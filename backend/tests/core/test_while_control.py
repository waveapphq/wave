"""Tests for WhileControl.

Covers metadata declaration, parameter validation, and execution signals.

REQ-3.5.1.17: While loop with condition
"""

import asyncio
from unittest.mock import MagicMock

import pytest

from wavecore.controls.loop import WhileControl
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId


class TestWhileControlMetadata:
    """Verify control metadata declaration matches design spec."""

    def setup_method(self) -> None:
        self.control = WhileControl()
        self.meta = self.control.metadata

    def test_control_id(self) -> None:
        assert self.meta["id"] == ControlId.WHILE

    def test_control_version(self) -> None:
        assert self.meta["version"] == "1.0.0"

    def test_control_name(self) -> None:
        assert self.meta["name"] == "While Loop"

    def test_control_category(self) -> None:
        assert self.meta["category"] == "loop"

    def test_control_icon(self) -> None:
        assert self.meta["icon_name"] == "refresh-cw"

    def test_control_description(self) -> None:
        assert isinstance(self.meta["description"], str)
        assert len(self.meta["description"]) > 0

    def test_parameter_schema_count(self) -> None:
        """While has 4 parameters: mode, conditions, max_iterations, timeout."""
        assert len(self.meta["parameter_schema"]) == 4

    def test_parameter_mode(self) -> None:
        """mode: string enum [while-do, do-while], required, default while-do."""
        param = self.meta["parameter_schema"][0]
        assert isinstance(param, ControlParameter)
        assert param.name == "mode"
        assert param.type == "string"
        assert param.required is True
        assert param.default == "while-do"
        assert param.enum_values == ["while-do", "do-while"]

    def test_parameter_conditions(self) -> None:
        """conditions: array, required, same format as If/Else assertions."""
        param = self.meta["parameter_schema"][1]
        assert isinstance(param, ControlParameter)
        assert param.name == "conditions"
        assert param.type == "array"
        assert param.required is True

    def test_parameter_max_iterations(self) -> None:
        """max_iterations: integer, optional, no default."""
        param = self.meta["parameter_schema"][2]
        assert isinstance(param, ControlParameter)
        assert param.name == "max_iterations"
        assert param.type == "integer"
        assert param.required is False
        assert param.default is None

    def test_parameter_timeout(self) -> None:
        """timeout: float, optional, no default."""
        param = self.meta["parameter_schema"][3]
        assert isinstance(param, ControlParameter)
        assert param.name == "timeout"
        assert param.type == "float"
        assert param.required is False
        assert param.default is None

    def test_output_schema_count(self) -> None:
        """While has 1 output: index."""
        assert len(self.meta["output_schema"]) == 1

    def test_output_index(self) -> None:
        """index output: 0-based iteration counter."""
        output = self.meta["output_schema"][0]
        assert output["name"] == "index"
        assert output["type"] == "integer"

    def test_structure_hints_type(self) -> None:
        assert self.meta["structure_hints"]["type"] == "looping"

    def test_structure_hints_has_body(self) -> None:
        assert self.meta["structure_hints"]["has_body"] is True

    def test_structure_hints_branches(self) -> None:
        assert self.meta["structure_hints"]["branches"] == ["body", "then"]

    def test_structure_hints_egress(self) -> None:
        assert self.meta["structure_hints"]["egress"] == "then"


class TestWhileControlValidation:
    """Test parameter validation."""

    def setup_method(self) -> None:
        self.control = WhileControl()

    def test_validate_invalid_mode(self) -> None:
        with pytest.raises(ValueError, match="^mode must be 'while-do' or 'do-while'$"):
            asyncio.run(self.control.validate({"mode": "invalid", "conditions": []}))

    def test_validate_missing_conditions(self) -> None:
        with pytest.raises(ValueError, match="^conditions parameter is required$"):
            asyncio.run(self.control.validate({"mode": "while-do"}))

    def test_validate_conditions_not_list(self) -> None:
        with pytest.raises(ValueError, match="^conditions must be a list$"):
            asyncio.run(self.control.validate({"mode": "while-do", "conditions": "not-a-list"}))

    @pytest.mark.parametrize("value", [True, 5.0, "5"])
    def test_validate_max_iterations_that_is_not_a_whole_number(self, value: object) -> None:
        with pytest.raises(ValueError, match="^max_iterations must be >= 1$"):
            asyncio.run(
                self.control.validate(
                    {"mode": "while-do", "conditions": [], "max_iterations": value}
                )
            )

    def test_validate_max_iterations_zero(self) -> None:
        with pytest.raises(ValueError, match="^max_iterations must be >= 1$"):
            asyncio.run(
                self.control.validate(
                    {
                        "mode": "while-do",
                        "conditions": [],
                        "max_iterations": 0,
                    }
                )
            )

    def test_validate_max_iterations_negative(self) -> None:
        with pytest.raises(ValueError, match="^max_iterations must be >= 1$"):
            asyncio.run(
                self.control.validate(
                    {
                        "mode": "while-do",
                        "conditions": [],
                        "max_iterations": -1,
                    }
                )
            )

    def test_validate_passes_while_do(self) -> None:
        asyncio.run(
            self.control.validate(
                {
                    "mode": "while-do",
                    "conditions": [{"type": "expression", "expression": "True"}],
                }
            )
        )

    def test_validate_passes_do_while(self) -> None:
        asyncio.run(
            self.control.validate(
                {
                    "mode": "do-while",
                    "conditions": [{"type": "expression", "expression": "True"}],
                }
            )
        )

    def test_validate_default_mode_requires_conditions(self) -> None:
        """Missing mode defaults to 'while-do', conditions still required."""
        with pytest.raises(ValueError, match="^conditions parameter is required$"):
            asyncio.run(self.control.validate({}))

    def test_validate_passes_with_max_iterations(self) -> None:
        asyncio.run(
            self.control.validate(
                {
                    "mode": "while-do",
                    "conditions": [],
                    "max_iterations": 100,
                }
            )
        )

    def test_validate_passes_with_timeout(self) -> None:
        asyncio.run(
            self.control.validate(
                {
                    "mode": "while-do",
                    "conditions": [],
                    "timeout": 30.0,
                }
            )
        )

    def test_validate_empty_conditions_passes(self) -> None:
        """Empty conditions list passes validation."""
        asyncio.run(self.control.validate({"mode": "while-do", "conditions": []}))

    def test_validate_max_iterations_one_passes(self) -> None:
        """max_iterations=1 is valid (minimum allowed)."""
        asyncio.run(
            self.control.validate(
                {
                    "mode": "while-do",
                    "conditions": [],
                    "max_iterations": 1,
                }
            )
        )


class TestWhileControlExecution:
    """Test execute() return signals."""

    def setup_method(self) -> None:
        self.control = WhileControl()

    def test_execute_while_do_mode(self) -> None:
        """While-Do returns correct engine signals."""
        conditions = [{"type": "expression", "expression": "x > 0"}]
        context: dict = {
            "parameters": {
                "mode": "while-do",
                "conditions": conditions,
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__while_loop"] is True
        assert result["__condition"] == conditions
        assert result["__mode"] == "while-do"
        assert result["__max_iterations"] is None
        assert result["__timeout"] is None
        assert result["index"] == 0

    def test_execute_do_while_mode(self) -> None:
        """Do-While mode signal."""
        conditions = [{"type": "expression", "expression": "x > 0"}]
        context: dict = {
            "parameters": {
                "mode": "do-while",
                "conditions": conditions,
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__while_loop"] is True
        assert result["__condition"] == conditions
        assert result["__mode"] == "do-while"
        assert result["index"] == 0

    def test_execute_with_max_iterations(self) -> None:
        context: dict = {
            "parameters": {
                "mode": "while-do",
                "conditions": [],
                "max_iterations": 50,
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__max_iterations"] == 50

    def test_execute_with_timeout(self) -> None:
        context: dict = {
            "parameters": {
                "mode": "while-do",
                "conditions": [],
                "timeout": 10.5,
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__timeout"] == 10.5

    def test_execute_default_mode(self) -> None:
        """Missing mode defaults to while-do."""
        context: dict = {
            "parameters": {
                "conditions": [{"type": "expression", "expression": "True"}],
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__mode"] == "while-do"

    def test_execute_with_logger(self) -> None:
        logger = MagicMock()
        context: dict = {
            "parameters": {
                "mode": "while-do",
                "conditions": [{"type": "expression", "expression": "True"}],
            },
            "variables": {},
            "logger": logger,
        }
        asyncio.run(self.control.execute(context))
        logger.info.assert_called_once()

    def test_execute_without_logger(self) -> None:
        context: dict = {
            "parameters": {
                "mode": "while-do",
                "conditions": [],
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result is not None

    def test_execute_returns_all_required_signal_keys(self) -> None:
        """Verify all required engine signal keys are present."""
        context: dict = {
            "parameters": {
                "mode": "while-do",
                "conditions": [{"type": "expression", "expression": "True"}],
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        required_keys = {
            "__while_loop",
            "__condition",
            "__mode",
            "__max_iterations",
            "__timeout",
            "index",
        }
        assert required_keys.issubset(set(result.keys()))

    def test_execute_index_is_integer_zero(self) -> None:
        """Initial index is integer 0."""
        context: dict = {
            "parameters": {
                "mode": "while-do",
                "conditions": [],
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["index"] == 0
        assert isinstance(result["index"], int)
