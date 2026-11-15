"""
Tests for the structure rules every control shares through ControlBase.

Requirements tested:
- REQ-3.5.0.3: Control parameter schema definition (inputs for configuration)
"""

import re
from typing import Any

import pytest

import wavecore.controls.base as base_module
from wavecore.controls.base import ControlBase
from wavecore.controls.conditional import IfElseControl, SwitchCaseControl
from wavecore.controls.flow import ParallelControl
from wavecore.controls.loop import ForControl
from wavecore.core.execution.field_checks import FieldFinding
from wavecore.models.enums import ControlId


class _RulelessControl(ControlBase):
    """A control that declares no structure rules of its own."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": ControlId.NOTE,
            "version": "1.0.0",
            "name": "Ruleless",
            "description": "A control with no structure rules",
            "category": "misc",
            "icon_name": "StickyNote",
            "parameter_schema": [],
            "output_schema": [],
            "structure_hints": {"type": "sequential"},
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        return None

    async def validate(self, params: dict[str, Any]) -> None:
        return None


class TestStructureProblemsBase:
    """structure_problems() lists FieldFinding items; raise_first_problem() raises the first."""

    def test_a_control_with_no_rules_reports_none(self) -> None:
        """A control that declares no rules reports no problem, with or without flagged places."""
        control = _RulelessControl()
        assert control.structure_problems({"anything": 0}) == []
        assert control.structure_problems({"anything": 0}, ("anything",)) == []

    @pytest.mark.parametrize(
        ("control", "values"),
        [
            pytest.param(IfElseControl(), {"branches": [{"type": "else"}]}, id="if-else"),
            pytest.param(
                SwitchCaseControl(), {"branches": [{"type": "default"}]}, id="switch-case"
            ),
            pytest.param(
                ParallelControl(), {"branches": [{"id": "lane_1", "name": "A"}]}, id="parallel"
            ),
            pytest.param(ForControl(), {"mode": "count", "count": 3, "step": 0}, id="for"),
        ],
    )
    def test_problems_are_field_findings(
        self, control: ControlBase, values: dict[str, Any]
    ) -> None:
        """Each problem is the shared FieldFinding with no fix; no separate problem type exists."""
        problems = control.structure_problems(values)
        assert isinstance(problems, list)
        assert problems
        for problem in problems:
            assert type(problem) is FieldFinding
            assert isinstance(problem.code, str)
            assert isinstance(problem.message, str)
            assert isinstance(problem.field, str)
            assert problem.fix is None
        assert not hasattr(base_module, "StructureProblem")

    def test_raise_first_problem_raises_the_first_message(self) -> None:
        """The ValueError text is the first problem's message, verbatim."""
        problems = [
            FieldFinding(
                "INVALID_CONTROL_STRUCTURE", "else branch must be last", None, "branches.1.type"
            ),
            FieldFinding(
                "REQUIRED_PARAM_EMPTY",
                "if branch must have conditions",
                None,
                "branches.2.conditions",
            ),
        ]
        with pytest.raises(ValueError, match=f"^{re.escape(problems[0].message)}$") as raised:
            base_module.raise_first_problem(problems)
        assert str(raised.value) == "else branch must be last"

    def test_raise_first_problem_is_silent_with_no_problems(self) -> None:
        """An empty problem list raises nothing."""
        assert base_module.raise_first_problem([]) is None
