"""Deterministic recursive column layout for compiled workflows.

Pure function of the flow's structure: the same nodes and edges always
produce identical positions. Child flows occupy centered columns beneath
their construct; continuation resumes on the parent centerline below the
deepest child row. A pinned node keeps its place unless a placed or grown
node needs the room, and then it only moves down.
"""

import math
import re
from collections import defaultdict
from collections.abc import Collection, Mapping
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

_Chain = list[tuple[str, list["_Chain"]]]
FlowTree = list[tuple[str, dict[str, "FlowTree"]]]
_Positions = Mapping[str, Mapping[str, float]]
_Box = tuple[float, float, int, float]


def _is_section_handle(handle: str) -> bool:
    return handle in _NAMED_SECTIONS or _INDEXED_HANDLE.match(handle) is not None


def _section_sort_key(handle: str) -> int:
    match = _INDEXED_HANDLE.match(handle)
    if match:
        return int(match.group(1))
    return _SECTION_ORDER[handle]


def _num(value: float) -> float:
    return int(value) if float(value).is_integer() else float(value)


def _gap(start_a: float, size_a: float, start_b: float, size_b: float) -> float:
    return max(start_b - (start_a + size_a), start_a - (start_b + size_b))


def _crowds(first: _Box, second: _Box) -> bool:
    first_x, first_y, first_width, first_height = first
    second_x, second_y, second_width, second_height = second
    return (
        _gap(first_x, first_width, second_x, second_width) < ROOM_CLEARANCE_X
        and _gap(first_y, first_height, second_y, second_height) < ROOM_CLEARANCE_Y
    )


def _row_step(height: float) -> int:
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
        # node id -> the nodes the flow puts above it (its construct, or the row before it).
        self.follows: dict[str, set[str]] = {}
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
    ) -> tuple[list[_Chain], list[str]]:
        child_chains: list[_Chain] = []
        child_exits: list[str] = []
        sections = self.sections.setdefault(node_id, [])
        for edge in section_edges:
            target = str(edge["target"])
            if target in self.rejoins:
                child_exits.append(target)
                continue
            sub_chain, sub_exit = self.build_chain(target)
            sections.append((str(edge["sourceHandle"]), sub_chain))
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

    def record_follows(self, chain: _Chain, above: set[str]) -> set[str]:
        """Note what each row of the chain sits below; returns every node of the chain."""
        everything: set[str] = set()
        for node_id, _children in chain:
            self.follows[node_id] = above
            row = {node_id}
            for _handle, sub_chain in self.sections.get(node_id, []):
                row |= self.record_follows(sub_chain, {node_id})
            everything |= row
            above = row
        return everything

    def _box(self, node_id: str, positions: _Positions, top: float) -> _Box:
        width, height = self._size(node_id)
        return (positions[node_id]["x"], top, width, height)

    def _blocks(self, other: str, node_id: str, top: float, positions: _Positions) -> bool:
        other_box = self._box(other, positions, positions[other]["y"])
        box = self._box(node_id, positions, top)
        if _crowds(other_box, box):
            return True
        other_x, other_y, other_width, other_height = other_box
        # In one column, a node the flow puts above this one stays a row above it.
        return (
            other in self.follows.get(node_id, ())
            and _gap(other_x, other_width, box[0], box[2]) < GUTTER_X
            and top < other_y + _row_step(other_height)
        )

    def _free_top(
        self, node_id: str, top: float, others: list[str], positions: _Positions
    ) -> float:
        """The first top at or below `top` where none of `others` is in the node's way."""
        while True:
            blockers = [other for other in others if self._blocks(other, node_id, top, positions)]
            if not blockers:
                return top
            top = max(positions[other]["y"] + _row_step(self._size(other)[1]) for other in blockers)

    def make_room(
        self, order: list[str], positions: dict[str, dict[str, float]], moved: set[str]
    ) -> None:
        """In flow order, move each node down just enough to clear the moved nodes before it."""
        settled: list[str] = []
        for node_id in order:
            top = positions[node_id]["y"]
            if node_id not in moved:
                cleared = self._free_top(
                    node_id, top, [other for other in settled if other in moved], positions
                )
                if cleared != top:
                    moved.add(node_id)
                top = cleared
            if node_id in moved:
                top = self._free_top(node_id, top, settled, positions)
            positions[node_id] = {"x": positions[node_id]["x"], "y": _num(top)}
            settled.append(node_id)


def flow_tree(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> FlowTree:
    """Every node in flow order, each row holding its sections' flows by handle."""
    layouter = _Layouter(nodes, edges)
    return [row for chain in layouter.top_chains(nodes) for row in layouter.tree(chain)]


def layout_workflow(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    pinned: _Positions | None = None,
    grown: Collection[str] = (),
) -> dict[str, dict[str, float]]:
    """node_id -> {x, y}: a pinned node keeps its place unless a placed or grown one needs it."""
    if not nodes:
        return {}
    layouter = _Layouter(nodes, edges)
    y = float(RHYTHM_Y)
    for chain in layouter.top_chains(nodes):
        y = layouter.place_chain(chain, 0, y)
        layouter.record_follows(chain, set())
    fresh = layouter.positions
    kept = pinned or {}
    positions = {
        node_id: dict(kept[node_id]) if node_id in kept else dict(position)
        for node_id, position in fresh.items()
    }
    order = sorted(fresh, key=lambda node_id: (fresh[node_id]["y"], fresh[node_id]["x"]))
    moved = {node_id for node_id in fresh if node_id not in kept or node_id in grown}
    layouter.make_room(order, positions, moved)
    return positions
