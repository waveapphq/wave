"""Unit tests for suite variable type collision detection.

Tests the compute_variable_delta and check_variable_type_collisions
functions used to prevent type conflicts across suites sharing tests.
"""

from typing import Any

from tests.api.suite_test_helpers import clear_suite_storage
from wavecore.api.services.suites.variable_validation import (
    check_variable_type_collisions,
    compute_variable_delta,
)


class TestComputeVariableDelta:
    """Tests for compute_variable_delta."""

    def test_returns_empty_when_no_changes(self) -> None:
        """No delta when current and proposed have same types."""
        current: dict[str, Any] = {
            "host": {"type": "string", "value": "localhost"},
            "port": {"type": "integer", "value": 8080},
        }
        proposed: dict[str, Any] = {
            "host": {"type": "string", "value": "remote"},
            "port": {"type": "integer", "value": 9090},
        }

        result = compute_variable_delta(current, proposed)

        assert result == []

    def test_detects_new_variable(self) -> None:
        """New variable names appear in the delta."""
        current: dict[str, Any] = {"host": {"type": "string", "value": "localhost"}}
        proposed: dict[str, Any] = {
            "host": {"type": "string", "value": "localhost"},
            "timeout": {"type": "integer", "value": 30},
        }

        result = compute_variable_delta(current, proposed)

        assert result == ["timeout"]

    def test_detects_type_change(self) -> None:
        """A variable whose type changed appears in the delta."""
        current: dict[str, Any] = {"port": {"type": "string", "value": "8080"}}
        proposed: dict[str, Any] = {"port": {"type": "integer", "value": 8080}}

        result = compute_variable_delta(current, proposed)

        assert result == ["port"]

    def test_ignores_removed_variables(self) -> None:
        """Variables removed from proposed do not appear in the delta."""
        current: dict[str, Any] = {
            "host": {"type": "string", "value": "localhost"},
            "port": {"type": "integer", "value": 8080},
        }
        proposed: dict[str, Any] = {"host": {"type": "string", "value": "localhost"}}

        result = compute_variable_delta(current, proposed)

        assert result == []

    def test_handles_empty_current(self) -> None:
        """All proposed variables are new when current is empty."""
        current: dict[str, Any] = {}
        proposed: dict[str, Any] = {
            "host": {"type": "string", "value": "a"},
            "port": {"type": "integer", "value": 1},
        }

        result = compute_variable_delta(current, proposed)

        assert sorted(result) == ["host", "port"]

    def test_handles_empty_proposed(self) -> None:
        """No delta when proposed is empty."""
        current: dict[str, Any] = {"host": {"type": "string", "value": "a"}}
        proposed: dict[str, Any] = {}

        result = compute_variable_delta(current, proposed)

        assert result == []

    def test_handles_non_dict_variable(self) -> None:
        """Non-dict variables default to type 'string'."""
        current: dict[str, Any] = {"simple": "old_value"}
        proposed: dict[str, Any] = {"simple": "new_value"}

        result = compute_variable_delta(current, proposed)

        assert result == []

    def test_non_dict_to_dict_type_change(self) -> None:
        """Changing from a non-dict variable to a dict with non-string type is a delta."""
        current: dict[str, Any] = {"port": "8080"}
        proposed: dict[str, Any] = {"port": {"type": "integer", "value": 8080}}

        result = compute_variable_delta(current, proposed)

        assert result == ["port"]

    def test_multiple_changes(self) -> None:
        """Multiple new and changed variables appear in the delta."""
        current: dict[str, Any] = {
            "a": {"type": "string", "value": "1"},
            "b": {"type": "integer", "value": 2},
        }
        proposed: dict[str, Any] = {
            "a": {"type": "boolean", "value": True},  # type changed
            "b": {"type": "integer", "value": 99},  # same type
            "c": {"type": "float", "value": 1.5},  # new
        }

        result = compute_variable_delta(current, proposed)

        assert sorted(result) == ["a", "c"]


class TestCheckVariableTypeCollisions:
    """Tests for check_variable_type_collisions."""

    def setup_method(self) -> None:
        """Reset storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.tests.service import _clear_storage as _clear_test_storage

        clear_suite_storage()
        _clear_test_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_no_collision_when_no_shared_tests(self) -> None:
        """No collision when suites do not share any tests."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        t1 = test_service.create_test({"name": "T1"})
        t2 = test_service.create_test({"name": "T2"})

        s1 = suite_service.create_suite(
            {
                "name": "S1",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        suite_service.create_suite(
            {
                "name": "S2",
                "tests": [t2["id"]],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        result = check_variable_type_collisions(
            s1["id"],
            ["env"],
            {"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_no_collision_when_types_match(self) -> None:
        """No collision when shared suites have the same type for the variable."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        t1 = test_service.create_test({"name": "T1"})
        s1 = suite_service.create_suite(
            {
                "name": "S1",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        suite_service.create_suite(
            {
                "name": "S2",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )

        result = check_variable_type_collisions(
            s1["id"],
            ["env"],
            {"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_detects_type_collision(self) -> None:
        """Detects a collision when another suite has a different type for the same variable."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        t1 = test_service.create_test({"name": "T1"})
        s1 = suite_service.create_suite(
            {
                "name": "S1",
                "tests": [t1["id"]],
                "variables": {"retry": {"type": "string", "value": "3"}},
            }
        )
        s2 = suite_service.create_suite(
            {
                "name": "S2",
                "tests": [t1["id"]],
                "variables": {"retry": {"type": "integer", "value": 3}},
            }
        )

        result = check_variable_type_collisions(
            s1["id"],
            ["retry"],
            {"retry": {"type": "string", "value": "3"}},
        )

        assert len(result) == 1
        assert result[0]["variable"] == "retry"
        assert result[0]["this_type"] == "string"
        assert result[0]["other_suite"] == "S2"
        assert result[0]["other_suite_id"] == s2["id"]
        assert result[0]["other_type"] == "integer"

    def test_self_exclusion(self) -> None:
        """The suite's own variables are excluded from collision checks."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        t1 = test_service.create_test({"name": "T1"})
        s1 = suite_service.create_suite(
            {
                "name": "S1",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        result = check_variable_type_collisions(
            s1["id"],
            ["env"],
            {"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_empty_variable_names_returns_empty(self) -> None:
        """Returns empty list when no variable names are given to check."""
        result = check_variable_type_collisions("any-id", [], {})

        assert result == []

    def test_suite_not_found_returns_empty(self) -> None:
        """Returns empty when suite does not exist."""
        result = check_variable_type_collisions(
            "nonexistent",
            ["env"],
            {"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_suite_with_no_tests_returns_empty(self) -> None:
        """No collisions when the suite has no tests."""
        from wavecore.api.services.suites import service as suite_service

        s1 = suite_service.create_suite(
            {
                "name": "EmptySuite",
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        result = check_variable_type_collisions(
            s1["id"],
            ["env"],
            {"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_variable_not_in_other_suite_no_collision(self) -> None:
        """No collision when the other suite does not have the variable at all."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        t1 = test_service.create_test({"name": "T1"})
        s1 = suite_service.create_suite(
            {
                "name": "S1",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        suite_service.create_suite(
            {
                "name": "S2",
                "tests": [t1["id"]],
                "variables": {"other_var": {"type": "integer", "value": 1}},
            }
        )

        result = check_variable_type_collisions(
            s1["id"],
            ["env"],
            {"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_skips_deleted_other_suite(self) -> None:
        """Gracefully skips other suites whose files have been deleted."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites._storage import _delete_suite_files
        from wavecore.api.services.tests import service as test_service

        t1 = test_service.create_test({"name": "T1"})
        s1 = suite_service.create_suite(
            {
                "name": "S1",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        s2 = suite_service.create_suite(
            {
                "name": "S2",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        # Delete S2 files but leave the relation index intact
        _delete_suite_files(s2["id"])

        result = check_variable_type_collisions(
            s1["id"],
            ["env"],
            {"env": {"type": "string", "value": "dev"}},
        )

        # S2 is gone so no collision should be reported
        assert result == []

    def test_multiple_collisions_across_suites(self) -> None:
        """Detects collisions from multiple other suites."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        t1 = test_service.create_test({"name": "T1"})
        t2 = test_service.create_test({"name": "T2"})
        s1 = suite_service.create_suite(
            {
                "name": "S1",
                "tests": [t1["id"], t2["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        suite_service.create_suite(
            {
                "name": "S2",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )
        suite_service.create_suite(
            {
                "name": "S3",
                "tests": [t2["id"]],
                "variables": {"env": {"type": "boolean", "value": True}},
            }
        )

        result = check_variable_type_collisions(
            s1["id"],
            ["env"],
            {"env": {"type": "string", "value": "dev"}},
        )

        assert len(result) == 2
        other_suites = {c["other_suite"] for c in result}
        assert other_suites == {"S2", "S3"}


class TestCheckVariableCollisionsForTests:
    """Tests for check_variable_collisions_for_tests (explicit test IDs)."""

    def setup_method(self) -> None:
        """Reset storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.tests.service import _clear_storage as _clear_test_storage

        clear_suite_storage()
        _clear_test_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_detects_collision_with_explicit_test_ids(self) -> None:
        """Detects collision when given explicit test IDs instead of reading from disk."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites.variable_validation import (
            check_variable_collisions_for_tests,
        )
        from wavecore.api.services.tests import service as test_service

        t1 = test_service.create_test({"name": "T1"})
        suite_service.create_suite(
            {
                "name": "S1",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "integer", "value": 1}},
            }
        )

        # Check collisions for a NOT-YET-SAVED suite that would share t1
        result = check_variable_collisions_for_tests(
            exclude_suite_id="new-suite-id",
            test_ids=[t1["id"]],
            proposed_variables={"env": {"type": "string", "value": "dev"}},
        )

        assert len(result) == 1
        assert result[0]["variable"] == "env"
        assert result[0]["this_type"] == "string"
        assert result[0]["other_type"] == "integer"

    def test_no_collision_when_types_match(self) -> None:
        """No collision when types match for explicit test IDs."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites.variable_validation import (
            check_variable_collisions_for_tests,
        )
        from wavecore.api.services.tests import service as test_service

        t1 = test_service.create_test({"name": "T1"})
        suite_service.create_suite(
            {
                "name": "S1",
                "tests": [t1["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )

        result = check_variable_collisions_for_tests(
            exclude_suite_id="new-suite-id",
            test_ids=[t1["id"]],
            proposed_variables={"env": {"type": "string", "value": "prod"}},
        )

        assert result == []

    def test_empty_test_ids_returns_empty(self) -> None:
        """Returns empty when no test IDs provided."""
        from wavecore.api.services.suites.variable_validation import (
            check_variable_collisions_for_tests,
        )

        result = check_variable_collisions_for_tests(
            exclude_suite_id="any-id",
            test_ids=[],
            proposed_variables={"env": {"type": "string", "value": "dev"}},
        )

        assert result == []

    def test_empty_variables_returns_empty(self) -> None:
        """Returns empty when no variables provided."""
        from wavecore.api.services.suites.variable_validation import (
            check_variable_collisions_for_tests,
        )

        result = check_variable_collisions_for_tests(
            exclude_suite_id="any-id",
            test_ids=["t1"],
            proposed_variables={},
        )

        assert result == []

    def test_no_sibling_suites_returns_empty(self) -> None:
        """Returns empty when test IDs do not belong to any other suite."""
        from wavecore.api.services.suites.variable_validation import (
            check_variable_collisions_for_tests,
        )
        from wavecore.api.services.tests import service as test_service

        # Create a test that is not in any suite
        t = test_service.create_test({"name": "Orphan"})

        result = check_variable_collisions_for_tests(
            exclude_suite_id="any-id",
            test_ids=[t["id"]],
            proposed_variables={"env": {"type": "string", "value": "dev"}},
        )

        assert result == []
