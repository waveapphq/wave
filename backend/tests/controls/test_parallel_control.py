"""Tests for ParallelControl.

Metadata, the container signal ``execute`` emits, and parameter validation for
the Parallel control. Covers REQ-3.2.3.6 (join modes), REQ-3.2.3.7 (time
limits), the container with a ``then`` egress, two join modes, two
independent limits, no outputs and a minimum of two branches.
"""

import asyncio
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.controls.flow import ParallelControl
from wavecore.models.controls.metadata import CORE_CONTROLS
from wavecore.models.enums import ControlId

# =============================================================================
# Helpers
# =============================================================================


def _branch(
    branch_id: str,
    name: str = "",
    time_limit: int | str | None = None,
) -> dict[str, Any]:
    """Build a branch record as the canvas stores it."""
    record: dict[str, Any] = {"id": branch_id, "name": name}
    if time_limit is not None:
        record["time_limit"] = time_limit
    return record


def _two_branches() -> list[dict[str, Any]]:
    return [_branch("branch_1", "ingest"), _branch("branch_2", "probe")]


# =============================================================================
# Metadata Tests
# =============================================================================


class TestParallelControlMetadata:
    """Parallel control metadata declaration."""

    def test_metadata_has_correct_id(self) -> None:
        """Verify Parallel control has id=PARALLEL."""
        control = ParallelControl()
        assert control.metadata["id"] == ControlId.PARALLEL

    def test_metadata_has_correct_version(self) -> None:
        """Verify Parallel control version is 1.0.0."""
        control = ParallelControl()
        assert control.metadata["version"] == "1.0.0"

    def test_metadata_has_correct_name(self) -> None:
        """Verify Parallel control name is 'Parallel'."""
        control = ParallelControl()
        assert control.metadata["name"] == "Parallel"

    def test_metadata_has_correct_category(self) -> None:
        """Verify Parallel control category is 'flow'."""
        control = ParallelControl()
        assert control.metadata["category"] == "flow"

    def test_metadata_has_correct_icon_name(self) -> None:
        """Verify Parallel control icon is 'git-merge'."""
        control = ParallelControl()
        assert control.metadata["icon_name"] == "git-merge"

    def test_metadata_description_matches_static_registry(self) -> None:
        """Verify the control description agrees with the CORE_CONTROLS mirror."""
        control = ParallelControl()
        assert CORE_CONTROLS[ControlId.PARALLEL].description == control.metadata["description"]

    def test_metadata_declares_exactly_three_parameters(self) -> None:
        """Verify branches, join and time_limit are the only declared parameters."""
        # Guard: wait_strategy, wait_condition and timeout must stay deleted.
        control = ParallelControl()
        params = control.metadata["parameter_schema"]
        assert [p.name for p in params] == ["branches", "join", "time_limit"]

    def test_metadata_branches_parameter_is_a_required_array(self) -> None:
        """Verify branches is a required array parameter."""
        control = ParallelControl()
        branches_param = next(
            p for p in control.metadata["parameter_schema"] if p.name == "branches"
        )
        assert branches_param.type == "array"
        assert branches_param.required is True

    def test_metadata_join_parameter_defaults_to_all(self) -> None:
        """Verify join is an optional string defaulting to 'all'."""
        control = ParallelControl()
        join_param = next(p for p in control.metadata["parameter_schema"] if p.name == "join")
        assert join_param.type == "string"
        assert join_param.required is False
        assert join_param.default == "all"

    def test_metadata_join_parameter_offers_two_modes(self) -> None:
        """Verify the join enum is exactly all and first, in that order."""
        control = ParallelControl()
        join_param = next(p for p in control.metadata["parameter_schema"] if p.name == "join")
        assert join_param.enum_values == ["all", "first"]

    def test_metadata_time_limit_parameter_is_an_optional_integer(self) -> None:
        """Verify the section time limit is an optional integer."""
        control = ParallelControl()
        limit_param = next(
            p for p in control.metadata["parameter_schema"] if p.name == "time_limit"
        )
        assert limit_param.type == "integer"
        assert limit_param.required is False
        assert limit_param.default is None

    def test_metadata_has_empty_output_schema(self) -> None:
        """Verify Parallel declares no outputs."""
        # Guard: the placeholder 'results' array output must stay deleted.
        control = ParallelControl()
        assert control.metadata["output_schema"] == []

    def test_metadata_has_scoped_structure_hints(self) -> None:
        """Verify Parallel declares container hints with a then egress."""
        control = ParallelControl()
        assert control.metadata["structure_hints"] == {
            "type": "scoped",
            "branches": ["branch_1", "branch_2", "then"],
            "egress": "then",
            "allows_dynamic_branches": True,
        }


# =============================================================================
# Validation Tests
# =============================================================================


class TestParallelControlValidation:
    """Parallel control parameter validation."""

    def test_validate_accepts_two_named_branches(self) -> None:
        """Verify the minimum legal configuration validates."""
        control = ParallelControl()
        asyncio.run(control.validate({"branches": _two_branches()}))

    def test_validate_accepts_more_than_two_branches(self) -> None:
        """Verify a three-branch section validates."""
        control = ParallelControl()
        branches = [*_two_branches(), _branch("branch_3", "verify")]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_unnamed_branches(self) -> None:
        """Verify branches with blank names validate; the engine defaults them."""
        control = ParallelControl()
        branches = [_branch("branch_1"), _branch("branch_2")]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_accepts_join_all(self) -> None:
        """Verify the default join mode validates when given explicitly."""
        control = ParallelControl()
        asyncio.run(control.validate({"branches": _two_branches(), "join": "all"}))

    def test_validate_accepts_join_first(self) -> None:
        """Verify first-to-finish validates."""
        control = ParallelControl()
        asyncio.run(control.validate({"branches": _two_branches(), "join": "first"}))

    def test_validate_accepts_both_limits_set(self) -> None:
        """Verify a section limit and a per-branch limit validate together."""
        control = ParallelControl()
        branches = [_branch("branch_1", "ingest", 30000), _branch("branch_2", "probe")]
        asyncio.run(control.validate({"branches": branches, "time_limit": 60000}))

    def test_validate_accepts_both_limits_absent(self) -> None:
        """Verify an unbounded section validates."""
        control = ParallelControl()
        asyncio.run(control.validate({"branches": _two_branches()}))

    def test_validate_accepts_a_null_section_limit(self) -> None:
        """Verify an explicitly cleared section limit is treated as unset."""
        control = ParallelControl()
        asyncio.run(control.validate({"branches": _two_branches(), "time_limit": None}))

    def test_validate_accepts_a_null_branch_limit(self) -> None:
        """Verify an explicitly cleared branch limit is treated as unset."""
        control = ParallelControl()
        branches = [
            {"id": "branch_1", "name": "ingest", "time_limit": None},
            _branch("branch_2", "probe"),
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_an_unknown_join_mode(self) -> None:
        """Verify a join mode outside the enum is rejected."""
        control = ParallelControl()
        params = {"branches": _two_branches(), "join": "race"}
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'join' must be one of: all, first; Actual value was 'race'\.$",
        ):
            asyncio.run(control.validate(params))

    def test_validate_rejects_the_removed_wait_any_strategy(self) -> None:
        """Verify the wait-any strategy is not accepted as a join mode."""
        # Guard: a wait_strategy value is not a join value.
        control = ParallelControl()
        params = {"branches": _two_branches(), "join": "wait-any"}
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'join' must be one of: all, first; Actual value was 'wait-any'\.$",
        ):
            asyncio.run(control.validate(params))

    def test_validate_rejects_missing_branches(self) -> None:
        """Verify validation fails when the branches parameter is missing."""
        control = ParallelControl()
        with pytest.raises(ValueError, match="^Parallel requires at least 2 branches$"):
            asyncio.run(control.validate({}))

    def test_validate_rejects_a_single_branch(self) -> None:
        """Verify one branch is rejected - a lone branch is a sequence."""
        control = ParallelControl()
        params = {"branches": [_branch("branch_1", "only")]}
        with pytest.raises(ValueError, match="^Parallel requires at least 2 branches$"):
            asyncio.run(control.validate(params))

    def test_validate_rejects_an_empty_branch_list(self) -> None:
        """Verify an empty branch list is rejected."""
        control = ParallelControl()
        with pytest.raises(ValueError, match="^Parallel requires at least 2 branches$"):
            asyncio.run(control.validate({"branches": []}))

    def test_validate_rejects_an_integer_branch_count(self) -> None:
        """Verify an integer branch count is rejected outright."""
        # Guard: branches is a list of records, never a count.
        control = ParallelControl()
        with pytest.raises(ValueError, match="^Parallel requires at least 2 branches$"):
            asyncio.run(control.validate({"branches": 2}))

    def test_validate_rejects_a_string_branch_list(self) -> None:
        """Verify a string is rejected as a branch list."""
        control = ParallelControl()
        with pytest.raises(ValueError, match="^Parallel requires at least 2 branches$"):
            asyncio.run(control.validate({"branches": "branch_1,branch_2"}))

    def test_validate_rejects_a_zero_section_limit(self) -> None:
        """Verify a zero section limit is rejected."""
        control = ParallelControl()
        params = {"branches": _two_branches(), "time_limit": 0}
        with pytest.raises(ValueError, match="^Parallel time limit must be a positive integer$"):
            asyncio.run(control.validate(params))

    def test_validate_rejects_a_negative_section_limit(self) -> None:
        """Verify a negative section limit is rejected."""
        control = ParallelControl()
        params = {"branches": _two_branches(), "time_limit": -1}
        with pytest.raises(ValueError, match="^Parallel time limit must be a positive integer$"):
            asyncio.run(control.validate(params))

    @pytest.mark.parametrize("limit", ["30s", "+30", "1e3", " 30", "30.0"])
    def test_validate_rejects_a_section_limit_that_is_no_whole_number(self, limit: str) -> None:
        """Verify text that breaks the number rule is rejected as a section limit (REQ-3.1.3.14)."""
        control = ParallelControl()
        params = {"branches": _two_branches(), "time_limit": limit}
        with pytest.raises(ValueError, match="^Parallel time limit must be a positive integer$"):
            asyncio.run(control.validate(params))

    def test_validate_takes_a_section_limit_written_as_its_digits(self) -> None:
        """Verify digit text is the limit it spells (REQ-3.1.3.14)."""
        control = ParallelControl()
        asyncio.run(control.validate({"branches": _two_branches(), "time_limit": "30000"}))

    def test_validate_rejects_a_boolean_section_limit(self) -> None:
        """Verify True is not accepted as a section limit of 1 ms."""
        # Guard: bool is an int in Python; the limit check must exclude it.
        control = ParallelControl()
        params = {"branches": _two_branches(), "time_limit": True}
        with pytest.raises(ValueError, match="^Parallel time limit must be a positive integer$"):
            asyncio.run(control.validate(params))

    def test_validate_rejects_a_zero_branch_limit(self) -> None:
        """Verify a zero per-branch limit is rejected."""
        control = ParallelControl()
        branches = [_branch("branch_1", "ingest", 0), _branch("branch_2", "probe")]
        with pytest.raises(
            ValueError, match="^Parallel branch time limit must be a positive integer$"
        ):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_a_negative_branch_limit(self) -> None:
        """Verify a negative per-branch limit is rejected."""
        control = ParallelControl()
        branches = [_branch("branch_1", "ingest"), _branch("branch_2", "probe", -5)]
        with pytest.raises(
            ValueError, match="^Parallel branch time limit must be a positive integer$"
        ):
            asyncio.run(control.validate({"branches": branches}))

    @pytest.mark.parametrize("limit", ["30s", "+30", "1e3", " 30", "0", "12345678901234567890"])
    def test_validate_rejects_a_branch_limit_that_is_no_whole_number(self, limit: str) -> None:
        """Verify text that breaks the number rule or is not above 0 is rejected (REQ-3.1.3.14)."""
        control = ParallelControl()
        branches = [_branch("branch_1", "ingest", limit), _branch("branch_2", "probe")]
        with pytest.raises(
            ValueError, match="^Parallel branch time limit must be a positive integer$"
        ):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_takes_a_branch_limit_written_as_its_digits(self) -> None:
        """Verify digit text, as the canvas sends a limit no JS number holds, is the limit."""
        control = ParallelControl()
        branches = [
            _branch("branch_1", "ingest", "9007199254740993"),
            _branch("branch_2", "probe", "030000"),
        ]
        asyncio.run(control.validate({"branches": branches}))

    def test_validate_rejects_a_boolean_branch_limit(self) -> None:
        """Verify True is not accepted as a branch limit of 1 ms."""
        control = ParallelControl()
        branches = [_branch("branch_1", "ingest"), _branch("branch_2", "probe", True)]
        with pytest.raises(
            ValueError, match="^Parallel branch time limit must be a positive integer$"
        ):
            asyncio.run(control.validate({"branches": branches}))

    def test_validate_ignores_the_limit_check_for_a_non_mapping_branch(self) -> None:
        """Verify a branch that is not a record carries no limit to check.

        Malformed branch entries are the recipe validator's rejection; the
        control's limit rule only applies to branch records.
        """
        control = ParallelControl()
        asyncio.run(control.validate({"branches": ["branch_1", "branch_2"]}))


class TestParallelControlValidationOrdering:
    """The pinned order of Parallel validation rules."""

    def test_join_is_checked_before_the_branch_count(self) -> None:
        """Verify a bad join mode wins over a missing branch list."""
        control = ParallelControl()
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'join' must be one of: all, first; Actual value was 'race'\.$",
        ):
            asyncio.run(control.validate({"join": "race"}))

    def test_branch_count_is_checked_before_the_section_limit(self) -> None:
        """Verify a single branch wins over an invalid section limit."""
        control = ParallelControl()
        params = {"branches": [_branch("branch_1")], "time_limit": 0}
        with pytest.raises(ValueError, match="^Parallel requires at least 2 branches$"):
            asyncio.run(control.validate(params))

    def test_section_limit_is_checked_before_the_branch_limits(self) -> None:
        """Verify an invalid section limit wins over an invalid branch limit."""
        control = ParallelControl()
        branches = [_branch("branch_1", "ingest", 0), _branch("branch_2", "probe")]
        params = {"branches": branches, "time_limit": -1}
        with pytest.raises(ValueError, match="^Parallel time limit must be a positive integer$"):
            asyncio.run(control.validate(params))


# =============================================================================
# Execution Tests - Signal Shape
# =============================================================================


class TestParallelControlExecution:
    """Parallel control signal emission."""

    def test_execute_returns_the_parallel_signal(self) -> None:
        """Verify execute returns the container signal with the branches verbatim."""
        control = ParallelControl()
        branches = _two_branches()
        context = {"parameters": {"branches": branches}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert result == {
            "__parallel": True,
            "__branches": branches,
            "__join": "all",
            "__time_limit": None,
        }

    def test_execute_returns_only_the_four_signal_keys(self) -> None:
        """Verify no other key rides along on the signal."""
        control = ParallelControl()
        context = {"parameters": {"branches": _two_branches()}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert set(result) == {"__parallel", "__branches", "__join", "__time_limit"}
        assert result["__parallel"] is True

    def test_execute_defaults_the_join_mode_to_all(self) -> None:
        """Verify an omitted join mode emits 'all'."""
        control = ParallelControl()
        context = {"parameters": {"branches": _two_branches()}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert result["__join"] == "all"

    def test_execute_carries_the_first_to_finish_join_mode(self) -> None:
        """Verify first-to-finish reaches the engine unchanged."""
        control = ParallelControl()
        context = {
            "parameters": {"branches": _two_branches(), "join": "first"},
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result["__join"] == "first"

    def test_execute_carries_the_section_time_limit(self) -> None:
        """Verify the section limit reaches the engine unchanged."""
        control = ParallelControl()
        context = {
            "parameters": {"branches": _two_branches(), "time_limit": 45000},
            "variables": {},
        }
        result = asyncio.run(control.execute(context))
        assert result["__time_limit"] == 45000

    def test_execute_round_trips_every_branch_key_in_order(self) -> None:
        """Verify branch order, names and per-branch limits survive the signal."""
        control = ParallelControl()
        branches = [
            _branch("branch_1", "ingest", 30000),
            _branch("branch_2", "probe"),
            _branch("branch_3", ""),
        ]
        context = {"parameters": {"branches": branches}, "variables": {}}
        result = asyncio.run(control.execute(context))
        emitted = result["__branches"]
        assert emitted == branches
        assert [b["id"] for b in emitted] == ["branch_1", "branch_2", "branch_3"]
        assert emitted[0]["time_limit"] == 30000
        assert "time_limit" not in emitted[1]

    def test_execute_emits_an_empty_branch_list_unchanged(self) -> None:
        """Verify execute does not re-validate; the engine sees what was stored."""
        control = ParallelControl()
        context = {"parameters": {}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert result["__branches"] == []

    def test_execute_binds_no_output(self) -> None:
        """Verify no bindable value rides on the signal."""
        # Guard: nothing stands in for the deleted 'results' output.
        control = ParallelControl()
        context = {"parameters": {"branches": _two_branches()}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert "results" not in result


class TestParallelControlLogging:
    """Parallel emits no log line; per-branch logging is the dispatcher's."""

    def test_execute_emits_no_logger_call(self) -> None:
        """Verify the control never touches the session logger."""
        control = ParallelControl()
        logger = MagicMock()
        context = {
            "parameters": {"branches": _two_branches()},
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        assert logger.mock_calls == []

    def test_no_logger_does_not_crash(self) -> None:
        """Verify execution works without a logger."""
        control = ParallelControl()
        context = {"parameters": {"branches": _two_branches()}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert result["__parallel"] is True
