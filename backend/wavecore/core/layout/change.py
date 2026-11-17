"""The layout of a changed workflow: the flow order of a fresh build, made from the stored layout.

Rows go top down in flow order by the fresh build's rules. A Block the change keeps in its lane
keeps its column, and its distance from what is above it unless WAVE laid it one row step below;
every other Block goes under the Block before it, and a new lane where a fresh build puts it
beside its construct. Then lanes move apart, whole lanes at a time and only as far as needed,
deepest construct first; the main line never moves sideways. A Block that still crowds one
before it moves down a row step below it, and the layout is worked out again.
"""

from collections.abc import Iterable, Mapping
from typing import Any

from wavecore.core.layout.dimensions import estimate_node_size
from wavecore.core.layout.engine import (
    GUTTER_X,
    MIN_COLUMN_WIDTH,
    RHYTHM_Y,
    Row,
    _num,
    crowds,
    flow_rows,
    ingress_counts,
    layout_workflow,
    row_step,
)

# (revised construct id, revised lane handle) -> the stored lane handle it is.
LanePairs = Mapping[tuple[str, str], str]


class _Shape:
    """A workflow's rows by node id: its construct, its lane, its place in its flow, its size."""

    def __init__(self, workflow: Mapping[str, Any]) -> None:
        nodes = list(workflow.get("nodes") or [])
        edges = list(workflow.get("edges") or [])
        ingress = ingress_counts(edges)
        self.size = {
            str(node["id"]): estimate_node_size(node, ingress.get(str(node["id"]), 0))
            for node in nodes
        }
        self.chains = flow_rows(nodes, edges)
        self.row: dict[str, Row] = {}
        self.parent: dict[str, str | None] = {}
        self.handle: dict[str, str] = {}
        self.chain: dict[str, tuple[Row, ...]] = {}
        self.index: dict[str, int] = {}
        # Which flow a node is in: its construct and lane, or the number of a top flow.
        self.flow: dict[str, tuple[str, str]] = {}
        for number, chain in enumerate(self.chains):
            self._index(chain, None, str(number))

    def _index(self, rows: tuple[Row, ...], parent: str | None, handle: str) -> None:
        for index, row in enumerate(rows):
            self.row[row.node_id] = row
            self.parent[row.node_id] = parent
            self.handle[row.node_id] = handle
            self.chain[row.node_id] = rows
            self.index[row.node_id] = index
            self.flow[row.node_id] = (parent or "", handle)
            for lane in row.lanes:
                self._index(lane.rows, row.node_id, lane.handle)

    def ids(self, rows: Iterable[Row]) -> list[str]:
        """Every node of the rows in flow order: each construct, then its lanes."""
        out: list[str] = []
        for row in rows:
            out.append(row.node_id)
            for lane in row.lanes:
                out += self.ids(lane.rows)
        return out

    def everything(self) -> list[str]:
        return self.ids(row for chain in self.chains for row in chain)

    def lane(self, node_id: str, handle: str) -> list[str]:
        rows = next((lane.rows for lane in self.row[node_id].lanes if lane.handle == handle), ())
        return self.ids(rows)

    def flow_top(self, node_id: str, top: Mapping[str, float]) -> float:
        """The top the fresh build's rules give a node, from the tops of what is above it."""
        index = self.index[node_id]
        if index:
            before = self.chain[node_id][index - 1]
            above = [before.node_id] if before.beside else self.ids([before])
            return max(top[other] + row_step(self.size[other][1]) for other in above)
        parent = self.parent[node_id]
        if parent is not None:
            return top[parent] + row_step(self.size[parent][1])
        earlier = self.ids(
            row for chain in self.chains[: int(self.handle[node_id])] for row in chain
        )
        return max(
            (top[other] + row_step(self.size[other][1]) for other in earlier), default=RHYTHM_Y
        )


class _ChangeLayout:
    def __init__(
        self,
        stored: Mapping[str, Any],
        revised: Mapping[str, Any],
        matches: Mapping[str, str],
        lanes: LanePairs,
    ) -> None:
        self.old = _Shape(stored)
        self.new = _Shape(revised)
        self.lanes = lanes
        self.matches = {
            new_id: old_id
            for new_id, old_id in matches.items()
            if new_id in self.new.size and old_id in self.old.size
        }
        self.old_x, self.old_top, placed = self._stored_places(stored)
        self.fresh = layout_workflow(list(revised["nodes"]), list(revised["edges"]))
        self.kept = {
            node_id
            for node_id in self.new.size
            if self.matches.get(node_id) in placed and self._in_its_lane(node_id)
        }
        self.slack = {
            old_id: self.old_top[old_id] - self.old.flow_top(old_id, self.old_top)
            for old_id in self.old.size
        }
        self.floor: dict[str, float] = {}
        self.top: dict[str, float] = {}
        self.center: dict[str, float] = {}
        self.side: dict[str, float] = {}

    def _stored_places(
        self, stored: Mapping[str, Any]
    ) -> tuple[dict[str, float], dict[str, float], set[str]]:
        """Each stored node's left and top; a node with no place takes a fresh build's."""
        nodes = list(stored.get("nodes") or [])
        fresh = layout_workflow(nodes, list(stored.get("edges") or []))
        left: dict[str, float] = {}
        top: dict[str, float] = {}
        placed: set[str] = set()
        for node in nodes:
            node_id = str(node["id"])
            position = node.get("position")
            if isinstance(position, dict):
                placed.add(node_id)
            else:
                position = fresh[node_id]
            left[node_id], top[node_id] = float(position["x"]), float(position["y"])
        return left, top, placed

    def _in_its_lane(self, node_id: str) -> bool:
        """Whether a recognized node is still in its lane, behind the ones it was behind."""
        old_id = self.matches[node_id]
        parent, old_parent = self.new.parent[node_id], self.old.parent[old_id]
        if (parent is None) != (old_parent is None):
            return False
        if parent is not None and (
            self.matches.get(parent) != old_parent
            or self.lanes.get((parent, self.new.handle[node_id])) != self.old.handle[old_id]
        ):
            return False
        before = self.new.chain[node_id][: self.new.index[node_id]]
        passed = (self.matches.get(row.node_id) for row in before)
        return not any(
            other is not None
            and self.old.flow[other] == self.old.flow[old_id]
            and self.old.index[other] > self.old.index[old_id]
            for other in passed
        )

    def _old_center(self, old_id: str) -> float:
        return self.old_x[old_id] + self.old.size[old_id][0] / 2

    def _fresh_center(self, node_id: str) -> float:
        return self.fresh[node_id]["x"] + self.new.size[node_id][0] / 2

    # Rows, top down in flow order.

    def _place(self) -> None:
        self.top, self.center, self.side = {}, {}, {}
        for chain in self.new.chains:
            self._place_rows(chain, None)

    def _place_rows(self, rows: tuple[Row, ...], construct: str | None) -> None:
        before: str | None = None
        for row in rows:
            node_id = row.node_id
            if node_id in self.kept:
                old_id = self.matches[node_id]
                top = self._kept_top(node_id, old_id)
                shift = self.side[construct] if construct is not None else 0.0
                center = self._old_center(old_id) + shift
            else:
                top = self.new.flow_top(node_id, self.top)
                center = (
                    self.center[before]
                    if before is not None
                    else self._first_column(rows, construct)
                )
            self.top[node_id] = max(top, self.floor.get(node_id, top))
            self.center[node_id] = center
            old_id_or_none = self.matches.get(node_id)
            self.side[node_id] = (
                center - self._old_center(old_id_or_none) if old_id_or_none is not None else 0.0
            )
            for lane in row.lanes:
                self._place_rows(lane.rows, node_id)
            before = node_id

    def _kept_top(self, node_id: str, old_id: str) -> float:
        if self.new.parent[node_id] is None and self.new.index[node_id] == 0:
            if self.new.handle[node_id] != "0":
                # A flow nothing reaches, such as a Note beside the flow, stays where it is.
                return self.old_top[old_id]
        need = self.new.flow_top(node_id, self.top)
        slack = self.slack[old_id]
        if not slack:
            # WAVE laid it one row step below what is above it, so it follows the flow both ways.
            return need
        # Room a person left above stays; a person's own offset is kept as far as it can be.
        return max(self.old_top[old_id], need + min(slack, 0.0))

    def _first_column(self, rows: tuple[Row, ...], construct: str | None) -> float:
        """The column of a lane's first Block: the lane's own, or a fresh build's beside its
        construct for a new lane."""
        for row in rows:
            if row.node_id in self.kept:
                shift = self.side[construct] if construct is not None else 0.0
                return self._old_center(self.matches[row.node_id]) + shift
        if construct is not None:
            first = rows[0].node_id
            return (
                self.center[construct] + self._fresh_center(first) - self._fresh_center(construct)
            )
        start = self.new.chains[0][0].node_id
        return self.center[start] if start in self.center else 0.0

    # Columns, deepest construct first.

    def _settle(self, rows: tuple[Row, ...]) -> None:
        for row in rows:
            for lane in row.lanes:
                self._settle(lane.rows)
            if row.lanes and not row.beside:
                self._spread(row)
        for index in range(len(rows) - 1, -1, -1):
            row = rows[index]
            if row.beside:
                lane_ids = self.new.ids(row.lanes[0].rows)
                rest = self.new.ids(rows[index + 1 :])
                short = self._span(lane_ids)[1] + self._gutter_beside(row) - self._span(rest)[0]
                if short > 0:
                    self._shift(lane_ids, -short)

    def _spread(self, row: Row) -> None:
        """Move the lanes of a construct apart, as whole lanes, to one gutter between them."""
        construct = row.node_id
        groups = [self.new.ids(lane.rows) for lane in row.lanes]
        old_groups = [self._old_lane(construct, lane.handle) for lane in row.lanes]
        gutters = [self._gutter(old_groups[i], old_groups[i + 1]) for i in range(len(groups) - 1)]
        center = self.center[construct]
        if row.anchored:
            # The lanes stay left of the continuation exit, so they only move left.
            over = self._span(groups[-1])[1] - (center - GUTTER_X / 2)
            if over > 0:
                self._shift([q for group in groups for q in group], -over)
            pivot = len(groups) - 1
        else:
            changed = [
                index
                for index, group in enumerate(groups)
                if self._changed(group, old_groups[index])
            ]
            pivot = min(
                changed or range(len(groups)),
                key=lambda index: abs(sum(self._span(groups[index])) / 2 - center),
            )
            for index in range(pivot, len(groups) - 1):
                short = (
                    self._span(groups[index])[1] + gutters[index] - self._span(groups[index + 1])[0]
                )
                if short > 0:
                    self._shift([q for group in groups[index + 1 :] for q in group], short)
        for index in range(pivot, 0, -1):
            short = (
                self._span(groups[index - 1])[1] + gutters[index - 1] - self._span(groups[index])[0]
            )
            if short > 0:
                self._shift([q for group in groups[:index] for q in group], -short)

    def _changed(self, group: list[str], old_group: list[str]) -> bool:
        if not old_group:
            return True
        for node_id in group:
            if node_id not in self.kept:
                return True
            if self.new.size[node_id] != self.old.size[self.matches[node_id]]:
                return True
        return {self.matches[node_id] for node_id in group} != set(old_group)

    def _old_lane(self, construct: str, handle: str) -> list[str]:
        old_construct = self.matches.get(construct)
        old_handle = self.lanes.get((construct, handle))
        if old_construct is None or old_handle is None:
            return []
        return self.old.lane(old_construct, old_handle)

    def _gutter(self, old_left: list[str], old_right: list[str]) -> float:
        """The gutter two lanes keep: a fresh build's, or the smaller one a person gave them."""
        if not old_left or not old_right:
            return GUTTER_X
        return min(GUTTER_X, self._old_span(old_right)[0] - self._old_span(old_left)[1])

    def _gutter_beside(self, row: Row) -> float:
        old_id = self.matches.get(row.node_id)
        if old_id is None or not self.old.row[old_id].beside:
            return GUTTER_X
        old_rows = self.old.chain[old_id]
        old_rest = self.old.ids(old_rows[self.old.index[old_id] + 1 :])
        return self._gutter(self._old_lane(row.node_id, row.lanes[0].handle), old_rest)

    def _span(self, ids: list[str]) -> tuple[float, float]:
        """The left and right edge of the column boxes of the nodes."""
        halves = [(q, max(self.new.size[q][0], MIN_COLUMN_WIDTH) / 2) for q in ids]
        return (
            min(self.center[q] - half for q, half in halves),
            max(self.center[q] + half for q, half in halves),
        )

    def _old_span(self, ids: list[str]) -> tuple[float, float]:
        halves = [(q, max(self.old.size[q][0], MIN_COLUMN_WIDTH) / 2) for q in ids]
        return (
            min(self._old_center(q) - half for q, half in halves),
            max(self._old_center(q) + half for q, half in halves),
        )

    def _shift(self, ids: list[str], amount: float) -> None:
        for node_id in ids:
            self.center[node_id] += amount

    # Blocks that still crowd.

    def _box(self, node_id: str) -> tuple[float, float, float, float]:
        width, height = self.new.size[node_id]
        return (self.center[node_id] - width / 2, self.top[node_id], width, height)

    def _crowded_before(self, first: str, second: str) -> bool:
        """Whether two kept Blocks crowded each other already, as a person arranged them."""
        if first not in self.kept or second not in self.kept:
            return False
        boxes = []
        for node_id in (self.matches[first], self.matches[second]):
            width, height = self.old.size[node_id]
            boxes.append((self.old_x[node_id], self.old_top[node_id], width, height))
        return crowds(boxes[0], boxes[1])

    def _lower_the_crowded(self, order: list[str]) -> bool:
        """Give each Block a crowding one before it in flow order a floor a row step below it."""
        lowered = False
        for index, first in enumerate(order):
            for second in order[index + 1 :]:
                if crowds(self._box(first), self._box(second)) and not self._crowded_before(
                    first, second
                ):
                    floor = self.top[first] + row_step(self.new.size[first][1])
                    self.floor[second] = max(self.floor.get(second, floor), floor)
                    lowered = True
        return lowered

    def positions(self) -> dict[str, dict[str, float]]:
        order = self.new.everything()
        while True:
            self._place()
            for chain in self.new.chains:
                self._settle(chain)
            if not self._lower_the_crowded(order):
                break
        return {
            node_id: {
                "x": _num(self.center[node_id] - self.new.size[node_id][0] / 2),
                "y": _num(self.top[node_id]),
            }
            for node_id in order
        }


def layout_change(
    stored: Mapping[str, Any],
    revised: Mapping[str, Any],
    matches: Mapping[str, str],
    lanes: LanePairs,
) -> dict[str, dict[str, float]]:
    """node_id -> {x, y} of each revised node, laid out as a change of the stored workflow.

    ``matches`` pairs each recognized revised node with its stored node, and ``lanes`` each
    lane of a recognized construct with its stored lane.
    """
    return _ChangeLayout(stored, revised, matches, lanes).positions()
