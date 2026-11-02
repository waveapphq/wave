"""
Tests for AssertControl.

Tests metadata, validation, and execution behavior of the Assert control.
Covers single/split modes, logging, variable passthrough, and error propagation.
"""

import asyncio
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from wavecore.controls.conditional import AssertControl
from wavecore.models.enums import ControlId

# =============================================================================
# Metadata Tests
# =============================================================================


class TestAssertControlMetadata:
    """Test Assert control metadata declaration."""

    def test_metadata_has_correct_id(self):
        """Verify Assert control has id=ASSERT."""
        control = AssertControl()
        assert control.metadata["id"] == ControlId.ASSERT

    def test_metadata_has_correct_version(self):
        """Verify Assert control version is 1.0.0."""
        control = AssertControl()
        assert control.metadata["version"] == "1.0.0"

    def test_metadata_has_correct_name(self):
        """Verify Assert control name is 'Assert'."""
        control = AssertControl()
        assert control.metadata["name"] == "Assert"

    def test_metadata_has_correct_category(self):
        """Verify Assert control category is 'conditional'."""
        control = AssertControl()
        assert control.metadata["category"] == "conditional"

    def test_metadata_has_assertions_parameter(self):
        """Verify Assert control has assertions parameter (array, required)."""
        control = AssertControl()
        params = control.metadata["parameter_schema"]
        assertions_param = next(p for p in params if p.name == "assertions")
        assert assertions_param.type == "array"
        assert assertions_param.required is True

    def test_metadata_has_mode_parameter(self):
        """Verify Assert control has mode parameter (string, optional, default=split)."""
        control = AssertControl()
        params = control.metadata["parameter_schema"]
        mode_param = next(p for p in params if p.name == "mode")
        assert mode_param.type == "string"
        assert mode_param.required is False
        assert mode_param.default == "split"
        assert mode_param.enum_values == ["single", "split"]

    def test_metadata_has_fail_current_scope_parameter(self):
        """Verify Assert control has fail_current_scope parameter (boolean, optional,
        default=False).
        """
        control = AssertControl()
        params = control.metadata["parameter_schema"]
        fail_current_scope_param = next(p for p in params if p.name == "fail_current_scope")
        assert fail_current_scope_param.type == "boolean"
        assert fail_current_scope_param.required is False
        assert fail_current_scope_param.default is False

    def test_fail_current_scope_description_names_both_modes(self):
        """The description says what the setting does in single and in split mode."""
        params = AssertControl().metadata["parameter_schema"]
        fail_current_scope_param = next(p for p in params if p.name == "fail_current_scope")
        assert fail_current_scope_param.description == (
            "When true, a failed assertion in single mode fails the block and stops the flow; "
            "in split mode the flow continues down the fail branch and the Test or Function it "
            "runs in ends failed"
        )

    def test_metadata_has_no_root_operator_parameter(self):
        """Verify Assert control has no root_operator parameter."""
        control = AssertControl()
        params = control.metadata["parameter_schema"]
        param_names = [p.name for p in params]
        assert "root_operator" not in param_names

    def test_metadata_has_passed_output(self):
        """Verify Assert control has 'passed' boolean output."""
        control = AssertControl()
        output_schema = control.metadata["output_schema"]
        assert len(output_schema) == 1
        assert output_schema[0]["name"] == "passed"
        assert output_schema[0]["type"] == "boolean"

    def test_metadata_has_branching_structure_hints(self):
        """Verify Assert control has branching structure hints with pass/fail branches."""
        control = AssertControl()
        hints = control.metadata["structure_hints"]
        assert hints["type"] == "branching"
        assert hints["branches"] == ["pass", "fail"]


# =============================================================================
# Validation Tests
# =============================================================================


class TestAssertControlValidation:
    """Test Assert control parameter validation."""

    def test_validate_rejects_missing_assertions(self):
        """Verify validation fails when assertions parameter is missing."""
        control = AssertControl()
        with pytest.raises(ValueError, match="^assertions parameter is required$"):
            asyncio.run(control.validate({}))

    def test_validate_rejects_non_list_assertions(self):
        """Verify validation fails when assertions is not a list."""
        control = AssertControl()
        with pytest.raises(ValueError, match="^assertions must be a list$"):
            asyncio.run(control.validate({"assertions": "not a list"}))

    def test_validate_rejects_empty_assertions(self):
        """Verify validation fails when assertions is an empty list."""
        control = AssertControl()
        with pytest.raises(ValueError, match="^assertions must not be empty$"):
            asyncio.run(control.validate({"assertions": []}))

    def test_validate_rejects_invalid_mode(self):
        """Verify validation fails for invalid mode value."""
        control = AssertControl()
        assertions = [{"type": "literal", "variable": "x", "operator": "equals"}]
        with pytest.raises(
            ValueError,
            match=r"^Invalid mode: 'invalid'\. Must be 'single' or 'split'$",
        ):
            asyncio.run(control.validate({"assertions": assertions, "mode": "invalid"}))

    def test_validate_accepts_valid_params_single_mode(self):
        """Verify validation passes with valid params and single mode."""
        control = AssertControl()
        assertions = [{"type": "literal", "variable": "x", "operator": "equals"}]
        asyncio.run(control.validate({"assertions": assertions, "mode": "single"}))

    def test_validate_accepts_valid_params_split_mode(self):
        """Verify validation passes with valid params and split mode."""
        control = AssertControl()
        assertions = [{"type": "literal", "variable": "x", "operator": "equals"}]
        asyncio.run(control.validate({"assertions": assertions, "mode": "split"}))

    def test_validate_accepts_default_mode(self):
        """Verify validation passes when mode is omitted (defaults to split)."""
        control = AssertControl()
        assertions = [{"type": "literal", "variable": "x", "operator": "equals"}]
        asyncio.run(control.validate({"assertions": assertions}))

    def test_validate_rejects_dict_assertions(self):
        """Verify validation rejects dict as assertions."""
        control = AssertControl()
        with pytest.raises(ValueError, match="^assertions must be a list$"):
            asyncio.run(control.validate({"assertions": {"a": 1}}))

    def test_validate_rejects_integer_assertions(self):
        """Verify validation rejects integer as assertions."""
        control = AssertControl()
        with pytest.raises(ValueError, match="^assertions must be a list$"):
            asyncio.run(control.validate({"assertions": 42}))


# =============================================================================
# Execution Tests - Single Mode
# =============================================================================


class TestAssertControlExecutionSingleMode:
    """Test Assert control execution in single mode (no branching)."""

    def test_all_pass_returns_passed_true(self):
        """Verify returns passed=True with no __branch when all assertions pass."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": True}
        assert "__branch" not in result

    def test_some_fail_returns_passed_false(self):
        """Verify returns passed=False with no __branch when assertions fail."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": False}
        assert "__branch" not in result

    def test_default_mode_is_split(self):
        """Verify mode defaults to split when not specified: a pass takes the pass handle."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
        ]
        context = {
            "parameters": {"assertions": assertions},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": True, "__branch": "pass"}

    def test_default_mode_sends_a_failure_down_the_fail_handle(self):
        """With mode not specified, a failed assertion takes the fail handle (split)."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {"assertions": assertions},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": False, "__branch": "fail"}

    def test_logs_info_on_pass(self):
        """Verify logger.info is called when all assertions pass."""
        control = AssertControl()
        logger = MagicMock()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 10},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.info.assert_called_once_with("All assertions passed")

    def test_logs_warn_on_failure_with_literal_details(self):
        """Verify logger.warn is called with failure details and actual value."""
        control = AssertControl()
        logger = MagicMock()
        assertions = [
            {
                "type": "literal",
                "variable": "status",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 200,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"status": 500},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        warn_calls = logger.warn.call_args_list
        assert len(warn_calls) == 3  # summary + failed detail + actual value
        assert "1 of 1 assertions failed" in str(warn_calls[0])
        assert "status" in str(warn_calls[1])
        assert "actual: 500" in str(warn_calls[2])

    def test_summary_counts_declared_assertions_not_evaluated_ones(self):
        """The denominator is what the author wrote, despite AND short-circuit."""
        control = AssertControl()
        logger = MagicMock()
        assertions = [
            {"type": "expression", "expression": "x > 100"},
            {"type": "operator", "value": "and"},
            {"type": "expression", "expression": "x < 200"},
            {"type": "operator", "value": "and"},
            {"type": "expression", "expression": "x != 0"},
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 5},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        warn_calls = logger.warn.call_args_list
        # The first condition fails, so only it is evaluated - but the summary
        # names all three the author declared.
        assert "1 of 3 assertions failed" in str(warn_calls[0])
        assert "Expression: x > 100" in str(warn_calls[1])

    def test_summary_counts_group_items_as_one_declared_assertion(self):
        """A group is one declared assertion, whatever it nests."""
        control = AssertControl()
        logger = MagicMock()
        assertions = [
            {
                "type": "group",
                "items": [
                    {"type": "expression", "expression": "x > 100"},
                    {"type": "operator", "value": "or"},
                    {"type": "expression", "expression": "x > 200"},
                ],
            },
            {"type": "operator", "value": "and"},
            {"type": "expression", "expression": "x != 0"},
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 5},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        assert "of 2 assertions failed" in str(logger.warn.call_args_list[0])

    def test_logs_warn_on_failure_with_expression_details(self):
        """Verify logger.warn is called with expression details on failure."""
        control = AssertControl()
        logger = MagicMock()
        assertions = [
            {
                "type": "expression",
                "expression": "x > 100",
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 5},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        warn_calls = logger.warn.call_args_list
        assert len(warn_calls) >= 2  # summary + expression detail
        assert "1 of 1 assertions failed" in str(warn_calls[0])
        assert "Expression: x > 100" in str(warn_calls[1])

    def test_logs_actual_value_truncated_for_large_strings(self):
        """Verify actual value is truncated when repr exceeds 1000 chars."""
        control = AssertControl()
        logger = MagicMock()
        large_string = "A" * 2000
        assertions = [
            {
                "type": "literal",
                "variable": "big",
                "value_type": "string",
                "operator": "equals",
                "reference_value": "small",
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"big": large_string},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        warn_calls = logger.warn.call_args_list
        # Find the actual value log line
        actual_call = str(warn_calls[2])
        assert " ... " in actual_call
        # Should not contain the full 2000-char string
        assert "A" * 600 not in actual_call

    def test_a_null_value_passes_not_equals(self):
        """A null value holds nothing, so it is not equal to 'done' (REQ-3.1.3.25)."""
        logger = MagicMock()
        context = {
            "parameters": {
                "assertions": [_null_status_check("not_equals", "done")],
                "mode": "single",
            },
            "variables": {"status": None},
            "logger": logger,
        }

        result = asyncio.run(AssertControl().execute(context))

        assert result == {"passed": True}
        logger.info.assert_called_once_with("All assertions passed")

    def test_a_null_value_fails_equals_with_a_failure_line_and_no_raise(self):
        logger = MagicMock()
        context = {
            "parameters": {"assertions": [_null_status_check("equals", "done")], "mode": "single"},
            "variables": {"status": None},
            "logger": logger,
        }

        result = asyncio.run(AssertControl().execute(context))

        assert result == {"passed": False}
        assert [call.args[0] for call in logger.warn.call_args_list] == [
            "Assertion failed: 1 of 1 assertions failed",
            "  - status (string) equals 'done'",
            "    actual: null",
        ]


_STATUS_CHECK = {
    "type": "literal",
    "variable": "status",
    "value_type": "integer",
    "operator": "equals",
    "reference_value": 200,
}
_SUMMARY = "Assertion failed: 1 of 1 assertions failed"
_CHECK_LINE = "  - status (integer) equals 200"


def _null_status_check(
    operator: str, reference_value: Any = None, value_type: str = "string"
) -> dict[str, Any]:
    """A literal check on ``status``, the variable the null tests hold as null."""
    return {
        "type": "literal",
        "variable": "status",
        "value_type": value_type,
        "operator": operator,
        "reference_value": reference_value,
        "reference_is_expression": False,
    }


def _check_failure_lines(check: dict[str, Any], **detail: Any) -> list[str]:
    """The warn lines of an Assert whose one given check failed with the given detail."""
    from wavecore.controls.assertion_evaluator import AssertionResult

    result = AssertionResult(
        passed=False, details=[{"assertion": check, "passed": False, **detail}]
    )
    logger = MagicMock()
    with patch("wavecore.controls.conditional.evaluate_assertions", return_value=result):
        asyncio.run(
            AssertControl().execute(
                {"parameters": {"assertions": [check]}, "variables": {}, "logger": logger}
            )
        )
    return [call.args[0] for call in logger.warn.call_args_list]


def _failure_lines(**detail: Any) -> list[str]:
    """The warn lines of an Assert whose one check failed with the given detail."""
    from wavecore.controls.assertion_evaluator import AssertionResult

    result = AssertionResult(
        passed=False, details=[{"assertion": _STATUS_CHECK, "passed": False, **detail}]
    )
    logger = MagicMock()
    with patch("wavecore.controls.conditional.evaluate_assertions", return_value=result):
        asyncio.run(
            AssertControl().execute(
                {"parameters": {"assertions": [_STATUS_CHECK]}, "variables": {}, "logger": logger}
            )
        )
    return [call.args[0] for call in logger.warn.call_args_list]


class TestAssertFailureDetailActualLine:
    """The ``actual:`` line of a failed check quotes a string and prints every other
    value in WAVE's print form (REQ-3.1.3.23)."""

    def test_a_null_actual_prints_null(self):
        assert _failure_lines(actual_value=None) == [_SUMMARY, _CHECK_LINE, "    actual: null"]

    def test_no_actual_line_when_no_actual_was_captured(self):
        assert _failure_lines() == [_SUMMARY, _CHECK_LINE]

    def test_a_string_actual_stays_quoted(self):
        assert _failure_lines(actual_value="hello") == [
            _SUMMARY,
            _CHECK_LINE,
            "    actual: 'hello'",
        ]

    def test_a_long_string_actual_is_quoted_and_truncated(self):
        lines = _failure_lines(actual_value="A" * 2000)

        assert lines[-1] == "    actual: '" + "A" * 499 + " ... " + "A" * 499 + "'"

    @pytest.mark.parametrize(
        ("actual", "text"),
        [
            (True, "true"),
            (False, "false"),
            (500, "500"),
            (Decimal("1.50"), "1.50"),
            ([1, None, "x"], '[1,null,"x"]'),
            ({"code": None, "ok": True}, '{"code":null,"ok":true}'),
        ],
    )
    def test_any_other_actual_prints_the_print_form(self, actual: Any, text: str):
        assert _failure_lines(actual_value=actual) == [_SUMMARY, _CHECK_LINE, f"    actual: {text}"]

    def test_a_long_actual_is_truncated_the_same_way(self):
        text = "[" + ",".join(["1"] * 600) + "]"

        lines = _failure_lines(actual_value=[1] * 600)

        assert lines[-1] == f"    actual: {text[:500]} ... {text[-500:]}"

    def test_a_failed_array_check_prints_its_actual_list_as_json(self):
        logger = MagicMock()
        check = {
            "type": "literal",
            "variable": "codes",
            "value_type": "array",
            "operator": "contains",
            "reference_value": 5,
        }

        asyncio.run(
            AssertControl().execute(
                {
                    "parameters": {"assertions": [check]},
                    "variables": {"codes": [1, None]},
                    "logger": logger,
                }
            )
        )

        assert logger.warn.call_args_list[-1].args[0] == "    actual: [1,null]"

    @pytest.mark.parametrize(
        ("value_type", "operator"),
        [
            ("string", "is_null"),
            ("string", "is_not_null"),
            ("boolean", "is_true"),
            ("boolean", "is_false"),
            ("array", "is_empty"),
            ("map", "is_not_empty"),
        ],
    )
    def test_a_unary_row_prints_no_compare_to_value(self, value_type: str, operator: str):
        check = _null_status_check(operator, value_type=value_type)

        lines = _check_failure_lines(check, actual_value=None)

        assert lines == [_SUMMARY, f"  - status ({value_type}) {operator}", "    actual: null"]
        assert not [line for line in lines if "None" in line]

    def test_a_failed_not_null_check_on_a_null_value_prints_null(self):
        logger = MagicMock()

        asyncio.run(
            AssertControl().execute(
                {
                    "parameters": {"assertions": [_null_status_check("is_not_null")]},
                    "variables": {"status": None},
                    "logger": logger,
                }
            )
        )

        lines = [call.args[0] for call in logger.warn.call_args_list]
        assert lines == [_SUMMARY, "  - status (string) is_not_null", "    actual: null"]
        assert not [line for line in lines if "None" in line]

    def test_a_failed_untyped_null_check_logs_its_row_without_a_type(self):
        logger = MagicMock()
        check = _null_status_check("is_null")
        check["variable"] = "tok"
        del check["value_type"]

        output = asyncio.run(
            AssertControl().execute(
                {
                    "parameters": {"assertions": [check]},
                    "variables": {"tok": "abc"},
                    "logger": logger,
                }
            )
        )

        lines = [call.args[0] for call in logger.warn.call_args_list]
        assert output["passed"] is False
        assert lines[:2] == [_SUMMARY, "  - tok is_null"]


# =============================================================================
# Execution Tests - Split Mode
# =============================================================================


class TestAssertControlExecutionSplitMode:
    """Test Assert control execution in split mode (branching)."""

    def test_all_pass_returns_branch_pass(self):
        """Verify returns __branch=pass when all assertions pass in split mode."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "split"},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": True, "__branch": "pass"}

    def test_some_fail_returns_branch_fail(self):
        """Verify returns __branch=fail when assertions fail in split mode."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "split"},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": False, "__branch": "fail"}

    def test_a_null_value_routes_fail_without_raising(self):
        context = {
            "parameters": {
                "assertions": [_null_status_check("equals", "done")],
                "mode": "split",
            },
            "variables": {"status": None},
        }

        result = asyncio.run(AssertControl().execute(context))

        assert result == {"passed": False, "__branch": "fail"}


# =============================================================================
# Execution Tests - fail_current_scope Parameter
# =============================================================================


class TestAssertControlFailTest:
    """Test Assert control fail_current_scope parameter behavior."""

    def test_single_mode_failure_without_fail_current_scope_no_test_failed_key(self):
        """Verify no __scope_failed in result when fail_current_scope is not set (default)."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": False}
        assert "__scope_failed" not in result

    def test_single_mode_failure_with_fail_current_scope_true(self):
        """Verify a single-mode failure with fail_current_scope=True fails the block."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {
                "assertions": assertions,
                "mode": "single",
                "fail_current_scope": True,
            },
            "variables": {"x": 10},
        }
        with pytest.raises(AssertionError, match=r"^Assertion failed: 1 of 1 assertions failed$"):
            asyncio.run(control.execute(context))

    def test_split_mode_failure_with_fail_current_scope_true(self):
        """Verify both __scope_failed and __branch in result when fail_current_scope=True in split
        mode.
        """
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {
                "assertions": assertions,
                "mode": "split",
                "fail_current_scope": True,
            },
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result["passed"] is False
        assert result["__scope_failed"] is True
        assert result["__branch"] == "fail"

    def test_passing_assertions_with_fail_current_scope_true_no_test_failed_key(self):
        """Verify no __scope_failed key when assertions pass even with fail_current_scope=True."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
        ]
        context = {
            "parameters": {
                "assertions": assertions,
                "mode": "single",
                "fail_current_scope": True,
            },
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": True}
        assert "__scope_failed" not in result

    def test_fail_current_scope_true_uses_logger_error(self):
        """Verify fail_current_scope=True uses logger.error() for failure details."""
        control = AssertControl()
        logger = MagicMock()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {
                "assertions": assertions,
                "mode": "single",
                "fail_current_scope": True,
            },
            "variables": {"x": 10},
            "logger": logger,
        }
        with pytest.raises(AssertionError):
            asyncio.run(control.execute(context))
        # Should use error, not warn, before the block fails
        assert logger.error.call_count >= 1
        assert logger.warn.call_count == 0

    def test_fail_current_scope_false_uses_logger_warn(self):
        """Verify fail_current_scope=False (default) uses logger.warn() for failure details."""
        control = AssertControl()
        logger = MagicMock()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {
                "assertions": assertions,
                "mode": "single",
                "fail_current_scope": False,
            },
            "variables": {"x": 10},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        # Should use warn, not error
        assert logger.warn.call_count >= 1
        assert logger.error.call_count == 0

    def test_fail_current_scope_default_is_false(self):
        """Verify fail_current_scope defaults to False when omitted from params."""
        control = AssertControl()
        logger = MagicMock()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 10},
            "logger": logger,
        }
        result = asyncio.run(control.execute(context))
        assert "__scope_failed" not in result
        assert logger.warn.call_count >= 1
        assert logger.error.call_count == 0


# =============================================================================
# Execution Tests - Variables
# =============================================================================


class TestAssertControlVariablePassthrough:
    """Test Assert control passes variables through to evaluator."""

    def test_variables_are_passed_to_evaluator(self):
        """Verify variables from context are passed through to evaluate_assertions."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "my_var",
                "value_type": "string",
                "operator": "equals",
                "reference_value": "hello",
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"my_var": "hello"},
        }
        result = asyncio.run(control.execute(context))
        assert result["passed"] is True

    def test_expression_uses_variables(self):
        """Verify expression assertions can reference variables."""
        control = AssertControl()
        assertions = [
            {
                "type": "expression",
                "expression": "a + b == 30",
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"a": 10, "b": 20},
        }
        result = asyncio.run(control.execute(context))
        assert result["passed"] is True

    def test_missing_variable_propagates_key_error(self):
        """Verify KeyError from missing variable propagates (not caught)."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "nonexistent",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {},
        }
        with pytest.raises(KeyError, match="nonexistent"):
            asyncio.run(control.execute(context))


# =============================================================================
# Execution Tests - Error Propagation
# =============================================================================


class TestAssertControlErrorPropagation:
    """Test Assert control propagates evaluator exceptions."""

    def test_evaluator_exception_propagates(self):
        """Verify exceptions from evaluate_assertions propagate through."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {},  # Missing variable -> KeyError
        }
        with pytest.raises(KeyError):
            asyncio.run(control.execute(context))

    def test_type_error_propagates(self):
        """Verify TypeError from type coercion propagates."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": "not_a_number"},
        }
        with pytest.raises(TypeError):
            asyncio.run(control.execute(context))

    def test_unknown_item_type_propagates(self):
        """Verify ValueError from unknown assertion item type propagates."""
        control = AssertControl()
        assertions = [
            {
                "type": "unknown_type",
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {},
        }
        with pytest.raises(ValueError, match="Unknown assertion item type"):
            asyncio.run(control.execute(context))


# =============================================================================
# Execution Tests - No Logger
# =============================================================================


class TestAssertControlNoLogger:
    """Test Assert control works without logger in context."""

    def test_execute_pass_without_logger(self):
        """Verify execution works when no logger is provided (pass case)."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": True}

    def test_execute_fail_without_logger(self):
        """Verify execution works when no logger is provided (fail case)."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {"assertions": assertions, "mode": "single"},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"passed": False}


# =============================================================================
# Execution Tests - Inline Operators
# =============================================================================


class TestAssertControlInlineOperators:
    """Test Assert control with inline interleaved operators."""

    def test_implicit_single_assertion_and(self):
        """Verify single assertion with AND semantics (default)."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
            {"type": "operator", "value": "and"},
            {
                "type": "literal",
                "variable": "y",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {"assertions": assertions},
            "variables": {"x": 10, "y": 20},
        }
        result = asyncio.run(control.execute(context))
        # AND mode: second fails -> overall fails
        assert result["passed"] is False

    def test_inline_or_operator_any_pass(self):
        """Verify inline OR operator passes when any assertion passes."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
            },
            {"type": "operator", "value": "or"},
            {
                "type": "literal",
                "variable": "y",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {"assertions": assertions},
            "variables": {"x": 10, "y": 20},
        }
        result = asyncio.run(control.execute(context))
        # OR: first passes -> overall passes
        assert result["passed"] is True

    def test_inline_or_operator_all_fail(self):
        """Verify inline OR operator fails when all assertions fail."""
        control = AssertControl()
        assertions = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
            {"type": "operator", "value": "or"},
            {
                "type": "literal",
                "variable": "y",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 99,
            },
        ]
        context = {
            "parameters": {"assertions": assertions},
            "variables": {"x": 10, "y": 20},
        }
        result = asyncio.run(control.execute(context))
        assert result["passed"] is False
