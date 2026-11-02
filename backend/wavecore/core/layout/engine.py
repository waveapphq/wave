"""Deterministic recursive column layout for compiled workflows.

Pure function of the flow's structure: the same nodes and edges always
produce identical positions. Child flows occupy centered columns beneath
their construct; continuation resumes on the parent centerline below the
deepest child row.
"""

import re
from collections import defaultdict
from typing import Any

from wavecore.core.layout.dimensions import estimate_node_size

RHYTHM_Y = 140
GUTTER_X = 80
MIN_COLUMN_WIDTH = 240

START_NODE_ID = "start-node"

_INDEXED_HANDLE = re.compile(r"^(?:branch|case)_(\d+)$")
_SECTION_ORDER = {
    "try": 0,
    "catch": 1,
    "finally": 2,
    "body": 0,
    "retry": 0,
    "pass": 0,
    "fail": 1,
}
_NAMED_SECTIONS = frozenset(_SECTION_ORDER)

_Chain = list[tuple[str, list["_Chain"]]]


def _is_section_handle(handle: str) -> bool:
    return handle in _NAMED_SECTIONS or _INDEXED_HANDLE.match(handle) is not None


def _section_sort_key(handle: str) -> int:
    match = _INDEXED_HANDLE.match(handle)
    if match:
        return int(match.group(1))
    return _SECTION_ORDER[handle]


def _num(value: float) -> float:
    return int(value) if float(value).is_integer() else float(value)


def ingress_counts(edges: list[dict[str, Any]]) -> dict[str, int]:
    """Incoming edge count per target node id, the canvas's ingress handle count."""
    counts: dict[str, int] = defaultdict(int)
    for edge in edges:
        counts[str(edge["target"])] += 1
    return dict(counts)


class _Layouter:
    def __init__(self, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
        self.by_id = {str(node["id"]): node for node in nodes}
        self.outgoing: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.ingress = ingress_counts(edges)
        for edge in edges:
            self.outgoing[str(edge["source"])].append(edge)
        self.rejoins = {
            str(edge["target"])
            for edge in edges
            if str(edge.get("targetHandle") or "").startswith("ingress_")
        }
        self.visited: set[str] = set()
        self.positions: dict[str, dict[str, float]] = {}

    def _width(self, node_id: str) -> int:
        width, _height = estimate_node_size(self.by_id[node_id], self.ingress.get(node_id, 0))
        return width

    def _classify_outgoing(
        self, node_id: str
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None, dict[str, Any] | None]:
        outs = self.outgoing.get(node_id, [])
        section_edges = sorted(
            (e for e in outs if _is_section_handle(str(e.get("sourceHandle") or ""))),
            key=lambda e: _section_sort_key(str(e["sourceHandle"])),
        )
        then_edge = next((e for e in outs if e.get("sourceHandle") == "then"), None)
        plain_edge = next((e for e in outs if not e.get("sourceHandle")), None)
        return section_edges, then_edge, plain_edge

    def _build_children(
        self, section_edges: list[dict[str, Any]]
    ) -> tuple[list[_Chain], list[str]]:
        child_chains: list[_Chain] = []
        child_exits: list[str] = []
        for edge in section_edges:
            target = str(edge["target"])
            if target in self.rejoins:
                child_exits.append(target)
                continue
            sub_chain, sub_exit = self.build_chain(target)
            if sub_chain:
                child_chains.append(sub_chain)
            if sub_exit is not None:
                child_exits.append(sub_exit)
        return child_chains, child_exits

    def _advance(
        self,
        section_edges: list[dict[str, Any]],
        then_edge: dict[str, Any] | None,
        plain_edge: dict[str, Any] | None,
        child_exits: list[str],
    ) -> tuple[str | None, str | None]:
        """Next node to walk and the rejoin exit this flow feeds, if any."""
        if then_edge is not None:
            return str(then_edge["target"]), None
        if section_edges:
            return (child_exits[0] if child_exits else None), None
        if plain_edge is not None:
            target = str(plain_edge["target"])
            if target in self.rejoins:
                return None, target
            return target, None
        return None, None

    def build_chain(self, start_id: str) -> tuple[_Chain, str | None]:
        """Walk one flow; returns its chain and the rejoin node it feeds, if any."""
        chain: _Chain = []
        exit_target: str | None = None
        current: str | None = start_id
        while current is not None and current in self.by_id and current not in self.visited:
            self.visited.add(current)
            section_edges, then_edge, plain_edge = self._classify_outgoing(current)
            child_chains, child_exits = self._build_children(section_edges)
            if then_edge is not None and child_chains:
                # Sentinel: sections pack left of the continuation lane (the spine).
                child_chains.append([])
            chain.append((current, child_chains))
            current, exit_target = self._advance(section_edges, then_edge, plain_edge, child_exits)
        return chain, exit_target

    @staticmethod
    def _sections(child_chains: list[_Chain]) -> tuple[list[_Chain], bool]:
        """Split off the continuation-lane sentinel appended by build_chain."""
        if child_chains and child_chains[-1] == []:
            return child_chains[:-1], True
        return child_chains, False

    def chain_width(self, chain: _Chain) -> float:
        width: float = MIN_COLUMN_WIDTH
        for node_id, child_chains in chain:
            row_width: float = self._width(node_id)
            if child_chains:
                sections, anchored = self._sections(child_chains)
                widths = [self.chain_width(sub) for sub in sections]
                span = sum(widths) + (len(widths) - 1) * GUTTER_X
                # Anchored rows extend left of the spine; reserve symmetric room.
                row_width = max(row_width, 2 * span + GUTTER_X if anchored else span)
            width = max(width, row_width)
        return width

    def place_chain(self, chain: _Chain, centerline: float, y: float) -> float:
        """Place every row of a chain; returns the first free y below it."""
        for node_id, child_chains in chain:
            width = self._width(node_id)
            self.positions[node_id] = {"x": _num(centerline - width / 2), "y": _num(y)}
            if child_chains:
                child_y = y + RHYTHM_Y
                sections, anchored = self._sections(child_chains)
                widths = [self.chain_width(sub) for sub in sections]
                span = sum(widths) + (len(widths) - 1) * GUTTER_X
                left = centerline - GUTTER_X / 2 - span if anchored else centerline - span / 2
                next_y = child_y
                for sub_chain, sub_width in zip(sections, widths, strict=True):
                    end_y = self.place_chain(sub_chain, left + sub_width / 2, child_y)
                    next_y = max(next_y, end_y)
                    left += sub_width + GUTTER_X
                y = next_y
            else:
                y += RHYTHM_Y
        return y

    def place_starts(self, starts: list[str], y: float) -> float:
        for start in starts:
            if start not in self.by_id or start in self.visited:
                continue
            chain, _exit = self.build_chain(start)
            y = self.place_chain(chain, 0, y)
        return y

    def place_orphans(self, nodes: list[dict[str, Any]], y: float) -> float:
        for node in nodes:
            node_id = str(node["id"])
            if node_id in self.positions:
                continue
            chain, _exit = self.build_chain(node_id)
            if chain:
                y = self.place_chain(chain, 0, y)
        return y


def layout_workflow(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    pinned: dict[str, dict[str, float]] | None = None,
) -> dict[str, dict[str, float]]:
    """node_id -> {x, y} placement; pinned entries are returned verbatim."""
    if not nodes:
        return {}
    layouter = _Layouter(nodes, edges)
    starts = [str(e["target"]) for e in edges if str(e["source"]) == START_NODE_ID]
    y = layouter.place_starts(starts, float(RHYTHM_Y))
    layouter.place_orphans(nodes, y)
    for node_id, position in (pinned or {}).items():
        if node_id in layouter.positions:
            layouter.positions[node_id] = dict(position)
    return layouter.positions
