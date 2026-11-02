"""
Tests for SwitchCaseControl.

Tests metadata, validation, and execution behavior of the Switch/Case control.
Covers the ordered branches contract, the container signal, and edge cases.
"""

import asyncio
from unittest.mock import MagicMock

import pytest

from wavecore.controls.assertion_evaluator import evaluate_assertions
from wavecore.controls.conditional import SwitchCaseControl
from wavecore.models.controls.metadata import CORE_CONTROLS
from wavecore.models.enums import ControlId

# =============================================================================
# Helpers
# =============================================================================


def _literal_condition(
    variable: str,
    value_type: str,
    operator: str,
    reference_value: object,
) -> dict[str, object]:
    """Build a literal assertion dict for use in branch conditions."""
    return {
        "type": "literal",
        "variable": variable,
        "value_type": value_type,
        "operator": operator,
        "reference_value": reference_value,
    }


def _expression_condition(expression: str) -> dict[str, str]:
    """Build an expression assertion dict for use in branch conditions."""
    return {"type": "expression", "expression": expression}


# =============================================================================
# Metadata Tests
# =============================================================================


class TestSwitchCaseControlMetadata:
    """Test Switch/Case control metadata declaration."""

    def test_metadata_has_correct_id(self) -> None:
        """Verify Switch/Case control has id=SWITCH_CASE."""
        control = SwitchCaseControl()
        assert control.metadata["id"] == ControlId.SWITCH_CASE

    def test_metadata_has_correct_version(self) -> None:
        """Verify Switch/Case control version is 1.0.0."""
        control = SwitchCaseControl()
        assert control.metadata["version"] == "1.0.0"

    def test_metadata_has_correct_name(self) -> None:
        """Verify Switch/Case control name is 'Switch/Case'."""
        control = SwitchCaseControl()
        assert control.metadata["name"] == "Switch/Case"

    def test_metadata_has_correct_description(self) -> None:
        """Verify Switch/Case description names condition-guarded cases."""
        control = SwitchCaseControl()
        expected = "Multi-way branching with condition-guarded cases"
        assert control.metadata["description"] == expected

    def test_metadata_has_correct_category(self) -> None:
        """Verify Switch/Case control category is 'conditional'."""
        control = SwitchCaseControl()
        assert control.metadata["category"] == "conditional"

    def test_metadata_has_correct_icon_name(self) -> None:
        """Verify Switch/Case control icon is 'list-tree'."""
        control = SwitchCaseControl()
        assert control.metadata["icon_name"] == "list-tree"

    def test_metadata_has_exactly_one_parameter(self) -> None:
        """Verify branches is the only declared parameter."""
        control = SwitchCaseControl()
        params = control.metadata["parameter_schema"]
        assert len(params) == 1
        assert params[0].name == "branches"

    def test_metadata_has_branches_parameter(self) -> None:
        """Verify Switch/Case has a branches parameter (array, required)."""
        control = SwitchCaseControl()
        params = control.metadata["parameter_schema"]
        branches_param = next(p for p in params if p.name == "branches")
        assert branches_param.type == "array"
        assert branches_param.required is True

    def test_metadata_branches_parameter_has_correct_description(self) -> None:
        """Verify the branches parameter description names cases, break and default."""
        control = SwitchCaseControl()
        params = control.metadata["parameter_schema"]
        branches_param = next(p for p in params if p.name == "branches")
        expected = (
            "Ordered list of case branches with conditions and break, plus an optional default"
        )
        assert branches_param.description == expected

    def test_metadata_has_empty_output_schema(self) -> None:
        """Verify Switch/Case declares no outputs."""
        # Guard: the matchedCase output the runtime never wrote must stay deleted.
        control = SwitchCaseControl()
        assert control.metadata["output_schema"] == []

    def test_metadata_has_scoped_structure_hints(self) -> None:
        """Verify Switch/Case declares container hints with a then egress."""
        control = SwitchCaseControl()
        assert control.metadata["structure_hints"] == {
            "type": "scoped",
            "branches": ["branch_0", "branch_1", "then"],
            "egress": "then",
            "allows_dynamic_branches": True,
        }

    def test_metadata_description_matches_static_registry(self) -> None:
        """Verify the control description agrees with the CORE_CONTROLS mirror."""
        control = SwitchCaseControl()
        assert CORE_CONTROLS[ControlId.SWITCH_CASE].description == control.metadata["description"]


# =============================================================================
# Validation Tests
# =============================================================================


class TestSwitchCaseControlValidation:
    """Test Switch/Case control parameter validation."""

    def test_validate_rejects_missing_branches(self) -> None:
        """Verify validation fails when branches parameter is missing."""
        control = SwitchCaseControl()
        with pytest.raises(ValueError, match="^branches parameter is required$"):
            asyncio.run(control.validate({}))

    def test_validate_rejects_string_branches(self) -> None:
        """Verify validation rejects a string as branches."""
        control = SwitchCaseControl()
        with pytest.raises(ValueError, match="^branches must be a list$"):
            asyncio.run(control.validate({"branches": "not a list"}))

    def test_validate_rejects_dict_branches(self) -> None:
        """Verify validation rejects a dict as branches."""
        control = SwitchCaseControl()
        with pytest.raises(ValueError, match="^branches must be a list$"):
            asyncio.run(control.validate({"branches": {"a": 1}}))

    def test_validate_rejects_integer_branches(self) -> None:
        """Verify validation rejects an integer as branches."""
        control = SwitchCaseControl()
        with pytest.raises(ValueError, match="^branches must be a list$"):
            asyncio.run(control.validate({"branches": 42}))

    def test_validate_rejects_empty_branches(self) -> None:
        """Verify validation fails when branches is an empty list."""
        control = SwitchCaseControl()
        with pytest.raises(ValueError, match="^branches must not be empty$"):
            asyncio.run(control.validate({"branches": []}))

    def test_validate_rejects_invalid_branch_type(self) -> None:
        """Verify validation fails for a branch type outside case/default."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "loop",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
        ]
        with pytest.raises(ValueError, match="^invalid branch type: 'loop'$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_missing_branch_type(self) -> None:
        """Verify validation fails when a branch omits its type."""
        # Guard: a branch with no type key must have a pinned rejection message.
        control = SwitchCaseControl()
        branches = [
            {"conditions": [_literal_condition("x", "integer", "equals", 1)]},
        ]
        with pytest.raises(ValueError, match="^invalid branch type: None$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_duplicate_branch_ids(self) -> None:
        """Verify validation fails for duplicate branch IDs."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("y", "integer", "equals", 2)],
            },
        ]
        with pytest.raises(ValueError, match="^duplicate branch id: 'branch_0'$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_multiple_defaults(self) -> None:
        """Verify validation fails when more than one default branch exists."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "default", "id": "branch_1"},
            {"type": "default", "id": "branch_2"},
        ]
        with pytest.raises(ValueError, match="^only one default branch allowed$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_a_default_only_list(self) -> None:
        """Verify a default with no case reports the missing case, not placement."""
        control = SwitchCaseControl()
        branches = [{"type": "default", "id": "branch_0"}]
        with pytest.raises(ValueError, match="^at least one case branch is required$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_default_not_last(self) -> None:
        """Verify validation fails when the default branch is not last."""
        control = SwitchCaseControl()
        branches = [
            {"type": "default", "id": "branch_0"},
            {
                "type": "case",
                "id": "branch_1",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
        ]
        with pytest.raises(ValueError, match="^default branch must be last$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_default_with_conditions(self) -> None:
        """Verify validation fails when the default branch carries conditions."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "default",
                "id": "branch_1",
                "conditions": [_literal_condition("y", "integer", "equals", 2)],
            },
        ]
        with pytest.raises(ValueError, match="^default branch must not have conditions$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_default_with_break_true(self) -> None:
        """Verify validation fails when the default branch carries break."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "default", "id": "branch_1", "break": True},
        ]
        with pytest.raises(ValueError, match="^default branch must not have break$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_default_with_break_false(self) -> None:
        """Verify a falsy break key on the default is still rejected."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "default", "id": "branch_1", "break": False},
        ]
        with pytest.raises(ValueError, match="^default branch must not have break$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_case_without_conditions(self) -> None:
        """Verify validation fails when a case branch omits conditions."""
        control = SwitchCaseControl()
        branches = [{"type": "case", "id": "branch_0"}]
        with pytest.raises(ValueError, match="^case branch must have conditions$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_case_with_empty_conditions_list(self) -> None:
        """Verify validation fails when a case branch has an empty conditions list."""
        control = SwitchCaseControl()
        branches = [{"type": "case", "id": "branch_0", "conditions": []}]
        with pytest.raises(ValueError, match="^case branch must have conditions$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_string_break(self) -> None:
        """Verify validation fails when a case break is a string."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": "true",
            },
        ]
        with pytest.raises(ValueError, match="^break must be a boolean$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_none_break(self) -> None:
        """Verify validation fails when a case break is None."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": None,
            },
        ]
        with pytest.raises(ValueError, match="^break must be a boolean$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_integer_break(self) -> None:
        """Verify validation fails when a case break is an integer."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": 1,
            },
        ]
        with pytest.raises(ValueError, match="^break must be a boolean$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_a_single_case(self) -> None:
        """Verify validation passes with one case branch only."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "label": "",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": True,
            },
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_cases_and_a_default(self) -> None:
        """Verify validation passes with cases followed by a default."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": True,
            },
            {
                "type": "case",
                "id": "branch_1",
                "conditions": [_literal_condition("x", "integer", "equals", 2)],
                "break": False,
            },
            {"type": "default", "id": "branch_2"},
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_break_omitted(self) -> None:
        """Verify validation passes when a case omits break."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_break_false(self) -> None:
        """Verify validation passes when a case sets break to false."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": False,
            },
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_branches_without_ids(self) -> None:
        """Verify validation passes when branches carry no id keys."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "case",
                "conditions": [_literal_condition("x", "integer", "equals", 2)],
            },
            {"type": "default"},
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_labels_present_and_empty(self) -> None:
        """Verify validation passes for labeled and unlabeled branches alike."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "label": "Slow",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": True,
            },
            {
                "type": "case",
                "id": "branch_1",
                "label": "",
                "conditions": [_literal_condition("x", "integer", "equals", 2)],
                "break": True,
            },
            {"type": "default", "id": "branch_2", "label": ""},
        ]
        asyncio.run(control.validate({"branches": branches}))


# =============================================================================
# Validation Tests - Rule Ordering
# =============================================================================


class TestSwitchCaseControlValidationOrdering:
    """Test the pinned order of Switch/Case validation rules."""

    def test_two_defaults_that_are_not_last_report_the_count_rule(self) -> None:
        """Verify the default count rule fires before the default placement rule."""
        control = SwitchCaseControl()
        branches = [
            {"type": "default", "id": "branch_0"},
            {"type": "default", "id": "branch_1"},
            {
                "type": "case",
                "id": "branch_2",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
        ]
        with pytest.raises(ValueError, match="^only one default branch allowed$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_duplicate_id_wins_over_a_later_invalid_type(self) -> None:
        """Verify branches are checked entry by entry, not rule by rule."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 2)],
            },
            {"type": "loop", "id": "branch_2"},
        ]
        with pytest.raises(ValueError, match="^duplicate branch id: 'branch_0'$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_invalid_type_wins_over_a_duplicate_id_on_the_same_branch(self) -> None:
        """Verify a branch's type is checked before its id."""
        control = SwitchCaseControl()
        branches = [
            {
                "type": "case",
                "id": "branch_0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "loop", "id": "branch_0"},
        ]
        with pytest.raises(ValueError, match="^invalid branch type: 'loop'$"):
            asyncio.run(control.validate({"branches": branches}))


# =============================================================================
# Execution Tests - Signal Shape
# =============================================================================


class TestSwitchCaseControlExecution:
    """Test Switch/Case control signal emission."""

    def test_execute_returns_the_switch_signal(self) -> None:
        """Verify execute returns the container signal with the branches verbatim."""
        control = SwitchCaseControl()
        branches = [
            {
                "id": "branch_0",
                "type": "case",
                "label": "",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": True,
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 1},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__switch": True, "__switch_branches": branches}

    def test_execute_returns_only_the_two_signal_keys(self) -> None:
        """Verify no other key rides along on the signal."""
        control = SwitchCaseControl()
        branches = [
            {
                "id": "branch_0",
                "type": "case",
                "label": "",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": True,
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 1},
        }
        result = asyncio.run(control.execute(context))
        assert set(result) == {"__switch", "__switch_branches"}
        assert result["__switch"] is True

    def test_execute_round_trips_every_branch_key_in_order(self) -> None:
        """Verify branch order and every case/default key survive the signal."""
        control = SwitchCaseControl()
        branches = [
            {
                "id": "branch_0",
                "type": "case",
                "label": "",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": True,
            },
            {
                "id": "branch_1",
                "type": "case",
                "label": "Slow",
                "conditions": [_expression_condition("a + b > 100")],
                "break": False,
            },
            {"id": "branch_2", "type": "default", "label": ""},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 1, "a": 60, "b": 50},
        }
        result = asyncio.run(control.execute(context))
        emitted = result["__switch_branches"]
        assert emitted == branches
        assert [branch["id"] for branch in emitted] == ["branch_0", "branch_1", "branch_2"]
        assert list(emitted[0]) == ["id", "type", "label", "conditions", "break"]
        assert list(emitted[1]) == ["id", "type", "label", "conditions", "break"]
        assert list(emitted[2]) == ["id", "type", "label"]
        assert emitted[1]["break"] is False
        assert emitted[1]["conditions"] == [_expression_condition("a + b > 100")]


# =============================================================================
# Execution Tests - Conditions Are Not Evaluated
# =============================================================================


class TestSwitchCaseControlLazyConditions:
    """Test Switch/Case evaluates no condition; the dispatcher owns that."""

    def test_execute_does_not_evaluate_conditions_for_missing_variables(self) -> None:
        """Verify a case referencing an absent variable still returns cleanly."""
        control = SwitchCaseControl()
        conditions = [_literal_condition("nonexistent", "integer", "equals", 10)]
        branches = [
            {
                "id": "branch_0",
                "type": "case",
                "label": "",
                "conditions": conditions,
                "break": True,
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__switch": True, "__switch_branches": branches}
        with pytest.raises(KeyError, match="nonexistent"):
            evaluate_assertions(conditions, {})

    def test_execute_does_not_coerce_condition_values(self) -> None:
        """Verify a case whose condition would raise on coercion still returns cleanly."""
        control = SwitchCaseControl()
        conditions = [_literal_condition("x", "integer", "equals", 10)]
        variables = {"x": "not_a_number"}
        branches = [
            {
                "id": "branch_0",
                "type": "case",
                "label": "",
                "conditions": conditions,
                "break": True,
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": variables,
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__switch": True, "__switch_branches": branches}
        with pytest.raises(TypeError):
            evaluate_assertions(conditions, variables)

    def test_execute_returns_a_default_only_signal_unchanged(self) -> None:
        """Verify a branches list with no matching case is still passed through."""
        control = SwitchCaseControl()
        branches = [
            {
                "id": "branch_0",
                "type": "case",
                "label": "",
                "conditions": [_literal_condition("x", "integer", "equals", 999)],
                "break": True,
            },
            {"id": "branch_1", "type": "default", "label": ""},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 1},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__switch": True, "__switch_branches": branches}


# =============================================================================
# Execution Tests - Logging
# =============================================================================


class TestSwitchCaseControlLogging:
    """Test Switch/Case emits no log line; per-case logging is the dispatcher's."""

    def test_execute_emits_no_logger_call(self) -> None:
        """Verify the control never touches the session logger."""
        control = SwitchCaseControl()
        logger = MagicMock()
        branches = [
            {
                "id": "branch_0",
                "type": "case",
                "label": "Slow",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": True,
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 1},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.info.assert_not_called()
        assert logger.mock_calls == []

    def test_execute_returns_the_signal_with_a_logger_present(self) -> None:
        """Verify the signal is unaffected by the presence of a logger."""
        control = SwitchCaseControl()
        logger = MagicMock()
        branches = [
            {
                "id": "branch_0",
                "type": "case",
                "label": "",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": True,
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 1},
            "logger": logger,
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__switch": True, "__switch_branches": branches}

    def test_no_logger_does_not_crash(self) -> None:
        """Verify execution works without a logger (no crash)."""
        control = SwitchCaseControl()
        branches = [
            {
                "id": "branch_0",
                "type": "case",
                "label": "",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
                "break": True,
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 1},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__switch": True, "__switch_branches": branches}
