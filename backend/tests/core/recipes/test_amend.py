"""Amend enablers on the compiler side."""

import copy
from collections.abc import Callable
from typing import Any

from tests.core.layout.flow_order import flow_order_findings
from tests.core.layout.storyboard import STEPS, seed_profiles, step_recipe
from tests.core.recipes.conftest import LOG_STEP, make_recipe


def compile_recipe(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe as compile_fn

    return compile_fn(text)


def compile_clean(text: str) -> dict[str, Any]:
    result = compile_recipe(text)
    errors = [f for f in result["findings"] if f["severity"] == "error"]
    assert errors == [], f"expected a clean compile, got {errors!r}"
    assert result["test_data"] is not None
    return result


def nodes_of(result: dict[str, Any]) -> list[dict[str, Any]]:
    return result["test_data"]["workflow"]["nodes"]


def all_edges(result: dict[str, Any]) -> list[dict[str, Any]]:
    return result["test_data"]["workflow"]["edges"]


def edge_between(result: dict[str, Any], source: str, target: str) -> dict[str, Any]:
    matches = [
        edge for edge in all_edges(result) if edge["source"] == source and edge["target"] == target
    ]
    assert len(matches) == 1, f"expected one edge {source}->{target}, got {matches!r}"
    return matches[0]


class TestRecipeKeyStamping:
    def test_every_node_carries_a_unique_non_empty_recipe_key(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP, LOG_STEP]))
        keys = [node["data"]["recipeKey"] for node in nodes_of(result)]
        assert all(isinstance(key, str) and key for key in keys)
        assert len(set(keys)) == len(keys)

    def test_recipe_keys_are_stable_across_compiles(self) -> None:
        text = make_recipe([LOG_STEP, LOG_STEP])
        first = compile_clean(text)
        second = compile_clean(text)
        first_keys = [node["data"]["recipeKey"] for node in nodes_of(first)]
        second_keys = [node["data"]["recipeKey"] for node in nodes_of(second)]
        assert first_keys == second_keys

    def test_recipe_key_is_data_scoped_not_a_top_level_node_field(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP]))
        node = nodes_of(result)[0]
        assert "recipeKey" not in node
        assert node["data"]["recipeKey"]


class TestRecipeKeyIdentity:
    def test_explicit_key_sibling_becomes_the_recipe_key(self) -> None:
        result = compile_clean(
            make_recipe(
                [
                    {"block": "log", "key": "k-alpha", "settings": {"message": "x"}},
                    LOG_STEP,
                ]
            )
        )
        nodes = nodes_of(result)
        assert nodes[0]["data"]["recipeKey"] == "k-alpha"

    def test_keyless_step_gets_a_fresh_key_distinct_from_keyed_siblings(self) -> None:
        result = compile_clean(
            make_recipe(
                [
                    {"block": "log", "key": "k-alpha", "settings": {"message": "x"}},
                    LOG_STEP,
                ]
            )
        )
        keyless = nodes_of(result)[1]["data"]["recipeKey"]
        assert keyless
        assert keyless != "k-alpha"


class TestKeyedRelayout:
    def _v1(self) -> dict[str, Any]:
        return compile_clean(
            make_recipe(
                [
                    {"block": "log", "key": "k-a", "settings": {"message": "a"}},
                    {"block": "log", "key": "k-b", "settings": {"message": "b"}},
                ]
            )
        )

    def _v2(self) -> dict[str, Any]:
        return compile_clean(
            make_recipe(
                [
                    {"block": "log", "settings": {"message": "new"}},
                    {"block": "log", "key": "k-a", "settings": {"message": "a"}},
                    {"block": "log", "key": "k-b", "settings": {"message": "b"}},
                ]
            )
        )

    def test_a_dragged_keyed_block_keeps_its_column_and_moves_down_as_far_as_the_flow_grew(
        self,
    ) -> None:
        from wavecore.core.layout.revision import carry_canvas_state
        from wavecore.core.recipes.amend import key_anchors

        stored = copy.deepcopy(self._v1()["test_data"]["workflow"])
        # A person drags the k-b node beside the flow, above its row.
        for node in stored["nodes"]:
            if node["data"]["recipeKey"] == "k-b":
                node["position"] = {"x": 999.0, "y": -7.0}

        v2 = self._v2()
        revised = copy.deepcopy(v2["test_data"]["workflow"])
        carry_canvas_state(stored, revised, key_anchors(stored, revised, v2["step_map"]))

        by_key = {node["data"]["recipeKey"]: node["position"] for node in revised["nodes"]}
        new_key = next(key for key in by_key if key not in ("k-a", "k-b"))
        assert by_key == {
            new_key: {"x": -80, "y": 140},
            "k-a": {"x": -80, "y": 280},
            "k-b": {"x": 999, "y": 133},
        }


def log_step(label: str, message: str | None = None) -> dict[str, Any]:
    return {"block": "log", "label": label, "settings": {"message": message or label.lower()}}


RELEASE_BODY = [log_step("API health check"), log_step("Verify API health")]
PING_STEP = log_step("Ping app server")


def release_recipe(body: list[dict[str, Any]], name: str = "Release Smoke Check") -> str:
    """An If/Else whose then-branch holds a Remote Execution running `body`."""
    remote = {"remote": {"settings": {"session_id": {"expr": "ssh_session"}}, "body": body}}
    halt = {"halt": {"scope": "test", "status": "failed", "message": "service down"}}
    flow = [
        log_step("Connect to app server"),
        log_step("Check orders-api service"),
        {"if": {"when": "svc_ok", "then": [remote], "else": [log_step("Alert on-call"), halt]}},
        log_step("Query release DB"),
        log_step("Verify release"),
        log_step("Disconnect"),
    ]
    variables = {
        "svc_ok": {"type": "boolean", "value": True},
        "ssh_session": {"type": "string", "value": "session"},
    }
    return make_recipe(flow, name=name, variables=variables)


def positions_by_label(workflow: dict[str, Any]) -> dict[str, dict[str, float]]:
    return {node["data"]["label"]: node["position"] for node in workflow["nodes"]}


def overlapping_pairs(workflow: dict[str, Any]) -> list[tuple[str, str]]:
    """Every pair of Blocks whose boxes, at the canvas's own sizes, overlap."""
    from wavecore.core.layout.dimensions import estimate_node_size
    from wavecore.core.layout.engine import ingress_counts

    ingress = ingress_counts(workflow["edges"])
    boxes = []
    for node in workflow["nodes"]:
        width, height = estimate_node_size(node, ingress.get(node["id"], 0))
        boxes.append(
            (node["data"]["label"], node["position"]["x"], node["position"]["y"], width, height)
        )
    return [
        (first[0], second[0])
        for index, first in enumerate(boxes)
        for second in boxes[index + 1 :]
        if first[1] < second[1] + second[3]
        and second[1] < first[1] + first[3]
        and first[2] < second[2] + second[4]
        and second[2] < first[2] + first[4]
    ]


class TestRecompileCarriesGeometry:
    """An amend recompiles the whole recipe; the stored geometry rides on each Block itself."""

    def test_a_fresh_compile_of_the_nested_flow_overlaps_nothing(self) -> None:
        workflow = compile_clean(release_recipe(RELEASE_BODY))["test_data"]["workflow"]
        assert overlapping_pairs(workflow) == []

    def test_a_step_inserted_first_in_a_nested_body_moves_only_the_blocks_below_it(self) -> None:
        # The Remote's continuation runs beside its body, so only the body moves down.
        from wavecore.core.layout.revision import carry_canvas_state

        before = compile_clean(release_recipe(RELEASE_BODY))["test_data"]["workflow"]
        after = compile_clean(release_recipe([PING_STEP, *RELEASE_BODY]))["test_data"]["workflow"]
        carry_canvas_state(before, after)
        assert positions_by_label(after) == {
            "Connect to app server": {"x": -134, "y": 140},
            "Check orders-api service": {"x": -149, "y": 280},
            "If/Else": {"x": -80, "y": 420},
            "Remote Execution": {"x": -269, "y": 560},
            "Ping app server": {"x": -584, "y": 700},
            "API health check": {"x": -589, "y": 840},
            "Verify API health": {"x": -594, "y": 980},
            "Alert on-call": {"x": 386, "y": 560},
            "Halt": {"x": 400, "y": 700},
            "Query release DB": {"x": -269, "y": 700},
            "Verify release": {"x": -259, "y": 840},
            "Disconnect": {"x": -240, "y": 980},
        }
        assert overlapping_pairs(after) == []


class TestAChangeReadsInFlowOrder:
    def test_the_storyboard_reads_in_order_after_each_step(self) -> None:
        from wavecore.core.recipes.amend import revise

        seed_profiles()
        stored = compile_clean(step_recipe(1))["test_data"]["workflow"]
        for step in (2, 3):
            result = compile_clean(step_recipe(step))
            revised = copy.deepcopy(result["test_data"]["workflow"])

            revise(stored, revised, result["step_map"])

            assert positions_by_label(revised) == STEPS[step], step
            assert flow_order_findings(revised) == [], step
            stored = revised


class TestRejoinPreservation:
    def _compile_three_branch_if(self) -> dict[str, Any]:
        flow = [
            {
                "if": {
                    "when": "x == 1",
                    "then": [LOG_STEP],
                    "elif": [{"when": "x == 2", "then": [LOG_STEP]}],
                    "else": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        variables = {"x": {"type": "integer", "value": 1}}
        return compile_clean(make_recipe(flow, variables=variables))

    def test_rejoin_edges_survive_and_every_node_is_keyed_for_amend(self) -> None:
        result = self._compile_three_branch_if()
        assert edge_between(result, "node-2", "node-5").get("targetHandle") is None
        assert edge_between(result, "node-3", "node-5")["targetHandle"] == "ingress_1"
        assert edge_between(result, "node-4", "node-5")["targetHandle"] == "ingress_2"
        # Amend re-pins keyed nodes on recompile, so each must carry a recipeKey.
        for node in nodes_of(result):
            assert node["data"]["recipeKey"]


def _field_loss_workflow() -> dict[str, Any]:
    """A For holding a stored value no recipe key writes: a setting the format cannot express."""
    return {
        "nodes": [
            {
                "id": "loop-1",
                "type": "workflowNode",
                "position": {"x": 100, "y": 100},
                "data": {
                    "label": "Count",
                    "elementType": "for",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"mode": "count", "count": 2, "shade": "red"}},
                },
            }
        ],
        "edges": [{"id": "edge-start-loop-1", "source": "start-node", "target": "loop-1"}],
    }


class TestAmendRefusesAFieldLoss:
    """A Test holding an inexpressible setting is never amended (REQ-5.2.7.6)."""

    def test_amending_a_test_that_holds_a_field_loss_is_refused_with_the_problem_text(
        self,
    ) -> None:
        from tests.mcp.test_tools_author import _write_test_with_workflow
        from wavecore.api.services.tests import service as test_service
        from wavecore.mcp.tools import author

        test_id = _write_test_with_workflow("Amend Field Loss", _field_loss_workflow())
        readback = author.get_test_recipe(test_id)
        assert readback["inexpressible"] == [
            {"what": "setting 'shade' of block 'Count'", "where": "loop-1"}
        ]

        result = author.amend_test_from_recipe(
            test_id, make_recipe([LOG_STEP], name="Amend Field Loss")
        )

        assert result == {
            "amended": False,
            "findings": [
                {
                    "step": "test",
                    "code": "TARGET_NOT_RECIPE_EXPRESSIBLE",
                    "severity": "error",
                    "problem": (
                        "The target test holds wiring or settings the recipe format cannot "
                        "express; amending it through a recipe would drop them."
                    ),
                    "fix": (
                        "Edit this test directly in the workbench. Recipe amendment is "
                        "available only for tests that round-trip fully."
                    ),
                }
            ],
        }
        stored = test_service.get_test(test_id)
        assert stored is not None
        assert stored["version"] == "1.0.0"


def revise(before: str, after: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
    """The stored workflow, its revision carrying the stored geometry and ids, and the step map."""
    from wavecore.core.recipes.amend import revise as revise_fn

    stored = compile_clean(before)["test_data"]["workflow"]
    result = compile_clean(after)
    revised = result["test_data"]["workflow"]
    step_map = revise_fn(stored, revised, result["step_map"])
    return stored, revised, step_map


def ids_by_label(workflow: dict[str, Any]) -> dict[str, str]:
    return {node["data"]["label"]: node["id"] for node in workflow["nodes"]}


def every_block(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    """Every Block at every depth, the Blocks of local Function bodies included."""
    from wavecore.core.functions.references import iter_blocks

    return list(iter_blocks(workflow))


def every_workflow(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    from wavecore.core.functions.references import nested_function_workflows

    nested = [inner for node in every_block(workflow) for inner in nested_function_workflows(node)]
    return [workflow, *nested]


def logs(*labels: str) -> list[dict[str, Any]]:
    return [log_step(label) for label in labels]


class TestAmendKeepsEachBlocksId:
    """A Block the amendment recognizes keeps its id."""

    def test_the_blocks_after_an_inserted_one_keep_their_ids(self) -> None:
        stored, revised, _ = revise(
            make_recipe(logs("Alpha", "Bravo")), make_recipe(logs("Inserted", "Alpha", "Bravo"))
        )

        before, after = ids_by_label(stored), ids_by_label(revised)
        assert after["Alpha"] == before["Alpha"]
        assert after["Bravo"] == before["Bravo"]
        assert after["Inserted"] not in before.values()

    def test_a_new_block_never_takes_the_id_of_a_removed_one(self) -> None:
        stored, revised, _ = revise(
            make_recipe(logs("Alpha", "Removed", "Bravo")),
            make_recipe(logs("Alpha", "Bravo", "Added")),
        )

        before, after = ids_by_label(stored), ids_by_label(revised)
        assert after["Bravo"] == before["Bravo"]
        assert after["Added"] not in before.values()
        assert len(set(after.values())) == len(after)

    def test_every_wire_joins_the_blocks_it_joined_under_the_ids_they_hold_now(self) -> None:
        from wavecore.core.recipes.compiler import wire_id

        after = make_recipe(logs("Inserted", "Alpha", "Bravo"))
        compiled = compile_clean(after)["test_data"]["workflow"]
        _, revised, _ = revise(make_recipe(logs("Alpha", "Bravo")), after)

        def joins(workflow: dict[str, Any]) -> list[tuple[str, str]]:
            label = {node["id"]: node["data"]["label"] for node in workflow["nodes"]}
            label["start-node"] = "start"
            return [(label[edge["source"]], label[edge["target"]]) for edge in workflow["edges"]]

        assert joins(revised) == joins(compiled)
        for edge in revised["edges"]:
            assert edge["id"] == wire_id(
                edge["source"], edge.get("sourceHandle"), edge["target"], edge.get("targetHandle")
            )
        assert len({edge["id"] for edge in revised["edges"]}) == len(revised["edges"])

    def test_a_break_keeps_pointing_at_its_loop(self) -> None:
        loop = {"for": {"count": 2, "body": [{"break": {}}]}}
        stored, revised, _ = revise(
            make_recipe([log_step("Alpha"), loop]),
            make_recipe([log_step("Inserted"), log_step("Alpha"), loop]),
        )

        before, after = ids_by_label(stored), ids_by_label(revised)
        loop_id = next(
            node["id"] for node in revised["nodes"] if node["data"]["elementType"] == "for"
        )
        breaker = next(node for node in revised["nodes"] if node["data"]["elementType"] == "break")
        assert loop_id in before.values()
        assert breaker["data"]["config"]["values"]["target_loop"] == loop_id
        assert after["Alpha"] == before["Alpha"]

    def test_an_unchanged_local_function_body_keeps_its_blocks_and_their_ids(self) -> None:
        functions = [{"name": "probe", "inputs": [], "outputs": [], "flow": [LOG_STEP]}]
        stored, revised, _ = revise(
            make_recipe([{"function": "probe"}], functions=functions),
            make_recipe([log_step("Inserted"), {"function": "probe"}], functions=functions),
        )

        def body(workflow: dict[str, Any]) -> dict[str, Any]:
            node = next(node for node in workflow["nodes"] if "localDefinition" in node["data"])
            return dict(node["data"]["localDefinition"])

        assert body(revised) == body(stored)
        ids = [node["id"] for node in every_block(revised)]
        assert len(set(ids)) == len(ids)

    def test_no_two_blocks_share_an_id_at_any_depth(self) -> None:
        functions = [{"name": "probe", "inputs": [], "outputs": [], "flow": logs("One", "Two")}]
        stored, revised, _ = revise(
            make_recipe([log_step("Alpha"), {"function": "probe"}], functions=functions),
            make_recipe(
                [*logs("New One", "New Two"), log_step("Alpha"), {"function": "probe"}],
                functions=functions,
            ),
        )

        stored_ids = {node["id"] for node in every_block(stored)}
        revised_blocks = every_block(revised)
        ids = [node["id"] for node in revised_blocks]
        assert len(set(ids)) == len(ids)
        new = [node["id"] for node in revised_blocks if node["data"]["label"].startswith("New")]
        assert not stored_ids & set(new)
        for workflow in every_workflow(revised):
            held = {node["id"] for node in workflow["nodes"]} | {"start-node"}
            for edge in workflow["edges"]:
                assert {edge["source"], edge["target"]} <= held

    def test_the_step_map_names_each_block_by_the_id_it_holds_now(self) -> None:
        _, revised, step_map = revise(
            make_recipe(logs("Alpha", "Bravo")), make_recipe(logs("Inserted", "Alpha", "Bravo"))
        )

        steps = {node["data"]["label"]: step_map[node["id"]] for node in revised["nodes"]}
        assert steps == {"Inserted": "flow[0]", "Alpha": "flow[1]", "Bravo": "flow[2]"}


PROBE_FUNCTIONS = [{"name": "probe", "inputs": [], "outputs": [], "flow": logs("One", "Two")}]
MASKING = {"secret_masking": "mask", "unmasked_secret_fields": ["auth_token"]}


def body_of(workflow: dict[str, Any]) -> dict[str, Any]:
    """The workflow of the test's local Function body."""
    node = next(node for node in workflow["nodes"] if "localDefinition" in node["data"])
    body: dict[str, Any] = node["data"]["localDefinition"]["workflow"]
    return body


def revise_body(adjust: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    """The revised body after a Block goes in before the Function."""
    from wavecore.core.recipes.amend import revise as revise_fn

    stored = compile_clean(make_recipe([{"function": "probe"}], functions=PROBE_FUNCTIONS))
    adjust(body_of(stored["test_data"]["workflow"])["nodes"][0])
    result = compile_clean(
        make_recipe([log_step("Inserted"), {"function": "probe"}], functions=PROBE_FUNCTIONS)
    )
    revised = result["test_data"]["workflow"]
    revise_fn(stored["test_data"]["workflow"], revised, result["step_map"])
    return body_of(revised)


class TestAmendCarriesTheCanvasIntoLocalBodies:
    """A recognized Block inside a local Function body keeps what a person set on the canvas."""

    def test_a_block_in_a_local_body_keeps_how_it_masks_and_its_open_description(self) -> None:
        def set_on_the_canvas(node: dict[str, Any]) -> None:
            node["data"]["config"].update(copy.deepcopy(MASKING))
            node["data"]["descriptionExpanded"] = True

        one, two = revise_body(set_on_the_canvas)["nodes"]

        assert {key: one["data"]["config"].get(key) for key in MASKING} == MASKING
        assert one["data"].get("descriptionExpanded") is True
        assert set(two["data"]["config"]) == {"values", "outputBindings", "profileBindings"}

    def test_a_block_in_a_local_body_keeps_the_place_a_person_dragged_it_to(self) -> None:
        def drag(node: dict[str, Any]) -> None:
            node["position"] = {"x": 400, "y": 700}

        one, _ = revise_body(drag)["nodes"]

        assert one["position"] == {"x": 400, "y": 700}


def canvas_test(*nodes: dict[str, Any], wired: int | None = None) -> dict[str, Any]:
    """A test of Log Blocks as the canvas saves them, the first ``wired`` joined in a chain."""
    ids = ["start-node", *(node["id"] for node in nodes)][: (wired or len(nodes)) + 1]
    edges = [
        {"id": f"edge-{source}-{target}", "source": source, "target": target}
        for source, target in zip(ids, ids[1:], strict=False)
    ]
    return {"workflow": {"nodes": list(nodes), "edges": edges}, "variables": {}}


def canvas_log(node_id: str, label: str, level: str = "INFO") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 3.3142364582105586, "y": 305.0396283985281},
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"level": level, "message": label.lower()},
                "outputBindings": {},
                "profileBindings": [],
                "unmasked_secret_fields": [],
                "secret_masking": "system",
            },
            "expressionFields": [],
            "templateFields": [],
        },
    }


class TestReadbackForm:
    """A test's readback form is its recipe readback compiled, under the ids its Blocks hold."""

    def test_a_block_saved_from_the_canvas_reads_back_as_the_compiler_writes_it(self) -> None:
        from wavecore.core.recipes.amend import readback_form

        form = readback_form(canvas_test(canvas_log("node-1793680720412-gsc0l7g", "Alpha")))

        assert form is not None
        (node,) = form["workflow"]["nodes"]
        compiled = compile_clean(make_recipe([log_step("Alpha")]))["test_data"]["workflow"]
        written = compiled["nodes"][0]["data"]
        # The settings a person set on the canvas stay with the Block.
        written["config"].update(unmasked_secret_fields=[], secret_masking="system")
        assert node["id"] == "node-1793680720412-gsc0l7g"
        assert node["data"] == written

    def test_a_test_whose_readback_leaves_something_out_has_none(self) -> None:
        from wavecore.core.recipes.amend import readback_form
        from wavecore.core.recipes.decompiler import decompile_test_data

        orphaned = canvas_test(
            canvas_log("node-a", "Alpha"), canvas_log("node-b", "Bravo"), wired=1
        )

        assert decompile_test_data(orphaned)["expressible"] is False
        assert readback_form(orphaned) is None

    def test_a_test_whose_readback_does_not_compile_has_none(self) -> None:
        from wavecore.core.recipes.amend import readback_form
        from wavecore.core.recipes.decompiler import decompile_test_data

        unknown_level = canvas_test(canvas_log("node-a", "Alpha", level="LOUD"))

        assert decompile_test_data(unknown_level)["expressible"] is True
        assert readback_form(unknown_level) is None


FOUR_LINE_NOTE = "one\ntwo\nthree\nfour"
# REQ-5.2.7.4: four lines x 22.75 + 18 + 33 px, rounded up.
FOUR_LINE_NOTE_HEIGHT = 142


def note_flow(*tail: dict[str, Any]) -> str:
    return make_recipe([log_step("Alpha"), {"note": FOUR_LINE_NOTE}, log_step("Bravo"), *tail])


def note_of(workflow: dict[str, Any]) -> dict[str, Any]:
    (note,) = [node for node in workflow["nodes"] if node["data"]["elementType"] == "note"]
    return note


def label_node(workflow: dict[str, Any], label: str) -> dict[str, Any]:
    (node,) = [node for node in workflow["nodes"] if node["data"]["label"] == label]
    return node


class TestAmendSizesNotes:
    """An amend keeps Note sizes and moves a Block a Note crowds (REQ-5.2.7.4)."""

    def _revise(self, adjust: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        from wavecore.core.recipes.amend import revise as revise_fn

        stored = compile_clean(note_flow())["test_data"]["workflow"]
        adjust(stored)
        result = compile_clean(note_flow(log_step("Charlie")))
        revised = result["test_data"]["workflow"]
        revise_fn(stored, revised, result["step_map"])
        return revised

    def test_a_note_resized_to_160_keeps_its_size(self) -> None:
        revised = self._revise(lambda stored: note_of(stored).update(width=160, height=150))

        assert (note_of(revised).get("width"), note_of(revised).get("height")) == (160, 150)

    def test_a_note_resized_to_300_by_200_keeps_its_size(self) -> None:
        revised = self._revise(lambda stored: note_of(stored).update(width=300, height=200))

        assert (note_of(revised).get("width"), note_of(revised).get("height")) == (300, 200)

    def test_a_block_a_note_crowds_moves_below_it(self) -> None:
        def crowd(stored: dict[str, Any]) -> None:
            note_y = note_of(stored)["position"]["y"]
            bravo = label_node(stored, "Bravo")
            bravo["position"] = {"x": bravo["position"]["x"], "y": note_y + 140}

        revised = self._revise(crowd)

        note_bottom = note_of(revised)["position"]["y"] + FOUR_LINE_NOTE_HEIGHT
        assert label_node(revised, "Bravo")["position"]["y"] - note_bottom >= 32

    def test_a_block_below_a_tall_resized_note_moves_below_it(self) -> None:
        def resize(stored: dict[str, Any]) -> None:
            note_of(stored).update(width=300, height=400)

        revised = self._revise(resize)

        note_bottom = note_of(revised)["position"]["y"] + 400
        assert label_node(revised, "Bravo")["position"]["y"] - note_bottom >= 32
