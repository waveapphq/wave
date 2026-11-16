"""Carry a workflow's geometry across a revision.

A Block of the revised workflow is the Block it was when it is the same kind,
in the same section of the same construct, recognized by its name and settings
rather than by its place in the list; it keeps its stored position and any width
a person set. Blocks the revision adds or moves are placed, and the Blocks in
their way move down.
"""

import json
from collections.abc import Callable, Mapping
from difflib import SequenceMatcher
from typing import Any

from wavecore.core.layout.dimensions import estimate_node_size, fit_node_width
from wavecore.core.layout.engine import FlowTree, flow_tree, ingress_counts, layout_workflow

_Signature = Callable[[Mapping[str, Any]], tuple[str, ...]]


def _kind(data: Mapping[str, Any]) -> tuple[str, ...]:
    return (
        str(data.get("nodeType") or ""),
        str(data.get("elementType") or ""),
        str(data.get("functionId") or ""),
    )


def _settings(data: Mapping[str, Any]) -> str:
    values = (data.get("config") or {}).get("values") or {}
    return json.dumps(values, sort_keys=True, default=str)


def _label(data: Mapping[str, Any]) -> str:
    return str(data.get("label") or "")


def _same_everything(data: Mapping[str, Any]) -> tuple[str, ...]:
    return (*_kind(data), _label(data), _settings(data))


def _same_settings(data: Mapping[str, Any]) -> tuple[str, ...]:
    return (*_kind(data), _settings(data))


def _same_name(data: Mapping[str, Any]) -> tuple[str, ...]:
    return (*_kind(data), _label(data))


# Strongest first: each weaker one pairs only what the stronger ones left between their pairs.
_SIGNATURES: tuple[_Signature, ...] = (_same_everything, _same_settings, _same_name, _kind)


def _rows_by_id(tree: FlowTree) -> dict[str, dict[str, FlowTree]]:
    rows: dict[str, dict[str, FlowTree]] = {}
    for node_id, sections in tree:
        rows[node_id] = sections
        for flow in sections.values():
            rows.update(_rows_by_id(flow))
    return rows


class _Matcher:
    def __init__(
        self,
        previous: Mapping[str, Any],
        revised: Mapping[str, Any],
        anchors: Mapping[str, str],
    ) -> None:
        self.old_data = {str(n["id"]): n.get("data") or {} for n in previous.get("nodes") or []}
        self.new_data = {str(n["id"]): n.get("data") or {} for n in revised.get("nodes") or []}
        self.anchors = dict(anchors)
        self.anchored = set(anchors.values())
        self.matches: dict[str, str] = dict(anchors)

    def align_flows(self, old_flow: FlowTree, new_flow: FlowTree) -> None:
        # Anchored Blocks are paired already, so they never pair with another one.
        self._align(
            [row for row in old_flow if row[0] not in self.anchored],
            [row for row in new_flow if row[0] not in self.anchors],
            0,
        )

    def _align(self, old_flow: FlowTree, new_flow: FlowTree, level: int) -> None:
        if level == len(_SIGNATURES) or not old_flow or not new_flow:
            return
        signature = _SIGNATURES[level]
        matcher = SequenceMatcher(
            None,
            [signature(self.old_data[node_id]) for node_id, _ in old_flow],
            [signature(self.new_data[node_id]) for node_id, _ in new_flow],
            autojunk=False,
        )
        old_at = new_at = 0
        for old_start, new_start, size in matcher.get_matching_blocks():
            self._align(old_flow[old_at:old_start], new_flow[new_at:new_start], level + 1)
            for offset in range(size):
                old_id, old_sections = old_flow[old_start + offset]
                new_id, new_sections = new_flow[new_start + offset]
                self.matches[new_id] = old_id
                self.align_sections(old_sections, new_sections)
            old_at, new_at = old_start + size, new_start + size

    def align_sections(
        self, old_sections: Mapping[str, FlowTree], new_sections: Mapping[str, FlowTree]
    ) -> None:
        for handle, flow in new_sections.items():
            self.align_flows(old_sections.get(handle, []), flow)


def match_blocks(
    previous: Mapping[str, Any],
    revised: Mapping[str, Any],
    anchors: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Revised node id -> previous node id of the same Block; `anchors` pairs some up front."""
    old_tree = flow_tree(list(previous.get("nodes") or []), list(previous.get("edges") or []))
    new_tree = flow_tree(list(revised.get("nodes") or []), list(revised.get("edges") or []))
    matcher = _Matcher(previous, revised, anchors or {})
    matcher.align_flows(old_tree, new_tree)
    old_rows, new_rows = _rows_by_id(old_tree), _rows_by_id(new_tree)
    for new_id, old_id in matcher.anchors.items():
        matcher.align_sections(old_rows.get(old_id, {}), new_rows.get(new_id, {}))
    return matcher.matches


def _hand_set_width(node: dict[str, Any], ingress: int) -> dict[str, float]:
    """The stored width a person set; one equal to the generated fit is the compiler's."""
    width = node.get("width")
    if not isinstance(width, int | float) or width == fit_node_width(node, ingress):
        return {}
    return {"width": width}


def _grew(old: tuple[int, float], new: tuple[int, float]) -> bool:
    return new[0] > old[0] or new[1] > old[1]


def carry_geometry(
    previous: Mapping[str, Any],
    revised: dict[str, Any],
    anchors: Mapping[str, str] | None = None,
) -> None:
    """Give each revised Block the position and hand-set width of the Block it was, then lay out."""
    matches = match_blocks(previous, revised, anchors)
    old_nodes = {str(node["id"]): node for node in previous.get("nodes") or []}
    old_ingress = ingress_counts(list(previous.get("edges") or []))
    new_nodes = revised["nodes"]
    new_edges = revised["edges"]
    new_ingress = ingress_counts(new_edges)
    pinned: dict[str, dict[str, float]] = {}
    grown: set[str] = set()
    for node in new_nodes:
        node_id = str(node["id"])
        old = old_nodes.get(matches.get(node_id, ""))
        if old is None:
            continue
        ingress = old_ingress.get(str(old["id"]), 0)
        node.update(_hand_set_width(old, ingress))
        if isinstance(old.get("position"), dict):
            pinned[node_id] = old["position"]
        if _grew(
            estimate_node_size(old, ingress), estimate_node_size(node, new_ingress.get(node_id, 0))
        ):
            grown.add(node_id)
    positions = layout_workflow(new_nodes, new_edges, pinned, grown)
    for node in new_nodes:
        node["position"] = positions[str(node["id"])]
