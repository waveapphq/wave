"""Canvas -> recipe readback: per-construct round-trip, secret omission, inexpressibility
predicate and field-loss report.

Every test defers the decompiler import.
"""

from typing import Any

import pytest
import yaml

from tests.core.recipes.block_creation_values import (
    HTTP_CREATION_VALUES,
    OPENSEARCH_CREATION_VALUES,
    SQL_CREATION_VALUES,
)
from tests.core.recipes.conftest import (
    LOG_STEP,
    create_library_function,
    create_profile,
    make_recipe,
)

COMPARISON: dict[str, Any] = {
    "variable": "transport",
    "operator": "equals",
    "value": "TCP",
    "value_type": "string",
}

SWITCH_VARIABLES: dict[str, Any] = {
    "code": {"type": "integer", "value": 200},
    "transport": {"type": "string", "value": "TCP"},
}

WAIT_VARIABLES: dict[str, Any] = {
    "pod_phase": {"type": "string", "value": ""},
    "transport": {"type": "string", "value": "TCP"},
}

# A compiled block holds every choice value, so its readback writes them (REQ-5.2.7.6).
LOG_READBACK: dict[str, Any] = {"block": "log", "settings": {"message": "hello", "level": "INFO"}}


def with_creation_values(step: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    """A step as it reads back: its own settings over the values its block was created with."""
    return {**step, "settings": {**values, **step["settings"]}}


_VOLATILE_KEYS = ("recipeKey", "position")


def compile_recipe(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe as compile_fn

    return compile_fn(text)


def compile_clean(text: str) -> dict[str, Any]:
    result = compile_recipe(text)
    errors = [f for f in result["findings"] if f["severity"] == "error"]
    assert errors == [], f"expected a clean compile, got {errors!r}"
    assert result["test_data"] is not None
    return result


def decompile(test_data: dict[str, Any]) -> dict[str, Any]:
    from wavecore.core.recipes.decompiler import decompile_test_data

    return decompile_test_data(test_data)


def _scrub(value: Any) -> Any:
    """Drop non-structural keys (recipeKey, position) at any nesting depth."""
    if isinstance(value, dict):
        return {key: _scrub(inner) for key, inner in value.items() if key not in _VOLATILE_KEYS}
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


def _all_keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {key for inner in value.values() for key in _all_keys(inner)}
    if isinstance(value, list):
        return {key for item in value for key in _all_keys(item)}
    return set()


def _node_shapes(test_data: dict[str, Any]) -> list[tuple[str, Any]]:
    return [(node["type"], _scrub(node["data"])) for node in test_data["workflow"]["nodes"]]


def _edge_set(test_data: dict[str, Any]) -> set[tuple[str, str, str | None, str | None]]:
    return {
        (edge["source"], edge["target"], edge.get("sourceHandle"), edge.get("targetHandle"))
        for edge in test_data["workflow"]["edges"]
    }


def assert_round_trip(recipe_text: str) -> None:
    first = compile_clean(recipe_text)["test_data"]
    readback = decompile(first)
    recipe = readback["recipe"]
    assert isinstance(recipe, str) and recipe.strip(), f"expected recipe yaml, got {recipe!r}"
    second = compile_clean(recipe)["test_data"]
    assert _node_shapes(first) == _node_shapes(second)
    assert _edge_set(first) == _edge_set(second)


def make_node(
    node_id: str,
    *,
    element_type: str = "log",
    node_type: str = "plugin",
    version: str = "1.0.0",
    values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0.0, "y": 0.0},
        "data": {
            "label": element_type,
            "elementType": element_type,
            "nodeType": node_type,
            "version": version,
            "config": {
                "values": values or {},
                "outputBindings": {},
                "profileBindings": [],
            },
            "expressionFields": [],
            "templateFields": [],
        },
    }


def make_edge(
    source: str,
    target: str,
    *,
    source_handle: str | None = None,
    target_handle: str | None = None,
) -> dict[str, Any]:
    edge: dict[str, Any] = {"id": f"edge-{source}-{target}", "source": source, "target": target}
    if source_handle is not None:
        edge["sourceHandle"] = source_handle
    if target_handle is not None:
        edge["targetHandle"] = target_handle
    return edge


def make_test_data(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "name": "Hand Built",
        "description": "",
        "workflow": {"nodes": nodes, "edges": edges},
        "variables": {},
        "metadata": {"tags": []},
    }


def readback_flow(flow: list[Any], variables: dict[str, Any] | None = None) -> list[Any]:
    readback = decompile(compile_clean(make_recipe(flow, variables=variables))["test_data"])
    steps = yaml.safe_load(readback["recipe"])["flow"]
    assert isinstance(steps, list)
    return steps


def readback_switch(flow: list[Any], variables: dict[str, Any] | None = None) -> dict[str, Any]:
    value = readback_flow(flow, variables)[0]["switch"]
    assert isinstance(value, dict)
    return value


def assert_inexpressible(test_data: dict[str, Any]) -> None:
    readback = decompile(test_data)
    assert readback["expressible"] is False
    assert readback["inexpressible"], "expected at least one inexpressible item"
    for item in readback["inexpressible"]:
        assert "what" in item, f"item missing 'what': {item!r}"
        assert "where" in item, f"item missing 'where': {item!r}"


_X_VARIABLE: dict[str, Any] = {"x": {"type": "integer", "value": 1}}

LABELED_CONTROLS = [
    pytest.param([{"delay": 100, "label": "Wait a bit"}, LOG_STEP], {}, id="delay"),
    pytest.param([LOG_STEP, {"halt": {}, "label": "Stop here"}], {}, id="halt"),
    pytest.param(
        [{"set": {"counter": 1}, "label": "Count"}, LOG_STEP],
        {"counter": {"type": "integer", "value": 0}},
        id="set",
    ),
    pytest.param([LOG_STEP, {"note": {"text": "Reviewed"}, "label": "Remark"}], {}, id="note"),
    pytest.param(
        [{"for": {"count": 1, "body": [{"break": {}, "label": "Leave"}]}}, LOG_STEP],
        {},
        id="break",
    ),
    pytest.param(
        [{"for": {"count": 1, "body": [{"continue": {}, "label": "Next"}]}}, LOG_STEP],
        {},
        id="continue",
    ),
    pytest.param(
        [{"assert": {"label": "Check x", "that": ["x == 1"]}}, LOG_STEP],
        _X_VARIABLE,
        id="assert",
    ),
    pytest.param(
        [
            {
                "assert": {
                    "label": "Gate",
                    "that": ["x == 1"],
                    "on_pass": [LOG_STEP],
                    "on_fail": [LOG_STEP],
                }
            },
            LOG_STEP,
        ],
        _X_VARIABLE,
        id="assert-split",
    ),
    pytest.param(
        [{"if": {"label": "Branch", "when": "x == 1", "then": [LOG_STEP]}}, LOG_STEP],
        _X_VARIABLE,
        id="if",
    ),
    pytest.param(
        [
            {
                "switch": {
                    "label": "Route",
                    "cases": [{"when": "x == 1", "steps": [LOG_STEP]}],
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ],
        _X_VARIABLE,
        id="switch",
    ),
    pytest.param(
        [{"try": {"label": "Guard", "steps": [LOG_STEP], "catch": [LOG_STEP]}}, LOG_STEP],
        {},
        id="try",
    ),
    pytest.param(
        [
            {
                "parallel": {
                    "label": "Fan out",
                    "branches": [{"steps": [LOG_STEP]}, {"steps": [LOG_STEP]}],
                }
            },
            LOG_STEP,
        ],
        {},
        id="parallel",
    ),
    pytest.param(
        [
            {
                "remote": {
                    "label": "On the host",
                    "settings": {"session_id": {"expr": "ssh_session"}},
                    "body": [LOG_STEP],
                }
            },
            LOG_STEP,
        ],
        {"ssh_session": {"type": "string", "value": "main"}},
        id="remote",
    ),
]


class TestControlLabelsReadBack:
    """A control step's own label reads back, so applying the readback keeps the Block's name."""

    @pytest.mark.parametrize(("flow", "variables"), LABELED_CONTROLS)
    def test_a_custom_label_survives_the_round_trip(
        self, flow: list[Any], variables: dict[str, Any]
    ) -> None:
        recipe = make_recipe(flow, variables=variables)
        assert_round_trip(recipe)

    def test_a_labeled_delay_block_step_keeps_its_label_in_the_shorthand(self) -> None:
        flow = [{"block": "delay", "label": "Wait 30", "settings": {"duration": "30"}}]
        readback = decompile(compile_clean(make_recipe(flow))["test_data"])["recipe"]

        assert yaml.safe_load(readback)["flow"] == [{"delay": 30, "label": "Wait 30"}]
        again = compile_clean(readback)["test_data"]["workflow"]["nodes"]
        assert [node["data"]["label"] for node in again] == ["Wait 30"]

    def test_a_control_with_its_default_name_reads_back_without_a_label(self) -> None:
        flow = [{"delay": 100}, {"assert": {"that": ["x == 1"]}}]
        steps = readback_flow(flow, _X_VARIABLE)

        assert steps == [
            {"delay": 100},
            {"assert": {"that": ["x == 1"], "fail_current_scope": False}},
        ]


class TestRoundTripFidelity:
    def test_block(self) -> None:
        recipe = make_recipe(
            [
                {
                    "block": "http-client",
                    "label": "Fetch home",
                    "settings": {
                        "url": "{{ base_url }}/home",
                        "method": "GET",
                        "timeout": {"expr": "1 + 2"},
                    },
                    "capture": {"status_code": "home_status"},
                },
                LOG_STEP,
            ],
            variables={"base_url": {"type": "string", "value": "http://shop.local"}},
        )
        assert_round_trip(recipe)

    def test_local_function_step(self) -> None:
        functions = [
            {
                "name": "fetch_status",
                "inputs": [{"name": "url", "type": "string", "required": True}],
                "outputs": [{"name": "status", "type": "integer"}],
                "flow": [{"block": "log", "settings": {"message": "in fn"}}],
            }
        ]
        flow = [
            {
                "function": "fetch_status",
                "settings": {"url": {"expr": "base + '/health'"}},
                "capture": {"status": "health_status"},
            }
        ]
        recipe = make_recipe(
            flow,
            variables={"base": {"type": "string", "value": "http://shop.local"}},
            functions=functions,
        )
        assert_round_trip(recipe)

    def test_library_function_step(self) -> None:
        create_library_function(
            "fetch_remote",
            version="1.2.0",
            inputs=[
                {
                    "name": "host",
                    "type": "string",
                    "required": True,
                    "default": None,
                    "description": "Target host",
                }
            ],
            outputs=[{"name": "result", "type": "string", "description": "Outcome"}],
        )
        flow = [
            {
                "function": "fetch_remote",
                "version": "1.2.0",
                "settings": {"host": "myhost.local"},
                "capture": {"result": "r"},
            }
        ]
        assert_round_trip(make_recipe(flow))

    def test_set(self) -> None:
        flow = [{"set": {"counter": 0, "greeting": {"expr": "'hi ' + user"}}}]
        variables = {
            "counter": {"type": "integer", "value": 0},
            "greeting": {"type": "string", "value": ""},
            "user": {"type": "string", "value": "sam"},
        }
        assert_round_trip(make_recipe(flow, variables=variables))

    def test_note(self) -> None:
        # A note in the flow reads back at its place and compiles wired there again.
        flow = [LOG_STEP, {"note": {"text": "Reviewed by QA", "color": "yellow"}}, LOG_STEP]
        first = compile_clean(make_recipe(flow))["test_data"]
        readback = decompile(first)
        assert readback["expressible"] is True
        steps = yaml.safe_load(readback["recipe"])["flow"]
        assert [next(iter(step)) for step in steps] == ["block", "note", "block"]
        assert steps[1]["note"] == {"text": "Reviewed by QA", "color": "yellow"}

        second = compile_clean(readback["recipe"])["test_data"]
        assert _edge_set(second) == _edge_set(first)
        assert _edge_set(second) == {
            ("start-node", "node-1", None, None),
            ("node-1", "node-2", None, None),
            ("node-2", "node-3", None, None),
        }

    def test_hand_built_note_with_no_connection_reads_back_beside_the_flow(self) -> None:
        nodes = [
            make_node("node-1"),
            {
                "id": "note-1",
                "type": "noteNode",
                "data": {"config": {"values": {"text": "hi", "color": "yellow"}}},
            },
        ]
        edges = [{"id": "e1", "source": "start-node", "target": "node-1"}]
        readback = decompile(
            {"name": "Noted", "workflow": {"nodes": nodes, "edges": edges}, "variables": {}}
        )
        assert readback["expressible"] is True
        recipe = yaml.safe_load(readback["recipe"])
        assert [next(iter(step)) for step in recipe["flow"]] == ["block"]
        assert recipe["notes"] == [{"note": {"text": "hi", "color": "yellow"}}]

    def test_if_elif_else(self) -> None:
        flow = [
            LOG_STEP,
            {
                "if": {
                    "when": "x == 1",
                    "then": [LOG_STEP, LOG_STEP],
                    "elif": [{"when": COMPARISON, "then": [LOG_STEP]}],
                    "else": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        variables = {
            "x": {"type": "integer", "value": 1},
            "transport": {"type": "string", "value": "TCP"},
        }
        assert_round_trip(make_recipe(flow, variables=variables))

    def test_switch(self) -> None:
        flow = [
            {
                "switch": {
                    "cases": [
                        {"when": "code == 200", "steps": [LOG_STEP]},
                        {"when": COMPARISON, "steps": [LOG_STEP]},
                    ],
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables=SWITCH_VARIABLES))

    def test_switch_without_a_default(self) -> None:
        flow = [
            {"switch": {"cases": [{"when": "code == 200", "steps": [LOG_STEP]}]}},
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables=SWITCH_VARIABLES))

    def test_switch_with_a_non_breaking_case(self) -> None:
        flow = [
            {
                "switch": {
                    "cases": [
                        {"when": "code == 200", "steps": [LOG_STEP], "break": False},
                        {"when": "code == 404", "steps": [LOG_STEP]},
                    ],
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables=SWITCH_VARIABLES))

    def test_switch_inside_a_loop_body(self) -> None:
        flow = [
            {
                "for": {
                    "count": 2,
                    "body": [
                        {
                            "switch": {
                                "cases": [{"when": "code == 200", "steps": [LOG_STEP]}],
                                "default": [LOG_STEP],
                            }
                        },
                        LOG_STEP,
                    ],
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables=SWITCH_VARIABLES))

    def test_switch_case_containing_a_nested_if(self) -> None:
        nested = {"if": {"when": "code == 200", "then": [LOG_STEP], "else": [LOG_STEP]}}
        flow = [
            {
                "switch": {
                    "cases": [
                        {"when": "code == 200", "steps": [nested]},
                        {"when": COMPARISON, "steps": [LOG_STEP], "break": False},
                    ],
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables=SWITCH_VARIABLES))

    def test_for(self) -> None:
        flow = [{"for": {"count": 3, "body": [LOG_STEP, LOG_STEP]}}, LOG_STEP]
        assert_round_trip(make_recipe(flow))

    def test_for_each(self) -> None:
        flow = [
            {
                "for_each": {
                    "collection": {"expr": "items"},
                    "body": [LOG_STEP],
                    "capture": {"item": "current", "index": "i"},
                }
            }
        ]
        assert_round_trip(make_recipe(flow, variables={"items": {"type": "array", "value": []}}))

    def test_while(self) -> None:
        flow = [
            {
                "while": {
                    "conditions": "i < 10",
                    "mode": "do-while",
                    "max_iterations": 5,
                    "timeout": 30,
                    "body": [LOG_STEP],
                }
            }
        ]
        assert_round_trip(make_recipe(flow, variables={"i": {"type": "integer", "value": 0}}))

    def test_wait_until_retry(self) -> None:
        flow = [
            {
                "wait_until": {
                    "label": "Poll pod",
                    "that": ["pod_phase == 'Running'"],
                    "timeout": 30000,
                    "interval": 250,
                    "message": "pod never reached Running",
                    "fail_current_scope": True,
                    "retry": [LOG_STEP],
                    "capture": {"passed": "pod_ready", "elapsed": "waited_ms"},
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables=WAIT_VARIABLES))

    def test_wait_until_watch(self) -> None:
        flow = [
            {"wait_until": {"that": ["pod_phase == 'Running'"], "timeout": 30000}},
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables=WAIT_VARIABLES))

    def test_wait_until_with_an_empty_retry_lane(self) -> None:
        # An empty lane is Retry mode, not Watch. If the readback dropped
        # `retry: []` the node would come back as a Watch with a different
        # handle set, and the wired egress would move.
        flow = [
            {"wait_until": {"that": ["pod_phase == 'Running'"], "timeout": 30000, "retry": []}},
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables=WAIT_VARIABLES))

    def test_wait_until_with_several_conditions(self) -> None:
        flow = [
            {
                "wait_until": {
                    "that": ["pod_phase == 'Running'", COMPARISON],
                    "timeout": 30000,
                    "retry": [LOG_STEP],
                }
            }
        ]
        assert_round_trip(make_recipe(flow, variables=WAIT_VARIABLES))

    def test_wait_until_inside_a_loop_body(self) -> None:
        flow = [
            {
                "for": {
                    "count": 2,
                    "body": [
                        {
                            "wait_until": {
                                "that": ["pod_phase == 'Running'"],
                                "timeout": 1000,
                                "retry": [LOG_STEP],
                            }
                        },
                        LOG_STEP,
                    ],
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables=WAIT_VARIABLES))

    def test_try(self) -> None:
        flow = [
            {
                "try": {
                    "steps": [LOG_STEP],
                    "catch": [LOG_STEP],
                    "finally": [LOG_STEP],
                    "capture": {"error": "err", "caught": "was_caught"},
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow))

    def test_assert_split(self) -> None:
        flow = [
            {
                "assert": {
                    "that": ["x == 1", COMPARISON],
                    "on_pass": [LOG_STEP],
                    "on_fail": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        variables = {
            "x": {"type": "integer", "value": 1},
            "transport": {"type": "string", "value": "TCP"},
        }
        assert_round_trip(make_recipe(flow, variables=variables))

    def test_assert_single(self) -> None:
        flow = [{"assert": {"that": ["x == 1"]}}, LOG_STEP]
        assert_round_trip(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))

    def test_assert_single_with_fail_current_scope(self) -> None:
        flow = [{"assert": {"that": ["x == 1"], "fail_current_scope": True}}, LOG_STEP]
        assert_round_trip(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))

    def test_hand_built_if_else_with_custom_branch_ids_keeps_children(self) -> None:
        nodes = [
            make_node(
                "if-detect",
                element_type="if-else",
                node_type="control",
                values={
                    "branches": [
                        {
                            "type": "if",
                            "id": "branch_hit",
                            "label": "Blocked node",
                            "conditions": [
                                {
                                    "type": "literal",
                                    "variable": "node_host",
                                    "value_type": "string",
                                    "operator": "equals",
                                    "reference_value": "node-3",
                                    "id": "c-hit",
                                }
                            ],
                        },
                        {"type": "else", "id": "branch_pass", "label": "Healthy"},
                    ]
                },
            ),
            make_node("log-hit", values={"message": "blocked"}),
            make_node("log-close", values={"message": "close"}),
        ]
        edges = [
            make_edge("start-node", "if-detect"),
            make_edge("if-detect", "log-hit", source_handle="branch_hit"),
            make_edge("log-hit", "log-close", target_handle="ingress_1"),
            make_edge("if-detect", "log-close", source_handle="branch_pass"),
        ]
        readback = decompile(make_test_data(nodes, edges))
        assert readback["expressible"] is True
        assert readback["inexpressible"] == []
        flow = yaml.safe_load(readback["recipe"])["flow"]
        assert flow[0] == {
            "if": {
                "if_label": "Blocked node",
                "when": {
                    "variable": "node_host",
                    "operator": "equals",
                    "value": "node-3",
                    "value_type": "string",
                },
                "then": [{"block": "log", "label": "log", "settings": {"message": "blocked"}}],
                "else_label": "Healthy",
                "else": [],
                "label": "if-else",
            }
        }
        assert flow[1] == {"block": "log", "label": "log", "settings": {"message": "close"}}

    def test_hand_built_switch_with_custom_branch_ids_keeps_children(self) -> None:
        nodes = [
            make_node(
                "switch-route",
                element_type="switch-case",
                node_type="control",
                values={
                    "branches": [
                        {
                            "type": "case",
                            "id": "case_hot",
                            "label": "Hot",
                            "conditions": [
                                {
                                    "type": "literal",
                                    "variable": "node_host",
                                    "value_type": "string",
                                    "operator": "equals",
                                    "reference_value": "node-3",
                                    "id": "c-hot",
                                }
                            ],
                            "break": False,
                        },
                        {"type": "default", "id": "case_rest", "label": ""},
                    ]
                },
            ),
            make_node("log-hot", values={"message": "hot"}),
            make_node("log-rest", values={"message": "rest"}),
            make_node("log-close", values={"message": "close"}),
        ]
        edges = [
            make_edge("start-node", "switch-route"),
            make_edge("switch-route", "log-hot", source_handle="case_hot"),
            make_edge("switch-route", "log-rest", source_handle="case_rest"),
            make_edge("switch-route", "log-close", source_handle="then"),
        ]
        readback = decompile(make_test_data(nodes, edges))
        assert readback["expressible"] is True
        assert readback["inexpressible"] == []
        flow = yaml.safe_load(readback["recipe"])["flow"]
        assert flow[0] == {
            "switch": {
                "cases": [
                    {
                        "label": "Hot",
                        "when": {
                            "variable": "node_host",
                            "operator": "equals",
                            "value": "node-3",
                            "value_type": "string",
                        },
                        "steps": [{"block": "log", "label": "log", "settings": {"message": "hot"}}],
                        "break": False,
                    }
                ],
                "default": [{"block": "log", "label": "log", "settings": {"message": "rest"}}],
                "label": "switch-case",
            }
        }
        assert flow[1] == {"block": "log", "label": "log", "settings": {"message": "close"}}

    def test_remote(self) -> None:
        flow = [
            {
                "remote": {
                    "settings": {"session_id": {"expr": "ssh_session"}},
                    "body": [LOG_STEP],
                    "capture": {"remote_session_id": "rsid"},
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(
            make_recipe(flow, variables={"ssh_session": {"type": "string", "value": "main"}})
        )

    def test_remote_with_profiles(self) -> None:
        create_profile("remote-main")
        remote = {
            "settings": {"session_id": {"expr": "ssh_session"}},
            "profiles": [{"profile": "remote-main", "alias": "creds", "fields": ["username"]}],
            "body": [LOG_READBACK],
        }
        recipe = make_recipe(
            [{"remote": remote}], variables={"ssh_session": {"type": "string", "value": "main"}}
        )

        steps = yaml.safe_load(decompile(compile_clean(recipe)["test_data"])["recipe"])["flow"]

        assert steps == [{"remote": remote}]
        assert_round_trip(recipe)

    def test_assert_split_with_fail_current_scope(self) -> None:
        flow = [
            {
                "assert": {
                    "that": ["x == 1"],
                    "on_pass": [LOG_STEP],
                    "on_fail": [LOG_STEP],
                    "fail_current_scope": True,
                }
            },
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))

    def test_for_range(self) -> None:
        flow = [
            {"for": {"range": {"start": 0, "end": 10, "step": 2}, "body": [LOG_STEP]}},
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow))

    def test_for_count_with_timeout(self) -> None:
        flow = [{"for": {"count": 3, "timeout": 30, "body": [LOG_STEP]}}, LOG_STEP]
        assert_round_trip(make_recipe(flow))

    def test_for_each_with_timeout(self) -> None:
        flow = [
            {"for_each": {"collection": {"expr": "items"}, "timeout": 15, "body": [LOG_STEP]}},
            LOG_STEP,
        ]
        assert_round_trip(make_recipe(flow, variables={"items": {"type": "array", "value": []}}))

    def test_if_with_empty_branch(self) -> None:
        flow = [{"if": {"when": "x == 1", "then": [], "else": [LOG_STEP]}}, LOG_STEP]
        assert_round_trip(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))

    def test_labeled_while_with_break_targeting_it(self) -> None:
        flow = [
            {
                "while": {
                    "label": "retry_loop",
                    "conditions": "i < 10",
                    "body": [
                        {"set": {"i": {"expr": "i + 1"}}},
                        {
                            "for": {
                                "count": 2,
                                "body": [{"break": {"loop": "retry_loop"}}],
                            }
                        },
                    ],
                }
            },
        ]
        recipe = make_recipe(flow, variables={"i": {"type": "integer", "value": 0}})
        assert_round_trip(recipe)
        readback = decompile(compile_clean(recipe)["test_data"])
        body = yaml.safe_load(readback["recipe"])["flow"][0]["while"]
        assert body["label"] == "retry_loop"
        assert body["body"][1]["for"]["body"][0] == {"break": {"loop": "retry_loop"}}

    def test_break_inside_a_loop(self) -> None:
        flow = [{"for": {"count": 1, "body": [{"break": {}}]}}, LOG_STEP]
        assert_round_trip(make_recipe(flow))

    def test_standalone_delay(self) -> None:
        flow = [LOG_STEP, {"delay": 100}, LOG_STEP]
        assert_round_trip(make_recipe(flow))

    def test_terminating_halt(self) -> None:
        flow = [LOG_STEP, {"halt": {}}]
        assert_round_trip(make_recipe(flow))

    def test_a_local_function_used_by_two_function_blocks(self) -> None:
        functions = [
            {
                "name": "greet",
                "inputs": [],
                "outputs": [],
                "flow": [{"block": "log", "settings": {"message": "in greet"}}],
            }
        ]
        flow = [{"function": "greet"}, {"function": "greet"}]
        assert_round_trip(make_recipe(flow, functions=functions))

    def test_shell_script(self) -> None:
        step = {
            "block": "shell-script",
            "label": "Double the replicas",
            "settings": {
                "script": "COUNT=$(( REPLICAS * 2 ))",
                "arguments": [{"value": "--env"}, {"value": {"expr": "env_name"}}],
                "input_vars": {"REPLICAS": {"expr": "replicas"}},
                "script_variables": ["COUNT", "UNBOUND"],
            },
            "capture": {"COUNT": "pod_count", "stdout": "script_out"},
        }
        recipe = make_recipe(
            [step, LOG_STEP],
            variables={
                "env_name": {"type": "string", "value": "staging"},
                "replicas": {"type": "integer", "value": 3},
                "pod_count": {"type": "integer"},
            },
        )
        assert_round_trip(recipe)

    def test_shell_exec(self) -> None:
        step = {
            "block": "shell-exec",
            "settings": {
                "command": "ls -1 | wc -l",
                "shell": "/bin/bash",
                "env_vars": {"TARGET": {"expr": "env_name"}},
            },
            "capture": {"stdout": "file_count"},
        }
        recipe = make_recipe(
            [step, LOG_STEP],
            variables={"env_name": {"type": "string", "value": "staging"}},
        )
        assert_round_trip(recipe)

    def test_sftp_download_with_every_row_set(self) -> None:
        # REQ-5.2.7.3: every row reads back as written, plus the true / false rows compiled in.
        variables = {
            "ssh_session": {"type": "string", "value": "main"},
            "fetched": {"type": "table"},
        }
        assert_round_trip(make_recipe([SFTP_DOWNLOAD_STEP, LOG_STEP], variables=variables))
        assert readback_flow([SFTP_DOWNLOAD_STEP], variables)[0] == with_creation_values(
            SFTP_DOWNLOAD_STEP, {"recursive": False, "missing_ok": False}
        )

    def test_k8s_copy_from_pod_with_both_limits_set(self) -> None:
        # REQ-5.2.7.3, K8SEXEC-10: the limit rows read back as written.
        variables = {"k8s_session": {"type": "string", "secret": True}}

        readback = readback_flow([K8S_COPY_FROM_POD_STEP], variables)[0]

        assert readback == with_creation_values(
            K8S_COPY_FROM_POD_STEP, {"no_preserve": False, "on_error": "fail"}
        )


SFTP_DOWNLOAD_STEP: dict[str, Any] = {
    "block": "sftp",
    "label": "Fetch the orders",
    "settings": {
        "session_id": {"expr": "ssh_session"},
        "operation": "download",
        "source": "/outbound/*.csv",
        "destination": "artifact://orders/",
        "if_exists": "fail",
        "timeout": 600,
        "max_size_mib": 50,
        "max_files": 20,
        "on_error": "record",
    },
    "capture": {"summary": "fetched"},
}
K8S_COPY_FROM_POD_STEP: dict[str, Any] = {
    "block": "k8s-copy",
    "label": "Pull the reports",
    "settings": {
        "session": {"expr": "k8s_session"},
        "direction": "from_pod",
        "pod": "reporter-0",
        "container": "reporter",
        "source_path": "/var/reports",
        "target_path": "artifact://reports",
        "max_size_mib": 64,
        "max_files": 500,
    },
}

OPENSEARCH_VARIABLES: dict[str, Any] = {
    "cluster_url": {"type": "string", "value": "https://opensearch.internal:9200"},
    "test_start": {"type": "string", "value": "2026-09-26T10:00:00Z"},
    "service": {"type": "string", "value": "checkout"},
    "level_field": {"type": "string", "value": "log.level"},
    "slow_stat": {"type": "map", "value": {"stat": "max", "field": "latency_ms"}},
    "hits": {"type": "table"},
    "per_minute": {"type": "table"},
}
OPENSEARCH_SEARCH_STEP: dict[str, Any] = {
    "block": "opensearch",
    "label": "Find the errors",
    "settings": {
        "url": {"expr": "cluster_url"},
        "index": "app-logs-*",
        "from": {"expr": "test_start"},
        "to": "now",
        "query": "service: {{ service }} and log.level: ERROR",
        "mode": "search",
        "fields": [{"value": "@timestamp"}, {"value": {"expr": "level_field"}}],
        "max_results": 0,
        "order": "asc",
    },
    "capture": {"results": "hits"},
}
OPENSEARCH_AGGREGATE_STEP: dict[str, Any] = {
    "block": "opensearch",
    "label": "Latency per minute",
    "settings": {
        "url": {"expr": "cluster_url"},
        "index": "app-logs-*",
        "mode": "aggregate",
        "group_by_time": "1m",
        "stats": [
            {"value": {"stat": "count"}},
            {"value": {"stat": "percentile", "field": "latency_ms", "percent": 95}},
            {"value": {"stat": "custom", "json": '{"max": {"field": "bytes"}}', "name": "peak"}},
            {"value": {"expr": "slow_stat"}},
        ],
    },
    "capture": {"results": "per_minute"},
}


def opensearch_recipe() -> str:
    return make_recipe(
        [OPENSEARCH_SEARCH_STEP, OPENSEARCH_AGGREGATE_STEP], variables=OPENSEARCH_VARIABLES
    )


class TestOpensearchReadback:
    """An OpenSearch step's Fields and Stats rows read back losslessly (REQ-3.4.1.15)."""

    def test_the_steps_read_back_as_the_same_test(self) -> None:
        assert_round_trip(opensearch_recipe())

    def test_every_setting_reads_back_as_written(self) -> None:
        steps = yaml.safe_load(
            decompile(compile_clean(opensearch_recipe())["test_data"])["recipe"]
        )["flow"]

        assert steps == [
            with_creation_values(OPENSEARCH_SEARCH_STEP, OPENSEARCH_CREATION_VALUES),
            with_creation_values(OPENSEARCH_AGGREGATE_STEP, OPENSEARCH_CREATION_VALUES),
        ]

    def test_a_hand_built_stats_row_expression_reads_back_as_a_nested_expression(self) -> None:
        node = make_node(
            "node-1",
            element_type="opensearch",
            values={
                "url": "https://opensearch.internal:9200",
                "index": "logs",
                "mode": "aggregate",
                "stats": [{"value": {"stat": "count"}}, {"value": "slow_stat"}],
            },
        )
        node["data"]["expressionFields"] = ["stats.1.value"]

        recipe = yaml.safe_load(
            decompile(make_test_data([node], [make_edge("start-node", "node-1")]))["recipe"]
        )

        assert recipe["flow"][0]["settings"]["stats"] == [
            {"value": {"stat": "count"}},
            {"value": {"expr": "slow_stat"}},
        ]

    def test_query_data_shaped_like_a_value_form_reads_back_as_a_literal(self) -> None:
        step = {
            "block": "opensearch",
            "settings": {
                "url": "https://opensearch.internal:9200",
                "index": "mail-*",
                "query": {"term": {"literal": {"template": "welcome-mail"}}},
            },
        }
        recipe = make_recipe([step])

        steps = yaml.safe_load(decompile(compile_clean(recipe)["test_data"])["recipe"])["flow"]

        assert steps == [with_creation_values(step, OPENSEARCH_CREATION_VALUES)]
        assert_round_trip(recipe)

    def test_the_secret_rows_are_never_in_the_readback(self) -> None:
        secrets = {
            "password": "os-password-classified",
            "api_key": "os-api-key-classified",
            "bearer_token": "os-bearer-classified",
            "client_key": "os-client-key-classified",
        }
        step = {
            "block": "opensearch",
            "settings": {"url": "https://opensearch.internal:9200", "index": "logs", **secrets},
        }

        recipe = decompile(compile_clean(make_recipe([step]))["test_data"])["recipe"]

        assert [value for value in secrets.values() if value in recipe] == []
        assert yaml.safe_load(recipe)["flow"][0]["settings"] == {
            **OPENSEARCH_CREATION_VALUES,
            "url": "https://opensearch.internal:9200",
            "index": "logs",
        }


class TestSqlScriptExpressionReadback:
    """A SQL script in expression mode reads back as `{expr: ...}` (SQL-10, REQ-3.4.1.6)."""

    def test_a_compiled_script_expression_reads_back_as_written(self) -> None:
        step = {
            "block": "sql-client",
            "settings": {
                "host": "db",
                "database": "wave",
                "username": "wave",
                "sql": {"expr": "order_query"},
                "parameters": {"min_qty": {"expr": "threshold"}},
            },
        }
        variables = {
            "order_query": {
                "type": "string",
                "value": "SELECT id FROM orders WHERE qty >= :min_qty",
            },
            "threshold": {"type": "integer", "value": 7},
        }

        [readback] = readback_flow([step], variables)

        assert readback == with_creation_values(step, SQL_CREATION_VALUES)
        assert_round_trip(make_recipe([step], variables=variables))

    def test_a_canvas_script_in_expression_mode_reads_back_as_an_expression(self) -> None:
        node = make_node(
            "node-1",
            element_type="sql-client",
            values={"host": "db", "database": "wave", "username": "wave", "sql": "order_query"},
        )
        node["data"]["expressionFields"] = ["sql"]

        recipe = yaml.safe_load(
            decompile(make_test_data([node], [make_edge("start-node", "node-1")]))["recipe"]
        )

        assert recipe["flow"][0]["settings"]["sql"] == {"expr": "order_query"}


class TestSwitchReadback:
    """The exact 'switch' mapping a compiled Switch reads back as."""

    def test_cases_read_back_as_when_and_steps(self) -> None:
        flow = [
            {"switch": {"cases": [{"when": "code == 200", "steps": [LOG_STEP]}]}},
            LOG_STEP,
        ]
        assert readback_switch(flow, SWITCH_VARIABLES) == {
            "cases": [{"when": "code == 200", "steps": [LOG_READBACK]}]
        }

    def test_a_comparison_when_reads_back_as_the_mapping(self) -> None:
        flow = [{"switch": {"cases": [{"when": COMPARISON, "steps": [LOG_STEP]}]}}, LOG_STEP]
        assert readback_switch(flow, SWITCH_VARIABLES)["cases"][0]["when"] == COMPARISON

    def test_break_reads_back_only_on_the_non_breaking_case(self) -> None:
        flow = [
            {
                "switch": {
                    "cases": [
                        {"when": "code == 200", "steps": [LOG_STEP], "break": False},
                        {"when": "code == 404", "steps": [LOG_STEP], "break": True},
                        {"when": "code == 500", "steps": [LOG_STEP]},
                    ]
                }
            },
            LOG_STEP,
        ]
        cases = readback_switch(flow, SWITCH_VARIABLES)["cases"]
        assert cases[0]["break"] is False
        assert "break" not in cases[1]
        assert "break" not in cases[2]

    def test_default_reads_back_only_when_one_was_authored(self) -> None:
        cases = [{"when": "code == 200", "steps": [LOG_STEP]}]
        assert "default" not in readback_switch(
            [{"switch": {"cases": cases}}, LOG_STEP], SWITCH_VARIABLES
        )
        with_default = readback_switch(
            [{"switch": {"cases": cases, "default": [LOG_STEP]}}, LOG_STEP], SWITCH_VARIABLES
        )
        assert with_default["default"] == [LOG_READBACK]

    def test_readback_carries_the_label_and_no_capture_or_on_key(self) -> None:
        flow = [
            {
                "switch": {
                    "label": "Route by status",
                    "cases": [{"when": "code == 200", "steps": [LOG_STEP]}],
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        switch = readback_switch(flow, SWITCH_VARIABLES)
        assert set(switch) == {"cases", "default", "label"}
        assert switch["label"] == "Route by status"

    def test_the_continuation_reads_back_as_the_next_sibling_step(self) -> None:
        after = {"block": "log", "settings": {"message": "after"}}
        flow = [
            {
                "switch": {
                    "cases": [{"when": "code == 200", "steps": [LOG_STEP]}],
                    "default": [LOG_STEP],
                }
            },
            after,
        ]
        steps = readback_flow(flow, SWITCH_VARIABLES)
        assert [next(iter(step)) for step in steps] == ["switch", "block"]
        assert steps[0]["switch"]["cases"][0]["steps"] == [LOG_READBACK]
        assert steps[0]["switch"]["default"] == [LOG_READBACK]
        assert steps[1] == {"block": "log", "settings": {"message": "after", "level": "INFO"}}


class TestWaitUntilReadback:
    """The exact `wait_until` mapping a compiled Wait Until reads back as."""

    def _readback(self, **overrides: Any) -> dict[str, Any]:
        value: dict[str, Any] = {
            "that": ["pod_phase == 'Running'"],
            "timeout": 30000,
            "retry": [LOG_STEP],
        }
        value.update(overrides)
        step = readback_flow([{"wait_until": value}, LOG_STEP], WAIT_VARIABLES)[0]["wait_until"]
        assert isinstance(step, dict)
        return step

    def test_the_condition_set_reads_back_under_that(self) -> None:
        assert self._readback()["that"] == ["pod_phase == 'Running'"]

    def test_a_single_condition_stays_a_list(self) -> None:
        # `that` is Assert's vocabulary; Assert's list never collapses, and a
        # scalar here would be the one condition set in the format that does.
        value = self._readback()["that"]
        assert isinstance(value, list)

    def test_several_conditions_read_back_in_author_order(self) -> None:
        step = self._readback(that=["pod_phase == 'Running'", COMPARISON])
        assert step["that"] == ["pod_phase == 'Running'", COMPARISON]

    def test_the_deadline_reads_back(self) -> None:
        assert self._readback()["timeout"] == 30000

    def test_the_retry_lane_reads_back_as_its_steps(self) -> None:
        assert self._readback()["retry"] == [LOG_READBACK]

    def test_an_authored_interval_reads_back(self) -> None:
        assert self._readback(interval=250)["interval"] == 250

    def test_an_unset_interval_is_absent_from_the_readback(self) -> None:
        assert "interval" not in self._readback()

    def test_an_unset_message_is_absent_from_the_readback(self) -> None:
        assert "message" not in self._readback()

    def test_a_fail_current_scope_left_out_reads_back_as_written_at_creation(self) -> None:
        assert self._readback()["fail_current_scope"] is False

    def test_the_mode_is_never_written_out(self) -> None:
        # Presence of `retry` already carries the mode; a `mode` key would be a
        # second source of truth the compiler would have to reconcile.
        assert "mode" not in self._readback()

    def test_a_watch_node_reads_back_without_a_retry_key(self) -> None:
        step = readback_flow(
            [{"wait_until": {"that": ["pod_phase == 'Running'"], "timeout": 30000}}, LOG_STEP],
            WAIT_VARIABLES,
        )[0]["wait_until"]
        assert "retry" not in step

    def test_an_empty_retry_lane_reads_back_as_an_empty_list(self) -> None:
        step = readback_flow(
            [
                {
                    "wait_until": {
                        "that": ["pod_phase == 'Running'"],
                        "timeout": 30000,
                        "retry": [],
                    }
                },
                LOG_STEP,
            ],
            WAIT_VARIABLES,
        )[0]["wait_until"]
        assert step["retry"] == []

    def test_the_continuation_reads_back_as_the_next_sibling_step(self) -> None:
        steps = readback_flow(
            [
                {
                    "wait_until": {
                        "that": ["pod_phase == 'Running'"],
                        "timeout": 30000,
                        "retry": [LOG_STEP],
                    }
                },
                LOG_STEP,
            ],
            WAIT_VARIABLES,
        )
        assert steps[1] == LOG_READBACK

    def test_a_watch_continuation_reads_back_as_the_next_sibling_step(self) -> None:
        # A Watch node leaves by its unnamed default handle; if the readback
        # only followed a `then` edge everything after it would vanish.
        steps = readback_flow(
            [{"wait_until": {"that": ["pod_phase == 'Running'"], "timeout": 30000}}, LOG_STEP],
            WAIT_VARIABLES,
        )
        assert steps[1] == LOG_READBACK


class TestSecretOmission:
    def test_secret_variable_value_is_never_in_the_readback(self) -> None:
        secret = "hunter2-classified-variable-value"
        variables = {"password": {"type": "string", "secret": True, "value": secret}}
        test_data = compile_clean(make_recipe([LOG_STEP], variables=variables))["test_data"]
        assert test_data["variables"]["password"]["value"] == secret
        recipe = decompile(test_data)["recipe"]
        assert secret not in recipe
        declared = yaml.safe_load(recipe)["variables"]["password"]
        assert declared.get("secret") is True
        assert declared.get("value") != secret

    def test_secret_setting_value_is_never_in_the_readback(self) -> None:
        secret = "s3kr3t-classified-setting-value"
        step = {
            "block": "ssh-session-open",
            "settings": {"host": "server.local", "username": "admin", "password": secret},
        }
        test_data = compile_clean(make_recipe([step]))["test_data"]
        assert test_data["workflow"]["nodes"][0]["data"]["config"]["values"]["password"] == secret
        recipe = decompile(test_data)["recipe"]
        assert secret not in recipe

    @pytest.mark.parametrize(
        "stored_default",
        ["canary-secret-output-default", "wave:enc:v1:c2VhbGVkLW91dHB1dC1kZWZhdWx0"],
        ids=["plain", "sealed"],
    )
    def test_a_secret_output_default_is_never_in_the_readback(self, stored_default: str) -> None:
        # SECUI-11: the default is allowed, sealed at rest and masked everywhere.
        functions = [{"name": "issue", "inputs": [], "outputs": [], "flow": [LOG_STEP]}]
        recipe = make_recipe([{"function": "issue"}], functions=functions)
        test_data = compile_clean(recipe)["test_data"]
        _local_definition(test_data)["outputs"] = [
            {"name": "token", "type": "string", "secret": True, "default": stored_default}
        ]
        readback = decompile(test_data)["recipe"]
        assert stored_default not in readback
        (function,) = yaml.safe_load(readback)["functions"]
        assert function["outputs"] == [{"name": "token", "type": "string", "secret": True}]

    @pytest.mark.parametrize(
        "stored",
        [None, "********", "wave:enc:v1:c2VhbGVkLWlucHV0"],
        ids=["as-compiled", "masked", "sealed"],
    )
    def test_a_secret_input_value_is_never_in_the_readback(self, stored: str | None) -> None:
        # REQ-3.1.2.9: a secret input is a secret field; the author gives it again on amend.
        functions = [
            {
                "name": "login",
                "inputs": [
                    {"name": "url", "type": "string", "required": True},
                    {"name": "token", "type": "string", "required": True, "secret": True},
                ],
                "outputs": [],
                "flow": [LOG_STEP],
            }
        ]
        flow = [{"function": "login", "settings": {"url": "http://a", "token": "t0k-classified"}}]
        test_data = compile_clean(make_recipe(flow, functions=functions))["test_data"]
        if stored is not None:
            _function_block(test_data)["data"]["config"]["values"]["token"] = stored

        readback = decompile(test_data)["recipe"]

        (step,) = yaml.safe_load(readback)["flow"]
        assert step == {"function": "login", "settings": {"url": "http://a"}}
        assert "t0k-classified" not in readback
        assert stored is None or stored not in readback

    def test_a_secret_setting_written_as_an_expression_reads_back_as_written(self) -> None:
        step = {
            "block": "sql-client",
            "settings": {
                "host": "db",
                "database": "wave",
                "username": "wave",
                "password": {"expr": "db_password"},
                "sql": "SELECT 1",
            },
        }
        variables = {"db_password": {"type": "string", "secret": True, "value": "pw-classified"}}

        readback = decompile(compile_clean(make_recipe([step], variables=variables))["test_data"])

        assert yaml.safe_load(readback["recipe"])["flow"] == [
            with_creation_values(step, SQL_CREATION_VALUES)
        ]
        assert "pw-classified" not in readback["recipe"]
        assert_round_trip(make_recipe([step], variables=variables))

    def test_a_k8s_step_reads_back_with_its_session_and_rebuilds(self) -> None:
        variables = {"k8s_session": {"type": "string", "secret": True}}
        recipe = make_recipe([K8S_COPY_FROM_POD_STEP], variables=variables)

        readback = decompile(compile_clean(recipe)["test_data"])["recipe"]

        assert yaml.safe_load(readback)["flow"][0]["settings"]["session"] == {"expr": "k8s_session"}
        assert compile_recipe(readback)["findings"] == []

    def test_a_secret_input_written_as_an_expression_reads_back_as_written(self) -> None:
        functions = [
            {
                "name": "login",
                "inputs": [
                    {"name": "url", "type": "string", "required": True},
                    {"name": "token", "type": "string", "required": True, "secret": True},
                ],
                "outputs": [],
                "flow": [LOG_STEP],
            }
        ]
        settings = {"url": "http://a", "token": {"expr": "api_token"}}
        variables = {"api_token": {"type": "string", "secret": True, "value": "t0k-classified"}}
        recipe = make_recipe(
            [{"function": "login", "settings": settings}], variables=variables, functions=functions
        )

        readback = decompile(compile_clean(recipe)["test_data"])["recipe"]

        (step,) = yaml.safe_load(readback)["flow"]
        assert step == {"function": "login", "settings": settings}
        assert "t0k-classified" not in readback

    def test_a_canvas_secret_setting_in_expression_mode_reads_back_as_an_expression(self) -> None:
        node = make_node(
            "node-1",
            element_type="k8s-get",
            values={"session": "k8s_session", "kind": "Pod", "name": "web-0"},
        )
        node["data"]["expressionFields"] = ["session"]

        recipe = yaml.safe_load(
            decompile(make_test_data([node], [make_edge("start-node", "node-1")]))["recipe"]
        )

        assert recipe["flow"][0]["settings"] == {
            "session": {"expr": "k8s_session"},
            "kind": "Pod",
            "name": "web-0",
        }


class TestExpressibility:
    def test_clean_tree_is_expressible(self) -> None:
        flow = [LOG_STEP, LOG_STEP, {"if": {"when": "x == 1", "then": [LOG_STEP]}}]
        test_data = compile_clean(
            make_recipe(flow, variables={"x": {"type": "integer", "value": 1}})
        )["test_data"]
        readback = decompile(test_data)
        assert readback["expressible"] is True
        assert readback["inexpressible"] == []
        assert isinstance(readback["recipe"], str)

    def test_cross_branch_edge_is_inexpressible(self) -> None:
        nodes = [
            make_node("node-1", element_type="if", node_type="control"),
            make_node("node-2"),
            make_node("node-3"),
        ]
        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-2", source_handle="branch_0"),
            make_edge("node-1", "node-3", source_handle="branch_1"),
            make_edge("node-2", "node-3"),
        ]
        assert_inexpressible(make_test_data(nodes, edges))

    def test_cycle_outside_a_loop_is_inexpressible(self) -> None:
        nodes = [make_node("node-1"), make_node("node-2")]
        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-2"),
            make_edge("node-2", "node-1"),
        ]
        assert_inexpressible(make_test_data(nodes, edges))

    def test_multi_join_beyond_the_structural_rejoin_is_inexpressible(self) -> None:
        nodes = [make_node("node-1"), make_node("node-2"), make_node("node-3"), make_node("node-4")]
        edges = [
            make_edge("start-node", "node-1"),
            make_edge("node-1", "node-2"),
            make_edge("node-2", "node-3"),
            make_edge("node-1", "node-4"),
            make_edge("node-2", "node-4", target_handle="ingress_1"),
            make_edge("node-3", "node-4", target_handle="ingress_2"),
        ]
        assert_inexpressible(make_test_data(nodes, edges))

    def test_orphan_node_is_inexpressible(self) -> None:
        nodes = [make_node("node-1"), make_node("node-2")]
        edges = [make_edge("start-node", "node-1")]
        assert_inexpressible(make_test_data(nodes, edges))

    def test_an_orphan_is_reported_as_an_unreachable_block(self) -> None:
        orphan = make_node("node-2")
        orphan["data"]["label"] = "Left over"
        edges = [make_edge("start-node", "node-1")]

        readback = decompile(make_test_data([make_node("node-1"), orphan], edges))

        assert {"what": "unreachable block 'Left over'", "where": "node-2"} in readback[
            "inexpressible"
        ]

    def test_break_targeting_an_absent_node_falls_back_to_innermost(self) -> None:
        nodes = [
            make_node(
                "loop-1",
                element_type="for",
                node_type="control",
                values={"count": 2},
            ),
            make_node(
                "break-1",
                element_type="break",
                node_type="control",
                values={"target_loop": "vanished-node"},
            ),
        ]
        edges = [
            make_edge("start-node", "loop-1"),
            make_edge("loop-1", "break-1", source_handle="body"),
        ]
        readback = decompile(make_test_data(nodes, edges))
        flow = yaml.safe_load(readback["recipe"])["flow"]
        assert flow[0]["for"]["body"][0] == {"break": {}, "label": "break"}
        assert readback["expressible"] is False
        assert readback["inexpressible"] == [
            {
                "what": "a break aimed at a loop that does not enclose it, in block 'break'",
                "where": "break-1",
            }
        ]

    def test_blocks_dropped_from_the_walk_are_inexpressible(self) -> None:
        # A handle that is neither a declared branch id nor 'then' anchors no section.
        nodes = [
            make_node(
                "switch-1",
                element_type="switch-case",
                node_type="control",
                values={
                    "branches": [
                        {
                            "id": "branch_0",
                            "type": "case",
                            "label": "",
                            "conditions": [
                                {
                                    "id": "cond-1",
                                    "type": "expression",
                                    "expression": "code == 200",
                                }
                            ],
                            "break": True,
                        }
                    ]
                },
            ),
            make_node("node-2"),
        ]
        edges = [
            make_edge("start-node", "switch-1"),
            make_edge("switch-1", "node-2", source_handle="case_hit"),
        ]
        test_data = make_test_data(nodes, edges)
        assert_inexpressible(test_data)
        readback = decompile(test_data)
        assert any(item["where"] == "node-2" for item in readback["inexpressible"])


class TestReadbackDetails:
    """Readback branches over hand-built graphs: profile bindings, expression
    variables, and defensive handling of malformed stored data (a readback is
    best-effort and never destructive)."""

    def test_expression_variable_survives_readback(self) -> None:
        recipe = make_recipe(
            [LOG_STEP], variables={"doubled": {"type": "integer", "expr": "1 + 1"}}
        )
        test_data = compile_clean(recipe)["test_data"]
        readback = yaml.safe_load(decompile(test_data)["recipe"])
        assert readback["variables"]["doubled"] == {"type": "integer", "expr": "1 + 1"}

    def test_a_template_variable_reads_back_as_its_template(self) -> None:
        # REQ-3.1.3.15, REQ-5.2.7.6: the kind survives the round trip.
        test_data = make_test_data([make_node("node-1")], [make_edge("start-node", "node-1")])
        test_data["variables"] = {
            "n": {"type": "integer", "value": 3},
            "label": {"type": "string", "isTemplate": True, "value": "id-{{ n }}"},
        }
        readback = yaml.safe_load(decompile(test_data)["recipe"])
        assert readback["variables"]["label"] == {"type": "string", "template": "id-{{ n }}"}

    def test_a_secret_template_variable_reads_back_without_its_source(self) -> None:
        test_data = make_test_data([make_node("node-1")], [make_edge("start-node", "node-1")])
        test_data["variables"] = {
            "label": {
                "type": "string",
                "secret": True,
                "isTemplate": True,
                "value": "canary-{{ n }}",
            },
        }
        readback = decompile(test_data)["recipe"]
        assert "canary-" not in readback
        assert yaml.safe_load(readback)["variables"]["label"] == {"type": "string", "secret": True}

    def test_block_profile_bindings_skip_non_dict_entries(self) -> None:
        node = make_node("node-1")
        node["data"]["config"]["profileBindings"] = [
            {"profileName": "db-prod", "alias": "db", "fields": ["host"]},
            "not-a-binding",
        ]
        recipe = yaml.safe_load(
            decompile(make_test_data([node], [make_edge("start-node", "node-1")]))["recipe"]
        )
        assert recipe["flow"][0]["profiles"] == [
            {"profile": "db-prod", "alias": "db", "fields": ["host"]}
        ]

    @pytest.mark.parametrize("values", [None, ["message"]], ids=["null", "a-list"])
    def test_a_block_whose_values_are_no_map_reads_back_with_no_settings(self, values: Any) -> None:
        node = make_node("node-1")
        node["data"]["label"] = "Log"
        node["data"]["config"]["values"] = values

        readback = decompile(make_test_data([node], [make_edge("start-node", "node-1")]))

        assert yaml.safe_load(readback["recipe"])["flow"] == [{"block": "log"}]
        assert (readback["expressible"], readback["inexpressible"]) == (True, [])

    def test_string_condition_reads_back_as_the_expression(self) -> None:
        if_node = make_node(
            "if-1",
            element_type="if-else",
            node_type="control",
            values={"branches": [{"id": "branch_0", "type": "if", "conditions": ["x == 1"]}]},
        )
        leaf = make_node("leaf-1")
        edges = [
            make_edge("start-node", "if-1"),
            make_edge("if-1", "leaf-1", source_handle="branch_0"),
        ]
        recipe = yaml.safe_load(decompile(make_test_data([if_node, leaf], edges))["recipe"])
        assert recipe["flow"][0]["if"]["when"] == "x == 1"

    def test_edge_to_a_missing_target_is_walked_cleanly(self) -> None:
        nodes = [make_node("node-1")]
        edges = [make_edge("start-node", "node-1"), make_edge("node-1", "ghost-target")]
        readback = decompile(make_test_data(nodes, edges))
        assert readback["expressible"] is True
        assert yaml.safe_load(readback["recipe"])["flow"][0]["block"] == "log"

    def test_non_dict_variable_declaration_is_dropped(self) -> None:
        test_data = make_test_data([make_node("node-1")], [make_edge("start-node", "node-1")])
        test_data["variables"] = {
            "good": {"type": "string", "value": "ok"},
            "bad": "not-a-declaration",
        }
        recipe = yaml.safe_load(decompile(test_data)["recipe"])
        assert "good" in recipe["variables"]
        assert "bad" not in recipe["variables"]

    def test_a_dotted_map_entry_reads_back_as_a_nested_expression(self) -> None:
        node = make_node(
            "node-1",
            element_type="http-client",
            values={"url": "http://x", "method": "GET", "headers": {"Authorization": "tok"}},
        )
        node["data"]["expressionFields"] = ["headers.Authorization"]
        recipe = yaml.safe_load(
            decompile(make_test_data([node], [make_edge("start-node", "node-1")]))["recipe"]
        )
        assert recipe["flow"][0]["settings"]["headers"] == {"Authorization": {"expr": "tok"}}

    def test_a_dotted_row_field_reads_back_as_a_nested_expression(self) -> None:
        node = make_node(
            "node-1",
            element_type="shell-script",
            values={
                "script": "echo hi",
                "arguments": [{"value": "--env"}, {"value": "env_name"}],
            },
        )
        node["data"]["expressionFields"] = ["arguments.1.value"]
        recipe = yaml.safe_load(
            decompile(make_test_data([node], [make_edge("start-node", "node-1")]))["recipe"]
        )
        assert recipe["flow"][0]["settings"]["arguments"] == [
            {"value": "--env"},
            {"value": {"expr": "env_name"}},
        ]

    def test_a_dotted_part_field_reads_back_as_a_nested_expression(self) -> None:
        node = make_node(
            "node-1",
            element_type="http-client",
            values={
                "url": "http://x",
                "method": "POST",
                "parts": [{"kind": "text", "name": "comment", "value": "note"}],
            },
        )
        node["data"]["expressionFields"] = ["parts.0.value"]
        recipe = yaml.safe_load(
            decompile(make_test_data([node], [make_edge("start-node", "node-1")]))["recipe"]
        )
        assert recipe["flow"][0]["settings"]["parts"] == [
            {"kind": "text", "name": "comment", "value": {"expr": "note"}}
        ]

    def test_readback_carries_no_layout_residue(self) -> None:
        step = {
            "block": "log",
            "label": "Write push file on sshd host",
            "settings": {"message": "hi"},
        }
        test_data = compile_clean(make_recipe([step]))["test_data"]
        assert test_data["workflow"]["nodes"][0]["width"] == 338
        recipe = yaml.safe_load(decompile(test_data)["recipe"])
        assert _all_keys(recipe).isdisjoint({"width", "height", "position"})


class TestReadbackNumbers:
    """A readback writes every number in plain digits, so applying it keeps the number."""

    def test_a_stored_float_in_any_magnitude_reads_back_in_plain_digits(self) -> None:
        flow = [{"for": {"count": 2, "timeout": 2.5, "body": [LOG_STEP]}}]
        test_data = compile_clean(make_recipe(flow))["test_data"]
        test_data["workflow"]["nodes"][0]["data"]["config"]["values"]["timeout"] = 1e-05
        test_data["variables"] = {"big": {"type": "float", "value": 1e20}}

        recipe = decompile(test_data)["recipe"]

        assert "e-05" not in recipe
        assert "e+20" not in recipe
        assert "timeout: 0.00001" in recipe
        assert "value: 100000000000000000000.0" in recipe

    def test_a_readback_of_exact_text_compiles_to_the_same_values(self) -> None:
        variables = {"ratio": {"type": "float", "value": "__ratio__"}}
        recipe = make_recipe([LOG_STEP], variables=variables).replace("__ratio__", "2.50")
        first = compile_clean(recipe)["test_data"]

        again = compile_clean(decompile(first)["recipe"])["test_data"]

        assert (
            again["variables"]
            == first["variables"]
            == {"ratio": {"type": "float", "value": "2.50"}}
        )


_HTTP_STEP: dict[str, Any] = {
    "block": "http-client",
    "settings": {"url": "http://x", "method": "GET"},
}


def _node_values(test_data: dict[str, Any], element_type: str) -> dict[str, Any]:
    node = next(
        node
        for node in test_data["workflow"]["nodes"]
        if node["data"]["elementType"] == element_type
    )
    values: dict[str, Any] = node["data"]["config"]["values"]
    return values


class TestReadbackOfNumberText:
    """A number stored as its exact digit text reads back as a plain YAML number written as
    stored; text that breaks the rule, and text in a text field, stays quoted (REQ-3.1.3.14)."""

    def stored_test(self) -> dict[str, Any]:
        flow = [
            {"delay": 30},
            _HTTP_STEP,
            {"for": {"count": 2, "timeout": 5, "body": [LOG_STEP]}},
        ]
        test_data = compile_clean(make_recipe(flow))["test_data"]
        _node_values(test_data, "delay")["duration"] = "30"
        _node_values(test_data, "http-client").update(
            retry_delay="2.50",
            retry_backoff_factor="0.0000001",
            max_size="1234567890123456789",
            timeout="+5",
        )
        _node_values(test_data, "for")["timeout"] = "30.0"
        _node_values(test_data, "log")["message"] = "30"
        test_data["variables"] = {
            "tiny": {"type": "float", "value": "0.0000001"},
            "big": {"type": "integer", "value": "1234567890123456789"},
            "code": {"type": "string", "value": "2.50"},
        }
        return test_data

    def test_digit_text_reads_back_unquoted_and_other_text_stays_quoted(self) -> None:
        recipe = decompile(self.stored_test())["recipe"]

        for line in (
            "- delay: 30\n",
            "retry_delay: 2.50\n",
            "retry_backoff_factor: 0.0000001\n",
            "max_size: 1234567890123456789\n",
            "timeout: '+5'\n",
            "timeout: 30.0\n",
            "message: '30'\n",
            "value: 0.0000001\n",
            "value: 1234567890123456789\n",
            "value: '2.50'\n",
        ):
            assert line in recipe

    def test_the_exact_loader_reads_the_readback_as_the_stored_numbers(self) -> None:
        from wavecore.core.number_rule import plain_number_text
        from wavecore.core.utf8_text import load_exact_yaml

        readback = load_exact_yaml(decompile(self.stored_test())["recipe"])
        http = readback["flow"][1]["settings"]

        assert [
            readback["flow"][0]["delay"],
            plain_number_text(http["retry_delay"]),
            plain_number_text(http["retry_backoff_factor"]),
            http["max_size"],
            plain_number_text(readback["flow"][2]["for"]["timeout"]),
            plain_number_text(readback["variables"]["tiny"]["value"]),
            readback["variables"]["big"]["value"],
        ] == [
            30,
            "2.50",
            "0.0000001",
            1234567890123456789,
            "30.0",
            "0.0000001",
            1234567890123456789,
        ]

    def test_function_defaults_and_typed_entries_read_back_as_numbers(self) -> None:
        functions = [
            {
                "name": "fn",
                "inputs": [
                    {"name": "rate", "type": "float", "default": "0.0000001"},
                    {"name": "ids", "type": "array", "default": ["7", "2.50"]},
                ],
                "outputs": [{"name": "total", "type": "integer", "default": "30"}],
                "flow": [LOG_STEP],
            }
        ]
        step = {"function": "fn", "settings": {"ids": ["8080", "30.0"]}}
        functions[0]["inputs"][1]["element_types"] = ["integer", "float"]
        step["element_types"] = {"ids": ["integer", "float"]}
        recipe = make_recipe([step], functions=functions)

        readback = yaml.safe_load(decompile(compile_clean(recipe)["test_data"])["recipe"])
        function = readback["functions"][0]

        assert [
            function["inputs"][0]["default"],
            function["inputs"][1]["default"],
            function["outputs"][0]["default"],
            readback["flow"][0]["settings"]["ids"],
        ] == [1e-07, [7, 2.5], 30, [8080, 30.0]]

    def test_a_readback_applied_again_stores_the_same_numbers(self) -> None:
        from wavecore.api.services.tests import service as test_service

        valid = self.stored_test()
        del _node_values(valid, "http-client")["timeout"]
        created = test_service.create_test(valid)
        stored = test_service._load_test(created["id"])
        assert stored is not None

        again = compile_clean(decompile(stored)["recipe"])["test_data"]
        test_service.update_test(
            created["id"], {"workflow": again["workflow"], "variables": again["variables"]}
        )
        restored = test_service._load_test(created["id"])
        assert restored is not None

        for element_type in ("http-client", "for", "log"):
            assert _node_values(restored, element_type) == _node_values(stored, element_type)
        assert restored["variables"] == stored["variables"]
        assert (_node_values(stored, "delay"), _node_values(restored, "delay")) == (
            {"duration": "30"},
            {"duration": 30},
        )


class TestElementTypesReadback:
    """A readback writes every element in its stored form with complete element_types
    (REQ-3.1.3.19), and compiling it again stores the same Test."""

    def recipe(self) -> str:
        variables = {
            "limits": {
                "type": "map",
                "value": {
                    "retries": 3,
                    "ratio": "1.0",
                    "big": "1234567890123456789",
                    "zip": "02134",
                },
                "element_types": {"ratio": "float", "big": "integer", "zip": "string"},
            },
            "ports": {
                "type": "array",
                "value": [8080, "1.0"],
                "element_types": ["integer", "float"],
            },
            "empty": {"type": "map", "value": {}},
            "built": {"type": "map"},
        }
        functions = [
            {
                "name": "fn",
                "inputs": [
                    {"name": "cfg", "type": "map", "default": {"n": 1}},
                    {"name": "none", "type": "array", "default": []},
                ],
                "outputs": [],
                "flow": [LOG_STEP],
            }
        ]
        flow = [
            {"set": {"built": {"n": "16"}}, "element_types": {"built": {"n": "integer"}}},
            {
                "block": "sql-client",
                "settings": {
                    "host": "db",
                    "database": "wave",
                    "username": "wave",
                    "sql": "SELECT 1",
                    "driver_options": {"timeout": "7"},
                },
                "element_types": {"driver_options": {"timeout": "integer"}},
            },
            {"function": "fn"},
        ]
        return make_recipe(flow, variables=variables, functions=functions)

    def test_the_readback_carries_every_element_type(self) -> None:
        readback = yaml.safe_load(decompile(compile_clean(self.recipe())["test_data"])["recipe"])
        assert readback["variables"]["limits"] == {
            "type": "map",
            "value": {
                "retries": 3,
                "ratio": 1.0,
                "big": 1234567890123456789,
                "zip": "02134",
            },
            "element_types": {
                "retries": "integer",
                "ratio": "float",
                "big": "integer",
                "zip": "string",
            },
        }
        assert readback["variables"]["ports"]["element_types"] == ["integer", "float"]
        assert readback["variables"]["empty"] == {"type": "map", "value": {}}
        assert readback["flow"][0]["element_types"] == {"built": {"n": "integer"}}
        assert readback["flow"][1]["element_types"] == {"driver_options": {"timeout": "integer"}}
        assert readback["functions"][0]["inputs"] == [
            {
                "name": "cfg",
                "type": "map",
                "default": {"n": 1},
                "element_types": {"n": "integer"},
            },
            {"name": "none", "type": "array", "default": []},
        ]

    def test_a_value_saved_without_element_types_reads_back_by_shape(self) -> None:
        test_data = compile_clean(make_recipe([LOG_STEP]))["test_data"]
        test_data["variables"] = {"m": {"type": "map", "value": {"n": "16", "j": "[1]"}}}
        readback = yaml.safe_load(decompile(test_data)["recipe"])
        assert readback["variables"]["m"]["element_types"] == {"n": "string", "j": "array"}

    def test_compiling_the_readback_stores_the_same_test(self) -> None:
        first = compile_clean(self.recipe())["test_data"]
        second = compile_clean(decompile(first)["recipe"])["test_data"]
        assert second["variables"] == first["variables"]
        assert _node_shapes(second) == _node_shapes(first)

    def test_a_sealed_secret_rows_element_types_stay_out_of_the_readback(self) -> None:
        test_data = compile_clean(self.recipe())["test_data"]
        setter = next(
            node
            for node in test_data["workflow"]["nodes"]
            if node["data"]["elementType"] == "variable-setter"
        )
        sealed = "wave:enc:v1:c2VhbGVkLXJvdw=="
        setter["data"]["elementTypes"]["variables.built"] = sealed
        setter["data"]["config"]["values"]["variables"]["built"] = sealed
        setter["data"]["config"]["secretFields"] = ["variables.built"]
        recipe = decompile(test_data)["recipe"]
        assert "element_types" not in yaml.safe_load(recipe)["flow"][0]
        assert sealed not in recipe


LOCAL_FUNCTION_VARIABLES: list[dict[str, Any]] = [
    {"id": "var-counter", "name": "counter", "type": "integer", "value": 5},
    {"id": "var-tmp_body", "name": "tmp_body", "type": "string"},
    {"id": "var-maybe", "name": "maybe", "type": "integer", "value": None},
]


def _local_definition(test_data: dict[str, Any]) -> dict[str, Any]:
    definition = _function_block(test_data)["data"]["localDefinition"]
    assert isinstance(definition, dict)
    return definition


def _without_ids(variables: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in item.items() if key != "id"} for item in variables]


class TestLocalFunctionVariablesReadback:
    """A local Function's own variables read back with it, so a readback that says
    expressible holds the whole Function (REQ-5.2.7.3)."""

    def stored_test(self, variables: list[dict[str, Any]]) -> dict[str, Any]:
        functions = [{"name": "tally", "inputs": [], "outputs": [], "flow": [LOG_STEP]}]
        recipe = make_recipe([{"function": "tally"}], functions=functions)
        test_data: dict[str, Any] = compile_clean(recipe)["test_data"]
        _local_definition(test_data)["variables"] = [dict(item) for item in variables]
        return test_data

    def test_the_readback_carries_the_functions_own_variables(self) -> None:
        readback = decompile(self.stored_test(LOCAL_FUNCTION_VARIABLES))
        assert readback["expressible"] is True
        (function,) = yaml.safe_load(readback["recipe"])["functions"]
        assert function["variables"] == {
            "counter": {"type": "integer", "value": 5},
            "tmp_body": {"type": "string"},
            "maybe": {"type": "integer", "value": None},
        }

    def test_an_expression_variable_reads_back_as_its_expression(self) -> None:
        variables = [
            {
                "id": "var-doubled",
                "name": "doubled",
                "type": "integer",
                "isExpression": True,
                "value": "2 * 2",
            }
        ]
        (function,) = yaml.safe_load(decompile(self.stored_test(variables))["recipe"])["functions"]
        assert function["variables"] == {"doubled": {"type": "integer", "expr": "2 * 2"}}

    def test_a_template_variable_reads_back_as_its_template(self) -> None:
        variables = [
            {
                "id": "var-label",
                "name": "label",
                "type": "string",
                "isTemplate": True,
                "value": "id-{{ counter }}",
            }
        ]
        (function,) = yaml.safe_load(decompile(self.stored_test(variables))["recipe"])["functions"]
        assert function["variables"] == {
            "label": {"type": "string", "template": "id-{{ counter }}"}
        }

    def test_a_secret_variable_reads_back_without_its_value(self) -> None:
        variables = [
            {
                "id": "var-api_key",
                "name": "api_key",
                "type": "string",
                "secret": True,
                "value": "local-hunter2",
            }
        ]
        readback = decompile(self.stored_test(variables))
        (function,) = yaml.safe_load(readback["recipe"])["functions"]
        assert function["variables"] == {"api_key": {"type": "string", "secret": True}}
        assert "local-hunter2" not in readback["recipe"]

    def test_compiling_the_readback_restores_the_functions_own_variables(self) -> None:
        first = self.stored_test(LOCAL_FUNCTION_VARIABLES)
        second = compile_clean(decompile(first)["recipe"])["test_data"]
        assert _without_ids(_local_definition(second)["variables"]) == _without_ids(
            LOCAL_FUNCTION_VARIABLES
        )


class TestTableReadback:
    """A table stored with its column types reads back in that form, and compiling the
    readback stores the same table (REQ-3.5.5.4)."""

    def test_a_stored_table_reads_back_and_compiles_to_the_same_value(self) -> None:
        grid = {
            "columns": [{"name": "id", "type": "integer"}, {"name": "price", "type": "float"}],
            "rows": [["7", "2.50"], [None, "3"]],
        }
        stored = compile_clean(make_recipe([LOG_STEP]))["test_data"]
        stored["variables"] = {"grid": {"type": "table", "value": grid}}
        again = compile_clean(decompile(stored)["recipe"])["test_data"]
        assert again["variables"]["grid"] == {
            "type": "table",
            "value": {"columns": grid["columns"], "rows": [[7, "2.50"], [None, 3]]},
        }


STORED_OUTPUT_KINDS = [
    pytest.param(
        {"name": "size", "type": "integer", "isExpression": True, "default": "len(url)"},
        {"name": "size", "type": "integer", "expr": "len(url)"},
        id="expression",
    ),
    pytest.param(
        {"name": "label", "type": "string", "isTemplate": True, "default": "id-{{ url }}"},
        {"name": "label", "type": "string", "template": "id-{{ url }}"},
        id="template",
    ),
]


class TestFunctionOutputKindReadback:
    """An output's kind reads back in the recipe form that wrote it (REQ-3.1.2.8, REQ-5.2.7.6)."""

    @staticmethod
    def stored_test(outputs: list[dict[str, Any]]) -> dict[str, Any]:
        functions = [
            {
                "name": "measure",
                "inputs": [{"name": "url", "type": "string", "required": True}],
                "outputs": [],
                "flow": [LOG_STEP],
            }
        ]
        flow = [{"function": "measure", "settings": {"url": "http://shop.local"}}]
        test_data: dict[str, Any] = compile_clean(make_recipe(flow, functions=functions))[
            "test_data"
        ]
        _local_definition(test_data)["outputs"] = [dict(item) for item in outputs]
        return test_data

    @pytest.mark.parametrize(("stored", "written"), STORED_OUTPUT_KINDS)
    def test_an_output_kind_reads_back_as_written(
        self, stored: dict[str, Any], written: dict[str, Any]
    ) -> None:
        (function,) = yaml.safe_load(decompile(self.stored_test([stored]))["recipe"])["functions"]
        assert function["outputs"] == [written]

    def test_compiling_the_readback_stores_the_same_outputs(self) -> None:
        stored = [
            {"name": "size", "type": "integer", "isExpression": True, "default": "len(url)"},
            {"name": "label", "type": "string", "isTemplate": True, "default": "id-{{ url }}"},
            {"name": "note", "type": "string", "default": "none"},
        ]
        first = self.stored_test(stored)
        readback = decompile(first)["recipe"]
        assert _all_keys(yaml.safe_load(readback)) & {"isExpression", "isTemplate"} == set()
        second = compile_clean(readback)["test_data"]
        assert _local_definition(second)["outputs"] == stored


DECLARED_INPUTS: list[dict[str, Any]] = [
    {
        "name": "level",
        "type": "string",
        "required": True,
        "enumValues": ["low", "high"],
        "default": "low",
    },
    {
        "name": "port",
        "type": "integer",
        "required": True,
        "default": 80,
        "description": "Service port",
    },
]


def declared_inputs_recipe() -> str:
    functions = [{"name": "probe", "inputs": DECLARED_INPUTS, "outputs": [], "flow": [LOG_STEP]}]
    step = {"function": "probe", "settings": {"level": "high", "port": 8080}}
    return make_recipe([step], functions=functions)


class TestFunctionInputDeclarationReadback:
    """An enum input and a Required input's default read back as stored, and the readback
    compiles to the same declaration (REQ-3.1.2.10, REQ-3.1.2.11, REQ-5.2.7.6)."""

    def test_a_stored_declaration_reads_back_as_written(self) -> None:
        recipe = make_recipe(
            [{"function": "probe"}],
            functions=[{"name": "probe", "inputs": [], "outputs": [], "flow": [LOG_STEP]}],
        )
        test_data: dict[str, Any] = compile_clean(recipe)["test_data"]
        _local_definition(test_data)["inputs"] = [dict(item) for item in DECLARED_INPUTS]
        (function,) = yaml.safe_load(decompile(test_data)["recipe"])["functions"]
        assert function["inputs"] == DECLARED_INPUTS

    def test_a_compiled_declaration_reads_back_identical(self) -> None:
        first = compile_clean(declared_inputs_recipe())["test_data"]
        readback = decompile(first)["recipe"]
        (function,) = yaml.safe_load(readback)["functions"]
        assert function["inputs"] == DECLARED_INPUTS
        second = compile_clean(readback)["test_data"]
        assert _local_definition(second)["inputs"] == DECLARED_INPUTS

    def test_the_declaration_round_trips(self) -> None:
        assert_round_trip(declared_inputs_recipe())


class TestNullCheckReadback:
    """A null check takes no value, so its readback writes none (REQ-3.1.3.25, REQ-5.2.7.6)."""

    @pytest.mark.parametrize("operator", ["is_null", "is_not_null"])
    def test_a_null_check_reads_back_with_no_value(self, operator: str) -> None:
        when = {"variable": "x", "operator": operator, "value_type": "integer"}
        flow = [{"if": {"when": when, "then": [LOG_STEP]}}]
        steps = readback_flow(flow, {"x": {"type": "integer", "value": 3}})
        assert steps[0]["if"]["when"] == when

    @pytest.mark.parametrize("operator", ["is_null", "is_not_null", "is_empty"])
    def test_a_value_given_to_an_operator_that_takes_none_reads_back_as_none(
        self, operator: str
    ) -> None:
        flow = [{"assert": {"that": [{"variable": "grid", "operator": operator, "value": ""}]}}]
        steps = readback_flow(flow, {"grid": {"type": "table"}})
        assert steps[0]["assert"]["that"] == [
            {"variable": "grid", "operator": operator, "value_type": "table"}
        ]

    def test_a_filter_row_given_a_value_on_is_null_reads_back_with_none(self) -> None:
        row = {
            "id": "r1",
            "type": "literal",
            "variable": "_cell",
            "value_type": "string",
            "operator": "is_null",
            "reference_value": "",
            "reference_is_expression": False,
        }
        step = {
            "block": "csv-parser",
            "settings": {
                "operation": "parse",
                "csv_content": "name\nann\n",
                "filters": [
                    {
                        "id": "f1",
                        "column": {"mode": "name", "value": "name"},
                        "asType": "string",
                        "conditions": [row],
                    }
                ],
            },
        }
        steps = readback_flow([step])
        assert steps[0]["settings"]["filters"][0]["conditions"] == [
            {key: value for key, value in row.items() if not key.startswith("reference_")}
        ]

    def test_a_stored_filter_row_holding_a_value_on_not_null_reads_back_with_none(self) -> None:
        row = {
            "id": "r1",
            "type": "literal",
            "variable": "_cell",
            "value_type": "string",
            "operator": "is_not_null",
        }
        stored = {**row, "reference_value": "", "reference_is_template": True}
        filters = [
            {
                "id": "f1",
                "column": {"mode": "name", "value": "name"},
                "asType": "string",
                "conditions": [stored],
            }
        ]
        values = {"operation": "parse", "csv_content": "name\nann\n", "filters": filters}
        node = make_node("csv-1", element_type="csv-parser", values=values)

        step = first_step(readback_of([node], [make_edge("start-node", "csv-1")]))

        assert step["settings"]["filters"][0]["conditions"] == [row]

    def test_an_assert_null_check_round_trips(self) -> None:
        flow = [
            {
                "assert": {
                    "that": [{"variable": "grid", "operator": "is_null", "value_type": "table"}]
                }
            }
        ]
        variables = {"grid": {"type": "table"}}
        steps = readback_flow(flow, variables)
        assert steps[0]["assert"]["that"] == [
            {"variable": "grid", "operator": "is_null", "value_type": "table"}
        ]
        assert_round_trip(make_recipe(flow, variables=variables))


SECRET_OUTPUT_FUNCTION: dict[str, Any] = {
    "name": "issue",
    "inputs": [],
    "outputs": [
        {"name": "token", "type": "string", "secret": True},
        {"name": "status", "type": "integer"},
    ],
    "flow": [LOG_STEP],
}


def _function_block(test_data: dict[str, Any]) -> dict[str, Any]:
    block: dict[str, Any] = next(
        node for node in test_data["workflow"]["nodes"] if node["data"]["elementType"] == "function"
    )
    return block


class TestFunctionStepSecretOutputsReadback:
    """A Function step's Secret outputs read back only when they differ from what its Function
    declares secret, and a compile of the readback holds the same choice (SECUI-11)."""

    @staticmethod
    def stored_test(**step: Any) -> dict[str, Any]:
        flow = [{"function": "issue", "capture": {"token": "tok"}, **step}]
        test_data: dict[str, Any] = compile_clean(
            make_recipe(flow, functions=[SECRET_OUTPUT_FUNCTION])
        )["test_data"]
        return test_data

    def test_the_declared_choice_reads_back_with_no_key(self) -> None:
        (step,) = yaml.safe_load(decompile(self.stored_test())["recipe"])["flow"]
        assert "secret_outputs" not in step

    @pytest.mark.parametrize("marked", [[], ["status"], ["token", "status"]])
    def test_another_choice_reads_back_and_compiles_to_the_same_list(
        self, marked: list[str]
    ) -> None:
        first = self.stored_test(secret_outputs=marked)
        readback = decompile(first)["recipe"]
        (step,) = yaml.safe_load(readback)["flow"]
        assert step["secret_outputs"] == marked
        second = compile_clean(readback)["test_data"]
        assert _function_block(second)["data"]["config"]["outputSecretFields"] == marked

    def test_a_renamed_secret_output_whose_mark_moved_reads_back_with_no_key(self) -> None:
        # The stored shape after an output rename that moves the mark with it (REQ-3.1.2.9).
        test_data = self.stored_test()
        _local_definition(test_data)["outputs"][0]["name"] = "access_token"
        config = _function_block(test_data)["data"]["config"]
        config["outputBindings"] = {"access_token": "tok"}
        config["outputSecretFields"] = ["access_token"]
        readback = decompile(test_data)["recipe"]
        (step,) = yaml.safe_load(readback)["flow"]
        assert step["capture"] == {"access_token": "tok"}
        assert "secret_outputs" not in step
        second = compile_clean(readback)["test_data"]
        # No stored list means the Function's own Secret boxes, the same choice.
        assert "outputSecretFields" not in _function_block(second)["data"]["config"]
        assert second["variables"]["tok"] == {"type": "string", "secret": True}

    def test_a_library_function_step_compares_with_its_version(self) -> None:
        create_library_function(
            "issue_remote",
            outputs=[{"name": "token", "type": "string", "secret": True, "description": ""}],
        )
        flow = [{"function": "issue_remote", "version": "1.0.0"}]
        test_data = compile_clean(make_recipe(flow))["test_data"]
        (step,) = yaml.safe_load(decompile(test_data)["recipe"])["flow"]
        assert "secret_outputs" not in step
        _function_block(test_data)["data"]["config"]["outputSecretFields"] = []
        (step,) = yaml.safe_load(decompile(test_data)["recipe"])["flow"]
        assert step["secret_outputs"] == []

    def test_a_library_function_step_whose_version_is_gone_reads_back_its_list(self) -> None:
        create_library_function("issue_remote")
        flow = [{"function": "issue_remote", "version": "1.0.0"}]
        test_data = compile_clean(make_recipe(flow))["test_data"]
        data = _function_block(test_data)["data"]
        data["functionVersion"] = "9.9.9"
        data["config"]["outputSecretFields"] = []
        (step,) = yaml.safe_load(decompile(test_data)["recipe"])["flow"]
        assert step["secret_outputs"] == []


FETCH_STATUS_FUNCTION: dict[str, Any] = {
    "name": "fetch_status",
    "inputs": [{"name": "url", "type": "string", "required": True}],
    "outputs": [{"name": "status", "type": "integer"}],
    "flow": [{"block": "log", "settings": {"message": "in fn"}}],
}
FORMS_FUNCTION: dict[str, Any] = {
    "name": "shape",
    "inputs": [
        {"name": "note", "type": "string"},
        {"name": "headers", "type": "map", "default": {}},
        {"name": "tags", "type": "array", "default": []},
    ],
    "outputs": [],
    "flow": [LOG_STEP],
}
RUN_ID: dict[str, Any] = {"run_id": {"type": "string", "value": "r-1"}}


def seed_fetch_remote() -> None:
    create_library_function(
        "fetch_remote",
        version="1.2.0",
        inputs=[{"name": "host", "type": "string", "required": True, "default": None}],
        outputs=[{"name": "result", "type": "string", "description": ""}],
    )


def readback_steps(recipe: str) -> list[Any]:
    steps = yaml.safe_load(decompile(compile_clean(recipe)["test_data"])["recipe"])["flow"]
    assert isinstance(steps, list)
    return steps


class TestFunctionStepReadback:
    """A Function Block reads back as a `function` step in the block step form, with its
    settings, element types, capture, label and version (REQ-5.2.7.6, REQ-3.1.3.19)."""

    def test_a_local_function_block_reads_back_as_a_function_step(self) -> None:
        step = {
            "function": "fetch_status",
            "settings": {"url": {"expr": "base + '/health'"}},
            "capture": {"status": "health_status"},
        }
        variables = {"base": {"type": "string", "value": "http://shop.local"}}
        recipe = make_recipe([step], variables=variables, functions=[FETCH_STATUS_FUNCTION])
        assert readback_steps(recipe) == [step]

    def test_the_readback_carries_no_call_form(self) -> None:
        step = {"function": "fetch_status", "settings": {"url": "http://x"}}
        recipe = make_recipe([step], functions=[FETCH_STATUS_FUNCTION])
        readback = yaml.safe_load(decompile(compile_clean(recipe)["test_data"])["recipe"])
        assert "call" not in _all_keys(readback)
        assert "inputs" not in readback["flow"][0]

    def test_a_label_reads_back_beside_the_function_name(self) -> None:
        step = {"function": "fetch_status", "label": "Check health", "settings": {"url": "u"}}
        recipe = make_recipe([step], functions=[FETCH_STATUS_FUNCTION])
        assert readback_steps(recipe) == [step]

    def test_a_library_function_block_reads_back_with_its_version(self) -> None:
        seed_fetch_remote()
        step = {
            "function": "fetch_remote",
            "version": "1.2.0",
            "settings": {"host": "myhost.local"},
            "capture": {"result": "r"},
        }
        assert readback_steps(make_recipe([step])) == [step]

    def test_a_library_function_block_label_reads_back_beside_its_name(self) -> None:
        seed_fetch_remote()
        step = {
            "function": "fetch_remote",
            "version": "1.2.0",
            "label": "Check remote",
            "settings": {"host": "h"},
        }
        assert readback_steps(make_recipe([step])) == [step]

    def test_every_setting_form_reads_back_in_its_stored_form(self) -> None:
        step = {
            "function": "shape",
            "settings": {
                "note": "id-{{ run_id }}",
                "headers": {"X-Id": {"expr": "run_id"}, "Accept": "json"},
                "tags": [8080, "1.0"],
            },
            "element_types": {"tags": ["integer", "float"]},
        }
        recipe = make_recipe([step], variables=RUN_ID, functions=[FORMS_FUNCTION])
        (readback,) = readback_steps(recipe)
        assert readback == {
            "function": "shape",
            "settings": {
                "note": "id-{{ run_id }}",
                "headers": {"X-Id": {"expr": "run_id"}, "Accept": "json"},
                "tags": [8080, 1.0],
            },
            "element_types": {"headers": {"Accept": "string"}, "tags": ["integer", "float"]},
        }
        assert_round_trip(recipe)

    def test_a_list_item_expression_reads_back_as_an_expression(self) -> None:
        step = {"function": "shape", "settings": {"tags": [{"expr": "run_id"}, "b"]}}
        recipe = make_recipe([step], variables=RUN_ID, functions=[FORMS_FUNCTION])
        (readback,) = readback_steps(recipe)
        assert readback["settings"] == {"tags": [{"expr": "run_id"}, "b"]}
        assert_round_trip(recipe)


PROBE_INPUTS: list[dict[str, Any]] = [
    {
        "name": "level",
        "type": "string",
        "required": True,
        "enumValues": ["low", "high"],
        "default": "low",
    },
    {"name": "strict", "type": "boolean", "required": True, "default": True},
    {"name": "verbose", "type": "boolean", "default": False},
    {"name": "note", "type": "string", "default": "hi"},
]


def probe_recipe(settings: dict[str, Any] | None = None) -> str:
    step: dict[str, Any] = {"function": "probe"}
    if settings is not None:
        step["settings"] = settings
    functions = [{"name": "probe", "inputs": PROBE_INPUTS, "outputs": [], "flow": [LOG_STEP]}]
    return make_recipe([step], functions=functions)


def hand_built_settings(element_type: str, values: dict[str, Any]) -> Any:
    node = make_node("node-1", element_type=element_type, values=values)
    test_data = make_test_data([node], [make_edge("start-node", "node-1")])
    return yaml.safe_load(decompile(test_data)["recipe"])["flow"][0]["settings"]


class TestChoiceValueReadback:
    """A readback writes every choice and true / false value a Block holds, one equal to
    its default included, and only the free-entry settings the Block holds (REQ-5.2.7.6)."""

    def test_a_choice_the_step_left_out_reads_back_written(self) -> None:
        assert readback_flow([LOG_STEP]) == [LOG_READBACK]

    def test_every_choice_and_true_false_value_reads_back_beside_the_given_settings(
        self,
    ) -> None:
        step = {"block": "http-client", "settings": {"url": "http://shop.local"}}
        assert readback_flow([step]) == [with_creation_values(step, HTTP_CREATION_VALUES)]

    def test_a_stored_choice_equal_to_its_default_reads_back(self) -> None:
        values = {"message": "m", "level": "INFO"}
        assert hand_built_settings("log", values) == values

    def test_a_free_entry_setting_the_block_does_not_hold_stays_out(self) -> None:
        values = {"url": "http://x", "method": "GET"}
        assert hand_built_settings("http-client", values) == values

    def test_a_function_block_reads_back_the_choice_values_written_for_it(self) -> None:
        assert readback_steps(probe_recipe()) == [
            {"function": "probe", "settings": {"level": "low", "strict": True, "verbose": False}}
        ]

    def test_a_function_block_choice_the_step_gave_reads_back_as_given(self) -> None:
        (step,) = readback_steps(probe_recipe({"level": "high", "note": "x"}))
        assert step["settings"] == {"level": "high", "strict": True, "verbose": False, "note": "x"}


class TestArgumentRowReadback:
    """Argument lists keep their stored record rows, each row's expression included, at
    compile and at readback (REQ-5.2.7.6)."""

    def test_script_arguments_are_record_rows(self) -> None:
        arguments = [{"value": "--env"}, {"value": {"expr": "env_name"}}]
        step = {"block": "shell-script", "settings": {"script": "echo $1", "arguments": arguments}}
        variables = {"env_name": {"type": "string", "value": "staging"}}
        data = compile_clean(make_recipe([step], variables=variables))["test_data"]["workflow"][
            "nodes"
        ][0]["data"]
        assert data["config"]["values"]["arguments"] == [{"value": "--env"}, {"value": "env_name"}]
        assert data["expressionFields"] == ["arguments.1.value"]
        assert readback_flow([step], variables)[0]["settings"]["arguments"] == arguments

    def test_sql_out_arguments_keep_the_row_expression_form(self) -> None:
        out_arguments = [{"value": "total"}, {"value": {"expr": "out_name"}}]
        step = {
            "block": "sql-client",
            "settings": {
                "host": "db",
                "database": "wave",
                "username": "wave",
                "operation": "call_procedure",
                "procedure": "app.totals",
                "out_arguments": out_arguments,
            },
        }
        variables = {"out_name": {"type": "string", "value": "count"}}
        (readback,) = readback_flow([step], variables)
        assert readback["settings"]["out_arguments"] == out_arguments


def _block_node(test_data: dict[str, Any]) -> dict[str, Any]:
    node: dict[str, Any] = next(
        node for node in test_data["workflow"]["nodes"] if node["id"] == "node-1"
    )
    return node


class TestBlockSecretOutputsReadback:
    """A block's Secret outputs read back only when they differ from its schema's boxes, and
    a compile of the readback stores the same choice (SECUI-4, K8SCON-4)."""

    @staticmethod
    def stored_test(**extra: Any) -> dict[str, Any]:
        step = {
            "block": "k8s-connect",
            "settings": {"api_url": "https://k8s.local"},
            "capture": {"session": "kube"},
            **extra,
        }
        test_data: dict[str, Any] = compile_clean(make_recipe([step]))["test_data"]
        return test_data

    @staticmethod
    def readback_step(test_data: dict[str, Any]) -> dict[str, Any]:
        (step,) = yaml.safe_load(decompile(test_data)["recipe"])["flow"]
        assert isinstance(step, dict)
        return step

    def test_no_stored_list_reads_back_with_no_key(self) -> None:
        assert "secret_outputs" not in self.readback_step(self.stored_test())

    def test_the_schema_choice_reads_back_with_no_key(self) -> None:
        test_data = self.stored_test(secret_outputs=["session"])
        assert "secret_outputs" not in self.readback_step(test_data)

    @pytest.mark.parametrize("marked", [[], ["cluster_version"], ["session", "cluster_version"]])
    def test_another_choice_reads_back_and_compiles_to_the_same_list(
        self, marked: list[str]
    ) -> None:
        first = self.stored_test(secret_outputs=marked)
        readback = decompile(first)["recipe"]
        (step,) = yaml.safe_load(readback)["flow"]
        assert step["secret_outputs"] == marked
        second = compile_clean(readback)["test_data"]
        assert _block_node(second)["data"]["config"]["outputSecretFields"] == marked

    def test_a_declared_script_variable_reads_back(self) -> None:
        step = {
            "block": "shell-script",
            "settings": {"script": "TOKEN=x", "script_variables": ["TOKEN"]},
            "capture": {"TOKEN": "tok"},
            "secret_outputs": ["TOKEN"],
        }
        test_data = compile_clean(make_recipe([step]))["test_data"]
        assert self.readback_step(test_data)["secret_outputs"] == ["TOKEN"]

    def test_a_name_the_block_no_longer_has_is_left_out(self) -> None:
        test_data = self.stored_test()
        _block_node(test_data)["data"]["config"]["outputSecretFields"] = ["session", "gone"]
        assert "secret_outputs" not in self.readback_step(test_data)


# ---------------------------------------------------------------------------
# Control fields, value forms and the field-loss report (REQ-5.2.7.6)
# ---------------------------------------------------------------------------


def _strip_ids(value: Any) -> Any:
    """Stored values with every generated id left out (condition, branch and lane ids)."""
    if isinstance(value, dict):
        return {key: _strip_ids(inner) for key, inner in value.items() if key != "id"}
    if isinstance(value, list):
        return [_strip_ids(item) for item in value]
    return value


def _control_fields(test_data: dict[str, Any]) -> list[dict[str, Any]]:
    """What a person sets on each Block, in flow order; ids and layout left out."""
    fields: list[dict[str, Any]] = []
    for node in test_data["workflow"]["nodes"]:
        data = node["data"]
        config = data.get("config") or {}
        fields.append(
            {
                "elementType": data.get("elementType"),
                "values": _strip_ids(config.get("values")),
                "outputBindings": config.get("outputBindings"),
                "secretFields": config.get("secretFields"),
                "expressionFields": sorted(data.get("expressionFields") or []),
                "templateFields": sorted(data.get("templateFields") or []),
                "elementTypes": data.get("elementTypes"),
                "label": data.get("label"),
                "description": data.get("description"),
                "disabled": data.get("disabled"),
            }
        )
    return fields


def assert_fields_round_trip(recipe_text: str) -> dict[str, Any]:
    """Compile, read back, compile: the readback is expressible and keeps every field."""
    first = compile_clean(recipe_text)["test_data"]
    fields = _control_fields(first)
    assert [field["elementType"] for field in fields if field["values"] is None] == []
    readback = decompile(first)
    assert readback["inexpressible"] == []
    assert readback["expressible"] is True
    second = compile_clean(readback["recipe"])["test_data"]
    assert _control_fields(second) == fields
    return readback


def readback_of(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    test_data = make_test_data(nodes, edges)
    if variables is not None:
        test_data["variables"] = variables
    return decompile(test_data)


def first_step(readback: dict[str, Any]) -> Any:
    return yaml.safe_load(readback["recipe"])["flow"][0]


def control_node(node_id: str, element_type: str, label: str, **values: Any) -> dict[str, Any]:
    node = make_node(node_id, element_type=element_type, node_type="control", values=values)
    node["data"]["label"] = label
    return node


def log_node(node_id: str, **values: Any) -> dict[str, Any]:
    node = make_node(node_id, values=values)
    node["data"]["label"] = "Log"
    return node


def setter_node(variables: dict[str, Any], **data: Any) -> dict[str, Any]:
    """A Variable Setter on the shared stored shape: dotted flags, one secret mark."""
    node = control_node("set-1", "variable-setter", "Variable Setter", variables=variables)
    secret_fields = data.pop("secretFields", None)
    node["data"].update(data)
    if secret_fields is not None:
        node["data"]["config"]["secretFields"] = secret_fields
    return node


def readback_setter(node: dict[str, Any]) -> dict[str, Any]:
    return readback_of([node], [make_edge("start-node", "set-1")])


def expression_item(item_id: str, text: str) -> dict[str, Any]:
    return {"id": item_id, "type": "expression", "expression": text}


def comparison_item(
    variable: str, operator: str, value: Any, value_type: str, **flags: Any
) -> dict[str, Any]:
    return {
        "id": f"cond-{variable}",
        "type": "literal",
        "variable": variable,
        "operator": operator,
        "value_type": value_type,
        "reference_value": value,
        **flags,
    }


AND_ITEM: dict[str, Any] = {"type": "operator", "value": "and"}
OR_ITEM: dict[str, Any] = {"type": "operator", "value": "or"}

ROUND_TRIP_VARIABLES: dict[str, Any] = {
    "x": {"type": "integer", "value": 1},
    "limit": {"type": "integer", "value": 3},
    "probe_ms": {"type": "integer", "value": 100},
    "counter": {"type": "integer", "value": 0},
    "transport": {"type": "string", "value": "TCP"},
    "prefix": {"type": "string", "value": "web"},
    "pod_phase": {"type": "string", "value": ""},
    "banner": {"type": "string", "value": ""},
    "hosts": {"type": "array", "value": ["alpha", "beta"]},
    "headers": {"type": "map", "value": {}},
}

CONTROL_FIELD_FLOWS = [
    pytest.param(
        [
            {
                "if": {
                    "label": "Route",
                    "description": "Pick the path",
                    "disabled": True,
                    "if_label": "Fast",
                    "when": [
                        "x == 1",
                        "or",
                        {
                            "group": [
                                "x > 2",
                                {
                                    "variable": "transport",
                                    "operator": "equals",
                                    "value": {"expr": "prefix"},
                                },
                            ]
                        },
                    ],
                    "then": [LOG_STEP],
                    "elif": [
                        {
                            "label": "Templated",
                            "when": {
                                "variable": "transport",
                                "operator": "equals",
                                "value": "{{ prefix }}-1",
                            },
                            "then": [LOG_STEP],
                        },
                        {
                            "when": [
                                {
                                    "variable": "transport",
                                    "operator": "starts_with",
                                    "value": {"template": "web"},
                                },
                                {
                                    "variable": "transport",
                                    "operator": "contains",
                                    "value": {"literal": "{{ raw }}"},
                                },
                            ],
                            "then": [LOG_STEP],
                        },
                    ],
                    "else_label": "Other",
                    "else": [LOG_STEP],
                }
            },
            LOG_STEP,
        ],
        id="if",
    ),
    pytest.param(
        [
            {
                "switch": {
                    "label": "By code",
                    "description": "Route on the code",
                    "cases": [
                        {"label": "One", "when": "x == 1", "steps": [LOG_STEP], "break": False},
                        {"when": ["x == 2", "or", "x == 3"], "steps": [LOG_STEP]},
                        {
                            "label": "At the limit",
                            "when": {
                                "variable": "x",
                                "operator": "equals",
                                "value": {"expr": "limit"},
                            },
                            "steps": [LOG_STEP],
                        },
                    ],
                    "default_label": "Rest",
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ],
        id="switch",
    ),
    pytest.param(
        [
            {
                "for": {
                    "label": "Count up",
                    "description": "Every other ping",
                    "count": {"expr": "limit"},
                    "step": 2,
                    "timeout": 30,
                    "capture": {"index": "i"},
                    "body": [LOG_STEP],
                }
            },
            LOG_STEP,
        ],
        id="for-count",
    ),
    pytest.param(
        [
            {"for": {"count": 6, "step": {"expr": "x"}, "disabled": True, "body": [LOG_STEP]}},
            LOG_STEP,
        ],
        id="for-count-step-expression",
    ),
    pytest.param(
        [
            {
                "for": {
                    "description": "Even ticks",
                    "range": {"start": {"expr": "x"}, "end": 10, "step": 2},
                    "body": [LOG_STEP],
                }
            },
            LOG_STEP,
        ],
        id="for-range",
    ),
    pytest.param(
        [
            {
                "for_each": {
                    "description": "Each host",
                    "collection": {"expr": "hosts"},
                    "collection_type": "array",
                    "timeout": 15,
                    "capture": {"item": "current", "index": "i"},
                    "body": [LOG_STEP],
                }
            },
            LOG_STEP,
        ],
        id="for-each",
    ),
    pytest.param(
        [{"for_each": {"description": "By name", "collection": "hosts", "body": [LOG_STEP]}}],
        id="for-each-by-name",
    ),
    pytest.param(
        [
            {
                "while": {
                    "label": "Retry",
                    "description": "Until the limit",
                    "conditions": {
                        "variable": "counter",
                        "operator": "less_than",
                        "value": {"expr": "limit"},
                    },
                    "mode": "do-while",
                    "max_iterations": {"expr": "limit"},
                    "timeout": 30,
                    "body": [{"set": {"counter": {"expr": "counter + 1"}}}],
                }
            }
        ],
        id="while",
    ),
    pytest.param(
        [
            {
                "while": {
                    "description": "Grouped",
                    "conditions": ["counter < 5", "or", {"group": ["x == 1", "limit > 2"]}],
                    "body": [{"set": {"counter": {"expr": "counter + 1"}}}],
                }
            }
        ],
        id="while-condition-list",
    ),
    pytest.param(
        [
            {
                "wait_until": {
                    "label": "Poll",
                    "description": "Pod ready",
                    "that": [
                        {
                            "variable": "pod_phase",
                            "operator": "equals",
                            "value": "{{ prefix }}-ready",
                        }
                    ],
                    "timeout": {"expr": "probe_ms"},
                    "interval": 250,
                    "message": "pod {{ prefix }} never ready",
                    "fail_current_scope": True,
                    "retry": [LOG_STEP],
                    "capture": {"passed": "ready", "elapsed": "waited_ms"},
                }
            },
            LOG_STEP,
        ],
        id="wait-until-retry",
    ),
    pytest.param(
        [
            {
                "wait_until": {
                    "description": "Watch",
                    "that": [
                        "pod_phase == 'Running'",
                        "or",
                        {
                            "variable": "pod_phase",
                            "operator": "equals",
                            "value": {"template": "done"},
                        },
                    ],
                    "timeout": 30000,
                    "interval": {"expr": "probe_ms"},
                    "message": {"literal": "{{ not read }}"},
                }
            },
            LOG_STEP,
        ],
        id="wait-until-watch",
    ),
    pytest.param(
        [
            {
                "wait_until": {
                    "description": "Plain words",
                    "that": ["pod_phase == 'Running'"],
                    "timeout": 1000,
                    "message": {"template": "gave up"},
                    "retry": [],
                }
            },
            LOG_STEP,
        ],
        id="wait-until-template-message",
    ),
    pytest.param(
        [
            {
                "parallel": {
                    "label": "Fan out",
                    "description": "Two lanes",
                    "branches": [
                        {"name": "ingest", "time_limit": 30000, "steps": [LOG_STEP]},
                        {"name": "probe", "time_limit": {"expr": "probe_ms"}, "steps": [LOG_STEP]},
                    ],
                    "join": "first",
                    "time_limit": {"expr": "probe_ms"},
                }
            },
            LOG_STEP,
        ],
        id="parallel",
    ),
    pytest.param(
        [
            {
                "parallel": {
                    "disabled": True,
                    "branches": [{"steps": [LOG_STEP]}, {"steps": [LOG_STEP]}],
                    "join": "all",
                    "time_limit": 60000,
                }
            },
            LOG_STEP,
        ],
        id="parallel-join-all",
    ),
    pytest.param(
        [
            {
                "assert": {
                    "label": "Check",
                    "description": "Transport holds",
                    "that": [
                        {"variable": "transport", "operator": "equals", "value": "{{ prefix }}"},
                        "or",
                        "x == 1",
                    ],
                    "fail_current_scope": True,
                    "capture": {"passed": "ok"},
                }
            },
            LOG_STEP,
        ],
        id="assert-single",
    ),
    pytest.param(
        [
            {
                "assert": {
                    "description": "Below the limit",
                    "that": [
                        {"variable": "x", "operator": "less_than", "value": {"expr": "limit"}}
                    ],
                    "on_pass": [LOG_STEP],
                    "on_fail": [LOG_STEP],
                    "capture": {"passed": "ok"},
                }
            },
            LOG_STEP,
        ],
        id="assert-split",
    ),
    pytest.param(
        [{"assert": {"description": "Ends here", "that": ["x == 1"], "mode": "split"}}],
        id="assert-split-unwired",
    ),
    pytest.param(
        [
            {
                "try": {
                    "label": "Guard",
                    "description": "Catch it",
                    "steps": [LOG_STEP],
                    "catch": [LOG_STEP],
                    "finally": [LOG_STEP],
                    "capture": {"error": "err", "caught": "was_caught"},
                }
            },
            LOG_STEP,
        ],
        id="try",
    ),
    pytest.param(
        [
            {
                "set": {
                    "counter": 5,
                    "x": {"expr": "limit + 1"},
                    "banner": "run {{ prefix }}",
                    "transport": {"template": "UDP"},
                    "prefix": {"literal": "{{ raw }}"},
                    "hosts": ["alpha", {"expr": "prefix"}, "{{ prefix }}-2"],
                    "headers": {
                        "X-Id": {"expr": "prefix"},
                        "Note": "id {{ prefix }}",
                        "Accept": "json",
                    },
                },
                "label": "Assign",
                "description": "Every row form",
                "disabled": True,
            },
            LOG_STEP,
        ],
        id="set",
    ),
    pytest.param(
        [{"set": {"headers": {"literal": {"expr": "x"}}}, "description": "Keep the shape"}],
        id="set-literal-shaped-like-a-form",
    ),
    pytest.param(
        [LOG_STEP, {"delay": 100, "label": "Pause", "description": "Settle", "disabled": True}],
        id="delay",
    ),
    pytest.param(
        [
            LOG_STEP,
            {"delay": {"duration": {"expr": "probe_ms"}}, "description": "Settle"},
            LOG_STEP,
        ],
        id="delay-expression",
    ),
    pytest.param(
        [
            LOG_STEP,
            {
                "halt": {"scope": "test", "status": "failed", "message": "gave up on {{ prefix }}"},
                "label": "Stop",
                "description": "Give up",
            },
        ],
        id="halt",
    ),
    pytest.param(
        [LOG_STEP, {"halt": {"message": {"expr": "prefix"}}, "disabled": True}],
        id="halt-expression-message",
    ),
    pytest.param(
        [LOG_STEP, {"halt": {"message": {"literal": "{{ raw }}"}}, "description": "Literal"}],
        id="halt-literal-message",
    ),
    pytest.param(
        [
            {
                "for": {
                    "count": 2,
                    "body": [
                        {
                            "while": {
                                "conditions": "x < 0",
                                "body": [
                                    {"break": {"loop": "For Loop"}, "description": "Leave both"}
                                ],
                            }
                        },
                        {"continue": {}, "label": "Next", "disabled": True},
                    ],
                }
            },
            LOG_STEP,
        ],
        id="break-continue",
    ),
    pytest.param(
        [{"block": "delay", "description": "Block form", "settings": {"duration": 30}}, LOG_STEP],
        id="delay-block-form",
    ),
    pytest.param(
        [
            LOG_STEP,
            {"note": {"text": "Reviewed {{ not read }}", "color": "yellow"}, "label": "Remark"},
        ],
        id="note",
    ),
]


class TestControlFieldRoundTrip:
    """Every control field a person sets in a window reads back and compiles to the same Block:
    values, flags, element types, capture, label, description and disabled (REQ-5.2.7.6)."""

    @pytest.mark.parametrize("flow", CONTROL_FIELD_FLOWS)
    def test_compile_readback_compile_keeps_every_control_field(self, flow: list[Any]) -> None:
        assert_fields_round_trip(make_recipe(flow, variables=ROUND_TRIP_VARIABLES))


def readback_when(conditions: list[Any]) -> Any:
    """The `when` an If/Else reads back as, its one branch holding these stored items."""
    if_node = control_node(
        "if-1",
        "if-else",
        "If/Else",
        branches=[{"id": "branch_0", "type": "if", "label": "", "conditions": conditions}],
    )
    edges = [
        make_edge("start-node", "if-1"),
        make_edge("if-1", "log-1", source_handle="branch_0"),
    ]
    readback = readback_of([if_node, log_node("log-1")], edges)
    assert readback["inexpressible"] == []
    return first_step(readback)["if"]["when"]


STORED_CONDITION_CASES = [
    pytest.param(
        [expression_item("c-1", "x == 1"), OR_ITEM, expression_item("c-2", "x == 2")],
        ["x == 1", "or", "x == 2"],
        id="or",
    ),
    pytest.param(
        [expression_item("c-1", "x == 1"), AND_ITEM, expression_item("c-2", "x == 2")],
        ["x == 1", "x == 2"],
        id="and-left-out-and-the-list-kept",
    ),
    pytest.param(
        [
            expression_item("c-1", "x == 1"),
            AND_ITEM,
            {
                "id": "group-1",
                "type": "group",
                "items": [
                    expression_item("c-2", "x == 2"),
                    OR_ITEM,
                    expression_item("c-3", "x == 3"),
                ],
            },
        ],
        ["x == 1", {"group": ["x == 2", "or", "x == 3"]}],
        id="group",
    ),
    pytest.param(
        [comparison_item("x", "equals", "limit + 1", "integer", reference_is_expression=True)],
        {
            "variable": "x",
            "operator": "equals",
            "value": {"expr": "limit + 1"},
            "value_type": "integer",
        },
        id="expression-value",
    ),
    pytest.param(
        [
            comparison_item(
                "transport", "equals", "{{ prefix }}-1", "string", reference_is_template=True
            )
        ],
        {
            "variable": "transport",
            "operator": "equals",
            "value": "{{ prefix }}-1",
            "value_type": "string",
        },
        id="template-value",
    ),
    pytest.param(
        [comparison_item("transport", "starts_with", "web", "string", reference_is_template=True)],
        {
            "variable": "transport",
            "operator": "starts_with",
            "value": {"template": "web"},
            "value_type": "string",
        },
        id="template-value-with-no-markers",
    ),
    pytest.param(
        [comparison_item("transport", "contains", "{{ raw }}", "string")],
        {
            "variable": "transport",
            "operator": "contains",
            "value": {"literal": "{{ raw }}"},
            "value_type": "string",
        },
        id="literal-value-holding-braces",
    ),
    pytest.param(
        [comparison_item("x", "is_not_null", "", "integer", reference_is_expression=True)],
        {"variable": "x", "operator": "is_not_null", "value_type": "integer"},
        id="value-on-an-operator-that-takes-none",
    ),
]

COMPARE_TO_FORMS = [
    pytest.param(
        {"variable": "x", "operator": "equals", "value": {"expr": "limit + 1"}},
        {"reference_value": "limit + 1", "reference_is_expression": True},
        id="expression-value",
    ),
    pytest.param(
        {"variable": "transport", "operator": "equals", "value": "{{ prefix }}-1"},
        {"reference_value": "{{ prefix }}-1", "reference_is_template": True},
        id="template-value",
    ),
    pytest.param(
        {"variable": "transport", "operator": "starts_with", "value": {"template": "web"}},
        {"reference_value": "web", "reference_is_template": True},
        id="template-value-with-no-markers",
    ),
    pytest.param(
        {"variable": "transport", "operator": "contains", "value": {"literal": "{{ raw }}"}},
        {"reference_value": "{{ raw }}"},
        id="literal-value-holding-braces",
    ),
]

RECIPE_CONDITION_FORMS = [
    pytest.param(["x == 1", "or", "x == 2"], id="or"),
    pytest.param(
        [
            "x == 1",
            {
                "group": [
                    "x == 2",
                    "or",
                    {"variable": "transport", "operator": "equals", "value": "TCP"},
                ]
            },
        ],
        id="group",
    ),
    pytest.param(["x == 1", "x == 2"], id="list"),
]


class TestConditionReadback:
    """A condition list reads back in the recipe form it compiles from: `or` markers, groups and
    every compare-to value form; one condition unwrapped, a list kept (REQ-5.2.7.6)."""

    @pytest.mark.parametrize(("stored", "expected"), STORED_CONDITION_CASES)
    def test_a_stored_condition_list_reads_back_in_its_recipe_form(
        self, stored: list[Any], expected: Any
    ) -> None:
        assert readback_when(stored) == expected

    def test_every_when_unwraps_one_condition_and_keeps_a_list(self) -> None:
        pair = [expression_item("c-1", "x == 1"), AND_ITEM, expression_item("c-2", "x == 2")]
        if_node = control_node(
            "if-1",
            "if-else",
            "If/Else",
            branches=[
                {"id": "branch_0", "type": "if", "label": "", "conditions": pair},
                {
                    "id": "branch_1",
                    "type": "else_if",
                    "label": "",
                    "conditions": [expression_item("c-3", "x == 3")],
                },
            ],
        )
        switch_node = control_node(
            "switch-1",
            "switch-case",
            "Switch/Case",
            branches=[
                {"id": "case_0", "type": "case", "label": "", "conditions": pair, "break": True},
                {
                    "id": "case_1",
                    "type": "case",
                    "label": "",
                    "conditions": [expression_item("c-4", "x == 4")],
                    "break": True,
                },
            ],
        )
        nodes = [if_node, log_node("log-1"), log_node("log-2"), switch_node]
        nodes += [log_node("log-3"), log_node("log-4")]
        edges = [
            make_edge("start-node", "if-1"),
            make_edge("if-1", "log-1", source_handle="branch_0"),
            make_edge("if-1", "log-2", source_handle="branch_1"),
            make_edge("log-1", "switch-1"),
            make_edge("log-2", "switch-1", target_handle="ingress_1"),
            make_edge("switch-1", "log-3", source_handle="case_0"),
            make_edge("switch-1", "log-4", source_handle="case_1"),
        ]

        readback = readback_of(nodes, edges)

        assert readback["inexpressible"] == []
        if_step, switch_step = yaml.safe_load(readback["recipe"])["flow"]
        assert if_step["if"]["when"] == ["x == 1", "x == 2"]
        assert if_step["if"]["elif"][0]["when"] == "x == 3"
        assert [case["when"] for case in switch_step["switch"]["cases"]] == [
            ["x == 1", "x == 2"],
            "x == 4",
        ]

    def test_while_conditions_unwrap_one_condition_and_keep_a_list(self) -> None:
        one = control_node(
            "while-1", "while", "While Loop", conditions=[expression_item("c-1", "x == 1")]
        )
        pair = control_node(
            "while-2",
            "while",
            "While Loop",
            conditions=[
                expression_item("c-2", "x == 2"),
                OR_ITEM,
                expression_item("c-3", "x == 3"),
            ],
        )
        edges = [
            make_edge("start-node", "while-1"),
            make_edge("while-1", "log-1", source_handle="body"),
            make_edge("while-1", "while-2", source_handle="then"),
            make_edge("while-2", "log-2", source_handle="body"),
        ]

        readback = readback_of([one, log_node("log-1"), pair, log_node("log-2")], edges)

        assert readback["inexpressible"] == []
        first, second = yaml.safe_load(readback["recipe"])["flow"]
        assert first["while"]["conditions"] == "x == 1"
        assert second["while"]["conditions"] == ["x == 2", "or", "x == 3"]

    @pytest.mark.parametrize("when", RECIPE_CONDITION_FORMS)
    def test_each_condition_form_round_trips(self, when: Any) -> None:
        flow = [{"if": {"when": when, "then": [LOG_STEP], "else": [LOG_STEP]}}, LOG_STEP]
        readback = assert_fields_round_trip(make_recipe(flow, variables=ROUND_TRIP_VARIABLES))
        assert isinstance(first_step(readback)["if"]["when"], type(when))

    @pytest.mark.parametrize(("when", "compare_to"), COMPARE_TO_FORMS)
    def test_a_compare_to_value_keeps_its_mode_through_the_round_trip(
        self, when: dict[str, Any], compare_to: dict[str, Any]
    ) -> None:
        flow = [{"if": {"when": when, "then": [LOG_STEP], "else": [LOG_STEP]}}, LOG_STEP]
        readback = assert_fields_round_trip(make_recipe(flow, variables=ROUND_TRIP_VARIABLES))

        again = compile_clean(readback["recipe"])["test_data"]["workflow"]["nodes"]
        (item,) = again[0]["data"]["config"]["values"]["branches"][0]["conditions"]
        # A compare-to flag is written only when true.
        expected = {"reference_is_expression": None, "reference_is_template": None, **compare_to}
        assert {key: item.get(key) for key in expected} == expected


SETTER_ROUND_TRIP_VARIABLES: dict[str, Any] = {
    "api_tok": {"type": "string"},
    "auth_header": {"type": "string"},
    "greeting": {"type": "string", "value": ""},
    "banner": {"type": "string", "value": ""},
    "hosts": {"type": "array", "value": []},
}


class TestSetterReadback:
    """A Variable Setter reads back row by row in the value forms it compiles from, with its
    Secret rows listed and their values left out (REQ-5.2.7.6, REQ-3.1.3.18)."""

    def test_a_template_row_reads_back_as_its_template(self) -> None:
        node = setter_node(
            {"banner": "run {{ run_id }}", "status": "ready", "raw": "{{ keep }}"},
            templateFields=["variables.banner", "variables.status"],
        )

        assert first_step(readback_setter(node)) == {
            "set": {
                "banner": "run {{ run_id }}",
                "status": {"template": "ready"},
                "raw": {"literal": "{{ keep }}"},
            }
        }

    def test_an_expression_row_reads_back_as_an_expression(self) -> None:
        node = setter_node(
            {"next_attempt": "attempt + 1", "greeting": "hi"},
            expressionFields=["variables.next_attempt"],
        )

        assert first_step(readback_setter(node)) == {
            "set": {"next_attempt": {"expr": "attempt + 1"}, "greeting": "hi"}
        }

    def test_entry_flags_read_back_on_their_entries(self) -> None:
        node = setter_node(
            {
                "hosts": ["web-1", "primary", "{{ prefix }}-2"],
                "headers": {"X-Id": "run_id", "Note": "id {{ run_id }}", "Mode": "fast"},
            },
            expressionFields=["variables.hosts.1", "variables.headers.X-Id"],
            templateFields=[
                "variables.hosts.2",
                "variables.headers.Note",
                "variables.headers.Mode",
            ],
        )

        assert first_step(readback_setter(node))["set"] == {
            "hosts": ["web-1", {"expr": "primary"}, "{{ prefix }}-2"],
            "headers": {
                "X-Id": {"expr": "run_id"},
                "Note": "id {{ run_id }}",
                "Mode": {"template": "fast"},
            },
        }

    @pytest.mark.parametrize(
        "stored",
        ["tok-classified", "wave:enc:v1:dG9rLWNsYXNzaWZpZWQ="],
        ids=["plain", "sealed"],
    )
    def test_a_literal_secret_row_reads_back_as_null_under_secret_rows(self, stored: str) -> None:
        node = setter_node(
            {"api_tok": stored, "greeting": "hi"}, secretFields=["variables.api_tok"]
        )

        readback = readback_setter(node)

        assert first_step(readback) == {
            "set": {"api_tok": None, "greeting": "hi"},
            "secret_rows": ["api_tok"],
        }
        assert stored not in readback["recipe"]

    def test_an_expression_secret_row_reads_back_as_written_under_secret_rows(self) -> None:
        node = setter_node(
            {"auth_header": "'Bearer ' + api_token"},
            expressionFields=["variables.auth_header"],
            secretFields=["variables.auth_header"],
        )

        assert first_step(readback_setter(node)) == {
            "set": {"auth_header": {"expr": "'Bearer ' + api_token"}},
            "secret_rows": ["auth_header"],
        }

    @pytest.mark.parametrize(
        ("stored", "read"),
        [
            pytest.param("hi {{ name }}", "hi {{ name }}", id="with-placeholders"),
            pytest.param("hello", {"template": "hello"}, id="plain-text"),
        ],
    )
    def test_a_template_secret_row_reads_back_as_written_under_secret_rows(
        self, stored: str, read: Any
    ) -> None:
        node = setter_node(
            {"greeting": stored},
            templateFields=["variables.greeting"],
            secretFields=["variables.greeting"],
        )

        readback = readback_setter(node)

        assert first_step(readback) == {"set": {"greeting": read}, "secret_rows": ["greeting"]}
        assert readback["inexpressible"] == []

    def test_a_secret_template_row_compiles_reads_back_and_compiles_the_same(self) -> None:
        step = {"set": {"banner": "run {{ greeting }}"}, "secret_rows": ["banner"]}
        recipe = make_recipe([step, LOG_STEP], variables=SETTER_ROUND_TRIP_VARIABLES)
        first = compile_clean(recipe)["test_data"]

        readback = decompile(first)
        read_step = yaml.safe_load(readback["recipe"])["flow"][0]
        second = compile_clean(readback["recipe"])["test_data"]

        assert read_step == {"set": {"banner": "run {{ greeting }}"}, "secret_rows": ["banner"]}
        assert readback["inexpressible"] == []
        assert _control_fields(second) == _control_fields(first)

    def test_a_saved_expression_secret_row_reads_back_as_written(self) -> None:
        """The save seals only a literal secret row, so the readback keeps the expression."""
        from wavecore.core.secrets.sealing import seal_workflow_node_secrets

        node = setter_node(
            {"auth_header": "'Bearer ' + api_token", "api_tok": "tok-classified"},
            expressionFields=["variables.auth_header"],
            secretFields=["variables.auth_header", "variables.api_tok"],
        )
        workflow = seal_workflow_node_secrets(
            {"nodes": [node], "edges": [make_edge("start-node", "set-1")]}
        )

        readback = readback_of(workflow["nodes"], workflow["edges"])

        assert first_step(readback) == {
            "set": {"auth_header": {"expr": "'Bearer ' + api_token"}, "api_tok": None},
            "secret_rows": ["auth_header", "api_tok"],
        }
        assert "tok-classified" not in readback["recipe"]

    def test_sealed_text_in_an_expression_secret_row_reads_back_as_null(self) -> None:
        sealed = "wave:enc:v1:c2VhbGVkLWV4cHJlc3Npb24="
        node = setter_node(
            {"auth_header": sealed},
            expressionFields=["variables.auth_header"],
            secretFields=["variables.auth_header"],
        )

        readback = readback_setter(node)

        assert first_step(readback) == {
            "set": {"auth_header": None},
            "secret_rows": ["auth_header"],
        }
        assert sealed not in readback["recipe"]

    def test_compile_readback_compile_keeps_the_setter_with_secrets_given_again(self) -> None:
        step = {
            "set": {
                "api_tok": "tok-classified",
                "auth_header": {"expr": "'Bearer ' + api_tok"},
                "greeting": {"template": "hello"},
                "banner": "run {{ greeting }}",
                "hosts": ["alpha", {"expr": "greeting"}, "{{ greeting }}-2"],
            },
            "secret_rows": ["api_tok", "auth_header"],
        }
        recipe = make_recipe([step, LOG_STEP], variables=SETTER_ROUND_TRIP_VARIABLES)
        first = compile_clean(recipe)["test_data"]

        readback = decompile(first)
        document = yaml.safe_load(readback["recipe"])
        read_step = document["flow"][0]
        assert list(read_step["set"]) == ["api_tok", "auth_header", "greeting", "banner", "hosts"]
        assert read_step["set"]["api_tok"] is None
        assert read_step["secret_rows"] == ["api_tok", "auth_header"]
        assert "tok-classified" not in readback["recipe"]
        read_step["set"]["api_tok"] = "tok-classified"
        second = compile_clean(yaml.safe_dump(document, sort_keys=False))["test_data"]

        assert _control_fields(second) == _control_fields(first)


class TestAssertReadback:
    """An Assert reads back with its capture in both modes, and a split Assert with no path
    wired keeps its mode (REQ-5.2.7.6)."""

    def test_a_single_assert_reads_back_with_its_capture(self) -> None:
        flow = [{"assert": {"that": ["x == 1"], "capture": {"passed": "ok"}}}, LOG_STEP]
        readback = assert_fields_round_trip(make_recipe(flow, variables=_X_VARIABLE))

        assert first_step(readback) == {
            "assert": {"that": ["x == 1"], "fail_current_scope": False, "capture": {"passed": "ok"}}
        }

    def test_a_split_assert_reads_back_with_its_capture(self) -> None:
        flow = [
            {
                "assert": {
                    "that": ["x == 1"],
                    "on_pass": [LOG_STEP],
                    "on_fail": [LOG_STEP],
                    "capture": {"passed": "ok"},
                }
            },
            LOG_STEP,
        ]
        readback = assert_fields_round_trip(make_recipe(flow, variables=_X_VARIABLE))

        step = first_step(readback)["assert"]
        assert step["capture"] == {"passed": "ok"}
        assert "mode" not in step

    def test_an_unwired_split_assert_writes_its_mode_and_compiles_split(self) -> None:
        node = control_node(
            "assert-1",
            "assert",
            "Assert",
            assertions=[expression_item("c-1", "x == 1")],
            mode="split",
            fail_current_scope=False,
        )

        readback = readback_of([node], [make_edge("start-node", "assert-1")], _X_VARIABLE)

        assert readback["inexpressible"] == []
        assert first_step(readback) == {
            "assert": {"that": ["x == 1"], "mode": "split", "fail_current_scope": False}
        }
        again = compile_clean(readback["recipe"])["test_data"]["workflow"]["nodes"]
        assert [node["data"]["config"]["values"]["mode"] for node in again] == ["split"]


def _loop_chain(
    outer_label: str, inner_element: str, inner_label: str, jump: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """An outer For, a loop inside its body, and a Break or Continue inside that loop."""
    inner_values: dict[str, Any] = (
        {"collection": "hosts"} if inner_element == "for-each" else {"mode": "count", "count": 2}
    )
    inner = control_node("loop-inner", inner_element, inner_label, **inner_values)
    if inner_element == "for-each":
        inner["data"]["expressionFields"] = ["collection"]
    nodes = [
        control_node("loop-outer", "for", outer_label, mode="count", count=2),
        inner,
        jump,
    ]
    edges = [
        make_edge("start-node", "loop-outer"),
        make_edge("loop-outer", "loop-inner", source_handle="body"),
        make_edge("loop-inner", str(jump["id"]), source_handle="body"),
    ]
    return nodes, edges


HOSTS_VARIABLE: dict[str, Any] = {"hosts": {"type": "array", "value": ["alpha"]}}


class TestLoopReadback:
    """A loop reads back with its count-mode step and collection type, and a jump to an outer
    loop names it by label or block name (REQ-5.2.7.6, REQ-3.5.1.15)."""

    def test_a_count_mode_step_reads_back(self) -> None:
        flow = [{"for": {"count": 6, "step": 2, "body": [LOG_STEP]}}, LOG_STEP]
        readback = assert_fields_round_trip(make_recipe(flow))

        assert first_step(readback) == {"for": {"count": 6, "step": 2, "body": [LOG_READBACK]}}

    def test_a_collection_type_reads_back(self) -> None:
        flow = [
            {
                "for_each": {
                    "collection": {"expr": "settings_map"},
                    "collection_type": "map",
                    "body": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        variables = {"settings_map": {"type": "map", "value": {"a": "1"}}}
        readback = assert_fields_round_trip(make_recipe(flow, variables=variables))

        assert first_step(readback)["for_each"]["collection_type"] == "map"

    def test_a_break_to_an_outer_default_named_loop_names_it_and_recompiles_to_it(self) -> None:
        jump = control_node("break-1", "break", "Break", target_loop="loop-outer")
        nodes, edges = _loop_chain("For Loop", "for-each", "For Each", jump)

        readback = readback_of(nodes, edges, HOSTS_VARIABLE)

        assert readback["inexpressible"] == []
        assert first_step(readback) == {
            "for": {
                "count": 2,
                "body": [
                    {
                        "for_each": {
                            "collection": {"expr": "hosts"},
                            "body": [{"break": {"loop": "For Loop"}}],
                        }
                    }
                ],
            }
        }
        again = compile_clean(readback["recipe"])["test_data"]["workflow"]["nodes"]
        by_type = {node["data"]["elementType"]: node for node in again}
        target = by_type["break"]["data"]["config"]["values"]["target_loop"]
        assert target == by_type["for"]["id"]

    @pytest.mark.parametrize("kind", ["break", "continue"])
    def test_a_jump_past_a_loop_of_the_same_name_is_reported(self, kind: str) -> None:
        jump = control_node("jump-1", kind, "Leave", target_loop="loop-outer")
        nodes, edges = _loop_chain("For Loop", "for", "For Loop", jump)

        readback = readback_of(nodes, edges)

        assert readback["expressible"] is False
        assert readback["inexpressible"] == [
            {
                "what": f"a {kind} aimed past a loop of the same name, in block 'Leave'",
                "where": "jump-1",
            }
        ]


class TestValueFormReadback:
    """A stored value reads back in the shortest form that compiles to the same value and
    mode: `{literal}` for text that must keep its braces or data shaped like a form,
    `{template}` for a template with no markers (REQ-5.2.7.6)."""

    def test_a_plugin_literal_setting_holding_braces_reads_back_as_a_literal(self) -> None:
        readback = readback_of(
            [log_node("log-1", message="Go {{ .Values.name }}")],
            [make_edge("start-node", "log-1")],
        )

        assert first_step(readback)["settings"] == {"message": {"literal": "Go {{ .Values.name }}"}}
        (again,) = compile_clean(readback["recipe"])["test_data"]["workflow"]["nodes"]
        assert again["data"]["config"]["values"]["message"] == "Go {{ .Values.name }}"
        assert again["data"]["templateFields"] == []

    def test_a_template_setting_with_no_markers_reads_back_as_a_template_form(self) -> None:
        node = log_node("log-1", message="ready")
        node["data"]["templateFields"] = ["message"]

        readback = readback_of([node], [make_edge("start-node", "log-1")])

        assert first_step(readback)["settings"] == {"message": {"template": "ready"}}
        (again,) = compile_clean(readback["recipe"])["test_data"]["workflow"]["nodes"]
        assert again["data"]["config"]["values"]["message"] == "ready"
        assert again["data"]["templateFields"] == ["message"]

    def test_a_literal_map_shaped_like_an_expression_reads_back_as_a_literal(self) -> None:
        node = make_node(
            "http-1",
            element_type="http-client",
            values={"url": "http://x", "method": "GET", "headers": {"expr": "x"}},
        )

        readback = readback_of([node], [make_edge("start-node", "http-1")])

        assert first_step(readback)["settings"]["headers"] == {"literal": {"expr": "x"}}
        (again,) = compile_clean(readback["recipe"])["test_data"]["workflow"]["nodes"]
        assert again["data"]["config"]["values"]["headers"] == {"expr": "x"}
        assert again["data"]["expressionFields"] == []


IDENTITY: dict[str, Any] = {"description": "Checks the banner", "disabled": True}


class TestStepIdentityReadback:
    """A Block's description and disabled mark read back beside a block or Setter step and
    inside a construct's mapping, and compile back onto the Block (REQ-5.2.7.6)."""

    def test_a_block_step_carries_its_description_and_disabled(self) -> None:
        node = log_node("log-1", message="hi")
        node["data"].update(IDENTITY)

        step = first_step(readback_of([node], [make_edge("start-node", "log-1")]))

        assert step == {"block": "log", **IDENTITY, "settings": {"message": "hi"}}

    def test_a_setter_step_carries_its_description_and_disabled(self) -> None:
        node = setter_node({"greeting": "hi"}, **IDENTITY)

        assert first_step(readback_setter(node)) == {"set": {"greeting": "hi"}, **IDENTITY}

    def test_a_construct_carries_them_inside_its_mapping(self) -> None:
        loop = control_node("loop-1", "for", "For Loop", mode="count", count=2)
        loop["data"].update(IDENTITY)
        edges = [
            make_edge("start-node", "loop-1"),
            make_edge("loop-1", "log-1", source_handle="body"),
        ]

        step = first_step(readback_of([loop, log_node("log-1", message="hi")], edges))

        assert step == {
            "for": {
                "count": 2,
                **IDENTITY,
                "body": [{"block": "log", "settings": {"message": "hi"}}],
            }
        }

    def test_only_a_disabled_block_writes_disabled(self) -> None:
        muted = log_node("log-1", message="muted")
        muted["data"]["disabled"] = True
        live = log_node("log-2", message="live")
        live["data"].update(disabled=False, description="")
        edges = [make_edge("start-node", "log-1"), make_edge("log-1", "log-2")]

        steps = yaml.safe_load(readback_of([muted, live], edges)["recipe"])["flow"]

        assert steps == [
            {"block": "log", "disabled": True, "settings": {"message": "muted"}},
            {"block": "log", "settings": {"message": "live"}},
        ]

    def test_description_and_disabled_round_trip_on_every_step_kind(self) -> None:
        functions = [{"name": "greet", "inputs": [], "outputs": [], "flow": [LOG_STEP]}]
        flow = [
            {"block": "log", "settings": {"message": "hi"}, **IDENTITY},
            {"function": "greet", "description": "Says hello"},
            {"set": {"counter": 1}, **IDENTITY},
            {"for": {"count": 2, **IDENTITY, "body": [LOG_STEP]}},
            {"delay": 100, "description": "Settle"},
            {"halt": {}, **IDENTITY},
        ]
        variables = {"counter": {"type": "integer", "value": 0}}

        assert_fields_round_trip(make_recipe(flow, variables=variables, functions=functions))


def _loss_readback(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    readback = readback_of(nodes, edges)
    assert readback["expressible"] is False
    return readback


def _undeclared_loop_field() -> tuple[dict[str, Any], dict[str, str]]:
    """A For holding a value no recipe key writes, and the item that reports it."""
    node = control_node("loop-9", "for", "Count", mode="count", count=1, shade="red")
    return node, {"what": "setting 'shade' of block 'Count'", "where": "loop-9"}


class TestFieldLossReport:
    """A stored value the recipe format cannot express is named in `inexpressible`, so the
    readback is never expressible and amend refuses the Test (REQ-5.2.7.6)."""

    @pytest.mark.parametrize(
        ("element_type", "values", "place"),
        [
            (
                "variable-setter",
                {"variables": {"cfg": {"inner": {"deep": "y"}}}},
                "variables.cfg.inner.deep",
            ),
            (
                "shell-script",
                {"script": "echo hi", "arguments": [{"value": ["--env"]}]},
                "arguments.0.value.0",
            ),
        ],
        ids=["setter-past-the-entry", "plugin-past-the-row-field"],
    )
    def test_an_expression_flag_the_readback_cannot_place_is_reported(
        self, element_type: str, values: dict[str, Any], place: str
    ) -> None:
        node_type = "control" if element_type == "variable-setter" else "plugin"
        node = make_node("node-1", element_type=element_type, node_type=node_type, values=values)
        node["data"]["label"] = "Prepare"
        node["data"]["expressionFields"] = [place]

        readback = _loss_readback([node], [make_edge("start-node", "node-1")])

        assert readback["inexpressible"] == [
            {"what": f"the expression mode of '{place}' in block 'Prepare'", "where": "node-1"}
        ]

    @pytest.mark.parametrize(
        "place",
        ["script.lines", "arguments.5.value", "arguments.first"],
        ids=["below-text", "past-the-last-row", "not-a-row-index"],
    )
    def test_a_flag_that_addresses_no_stored_value_is_no_loss(self, place: str) -> None:
        values = {"script": "echo hi", "arguments": [{"value": "--env"}]}
        node = make_node("node-1", element_type="shell-script", values=values)
        node["data"]["label"] = "Prepare"
        node["data"]["expressionFields"] = [place]

        readback = readback_of([node], [make_edge("start-node", "node-1")])

        assert (readback["expressible"], readback["inexpressible"]) == (True, [])
        assert first_step(readback) == {
            "block": "shell-script",
            "label": "Prepare",
            "settings": values,
        }

    def test_a_template_flag_the_readback_cannot_place_is_reported(self) -> None:
        node = setter_node(
            {"cfg": {"inner": {"deep": "x {{ y }}"}}},
            label="Assign",
            templateFields=["variables.cfg.inner.deep"],
        )

        readback = _loss_readback([node], [make_edge("start-node", "set-1")])

        assert readback["inexpressible"] == [
            {
                "what": "the template mode of 'variables.cfg.inner.deep' in block 'Assign'",
                "where": "set-1",
            }
        ]

    def test_conditions_not_joined_by_and_or_are_reported(self) -> None:
        node = control_node(
            "assert-1",
            "assert",
            "Check",
            assertions=[expression_item("c-1", "x == 1"), expression_item("c-2", "x == 2")],
            mode="single",
            fail_current_scope=False,
        )

        readback = _loss_readback([node], [make_edge("start-node", "assert-1")])

        assert readback["inexpressible"] == [
            {
                "what": (
                    "a condition list in 'assertions' of block 'Check' whose items are not "
                    "joined by and / or"
                ),
                "where": "assert-1",
            }
        ]

    @pytest.mark.parametrize(
        "items",
        [
            [AND_ITEM, expression_item("c-1", "x == 1")],
            [expression_item("c-1", "x == 1"), OR_ITEM],
            [expression_item("c-1", "x == 1"), AND_ITEM, OR_ITEM, expression_item("c-2", "x == 2")],
            [
                expression_item("c-1", "x == 1"),
                {"type": "operator", "value": "xor"},
                expression_item("c-2", "x == 2"),
            ],
        ],
        ids=["leading", "trailing", "two-in-a-row", "unknown-marker"],
    )
    def test_an_operator_that_does_not_join_two_conditions_is_reported(
        self, items: list[dict[str, Any]]
    ) -> None:
        node = control_node(
            "assert-1", "assert", "Check", assertions=items, mode="single", fail_current_scope=False
        )

        readback = _loss_readback([node], [make_edge("start-node", "assert-1")])

        assert readback["inexpressible"] == [
            {
                "what": (
                    "a condition list in 'assertions' of block 'Check' whose items are not "
                    "joined by and / or"
                ),
                "where": "assert-1",
            }
        ]

    @pytest.mark.parametrize(
        ("item", "item_type"),
        [
            ({"id": "c-1", "type": "regex", "pattern": "^x$"}, "regex"),
            (expression_item("c-1", "or"), "expression"),
        ],
        ids=["unknown-type", "expression-that-is-a-marker"],
    )
    def test_a_condition_item_no_recipe_form_holds_is_reported(
        self, item: dict[str, Any], item_type: str
    ) -> None:
        node = control_node(
            "assert-1",
            "assert",
            "Check",
            assertions=[item],
            mode="single",
            fail_current_scope=False,
        )

        readback = _loss_readback([node], [make_edge("start-node", "assert-1")])

        assert readback["inexpressible"] == [
            {
                "what": f"a condition item of type '{item_type}' in 'assertions' of block 'Check'",
                "where": "assert-1",
            }
        ]

    def test_a_branch_key_with_no_recipe_place_is_reported(self) -> None:
        branch = {
            "id": "branch_0",
            "type": "if",
            "label": "",
            "conditions": [expression_item("c-1", "x == 1")],
            "shade": "red",
        }
        node = control_node("if-1", "if-else", "Route", branches=[branch])
        edges = [
            make_edge("start-node", "if-1"),
            make_edge("if-1", "log-1", source_handle="branch_0"),
        ]

        readback = _loss_readback([node, log_node("log-1")], edges)

        assert readback["inexpressible"] == [
            {"what": "key 'shade' of a branch in block 'Route'", "where": "if-1"}
        ]

    def test_a_lane_key_with_no_recipe_place_is_reported(self) -> None:
        lanes = [{"id": "branch_1", "name": "a", "retries": 2}, {"id": "branch_2", "name": "b"}]
        node = control_node("par-1", "parallel", "Fan", branches=lanes, join="all")
        edges = [
            make_edge("start-node", "par-1"),
            make_edge("par-1", "log-1", source_handle="branch_1"),
            make_edge("par-1", "log-2", source_handle="branch_2"),
        ]

        readback = _loss_readback([node, log_node("log-1"), log_node("log-2")], edges)

        assert readback["inexpressible"] == [
            {"what": "key 'retries' of a branch in block 'Fan'", "where": "par-1"}
        ]

    def test_a_template_mark_on_a_lane_limit_is_reported(self) -> None:
        lanes = [
            {"id": "branch_1", "name": "a"},
            {"id": "branch_2", "name": "b", "time_limit": 500},
        ]
        node = control_node("par-1", "parallel", "Fan", branches=lanes, join="all")
        node["data"]["templateFields"] = ["branches.1.time_limit"]
        edges = [
            make_edge("start-node", "par-1"),
            make_edge("par-1", "log-1", source_handle="branch_1"),
            make_edge("par-1", "log-2", source_handle="branch_2"),
        ]

        readback = _loss_readback([node, log_node("log-1"), log_node("log-2")], edges)

        assert readback["inexpressible"] == [
            {
                "what": "the template mode of 'branches.1.time_limit' in block 'Fan'",
                "where": "par-1",
            }
        ]
        assert first_step(readback)["parallel"]["branches"][1]["time_limit"] == 500

    @pytest.mark.parametrize("kind", ["break", "continue"])
    def test_a_jump_aimed_at_a_loop_that_does_not_enclose_it_is_reported(self, kind: str) -> None:
        nodes = [
            control_node("loop-a", "for", "For Loop", mode="count", count=1),
            control_node("loop-b", "for", "Second loop", mode="count", count=1),
            control_node("jump-1", kind, "Leave", target_loop="loop-a"),
        ]
        edges = [
            make_edge("start-node", "loop-a"),
            make_edge("loop-a", "loop-b", source_handle="then"),
            make_edge("loop-b", "jump-1", source_handle="body"),
        ]

        readback = _loss_readback(nodes, edges)

        assert readback["inexpressible"] == [
            {
                "what": f"a {kind} aimed at a loop that does not enclose it, in block 'Leave'",
                "where": "jump-1",
            }
        ]

    def test_a_jump_aimed_past_a_loop_of_the_same_name_is_reported(self) -> None:
        jump = control_node("next-1", "continue", "Next", target_loop="loop-outer")
        nodes, edges = _loop_chain("For Loop", "for", "For Loop", jump)

        readback = _loss_readback(nodes, edges)

        assert readback["inexpressible"] == [
            {
                "what": "a continue aimed past a loop of the same name, in block 'Next'",
                "where": "next-1",
            }
        ]

    def test_an_unpublished_function_edit_is_reported(self) -> None:
        seed_fetch_remote()
        step = {"function": "fetch_remote", "version": "1.2.0", "settings": {"host": "h"}}
        test_data = compile_clean(make_recipe([step]))["test_data"]
        data = _function_block(test_data)["data"]
        data["editMode"] = True
        data["draft"] = {
            "name": "fetch_remote",
            "workflow": {"nodes": [], "edges": []},
            "inputs": [],
            "outputs": [],
            "variables": [],
        }

        readback = decompile(test_data)

        assert readback["expressible"] is False
        assert readback["inexpressible"] == [
            {
                "what": "an unpublished edit of Function 'fetch_remote' in block 'fetch_remote'",
                "where": "node-1",
            }
        ]

    def test_a_control_value_with_no_recipe_place_is_reported(self) -> None:
        node, item = _undeclared_loop_field()

        readback = _loss_readback([node], [make_edge("start-node", "loop-9")])

        assert readback["inexpressible"] == [item]

    def _only_the_loop_is_reported(self, other: dict[str, Any]) -> dict[str, Any]:
        loop, item = _undeclared_loop_field()
        edges = [
            make_edge("start-node", "loop-9"),
            make_edge("loop-9", str(other["id"]), source_handle="then"),
        ]
        extra = [log_node("log-1")] if other["data"]["elementType"] == "if-else" else []
        if extra:
            edges.append(make_edge(str(other["id"]), "log-1", source_handle="custom-if"))
        readback = _loss_readback([loop, other, *extra], edges)
        assert readback["inexpressible"] == [item]
        return readback

    def test_a_secret_value_is_not_reported(self) -> None:
        setter = setter_node({"api_tok": "tok-classified"}, secretFields=["variables.api_tok"])

        readback = self._only_the_loop_is_reported(setter)

        assert "tok-classified" not in readback["recipe"]

    def test_a_reveal_choice_is_not_reported(self) -> None:
        sql = make_node(
            "sql-1",
            element_type="sql-client",
            values={
                "host": "db",
                "database": "wave",
                "username": "wave",
                "password": "pw-classified",
                "sql": "SELECT 1",
            },
        )
        sql["data"]["config"].update(secret_masking="reveal", unmasked_secret_fields=["password"])

        self._only_the_loop_is_reported(sql)

    def test_condition_and_branch_ids_are_not_reported(self) -> None:
        branch = {
            "id": "custom-if",
            "type": "if",
            "label": "",
            "conditions": [expression_item("custom-condition", "x == 1")],
        }

        self._only_the_loop_is_reported(
            control_node("if-1", "if-else", "If/Else", branches=[branch])
        )

    def test_a_flag_that_addresses_no_stored_value_is_not_reported(self) -> None:
        http = make_node(
            "http-1",
            element_type="http-client",
            values={"url": "http://x", "method": "GET", "headers": {"Accept": "json"}},
        )
        http["data"]["expressionFields"] = ["headers.Missing", "timeout"]
        http["data"]["templateFields"] = ["body"]

        self._only_the_loop_is_reported(http)
