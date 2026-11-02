"""Tests for TryCatchFinallyControl.

Covers metadata declaration, parameter validation, and execution signals.
"""

import asyncio
from unittest.mock import MagicMock

from wavecore.controls.flow import TryCatchFinallyControl
from wavecore.models.enums import ControlId


class TestTryCatchFinallyControlMetadata:
    """Verify control metadata declaration."""

    def setup_method(self) -> None:
        self.control = TryCatchFinallyControl()
        self.meta = self.control.metadata

    def test_control_id(self) -> None:
        assert self.meta["id"] == ControlId.TRY_CATCH_FINALLY

    def test_control_version(self) -> None:
        assert self.meta["version"] == "1.0.0"

    def test_control_name(self) -> None:
        assert self.meta["name"] == "Try/Catch/Finally"

    def test_control_category(self) -> None:
        assert self.meta["category"] == "flow"

    def test_control_icon(self) -> None:
        assert self.meta["icon_name"] == "shield-check"

    def test_control_description(self) -> None:
        assert isinstance(self.meta["description"], str)
        assert len(self.meta["description"]) > 0

    def test_parameter_schema_count(self) -> None:
        assert len(self.meta["parameter_schema"]) == 2

    def test_parameter_enable_catch(self) -> None:
        param = self.meta["parameter_schema"][0]
        assert param.name == "enable_catch"
        assert param.type == "boolean"
        assert param.required is False
        assert param.default is True

    def test_parameter_enable_finally(self) -> None:
        param = self.meta["parameter_schema"][1]
        assert param.name == "enable_finally"
        assert param.type == "boolean"
        assert param.required is False
        assert param.default is False

    def test_output_schema_count(self) -> None:
        assert len(self.meta["output_schema"]) == 2

    def test_output_error(self) -> None:
        output = self.meta["output_schema"][0]
        assert output["name"] == "error"
        assert output["type"] == "map"

    def test_output_caught(self) -> None:
        output = self.meta["output_schema"][1]
        assert output["name"] == "caught"
        assert output["type"] == "boolean"

    def test_structure_hints_type(self) -> None:
        assert self.meta["structure_hints"]["type"] == "scoped"

    def test_structure_hints_branches(self) -> None:
        assert self.meta["structure_hints"]["branches"] == [
            "try",
            "catch",
            "finally",
            "then",
        ]

    def test_structure_hints_egress(self) -> None:
        assert self.meta["structure_hints"]["egress"] == "then"


class TestTryCatchFinallyControlValidation:
    """Test parameter validation."""

    def setup_method(self) -> None:
        self.control = TryCatchFinallyControl()

    def test_validate_empty_params(self) -> None:
        asyncio.run(self.control.validate({}))

    def test_validate_with_enable_catch(self) -> None:
        asyncio.run(self.control.validate({"enable_catch": False}))

    def test_validate_with_enable_finally(self) -> None:
        asyncio.run(self.control.validate({"enable_finally": True}))


class TestTryCatchFinallyControlExecution:
    """Test execute() return signals."""

    def setup_method(self) -> None:
        self.control = TryCatchFinallyControl()

    def test_execute_defaults(self) -> None:
        context: dict = {"parameters": {}, "variables": {}}
        result = asyncio.run(self.control.execute(context))
        assert result["__branch"] == "try"
        assert result["__try_catch"] is True
        assert result["__enable_catch"] is True
        assert result["__enable_finally"] is False

    def test_execute_catch_disabled(self) -> None:
        context: dict = {
            "parameters": {"enable_catch": False},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__enable_catch"] is False

    def test_execute_finally_enabled(self) -> None:
        context: dict = {
            "parameters": {"enable_finally": True},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__enable_finally"] is True

    def test_execute_all_custom(self) -> None:
        context: dict = {
            "parameters": {
                "enable_catch": False,
                "enable_finally": True,
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__branch"] == "try"
        assert result["__try_catch"] is True
        assert result["__enable_catch"] is False
        assert result["__enable_finally"] is True

    def test_execute_with_logger(self) -> None:
        logger = MagicMock()
        context: dict = {"parameters": {}, "variables": {}, "logger": logger}
        asyncio.run(self.control.execute(context))
        logger.info.assert_called_once_with("Try/Catch: catch=True, finally=False")

    def test_execute_without_logger(self) -> None:
        context: dict = {"parameters": {}, "variables": {}}
        result = asyncio.run(self.control.execute(context))
        assert result is not None

    def test_execute_no_error_variable_in_result(self) -> None:
        """The result carries no error variable."""
        context: dict = {"parameters": {}, "variables": {}}
        result = asyncio.run(self.control.execute(context))
        assert "__error_variable" not in result
