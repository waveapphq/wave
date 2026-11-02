"""Unit tests for Function validation (REQ-3.1.2.4).

These tests exercise the validators in
``wavecore.api.services.functions._storage``.
``validate_function_for_save`` is the top-level aggregator; per-dimension
helpers (``_validate_structural``, ``_validate_references``, etc.) implement
each individual dimension and return validation issues with ``code``,
``message``, and ``severity`` fields.

The anchored error messages are asserted verbatim with
``^...$`` patterns so the implementation is forced to produce the exact
strings the FE expects.

Coverage dimensions:
1. Structural - required fields, name format, type set, parameter names, duplicates
2. Reference existence - unknown plugins, unknown Functions
3. Field checks - required, type, allowed values and unknown fields of every Block
4. Function Block fields - the same checks on a Function Block at every depth
5. Output producer - declared output not written by any node (warning)
6. Scope discipline - writes to declared inputs, reads from external scopes
7. Flow consistency - unreachable nodes, unmatched control constructs
8. Function-flow checks - muted Blocks, unknown types, undeclared names, read-only
   expressions and Block metadata in every Function flow

Each dimension has positive (clean payload) + negative (each rule's failure)
cases.
"""

from __future__ import annotations

import copy
import re
import uuid
from collections.abc import Iterable
from typing import Any

import pytest

from .conftest import make_function_payload, make_input, make_output

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _issue_field(issue: Any, name: str) -> Any:
    """Read a field from a validation issue (dict OR object)."""
    if isinstance(issue, dict):
        return issue.get(name)
    return getattr(issue, name, None)


def _codes(issues: Iterable[Any]) -> list[str]:
    return [_issue_field(i, "code") for i in issues]


def _messages(issues: Iterable[Any]) -> list[str]:
    return [_issue_field(i, "message") for i in issues]


def _severities(issues: Iterable[Any]) -> list[str]:
    out: list[str] = []
    for issue in issues:
        severity = _issue_field(issue, "severity")
        if hasattr(severity, "value"):
            severity = severity.value
        out.append(str(severity).lower() if severity is not None else "")
    return out


def _find(issues: Iterable[Any], code: str) -> list[Any]:
    return [i for i in issues if _issue_field(i, "code") == code]


def _make_workflow_node(
    node_id: str,
    *,
    element_type: str,
    node_type: str = "plugin",
    values: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    function_id: str | None = None,
    local_definition: dict[str, Any] | None = None,
    function_lifecycle: str | None = None,
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
) -> dict[str, Any]:
    """Build a workflow node mirroring the canvas-node payload shape."""
    data: dict[str, Any] = {
        "label": node_id,
        "elementType": element_type,
        "nodeType": node_type,
        "version": "1.0.0",
        "config": {
            "values": values or {},
            "profileBindings": [],
            "outputBindings": output_bindings or {},
        },
    }
    if function_id is not None:
        data["functionId"] = function_id
    if local_definition is not None:
        data["localDefinition"] = local_definition
    if expression_fields is not None:
        data["expressionFields"] = expression_fields
    if template_fields is not None:
        data["templateFields"] = template_fields
    if function_lifecycle is not None:
        data["functionLifecycle"] = function_lifecycle
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": data,
    }


def _edge(source: str, target: str, source_handle: str | None = None) -> dict[str, Any]:
    edge: dict[str, Any] = {"source": source, "target": target}
    if source_handle is not None:
        edge["sourceHandle"] = source_handle
    return edge


# Where a Function Block's field values are judged (REQ-3.1.2.4).
_BLOCK_PLACEMENTS = ["library-save", "local-body", "top-level"]


# ---------------------------------------------------------------------------
# Top-level aggregator: validate_function_for_save
# ---------------------------------------------------------------------------


class TestAggregator:
    """``validate_function_for_save`` aggregates issues from every dimension."""

    def test_clean_payload_returns_empty(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        log_node = _make_workflow_node(
            "log-1",
            element_type="log",
            values={"message": "x", "level": "INFO"},
            output_bindings={"line": "r"},
        )
        log_node["data"]["expressionFields"] = ["message"]
        payload = make_function_payload(
            name="clean",
            inputs=[make_input("x", "string", required=True)],
            outputs=[make_output("r", "string")],
            workflow={
                "nodes": [log_node],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        issues = validate_function_for_save(payload)
        assert _codes(issues) == []

    def test_aggregates_issues_from_multiple_dimensions(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            name="X" * 33,  # structural - name too long
            inputs=[make_input("x", "string")],
            outputs=[make_output("r", "string")],
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="this_plugin_does_not_exist",  # reference
                        values={"message": "x"},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        issues = validate_function_for_save(payload)
        codes = _codes(issues)
        assert "FUNCTION_NAME_TOO_LONG" in codes
        assert "UNKNOWN_PLUGIN" in codes
        # Reference dimension issues carry the inner node label so the UI
        # can prefix the message.
        ref_issue = next(i for i in issues if _issue_field(i, "code") == "UNKNOWN_PLUGIN")
        assert _issue_field(ref_issue, "node_label") == "log-1"


# ---------------------------------------------------------------------------
# Dimension 1: Structural
# ---------------------------------------------------------------------------


class TestStructural:
    """``_validate_structural`` covers required fields and name/type rules."""

    def test_name_exceeding_32_chars_produces_too_long_code(self) -> None:
        from wavecore.api.services.functions._storage import _validate_structural

        payload = make_function_payload(name="X" * 33)
        issues = _find(_validate_structural(payload), "FUNCTION_NAME_TOO_LONG")
        assert len(issues) == 1
        message = _issue_field(issues[0], "message")
        assert re.match(r"^Function name 'X{33}' exceeds 32 characters$", message), message
        assert "error" in _severities(issues)

    def test_empty_function_body_is_warning(self) -> None:
        from wavecore.api.services.functions._storage import _validate_structural

        payload = make_function_payload(
            name="emptybody",
            workflow={"nodes": [], "edges": []},
        )
        issues = _find(_validate_structural(payload), "EMPTY_FUNCTION_BODY")
        assert len(issues) == 1
        assert re.match(
            r"^Function 'emptybody' has no blocks$",
            _issue_field(issues[0], "message"),
        )
        assert _severities(issues) == ["warning"]

    def test_input_with_missing_type_is_input_type_missing(self) -> None:
        from wavecore.api.services.functions._storage import _validate_structural

        payload = make_function_payload(
            name="missingtype",
            inputs=[{"name": "alpha", "required": True}],
        )
        issues = _find(_validate_structural(payload), "INPUT_TYPE_MISSING")
        assert len(issues) == 1
        assert re.match(
            r"^Function input 'alpha' has no declared type$",
            _issue_field(issues[0], "message"),
        )

    def test_output_with_missing_type_is_output_type_missing(self) -> None:
        from wavecore.api.services.functions._storage import _validate_structural

        payload = make_function_payload(
            name="missingouttype",
            outputs=[{"name": "beta"}],
        )
        issues = _find(_validate_structural(payload), "OUTPUT_TYPE_MISSING")
        assert len(issues) == 1
        assert re.match(
            r"^Function output 'beta' has no declared type$",
            _issue_field(issues[0], "message"),
        )

    def test_duplicate_input_name(self) -> None:
        from wavecore.api.services.functions._storage import _validate_structural

        payload = make_function_payload(
            name="dupin",
            inputs=[make_input("alpha", "string"), make_input("alpha", "integer")],
        )
        issues = _find(_validate_structural(payload), "DUPLICATE_INPUT_NAME")
        assert len(issues) == 1
        assert re.match(
            r"^Function declares input 'alpha' more than once$",
            _issue_field(issues[0], "message"),
        )

    def test_duplicate_output_name(self) -> None:
        from wavecore.api.services.functions._storage import _validate_structural

        payload = make_function_payload(
            name="dupout",
            outputs=[make_output("r", "string"), make_output("r", "integer")],
        )
        issues = _find(_validate_structural(payload), "DUPLICATE_OUTPUT_NAME")
        assert len(issues) == 1
        assert re.match(
            r"^Function declares output 'r' more than once$",
            _issue_field(issues[0], "message"),
        )

    def test_clean_payload_produces_no_structural_issues(self) -> None:
        from wavecore.api.services.functions._storage import _validate_structural

        payload = make_function_payload(
            name="ok",
            inputs=[make_input("x", "string")],
            outputs=[make_output("r", "string")],
            workflow={
                "nodes": [
                    _make_workflow_node("log-1", element_type="log", values={"message": "x"}),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        assert _codes(_validate_structural(payload)) == []


# ---------------------------------------------------------------------------
# Dimension 2: Reference existence
# ---------------------------------------------------------------------------


class TestReferenceExistence:
    """``_validate_references`` checks plugin + Function references resolve."""

    def test_unknown_plugin_produces_unknown_plugin_code(self) -> None:
        from wavecore.api.services.functions._storage import _validate_references

        payload = make_function_payload(
            name="unknownplugin",
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "n-1",
                        element_type="totally_made_up_plugin",
                        values={"x": 1},
                    ),
                ],
                "edges": [_edge("start-node", "n-1")],
            },
        )
        issues = _find(
            _validate_references(payload, plugin_registry=None, function_registry={}),
            "UNKNOWN_PLUGIN",
        )
        assert len(issues) == 1
        # Canonical save-pipeline shape: the message is parameter-shaped and
        # node identity travels in the ``node_label`` field so the UI can
        # prefix the message with the user-visible block name once.
        assert re.match(
            r"^References unknown plugin 'totally_made_up_plugin'$",
            _issue_field(issues[0], "message"),
        )
        assert _issue_field(issues[0], "node_label") == "n-1"

    def test_unknown_function_produces_missing_function_id_code(self) -> None:
        """Per REQ-3.1.2.2: unknown function id surfaces ``missing_function_id``."""
        from wavecore.api.services.functions._storage import _validate_references

        missing_id = str(uuid.uuid4())
        payload = make_function_payload(
            name="unknownfn",
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "n-1",
                        element_type="function",
                        node_type="function",
                        function_id=missing_id,
                        function_lifecycle="shared",
                    ),
                ],
                "edges": [_edge("start-node", "n-1")],
            },
        )
        issues = _find(
            _validate_references(payload, plugin_registry=None, function_registry={}),
            "MISSING_FUNCTION_ID",
        )
        assert len(issues) == 1
        assert re.match(
            rf"^References unknown Function '{missing_id}'$",
            _issue_field(issues[0], "message"),
        )
        assert _issue_field(issues[0], "node_label") == "n-1"

    def test_known_plugin_passes(self) -> None:
        """A node referencing the built-in log plugin should not produce UNKNOWN_PLUGIN."""
        from wavecore.api.services.functions._storage import _validate_references

        payload = make_function_payload(
            name="knownplugin",
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "n-1",
                        element_type="log",
                        values={"message": "'hi'", "level": "INFO"},
                    ),
                ],
                "edges": [_edge("start-node", "n-1")],
            },
        )
        issues = _validate_references(payload, plugin_registry=None, function_registry={})
        assert "UNKNOWN_PLUGIN" not in _codes(issues)


# ---------------------------------------------------------------------------
# Dimension 3: Binding completeness
# ---------------------------------------------------------------------------


class TestBindingCompleteness:
    """``_validate_binding_completeness`` rejects missing required bindings."""

    def test_missing_required_binding_produces_required_param_missing(self) -> None:
        from wavecore.api.services.functions._storage import _validate_binding_completeness

        payload = make_function_payload(
            name="missingbinding",
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        # log requires "message" - omit it.
                        values={"level": "INFO"},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        # Uses the same code + message format the outer test save pipeline
        # emits for plugin nodes at the root level, so the UI surfaces one
        # uniform "Log_1:Required parameter 'message' is missing" experience.
        issues = _find(
            _validate_binding_completeness(payload),
            "REQUIRED_PARAM_MISSING",
        )
        assert len(issues) >= 1
        first = issues[0]
        assert re.match(
            r"^Required parameter '\w+' is missing$",
            _issue_field(first, "message"),
        )
        assert _issue_field(first, "node_label") == "log-1"

    def test_all_required_bindings_present_passes(self) -> None:
        from wavecore.api.services.functions._storage import _validate_binding_completeness

        payload = make_function_payload(
            name="okbinding",
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        values={"message": "'hi'", "level": "INFO"},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        issues = _validate_binding_completeness(payload)
        assert "REQUIRED_PARAM_MISSING" not in _codes(issues)

    @pytest.mark.parametrize(
        ("element_type", "node_type"),
        [("no-such-plugin", "plugin"), ("log", "")],
        ids=["unregistered-type", "no-block-tier"],
    )
    def test_a_block_without_known_fields_has_none_to_check(
        self, element_type: str, node_type: str
    ) -> None:
        from wavecore.api.services.functions._storage import _validate_binding_completeness

        node = _make_workflow_node("x-1", element_type=element_type, node_type=node_type)
        payload = make_function_payload(
            name="unchecked",
            workflow={"nodes": [node], "edges": [_edge("start-node", "x-1")]},
        )

        assert _validate_binding_completeness(payload) == []


# ---------------------------------------------------------------------------
# Dimension 4: Function Block fields
# ---------------------------------------------------------------------------

_TABLE_LITERAL = {"columns": [{"name": "n", "type": "integer"}], "rows": [[16]]}


class TestFunctionBlockFieldValues:
    """A Function Block's stored values go through the one field check every Block uses,
    at every depth; for a Function Block the block named is its Function (REQ-3.1.2.4,
    REQ-3.1.2.11)."""

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    def test_a_value_of_the_wrong_type_is_refused(self, placement: str) -> None:
        inner = {"inputs": [make_input("n", "integer", required=True)]}

        errors = _function_block_errors(placement, inner, {"n": "abc"})

        assert _messages_of(errors, "INVALID_SETTING_TYPE") == [
            "Setting 'n' of block 'inner' expects integer, got string"
        ]

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    def test_a_value_of_the_declared_type_is_clean(self, placement: str) -> None:
        inner = {"inputs": [make_input("n", "integer", required=True)]}

        errors = _function_block_errors(placement, inner, {"n": 5})

        assert _messages_of(errors, "INVALID_SETTING_TYPE") == []
        assert _messages_of(errors, "REQUIRED_PARAM_MISSING") == []

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    @pytest.mark.parametrize(
        ("value_type", "allowed", "value", "expected"),
        [
            pytest.param(
                "string",
                ["low", "high"],
                "mid",
                "Setting 'level' of block 'inner' must be one of: low, high",
                id="string",
            ),
            pytest.param(
                "integer",
                [1, 2],
                3,
                "Setting 'level' of block 'inner' must be one of: 1, 2",
                id="integer",
            ),
            pytest.param(
                "float",
                [1.5, 2.5],
                3.5,
                "Setting 'level' of block 'inner' must be one of: 1.5, 2.5",
                id="float",
            ),
        ],
    )
    def test_a_value_outside_the_enum_is_refused(
        self,
        placement: str,
        value_type: str,
        allowed: list[Any],
        value: Any,
        expected: str,
    ) -> None:
        inner = {"inputs": [_enum_input("level", value_type, allowed)]}

        errors = _function_block_errors(placement, inner, {"level": value})

        assert _messages_of(errors, "INVALID_ENUM_VALUE") == [expected]
        assert _messages_of(errors, "INVALID_SETTING_TYPE") == []

    @pytest.mark.parametrize("placement", ["local-body", "top-level"])
    @pytest.mark.parametrize(
        ("value_type", "before", "after", "value", "expected"),
        [
            pytest.param(
                "string",
                ["low", "mid", "high"],
                ["low", "high"],
                "mid",
                "Setting 'level' of block 'inner' must be one of: low, high",
                id="string",
            ),
            pytest.param(
                "integer",
                [1, 2, 3],
                [1, 2],
                3,
                "Setting 'level' of block 'inner' must be one of: 1, 2",
                id="integer",
            ),
        ],
    )
    def test_a_picked_value_the_narrowed_allowed_values_drop_is_refused(
        self,
        placement: str,
        value_type: str,
        before: list[Any],
        after: list[Any],
        value: Any,
        expected: str,
    ) -> None:
        picked = {"level": value}
        wide = _function_block_errors(
            placement, {"inputs": [_enum_input("level", value_type, before)]}, picked
        )
        narrowed = _function_block_errors(
            placement, {"inputs": [_enum_input("level", value_type, after)]}, picked
        )

        assert _messages_of(wide, "INVALID_ENUM_VALUE") == []
        assert _messages_of(narrowed, "INVALID_ENUM_VALUE") == [expected]

    @pytest.mark.parametrize(
        ("value_type", "allowed", "value"),
        [
            pytest.param("string", ["low", "high"], "low", id="string"),
            pytest.param("integer", [1, 2], 2, id="integer"),
            pytest.param("float", [1.5], 1.5, id="float"),
        ],
    )
    def test_a_value_inside_the_enum_is_clean(
        self, value_type: str, allowed: list[Any], value: Any
    ) -> None:
        inner = {"inputs": [_enum_input("level", value_type, allowed)]}

        errors = _function_block_errors("top-level", inner, {"level": value})

        assert _messages_of(errors, "INVALID_ENUM_VALUE") == []
        assert _messages_of(errors, "INVALID_SETTING_TYPE") == []

    @pytest.mark.parametrize(
        "input_type", ["string", "integer", "float", "boolean", "array", "map"]
    )
    def test_a_null_value_is_not_a_type_mismatch(self, input_type: str) -> None:
        inner = {"inputs": [make_input("n", input_type, required=False)]}

        errors = _function_block_errors("library-save", inner, {"n": None})

        assert _messages_of(errors, "INVALID_SETTING_TYPE") == []

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    def test_an_expression_value_is_not_type_judged_on_save(self, placement: str) -> None:
        inner = {"inputs": [make_input("n", "integer", required=True)]}

        errors = _function_block_errors(
            placement, inner, {"n": "some_var"}, expression_fields=["n"]
        )

        assert _messages_of(errors, "INVALID_SETTING_TYPE") == []

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    def test_an_undeclared_field_is_refused(self, placement: str) -> None:
        inner = {"inputs": [make_input("n", "integer", required=False)]}

        errors = _function_block_errors(placement, inner, {"nope": 5})

        assert _messages_of(errors, "UNKNOWN_SETTING") == ["Block 'inner' has no setting 'nope'"]

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    def test_a_stored_table_literal_fits_a_table_input(self, placement: str) -> None:
        """The table editor saves a table as {columns, rows}."""
        inner = {"inputs": [make_input("x", "table", required=True)]}

        errors = _function_block_errors(placement, inner, {"x": _TABLE_LITERAL})

        assert _messages_of(errors, "INVALID_SETTING_TYPE") == []

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    def test_a_list_of_row_maps_fits_a_table_input(self, placement: str) -> None:
        inner = {"inputs": [make_input("x", "table", required=True)]}

        errors = _function_block_errors(placement, inner, {"x": [{"n": 16}]})

        assert _messages_of(errors, "INVALID_SETTING_TYPE") == []

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param({"a": 1}, id="plain-map"),
            pytest.param({"columns": "n"}, id="malformed-columns"),
            pytest.param(
                {"columns": [{"name": "n", "type": "integer"}], "rows": [["a", "b"]]},
                id="ragged-rows",
            ),
        ],
    )
    def test_a_map_that_is_not_a_table_is_refused_on_a_table_input(
        self, value: dict[str, Any]
    ) -> None:
        inner = {"inputs": [make_input("x", "table", required=True)]}

        errors = _function_block_errors("top-level", inner, {"x": value})

        assert _messages_of(errors, "INVALID_SETTING_TYPE") == [
            "Setting 'x' of block 'inner' expects table, got map"
        ]

    def test_a_stored_table_literal_does_not_fit_an_array_input(self) -> None:
        inner = {"inputs": [make_input("x", "array", required=True)]}

        errors = _function_block_errors("top-level", inner, {"x": _TABLE_LITERAL})

        assert _messages_of(errors, "INVALID_SETTING_TYPE") == [
            "Setting 'x' of block 'inner' expects array, got map"
        ]

    def test_the_issue_names_the_function_block(self) -> None:
        inner = make_function_payload(
            name="inner", outputs=[], inputs=[make_input("n", "integer", required=True)]
        )

        entries = _test_validate_entries([_local_function_block("fn-1", inner, {"n": "abc"})])

        found = [e for e in entries if e.get("code") == "INVALID_SETTING_TYPE"]
        assert len(found) == 1, entries
        assert found[0]["node_id"] == "fn-1"


def _error_pairs(errors: Iterable[Any]) -> list[tuple[Any, Any]]:
    return [(_issue_field(e, "code"), _issue_field(e, "message")) for e in errors]


def _messages_of(errors: Iterable[tuple[Any, Any]], code: str) -> list[Any]:
    return [message for found, message in errors if found == code]


def _enum_input(name: str, value_type: str, allowed: list[Any]) -> dict[str, Any]:
    return {
        "name": name,
        "type": value_type,
        "required": True,
        "description": "",
        "enumValues": allowed,
        "default": allowed[0],
    }


def _library_save_errors(payload: dict[str, Any]) -> list[tuple[Any, Any]]:
    from wavecore.api.services.functions import service as function_service

    try:
        function_service.create_function(payload)
    except function_service.SaveValidationError as exc:
        return _error_pairs(exc.errors)
    return []


def _test_validate_entries(
    nodes: list[dict[str, Any]], variables: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    from wavecore.api.services.tests.service import _validate_test_data

    placed = [{**node, "position": {"x": 0, "y": 0}} for node in nodes]
    test = {
        "id": str(uuid.uuid4()),
        "name": "T",
        "version": "1.0.0",
        "workflow": {"nodes": placed, "edges": [_edge("start-node", nodes[0]["id"])]},
        "variables": variables or {},
    }
    return list(_validate_test_data(test, context="save")["errors"])


def _test_validate_errors(
    nodes: list[dict[str, Any]], variables: dict[str, Any] | None = None
) -> list[tuple[Any, Any]]:
    return _error_pairs(_test_validate_entries(nodes, variables))


def _local_function_block(
    node_id: str,
    definition: dict[str, Any],
    values: dict[str, Any] | None = None,
    *,
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
) -> dict[str, Any]:
    return _make_workflow_node(
        node_id,
        element_type="function",
        node_type="function",
        function_lifecycle="local",
        local_definition=definition,
        values=values,
        expression_fields=expression_fields,
        template_fields=template_fields,
    )


def _function_block_errors(
    placement: str,
    inner: dict[str, Any],
    values: dict[str, Any],
    *,
    expression_fields: list[str] | None = None,
) -> list[tuple[Any, Any]]:
    """Errors for a Function Block ``fn-1`` of a Local Function ``inner`` on one save surface."""
    inner_def = make_function_payload(name="inner", outputs=[], **inner)
    block = _local_function_block("fn-1", inner_def, values, expression_fields=expression_fields)
    body = {"nodes": [block], "edges": [_edge("start-node", "fn-1")]}
    if placement == "library-save":
        return _library_save_errors(make_function_payload(name="outer", workflow=body))
    if placement == "local-body":
        outer = _local_function_block("outer-1", make_function_payload(name="outer", workflow=body))
        return _test_validate_errors([outer])
    return _test_validate_errors([block])


# ---------------------------------------------------------------------------
# Expression and Template outputs and locals (REQ-3.1.2.4, REQ-3.1.2.8)
# ---------------------------------------------------------------------------

_SAVE_SURFACES = ["library-save", "test-validate"]


def _function_save_errors(surface: str, definition: dict[str, Any]) -> list[tuple[Any, Any]]:
    """Errors the save validation reports for ``definition`` on one surface."""
    if surface == "library-save":
        return _library_save_errors(definition)
    return _test_validate_errors([_local_function_block("fn-local", definition)])


def _computed_function(
    *,
    outputs: list[dict[str, Any]],
    variables: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return make_function_payload(
        name="computed",
        inputs=[make_input("count", "integer", required=False)],
        outputs=outputs,
        variables=variables or [],
        workflow={
            "nodes": [
                _make_workflow_node(
                    "log-1", element_type="log", values={"message": "'x'", "level": "INFO"}
                )
            ],
            "edges": [_edge("start-node", "log-1")],
        },
    )


_UNRESOLVED_NOPE = (
    "Variable 'nope' is not defined in this Function's scope (inputs, outputs, and local variables)"
)


class TestExpressionOutputs:
    """Names inside an Expression / Template output or local are checked on save."""

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    @pytest.mark.parametrize(
        ("outputs", "variables"),
        [
            pytest.param(
                [{"name": "total", "type": "integer", "isExpression": True, "default": "nope + 1"}],
                [],
                id="expression-output",
            ),
            pytest.param(
                [
                    {
                        "name": "label",
                        "type": "string",
                        "isTemplate": True,
                        "default": "id-{{ nope }}",
                    }
                ],
                [],
                id="template-output",
            ),
            pytest.param(
                [],
                [{"name": "step", "type": "integer", "isExpression": True, "value": "nope * 2"}],
                id="expression-local",
            ),
        ],
    )
    def test_an_unknown_name_is_refused(
        self, surface: str, outputs: list[dict[str, Any]], variables: list[dict[str, Any]]
    ) -> None:
        definition = _computed_function(outputs=outputs, variables=variables)

        errors = _function_save_errors(surface, definition)

        assert _messages_of(errors, "UNRESOLVED_VARIABLE_REFERENCE") == [_UNRESOLVED_NOPE]

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    def test_an_output_expression_reading_itself_is_refused(self, surface: str) -> None:
        definition = _computed_function(
            outputs=[
                {"name": "total", "type": "integer", "isExpression": True, "default": "total + 1"}
            ]
        )

        errors = _function_save_errors(surface, definition)

        assert _messages_of(errors, "EXPRESSION_CYCLE") == [
            "Circular reference detected for variable 'total': total -> total"
        ]

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    def test_a_cycle_through_locals_is_refused(self, surface: str) -> None:
        definition = _computed_function(
            outputs=[
                {"name": "total", "type": "integer", "isExpression": True, "default": "a + 1"}
            ],
            variables=[
                {"name": "a", "type": "integer", "isExpression": True, "value": "b + 1"},
                {"name": "b", "type": "integer", "isExpression": True, "value": "a + 1"},
            ],
        )

        errors = _function_save_errors(surface, definition)

        assert _messages_of(errors, "EXPRESSION_CYCLE") == [
            "Circular reference detected for variable 'a': a -> b -> a"
        ]

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    def test_an_output_and_a_local_reading_each_other_is_refused(self, surface: str) -> None:
        definition = _computed_function(
            outputs=[
                {"name": "total", "type": "integer", "isExpression": True, "default": "step + 1"}
            ],
            variables=[
                {"name": "step", "type": "integer", "isExpression": True, "value": "total * 2"}
            ],
        )

        errors = _function_save_errors(surface, definition)

        assert _messages_of(errors, "EXPRESSION_CYCLE") == [
            "Circular reference detected for variable 'step': step -> total -> step"
        ]

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    def test_known_names_give_no_finding(self, surface: str) -> None:
        definition = _computed_function(
            outputs=[
                {"name": "total", "type": "integer", "isExpression": True, "default": "step + 1"},
                {
                    "name": "label",
                    "type": "string",
                    "isTemplate": True,
                    "default": "id-{{ count }}",
                },
            ],
            variables=[
                {"name": "step", "type": "integer", "isExpression": True, "value": "count * 2"}
            ],
        )

        errors = _function_save_errors(surface, definition)

        assert _messages_of(errors, "UNRESOLVED_VARIABLE_REFERENCE") == []
        assert _messages_of(errors, "EXPRESSION_CYCLE") == []


class TestSecretEnumInput:
    """An input cannot be both secret and an enum (REQ-3.1.2.11, VMGR-104)."""

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    def test_a_secret_enum_input_is_refused(self, surface: str) -> None:
        level = {**_enum_input("level", "string", ["low", "high"]), "secret": True}
        definition = _computed_function(outputs=[])
        definition["inputs"] = [level]

        errors = _function_save_errors(surface, definition)

        assert _messages_of(errors, "SECRET_ENUM_INPUT") == [
            "Input 'level' cannot be both secret and an enum"
        ]

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    def test_an_enum_input_that_is_not_secret_is_clean(self, surface: str) -> None:
        definition = _computed_function(outputs=[])
        definition["inputs"] = [_enum_input("level", "string", ["low", "high"])]

        errors = _function_save_errors(surface, definition)

        assert _messages_of(errors, "SECRET_ENUM_INPUT") == []


# ---------------------------------------------------------------------------
# Declaration rules: enum inputs, boolean default, one name per Function
# (REQ-3.1.2.4, REQ-3.1.2.10, REQ-3.1.2.11)
# ---------------------------------------------------------------------------

_DECLARATION_CODES = frozenset(
    {
        "ENUM_INPUT_TYPE",
        "ENUM_INPUT_NOT_REQUIRED",
        "ENUM_INPUT_EMPTY",
        "ENUM_VALUE_TYPE",
        "ENUM_INPUT_NO_DEFAULT",
        "ENUM_DEFAULT_NOT_ALLOWED",
        "SECRET_ENUM_INPUT",
        "BOOLEAN_INPUT_NO_DEFAULT",
        "DUPLICATE_PARAMETER_NAME",
        "DUPLICATE_VARIABLE_NAME",
    }
)

_ENUM_INPUT_TYPE = (
    "ENUM_INPUT_TYPE",
    "Enum input 'level' must be of type string, integer or float",
)
_ENUM_INPUT_NO_DEFAULT = (
    "ENUM_INPUT_NO_DEFAULT",
    "Enum input 'level' needs a default from its allowed values",
)
_BOOLEAN_INPUT_NO_DEFAULT = (
    "BOOLEAN_INPUT_NO_DEFAULT",
    "Boolean input 'flag' needs a default",
)


def _declaration_errors(errors: Iterable[tuple[Any, Any]]) -> list[tuple[Any, Any]]:
    return sorted(pair for pair in errors if pair[0] in _DECLARATION_CODES)


def _declaring(
    inputs: list[dict[str, Any]],
    *,
    outputs: list[dict[str, Any]] | None = None,
    variables: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    definition = _computed_function(outputs=outputs or [], variables=variables)
    definition["inputs"] = inputs
    return definition


def _without_default(declared: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in declared.items() if key != "default"}


_OLD_ARRAY_ENUM = {
    "name": "level",
    "type": "array",
    "required": True,
    "description": "",
    "enumValueType": "string",
    "enumValues": ["low", "high"],
}


class TestEnumInputRules:
    """A malformed enum input is refused at library save and at Test save (REQ-3.1.2.11)."""

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    @pytest.mark.parametrize(
        ("level", "expected"),
        [
            pytest.param(
                {**_enum_input("level", "string", ["low", "high"]), "required": False},
                [("ENUM_INPUT_NOT_REQUIRED", "Enum input 'level' must be required")],
                id="not-required",
            ),
            pytest.param(
                _without_default({**_enum_input("level", "string", ["low"]), "enumValues": []}),
                sorted(
                    [
                        ("ENUM_INPUT_EMPTY", "Enum input 'level' has no allowed values"),
                        _ENUM_INPUT_NO_DEFAULT,
                    ]
                ),
                id="no-allowed-values",
            ),
            pytest.param(
                _enum_input("level", "integer", [1, "abc"]),
                [
                    (
                        "ENUM_VALUE_TYPE",
                        "Allowed value 'abc' of enum input 'level' is not a valid integer",
                    )
                ],
                id="allowed-value-type",
            ),
            pytest.param(
                _without_default(_enum_input("level", "string", ["low", "high"])),
                [_ENUM_INPUT_NO_DEFAULT],
                id="no-default",
            ),
            pytest.param(
                {**_enum_input("level", "string", ["low", "high"]), "default": None},
                [_ENUM_INPUT_NO_DEFAULT],
                id="null-default",
            ),
            pytest.param(
                {**_enum_input("level", "string", ["low", "high"]), "default": "x"},
                [
                    (
                        "ENUM_DEFAULT_NOT_ALLOWED",
                        "Default 'x' of enum input 'level' is not one of its allowed values",
                    )
                ],
                id="default-not-allowed",
            ),
        ],
    )
    def test_a_broken_enum_rule_is_refused(
        self, surface: str, level: dict[str, Any], expected: list[tuple[str, str]]
    ) -> None:
        errors = _function_save_errors(surface, _declaring([level]))

        assert _declaration_errors(errors) == expected

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    def test_an_old_array_enum_is_refused_without_per_value_findings(self, surface: str) -> None:
        errors = _function_save_errors(surface, _declaring([_OLD_ARRAY_ENUM]))

        assert _declaration_errors(errors) == sorted([_ENUM_INPUT_TYPE, _ENUM_INPUT_NO_DEFAULT])

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    @pytest.mark.parametrize(
        ("level", "last_rules"),
        [
            pytest.param(
                {"enumValues": ["abc", 2], "default": 5},
                [
                    (
                        "ENUM_DEFAULT_NOT_ALLOWED",
                        "Default '5' of enum input 'level' is not one of its allowed values",
                    )
                ],
                id="default-outside",
            ),
            # A save drops a secret input's default, so the secret case carries none.
            pytest.param(
                {"enumValues": ["abc", 2], "secret": True},
                [
                    _ENUM_INPUT_NO_DEFAULT,
                    ("SECRET_ENUM_INPUT", "Input 'level' cannot be both secret and an enum"),
                ],
                id="secret-without-default",
            ),
        ],
    )
    def test_every_failing_rule_of_one_input_is_reported_together(
        self, surface: str, level: dict[str, Any], last_rules: list[tuple[str, str]]
    ) -> None:
        declared = {"name": "level", "type": "integer", "required": False, **level}

        errors = _function_save_errors(surface, _declaring([declared]))

        assert _declaration_errors(errors) == sorted(
            [
                ("ENUM_INPUT_NOT_REQUIRED", "Enum input 'level' must be required"),
                (
                    "ENUM_VALUE_TYPE",
                    "Allowed value 'abc' of enum input 'level' is not a valid integer",
                ),
                *last_rules,
            ]
        )

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    @pytest.mark.parametrize(
        ("value_type", "allowed"),
        [
            pytest.param("string", ["low", "high"], id="string"),
            pytest.param("integer", [1, 2], id="integer"),
            pytest.param("float", [1.5, 2.5], id="float"),
        ],
    )
    def test_a_well_formed_enum_is_clean(
        self, surface: str, value_type: str, allowed: list[Any]
    ) -> None:
        errors = _function_save_errors(
            surface, _declaring([_enum_input("level", value_type, allowed)])
        )

        assert _declaration_errors(errors) == []


class TestBooleanInputDefault:
    """Every non-secret true/false input has a default (REQ-3.1.2.10, VMGR-113)."""

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    @pytest.mark.parametrize("required", [True, False], ids=["required", "not-required"])
    @pytest.mark.parametrize(
        "default",
        [pytest.param({}, id="no-default"), pytest.param({"default": None}, id="null-default")],
    )
    def test_a_boolean_without_a_default_is_refused(
        self, surface: str, required: bool, default: dict[str, Any]
    ) -> None:
        flag = {"name": "flag", "type": "boolean", "required": required, **default}

        errors = _function_save_errors(surface, _declaring([flag]))

        assert _declaration_errors(errors) == [_BOOLEAN_INPUT_NO_DEFAULT]

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    @pytest.mark.parametrize("required", [True, False], ids=["required", "not-required"])
    @pytest.mark.parametrize("default", [True, False])
    def test_a_boolean_with_a_default_is_clean(
        self, surface: str, required: bool, default: bool
    ) -> None:
        flag = {"name": "flag", "type": "boolean", "required": required, "default": default}

        errors = _function_save_errors(surface, _declaring([flag]))

        assert _declaration_errors(errors) == []

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    def test_a_required_input_may_keep_a_default(self, surface: str) -> None:
        count = {"name": "count", "type": "integer", "required": True, "default": 3}

        errors = _function_save_errors(surface, _declaring([count]))

        assert _declaration_errors(errors) == []

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    @pytest.mark.parametrize("required", [True, False], ids=["required", "not-required"])
    def test_a_secret_boolean_needs_no_default(self, surface: str, required: bool) -> None:
        # A secret input has no default, so the boolean rule leaves it alone.
        flag = {"name": "flag", "type": "boolean", "required": required, "secret": True}

        errors = _function_save_errors(surface, _declaring([flag]))

        assert _declaration_errors(errors) == []


class TestParameterNameCollisions:
    """Inputs, outputs and locals share one name per Function (REQ-3.1.2.4, REQ-3.1.3.1)."""

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    @pytest.mark.parametrize(
        ("inputs", "outputs", "variables", "expected"),
        [
            pytest.param(
                [make_input("id", "string", required=False)],
                [make_output("id", "string")],
                [],
                (
                    "DUPLICATE_PARAMETER_NAME",
                    "Function declares 'id' as both an input and an output",
                ),
                id="input-and-output",
            ),
            pytest.param(
                [make_input("id", "string", required=False)],
                [],
                [{"name": "id", "type": "string", "value": "x"}],
                (
                    "DUPLICATE_PARAMETER_NAME",
                    "Function declares 'id' as both an input and a local variable",
                ),
                id="input-and-local",
            ),
            pytest.param(
                [],
                [make_output("id", "string")],
                [{"name": "id", "type": "string", "value": "x"}],
                (
                    "DUPLICATE_PARAMETER_NAME",
                    "Function declares 'id' as both an output and a local variable",
                ),
                id="output-and-local",
            ),
            pytest.param(
                [],
                [],
                [
                    {"name": "n", "type": "integer", "value": 1},
                    {"name": "n", "type": "string", "value": "x"},
                ],
                ("DUPLICATE_VARIABLE_NAME", "Function declares local variable 'n' more than once"),
                id="local-twice",
            ),
        ],
    )
    def test_a_name_declared_twice_is_refused(
        self,
        surface: str,
        inputs: list[dict[str, Any]],
        outputs: list[dict[str, Any]],
        variables: list[dict[str, Any]],
        expected: tuple[str, str],
    ) -> None:
        definition = _declaring(inputs, outputs=outputs, variables=variables)

        errors = _function_save_errors(surface, definition)

        assert _declaration_errors(errors) == [expected]

    @pytest.mark.parametrize("surface", _SAVE_SURFACES)
    def test_distinct_names_are_clean(self, surface: str) -> None:
        definition = _declaring(
            [make_input("host", "string", required=False)],
            outputs=[make_output("result", "string")],
            variables=[{"name": "step", "type": "integer", "value": 1}],
        )

        errors = _function_save_errors(surface, definition)

        assert _declaration_errors(errors) == []

    def test_malformed_local_entries_are_skipped(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        malformed: list[Any] = [
            None,
            "not-a-dict",
            {"name": 42, "type": "string"},
            {"type": "string", "value": "x"},
            {"name": "id", "type": "string", "value": "x"},
        ]
        definition = _declaring([make_input("id", "string", required=False)], variables=malformed)

        errors = _error_pairs(validate_function_for_save(definition))

        assert _declaration_errors(errors) == [
            (
                "DUPLICATE_PARAMETER_NAME",
                "Function declares 'id' as both an input and a local variable",
            )
        ]


class TestDeclarationIssuesAtTestSave:
    """A Test save attaches a Local Function's declaration issue to that Function Block."""

    def test_the_issue_names_the_local_function_block(self) -> None:
        not_required = {**_enum_input("level", "string", ["low", "high"]), "required": False}
        block = _local_function_block("fn-local", _declaring([not_required]))

        entries = _test_validate_entries([block])

        found = [e for e in entries if e.get("code") == "ENUM_INPUT_NOT_REQUIRED"]
        assert len(found) == 1, entries
        assert found[0]["message"] == "Enum input 'level' must be required"
        assert found[0]["node_id"] == "fn-local"
        assert found[0]["function_path"] == []

    def test_a_nested_local_function_issue_carries_the_function_path(self) -> None:
        inner = _local_function_block("fn-inner", _declaring([_OLD_ARRAY_ENUM]))
        outer = _local_function_block(
            "outer-1",
            make_function_payload(
                name="outer",
                workflow={"nodes": [inner], "edges": [_edge("start-node", "fn-inner")]},
            ),
        )

        entries = _test_validate_entries([outer])

        found = [e for e in entries if e.get("code") == "ENUM_INPUT_TYPE"]
        assert len(found) == 1, entries
        assert found[0]["message"] == "Enum input 'level' must be of type string, integer or float"
        assert found[0]["node_id"] == "fn-inner"
        assert [segment["node_id"] for segment in found[0]["function_path"]] == ["outer-1"]


# ---------------------------------------------------------------------------
# A Function Block gives every Required input a value (REQ-3.1.2.4, REQ-3.1.2.10)
# ---------------------------------------------------------------------------

_MISSING_N = ["Required parameter 'n' is missing"]


class TestFunctionBlockRequiredInputs:
    """A save refuses a Function Block that leaves a Required input with no value, at every
    depth; the input's default never counts as one."""

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    @pytest.mark.parametrize(
        "declared",
        [
            pytest.param(make_input("n", "integer", required=True), id="no-default"),
            pytest.param(make_input("n", "integer", required=True, default=3), id="with-default"),
            pytest.param(_enum_input("n", "string", ["low", "high"]), id="enum"),
        ],
    )
    def test_an_unset_required_input_is_refused(
        self, placement: str, declared: dict[str, Any]
    ) -> None:
        errors = _function_block_errors(placement, {"inputs": [declared]}, {})

        assert _messages_of(errors, "REQUIRED_PARAM_MISSING") == _MISSING_N

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    def test_a_null_value_gives_no_value(self, placement: str) -> None:
        inner = {"inputs": [make_input("n", "integer", required=True, default=3)]}

        errors = _function_block_errors(placement, inner, {"n": None})

        assert _messages_of(errors, "REQUIRED_PARAM_MISSING") == _MISSING_N

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    @pytest.mark.parametrize("text", ["", "   "], ids=["empty", "blank"])
    def test_a_blank_expression_is_empty(self, placement: str, text: str) -> None:
        inner = {"inputs": [make_input("n", "integer", required=True, default=3)]}

        errors = _function_block_errors(placement, inner, {"n": text}, expression_fields=["n"])

        assert _messages_of(errors, "REQUIRED_PARAM_EMPTY") == ["Required parameter 'n' is empty"]
        assert _messages_of(errors, "REQUIRED_PARAM_MISSING") == []

    @pytest.mark.parametrize("placement", ["local-body", "top-level"])
    def test_a_picked_value_the_narrowed_allowed_values_dropped_leaves_the_input_empty(
        self, placement: str
    ) -> None:
        picked = _function_block_errors(
            placement,
            {"inputs": [_enum_input("n", "string", ["low", "mid", "high"])]},
            {"n": "mid"},
        )
        dropped = _function_block_errors(
            placement, {"inputs": [_enum_input("n", "string", ["low", "high"])]}, {}
        )

        assert _messages_of(picked, "REQUIRED_PARAM_MISSING") == []
        assert _messages_of(dropped, "REQUIRED_PARAM_MISSING") == _MISSING_N

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    @pytest.mark.parametrize(
        ("declared", "value", "expression_fields"),
        [
            pytest.param(make_input("n", "integer", required=True, default=3), 4, [], id="literal"),
            pytest.param(
                make_input("n", "integer", required=True, default=3),
                "count + 1",
                ["n"],
                id="expression",
            ),
            pytest.param(_enum_input("n", "string", ["low", "high"]), "high", [], id="enum-pick"),
        ],
    )
    def test_a_required_input_given_a_value_is_clean(
        self, placement: str, declared: dict[str, Any], value: Any, expression_fields: list[str]
    ) -> None:
        errors = _function_block_errors(
            placement, {"inputs": [declared]}, {"n": value}, expression_fields=expression_fields
        )

        assert _messages_of(errors, "REQUIRED_PARAM_MISSING") == []
        assert _messages_of(errors, "REQUIRED_PARAM_EMPTY") == []

    @pytest.mark.parametrize("placement", _BLOCK_PLACEMENTS)
    def test_an_optional_input_may_be_left_unset(self, placement: str) -> None:
        inner = {"inputs": [make_input("n", "integer", required=False, default=3)]}

        errors = _function_block_errors(placement, inner, {})

        assert _messages_of(errors, "REQUIRED_PARAM_MISSING") == []

    def test_the_issue_names_the_function_block_on_the_test_canvas(self) -> None:
        inner = make_function_payload(
            name="inner", inputs=[make_input("n", "integer", required=True, default=3)]
        )

        entries = _test_validate_entries([_local_function_block("fn-1", inner)])

        found = [e for e in entries if e.get("code") == "REQUIRED_PARAM_MISSING"]
        assert len(found) == 1, entries
        assert found[0]["message"] == "Required parameter 'n' is missing"
        assert found[0]["node_id"] == "fn-1"
        assert found[0].get("function_path", []) == []

    def test_the_issue_inside_a_local_body_carries_the_function_path(self) -> None:
        inner = make_function_payload(
            name="inner", inputs=[make_input("n", "integer", required=True, default=3)]
        )
        block = _local_function_block("fn-1", inner)
        outer = _local_function_block(
            "outer-1",
            make_function_payload(
                name="outer", workflow={"nodes": [block], "edges": [_edge("start-node", "fn-1")]}
            ),
        )

        entries = _test_validate_entries([outer])

        found = [e for e in entries if e.get("code") == "REQUIRED_PARAM_MISSING"]
        assert len(found) == 1, entries
        assert found[0]["message"] == "Required parameter 'n' is missing"
        assert found[0]["node_id"] == "fn-1"
        assert [segment["node_id"] for segment in found[0]["function_path"]] == ["outer-1"]


# ---------------------------------------------------------------------------
# Dimension 5: Output producer (warning)
# ---------------------------------------------------------------------------


class TestOutputProducer:
    """``_validate_output_producer`` warns when an output has no internal writer."""

    def test_unwritten_output_produces_output_has_no_producer_warning(self) -> None:
        from wavecore.api.services.functions._storage import _validate_output_producer

        payload = make_function_payload(
            name="noproducer",
            outputs=[make_output("result", "string")],
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        values={"message": "'x'", "level": "INFO"},
                        # No binding to 'result' - the output has no writer.
                        output_bindings={},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        issues = _find(_validate_output_producer(payload), "OUTPUT_HAS_NO_PRODUCER")
        assert len(issues) == 1
        assert re.match(
            r"^Declared output 'result' is not written by any block$",
            _issue_field(issues[0], "message"),
        )
        assert _severities(issues) == ["warning"]

    def test_written_output_passes(self) -> None:
        from wavecore.api.services.functions._storage import _validate_output_producer

        payload = make_function_payload(
            name="hasproducer",
            outputs=[make_output("result", "string")],
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        values={"message": "'x'", "level": "INFO"},
                        output_bindings={"line": "result"},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        issues = _validate_output_producer(payload)
        assert "OUTPUT_HAS_NO_PRODUCER" not in _codes(issues)


# ---------------------------------------------------------------------------
# Dimension 6: Scope discipline
# ---------------------------------------------------------------------------


class TestScopeDiscipline:
    """``_validate_scope_discipline`` enforces the Function isolation contract."""

    def test_write_to_declared_input_produces_input_write_forbidden(self) -> None:
        from wavecore.api.services.functions._storage import _validate_scope_discipline

        payload = make_function_payload(
            name="writesinput",
            inputs=[make_input("x", "string", required=True)],
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        values={"message": "'mutating'", "level": "INFO"},
                        # Binding writes back into the declared input "x".
                        output_bindings={"line": "x"},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        issues = _find(_validate_scope_discipline(payload), "INPUT_WRITE_FORBIDDEN")
        assert len(issues) == 1
        assert re.match(
            r"^Writes to declared input 'x'; inputs are read-only$",
            _issue_field(issues[0], "message"),
        )
        assert _issue_field(issues[0], "node_label") == "log-1"

    def test_external_scope_read_produces_external_scope_read_forbidden(self) -> None:
        from wavecore.api.services.functions._storage import _validate_scope_discipline

        payload = make_function_payload(
            name="readsexternal",
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        # Reads "regression.foo" - regression scope is external.
                        values={"message": "regression.foo", "level": "INFO"},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        issues = _find(
            _validate_scope_discipline(payload),
            "EXTERNAL_SCOPE_READ_FORBIDDEN",
        )
        assert len(issues) == 1
        assert re.match(
            r"^Reads variable 'foo' from external scope 'regression'; "
            r"only the Function's own scope is visible$",
            _issue_field(issues[0], "message"),
        )
        assert _issue_field(issues[0], "node_label") == "log-1"

    def test_legal_local_scope_read_passes(self) -> None:
        from wavecore.api.services.functions._storage import _validate_scope_discipline

        payload = make_function_payload(
            name="readsown",
            inputs=[make_input("x", "string", required=True)],
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        values={"message": "x", "level": "INFO"},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        issues = _validate_scope_discipline(payload)
        assert "EXTERNAL_SCOPE_READ_FORBIDDEN" not in _codes(issues)
        assert "INPUT_WRITE_FORBIDDEN" not in _codes(issues)


# ---------------------------------------------------------------------------
# Dimension 7: Flow consistency
# ---------------------------------------------------------------------------


class TestFlowConsistency:
    """``_validate_flow_consistency`` reuses Test-workflow structural rules."""

    def test_unreachable_node_produces_node_unreachable(self) -> None:
        from wavecore.api.services.functions._storage import _validate_flow_consistency

        payload = make_function_payload(
            name="unreachable",
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "reachable",
                        element_type="log",
                        values={"message": "'a'", "level": "INFO"},
                    ),
                    _make_workflow_node(
                        "orphan",
                        element_type="log",
                        values={"message": "'b'", "level": "INFO"},
                    ),
                ],
                "edges": [_edge("start-node", "reachable")],
            },
        )
        issues = _find(_validate_flow_consistency(payload), "NODE_UNREACHABLE")
        assert len(issues) == 1
        assert re.match(
            r"^Block is not reachable from the Function's entry$",
            _issue_field(issues[0], "message"),
        )
        assert _issue_field(issues[0], "node_label") == "orphan"

    def test_try_without_catch_produces_try_without_catch(self) -> None:
        from wavecore.api.services.functions._storage import _validate_flow_consistency

        payload = make_function_payload(
            name="trynocatch",
            workflow={
                "nodes": [
                    {
                        "id": "try-1",
                        "type": "workflowNode",
                        "data": {
                            # ``label`` doubles as the user-visible node name in
                            # validation messages; the test asserts on ``try-1``.
                            "label": "try-1",
                            "elementType": "try_catch",
                            "nodeType": "control",
                            "config": {"enable_catch": True, "enable_finally": False},
                        },
                    },
                    _make_workflow_node(
                        "body",
                        element_type="log",
                        values={"message": "'inner'", "level": "INFO"},
                    ),
                ],
                # Only a "body" edge - no "catch" branch.
                "edges": [
                    _edge("start-node", "try-1"),
                    _edge("try-1", "body", source_handle="body"),
                ],
            },
        )
        issues = _find(_validate_flow_consistency(payload), "TRY_WITHOUT_CATCH")
        assert len(issues) == 1
        assert re.match(
            r"^Try construct has no matching catch branch$",
            _issue_field(issues[0], "message"),
        )
        assert _issue_field(issues[0], "node_label") == "try-1"


# ---------------------------------------------------------------------------
# Severity classification (errors vs warnings)
# ---------------------------------------------------------------------------


class TestSeverityClassification:
    """Errors block save; warnings are advisory."""

    def test_warning_codes_are_warning_severity(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            name="warnonly",
            outputs=[make_output("unwritten", "string")],
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        values={"message": "'x'", "level": "INFO"},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        issues = validate_function_for_save(payload)
        producers = _find(issues, "OUTPUT_HAS_NO_PRODUCER")
        assert producers, "expected at least one OUTPUT_HAS_NO_PRODUCER warning"
        assert all(s == "warning" for s in _severities(producers))

    def test_error_codes_are_error_severity(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(name="X" * 33)
        issues = validate_function_for_save(payload)
        name_issues = _find(issues, "FUNCTION_NAME_TOO_LONG")
        assert name_issues
        assert all(s == "error" for s in _severities(name_issues))


class TestDefensiveGuards:
    """Edge-case + defensive branches in the storage validator helpers."""

    def test_empty_name_emits_function_name_required(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(name="")
        codes = _codes(validate_function_for_save(payload))
        assert "FUNCTION_NAME_REQUIRED" in codes

    def test_whitespace_only_name_emits_function_name_required(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(name="   ")
        codes = _codes(validate_function_for_save(payload))
        assert "FUNCTION_NAME_REQUIRED" in codes

    def test_non_mapping_input_declaration_is_skipped(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            inputs=[None, "not-a-dict", make_input("x", "string", required=True)]
        )
        # Validator should NOT crash on malformed entries; it just skips them.
        issues = validate_function_for_save(payload)
        # The valid input ``x`` has type so no INPUT_TYPE_MISSING for it.
        assert "INPUT_TYPE_MISSING" not in _codes(issues)

    def test_non_string_input_name_is_skipped(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            inputs=[
                {"name": 42, "type": "string"},
                make_input("y", "string", required=True),
            ]
        )
        # Validator survives a numeric ``name`` field.
        validate_function_for_save(payload)

    def test_non_mapping_output_declaration_is_skipped(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            outputs=[None, "not-a-dict", make_output("result", "string")]
        )
        validate_function_for_save(payload)

    def test_non_string_output_name_is_skipped(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            outputs=[{"name": 99, "type": "string"}, make_output("result", "string")]
        )
        validate_function_for_save(payload)


class TestAttributeChainsParse:
    """``_attribute_chains`` swallows ``SyntaxError`` from un-parseable text."""

    def test_unparsable_expression_returns_empty(self) -> None:
        from wavecore.api.services.functions._storage import _attribute_chains

        assert _attribute_chains("totally not python (((") == []


class TestValidateNameDefensive:
    """``_validate_name`` returns no issues when name is not a string."""

    def test_non_string_name_returns_empty(self) -> None:
        from wavecore.api.services.functions._storage import _validate_name

        # name is not a str (e.g. ``42`` or ``None``); the function returns []
        # without raising.
        assert _validate_name(42) == []
        assert _validate_name(None) == []


class TestTryWithCatchSkipsValidation:
    """A try-catch construct that has a catch egress does NOT report
    ``TRY_WITHOUT_CATCH`` (the helper returns ``None``)."""

    def test_try_with_catch_branch_is_silent(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            workflow={
                "nodes": [
                    {
                        "id": "tc-ok",
                        "type": "workflowNode",
                        "data": {
                            "nodeType": "control",
                            "elementType": "try-catch-finally",
                            "config": {"values": {"enable_catch": True}},
                        },
                    },
                    _make_workflow_node(
                        "log-try",
                        element_type="log",
                        values={"message": "'try'", "level": "INFO"},
                    ),
                    _make_workflow_node(
                        "log-catch",
                        element_type="log",
                        values={"message": "'catch'", "level": "INFO"},
                    ),
                ],
                "edges": [
                    _edge("start-node", "tc-ok"),
                    _edge("tc-ok", "log-try", source_handle="try"),
                    _edge("tc-ok", "log-catch", source_handle="catch"),
                ],
            },
        )
        codes = _codes(validate_function_for_save(payload))
        assert "TRY_WITHOUT_CATCH" not in codes


class TestFlowConsistencyVisitedShortCircuit:
    """``_validate_flow_consistency`` BFS short-circuits via the visited set."""

    def test_duplicate_initial_edges_do_not_double_count(self) -> None:
        """Two edges from ``start-node`` to the same target -> the visited
        check fires on the second pop (line 775)."""
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            workflow={
                "nodes": [
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        values={"message": "'x'", "level": "INFO"},
                    ),
                ],
                "edges": [
                    _edge("start-node", "log-1"),
                    _edge("start-node", "log-1"),  # duplicate -> visited check
                ],
            },
        )
        codes = _codes(validate_function_for_save(payload))
        # No NODE_UNREACHABLE because the (only) node was visited once.
        assert "NODE_UNREACHABLE" not in codes


class TestFunctionBlockShapesInAFunctionFlow:
    """The Function save copes with every Function Block shape a body can carry."""

    def test_local_function_with_non_dict_localDefinition_is_skipped(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            workflow={
                "nodes": [
                    {
                        "id": "fn-inner-1",
                        "type": "workflowNode",
                        "data": {
                            "nodeType": "function",
                            "functionLifecycle": "local",
                            # Not a dict: the Block has no field list to read.
                            "localDefinition": "not-a-dict",
                            "config": {"values": {"x": 1}},
                        },
                    },
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        values={"message": "'x'", "level": "INFO"},
                    ),
                ],
                "edges": [_edge("start-node", "log-1")],
            },
        )
        validate_function_for_save(payload)

    def test_a_text_value_fits_a_string_input(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            workflow={
                "nodes": [
                    _local_function_block(
                        "fn-inner",
                        {
                            "name": "inner",
                            "inputs": [make_input("x", "string", required=False)],
                            "outputs": [],
                        },
                        {"x": "raw-string-value"},
                    ),
                ],
                "edges": [_edge("start-node", "fn-inner")],
            },
        )
        codes = _codes(validate_function_for_save(payload))
        assert "INVALID_SETTING_TYPE" not in codes
        assert "UNKNOWN_SETTING" not in codes

    def test_an_undeclared_field_is_refused(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            workflow={
                "nodes": [
                    _local_function_block(
                        "fn-inner",
                        {
                            "name": "inner",
                            "inputs": [make_input("declared", "string", required=False)],
                            "outputs": [],
                        },
                        {"unknown": 5},
                    ),
                ],
                "edges": [_edge("start-node", "fn-inner")],
            },
        )
        errors = _error_pairs(validate_function_for_save(payload))
        assert _messages_of(errors, "UNKNOWN_SETTING") == ["Block 'inner' has no setting 'unknown'"]


class TestOutputProducerDefensiveBranches:
    """``_validate_output_producer`` skips malformed entries."""

    def test_non_mapping_output_declaration_is_skipped(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        payload = make_function_payload(
            outputs=[None, {"name": 0, "type": "string"}, make_output("real", "string")],
        )
        codes = _codes(validate_function_for_save(payload))
        # ``real`` is the only valid output and has no producer -> warning.
        producers = [c for c in codes if c == "OUTPUT_HAS_NO_PRODUCER"]
        assert len(producers) == 1


class TestTryCatchEnablesCatchFallback:
    """``_try_catch_enables_catch`` falls back to ``config.values`` when
    ``enable_catch`` is not on the top-level config."""

    def test_try_with_catch_disabled_via_values_skips_validation(self) -> None:
        from wavecore.api.services.functions._storage import validate_function_for_save

        # A try-catch with catch disabled via ``values.enable_catch=False``
        # bypasses the TRY_WITHOUT_CATCH check entirely.
        payload = make_function_payload(
            workflow={
                "nodes": [
                    {
                        "id": "tc-1",
                        "type": "workflowNode",
                        "data": {
                            "nodeType": "control",
                            "elementType": "try-catch-finally",
                            "config": {
                                "values": {"enable_catch": False},
                            },
                        },
                    },
                    _make_workflow_node(
                        "log-1",
                        element_type="log",
                        values={"message": "'x'", "level": "INFO"},
                    ),
                ],
                "edges": [
                    _edge("start-node", "tc-1"),
                    _edge("tc-1", "log-1", source_handle="try"),
                ],
            },
        )
        codes = _codes(validate_function_for_save(payload))
        assert "TRY_WITHOUT_CATCH" not in codes


# ---------------------------------------------------------------------------
# Dimension 8: Function-flow checks at every depth (REQ-3.1.2.4, REQ-3.1.3.13)
# ---------------------------------------------------------------------------

# Library version body, Local body, and a Shared Function Block's edit-mode draft.
_FLOW_SURFACES = ["library-save", "local-body", "shared-draft"]

_LIBRARY_METADATA = {
    "description": "",
    "tags": [],
    "changelog": "v",
    "details": "",
    "published_at": "2026-01-01T00:00:00Z",
    "published_by": "wave",
}


def _seed_library_version(
    function_id: str, version: str, *, name: str, inputs: list[dict[str, Any]]
) -> None:
    from wavecore.api.services.functions._storage import save_new_version

    definition = {
        "inputs": inputs,
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }
    save_new_version(function_id, version, definition, _LIBRARY_METADATA, name=name)


def _shared_function_block(
    node_id: str, function_id: str, version: str, values: dict[str, Any] | None = None
) -> dict[str, Any]:
    block = _make_workflow_node(
        node_id,
        element_type="function",
        node_type="function",
        function_id=function_id,
        function_lifecycle="shared",
        values=values,
    )
    block["data"]["functionVersion"] = version
    return block


def _shared_draft_errors(definition: dict[str, Any]) -> list[tuple[Any, Any]]:
    function_id = str(uuid.uuid4())
    _seed_library_version(function_id, "1.0.0", name="drafted", inputs=[])
    block = _shared_function_block("fn-draft", function_id, "1.0.0")
    block["data"].update(
        editMode=True,
        upstreamLink={"functionId": function_id, "sourceVersion": "1.0.0"},
        draft=definition,
    )
    return _test_validate_errors([block])


def _flow_errors(surface: str, definition: dict[str, Any]) -> list[tuple[Any, Any]]:
    """Errors the save reports for the Function flow of ``definition`` on one surface."""
    if surface == "shared-draft":
        return _shared_draft_errors(definition)
    if surface == "library-save":
        return _library_save_errors(definition)
    return _test_validate_errors([_local_function_block("fn-local", definition)])


def _flow(
    nodes: list[dict[str, Any]], *, name: str = "checked", **declarations: Any
) -> dict[str, Any]:
    """A Function ``name`` whose body runs ``nodes`` one after another."""
    nodes = copy.deepcopy(nodes)
    ids = ["start-node", *(node["id"] for node in nodes)]
    edges = [_edge(source, target) for source, target in zip(ids, ids[1:], strict=False)]
    return make_function_payload(
        name=name,
        outputs=declarations.pop("outputs", []),
        workflow={"nodes": nodes, "edges": edges},
        **declarations,
    )


def _log_block(node_id: str = "log-1", **values: Any) -> dict[str, Any]:
    return _make_workflow_node(
        node_id, element_type="log", values={"message": "'hi'", "level": "INFO", **values}
    )


def _setter_block(node_id: str, rows: dict[str, Any]) -> dict[str, Any]:
    return _make_workflow_node(
        node_id, element_type="variable-setter", node_type="control", values={"variables": rows}
    )


def _inner_function(**inputs: str) -> dict[str, Any]:
    """A Local Function ``inner`` whose optional inputs have the given types."""
    declared = [make_input(name, value_type, required=False) for name, value_type in inputs.items()]
    return make_function_payload(name="inner", outputs=[], inputs=declared)


_CHANGES_DATA = (
    "The append method changes data. An expression can only read data, not change it. "
    "To change a variable, add a Variable Setter Block. "
)


class TestFunctionBlockScopeRules:
    """The Function-flow scope rules judge every Block inside a Function flow, Function Blocks
    included; a Function Block in the root flow reads and writes like any root-flow Block."""

    def test_a_root_flow_function_block_may_read_a_system_variable(self) -> None:
        block = _local_function_block(
            "fn-1", _inner_function(n="string"), {"n": "system.x"}, expression_fields=["n"]
        )

        errors = _test_validate_errors([block])

        assert _messages_of(errors, "EXTERNAL_SCOPE_READ_FORBIDDEN") == []

    def test_a_root_flow_function_block_may_write_a_variable_named_like_its_input(self) -> None:
        inner = make_function_payload(
            name="inner",
            inputs=[make_input("x", "string", required=False)],
            outputs=[make_output("r", "string")],
        )
        block = _local_function_block("fn-1", inner)
        block["data"]["config"]["outputBindings"] = {"r": "x"}

        errors = _test_validate_errors([block], {"x": {"type": "string", "value": ""}})

        assert _messages_of(errors, "INPUT_WRITE_FORBIDDEN") == []

    @pytest.mark.parametrize("surface", ["library-save", "local-body"])
    def test_a_function_block_in_a_function_flow_may_not_read_an_outer_scope(
        self, surface: str
    ) -> None:
        block = _local_function_block(
            "fn-1", _inner_function(n="string"), {"n": "regression.foo"}, expression_fields=["n"]
        )

        errors = _flow_errors(surface, _flow([block]))

        assert _messages_of(errors, "EXTERNAL_SCOPE_READ_FORBIDDEN") == [
            "Reads variable 'foo' from external scope 'regression'; "
            "only the Function's own scope is visible"
        ]


class TestFunctionFlowSaveChecks:
    """Every Block in every Function flow gets the root flow's save checks (REQ-3.1.2.4)."""

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_a_muted_block_never_blocks_the_save(self, surface: str) -> None:
        muted_log = _make_workflow_node("log-1", element_type="log", values={"level": 5})
        muted_log["data"]["disabled"] = True
        fn_id = str(uuid.uuid4())
        _seed_library_version(
            fn_id, "1.0.0", name="greet", inputs=[make_input("who", "string", required=True)]
        )
        muted_block = _shared_function_block("fn-1", fn_id, "1.0.0")
        muted_block["data"]["disabled"] = True

        errors = _flow_errors(surface, _flow([muted_log, muted_block]))

        assert errors == []

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_the_same_block_unmuted_is_refused(self, surface: str) -> None:
        log = _make_workflow_node("log-1", element_type="log", values={"level": 5})

        errors = _flow_errors(surface, _flow([log]))

        assert _messages_of(errors, "REQUIRED_PARAM_MISSING") == [
            "Required parameter 'message' is missing"
        ]
        assert _messages_of(errors, "INVALID_SETTING_TYPE") == [
            "Setting 'level' of block 'log' expects string, got integer"
        ]

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_an_unknown_control_is_refused(self, surface: str) -> None:
        unknown = _make_workflow_node("x-1", element_type="x", node_type="control", values={})

        errors = _flow_errors(surface, _flow([unknown]))

        assert _messages_of(errors, "UNKNOWN_BLOCK_TYPE") == ["Unknown block type: 'x'"]

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    @pytest.mark.parametrize(
        "node",
        [
            pytest.param(
                _make_workflow_node(
                    "log-1",
                    element_type="log",
                    values={"message": "Hi {{ nope }}", "level": "INFO"},
                    template_fields=["message"],
                ),
                id="template-marker",
            ),
            pytest.param(
                _make_workflow_node(
                    "log-1",
                    element_type="log",
                    values={"message": "'hi'", "level": "INFO"},
                    output_bindings={"line": "nope"},
                ),
                id="output-target",
            ),
            pytest.param(_setter_block("set-1", {"nope": "v"}), id="setter-target"),
            pytest.param(
                _local_function_block(
                    "fn-1",
                    _inner_function(headers="map"),
                    {"headers": {"X-Id": "nope"}},
                    expression_fields=["headers.X-Id"],
                ),
                id="map-entry-expression",
            ),
        ],
    )
    def test_an_undeclared_name_is_refused(self, surface: str, node: dict[str, Any]) -> None:
        errors = _flow_errors(surface, _flow([node]))

        assert _messages_of(errors, "UNRESOLVED_VARIABLE_REFERENCE") == [_UNRESOLVED_NOPE]

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_declared_names_at_every_site_are_clean(self, surface: str) -> None:
        nodes = [
            _make_workflow_node(
                "log-1",
                element_type="log",
                values={"message": "Hi {{ who }}", "level": "INFO"},
                template_fields=["message"],
                output_bindings={"line": "out"},
            ),
            _setter_block("set-1", {"seen": "v"}),
            _local_function_block(
                "fn-1",
                _inner_function(headers="map"),
                {"headers": {"X-Id": "who"}},
                expression_fields=["headers.X-Id"],
            ),
        ]
        definition = _flow(
            nodes,
            inputs=[make_input("who", "string", required=False)],
            outputs=[make_output("out", "string")],
            variables=[{"name": "seen", "type": "string", "value": ""}],
        )

        errors = _flow_errors(surface, definition)

        assert _messages_of(errors, "UNRESOLVED_VARIABLE_REFERENCE") == []

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_a_setter_writing_an_input_is_refused(self, surface: str) -> None:
        definition = _flow(
            [_setter_block("set-1", {"x": "v"})],
            inputs=[make_input("x", "string", required=False)],
        )

        errors = _flow_errors(surface, definition)

        assert _messages_of(errors, "INPUT_WRITE_FORBIDDEN") == [
            "Writes to declared input 'x'; inputs are read-only"
        ]
        assert _messages_of(errors, "UNRESOLVED_VARIABLE_REFERENCE") == []

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_a_description_over_64_characters_is_refused(self, surface: str) -> None:
        log = _log_block()
        log["data"]["description"] = "d" * 65

        errors = _flow_errors(surface, _flow([log]))

        assert _messages_of(errors, "DESCRIPTION_TOO_LONG") == [
            "Block description must be at most 64 characters"
        ]

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_a_description_of_64_characters_is_clean(self, surface: str) -> None:
        log = _log_block()
        log["data"]["description"] = "d" * 64

        errors = _flow_errors(surface, _flow([log]))

        assert _messages_of(errors, "DESCRIPTION_TOO_LONG") == []

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    @pytest.mark.parametrize(
        ("node", "where"),
        [
            pytest.param(
                _make_workflow_node(
                    "log-1",
                    element_type="log",
                    values={"message": "str(rows.append(9))", "level": "INFO"},
                    expression_fields=["message"],
                ),
                "Block: log-1. Field: message.",
                id="plugin-block",
            ),
            pytest.param(
                _local_function_block(
                    "fn-1",
                    _inner_function(n="array"),
                    {"n": "rows.append(9)"},
                    expression_fields=["n"],
                ),
                "Block: fn-1. Field: n.",
                id="function-block",
            ),
        ],
    )
    def test_an_expression_that_changes_data_is_refused(
        self, surface: str, node: dict[str, Any], where: str
    ) -> None:
        definition = _flow([node], variables=[{"name": "rows", "type": "array", "value": [1]}])

        errors = _flow_errors(surface, definition)

        assert _messages_of(errors, "EXPRESSION_CHANGES_DATA") == [_CHANGES_DATA + where]

    def test_a_check_reaches_a_function_flow_two_levels_down(self) -> None:
        unknown = _make_workflow_node("x-1", element_type="x", node_type="control", values={})
        inner = _local_function_block("inner-1", _flow([unknown], name="inner"))
        outer = _local_function_block("outer-1", _flow([inner], name="outer"))

        entries = _test_validate_entries([outer])

        found = [e for e in entries if e.get("code") == "UNKNOWN_BLOCK_TYPE"]
        assert [e["message"] for e in found] == ["Unknown block type: 'x'"], entries
        assert found[0]["node_id"] == "x-1"
        assert [segment["node_id"] for segment in found[0]["function_path"]] == [
            "outer-1",
            "inner-1",
        ]

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_a_nested_shared_block_missing_a_required_input_is_refused(self, surface: str) -> None:
        fn_id = str(uuid.uuid4())
        _seed_library_version(
            fn_id, "1.0.0", name="greet", inputs=[make_input("who", "string", required=True)]
        )

        errors = _flow_errors(surface, _flow([_shared_function_block("fn-1", fn_id, "1.0.0")]))

        assert _messages_of(errors, "REQUIRED_PARAM_MISSING") == [
            "Required parameter 'who' is missing"
        ]

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_a_nested_shared_block_given_its_required_input_is_clean(self, surface: str) -> None:
        fn_id = str(uuid.uuid4())
        _seed_library_version(
            fn_id, "1.0.0", name="greet", inputs=[make_input("who", "string", required=True)]
        )
        block = _shared_function_block("fn-1", fn_id, "1.0.0", {"who": "ann"})

        errors = _flow_errors(surface, _flow([block]))

        assert _messages_of(errors, "REQUIRED_PARAM_MISSING") == []
        assert _messages_of(errors, "INVALID_SETTING_TYPE") == []

    @pytest.mark.parametrize("surface", _FLOW_SURFACES)
    def test_a_nested_shared_block_is_judged_by_its_pinned_version(self, surface: str) -> None:
        fn_id = str(uuid.uuid4())
        _seed_library_version(
            fn_id, "1.0.0", name="greet", inputs=[make_input("who", "integer", required=True)]
        )
        _seed_library_version(
            fn_id, "2.0.0", name="greet", inputs=[make_input("who", "string", required=True)]
        )

        pinned_old = _flow_errors(
            surface,
            _flow([_shared_function_block("fn-1", fn_id, "1.0.0", {"who": "ann"})], name="old"),
        )
        pinned_new = _flow_errors(
            surface,
            _flow([_shared_function_block("fn-1", fn_id, "2.0.0", {"who": "ann"})], name="new"),
        )

        assert _messages_of(pinned_old, "INVALID_SETTING_TYPE") == [
            "Setting 'who' of block 'greet' expects integer, got string"
        ]
        assert _messages_of(pinned_new, "INVALID_SETTING_TYPE") == []


pytestmark = pytest.mark.usefixtures("temp_storage_path")
