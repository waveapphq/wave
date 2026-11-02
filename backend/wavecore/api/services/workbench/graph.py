"""Graph traversal and topology helpers for workbench workflow execution."""

from typing import Any


def _topological_sort_workflow(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Sort workflow nodes in execution order based on edges."""
    node_map = {n["id"]: n for n in nodes}
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}

    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source in adj and target in in_degree:
            adj[source].append(target)
            in_degree[target] += 1

    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    sorted_nodes: list[dict[str, Any]] = []

    while queue:
        nid = queue.pop(0)
        if nid in node_map:
            sorted_nodes.append(node_map[nid])
        for neighbor in adj.get(nid, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    return sorted_nodes


def _build_adjacency_list(
    edges: list[dict[str, Any]],
) -> dict[str, list[tuple[str, str | None]]]:
    """Build adjacency list from edges with sourceHandle for branching support."""
    adj: dict[str, list[tuple[str, str | None]]] = {}
    for edge in edges:
        source = edge.get("source", "")
        target = edge.get("target", "")
        source_handle: str | None = edge.get("sourceHandle")
        adj.setdefault(source, []).append((target, source_handle))
    return adj


def _find_entry_points(edges: list[dict[str, Any]], node_id_set: set[str]) -> list[str]:
    """Find nodes directly connected from start-node."""
    return [
        edge.get("target", "")
        for edge in edges
        if edge.get("source", "") == "start-node" and edge.get("target", "") in node_id_set
    ]


def _collect_reachable_nodes(
    entry_points: list[str],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """BFS from entry points to find reachable executable nodes in order."""
    visited: set[str] = set()
    queue: list[str] = list(entry_points)
    executable_nodes: list[dict[str, Any]] = []

    while queue:
        nid = queue.pop(0)
        if nid in visited:
            continue
        visited.add(nid)

        node = node_map.get(nid)
        if node and node.get("type") == "workflowNode":
            executable_nodes.append(node)

        for child_id, _handle in adj.get(nid, []):
            if child_id not in visited:
                queue.append(child_id)

    return executable_nodes


def _ensure_output_variables(
    executable_nodes: list[dict[str, Any]], variables: dict[str, Any]
) -> None:
    """Pre-execution reconciliation: ensure output-bound variables exist (REQ-3.1.3.6)."""
    for node in executable_nodes:
        nd = node.get("data", {})
        bindings = nd.get("config", {}).get("outputBindings", {})
        for _output_name, var_name in bindings.items():
            if var_name and var_name not in variables:
                variables[var_name] = None
