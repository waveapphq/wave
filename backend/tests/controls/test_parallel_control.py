"""Tests for ParallelControl.

Metadata, the container signal ``execute`` emits, and parameter validation for
the Parallel control. Covers REQ-3.2.3.6 (join modes), REQ-3.2.3.7 (time
limits), the container with a ``then`` egress, two join modes, two
independent limits, no outputs and a minimum of two branches.
"""

import asyncio
from collections.abc import Collection
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.core.run_fill_support import run_fill
from wavecore.controls.flow import ParallelControl
from wavecore.core.execution import field_checks
from wavecore.core.execution.field_checks import FieldFinding
from wavecore.models.controls.metadata import CORE_CONTROLS
from wavecore.models.enums import ControlId

# =============================================================================
# Helpers
# =============================================================================

_TWO_LANE_PROBLEM = FieldFinding(
    "INVALID_CONTROL_STRUCTURE", "Parallel requires at least 2 branches", None, "branches"
)


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


def _lane_limit_problem(index: int) -> FieldFinding:
    return FieldFinding(
        "INVALID_SETTING_VALUE",
        "Parallel branch time limit must be a positive integer",
        None,
        f"branches.{index}.time_limit",
    )


def _structure_problems(
    values: dict[str, Any], sources: Collection[str] = ()
) -> list[FieldFinding]:
    return ParallelControl().structure_problems(values, sources)


def _run_fill(stored: dict[str, Any]) -> dict[str, Any]:
    return run_fill(ParallelControl(), stored)


def _start_block(
    branches: list[dict[str, Any]], expression_fields: set[str], variables: dict[str, Any]
) -> Any:
    """Start a stored Parallel Block the way the workbench starts every control."""
    from wavecore.api.services.workbench.plugins import _execute_control

    with patch(
        "wavecore.controls.registry.get_control_implementation", return_value=ParallelControl
    ):
        return asyncio.run(
            _execute_control(
                control_type="parallel",
                version="1.0.0",
                parameters={"branches": branches},
                variables=variables,
                expression_fields=expression_fields,
            )
        )


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

    def test_metadata_time_limit_parameter_declares_minimum_one(self) -> None:
        """Verify the section floor is a declared minimum the shared save check reads."""
        limit_param = next(
            p for p in ParallelControl().metadata["parameter_schema"] if p.name == "time_limit"
        )
        assert limit_param.minimum is not None
        assert limit_param.minimum == 1

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

    def test_the_run_fill_rejects_an_unknown_join_mode(self) -> None:
        """Verify a join mode outside the enum stops the Block before validate() runs."""
        params = {"branches": _two_branches(), "join": "race"}
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'join' must be one of: all, first; Actual value was 'race'\.$",
        ):
            _run_fill(params)

    def test_the_run_fill_rejects_wait_any_as_a_join_mode(self) -> None:
        """Verify the wait-any strategy is not accepted as a join mode."""
        # Guard: a wait_strategy value is not a join value.
        params = {"branches": _two_branches(), "join": "wait-any"}
        with pytest.raises(
            ValueError,
            match=r"^Parameter 'join' must be one of: all, first; Actual value was 'wait-any'\.$",
        ):
            _run_fill(params)

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
# Structure Problems (REQ-3.5.0.3)
# =============================================================================


class TestParallelStructureProblems:
    """The lane rules the save check and validate() share, each at its place."""

    def test_two_lanes_or_more_have_no_problem(self) -> None:
        three = [*_two_branches(), _branch("branch_3", "verify", 30000)]

        assert _structure_problems({"branches": _two_branches()}) == []
        assert _structure_problems({"branches": three}) == []

    def test_one_lane_is_reported(self) -> None:
        problems = _structure_problems({"branches": [_branch("branch_1", "only")]})

        assert problems == [_TWO_LANE_PROBLEM]

    def test_a_lane_id_used_again_is_reported_at_the_later_lane(self) -> None:
        """Lane ids are unique, as If/Else and Switch branch ids are (REQ-3.5.0.3)."""
        lanes = [_branch("branch_1", "A"), _branch("branch_2", "B"), _branch("branch_1", "C")]

        assert _structure_problems({"branches": lanes}) == [
            FieldFinding(
                "INVALID_CONTROL_STRUCTURE",
                "duplicate branch id: 'branch_1'",
                None,
                "branches.2.id",
            )
        ]

    def test_lanes_with_no_id_have_no_duplicate_problem(self) -> None:
        assert _structure_problems({"branches": [{"name": "A"}, {"name": "B"}]}) == []

    def test_validate_rejects_two_lanes_of_one_id_with_the_save_text(self) -> None:
        params = {"branches": [_branch("branch_1", "A"), _branch("branch_1", "B")], "join": "all"}

        with pytest.raises(ValueError, match="^duplicate branch id: 'branch_1'$"):
            asyncio.run(ParallelControl().validate(params))

    @pytest.mark.parametrize("limit", [0, -1, "0"], ids=["zero", "negative", "zero-as-digits"])
    def test_the_section_limit_is_no_structure_problem(self, limit: int | str) -> None:
        # The section floor is the declared minimum of 'time_limit', checked by the shared check.
        assert _structure_problems({"branches": _two_branches(), "time_limit": limit}) == []

    @pytest.mark.parametrize("limit", [0, -5, "0"], ids=["zero", "negative", "zero-as-digits"])
    def test_a_lane_limit_below_one_is_reported_at_its_place(self, limit: int | str) -> None:
        one_bad = [_branch("branch_1", "ingest"), _branch("branch_2", "probe", limit)]
        two_bad = [
            _branch("branch_1", "ingest", limit),
            _branch("branch_2", "probe", 30000),
            _branch("branch_3", "verify", limit),
        ]

        assert _structure_problems({"branches": one_bad}) == [_lane_limit_problem(1)]
        assert _structure_problems({"branches": two_bad}) == [
            _lane_limit_problem(0),
            _lane_limit_problem(2),
        ]

    @pytest.mark.parametrize(
        "limit", ["30s", "+30", "1e3", " 30", "12345678901234567890", True, 1.5]
    )
    def test_a_lane_limit_that_is_no_whole_number_is_reported(self, limit: Any) -> None:
        branches = [_branch("branch_1", "ingest"), _branch("branch_2", "probe", limit)]

        assert _structure_problems({"branches": branches}) == [_lane_limit_problem(1)]

    def test_a_lane_limit_written_as_digits_is_taken(self) -> None:
        branches = [
            _branch("branch_1", "ingest", "9007199254740993"),
            _branch("branch_2", "probe", "030000"),
        ]

        assert _structure_problems({"branches": branches}) == []

    def test_a_null_lane_limit_means_no_limit(self) -> None:
        branches = [
            {"id": "branch_1", "name": "ingest", "time_limit": None},
            _branch("branch_2", "probe"),
        ]

        assert _structure_problems({"branches": branches}) == []

    def test_a_flagged_lane_limit_is_skipped(self) -> None:
        branches = [_branch("branch_1", "ingest"), _branch("branch_2", "probe", "lane_ms * 2")]

        assert _structure_problems({"branches": branches}, {"branches.1.time_limit"}) == []
        assert _structure_problems({"branches": branches}) == [_lane_limit_problem(1)]

    @pytest.mark.parametrize("text", ["", "   "])
    def test_a_flagged_blank_lane_limit_is_required_param_empty(self, text: str) -> None:
        branches = [_branch("branch_1", "ingest"), _branch("branch_2", "probe", text)]

        problems = _structure_problems({"branches": branches}, {"branches.1.time_limit"})

        assert problems == [
            FieldFinding(
                "REQUIRED_PARAM_EMPTY",
                "Required parameter 'branches.1.time_limit' is empty",
                None,
                "branches.1.time_limit",
            )
        ]

    @pytest.mark.parametrize(
        ("values", "shared"),
        [
            (
                {},
                FieldFinding(
                    "REQUIRED_PARAM_MISSING",
                    "Required parameter 'branches' is missing",
                    None,
                    "branches",
                ),
            ),
            (
                {"branches": []},
                FieldFinding(
                    "REQUIRED_PARAM_EMPTY",
                    "Required parameter 'branches' is empty",
                    None,
                    "branches",
                ),
            ),
        ],
        ids=["missing", "empty"],
    )
    def test_a_missing_or_empty_lane_list_gives_the_two_lane_problem(
        self, values: dict[str, Any], shared: FieldFinding
    ) -> None:
        required = field_checks.check_block_fields(
            ParallelControl().metadata["parameter_schema"],
            values,
            block_id="parallel",
            expression_fields=set(),
            template_fields=set(),
            check_required=True,
        )

        assert _structure_problems(values) == [_TWO_LANE_PROBLEM]
        assert required == [shared]

    @pytest.mark.parametrize(
        "lanes", [None, 2, "branch_1,branch_2"], ids=["null", "a-count", "text"]
    )
    def test_a_lane_value_that_is_no_list_gives_the_two_lane_problem(self, lanes: Any) -> None:
        assert _structure_problems({"branches": lanes}) == [_TWO_LANE_PROBLEM]


class TestLaneLimitExpression:
    """A lane limit flagged {x} resolves per lane when the Block starts (REQ-3.2.3.7)."""

    def test_a_lane_limit_expression_resolves_per_lane_at_block_start(self) -> None:
        branches = [
            _branch("branch_1", "ingest", 30000),
            _branch("branch_2", "probe", "lane_ms * 2"),
        ]

        result = _start_block(branches, {"branches.1.time_limit"}, {"lane_ms": 1500})

        assert result["__branches"] == [
            _branch("branch_1", "ingest", 30000),
            _branch("branch_2", "probe", 3000),
        ]
        assert branches[1]["time_limit"] == "lane_ms * 2"

    def test_a_lane_limit_expression_that_gives_zero_stops_the_block_with_the_save_text(
        self,
    ) -> None:
        branches = [_branch("branch_1", "ingest"), _branch("branch_2", "probe", "lane_ms * 2")]

        with pytest.raises(
            ValueError, match="^Parallel branch time limit must be a positive integer$"
        ):
            _start_block(branches, {"branches.1.time_limit"}, {"lane_ms": 0})


# =============================================================================
# Execution Tests - Signal Shape
# =============================================================================


class TestParallelControlExecution:
    """Parallel control signal emission."""

    def test_execute_returns_the_parallel_signal(self) -> None:
        """Verify execute returns the container signal with the branches verbatim."""
        control = ParallelControl()
        branches = _two_branches()
        context = {"parameters": {"branches": branches, "join": "all"}, "variables": {}}
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
        context = {"parameters": {"branches": _two_branches(), "join": "all"}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert set(result) == {"__parallel", "__branches", "__join", "__time_limit"}
        assert result["__parallel"] is True

    def test_execute_defaults_the_join_mode_to_all(self) -> None:
        """Verify an omitted join mode emits 'all', the default the run fills in."""
        control = ParallelControl()
        context = {"parameters": _run_fill({"branches": _two_branches()}), "variables": {}}
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
            "parameters": {"branches": _two_branches(), "join": "all", "time_limit": 45000},
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
        context = {"parameters": {"branches": branches, "join": "all"}, "variables": {}}
        result = asyncio.run(control.execute(context))
        emitted = result["__branches"]
        assert emitted == branches
        assert [b["id"] for b in emitted] == ["branch_1", "branch_2", "branch_3"]
        assert emitted[0]["time_limit"] == 30000
        assert "time_limit" not in emitted[1]

    def test_execute_emits_an_empty_branch_list_unchanged(self) -> None:
        """Verify execute does not re-validate; the engine sees what was stored."""
        control = ParallelControl()
        context = {"parameters": {"join": "all"}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert result["__branches"] == []

    def test_execute_binds_no_output(self) -> None:
        """Verify no bindable value rides on the signal."""
        # Guard: nothing stands in for the deleted 'results' output.
        control = ParallelControl()
        context = {"parameters": {"branches": _two_branches(), "join": "all"}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert "results" not in result


class TestParallelControlLogging:
    """Parallel emits no log line; per-branch logging is the dispatcher's."""

    def test_execute_emits_no_logger_call(self) -> None:
        """Verify the control never touches the session logger."""
        control = ParallelControl()
        logger = MagicMock()
        context = {
            "parameters": {"branches": _two_branches(), "join": "all"},
            "variables": {},
            "logger": logger,
        }
        asyncio.run(control.execute(context))
        assert logger.mock_calls == []

    def test_no_logger_does_not_crash(self) -> None:
        """Verify execution works without a logger."""
        control = ParallelControl()
        context = {"parameters": {"branches": _two_branches(), "join": "all"}, "variables": {}}
        result = asyncio.run(control.execute(context))
        assert result["__parallel"] is True
