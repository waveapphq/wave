"""Canvas -> recipe readback: per-construct round-trip, secret omission, inexpressibility predicate.

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
            "variableExpressionKeys": [],
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
        # Floating notes read back as trailing note steps; the chain is intact.
        flow = [LOG_STEP, {"note": {"text": "Reviewed by QA", "color": "yellow"}}, LOG_STEP]
        first = compile_clean(make_recipe(flow))["test_data"]
        readback = decompile(first)
        assert readback["expressible"] is True
        steps = yaml.safe_load(readback["recipe"])["flow"]
        assert [next(iter(step)) for step in steps] == ["block", "block", "note"]
        assert steps[2]["note"] == {"text": "Reviewed by QA", "color": "yellow"}

        second = compile_clean(readback["recipe"])["test_data"]
        note_ids = [n["id"] for n in second["workflow"]["nodes"] if n["type"] == "noteNode"]
        assert len(note_ids) == 1
        assert not [
            e for e in second["workflow"]["edges"] if note_ids[0] in (e["source"], e["target"])
        ]

    def test_hand_built_floating_note_is_expressible(self) -> None:
        nodes = [
            make_node("node-1"),
            {
                "id": "note-1",
                "type": "noteNode",
                "data": {"config": {"text": "hi", "color": "yellow"}},
            },
        ]
        edges = [{"id": "e1", "source": "start-node", "target": "node-1"}]
        readback = decompile(
            {"name": "Noted", "workflow": {"nodes": nodes, "edges": edges}, "variables": {}}
        )
        assert readback["expressible"] is True
        steps = yaml.safe_load(readback["recipe"])["flow"]
        assert steps[-1] == {"note": {"text": "hi", "color": "yellow"}}

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
                "when": {
                    "variable": "node_host",
                    "operator": "equals",
                    "value": "node-3",
                    "value_type": "string",
                },
                "then": [{"block": "log", "label": "log", "settings": {"message": "blocked"}}],
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
        # REQ-5.2.7.3, K8SEXEC-10: the limit rows read back as written; secret rows never do.
        variables = {"k8s_session": {"type": "string", "secret": True}}
        settings = {
            name: value
            for name, value in K8S_COPY_FROM_POD_STEP["settings"].items()
            if name != "session"
        }

        readback = readback_flow([K8S_COPY_FROM_POD_STEP], variables)[0]

        assert readback == {
            **K8S_COPY_FROM_POD_STEP,
            "settings": {**settings, "no_preserve": False, "on_error": "fail"},
        }


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
        setter["data"]["variableElementTypes"]["built"] = "enc:v1:sealed"
        readback = yaml.safe_load(decompile(test_data)["recipe"])
        assert "element_types" not in readback["flow"][0]


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
            {**row, "reference_value": None}
        ]

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
