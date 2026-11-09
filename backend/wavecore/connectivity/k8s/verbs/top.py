"""The K8s Top verb (REQ-5.1.1, REQ-3.4.1.5).

Reads resource usage from the aggregated metrics API for pods or nodes,
selected by name, by label selector, or all of them. Wire quantities are
converted to raw cores and bytes, never percentages, so the workflow picks
its own denominator. A pod's usage is the sum over its containers, with an
optional per-container breakdown; a node row also carries the node's
capacity and allocatable. CPU crosses the wire as an exact decimal string.
A cluster without the metrics API hard-fails in both on_error modes.
"""

from collections.abc import Callable, Iterable
from decimal import Decimal
from typing import Any

from wavecore.connectivity.block_outputs import block_failure, block_success

from ..rest import K8sClient, K8sResource
from ._context import require_context
from ._errors import K8sReadRejected, map_api_error
from ._resources import DEFAULT_TIMEOUT, client_options, resolve_namespace, resource_path

_METRICS_API = "metrics.k8s.io/v1beta1"
_METRICS_ROOT = f"/apis/{_METRICS_API}"
_POD_METRICS = K8sResource("Pod", "pods", True, _METRICS_API, _METRICS_ROOT)
_NODE_METRICS = K8sResource("Node", "nodes", False, _METRICS_API, _METRICS_ROOT)
_NODES = K8sResource("Node", "nodes", False, "v1", "/api/v1")
_METRICS_MISSING = (
    f"This cluster does not serve the metrics API '{_METRICS_API}' - "
    "check whether metrics-server is installed"
)
_UNKNOWN_USAGE: dict[str, Any] = {"cpu": None, "memory": None}
_POD_COLUMNS = [("NAME", "string"), ("CPU", "float"), ("MEMORY", "integer")]
_CONTAINER_COLUMNS = [
    ("NAME", "string"),
    ("CONTAINER", "string"),
    ("CPU", "float"),
    ("MEMORY", "integer"),
]
_NODE_COLUMNS = [
    ("NAME", "string"),
    ("CPU", "float"),
    ("MEMORY", "integer"),
    ("CAPACITY CPU", "float"),
    ("CAPACITY MEMORY", "integer"),
    ("ALLOCATABLE CPU", "float"),
    ("ALLOCATABLE MEMORY", "integer"),
]
_SUFFIX_CHARS = "numkKMGTPEi"
_QUANTITY_SCALE: dict[str, Decimal] = {
    "": Decimal(1),
    "n": Decimal("1e-9"),
    "u": Decimal("1e-6"),
    "m": Decimal("1e-3"),
    "k": Decimal("1e3"),
    "M": Decimal("1e6"),
    "G": Decimal("1e9"),
    "T": Decimal("1e12"),
    "P": Decimal("1e15"),
    "E": Decimal("1e18"),
    "Ki": Decimal(1024),
    "Mi": Decimal(1024**2),
    "Gi": Decimal(1024**3),
    "Ti": Decimal(1024**4),
    "Pi": Decimal(1024**5),
    "Ei": Decimal(1024**6),
}


def _quantity(text: str) -> Decimal:
    """A Kubernetes quantity string as its base-unit value (cores or bytes)."""
    number = text.rstrip(_SUFFIX_CHARS)
    return Decimal(number) * _QUANTITY_SCALE[text[len(number) :]]


def _totals(usages: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Sum cpu and memory over usage maps: cpu as exact cores, memory as bytes."""
    items = list(usages)
    cpu = sum((_quantity(usage.get("cpu", "0")) for usage in items), Decimal(0))
    memory = sum((_quantity(usage.get("memory", "0")) for usage in items), Decimal(0))
    return {"cpu": cpu, "memory": int(memory)}


def _columns(params: dict[str, Any]) -> list[tuple[str, str]]:
    """The usage columns the mode prints, the way kubectl top heads its output."""
    if params.get("scope", "pod") == "node":
        return _NODE_COLUMNS
    if params.get("include_containers"):
        return _CONTAINER_COLUMNS
    return _POD_COLUMNS


def _usage_table(params: dict[str, Any], rows: list[list[Any]]) -> dict[str, Any]:
    """The usage table envelope; a Decimal cell crosses the wire in fixed-point text."""
    return {
        "__wave_type": "table",
        "columns": [{"name": name, "type": col_type} for name, col_type in _columns(params)],
        "rows": [
            [format(cell, "f") if isinstance(cell, Decimal) else cell for cell in cells]
            for cells in rows
        ],
    }


def _cells(totals: dict[str, Any]) -> list[Any]:
    return [totals["cpu"], totals["memory"]]


def _empty_outputs(params: dict[str, Any]) -> dict[str, Any]:
    return {"usage": _usage_table(params, []), "count": 0}


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Probe the metrics API, read the usage rows, and emit them with the output core."""
    k8s_context = require_context(params)
    client = K8sClient(
        k8s_context, params.get("timeout", DEFAULT_TIMEOUT), **client_options(params)
    )
    scope = params.get("scope", "pod")
    named = params.get("select_by", "all") == "name"

    status, _ = client.request("GET", _METRICS_ROOT, None)
    if status == 404:
        raise ValueError(_METRICS_MISSING)
    try:
        if scope == "pod":
            namespace = resolve_namespace(params, k8s_context, named=named)
            rows = _pod_rows(client, params, namespace)
        else:
            rows = _node_rows(client, params)
    except K8sReadRejected as exc:
        outputs = block_failure(
            params, _empty_outputs(params), exc.message, exc.reason, log, action="Read"
        )
        return {"__wave_type": "result", "outputs": outputs, "secrets": []}
    log("INFO", f"Read {scope} usage: {len(rows)} rows")
    outputs = block_success({"usage": _usage_table(params, rows), "count": len(rows)})
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def _pod_rows(client: K8sClient, params: dict[str, Any], namespace: str | None) -> list[list[Any]]:
    pods = _targets(client, params, _POD_METRICS, namespace)
    rows: list[list[Any]] = []
    for pod in pods:
        name = pod["metadata"]["name"]
        containers = pod.get("containers", [])
        if params.get("include_containers"):
            rows.extend([name, c["name"], *_cells(_totals([c["usage"]]))] for c in containers)
        else:
            rows.append([name, *_cells(_totals(c["usage"] for c in containers))])
    return rows


def _node_rows(client: K8sClient, params: dict[str, Any]) -> list[list[Any]]:
    metrics = _targets(client, params, _NODE_METRICS, None, optional=True)
    nodes = _targets(client, params, _NODES, None)
    statuses = {node["metadata"]["name"]: node.get("status", {}) for node in nodes}
    usages = {item["metadata"]["name"]: item.get("usage", {}) for item in metrics}
    rows: list[list[Any]] = []
    # kubectl prints the reporting nodes first, then the ones metrics never answered for.
    for name in sorted(statuses, key=lambda node: node not in usages):
        status = statuses[name]
        used = _totals([usages[name]]) if name in usages else _UNKNOWN_USAGE
        rows.append(
            [
                name,
                *_cells(used),
                *_cells(_totals([status.get("capacity", {})])),
                *_cells(_totals([status.get("allocatable", {})])),
            ]
        )
    return rows


def _targets(
    client: K8sClient,
    params: dict[str, Any],
    resource: K8sResource,
    namespace: str | None,
    *,
    optional: bool = False,
) -> list[dict[str, Any]]:
    """The selected objects of one resource: a single named one, or a filtered list."""
    select_by = params.get("select_by", "all")
    if select_by == "name":
        name = params["name"]
        path = resource_path(resource, namespace, name)
        found = _get(client, path, resource.kind, name, namespace, verb="read", optional=optional)
        return [found] if found is not None else []
    query = None
    if select_by == "selector" and params.get("label_selector"):
        query = {"labelSelector": params["label_selector"]}
    path = resource_path(resource, namespace, query=query)
    body = _get(client, path, resource.kind, "", namespace, verb="list", optional=optional)
    return list(body.get("items", [])) if body is not None else []


def _get(
    client: K8sClient,
    path: str,
    kind: str,
    name: str,
    namespace: str | None,
    *,
    verb: str,
    optional: bool = False,
) -> dict[str, Any] | None:
    """None when an optional read finds nothing; every other error still fails the block."""
    status, body = client.request("GET", path, None)
    if status == 404 and optional:
        return None
    if status >= 400:
        raise K8sReadRejected(
            map_api_error(status, body, kind, name, namespace, verb=verb),
            body.get("reason"),
        )
    return dict(body)
