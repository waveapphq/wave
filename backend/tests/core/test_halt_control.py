"""
Tests for HaltControl.

Tests metadata, validation, and execution behavior of the Halt control.
Covers scope/status/message parameters, logging by status level,
result dict shape, defaults, and graceful behavior without a logger.
"""

import asyncio
from unittest.mock import MagicMock

import pytest

from wavecore.controls.flow import HaltControl
from wavecore.models.enums import ControlId

# =============================================================================
# Metadata Tests
# =============================================================================


class TestHaltControlMetadata:
    """Test Halt control metadata declaration."""

    def test_metadata_has_correct_id(self) -> None:
        """Verify Halt control has id=HALT."""
        control = HaltControl()
        assert control.metadata["id"] == ControlId.HALT

    def test_metadata_has_correct_version(self) -> None:
        """Verify Halt control version is 1.0.0."""
        control = HaltControl()
        assert control.metadata["version"] == "1.0.0"

    def test_metadata_has_correct_name(self) -> None:
        """Verify Halt control name is 'Halt'."""
        control = HaltControl()
        assert control.metadata["name"] == "Halt"

    def test_metadata_has_correct_category(self) -> None:
        """Verify Halt control category is 'flow'."""
        control = HaltControl()
        assert control.metadata["category"] == "flow"

    def test_metadata_has_scope_parameter(self) -> None:
        """Verify Halt control has scope parameter (string, optional, default=test)."""
        control = HaltControl()
        params = control.metadata["parameter_schema"]
        scope_param = next(p for p in params if p.name == "scope")
        assert scope_param.type == "string"
        assert scope_param.required is False
        assert scope_param.default == "test"

    def test_metadata_has_status_parameter(self) -> None:
        """Verify Halt control has status parameter (string, optional, default=failed)."""
        control = HaltControl()
        params = control.metadata["parameter_schema"]
        status_param = next(p for p in params if p.name == "status")
        assert status_param.type == "string"
        assert status_param.required is False
        assert status_param.default == "failed"

    def test_metadata_has_message_parameter(self) -> None:
        """Verify Halt control has message parameter (string, optional)."""
        control = HaltControl()
        params = control.metadata["parameter_schema"]
        message_param = next(p for p in params if p.name == "message")
        assert message_param.type == "string"
        assert message_param.required is False

    def test_metadata_has_exactly_three_parameters(self) -> None:
        """Verify Halt control has exactly scope, status, and message parameters."""
        control = HaltControl()
        params = control.metadata["parameter_schema"]
        param_names = [p.name for p in params]
        assert param_names == ["scope", "message", "status"]

    def test_metadata_has_empty_output_schema(self) -> None:
        """Verify Halt control has empty output schema (halt produces no outputs)."""
        control = HaltControl()
        assert control.metadata["output_schema"] == []

    def test_metadata_has_sequential_structure_hints(self) -> None:
        """Verify Halt control has sequential structure hints."""
        control = HaltControl()
        hints = control.metadata["structure_hints"]
        assert hints["type"] == "sequential"

    def test_metadata_has_terminating_true(self) -> None:
        """Verify Halt control structure_hints has terminating: True."""
        control = HaltControl()
        hints = control.metadata["structure_hints"]
        assert hints["terminating"] is True


# =============================================================================
# Validation Tests
# =============================================================================


class TestHaltControlValidation:
    """Test Halt control parameter validation."""

    def test_validate_accepts_scope_test(self) -> None:
        """Verify validation passes for scope=test."""
        control = HaltControl()
        asyncio.run(control.validate({"scope": "test"}))

    def test_validate_accepts_scope_suite(self) -> None:
        """Verify validation passes for scope=suite."""
        control = HaltControl()
        asyncio.run(control.validate({"scope": "suite"}))

    def test_validate_accepts_scope_regression(self) -> None:
        """Verify validation passes for scope=regression."""
        control = HaltControl()
        asyncio.run(control.validate({"scope": "regression"}))

    def test_validate_accepts_scope_function(self) -> None:
        """Verify validation passes for scope=function (REQ-3.5.1.14)."""
        control = HaltControl()
        asyncio.run(control.validate({"scope": "function"}))

    def test_validate_rejects_invalid_scope(self) -> None:
        """Verify validation fails for invalid scope value."""
        control = HaltControl()
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'scope' must be one of: test, suite, regression, function; Actual "
            r"value was '.*'\.$",
        ):
            asyncio.run(control.validate({"scope": "invalid"}))

    def test_validate_rejects_empty_string_scope(self) -> None:
        """Verify validation fails for empty string scope."""
        control = HaltControl()
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'scope' must be one of: test, suite, regression, function; Actual "
            r"value was '.*'\.$",
        ):
            asyncio.run(control.validate({"scope": ""}))

    def test_validate_accepts_status_passed(self) -> None:
        """Verify validation passes for status=passed."""
        control = HaltControl()
        asyncio.run(control.validate({"status": "passed"}))

    def test_validate_accepts_status_failed(self) -> None:
        """Verify validation passes for status=failed."""
        control = HaltControl()
        asyncio.run(control.validate({"status": "failed"}))

    def test_validate_accepts_status_skipped(self) -> None:
        """Verify validation passes for status=skipped."""
        control = HaltControl()
        asyncio.run(control.validate({"status": "skipped"}))

    def test_validate_rejects_invalid_status(self) -> None:
        """Verify validation fails for invalid status value."""
        control = HaltControl()
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'status' must be one of: passed, failed, skipped; Actual value was "
            r"'.*'\.$",
        ):
            asyncio.run(control.validate({"status": "error"}))

    def test_validate_rejects_empty_string_status(self) -> None:
        """Verify validation fails for empty string status."""
        control = HaltControl()
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'status' must be one of: passed, failed, skipped; Actual value was "
            r"'.*'\.$",
        ):
            asyncio.run(control.validate({"status": ""}))

    def test_validate_accepts_defaults_when_params_omitted(self) -> None:
        """Verify validation passes when all params omitted (defaults apply)."""
        control = HaltControl()
        asyncio.run(control.validate({}))

    def test_validate_accepts_all_valid_params_together(self) -> None:
        """Verify validation passes with all valid params specified."""
        control = HaltControl()
        asyncio.run(
            control.validate({"scope": "suite", "status": "skipped", "message": "not applicable"})
        )

    def test_validate_rejects_scope_with_case_mismatch(self) -> None:
        """Verify validation rejects uppercase scope values."""
        control = HaltControl()
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'scope' must be one of: test, suite, regression, function; Actual "
            r"value was '.*'\.$",
        ):
            asyncio.run(control.validate({"scope": "Test"}))

    def test_validate_rejects_status_with_case_mismatch(self) -> None:
        """Verify validation rejects uppercase status values."""
        control = HaltControl()
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'status' must be one of: passed, failed, skipped; Actual value was "
            r"'.*'\.$",
        ):
            asyncio.run(control.validate({"status": "Failed"}))


# =============================================================================
# Function Scope (REQ-3.5.1.14)
# =============================================================================


class TestHaltControlFunctionScope:
    """The scope enum gains 'function' and the scope description documents it."""

    def test_scope_enum_values_include_function_in_order(self) -> None:
        """scope enum_values are exactly [test, suite, regression, function].

        Order matters: ``validate_enum_param`` renders the rejection message
        from this list, so 'function' must append after 'regression'.
        """
        control = HaltControl()
        params = control.metadata["parameter_schema"]
        scope_param = next(p for p in params if p.name == "scope")
        assert scope_param.enum_values == ["test", "suite", "regression", "function"]

    def test_scope_param_description_mentions_function(self) -> None:
        """The scope parameter description documents the new 'function' scope."""
        control = HaltControl()
        params = control.metadata["parameter_schema"]
        scope_param = next(p for p in params if p.name == "scope")
        assert "function" in (scope_param.description or "")

    def test_execute_passes_function_scope_through_to_signal(self) -> None:
        """execute() emits __halt_scope='function' so the body walker can absorb it."""
        control = HaltControl()
        context = {
            "parameters": {"scope": "function", "status": "failed", "message": "abort"},
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result["__halt_scope"] == "function"
        assert result["__halt_status"] == "failed"
        assert result["__halt_message"] == "abort"


# =============================================================================
# Execution Tests
# =============================================================================


class TestHaltControlExecution:
    """Test Halt control execute() return values."""

    def test_halt_with_failed_status(self) -> None:
        """Verify halt returns correct dict for status=failed."""
        control = HaltControl()
        context = {
            "parameters": {
                "scope": "test",
                "status": "failed",
                "message": "env broken",
            },
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result == {
            "__halt": True,
            "__halt_scope": "test",
            "__halt_status": "failed",
            "__halt_message": "env broken",
        }

    def test_halt_with_passed_status(self) -> None:
        """Verify halt returns correct dict for status=passed."""
        control = HaltControl()
        context = {
            "parameters": {
                "scope": "suite",
                "status": "passed",
                "message": "preconditions verified",
            },
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result == {
            "__halt": True,
            "__halt_scope": "suite",
            "__halt_status": "passed",
            "__halt_message": "preconditions verified",
        }

    def test_halt_with_skipped_status(self) -> None:
        """Verify halt returns correct dict for status=skipped."""
        control = HaltControl()
        context = {
            "parameters": {
                "scope": "regression",
                "status": "skipped",
                "message": "not applicable",
            },
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result == {
            "__halt": True,
            "__halt_scope": "regression",
            "__halt_status": "skipped",
            "__halt_message": "not applicable",
        }

    def test_halt_defaults_scope_to_test(self) -> None:
        """Verify scope defaults to 'test' when omitted."""
        control = HaltControl()
        context = {
            "parameters": {"status": "failed"},
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result["__halt_scope"] == "test"

    def test_halt_defaults_status_to_failed(self) -> None:
        """Verify status defaults to 'failed' when omitted."""
        control = HaltControl()
        context = {
            "parameters": {"scope": "test"},
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result["__halt_status"] == "failed"

    def test_halt_defaults_message_to_none(self) -> None:
        """Verify message defaults to None when omitted."""
        control = HaltControl()
        context = {
            "parameters": {"scope": "test", "status": "failed"},
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result["__halt_message"] is None

    def test_halt_all_defaults_when_params_empty(self) -> None:
        """Verify all defaults applied when no params specified."""
        control = HaltControl()
        context = {
            "parameters": {},
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result == {
            "__halt": True,
            "__halt_scope": "test",
            "__halt_status": "failed",
            "__halt_message": None,
        }

    def test_halt_always_returns_halt_true(self) -> None:
        """Verify __halt is always True regardless of status."""
        control = HaltControl()
        for status in ("passed", "failed", "skipped"):
            context = {
                "parameters": {"status": status},
                "variables": {},
            }
            result = asyncio.run(control.execute(context))
            assert result["__halt"] is True

    def test_halt_result_has_exactly_four_keys(self) -> None:
        """Verify result dict contains exactly __halt, __halt_scope, __halt_status,
        __halt_message.
        """
        control = HaltControl()
        context = {
            "parameters": {
                "scope": "test",
                "status": "failed",
                "message": "reason",
            },
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert set(result.keys()) == {
            "__halt",
            "__halt_scope",
            "__halt_status",
            "__halt_message",
        }

    def test_halt_preserves_message_content(self) -> None:
        """Verify message is passed through exactly as provided."""
        control = HaltControl()
        message = "Complex message with special chars: <>&\"'"
        context = {
            "parameters": {
                "scope": "test",
                "status": "failed",
                "message": message,
            },
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result["__halt_message"] == message

    def test_halt_each_scope_value_in_result(self) -> None:
        """Verify each valid scope value appears correctly in the result."""
        control = HaltControl()
        for scope in ("test", "suite", "regression"):
            context = {
                "parameters": {"scope": scope, "status": "failed"},
                "variables": {},
            }
            result = asyncio.run(control.execute(context))
            assert result["__halt_scope"] == scope


# =============================================================================
# Logging Tests
# =============================================================================


class TestHaltControlLogging:
    """Test Halt control logging behavior by status."""

    def test_status_passed_logs_info(self) -> None:
        """Verify status=passed calls logger.info."""
        control = HaltControl()
        logger = MagicMock()
        context = {
            "parameters": {
                "scope": "test",
                "status": "passed",
                "message": "all good",
            },
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.info.assert_called_once()
        logger.error.assert_not_called()
        logger.warn.assert_not_called()

    def test_status_failed_logs_error(self) -> None:
        """Verify status=failed calls logger.error."""
        control = HaltControl()
        logger = MagicMock()
        context = {
            "parameters": {
                "scope": "test",
                "status": "failed",
                "message": "env broken",
            },
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.error.assert_called_once()
        logger.info.assert_not_called()
        logger.warn.assert_not_called()

    def test_status_skipped_logs_warn(self) -> None:
        """Verify status=skipped calls logger.warn."""
        control = HaltControl()
        logger = MagicMock()
        context = {
            "parameters": {
                "scope": "test",
                "status": "skipped",
                "message": "not applicable",
            },
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.warn.assert_called_once()
        logger.info.assert_not_called()
        logger.error.assert_not_called()

    def test_message_included_in_info_log(self) -> None:
        """Verify message text appears in the info log call."""
        control = HaltControl()
        logger = MagicMock()
        context = {
            "parameters": {
                "scope": "suite",
                "status": "passed",
                "message": "preconditions verified",
            },
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        log_message = logger.info.call_args[0][0]
        assert "preconditions verified" in log_message

    def test_message_included_in_error_log(self) -> None:
        """Verify message text appears in the error log call."""
        control = HaltControl()
        logger = MagicMock()
        context = {
            "parameters": {
                "scope": "test",
                "status": "failed",
                "message": "database unreachable",
            },
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        log_message = logger.error.call_args[0][0]
        assert "database unreachable" in log_message

    def test_message_included_in_warn_log(self) -> None:
        """Verify message text appears in the warn log call."""
        control = HaltControl()
        logger = MagicMock()
        context = {
            "parameters": {
                "scope": "regression",
                "status": "skipped",
                "message": "config not applicable",
            },
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        log_message = logger.warn.call_args[0][0]
        assert "config not applicable" in log_message

    def test_scope_included_in_log(self) -> None:
        """Verify scope appears in the log message."""
        control = HaltControl()
        logger = MagicMock()
        context = {
            "parameters": {
                "scope": "regression",
                "status": "failed",
                "message": "critical failure",
            },
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        log_message = logger.error.call_args[0][0]
        assert "regression" in log_message

    def test_log_without_message(self) -> None:
        """Verify logging works when message is omitted (None)."""
        control = HaltControl()
        logger = MagicMock()
        context = {
            "parameters": {"scope": "test", "status": "failed"},
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.error.assert_called_once()


# =============================================================================
# No Logger Tests
# =============================================================================


class TestHaltControlNoLogger:
    """Test Halt control works without logger in context."""

    def test_execute_without_logger_does_not_crash(self) -> None:
        """Verify execution works when no logger is provided."""
        control = HaltControl()
        context = {
            "parameters": {
                "scope": "test",
                "status": "failed",
                "message": "no logger",
            },
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result is not None

    def test_execute_without_logger_returns_correct_result(self) -> None:
        """Verify correct result dict when no logger is in context."""
        control = HaltControl()
        context = {
            "parameters": {
                "scope": "suite",
                "status": "passed",
                "message": "done",
            },
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result == {
            "__halt": True,
            "__halt_scope": "suite",
            "__halt_status": "passed",
            "__halt_message": "done",
        }

    def test_execute_without_logger_all_statuses(self) -> None:
        """Verify all three status values work without a logger."""
        control = HaltControl()
        for status in ("passed", "failed", "skipped"):
            context = {
                "parameters": {"scope": "test", "status": status},
                "variables": {},
            }
            result = asyncio.run(control.execute(context))
            assert result["__halt"] is True
            assert result["__halt_status"] == status

    def test_execute_without_logger_defaults(self) -> None:
        """Verify defaults work without a logger."""
        control = HaltControl()
        context = {
            "parameters": {},
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result == {
            "__halt": True,
            "__halt_scope": "test",
            "__halt_status": "failed",
            "__halt_message": None,
        }
