"""Unit tests for variable_service layer (REQ-5.2.4.7).

This module tests the variable service layer which provides business logic
for variable management operations including scope discovery, variable
manipulation, expression evaluation, and variable watching.

Variables follow the WAVE hierarchy (Regression → Suite → Test → Block)
with inheritance and override capabilities at each level, supporting typed
values, computed expressions, and secret masking.
"""

import re
import uuid
from decimal import Decimal
from typing import Any

import pytest

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.services import variable_service


def _exactly(message: str) -> str:
    """An anchored pattern matching ``message`` and nothing else."""
    return rf"^{re.escape(message)}$"


def _reset_storage() -> None:
    """Reset module-level storage for test isolation."""
    variable_service._variable_storage.clear()
    variable_service._watch_storage.clear()
    # Also drop the "hydrated from disk" flag so the next system-scope
    # access re-reads whatever the test fixture has set up on disk.
    variable_service._system_cache_loaded = False


class TestListScopes:
    """Test suite for list_scopes service function."""

    def test_list_scopes_returns_all_scopes(self) -> None:
        """Test that list_scopes returns all available scopes."""
        result = variable_service.list_scopes()

        assert "scopes" in result
        assert "system" in result["scopes"]
        assert "regression" in result["scopes"]
        assert "suite" in result["scopes"]
        assert "test" in result["scopes"]

    def test_list_scopes_returns_ordered_scopes(self) -> None:
        """Test that scopes are ordered from broadest to narrowest."""
        result = variable_service.list_scopes()

        scopes = result["scopes"]
        assert scopes.index("system") < scopes.index("regression")
        assert scopes.index("regression") < scopes.index("suite")
        assert scopes.index("suite") < scopes.index("test")


class TestGetEntityVariables:
    """Test suite for get_entity_variables service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_get_entity_variables_returns_variables(self) -> None:
        """Test getting variables for an entity."""
        entity_id = str(uuid.uuid4())

        # First set some variables
        variable_service.set_entity_variables(
            "test",
            entity_id,
            {
                "username": {"type": "string", "value": "admin"},
                "timeout": {"type": "integer", "value": 30},
            },
        )

        result = variable_service.get_entity_variables("test", entity_id)

        assert result is not None
        assert "variables" in result
        assert "username" in result["variables"]
        assert "timeout" in result["variables"]

    def test_get_entity_variables_returns_none_when_not_found(self) -> None:
        """Test that get_entity_variables returns None when entity not found."""
        result = variable_service.get_entity_variables("test", "nonexistent-id")

        assert result is None

    def test_get_entity_variables_includes_type_metadata(self) -> None:
        """Test that response includes type information."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"count": {"type": "integer", "value": 10}},
        )

        result = variable_service.get_entity_variables("test", entity_id)

        assert result is not None
        assert result["variables"]["count"]["type"] == "integer"

    def test_get_entity_variables_includes_secret_indicator(self) -> None:
        """Test that response includes secret indicator."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"api_key": {"type": "string", "value": "secret123", "secret": True}},
        )

        result = variable_service.get_entity_variables("test", entity_id)

        assert result is not None
        assert result["variables"]["api_key"]["secret"] is True
        assert result["variables"]["api_key"]["masked"] is True
        assert result["variables"]["api_key"]["value"] == "********"

    def test_get_entity_variables_includes_computed_status(self) -> None:
        """Test that response includes computed expression status."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {
                "total": {
                    "type": "integer",
                    "computed": True,
                    "expression": "count * price",
                }
            },
        )

        result = variable_service.get_entity_variables("test", entity_id)

        assert result is not None
        assert result["variables"]["total"]["computed"] is True


class TestSetEntityVariables:
    """Test suite for set_entity_variables service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_set_entity_variables_replaces_collection(self) -> None:
        """Test that set replaces entire variable collection."""
        entity_id = str(uuid.uuid4())

        # Set initial variables
        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"old_var": {"type": "string", "value": "old"}},
        )

        # Replace with new variables
        result = variable_service.set_entity_variables(
            "test",
            entity_id,
            {"new_var": {"type": "string", "value": "new"}},
        )

        assert result is not None
        assert "new_var" in result["variables"]
        assert "old_var" not in result["variables"]

    def test_set_entity_variables_validates_variable_names(self) -> None:
        """Test that invalid variable names are rejected."""
        entity_id = str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Invalid variable name: '123invalid' "
            r"\(must match \[a-zA-Z_\]\[a-zA-Z0-9_\]\*\)$",
        ):
            variable_service.set_entity_variables(
                "test",
                entity_id,
                {"123invalid": {"type": "string", "value": "bad"}},
            )

    @pytest.mark.parametrize("scope", ["system", "test"])
    def test_set_entity_variables_refuses_a_value_that_breaks_the_number_rule(
        self, scope: str
    ) -> None:
        """A typed value is held to the one number rule (REQ-3.1.3.14)."""
        with pytest.raises(
            ValidationException,
            match=_exactly("Value for variable 'big' allows at most 19 digits, got 20"),
        ):
            variable_service.set_entity_variables(
                scope,
                str(uuid.uuid4()),
                {"big": {"type": "integer", "value": "12345678901234567890"}},
            )

    def test_set_entity_variables_takes_digit_text(self) -> None:
        result = variable_service.set_entity_variables(
            "test", str(uuid.uuid4()), {"n": {"type": "integer", "value": "1234567890123456789"}}
        )

        assert result["variables"]["n"]["value"] == "1234567890123456789"

    def test_refuse_value_problems_skips_a_bare_value(self) -> None:
        variable_service.refuse_value_problems({"legacy": "1e3"})

    def test_set_entity_variables_accepts_name_at_max_length(self) -> None:
        """Test that variable names at exactly 64 characters are accepted."""
        entity_id = str(uuid.uuid4())
        name_64 = "a" * 64

        result = variable_service.set_entity_variables(
            "test",
            entity_id,
            {name_64: {"type": "string", "value": "ok"}},
        )

        assert result is not None
        assert name_64 in result["variables"]

    def test_set_entity_variables_rejects_name_exceeding_max_length(self) -> None:
        """Test that variable names exceeding 64 characters are rejected."""
        entity_id = str(uuid.uuid4())
        name_65 = "a" * 65

        with pytest.raises(
            ValidationException,
            match=r"^Invalid variable name: 'a{65}' \(must be 64 characters or fewer\)$",
        ):
            variable_service.set_entity_variables(
                "test",
                entity_id,
                {name_65: {"type": "string", "value": "bad"}},
            )

    def test_set_entity_variables_rejects_mismatched_element_types(self) -> None:
        """A sidecar must fit its value's declared type (REQ-3.1.3.19)."""
        with pytest.raises(
            ValidationException,
            match=r"^Invalid element types for variable 'm': "
            r"unknown element type 'number' for key 'n' "
            r"\(must be one of: array, boolean, float, integer, map, string\)$",
        ):
            variable_service.set_entity_variables(
                "suite",
                str(uuid.uuid4()),
                {"m": {"type": "map", "value": {"n": "1"}, "elementTypes": {"n": "number"}}},
            )

    def test_set_entity_variables_stores_element_types(self) -> None:
        entity_id = str(uuid.uuid4())
        typed = {"type": "array", "value": ["1", "x"], "elementTypes": ["integer", "string"]}
        result = variable_service.set_entity_variables("suite", entity_id, {"a": typed})

        assert result["variables"]["a"]["elementTypes"] == ["integer", "string"]

    def test_set_entity_variables_validates_types(self) -> None:
        """Test that invalid types are rejected."""
        entity_id = str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Invalid variable type: 'unknown_type' "
            r"\(must be one of: array, boolean, float, integer, map, string, table\)$",
        ):
            variable_service.set_entity_variables(
                "test",
                entity_id,
                {"var": {"type": "unknown_type", "value": "value"}},
            )

    def test_set_entity_variables_validates_expression_syntax(self) -> None:
        """Test that invalid expression syntax is rejected."""
        entity_id = str(uuid.uuid4())

        with pytest.raises(ValidationException, match=r"expression syntax"):
            variable_service.set_entity_variables(
                "test",
                entity_id,
                {
                    "total": {
                        "type": "integer",
                        "computed": True,
                        "expression": "count +* price",
                    }
                },
            )

    def test_set_entity_variables_masks_secrets_in_response(self) -> None:
        """Test that secret values are masked in response."""
        entity_id = str(uuid.uuid4())

        result = variable_service.set_entity_variables(
            "test",
            entity_id,
            {"password": {"type": "string", "value": "secret123", "secret": True}},
        )

        assert result is not None
        assert result["variables"]["password"]["value"] == "********"
        assert result["variables"]["password"]["masked"] is True

    def test_set_entity_variables_accepts_all_valid_types(self) -> None:
        """Test that all valid types are accepted."""
        entity_id = str(uuid.uuid4())

        result = variable_service.set_entity_variables(
            "test",
            entity_id,
            {
                "str_var": {"type": "string", "value": "text"},
                "num_var": {"type": "float", "value": 3.14},
                "bool_var": {"type": "boolean", "value": True},
                "arr_var": {"type": "array", "value": [1, 2, 3]},
                "map_var": {"type": "map", "value": {"key": "value"}},
                "table_var": {"type": "table", "value": [[1, 2], [3, 4]]},
            },
        )

        assert result is not None
        assert len(result["variables"]) == 6

    def test_set_entity_variables_rejects_reserved_name_in_test_scope(self) -> None:
        """Test that reserved namespace names are rejected for test-scope variables."""
        entity_id = str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Invalid variable name: 'system' \(reserved for namespace access; "
            r"use system\.field_name\)$",
        ):
            variable_service.set_entity_variables(
                "test",
                entity_id,
                {"system": {"type": "string", "value": "forbidden"}},
            )

    def test_set_entity_variables_rejects_suite_name_in_test_scope(self) -> None:
        """Test that 'suite' is rejected as test-scope variable name."""
        entity_id = str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Invalid variable name: 'suite' \(reserved for namespace access; "
            r"use suite\.field_name\)$",
        ):
            variable_service.set_entity_variables(
                "test",
                entity_id,
                {"suite": {"type": "string", "value": "forbidden"}},
            )

    def test_set_entity_variables_rejects_regression_name_in_test_scope(self) -> None:
        """Test that 'regression' is rejected as test-scope variable name."""
        entity_id = str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Invalid variable name: 'regression' \(reserved for namespace access; "
            r"use regression\.field_name\)$",
        ):
            variable_service.set_entity_variables(
                "test",
                entity_id,
                {"regression": {"type": "string", "value": "forbidden"}},
            )

    def test_set_entity_variables_allows_reserved_names_in_system_scope(self) -> None:
        """Test that reserved names are allowed in non-test scopes (system)."""
        result = variable_service.set_entity_variables(
            "system",
            variable_service.SYSTEM_ENTITY_ID,
            {"suite": {"type": "string", "value": "allowed_in_system"}},
        )

        assert result is not None
        assert "suite" in result["variables"]

    @pytest.mark.parametrize(
        ("name", "reason"),
        [
            pytest.param("class", "a Python keyword", id="keyword"),
            pytest.param("n\u00e4me", "must match [a-zA-Z_][a-zA-Z0-9_]*", id="not-ascii"),
        ],
    )
    @pytest.mark.parametrize("scope", ["test", "suite"])
    def test_set_entity_variables_refuses_a_name_the_variable_window_refuses(
        self, scope: str, name: str, reason: str
    ) -> None:
        """One name rule for every variable store (REQ-3.1.3.1)."""
        with pytest.raises(ValidationException) as raised:
            variable_service.set_entity_variables(
                scope, str(uuid.uuid4()), {name: {"type": "string", "value": "v"}}
            )

        assert raised.value.message == f"Invalid variable name: '{name}' ({reason})"

    def test_set_entity_variables_allows_reserved_names_in_suite_scope(self) -> None:
        """Test that reserved names are allowed in suite scope."""
        entity_id = str(uuid.uuid4())

        result = variable_service.set_entity_variables(
            "suite",
            entity_id,
            {"system": {"type": "string", "value": "allowed_in_suite"}},
        )

        assert result is not None
        assert "system" in result["variables"]


class TestUpdateEntityVariables:
    """Test suite for update_entity_variables service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_update_entity_variables_merges_variables(self) -> None:
        """Test that update merges with existing variables."""
        entity_id = str(uuid.uuid4())

        # Set initial variables
        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"existing": {"type": "string", "value": "kept"}},
        )

        # Update with new variables
        result = variable_service.update_entity_variables(
            "test",
            entity_id,
            {"new": {"type": "string", "value": "added"}},
        )

        assert result is not None
        assert "existing" in result["variables"]
        assert "new" in result["variables"]

    def test_update_entity_variables_returns_none_when_not_found(self) -> None:
        """Test that update returns None when entity not found."""
        result = variable_service.update_entity_variables(
            "test",
            "nonexistent-id",
            {"var": {"type": "string", "value": "value"}},
        )

        assert result is None

    def test_update_entity_variables_validates_type_consistency(self) -> None:
        """Test that type changes are rejected."""
        entity_id = str(uuid.uuid4())

        # Set initial variable with number type
        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"count": {"type": "integer", "value": 10}},
        )

        # Try to change type to string
        with pytest.raises(
            ValidationException,
            match=r"^Type mismatch for variable 'count': expected 'integer', got 'string'$",
        ):
            variable_service.update_entity_variables(
                "test",
                entity_id,
                {"count": {"type": "string", "value": "not-a-number"}},
            )

    def test_update_entity_variables_allows_adding_new_variables(self) -> None:
        """Test that new variables can be added."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"existing": {"type": "string", "value": "value"}},
        )

        result = variable_service.update_entity_variables(
            "test",
            entity_id,
            {"new_var": {"type": "integer", "value": 42}},
        )

        assert result is not None
        assert "new_var" in result["variables"]


class TestDeleteVariable:
    """Test suite for delete_variable service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_delete_variable_removes_variable(self) -> None:
        """Test that delete removes the specified variable."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {
                "keep": {"type": "string", "value": "kept"},
                "delete_me": {"type": "string", "value": "gone"},
            },
        )

        result = variable_service.delete_variable("test", entity_id, "delete_me")

        assert result is True

        # Verify variable is gone
        vars_result = variable_service.get_entity_variables("test", entity_id)
        assert vars_result is not None
        assert "keep" in vars_result["variables"]
        assert "delete_me" not in vars_result["variables"]

    def test_delete_variable_returns_false_when_not_found(self) -> None:
        """Test that delete returns False when variable not found."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"existing": {"type": "string", "value": "value"}},
        )

        result = variable_service.delete_variable("test", entity_id, "nonexistent")

        assert result is False

    def test_delete_variable_raises_when_entity_not_found(self) -> None:
        """Test that delete raises error when entity not found."""
        entity_id = str(uuid.uuid4())

        with pytest.raises(
            NotFoundException,
            match=rf"^Entity with ID '{entity_id}' not found in scope 'test'$",
        ):
            variable_service.delete_variable("test", entity_id, "some_var")


class TestEvaluateExpression:
    """Test suite for evaluate_expression service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_evaluate_expression_returns_result(self) -> None:
        """Test that evaluate returns computed result."""
        result = variable_service.evaluate_expression(
            "a + b",
            context={"variables": {"a": 5, "b": 3}},
        )

        assert result is not None
        assert result["result"] == 8
        assert result["type"] == "integer"

    def test_evaluate_expression_supports_fstring_interpolation(self) -> None:
        """Test that evaluation supports f-string interpolation."""
        result = variable_service.evaluate_expression(
            "f'Hello, {name}!'",
            context={"variables": {"name": "World"}},
        )

        assert result is not None
        assert result["result"] == "Hello, World!"

    def test_evaluate_expression_supports_arithmetic(self) -> None:
        """Test that evaluation supports arithmetic operators."""
        result = variable_service.evaluate_expression(
            "a * b + c",
            context={"variables": {"a": 2, "b": 3, "c": 4}},
        )

        assert result is not None
        assert result["result"] == 10

    def test_evaluate_expression_supports_logical_operators(self) -> None:
        """Test that evaluation supports logical operators."""
        result = variable_service.evaluate_expression(
            "a > 5 and b < 10",
            context={"variables": {"a": 10, "b": 5}},
        )

        assert result is not None
        assert result["result"] is True

    def test_evaluate_expression_supports_builtin_functions(self) -> None:
        """Test that evaluation supports built-in functions."""
        result = variable_service.evaluate_expression(
            "sum(values)",
            context={"variables": {"values": [1, 2, 3, 4, 5]}},
        )

        assert result is not None
        assert result["result"] == 15

    def test_evaluate_expression_with_entity_context(self) -> None:
        """Test evaluation with entity context for scope inheritance."""
        entity_id = str(uuid.uuid4())

        # Set up variables for the entity
        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"count": {"type": "integer", "value": 10}},
        )

        result = variable_service.evaluate_expression(
            "count * 2",
            context={"scope": "test", "entity_id": entity_id},
        )

        assert result is not None
        assert result["result"] == 20

    def test_evaluate_expression_reads_declared_element_types(self) -> None:
        """A map's declared element types decide what an expression reads (REQ-3.1.3.19)."""
        result = variable_service.evaluate_expression(
            "m['n'] + 1",
            context={
                "variables": {
                    "m": {"type": "map", "value": {"n": "16"}, "elementTypes": {"n": "integer"}}
                }
            },
        )

        assert result is not None
        assert result["result"] == 17

    def test_evaluate_expression_entity_context_reads_element_types(self) -> None:
        entity_id = str(uuid.uuid4())
        variable_service.set_entity_variables(
            "suite",
            entity_id,
            {"m": {"type": "map", "value": {"f": "1.5"}, "elementTypes": {"f": "float"}}},
        )

        result = variable_service.evaluate_expression(
            "m['f'] * 2",
            context={"scope": "suite", "entity_id": entity_id},
        )

        assert result is not None
        assert result["result"] == "3.0"
        assert result["type"] == "float"

    def test_evaluate_expression_raises_on_syntax_error(self) -> None:
        """Test that evaluation raises error on syntax error."""
        with pytest.raises(ValidationException, match=r"syntax"):
            variable_service.evaluate_expression("a +* b")

    def test_evaluate_expression_marks_secret_results(self) -> None:
        """Test that results containing secrets are marked."""
        result = variable_service.evaluate_expression(
            "f'Bearer {token}'",
            context={
                "variables": {
                    "token": {"value": "secret123", "secret": True},
                }
            },
        )

        assert result is not None
        assert result.get("contains_secret") is True

    def test_evaluate_expression_supports_string_method_upper(self) -> None:
        """Test that evaluation supports string .upper() method."""
        result = variable_service.evaluate_expression(
            "name.upper()",
            context={"variables": {"name": "alice"}},
        )

        assert result is not None
        assert result["result"] == "ALICE"

    def test_evaluate_expression_supports_string_method_capitalize(self) -> None:
        """Test that evaluation supports string .capitalize() method."""
        result = variable_service.evaluate_expression(
            "name.capitalize()",
            context={"variables": {"name": "alice"}},
        )

        assert result is not None
        assert result["result"] == "Alice"

    def test_evaluate_expression_supports_chained_methods(self) -> None:
        """Test that evaluation supports chained method calls."""
        result = variable_service.evaluate_expression(
            "name.strip().upper()",
            context={"variables": {"name": "  alice  "}},
        )

        assert result is not None
        assert result["result"] == "ALICE"

    def test_evaluate_expression_supports_method_with_args(self) -> None:
        """Test that evaluation supports methods with arguments."""
        result = variable_service.evaluate_expression(
            "text.replace('world', 'python')",
            context={"variables": {"text": "hello world"}},
        )

        assert result is not None
        assert result["result"] == "hello python"

    def test_evaluate_expression_method_call_in_fstring(self) -> None:
        """Test method call combined with literal text via f-string."""
        result = variable_service.evaluate_expression(
            "f'Hello, {name.capitalize()}!'",
            context={"variables": {"name": "alice"}},
        )

        assert result is not None
        assert result["result"] == "Hello, Alice!"

    def test_evaluate_expression_mixed_variables_and_methods(self) -> None:
        """Test mixing simple variables and method calls via f-string."""
        result = variable_service.evaluate_expression(
            "f'{protocol}://{host.lower()}'",
            context={"variables": {"protocol": "https", "host": "EXAMPLE.COM"}},
        )

        assert result is not None
        assert result["result"] == "https://example.com"

    def test_evaluate_expression_undefined_var_in_a_method_call_is_refused_with_the_run_text(
        self,
    ) -> None:
        """An undefined variable fails as a 400 with the run's text for the same expression."""
        with pytest.raises(
            ValidationException, match=_exactly("Variable 'missing' is not defined")
        ) as refused:
            variable_service.evaluate_expression(
                "missing.upper()",
                context={"variables": {}},
            )

        assert refused.value.status_code == 400
        assert refused.value.error_code == "VALIDATION_ERROR"


class TestValidateExpression:
    """Test suite for validate_expression service function."""

    def test_validate_expression_returns_valid_for_good_syntax(self) -> None:
        """Test that validation passes for valid syntax."""
        result = variable_service.validate_expression("count * price")

        assert result["valid"] is True
        errors = [i for i in result["issues"] if i["type"] == "error"]
        assert len(errors) == 0

    def test_validate_expression_returns_errors_for_bad_syntax(self) -> None:
        """Test that validation returns errors for bad syntax."""
        result = variable_service.validate_expression("count +")

        assert result["valid"] is False
        errors = [i for i in result["issues"] if i["type"] == "error"]
        assert len(errors) > 0

    def test_validate_expression_returns_warnings_for_undefined_refs(self) -> None:
        """Test that validation warns about undefined variable references."""
        result = variable_service.validate_expression(
            "undefined_var",
            context={"variables": {}},
        )

        # Undefined refs are warnings, not errors
        warnings = [i for i in result["issues"] if i["type"] == "warning"]
        assert len(warnings) > 0

    def test_validate_expression_with_defined_variables(self) -> None:
        """Test that validation succeeds when variables are defined in context."""
        result = variable_service.validate_expression(
            "string_var + 5",
            context={
                "variables": {
                    "string_var": {"type": "string", "value": "text"},
                }
            },
        )

        # Valid syntax with defined variable - no issues
        assert result["valid"] is True
        assert len(result["issues"]) == 0

    def test_validate_expression_is_idempotent(self) -> None:
        """Test that validation has no side effects."""
        expression = "x + y"

        result1 = variable_service.validate_expression(expression)
        result2 = variable_service.validate_expression(expression)

        assert result1 == result2


class TestRegisterWatch:
    """Test suite for register_watch service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_register_watch_returns_watch_id(self) -> None:
        """Test that register_watch returns a watch ID."""
        result = variable_service.register_watch(["count", "total"])

        assert result is not None
        assert "watch_id" in result
        # Watch ID should be a valid UUID
        uuid.UUID(result["watch_id"])

    def test_register_watch_accepts_qualified_paths(self) -> None:
        """Test that register accepts variable paths with scope qualifiers."""
        result = variable_service.register_watch(
            [
                "test.my_test.count",
                "suite.my_suite.config",
            ]
        )

        assert result is not None
        assert "watch_id" in result

    def test_register_watch_accepts_execution_context(self) -> None:
        """Test that register accepts execution context."""
        execution_id = str(uuid.uuid4())

        result = variable_service.register_watch(
            ["count"],
            execution_id=execution_id,
        )

        assert result is not None

    def test_register_watch_raises_on_empty_list(self) -> None:
        """Test that register raises error for empty variable list."""
        with pytest.raises(
            ValidationException,
            match=r"^At least one variable path is required$",
        ):
            variable_service.register_watch([])


class TestGetWatchedValues:
    """Test suite for get_watched_values service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_get_watched_values_returns_current_values(self) -> None:
        """Test that get_watched_values returns current values."""
        entity_id = str(uuid.uuid4())

        # Set up variables
        variable_service.set_entity_variables(
            "test",
            entity_id,
            {
                "count": {"type": "integer", "value": 42},
                "total": {"type": "integer", "value": 100},
            },
        )

        # Register watch
        watch_result = variable_service.register_watch(
            [f"test.{entity_id}.count", f"test.{entity_id}.total"]
        )
        watch_id = watch_result["watch_id"]

        result = variable_service.get_watched_values(watch_id)

        assert result is not None
        assert "values" in result

    def test_get_watched_values_returns_none_when_not_found(self) -> None:
        """Test that get_watched_values returns None for unknown watch ID."""
        result = variable_service.get_watched_values("nonexistent-watch-id")

        assert result is None


class TestUnregisterWatch:
    """Test suite for unregister_watch service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_unregister_watch_returns_true_on_success(self) -> None:
        """Test that unregister returns True on success."""
        # Register a watch first
        watch_result = variable_service.register_watch(["count"])
        watch_id = watch_result["watch_id"]

        result = variable_service.unregister_watch(watch_id)

        assert result is True

    def test_unregister_watch_returns_false_when_not_found(self) -> None:
        """Test that unregister returns False for unknown watch ID."""
        result = variable_service.unregister_watch("nonexistent-watch-id")

        assert result is False

    def test_unregister_watch_releases_resources(self) -> None:
        """Test that unregister releases watch resources."""
        # Register a watch
        watch_result = variable_service.register_watch(["count"])
        watch_id = watch_result["watch_id"]

        # Unregister
        variable_service.unregister_watch(watch_id)

        # Subsequent get should return None
        result = variable_service.get_watched_values(watch_id)
        assert result is None


class TestValidateScope:
    """Test suite for scope validation."""

    def test_valid_scopes_are_accepted(self) -> None:
        """Test that valid scope identifiers are accepted."""
        entity_id = str(uuid.uuid4())

        for scope in ["system", "regression", "suite", "test"]:
            # Should not raise
            variable_service.set_entity_variables(
                scope,
                entity_id,
                {"var": {"type": "string", "value": "value"}},
            )

    def test_invalid_scope_raises_error(self) -> None:
        """Test that invalid scope identifier raises error."""
        entity_id = str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Invalid scope 'invalid_scope': valid scopes are system, regression, suite, "
            r"test$",
        ):
            variable_service.set_entity_variables(
                "invalid_scope",
                entity_id,
                {"var": {"type": "string", "value": "value"}},
            )


class TestSecretHandling:
    """Test suite for secret variable handling."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_secret_values_are_masked_in_get(self) -> None:
        """Test that secret values are masked in get responses."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"password": {"type": "string", "value": "secret123", "secret": True}},
        )

        result = variable_service.get_entity_variables("test", entity_id)

        assert result is not None
        assert result["variables"]["password"]["value"] == "********"
        assert result["variables"]["password"]["masked"] is True

    def test_secret_indicator_propagates_through_computed(self) -> None:
        """Test that secret indicator propagates through computed expressions."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {
                "api_key": {"type": "string", "value": "key123", "secret": True},
                "auth_header": {
                    "type": "string",
                    "computed": True,
                    "expression": "f'Bearer {api_key}'",
                },
            },
        )

        result = variable_service.get_entity_variables("test", entity_id)

        assert result is not None
        # The computed variable should also be marked as containing secrets
        assert result["variables"]["auth_header"].get("contains_secret") is True


class TestBuiltinFunctionsCoverage:
    """Test suite for builtin function evaluation coverage."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_avg_is_not_recognized(self) -> None:
        """The preview offers the run's builtins only, and ``avg`` is not one of them."""
        with pytest.raises(ValidationException, match=_exactly("Function 'avg' is not recognized")):
            variable_service.evaluate_expression(
                "avg(values)",
                context={"variables": {"values": [10, 20, 30]}},
            )

    def test_min_function(self) -> None:
        """Test min builtin function."""
        result = variable_service.evaluate_expression(
            "min(values)",
            context={"variables": {"values": [5, 2, 8]}},
        )
        assert result["result"] == 2
        assert result["type"] == "integer"

    def test_max_function(self) -> None:
        """Test max builtin function."""
        result = variable_service.evaluate_expression(
            "max(values)",
            context={"variables": {"values": [5, 2, 8]}},
        )
        assert result["result"] == 8
        assert result["type"] == "integer"

    def test_concat_is_not_recognized(self) -> None:
        """The preview offers the run's builtins only, and ``concat`` is not one of them."""
        with pytest.raises(
            ValidationException, match=_exactly("Function 'concat' is not recognized")
        ):
            variable_service.evaluate_expression(
                "concat(values)",
                context={"variables": {"values": ["a", "b", "c"]}},
            )

    def test_unknown_function_is_refused(self) -> None:
        """An unknown function fails with the run's text; the expression is never echoed back."""
        with pytest.raises(
            ValidationException, match=_exactly("Function 'unknownfunc' is not recognized")
        ):
            variable_service.evaluate_expression(
                "unknownfunc(values)",
                context={"variables": {"values": [1, 2, 3]}},
            )

    def test_builtin_with_secret_variable(self) -> None:
        """Test builtin function with secret variable marks result."""
        result = variable_service.evaluate_expression(
            "sum(secret_values)",
            context={"variables": {"secret_values": {"value": [1, 2, 3], "secret": True}}},
        )
        assert result["result"] == 6
        assert result.get("contains_secret") is True


class TestExpressionEvaluationCoverage:
    """Test suite for expression evaluation edge cases."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_lowercase_true_is_not_defined(self) -> None:
        """Expressions are Python: lowercase ``true`` is a name, refused as a run refuses it."""
        with pytest.raises(ValidationException, match=_exactly("Variable 'true' is not defined")):
            variable_service.evaluate_expression("true")

    def test_lowercase_false_is_not_defined(self) -> None:
        """Expressions are Python: lowercase ``false`` is a name, refused as a run refuses it."""
        with pytest.raises(ValidationException, match=_exactly("Variable 'false' is not defined")):
            variable_service.evaluate_expression("false")

    def test_float_number_evaluation(self) -> None:
        """Test evaluation of float number."""
        result = variable_service.evaluate_expression("3.14")
        assert result["result"] == 3.14
        assert result["type"] == "float"

    def test_integer_evaluation(self) -> None:
        """Test evaluation of integer."""
        result = variable_service.evaluate_expression("42")
        assert result["result"] == 42
        assert result["type"] == "integer"

    def test_undefined_variable_is_refused(self) -> None:
        """An undefined variable fails with the run's text; the expression is never echoed back."""
        with pytest.raises(
            ValidationException, match=_exactly("Variable 'undefined_var' is not defined")
        ):
            variable_service.evaluate_expression(
                "undefined_var + 1",
                context={"variables": {}},
            )

    def test_arithmetic_with_float_result(self) -> None:
        """Test arithmetic producing float result."""
        result = variable_service.evaluate_expression("5 / 2")
        assert result["result"] == 2.5
        assert result["type"] == "float"

    def test_arithmetic_on_undefined_names_is_refused(self) -> None:
        """The first undefined name is reported, as a run reports it."""
        with pytest.raises(ValidationException, match=_exactly("Variable 'hello' is not defined")):
            variable_service.evaluate_expression("hello + world")


class TestWatchPathCoverage:
    """Test suite for watch path resolution coverage."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_unqualified_watch_path(self) -> None:
        """Test watching unqualified variable path."""
        watch_result = variable_service.register_watch(["simple_var"])
        values = variable_service.get_watched_values(watch_result["watch_id"])

        assert values is not None
        assert "simple_var" in values["values"]
        assert values["values"]["simple_var"]["value"] is None
        assert values["values"]["simple_var"]["type"] is None

    def test_qualified_watch_path_not_found(self) -> None:
        """Test watching qualified path where entity doesn't exist."""
        entity_id = str(uuid.uuid4())
        watch_result = variable_service.register_watch([f"test.{entity_id}.myvar"])
        values = variable_service.get_watched_values(watch_result["watch_id"])

        # Path should still be in values, but entity wasn't found
        assert values is not None


class TestExpressionSyntaxCoverage:
    """Test suite for expression syntax validation coverage."""

    def test_invalid_python_syntax_raises(self) -> None:
        """Test that invalid Python syntax raises ValueError."""
        with pytest.raises(ValidationException, match=r"expression syntax"):
            variable_service._validate_expression_syntax("x +* y")

    def test_check_computed_contains_secret_with_invalid_syntax(self) -> None:
        """Test that invalid expression syntax returns False for secret check."""
        result = variable_service._check_computed_contains_secret(
            "x +* y",
            {"x": {"secret": True}},
        )
        assert result is False


class TestEvaluateExpressionEdgeCases:
    """Test suite for evaluate_expression edge cases."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_eval_returning_list_is_stringified(self) -> None:
        """Test that eval returning a non-string non-numeric result is stringified."""
        result = variable_service.evaluate_expression(
            "[1, 2, 3]",
        )
        assert result["result"] == "[1, 2, 3]"
        assert result["type"] == "string"


class TestExpressionEvaluationMethodCallCoverage:
    """Test suite for method call handling in expression evaluation."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_method_call_exception_is_refused_with_the_run_text(self) -> None:
        """A failing method call fails with the run's message; the expression is never echoed."""
        message = (
            "Expression evaluation failed for 'test_var.nonexistent_method()': "
            "'str' object has no attribute 'nonexistent_method'"
        )
        with pytest.raises(ValidationException, match=_exactly(message)):
            variable_service.evaluate_expression(
                "test_var.nonexistent_method()",
                context={"variables": {"test_var": {"value": "hello", "type": "string"}}},
            )

    def test_method_call_with_variable_argument(self) -> None:
        """Test method calls with variables as arguments (not just literals)."""
        result = variable_service.evaluate_expression(
            "my_var.replace('l', my_var)",
            context={"variables": {"my_var": {"value": "hello", "type": "string"}}},
        )

        # 'hello' with each 'l' replaced by 'hello' = 'hehellohelloo'
        assert result["result"] == "hehellohelloo"

    def test_method_call_with_multiple_variable_arguments(self) -> None:
        """Test method calls with multiple variables as arguments."""
        result = variable_service.evaluate_expression(
            "text.replace(old_val, new_val)",
            context={
                "variables": {
                    "text": {"value": "hello world", "type": "string"},
                    "old_val": {"value": "world", "type": "string"},
                    "new_val": {"value": "python", "type": "string"},
                }
            },
        )

        assert result["result"] == "hello python"


class TestEvaluateExpressionUsesTheRunEvaluator:
    """The preview evaluates exactly as a run does (REQ-5.2.4.7)."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_an_undefined_name_is_a_validation_error_without_the_expression(self) -> None:
        with pytest.raises(
            ValidationException, match=_exactly("Variable 'nope' is not defined")
        ) as refused:
            variable_service.evaluate_expression("nope")

        assert refused.value.status_code == 400
        assert refused.value.error_code == "VALIDATION_ERROR"

    def test_arithmetic_on_null_is_refused_with_the_null_message(self) -> None:
        message = "A value is null: unsupported operand type(s) for +: 'null' and 'int'"
        with pytest.raises(ValidationException, match=_exactly(message)):
            variable_service.evaluate_expression("None + 1")

    def test_arithmetic_on_a_variable_holding_null_is_refused_with_the_null_message(
        self,
    ) -> None:
        message = "A value is null: unsupported operand type(s) for +: 'null' and 'int'"
        with pytest.raises(ValidationException, match=_exactly(message)):
            variable_service.evaluate_expression(
                "count + 1",
                context={"variables": {"count": {"type": "integer", "value": None}}},
            )

    def test_a_null_result_is_null(self) -> None:
        result = variable_service.evaluate_expression("None")

        assert result["result"] is None
        assert result["type"] == "null"

    def test_a_variable_holding_null_reads_null(self) -> None:
        result = variable_service.evaluate_expression(
            "name",
            context={"variables": {"name": {"type": "string", "value": None}}},
        )

        assert result["result"] is None
        assert result["type"] == "null"

    @pytest.mark.parametrize(
        ("expression", "expected"),
        [("sum(values)", 15), ("min(values)", 1), ("max(values)", 5)],
    )
    def test_sum_min_and_max_work(self, expression: str, expected: int) -> None:
        result = variable_service.evaluate_expression(
            expression,
            context={"variables": {"values": [3, 1, 5, 2, 4]}},
        )

        assert result["result"] == expected
        assert result["type"] == "integer"

    def test_a_builtin_of_the_run_is_offered(self) -> None:
        result = variable_service.evaluate_expression(
            "format(port, '05d')",
            context={"variables": {"port": {"type": "integer", "value": 42}}},
        )

        assert result["result"] == "00042"
        assert result["type"] == "string"


class TestGetSystemVariables:
    """Test suite for get_system_variables service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_get_system_variables_returns_empty_when_none_exist(self) -> None:
        """Test auto-init: returns empty variables dict, not None."""
        result = variable_service.get_system_variables()

        assert result == {"variables": {}}

    def test_get_system_variables_returns_stored_variables(self) -> None:
        """Test retrieval of stored system variables."""
        variable_service.set_system_variables(
            {
                "api_url": {"type": "string", "value": "https://api.example.com"},
                "timeout": {"type": "integer", "value": 30},
            }
        )

        result = variable_service.get_system_variables()

        assert "variables" in result
        assert "api_url" in result["variables"]
        assert "timeout" in result["variables"]

    def test_get_system_variables_masks_secrets(self) -> None:
        """Test that secret values are masked in response."""
        variable_service.set_system_variables(
            {"api_key": {"type": "string", "value": "secret123", "secret": True}}
        )

        result = variable_service.get_system_variables()

        assert result["variables"]["api_key"]["value"] == "********"
        assert result["variables"]["api_key"]["masked"] is True


class TestSystemVariablePersistence:
    """System variables have no parent entity file, so the variable
    service owns their disk persistence at
    ``storage_paths.get_system_variables_file_path()``. These tests pin
    the restart-survival contract and the save/load hooks.
    """

    @pytest.fixture(autouse=True)
    def _isolated_storage_path(self, tmp_path, monkeypatch):
        """Redirect the on-disk file to a tmp path for every test in this
        class so tests can't pollute each other or the dev data dir."""
        target = tmp_path / "system_variables.yaml"
        monkeypatch.setattr(
            variable_service,
            "get_system_variables_file_path",
            lambda: target,
        )
        _reset_storage()
        yield target

    def test_set_system_variables_writes_yaml_file(self, _isolated_storage_path) -> None:
        variable_service.set_system_variables({"env": {"type": "string", "value": "prod"}})
        assert _isolated_storage_path.exists()
        # The file is a yaml document with a top-level `variables` key.
        import yaml

        with open(_isolated_storage_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data == {"variables": {"env": {"type": "string", "value": "prod"}}}

    def test_vars_survive_in_memory_reset_by_reading_from_disk(
        self, _isolated_storage_path
    ) -> None:
        """Simulating a backend restart: set vars, wipe the in-memory
        cache + hydrated flag, then fetch. The file-backed store must
        return the exact same vars without any re-set call."""
        variable_service.set_system_variables(
            {
                "env": {"type": "string", "value": "prod"},
                "retries": {"type": "integer", "value": 5},
            }
        )
        # Simulate restart.
        variable_service._variable_storage.clear()
        variable_service._system_cache_loaded = False

        result = variable_service.get_system_variables()
        assert result["variables"]["env"]["value"] == "prod"
        assert result["variables"]["retries"]["value"] == 5

    def test_delete_all_system_variables_persists_empty_state(self, _isolated_storage_path) -> None:
        variable_service.set_system_variables({"env": {"type": "string", "value": "prod"}})
        variable_service.delete_all_system_variables()
        # Restart.
        variable_service._variable_storage.clear()
        variable_service._system_cache_loaded = False

        # After reload, the deletion must persist - not revert to the prior snapshot.
        assert variable_service.get_system_variables() == {"variables": {}}

    def test_delete_single_system_variable_persists(self, _isolated_storage_path) -> None:
        variable_service.set_system_variables(
            {
                "keep": {"type": "string", "value": "k"},
                "drop": {"type": "string", "value": "d"},
            }
        )
        assert variable_service.delete_system_variable("drop") is True
        variable_service._variable_storage.clear()
        variable_service._system_cache_loaded = False

        result = variable_service.get_system_variables()
        assert "keep" in result["variables"]
        assert "drop" not in result["variables"]

    def test_load_handles_missing_file_by_returning_empty(self, _isolated_storage_path) -> None:
        """First-run behavior: no file on disk yet, service returns empty."""
        assert not _isolated_storage_path.exists()
        result = variable_service.get_system_variables()
        assert result == {"variables": {}}

    def test_load_handles_malformed_yaml_by_returning_empty(self, _isolated_storage_path) -> None:
        """Corrupted yaml must not crash the service - fall back to empty."""
        _isolated_storage_path.write_text("{not valid yaml: [", encoding="utf-8")
        assert variable_service.get_system_variables() == {"variables": {}}

    def test_load_handles_non_mapping_payload(self, _isolated_storage_path) -> None:
        """File exists but holds a scalar instead of the expected mapping."""
        _isolated_storage_path.write_text("42\n", encoding="utf-8")
        assert variable_service.get_system_variables() == {"variables": {}}

    def test_load_handles_variables_field_not_mapping(self, _isolated_storage_path) -> None:
        """File has top-level mapping but `variables:` is a list (malformed)."""
        _isolated_storage_path.write_text("variables: [1, 2, 3]\n", encoding="utf-8")
        assert variable_service.get_system_variables() == {"variables": {}}

    def test_update_entity_variables_system_scope_persists(self, _isolated_storage_path) -> None:
        """The generic update_entity_variables(scope='system', ...) path
        (used by the PATCH /variables/system API) must also write through
        to disk so merges survive restart."""
        variable_service.set_system_variables({"env": {"type": "string", "value": "prod"}})
        variable_service.update_entity_variables(
            "system",
            variable_service.SYSTEM_ENTITY_ID,
            {"retries": {"type": "integer", "value": 3}},
        )
        variable_service._variable_storage.clear()
        variable_service._system_cache_loaded = False

        result = variable_service.get_system_variables()
        assert result["variables"]["env"]["value"] == "prod"
        assert result["variables"]["retries"]["value"] == 3

    def test_delete_variable_system_scope_persists(self, _isolated_storage_path) -> None:
        """The generic delete_variable(scope='system', ..., name=...) path
        (used by the DELETE /variables/system/{name} API's backing call
        for non-system scopes - kept here for parity) must also persist."""
        variable_service.set_system_variables(
            {
                "keep": {"type": "string", "value": "k"},
                "drop": {"type": "string", "value": "d"},
            }
        )
        assert variable_service.delete_variable("system", variable_service.SYSTEM_ENTITY_ID, "drop")
        variable_service._variable_storage.clear()
        variable_service._system_cache_loaded = False

        result = variable_service.get_system_variables()
        assert "keep" in result["variables"]
        assert "drop" not in result["variables"]


class TestSetSystemVariables:
    """Test suite for set_system_variables service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_set_system_variables_stores_and_returns(self) -> None:
        """Test setting system variables stores them correctly."""
        variables: dict[str, Any] = {
            "env": {"type": "string", "value": "production"},
            "debug": {"type": "boolean", "value": False},
        }
        result = variable_service.set_system_variables(variables)

        assert "variables" in result
        assert "env" in result["variables"]
        assert "debug" in result["variables"]

    def test_set_system_variables_replaces_existing(self) -> None:
        """Test that set replaces entire collection."""
        variable_service.set_system_variables({"old_var": {"type": "string", "value": "old"}})
        variable_service.set_system_variables({"new_var": {"type": "string", "value": "new"}})

        result = variable_service.get_system_variables()

        assert "new_var" in result["variables"]
        assert "old_var" not in result["variables"]

    def test_set_system_variables_validates_names(self) -> None:
        """Test that invalid variable names are rejected."""
        with pytest.raises(
            ValidationException,
            match=r"^Invalid variable name: '123invalid' "
            r"\(must match \[a-zA-Z_\]\[a-zA-Z0-9_\]\*\)$",
        ):
            variable_service.set_system_variables(
                {"123invalid": {"type": "string", "value": "bad"}}
            )

    def test_set_system_variables_validates_types(self) -> None:
        """Test that invalid variable types are rejected."""
        with pytest.raises(
            ValidationException,
            match=r"^Invalid variable type: 'invalid_type' \(must be one of: array, boolean, "
            r"float, integer, map, string, table\)$",
        ):
            variable_service.set_system_variables({"x": {"type": "invalid_type", "value": "bad"}})


class TestDeleteAllSystemVariables:
    """Test suite for delete_all_system_variables service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_delete_all_system_variables_clears_storage(self) -> None:
        """Test that delete_all removes all system variables."""
        variable_service.set_system_variables({"x": {"type": "string", "value": "val"}})

        variable_service.delete_all_system_variables()

        result = variable_service.get_system_variables()
        assert result == {"variables": {}}

    def test_delete_all_system_variables_noop_when_empty(self) -> None:
        """Test that delete_all is safe when no variables exist."""
        variable_service.delete_all_system_variables()

        result = variable_service.get_system_variables()
        assert result == {"variables": {}}


class TestDeleteSystemVariable:
    """Test suite for delete_system_variable service function."""

    def setup_method(self) -> None:
        """Reset variable storage before each test."""
        _reset_storage()

    def test_delete_system_variable_removes_specific_variable(self) -> None:
        """Test that a specific variable is deleted."""
        variable_service.set_system_variables(
            {
                "keep_me": {"type": "string", "value": "kept"},
                "delete_me": {"type": "string", "value": "gone"},
            }
        )

        deleted = variable_service.delete_system_variable("delete_me")

        assert deleted is True
        result = variable_service.get_system_variables()
        assert "keep_me" in result["variables"]
        assert "delete_me" not in result["variables"]

    def test_delete_system_variable_returns_false_when_not_found(self) -> None:
        """Test that deleting non-existent variable returns False."""
        variable_service.set_system_variables({"x": {"type": "string", "value": "val"}})

        deleted = variable_service.delete_system_variable("nonexistent")

        assert deleted is False

    def test_delete_system_variable_returns_false_when_no_system_vars(self) -> None:
        """Test that deleting when no system scope exists returns False."""
        deleted = variable_service.delete_system_variable("anything")

        assert deleted is False

    def test_validate_variable_definitions_skips_non_dict_var_info(self) -> None:
        """Non-dict variable info values are skipped after name validation."""
        from wavecore.api.services.variable_service import _validate_variable_definitions

        # "my_var" with a plain string value (not a dict) should not raise
        _validate_variable_definitions({"my_var": "simple_string_value"}, bare_names=True)

    def test_check_type_consistency_skips_non_dict_var_info(self) -> None:
        """Non-dict variable info values are skipped in type consistency check."""
        from wavecore.api.services.variable_service import _check_type_consistency

        # Non-dict var_info should be silently skipped
        _check_type_consistency(
            {"my_var": "plain_value"},
            {"my_var": {"type": "string", "value": "old"}},
        )


class TestSetEntityVariablesCycleDetection:
    """Cycle detection on set_entity_variables (replace semantics).

    These tests pin the API-level circular-reference contract:
    every variable definition entry point (system, regression, suite, test
    scopes) MUST reject self-references, two-variable cycles, and N-variable
    cycles before persistence. Anchored regex on the exact error message
    matches this format:
        ^Circular reference detected for variable '<name>': <a> -> ... -> <a>$
    """

    def setup_method(self) -> None:
        _reset_storage()

    @pytest.mark.parametrize("scope", ["system", "regression", "suite", "test"])
    def test_set_rejects_direct_self_reference(self, scope: str) -> None:
        """Self-referential computed variable a -> a is rejected on every scope."""
        entity_id = variable_service.SYSTEM_ENTITY_ID if scope == "system" else str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Circular reference detected for variable 'a': a -> a$",
        ):
            variable_service.set_entity_variables(
                scope,
                entity_id,
                {
                    "a": {
                        "type": "integer",
                        "computed": True,
                        "expression": "a + 1",
                    },
                },
            )

    @pytest.mark.parametrize("scope", ["system", "regression", "suite", "test"])
    def test_set_rejects_two_variable_cycle(self, scope: str) -> None:
        """Cycle a -> b -> a is rejected on every scope."""
        entity_id = variable_service.SYSTEM_ENTITY_ID if scope == "system" else str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Circular reference detected for variable 'a': a -> b -> a$",
        ):
            variable_service.set_entity_variables(
                scope,
                entity_id,
                {
                    "a": {
                        "type": "integer",
                        "computed": True,
                        "expression": "b + 1",
                    },
                    "b": {
                        "type": "integer",
                        "computed": True,
                        "expression": "a + 1",
                    },
                },
            )

    @pytest.mark.parametrize("scope", ["system", "regression", "suite", "test"])
    def test_set_rejects_three_variable_cycle(self, scope: str) -> None:
        """Cycle a -> b -> c -> a is rejected on every scope, listing every node."""
        entity_id = variable_service.SYSTEM_ENTITY_ID if scope == "system" else str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Circular reference detected for variable 'a': a -> b -> c -> a$",
        ):
            variable_service.set_entity_variables(
                scope,
                entity_id,
                {
                    "a": {
                        "type": "integer",
                        "computed": True,
                        "expression": "b + 1",
                    },
                    "b": {
                        "type": "integer",
                        "computed": True,
                        "expression": "c + 1",
                    },
                    "c": {
                        "type": "integer",
                        "computed": True,
                        "expression": "a + 1",
                    },
                },
            )

    @pytest.mark.parametrize("scope", ["system", "regression", "suite", "test"])
    @pytest.mark.parametrize(
        "b_entry",
        [
            pytest.param({"type": "integer", "isExpression": True, "value": "a + 1"}, id="expr"),
            pytest.param({"type": "string", "isTemplate": True, "value": "{{ a }}"}, id="template"),
        ],
    )
    def test_set_rejects_a_cycle_through_the_test_variable_form(
        self, scope: str, b_entry: dict[str, Any]
    ) -> None:
        """A loop written in the form a Test variable is saved in (``isExpression`` or
        ``isTemplate`` with ``value``) is refused like one in the ``computed`` form."""
        entity_id = variable_service.SYSTEM_ENTITY_ID if scope == "system" else str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=r"^Circular reference detected for variable 'a': a -> b -> a$",
        ):
            variable_service.set_entity_variables(
                scope,
                entity_id,
                {
                    "a": {"type": "integer", "computed": True, "expression": "b + 1"},
                    "b": b_entry,
                },
            )

    def test_set_accepts_a_bare_value_beside_computed_variables(self) -> None:
        """A bare value declares no source, so the loop check passes over it."""
        entity_id = str(uuid.uuid4())

        result = variable_service.set_entity_variables(
            "test",
            entity_id,
            {"plain": 5, "a": {"type": "integer", "computed": True, "expression": "plain + 1"}},
        )

        assert "plain" in result["variables"]

    def test_set_refuses_a_variable_that_is_both_expression_and_template(self) -> None:
        with pytest.raises(
            ValidationException, match=r"^is_expression and is_template are mutually exclusive$"
        ):
            variable_service.set_entity_variables(
                "test",
                str(uuid.uuid4()),
                {"a": {"type": "string", "isExpression": True, "isTemplate": True, "value": "x"}},
            )

    def test_set_does_not_persist_when_cycle_detected(self) -> None:
        """A cycle-rejected payload must not write through to storage (no partial state).

        After a rejected save, get_entity_variables must reflect the prior state.
        """
        entity_id = str(uuid.uuid4())
        # Establish a known good state.
        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"keep": {"type": "integer", "value": 1}},
        )

        # Attempt to overwrite with a cyclic payload.
        with pytest.raises(ValidationException):
            variable_service.set_entity_variables(
                "test",
                entity_id,
                {
                    "a": {
                        "type": "integer",
                        "computed": True,
                        "expression": "a + 1",
                    },
                },
            )

        # Existing variable must still be present; cyclic variable must NOT be.
        result = variable_service.get_entity_variables("test", entity_id)
        assert result is not None
        assert "keep" in result["variables"]
        assert "a" not in result["variables"]

    def test_set_accepts_acyclic_computed_variables(self) -> None:
        """Non-cyclic computed graphs (a -> b, b literal) must still be accepted."""
        entity_id = str(uuid.uuid4())

        result = variable_service.set_entity_variables(
            "test",
            entity_id,
            {
                "b": {"type": "integer", "value": 1},
                "a": {
                    "type": "integer",
                    "computed": True,
                    "expression": "b + 1",
                },
            },
        )

        assert result is not None
        assert "a" in result["variables"]
        assert "b" in result["variables"]

    def test_set_accepts_diamond_dependency(self) -> None:
        """Diamond (a -> b, a -> c, b -> d, c -> d) is acyclic and must pass.

        Verifies the validator does not over-trigger on shared dependencies.
        """
        entity_id = str(uuid.uuid4())

        result = variable_service.set_entity_variables(
            "test",
            entity_id,
            {
                "d": {"type": "integer", "value": 1},
                "b": {
                    "type": "integer",
                    "computed": True,
                    "expression": "d + 1",
                },
                "c": {
                    "type": "integer",
                    "computed": True,
                    "expression": "d + 2",
                },
                "a": {
                    "type": "integer",
                    "computed": True,
                    "expression": "b + c",
                },
            },
        )

        assert result is not None
        assert {"a", "b", "c", "d"} <= set(result["variables"].keys())


class TestUpdateEntityVariablesCycleDetection:
    """Cycle detection on update_entity_variables (merge semantics).

    The merge path must validate the post-merge state, not just the patch:
    introducing a cycle by patching one half of an a/b pair must be caught.
    """

    def setup_method(self) -> None:
        _reset_storage()

    @pytest.mark.parametrize("scope", ["system", "regression", "suite", "test"])
    def test_update_rejects_direct_self_reference(self, scope: str) -> None:
        """A patch that introduces a self-reference is rejected."""
        entity_id = variable_service.SYSTEM_ENTITY_ID if scope == "system" else str(uuid.uuid4())

        # Seed a non-cyclic state first.
        variable_service.set_entity_variables(
            scope,
            entity_id,
            {"a": {"type": "integer", "value": 0}},
        )

        with pytest.raises(
            ValidationException,
            match=r"^Circular reference detected for variable 'a': a -> a$",
        ):
            variable_service.update_entity_variables(
                scope,
                entity_id,
                {
                    "a": {
                        "type": "integer",
                        "computed": True,
                        "expression": "a + 1",
                    },
                },
            )

    @pytest.mark.parametrize("scope", ["system", "regression", "suite", "test"])
    def test_update_rejects_cycle_introduced_via_merge(self, scope: str) -> None:
        """Patching one half of a pair to close a cycle (b refs a, then a refs b) is rejected."""
        entity_id = variable_service.SYSTEM_ENTITY_ID if scope == "system" else str(uuid.uuid4())

        # Seed: b is computed from a, a is a literal. No cycle.
        variable_service.set_entity_variables(
            scope,
            entity_id,
            {
                "a": {"type": "integer", "value": 1},
                "b": {
                    "type": "integer",
                    "computed": True,
                    "expression": "a + 1",
                },
            },
        )

        # Patch a to reference b, closing the cycle a -> b -> a.
        with pytest.raises(
            ValidationException,
            match=r"^Circular reference detected for variable 'a': a -> b -> a$",
        ):
            variable_service.update_entity_variables(
                scope,
                entity_id,
                {
                    "a": {
                        "type": "integer",
                        "computed": True,
                        "expression": "b + 1",
                    },
                },
            )

    @pytest.mark.parametrize("scope", ["system", "regression", "suite", "test"])
    def test_update_rejects_three_variable_cycle_introduced_via_merge(self, scope: str) -> None:
        """Closing a 3-node cycle a -> b -> c -> a via update is rejected."""
        entity_id = variable_service.SYSTEM_ENTITY_ID if scope == "system" else str(uuid.uuid4())

        # Seed an acyclic chain c (literal), b -> c, a -> b.
        variable_service.set_entity_variables(
            scope,
            entity_id,
            {
                "c": {"type": "integer", "value": 1},
                "b": {
                    "type": "integer",
                    "computed": True,
                    "expression": "c + 1",
                },
                "a": {
                    "type": "integer",
                    "computed": True,
                    "expression": "b + 1",
                },
            },
        )

        # Patch c to reference a, closing the 3-cycle a -> b -> c -> a.
        with pytest.raises(
            ValidationException,
            match=r"^Circular reference detected for variable 'a': a -> b -> c -> a$",
        ):
            variable_service.update_entity_variables(
                scope,
                entity_id,
                {
                    "c": {
                        "type": "integer",
                        "computed": True,
                        "expression": "a + 1",
                    },
                },
            )

    def test_update_does_not_persist_when_cycle_detected(self) -> None:
        """A rejected merge must leave the prior state untouched."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {
                "a": {"type": "integer", "value": 1},
                "b": {
                    "type": "integer",
                    "computed": True,
                    "expression": "a + 1",
                },
            },
        )

        with pytest.raises(ValidationException):
            variable_service.update_entity_variables(
                "test",
                entity_id,
                {
                    "a": {
                        "type": "integer",
                        "computed": True,
                        "expression": "b + 1",
                    },
                },
            )

        # a must still be the literal; b must still reference a.
        result = variable_service.get_entity_variables("test", entity_id)
        assert result is not None
        assert result["variables"]["a"].get("value") == 1
        assert result["variables"]["a"].get("computed") is not True
        assert result["variables"]["b"].get("expression") == "a + 1"

    def test_update_accepts_non_cyclic_patch(self) -> None:
        """A patch that adds an acyclic computed variable must be accepted."""
        entity_id = str(uuid.uuid4())

        variable_service.set_entity_variables(
            "test",
            entity_id,
            {"x": {"type": "integer", "value": 1}},
        )

        result = variable_service.update_entity_variables(
            "test",
            entity_id,
            {
                "y": {
                    "type": "integer",
                    "computed": True,
                    "expression": "x + 1",
                },
            },
        )

        assert result is not None
        assert "x" in result["variables"]
        assert "y" in result["variables"]


class TestDecimalExpressionEvaluation:
    """Design-time expression math on float variables stays exact and renders
    as a plain decimal string typed "float" (REQ-3.1.3.14)."""

    def setup_method(self) -> None:
        _reset_storage()

    def test_determine_result_type_decimal_is_plain_string_float(self) -> None:
        value, result_type = variable_service._determine_result_type(Decimal("1.5"))
        assert value == "1.5"
        assert result_type == "float"

    def test_determine_result_type_decimal_avoids_exponent(self) -> None:
        value, result_type = variable_service._determine_result_type(Decimal("1E+3"))
        assert value == "1000"
        assert result_type == "float"

    def test_evaluate_float_expression_is_exact_plain_string(self) -> None:
        result = variable_service.evaluate_expression(
            "price * 1.08",
            context={"variables": {"price": {"type": "float", "value": "19.99"}}},
        )
        assert result["result"] == "21.5892"
        assert result["type"] == "float"


class TestSystemVariablesRawAccessor:
    """Raw system-variable accessor for engine injection."""

    def setup_method(self) -> None:
        _reset_storage()

    @staticmethod
    def _seed() -> None:
        variable_service.set_system_variables(
            {
                "api_token": {
                    "type": "string",
                    "value": "sys-s3cr3t-t0ken",
                    "secret": True,
                },
                "region": {"type": "string", "value": "us-west-2"},
            }
        )

    def test_raw_accessor_returns_real_secret_values(self) -> None:
        """Engine injection receives the sealed stored value, never the placeholder."""
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        self._seed()

        raw = variable_service.get_system_variables_raw()

        assert is_secret_envelope(raw["variables"]["api_token"]["value"])
        assert unseal_all(raw["variables"]["api_token"]["value"]) == "sys-s3cr3t-t0ken"

    def test_raw_accessor_keeps_the_secret_flag(self) -> None:
        """The injection site needs the flag to register the value for the run."""
        self._seed()

        raw = variable_service.get_system_variables_raw()

        assert raw["variables"]["api_token"]["secret"] is True

    def test_raw_accessor_does_not_mark_entries_masked(self) -> None:
        self._seed()

        raw = variable_service.get_system_variables_raw()

        assert raw["variables"]["api_token"].get("masked") is not True

    def test_raw_accessor_returns_non_secret_values_unchanged(self) -> None:
        self._seed()

        raw = variable_service.get_system_variables_raw()

        assert raw["variables"]["region"]["value"] == "us-west-2"

    def test_masked_getter_still_masks_the_same_variable(self) -> None:
        """The API-facing read stays masked; only engine injection reads raw."""
        self._seed()

        masked = variable_service.get_system_variables()

        assert masked["variables"]["api_token"]["value"] == "********"
        assert masked["variables"]["api_token"]["masked"] is True

    def test_raw_accessor_with_no_system_variables_returns_empty(self) -> None:
        raw = variable_service.get_system_variables_raw()

        assert raw == {"variables": {}}
