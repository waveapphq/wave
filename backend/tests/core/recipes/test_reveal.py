"""Reveal frames: growing pre-order snapshots the watch-mode build streams.

Watch-mode build-up: reveal_frames
consumes a clean compile_recipe result's test_data and yields a growing sequence
of canvas snapshots, one per pre-order node. The final frame equals the full
compiled workflow.
"""

from typing import Any

from tests.core.recipes.conftest import LOG_STEP, make_recipe


def compile_recipe(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe as compile_fn

    return compile_fn(text)


def reveal_frames(test_data: dict[str, Any]) -> list[dict[str, Any]]:
    from wavecore.core.recipes.reveal import reveal_frames as reveal_fn

    return list(reveal_fn(test_data))


def compile_clean(text: str) -> dict[str, Any]:
    result = compile_recipe(text)
    errors = [f for f in result["findings"] if f["severity"] == "error"]
    assert errors == [], f"expected a clean compile, got {errors!r}"
    assert result["test_data"] is not None
    return result


FRAME_KEYS = {"nodes", "edges", "variables", "active_node_id"}

MINIMAL_VARIABLES: dict[str, Any] = {
    "attempts": {"type": "integer", "value": 3},
    "greeting": {"type": "string", "value": "hi"},
}


def minimal_recipe() -> str:
    """Four pre-order nodes, a for control with a body, and two variables."""
    flow = [
        {"block": "log", "settings": {"message": "start"}},
        {
            "for": {
                "count": 3,
                "body": [{"block": "log", "settings": {"message": "tick"}}],
            }
        },
        {"block": "log", "settings": {"message": "done"}},
    ]
    return make_recipe(flow, name="Watch Build", variables=MINIMAL_VARIABLES)


def reveal_minimal() -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, str]]:
    result = compile_clean(minimal_recipe())
    frames = reveal_frames(result["test_data"])
    return frames, result["test_data"], result["step_map"]


class TestRevealFrames:
    def test_yields_one_frame_per_node(self) -> None:
        frames, test_data, _ = reveal_minimal()
        assert len(frames) == len(test_data["workflow"]["nodes"]) == 4

    def test_each_frame_is_a_snapshot_with_the_four_contract_keys(self) -> None:
        frames, _, _ = reveal_minimal()
        for frame in frames:
            assert set(frame.keys()) == FRAME_KEYS

    def test_each_frame_reveals_the_next_pre_order_prefix(self) -> None:
        frames, test_data, _ = reveal_minimal()
        expected_ids = [node["id"] for node in test_data["workflow"]["nodes"]]
        for k, frame in enumerate(frames):
            assert [node["id"] for node in frame["nodes"]] == expected_ids[: k + 1]

    def test_active_node_id_walks_the_node_list_order(self) -> None:
        frames, _, _ = reveal_minimal()
        assert [frame["active_node_id"] for frame in frames] == [
            "node-1",
            "node-2",
            "node-3",
            "node-4",
        ]

    def test_all_variables_seed_the_first_frame(self) -> None:
        frames, test_data, _ = reveal_minimal()
        assert test_data["variables"] == MINIMAL_VARIABLES
        assert frames[0]["variables"] == test_data["variables"]

    def test_variables_stay_full_through_the_final_frame(self) -> None:
        frames, test_data, _ = reveal_minimal()
        assert frames[-1]["variables"] == test_data["variables"]

    def test_final_frame_holds_the_full_workflow_nodes(self) -> None:
        frames, test_data, _ = reveal_minimal()
        assert frames[-1]["nodes"] == test_data["workflow"]["nodes"]

    def test_final_frame_holds_every_workflow_edge(self) -> None:
        frames, test_data, _ = reveal_minimal()
        frame_edge_ids = {edge["id"] for edge in frames[-1]["edges"]}
        workflow_edge_ids = {edge["id"] for edge in test_data["workflow"]["edges"]}
        assert frame_edge_ids == workflow_edge_ids

    def test_control_block_frames_before_its_body(self) -> None:
        frames, _, _ = reveal_minimal()
        frame_two_ids = [node["id"] for node in frames[1]["nodes"]]
        frame_three_ids = [node["id"] for node in frames[2]["nodes"]]
        assert "node-2" in frame_two_ids
        assert "node-3" not in frame_two_ids
        assert "node-3" in frame_three_ids

    def test_start_edge_is_revealed_in_the_first_frame(self) -> None:
        frames, _, _ = reveal_minimal()
        first_frame_edge_ids = {edge["id"] for edge in frames[0]["edges"]}
        assert "edge-start-node-node-1" in first_frame_edge_ids

    def test_every_frame_edge_connects_revealed_nodes(self) -> None:
        frames, _, _ = reveal_minimal()
        for frame in frames:
            revealed = {node["id"] for node in frame["nodes"]}
            for edge in frame["edges"]:
                assert edge["target"] in revealed
                assert edge["source"] in revealed or edge["source"] == "start-node"

    def test_step_map_covers_every_revealed_node(self) -> None:
        frames, _, step_map = reveal_minimal()
        for frame in frames:
            for node in frame["nodes"]:
                assert node["id"] in step_map

    def test_reveal_is_deterministic(self) -> None:
        first_frames, _, _ = reveal_minimal()
        second_frames, _, _ = reveal_minimal()
        assert first_frames == second_frames


class TestRevealEdgeCases:
    def test_single_node_recipe_yields_exactly_one_frame(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP]))
        test_data = result["test_data"]
        frames = reveal_frames(test_data)
        assert len(frames) == 1
        node_id = test_data["workflow"]["nodes"][0]["id"]
        assert [node["id"] for node in frames[0]["nodes"]] == [node_id]
        assert frames[0]["active_node_id"] == node_id
        assert frames[0]["variables"] == test_data["variables"]
        assert set(frames[0].keys()) == FRAME_KEYS

    def test_empty_workflow_yields_zero_frames(self) -> None:
        empty_test_data: dict[str, Any] = {
            "name": "Empty Watch",
            "description": "",
            "workflow": {"nodes": [], "edges": []},
            "variables": {},
            "metadata": {"tags": []},
        }
        assert reveal_frames(empty_test_data) == []
