"""A Note keeps its place: in the flow, wired like any Block the run passes through, or beside
the flow in `notes:` with no connection at all (REQ-5.2.7.3, REQ-5.2.7.6)."""

from typing import Any

import pytest
import yaml

from tests.core.recipes.conftest import LOG_STEP, dump_recipe, make_recipe
from tests.core.recipes.test_decompiler import (
    assert_round_trip,
    compile_clean,
    compile_recipe,
    control_node,
    decompile,
    log_node,
    make_edge,
    make_test_data,
    readback_of,
)
from tests.core.recipes.test_validator import validate

FIRST_LOG: dict[str, Any] = {"block": "log", "settings": {"message": "first", "level": "INFO"}}
SECOND_LOG: dict[str, Any] = {"block": "log", "settings": {"message": "second", "level": "INFO"}}
X_VARIABLE: dict[str, Any] = {"x": {"type": "integer", "value": 1}}
NOTES_ITEM_FIX = "Write it as '- note: ...', or move it into flow"


def note_node(node_id: str, text: str, color: str = "slate") -> dict[str, Any]:
    """A Note as the canvas stores it."""
    node = control_node(node_id, "note", "Note", text=text, color=color)
    node["type"] = "noteNode"
    return node


def edge_set(workflow: dict[str, Any]) -> set[tuple[str, str, str | None, str | None]]:
    return {
        (edge["source"], edge["target"], edge.get("sourceHandle"), edge.get("targetHandle"))
        for edge in workflow["edges"]
    }


def nodes_of(workflow: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {node["id"]: node for node in workflow["nodes"]}


def local_workflow(test_data: dict[str, Any]) -> dict[str, Any]:
    """The workflow of the one local Function the test holds."""
    (function_node,) = [
        node for node in test_data["workflow"]["nodes"] if node["data"]["elementType"] == "function"
    ]
    workflow: dict[str, Any] = function_node["data"]["localDefinition"]["workflow"]
    return workflow


def parse(text: str) -> tuple[Any, list[dict[str, Any]]]:
    from wavecore.core.recipes.parser import parse_recipe

    return parse_recipe(text)


def error(step: str, code: str, problem: str, fix: str | None) -> dict[str, Any]:
    return {"step": step, "code": code, "severity": "error", "problem": problem, "fix": fix}


def helper(**entry: Any) -> dict[str, Any]:
    """A local Function entry named helper."""
    return {"name": "helper", "flow": [LOG_STEP], **entry}


class TestHandWiredNote:
    """A Note a person wires between two Blocks reads back at its place and amends clean."""

    def test_a_note_wired_between_two_blocks_reads_back_at_its_place(self) -> None:
        nodes = [
            log_node("log-1", message="first", level="INFO"),
            note_node("note-1", "Add the login here", "yellow"),
            log_node("log-2", message="second", level="INFO"),
        ]
        edges = [
            make_edge("start-node", "log-1"),
            make_edge("log-1", "note-1"),
            make_edge("note-1", "log-2"),
        ]

        readback = readback_of(nodes, edges)

        assert readback["inexpressible"] == []
        assert readback["expressible"] is True
        recipe = yaml.safe_load(readback["recipe"])
        assert recipe["flow"] == [
            FIRST_LOG,
            {"note": {"text": "Add the login here", "color": "yellow"}},
            SECOND_LOG,
        ]
        assert "notes" not in recipe
        again = compile_clean(readback["recipe"])["test_data"]
        assert [node["type"] for node in again["workflow"]["nodes"]] == [
            "workflowNode",
            "noteNode",
            "workflowNode",
        ]
        assert edge_set(again["workflow"]) == {
            ("start-node", "node-1", None, None),
            ("node-1", "node-2", None, None),
            ("node-2", "node-3", None, None),
        }

    def test_a_note_with_no_connection_reads_back_beside_the_flow(self) -> None:
        nodes = [log_node("log-1", message="first", level="INFO"), note_node("note-1", "hi")]

        readback = readback_of(nodes, [make_edge("start-node", "log-1")])

        assert readback["inexpressible"] == []
        recipe = yaml.safe_load(readback["recipe"])
        assert recipe["flow"] == [FIRST_LOG]
        assert recipe["notes"] == [{"note": {"text": "hi", "color": "slate"}}]

    def test_a_connected_note_the_start_never_reaches_is_reported(self) -> None:
        nodes = [
            log_node("log-1", message="first", level="INFO"),
            note_node("note-1", "Orphan"),
            log_node("log-2", message="second", level="INFO"),
        ]
        edges = [make_edge("start-node", "log-1"), make_edge("note-1", "log-2")]

        readback = readback_of(nodes, edges)

        assert readback["expressible"] is False
        assert readback["inexpressible"] == [
            {"what": "unreachable block 'Note'", "where": "note-1"},
            {"what": "unreachable block 'Log'", "where": "log-2"},
        ]
        recipe = yaml.safe_load(readback["recipe"])
        assert recipe["flow"] == [FIRST_LOG]
        assert "notes" not in recipe

    def test_a_note_setting_and_mode_with_no_recipe_form_are_reported(self) -> None:
        note = note_node("note-1", "Check", "green")
        note["data"]["config"]["values"]["font"] = "large"
        note["data"]["expressionFields"] = ["text"]
        edges = [make_edge("start-node", "note-1")]

        readback = readback_of([note], edges)

        assert readback["inexpressible"] == [
            {"what": "setting 'font' of block 'Note'", "where": "note-1"},
            {"what": "the expression mode of 'text' in block 'Note'", "where": "note-1"},
        ]
        assert yaml.safe_load(readback["recipe"])["flow"] == [
            {"note": {"text": "Check", "color": "green"}}
        ]

    def test_a_note_description_and_disabled_mark_with_no_recipe_form_are_reported(self) -> None:
        note = note_node("note-1", "Check", "green")
        note["data"]["description"] = "Why this waits"
        note["data"]["disabled"] = True
        edges = [make_edge("start-node", "note-1")]

        readback = readback_of([note], edges)

        assert readback["inexpressible"] == [
            {"what": "the description of block 'Note'", "where": "note-1"},
            {"what": "the disabled mark of block 'Note'", "where": "note-1"},
        ]
        assert yaml.safe_load(readback["recipe"])["flow"] == [
            {"note": {"text": "Check", "color": "green"}}
        ]


class TestNoteInTheFlow:
    """A note step stands in the flow at its place, wired in and out as a Delay is."""

    def test_a_note_step_is_wired_between_its_neighbors(self) -> None:
        flow = [LOG_STEP, {"note": {"text": "Login goes here", "color": "yellow"}}, LOG_STEP]

        workflow = compile_clean(make_recipe(flow))["test_data"]["workflow"]

        note = nodes_of(workflow)["node-2"]
        assert note["type"] == "noteNode"
        assert note["data"]["elementType"] == "note"
        assert note["data"]["config"]["values"] == {"text": "Login goes here", "color": "yellow"}
        assert workflow["edges"] == [
            {"id": "edge-start-node-node-1", "source": "start-node", "target": "node-1"},
            {"id": "edge-node-1-node-2", "source": "node-1", "target": "node-2"},
            {"id": "edge-node-2-node-3", "source": "node-2", "target": "node-3"},
        ]

    def test_a_note_shorthand_keeps_its_label_and_key_in_the_flow(self) -> None:
        flow = [{"note": "TODO: add the login", "label": "Login", "key": "login"}, LOG_STEP]

        result = compile_clean(make_recipe(flow))

        workflow = result["test_data"]["workflow"]
        data = nodes_of(workflow)["node-1"]["data"]
        assert data["config"]["values"] == {"text": "TODO: add the login", "color": "slate"}
        assert data["label"] == "Login"
        assert data["recipeKey"] == "login"
        assert result["step_map"]["node-1"] == "flow[0]"
        assert edge_set(workflow) == {
            ("start-node", "node-1", None, None),
            ("node-1", "node-2", None, None),
        }

    def test_a_note_in_a_loop_body_is_wired_there(self) -> None:
        flow = [{"for": {"count": 2, "body": [LOG_STEP, {"note": "Later"}, LOG_STEP]}}, LOG_STEP]

        workflow = compile_clean(make_recipe(flow))["test_data"]["workflow"]

        assert nodes_of(workflow)["node-3"]["type"] == "noteNode"
        assert edge_set(workflow) == {
            ("start-node", "node-1", None, None),
            ("node-1", "node-2", "body", None),
            ("node-2", "node-3", None, None),
            ("node-3", "node-4", None, None),
            ("node-1", "node-5", "then", None),
        }

    def test_a_note_in_an_if_branch_is_wired_there(self) -> None:
        flow = [{"if": {"when": "x == 1", "then": [{"note": "Placeholder"}]}}, LOG_STEP]

        workflow = compile_clean(make_recipe(flow, variables=X_VARIABLE))["test_data"]["workflow"]

        assert nodes_of(workflow)["node-2"]["type"] == "noteNode"
        assert edge_set(workflow) == {
            ("start-node", "node-1", None, None),
            ("node-1", "node-2", "branch_0", None),
            ("node-2", "node-3", None, None),
            ("node-1", "node-3", "branch_1", "ingress_1"),
        }

    @pytest.mark.parametrize(
        "construct",
        [
            pytest.param({"if": {"when": "x == 1", "then": [LOG_STEP]}}, id="if"),
            pytest.param(
                {"assert": {"that": ["x == 1"], "on_pass": [LOG_STEP], "on_fail": [LOG_STEP]}},
                id="assert-split",
            ),
        ],
    )
    def test_a_note_where_paths_join_takes_each_path_in_as_a_delay_does(
        self, construct: dict[str, Any]
    ) -> None:
        def wiring(step: dict[str, Any]) -> tuple[set[tuple[Any, ...]], str]:
            recipe = make_recipe([construct, step, LOG_STEP], variables=X_VARIABLE)
            workflow = compile_clean(recipe)["test_data"]["workflow"]
            (join,) = [
                node["id"]
                for node in workflow["nodes"]
                if node["data"]["elementType"] in ("note", "delay")
            ]
            return edge_set(workflow), nodes_of(workflow)[join]["type"]

        note_edges, note_type = wiring({"note": "The report goes here"})
        delay_edges, delay_type = wiring({"delay": 1})

        assert (note_type, delay_type) == ("noteNode", "workflowNode")
        assert note_edges == delay_edges
        assert sum(1 for edge in note_edges if edge[3] == "ingress_1") == 1

    def test_a_note_in_a_local_function_flow_is_wired_there(self) -> None:
        functions = [helper(flow=[LOG_STEP, {"note": "Check here"}, LOG_STEP])]

        test_data = compile_clean(make_recipe([{"function": "helper"}], functions=functions))[
            "test_data"
        ]

        inner = local_workflow(test_data)
        assert nodes_of(inner)["node-3"]["type"] == "noteNode"
        assert edge_set(inner) == {
            ("start-node", "node-2", None, None),
            ("node-2", "node-3", None, None),
            ("node-3", "node-4", None, None),
        }

    @pytest.mark.parametrize(
        ("flow", "functions", "step"),
        [
            pytest.param([LOG_STEP, {"halt": {}}, {"note": "After"}], None, "flow[2]", id="test"),
            pytest.param(
                [{"function": "helper"}],
                [helper(flow=[{"halt": {}}, {"note": "After"}])],
                "functions[helper].flow[1]",
                id="local-function",
            ),
            pytest.param(
                [{"function": "helper"}, {"function": "helper"}],
                [helper(flow=[{"halt": {}}, {"note": "After"}])],
                "functions[helper].flow[1]",
                id="local-function-used-twice",
            ),
        ],
    )
    def test_a_note_after_a_halt_is_unreachable(
        self, flow: list[Any], functions: list[dict[str, Any]] | None, step: str
    ) -> None:
        result = compile_recipe(make_recipe(flow, functions=functions))

        assert result["test_data"] is None
        assert result["findings"] == [
            error(
                step,
                "UNREACHABLE_BLOCK",
                "Compiled block is unreachable from the start of the flow",
                None,
            )
        ]

    def test_a_block_after_a_halt_in_a_local_function_is_unreachable(self) -> None:
        functions = [helper(flow=[{"halt": {}}, LOG_STEP])]

        result = compile_recipe(make_recipe([{"function": "helper"}], functions=functions))

        assert result["test_data"] is None
        assert result["findings"] == [
            error(
                "functions[helper].flow[1]",
                "UNREACHABLE_BLOCK",
                "Compiled block is unreachable from the start of the flow",
                None,
            )
        ]


class TestNotesBesideTheFlow:
    """`notes:` holds the Notes nothing connects to, for the test and for a local Function."""

    def test_the_test_notes_compile_to_notes_with_no_edges(self) -> None:
        notes = [
            {"note": {"text": "About this test", "color": "blue"}, "label": "About"},
            {"note": "Ask the team", "key": "ask"},
        ]

        result = compile_clean(make_recipe([LOG_STEP], notes=notes))

        workflow = result["test_data"]["workflow"]
        nodes = nodes_of(workflow)
        assert [nodes[node_id]["type"] for node_id in ("node-2", "node-3")] == [
            "noteNode",
            "noteNode",
        ]
        assert nodes["node-2"]["data"]["label"] == "About"
        assert nodes["node-2"]["data"]["config"]["values"] == {
            "text": "About this test",
            "color": "blue",
        }
        assert nodes["node-3"]["data"]["config"]["values"] == {
            "text": "Ask the team",
            "color": "slate",
        }
        assert nodes["node-3"]["data"]["recipeKey"] == "ask"
        assert result["step_map"]["node-2"] == "notes[0]"
        assert result["step_map"]["node-3"] == "notes[1]"
        assert edge_set(workflow) == {("start-node", "node-1", None, None)}

    def test_a_function_notes_compile_to_notes_with_no_edges(self) -> None:
        functions = [helper(notes=[{"note": "Inside the helper"}])]

        result = compile_clean(make_recipe([{"function": "helper"}], functions=functions))

        inner = local_workflow(result["test_data"])
        assert nodes_of(inner)["node-3"]["type"] == "noteNode"
        assert result["step_map"]["node-3"] == "functions[helper].notes[0]"
        assert edge_set(inner) == {("start-node", "node-2", None, None)}

    @pytest.mark.parametrize(
        "item",
        [
            pytest.param(LOG_STEP, id="block"),
            pytest.param({"delay": 100}, id="delay"),
            pytest.param("Just text", id="not-a-step"),
            pytest.param({"note": "Both", "delay": 100}, id="two-keywords"),
        ],
    )
    def test_a_notes_item_that_is_not_a_note_step_is_refused(self, item: Any) -> None:
        doc, findings = parse(make_recipe([LOG_STEP], notes=[{"note": "Fine"}, item]))

        assert doc is None
        assert findings == [
            error(
                "notes[1]",
                "INVALID_CONSTRUCT",
                "'notes' construct is malformed: each item must be a note step",
                NOTES_ITEM_FIX,
            )
        ]

    def test_a_function_notes_item_that_is_not_a_note_step_is_refused(self) -> None:
        functions = [helper(notes=[{"set": {"x": 1}}])]

        doc, findings = parse(make_recipe([{"function": "helper"}], functions=functions))

        assert doc is None
        assert findings == [
            error(
                "functions[helper].notes[0]",
                "INVALID_CONSTRUCT",
                "'notes' construct is malformed: each item must be a note step",
                NOTES_ITEM_FIX,
            )
        ]

    @pytest.mark.parametrize(
        "parts",
        [
            pytest.param({"flow": [], "notes": []}, id="empty-notes"),
            pytest.param({"flow": []}, id="no-notes"),
            pytest.param({"notes": [{"note": "A"}]}, id="no-flow"),
        ],
    )
    def test_an_empty_flow_needs_a_note_beside_it(self, parts: dict[str, Any]) -> None:
        doc, findings = parse(dump_recipe({"test": {"name": "T"}, **parts}))

        assert doc is None
        assert findings == [
            error(
                "flow",
                "EMPTY_FLOW",
                "flow must be a non-empty list of steps",
                "Add at least one step to flow",
            )
        ]

    def test_notes_that_are_not_a_list_are_refused(self) -> None:
        text = dump_recipe({"test": {"name": "T"}, "flow": [LOG_STEP], "notes": "About"})

        doc, findings = parse(text)

        assert doc is None
        assert findings == [
            error(
                "notes",
                "INVALID_CONSTRUCT",
                "'notes' construct is malformed: must be a list of note steps",
                None,
            )
        ]

    def test_a_note_beside_the_flow_takes_only_its_label_and_key(self) -> None:
        doc, findings = parse(make_recipe([LOG_STEP], notes=[{"note": "x", "description": "y"}]))

        assert doc is None
        assert findings == [
            error(
                "notes[0]",
                "UNKNOWN_STEP_KEY",
                "Unknown key 'description' on a 'note' step",
                "Valid keys: key, label",
            )
        ]

    @pytest.mark.parametrize(
        ("functions", "notes", "step"),
        [
            pytest.param(None, [{"note": {"text": {"expr": "'hi'"}}}], "notes[0]", id="test"),
            pytest.param(
                [helper(notes=[{"note": {"text": {"expr": "'hi'"}}}])],
                None,
                "functions[helper].notes[0]",
                id="local-function",
            ),
        ],
    )
    def test_a_note_beside_the_flow_is_checked_as_a_note_step(
        self, functions: list[dict[str, Any]] | None, notes: list[Any] | None, step: str
    ) -> None:
        flow = [{"function": "helper"}] if functions else [LOG_STEP]

        findings = validate(make_recipe(flow, functions=functions, notes=notes))

        assert findings == [
            error(
                step,
                "INVALID_CONSTRUCT",
                "'note' step is malformed: a note holds plain text and takes no expression",
                None,
            )
        ]


LOG: dict[str, Any] = {"block": "log", "settings": {"message": "hello", "level": "INFO"}}
YELLOW_NOTE: dict[str, Any] = {"note": {"text": "Reviewed", "color": "yellow"}}
SLATE_NOTE: dict[str, Any] = {"note": {"text": "Placeholder", "color": "slate"}, "label": "Slot"}

ROUND_TRIPS = [
    pytest.param({"flow": [LOG, YELLOW_NOTE, LOG]}, id="flow"),
    pytest.param({"flow": [SLATE_NOTE]}, id="only-step"),
    pytest.param({"flow": [{"for": {"count": 2, "body": [LOG, SLATE_NOTE]}}, LOG]}, id="loop"),
    pytest.param(
        {
            "variables": X_VARIABLE,
            "flow": [{"if": {"when": "x == 1", "then": [SLATE_NOTE], "else": []}}, LOG],
        },
        id="if-branch",
    ),
    pytest.param({"flow": [LOG], "notes": [YELLOW_NOTE, SLATE_NOTE]}, id="test-notes"),
    pytest.param({"flow": [], "notes": [YELLOW_NOTE]}, id="only-notes"),
    pytest.param(
        {
            "variables": X_VARIABLE,
            "flow": [{"if": {"when": "x == 1", "then": [LOG], "else": []}}, YELLOW_NOTE, LOG],
        },
        id="where-paths-join",
    ),
    pytest.param(
        {
            "functions": [
                {
                    "name": "helper",
                    "inputs": [],
                    "outputs": [],
                    "flow": [LOG, SLATE_NOTE],
                    "notes": [YELLOW_NOTE],
                }
            ],
            "flow": [{"function": "helper"}, YELLOW_NOTE],
            "notes": [SLATE_NOTE],
        },
        id="function-notes",
    ),
]


class TestNoteRoundTrip:
    """Each Note reads back where it was, and the readback compiles to the same Test."""

    @pytest.mark.parametrize("parts", ROUND_TRIPS)
    def test_a_note_reads_back_where_it_was_written(self, parts: dict[str, Any]) -> None:
        written = {"test": {"name": "Noted"}, **parts}
        text = dump_recipe(written)

        readback = decompile(compile_clean(text)["test_data"])

        assert readback["inexpressible"] == []
        assert yaml.safe_load(readback["recipe"]) == written
        assert_round_trip(text)

    def test_a_local_function_graph_the_recipe_cannot_express_is_reported(self) -> None:
        test_data = compile_clean(make_recipe([{"function": "helper"}], functions=[helper()]))[
            "test_data"
        ]
        inner = local_workflow(test_data)
        inner["nodes"].extend([note_node("note-9", "Orphan"), log_node("log-9")])
        inner["edges"].append(make_edge("note-9", "log-9"))

        readback = decompile(test_data)

        assert readback["inexpressible"] == [
            {"what": "unreachable block 'Note'", "where": "note-9"},
            {"what": "unreachable block 'Log'", "where": "log-9"},
        ]

    def test_a_local_function_note_with_no_connection_reads_back_in_its_notes(self) -> None:
        test_data = compile_clean(make_recipe([{"function": "helper"}], functions=[helper()]))[
            "test_data"
        ]
        local_workflow(test_data)["nodes"].append(note_node("note-9", "Beside", "pink"))

        readback = decompile(test_data)

        assert readback["inexpressible"] == []
        (entry,) = yaml.safe_load(readback["recipe"])["functions"]
        assert entry["notes"] == [{"note": {"text": "Beside", "color": "pink"}}]

    def test_a_hand_built_test_with_only_a_note_reads_back_and_compiles_to_it(self) -> None:
        readback = readback_of([note_node("note-1", "TODO: write this test", "yellow")], [])

        assert readback["expressible"] is True
        assert readback["inexpressible"] == []
        assert yaml.safe_load(readback["recipe"]) == {
            "test": {"name": "Hand Built"},
            "flow": [],
            "notes": [{"note": {"text": "TODO: write this test", "color": "yellow"}}],
        }
        again = compile_clean(readback["recipe"])["test_data"]["workflow"]
        assert [node["type"] for node in again["nodes"]] == ["noteNode"]
        assert again["edges"] == []

    def test_a_hand_built_test_with_only_notes_beside_the_flow_keeps_them(self) -> None:
        test_data = make_test_data(
            [log_node("log-1", message="first", level="INFO"), note_node("note-1", "A")],
            [make_edge("start-node", "log-1")],
        )

        recipe = yaml.safe_load(decompile(test_data)["recipe"])

        assert list(recipe) == ["test", "flow", "notes"]
