"""The order check: where a workflow's layout does not read in flow order as a fresh build does.

It reads the flow's structure from the layout engine's walker and checks the positions against
the layout rules on its own: each Block one row step below the Block before it and in its
column, nothing between them, the lanes of a construct in columns of their own, a single lane
one gutter left of the Blocks after its construct, and no two boxes overlapping. Flows nothing
reaches go on after the start flow, as a fresh build draws them.
"""

import math
from typing import Any, NamedTuple

GUTTER = 80
MIN_COLUMN = 240
ROW = 140
CLEAR_Y = 32
LANE_HANDLES = frozenset({"body", "retry"})


class Finding(NamedTuple):
    kind: str
    blocks: tuple[str, ...]
    detail: str


def row_step(height: float) -> int:
    return math.ceil((height + CLEAR_Y) / ROW) * ROW


class _Flow:
    def __init__(self, workflow: dict[str, Any]) -> None:
        from wavecore.core.layout.dimensions import estimate_node_size
        from wavecore.core.layout.engine import flow_tree, ingress_counts

        nodes = list(workflow["nodes"])
        edges = list(workflow["edges"])
        ingress = ingress_counts(edges)
        self.nodes = {str(node["id"]): node for node in nodes}
        self.size = {
            node_id: estimate_node_size(node, ingress.get(node_id, 0))
            for node_id, node in self.nodes.items()
        }
        self.x = {node_id: float(node["position"]["x"]) for node_id, node in self.nodes.items()}
        self.y = {node_id: float(node["position"]["y"]) for node_id, node in self.nodes.items()}
        self.then = {str(edge["source"]) for edge in edges if edge.get("sourceHandle") == "then"}
        self.parent: dict[str, str | None] = {}
        self.chain_of: dict[str, list[str]] = {}
        self.index: dict[str, int] = {}
        self.sections: dict[str, dict[str, list[str]]] = {}
        self.root = self._walk(flow_tree(nodes, edges), None)

    def _walk(self, flow: Any, parent: str | None) -> list[str]:
        chain = [node_id for node_id, _sections in flow]
        for index, (node_id, sections) in enumerate(flow):
            self.parent[node_id] = parent
            self.chain_of[node_id] = chain
            self.index[node_id] = index
            self.sections[node_id] = {
                handle: self._walk(sub, node_id) for handle, sub in sections.items() if sub
            }
        return chain

    def label(self, node_id: str) -> str:
        return str(self.nodes[node_id]["data"].get("label"))

    def previous(self, node_id: str) -> str | None:
        index = self.index[node_id]
        return self.chain_of[node_id][index - 1] if index else None

    def beside(self, node_id: str) -> bool:
        lanes = list(self.sections[node_id])
        has_next = self.index[node_id] < len(self.chain_of[node_id]) - 1
        return node_id in self.then and len(lanes) == 1 and lanes[0] in LANE_HANDLES and has_next

    def below_lanes(self, node_id: str) -> bool:
        return bool(self.sections[node_id]) and not self.beside(node_id)

    def subtree(self, node_id: str) -> list[str]:
        return [q for lane in self.sections[node_id].values() for q in self.ids(lane)]

    def ids(self, chain: list[str]) -> list[str]:
        return [q for node_id in chain for q in (node_id, *self.subtree(node_id))]

    def center(self, node_id: str) -> float:
        return self.x[node_id] + self.size[node_id][0] / 2

    def span(self, ids: list[str], widened: bool = False) -> tuple[float, float]:
        halves = [
            (max(self.size[q][0], MIN_COLUMN) if widened else self.size[q][0]) / 2 for q in ids
        ]
        return (
            min(self.center(q) - half for q, half in zip(ids, halves, strict=True)),
            max(self.center(q) + half for q, half in zip(ids, halves, strict=True)),
        )

    def flow_top(self, node_id: str) -> float:
        previous = self.previous(node_id)
        if previous is None:
            parent = self.parent[node_id]
            return ROW if parent is None else self.y[parent] + row_step(self.size[parent][1])
        above = [previous, *(self.subtree(previous) if self.below_lanes(previous) else [])]
        return max(self.y[q] + row_step(self.size[q][1]) for q in above)


def _row_findings(flow: _Flow, node_id: str) -> list[Finding]:
    label = flow.label(node_id)
    need = flow.flow_top(node_id)
    top = flow.y[node_id]
    previous = flow.previous(node_id)
    out: list[Finding] = []
    if top < need:
        out.append(Finding("ABOVE", (label,), f"y={top:g}, the flow puts it at y={need:g}"))
    elif top > need:
        out.append(Finding("FAR", (label,), f"y={top:g}, the flow puts it at y={need:g}"))
    if previous is None:
        return out
    before = flow.label(previous)
    off = flow.center(node_id) - flow.center(previous)
    if off:
        out.append(Finding("COLUMN", (label, before), f"{off:+g} px off the column"))
    low, high = flow.y[previous] + flow.size[previous][1], top
    left, right = flow.span([previous, node_id])
    own = set(flow.subtree(previous)) if flow.below_lanes(previous) else set()
    for other in flow.ids(flow.root):
        if other in (node_id, previous) or other in own:
            continue
        if low <= flow.y[other] < high and left <= flow.center(other) <= right:
            out.append(Finding("BETWEEN", (flow.label(other), before, label), "in their column"))
    return out


def _lane_findings(flow: _Flow, node_id: str) -> list[Finding]:
    label = flow.label(node_id)
    lanes = flow.sections[node_id]
    out: list[Finding] = []
    if flow.below_lanes(node_id):
        spans = [(handle, flow.span(flow.ids(chain))) for handle, chain in lanes.items()]
        for (first, (_, first_right)), (second, (second_left, _)) in zip(
            spans, spans[1:], strict=False
        ):
            if first_right > second_left:
                out.append(Finding("LANES", (label, first, second), "share columns"))
    if flow.beside(node_id):
        chain = flow.chain_of[node_id]
        rest = flow.ids(chain[flow.index[node_id] + 1 :])
        lane_right = flow.span(flow.ids(next(iter(lanes.values()))))[1]
        rest_left = flow.span(rest)[0]
        if lane_right + GUTTER > rest_left:
            out.append(
                Finding(
                    "BESIDE",
                    (label,),
                    f"its lane ends at x={lane_right:g}, the Blocks after it start at "
                    f"x={rest_left:g}",
                )
            )
    return out


def _overlaps(flow: _Flow) -> list[Finding]:
    ids = flow.ids(flow.root)
    out: list[Finding] = []
    for index, first in enumerate(ids):
        for second in ids[index + 1 :]:
            (first_width, first_height), (second_width, second_height) = (
                flow.size[first],
                flow.size[second],
            )
            if (
                flow.x[first] < flow.x[second] + second_width
                and flow.x[second] < flow.x[first] + first_width
                and flow.y[first] < flow.y[second] + second_height
                and flow.y[second] < flow.y[first] + first_height
            ):
                out.append(Finding("OVERLAP", (flow.label(first), flow.label(second)), ""))
    return out


def flow_order_findings(workflow: dict[str, Any]) -> list[Finding]:
    """Every place the layout does not read in flow order, in flow order; none when it does."""
    flow = _Flow(workflow)
    out: list[Finding] = []
    for node_id in flow.ids(flow.root):
        out += _row_findings(flow, node_id)
        out += _lane_findings(flow, node_id)
    return out + _overlaps(flow)


def kinds(findings: list[Finding]) -> set[tuple[str, tuple[str, ...]]]:
    """The findings without their numbers, to compare a layout before and after a change."""
    return {(finding.kind, finding.blocks) for finding in findings}
