"""Construct wiring: section anchoring, egress, rejoin, loop targets, sugar steps.

REQ-5.2.7.3; handles follow each control's declared structure_hints.
"""

from typing import Any

import pytest

from tests.core.recipes.conftest import LOG_STEP, create_profile, find_finding, make_recipe


def compile_recipe(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe as compile_fn

    return compile_fn(text)


def compile_clean(text: str) -> dict[str, Any]:
    result = compile_recipe(text)
    errors = [f for f in result["findings"] if f["severity"] == "error"]
    assert errors == [], f"expected a clean compile, got {errors!r}"
    assert result["test_data"] is not None
    return result


def nodes_by_id(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {node["id"]: node for node in result["test_data"]["workflow"]["nodes"]}


def all_edges(result: dict[str, Any]) -> list[dict[str, Any]]:
    return result["test_data"]["workflow"]["edges"]


def edge_between(result: dict[str, Any], source: str, target: str) -> dict[str, Any]:
    matches = [
        edge for edge in all_edges(result) if edge["source"] == source and edge["target"] == target
    ]
    assert len(matches) == 1, f"expected one edge {source}->{target}, got {matches!r}"
    return matches[0]


def edges_from(result: dict[str, Any], source: str) -> list[dict[str, Any]]:
    return [edge for edge in all_edges(result) if edge["source"] == source]


def values_of(result: dict[str, Any], node_id: str) -> dict[str, Any]:
    return nodes_by_id(result)[node_id]["data"]["config"]["values"]


def without_id(item: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key != "id"}


def variable_prefixed_keys(data: dict[str, Any]) -> list[str]:
    """Keys of a node's data or config named 'variable...': a Setter keeps its rows only in
    config.values and the shared flags (REQ-3.4.1.14)."""
    return [key for key in (*data, *data.get("config", {})) if key.startswith("variable")]


def assert_assertion_ids(items: list[dict[str, Any]]) -> None:
    ids = [item["id"] for item in items if item.get("type") != "operator"]
    assert all(isinstance(item_id, str) and item_id for item_id in ids)
    assert len(set(ids)) == len(ids)


COMPARISON = {
    "variable": "transport",
    "operator": "equals",
    "value": "TCP",
    "value_type": "string",
}


class TestIfElse:
    def _compile(self) -> dict[str, Any]:
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
        return compile_clean(make_recipe(flow, variables=variables))

    def test_branch_config_follows_the_canvas_shape(self) -> None:
        result = self._compile()
        branches = values_of(result, "node-2")["branches"]
        assert [branch["id"] for branch in branches] == ["branch_0", "branch_1", "branch_2"]
        assert [branch["type"] for branch in branches] == ["if", "else_if", "else"]
        assert not branches[2].get("conditions")

    def test_expression_condition_becomes_an_expression_item(self) -> None:
        result = self._compile()
        conditions = values_of(result, "node-2")["branches"][0]["conditions"]
        assert [without_id(item) for item in conditions] == [
            {"type": "expression", "expression": "x == 1"}
        ]
        assert_assertion_ids(conditions)

    def test_comparison_condition_becomes_a_literal_item(self) -> None:
        result = self._compile()
        conditions = values_of(result, "node-2")["branches"][1]["conditions"]
        assert [without_id(item) for item in conditions] == [
            {
                "type": "literal",
                "variable": "transport",
                "operator": "equals",
                "value_type": "string",
                "reference_value": "TCP",
            }
        ]
        assert_assertion_ids(conditions)

    def test_branch_edges_use_the_branch_ids(self) -> None:
        result = self._compile()
        assert edge_between(result, "node-2", "node-3")["sourceHandle"] == "branch_0"
        assert edge_between(result, "node-2", "node-5")["sourceHandle"] == "branch_1"
        assert edge_between(result, "node-2", "node-6")["sourceHandle"] == "branch_2"

    def test_branch_bodies_chain_internally(self) -> None:
        result = self._compile()
        chain = edge_between(result, "node-3", "node-4")
        assert chain.get("sourceHandle") is None
        assert chain.get("targetHandle") is None

    def test_branches_rejoin_with_progressive_ingress_handles(self) -> None:
        result = self._compile()
        assert edge_between(result, "node-4", "node-7").get("targetHandle") is None
        assert edge_between(result, "node-5", "node-7")["targetHandle"] == "ingress_1"
        assert edge_between(result, "node-6", "node-7")["targetHandle"] == "ingress_2"

    def test_step_map_covers_the_branch_children(self) -> None:
        result = self._compile()
        step_map = result["step_map"]
        assert step_map["node-2"] == "flow[1]"
        assert step_map["node-3"] == "flow[1].if.then[0]"
        assert step_map["node-4"] == "flow[1].if.then[1]"
        assert step_map["node-5"] == "flow[1].if.elif[0].then[0]"
        assert step_map["node-6"] == "flow[1].if.else[0]"

    def test_if_without_else_falls_through_to_the_next_step(self) -> None:
        flow = [
            {"if": {"when": "x == 1", "then": [LOG_STEP]}},
            LOG_STEP,
        ]
        result = compile_clean(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))
        branches = values_of(result, "node-1")["branches"]
        assert [branch["type"] for branch in branches] == ["if", "else"]
        assert not branches[1].get("conditions")
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "branch_0"
        # The next step is reachable from the then tail AND the false path.
        assert edge_between(result, "node-2", "node-3").get("targetHandle") is None
        implicit = edge_between(result, "node-1", "node-3")
        assert implicit["sourceHandle"] == "branch_1"
        assert implicit["targetHandle"] == "ingress_1"

    def test_empty_branches_meeting_one_block_each_keep_their_own_wire(self) -> None:
        flow = [
            {
                "if": {
                    "when": "x == 1",
                    "then": [],
                    "elif": [{"when": "x == 2", "then": []}],
                    "else": [],
                }
            },
            LOG_STEP,
        ]
        result = compile_clean(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))
        assert edges_from(result, "node-1") == [
            {
                "id": "edge-node-1-branch_0-node-2",
                "source": "node-1",
                "target": "node-2",
                "sourceHandle": "branch_0",
            },
            {
                "id": "edge-node-1-branch_1-node-2-ingress_1",
                "source": "node-1",
                "target": "node-2",
                "sourceHandle": "branch_1",
                "targetHandle": "ingress_1",
            },
            {
                "id": "edge-node-1-branch_2-node-2-ingress_2",
                "source": "node-1",
                "target": "node-2",
                "sourceHandle": "branch_2",
                "targetHandle": "ingress_2",
            },
        ]

    def test_a_missing_else_falling_through_beside_an_empty_then_keeps_its_own_wire(
        self,
    ) -> None:
        flow = [{"if": {"when": "x == 1", "then": []}}, LOG_STEP]
        result = compile_clean(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))
        assert [edge["id"] for edge in edges_from(result, "node-1")] == [
            "edge-node-1-branch_0-node-2",
            "edge-node-1-branch_1-node-2-ingress_1",
        ]

    def test_trailing_if_without_else_keeps_a_single_branch(self) -> None:
        flow = [{"if": {"when": "x == 1", "then": [LOG_STEP]}}]
        result = compile_clean(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))
        branches = values_of(result, "node-1")["branches"]
        assert [branch["type"] for branch in branches] == ["if"]
        assert [edge["sourceHandle"] for edge in edges_from(result, "node-1")] == ["branch_0"]

    def test_if_with_a_terminal_then_still_reaches_the_next_step(self) -> None:
        # The Watch Build Demo defect: then ends in a break, no else authored -
        # the step after the if must ride the false path, never float unwired.
        flow = [
            {
                "for": {
                    "count": 3,
                    "body": [
                        {"if": {"when": "x == 1", "then": [{"break": {}}]}},
                        {"delay": 500},
                    ],
                }
            },
            LOG_STEP,
        ]
        result = compile_clean(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))
        # node-1 for, node-2 if, node-3 break, node-4 delay, node-5 log
        delay_in = [edge for edge in all_edges(result) if edge["target"] == "node-4"]
        assert [(edge["source"], edge.get("sourceHandle")) for edge in delay_in] == [
            ("node-2", "branch_1")
        ]

    def test_branch_labels_come_from_if_label_elif_label_and_else_label(self) -> None:
        flow = [
            {
                "if": {
                    "label": "Route",
                    "if_label": "Is one",
                    "when": "x == 1",
                    "then": [LOG_STEP],
                    "elif": [{"label": "Is two", "when": "x == 2", "then": [LOG_STEP]}],
                    "else_label": "Other",
                    "else": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        result = compile_clean(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))
        branches = values_of(result, "node-1")["branches"]
        assert [branch["label"] for branch in branches] == ["Is one", "Is two", "Other"]
        # The construct's own label stays the Block's name.
        assert nodes_by_id(result)["node-1"]["data"]["label"] == "Route"

    def test_an_implicit_else_keeps_a_blank_label(self) -> None:
        flow = [{"if": {"if_label": "Is one", "when": "x == 1", "then": [LOG_STEP]}}, LOG_STEP]
        result = compile_clean(make_recipe(flow, variables={"x": {"type": "integer", "value": 1}}))
        branches = values_of(result, "node-1")["branches"]
        assert branches[0]["label"] == "Is one"
        assert branches[1] == {"id": "branch_1", "type": "else", "label": ""}

    def test_when_lists_join_their_conditions(self) -> None:
        flow = [
            {
                "if": {
                    "when": ["x == 1", COMPARISON],
                    "then": [LOG_STEP],
                    "elif": [{"when": ["x == 2", "or", "x == 3"], "then": [LOG_STEP]}],
                }
            },
            LOG_STEP,
        ]
        variables = {
            "x": {"type": "integer", "value": 1},
            "transport": {"type": "string", "value": "TCP"},
        }
        branches = values_of(compile_clean(make_recipe(flow, variables=variables)), "node-1")[
            "branches"
        ]
        assert [without_id(item) for item in branches[0]["conditions"]] == [
            {"type": "expression", "expression": "x == 1"},
            {"type": "operator", "value": "and"},
            {
                "type": "literal",
                "variable": "transport",
                "operator": "equals",
                "value_type": "string",
                "reference_value": "TCP",
            },
        ]
        assert [without_id(item) for item in branches[1]["conditions"]] == [
            {"type": "expression", "expression": "x == 2"},
            {"type": "operator", "value": "or"},
            {"type": "expression", "expression": "x == 3"},
        ]
        assert_assertion_ids([*branches[0]["conditions"], *branches[1]["conditions"]])


SWITCH_VARIABLES = {
    "code": {"type": "integer", "value": 200},
    "transport": {"type": "string", "value": "TCP"},
}


class TestSwitch:
    """Condition-guarded cases, an optional default, and a guaranteed then egress."""

    def _compile(self) -> dict[str, Any]:
        flow = [
            {
                "switch": {
                    "cases": [
                        {"when": "code == 200", "steps": [LOG_STEP]},
                        {"when": COMPARISON, "break": False, "steps": [LOG_STEP]},
                    ],
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        return compile_clean(make_recipe(flow, variables=SWITCH_VARIABLES))

    def test_switch_compiles_to_the_switch_case_control(self) -> None:
        data = nodes_by_id(self._compile())["node-1"]["data"]
        assert data["elementType"] == "switch-case"
        assert data["nodeType"] == "control"

    def test_branch_config_carries_stable_ids_types_and_labels(self) -> None:
        branches = values_of(self._compile(), "node-1")["branches"]
        assert [branch["id"] for branch in branches] == ["branch_0", "branch_1", "branch_2"]
        assert [branch["type"] for branch in branches] == ["case", "case", "default"]
        assert [branch["label"] for branch in branches] == ["", "", ""]

    def test_break_defaults_to_true_and_honors_an_authored_false(self) -> None:
        branches = values_of(self._compile(), "node-1")["branches"]
        assert branches[0]["break"] is True
        assert branches[1]["break"] is False

    def test_the_default_branch_carries_no_conditions_and_no_break(self) -> None:
        branches = values_of(self._compile(), "node-1")["branches"]
        assert branches[2] == {"id": "branch_2", "type": "default", "label": ""}

    def test_expression_when_becomes_an_expression_item(self) -> None:
        conditions = values_of(self._compile(), "node-1")["branches"][0]["conditions"]
        assert [without_id(item) for item in conditions] == [
            {"type": "expression", "expression": "code == 200"}
        ]
        assert_assertion_ids(conditions)

    def test_comparison_when_becomes_a_literal_item(self) -> None:
        conditions = values_of(self._compile(), "node-1")["branches"][1]["conditions"]
        assert [without_id(item) for item in conditions] == [
            {
                "type": "literal",
                "variable": "transport",
                "operator": "equals",
                "value_type": "string",
                "reference_value": "TCP",
            }
        ]
        assert_assertion_ids(conditions)

    def test_case_and_default_steps_anchor_on_their_branch_handles(self) -> None:
        result = self._compile()
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "branch_0"
        assert edge_between(result, "node-1", "node-3")["sourceHandle"] == "branch_1"
        assert edge_between(result, "node-1", "node-4")["sourceHandle"] == "branch_2"

    def test_continuation_leaves_via_the_then_egress(self) -> None:
        egress = edge_between(self._compile(), "node-1", "node-5")
        assert egress["sourceHandle"] == "then"
        assert egress.get("targetHandle") is None

    def test_case_and_default_tails_are_dead_ends(self) -> None:
        result = self._compile()
        for tail in ("node-2", "node-3", "node-4"):
            assert edges_from(result, tail) == []

    def test_switch_declares_no_output_bindings(self) -> None:
        config = nodes_by_id(self._compile())["node-1"]["data"]["config"]
        assert config["outputBindings"] == {}

    def test_step_map_uses_case_and_default_paths(self) -> None:
        step_map = self._compile()["step_map"]
        assert step_map["node-1"] == "flow[0]"
        assert step_map["node-2"] == "flow[0].switch.cases[0].steps[0]"
        assert step_map["node-3"] == "flow[0].switch.cases[1].steps[0]"
        assert step_map["node-4"] == "flow[0].switch.default[0]"

    def test_an_authored_label_names_the_node(self) -> None:
        # Guard: `label` must not become an accepted-then-discarded key.
        flow = [
            {
                "switch": {
                    "label": "Route by status",
                    "cases": [{"when": "code == 200", "steps": [LOG_STEP]}],
                }
            }
        ]
        result = compile_clean(make_recipe(flow, variables=SWITCH_VARIABLES))
        assert nodes_by_id(result)["node-1"]["data"]["label"] == "Route by status"

    def test_switch_without_a_default_still_wires_then_onward(self) -> None:
        flow = [
            {"switch": {"cases": [{"when": "code == 200", "steps": [LOG_STEP]}]}},
            LOG_STEP,
        ]
        result = compile_clean(make_recipe(flow, variables=SWITCH_VARIABLES))
        branches = values_of(result, "node-1")["branches"]
        assert [branch["type"] for branch in branches] == ["case"]
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "branch_0"
        egress = edge_between(result, "node-1", "node-3")
        assert egress["sourceHandle"] == "then"
        assert egress.get("targetHandle") is None
        assert edges_from(result, "node-2") == []

    def test_a_trailing_switch_wires_nothing_onward(self) -> None:
        flow = [{"switch": {"cases": [{"when": "code == 200", "steps": [LOG_STEP]}]}}]
        result = compile_clean(make_recipe(flow, variables=SWITCH_VARIABLES))
        assert [edge["sourceHandle"] for edge in edges_from(result, "node-1")] == ["branch_0"]
        assert edges_from(result, "node-2") == []

    def test_case_and_default_labels_come_from_label_and_default_label(self) -> None:
        flow = [
            {
                "switch": {
                    "cases": [
                        {"label": "OK", "when": "code == 200", "steps": [LOG_STEP]},
                        {"when": "code == 404", "steps": [LOG_STEP]},
                    ],
                    "default_label": "Fallback",
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        result = compile_clean(make_recipe(flow, variables=SWITCH_VARIABLES))
        branches = values_of(result, "node-1")["branches"]
        assert [branch["label"] for branch in branches] == ["OK", "", "Fallback"]

    def test_a_case_when_list_joins_its_conditions(self) -> None:
        flow = [
            {"switch": {"cases": [{"when": ["code == 200", COMPARISON], "steps": [LOG_STEP]}]}},
            LOG_STEP,
        ]
        conditions = values_of(
            compile_clean(make_recipe(flow, variables=SWITCH_VARIABLES)), "node-1"
        )["branches"][0]["conditions"]
        assert [without_id(item) for item in conditions] == [
            {"type": "expression", "expression": "code == 200"},
            {"type": "operator", "value": "and"},
            {
                "type": "literal",
                "variable": "transport",
                "operator": "equals",
                "value_type": "string",
                "reference_value": "TCP",
            },
        ]
        assert_assertion_ids(conditions)


CONDITION_VARIABLES = {
    "x": {"type": "integer", "value": 1},
    "count": {"type": "integer", "value": 0},
    "limit": {"type": "integer", "value": 5},
    "host": {"type": "string", "value": "web-1"},
    "prefix": {"type": "string", "value": "web"},
}


def assertion_items(that: list[Any]) -> list[dict[str, Any]]:
    flow = [{"assert": {"that": that}}, LOG_STEP]
    result = compile_clean(make_recipe(flow, variables=CONDITION_VARIABLES))
    items: list[dict[str, Any]] = values_of(result, "node-1")["assertions"]
    return items


def without_ids(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Condition items with every id dropped, group items included."""
    stripped: list[dict[str, Any]] = []
    for item in items:
        bare = without_id(item)
        if bare.get("type") == "group":
            bare["items"] = without_ids(bare["items"])
        stripped.append(bare)
    return stripped


def item_ids(items: list[dict[str, Any]]) -> list[Any]:
    """The ids of every condition and group item, group items included."""
    ids: list[Any] = []
    for item in items:
        if item.get("type") == "operator":
            continue
        ids.append(item.get("id"))
        if item.get("type") == "group":
            ids.extend(item_ids(item["items"]))
    return ids


def expression(text: str) -> dict[str, Any]:
    return {"type": "expression", "expression": text}


def operator(word: str) -> dict[str, Any]:
    return {"type": "operator", "value": word}


class TestConditionItems:
    """Recipe condition lists compile to the stored condition items (REQ-5.2.7.3)."""

    def test_an_or_marker_becomes_an_or_operator(self) -> None:
        items = assertion_items(["x == 1", "or", "x == 2"])
        assert without_ids(items) == [expression("x == 1"), operator("or"), expression("x == 2")]
        assert_assertion_ids(items)

    def test_neighbors_are_joined_with_and(self) -> None:
        items = assertion_items(["x == 1", "x == 2", "or", "x == 3"])
        assert without_ids(items) == [
            expression("x == 1"),
            operator("and"),
            expression("x == 2"),
            operator("or"),
            expression("x == 3"),
        ]

    def test_an_explicit_and_marker_is_kept_once(self) -> None:
        items = assertion_items(["x == 1", "and", "x == 2"])
        assert without_ids(items) == [expression("x == 1"), operator("and"), expression("x == 2")]

    def test_a_group_becomes_a_group_item_with_nested_items_and_unique_ids(self) -> None:
        items = assertion_items([{"group": ["x == 1", "or", "x == 2"]}, "x == 3"])
        assert without_ids(items) == [
            {
                "type": "group",
                "items": [expression("x == 1"), operator("or"), expression("x == 2")],
            },
            operator("and"),
            expression("x == 3"),
        ]
        ids = item_ids(items)
        assert len(ids) == 4
        assert all(isinstance(item_id, str) and item_id for item_id in ids)
        assert len(set(ids)) == len(ids)

    def test_groups_nest_inside_groups(self) -> None:
        items = assertion_items([{"group": ["x == 1", {"group": ["x == 2", "or", "x == 3"]}]}])
        assert without_ids(items) == [
            {
                "type": "group",
                "items": [
                    expression("x == 1"),
                    operator("and"),
                    {
                        "type": "group",
                        "items": [expression("x == 2"), operator("or"), expression("x == 3")],
                    },
                ],
            }
        ]
        ids = item_ids(items)
        assert len(ids) == 5
        assert len(set(ids)) == len(ids)

    def test_an_expression_compare_to_sets_the_flag_with_the_text_and_the_declared_type(
        self,
    ) -> None:
        (item,) = assertion_items(
            [{"variable": "count", "operator": "equals", "value": {"expr": "limit + 1"}}]
        )
        assert without_id(item) == {
            "type": "literal",
            "variable": "count",
            "operator": "equals",
            "value_type": "integer",
            "reference_value": "limit + 1",
            "reference_is_expression": True,
        }

    @pytest.mark.parametrize(
        ("value", "stored"),
        [
            pytest.param("{{ prefix }}-1", "{{ prefix }}-1", id="template-text"),
            pytest.param({"template": "web-1"}, "web-1", id="template-form"),
        ],
    )
    def test_a_template_compare_to_sets_the_template_flag(self, value: Any, stored: str) -> None:
        (item,) = assertion_items([{"variable": "host", "operator": "equals", "value": value}])
        assert without_id(item) == {
            "type": "literal",
            "variable": "host",
            "operator": "equals",
            "value_type": "string",
            "reference_value": stored,
            "reference_is_template": True,
        }

    def test_a_literal_compare_to_sets_no_flag(self) -> None:
        (item,) = assertion_items(
            [{"variable": "host", "operator": "equals", "value": {"literal": "{{ prefix }}-1"}}]
        )
        assert without_id(item) == {
            "type": "literal",
            "variable": "host",
            "operator": "equals",
            "value_type": "string",
            "reference_value": "{{ prefix }}-1",
        }

    def test_a_comparison_written_with_no_value_stores_no_compare_to_value(self) -> None:
        (item,) = assertion_items([{"variable": "host", "operator": "equals"}])
        assert without_id(item) == {
            "type": "literal",
            "variable": "host",
            "operator": "equals",
            "value_type": "string",
        }

    def test_a_null_value_is_stored_as_written(self) -> None:
        (item,) = assertion_items([{"variable": "host", "operator": "equals", "value": None}])
        assert without_id(item) == {
            "type": "literal",
            "variable": "host",
            "operator": "equals",
            "value_type": "string",
            "reference_value": None,
        }

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param({"expr": "prefix"}, id="expression"),
            pytest.param({"literal": "web"}, id="literal-form"),
            pytest.param("{{ prefix }}-1", id="template-text"),
            pytest.param({"template": "web-1"}, id="template-form"),
        ],
    )
    def test_a_unary_operator_with_a_value_stores_no_compare_to_value(self, value: Any) -> None:
        (item,) = assertion_items([{"variable": "host", "operator": "is_null", "value": value}])
        assert without_id(item) == {
            "type": "literal",
            "variable": "host",
            "operator": "is_null",
            "value_type": "string",
        }

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param("{{ limit }}", id="template-text"),
            pytest.param({"template": "{{ limit }}"}, id="template-form"),
        ],
    )
    def test_a_template_under_a_unary_operator_on_a_number_compiles_and_is_dropped(
        self, value: Any
    ) -> None:
        (item,) = assertion_items(
            [{"variable": "count", "operator": "is_not_null", "value": value}]
        )
        assert without_id(item) == {
            "type": "literal",
            "variable": "count",
            "operator": "is_not_null",
            "value_type": "integer",
        }


class TestUnreachableGuard:
    def test_a_compile_producing_an_orphan_block_is_refused(self) -> None:
        from unittest.mock import patch

        with patch(
            "wavecore.core.recipes.compiler._unreachable_flow_nodes",
            return_value=["node-1"],
        ):
            result = compile_recipe(make_recipe([LOG_STEP]))

        assert result["test_data"] is None
        finding = find_finding(result["findings"], "UNREACHABLE_BLOCK")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "Compiled block is unreachable from the start of the flow"

    def test_notes_beside_the_flow_never_trip_the_guard(self) -> None:
        notes = [{"note": {"text": "Reviewed", "color": "yellow"}}]
        result = compile_clean(make_recipe([LOG_STEP], notes=notes))
        note = next(
            node for node in result["test_data"]["workflow"]["nodes"] if node["type"] == "noteNode"
        )
        assert not [
            edge for edge in all_edges(result) if note["id"] in (edge["source"], edge["target"])
        ]


class TestLoops:
    def test_for_count_form(self) -> None:
        flow = [{"for": {"count": 3, "body": [LOG_STEP, LOG_STEP]}}, LOG_STEP]
        result = compile_clean(make_recipe(flow))
        assert values_of(result, "node-1") == {"mode": "count", "count": 3}
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "body"
        assert edge_between(result, "node-1", "node-4")["sourceHandle"] == "then"
        chain = edge_between(result, "node-2", "node-3")
        assert chain.get("sourceHandle") is None

    def test_loop_body_tail_is_a_dead_end(self) -> None:
        flow = [{"for": {"count": 3, "body": [LOG_STEP, LOG_STEP]}}, LOG_STEP]
        result = compile_clean(make_recipe(flow))
        assert edges_from(result, "node-3") == []

    def test_for_range_form(self) -> None:
        flow = [{"for": {"range": {"start": 0, "end": 10, "step": 2}, "body": [LOG_STEP]}}]
        result = compile_clean(make_recipe(flow))
        assert values_of(result, "node-1") == {
            "mode": "range",
            "start": 0,
            "end": 10,
            "step": 2,
        }

    def test_for_each_collection_expression_and_capture(self) -> None:
        flow = [
            {
                "for_each": {
                    "collection": {"expr": "items"},
                    "body": [LOG_STEP],
                    "capture": {"item": "current", "index": "i"},
                }
            }
        ]
        variables = {"items": {"type": "array", "value": []}}
        result = compile_clean(make_recipe(flow, variables=variables))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"] == {"collection": "items"}
        assert data["expressionFields"] == ["collection"]
        assert data["config"]["outputBindings"] == {"item": "current", "index": "i"}

    def test_while_conditions_and_passthrough_settings(self) -> None:
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
        variables = {"i": {"type": "integer", "value": 0}}
        result = compile_clean(make_recipe(flow, variables=variables))
        values = values_of(result, "node-1")
        assert values["mode"] == "do-while"
        assert values["max_iterations"] == 5
        assert values["timeout"] == 30
        assert [without_id(item) for item in values["conditions"]] == [
            {"type": "expression", "expression": "i < 10"}
        ]
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "body"

    def test_for_count_mode_keeps_its_step(self) -> None:
        flow = [{"for": {"count": 6, "step": 2, "body": [LOG_STEP]}}]
        result = compile_clean(make_recipe(flow))
        assert values_of(result, "node-1") == {"mode": "count", "count": 6, "step": 2}

    def test_for_each_writes_a_given_collection_type(self) -> None:
        flow = [
            {
                "for_each": {
                    "collection": {"expr": "bag"},
                    "collection_type": "map",
                    "body": [LOG_STEP],
                }
            }
        ]
        variables = {"bag": {"type": "map", "value": {}}}
        result = compile_clean(make_recipe(flow, variables=variables))
        assert values_of(result, "node-1") == {"collection": "bag", "collection_type": "map"}

    @pytest.mark.parametrize("declared", ["array", "map", "table"])
    def test_for_each_derives_the_collection_type_from_the_variable_it_names(
        self, declared: str
    ) -> None:
        flow = [{"for_each": {"collection": "bag", "body": [LOG_STEP]}}]
        variables = {"bag": {"type": declared}}
        result = compile_clean(make_recipe(flow, variables=variables))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"] == {"collection": "bag", "collection_type": declared}
        assert data["expressionFields"] == []

    def test_for_each_leaves_the_collection_type_out_for_an_expression_collection(self) -> None:
        flow = [{"for_each": {"collection": {"expr": "bag"}, "body": [LOG_STEP]}}]
        variables = {"bag": {"type": "map", "value": {}}}
        result = compile_clean(make_recipe(flow, variables=variables))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"] == {"collection": "bag"}
        assert data["expressionFields"] == ["collection"]


class TestWaitUntil:
    """`wait_until` is a container step: a `retry` lane plus a `then` egress.

    Presence of `retry` selects Retry mode, absence selects Watch, and a Watch
    node carries the single unnamed egress its canvas handle produces
    (WAIT-3).
    """

    WAIT_VARIABLES = {
        "pod_phase": {"type": "string", "value": ""},
        "transport": {"type": "string", "value": "TCP"},
    }

    def _retry_flow(self, **overrides: Any) -> list[Any]:
        value: dict[str, Any] = {
            "that": ["pod_phase == 'Running'"],
            "timeout": 30000,
            "retry": [LOG_STEP],
        }
        value.update(overrides)
        return [{"wait_until": value}, LOG_STEP]

    def _compile_retry(self, **overrides: Any) -> dict[str, Any]:
        return compile_clean(
            make_recipe(self._retry_flow(**overrides), variables=self.WAIT_VARIABLES)
        )

    def test_it_compiles_to_the_wait_until_control(self) -> None:
        result = self._compile_retry()
        assert nodes_by_id(result)["node-1"]["data"]["elementType"] == "wait-until"

    def test_the_condition_set_becomes_assertion_items(self) -> None:
        result = self._compile_retry()
        items = values_of(result, "node-1")["conditions"]
        assert [without_id(item) for item in items] == [
            {"type": "expression", "expression": "pod_phase == 'Running'"}
        ]
        assert_assertion_ids(items)

    def test_several_conditions_interleave_with_and_operators(self) -> None:
        result = self._compile_retry(that=["pod_phase == 'Running'", COMPARISON])
        items = values_of(result, "node-1")["conditions"]
        assert [item["type"] for item in items] == ["expression", "operator", "literal"]

    def test_the_deadline_and_interval_land_on_the_node(self) -> None:
        result = self._compile_retry(interval=250)
        values = values_of(result, "node-1")
        assert values["timeout"] == 30000
        assert values["check_interval"] == 250

    def test_an_omitted_interval_is_not_emitted(self) -> None:
        # The control's own default supplies 1000; writing it out would make an
        # unset interval indistinguishable from an authored one.
        assert "check_interval" not in values_of(self._compile_retry(), "node-1")

    def test_the_message_and_fail_scope_pass_through(self) -> None:
        result = self._compile_retry(message="pod never reached Running", fail_current_scope=True)
        values = values_of(result, "node-1")
        assert values["message"] == "pod never reached Running"
        assert values["fail_current_scope"] is True

    def test_a_retry_lane_selects_retry_mode(self) -> None:
        assert values_of(self._compile_retry(), "node-1")["mode"] == "retry"

    def test_the_retry_lane_anchors_on_its_own_handle(self) -> None:
        result = self._compile_retry()
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "retry"

    def test_the_continuation_leaves_via_the_then_egress(self) -> None:
        result = self._compile_retry()
        assert edge_between(result, "node-1", "node-3")["sourceHandle"] == "then"

    def test_the_retry_lane_tail_is_a_dead_end(self) -> None:
        result = self._compile_retry()
        assert edges_from(result, "node-2") == []

    def test_a_multi_step_retry_lane_chains_internally(self) -> None:
        result = compile_clean(
            make_recipe(
                [
                    {
                        "wait_until": {
                            "that": ["pod_phase == 'Running'"],
                            "timeout": 1,
                            "retry": [LOG_STEP, LOG_STEP],
                        }
                    }
                ],
                variables=self.WAIT_VARIABLES,
            )
        )
        assert edge_between(result, "node-2", "node-3").get("sourceHandle") is None

    def test_capture_binds_the_two_outputs(self) -> None:
        result = self._compile_retry(capture={"passed": "pod_ready", "elapsed": "waited_ms"})
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["outputBindings"] == {
            "passed": "pod_ready",
            "elapsed": "waited_ms",
        }

    def test_captured_targets_are_declared_with_the_output_types(self) -> None:
        result = self._compile_retry(capture={"passed": "pod_ready", "elapsed": "waited_ms"})
        variables = result["test_data"]["variables"]
        assert variables["pod_ready"]["type"] == "boolean"
        assert variables["waited_ms"]["type"] == "integer"

    def test_an_authored_label_names_the_node(self) -> None:
        result = self._compile_retry(label="Poll pod")
        assert nodes_by_id(result)["node-1"]["data"]["label"] == "Poll pod"

    def test_the_step_map_covers_the_retry_children(self) -> None:
        result = self._compile_retry()
        assert result["step_map"]["node-2"] == "flow[0].wait_until.retry[0]"

    def test_an_empty_retry_lane_still_selects_retry_mode(self) -> None:
        # An empty lane is legal on the canvas, and the round trip stays
        # lossless only if `retry: []` keeps meaning Retry.
        result = compile_clean(
            make_recipe(
                [
                    {"wait_until": {"that": ["pod_phase == 'Running'"], "timeout": 1, "retry": []}},
                    LOG_STEP,
                ],
                variables=self.WAIT_VARIABLES,
            )
        )
        assert values_of(result, "node-1")["mode"] == "retry"
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "then"

    def test_no_retry_lane_selects_watch_mode(self) -> None:
        result = compile_clean(
            make_recipe(
                [{"wait_until": {"that": ["pod_phase == 'Running'"], "timeout": 1}}, LOG_STEP],
                variables=self.WAIT_VARIABLES,
            )
        )
        assert values_of(result, "node-1")["mode"] == "watch"

    def test_a_watch_node_continues_on_its_unnamed_default_egress(self) -> None:
        # Watch renders the single default handle, so its edge is unnamed -
        # exactly like any sequential block's.
        result = compile_clean(
            make_recipe(
                [{"wait_until": {"that": ["pod_phase == 'Running'"], "timeout": 1}}, LOG_STEP],
                variables=self.WAIT_VARIABLES,
            )
        )
        assert edge_between(result, "node-1", "node-2").get("sourceHandle") is None

    def test_a_trailing_wait_wires_nothing_onward(self) -> None:
        result = compile_clean(
            make_recipe(
                [
                    {
                        "wait_until": {
                            "that": ["pod_phase == 'Running'"],
                            "timeout": 1,
                            "retry": [LOG_STEP],
                        }
                    }
                ],
                variables=self.WAIT_VARIABLES,
            )
        )
        assert [edge.get("sourceHandle") for edge in edges_from(result, "node-1")] == ["retry"]


class TestTryCatchFinally:
    def _compile_full(self) -> dict[str, Any]:
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
        return compile_clean(make_recipe(flow))

    def test_section_presence_sets_the_enable_flags(self) -> None:
        result = self._compile_full()
        values = values_of(result, "node-1")
        assert values["enable_catch"] is True
        assert values["enable_finally"] is True

    def test_absent_sections_disable_their_flags_explicitly(self) -> None:
        result = compile_clean(make_recipe([{"try": {"steps": [LOG_STEP]}}, LOG_STEP]))
        values = values_of(result, "node-1")
        assert values["enable_catch"] is False
        assert values["enable_finally"] is False

    def test_sections_anchor_on_their_named_handles(self) -> None:
        result = self._compile_full()
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "try"
        assert edge_between(result, "node-1", "node-3")["sourceHandle"] == "catch"
        assert edge_between(result, "node-1", "node-4")["sourceHandle"] == "finally"

    def test_continuation_leaves_via_the_then_egress(self) -> None:
        result = self._compile_full()
        assert edge_between(result, "node-1", "node-5")["sourceHandle"] == "then"

    def test_section_tails_are_dead_ends(self) -> None:
        result = self._compile_full()
        for section_tail in ("node-2", "node-3", "node-4"):
            assert edges_from(result, section_tail) == []

    def test_capture_binds_the_try_outputs(self) -> None:
        result = self._compile_full()
        bindings = nodes_by_id(result)["node-1"]["data"]["config"]["outputBindings"]
        assert bindings == {"error": "err", "caught": "was_caught"}

    def test_step_map_covers_all_sections(self) -> None:
        result = self._compile_full()
        assert result["step_map"]["node-2"] == "flow[0].try.steps[0]"
        assert result["step_map"]["node-3"] == "flow[0].try.catch[0]"
        assert result["step_map"]["node-4"] == "flow[0].try.finally[0]"


class TestAssert:
    def test_single_mode_is_emitted_explicitly(self) -> None:
        # An assert without lanes is single, whatever the declared default says.
        flow = [{"assert": {"that": ["x == 1"]}}, LOG_STEP]
        variables = {"x": {"type": "integer", "value": 1}}
        result = compile_clean(make_recipe(flow, variables=variables))
        values = values_of(result, "node-1")
        assert values["mode"] == "single"
        egress = edge_between(result, "node-1", "node-2")
        assert egress.get("sourceHandle") is None

    def test_split_mode_wires_pass_and_fail(self) -> None:
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
        result = compile_clean(make_recipe(flow, variables=variables))
        values = values_of(result, "node-1")
        assert values["mode"] == "split"
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "pass"
        assert edge_between(result, "node-1", "node-3")["sourceHandle"] == "fail"
        assert edge_between(result, "node-2", "node-4").get("targetHandle") is None
        assert edge_between(result, "node-3", "node-4")["targetHandle"] == "ingress_1"
        assert result["step_map"]["node-2"] == "flow[0].assert.on_pass[0]"
        assert result["step_map"]["node-3"] == "flow[0].assert.on_fail[0]"

    def test_multiple_assertions_interleave_with_and_operators(self) -> None:
        flow = [{"assert": {"that": ["x == 1", COMPARISON]}}, LOG_STEP]
        variables = {
            "x": {"type": "integer", "value": 1},
            "transport": {"type": "string", "value": "TCP"},
        }
        result = compile_clean(make_recipe(flow, variables=variables))
        assertions = values_of(result, "node-1")["assertions"]
        assert [without_id(item) for item in assertions] == [
            {"type": "expression", "expression": "x == 1"},
            {"type": "operator", "value": "and"},
            {
                "type": "literal",
                "variable": "transport",
                "operator": "equals",
                "value_type": "string",
                "reference_value": "TCP",
            },
        ]
        assert_assertion_ids(assertions)

    def test_empty_pass_and_fail_meeting_the_next_step_each_keep_their_own_wire(self) -> None:
        flow = [{"assert": {"that": ["x == 1"], "on_pass": [], "on_fail": []}}, LOG_STEP]
        variables = {"x": {"type": "integer", "value": 1}}
        result = compile_clean(make_recipe(flow, variables=variables))
        assert [edge["id"] for edge in edges_from(result, "node-1")] == [
            "edge-node-1-pass-node-2",
            "edge-node-1-fail-node-2-ingress_1",
        ]

    def test_split_mode_with_no_section_last_in_the_flow_stays_split_with_no_egress(self) -> None:
        flow = [LOG_STEP, {"assert": {"that": ["x == 1"], "mode": "split"}}]
        variables = {"x": {"type": "integer", "value": 1}}
        result = compile_clean(make_recipe(flow, variables=variables))
        assert values_of(result, "node-2")["mode"] == "split"
        assert edges_from(result, "node-2") == []


class TestRemote:
    def _compile(self) -> dict[str, Any]:
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
        variables = {"ssh_session": {"type": "string", "value": "main"}}
        return compile_clean(make_recipe(flow, variables=variables))

    def test_remote_compiles_to_the_engine_dispatched_container(self) -> None:
        result = self._compile()
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["elementType"] == "remote-execution"
        assert data["nodeType"] == "plugin"
        assert "category" not in data
        assert data["config"]["values"] == {"session_id": "ssh_session"}
        assert data["expressionFields"] == ["session_id"]
        assert data["config"]["outputBindings"] == {"remote_session_id": "rsid"}

    def test_remote_wires_body_and_then(self) -> None:
        result = self._compile()
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "body"
        assert edge_between(result, "node-1", "node-3")["sourceHandle"] == "then"
        assert result["step_map"]["node-2"] == "flow[0].remote.body[0]"

    def test_remote_binds_its_profiles(self) -> None:
        profile = create_profile("remote-main")
        flow = [
            {
                "remote": {
                    "settings": {"session_id": {"expr": "ssh_session"}},
                    "profiles": [{"profile": "remote-main"}],
                    "body": [LOG_STEP],
                }
            }
        ]
        variables = {"ssh_session": {"type": "string", "value": "main"}}
        result = compile_clean(make_recipe(flow, variables=variables))
        bindings = nodes_by_id(result)["node-1"]["data"]["config"]["profileBindings"]
        assert bindings == [
            {
                "profileId": profile["id"],
                "profileName": "remote-main",
                "profileType": profile["type"],
            }
        ]


class TestBreakContinue:
    def test_break_targets_the_innermost_loop(self) -> None:
        flow = [
            {
                "while": {
                    "label": "outer",
                    "conditions": "True",
                    "body": [
                        {"for": {"count": 3, "body": [{"break": {}}]}},
                        {"break": {"loop": "outer"}},
                    ],
                }
            }
        ]
        result = compile_clean(make_recipe(flow))
        assert nodes_by_id(result)["node-1"]["data"]["label"] == "outer"
        assert values_of(result, "node-3") == {"target_loop": "node-2"}
        assert values_of(result, "node-4") == {"target_loop": "node-1"}
        assert result["step_map"]["node-3"] == "flow[0].while.body[0].for.body[0]"

    def test_continue_targets_the_innermost_loop(self) -> None:
        flow = [{"while": {"conditions": "True", "body": [{"continue": {}}]}}]
        result = compile_clean(make_recipe(flow))
        assert values_of(result, "node-2") == {"target_loop": "node-1"}

    def test_break_outside_a_loop_is_an_error(self) -> None:
        result = compile_recipe(make_recipe([{"break": {}}]))
        finding = find_finding(result["findings"], "BREAK_OUTSIDE_LOOP")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "break/continue is only valid inside a loop body"
        assert finding["fix"] is None
        assert result["test_data"] is None

    def test_continue_outside_a_loop_is_an_error(self) -> None:
        result = compile_recipe(make_recipe([{"continue": {}}]))
        find_finding(result["findings"], "BREAK_OUTSIDE_LOOP")

    def test_unknown_loop_label_is_an_error(self) -> None:
        flow = [{"while": {"conditions": "True", "body": [{"break": {"loop": "nope"}}]}}]
        result = compile_recipe(make_recipe(flow))
        finding = find_finding(result["findings"], "UNKNOWN_LOOP_LABEL")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].while.body[0]"
        assert finding["problem"] == "No enclosing loop is labeled 'nope'"
        assert finding["fix"] == "Label the target loop and reference that label"

    def test_sibling_loop_labels_are_not_enclosing(self) -> None:
        flow = [
            {"for": {"label": "other", "count": 1, "body": [LOG_STEP]}},
            {"while": {"conditions": "True", "body": [{"break": {"loop": "other"}}]}},
        ]
        result = compile_recipe(make_recipe(flow))
        find_finding(result["findings"], "UNKNOWN_LOOP_LABEL")


class TestLeafSugar:
    def test_delay_scalar_form(self) -> None:
        result = compile_clean(make_recipe([{"delay": 500}]))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["elementType"] == "delay"
        assert data["config"]["values"] == {"duration": 500}

    def test_delay_mapping_form(self) -> None:
        result = compile_clean(make_recipe([{"delay": {"duration": 500}}]))
        assert values_of(result, "node-1") == {"duration": 500}

    def test_set_compiles_to_a_variable_setter(self) -> None:
        flow = [{"set": {"counter": 0, "greeting": {"expr": "'hi ' + user"}}}]
        variables = {
            "counter": {"type": "integer", "value": 0},
            "greeting": {"type": "string", "value": ""},
            "user": {"type": "string", "value": "sam"},
        }
        result = compile_clean(make_recipe(flow, variables=variables))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["elementType"] == "variable-setter"
        assert data["config"]["values"] == {"variables": {"counter": 0, "greeting": "'hi ' + user"}}
        assert data["expressionFields"] == ["variables.greeting"]
        # A row's type is its declared variable's type; the Block stores none (REQ-3.4.1.14).
        assert variable_prefixed_keys(data) == []

    def test_set_types_rows_from_auto_declared_capture_targets(self) -> None:
        flow = [
            {
                "block": "http-client",
                "settings": {"url": "http://x", "method": "GET"},
                "capture": {"status_code": "code"},
            },
            {"set": {"code": 0}},
        ]
        result = compile_clean(make_recipe(flow))
        data = nodes_by_id(result)["node-2"]["data"]
        assert variable_prefixed_keys(data) == []
        assert result["test_data"]["variables"]["code"] == {"type": "integer"}

    def test_halt_settings_pass_through(self) -> None:
        flow = [LOG_STEP, {"halt": {"scope": "test", "status": "failed", "message": "gave up"}}]
        result = compile_clean(make_recipe(flow))
        data = nodes_by_id(result)["node-2"]["data"]
        assert data["elementType"] == "halt"
        assert data["config"]["values"] == {
            "scope": "test",
            "status": "failed",
            "message": "gave up",
        }
        assert edges_from(result, "node-2") == []

    def test_a_note_step_stands_in_the_flow(self) -> None:
        flow = [LOG_STEP, {"note": {"text": "Reviewed by QA", "color": "yellow"}}, LOG_STEP]
        result = compile_clean(make_recipe(flow))
        note = nodes_by_id(result)["node-2"]
        assert note["type"] == "noteNode"
        assert note["data"]["elementType"] == "note"
        config = note["data"]["config"]
        assert config["values"] == {"text": "Reviewed by QA", "color": "yellow"}
        assert "text" not in config
        assert "color" not in config
        assert edges_from(result, "node-1") == [
            {"id": "edge-node-1-node-2", "source": "node-1", "target": "node-2"}
        ]
        assert edges_from(result, "node-2") == [
            {"id": "edge-node-2-node-3", "source": "node-2", "target": "node-3"}
        ]

    @pytest.mark.parametrize(
        "halt_step",
        [
            pytest.param({"halt": {}}, id="halt-keyword"),
            pytest.param({"block": "halt"}, id="block-halt"),
        ],
    )
    def test_a_step_after_a_halt_is_unreachable(self, halt_step: dict[str, Any]) -> None:
        result = compile_recipe(make_recipe([halt_step, LOG_STEP]))
        assert result["test_data"] is None
        assert find_finding(result["findings"], "UNREACHABLE_BLOCK") == {
            "step": "flow[1]",
            "code": "UNREACHABLE_BLOCK",
            "severity": "error",
            "problem": "Compiled block is unreachable from the start of the flow",
            "fix": None,
        }


class TestStepIdentity:
    """A step's description and disabled mark are written on its Block (REQ-5.2.7.3)."""

    @pytest.mark.parametrize(
        "step",
        [
            pytest.param({**LOG_STEP, "description": "Says hello", "disabled": True}, id="block"),
            pytest.param(
                {"set": {"counter": 1}, "description": "Says hello", "disabled": True},
                id="set",
            ),
            pytest.param(
                {
                    "for": {
                        "count": 2,
                        "description": "Says hello",
                        "disabled": True,
                        "body": [LOG_STEP],
                    }
                },
                id="construct",
            ),
        ],
    )
    def test_a_step_holds_its_description_and_disabled_mark(self, step: dict[str, Any]) -> None:
        variables = {"counter": {"type": "integer", "value": 0}}
        result = compile_clean(make_recipe([step], variables=variables))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["description"] == "Says hello"
        assert data["disabled"] is True


class TestNodeDataShape:
    """A compiled Block keeps its values in config.values and the shared flags only
    (REQ-5.2.7.3)."""

    def test_no_block_carries_a_variable_key(self) -> None:
        flow = [
            LOG_STEP,
            {"note": "Reviewed"},
            {"for": {"count": 2, "body": [{"set": {"counter": 1}}]}},
        ]
        variables = {"counter": {"type": "integer", "value": 0}}
        nodes = compile_clean(make_recipe(flow, variables=variables))["test_data"]["workflow"][
            "nodes"
        ]
        assert {node["data"]["elementType"] for node in nodes} == {
            "log",
            "note",
            "for",
            "variable-setter",
        }
        assert {node["id"]: variable_prefixed_keys(node["data"]) for node in nodes} == {
            node["id"]: [] for node in nodes
        }


def without_key(values: dict[str, Any], key: str) -> dict[str, Any]:
    return {name: value for name, value in values.items() if name != key}


class TestConstructCreationValues:
    """A construct step holds every choice-list and true / false value its control declares,
    from the declared default unless the step gives one (FIELD-8, REQ-5.2.7.3)."""

    def test_a_while_step_without_a_mode_holds_the_declared_mode(self) -> None:
        flow = [{"while": {"conditions": "i < 10", "body": [LOG_STEP]}}]
        variables = {"i": {"type": "integer", "value": 0}}
        result = compile_clean(make_recipe(flow, variables=variables))

        assert without_key(values_of(result, "node-1"), "conditions") == {"mode": "while-do"}

    def test_a_while_step_keeps_the_mode_it_gives(self) -> None:
        flow = [{"while": {"conditions": "i < 10", "mode": "do-while", "body": [LOG_STEP]}}]
        variables = {"i": {"type": "integer", "value": 0}}
        result = compile_clean(make_recipe(flow, variables=variables))

        assert without_key(values_of(result, "node-1"), "conditions") == {"mode": "do-while"}

    def test_a_for_step_holds_only_its_own_mode(self) -> None:
        result = compile_clean(make_recipe([{"for": {"count": 3, "body": [LOG_STEP]}}]))

        assert values_of(result, "node-1") == {"mode": "count", "count": 3}

    @pytest.mark.parametrize(
        "step",
        [
            pytest.param({"collection": {"expr": "items"}, "collection_type": "array"}, id="given"),
            pytest.param({"collection": "items"}, id="derived"),
        ],
    )
    def test_a_for_each_step_writes_the_collection_type_when_given_or_derived(
        self, step: dict[str, Any]
    ) -> None:
        flow = [{"for_each": {**step, "body": [LOG_STEP]}}]
        variables = {"items": {"type": "array", "value": []}}
        result = compile_clean(make_recipe(flow, variables=variables))

        assert values_of(result, "node-1") == {"collection": "items", "collection_type": "array"}

    def test_a_wait_until_step_holds_the_declared_fail_scope_flag(self) -> None:
        flow = [{"wait_until": {"that": ["ready == True"], "timeout": 30000, "retry": [LOG_STEP]}}]
        variables = {"ready": {"type": "boolean", "value": False}}
        result = compile_clean(make_recipe(flow, variables=variables))

        assert without_key(values_of(result, "node-1"), "conditions") == {
            "timeout": 30000,
            "mode": "retry",
            "fail_current_scope": False,
        }

    def test_an_assert_step_holds_the_declared_fail_scope_flag(self) -> None:
        flow = [{"assert": {"that": ["1 == 1"]}}]
        result = compile_clean(make_recipe(flow))

        assert without_key(values_of(result, "node-1"), "assertions") == {
            "mode": "single",
            "fail_current_scope": False,
        }

    def test_a_try_step_holds_both_section_flags(self) -> None:
        result = compile_clean(make_recipe([{"try": {"steps": [LOG_STEP]}}]))

        assert values_of(result, "node-1") == {"enable_catch": False, "enable_finally": False}

    def test_a_parallel_step_holds_the_declared_join(self) -> None:
        flow = [{"parallel": {"branches": [{"steps": [LOG_STEP]}, {"steps": [LOG_STEP]}]}}]
        result = compile_clean(make_recipe(flow))

        assert without_key(values_of(result, "node-1"), "branches") == {"join": "all"}

    def test_a_halt_step_holds_the_declared_scope_and_status(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP, {"halt": {"message": "gave up"}}]))

        assert values_of(result, "node-2") == {
            "scope": "test",
            "status": "failed",
            "message": "gave up",
        }

    def test_a_halt_step_keeps_the_status_it_gives(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP, {"halt": {"status": "passed"}}]))

        assert values_of(result, "node-2") == {"scope": "test", "status": "passed"}

    def test_a_note_step_holds_the_declared_color_beside_its_text(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP, {"note": "Reviewed by QA"}, LOG_STEP]))

        assert nodes_by_id(result)["node-2"]["data"]["config"]["values"] == {
            "text": "Reviewed by QA",
            "color": "slate",
        }


class TestNestedConstructs:
    def test_construct_inside_a_loop_body_recurses(self) -> None:
        flow = [
            {
                "for": {
                    "count": 2,
                    "body": [
                        {"if": {"when": "x == 1", "then": [LOG_STEP], "else": [LOG_STEP]}},
                        LOG_STEP,
                    ],
                }
            }
        ]
        variables = {"x": {"type": "integer", "value": 1}}
        result = compile_clean(make_recipe(flow, variables=variables))
        assert result["step_map"]["node-3"] == "flow[0].for.body[0].if.then[0]"
        assert result["step_map"]["node-4"] == "flow[0].for.body[0].if.else[0]"
        assert result["step_map"]["node-5"] == "flow[0].for.body[1]"
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "body"
        assert edge_between(result, "node-2", "node-3")["sourceHandle"] == "branch_0"
        assert edge_between(result, "node-3", "node-5").get("targetHandle") is None
        assert edge_between(result, "node-4", "node-5")["targetHandle"] == "ingress_1"

    def test_nested_empty_branches_give_every_wire_its_own_id(self) -> None:
        inner = {"if": {"when": "x == 2", "then": [], "else": []}}
        flow = [{"if": {"when": "x == 1", "then": [inner], "else": []}}, LOG_STEP]
        variables = {"x": {"type": "integer", "value": 1}}
        result = compile_clean(make_recipe(flow, variables=variables))
        ids = [edge["id"] for edge in all_edges(result)]
        assert len(ids) == len(set(ids)), ids
        into_log = [edge["id"] for edge in all_edges(result) if edge["target"] == "node-3"]
        assert into_log == [
            "edge-node-2-branch_0-node-3",
            "edge-node-2-branch_1-node-3-ingress_1",
            "edge-node-1-branch_1-node-3-ingress_2",
        ]

    def test_switch_inside_a_loop_body_recurses(self) -> None:
        flow = [
            {
                "for": {
                    "count": 2,
                    "body": [
                        {
                            "switch": {
                                "cases": [{"when": "x == 1", "steps": [LOG_STEP]}],
                                "default": [LOG_STEP],
                            }
                        },
                        LOG_STEP,
                    ],
                }
            }
        ]
        variables = {"x": {"type": "integer", "value": 1}}
        result = compile_clean(make_recipe(flow, variables=variables))
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "body"
        assert edge_between(result, "node-2", "node-3")["sourceHandle"] == "branch_0"
        assert edge_between(result, "node-2", "node-4")["sourceHandle"] == "branch_1"
        assert edge_between(result, "node-2", "node-5")["sourceHandle"] == "then"
        assert result["step_map"]["node-3"] == "flow[0].for.body[0].switch.cases[0].steps[0]"
        assert result["step_map"]["node-4"] == "flow[0].for.body[0].switch.default[0]"
        assert result["step_map"]["node-5"] == "flow[0].for.body[1]"

    def test_construct_inside_a_switch_case_recurses(self) -> None:
        flow = [
            {
                "switch": {
                    "cases": [
                        {
                            "when": "x == 1",
                            "steps": [
                                {"if": {"when": "y == 2", "then": [LOG_STEP], "else": [LOG_STEP]}},
                                LOG_STEP,
                            ],
                        }
                    ]
                }
            },
            LOG_STEP,
        ]
        variables = {
            "x": {"type": "integer", "value": 1},
            "y": {"type": "integer", "value": 2},
        }
        result = compile_clean(make_recipe(flow, variables=variables))
        assert edge_between(result, "node-1", "node-2")["sourceHandle"] == "branch_0"
        assert edge_between(result, "node-2", "node-3")["sourceHandle"] == "branch_0"
        assert edge_between(result, "node-2", "node-4")["sourceHandle"] == "branch_1"
        assert edge_between(result, "node-3", "node-5").get("targetHandle") is None
        assert edge_between(result, "node-4", "node-5")["targetHandle"] == "ingress_1"
        assert edge_between(result, "node-1", "node-6")["sourceHandle"] == "then"
        assert edges_from(result, "node-5") == []
        assert result["step_map"]["node-3"] == "flow[0].switch.cases[0].steps[0].if.then[0]"
        assert result["step_map"]["node-5"] == "flow[0].switch.cases[0].steps[1]"


class TestCoverageClosure:
    """Passthrough settings and inference paths."""

    def test_for_count_timeout_passes_through(self) -> None:
        flow = [{"for": {"count": 2, "timeout": 9000, "body": [LOG_STEP]}}]
        result = compile_clean(make_recipe(flow))
        assert values_of(result, "node-1")["timeout"] == 9000

    def test_for_each_timeout_passes_through(self) -> None:
        flow = [
            {
                "for_each": {
                    "collection": {"expr": "items"},
                    "timeout": 5000,
                    "body": [LOG_STEP],
                }
            }
        ]
        variables = {"items": {"type": "array", "value": [1]}}
        result = compile_clean(make_recipe(flow, variables=variables))
        assert values_of(result, "node-1")["timeout"] == 5000

    def test_assert_fail_current_scope_passes_through(self) -> None:
        flow = [{"assert": {"that": ["1 == 1"], "fail_current_scope": False}}]
        result = compile_clean(make_recipe(flow))
        assert values_of(result, "node-1")["fail_current_scope"] is False

    def test_comparison_value_type_is_inferred_from_the_literal(self) -> None:
        flow = [
            {
                "if": {
                    "when": {"variable": "count", "operator": "equals", "value": 5},
                    "then": [LOG_STEP],
                }
            }
        ]
        variables = {"count": {"type": "integer", "value": 0}}
        result = compile_clean(make_recipe(flow, variables=variables))
        condition = values_of(result, "node-1")["branches"][0]["conditions"][0]
        assert condition["value_type"] == "integer"

    def test_comparison_without_a_value_takes_the_declared_variable_type(self) -> None:
        flow = [
            {
                "if": {
                    "when": {"variable": "flag", "operator": "is_true"},
                    "then": [LOG_STEP],
                }
            }
        ]
        variables = {"flag": {"type": "boolean", "value": True}}
        result = compile_clean(make_recipe(flow, variables=variables))
        condition = values_of(result, "node-1")["branches"][0]["conditions"][0]
        assert condition["value_type"] == "boolean"

    def test_set_to_an_undeclared_name_stores_no_row_type(self) -> None:
        result = compile_clean(make_recipe([{"set": {"fresh_target": 42}}]))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"] == {"variables": {"fresh_target": 42}}
        assert variable_prefixed_keys(data) == []


VARIABLE_TYPES = ("string", "integer", "float", "boolean", "array", "map", "table")


def if_condition(when: dict[str, Any], variables: dict[str, Any] | None) -> dict[str, Any]:
    flow = [{"if": {"when": when, "then": [LOG_STEP]}}]
    result = compile_clean(make_recipe(flow, variables=variables))
    condition: dict[str, Any] = values_of(result, "node-1")["branches"][0]["conditions"][0]
    return condition


def assert_condition(that: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    result = compile_clean(make_recipe([{"assert": {"that": [that]}}], variables=variables))
    (condition,) = values_of(result, "node-1")["assertions"]
    assert isinstance(condition, dict)
    return condition


class TestValuelessComparisons:
    """A comparison with no value and no value_type takes the checked variable's declared
    type, else carries no value_type and works for any type (REQ-3.1.3.25)."""

    @pytest.mark.parametrize("operator", ["is_null", "is_not_null"])
    @pytest.mark.parametrize("declared", VARIABLE_TYPES)
    def test_a_null_check_takes_the_declared_variable_type(
        self, declared: str, operator: str
    ) -> None:
        condition = if_condition({"variable": "x", "operator": operator}, {"x": {"type": declared}})
        assert without_id(condition) == {
            "type": "literal",
            "variable": "x",
            "operator": operator,
            "value_type": declared,
        }

    @pytest.mark.parametrize("operator", ["is_null", "is_not_null"])
    def test_a_null_check_on_an_undeclared_variable_carries_no_value_type(
        self, operator: str
    ) -> None:
        condition = if_condition({"variable": "outer_value", "operator": operator}, None)
        assert without_id(condition) == {
            "type": "literal",
            "variable": "outer_value",
            "operator": operator,
        }

    def test_an_authored_value_type_wins_and_compiles_with_no_reference(self) -> None:
        condition = if_condition(
            {"variable": "x", "operator": "is_null", "value_type": "string"},
            {"x": {"type": "integer", "value": 3}},
        )
        assert condition["value_type"] == "string"
        assert "reference_value" not in condition

    @pytest.mark.parametrize("operator", ["is_empty", "is_not_empty"])
    def test_a_table_emptiness_check_takes_the_table_type(self, operator: str) -> None:
        condition = assert_condition(
            {"variable": "grid", "operator": operator}, {"grid": {"type": "table"}}
        )
        assert condition["value_type"] == "table"
        assert "reference_value" not in condition

    @pytest.mark.parametrize(
        ("declared", "operator"),
        [
            ("string", "is_null"),
            ("integer", "is_not_null"),
            ("boolean", "is_true"),
            ("boolean", "is_false"),
            ("array", "is_empty"),
            ("table", "is_not_empty"),
        ],
    )
    @pytest.mark.parametrize("value", ["", "abc"])
    def test_an_operator_that_takes_no_value_stores_no_value_and_the_declared_type(
        self, declared: str, operator: str, value: str
    ) -> None:
        condition = if_condition(
            {"variable": "x", "operator": operator, "value": value}, {"x": {"type": declared}}
        )
        assert without_id(condition) == {
            "type": "literal",
            "variable": "x",
            "operator": operator,
            "value_type": declared,
        }

    def test_value_type_table_compiles(self) -> None:
        condition = assert_condition(
            {"variable": "grid", "operator": "is_not_empty", "value_type": "table"},
            {"grid": {"type": "table", "value": None}},
        )
        assert without_id(condition) == {
            "type": "literal",
            "variable": "grid",
            "operator": "is_not_empty",
            "value_type": "table",
        }


class TestFitWidthLayout:
    def test_wide_sibling_columns_do_not_overlap(self) -> None:
        def branch(label: str) -> dict[str, Any]:
            return {"block": "log", "label": label, "settings": {"message": "hello"}}

        flow = [
            {
                "if": {
                    "when": "x == 1",
                    "then": [branch("Then branch with a very long name")],
                    "else": [branch("Else branch with a very long name")],
                }
            }
        ]
        variables = {"x": {"type": "integer", "value": 1}}
        nodes = nodes_by_id(compile_clean(make_recipe(flow, variables=variables)))
        left, right = sorted(
            (nodes["node-2"], nodes["node-3"]), key=lambda node: node["position"]["x"]
        )
        assert left["width"] == right["width"] == 360
        assert left["position"]["x"] + left["width"] <= right["position"]["x"]


class TestControlWidth:
    """A control with more lanes than its name needs is stored at the width its handles draw."""

    def _if_with_elif(self, label: str | None = None) -> dict[str, Any]:
        step: dict[str, Any] = {
            "when": "x == 1",
            "then": [LOG_STEP],
            "elif": [{"when": "x == 2", "then": [LOG_STEP]}],
            "else": [LOG_STEP],
        }
        if label is not None:
            step["label"] = label
        variables = {"x": {"type": "integer", "value": 1}}
        return nodes_by_id(
            compile_clean(make_recipe([{"if": step}, LOG_STEP], variables=variables))
        )

    def test_an_if_with_an_elif_is_as_wide_as_its_three_lanes(self) -> None:
        assert self._if_with_elif()["node-1"]["width"] == 224

    def test_a_rejoin_block_is_as_wide_as_its_ingress_handles(self) -> None:
        nodes = self._if_with_elif()
        rejoin = nodes["node-5"]
        assert rejoin["data"]["elementType"] == "log"
        assert rejoin["width"] == 240

    def test_a_long_name_still_wins_over_the_handle_footprint(self) -> None:
        assert self._if_with_elif("Write push file on sshd host")["node-1"]["width"] == 338

    def test_a_switch_with_two_cases_and_a_default_is_as_wide_as_its_four_lanes(self) -> None:
        flow = [
            {
                "switch": {
                    "cases": [
                        {"when": "code == 200", "steps": [LOG_STEP]},
                        {"when": "code == 404", "steps": [LOG_STEP]},
                    ],
                    "default": [LOG_STEP],
                }
            },
            LOG_STEP,
        ]
        nodes = nodes_by_id(compile_clean(make_recipe(flow, variables=SWITCH_VARIABLES)))
        assert nodes["node-1"]["width"] == 288

    def test_a_try_with_catch_and_finally_is_as_wide_as_its_four_lanes(self) -> None:
        flow = [
            {"try": {"steps": [LOG_STEP], "catch": [LOG_STEP], "finally": [LOG_STEP]}},
            LOG_STEP,
        ]
        assert nodes_by_id(compile_clean(make_recipe(flow)))["node-1"]["width"] == 288

    def test_a_parallel_with_three_branches_is_as_wide_as_its_four_lanes(self) -> None:
        branches = [{"steps": [LOG_STEP]} for _ in range(3)]
        flow = [{"parallel": {"branches": branches}}, LOG_STEP]
        assert nodes_by_id(compile_clean(make_recipe(flow)))["node-1"]["width"] == 288


class TestRecipeNumbersStoredForm:
    """A recipe number is stored the way every surface stores one (REQ-3.1.3.14)."""

    def test_a_float_set_row_and_compare_to_value_type_as_float(self) -> None:
        flow = [
            {"set": {"ratio": 2.5}},
            {
                "if": {
                    "when": {"variable": "ratio", "operator": "equals", "value": "__value__"},
                    "then": [LOG_STEP],
                }
            },
        ]
        recipe = make_recipe(flow, variables={"ratio": {"type": "float"}})
        result = compile_clean(recipe.replace("__value__", "2.50"))
        setter = nodes_by_id(result)["node-1"]["data"]
        condition = values_of(result, "node-2")["branches"][0]["conditions"][0]

        assert variable_prefixed_keys(setter) == []
        assert result["test_data"]["variables"]["ratio"] == {"type": "float"}
        assert setter["config"]["values"] == {"variables": {"ratio": 2.5}}
        assert condition["value_type"] == "float"
        assert condition["reference_value"] == "2.50"

    @pytest.mark.parametrize(
        ("written", "stored"),
        [
            pytest.param("2.5", 2.5, id="float-a-number-keeps"),
            pytest.param("2.50", "2.50", id="float-with-a-trailing-zero"),
            pytest.param("30.0", "30.0", id="whole-float"),
            pytest.param("0.0000001", "0.0000001", id="small-float"),
            pytest.param("30", 30, id="integer"),
            pytest.param("9007199254740993", "9007199254740993", id="integer-past-2-53"),
        ],
    )
    def test_a_loop_timeout_is_stored_in_its_wire_form(self, written: str, stored: Any) -> None:
        flow = [{"for": {"count": 2, "timeout": "__timeout__", "body": [LOG_STEP]}}]
        recipe = make_recipe(flow).replace("__timeout__", written)

        values = values_of(compile_clean(recipe), "node-1")

        assert values["timeout"] == stored
        assert type(values["timeout"]) is type(stored)
