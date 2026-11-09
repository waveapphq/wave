"""The K8s Logs verb (REQ-3.3.2.1, REQ-3.4.1.5).

Reads one container's log through the pod log subresource, like kubectl logs,
and hands it back as text or per line, where a per-line read with Timestamps
on is a TIME and MESSAGE table envelope, with the shared success/error/reason
output core. The container is always named on the block (K8SREAD-20). A
cluster 400 ('previous' on a container that never restarted, a container the
pod does not have) surfaces the cluster's own message; the other cluster rows
come from the shared mapper; session, transport, TLS and timeout failures
always raise.
"""

import urllib.parse
from collections.abc import Callable
from typing import Any

from wavecore.connectivity.block_outputs import block_failure, block_success

from ..rest import K8sClient, K8sResource
from ._context import require_context
from ._errors import decode_status, map_api_error
from ._resources import DEFAULT_TIMEOUT, client_options, resolve_namespace, resource_path

_TABLE_COLUMNS = [("TIME", "string"), ("MESSAGE", "string")]
_PODS = K8sResource("Pod", "pods", True, "v1", "/api/v1")


def _log_table(text: str) -> dict[str, Any]:
    """The cluster prefixes an RFC3339 stamp and one space, so the first space splits it."""
    rows: list[list[str]] = []
    for line in text.splitlines():
        stamp, _space, message = line.partition(" ")
        rows.append([stamp, message])
    return {
        "__wave_type": "table",
        "columns": [{"name": name, "type": col_type} for name, col_type in _TABLE_COLUMNS],
        "rows": rows,
    }


def _render_logs(text: str, params: dict[str, Any]) -> Any:
    """A per-line read splits into a table when the cluster stamped every line."""
    if params.get("output_format", "string") != "array":
        return text
    if params.get("timestamps"):
        return _log_table(text)
    return text.splitlines()


def _empty_outputs(params: dict[str, Any]) -> dict[str, Any]:
    return {"logs": _render_logs("", params)}


def _log_query(params: dict[str, Any]) -> str:
    """The pod log subresource query; unset and false options stay off the wire."""
    query: dict[str, str] = {"container": str(params["container"])}
    if params.get("previous"):
        query["previous"] = "true"
    if params.get("tail_lines") is not None:
        query["tailLines"] = str(params["tail_lines"])
    if params.get("since_seconds") is not None:
        query["sinceSeconds"] = str(params["since_seconds"])
    if params.get("timestamps"):
        query["timestamps"] = "true"
    if params.get("max_bytes") is not None:
        query["limitBytes"] = str(params["max_bytes"])
    return f"?{urllib.parse.urlencode(query)}"


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Read the log subresource once and render the output core."""
    pod = params["pod"]
    k8s_context = require_context(params)
    namespace = resolve_namespace(params, k8s_context, named=True)
    client = K8sClient(
        k8s_context, params.get("timeout", DEFAULT_TIMEOUT), **client_options(params)
    )
    path = f"{resource_path(_PODS, namespace, pod)}/log{_log_query(params)}"

    status, payload = client.request("GET", path, None, raw=True)
    if status >= 400:
        body = decode_status(payload)
        detail = body.get("message", "")
        if status == 400 and detail:
            message = f"Kubernetes rejected the log request: {detail}"
        else:
            message = map_api_error(status, body, "Pod", pod, namespace, verb="read")
        outputs = block_failure(
            params, _empty_outputs(params), message, body.get("reason"), log, action="Read"
        )
        return {"__wave_type": "result", "outputs": outputs, "secrets": []}

    max_bytes = params.get("max_bytes")
    text = (payload[:max_bytes] if max_bytes else payload).decode("utf-8", errors="replace")
    log("INFO", f"Read {len(text)} characters of log from pod '{pod}' in '{namespace}'")
    outputs = block_success({"logs": _render_logs(text, params)})
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}
