"""Tests for ContinueControl.

Covers metadata declaration, parameter validation, and execution signals.

REQ-3.5.1.3: Continue to next iteration
"""

import asyncio

import pytest

from wavecore.controls.loop import ContinueControl
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId


class TestContinueControlMetadata:
    """Verify control metadata declaration matches design spec."""

    def setup_method(self) -> None:
        self.control = ContinueControl()
        self.meta = self.control.metadata

    def test_control_id(self) -> None:
        assert self.meta["id"] == ControlId.CONTINUE

    def test_control_version(self) -> None:
        assert self.meta["version"] == "1.0.0"

    def test_control_name(self) -> None:
        assert self.meta["name"] == "Continue"

    def test_control_category(self) -> None:
        assert self.meta["category"] == "loop"

    def test_control_icon(self) -> None:
        assert self.meta["icon_name"] == "skip-forward"

    def test_control_description(self) -> None:
        assert isinstance(self.meta["description"], str)
        assert len(self.meta["description"]) > 0

    def test_parameter_schema_count(self) -> None:
        """Continue has exactly 1 parameter: target_loop."""
        assert len(self.meta["parameter_schema"]) == 1

    def test_parameter_target_loop(self) -> None:
        """target_loop: string, required, no default."""
        param = self.meta["parameter_schema"][0]
        assert isinstance(param, ControlParameter)
        assert param.name == "target_loop"
        assert param.type == "string"
        assert param.required is True
        assert param.default is None
        assert param.description is not None
        assert len(param.description) > 0

    def test_parameter_target_loop_description_says_block(self) -> None:
        description = self.meta["parameter_schema"][0].description

        assert description == "Block ID of the loop to continue to next iteration"

    def test_no_condition_parameter(self) -> None:
        """Continue must NOT have a condition parameter (pure signal control)."""
        param_names = [p.name for p in self.meta["parameter_schema"]]
        assert "condition" not in param_names

    def test_output_schema_empty(self) -> None:
        """Continue produces no output variables."""
        assert self.meta["output_schema"] == []

    def test_structure_hints_type(self) -> None:
        assert self.meta["structure_hints"]["type"] == "sequential"

    def test_structure_hints_loop_modifier(self) -> None:
        assert self.meta["structure_hints"]["loop_modifier"] is True


class TestContinueControlValidation:
    """Test parameter validation for ContinueControl."""

    def setup_method(self) -> None:
        self.control = ContinueControl()

    def test_validate_valid_target_loop(self) -> None:
        """Non-empty target_loop passes validation."""
        asyncio.run(self.control.validate({"target_loop": "for-each-node-789"}))

    def test_validate_missing_target_loop(self) -> None:
        """Missing target_loop fails validation."""
        with pytest.raises(ValueError, match="^target_loop is required$"):
            asyncio.run(self.control.validate({}))

    def test_validate_empty_string_target_loop(self) -> None:
        """Empty string target_loop fails validation."""
        with pytest.raises(ValueError, match="^target_loop must not be empty$"):
            asyncio.run(self.control.validate({"target_loop": ""}))

    def test_validate_whitespace_only_target_loop(self) -> None:
        """Whitespace-only target_loop fails validation."""
        with pytest.raises(ValueError, match="^target_loop must not be empty$"):
            asyncio.run(self.control.validate({"target_loop": "   "}))


class TestContinueControlExecution:
    """Test execute() return signals for ContinueControl."""

    def setup_method(self) -> None:
        self.control = ContinueControl()

    def test_execute_returns_continue_signal(self) -> None:
        """Execute returns __continue=True with __continue_target from target_loop."""
        context: dict = {
            "parameters": {"target_loop": "for-each-node-789"},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__continue"] is True
        assert result["__continue_target"] == "for-each-node-789"

    def test_execute_target_flows_through(self) -> None:
        """target_loop value from parameters flows through to __continue_target."""
        context: dict = {
            "parameters": {"target_loop": "while-inner-321"},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__continue_target"] == "while-inner-321"

    def test_execute_result_has_exactly_two_keys(self) -> None:
        """Execute result contains only __continue and __continue_target."""
        context: dict = {
            "parameters": {"target_loop": "loop-1"},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert set(result.keys()) == {"__continue", "__continue_target"}
