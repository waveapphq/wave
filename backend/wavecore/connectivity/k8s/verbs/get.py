"""The K8s Get verb (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

Reads any Kubernetes kind by name, by label/field selector, or as a plain
list, and renders the answer as a map, a table envelope, JSON text or a yaml
envelope. The kind is resolved through live discovery, so custom resources
and short names work without a WAVE-side catalog. Reading kind Secret carries
every data value in the envelope's secrets list. Carries the family output
core and the fail-or-record Failure Handling control.
"""

import base64
from collections.abc import Callable
from contextlib import suppress
from typing import Any

from wavecore.connectivity.block_outputs import block_failure, block_success

from ..rest import K8sClient
from ._context import require_context
from ._errors import K8sReadRejected, map_api_error
from ._outputs import (
    empty_read_result,
    object_names,
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
    typed_kind,
)


def _empty_outputs(params: dict[str, Any]) -> dict[str, Any]:
    fmt = params.get("output_format", "map")
    listed = params.get("search_by", "name") != "name"
    return {"result": empty_read_result(fmt, listed=listed), "names": [], "count": 0}


def _selector_query(params: dict[str, Any]) -> dict[str, str]:
    query: dict[str, str] = {}
    if present(params, "label_selector"):
        query["labelSelector"] = params["label_selector"].strip()
    if present(params, "field_selector"):
        query["fieldSelector"] = params["field_selector"].strip()
    return query


def _secret_values(objects: list[dict[str, Any]]) -> list[str]:
    """Every Secret data value, base64 and decoded plaintext alike, for scrubbing."""
    values: list[str] = []
    for obj in objects:
        for encoded in obj.get("data", {}).values():
            values.append(encoded)
            with suppress(ValueError, TypeError):
                values.append(base64.b64decode(encoded, validate=True).decode())
    return values


def _failed(
    params: dict[str, Any], message: str, reason: str | None, log: Callable[[str, str], None]
) -> dict[str, Any]:
    """The result envelope of a recorded read failure; raises under on_error=fail."""
    outputs = block_failure(params, _empty_outputs(params), message, reason, log, action="Read")
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Resolve the kind, read the object or list, render it per output_format."""
    k8s_context = require_context(params)
    client = K8sClient(
        k8s_context, params.get("timeout", DEFAULT_TIMEOUT), **client_options(params)
    )
    try:
        resource = resolve_read_resource(client, typed_kind(params))
    except K8sReadRejected as exc:
        return _failed(params, exc.message, exc.reason, log)

    search_by = params.get("search_by", "name")
    named = search_by == "name"
    name = str(params["name"]).strip() if named else None
    namespace = resolve_namespace(params, k8s_context, named=named) if resource.namespaced else None
    query = _selector_query(params) if search_by == "selector" else None
    path = resource_path(resource, namespace, name, query)
    output_format = params.get("output_format", "map")

    status, parsed = read_formatted(client, path, output_format)
    if output_format == "table" and table_unsupported(status, parsed):
        return _failed(params, table_unsupported_message(resource.kind), "NotAcceptable", log)
    if status >= 400:
        target = name or ""
        verb = "read" if named else "list"
        message = map_api_error(status, parsed, resource.kind, target, namespace, verb=verb)
        return _failed(params, message, parsed.get("reason"), log)

    strip_managed_fields(parsed)
    objects = read_objects(parsed)
    names = object_names(objects)
    log("INFO", f"Read {len(names)} {resource.kind} object(s) from {path}")
    outputs = block_success(
        {"result": render_read_result(output_format, parsed), "names": names, "count": len(names)}
    )
    secrets = _secret_values(objects) if resource.kind == "Secret" else []
    return {"__wave_type": "result", "outputs": outputs, "secrets": secrets}
