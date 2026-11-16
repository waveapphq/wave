"""Tests for ForControl.

Covers metadata declaration, parameter validation, and execution signals.

REQ-3.5.1.15: For loop with counter variable
"""

import asyncio
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.core.run_fill_support import run_fill
from wavecore.controls.loop import ForControl
from wavecore.core.execution import field_checks
from wavecore.core.execution.field_checks import FieldFinding
from wavecore.core.expressions.errors import ExpressionTypeError
from wavecore.models.controls.parameters import RequiredWhen
from wavecore.models.enums import ControlId


def _run_fill(
    stored: dict[str, Any],
    expression_fields: set[str] | None = None,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return run_fill(ForControl(), stored, expression_fields=expression_fields, variables=variables)


def _count_field() -> Any:
    return next(p for p in ForControl().metadata["parameter_schema"] if p.name == "count")


class TestForControlMetadata:
    """Verify control metadata declaration."""

    def setup_method(self) -> None:
        self.control = ForControl()
        self.meta = self.control.metadata

    def test_control_id(self) -> None:
        assert self.meta["id"] == ControlId.FOR

    def test_control_version(self) -> None:
        assert self.meta["version"] == "1.0.0"

    def test_control_name(self) -> None:
        assert self.meta["name"] == "For Loop"

    def test_control_category(self) -> None:
        assert self.meta["category"] == "loop"

    def test_control_icon(self) -> None:
        assert self.meta["icon_name"] == "repeat"

    def test_control_description(self) -> None:
        assert isinstance(self.meta["description"], str)
        assert len(self.meta["description"]) > 0

    def test_parameter_schema_count(self) -> None:
        assert len(self.meta["parameter_schema"]) == 6

    def test_parameter_mode(self) -> None:
        param = self.meta["parameter_schema"][0]
        assert param.name == "mode"
        assert param.type == "string"
        assert param.required is True
        assert param.default == "count"
        assert param.enum_values == ["count", "range"]

    def test_parameter_count(self) -> None:
        param = self.meta["parameter_schema"][1]
        assert param.name == "count"
        assert param.type == "integer"
        assert param.required is False
        assert param.required_when == RequiredWhen(field="mode", values=["count"])
        assert param.default is None

    def test_parameter_start(self) -> None:
        param = self.meta["parameter_schema"][2]
        assert param.name == "start"
        assert param.type == "integer"
        assert param.required is False
        assert param.required_when == RequiredWhen(field="mode", values=["range"])
        assert param.default is None

    def test_parameter_end(self) -> None:
        param = self.meta["parameter_schema"][3]
        assert param.name == "end"
        assert param.type == "integer"
        assert param.required is False
        assert param.required_when == RequiredWhen(field="mode", values=["range"])
        assert param.default is None

    def test_parameter_step(self) -> None:
        param = self.meta["parameter_schema"][4]
        assert param.name == "step"
        assert param.type == "integer"
        assert param.required is True
        assert param.default == 1

    def test_parameter_timeout(self) -> None:
        param = self.meta["parameter_schema"][5]
        assert param.name == "timeout"
        assert param.type == "float"
        assert param.required is False
        assert param.default is None

    def test_output_schema_count(self) -> None:
        assert len(self.meta["output_schema"]) == 1

    def test_output_index(self) -> None:
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

    def test_the_count_takes_null(self) -> None:
        """A null count runs zero times (REQ-3.1.3.25), so the setting declares it takes null."""
        param = self.meta["parameter_schema"][1]
        assert (param.name, param.accepts_null) == ("count", True)

    @pytest.mark.parametrize(("position", "name"), [(2, "start"), (3, "end"), (4, "step")])
    def test_a_range_setting_refuses_null(self, position: int, name: str) -> None:
        param = self.meta["parameter_schema"][position]
        assert (param.name, param.accepts_null) == (name, False)


class TestForControlValidation:
    """Test parameter validation."""

    def setup_method(self) -> None:
        self.control = ForControl()

    def test_the_run_fill_refuses_an_invalid_mode(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'mode' must be one of: count, range; Actual value was 'invalid'\.$",
        ):
            _run_fill({"mode": "invalid", "count": 1})

    def test_validate_count_mode_requires_count(self) -> None:
        validation = self.control.validate({"mode": "count"})

        with pytest.raises(ValueError, match="^count is required when mode is 'count'$"):
            asyncio.run(validation)

    def test_validate_range_mode_requires_start(self) -> None:
        validation = self.control.validate({"mode": "range", "end": 5})

        with pytest.raises(ValueError, match="^start is required when mode is 'range'$"):
            asyncio.run(validation)

    def test_validate_range_mode_requires_end(self) -> None:
        validation = self.control.validate({"mode": "range", "start": 0})

        with pytest.raises(ValueError, match="^end is required when mode is 'range'$"):
            asyncio.run(validation)

    def test_validate_step_zero(self) -> None:
        validation = self.control.validate({"mode": "count", "count": 5, "step": 0})

        with pytest.raises(ValueError, match="^step must not be zero$"):
            asyncio.run(validation)

    def test_validate_negative_count(self) -> None:
        validation = self.control.validate({"mode": "count", "count": -1})

        with pytest.raises(ValueError, match="^count must be >= 0$"):
            asyncio.run(validation)

    def test_validate_passes_count_mode(self) -> None:
        asyncio.run(self.control.validate({"mode": "count", "count": 5}))

    def test_validate_passes_range_mode(self) -> None:
        asyncio.run(self.control.validate({"mode": "range", "start": 0, "end": 5}))

    def test_validate_default_mode_is_count(self) -> None:
        """The run fill gives a missing mode its declared default 'count', so count is required."""
        validation = self.control.validate(_run_fill({}))

        with pytest.raises(ValueError, match="^count is required when mode is 'count'$"):
            asyncio.run(validation)

    def test_validate_count_zero_passes(self) -> None:
        asyncio.run(self.control.validate({"mode": "count", "count": 0}))

    def test_validate_null_count_passes(self) -> None:
        assert asyncio.run(self.control.validate({"mode": "count", "count": None})) is None


class TestForControlExecution:
    """Test execute() return signals."""

    def setup_method(self) -> None:
        self.control = ForControl()

    def test_execute_count_mode(self) -> None:
        context: dict = {
            "parameters": {"mode": "count", "count": 5, "step": 1},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__for_loop"] is True
        assert result["__loop_start"] == 0
        assert result["__loop_end"] == 5
        assert result["__loop_step"] == 1
        assert result["__loop_variable"] == "index"
        assert result["index"] == 0

    def test_execute_range_mode(self) -> None:
        context: dict = {
            "parameters": {"mode": "range", "start": 8080, "end": 8085, "step": 1},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__for_loop"] is True
        assert result["__loop_start"] == 8080
        assert result["__loop_end"] == 8085
        assert result["__loop_step"] == 1
        assert result["__loop_variable"] == "index"
        assert result["index"] == 8080

    def test_execute_custom_step(self) -> None:
        context: dict = {
            "parameters": {"mode": "count", "count": 10, "step": 2},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__loop_step"] == 2
        assert result["index"] == 0
        assert isinstance(result["index"], int)

    def test_execute_empty_loop(self) -> None:
        context: dict = {
            "parameters": {"mode": "count", "count": 0, "step": 1},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__for_loop"] is True
        assert result["__loop_start"] == 0
        assert result["__loop_end"] == 0

    def test_execute_default_step(self) -> None:
        context: dict = {
            "parameters": _run_fill({"mode": "count", "count": 5}),
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__loop_step"] == 1

    def test_execute_default_mode(self) -> None:
        context: dict = {
            "parameters": _run_fill({"count": 3}),
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__for_loop"] is True
        assert result["__loop_start"] == 0
        assert result["__loop_end"] == 3

    def test_execute_with_logger(self) -> None:
        logger = MagicMock()
        context: dict = {
            "parameters": {"mode": "count", "count": 5, "step": 1},
            "variables": {},
            "logger": logger,
        }
        asyncio.run(self.control.execute(context))
        logger.info.assert_called_once()

    def test_execute_without_logger(self) -> None:
        context: dict = {
            "parameters": {"mode": "count", "count": 5, "step": 1},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result is not None

    def test_execute_range_with_step(self) -> None:
        context: dict = {
            "parameters": {
                "mode": "range",
                "start": 0,
                "end": 10,
                "step": 3,
            },
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__loop_start"] == 0
        assert result["__loop_end"] == 10
        assert result["__loop_step"] == 3
        assert result["index"] == 0

    def test_execute_null_count_with_a_logger_runs_zero_times(self) -> None:
        logger = MagicMock()
        context: dict = {
            "parameters": {"mode": "count", "count": None, "step": 1},
            "variables": {},
            "logger": logger,
        }

        result = asyncio.run(self.control.execute(context))

        assert (result["__loop_start"], result["__loop_end"], result["index"]) == (0, 0, 0)
        logger.info.assert_called_once_with("For loop: mode=count, iterations=0, step=1")

    def test_execute_null_count_without_a_logger_ends_at_zero(self) -> None:
        context: dict = {
            "parameters": {"mode": "count", "count": None, "step": 1},
            "variables": {},
        }

        result = asyncio.run(self.control.execute(context))

        assert result["__loop_end"] == 0


class TestForStructureProblems:
    """The For rule the save check and validate() share (REQ-3.5.0.3)."""

    @pytest.mark.parametrize(
        "values",
        [
            {"mode": "count", "count": 3, "step": 0},
            {"mode": "range", "start": 0, "end": 5, "step": 0},
            {"mode": "count", "count": 3, "step": "0"},
        ],
        ids=["count-mode", "range-mode", "zero-as-digits"],
    )
    def test_a_step_of_zero_is_reported(self, values: dict[str, Any]) -> None:
        assert ForControl().structure_problems(values) == [
            FieldFinding("INVALID_SETTING_VALUE", "step must not be zero", None, "step")
        ]

    @pytest.mark.parametrize("step", [0, "0"], ids=["zero", "zero-as-digits"])
    def test_a_flagged_step_is_skipped(self, step: int | str) -> None:
        values = {"mode": "count", "count": 3, "step": step}

        assert ForControl().structure_problems(values, {"step"}) == []
        assert ForControl().structure_problems(values) == [
            FieldFinding("INVALID_SETTING_VALUE", "step must not be zero", None, "step")
        ]

    @pytest.mark.parametrize(
        "step", [False, 0.0, "0.0", "zero"], ids=["false", "float", "float-text", "word"]
    )
    def test_a_step_that_is_no_integer_is_left_to_the_shared_check(self, step: Any) -> None:
        values = {"mode": "count", "count": 3, "step": step}
        shared = field_checks.check_block_fields(
            ForControl().metadata["parameter_schema"],
            values,
            block_id="for",
            expression_fields=set(),
            template_fields=set(),
            check_required=True,
        )

        assert ForControl().structure_problems(values) == []
        assert [(finding.code, finding.field) for finding in shared] == [
            ("INVALID_SETTING_TYPE", "step")
        ]

    @pytest.mark.parametrize(
        "values",
        [
            {"mode": "count", "count": -1, "step": 1},
            {"mode": "count", "count": None, "step": 1},
            {"mode": "count", "step": 1},
        ],
        ids=["below-zero", "null", "left-out"],
    )
    def test_a_count_is_never_a_structure_problem(self, values: dict[str, Any]) -> None:
        # The count floor is the declared minimum of 'count', checked by the shared check.
        assert ForControl().structure_problems(values) == []


class TestForFields:
    """The declared marks of the For count (REQ-3.5.1.15, REQ-3.1.3.21)."""

    def test_count_declares_minimum_zero(self) -> None:
        count = _count_field()

        assert count.minimum is not None
        assert count.minimum == 0

    def test_count_accepts_null(self) -> None:
        assert _count_field().accepts_null is True


class TestForRunFloor:
    """validate() keeps the count floor for an {x} result the save cannot see."""

    def test_validate_still_refuses_a_count_below_zero_from_an_expression(self) -> None:
        resolved = _run_fill({"mode": "count", "count": "start - 5"}, {"count"}, {"start": 2})

        assert resolved["count"] == -3
        validation = ForControl().validate(resolved)
        with pytest.raises(ValueError, match="^count must be >= 0$"):
            asyncio.run(validation)

    def test_a_count_that_is_not_an_integer_is_left_to_the_shared_check(self) -> None:
        assert (
            asyncio.run(ForControl().validate({"mode": "count", "count": -2.5, "step": 1})) is None
        )
        with pytest.raises(
            ExpressionTypeError, match="^Parameter 'count' expects integer, got float$"
        ):
            _run_fill({"mode": "count", "count": "half"}, {"count"}, {"half": -2.5})
