"""Watch-mode reveal frames: growing pre-order snapshots of a compiled test.

reveal_frames streams a clean compile_recipe result into a sequence of growing
canvas snapshots, one per flow node in the compiler's pre-order. Every frame
seeds all variables; an edge appears once both endpoints are revealed (the
implicit start-node counts as always revealed). The final frame equals the full
compiled workflow.
"""

from collections.abc import Iterator
from typing import Any

_START_NODE_ID = "start-node"


def reveal_frames(test_data: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Yield growing ``{nodes, edges, variables, active_node_id}`` snapshots.

    One frame per flow node in list (pre-order) order. An empty workflow yields
    nothing (a variables-only frame has no active node).
    """
    workflow = test_data["workflow"]
    nodes = workflow["nodes"]
    edges = workflow["edges"]
    variables = test_data["variables"]
    for index in range(len(nodes)):
        revealed = nodes[: index + 1]
        revealed_ids = {node["id"] for node in revealed}
        frame_edges = [
            edge
            for edge in edges
            if edge["target"] in revealed_ids
            and (edge["source"] in revealed_ids or edge["source"] == _START_NODE_ID)
        ]
        yield {
            "nodes": revealed,
            "edges": frame_edges,
            "variables": variables,
            "active_node_id": nodes[index]["id"],
        }
