"""Deterministic recursive column layout (algorithm + invariants).

Canonical pixel cases, determinism, geometric invariants, pinned-position
passthrough.
"""

import math
from typing import Any


def layout(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    pinned: dict[str, dict[str, float]] | None = None,
) -> dict[str, dict[str, float]]:
    from wavecore.core.layout.engine import layout_workflow

    return layout_workflow(nodes, edges, pinned)


def estimate(node: dict[str, Any], ingress_count: int) -> tuple[int, int]:
    from wavecore.core.layout.dimensions import estimate_node_size

    return estimate_node_size(node, ingress_count)


def make_node(
    node_id: str,
    element_type: str = "log",
    node_type: str = "plugin",
    *,
    values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": element_type,
            "nodeType": node_type,
            "config": {"values": values or {}},
        },
    }


def make_edge(
    source: str,
    target: str,
    source_handle: str | None = None,
    target_handle: str | None = None,
) -> dict[str, Any]:
    edge: dict[str, Any] = {"id": f"edge-{source}-{target}", "source": source, "target": target}
    if source_handle is not None:
        edge["sourceHandle"] = source_handle
    if target_handle is not None:
        edge["targetHandle"] = target_handle
    return edge


def two_branch_if_values() -> dict[str, Any]:
    return {
        "branches": [
            {"id": "branch_0", "type": "if", "label": "", "conditions": []},
            {"id": "branch_1", "type": "else", "label": ""},
        ]
    }


def sequential_workflow() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    nodes = [make_node("node-1"), make_node("node-2")]
    edges = [make_edge("start-node", "node-1"), make_edge("node-1", "node-2")]
    return nodes, edges


def branching_workflow() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    nodes = [
        make_node("node-1", "if-else", "control", values=two_branch_if_values()),
        make_node("node-2"),
        make_node("node-3"),
        make_node("node-4"),
    ]
    edges = [
        make_edge("start-node", "node-1"),
        make_edge("node-1", "node-2", source_handle="branch_0"),
        make_edge("node-1", "node-3", source_handle="branch_1"),
        make_edge("node-2", "node-4"),
        make_edge("node-3", "node-4", target_handle="ingress_1"),
    ]
    return nodes, edges


def loop_workflow() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    nodes = [
        make_node("node-1", "for", "control", values={"mode": "count", "count": 3}),
        make_node("node-2"),
        make_node("node-3"),
    ]
    edges = [
        make_edge("start-node", "node-1"),
        make_edge("node-1", "node-2", source_handle="body"),
        make_edge("node-1", "node-3", source_handle="then"),
    ]
    return nodes, edges


def complex_workflow() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Try/catch/finally whose try section holds a nested two-branch if."""
    nodes = [
        make_node(
            "node-1",
            "try-catch-finally",
            "control",
            values={"enable_catch": True, "enable_finally": True},
        ),
        make_node("node-2", "if-else", "control", values=two_branch_if_values()),
        make_node("node-3"),
        make_node("node-4"),
        make_node("node-5"),
        make_node("node-6"),
        make_node("node-7"),
        make_node("node-8"),
    ]
    edges = [
        make_edge("start-node", "node-1"),
        make_edge("node-1", "node-2", source_handle="try"),
        make_edge("node-2", "node-3", source_handle="branch_0"),
        make_edge("node-2", "node-4", source_handle="branch_1"),
        make_edge("node-3", "node-5"),
        make_edge("node-4", "node-5", target_handle="ingress_1"),
        make_edge("node-1", "node-6", source_handle="catch"),
        make_edge("node-1", "node-7", source_handle="finally"),
        make_edge("node-1", "node-8", source_handle="then"),
    ]
    return nodes, edges


def ingress_counts(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, int]:
    counts = {node["id"]: 0 for node in nodes}
    for edge in edges:
        if edge["target"] in counts:
            counts[edge["target"]] += 1
    return counts


def bounding_boxes(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    positions: dict[str, dict[str, float]],
) -> dict[str, tuple[float, float, float, float]]:
    counts = ingress_counts(nodes, edges)
    boxes: dict[str, tuple[float, float, float, float]] = {}
    for node in nodes:
        width, height = estimate(node, max(1, counts[node["id"]]))
        position = positions[node["id"]]
        boxes[node["id"]] = (position["x"], position["y"], width, height)
    return boxes


def boxes_overlap(
    a: tuple[float, float, float, float], b: tuple[float, float, float, float]
) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


class TestConstants:
    def test_layout_constants_match_the_canvas_rhythm(self) -> None:
        from wavecore.core.layout import engine

        assert engine.RHYTHM_Y == 140
        assert engine.GUTTER_X == 80
        assert engine.MIN_COLUMN_WIDTH == 240


class TestCanonicalPixelCases:
    def test_two_sequential_blocks(self) -> None:
        nodes, edges = sequential_workflow()
        assert layout(nodes, edges) == {
            "node-1": {"x": -80, "y": 140},
            "node-2": {"x": -80, "y": 280},
        }

    def test_single_block(self) -> None:
        node = make_node("node-1")
        assert layout([node], [make_edge("start-node", "node-1")]) == {
            "node-1": {"x": -80, "y": 140}
        }

    def test_two_branch_if_fans_out_and_rejoins(self) -> None:
        nodes, edges = branching_workflow()
        assert layout(nodes, edges) == {
            "node-1": {"x": -80, "y": 140},
            "node-2": {"x": -240, "y": 280},
            "node-3": {"x": 80, "y": 280},
            "node-4": {"x": -80, "y": 420},
        }

    def test_loop_body_hangs_left_of_the_continuation_lane(self) -> None:
        # A single body column + a then egress reserves an empty continuation
        # lane so the then edge never runs through the body boxes.
        nodes, edges = loop_workflow()
        assert layout(nodes, edges) == {
            "node-1": {"x": -80, "y": 140},
            "node-2": {"x": -240, "y": 280},
            "node-3": {"x": -80, "y": 420},
        }

    def test_try_sections_all_pack_left_of_the_continuation_lane(self) -> None:
        # Multi-section constructs with a then egress hang EVERY section column
        # left of the spine in handle order; the continuation stays on the spine.
        nodes = [
            make_node(
                "node-1",
                "try-catch-finally",
                "control",
                values={"enable_catch": True, "enable_finally": False},
            ),
            make_node("node-2"),
            make_node("node-3"),
            make_node("node-4"),
        ]
        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-2", source_handle="try"),
            make_edge("node-1", "node-3", source_handle="catch"),
            make_edge("node-1", "node-4", source_handle="then"),
        ]
        positions = layout(nodes, edges)
        assert positions["node-2"] == {"x": -560, "y": 280}
        assert positions["node-3"] == {"x": -240, "y": 280}
        assert positions["node-4"] == {"x": -80, "y": 420}

    def test_try_with_steps_only_also_reserves_the_continuation_lane(self) -> None:
        nodes = [
            make_node(
                "node-1",
                "try-catch-finally",
                "control",
                values={"enable_catch": False, "enable_finally": False},
            ),
            make_node("node-2"),
            make_node("node-3"),
        ]
        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-2", source_handle="try"),
            make_edge("node-1", "node-3", source_handle="then"),
        ]
        positions = layout(nodes, edges)
        assert positions["node-2"] == {"x": -240, "y": 280}
        assert positions["node-3"] == {"x": -80, "y": 420}

    def test_start_node_is_never_in_the_result(self) -> None:
        nodes, edges = sequential_workflow()
        assert "start-node" not in layout(nodes, edges)

    def test_empty_workflow_yields_an_empty_result(self) -> None:
        assert layout([], []) == {}


class TestDeterminism:
    def test_same_input_yields_identical_output(self) -> None:
        first_nodes, first_edges = complex_workflow()
        second_nodes, second_edges = complex_workflow()
        assert layout(first_nodes, first_edges) == layout(second_nodes, second_edges)


class TestInvariants:
    def test_positions_are_finite_numbers(self) -> None:
        nodes, edges = complex_workflow()
        for position in layout(nodes, edges).values():
            assert math.isfinite(position["x"])
            assert math.isfinite(position["y"])

    def test_result_covers_exactly_the_input_nodes(self) -> None:
        nodes, edges = complex_workflow()
        assert set(layout(nodes, edges).keys()) == {node["id"] for node in nodes}

    def test_y_strictly_increases_along_every_edge(self) -> None:
        nodes, edges = complex_workflow()
        positions = layout(nodes, edges)
        for edge in edges:
            if edge["source"] == "start-node":
                continue
            assert (
                positions[edge["target"]]["y"] > positions[edge["source"]]["y"]
            ), f"edge {edge['id']} must descend"

    def test_no_two_estimated_bounding_boxes_overlap(self) -> None:
        nodes, edges = complex_workflow()
        boxes = bounding_boxes(nodes, edges, layout(nodes, edges))
        ids = sorted(boxes)
        for index, first in enumerate(ids):
            for second in ids[index + 1 :]:
                assert not boxes_overlap(boxes[first], boxes[second]), f"{first} overlaps {second}"

    def test_sibling_branch_columns_are_separated_by_the_gutter(self) -> None:
        nodes, edges = branching_workflow()
        boxes = bounding_boxes(nodes, edges, layout(nodes, edges))
        left_x, _, left_width, _ = boxes["node-2"]
        right_x, _, _, _ = boxes["node-3"]
        assert left_x + left_width + 80 <= right_x

    def test_try_sections_pack_left_to_right_in_section_order(self) -> None:
        nodes, edges = complex_workflow()
        positions = layout(nodes, edges)
        try_column_max_x = max(positions[n]["x"] for n in ("node-2", "node-3", "node-4", "node-5"))
        assert try_column_max_x < positions["node-6"]["x"]
        assert positions["node-6"]["x"] < positions["node-7"]["x"]

    def test_rejoin_row_is_below_every_child_row(self) -> None:
        nodes, edges = branching_workflow()
        positions = layout(nodes, edges)
        assert positions["node-4"]["y"] > positions["node-2"]["y"]
        assert positions["node-4"]["y"] > positions["node-3"]["y"]

    def test_egress_row_is_below_every_section_row(self) -> None:
        nodes, edges = complex_workflow()
        positions = layout(nodes, edges)
        section_ids = ("node-2", "node-3", "node-4", "node-5", "node-6", "node-7")
        assert all(positions["node-8"]["y"] > positions[n]["y"] for n in section_ids)


class TestPinnedPositions:
    def test_pinned_positions_are_returned_verbatim(self) -> None:
        nodes, edges = sequential_workflow()
        pinned = {"node-2": {"x": 999.5, "y": -3.0}}
        positions = layout(nodes, edges, pinned)
        assert positions["node-2"] == {"x": 999.5, "y": -3.0}

    def test_unpinned_nodes_are_still_placed_fresh(self) -> None:
        nodes, edges = sequential_workflow()
        positions = layout(nodes, edges, {"node-2": {"x": 999.5, "y": -3.0}})
        assert positions["node-1"] == {"x": -80, "y": 140}

    def test_batch_b_passes_none_and_gets_full_placement(self) -> None:
        nodes, edges = sequential_workflow()
        assert layout(nodes, edges, None) == layout(nodes, edges)


class TestStructuralEdgeCases:
    """Coverage closure: rejoin-only branches, dangling starts, orphans."""

    def test_empty_branch_edge_straight_to_the_rejoin(self) -> None:
        nodes = [
            make_node("node-1", "if-else", "control", values=two_branch_if_values()),
            make_node("node-2"),
            make_node("node-3"),
        ]
        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-3", source_handle="branch_0"),
            make_edge("node-1", "node-2", source_handle="branch_1"),
            make_edge("node-2", "node-3", target_handle="ingress_1"),
        ]
        positions = layout(nodes, edges)
        assert set(positions) == {"node-1", "node-2", "node-3"}
        assert positions["node-3"]["y"] > positions["node-2"]["y"]

    def test_dangling_start_edge_is_skipped(self) -> None:
        node = make_node("node-1")
        edges = [make_edge("start-node", "ghost"), make_edge("start-node", "node-1")]
        assert layout([node], edges) == {"node-1": {"x": -80, "y": 140}}

    def test_orphan_node_is_still_placed(self) -> None:
        nodes = [make_node("node-1"), make_node("node-2")]
        edges = [make_edge("start-node", "node-1")]
        positions = layout(nodes, edges)
        assert set(positions) == {"node-1", "node-2"}
        assert positions["node-2"]["y"] > positions["node-1"]["y"]


class TestIngressCounts:
    def test_counts_incoming_edges_per_target(self) -> None:
        from wavecore.core.layout.engine import ingress_counts as count_ingress

        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-2", source_handle="branch_0"),
            make_edge("node-1", "node-3", source_handle="branch_1"),
            make_edge("node-2", "node-4", target_handle="ingress_0"),
            make_edge("node-3", "node-4", target_handle="ingress_1"),
        ]
        assert count_ingress(edges) == {"node-1": 1, "node-2": 1, "node-3": 1, "node-4": 2}

    def test_a_node_without_incoming_edges_is_absent(self) -> None:
        from wavecore.core.layout.engine import ingress_counts as count_ingress

        assert count_ingress([]) == {}
        assert "node-9" not in count_ingress([make_edge("start-node", "node-1")])
