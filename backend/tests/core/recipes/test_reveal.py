"""Reveal frames: growing pre-order snapshots the watch-mode build streams.

Watch-mode build-up: reveal_frames
consumes a clean compile_recipe result's test_data and yields a growing sequence
of canvas snapshots, one per pre-order node. The final frame equals the full
compiled workflow.
"""

import copy
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


FRAME_KEYS = {"nodes", "edges", "variables", "active_node_id", "final_bounds"}

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

    def test_each_frame_is_a_snapshot_with_the_five_contract_keys(self) -> None:
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


def placed_node(node_id: str, x: float, y: float, width: int, **data: Any) -> dict[str, Any]:
    """A laid-out log Block as the compiler stores it."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": x, "y": y},
        "width": width,
        "data": {"label": "Log", "elementType": "log", **data},
    }


def placed_test(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return {"workflow": {"nodes": nodes, "edges": edges}, "variables": {}}


def edge(source: str, target: str) -> dict[str, Any]:
    return {"id": f"edge-{source}-{target}", "source": source, "target": target}


class TestRevealFinalBounds:
    """Every frame carries where the finished test sits, so a watcher can frame it up front."""

    def test_every_frame_carries_the_same_final_bounds(self) -> None:
        frames, _, _ = reveal_minimal()
        assert frames[0]["final_bounds"] is not None
        assert [frame["final_bounds"] for frame in frames] == [frames[0]["final_bounds"]] * 4

    def test_final_bounds_span_every_block_at_its_final_position_and_size(self) -> None:
        # A 73 px card: the 44 px body and the 29 px status bar.
        test_data = placed_test(
            [placed_node("a", -100, 140, 200), placed_node("b", 300, 400, 160)],
            [edge("start-node", "a"), edge("a", "b")],
        )

        frames = reveal_frames(test_data)

        assert frames[0]["final_bounds"] == {"x": -100, "y": 140, "width": 560, "height": 333}

    def test_final_bounds_hold_the_blocks_still_to_come(self) -> None:
        test_data = placed_test(
            [placed_node("a", 0, 140, 160), placed_node("b", 0, 1400, 160)],
            [edge("start-node", "a"), edge("a", "b")],
        )

        first = reveal_frames(test_data)[0]

        assert [node["id"] for node in first["nodes"]] == ["a"]
        assert first["final_bounds"] == {"x": 0, "y": 140, "width": 160, "height": 1333}

    def test_final_bounds_size_each_block_by_its_incoming_connections(self) -> None:
        # Three incoming connections need three 80 px ingress handles: 240 px wide.
        test_data = placed_test(
            [
                placed_node("a", 0, 140, 160),
                placed_node("b", 0, 280, 160),
                placed_node("c", 0, 420, 160),
                placed_node("join", 0, 560, 160),
            ],
            [
                edge("start-node", "a"),
                edge("a", "b"),
                edge("b", "c"),
                edge("a", "join"),
                edge("b", "join"),
                edge("c", "join"),
            ],
        )

        frames = reveal_frames(test_data)

        assert frames[0]["final_bounds"] == {"x": 0, "y": 140, "width": 240, "height": 493}

    def test_final_bounds_grow_with_a_description(self) -> None:
        # Body chrome 42 + gap 4 + two 16.5 px description lines + the 29 px status bar.
        test_data = placed_test(
            [placed_node("a", 0, 140, 360, description="x" * 400)],
            [edge("start-node", "a")],
        )

        frames = reveal_frames(test_data)

        assert frames[0]["final_bounds"] == {"x": 0, "y": 140, "width": 360, "height": 108}


def log_step(label: str, message: str | None = None) -> dict[str, Any]:
    return {"block": "log", "label": label, "settings": {"message": message or label.lower()}}


def logs(*labels: str) -> list[dict[str, Any]]:
    return [log_step(label) for label in labels]


def change(before: str, after: str) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    """The stored test, its revision as the amendment saves it, and the frames between them."""
    from wavecore.core.recipes.amend import revise
    from wavecore.core.recipes.reveal import change_frames

    stored = compile_clean(before)["test_data"]
    result = compile_clean(after)
    revised = result["test_data"]
    revise(stored["workflow"], revised["workflow"], result["step_map"])
    return stored, revised, list(change_frames(stored, revised))


def node_by_label(nodes: list[dict[str, Any]], label: str) -> dict[str, Any]:
    return next(node for node in nodes if node["data"]["label"] == label)


def labels_of(frame: dict[str, Any]) -> list[str]:
    return [node["data"]["label"] for node in frame["nodes"]]


def lines_of(frame: dict[str, Any]) -> set[tuple[str, str]]:
    label = {node["id"]: node["data"]["label"] for node in frame["nodes"]}
    label["start-node"] = "start"
    return {(label[edge["source"]], label[edge["target"]]) for edge in frame["edges"]}


def turns(frames: list[dict[str, Any]]) -> list[str]:
    """The label of each turn's Block, in the order the turns come."""
    return [
        node_by_label_id(frame["nodes"], frame["active_node_id"])["data"]["label"]
        for frame in frames[1:]
    ]


def node_by_label_id(nodes: list[dict[str, Any]], node_id: str) -> dict[str, Any]:
    return next(node for node in nodes if node["id"] == node_id)


def canvas_log(node_id: str, label: str, y: float) -> dict[str, Any]:
    """A Log Block as the Workbench canvas saves it: keys and order the compiler never writes."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 3.3142364582105586, "y": y},
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"level": "INFO", "message": label.lower()},
                "outputBindings": {},
                "profileBindings": [],
                "unmasked_secret_fields": [],
                "secret_masking": "system",
            },
            "expressionFields": [],
            "templateFields": [],
        },
    }


def canvas_http(node_id: str, label: str, y: float) -> dict[str, Any]:
    """An HTTP Request Block as the Workbench canvas saves it: without choices the compiler
    writes for every HTTP Block it makes, such as ``auth_mode``."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 180.68775055229852, "y": y},
        "data": {
            "label": label,
            "elementType": "http-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {
                    "method": "GET",
                    "auth_enabled": False,
                    "body_mode": "text",
                    "body_auto_headers": True,
                    "response_mode": "body",
                    "verify_ssl": True,
                    "tls_min_version": "1.2",
                    "tls_max_version": "1.3",
                    "allow_redirects": True,
                    "proxy_mode": "wave-setting",
                    "url": "url",
                },
                "outputBindings": {},
                "profileBindings": [],
                "unmasked_secret_fields": [],
                "secret_masking": "system",
            },
            "expressionFields": ["url"],
            "templateFields": [],
            "description": "Fetch the page",
            "descriptionExpanded": True,
        },
        "width": 360,
        "height": 73,
        "resizing": False,
    }


def ssh_open_step(password: str | None) -> dict[str, Any]:
    settings = {"host": "node-1", "username": "wave"}
    if password is not None:
        settings["password"] = password
    return {"block": "ssh-session-open", "label": "SSH", "settings": settings}


SWITCH_VARIABLES: dict[str, Any] = {"x": {"type": "integer", "value": 1}}


def switch_recipe(cases: list[dict[str, Any]]) -> str:
    flow = [{"switch": {"cases": cases}}, log_step("After")]
    return make_recipe(flow, name="Switch Change", variables=SWITCH_VARIABLES)


def branch_recipe(then: list[dict[str, Any]], otherwise: list[dict[str, Any]]) -> str:
    flow = [{"if": {"when": "go", "then": then, "else": otherwise}}, log_step("After")]
    variables = {"go": {"type": "boolean", "value": True}}
    return make_recipe(flow, name="Branch Change", variables=variables)


class TestChangeFramesStepOne:
    """The first frame moves the Blocks that stay and drops the removed ones, all at once."""

    def test_the_staying_blocks_stand_at_their_final_places_and_nothing_else_shows(self) -> None:
        stored, revised, frames = change(
            make_recipe(logs("Alpha", "Bravo", "Removed")),
            make_recipe(logs("Inserted", "Alpha", "Bravo")),
        )

        first = frames[0]
        assert labels_of(first) == ["Alpha", "Bravo"]
        for label in ("Alpha", "Bravo"):
            shown = node_by_label(first["nodes"], label)
            final = node_by_label(revised["workflow"]["nodes"], label)
            assert shown["id"] == node_by_label(stored["workflow"]["nodes"], label)["id"]
            assert shown["position"] == final["position"]
        assert first["active_node_id"] is None

    def test_a_changed_block_keeps_its_stored_form_in_step_one(self) -> None:
        stored, _, frames = change(
            make_recipe([log_step("Alpha", "old"), log_step("Bravo")]),
            make_recipe([log_step("Alpha", "new"), log_step("Bravo")]),
        )

        shown = node_by_label(frames[0]["nodes"], "Alpha")
        assert shown["data"] == node_by_label(stored["workflow"]["nodes"], "Alpha")["data"]
        assert shown["data"]["config"]["values"]["message"] == "old"

    def test_every_frame_carries_the_finished_tests_bounds_and_its_variables(self) -> None:
        _, revised, frames = change(
            make_recipe(logs("Alpha"), variables={"v": {"type": "integer", "value": 1}}),
            make_recipe(logs("Alpha", "Added"), variables={"v": {"type": "integer", "value": 2}}),
        )

        bounds = reveal_frames(revised)[0]["final_bounds"]
        assert [frame["final_bounds"] for frame in frames] == [bounds] * len(frames)
        assert [frame["variables"] for frame in frames] == [revised["variables"]] * len(frames)
        assert all(set(frame) == FRAME_KEYS for frame in frames)

    def test_an_identical_recipe_gives_step_one_only(self) -> None:
        functions = [{"name": "probe", "inputs": [], "outputs": [], "flow": [LOG_STEP]}]
        recipe = make_recipe(
            [*logs("Alpha"), {"function": "probe"}, {"for": {"count": 2, "body": [LOG_STEP]}}],
            functions=functions,
        )

        stored, _, frames = change(recipe, recipe)

        assert len(frames) == 1
        assert frames[0]["nodes"] == stored["workflow"]["nodes"]
        assert frames[0]["edges"] == stored["workflow"]["edges"]

    def test_a_change_of_a_variable_value_only_gives_step_one_with_the_new_value(self) -> None:
        _, _, frames = change(
            make_recipe(logs("Alpha"), variables={"v": {"type": "integer", "value": 1}}),
            make_recipe(logs("Alpha"), variables={"v": {"type": "integer", "value": 2}}),
        )

        assert len(frames) == 1
        assert frames[0]["variables"] == {"v": {"type": "integer", "value": 2}}


class TestChangeFramesTurns:
    """Each added and each changed Block takes its own turn, in the flow order of the result."""

    def test_new_and_changed_blocks_take_turns_in_flow_order(self) -> None:
        _, _, frames = change(
            make_recipe([log_step("Alpha"), log_step("Bravo"), log_step("Charlie")]),
            make_recipe(
                [
                    log_step("Alpha", "changed"),
                    log_step("First New"),
                    log_step("Bravo"),
                    log_step("Charlie", "changed"),
                    log_step("Second New"),
                ]
            ),
        )

        assert turns(frames) == ["Alpha", "First New", "Charlie", "Second New"]

    def test_the_turns_block_takes_its_final_form(self) -> None:
        _, revised, frames = change(
            make_recipe([log_step("Alpha", "old")]),
            make_recipe([log_step("Alpha", "new"), log_step("Added")]),
        )

        final = revised["workflow"]["nodes"]
        alpha_turn, added_turn = frames[1], frames[2]
        assert node_by_label(alpha_turn["nodes"], "Alpha") == node_by_label(final, "Alpha")
        assert labels_of(alpha_turn) == ["Alpha"]
        assert node_by_label(added_turn["nodes"], "Added") == node_by_label(final, "Added")
        assert added_turn["active_node_id"] == node_by_label(final, "Added")["id"]

    def test_a_renamed_block_takes_its_turn_under_its_stored_id(self) -> None:
        stored, _, frames = change(
            make_recipe([log_step("Alpha", "same"), log_step("Bravo")]),
            make_recipe([log_step("Alpha renamed", "same"), log_step("Bravo")]),
        )

        assert len(frames) == 2
        alpha_id = node_by_label(stored["workflow"]["nodes"], "Alpha")["id"]
        assert frames[1]["active_node_id"] == alpha_id
        assert labels_of(frames[1]) == ["Alpha renamed", "Bravo"]

    def test_a_block_saved_from_the_canvas_takes_a_turn_only_for_what_the_recipe_changes(
        self,
    ) -> None:
        import yaml

        from wavecore.core.recipes.amend import revise
        from wavecore.core.recipes.decompiler import decompile_test_data
        from wavecore.core.recipes.reveal import change_frames

        alpha, bravo = "node-1793680693413-dvjla2m", "node-1793680720999-p4w8m2c"
        stored = {
            "workflow": {
                "nodes": [canvas_http(alpha, "Alpha", 47.3), canvas_log(bravo, "Bravo", 420.25)],
                "edges": [edge("start-node", alpha), edge(alpha, bravo)],
            },
            "variables": {"url": {"value": "http://google.com", "type": "string"}},
        }
        recipe = yaml.safe_load(decompile_test_data(stored)["recipe"])
        recipe["flow"][1]["settings"]["message"] = "changed"
        result = compile_clean(yaml.safe_dump(recipe, sort_keys=False))
        revised = result["test_data"]
        revise(stored["workflow"], revised["workflow"], result["step_map"])

        stored_alpha = node_by_label(stored["workflow"]["nodes"], "Alpha")["data"]["config"]
        compiled_alpha = node_by_label(revised["workflow"]["nodes"], "Alpha")["data"]["config"]
        # Alpha is unchanged, yet its stored values lack choices its compiled values hold.
        missing = compiled_alpha["values"].keys() - stored_alpha["values"].keys()
        assert {"auth_mode", "file_content_type"} <= missing
        changed = turns(list(change_frames(stored, revised)))
        assert "Alpha" not in changed
        assert changed == ["Bravo"]

    def test_a_recipe_that_drops_a_secret_the_block_holds_gives_it_a_turn(self) -> None:
        _, _, frames = change(
            make_recipe([ssh_open_step("s3cret"), log_step("After")]),
            make_recipe([ssh_open_step(None), log_step("After")]),
        )

        assert turns(frames) == ["SSH"]

    def test_a_new_value_for_a_secret_the_block_holds_gives_it_no_turn(self) -> None:
        _, _, frames = change(
            make_recipe([ssh_open_step("s3cret"), log_step("After")]),
            make_recipe([ssh_open_step("n3w-value"), log_step("After")]),
        )

        assert len(frames) == 1

    def test_a_block_that_differs_only_in_what_a_person_set_on_the_canvas_takes_no_turn(
        self,
    ) -> None:
        from wavecore.core.recipes.reveal import change_frames

        stored = compile_clean(make_recipe(logs("Alpha", "Bravo")))["test_data"]
        revised = copy.deepcopy(stored)
        alpha = stored["workflow"]["nodes"][0]["data"]
        alpha["descriptionExpanded"] = True
        alpha["config"].update(secret_masking="mask", unmasked_secret_fields=["auth_token"])

        assert len(list(change_frames(stored, revised))) == 1

    def test_a_block_moved_into_another_branch_leaves_in_step_one_and_returns_at_its_turn(
        self,
    ) -> None:
        stored, revised, frames = change(
            branch_recipe(logs("Keep", "Moving"), logs("Other")),
            branch_recipe(logs("Keep"), logs("Moving", "Other")),
        )

        stored_id = node_by_label(stored["workflow"]["nodes"], "Moving")["id"]
        moved_id = node_by_label(revised["workflow"]["nodes"], "Moving")["id"]
        assert "Moving" not in labels_of(frames[0])
        assert moved_id != stored_id
        assert turns(frames) == ["Moving"]
        assert node_by_label(frames[1]["nodes"], "Moving")["id"] == moved_id


class TestChangeFramesLines:
    """A line shows once both its ends have their final form; a line the stored test had
    stays while both its ends are on the canvas; every other stored line goes in step one."""

    def test_a_block_inserted_between_two_brings_its_lines_and_the_old_line_goes(self) -> None:
        _, _, frames = change(
            make_recipe(logs("Alpha", "Bravo")), make_recipe(logs("Alpha", "Inserted", "Bravo"))
        )

        assert lines_of(frames[0]) == {("start", "Alpha")}
        assert lines_of(frames[1]) == {
            ("start", "Alpha"),
            ("Alpha", "Inserted"),
            ("Inserted", "Bravo"),
        }

    def test_a_removal_joins_the_two_blocks_around_it_in_step_one(self) -> None:
        _, _, frames = change(
            make_recipe(logs("Alpha", "Removed", "Bravo")), make_recipe(logs("Alpha", "Bravo"))
        )

        assert len(frames) == 1
        assert lines_of(frames[0]) == {("start", "Alpha"), ("Alpha", "Bravo")}

    def test_a_changed_blocks_stored_lines_stay_throughout(self) -> None:
        _, _, frames = change(
            make_recipe([log_step("Alpha", "old"), log_step("Bravo")]),
            make_recipe([log_step("Alpha", "new"), log_step("Bravo")]),
        )

        assert [lines_of(frame) for frame in frames] == [
            {("start", "Alpha"), ("Alpha", "Bravo")}
        ] * 2

    def test_a_switch_that_gains_a_case_gains_its_line_once_both_ends_are_final(self) -> None:
        first_case = {"when": "x == 1", "steps": logs("One")}
        second_case = {"when": "x == 2", "steps": logs("Two")}
        _, _, frames = change(switch_recipe([first_case]), switch_recipe([first_case, second_case]))

        assert turns(frames) == ["Switch/Case", "Two"]
        kept = {("start", "Switch/Case"), ("Switch/Case", "One"), ("Switch/Case", "After")}
        assert lines_of(frames[0]) == kept
        assert lines_of(frames[1]) == kept
        assert lines_of(frames[2]) == kept | {("Switch/Case", "Two")}
