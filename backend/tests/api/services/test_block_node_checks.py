"""The read-only, Block metadata and loop signal target checks and the Wait Until lane rule
shared by the Test save and the Function save.

REQ-3.1.2.4, REQ-3.1.3.13, REQ-3.5.4.3, REQ-3.5.1.2, REQ-3.5.1.3.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from wavecore.api.services.block_node_checks import (
    RemovedWire,
    node_read_only_violations,
    put_body_wires_on_lanes,
    put_flow_wires_on_lanes,
    removed_wires_by_flow,
    validate_loop_targets,
    validate_node_element_type,
    validate_node_metadata,
    validate_read_only_expressions,
)

_CHANGES_DATA = (
    "The append method changes data. An expression can only read data, not change it. "
    "To change a variable, add a Variable Setter Block."
)
_CONTROL_IDS = {"assert", "variable-setter"}


@pytest.fixture(autouse=True)
def _register_log_and_controls() -> Generator[None, None, None]:
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    _registry.clear()
    clear_registry()


def _error(**fields: Any) -> dict[str, Any]:
    """One save error entry, in the shape every save-check error takes."""
    return {
        "path": fields["path"],
        "node_id": fields.get("node_id"),
        "node_label": fields.get("node_label"),
        "element_type": fields.get("element_type"),
        "code": fields["code"],
        "message": fields["message"],
        "severity": "error",
        "fix_action": fields.get("fix_action"),
    }


def _block(
    node_id: str,
    element_type: str,
    *,
    node_type: str = "plugin",
    label: str | None = "Log",
    values: dict[str, Any] | None = None,
    **data: Any,
) -> dict[str, Any]:
    node_data: dict[str, Any] = {
        "elementType": element_type,
        "nodeType": node_type,
        "version": "1.0.0",
        "config": {"values": values or {}, "profileBindings": [], "outputBindings": {}},
        **data,
    }
    if label is not None:
        node_data["label"] = label
    return {"id": node_id, "type": "workflowNode", "data": node_data}


def _metadata_errors(data: dict[str, Any], element_type: str = "log") -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    validate_node_metadata(data, "nodes[0]", "n1", "Log", element_type, _CONTROL_IDS, errors)
    return errors


class TestValidateNodeElementType:
    """An unknown or missing type is refused and the Block's other checks are skipped."""

    def test_a_known_type_passes(self) -> None:
        errors: list[dict[str, Any]] = []

        kept = validate_node_element_type("nodes[0]", "n1", "Log", "log", {"log"}, errors)

        assert kept is True
        assert errors == []

    def test_an_unknown_type_is_refused(self) -> None:
        errors: list[dict[str, Any]] = []

        kept = validate_node_element_type("nodes[0]", "n1", "Mystery", "x", {"log"}, errors)

        assert kept is False
        assert errors == [
            _error(
                path="nodes[0].data.elementType",
                node_id="n1",
                node_label="Mystery",
                element_type="x",
                code="UNKNOWN_BLOCK_TYPE",
                message="Unknown block type: 'x'",
                fix_action="Remove block",
            )
        ]

    @pytest.mark.parametrize("element_type", [None, ""], ids=["none", "empty"])
    def test_a_missing_type_is_refused(self, element_type: str | None) -> None:
        errors: list[dict[str, Any]] = []

        kept = validate_node_element_type("nodes[0]", "n1", "Log", element_type, {"log"}, errors)

        assert kept is False
        assert errors == [
            _error(
                path="nodes[0].data.elementType",
                node_id="n1",
                node_label="Log",
                code="MISSING_BLOCK_TYPE",
                message="Block must have an elementType",
                fix_action="Remove block (type unknown)",
            )
        ]


class TestValidateNodeMetadata:
    """Name, version, the nodeType key and the 64-character description cap."""

    def test_a_well_formed_block_is_clean(self) -> None:
        data = _block("n1", "log", description="d" * 64)["data"]

        assert _metadata_errors(data) == []

    def test_a_description_over_64_characters_is_refused(self) -> None:
        data = _block("n1", "log", description="d" * 65)["data"]

        assert _metadata_errors(data) == [
            _error(
                path="nodes[0].data.description",
                node_id="n1",
                node_label="Log",
                element_type="log",
                code="DESCRIPTION_TOO_LONG",
                message="Block description must be at most 64 characters",
                fix_action="Trim description to 64 characters",
            )
        ]

    @pytest.mark.parametrize("label", [None, "", "   "], ids=["absent", "empty", "blank"])
    def test_a_block_with_no_name_is_refused(self, label: str | None) -> None:
        data = _block("n1", "log", label=label)["data"]

        assert _metadata_errors(data) == [
            _error(
                path="nodes[0].data.label",
                node_id="n1",
                node_label="Log",
                element_type="log",
                code="MISSING_LABEL",
                message="Block must have a name",
                fix_action="Generate a name from the block type",
            )
        ]

    def test_an_invalid_version_is_refused(self) -> None:
        data = _block("n1", "log", version="v1")["data"]

        assert _metadata_errors(data) == [
            _error(
                path="nodes[0].data.version",
                node_id="n1",
                node_label="Log",
                element_type="log",
                code="INVALID_VERSION",
                message="Invalid semantic version: 'v1'",
                fix_action="Remove block",
            )
        ]

    def test_a_mismatched_node_type_key_is_refused(self) -> None:
        data = _block("n1", "assert", node_type="plugin")["data"]

        assert _metadata_errors(data, "assert") == [
            _error(
                path="nodes[0].data.nodeType",
                node_id="n1",
                node_label="Log",
                element_type="assert",
                code="NODE_TYPE_MISMATCH",
                message=(
                    "nodeType 'plugin' does not match elementType 'assert' (expected 'control')"
                ),
                fix_action="Remove block",
            )
        ]

    def test_the_function_type_marker_is_accepted(self) -> None:
        data = _block("n1", "function", node_type="function")["data"]

        assert _metadata_errors(data, "function") == []


class TestNodeReadOnlyViolations:
    """Every field a Block reads as an expression or template is checked, Function Blocks
    included."""

    @pytest.mark.parametrize(
        ("node", "field"),
        [
            pytest.param(
                _block(
                    "n1",
                    "log",
                    values={"message": "str(rows.append(9))"},
                    expressionFields=["message"],
                ),
                "message",
                id="expression-field",
            ),
            pytest.param(
                _block(
                    "n1",
                    "log",
                    values={"message": "{{ rows.append(9) }}"},
                    templateFields=["message"],
                ),
                "message",
                id="template-field",
            ),
            pytest.param(
                _block(
                    "n1",
                    "variable-setter",
                    node_type="control",
                    values={"variables": {"out": "rows.append(9)"}},
                    expressionFields=["variables.out"],
                ),
                "variables.out",
                id="setter-row",
            ),
            pytest.param(
                _block(
                    "n1",
                    "function",
                    node_type="function",
                    values={"headers": {"X-Id": "rows.append(9)"}},
                    expressionFields=["headers.X-Id"],
                ),
                "headers.X-Id",
                id="function-block-map-entry",
            ),
            pytest.param(
                _block(
                    "n1",
                    "function",
                    node_type="function",
                    values={"n": "rows.append(9)"},
                    expressionFields=["n"],
                ),
                "n",
                id="function-block-field",
            ),
        ],
    )
    def test_a_field_that_changes_data_is_reported(self, node: dict[str, Any], field: str) -> None:
        assert node_read_only_violations(node) == [(field, _CHANGES_DATA)]

    def test_fields_that_only_read_are_clean(self) -> None:
        node = _block(
            "n1",
            "log",
            values={"message": "sorted(rows)", "level": "INFO"},
            expressionFields=["message"],
        )

        assert node_read_only_violations(node) == []

    def test_a_block_with_no_config_values_is_skipped(self) -> None:
        node = _block("n1", "log", templateFields=["message"])
        node["data"]["config"] = {}

        assert node_read_only_violations(node) == []


class TestValidateReadOnlyExpressions:
    """Each violation becomes one save error naming the Block and the field, or the variable."""

    def test_a_block_field_names_the_block_and_the_field(self) -> None:
        node = _block(
            "n1", "log", values={"message": "str(rows.append(9))"}, expressionFields=["message"]
        )
        errors: list[dict[str, Any]] = []

        validate_read_only_expressions([node], {}, errors)

        assert errors == [
            _error(
                path="nodes.n1.config.values.message",
                node_id="n1",
                node_label="Log",
                element_type="log",
                code="EXPRESSION_CHANGES_DATA",
                message=f"{_CHANGES_DATA} Block: Log. Field: message.",
            )
        ]

    def test_a_block_with_no_name_is_named_by_its_id(self) -> None:
        node = _block(
            "n1",
            "log",
            label=None,
            values={"message": "str(rows.append(9))"},
            expressionFields=["message"],
        )
        errors: list[dict[str, Any]] = []

        validate_read_only_expressions([node], {}, errors)

        assert [error["message"] for error in errors] == [
            f"{_CHANGES_DATA} Block: n1. Field: message."
        ]

    def test_an_expression_variable_names_the_variable(self) -> None:
        variables = {"sneaky": {"type": "string", "value": "rows.append(9)", "isExpression": True}}
        errors: list[dict[str, Any]] = []

        validate_read_only_expressions([], variables, errors)

        assert errors == [
            _error(
                path="variables.sneaky",
                code="EXPRESSION_CHANGES_DATA",
                message=f"{_CHANGES_DATA} Variable: sneaky.",
            )
        ]

    def test_a_variable_declared_as_a_bare_value_is_skipped(self) -> None:
        errors: list[dict[str, Any]] = []

        validate_read_only_expressions([], {"rows": [1, 2]}, errors)

        assert errors == []


def _compare(item_id: str, reference: str, **flags: Any) -> dict[str, Any]:
    """One literal condition item comparing ``status`` with ``reference``."""
    return {
        "id": item_id,
        "type": "literal",
        "variable": "status",
        "value_type": "string",
        "operator": "equals",
        "reference_value": reference,
        **flags,
    }


def _expression_item(item_id: str, expression: str) -> dict[str, Any]:
    return {"id": item_id, "type": "expression", "expression": expression}


def _if_else(*conditions: dict[str, Any]) -> dict[str, Any]:
    """If/Else values whose first branch checks ``conditions``."""
    return {
        "branches": [
            {"id": "b1", "type": "if", "label": "", "conditions": list(conditions)},
            {"id": "b2", "type": "else", "label": ""},
        ]
    }


def _control(element_type: str, values: dict[str, Any], **data: Any) -> dict[str, Any]:
    return _block(
        "n1", element_type, node_type="control", label="Check status", values=values, **data
    )


def _gate_errors(node: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    validate_read_only_expressions([node], {}, errors)
    return errors


def _refusal(node: dict[str, Any], field: str) -> dict[str, Any]:
    """The one read-only refusal of ``node`` at ``field``."""
    label = node["data"]["label"]
    return _error(
        path=f"nodes.{node['id']}.config.values.{field}",
        node_id=node["id"],
        node_label=label,
        element_type=node["data"]["elementType"],
        code="EXPRESSION_CHANGES_DATA",
        message=f"{_CHANGES_DATA} Block: {label}. Field: {field}.",
    )


class TestEveryExpressionSiteIsGated:
    """REQ-3.1.1.5, REQ-3.5.1.5: the read-only gate checks every expression and template site
    of a Block, condition rows included, and names each by its full place."""

    @pytest.mark.parametrize(
        ("element_type", "values", "field"),
        [
            pytest.param(
                "assert",
                {"assertions": [_expression_item("a1", "rows.append(9)")], "mode": "split"},
                "assertions.0.expression",
                id="assert",
            ),
            pytest.param(
                "while",
                {
                    "mode": "while-do",
                    "conditions": [
                        _compare("c1", "ok"),
                        _expression_item("c2", "len(rows.append(9)) > 0"),
                    ],
                },
                "conditions.1.expression",
                id="while",
            ),
            pytest.param(
                "if-else",
                _if_else(_expression_item("c1", "rows.append(9)")),
                "branches.0.conditions.0.expression",
                id="if-else-branch",
            ),
            pytest.param(
                "if-else",
                _if_else(
                    {
                        "id": "g1",
                        "type": "group",
                        "items": [
                            _compare("c1", "ok"),
                            {"id": "op1", "type": "operator", "value": "and"},
                            _expression_item("c2", "rows.append(9)"),
                        ],
                    }
                ),
                "branches.0.conditions.0.items.2.expression",
                id="item-in-a-group",
            ),
        ],
    )
    def test_a_condition_expression_item_that_changes_data_is_refused(
        self, element_type: str, values: dict[str, Any], field: str
    ) -> None:
        node = _control(element_type, values)

        assert _gate_errors(node) == [_refusal(node, field)]

    def test_a_compare_to_expression_that_changes_data_is_refused(self) -> None:
        # A plain literal compare-to is data; an operator that takes no value never reads one.
        hidden = {
            **_compare("c3", "rows.append(9)", reference_is_expression=True),
            "operator": "is_null",
        }
        node = _control(
            "if-else",
            _if_else(
                _compare("c1", "rows.append(9)", reference_is_expression=False),
                {"id": "op1", "type": "operator", "value": "and"},
                _compare("c2", "rows.append(9)", reference_is_expression=True),
                {"id": "op2", "type": "operator", "value": "and"},
                hidden,
            ),
        )

        assert _gate_errors(node) == [
            _error(
                path="nodes.n1.config.values.branches.0.conditions.2.reference_value",
                node_id="n1",
                node_label="Check status",
                element_type="if-else",
                code="EXPRESSION_CHANGES_DATA",
                message=(
                    "The append method changes data. An expression can only read data, not "
                    "change it. To change a variable, add a Variable Setter Block. "
                    "Block: Check status. Field: branches.0.conditions.2.reference_value."
                ),
            )
        ]

    def test_a_compare_to_template_piece_that_changes_data_is_refused(self) -> None:
        node = _control(
            "while",
            {
                "mode": "while-do",
                "conditions": [
                    _compare("c1", "Host {{ rows.append(9) }}", reference_is_template=True)
                ],
            },
        )

        assert _gate_errors(node) == [_refusal(node, "conditions.0.reference_value")]

    def test_a_filter_item_that_changes_data_is_refused(self) -> None:
        cell_check = {
            "id": "c1",
            "type": "literal",
            "variable": "_cell",
            "value_type": "integer",
            "operator": "equals",
            "reference_value": "len(rows.append(9))",
            "reference_is_expression": True,
        }
        filter_block = {
            "id": "f1",
            "column": {"mode": "name", "value": "id"},
            "asType": "integer",
            "conditions": [cell_check],
        }
        node = _block(
            "n1",
            "csv-parser",
            label="Read orders",
            values={"operation": "parse", "csv_content": "id\n1\n", "filters": [filter_block]},
        )

        assert _gate_errors(node) == [_refusal(node, "filters.0.conditions.0.reference_value")]

    @pytest.mark.parametrize(
        ("text", "flags"),
        [
            pytest.param("rows.append(9)", {"expressionFields": ["variables.counter"]}, id="expr"),
            pytest.param(
                "n={{ rows.append(9) }}", {"templateFields": ["variables.counter"]}, id="template"
            ),
        ],
    )
    def test_a_setter_row_is_named_by_its_full_place(
        self, text: str, flags: dict[str, Any]
    ) -> None:
        node = _control("variable-setter", {"variables": {"counter": text}}, **flags)

        errors = _gate_errors(node)

        assert errors == [_refusal(node, "variables.counter")]
        assert errors[0]["message"].endswith(" Field: variables.counter.")

    @pytest.mark.parametrize(
        ("rows", "flag", "place"),
        [
            pytest.param(
                {"hosts": ["web-1", "rows.append(9)"]},
                "expressionFields",
                "variables.hosts.1",
                id="list",
            ),
            pytest.param(
                {"limits": {"max": "rows.append(9)"}},
                "expressionFields",
                "variables.limits.max",
                id="map",
            ),
            pytest.param(
                {"limits": {"max": "n={{ rows.append(9) }}"}},
                "templateFields",
                "variables.limits.max",
                id="map-template",
            ),
        ],
    )
    def test_a_setter_entry_is_named_by_its_full_place(
        self, rows: dict[str, Any], flag: str, place: str
    ) -> None:
        node = _control("variable-setter", {"variables": rows}, **{flag: [place]})

        assert _gate_errors(node) == [_refusal(node, place)]

    def test_a_variable_reference_setting_is_gated(self) -> None:
        # For Each reads a collection picked by name as an expression, flagged or not.
        node = _control("for-each", {"collection": "rows.append(9)"})

        assert _gate_errors(node) == [_refusal(node, "collection")]


def _root_pairs(nodes: list[dict[str, Any]], variables: dict[str, Any]) -> list[tuple[str, str]]:
    from wavecore.api.services.tests.service import _validate_test_data

    placed = [{**node, "position": {"x": 0, "y": 0}} for node in nodes]
    test = {
        "id": "t-1",
        "name": "T",
        "version": "1.0.0",
        "workflow": {
            "nodes": placed,
            "edges": [{"source": "start-node", "target": placed[0]["id"]}],
        },
        "variables": variables,
    }
    return [(e["code"], e["message"]) for e in _validate_test_data(test, context="save")["errors"]]


def _function_flow_pairs(
    nodes: list[dict[str, Any]], locals_: list[dict[str, Any]]
) -> list[tuple[str, str]]:
    from wavecore.api.services.functions._storage import validate_function_for_save

    definition = {
        "name": "checked",
        "inputs": [],
        "outputs": [],
        "variables": locals_,
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": nodes,
            "edges": [{"source": "start-node", "target": nodes[0]["id"]}],
        },
    }
    return [(issue.code, issue.message) for issue in validate_function_for_save(definition)]


def _of(pairs: list[tuple[str, str]], code: str) -> list[str]:
    return [message for found, message in pairs if found == code]


class TestTheSameChecksAtTheRootAndInAFunctionFlow:
    """The Test save and the Function save give one code and one text for each check."""

    @pytest.mark.parametrize(
        ("node", "code", "expected"),
        [
            pytest.param(
                _block("n1", "x", node_type="control", label="Mystery"),
                "UNKNOWN_BLOCK_TYPE",
                ["Unknown block type: 'x'"],
                id="unknown-type",
            ),
            pytest.param(
                _block("n1", "log", values={"message": "'hi'"}, description="d" * 65),
                "DESCRIPTION_TOO_LONG",
                ["Block description must be at most 64 characters"],
                id="long-description",
            ),
            pytest.param(
                _block(
                    "n1",
                    "log",
                    values={"message": "str(rows.append(9))"},
                    expressionFields=["message"],
                ),
                "EXPRESSION_CHANGES_DATA",
                [f"{_CHANGES_DATA} Block: Log. Field: message."],
                id="changes-data",
            ),
            pytest.param(
                _block(
                    "n1",
                    "function",
                    node_type="function",
                    label="Inner",
                    values={"n": "rows.append(9)"},
                    expressionFields=["n"],
                    functionLifecycle="local",
                    localDefinition={
                        "name": "inner",
                        "inputs": [{"name": "n", "type": "array", "required": False}],
                        "outputs": [],
                        "workflow": {"nodes": [], "edges": []},
                    },
                ),
                "EXPRESSION_CHANGES_DATA",
                [f"{_CHANGES_DATA} Block: Inner. Field: n."],
                id="function-block-changes-data",
            ),
        ],
    )
    def test_both_saves_report_it_alike(
        self, node: dict[str, Any], code: str, expected: list[str]
    ) -> None:
        rows = {"type": "array", "value": [1]}

        at_root = _root_pairs([node], {"rows": rows})
        in_function_flow = _function_flow_pairs([node], [{"name": "rows", **rows}])

        assert _of(at_root, code) == expected
        assert _of(in_function_flow, code) == expected


def _wait(node_id: str, mode: str) -> dict[str, Any]:
    return _block(node_id, "wait-until", node_type="control", label="Wait", values={"mode": mode})


def _wire(edge_id: str, source: str, target: str, handle: str | None = None) -> dict[str, Any]:
    wire: dict[str, Any] = {"id": edge_id, "source": source, "target": target}
    if handle is not None:
        wire["sourceHandle"] = handle
    return wire


def _watch_flow() -> dict[str, Any]:
    """A Watch wait with a retry wire and a next wire on `then`."""
    return {
        "nodes": [_wait("w", "watch"), _block("a", "log"), _block("b", "log")],
        "edges": [
            _wire("e-in", "start-node", "w"),
            _wire("e-retry", "w", "a", "retry"),
            _wire("e-next", "w", "b", "then"),
        ],
    }


def _holder(node_id: str, flow: dict[str, Any], key: str = "localDefinition") -> dict[str, Any]:
    return _block(
        node_id, "function", node_type="function", label=node_id, **{key: {"workflow": flow}}
    )


def _lanes(flow: dict[str, Any]) -> list[tuple[str, str | None]]:
    return [(e["id"], e.get("sourceHandle")) for e in flow["edges"]]


class TestTheWaitUntilLaneRuleInEveryFunctionFlow:
    """One rule puts the Wait Until wires of a Function flow and of its bodies on their lanes."""

    def test_a_flow_drops_the_retry_wire_and_moves_the_next_wire_to_the_single_exit(self) -> None:
        flow = _watch_flow()

        removed = put_flow_wires_on_lanes(flow)

        assert removed == [RemovedWire(edge=_wire("e-retry", "w", "a", "retry"), holders=())]
        assert _lanes(flow) == [("e-in", None), ("e-next", None)]

    @pytest.mark.parametrize("key", ["localDefinition", "draft"])
    def test_every_body_at_every_depth_names_the_blocks_that_hold_it(self, key: str) -> None:
        inner_flow = _watch_flow()
        inner = _holder("inner", inner_flow, key)
        outer = _holder("outer", {"nodes": [inner], "edges": []})

        removed = put_body_wires_on_lanes([outer])

        assert [(wire.edge["id"], [h["id"] for h in wire.holders]) for wire in removed] == [
            ("e-retry", ["outer", "inner"])
        ]
        assert _lanes(inner_flow) == [("e-in", None), ("e-next", None)]

    def test_the_blocks_own_flow_is_left_to_the_caller(self) -> None:
        flow = _watch_flow()

        assert put_body_wires_on_lanes(flow["nodes"]) == []
        assert _lanes(flow) == [("e-in", None), ("e-retry", "retry"), ("e-next", "then")]

    @pytest.mark.parametrize("flow", [None, [], {"nodes": None, "edges": []}])
    def test_a_flow_with_no_list_of_blocks_holds_nothing_to_move(self, flow: Any) -> None:
        assert put_flow_wires_on_lanes(flow) == []

    def test_a_flow_with_no_list_of_wires_still_reaches_its_bodies(self) -> None:
        inner_flow = _watch_flow()
        flow = {"nodes": [_holder("inner", inner_flow)], "edges": None}

        removed = put_flow_wires_on_lanes(flow)

        assert [wire.edge["id"] for wire in removed] == ["e-retry"]
        assert flow["edges"] is None

    def test_malformed_blocks_and_wires_are_kept_as_they_are(self) -> None:
        wait = _block("w", "wait-until", node_type="control", label="Wait")
        wait["data"]["config"] = "not a config"
        flow: dict[str, Any] = {
            "nodes": ["not a block", {"id": "x", "data": "not data"}, wait],
            "edges": ["not a wire", _wire("e-next", "w", "x")],
        }

        assert put_flow_wires_on_lanes(flow) == []
        # A wait with no readable mode takes the field default, Retry, so its next wire is on then.
        assert flow["edges"] == ["not a wire", _wire("e-next", "w", "x", "then")]

    def test_the_removed_wires_are_grouped_by_the_flow_that_held_them(self) -> None:
        inner = _holder("inner", _watch_flow())
        flow = _watch_flow()
        flow["nodes"].append(_holder("outer", {"nodes": [inner], "edges": []}))

        grouped = removed_wires_by_flow(put_flow_wires_on_lanes(flow))

        assert {key: [edge["id"] for edge in edges] for key, edges in grouped.items()} == {
            (): ["e-retry"],
            ("outer", "inner"): ["e-retry"],
        }


_OUTSIDE_LOOP = "break/continue is only valid inside a loop body"


def _loop(node_id: str, element_type: str = "for") -> dict[str, Any]:
    return _block(node_id, element_type, node_type="control", label=node_id)


def _signal(node_id: str, target: Any, element_type: str = "break", **data: Any) -> dict[str, Any]:
    values = {} if target is None else {"target_loop": target}
    return _block(node_id, element_type, node_type="control", label="Stop", values=values, **data)


def _loop_target_errors(nodes: list[Any], edges: list[Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    validate_loop_targets(nodes, edges, errors)
    return errors


def _outside(index: int, node_id: str, message: str, element_type: str = "break") -> dict[str, Any]:
    return _error(
        path=f"nodes[{index}].data.config.values.target_loop",
        node_id=node_id,
        node_label="Stop",
        element_type=element_type,
        code="BREAK_OUTSIDE_LOOP",
        message=message,
    )


def _root_flow_pairs(nodes: list[dict[str, Any]], edges: list[Any]) -> list[tuple[str, str]]:
    from wavecore.api.services.tests.service import _validate_test_data

    placed = [{**node, "position": {"x": 0, "y": 0}} for node in nodes]
    workflow = {"nodes": placed, "edges": edges}
    test = {"id": "t-1", "name": "T", "version": "1.0.0", "workflow": workflow}
    return [(e["code"], e["message"]) for e in _validate_test_data(test, context="save")["errors"]]


def _function_body_pairs(nodes: list[dict[str, Any]], edges: list[Any]) -> list[tuple[str, str]]:
    from wavecore.api.services.functions._storage import validate_function_for_save

    definition = {
        "name": "checked",
        "inputs": [],
        "outputs": [],
        "variables": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": nodes, "edges": edges},
    }
    return [(issue.code, issue.message) for issue in validate_function_for_save(definition)]


class TestLoopSignalTargets:
    """A Break or Continue aims at a loop whose body holds it: every Block reached forward from
    the body's first Block (REQ-3.5.1.2, REQ-3.5.1.3)."""

    @pytest.mark.parametrize("loop_type", ["for", "for-each", "while"])
    @pytest.mark.parametrize("signal", ["break", "continue"])
    def test_a_signal_in_the_body_of_its_target_is_clean(self, loop_type: str, signal: str) -> None:
        nodes = [_loop("loop", loop_type), _block("log", "log"), _signal("stop", "loop", signal)]
        edges = [_wire("e1", "loop", "log", "body"), _wire("e2", "log", "stop")]

        assert _loop_target_errors(nodes, edges) == []

    def test_a_signal_may_aim_past_its_nearest_loop_at_one_that_holds_it(self) -> None:
        nodes = [_loop("outer"), _loop("inner", "while"), _signal("stop", "outer")]
        edges = [_wire("e1", "outer", "inner", "body"), _wire("e2", "inner", "stop", "body")]

        assert _loop_target_errors(nodes, edges) == []

    def test_a_body_that_splits_and_rejoins_holds_the_blocks_after_the_rejoin(self) -> None:
        nodes = [_loop("loop"), _block("a", "log"), _block("b", "log"), _signal("stop", "loop")]
        edges = [
            _wire("e1", "loop", "a", "body"),
            _wire("e2", "loop", "b", "body"),
            _wire("e3", "a", "stop"),
            _wire("e4", "b", "stop"),
        ]

        assert _loop_target_errors(nodes, edges) == []

    def test_a_signal_in_no_loop_body_is_refused(self) -> None:
        nodes = [_loop("loop"), _signal("stop", "loop", "continue")]
        edges = [_wire("e1", "loop", "stop", "then")]

        assert _loop_target_errors(nodes, edges) == [_outside(1, "stop", _OUTSIDE_LOOP, "continue")]

    def test_a_signal_aimed_at_a_loop_that_does_not_hold_it_is_refused(self) -> None:
        nodes = [_loop("loop-a"), _signal("stop", "loop-b"), _loop("loop-b")]
        edges = [_wire("e1", "loop-a", "stop", "body"), _wire("e2", "loop-a", "loop-b", "then")]

        assert _loop_target_errors(nodes, edges) == [
            _outside(1, "stop", "break/continue target 'loop-b' is not an enclosing loop")
        ]

    @pytest.mark.parametrize(
        "node",
        [
            pytest.param(_signal("stop", None), id="no-target"),
            pytest.param(_signal("stop", "  "), id="blank-target"),
            pytest.param(_signal("stop", 7), id="no-text"),
            pytest.param(_signal("stop", "ghost", disabled=True), id="disabled"),
        ],
    )
    def test_a_signal_the_other_checks_name_or_the_run_skips_is_left_alone(
        self, node: dict[str, Any]
    ) -> None:
        assert _loop_target_errors([node], []) == []

    def test_wires_with_no_end_and_blocks_with_no_data_are_skipped(self) -> None:
        nodes: list[Any] = [_loop("loop"), {"id": "bare"}, _signal("stop", "loop")]
        edges = [{"source": "loop"}, _wire("e1", "loop", "stop", "body")]

        assert _loop_target_errors(nodes, edges) == []

    @pytest.mark.parametrize(
        ("target", "expected"),
        [
            pytest.param(
                "ghost",
                ["break/continue target 'ghost' is not an enclosing loop"],
                id="not-enclosing",
            ),
            pytest.param("loop", [], id="enclosing"),
        ],
    )
    def test_both_saves_report_it_alike(self, target: str, expected: list[str]) -> None:
        loop = _block("loop", "for", node_type="control", label="Loop", values={"count": 2})
        nodes = [loop, _signal("stop", target)]
        edges = [{"source": "start-node", "target": "loop"}, _wire("e1", "loop", "stop", "body")]

        at_root = _root_flow_pairs(nodes, edges)
        in_function_flow = _function_body_pairs(nodes, edges)

        assert _of(at_root, "BREAK_OUTSIDE_LOOP") == expected
        assert _of(in_function_flow, "BREAK_OUTSIDE_LOOP") == expected
