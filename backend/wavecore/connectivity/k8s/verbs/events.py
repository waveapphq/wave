"""The K8s Events verb (REQ-3.3.5.4, REQ-3.4.1.5).

Lists core v1 Events namespace-wide, cluster-wide, or scoped to one object,
filtered by type, reason and age, and hands them back newest-first as a map,
a table envelope, JSON text or a yaml envelope. Carries the family output
core and the fail-or-record Failure Handling control.
"""

import re
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from ..rest import K8sClient, K8sResource
from ._context import require_context
from ._errors import K8sReadRejected, map_api_error
from ._outputs import (
    block_failure,
    block_success,
    empty_read_result,
    read_formatted,
    read_objects,
    render_read_result,
    strip_managed_fields,
    table_unsupported,
    table_unsupported_message,
)
from ._resources import (
    DEFAULT_TIMEOUT,
    client_options,
    present,
    resolve_namespace,
    resolve_read_resource,
    resource_path,
)

_EVENTS = K8sResource(
    kind="Event", name="events", namespaced=True, group_version="v1", path_root="/api/v1"
)
_NEVER = "1970-01-01T00:00:00Z"
_FRACTION = re.compile(r"\.(\d+)")
_OFFSET = re.compile(r"([+-])(\d{2}):?(\d{2})?$")


def _empty_outputs(params: dict[str, Any]) -> dict[str, Any]:
    fmt = params.get("output_format", "map")
    return {"result": empty_read_result(fmt, listed=True), "count": 0}


def _scoped_kind(params: dict[str, Any]) -> str:
    if params.get("object_type", "default") == "custom":
        return str(params["object_kind_custom"]).strip()
    return str(params["object_kind"]).strip()


def _field_selector(params: dict[str, Any], target: K8sResource | None) -> dict[str, str]:
    clauses: list[str] = []
    if target is not None:
        clauses.append(f"involvedObject.kind={target.kind}")
        clauses.append(f"involvedObject.name={str(params['object_name']).strip()}")
    event_type = params.get("event_type", "any")
    if event_type != "any":
        clauses.append(f"type={event_type}")
    if present(params, "reason"):
        clauses.append(f"reason={params['reason'].strip()}")
    return {"fieldSelector": ",".join(clauses)} if clauses else {}


def _parseable(stamp: str) -> str:
    """The stamp in the isoformat grammar Python 3.10 reads: a colon-separated UTC-anchored
    offset and six fraction digits."""
    if stamp.endswith("Z"):
        stamp = f"{stamp[:-1]}+00:00"
    stamp = _FRACTION.sub(lambda match: f".{match.group(1)[:6]:0<6}", stamp, count=1)
    date, sep, time = stamp.partition("T")
    if not sep:
        return stamp
    offset = _OFFSET.search(time)
    # An offset-naive stamp reads as UTC, so every event sorts against every other.
    if offset is None:
        return f"{date}T{time}+00:00"
    sign, hours, minutes = offset.groups()
    return f"{date}T{time[: offset.start()]}{sign}{hours}:{minutes or '00'}"


def _seen_at(event: dict[str, Any]) -> datetime:
    """When the event was last seen; an event without any timestamp sorts as the oldest."""
    value = (
        event.get("lastTimestamp")
        or event.get("eventTime")
        or event.get("firstTimestamp")
        or event.get("metadata", {}).get("creationTimestamp")
        or _NEVER
    )
    return datetime.fromisoformat(_parseable(str(value)))


def _ordered(parsed: dict[str, Any], output_format: str, params: dict[str, Any]) -> dict[str, Any]:
    """Newest-first, inside the age window, cut at max_events: Table rows or list items."""
    key = "rows" if output_format == "table" else "items"
    # A Table row carries its event under 'object'; a list item is the event itself.
    stamped = [(_seen_at(entry.get("object", entry)), entry) for entry in parsed.get(key, [])]
    stamped.sort(key=lambda pair: pair[0], reverse=True)
    within = params.get("within_seconds")
    # datetime.UTC is 3.11+; the remote bundle runs on 3.10 hosts (keep timezone.utc).
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=within) if within else None
    kept = [entry for seen, entry in stamped if cutoff is None or seen >= cutoff]
    return {**parsed, key: kept[: params.get("max_events")]}


def _failed(
    params: dict[str, Any], message: str, reason: str | None, log: Callable[[str, str], None]
) -> dict[str, Any]:
    """The result envelope of a recorded read failure; raises under on_error=fail."""
    outputs = block_failure(params, _empty_outputs(params), message, reason, log, action="Read")
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """List the events, order and trim them in the verb, render per output_format."""
    k8s_context = require_context(params)
    client = K8sClient(
        k8s_context, params.get("timeout", DEFAULT_TIMEOUT), **client_options(params)
    )
    namespace = resolve_namespace(params, k8s_context)
    output_format = params.get("output_format", "map")
    target = None
    if params.get("scope_to_object"):
        try:
            target = resolve_read_resource(client, _scoped_kind(params))
        except K8sReadRejected as exc:
            return _failed(params, exc.message, exc.reason, log)
    query = _field_selector(params, target)
    if output_format == "table":
        # The Table default embeds only metadata, which carries no last-seen stamp.
        query["includeObject"] = "Object"
    path = resource_path(_EVENTS, namespace, None, query)

    status, parsed = read_formatted(client, path, output_format)
    if output_format == "table" and table_unsupported(status, parsed):
        return _failed(params, table_unsupported_message(_EVENTS.kind), "NotAcceptable", log)
    if status >= 400:
        message = map_api_error(status, parsed, _EVENTS.kind, "", namespace, verb="list")
        return _failed(params, message, parsed.get("reason"), log)

    parsed = _ordered(strip_managed_fields(parsed), output_format, params)
    count = len(read_objects(parsed))
    log("INFO", f"Read {count} event(s) from {path}")
    outputs = block_success({"result": render_read_result(output_format, parsed), "count": count})
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}
