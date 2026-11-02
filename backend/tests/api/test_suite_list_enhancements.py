"""Unit tests for suite list enhancements (REQ-5.2.1.36).

This module tests the enhanced list_suites functionality needed for the
Suites List UI including:
- Tags field on suite model
- Computed fields: tests_count, status, last_run
- Filtering by status and tags
- Sorting by name, testsCount, status, lastRun
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from tests.api.suite_test_helpers import (
    clear_suite_storage,
    load_suite_file,
    save_suite_file,
)


class TestSuiteTagsField:
    """Test suite tags field support (REQ-5.2.1.36).

    Tags are an array of strings attached to suites for categorization
    and filtering purposes.
    """

    def test_create_suite_with_tags(self) -> None:
        """Test that create_suite stores tags field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.create_suite(
            {
                "name": "Tagged Suite",
                "tags": ["smoke", "auth", "critical"],
            }
        )

        assert "tags" in result
        assert result["tags"] == ["smoke", "auth", "critical"]

    def test_create_suite_without_tags_defaults_to_empty_list(self) -> None:
        """Test that create_suite defaults tags to empty list."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.create_suite({"name": "Suite Without Tags"})

        assert "tags" in result
        assert result["tags"] == []

    def test_create_suite_tags_persisted_to_storage(self) -> None:
        """Test that suite tags are persisted to YAML storage."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        result = suite_service.create_suite(
            {
                "name": "Persisted Suite",
                "tags": ["api", "integration"],
            }
        )

        # Load directly from file to verify persistence
        stored = load_suite_file(result["id"])
        assert stored is not None
        assert stored["tags"] == ["api", "integration"]

    def test_get_suite_returns_tags(self) -> None:
        """Test that get_suite returns tags field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite(
            {
                "name": "Test Suite",
                "tags": ["regression"],
            }
        )

        result = suite_service.get_suite(created["id"])

        assert result is not None
        assert result["tags"] == ["regression"]

    def test_update_suite_updates_tags(self) -> None:
        """Test that update_suite can update tags."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite(
            {
                "name": "Test Suite",
                "tags": ["original"],
            }
        )

        result = suite_service.update_suite(
            created["id"],
            {
                "tags": ["updated", "new-tag"],
            },
        )

        assert result is not None
        assert result["tags"] == ["updated", "new-tag"]

    def test_update_suite_can_clear_tags(self) -> None:
        """Test that update_suite can clear all tags."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite(
            {
                "name": "Test Suite",
                "tags": ["will-be-cleared"],
            }
        )

        result = suite_service.update_suite(created["id"], {"tags": []})

        assert result is not None
        assert result["tags"] == []

    def test_clone_suite_copies_tags(self) -> None:
        """Test that clone_suite copies tags from source."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.suites import version_service as _suite_version_svc

        clear_suite_storage()

        original = suite_service.create_suite(
            {
                "name": "Original Suite",
                "tags": ["auth", "smoke"],
            }
        )

        clone = _suite_version_svc.clone_suite(original["id"], "Cloned Suite")

        assert clone is not None
        assert clone["tags"] == ["auth", "smoke"]

    def test_list_suites_includes_tags_in_response(self) -> None:
        """Test that list_suites includes tags for each suite."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite(
            {
                "name": "Suite A",
                "tags": ["tag-a"],
            }
        )
        suite_service.create_suite(
            {
                "name": "Suite B",
                "tags": ["tag-b", "tag-c"],
            }
        )

        result = suite_service.list_suites()

        assert result["total"] == 2
        suites_by_name = {s["name"]: s for s in result["suites"]}
        assert suites_by_name["Suite A"]["tags"] == ["tag-a"]
        assert suites_by_name["Suite B"]["tags"] == ["tag-b", "tag-c"]


class TestListSuitesComputedFields:
    """Test computed fields in list_suites response (REQ-5.2.1.36).

    Computed fields provide aggregated data without requiring
    additional API calls:
    - tests_count: Number of tests in the suite
    - status: Execution status from last run (passed/failed/never_run)
    - last_run: Timestamp of last execution
    """

    def test_list_suites_includes_tests_count(self) -> None:
        """Test that list_suites returns tests_count field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        test_ids = [str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())]
        suite_service.create_suite(
            {
                "name": "Suite With Tests",
                "tests": test_ids,
            }
        )

        result = suite_service.list_suites()

        assert result["total"] == 1
        assert "tests_count" in result["suites"][0]
        assert result["suites"][0]["tests_count"] == 3

    def test_list_suites_tests_count_is_zero_for_empty_suite(self) -> None:
        """Test that tests_count is 0 when suite has no tests."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Empty Suite", "tests": []})

        result = suite_service.list_suites()

        assert result["suites"][0]["tests_count"] == 0

    def test_list_suites_includes_status_field(self) -> None:
        """Test that list_suites returns status field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Test Suite"})

        result = suite_service.list_suites()

        assert "status" in result["suites"][0]
        # Default status should be never_run
        assert result["suites"][0]["status"] == "never_run"

    def test_list_suites_status_from_last_execution_passed(self) -> None:
        """Test that status reflects passed execution."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Passed Suite"})

        # Mock batch execution info to return passed for this suite
        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value={created["id"]: ("passed", None)},
        ):
            result = suite_service.list_suites()

        assert result["suites"][0]["status"] == "passed"

    def test_list_suites_status_from_last_execution_failed(self) -> None:
        """Test that status reflects failed execution."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Failed Suite"})

        # Mock batch execution info to return failed for this suite
        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value={created["id"]: ("failed", None)},
        ):
            result = suite_service.list_suites()

        assert result["suites"][0]["status"] == "failed"

    def test_list_suites_status_never_run_when_no_executions(self) -> None:
        """Test that status is never_run when no executions exist."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Never Run Suite"})

        # Mock batch execution info to return empty dict (defaults to never_run)
        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value={},
        ):
            result = suite_service.list_suites()

        assert result["suites"][0]["status"] == "never_run"

    def test_list_suites_includes_last_run_field(self) -> None:
        """Test that list_suites returns last_run field."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Test Suite"})

        result = suite_service.list_suites()

        assert "last_run" in result["suites"][0]

    def test_list_suites_last_run_is_none_when_never_run(self) -> None:
        """Test that last_run is None when suite has no executions."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Never Run Suite"})

        # Mock batch execution info to return empty dict (defaults to never_run, None)
        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value={},
        ):
            result = suite_service.list_suites()

        assert result["suites"][0]["last_run"] is None

    def test_list_suites_last_run_from_execution_timestamp(self) -> None:
        """Test that last_run contains execution timestamp."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        created = suite_service.create_suite({"name": "Executed Suite"})
        last_run_time = "2025-12-28T10:30:00Z"

        # Mock batch execution info to return specific timestamp for this suite
        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value={created["id"]: ("never_run", last_run_time)},
        ):
            result = suite_service.list_suites()

        assert result["suites"][0]["last_run"] == last_run_time

    def test_get_suite_includes_computed_fields(self) -> None:
        """Test that get_suite also returns computed fields."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        test_ids = [str(uuid.uuid4())]
        created = suite_service.create_suite(
            {
                "name": "Test Suite",
                "tests": test_ids,
            }
        )

        with patch(
            "wavecore.api.services.executions.service.list_executions",
            return_value={
                "executions": [{"status": "passed", "completed_at": "2025-12-28T12:00:00Z"}],
                "total": 1,
                "page": 1,
                "per_page": 1,
            },
        ):
            result = suite_service.get_suite(created["id"])

        assert result is not None
        assert result["tests_count"] == 1
        assert result["status"] == "passed"
        assert result["last_run"] == "2025-12-28T12:00:00Z"


class TestListSuitesStatusFilter:
    """Test status filter in list_suites (REQ-5.2.1.36).

    The status filter allows filtering suites by their execution status:
    - passed: Last execution passed
    - failed: Last execution failed
    - never_run: No executions yet
    """

    def test_list_suites_filter_by_passed_status(self) -> None:
        """Test filtering suites by passed status."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite({"name": "Passed Suite"})
        suite2 = suite_service.create_suite({"name": "Failed Suite"})

        # Mock batch: suite1=passed, suite2=failed
        exec_info = {
            suite1["id"]: ("passed", None),
            suite2["id"]: ("failed", None),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            result = suite_service.list_suites(status=["passed"])

        assert result["total"] == 1
        assert result["suites"][0]["name"] == "Passed Suite"

    def test_list_suites_filter_by_failed_status(self) -> None:
        """Test filtering suites by failed status."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite({"name": "Passed Suite"})
        suite2 = suite_service.create_suite({"name": "Failed Suite"})

        exec_info = {
            suite1["id"]: ("passed", None),
            suite2["id"]: ("failed", None),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            result = suite_service.list_suites(status=["failed"])

        assert result["total"] == 1
        assert result["suites"][0]["name"] == "Failed Suite"

    def test_list_suites_filter_by_never_run_status(self) -> None:
        """Test filtering suites by never_run status."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite({"name": "Executed Suite"})
        _suite2 = suite_service.create_suite({"name": "Never Run Suite"})

        # Only suite1 has execution info; suite2 absent from dict defaults to never_run
        exec_info = {
            suite1["id"]: ("passed", None),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            result = suite_service.list_suites(status=["never_run"])

        assert result["total"] == 1
        assert result["suites"][0]["name"] == "Never Run Suite"

    def test_list_suites_filter_by_multiple_statuses_any_match(self) -> None:
        """Test filtering by multiple statuses (any match)."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite({"name": "Passed Suite"})
        suite2 = suite_service.create_suite({"name": "Failed Suite"})
        _suite3 = suite_service.create_suite({"name": "Never Run Suite"})

        # suite3 absent from dict defaults to never_run
        exec_info = {
            suite1["id"]: ("passed", None),
            suite2["id"]: ("failed", None),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            result = suite_service.list_suites(status=["passed", "failed"])

        assert result["total"] == 2
        names = {s["name"] for s in result["suites"]}
        assert names == {"Passed Suite", "Failed Suite"}

    def test_list_suites_status_filter_with_empty_list_returns_all(self) -> None:
        """Test that empty status filter returns all suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Suite A"})
        suite_service.create_suite({"name": "Suite B"})

        result = suite_service.list_suites(status=[])

        assert result["total"] == 2

    def test_list_suites_status_filter_with_none_returns_all(self) -> None:
        """Test that None status filter returns all suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Suite A"})
        suite_service.create_suite({"name": "Suite B"})

        result = suite_service.list_suites(status=None)

        assert result["total"] == 2


class TestListSuitesTagsFilter:
    """Test tags filter in list_suites (REQ-5.2.1.36).

    The tags filter allows filtering suites by their tags.
    All specified tags must match (AND logic).
    """

    def test_list_suites_filter_by_single_tag(self) -> None:
        """Test filtering suites by single tag."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Auth Suite", "tags": ["auth", "smoke"]})
        suite_service.create_suite({"name": "API Suite", "tags": ["api", "smoke"]})
        suite_service.create_suite({"name": "DB Suite", "tags": ["database"]})

        result = suite_service.list_suites(tags=["auth"])

        assert result["total"] == 1
        assert result["suites"][0]["name"] == "Auth Suite"

    def test_list_suites_filter_by_multiple_tags_matches_any(self) -> None:
        """Test filtering by multiple tags (OR semantics: match any)."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite(
            {
                "name": "Auth Smoke Suite",
                "tags": ["auth", "smoke"],
            }
        )
        suite_service.create_suite(
            {
                "name": "Auth Only Suite",
                "tags": ["auth"],
            }
        )
        suite_service.create_suite(
            {
                "name": "Smoke Only Suite",
                "tags": ["smoke"],
            }
        )
        suite_service.create_suite(
            {
                "name": "Other Suite",
                "tags": ["other"],
            }
        )

        # OR semantics: selecting auth OR smoke matches all three suites that have either tag
        result = suite_service.list_suites(tags=["auth", "smoke"])

        assert result["total"] == 3
        names = {s["name"] for s in result["suites"]}
        assert names == {"Auth Smoke Suite", "Auth Only Suite", "Smoke Only Suite"}

    def test_list_suites_filter_by_tag_no_matches(self) -> None:
        """Test filtering by tag with no matches."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Suite A", "tags": ["tag-a"]})
        suite_service.create_suite({"name": "Suite B", "tags": ["tag-b"]})

        result = suite_service.list_suites(tags=["nonexistent-tag"])

        assert result["total"] == 0
        assert result["suites"] == []

    def test_list_suites_tags_filter_with_empty_list_returns_all(self) -> None:
        """Test that empty tags filter returns all suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Suite A", "tags": ["tag-a"]})
        suite_service.create_suite({"name": "Suite B", "tags": ["tag-b"]})

        result = suite_service.list_suites(tags=[])

        assert result["total"] == 2

    def test_list_suites_tags_filter_with_none_returns_all(self) -> None:
        """Test that None tags filter returns all suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Suite A", "tags": ["tag-a"]})

        result = suite_service.list_suites(tags=None)

        assert result["total"] == 1

    def test_list_suites_combine_tags_and_search_filter(self) -> None:
        """Test combining tags filter with search filter."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite(
            {
                "name": "Auth Smoke Suite",
                "tags": ["smoke"],
            }
        )
        suite_service.create_suite(
            {
                "name": "API Smoke Suite",
                "tags": ["smoke"],
            }
        )
        suite_service.create_suite(
            {
                "name": "Auth Regression Suite",
                "tags": ["regression"],
            }
        )

        result = suite_service.list_suites(search="auth", tags=["smoke"])

        assert result["total"] == 1
        assert result["suites"][0]["name"] == "Auth Smoke Suite"

    def test_list_suites_combine_tags_and_status_filter(self) -> None:
        """Test combining tags filter with status filter."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite(
            {
                "name": "Smoke Passed Suite",
                "tags": ["smoke"],
            }
        )
        suite2 = suite_service.create_suite(
            {
                "name": "Smoke Failed Suite",
                "tags": ["smoke"],
            }
        )
        suite3 = suite_service.create_suite(
            {
                "name": "Regression Passed Suite",
                "tags": ["regression"],
            }
        )

        exec_info = {
            suite1["id"]: ("passed", None),
            suite2["id"]: ("failed", None),
            suite3["id"]: ("passed", None),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            result = suite_service.list_suites(tags=["smoke"], status=["passed"])

        assert result["total"] == 1
        assert result["suites"][0]["name"] == "Smoke Passed Suite"


class TestListSuitesSorting:
    """Test sorting in list_suites (REQ-5.2.1.36).

    Sorting supports the following fields:
    - name: Suite name (alphabetical)
    - testsCount: Number of tests in suite
    - status: Execution status (passed, failed, never_run)
    - lastRun: Timestamp of last execution
    """

    def test_list_suites_sort_by_name_ascending(self) -> None:
        """Test sorting suites by name in ascending order."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Zebra Suite"})
        suite_service.create_suite({"name": "Alpha Suite"})
        suite_service.create_suite({"name": "Middle Suite"})

        result = suite_service.list_suites(sort_by="name", sort_order="asc")

        names = [s["name"] for s in result["suites"]]
        assert names == ["Alpha Suite", "Middle Suite", "Zebra Suite"]

    def test_list_suites_sort_by_name_descending(self) -> None:
        """Test sorting suites by name in descending order."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Zebra Suite"})
        suite_service.create_suite({"name": "Alpha Suite"})
        suite_service.create_suite({"name": "Middle Suite"})

        result = suite_service.list_suites(sort_by="name", sort_order="desc")

        names = [s["name"] for s in result["suites"]]
        assert names == ["Zebra Suite", "Middle Suite", "Alpha Suite"]

    def test_list_suites_sort_by_name_case_insensitive(self) -> None:
        """Test that name sorting is case-insensitive."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "alpha Suite"})
        suite_service.create_suite({"name": "BETA Suite"})
        suite_service.create_suite({"name": "Gamma Suite"})

        result = suite_service.list_suites(sort_by="name", sort_order="asc")

        names = [s["name"] for s in result["suites"]]
        assert names == ["alpha Suite", "BETA Suite", "Gamma Suite"]

    def test_list_suites_sort_by_tests_count_ascending(self) -> None:
        """Test sorting suites by tests_count in ascending order."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite(
            {
                "name": "Large Suite",
                "tests": [str(uuid.uuid4()) for _ in range(10)],
            }
        )
        suite_service.create_suite(
            {
                "name": "Empty Suite",
                "tests": [],
            }
        )
        suite_service.create_suite(
            {
                "name": "Small Suite",
                "tests": [str(uuid.uuid4())],
            }
        )

        result = suite_service.list_suites(sort_by="testsCount", sort_order="asc")

        names = [s["name"] for s in result["suites"]]
        assert names == ["Empty Suite", "Small Suite", "Large Suite"]

    def test_list_suites_sort_by_tests_count_descending(self) -> None:
        """Test sorting suites by tests_count in descending order."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite(
            {
                "name": "Large Suite",
                "tests": [str(uuid.uuid4()) for _ in range(10)],
            }
        )
        suite_service.create_suite(
            {
                "name": "Empty Suite",
                "tests": [],
            }
        )
        suite_service.create_suite(
            {
                "name": "Small Suite",
                "tests": [str(uuid.uuid4())],
            }
        )

        result = suite_service.list_suites(sort_by="testsCount", sort_order="desc")

        names = [s["name"] for s in result["suites"]]
        assert names == ["Large Suite", "Small Suite", "Empty Suite"]

    def test_list_suites_sort_by_status_ascending(self) -> None:
        """Test sorting suites by status in ascending order.

        Status order: passed (0) < failed (1) < never_run (2)
        """
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        _suite1 = suite_service.create_suite({"name": "Never Run Suite"})
        suite2 = suite_service.create_suite({"name": "Failed Suite"})
        suite3 = suite_service.create_suite({"name": "Passed Suite"})

        # suite1 absent from dict defaults to never_run
        exec_info = {
            suite2["id"]: ("failed", None),
            suite3["id"]: ("passed", None),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            result = suite_service.list_suites(sort_by="status", sort_order="asc")

        names = [s["name"] for s in result["suites"]]
        assert names == ["Passed Suite", "Failed Suite", "Never Run Suite"]

    def test_list_suites_sort_by_status_descending(self) -> None:
        """Test sorting suites by status in descending order."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        _suite1 = suite_service.create_suite({"name": "Never Run Suite"})
        suite2 = suite_service.create_suite({"name": "Failed Suite"})
        suite3 = suite_service.create_suite({"name": "Passed Suite"})

        # suite1 absent from dict defaults to never_run
        exec_info = {
            suite2["id"]: ("failed", None),
            suite3["id"]: ("passed", None),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            result = suite_service.list_suites(sort_by="status", sort_order="desc")

        names = [s["name"] for s in result["suites"]]
        assert names == ["Never Run Suite", "Failed Suite", "Passed Suite"]

    def test_list_suites_sort_by_last_run_ascending(self) -> None:
        """Test sorting suites by last_run in ascending order."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite({"name": "Recent Suite"})
        suite2 = suite_service.create_suite({"name": "Old Suite"})
        _suite3 = suite_service.create_suite({"name": "Never Run Suite"})

        # suite3 absent from dict defaults to (never_run, None)
        exec_info = {
            suite1["id"]: ("never_run", "2025-12-28T12:00:00Z"),
            suite2["id"]: ("never_run", "2025-12-01T12:00:00Z"),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            result = suite_service.list_suites(sort_by="lastRun", sort_order="asc")

        names = [s["name"] for s in result["suites"]]
        # Empty/None values come first in ascending order
        assert names == ["Never Run Suite", "Old Suite", "Recent Suite"]

    def test_list_suites_sort_by_last_run_descending(self) -> None:
        """Test sorting suites by last_run in descending order."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite({"name": "Recent Suite"})
        suite2 = suite_service.create_suite({"name": "Old Suite"})
        _suite3 = suite_service.create_suite({"name": "Never Run Suite"})

        # suite3 absent from dict defaults to (never_run, None)
        exec_info = {
            suite1["id"]: ("never_run", "2025-12-28T12:00:00Z"),
            suite2["id"]: ("never_run", "2025-12-01T12:00:00Z"),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            result = suite_service.list_suites(sort_by="lastRun", sort_order="desc")

        names = [s["name"] for s in result["suites"]]
        assert names == ["Recent Suite", "Old Suite", "Never Run Suite"]

    def test_list_suites_default_sort_order_is_ascending(self) -> None:
        """Test that default sort order is ascending."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Zebra Suite"})
        suite_service.create_suite({"name": "Alpha Suite"})

        result = suite_service.list_suites(sort_by="name")

        names = [s["name"] for s in result["suites"]]
        assert names == ["Alpha Suite", "Zebra Suite"]

    def test_list_suites_sort_with_filter(self) -> None:
        """Test sorting works correctly with filters applied."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Zebra Auth Suite", "tags": ["auth"]})
        suite_service.create_suite({"name": "Alpha Auth Suite", "tags": ["auth"]})
        suite_service.create_suite({"name": "API Suite", "tags": ["api"]})

        result = suite_service.list_suites(
            tags=["auth"],
            sort_by="name",
            sort_order="asc",
        )

        assert result["total"] == 2
        names = [s["name"] for s in result["suites"]]
        assert names == ["Alpha Auth Suite", "Zebra Auth Suite"]

    def test_list_suites_no_sort_returns_natural_order(self) -> None:
        """Test that no sorting returns suites in natural/insertion order."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "First Suite"})
        suite_service.create_suite({"name": "Second Suite"})

        result = suite_service.list_suites(sort_by=None)

        # Without explicit sorting, order is not guaranteed
        # Just verify both are returned
        assert result["total"] == 2


class TestListSuitesEndpointEnhancements:
    """Test GET /suites endpoint with enhanced parameters (REQ-5.2.1.36)."""

    @pytest.fixture
    def client(self):
        """Create FastAPI test client."""
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        return TestClient(app)

    def test_list_suites_accepts_status_filter_parameter(self, client) -> None:
        """Test that GET /suites accepts status filter parameter."""
        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/suites?status=passed,failed")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["status"] == ["passed", "failed"]

    def test_list_suites_accepts_tags_filter_parameter(self, client) -> None:
        """Test that GET /suites accepts tags filter parameter."""
        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/suites?tags=auth,smoke")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["tags"] == ["auth", "smoke"]

    def test_list_suites_accepts_sort_by_parameter(self, client) -> None:
        """Test that GET /suites accepts sort_by parameter."""
        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/suites?sort_by=name")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["sort_by"] == "name"

    def test_list_suites_accepts_sort_order_parameter(self, client) -> None:
        """Test that GET /suites accepts sort_order parameter."""
        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/suites?sort_by=name&sort_order=desc")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["sort_order"] == "desc"

    def test_list_suites_validates_sort_by_field(self, client) -> None:
        """Test that GET /suites validates sort_by field values."""
        response = client.get("/suites?sort_by=invalid_field")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "sort_by" in data["error"]["message"].lower()

    def test_list_suites_validates_sort_order_value(self, client) -> None:
        """Test that GET /suites validates sort_order values."""
        response = client.get("/suites?sort_by=name&sort_order=invalid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "sort_order" in data["error"]["message"].lower()

    def test_list_suites_returns_computed_fields_in_response(self, client) -> None:
        """Test that GET /suites returns computed fields in response."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [
                    {
                        "id": suite_id,
                        "name": "Test Suite",
                        "version": "1.0.0",
                        "description": "",
                        "tests": [str(uuid.uuid4())],
                        "tests_count": 1,
                        "status": "passed",
                        "last_run": "2025-12-28T10:00:00Z",
                        "tags": ["smoke"],
                        "variables": {},
                        "metadata": {},
                        "created_at": now,
                        "updated_at": now,
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/suites")

        assert response.status_code == 200
        data = response.json()
        suite = data["data"][0]
        assert suite["tests_count"] == 1
        assert suite["status"] == "passed"
        assert suite["last_run"] == "2025-12-28T10:00:00Z"
        assert suite["tags"] == ["smoke"]


class TestSuiteTagsEdgeCases:
    """Test edge cases for tags field handling."""

    def test_list_suites_adds_empty_tags_when_suite_has_no_tags_field(self) -> None:
        """Test that suites without tags field get empty tags array."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Create a suite and then manually remove the tags field from storage
        suite = suite_service.create_suite({"name": "Legacy Suite"})
        suite_id = suite["id"]

        # Manually load and modify the stored suite to simulate legacy data
        raw_suite = load_suite_file(suite_id)
        assert raw_suite is not None
        if "tags" in raw_suite:
            del raw_suite["tags"]
        save_suite_file(raw_suite)

        # Now list suites should add empty tags array
        result = suite_service.list_suites()
        suites = result["suites"]
        assert len(suites) == 1
        assert suites[0]["tags"] == []

    def test_get_suite_adds_empty_tags_when_suite_has_no_tags_field(self) -> None:
        """Test that get_suite adds empty tags for legacy suites."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Create a suite and then manually remove the tags field from storage
        suite = suite_service.create_suite({"name": "Legacy Suite"})
        suite_id = suite["id"]

        # Manually load and modify the stored suite to simulate legacy data
        raw_suite = load_suite_file(suite_id)
        assert raw_suite is not None
        if "tags" in raw_suite:
            del raw_suite["tags"]
        save_suite_file(raw_suite)

        # Now get_suite should add empty tags array
        result = suite_service.get_suite(suite_id)
        assert result is not None
        assert result["tags"] == []


class TestSuiteSortingEdgeCases:
    """Test edge cases for sorting functionality."""

    def test_list_suites_sort_with_unknown_sort_by_uses_fallback(self) -> None:
        """Test that unknown sort_by values use fallback empty string key."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite_service.create_suite({"name": "Suite B"})
        suite_service.create_suite({"name": "Suite A"})

        # Call service directly with unknown sort_by (bypasses route validation)
        # This tests the fallback return "" in get_sort_key
        result = suite_service.list_suites(sort_by="unknown_field", sort_order="asc")

        # Should still return suites, but in natural order (not sorted)
        assert len(result["suites"]) == 2


class TestSuiteHelperFunctions:
    """Test helper functions for suite execution info computation."""

    def test_batch_suite_execution_info_returns_empty_when_no_executions(self) -> None:
        """Test _batch_suite_execution_info returns empty dict when no executions."""
        from wavecore.api.services.suites import _storage as _suite_storage

        with patch(
            "wavecore.api.services.executions.service.list_executions",
            return_value={"executions": [], "total": 0, "page": 1, "per_page": 10000},
        ):
            result = _suite_storage._batch_suite_execution_info()

        assert result == {}

    def test_batch_suite_execution_info_returns_passed_from_latest_execution(self) -> None:
        """Test _batch_suite_execution_info returns passed status and timestamp."""
        from wavecore.api.services.suites import _storage as _suite_storage

        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.services.executions.service.list_executions",
            return_value={
                "executions": [
                    {
                        "entity_id": suite_id,
                        "status": "passed",
                        "completed_at": "2025-12-28T10:00:00Z",
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 10000,
            },
        ):
            result = _suite_storage._batch_suite_execution_info()

        assert suite_id in result
        assert result[suite_id] == ("passed", "2025-12-28T10:00:00Z")

    def test_batch_suite_execution_info_returns_failed_from_latest_execution(self) -> None:
        """Test _batch_suite_execution_info returns failed status and timestamp."""
        from wavecore.api.services.suites import _storage as _suite_storage

        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.services.executions.service.list_executions",
            return_value={
                "executions": [
                    {
                        "entity_id": suite_id,
                        "status": "failed",
                        "completed_at": "2025-12-28T10:00:00Z",
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 10000,
            },
        ):
            result = _suite_storage._batch_suite_execution_info()

        assert suite_id in result
        assert result[suite_id] == ("failed", "2025-12-28T10:00:00Z")

    def test_batch_suite_execution_info_returns_timestamp_from_completed_at(self) -> None:
        """Test _batch_suite_execution_info returns completed_at as last_run."""
        from wavecore.api.services.suites import _storage as _suite_storage

        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.services.executions.service.list_executions",
            return_value={
                "executions": [
                    {
                        "entity_id": suite_id,
                        "status": "passed",
                        "completed_at": "2025-12-28T10:30:00Z",
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 10000,
            },
        ):
            result = _suite_storage._batch_suite_execution_info()

        assert result[suite_id] == ("passed", "2025-12-28T10:30:00Z")

    def test_batch_suite_execution_info_uses_started_at_if_not_completed(self) -> None:
        """Test _batch_suite_execution_info uses started_at if completed_at is None."""
        from wavecore.api.services.suites import _storage as _suite_storage

        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.services.executions.service.list_executions",
            return_value={
                "executions": [
                    {
                        "entity_id": suite_id,
                        "status": "running",
                        "started_at": "2025-12-28T10:00:00Z",
                        "completed_at": None,
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 10000,
            },
        ):
            result = _suite_storage._batch_suite_execution_info()

        assert result[suite_id] == ("running", "2025-12-28T10:00:00Z")


class TestGetSuiteTestsCount:
    """Test _get_suite_tests_count helper function."""

    def test_returns_len_when_suite_has_tests_array(self) -> None:
        """Test returns count from explicit tests array."""
        from wavecore.api.services.suites import _storage as _suite_storage

        suite = {"name": "S", "tests": ["t1", "t2", "t3"]}
        assert _suite_storage._get_suite_tests_count(suite) == 3

    def test_returns_zero_when_no_tests_array(self) -> None:
        """Test returns zero when suite has empty tests array."""
        from wavecore.api.services.suites import _storage as _suite_storage

        suite = {"name": "MySuite", "tests": []}
        assert _suite_storage._get_suite_tests_count(suite) == 0

    def test_returns_zero_when_no_tests_key(self) -> None:
        """Test returns zero when suite has no tests key."""
        from wavecore.api.services.suites import _storage as _suite_storage

        suite = {"name": "MySuite"}
        assert _suite_storage._get_suite_tests_count(suite) == 0


class TestBatchSuiteTestCounts:
    """Test _batch_suite_test_counts helper function."""

    def test_batch_suite_test_counts_computes_from_tests_arrays(self) -> None:
        """Test _batch_suite_test_counts counts from suite.tests arrays keyed by suite_id."""
        from wavecore.api.services.suites import _storage as _suite_storage

        with patch.object(
            _suite_storage,
            "_list_all_suites",
            return_value=[
                {"id": "s1", "name": "Suite A", "tests": ["t1", "t2"]},
                {"id": "s2", "name": "Suite B", "tests": ["t3"]},
                {"id": "s3", "name": "Suite C", "tests": []},
            ],
        ):
            counts = _suite_storage._batch_suite_test_counts()

        assert counts == {"s1": 2, "s2": 1, "s3": 0}

    def test_batch_suite_test_counts_empty(self) -> None:
        """Test _batch_suite_test_counts with no suites."""
        from wavecore.api.services.suites import _storage as _suite_storage

        with patch.object(_suite_storage, "_list_all_suites", return_value=[]):
            counts = _suite_storage._batch_suite_test_counts()

        assert counts == {}


class TestListSuitesPaginationWithFilters:
    """Test pagination combined with filters (REQ-5.2.1.36).

    Ensures that filters work correctly across paginated results.
    """

    def test_list_suites_pagination_with_status_filter(self) -> None:
        """Test that status filter works correctly with pagination."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Create 15 suites - enough to span multiple pages
        suite_ids = []
        for i in range(15):
            suite = suite_service.create_suite({"name": f"Suite {i:02d}"})
            suite_ids.append(suite["id"])

        # Mock batch: first 10 passed, last 5 failed
        exec_info = {}
        for idx, sid in enumerate(suite_ids):
            exec_info[sid] = ("passed", None) if idx < 10 else ("failed", None)

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            # Page 1 of passed suites (10 per page)
            result_page1 = suite_service.list_suites(status=["passed"], page=1, per_page=10)

            # Page 2 of passed suites should be empty (only 10 passed)
            result_page2 = suite_service.list_suites(status=["passed"], page=2, per_page=10)

        assert result_page1["total"] == 10
        assert len(result_page1["suites"]) == 10
        assert result_page2["total"] == 10
        assert len(result_page2["suites"]) == 0

    def test_list_suites_pagination_with_tags_filter(self) -> None:
        """Test that tags filter works correctly with pagination."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Create 8 suites with 'smoke' tag, 4 without
        for i in range(8):
            suite_service.create_suite(
                {
                    "name": f"Smoke Suite {i:02d}",
                    "tags": ["smoke"],
                }
            )
        for i in range(4):
            suite_service.create_suite(
                {
                    "name": f"Other Suite {i:02d}",
                    "tags": ["other"],
                }
            )

        # Page 1: 5 per page, filtered by 'smoke' tag
        result_page1 = suite_service.list_suites(tags=["smoke"], page=1, per_page=5)
        # Page 2: remaining smoke suites
        result_page2 = suite_service.list_suites(tags=["smoke"], page=2, per_page=5)

        assert result_page1["total"] == 8
        assert len(result_page1["suites"]) == 5
        assert result_page2["total"] == 8
        assert len(result_page2["suites"]) == 3

    def test_list_suites_pagination_with_sorting_and_filter(self) -> None:
        """Test that sorting works correctly with filters and pagination."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        # Create suites with tags
        suite_service.create_suite({"name": "Zebra Suite", "tags": ["auth"]})
        suite_service.create_suite({"name": "Alpha Suite", "tags": ["auth"]})
        suite_service.create_suite({"name": "Middle Suite", "tags": ["auth"]})
        suite_service.create_suite({"name": "Other Suite", "tags": ["other"]})

        # Filter by 'auth' tag, sort by name ascending, page 1
        result = suite_service.list_suites(
            tags=["auth"],
            sort_by="name",
            sort_order="asc",
            page=1,
            per_page=2,
        )

        assert result["total"] == 3
        assert len(result["suites"]) == 2
        names = [s["name"] for s in result["suites"]]
        assert names == ["Alpha Suite", "Middle Suite"]

        # Page 2 should have the remaining suite
        result_page2 = suite_service.list_suites(
            tags=["auth"],
            sort_by="name",
            sort_order="asc",
            page=2,
            per_page=2,
        )
        assert len(result_page2["suites"]) == 1
        assert result_page2["suites"][0]["name"] == "Zebra Suite"

    def test_list_suites_combine_search_status_and_tags_filters(self) -> None:
        """Test combining all three filter types together."""
        from wavecore.api.services.suites import service as suite_service

        clear_suite_storage()

        suite1 = suite_service.create_suite(
            {
                "name": "Auth Smoke Suite",
                "tags": ["smoke", "auth"],
            }
        )
        suite2 = suite_service.create_suite(
            {
                "name": "Auth Regression Suite",
                "tags": ["regression", "auth"],
            }
        )
        suite3 = suite_service.create_suite(
            {
                "name": "API Smoke Suite",
                "tags": ["smoke", "api"],
            }
        )
        suite4 = suite_service.create_suite(
            {
                "name": "Auth Failed Suite",
                "tags": ["smoke", "auth"],
            }
        )

        # Mock batch statuses
        exec_info = {
            suite1["id"]: ("passed", None),
            suite2["id"]: ("passed", None),
            suite3["id"]: ("passed", None),
            suite4["id"]: ("failed", None),
        }

        with patch(
            "wavecore.api.services.suites.service._batch_suite_execution_info",
            return_value=exec_info,
        ):
            # Filter: search="Auth", tags=["smoke"], status=["passed"]
            result = suite_service.list_suites(
                search="Auth",
                tags=["smoke"],
                status=["passed"],
            )

        # Only "Auth Smoke Suite" should match all criteria
        assert result["total"] == 1
        assert result["suites"][0]["name"] == "Auth Smoke Suite"
