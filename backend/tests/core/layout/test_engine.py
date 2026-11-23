"""Deterministic recursive column layout (algorithm + invariants)."""

import math
from typing import Any

import pytest


def layout(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    from wavecore.core.layout.engine import layout_workflow

    return layout_workflow(nodes, edges)


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


def loop_ending_a_branch_workflow() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """An If whose first branch ends with a loop; the loop's continuation is the If's rejoin."""
    nodes = [
        make_node("node-1", "if-else", "control", values=two_branch_if_values()),
        make_node("node-2", "for", "control", values={"mode": "count", "count": 2}),
        make_node("node-3"),
        make_node("node-4"),
        make_node("node-5"),
    ]
    edges = [
        make_edge("start-node", "node-1"),
        make_edge("node-1", "node-2", source_handle="branch_0"),
        make_edge("node-2", "node-3", source_handle="body"),
        make_edge("node-2", "node-5", source_handle="then"),
        make_edge("node-1", "node-4", source_handle="branch_1"),
        make_edge("node-4", "node-5", target_handle="ingress_1"),
    ]
    return nodes, edges


def if_ending_a_branch_workflow() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """An If whose first branch ends with another If; all three paths rejoin at node-6."""
    nodes = [
        make_node("node-1", "if-else", "control", values=two_branch_if_values()),
        make_node("node-2", "if-else", "control", values=two_branch_if_values()),
        make_node("node-3"),
        make_node("node-4"),
        make_node("node-5"),
        make_node("node-6"),
    ]
    edges = [
        make_edge("start-node", "node-1"),
        make_edge("node-1", "node-2", source_handle="branch_0"),
        make_edge("node-2", "node-3", source_handle="branch_0"),
        make_edge("node-2", "node-4", source_handle="branch_1"),
        make_edge("node-1", "node-5", source_handle="branch_1"),
        make_edge("node-3", "node-6"),
        make_edge("node-4", "node-6", target_handle="ingress_1"),
        make_edge("node-5", "node-6", target_handle="ingress_2"),
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

    def test_the_room_clearance_is_what_a_row_leaves_under_the_tallest_collapsed_card(
        self,
    ) -> None:
        from wavecore.core.layout import engine

        assert engine.ROOM_CLEARANCE_X == 40
        assert engine.ROOM_CLEARANCE_Y == 32


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

    def test_a_loop_continuation_sits_one_row_below_it_beside_the_body(self) -> None:
        # The body column hangs left of the continuation column, one gutter apart.
        nodes, edges = loop_workflow()
        assert layout(nodes, edges) == {
            "node-1": {"x": -80, "y": 140},
            "node-2": {"x": -400, "y": 280},
            "node-3": {"x": -80, "y": 280},
        }

    def test_a_loop_continuation_chain_runs_down_beside_the_body(self) -> None:
        nodes = [
            make_node("node-1", "while", "control"),
            make_node("node-2"),
            make_node("node-3"),
            make_node("node-4"),
            make_node("node-5"),
        ]
        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-2", source_handle="body"),
            make_edge("node-2", "node-3"),
            make_edge("node-1", "node-4", source_handle="then"),
            make_edge("node-4", "node-5"),
        ]
        assert layout(nodes, edges) == {
            "node-1": {"x": -80, "y": 140},
            "node-2": {"x": -400, "y": 280},
            "node-3": {"x": -400, "y": 420},
            "node-4": {"x": -80, "y": 280},
            "node-5": {"x": -80, "y": 420},
        }

    def test_a_wait_retry_lane_puts_its_continuation_beside_it(self) -> None:
        nodes = [
            make_node("node-1", "wait-until", "control", values={"mode": "retry"}),
            make_node("node-2"),
            make_node("node-3"),
        ]
        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-2", source_handle="retry"),
            make_edge("node-1", "node-3", source_handle="then"),
        ]
        positions = layout(nodes, edges)
        assert positions["node-3"] == {"x": -80, "y": 280}
        assert positions["node-2"] == {"x": -400, "y": 280}

    def test_a_wide_continuation_pushes_the_body_further_left(self) -> None:
        nodes, edges = loop_workflow()
        nodes[2]["width"] = 360
        positions = layout(nodes, edges)
        assert positions["node-3"] == {"x": -180, "y": 280}
        assert positions["node-2"] == {"x": -460, "y": 280}

    def test_a_loop_inside_a_branch_keeps_the_rejoin_below_body_and_continuation(self) -> None:
        nodes = [
            make_node("node-1", "if-else", "control", values=two_branch_if_values()),
            make_node("node-2", "for", "control", values={"mode": "count", "count": 2}),
            make_node("node-3"),
            make_node("node-4"),
            make_node("node-5"),
            make_node("node-6"),
            make_node("node-7"),
        ]
        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-2", source_handle="branch_0"),
            make_edge("node-2", "node-3", source_handle="body"),
            make_edge("node-3", "node-4"),
            make_edge("node-4", "node-5"),
            make_edge("node-2", "node-6", source_handle="then"),
            make_edge("node-1", "node-7", source_handle="branch_1", target_handle="ingress_1"),
            make_edge("node-6", "node-7"),
        ]
        positions = layout(nodes, edges)
        assert positions["node-6"]["y"] == 420
        assert positions["node-7"]["y"] == 840
        assert crowding_pairs(nodes, edges, positions) == []

    def test_a_loop_ending_a_branch_puts_the_step_after_the_if_below_it_on_the_main_line(
        self,
    ) -> None:
        # The loop's continuation is the If's rejoin, so the loop's body packs left of it.
        nodes, edges = loop_ending_a_branch_workflow()
        assert layout(nodes, edges) == {
            "node-1": {"x": -80, "y": 140},
            "node-2": {"x": -240, "y": 280},
            "node-3": {"x": -400, "y": 420},
            "node-4": {"x": 240, "y": 280},
            "node-5": {"x": -80, "y": 560},
        }

    def test_an_if_ending_a_branch_puts_the_step_after_the_outer_if_below_it(self) -> None:
        nodes, edges = if_ending_a_branch_workflow()
        assert layout(nodes, edges) == {
            "node-1": {"x": -80, "y": 140},
            "node-2": {"x": -240, "y": 280},
            "node-3": {"x": -400, "y": 420},
            "node-4": {"x": -80, "y": 420},
            "node-5": {"x": 240, "y": 280},
            "node-6": {"x": -120, "y": 560},
        }

    def test_try_sections_all_pack_left_of_the_continuation_lane(self) -> None:
        # Every section column hangs left of the spine; the continuation stays on it.
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


def chain_workflow(count: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """node-1 .. node-<count> in one straight flow."""
    nodes = [make_node(f"node-{index}") for index in range(1, count + 1)]
    edges = [make_edge("start-node", "node-1")]
    edges += [make_edge(f"node-{index}", f"node-{index + 1}") for index in range(1, count)]
    return nodes, edges


def crowding_pairs(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    positions: dict[str, dict[str, float]],
) -> list[tuple[str, str]]:
    boxes = bounding_boxes(nodes, edges, positions)
    ids = sorted(boxes)
    return [
        (first, second)
        for index, first in enumerate(ids)
        for second in ids[index + 1 :]
        if boxes_overlap(boxes[first], boxes[second])
    ]


def nested_release_workflow() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """An If/Else whose then-branch holds a Remote Execution with a two-Block body."""
    nodes = [
        make_node("node-1"),
        make_node("node-2", "if-else", "control", values=two_branch_if_values()),
        make_node("node-3", "remote-execution", "control"),
        make_node("node-4"),
        make_node("node-5"),
        make_node("node-6"),
        make_node("node-7", "halt", "control"),
        make_node("node-8"),
        make_node("node-9"),
    ]
    edges = [
        make_edge("start-node", "node-1"),
        make_edge("node-1", "node-2"),
        make_edge("node-2", "node-3", source_handle="branch_0"),
        make_edge("node-3", "node-4", source_handle="body"),
        make_edge("node-4", "node-5"),
        make_edge("node-2", "node-6", source_handle="branch_1"),
        make_edge("node-6", "node-7"),
        make_edge("node-3", "node-8", source_handle="then"),
        make_edge("node-8", "node-9"),
    ]
    return nodes, edges


class TestFreshLayoutNeverOverlaps:
    def test_rows_of_the_tallest_collapsed_cards_keep_the_rhythm(self) -> None:
        nodes, edges = chain_workflow(3)
        for node in nodes:
            node["data"]["description"] = "x" * 64
        positions = layout(nodes, edges)
        assert positions == {
            "node-1": {"x": -80, "y": 140},
            "node-2": {"x": -80, "y": 280},
            "node-3": {"x": -80, "y": 420},
        }
        assert crowding_pairs(nodes, edges, positions) == []

    def test_a_remote_body_inside_a_branch_overlaps_nothing(self) -> None:
        nodes, edges = nested_release_workflow()
        assert crowding_pairs(nodes, edges, layout(nodes, edges)) == []

    def test_the_nested_flow_keeps_its_columns(self) -> None:
        nodes, edges = nested_release_workflow()
        assert layout(nodes, edges) == {
            "node-1": {"x": -80, "y": 140},
            "node-2": {"x": -80, "y": 280},
            "node-3": {"x": -240, "y": 420},
            "node-4": {"x": -560, "y": 560},
            "node-5": {"x": -560, "y": 700},
            "node-6": {"x": 400, "y": 420},
            "node-7": {"x": 400, "y": 560},
            "node-8": {"x": -240, "y": 560},
            "node-9": {"x": -240, "y": 700},
        }


class TestFlowTree:
    """Every node in flow order, with the flows of its sections keyed by handle."""

    def tree(
        self, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
    ) -> list[tuple[str, dict[str, Any]]]:
        from wavecore.core.layout.engine import flow_tree

        return flow_tree(nodes, edges)

    def test_a_straight_flow_is_one_row_per_node(self) -> None:
        nodes, edges = sequential_workflow()
        assert self.tree(nodes, edges) == [("node-1", {}), ("node-2", {})]

    def test_branches_are_sections_and_the_rejoin_continues_the_flow(self) -> None:
        nodes, edges = branching_workflow()
        assert self.tree(nodes, edges) == [
            ("node-1", {"branch_0": [("node-2", {})], "branch_1": [("node-3", {})]}),
            ("node-4", {}),
        ]

    def test_a_loop_body_is_a_section_and_then_continues_the_flow(self) -> None:
        nodes, edges = loop_workflow()
        assert self.tree(nodes, edges) == [("node-1", {"body": [("node-2", {})]}), ("node-3", {})]

    def test_sections_nest(self) -> None:
        nodes, edges = complex_workflow()
        assert self.tree(nodes, edges) == [
            (
                "node-1",
                {
                    "try": [
                        ("node-2", {"branch_0": [("node-3", {})], "branch_1": [("node-4", {})]}),
                        ("node-5", {}),
                    ],
                    "catch": [("node-6", {})],
                    "finally": [("node-7", {})],
                },
            ),
            ("node-8", {}),
        ]

    def test_a_branch_wired_straight_to_the_rejoin_has_no_section(self) -> None:
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
        assert self.tree(nodes, edges) == [
            ("node-1", {"branch_1": [("node-2", {})]}),
            ("node-3", {}),
        ]

    def test_flows_nothing_reaches_follow_the_start_flow(self) -> None:
        nodes = [make_node("node-1"), make_node("node-2"), make_node("node-3")]
        edges = [make_edge("start-node", "node-2"), make_edge("node-1", "node-3")]
        assert self.tree(nodes, edges) == [("node-2", {}), ("node-1", {}), ("node-3", {})]

    def test_the_rejoin_after_a_loop_ending_a_branch_continues_the_main_flow(self) -> None:
        nodes, edges = loop_ending_a_branch_workflow()
        assert self.tree(nodes, edges) == [
            (
                "node-1",
                {
                    "branch_0": [("node-2", {"body": [("node-3", {})]})],
                    "branch_1": [("node-4", {})],
                },
            ),
            ("node-5", {}),
        ]

    def test_the_rejoin_after_an_if_ending_a_branch_continues_the_outer_flow(self) -> None:
        nodes, edges = if_ending_a_branch_workflow()
        inner = {"branch_0": [("node-3", {})], "branch_1": [("node-4", {})]}
        assert self.tree(nodes, edges) == [
            ("node-1", {"branch_0": [("node-2", inner)], "branch_1": [("node-5", {})]}),
            ("node-6", {}),
        ]


class TestFlowRows:
    """Each flow's rows, with each construct's lanes and how its continuation runs."""

    def rows(self, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[Any]:
        from wavecore.core.layout.engine import flow_rows

        return flow_rows(nodes, edges)

    def test_a_loop_with_a_continuation_runs_it_beside_its_body(self) -> None:
        from wavecore.core.layout.engine import Lane, Row

        nodes, edges = loop_workflow()
        body = Lane("body", (Row("node-2", (), False, False),))
        assert self.rows(nodes, edges) == [
            (Row("node-1", (body,), True, True), Row("node-3", (), False, False))
        ]

    def test_a_loop_ending_a_branch_packs_its_body_left_of_the_rejoin(self) -> None:
        nodes, edges = loop_ending_a_branch_workflow()
        (main,) = self.rows(nodes, edges)
        loop = main[0].lanes[0].rows[0]
        assert (loop.node_id, loop.anchored, loop.beside) == ("node-2", True, False)
        assert [row.node_id for row in main] == ["node-1", "node-5"]

    def test_lanes_come_in_handle_order_without_the_empty_ones(self) -> None:
        nodes, edges = complex_workflow()
        (main,) = self.rows(nodes, edges)
        assert [lane.handle for lane in main[0].lanes] == ["try", "catch", "finally"]
        assert (main[0].anchored, main[0].beside) == (True, False)

    def test_each_flow_nothing_reaches_is_a_flow_of_its_own(self) -> None:
        nodes = [make_node("node-1"), make_node("node-2"), make_node("node-3")]
        edges = [make_edge("start-node", "node-2"), make_edge("node-1", "node-3")]
        assert [[row.node_id for row in flow] for flow in self.rows(nodes, edges)] == [
            ["node-2"],
            ["node-1", "node-3"],
        ]


class TestCrowding:
    def test_boxes_closer_than_the_clearance_on_both_axes_crowd(self) -> None:
        from wavecore.core.layout.engine import crowds

        assert crowds((0, 0, 160, 73), (199, 104, 160, 73)) is True
        assert crowds((0, 0, 160, 73), (200, 0, 160, 73)) is False
        assert crowds((0, 0, 160, 73), (0, 105, 160, 73)) is False

    def test_a_row_step_clears_the_card_by_whole_rows(self) -> None:
        from wavecore.core.layout.engine import row_step

        assert [row_step(height) for height in (73, 108, 109, 174)] == [140, 140, 280, 280]


def note_in_chain(text: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """node-1, a wired Note holding ``text``, then node-2."""
    note = {
        "id": "note-1",
        "type": "noteNode",
        "data": {
            "label": "Note",
            "elementType": "note",
            "nodeType": "control",
            "config": {"values": {"text": text}},
        },
    }
    nodes = [make_node("node-1"), note, make_node("node-2")]
    edges = [
        make_edge("start-node", "node-1"),
        make_edge("node-1", "note-1"),
        make_edge("note-1", "node-2"),
    ]
    return nodes, edges


class TestANoteNeverCrowdsTheNextBlock:
    """REQ-5.2.7.4: the Block after a Note starts on a whole row at least 32 px below it."""

    @pytest.mark.parametrize(
        ("lines", "note_height"), [(4, 142), (8, 233)], ids=["four-lines", "eight-lines"]
    )
    def test_the_next_block_moves_down_whole_rows(self, lines: int, note_height: int) -> None:
        nodes, edges = note_in_chain("\n".join(f"line {index}" for index in range(lines)))

        positions = layout(nodes, edges)

        step = positions["node-2"]["y"] - positions["note-1"]["y"]
        assert step == math.ceil((note_height + 32) / 140) * 140
        assert step - note_height >= 32
        assert crowding_pairs(nodes, edges, positions) == []
