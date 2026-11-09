"""The K8s Delete verb (REQ-5.1.1, REQ-3.4.1.5, K8SWRITE-5).

Removes one Kubernetes object by name or every object a label selector
matches, with kubectl's own cascade, grace period and wait-until-gone
controls. It follows kubectl on a missing target: a name that is already
gone is an error unless 'Ignore not found' is ticked, while a selector that
matches nothing is a pass with count 0. The wait polls on a monotonic
deadline bounded by the block timeout. Carries the family output core and
the fail-or-record Failure Handling control.
"""

import time
from collections.abc import Callable
from typing import Any

from wavecore.connectivity.block_outputs import block_failure, block_success, summary_table

from ..rest import K8sClient, K8sResource, seconds
from ._context import require_context
from ._errors import K8sReadRejected, map_api_error
from ._outputs import object_names, read_objects, type_name
from ._resources import (
    DEFAULT_TIMEOUT,
    client_options,
    resolve_namespace,
    resolve_read_resource,
    resource_path,
    typed_kind,
)

_POLICIES = {"background": "Background", "foreground": "Foreground", "orphan": "Orphan"}
_SUMMARY_COLUMNS: list[tuple[str, str]] = [("RESOURCE", "string"), ("OUTCOME", "string")]
_POLL_INTERVAL_SECONDS = 1.0


def _empty_outputs() -> dict[str, Any]:
    return {"summary": summary_table(_SUMMARY_COLUMNS, []), "names": [], "count": 0}


def _failed(
    params: dict[str, Any], message: str, reason: str | None, log: Callable[[str, str], None]
) -> dict[str, Any]:
    """The result envelope of a recorded delete failure; raises under on_error=fail."""
    outputs = block_failure(params, _empty_outputs(), message, reason, log, action="Delete")
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def _delete_query(params: dict[str, Any]) -> dict[str, str]:
    query = {"propagationPolicy": _POLICIES[params.get("cascade", "background")]}
    grace = params.get("grace_period_seconds")
    if grace is not None:
        query["gracePeriodSeconds"] = str(grace)
    return query


def _is_gone(status: int, parsed: dict[str, Any], *, named: bool) -> bool:
    """Only the cluster's own answer proves absence; an error answer proves nothing."""
    if named:
        return status == 404
    return status < 400 and not parsed.get("items")


def _wait_target(
    resource: K8sResource, namespace: str | None, names: list[str], selector: str | None
) -> tuple[str, str]:
    """Name mode polls the object itself; selector mode polls the collection it matched."""
    if selector is None:
        return resource_path(resource, namespace, names[0]), type_name(resource, names[0])
    return (
        resource_path(resource, namespace, None, {"labelSelector": selector}),
        f"{resource.name} matching {selector}",
    )


def _wait_until_gone(client: K8sClient, path: str, timeout: float, *, named: bool) -> bool:
    """True once the cluster says it is gone; False when the deadline passed first."""
    deadline = time.monotonic() + timeout
    while True:
        # The first poll is unconditional: the deadline is checked after it, never before.
        status, parsed = client.request("GET", path, None)
        if _is_gone(status, parsed, named=named):
            return True
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        time.sleep(min(_POLL_INTERVAL_SECONDS, remaining))


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Resolve the kind, delete the object or the matching set, then wait for it to go."""
    k8s_context = require_context(params)
    timeout = params.get("timeout", DEFAULT_TIMEOUT)
    client = K8sClient(k8s_context, timeout, **client_options(params))
    try:
        resource = resolve_read_resource(client, typed_kind(params))
    except K8sReadRejected as exc:
        return _failed(params, exc.message, exc.reason, log)

    named = params.get("delete_by", "name") == "name"
    namespace = resolve_namespace(params, k8s_context) if resource.namespaced else None
    name = str(params["name"]).strip() if named else None
    selector = None if named else str(params["label_selector"]).strip()
    query = _delete_query(params)
    if selector is not None:
        query["labelSelector"] = selector
    path = resource_path(resource, namespace, name, query)

    status, parsed = client.request("DELETE", path, None)
    if named and status == 404 and params.get("ignore_not_found"):
        names: list[str] = []
    elif status >= 400:
        message = map_api_error(status, parsed, resource.kind, name or "", namespace, verb="delete")
        return _failed(params, message, parsed.get("reason"), log)
    elif named:
        names = [str(name)]
    else:
        names = object_names(read_objects(parsed))

    if names and params.get("wait_until_gone", True):
        wait_path, target = _wait_target(resource, namespace, names, selector)
        if not _wait_until_gone(client, wait_path, timeout, named=named):
            message = f"Timed out after {seconds(timeout)} waiting for {target} to be deleted"
            return _failed(params, message, "Timeout", log)

    log("INFO", f"Deleted {len(names)} {resource.kind} object(s) from {path}")
    outputs = block_success(
        {
            "summary": summary_table(
                _SUMMARY_COLUMNS, [[type_name(resource, n), "deleted"] for n in names]
            ),
            "names": names,
            "count": len(names),
        }
    )
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}
