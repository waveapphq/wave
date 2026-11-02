"""Workflow service layer for workflow validation (REQ-5.2.4.3).

This module provides the service layer for workflow validation operations.
It enables validating workflow structures independently of test context,
supporting cycle detection, reachability analysis, and structural verification.
"""

from typing import Any


def _build_adjacency(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> tuple[dict[str, dict[str, Any]], set[str], dict[str, list[str]]]:
    """Build node lookup map and adjacency list from workflow nodes and edges.

    Returns:
        Tuple of (node_map, node_ids, adjacency_list).
    """
    node_map: dict[str, dict[str, Any]] = {
        str(node_id): n for n in nodes if (node_id := n.get("id")) is not None
    }
    node_ids = set(node_map.keys())

    adj: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source in adj and target in node_ids:
            adj[source].append(target)

    return node_map, node_ids, adj


def _dfs_find_cycle(
    node: str,
    adj: dict[str, list[str]],
    visited: set[str],
    rec_stack: set[str],
    path: list[str],
) -> str | None:
    """DFS traversal with path tracking to find a cycle.

    Returns:
        Cycle description string if found, None otherwise.
    """
    visited.add(node)
    rec_stack.add(node)
    path.append(node)

    for neighbor in adj.get(node, []):
        if neighbor not in visited:
            result = _dfs_find_cycle(neighbor, adj, visited, rec_stack, path)
            if result:
                return result
        elif neighbor in rec_stack:
            cycle_start = path.index(neighbor)
            cycle = path[cycle_start:] + [neighbor]
            return " -> ".join(cycle)

    path.pop()
    rec_stack.remove(node)
    return None


def _check_cycle_from(
    start: str,
    adj: dict[str, list[str]],
    visited: set[str],
    rec_stack: set[str],
    errors: list[str],
) -> None:
    """Run DFS from a start node and append cycle error if found."""
    if start in visited:
        return
    cycle = _dfs_find_cycle(start, adj, visited, rec_stack, [])
    if cycle:
        errors.append(f"Workflow graph contains cycle: {cycle}")


def _detect_cycles(
    node_ids: set[str],
    adj: dict[str, list[str]],
    first_node_id: str | None,
) -> list[str]:
    """Detect cycles in the workflow graph using DFS with recursion stack.

    Returns:
        List of error messages for any cycles found.
    """
    errors: list[str] = []
    visited: set[str] = set()
    rec_stack: set[str] = set()

    if first_node_id:
        _check_cycle_from(first_node_id, adj, visited, rec_stack, errors)

    for nid in node_ids:
        _check_cycle_from(nid, adj, visited, rec_stack, errors)

    return errors


def _find_unreachable_nodes(
    nodes: list[dict[str, Any]],
    adj: dict[str, list[str]],
    first_node_id: str | None,
) -> list[str]:
    """Find nodes unreachable from the first node.

    Returns:
        List of error messages for unreachable nodes.
    """
    reachable: set[str] = set()

    def mark_reachable(node: str) -> None:
        if node in reachable:
            return
        reachable.add(node)
        for neighbor in adj.get(node, []):
            mark_reachable(neighbor)

    if first_node_id:
        mark_reachable(first_node_id)

    errors: list[str] = []
    for node in nodes:
        node_id = node.get("id")
        if node_id not in reachable:
            errors.append(f"Block '{node_id}' is unreachable from first block")

    return errors


def _validate_block_references(nodes: list[dict[str, Any]]) -> list[str]:
    """Validate block references on block-type nodes.

    Returns:
        List of error messages for invalid block references.
    """
    errors: list[str] = []
    for node in nodes:
        if node.get("type") != "block":
            continue
        block_ref = node.get("block_ref") or node.get("block_id")
        if block_ref and not isinstance(block_ref, str):
            errors.append(f"Block '{node.get('id')}' has invalid block reference")
    return errors


def _find_dead_ends(nodes: list[dict[str, Any]], adj: dict[str, list[str]]) -> list[str]:
    """Find nodes with no outgoing edges (dead ends).

    Returns:
        List of warning messages for dead-end nodes.
    """
    warnings: list[str] = []
    for node in nodes:
        node_id = str(node.get("id", ""))
        if not adj.get(node_id):
            warnings.append(f"Block '{node_id}' has no outgoing edges (dead end)")
    return warnings


def validate_workflow(workflow: dict[str, Any]) -> dict[str, Any]:
    """Validate workflow structure.

    Performs comprehensive workflow validation including:
    - Cycle detection in workflow graph
    - Reachability analysis from first node
    - Block reference validation
    - Node and edge consistency checks

    No start/end node requirements - startNode is injected at render time
    by the FE and leaf nodes are natural endpoints.

    Args:
        workflow: Workflow definition with nodes and edges

    Returns:
        Validation result with valid flag, errors, and warnings
    """
    errors: list[str] = []
    warnings: list[str] = []

    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])

    if not nodes:
        errors.append("Workflow must have at least one block")
        return {"valid": False, "errors": errors, "warnings": warnings}

    _node_map, node_ids, adj = _build_adjacency(nodes, edges)
    first_node_id = nodes[0].get("id")

    errors.extend(_detect_cycles(node_ids, adj, first_node_id))
    errors.extend(_find_unreachable_nodes(nodes, adj, first_node_id))
    errors.extend(_validate_block_references(nodes))
    warnings.extend(_find_dead_ends(nodes, adj))

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
