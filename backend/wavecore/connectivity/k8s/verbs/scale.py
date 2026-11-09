"""The K8s Scale verb (REQ-5.1.1, REQ-3.4.1.5).

Sets the replica count of any scalable kind through the /scale subresource:
the count already in place is read first, then the new one is written back as
a merge patch. The verb does not wait and does not poll, and a kind the
cluster serves no scale endpoint for is refused before anything is written.
Carries the family output core and the fail-or-record Failure Handling control.
"""

from collections.abc import Callable
from typing import Any

from wavecore.connectivity.block_outputs import block_failure, block_success, summary_table

from ..rest import K8sClient
from ._context import require_context
from ._errors import K8sReadRejected, map_api_error
from ._outputs import type_name
from ._resources import (
    DEFAULT_TIMEOUT,
    client_options,
    resolve_namespace,
    resolve_read_resource,
    resource_path,
    typed_kind,
)

_SUMMARY_COLUMNS: list[tuple[str, str]] = [
    ("RESOURCE", "string"),
    ("OUTCOME", "string"),
    ("PREVIOUS", "integer"),
    ("REPLICAS", "integer"),
]
_MERGE_PATCH = "application/merge-patch+json"


def _empty_outputs() -> dict[str, Any]:
    return {"summary": summary_table(_SUMMARY_COLUMNS, [])}


def _failed(
    params: dict[str, Any], message: str, reason: str | None, log: Callable[[str, str], None]
) -> dict[str, Any]:
    """The result envelope of a recorded scale failure; raises under on_error=fail."""
    outputs = block_failure(params, _empty_outputs(), message, reason, log, action="Scale")
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def _replicas(scale: dict[str, Any]) -> int:
    """The API omits spec.replicas at zero, so a missing key is a count of zero."""
    return int(scale.get("spec", {}).get("replicas", 0))


def _cannot_scale(kind: str) -> str:
    return f"Kind '{kind}' cannot be scaled - the cluster serves no scale endpoint for it"


def _is_no_scale_endpoint(status: int, body: dict[str, Any]) -> bool:
    """A missing object names itself in details; a missing subresource has nothing to name."""
    return status == 404 and not body.get("details", {}).get("name")


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Read the scale subresource for the count in place, then merge-patch the new one."""
    k8s_context = require_context(params)
    client = K8sClient(
        k8s_context, params.get("timeout", DEFAULT_TIMEOUT), **client_options(params)
    )
    try:
        resource = resolve_read_resource(client, typed_kind(params))
    except K8sReadRejected as exc:
        return _failed(params, exc.message, exc.reason, log)

    name = str(params["name"]).strip()
    namespace = resolve_namespace(params, k8s_context, named=True) if resource.namespaced else None
    path = resource_path(resource, namespace, name, subresource="scale")

    status, scale = client.request("GET", path, None)
    if status >= 400:
        message = (
            _cannot_scale(resource.kind)
            if _is_no_scale_endpoint(status, scale)
            else map_api_error(status, scale, resource.kind, name, namespace, verb="scale")
        )
        return _failed(params, message, scale.get("reason"), log)

    previous = _replicas(scale)
    wanted = int(params["replicas"])
    status, patched = client.request(
        "PATCH", path, {"spec": {"replicas": wanted}}, content_type=_MERGE_PATCH
    )
    if status >= 400:
        message = map_api_error(status, patched, resource.kind, name, namespace, verb="scale")
        return _failed(params, message, patched.get("reason"), log)

    target = type_name(resource, name)
    replicas = _replicas(patched)
    log("INFO", f"Scaled {target} from {previous} to {replicas}")
    outputs = block_success(
        {"summary": summary_table(_SUMMARY_COLUMNS, [[target, "scaled", previous, replicas]])}
    )
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}
