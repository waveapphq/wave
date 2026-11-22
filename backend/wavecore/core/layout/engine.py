"""Deterministic recursive column layout for compiled workflows."""

import math
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from wavecore.core.layout.dimensions import TALLEST_COLLAPSED_HEIGHT, estimate_node_size

RHYTHM_Y = 140
GUTTER_X = 80
MIN_COLUMN_WIDTH = 240
# Two blocks closer than these on both axes crowd each other.
ROOM_CLEARANCE_X = GUTTER_X // 2
# The space a row leaves under the tallest collapsed card, so fresh rows never crowd.
ROOM_CLEARANCE_Y = RHYTHM_Y - TALLEST_COLLAPSED_HEIGHT

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
# A construct whose one lane has these handles puts its continuation beside the lane.
_LANE_HANDLES = frozenset({"body", "retry"})

_Chain = list[tuple[str, list["_Chain"]]]
FlowTree = list[tuple[str, dict[str, "FlowTree"]]]
# A flow's exit: the rejoin it feeds, and how many of the rejoin's wires come from it.
_Exit = tuple[str, int] | None
Box = tuple[float, float, float, float]


@dataclass(frozen=True)
class Lane:
    """A section of a construct and the rows of its flow."""

    handle: str
    rows: tuple["Row", ...]


@dataclass(frozen=True)
class Row:
    """One node of a flow as the layout reads it, its non-empty lanes in handle order."""

    node_id: str
    lanes: tuple[Lane, ...]
    anchored: bool
    beside: bool


def is_numbered_section(handle: str) -> bool:
    """Whether a section's handle names it by a number, as a branch or a case does."""
    return _INDEXED_HANDLE.match(handle) is not None


def _is_section_handle(handle: str) -> bool:
    return handle in _NAMED_SECTIONS or is_numbered_section(handle)


def _section_sort_key(handle: str) -> int:
    match = _INDEXED_HANDLE.match(handle)
    if match:
        return int(match.group(1))
    return _SECTION_ORDER[handle]


def _num(value: float) -> float:
    return int(value) if float(value).is_integer() else float(value)


def _gap(start_a: float, size_a: float, start_b: float, size_b: float) -> float:
    return max(start_b - (start_a + size_a), start_a - (start_b + size_b))


def crowds(first: Box, second: Box) -> bool:
    """Whether two ``(x, y, width, height)`` boxes come closer than the clearance on both axes."""
    first_x, first_y, first_width, first_height = first
    second_x, second_y, second_width, second_height = second
    return (
        _gap(first_x, first_width, second_x, second_width) < ROOM_CLEARANCE_X
        and _gap(first_y, first_height, second_y, second_height) < ROOM_CLEARANCE_Y
    )


def row_step(height: float) -> int:
    """Top-to-top distance below a block of this height, in whole rhythm rows."""
    return math.ceil((height + ROOM_CLEARANCE_Y) / RHYTHM_Y) * RHYTHM_Y


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
        self.starts = [str(e["target"]) for e in edges if str(e["source"]) == START_NODE_ID]
        self.visited: set[str] = set()
        self.positions: dict[str, dict[str, float]] = {}
        self.sections: dict[str, list[tuple[str, _Chain]]] = {}
        self.sizes: dict[str, tuple[int, float]] = {}

    def _size(self, node_id: str) -> tuple[int, float]:
        if node_id not in self.sizes:
            self.sizes[node_id] = estimate_node_size(
                self.by_id[node_id], self.ingress.get(node_id, 0)
            )
        return self.sizes[node_id]

    def _width(self, node_id: str) -> int:
        return self._size(node_id)[0]

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
        self, node_id: str, section_edges: list[dict[str, Any]]
    ) -> tuple[list[_Chain], list[tuple[str, int]]]:
        child_chains: list[_Chain] = []
        child_exits: list[tuple[str, int]] = []
        sections = self.sections.setdefault(node_id, [])
        for edge in section_edges:
            target = str(edge["target"])
            if target in self.rejoins:
                child_exits.append((target, 1))
                continue
            sub_chain, sub_exit = self.build_chain(target)
            sections.append((str(edge["sourceHandle"]), sub_chain))
            if sub_chain:
                child_chains.append(sub_chain)
            if sub_exit is not None:
                child_exits.append(sub_exit)
        return child_chains, child_exits

    def _onward(self, target: str) -> tuple[str | None, _Exit]:
        if target in self.rejoins:
            return None, (target, 1)
        return target, None

    def _advance(
        self,
        section_edges: list[dict[str, Any]],
        then_edge: dict[str, Any] | None,
        plain_edge: dict[str, Any] | None,
        child_exits: list[tuple[str, int]],
    ) -> tuple[str | None, _Exit]:
        """Next node to walk and the rejoin exit this flow feeds, if any."""
        if then_edge is not None:
            return self._onward(str(then_edge["target"]))
        if section_edges:
            if not child_exits:
                return None, None
            target = child_exits[0][0]
            wires = sum(count for exit_id, count in child_exits if exit_id == target)
            # A rejoin that also takes a wire from outside this construct is an enclosing one's.
            if wires < self.ingress[target]:
                return None, (target, wires)
            return target, None
        if plain_edge is not None:
            return self._onward(str(plain_edge["target"]))
        return None, None

    def build_chain(self, start_id: str) -> tuple[_Chain, _Exit]:
        """Walk one flow; returns its chain and the rejoin node it feeds, if any."""
        chain: _Chain = []
        exit_target: _Exit = None
        current: str | None = start_id
        while current is not None and current in self.by_id and current not in self.visited:
            self.visited.add(current)
            section_edges, then_edge, plain_edge = self._classify_outgoing(current)
            child_chains, child_exits = self._build_children(current, section_edges)
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

    def _beside(self, node_id: str, child_chains: list[_Chain]) -> bool:
        """A single-lane construct with a continuation, which runs beside its lane."""
        anchored = self._sections(child_chains)[1]
        handles = [handle for handle, sub in self.sections.get(node_id, []) if sub]
        return anchored and len(handles) == 1 and handles[0] in _LANE_HANDLES

    def chain_width(self, chain: _Chain) -> float:
        width: float = MIN_COLUMN_WIDTH
        for index, (node_id, child_chains) in enumerate(chain):
            row_width: float = self._width(node_id)
            if child_chains:
                sections, anchored = self._sections(child_chains)
                widths = [self.chain_width(sub) for sub in sections]
                span = sum(widths) + (len(widths) - 1) * GUTTER_X
                rest = chain[index + 1 :]
                if rest and self._beside(node_id, child_chains):
                    # The lane hangs left of the continuation column; reserve symmetric room.
                    return max(width, row_width, self.chain_width(rest) + 2 * (GUTTER_X + span))
                # Anchored rows extend left of the spine; reserve symmetric room.
                row_width = max(row_width, 2 * span + GUTTER_X if anchored else span)
            width = max(width, row_width)
        return width

    def _place_beside(self, lane: _Chain, rest: _Chain, centerline: float, y: float) -> float:
        rest_width = self.chain_width(rest)
        lane_center = centerline - rest_width / 2 - GUTTER_X - self.chain_width(lane) / 2
        lane_end = self.place_chain(lane, lane_center, y)
        return max(lane_end, self.place_chain(rest, centerline, y))

    def place_chain(self, chain: _Chain, centerline: float, y: float) -> float:
        """Place every row of a chain; returns the first free y below it."""
        for index, (node_id, child_chains) in enumerate(chain):
            width = self._width(node_id)
            self.positions[node_id] = {"x": _num(centerline - width / 2), "y": _num(y)}
            if child_chains:
                child_y = y + row_step(self._size(node_id)[1])
                sections, anchored = self._sections(child_chains)
                rest = chain[index + 1 :]
                if rest and self._beside(node_id, child_chains):
                    return self._place_beside(sections[0], rest, centerline, child_y)
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
                y += row_step(self._size(node_id)[1])
        return y

    def top_chains(self, nodes: list[dict[str, Any]]) -> list[_Chain]:
        """The flows from the start first, then each flow nothing reaches."""
        chains: list[_Chain] = []
        for node_id in [*self.starts, *(str(node["id"]) for node in nodes)]:
            if node_id in self.by_id and node_id not in self.visited:
                chains.append(self.build_chain(node_id)[0])
        return chains

    def tree(self, chain: _Chain) -> FlowTree:
        return [
            (node_id, {handle: self.tree(sub) for handle, sub in self.sections.get(node_id, [])})
            for node_id, _children in chain
        ]

    def rows(self, chain: _Chain) -> tuple[Row, ...]:
        return tuple(
            Row(
                node_id,
                tuple(
                    Lane(handle, self.rows(sub))
                    for handle, sub in self.sections.get(node_id, [])
                    if sub
                ),
                self._sections(child_chains)[1],
                index < len(chain) - 1 and self._beside(node_id, child_chains),
            )
            for index, (node_id, child_chains) in enumerate(chain)
        )


def flow_tree(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> FlowTree:
    """Every node in flow order, each row holding its sections' flows by handle."""
    layouter = _Layouter(nodes, edges)
    return [row for chain in layouter.top_chains(nodes) for row in layouter.tree(chain)]


def flow_rows(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[tuple[Row, ...]]:
    """Each flow's rows, the start's flow first and then each flow nothing reaches."""
    layouter = _Layouter(nodes, edges)
    return [layouter.rows(chain) for chain in layouter.top_chains(nodes)]


def layout_workflow(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> dict[str, dict[str, float]]:
    """node_id -> {x, y}, as a fresh build places it."""
    layouter = _Layouter(nodes, edges)
    y = float(RHYTHM_Y)
    for chain in layouter.top_chains(nodes):
        y = layouter.place_chain(chain, 0, y)
    return layouter.positions
