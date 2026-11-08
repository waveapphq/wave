"""Unit tests for regression variable type collision detection.

Tests the regression variable validation at
``wavecore.api.services.regressions.variable_validation``.

The regression variable validation follows the same pattern as suite variable
validation but operates at a different level of the hierarchy:
- Suite validation: checks across suites that share tests
- Regression validation: checks regression variables against its member suites' variables

Test Coverage:
- compute_regression_variable_delta: new vars, type changes, no changes, empty
- check_variable_collisions_for_regression: type mismatch detection against suites,
  no collision when types match, empty cases, self-exclusion logic
- Integration with update_regression: validation before save, explicit suite IDs
- Integration with add_suite path: validate when adding a suite to a regression
- Integration with import path: validate during regression import
- Error response structure: collision detail format
"""

from typing import Any
from unittest.mock import patch

import pytest

from tests.api.regression_test_helpers import clear_regression_storage
from tests.api.suite_test_helpers import clear_suite_storage

# ============================================================================
# Delta computation
# ============================================================================


class TestComputeRegressionVariableDelta:
    """Tests for compute_regression_variable_delta.

    This mirrors suite's compute_variable_delta but operates on regression
    variables vs suite variables.
    """

    def test_returns_empty_when_no_changes(self) -> None:
        """No delta when current and proposed have same types."""
        from wavecore.api.services.regressions.variable_validation import (
            compute_regression_variable_delta,
        )

        current: dict[str, Any] = {
            "host": {"type": "string", "value": "localhost"},
            "port": {"type": "integer", "value": 8080},
        }
        proposed: dict[str, Any] = {
            "host": {"type": "string", "value": "remote"},
            "port": {"type": "integer", "value": 9090},
        }

        result = compute_regression_variable_delta(current, proposed)

        assert result == []

    def test_detects_new_variable(self) -> None:
        """New variable names appear in the delta."""
        from wavecore.api.services.regressions.variable_validation import (
            compute_regression_variable_delta,
        )

        current: dict[str, Any] = {"host": {"type": "string", "value": "localhost"}}
        proposed: dict[str, Any] = {
            "host": {"type": "string", "value": "localhost"},
            "timeout": {"type": "integer", "value": 30},
        }

        result = compute_regression_variable_delta(current, proposed)

        assert result == ["timeout"]

    def test_detects_type_change(self) -> None:
        """A variable whose type changed appears in the delta."""
        from wavecore.api.services.regressions.variable_validation import (
            compute_regression_variable_delta,
        )

        current: dict[str, Any] = {"port": {"type": "string", "value": "8080"}}
        proposed: dict[str, Any] = {"port": {"type": "integer", "value": 8080}}

        result = compute_regression_variable_delta(current, proposed)

        assert result == ["port"]

    def test_ignores_removed_variables(self) -> None:
        """Variables removed from proposed do not appear in the delta."""
        from wavecore.api.services.regressions.variable_validation import (
            compute_regression_variable_delta,
        )

        current: dict[str, Any] = {
            "host": {"type": "string", "value": "localhost"},
            "port": {"type": "integer", "value": 8080},
        }
        proposed: dict[str, Any] = {"host": {"type": "string", "value": "localhost"}}

        result = compute_regression_variable_delta(current, proposed)

        assert result == []

    def test_handles_empty_current(self) -> None:
        """All proposed variables are new when current is empty."""
        from wavecore.api.services.regressions.variable_validation import (
            compute_regression_variable_delta,
        )

        current: dict[str, Any] = {}
        proposed: dict[str, Any] = {
            "host": {"type": "string", "value": "a"},
            "port": {"type": "integer", "value": 1},
        }

        result = compute_regression_variable_delta(current, proposed)

        assert sorted(result) == ["host", "port"]

    def test_handles_empty_proposed(self) -> None:
        """No delta when proposed is empty."""
        from wavecore.api.services.regressions.variable_validation import (
            compute_regression_variable_delta,
        )

        current: dict[str, Any] = {"host": {"type": "string", "value": "a"}}
        proposed: dict[str, Any] = {}

        result = compute_regression_variable_delta(current, proposed)

        assert result == []

    def test_handles_non_dict_variable(self) -> None:
        """Non-dict variables default to type 'string'."""
        from wavecore.api.services.regressions.variable_validation import (
            compute_regression_variable_delta,
        )

        current: dict[str, Any] = {"simple": "old_value"}
        proposed: dict[str, Any] = {"simple": "new_value"}

        result = compute_regression_variable_delta(current, proposed)

        assert result == []

    def test_non_dict_to_dict_type_change(self) -> None:
        """Changing from a non-dict variable to a dict with non-string type is a delta."""
        from wavecore.api.services.regressions.variable_validation import (
            compute_regression_variable_delta,
        )

        current: dict[str, Any] = {"port": "8080"}
        proposed: dict[str, Any] = {"port": {"type": "integer", "value": 8080}}

        result = compute_regression_variable_delta(current, proposed)

        assert result == ["port"]

    def test_multiple_changes(self) -> None:
        """Multiple new and changed variables appear in the delta."""
        from wavecore.api.services.regressions.variable_validation import (
            compute_regression_variable_delta,
        )

        current: dict[str, Any] = {
            "a": {"type": "string", "value": "1"},
            "b": {"type": "integer", "value": 2},
        }
        proposed: dict[str, Any] = {
            "a": {"type": "boolean", "value": True},  # type changed
            "b": {"type": "integer", "value": 99},  # same type
            "c": {"type": "float", "value": 1.5},  # new
        }

        result = compute_regression_variable_delta(current, proposed)

        assert sorted(result) == ["a", "c"]


# ============================================================================
# Collision detection against member suites
# ============================================================================


class TestCheckVariableCollisionsForRegression:
    """Tests for check_variable_collisions_for_regression.

    This function checks whether the regression's proposed variables conflict
    (in type) with variables of the same name in the regression's member suites.
    For example, if regression proposes ``env: string`` but suite S1 has
    ``env: integer``, that is a collision.
    """

    def test_no_collision_when_no_suites(self) -> None:
        """No collision when regression has no suites."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        result = check_variable_collisions_for_regression(
            suite_ids=[],
            variable_names_to_check=["env"],
            proposed_variables={"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_no_collision_when_types_match(self) -> None:
        """No collision when suite has the same type for the variable."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        suite_id = "suite-1"
        suite_data = {
            "id": suite_id,
            "name": "Suite One",
            "variables": {"env": {"type": "string", "value": "prod"}},
        }

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            return_value=suite_data,
        ):
            result = check_variable_collisions_for_regression(
                suite_ids=[suite_id],
                variable_names_to_check=["env"],
                proposed_variables={"env": {"type": "string", "value": "dev"}},
            )

        assert result == []

    def test_detects_type_collision(self) -> None:
        """Detects collision when suite has different type for the same variable."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        suite_id = "suite-1"
        suite_data = {
            "id": suite_id,
            "name": "Suite One",
            "variables": {"retry": {"type": "integer", "value": 3}},
        }

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            return_value=suite_data,
        ):
            result = check_variable_collisions_for_regression(
                suite_ids=[suite_id],
                variable_names_to_check=["retry"],
                proposed_variables={"retry": {"type": "string", "value": "3"}},
            )

        assert len(result) == 1
        assert result[0]["variable"] == "retry"
        assert result[0]["this_type"] == "string"
        assert result[0]["other_suite"] == "Suite One"
        assert result[0]["other_suite_id"] == suite_id
        assert result[0]["other_type"] == "integer"

    def test_empty_variable_names_returns_empty(self) -> None:
        """Returns empty list when no variable names are given to check."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        result = check_variable_collisions_for_regression(
            suite_ids=["suite-1"],
            variable_names_to_check=[],
            proposed_variables={},
        )

        assert result == []

    def test_variable_not_in_suite_no_collision(self) -> None:
        """No collision when the suite does not have the variable at all."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        suite_id = "suite-1"
        suite_data = {
            "id": suite_id,
            "name": "Suite One",
            "variables": {"other_var": {"type": "integer", "value": 1}},
        }

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            return_value=suite_data,
        ):
            result = check_variable_collisions_for_regression(
                suite_ids=[suite_id],
                variable_names_to_check=["env"],
                proposed_variables={"env": {"type": "string", "value": "dev"}},
            )

        assert result == []

    def test_skips_deleted_suite(self) -> None:
        """Gracefully skips suites whose files have been deleted."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            return_value=None,
        ):
            result = check_variable_collisions_for_regression(
                suite_ids=["deleted-suite"],
                variable_names_to_check=["env"],
                proposed_variables={"env": {"type": "string", "value": "dev"}},
            )

        assert result == []

    def test_multiple_collisions_across_suites(self) -> None:
        """Detects collisions from multiple member suites."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        suite_1 = {
            "id": "s1",
            "name": "Suite A",
            "variables": {"env": {"type": "integer", "value": 1}},
        }
        suite_2 = {
            "id": "s2",
            "name": "Suite B",
            "variables": {"env": {"type": "boolean", "value": True}},
        }

        def load_suite_side_effect(suite_id: str) -> dict[str, Any] | None:
            return {"s1": suite_1, "s2": suite_2}.get(suite_id)

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            side_effect=load_suite_side_effect,
        ):
            result = check_variable_collisions_for_regression(
                suite_ids=["s1", "s2"],
                variable_names_to_check=["env"],
                proposed_variables={"env": {"type": "string", "value": "dev"}},
            )

        assert len(result) == 2
        other_suites = {c["other_suite"] for c in result}
        assert other_suites == {"Suite A", "Suite B"}

    def test_multiple_variables_checked(self) -> None:
        """Checks multiple variable names independently against suites."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        suite_data = {
            "id": "s1",
            "name": "Suite A",
            "variables": {
                "env": {"type": "integer", "value": 1},
                "timeout": {"type": "string", "value": "30"},
            },
        }

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            return_value=suite_data,
        ):
            result = check_variable_collisions_for_regression(
                suite_ids=["s1"],
                variable_names_to_check=["env", "timeout"],
                proposed_variables={
                    "env": {"type": "string", "value": "dev"},
                    "timeout": {"type": "integer", "value": 30},
                },
            )

        assert len(result) == 2
        collision_vars = {c["variable"] for c in result}
        assert collision_vars == {"env", "timeout"}

    def test_suite_with_no_variables_no_collision(self) -> None:
        """No collision when suite has no variables."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        suite_data = {
            "id": "s1",
            "name": "Empty Suite",
            "variables": {},
        }

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            return_value=suite_data,
        ):
            result = check_variable_collisions_for_regression(
                suite_ids=["s1"],
                variable_names_to_check=["env"],
                proposed_variables={"env": {"type": "string", "value": "dev"}},
            )

        assert result == []


# ============================================================================
# Validation in update_regression path
# ============================================================================


class TestRegressionUpdateCollisionValidation:
    """Tests for collision validation in the update_regression path.

    Collision validation MUST be in update_regression() because the UI calls
    PUT for everything. Validate BEFORE save.
    """

    def setup_method(self) -> None:
        """Reset storage before each test."""
        clear_regression_storage()
        clear_suite_storage()

    def test_update_with_colliding_variables_raises_conflict(self) -> None:
        """update_regression raises ConflictException when variable types collide with suites."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Suite With Vars",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "My Regression",
                "suites": [suite["id"]],
            }
        )

        from wavecore.api.exceptions import ConflictException

        with pytest.raises(ConflictException, match="Variable type collision"):
            regression_service.update_regression(
                regression["id"],
                {
                    "variables": {"env": {"type": "string", "value": "dev"}},
                    "suites": [suite["id"]],
                },
            )

    def test_update_with_matching_types_succeeds(self) -> None:
        """update_regression succeeds when proposed variable types match suite variables."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Suite With Vars",
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "My Regression",
                "suites": [suite["id"]],
            }
        )

        result = regression_service.update_regression(
            regression["id"],
            {
                "variables": {"env": {"type": "string", "value": "staging"}},
                "suites": [suite["id"]],
            },
        )

        assert result is not None
        assert result["variables"]["env"]["value"] == "staging"

    def test_update_validates_before_save(self) -> None:
        """Collision check runs BEFORE saving - regression is not modified on failure."""
        from tests.api.regression_test_helpers import load_regression_file
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Suite With Integer Env",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Pre-Save Check",
                "suites": [suite["id"]],
                "variables": {},
            }
        )

        original_version = regression["version"]

        from wavecore.api.exceptions import ConflictException

        with pytest.raises(ConflictException):
            regression_service.update_regression(
                regression["id"],
                {"variables": {"env": {"type": "string", "value": "dev"}}},
            )

        # Verify the regression was NOT modified
        stored = load_regression_file(regression["id"])
        assert stored is not None
        assert stored["version"] == original_version
        assert stored.get("variables", {}) == {}

    def test_update_with_new_suites_validates_against_new_suite_list(self) -> None:
        """When update changes both variables and suites, validates against new suite list."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite_a = suite_service.create_suite(
            {
                "name": "Suite A",
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )
        suite_b = suite_service.create_suite(
            {
                "name": "Suite B",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Multi Suite Regression",
                "suites": [suite_a["id"]],
            }
        )

        # Adding suite_b alongside a string 'env' variable should collide
        from wavecore.api.exceptions import ConflictException

        with pytest.raises(ConflictException, match="Variable type collision"):
            regression_service.update_regression(
                regression["id"],
                {
                    "suites": [suite_a["id"], suite_b["id"]],
                    "variables": {"env": {"type": "string", "value": "dev"}},
                },
            )

    def test_delta_only_validation_skips_unchanged_variables(self) -> None:
        """Only changed or new variables are validated, not existing unchanged ones."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Suite With Vars",
                "variables": {
                    "env": {"type": "string", "value": "prod"},
                    "count": {"type": "integer", "value": 5},
                },
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Delta Regression",
                "suites": [suite["id"]],
                "variables": {
                    "env": {"type": "string", "value": "dev"},
                },
            }
        )

        # Adding a new variable 'timeout' that does not conflict should succeed,
        # even though 'env' is already present (unchanged type)
        result = regression_service.update_regression(
            regression["id"],
            {
                "variables": {
                    "env": {"type": "string", "value": "staging"},  # same type
                    "timeout": {"type": "integer", "value": 30},  # new, no conflict
                },
            },
        )

        assert result is not None


class TestRegressionCreateCollisionValidation:
    """create_regression runs the same variable type check as update_regression."""

    def setup_method(self) -> None:
        """Reset storage and the relation index before each test."""
        from wavecore.api.services.relations import service as relation_service

        clear_regression_storage()
        clear_suite_storage()
        relation_service._test_to_suites.clear()
        relation_service._suite_to_regressions.clear()
        relation_service._initialized = False

    def _stored_regression_names(self) -> list[str]:
        from wavecore.api.services.regressions import service as regression_service

        return sorted(doc["name"] for doc, _ in regression_service.list_regression_documents())

    def test_create_refuses_variables_that_collide_with_a_member_suite(self) -> None:
        """A Regression variable typed unlike the same variable of a member Suite is refused."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {"name": "Suite With Vars", "variables": {"env": {"type": "integer", "value": 1}}}
        )

        with pytest.raises(
            ConflictException,
            match=r"^Variable type collision: variable 'env' is 'string' here but 'integer' "
            r"in suite 'Suite With Vars'$",
        ) as exc_info:
            regression_service.create_regression(
                {
                    "name": "My Regression",
                    "suites": [suite["id"]],
                    "variables": {"env": {"type": "string", "value": "dev"}},
                }
            )

        assert exc_info.value.details is not None
        assert exc_info.value.details["conflicting_suite_ids"] == [suite["id"]]
        assert self._stored_regression_names() == []
        assert relation_service.get_regression_count_for_suite(suite["id"]) == 0

    def test_create_refuses_member_suites_that_collide_with_each_other(self) -> None:
        """Two member Suites that type one variable differently are refused."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite_a = suite_service.create_suite(
            {"name": "Suite A", "variables": {"env": {"type": "integer", "value": 1}}}
        )
        suite_b = suite_service.create_suite(
            {"name": "Suite B", "variables": {"env": {"type": "string", "value": "dev"}}}
        )

        with pytest.raises(
            ConflictException,
            match=r"^Variable type collision: variable 'env' is 'string' in suite 'Suite B' "
            r"but 'integer' in suite 'Suite A'$",
        ):
            regression_service.create_regression(
                {"name": "My Regression", "suites": [suite_a["id"], suite_b["id"]]}
            )

        assert self._stored_regression_names() == []

    def test_create_refuses_variables_that_collide_with_a_sibling_regression(self) -> None:
        """A Regression sharing a Suite with one that types the variable differently is refused."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        shared_suite = suite_service.create_suite({"name": "Shared Suite"})
        sibling = regression_service.create_regression(
            {
                "name": "Sibling Regression",
                "suites": [shared_suite["id"]],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        with pytest.raises(
            ConflictException,
            match=r"^Variable type collision: variable 'env' is 'string' here but 'integer' "
            r"in regression 'Sibling Regression'$",
        ) as exc_info:
            regression_service.create_regression(
                {
                    "name": "Target Regression",
                    "suites": [shared_suite["id"]],
                    "variables": {"env": {"type": "string", "value": "dev"}},
                }
            )

        assert exc_info.value.details is not None
        assert exc_info.value.details["conflicting_regression_ids"] == [sibling["id"]]
        assert self._stored_regression_names() == ["Sibling Regression"]

    def test_create_with_matching_types_succeeds(self) -> None:
        """The same type in the Regression and its member Suite is no collision."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {"name": "Suite With Vars", "variables": {"env": {"type": "string", "value": "a"}}}
        )

        result = regression_service.create_regression(
            {
                "name": "My Regression",
                "suites": [suite["id"]],
                "variables": {"env": {"type": "string", "value": "b"}},
            }
        )

        assert result["suites"] == [suite["id"]]


# ============================================================================
# Validation in add-suite path
# ============================================================================


class TestRegressionAddSuiteCollisionValidation:
    """Tests for collision validation when adding a suite to a regression."""

    def setup_method(self) -> None:
        """Reset storage before each test."""
        clear_regression_storage()
        clear_suite_storage()

    def test_add_suite_with_colliding_variables_raises_conflict(self) -> None:
        """Adding a suite whose variables conflict with regression variables raises error."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Conflicting Suite",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Regression With String Env",
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        from wavecore.api.exceptions import ConflictException

        with pytest.raises(ConflictException, match="Variable type collision"):
            regression_service.update_regression(regression["id"], {"suites": [suite["id"]]})

    def test_add_suite_with_matching_variables_succeeds(self) -> None:
        """Adding a suite whose variables match regression variable types succeeds."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Compatible Suite",
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Regression With String Env",
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        result = regression_service.update_regression(regression["id"], {"suites": [suite["id"]]})

        assert result is not None
        assert suite["id"] in result["suites"]

    def test_add_suite_with_no_regression_variables_succeeds(self) -> None:
        """Adding a suite when regression has no variables always succeeds."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Any Suite",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Regression No Vars",
            }
        )

        result = regression_service.update_regression(regression["id"], {"suites": [suite["id"]]})

        assert result is not None


# ============================================================================
# Collision error response structure (Lesson #7)
# ============================================================================


class TestCollisionErrorStructure:
    """Tests for the collision error response structure.

    The error response must include collision details so the frontend can
    display grouped collision information and offer a "Fix" button.
    """

    def setup_method(self) -> None:
        """Reset storage before each test."""
        clear_regression_storage()
        clear_suite_storage()

    def test_collision_error_includes_details(self) -> None:
        """ConflictException includes collision details for frontend rendering."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Detail Suite",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Detail Regression",
                "suites": [suite["id"]],
            }
        )

        from wavecore.api.exceptions import ConflictException

        with pytest.raises(ConflictException) as exc_info:
            regression_service.update_regression(
                regression["id"],
                {"variables": {"env": {"type": "string", "value": "dev"}}},
            )

        error = exc_info.value
        assert hasattr(error, "details")
        assert "collisions" in error.details
        collisions = error.details["collisions"]
        assert len(collisions) >= 1
        collision = collisions[0]
        assert collision["variable"] == "env"
        assert collision["this_type"] == "string"
        assert collision["other_type"] == "integer"
        assert collision["other_suite"] == "Detail Suite"
        assert collision["other_suite_id"] == suite["id"]

    def test_collision_error_includes_conflicting_suite_ids(self) -> None:
        """ConflictException details include conflicting_suite_ids for Fix button."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Conflict Suite",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Conflict Regression",
                "suites": [suite["id"]],
            }
        )

        from wavecore.api.exceptions import ConflictException

        with pytest.raises(ConflictException) as exc_info:
            regression_service.update_regression(
                regression["id"],
                {"variables": {"env": {"type": "string", "value": "dev"}}},
            )

        error = exc_info.value
        assert "conflicting_suite_ids" in error.details
        assert suite["id"] in error.details["conflicting_suite_ids"]


# ============================================================================
# Regression-to-regression collision (sibling regressions sharing suites)
# ============================================================================


class TestRegressionToRegressionCollision:
    """Tests for collision detection across regressions that share suites.

    Exercises check_variable_collisions_for_suites and its helpers
    (_collect_other_regression_ids, _build_proposed_type_map, _find_collisions,
    _check_regression_collisions).
    """

    def setup_method(self) -> None:
        """Reset storage before each test."""
        clear_regression_storage()
        clear_suite_storage()

    def test_update_detects_sibling_regression_type_conflict(self) -> None:
        """update_regression raises when another regression sharing a suite has a conflicting
        type.
        """
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        shared_suite = suite_service.create_suite({"name": "Shared Suite"})

        # Sibling regression already defines 'env' as integer
        sibling = regression_service.create_regression(
            {
                "name": "Sibling Regression",
                "suites": [shared_suite["id"]],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        # Target regression sharing the same suite tries to use 'env' as string
        target = regression_service.create_regression(
            {
                "name": "Target Regression",
                "suites": [shared_suite["id"]],
            }
        )

        with pytest.raises(ConflictException, match="Variable type collision") as exc_info:
            regression_service.update_regression(
                target["id"],
                {"variables": {"env": {"type": "string", "value": "dev"}}},
            )

        error = exc_info.value
        assert "conflicting_regression_ids" in error.details
        assert sibling["id"] in error.details["conflicting_regression_ids"]
        collisions = error.details["collisions"]
        assert any(c["other_regression"] == "Sibling Regression" for c in collisions)
        assert any(c["other_regression_id"] == sibling["id"] for c in collisions)

    def test_update_excludes_target_regression_from_sibling_scan(self) -> None:
        """The regression being updated is not treated as its own sibling."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite({"name": "Lone Suite"})

        target = regression_service.create_regression(
            {
                "name": "Only Regression",
                "suites": [suite["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        # Updating variables with a compatible type on the same (single) regression
        # must not report a collision against itself.
        result = regression_service.update_regression(
            target["id"],
            {"variables": {"env": {"type": "string", "value": "staging"}}},
        )

        assert result is not None
        assert result["variables"]["env"]["value"] == "staging"

    def test_update_no_sibling_collision_when_no_overlap(self) -> None:
        """No collision when no other regression shares any suites."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite_a = suite_service.create_suite({"name": "Suite A"})
        suite_b = suite_service.create_suite({"name": "Suite B"})

        # Sibling regression uses a different suite - no overlap
        regression_service.create_regression(
            {
                "name": "Unrelated Regression",
                "suites": [suite_b["id"]],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        target = regression_service.create_regression(
            {
                "name": "Target Regression",
                "suites": [suite_a["id"]],
            }
        )

        result = regression_service.update_regression(
            target["id"],
            {"variables": {"env": {"type": "string", "value": "dev"}}},
        )

        assert result is not None
        assert result["variables"]["env"]["type"] == "string"

    def test_add_suite_detects_sibling_regression_conflict(self) -> None:
        """Adding a suite via update_regression raises when it creates a sibling-regression
        collision.
        """
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        shared_suite = suite_service.create_suite({"name": "Shared Suite"})

        # Sibling regression already defines 'env' as integer
        sibling = regression_service.create_regression(
            {
                "name": "Sibling With Integer",
                "suites": [shared_suite["id"]],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        # Target regression declares 'env' as string, but has no suites yet
        target = regression_service.create_regression(
            {
                "name": "Target With String",
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        with pytest.raises(ConflictException, match="Variable type collision") as exc_info:
            regression_service.update_regression(target["id"], {"suites": [shared_suite["id"]]})

        error = exc_info.value
        assert "conflicting_regression_ids" in error.details
        assert sibling["id"] in error.details["conflicting_regression_ids"]

    def test_check_variable_collisions_for_suites_empty_inputs(self) -> None:
        """check_variable_collisions_for_suites returns empty for empty inputs."""
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_suites,
        )

        # No suite ids -> early return
        assert (
            check_variable_collisions_for_suites(
                exclude_regression_id="reg-1",
                suite_ids=[],
                proposed_variables={"env": {"type": "string"}},
            )
            == []
        )

        # No proposed variables -> early return
        assert (
            check_variable_collisions_for_suites(
                exclude_regression_id="reg-1",
                suite_ids=["suite-1"],
                proposed_variables={},
            )
            == []
        )

    def test_check_variable_collisions_for_suites_no_other_regressions(self) -> None:
        """Returns empty list when no sibling regression shares the given suites."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_suites,
        )
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite({"name": "Only Suite"})
        regression = regression_service.create_regression(
            {
                "name": "Only Regression",
                "suites": [suite["id"]],
            }
        )

        # Excluding the only regression - no siblings remain.
        result = check_variable_collisions_for_suites(
            exclude_regression_id=regression["id"],
            suite_ids=[suite["id"]],
            proposed_variables={"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_check_variable_collisions_for_suites_skips_missing_sibling(self) -> None:
        """Siblings whose files are missing on disk are silently skipped."""
        from unittest.mock import patch

        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_suites,
        )

        # Stub the discovery layer to claim a sibling exists at 'ghost-reg'
        # but make the loader return None, so the function hits the
        # "sibling file disappeared" continue branch.
        with (
            patch(
                "wavecore.api.services.regressions._storage._list_all_regressions",
                return_value=[{"id": "ghost-reg", "suites": ["shared-suite"]}],
            ),
            patch(
                "wavecore.api.services.regressions._storage._load_regression",
                return_value=None,
            ),
        ):
            result = check_variable_collisions_for_suites(
                exclude_regression_id="target-reg",
                suite_ids=["shared-suite"],
                proposed_variables={"env": {"type": "string", "value": "dev"}},
            )

        assert result == []

    def test_check_regression_collisions_skips_variables_not_present_in_sibling(self) -> None:
        """Sibling regressions missing the proposed variable name are skipped entirely."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_suites,
        )
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite({"name": "Shared Suite"})
        regression_service.create_regression(
            {
                "name": "Sibling Without Env",
                "suites": [suite["id"]],
                "variables": {"other_var": {"type": "integer", "value": 1}},
            }
        )

        # Sibling does not declare 'env', so no collision can be reported.
        result = check_variable_collisions_for_suites(
            exclude_regression_id="target-regression",
            suite_ids=[suite["id"]],
            proposed_variables={"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_collisions_include_sibling_with_matching_type_no_false_positive(self) -> None:
        """Sibling regression with matching type does not produce a collision entry."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_suites,
        )
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite({"name": "Shared Suite"})

        # Sibling has 'env' as string - same type as proposed
        regression_service.create_regression(
            {
                "name": "Sibling Match",
                "suites": [suite["id"]],
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )

        result = check_variable_collisions_for_suites(
            exclude_regression_id="other-regression",
            suite_ids=[suite["id"]],
            proposed_variables={"env": {"type": "string", "value": "dev"}},
        )

        assert result == []


# ============================================================================
# Non-dict edge cases on suite variables
# ============================================================================


class TestSuitePairCollisions:
    """Edge cases for check_suite_pair_collisions helper."""

    def test_empty_suite_list_returns_empty(self) -> None:
        """No collisions when suite_ids is empty."""
        from wavecore.api.services.regressions.variable_validation import (
            check_suite_pair_collisions,
        )

        assert check_suite_pair_collisions([]) == []

    def test_single_suite_returns_empty(self) -> None:
        """Needs at least 2 suites to have a pair collision."""
        from wavecore.api.services.regressions.variable_validation import (
            check_suite_pair_collisions,
        )

        assert check_suite_pair_collisions(["only-suite"]) == []

    def test_skips_missing_suite(self) -> None:
        """Suites that cannot be loaded are skipped silently."""
        from unittest.mock import patch

        from wavecore.api.services.regressions.variable_validation import (
            check_suite_pair_collisions,
        )

        def load_side_effect(suite_id: str) -> None:
            return None

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            side_effect=load_side_effect,
        ):
            result = check_suite_pair_collisions(["missing-1", "missing-2"])

        assert result == []

    def test_skips_suite_with_non_dict_variables(self) -> None:
        """Suites whose 'variables' field is a non-dict (corrupt data) are skipped."""
        from unittest.mock import patch

        from wavecore.api.services.regressions.variable_validation import (
            check_suite_pair_collisions,
        )

        bad_suite = {
            "id": "bad",
            "name": "Bad Suite",
            "variables": ["env"],  # list instead of dict
        }
        good_suite = {
            "id": "good",
            "name": "Good Suite",
            "variables": {"env": {"type": "string", "value": "dev"}},
        }

        def load_side_effect(suite_id: str) -> dict:
            return {"bad": bad_suite, "good": good_suite}.get(suite_id)  # type: ignore[return-value]

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            side_effect=load_side_effect,
        ):
            result = check_suite_pair_collisions(["bad", "good"])

        # Neither pair generates a collision because the bad suite is skipped
        assert result == []


class TestNonDictSuiteVariables:
    """Edge cases where suite.variables is not a dict (corrupt data)."""

    def test_non_dict_suite_variables_skipped(self) -> None:
        """check_variable_collisions_for_regression skips suites whose variables are not a dict."""
        from unittest.mock import patch

        from wavecore.api.services.regressions.variable_validation import (
            check_variable_collisions_for_regression,
        )

        # Corrupt suite where 'variables' is a list instead of dict
        bad_suite = {
            "id": "bad-suite",
            "name": "Bad Suite",
            "variables": ["env", "host"],  # Not a dict
        }

        with patch(
            "wavecore.api.services.suites._storage._load_suite",
            return_value=bad_suite,
        ):
            result = check_variable_collisions_for_regression(
                suite_ids=["bad-suite"],
                variable_names_to_check=["env"],
                proposed_variables={"env": {"type": "string", "value": "dev"}},
            )

        assert result == []


# ============================================================================
# Delta-only optimization (unchanged variables are skipped)
# ============================================================================


class TestDeltaOnlySkipWhenUnchanged:
    """Tests for the delta-empty short-circuit in update_regression."""

    def setup_method(self) -> None:
        """Reset storage before each test."""
        clear_regression_storage()
        clear_suite_storage()

    def test_update_suites_only_revalidates_existing_variables(self) -> None:
        """Updating only 'suites' (no 'variables') still validates existing regression variables."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        # Suite A has 'env' as string, compatible with regression
        suite_a = suite_service.create_suite(
            {
                "name": "Suite A",
                "variables": {"env": {"type": "string", "value": "a"}},
            }
        )
        # Suite B has 'env' as integer - conflict
        suite_b = suite_service.create_suite(
            {
                "name": "Suite B",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Suite-Only Update",
                "suites": [suite_a["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        # Update only the 'suites' field - no 'variables' in the payload.
        # Existing regression variable 'env' must still be validated against
        # the new suite list (suite B has the conflicting type).
        with pytest.raises(ConflictException, match="Variable type collision"):
            regression_service.update_regression(
                regression["id"],
                {"suites": [suite_a["id"], suite_b["id"]]},
            )

    def test_update_suites_only_without_variables_key_validates_existing_vars_against_first_suite(
        self,
    ) -> None:
        """Hit the 'delta = list(proposed_vars.keys())' branch where 'variables' is
        NOT in data but regression still has vars that must be re-validated against
        member suites. This bypasses the suite-pair check (only one suite) and
        exercises the existing-var collision path.
        """
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        # Suite with env as integer
        suite_integer = suite_service.create_suite(
            {
                "name": "Integer Suite",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        # Start with a regression whose own 'env' is string and no suites.
        # Direct storage seed so creation doesn't trigger its own validation.
        from tests.api.regression_test_helpers import (
            load_regression_file,
            save_regression_file,
        )

        regression = regression_service.create_regression(
            {
                "name": "Suites-Only Update No Vars Key",
            }
        )
        stored = load_regression_file(regression["id"])
        assert stored is not None
        stored["variables"] = {"env": {"type": "string", "value": "dev"}}
        save_regression_file(stored)

        # Update with ONLY a suites change - no variables key at all.
        # Must raise because the regression's 'env' variable collides with
        # the integer type declared by the new suite.
        with pytest.raises(ConflictException, match="Variable type collision"):
            regression_service.update_regression(
                regression["id"],
                {"suites": [suite_integer["id"]]},
            )

    def test_update_regression_persists_tags(self) -> None:
        """update_regression persists 'tags' and bumps the minor version."""
        from tests.api.regression_test_helpers import load_regression_file
        from wavecore.api.services.regressions import service as regression_service

        regression = regression_service.create_regression({"name": "Tag Target"})

        result = regression_service.update_regression(
            regression["id"],
            {"tags": ["nightly", "smoke"]},
        )

        assert result is not None
        assert result["tags"] == ["nightly", "smoke"]
        assert result["version"] == "1.1.0"
        stored = load_regression_file(regression["id"])
        assert stored is not None
        assert stored["tags"] == ["nightly", "smoke"]

    def test_update_regression_refuses_a_single_integer_version(self) -> None:
        """update_regression refuses stored version '1' and keeps the stored regression."""
        from tests.api.regression_test_helpers import (
            load_regression_file,
            save_regression_file,
        )
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.regressions import service as regression_service

        regression = regression_service.create_regression({"name": "Tag Target"})
        stored = load_regression_file(regression["id"])
        assert stored is not None
        stored["version"] = "1"
        save_regression_file(stored)

        with pytest.raises(ValidationException) as exc_info:
            regression_service.update_regression(regression["id"], {"tags": ["nightly"]})

        assert exc_info.value.message == (
            "Invalid version format '1': must follow semantic versioning (MAJOR.MINOR.PATCH)"
        )
        assert load_regression_file(regression["id"]) == stored

    def test_update_with_identical_variables_skips_collision_check(self) -> None:
        """Re-sending the same variables does not trigger collision validation."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite(
            {
                "name": "Neutral Suite",
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        # Regression has its own 'env' as string. Note: collision detection
        # only runs on *changed or new* variables, so re-sending the same
        # declaration must not raise even though a naive scan would.
        regression = regression_service.create_regression(
            {
                "name": "Delta Regression",
                "suites": [suite["id"]],
            }
        )

        # Seed the regression variables via direct storage to bypass any
        # cross-level validation on creation.
        from tests.api.regression_test_helpers import load_regression_file, save_regression_file

        stored = load_regression_file(regression["id"])
        assert stored is not None
        stored["variables"] = {"host": {"type": "string", "value": "localhost"}}
        save_regression_file(stored)

        # Re-send identical 'host' declaration - delta is empty, validation is skipped.
        result = regression_service.update_regression(
            regression["id"],
            {"variables": {"host": {"type": "string", "value": "localhost"}}},
        )

        assert result is not None
        assert result["variables"]["host"]["value"] == "localhost"

    def test_identical_variables_plus_suite_change_still_validates(self) -> None:
        """When variables echo unchanged but suites also change, full validation must still run.

        Both cross-level and cross-regression checks run even when the delta is
        empty, as long as suite membership changes in the same PUT.
        """
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        # Suite A: 'host' as string (compatible starting point).
        suite_a = suite_service.create_suite(
            {
                "name": "Suite Host String",
                "variables": {"host": {"type": "string", "value": "a"}},
            }
        )
        # Suite B: 'host' as integer - conflicts with the regression's variable.
        suite_b = suite_service.create_suite(
            {
                "name": "Suite Host Integer",
                "variables": {"host": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Delta-Zero Plus Suite Change",
                "suites": [suite_a["id"]],
                "variables": {"host": {"type": "string", "value": "dev"}},
            }
        )

        # PUT echoes the same 'host' variable (delta == []) AND adds suite_b.
        # The new suite's 'host: integer' must still raise a collision.
        with pytest.raises(ConflictException, match="Variable type collision"):
            regression_service.update_regression(
                regression["id"],
                {
                    "variables": {"host": {"type": "string", "value": "dev"}},
                    "suites": [suite_a["id"], suite_b["id"]],
                },
            )

    def test_identical_variables_plus_single_suite_add_raises_member_suite_collision(
        self,
    ) -> None:
        """Covers the delta-zero + suite-change fall-through that feeds Check 1.

        Specifically guards the line that re-expands ``delta`` from an empty
        list to the full proposed variable set when only one new suite is
        added (so suite-pair can't fire). The regression already has
        ``host: string`` and the added suite introduces ``host: integer`` -
        Check 1 (regression-vs-member-suite) must raise.
        """
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite_int = suite_service.create_suite(
            {
                "name": "Member Suite Int Env",
                "variables": {"host": {"type": "integer", "value": 1}},
            }
        )

        regression = regression_service.create_regression(
            {
                "name": "Delta-Zero Single Suite Add",
                "variables": {"host": {"type": "string", "value": "dev"}},
            }
        )

        with pytest.raises(ConflictException, match="Variable type collision") as exc_info:
            regression_service.update_regression(
                regression["id"],
                {
                    "variables": {"host": {"type": "string", "value": "dev"}},
                    "suites": [suite_int["id"]],
                },
            )

        # The error must carry the suite-side payload (not regression-side).
        details = exc_info.value.details
        assert "conflicting_suite_ids" in details
        assert suite_int["id"] in details["conflicting_suite_ids"]
