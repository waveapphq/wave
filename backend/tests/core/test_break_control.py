"""Tests for BreakControl.

Covers metadata declaration, parameter validation, and execution signals.

REQ-3.5.1.2: Break current block execution
"""

import asyncio

import pytest

from wavecore.controls.loop import BreakControl
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId


class TestBreakControlMetadata:
    """Verify control metadata declaration matches design spec."""

    def setup_method(self) -> None:
        self.control = BreakControl()
        self.meta = self.control.metadata

    def test_control_id(self) -> None:
        assert self.meta["id"] == ControlId.BREAK

    def test_control_version(self) -> None:
        assert self.meta["version"] == "1.0.0"

    def test_control_name(self) -> None:
        assert self.meta["name"] == "Break"

    def test_control_category(self) -> None:
        assert self.meta["category"] == "loop"

    def test_control_icon(self) -> None:
        assert self.meta["icon_name"] == "log-out"

    def test_control_description(self) -> None:
        assert isinstance(self.meta["description"], str)
        assert len(self.meta["description"]) > 0

    def test_parameter_schema_count(self) -> None:
        """Break has exactly 1 parameter: target_loop."""
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

        assert description == "Block ID of the loop to break out of"

    def test_no_condition_parameter(self) -> None:
        """Break must NOT have a condition parameter (pure signal control)."""
        param_names = [p.name for p in self.meta["parameter_schema"]]
        assert "condition" not in param_names

    def test_output_schema_empty(self) -> None:
        """Break produces no output variables."""
        assert self.meta["output_schema"] == []

    def test_structure_hints_type(self) -> None:
        assert self.meta["structure_hints"]["type"] == "sequential"

    def test_structure_hints_loop_modifier(self) -> None:
        assert self.meta["structure_hints"]["loop_modifier"] is True


class TestBreakControlValidation:
    """Test parameter validation for BreakControl."""

    def setup_method(self) -> None:
        self.control = BreakControl()

    def test_validate_valid_target_loop(self) -> None:
        """Non-empty target_loop passes validation."""
        asyncio.run(self.control.validate({"target_loop": "for-node-123"}))

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


class TestBreakControlExecution:
    """Test execute() return signals for BreakControl."""

    def setup_method(self) -> None:
        self.control = BreakControl()

    def test_execute_returns_break_signal(self) -> None:
        """Execute returns __break=True with __break_target from target_loop."""
        context: dict = {
            "parameters": {"target_loop": "for-node-123"},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__break"] is True
        assert result["__break_target"] == "for-node-123"

    def test_execute_target_flows_through(self) -> None:
        """target_loop value from parameters flows through to __break_target."""
        context: dict = {
            "parameters": {"target_loop": "while-outer-456"},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__break_target"] == "while-outer-456"

    def test_execute_result_has_exactly_two_keys(self) -> None:
        """Execute result contains only __break and __break_target."""
        context: dict = {
            "parameters": {"target_loop": "loop-1"},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert set(result.keys()) == {"__break", "__break_target"}
