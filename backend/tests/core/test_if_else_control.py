"""
Tests for IfElseControl.

Tests metadata, validation, and execution behavior of the If/Else control.
Covers N-branch conditionals, logging, variable passthrough, and edge cases.
"""

import asyncio
from unittest.mock import MagicMock

import pytest

from wavecore.controls.conditional import IfElseControl
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


class TestIfElseControlMetadata:
    """Test If/Else control metadata declaration."""

    def test_metadata_has_correct_id(self) -> None:
        """Verify If/Else control has id=IF_ELSE."""
        control = IfElseControl()
        assert control.metadata["id"] == ControlId.IF_ELSE

    def test_metadata_has_correct_version(self) -> None:
        """Verify If/Else control version is 1.0.0."""
        control = IfElseControl()
        assert control.metadata["version"] == "1.0.0"

    def test_metadata_has_correct_name(self) -> None:
        """Verify If/Else control name is 'If/Else'."""
        control = IfElseControl()
        assert control.metadata["name"] == "If/Else"

    def test_metadata_has_correct_category(self) -> None:
        """Verify If/Else control category is 'conditional'."""
        control = IfElseControl()
        assert control.metadata["category"] == "conditional"

    def test_metadata_has_branches_parameter(self) -> None:
        """Verify If/Else control has branches parameter (array, required)."""
        control = IfElseControl()
        params = control.metadata["parameter_schema"]
        branches_param = next(p for p in params if p.name == "branches")
        assert branches_param.type == "array"
        assert branches_param.required is True

    def test_metadata_has_empty_output_schema(self) -> None:
        """Verify If/Else control has empty output schema."""
        control = IfElseControl()
        assert control.metadata["output_schema"] == []

    def test_metadata_has_branching_structure_hints(self) -> None:
        """Verify If/Else control has branching structure hints."""
        control = IfElseControl()
        hints = control.metadata["structure_hints"]
        assert hints["type"] == "branching"
        assert hints["branches"] == ["branch_0", "branch_1"]

    def test_metadata_allows_dynamic_branches(self) -> None:
        """Verify If/Else control allows dynamic branches."""
        control = IfElseControl()
        hints = control.metadata["structure_hints"]
        assert hints["allows_dynamic_branches"] is True


# =============================================================================
# Validation Tests
# =============================================================================


class TestIfElseControlValidation:
    """Test If/Else control parameter validation."""

    def test_validate_rejects_missing_branches(self) -> None:
        """Verify validation fails when branches parameter is missing."""
        control = IfElseControl()
        with pytest.raises(ValueError, match="^branches parameter is required$"):
            asyncio.run(control.validate({}))

    def test_validate_rejects_non_list_branches(self) -> None:
        """Verify validation fails when branches is not a list."""
        control = IfElseControl()
        with pytest.raises(ValueError, match="^branches must be a list$"):
            asyncio.run(control.validate({"branches": "not a list"}))

    def test_validate_rejects_empty_branches(self) -> None:
        """Verify validation fails when branches is an empty list."""
        control = IfElseControl()
        with pytest.raises(ValueError, match="^branches must not be empty$"):
            asyncio.run(control.validate({"branches": []}))

    def test_validate_rejects_first_branch_not_if(self) -> None:
        """Verify validation fails when first branch is not type 'if'."""
        control = IfElseControl()
        branches = [
            {
                "type": "else_if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            }
        ]
        with pytest.raises(ValueError, match="^first branch must be type 'if'$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_if_at_wrong_position(self) -> None:
        """Verify validation fails when 'if' branch is not first."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "if",
                "conditions": [_literal_condition("y", "integer", "equals", 2)],
            },
        ]
        with pytest.raises(ValueError, match="^if branch must be first$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_else_if_at_position_zero(self) -> None:
        """Verify validation fails when else_if is at position 0."""
        control = IfElseControl()
        branches = [
            {
                "type": "else_if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
        ]
        # First branch not 'if' is caught first
        with pytest.raises(ValueError, match="^first branch must be type 'if'$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_invalid_branch_type(self) -> None:
        """Verify validation fails for unknown branch type."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "unknown"},
        ]
        with pytest.raises(ValueError, match="^invalid branch type: 'unknown'$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_else_not_last(self) -> None:
        """Verify validation fails when else branch is not last."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "else"},
            {
                "type": "else_if",
                "conditions": [_literal_condition("y", "integer", "equals", 2)],
            },
        ]
        with pytest.raises(ValueError, match="^else branch must be last$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_multiple_else_branches(self) -> None:
        """Verify validation fails when there are multiple else branches."""
        control = IfElseControl()
        # Two else branches at end - first else triggers "not last" error
        # because there's another branch after it
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "else"},
            {"type": "else"},
        ]
        with pytest.raises(ValueError, match="^else branch must be last$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_else_with_conditions(self) -> None:
        """Verify validation fails when else branch has conditions."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "else",
                "conditions": [_literal_condition("y", "integer", "equals", 2)],
            },
        ]
        with pytest.raises(ValueError, match="^else branch must not have conditions$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_if_without_conditions(self) -> None:
        """Verify validation fails when if branch has no conditions."""
        control = IfElseControl()
        branches = [{"type": "if"}]
        with pytest.raises(ValueError, match="^if branch must have conditions$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_else_if_without_conditions(self) -> None:
        """Verify validation fails when else_if branch has no conditions."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "else_if"},
        ]
        with pytest.raises(ValueError, match="^else_if branch must have conditions$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_duplicate_branch_ids(self) -> None:
        """Verify validation fails for duplicate branch IDs."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "branch_a",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "else_if",
                "id": "branch_a",
                "conditions": [_literal_condition("y", "integer", "equals", 2)],
            },
        ]
        with pytest.raises(ValueError, match="^duplicate branch id: 'branch_a'$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_if_only(self) -> None:
        """Verify validation passes with just an if branch."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_if_else(self) -> None:
        """Verify validation passes with if and else branches."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "else"},
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_if_else_if_else(self) -> None:
        """Verify validation passes with if, else_if, and else branches."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "else_if",
                "conditions": [_literal_condition("x", "integer", "equals", 2)],
            },
            {"type": "else"},
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_if_multiple_else_if_else(self) -> None:
        """Verify validation passes with if, multiple else_if, and else."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "else_if",
                "id": "b1",
                "conditions": [_literal_condition("x", "integer", "equals", 2)],
            },
            {
                "type": "else_if",
                "id": "b2",
                "conditions": [_literal_condition("x", "integer", "equals", 3)],
            },
            {
                "type": "else_if",
                "id": "b3",
                "conditions": [_literal_condition("x", "integer", "equals", 4)],
            },
            {"type": "else", "id": "b4"},
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_dict_branches(self) -> None:
        """Verify validation rejects dict as branches."""
        control = IfElseControl()
        with pytest.raises(ValueError, match="^branches must be a list$"):
            asyncio.run(control.validate({"branches": {"a": 1}}))

    def test_validate_rejects_integer_branches(self) -> None:
        """Verify validation rejects integer as branches."""
        control = IfElseControl()
        with pytest.raises(ValueError, match="^branches must be a list$"):
            asyncio.run(control.validate({"branches": 42}))

    def test_validate_rejects_if_with_empty_conditions_list(self) -> None:
        """Verify validation fails when if branch has empty conditions list."""
        control = IfElseControl()
        branches = [{"type": "if", "conditions": []}]
        with pytest.raises(ValueError, match="^if branch must have conditions$"):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_else_if_with_empty_conditions_list(self) -> None:
        """Verify validation fails when else_if has empty conditions list."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {"type": "else_if", "conditions": []},
        ]
        with pytest.raises(ValueError, match="^else_if branch must have conditions$"):
            asyncio.run(control.validate({"branches": branches}))


# =============================================================================
# Execution Tests - Single If Branch
# =============================================================================


class TestIfElseControlExecutionSingleIf:
    """Test If/Else control with a single if branch."""

    def test_single_if_condition_true(self) -> None:
        """Verify if branch is taken when condition passes."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "if_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "if_branch"}

    def test_single_if_condition_false(self) -> None:
        """Verify __no_match__ is returned when if condition fails."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "if_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 99)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "__no_match__"}


# =============================================================================
# Execution Tests - If/Else
# =============================================================================


class TestIfElseControlExecutionIfElse:
    """Test If/Else control with if and else branches."""

    def test_if_else_condition_true_takes_if(self) -> None:
        """Verify if branch is taken when condition passes."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "if_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
            {"type": "else", "id": "else_branch"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "if_branch"}

    def test_if_else_condition_false_takes_else(self) -> None:
        """Verify else branch is taken when if condition fails."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "if_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 99)],
            },
            {"type": "else", "id": "else_branch"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "else_branch"}

    def test_a_null_value_takes_else(self) -> None:
        """A null value holds nothing, so it does not equal 10 (REQ-3.1.3.25)."""
        branches = [
            {
                "type": "if",
                "id": "if_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
            {"type": "else", "id": "else_branch"},
        ]
        context = {"parameters": {"branches": branches}, "variables": {"x": None}}

        result = asyncio.run(IfElseControl().execute(context))

        assert result == {"__branch": "else_branch"}

    def test_is_null_on_a_null_value_takes_if(self) -> None:
        branches = [
            {
                "type": "if",
                "id": "if_branch",
                "conditions": [_literal_condition("x", "integer", "is_null", None)],
            },
            {"type": "else", "id": "else_branch"},
        ]
        context = {"parameters": {"branches": branches}, "variables": {"x": None}}

        result = asyncio.run(IfElseControl().execute(context))

        assert result == {"__branch": "if_branch"}


# =============================================================================
# Execution Tests - If/ElseIf/Else
# =============================================================================


class TestIfElseControlExecutionIfElseIfElse:
    """Test If/Else control with if, else_if, and else branches."""

    def test_first_condition_true_takes_if(self) -> None:
        """Verify if branch is taken when first condition passes."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "if_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
            {
                "type": "else_if",
                "id": "elif_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 20)],
            },
            {"type": "else", "id": "else_branch"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "if_branch"}

    def test_second_condition_true_takes_else_if(self) -> None:
        """Verify else_if branch is taken when its condition passes."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "if_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
            {
                "type": "else_if",
                "id": "elif_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 20)],
            },
            {"type": "else", "id": "else_branch"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 20},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "elif_branch"}

    def test_no_conditions_match_takes_else(self) -> None:
        """Verify else branch is taken when no conditions match."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "if_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
            {
                "type": "else_if",
                "id": "elif_branch",
                "conditions": [_literal_condition("x", "integer", "equals", 20)],
            },
            {"type": "else", "id": "else_branch"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 999},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "else_branch"}


# =============================================================================
# Execution Tests - Multiple ElseIf
# =============================================================================


class TestIfElseControlExecutionMultipleElseIf:
    """Test If/Else control with multiple else_if branches."""

    def test_correct_else_if_chosen(self) -> None:
        """Verify the correct else_if branch is chosen among multiple."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 1)],
            },
            {
                "type": "else_if",
                "id": "b1",
                "conditions": [_literal_condition("x", "integer", "equals", 2)],
            },
            {
                "type": "else_if",
                "id": "b2",
                "conditions": [_literal_condition("x", "integer", "equals", 3)],
            },
            {
                "type": "else_if",
                "id": "b3",
                "conditions": [_literal_condition("x", "integer", "equals", 4)],
            },
            {"type": "else", "id": "b4"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 3},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b2"}

    def test_first_matching_else_if_wins(self) -> None:
        """Verify the first matching else_if is returned when multiple match."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "greater_than", 100)],
            },
            {
                "type": "else_if",
                "id": "b1",
                "conditions": [_literal_condition("x", "integer", "greater_than", 5)],
            },
            {
                "type": "else_if",
                "id": "b2",
                "conditions": [_literal_condition("x", "integer", "greater_than", 0)],
            },
        ]
        # x=10 matches both b1 (>5) and b2 (>0), but b1 should win
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b1"}


# =============================================================================
# Execution Tests - Default Branch IDs
# =============================================================================


class TestIfElseControlDefaultBranchIds:
    """Test If/Else control default branch ID generation."""

    def test_default_branch_id_for_if(self) -> None:
        """Verify default branch_0 id when if branch has no explicit id."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "branch_0"}

    def test_default_branch_id_for_else(self) -> None:
        """Verify default branch_N id when else branch has no explicit id."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "conditions": [_literal_condition("x", "integer", "equals", 99)],
            },
            {"type": "else"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "branch_1"}


# =============================================================================
# Execution Tests - Logging
# =============================================================================


class TestIfElseControlLogging:
    """Test If/Else control logging behavior."""

    def test_logs_label_when_present_for_if(self) -> None:
        """Verify logger uses label when if branch is taken."""
        control = IfElseControl()
        logger = MagicMock()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "label": "Status OK",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.info.assert_called_once_with("Branch taken: Status OK")

    def test_logs_index_when_no_label_for_if(self) -> None:
        """Verify logger uses type and index when if branch has no label."""
        control = IfElseControl()
        logger = MagicMock()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.info.assert_called_once_with("Branch taken: if (branch 1)")

    def test_logs_label_when_present_for_else(self) -> None:
        """Verify logger uses label when else branch is taken."""
        control = IfElseControl()
        logger = MagicMock()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 99)],
            },
            {"type": "else", "id": "b1", "label": "Default Case"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.info.assert_called_once_with("Branch taken: Default Case")

    def test_logs_index_when_no_label_for_else(self) -> None:
        """Verify logger uses 'else (index N)' when else has no label."""
        control = IfElseControl()
        logger = MagicMock()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 99)],
            },
            {"type": "else", "id": "b1"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.info.assert_called_once_with("Branch taken: else (branch 2)")

    def test_logs_label_when_present_for_else_if(self) -> None:
        """Verify logger uses label when else_if branch is taken."""
        control = IfElseControl()
        logger = MagicMock()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 99)],
            },
            {
                "type": "else_if",
                "id": "b1",
                "label": "Check Two",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.info.assert_called_once_with("Branch taken: Check Two")

    def test_logs_no_match(self) -> None:
        """Verify logger reports when no branch matched."""
        control = IfElseControl()
        logger = MagicMock()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 99)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        logger.info.assert_called_once_with("All conditions evaluated and failed, end of flow")

    def test_no_logger_does_not_crash(self) -> None:
        """Verify execution works without a logger (no crash)."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b0"}

    def test_no_logger_no_match_does_not_crash(self) -> None:
        """Verify no-match execution works without a logger (no crash)."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 99)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "__no_match__"}


# =============================================================================
# Execution Tests - Variables
# =============================================================================


class TestIfElseControlVariables:
    """Test If/Else control uses variables from context."""

    def test_condition_uses_variables(self) -> None:
        """Verify conditions evaluate against the variable context."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("status", "string", "equals", "active")],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"status": "active"},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b0"}

    def test_expression_conditions(self) -> None:
        """Verify expression-type conditions work with variables."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_expression_condition("a + b > 100")],
            },
            {"type": "else", "id": "b1"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"a": 60, "b": 50},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b0"}

    def test_expression_condition_false(self) -> None:
        """Verify expression-type condition that evaluates to false."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_expression_condition("a + b > 100")],
            },
            {"type": "else", "id": "b1"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"a": 10, "b": 5},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b1"}


# =============================================================================
# Execution Tests - Complex Conditions (AND/OR combinators)
# =============================================================================


class TestIfElseControlComplexConditions:
    """Test If/Else control with complex AND/OR conditions."""

    def test_and_combinator_all_pass(self) -> None:
        """Verify AND combinator passes when all conditions pass."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [
                    _literal_condition("x", "integer", "equals", 10),
                    {"type": "operator", "value": "and"},
                    _literal_condition("y", "integer", "equals", 20),
                ],
            },
            {"type": "else", "id": "b1"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10, "y": 20},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b0"}

    def test_and_combinator_one_fails(self) -> None:
        """Verify AND combinator fails when one condition fails."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [
                    _literal_condition("x", "integer", "equals", 10),
                    {"type": "operator", "value": "and"},
                    _literal_condition("y", "integer", "equals", 99),
                ],
            },
            {"type": "else", "id": "b1"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10, "y": 20},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b1"}

    def test_or_combinator_one_passes(self) -> None:
        """Verify OR combinator passes when one condition passes."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [
                    _literal_condition("x", "integer", "equals", 99),
                    {"type": "operator", "value": "or"},
                    _literal_condition("y", "integer", "equals", 20),
                ],
            },
            {"type": "else", "id": "b1"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10, "y": 20},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b0"}

    def test_or_combinator_all_fail(self) -> None:
        """Verify OR combinator fails when all conditions fail."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [
                    _literal_condition("x", "integer", "equals", 99),
                    {"type": "operator", "value": "or"},
                    _literal_condition("y", "integer", "equals", 99),
                ],
            },
            {"type": "else", "id": "b1"},
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": 10, "y": 20},
        }
        result = asyncio.run(control.execute(context))
        assert result == {"__branch": "b1"}


# =============================================================================
# Execution Tests - Error Propagation
# =============================================================================


class TestIfElseControlErrorPropagation:
    """Test If/Else control propagates evaluator exceptions."""

    def test_missing_variable_propagates_key_error(self) -> None:
        """Verify KeyError from missing variable propagates."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("nonexistent", "integer", "equals", 10)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {},
        }
        with pytest.raises(KeyError, match="nonexistent"):
            asyncio.run(control.execute(context))

    def test_type_error_propagates(self) -> None:
        """Verify TypeError from type coercion propagates."""
        control = IfElseControl()
        branches = [
            {
                "type": "if",
                "id": "b0",
                "conditions": [_literal_condition("x", "integer", "equals", 10)],
            },
        ]
        context = {
            "parameters": {"branches": branches},
            "variables": {"x": "not_a_number"},
        }
        with pytest.raises(TypeError):
            asyncio.run(control.execute(context))


class TestIfConditionsAreReadOnly:
    """An If condition is a read: it may not change the data it inspects."""

    def test_condition_that_changes_a_list_is_refused(self) -> None:
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows = [1]
        control = IfElseControl()
        context = {
            "parameters": {
                "branches": [
                    {
                        "id": "branch_0",
                        "type": "if",
                        "conditions": [_expression_condition("rows.append(5) or True")],
                    }
                ]
            },
            "variables": {"rows": rows},
        }

        with pytest.raises(BlockedExpressionError) as exc_info:
            asyncio.run(control.execute(context))

        assert "add a Variable Setter Block" in str(exc_info.value)
        assert rows == [1]

    def test_condition_that_only_reads_still_takes_the_branch(self) -> None:
        control = IfElseControl()
        context = {
            "parameters": {
                "branches": [
                    {
                        "id": "branch_0",
                        "type": "if",
                        "conditions": [_expression_condition("len(rows) == 2")],
                    }
                ]
            },
            "variables": {"rows": [1, 2]},
        }

        assert asyncio.run(control.execute(context)) == {"__branch": "branch_0"}
