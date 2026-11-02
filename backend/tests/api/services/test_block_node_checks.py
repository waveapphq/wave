"""The read-only and Block metadata checks shared by the Test save and the Function save.

REQ-3.1.2.4, REQ-3.1.3.13.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from wavecore.api.services.block_node_checks import (
    node_read_only_violations,
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
                    variableExpressionKeys=["out"],
                ),
                "out",
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
        assert node_read_only_violations(node["data"]) == [(field, _CHANGES_DATA)]

    def test_fields_that_only_read_are_clean(self) -> None:
        node = _block(
            "n1",
            "log",
            values={"message": "sorted(rows)", "level": "INFO"},
            expressionFields=["message"],
        )

        assert node_read_only_violations(node["data"]) == []

    def test_a_block_with_no_config_values_is_skipped(self) -> None:
        node = _block("n1", "log", templateFields=["message"])
        node["data"]["config"] = {}

        assert node_read_only_violations(node["data"]) == []


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
