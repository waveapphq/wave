"""Watch-mode frames: a build's growing snapshots and a change's turns.

reveal_frames streams a clean compile_recipe result into a sequence of growing
canvas snapshots, one per flow node in the compiler's pre-order. Every frame
seeds all variables; an edge appears once both endpoints are revealed (the
implicit start-node counts as always revealed). The final frame equals the full
compiled workflow, and every frame carries the finished test's bounds.

change_frames plays an amendment on a saved test: one step that moves the Blocks
that stay and drops the removed ones, then one turn per added or changed Block. A Block
counts as changed when its readback form or the secrets it holds differ.
"""

from collections.abc import Iterator, Mapping
from typing import Any

from wavecore.core.layout.dimensions import estimate_node_size
from wavecore.core.layout.engine import ingress_counts
from wavecore.core.layout.revision import (
    CANVAS_CONFIG_SETTINGS,
    CANVAS_DATA_SETTINGS,
    without_condition_ids,
)
from wavecore.core.recipes.amend import readback_form
from wavecore.core.secrets.masking import holds_secret_value
from wavecore.core.secrets.sealing import iter_workflow_secret_items, mask_workflow_node_secrets

_START_NODE_ID = "start-node"
_GEOMETRY = ("position", "width", "height")


def _final_bounds(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, float]:
    """``{x, y, width, height}`` around every node at its final position and layout size."""
    ingress = ingress_counts(edges)
    boxes = []
    for node in nodes:
        width, height = estimate_node_size(node, ingress.get(node["id"], 0))
        x, y = node["position"]["x"], node["position"]["y"]
        boxes.append((x, y, x + width, y + height))
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    return {
        "x": left,
        "y": top,
        "width": max(box[2] for box in boxes) - left,
        "height": max(box[3] for box in boxes) - top,
    }


def reveal_frames(test_data: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Yield growing ``{nodes, edges, variables, active_node_id, final_bounds}`` snapshots.

    One frame per flow node in list (pre-order) order. An empty workflow yields
    nothing (a variables-only frame has no active node).
    """
    workflow = test_data["workflow"]
    nodes = workflow["nodes"]
    edges = workflow["edges"]
    variables = test_data["variables"]
    if not nodes:
        return
    bounds = _final_bounds(nodes, edges)
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
            "final_bounds": bounds,
        }


def _without_geometry(node: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in node.items() if key not in _GEOMETRY}


def _content(node: Mapping[str, Any]) -> Any:
    """What a Block holds, its ids, its geometry and its canvas settings aside, at every depth
    of a local body; a recipe cannot change a canvas setting, so it never makes a turn."""
    data = {
        key: value
        for key, value in (node.get("data") or {}).items()
        if key != "recipeKey" and key not in CANVAS_DATA_SETTINGS
    }
    config = data.get("config") or {}
    data["config"] = {k: v for k, v in config.items() if k not in CANVAS_CONFIG_SETTINGS}
    definition = data.get("localDefinition")
    if isinstance(definition, Mapping) and isinstance(definition.get("workflow"), Mapping):
        body = definition["workflow"]
        nodes = [{**_without_geometry(inner), "data": _content(inner)} for inner in body["nodes"]]
        data["localDefinition"] = {**definition, "workflow": {**body, "nodes": nodes}}
    return without_condition_ids(data)


def _secrets_held(node: Mapping[str, Any]) -> list[str]:
    """The secret places a Block holds a value in, at every depth, whatever the values are."""
    items = iter_workflow_secret_items({"nodes": [node], "edges": []})
    return sorted(name for name, value in items if holds_secret_value(value))


def _compared(
    test: Mapping[str, Any], placement_defaults: Mapping[str, Mapping[str, Any]] | None
) -> dict[str, tuple[Any, list[str]]]:
    """Each Block's content as its test's readback compiles it, and the secrets it holds.

    A canvas save and a compile write the same Block differently; the readback form is the
    same for both. A Block the readback form lacks compares as it is stored.
    """
    readback = readback_form(test, placement_defaults)
    compiled = mask_workflow_node_secrets(readback["workflow"])["nodes"] if readback else []
    canonical = {node["id"]: node for node in compiled}
    return {
        node["id"]: (_content(canonical.get(node["id"], node)), _secrets_held(node))
        for node in mask_workflow_node_secrets(test["workflow"])["nodes"]
    }


def _changed_ids(
    stored: Mapping[str, Any],
    revised: Mapping[str, Any],
    placement_defaults: Mapping[str, Mapping[str, Any]] | None,
) -> set[str]:
    """The Blocks that stay but hold something a person sees as new; a secret's value aside."""
    before = _compared(stored, placement_defaults)
    return {
        node_id
        for node_id, compared in _compared(revised, placement_defaults).items()
        if node_id in before and compared != before[node_id]
    }


def _line(edge: Mapping[str, Any]) -> tuple[Any, ...]:
    return (edge["source"], edge.get("sourceHandle"), edge["target"], edge.get("targetHandle"))


def change_frames(
    stored: Mapping[str, Any],
    revised: Mapping[str, Any],
    placement_defaults: Mapping[str, Mapping[str, Any]] | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield the frames of a watched change, each ``{nodes, edges, variables, active_node_id,
    final_bounds}``: step one, then one turn per added or changed Block in flow order.

    ``stored`` and ``revised`` are tests whose recognized Blocks share their ids. An unchanged
    Block has its final form from step one; a changed one shows its stored form at its final
    place until its turn. ``placement_defaults`` are the ones the revision compiled with.
    """
    nodes = revised["workflow"]["nodes"]
    edges = revised["workflow"]["edges"]
    variables = revised["variables"]
    bounds = _final_bounds(nodes, edges)
    before = {node["id"]: node for node in stored["workflow"]["nodes"]}
    changed = _changed_ids(stored, revised, placement_defaults)
    kept_lines = {_line(edge): edge for edge in stored["workflow"]["edges"]}
    turns = [node["id"] for node in nodes if node["id"] not in before or node["id"] in changed]
    final = {node_id for node_id in before if node_id not in changed} | {_START_NODE_ID}
    shown = set(before) | {_START_NODE_ID}
    for active in [None, *turns]:
        if active is not None:
            final.add(active)
            shown.add(active)
        frame_nodes = [
            node if node["id"] in final else _stored_form_at(before[node["id"]], node)
            for node in nodes
            if node["id"] in shown
        ]
        frame_edges = [
            kept_lines.get(_line(edge), edge)
            for edge in edges
            if {edge["source"], edge["target"]} <= final
            or (_line(edge) in kept_lines and {edge["source"], edge["target"]} <= shown)
        ]
        yield {
            "nodes": frame_nodes,
            "edges": frame_edges,
            "variables": variables,
            "active_node_id": active,
            "final_bounds": bounds,
        }


def _stored_form_at(stored: Mapping[str, Any], final: Mapping[str, Any]) -> dict[str, Any]:
    """A Block as stored, at the place and size it ends up with."""
    return {**_without_geometry(stored), **{key: final[key] for key in _GEOMETRY if key in final}}
