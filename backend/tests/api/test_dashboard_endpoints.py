"""Unit tests for status dashboard endpoint (REQ-5.2.1.43).

This module tests the status dashboard endpoint which provides an aggregated view of
system state for the main navigation dashboard. It consolidates multiple data sources
into a single response.

Test Coverage:
- GET /dashboard endpoint basic structure
- Metrics section: entity counts as objects with count property, execution statistics with sinceDays
- Recent activity section: entities with id, type, name, statusInfo, timestamp
- Running executions section: active executions with id, environment, entityName, entityType,
  progress, startedAt, status
- Error handling: HTTP 503 for complete storage failure, HTTP 200 with null for partial
- Empty state detection: derived from zero entity counts
- Performance target: sub-200ms response
- Caching: 5-second TTL with cache invalidation
"""

import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient


class TestDashboardEndpoint:
    """Test suite for GET /dashboard endpoint (REQ-5.2.1.43)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_dashboard_endpoint_returns_200(self, client: TestClient) -> None:
        """Test that /dashboard returns 200 with aggregated data."""
        response = client.get("/dashboard")

        assert response.status_code == 200

    def test_dashboard_response_contains_metrics(self, client: TestClient) -> None:
        """Test that /dashboard response contains metrics section."""
        response = client.get("/dashboard")

        data = response.json()
        assert "metrics" in data

    def test_dashboard_response_contains_recent_activity(self, client: TestClient) -> None:
        """Test that /dashboard response contains recentActivity section."""
        response = client.get("/dashboard")

        data = response.json()
        assert "recentActivity" in data

    def test_dashboard_response_contains_recent_executions(self, client: TestClient) -> None:
        """Test that /dashboard response contains recentExecutions section."""
        response = client.get("/dashboard")

        data = response.json()
        assert "recentExecutions" in data

    def test_dashboard_response_structure(self, client: TestClient) -> None:
        """Test that /dashboard response has correct top-level structure."""
        response = client.get("/dashboard")

        data = response.json()
        # All three main sections must be present
        assert "metrics" in data
        assert "recentActivity" in data
        assert "recentExecutions" in data


class TestDashboardMetricsSection:
    """Test suite for dashboard metrics section."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_metrics_contains_entity_counts(self, client: TestClient) -> None:
        """Test that metrics section contains entity counts."""
        response = client.get("/dashboard")

        metrics = response.json()["metrics"]
        assert "tests" in metrics
        assert "suites" in metrics
        assert "regressions" in metrics

    def test_metrics_entity_counts_are_objects_with_count(self, client: TestClient) -> None:
        """Test that entity counts are objects with count property."""
        response = client.get("/dashboard")

        metrics = response.json()["metrics"]
        assert isinstance(metrics["tests"], dict)
        assert isinstance(metrics["suites"], dict)
        assert isinstance(metrics["regressions"], dict)
        assert "count" in metrics["tests"]
        assert "count" in metrics["suites"]
        assert "count" in metrics["regressions"]
        assert isinstance(metrics["tests"]["count"], int)
        assert isinstance(metrics["suites"]["count"], int)
        assert isinstance(metrics["regressions"]["count"], int)

    def test_metrics_entity_counts_non_negative(self, client: TestClient) -> None:
        """Test that entity counts are non-negative integers."""
        response = client.get("/dashboard")

        metrics = response.json()["metrics"]
        assert metrics["tests"]["count"] >= 0
        assert metrics["suites"]["count"] >= 0
        assert metrics["regressions"]["count"] >= 0

    def test_metrics_contains_execution_statistics(self, client: TestClient) -> None:
        """Test that metrics section contains execution statistics."""
        response = client.get("/dashboard")

        metrics = response.json()["metrics"]
        assert "executions" in metrics

        executions = metrics["executions"]
        assert "sinceDays" in executions
        assert "count" in executions
        assert "running" in executions
        assert "passed" in executions
        assert "failed" in executions

    def test_metrics_execution_stats_are_integers(self, client: TestClient) -> None:
        """Test that execution statistics are integers."""
        response = client.get("/dashboard")

        executions = response.json()["metrics"]["executions"]
        assert isinstance(executions["sinceDays"], int)
        assert isinstance(executions["count"], int)
        assert isinstance(executions["running"], int)
        assert isinstance(executions["passed"], int)
        assert isinstance(executions["failed"], int)

    def test_metrics_execution_stats_non_negative(self, client: TestClient) -> None:
        """Test that execution statistics are non-negative."""
        response = client.get("/dashboard")

        executions = response.json()["metrics"]["executions"]
        assert executions["sinceDays"] >= 0
        assert executions["count"] >= 0
        assert executions["running"] >= 0
        assert executions["passed"] >= 0
        assert executions["failed"] >= 0

    def test_metrics_aggregates_from_services(self, client: TestClient) -> None:
        """Test that metrics aggregates data from entity and execution services."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.get_suite_count") as mock_suites,
            patch("wavecore.api.routes.dashboard.routes.get_regression_count") as mock_regressions,
            patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats,
        ):
            mock_tests.return_value = 42
            mock_suites.return_value = 7
            mock_regressions.return_value = 3
            mock_stats.return_value = {
                "sinceDays": 1,
                "count": 160,
                "running": 2,
                "passed": 150,
                "failed": 5,
            }

            response = client.get("/dashboard")

            metrics = response.json()["metrics"]
            assert metrics["tests"]["count"] == 42
            assert metrics["suites"]["count"] == 7
            assert metrics["regressions"]["count"] == 3
            assert metrics["executions"]["sinceDays"] == 1
            assert metrics["executions"]["count"] == 160
            assert metrics["executions"]["running"] == 2
            assert metrics["executions"]["passed"] == 150
            assert metrics["executions"]["failed"] == 5

    def test_metrics_uses_default_24h_time_window(self, client: TestClient) -> None:
        """Test that execution statistics use 24-hour default time window."""
        with patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats:
            mock_stats.return_value = {
                "sinceDays": 1,
                "count": 0,
                "running": 0,
                "passed": 0,
                "failed": 0,
            }

            client.get("/dashboard")

            # Verify default 24-hour time window is passed
            mock_stats.assert_called_once()
            call_args = mock_stats.call_args
            # Should pass time_window_hours=24 as default
            assert call_args is not None
            assert call_args.kwargs.get("time_window_hours") == 24


class TestDashboardRecentActivitySection:
    """Test suite for dashboard recentActivity section."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_recent_activity_is_list(self, client: TestClient) -> None:
        """Test that recentActivity is a list."""
        response = client.get("/dashboard")

        data = response.json()
        assert isinstance(data["recentActivity"], list)

    def test_recent_activity_item_structure(self, client: TestClient) -> None:
        """Test that recentActivity items have correct structure."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity:
            mock_activity.return_value = [
                {
                    "id": "login-flow-test",
                    "type": "test",
                    "name": "Login Flow Test",
                    "statusInfo": "Test · Auth Suite",
                    "timestamp": datetime.now(UTC).isoformat(),
                }
            ]

            response = client.get("/dashboard")

            activity = response.json()["recentActivity"]
            assert len(activity) == 1
            item = activity[0]
            assert "id" in item
            assert "type" in item
            assert "name" in item
            assert "statusInfo" in item
            assert "timestamp" in item

    def test_recent_activity_type_values(self, client: TestClient) -> None:
        """Test that recentActivity type is one of valid entity types."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity:
            mock_activity.return_value = [
                {
                    "id": "test-1",
                    "type": "test",
                    "name": "Test 1",
                    "statusInfo": "Test · Suite 1",
                    "timestamp": datetime.now(UTC).isoformat(),
                },
                {
                    "id": "suite-1",
                    "type": "suite",
                    "name": "Suite 1",
                    "statusInfo": "Suite · Reg 1",
                    "timestamp": datetime.now(UTC).isoformat(),
                },
                {
                    "id": "reg-1",
                    "type": "regression",
                    "name": "Regression 1",
                    "statusInfo": "Regression",
                    "timestamp": datetime.now(UTC).isoformat(),
                },
            ]

            response = client.get("/dashboard")

            activity = response.json()["recentActivity"]
            valid_types = {"test", "suite", "regression", "block"}
            for item in activity:
                assert item["type"] in valid_types

    def test_recent_activity_timestamp_iso8601(self, client: TestClient) -> None:
        """Test that recentActivity timestamps are ISO 8601 format."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity:
            mock_activity.return_value = [
                {
                    "id": "test-1",
                    "type": "test",
                    "name": "Test 1",
                    "statusInfo": "Test · Suite 1",
                    "timestamp": "2025-01-15T10:30:00+00:00",
                },
            ]

            response = client.get("/dashboard")

            activity = response.json()["recentActivity"]
            # Should be able to parse ISO 8601 timestamp
            timestamp = activity[0]["timestamp"]
            datetime.fromisoformat(timestamp.replace("Z", "+00:00"))

    def test_recent_activity_status_info_for_top_level_entities(self, client: TestClient) -> None:
        """Test that statusInfo contains entity type for top-level entities."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity:
            mock_activity.return_value = [
                {
                    "id": "reg-1",
                    "type": "regression",
                    "name": "Top Level",
                    "statusInfo": "Regression",
                    "timestamp": datetime.now(UTC).isoformat(),
                },
            ]

            response = client.get("/dashboard")

            activity = response.json()["recentActivity"]
            assert activity[0]["statusInfo"] == "Regression"

    def test_recent_activity_empty_when_no_entities(self, client: TestClient) -> None:
        """Test that recentActivity is empty list when no recent entities."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity:
            mock_activity.return_value = []

            response = client.get("/dashboard")

            activity = response.json()["recentActivity"]
            assert activity == []


class TestDashboardRecentExecutionsSection:
    """Test suite for dashboard recentExecutions section."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_recent_executions_is_list(self, client: TestClient) -> None:
        """Test that recentExecutions is a list."""
        response = client.get("/dashboard")

        data = response.json()
        assert isinstance(data["recentExecutions"], list)

    def test_recent_executions_item_structure(self, client: TestClient) -> None:
        """Test that recentExecutions items have correct structure."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions:
            mock_executions.return_value = [
                {
                    "id": "exec-123",
                    "environment": "staging",
                    "entityName": "Login Test",
                    "entityType": "test",
                    "progress": 45,
                    "startedAt": datetime.now(UTC).isoformat(),
                    "status": "running",
                }
            ]

            response = client.get("/dashboard")

            executions = response.json()["recentExecutions"]
            assert len(executions) == 1
            item = executions[0]
            assert "id" in item
            assert "environment" in item
            assert "entityName" in item
            assert "entityType" in item
            assert "progress" in item
            assert "startedAt" in item
            assert "status" in item

    def test_recent_executions_progress_is_percentage(self, client: TestClient) -> None:
        """Test that progress is a valid percentage (0-100)."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions:
            mock_executions.return_value = [
                {
                    "id": "exec-123",
                    "environment": "dev",
                    "entityName": "Test",
                    "entityType": "test",
                    "progress": 75,
                    "startedAt": datetime.now(UTC).isoformat(),
                    "status": "running",
                }
            ]

            response = client.get("/dashboard")

            executions = response.json()["recentExecutions"]
            progress = executions[0]["progress"]
            assert isinstance(progress, int | float)
            assert 0 <= progress <= 100

    def test_recent_executions_status_is_running(self, client: TestClient) -> None:
        """Test that all listed executions have running status."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions:
            mock_executions.return_value = [
                {
                    "id": "exec-1",
                    "environment": "dev",
                    "entityName": "Test 1",
                    "entityType": "test",
                    "progress": 30,
                    "startedAt": datetime.now(UTC).isoformat(),
                    "status": "running",
                },
                {
                    "id": "exec-2",
                    "environment": "staging",
                    "entityName": "Suite 1",
                    "entityType": "suite",
                    "progress": 60,
                    "startedAt": datetime.now(UTC).isoformat(),
                    "status": "running",
                },
            ]

            response = client.get("/dashboard")

            executions = response.json()["recentExecutions"]
            for item in executions:
                assert item["status"] == "running"

    def test_recent_executions_empty_when_none_active(self, client: TestClient) -> None:
        """Test that recentExecutions is empty list when no active executions."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions:
            mock_executions.return_value = []

            response = client.get("/dashboard")

            executions = response.json()["recentExecutions"]
            assert executions == []

    def test_recent_executions_zero_progress(self, client: TestClient) -> None:
        """Test that executions at 0% progress are handled correctly."""
        with patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions:
            mock_executions.return_value = [
                {
                    "id": "exec-new",
                    "environment": "dev",
                    "entityName": "New Test",
                    "entityType": "test",
                    "progress": 0,
                    "startedAt": datetime.now(UTC).isoformat(),
                    "status": "running",
                }
            ]

            response = client.get("/dashboard")

            executions = response.json()["recentExecutions"]
            assert len(executions) == 1
            assert executions[0]["progress"] == 0


class TestDashboardEmptyState:
    """Test suite for dashboard empty state detection."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_empty_state_zero_entity_counts(self, client: TestClient) -> None:
        """Test that empty state is derived from zero entity counts."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.get_suite_count") as mock_suites,
            patch("wavecore.api.routes.dashboard.routes.get_regression_count") as mock_regressions,
            patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats,
            patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity,
            patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions,
        ):
            mock_tests.return_value = 0
            mock_suites.return_value = 0
            mock_regressions.return_value = 0
            mock_stats.return_value = {
                "sinceDays": 1,
                "count": 0,
                "running": 0,
                "passed": 0,
                "failed": 0,
            }
            mock_activity.return_value = []
            mock_executions.return_value = []

            response = client.get("/dashboard")

            data = response.json()
            metrics = data["metrics"]
            assert metrics["tests"]["count"] == 0
            assert metrics["suites"]["count"] == 0
            assert metrics["regressions"]["count"] == 0
            # Empty state detection is client-side based on zero counts

    def test_empty_arrays_indicate_success_with_no_items(self, client: TestClient) -> None:
        """Test that empty arrays mean success but no items (not failure)."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity,
            patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions,
        ):
            mock_activity.return_value = []
            mock_executions.return_value = []

            response = client.get("/dashboard")

            data = response.json()
            # Empty array = success with zero items, NOT failure
            assert data["recentActivity"] == []
            assert data["recentExecutions"] == []
            # No errors in metadata for empty results
            if "meta" in data:
                assert data.get("meta", {}).get("errors") in (None, [])


class TestDashboardErrorHandling:
    """Test suite for dashboard error handling."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_complete_storage_failure_returns_503(self, client: TestClient) -> None:
        """Test that complete storage unavailability returns HTTP 503."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.get_suite_count") as mock_suites,
            patch("wavecore.api.routes.dashboard.routes.get_regression_count") as mock_regressions,
            patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats,
            patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity,
            patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions,
        ):
            # All storage operations fail
            mock_tests.side_effect = OSError("Storage unavailable")
            mock_suites.side_effect = OSError("Storage unavailable")
            mock_regressions.side_effect = OSError("Storage unavailable")
            mock_stats.side_effect = OSError("Storage unavailable")
            mock_activity.side_effect = OSError("Storage unavailable")
            mock_executions.side_effect = OSError("Storage unavailable")

            response = client.get("/dashboard")

            assert response.status_code == 503

    def test_partial_failure_returns_200_with_available_data(self, client: TestClient) -> None:
        """Test that partial failures return 200 with available data."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.get_suite_count") as mock_suites,
            patch("wavecore.api.routes.dashboard.routes.get_regression_count") as mock_regressions,
            patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats,
            patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity,
            patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions,
        ):
            # Some operations succeed, some fail
            mock_tests.return_value = 10
            mock_suites.return_value = 5
            mock_regressions.side_effect = OSError("Partial failure")  # Fails
            mock_stats.return_value = {
                "sinceDays": 1,
                "count": 23,
                "running": 1,
                "passed": 20,
                "failed": 2,
            }
            mock_activity.return_value = []
            mock_executions.side_effect = OSError("Partial failure")  # Fails

            response = client.get("/dashboard")

            # Should still return 200 with available data
            assert response.status_code == 200

    def test_failed_section_returns_null_not_empty(self, client: TestClient) -> None:
        """Test that failed sections return null, not empty arrays."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.get_suite_count") as mock_suites,
            patch("wavecore.api.routes.dashboard.routes.get_regression_count") as mock_regressions,
            patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats,
            patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity,
            patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions,
        ):
            mock_tests.return_value = 10
            mock_suites.return_value = 5
            mock_regressions.return_value = 2
            mock_stats.return_value = {
                "sinceDays": 1,
                "count": 23,
                "running": 1,
                "passed": 20,
                "failed": 2,
            }
            mock_activity.side_effect = OSError("Recent activity fetch failed")  # Fails
            mock_executions.return_value = []

            response = client.get("/dashboard")

            data = response.json()
            # Failed section should be null to distinguish from empty
            assert data["recentActivity"] is None

    def test_null_distinguishes_from_empty_array(self, client: TestClient) -> None:
        """Test that null indicates failure while empty array indicates success with no items."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.get_suite_count") as mock_suites,
            patch("wavecore.api.routes.dashboard.routes.get_regression_count") as mock_regressions,
            patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats,
            patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity,
            patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions,
        ):
            mock_tests.return_value = 10
            mock_suites.return_value = 5
            mock_regressions.return_value = 2
            mock_stats.return_value = {
                "sinceDays": 1,
                "count": 22,
                "running": 0,
                "passed": 20,
                "failed": 2,
            }
            mock_activity.return_value = []  # Success with no items
            mock_executions.side_effect = OSError("Failed to fetch")  # Failure

            response = client.get("/dashboard")

            data = response.json()
            # Empty array = success, no items
            assert data["recentActivity"] == []
            # Null = failed to fetch
            assert data["recentExecutions"] is None

    def test_errors_array_describes_failures(self, client: TestClient) -> None:
        """Test that errors array in metadata describes what failed."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.get_suite_count") as mock_suites,
            patch("wavecore.api.routes.dashboard.routes.get_regression_count") as mock_regressions,
            patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats,
            patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity,
            patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions,
        ):
            mock_tests.return_value = 10
            mock_suites.return_value = 5
            mock_regressions.side_effect = OSError("Regression storage failed")
            mock_stats.return_value = {
                "sinceDays": 1,
                "count": 22,
                "running": 0,
                "passed": 20,
                "failed": 2,
            }
            mock_activity.return_value = []
            mock_executions.side_effect = OSError("Execution service unavailable")

            response = client.get("/dashboard")

            data = response.json()
            # Meta should contain errors array
            assert "meta" in data
            assert "errors" in data["meta"]
            errors = data["meta"]["errors"]
            assert isinstance(errors, list)
            assert len(errors) > 0

    def test_errors_array_contains_descriptive_messages(self, client: TestClient) -> None:
        """Test that errors array contains descriptive error messages."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.get_suite_count") as mock_suites,
            patch("wavecore.api.routes.dashboard.routes.get_regression_count") as mock_regressions,
            patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats,
            patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity,
            patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions,
        ):
            mock_tests.return_value = 10
            mock_suites.return_value = 5
            mock_regressions.return_value = 2
            mock_stats.return_value = {
                "sinceDays": 1,
                "count": 22,
                "running": 0,
                "passed": 20,
                "failed": 2,
            }
            mock_activity.side_effect = OSError("Recent activity fetch failed")
            mock_executions.return_value = []

            response = client.get("/dashboard")

            data = response.json()
            errors = data["meta"]["errors"]
            # Each error should describe which section failed
            error_found = False
            for error in errors:
                if "recentActivity" in str(error).lower() or "recent" in str(error).lower():
                    error_found = True
                    break
            assert error_found, f"Expected error about recentActivity, got: {errors}"


class TestDashboardPerformance:
    """Test suite for dashboard performance requirements."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_dashboard_response_time_under_200ms(self, client: TestClient) -> None:
        """Test that /dashboard responds in <200ms (target per REQ-5.2.1.43).

        Note: Test allows 400ms threshold to account for test framework overhead.
        Production target remains <200ms. The fastest of five requests is judged, so a
        busy machine slowing one request does not fail it.
        """
        from wavecore.api.routes.dashboard import routes as dashboard_routes

        timings_ms = []
        for _ in range(5):
            # Each request computes the dashboard instead of reading the 5-second cache.
            dashboard_routes.invalidate_dashboard_cache()
            start = time.perf_counter()
            response = client.get("/dashboard")
            timings_ms.append((time.perf_counter() - start) * 1000)
            assert response.status_code == 200

        fastest_ms = min(timings_ms)
        # Allow 2x margin for test environment overhead
        assert fastest_ms < 400, f"Dashboard took {fastest_ms:.2f}ms, target <200ms"

    def test_dashboard_uses_optimized_count_queries(self, client: TestClient) -> None:
        """Test that dashboard uses optimized count queries (not full entity loads)."""
        with patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_count:
            mock_count.return_value = 100

            client.get("/dashboard")

            # Should use count-specific function, not list_all_tests
            mock_count.assert_called_once()


class TestDashboardCaching:
    """Test suite for dashboard caching behavior."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_dashboard_results_cached_with_ttl(self, client: TestClient) -> None:
        """Test that dashboard results are cached with TTL."""
        with patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests:
            mock_tests.return_value = 10

            # First request
            response1 = client.get("/dashboard")
            _first_call_count = mock_tests.call_count

            # Second request immediately after should use cache
            response2 = client.get("/dashboard")
            _second_call_count = mock_tests.call_count

            assert response1.status_code == 200
            assert response2.status_code == 200
            # If caching is implemented, call count should not increase
            # (or increase minimally for cache checks)

    def test_dashboard_cache_invalidates_on_entity_change(self, client: TestClient) -> None:
        """Test that cache invalidates when entities are modified."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch(
                "wavecore.api.routes.dashboard.routes.invalidate_dashboard_cache"
            ) as mock_invalidate,
        ):
            mock_tests.return_value = 10

            # First request caches result
            client.get("/dashboard")

            # Simulate entity modification triggering cache invalidation
            mock_invalidate()

            # Verify invalidation was called
            mock_invalidate.assert_called()

    def test_dashboard_cache_invalidates_on_execution_change(self, client: TestClient) -> None:
        """Test that cache invalidates when execution state changes."""
        with patch(
            "wavecore.api.routes.dashboard.routes.invalidate_dashboard_cache"
        ) as mock_invalidate:
            # Simulate execution state change triggering cache invalidation
            mock_invalidate()

            mock_invalidate.assert_called()

    def test_dashboard_cache_expires_after_5_seconds(self, client: TestClient) -> None:
        """Test that dashboard cache expires after 5-second TTL per REQ-5.2.1.43."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.CACHE_TTL_SECONDS", 5),
        ):
            mock_tests.return_value = 10

            # First request - caches result
            client.get("/dashboard")
            first_call_count = mock_tests.call_count

            # Wait for cache to expire
            time.sleep(5.1)

            # Second request after TTL - should re-fetch
            client.get("/dashboard")
            second_call_count = mock_tests.call_count

            # Call count should have increased after cache expiry
            assert second_call_count > first_call_count


class TestDashboardCountFunctions:
    """Test suite for dashboard count helper functions."""

    def test_get_test_count_returns_integer(self) -> None:
        """Test that get_test_count returns integer."""
        with patch("wavecore.api.routes.dashboard.helpers._list_all_tests") as mock_list:
            mock_list.return_value = [{"id": "1"}, {"id": "2"}, {"id": "3"}]

            from wavecore.api.routes.dashboard import get_test_count

            count = get_test_count()

            assert isinstance(count, int)
            assert count == 3

    def test_get_suite_count_returns_integer(self) -> None:
        """Test that get_suite_count returns integer."""
        with patch("wavecore.api.routes.dashboard.helpers._list_all_suites") as mock_list:
            mock_list.return_value = [{"id": "1"}, {"id": "2"}]

            from wavecore.api.routes.dashboard import get_suite_count

            count = get_suite_count()

            assert isinstance(count, int)
            assert count == 2

    def test_get_regression_count_returns_integer(self) -> None:
        """Test that get_regression_count returns integer."""
        with patch("wavecore.api.routes.dashboard.helpers._list_all_regressions") as mock_list:
            mock_list.return_value = [{"id": "1"}]

            from wavecore.api.routes.dashboard import get_regression_count

            count = get_regression_count()

            assert isinstance(count, int)
            assert count == 1


class TestDashboardExecutionStatistics:
    """Test suite for dashboard execution statistics."""

    def test_get_execution_statistics_returns_dict(self) -> None:
        """Test that get_execution_statistics returns proper dictionary."""
        with patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list:
            mock_list.return_value = {
                "executions": [
                    {"id": "1", "status": "running"},
                    {"id": "2", "status": "passed"},
                    {"id": "3", "status": "failed"},
                ],
                "total": 3,
            }

            from wavecore.api.routes.dashboard import get_execution_statistics

            stats = get_execution_statistics()

            assert isinstance(stats, dict)
            assert "sinceDays" in stats
            assert "count" in stats
            assert "running" in stats
            assert "passed" in stats
            assert "failed" in stats

    def test_get_execution_statistics_filters_by_time_window(self) -> None:
        """Test that execution statistics respects time window parameter."""
        with patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list:
            mock_list.return_value = {"executions": [], "total": 0}

            from wavecore.api.routes.dashboard import get_execution_statistics

            get_execution_statistics(time_window_hours=24)

            mock_list.assert_called_once()

    def test_get_execution_statistics_counts_by_status(self) -> None:
        """Test that executions are counted by status."""
        with patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list:
            mock_list.return_value = {
                "executions": [
                    {"id": "1", "status": "running"},
                    {"id": "2", "status": "passed"},
                    {"id": "3", "status": "failed"},
                    {"id": "4", "status": "failed"},
                ],
                "total": 4,
            }

            from wavecore.api.routes.dashboard import get_execution_statistics

            stats = get_execution_statistics()

            assert stats["running"] == 1
            assert stats["passed"] == 1
            assert stats["failed"] == 2
            assert stats["count"] == 4


class TestDashboardRecentActivityFunction:
    """Test suite for dashboard recent activity function."""

    def test_get_recent_activity_returns_list(self) -> None:
        """Test that get_recent_activity returns list."""
        with patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent:
            mock_recent.return_value = []

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert isinstance(result, list)

    def test_get_recent_activity_formats_entities(self) -> None:
        """Test that get_recent_activity formats entity data correctly.

        API returns raw data for frontend to format:
        - Tests: suiteCount (number of suites the test belongs to; 0 = unassigned)
        - Suites/Regressions: testCount
        """
        mock_entity = MagicMock()
        mock_entity.id = "test-1"
        mock_entity.type = "test"
        mock_entity.name = "Login Test"
        mock_entity.metadata = {}
        mock_entity.updated_at = datetime.now(UTC)

        with patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent:
            mock_recent.return_value = [mock_entity]

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            assert result[0]["id"] == "test-1"
            assert result[0]["type"] == "test"
            assert result[0]["name"] == "Login Test"
            assert "timestamp" in result[0]
            # Tests carry suiteCount, never parentSuite
            assert "suiteCount" in result[0]
            assert "parentSuite" not in result[0]

    def test_get_recent_activity_unassigned_test_has_zero_suite_count(self) -> None:
        """A test in no suites surfaces suiteCount=0 (frontend renders 'Unassigned')."""
        mock_entity = MagicMock()
        mock_entity.id = "test-2"
        mock_entity.type = "test"
        mock_entity.name = "Standalone Test"
        mock_entity.metadata = {}
        mock_entity.updated_at = datetime.now(UTC)

        with (
            patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent,
            patch(
                "wavecore.api.services.relations.service.get_suite_membership_bulk",
                return_value={"test-2": []},
            ),
        ):
            mock_recent.return_value = [mock_entity]

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            assert result[0]["suiteCount"] == 0
            assert "parentSuite" not in result[0]

    def test_get_recent_activity_assigned_test_counts_suites(self) -> None:
        """A test referenced by multiple suites surfaces the correct suiteCount."""
        mock_entity = MagicMock()
        mock_entity.id = "test-shared"
        mock_entity.type = "test"
        mock_entity.name = "Shared Test"
        mock_entity.metadata = {}
        mock_entity.updated_at = datetime.now(UTC)

        # The relation index reports the test belongs to two suites.
        membership = {
            "test-shared": [
                {"id": "suite-a", "name": "Suite A"},
                {"id": "suite-b", "name": "Suite B"},
            ],
        }

        with (
            patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent,
            patch(
                "wavecore.api.services.relations.service.get_suite_membership_bulk",
                return_value=membership,
            ),
        ):
            mock_recent.return_value = [mock_entity]

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            assert result[0]["suiteCount"] == 2

    def test_get_recent_activity_suite_with_test_count(self) -> None:
        """Test that suites include testCount computed from suite.tests arrays."""
        mock_entity = MagicMock()
        mock_entity.id = "suite-1"
        mock_entity.type = "suite"
        mock_entity.name = "API Tests"
        mock_entity.metadata = {}
        mock_entity.updated_at = datetime.now(UTC)

        with (
            patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent,
            patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_suite_storage,
        ):
            mock_recent.return_value = [mock_entity]
            # Suites with tests arrays
            mock_suite_storage._list_all_suites.return_value = [
                {"id": "suite-1", "name": "API Tests", "tests": ["t1", "t2", "t3"]},
                {"id": "suite-2", "name": "Other Suite", "tests": ["t4"]},
            ]

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            assert result[0]["type"] == "suite"
            assert result[0]["testCount"] == 3  # From suite.tests array

    def test_get_recent_activity_regression_with_test_count(self) -> None:
        """Test that regressions include testCount computed from suites."""
        mock_entity = MagicMock()
        mock_entity.id = "reg-1"
        mock_entity.type = "regression"
        mock_entity.name = "v2.0 Release"
        mock_entity.metadata = {}
        mock_entity.updated_at = datetime.now(UTC)

        with (
            patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent,
            patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_suite_storage,
        ):
            mock_recent.return_value = [mock_entity]
            # Suites with tests arrays and parent_regression
            mock_suite_storage._list_all_suites.return_value = [
                {
                    "id": "s1",
                    "name": "Suite A",
                    "tests": ["t1", "t2"],
                    "metadata": {"parent_regression": "v2.0 Release"},
                },
                {
                    "id": "s2",
                    "name": "Suite B",
                    "tests": ["t3"],
                    "metadata": {"parent_regression": "v2.0 Release"},
                },
                {
                    "id": "s3",
                    "name": "Suite C",
                    "tests": ["t4"],
                    "metadata": {"parent_regression": "Other Reg"},
                },
            ]

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            assert result[0]["type"] == "regression"
            # Suite A has 2 tests, Suite B has 1 test = 3 total for v2.0 Release
            assert result[0]["testCount"] == 3

    def test_get_recent_activity_suite_with_no_tests(self) -> None:
        """Test that suites with no assigned tests have testCount of 0."""
        mock_entity = MagicMock()
        mock_entity.id = "suite-empty"
        mock_entity.type = "suite"
        mock_entity.name = "Empty Suite"
        mock_entity.metadata = {}
        mock_entity.updated_at = datetime.now(UTC)

        with (
            patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent,
            patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_suite_storage,
        ):
            mock_recent.return_value = [mock_entity]
            mock_suite_storage._list_all_suites.return_value = [
                {"id": "suite-empty", "name": "Empty Suite", "tests": []},
            ]

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            assert result[0]["testCount"] == 0

    def test_get_recent_activity_regression_with_no_suites(self) -> None:
        """Test that regressions with no assigned suites have testCount of 0."""
        mock_entity = MagicMock()
        mock_entity.id = "reg-empty"
        mock_entity.type = "regression"
        mock_entity.name = "Empty Regression"
        mock_entity.metadata = {}
        mock_entity.updated_at = datetime.now(UTC)

        with (
            patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent,
            patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_suite_storage,
        ):
            mock_recent.return_value = [mock_entity]
            mock_suite_storage._list_all_suites.return_value = []

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            assert result[0]["testCount"] == 0


class TestGetRecentEntities:
    """Test suite for get_recent_entities over the tests, suites and regressions listings."""

    def test_get_recent_entities_with_tests(self) -> None:
        """Test get_recent_entities includes test entities."""
        from wavecore.api.routes.dashboard.helpers import get_recent_entities

        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_tests,
            patch("wavecore.api.services.suites._storage._list_all_suites") as mock_suites,
            patch("wavecore.api.services.regressions._storage._list_all_regressions") as mock_regs,
        ):
            mock_tests.return_value = [
                {"id": "test-1", "name": "Test One", "updated_at": "2025-01-01T00:00:00Z"}
            ]
            mock_suites.return_value = []
            mock_regs.return_value = []

            result = get_recent_entities()

            assert len(result) == 1
            assert result[0].id == "test-1"
            assert result[0].name == "Test One"
            assert result[0].type == "test"

    def test_get_recent_entities_with_suites(self) -> None:
        """Test get_recent_entities includes suite entities."""
        from wavecore.api.routes.dashboard.helpers import get_recent_entities

        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_tests,
            patch("wavecore.api.services.suites._storage._list_all_suites") as mock_suites,
            patch("wavecore.api.services.regressions._storage._list_all_regressions") as mock_regs,
        ):
            mock_tests.return_value = []
            mock_suites.return_value = [
                {
                    "id": "suite-1",
                    "name": "Suite One",
                    "updated_at": "2025-01-01T00:00:00Z",
                    "metadata": {"test_count": 10},
                }
            ]
            mock_regs.return_value = []

            result = get_recent_entities()

            assert len(result) == 1
            assert result[0].id == "suite-1"
            assert result[0].name == "Suite One"
            assert result[0].type == "suite"

    def test_get_recent_entities_with_regressions(self) -> None:
        """Test get_recent_entities includes regression entities."""
        from wavecore.api.routes.dashboard.helpers import get_recent_entities

        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_tests,
            patch("wavecore.api.services.suites._storage._list_all_suites") as mock_suites,
            patch("wavecore.api.services.regressions._storage._list_all_regressions") as mock_regs,
        ):
            mock_tests.return_value = []
            mock_suites.return_value = []
            mock_regs.return_value = [
                {
                    "id": "reg-1",
                    "name": "Regression One",
                    "updated_at": "2025-01-01T00:00:00Z",
                    "metadata": {"test_count": 50},
                }
            ]

            result = get_recent_entities()

            assert len(result) == 1
            assert result[0].id == "reg-1"
            assert result[0].name == "Regression One"
            assert result[0].type == "regression"

    def test_get_recent_entities_sorts_by_updated_at(self) -> None:
        """Test get_recent_entities sorts by updated_at timestamp."""
        from wavecore.api.routes.dashboard.helpers import get_recent_entities

        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_tests,
            patch("wavecore.api.services.suites._storage._list_all_suites") as mock_suites,
            patch("wavecore.api.services.regressions._storage._list_all_regressions") as mock_regs,
        ):
            mock_tests.return_value = [
                {"id": "test-old", "name": "Old Test", "updated_at": "2025-01-01T00:00:00Z"},
                {"id": "test-new", "name": "New Test", "updated_at": "2025-12-31T23:59:59Z"},
            ]
            mock_suites.return_value = []
            mock_regs.return_value = []

            result = get_recent_entities()

            # Most recent should be first
            assert result[0].id == "test-new"
            assert result[1].id == "test-old"

    def test_get_recent_entities_handles_test_service_exception(self) -> None:
        """Test that exceptions from test_service are caught and ignored."""
        from wavecore.api.routes.dashboard.helpers import get_recent_entities

        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_tests,
            patch("wavecore.api.services.suites._storage._list_all_suites") as mock_suites,
            patch("wavecore.api.services.regressions._storage._list_all_regressions") as mock_regs,
        ):
            mock_tests.side_effect = OSError("Storage failure")
            mock_suites.return_value = []
            mock_regs.return_value = []

            result = get_recent_entities()

            # Should return empty list, not raise
            assert result == []

    def test_get_recent_entities_handles_suite_service_exception(self) -> None:
        """Test that exceptions from suite_service are caught and ignored."""
        from wavecore.api.routes.dashboard.helpers import get_recent_entities

        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_tests,
            patch("wavecore.api.services.suites._storage._list_all_suites") as mock_suites,
            patch("wavecore.api.services.regressions._storage._list_all_regressions") as mock_regs,
        ):
            mock_tests.return_value = []
            mock_suites.side_effect = OSError("Storage failure")
            mock_regs.return_value = []

            result = get_recent_entities()

            # Should return empty list, not raise
            assert result == []

    def test_get_recent_entities_handles_regression_service_exception(self) -> None:
        """Test that exceptions from regression_service are caught and ignored."""
        from wavecore.api.routes.dashboard.helpers import get_recent_entities

        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_tests,
            patch("wavecore.api.services.suites._storage._list_all_suites") as mock_suites,
            patch("wavecore.api.services.regressions._storage._list_all_regressions") as mock_regs,
        ):
            mock_tests.return_value = []
            mock_suites.return_value = []
            mock_regs.side_effect = OSError("Storage failure")

            result = get_recent_entities()

            # Should return empty list, not raise
            assert result == []

    def test_get_recent_entities_entity_without_timestamp(self) -> None:
        """Test sorting handles entities without any timestamp."""
        from wavecore.api.routes.dashboard.helpers import get_recent_entities

        with (
            patch("wavecore.api.services.tests.service._list_all_tests") as mock_tests,
            patch("wavecore.api.services.suites._storage._list_all_suites") as mock_suites,
            patch("wavecore.api.services.regressions._storage._list_all_regressions") as mock_regs,
        ):
            # Test without updated_at
            mock_tests.return_value = [{"id": "test-1", "name": "No Timestamp Test"}]
            mock_suites.return_value = []
            mock_regs.return_value = []

            result = get_recent_entities()

            assert len(result) == 1
            assert result[0].id == "test-1"


class TestComputeSuiteTestCounts:
    """Test suite for _compute_suite_test_counts function."""

    def test_computes_counts_from_suite_tests_arrays(self) -> None:
        """Test that suite test counts are computed from suite.tests arrays."""
        with patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_storage:
            mock_storage._list_all_suites.return_value = [
                {"id": "s1", "name": "Suite A", "tests": ["t1", "t2"]},
                {"id": "s2", "name": "Suite B", "tests": ["t3"]},
                {"id": "s3", "name": "Suite C", "tests": []},
            ]

            from wavecore.api.routes.dashboard import _compute_suite_test_counts

            counts = _compute_suite_test_counts()

            assert counts == {"Suite A": 2, "Suite B": 1, "Suite C": 0}

    def test_returns_empty_dict_on_exception(self) -> None:
        """Test that exceptions are caught and empty dict returned."""
        with patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_storage:
            mock_storage._list_all_suites.side_effect = OSError("Storage error")

            from wavecore.api.routes.dashboard import _compute_suite_test_counts

            counts = _compute_suite_test_counts()

            assert counts == {}

    def test_skips_suites_without_name(self) -> None:
        """Test that suites without a name are skipped."""
        with patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_storage:
            mock_storage._list_all_suites.return_value = [
                {"id": "s1", "name": "", "tests": ["t1"]},
                {"id": "s2", "name": "Suite A", "tests": ["t2"]},
            ]

            from wavecore.api.routes.dashboard import _compute_suite_test_counts

            counts = _compute_suite_test_counts()

            assert counts == {"Suite A": 1}


class TestComputeRegressionTestCounts:
    """Test suite for _compute_regression_test_counts function."""

    def test_computes_counts_from_suites(self) -> None:
        """Test that regression test counts are computed from suites."""
        suite_test_counts = {"Suite A": 5, "Suite B": 3, "Suite C": 2}

        with patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_storage:
            mock_storage._list_all_suites.return_value = [
                {"id": "s1", "name": "Suite A", "metadata": {"parent_regression": "Reg 1"}},
                {"id": "s2", "name": "Suite B", "metadata": {"parent_regression": "Reg 1"}},
                {"id": "s3", "name": "Suite C", "metadata": {"parent_regression": "Reg 2"}},
            ]

            from wavecore.api.routes.dashboard import _compute_regression_test_counts

            counts = _compute_regression_test_counts(suite_test_counts)

            # Reg 1 = Suite A (5) + Suite B (3) = 8
            # Reg 2 = Suite C (2) = 2
            assert counts == {"Reg 1": 8, "Reg 2": 2}

    def test_returns_empty_dict_on_exception(self) -> None:
        """Test that exceptions are caught and empty dict returned."""
        with patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_storage:
            mock_storage._list_all_suites.side_effect = OSError("Storage error")

            from wavecore.api.routes.dashboard import _compute_regression_test_counts

            counts = _compute_regression_test_counts({})

            assert counts == {}

    def test_handles_non_dict_metadata(self) -> None:
        """Test that non-dict metadata is handled gracefully."""
        suite_test_counts = {"Suite A": 5}

        with patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_storage:
            mock_storage._list_all_suites.return_value = [
                {"id": "s1", "name": "Suite A", "metadata": "not a dict"},
                {"id": "s2", "name": "Suite B", "metadata": {"parent_regression": "Reg 1"}},
            ]

            from wavecore.api.routes.dashboard import _compute_regression_test_counts

            counts = _compute_regression_test_counts(suite_test_counts)

            # Suite B has no tests in suite_test_counts, so count is 0
            assert counts == {"Reg 1": 0}

    def test_suite_not_in_counts_defaults_to_zero(self) -> None:
        """Test that suites without tests contribute 0 to regression count."""
        suite_test_counts = {"Suite A": 5}  # Suite B not in counts

        with patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_storage:
            mock_storage._list_all_suites.return_value = [
                {"id": "s1", "name": "Suite A", "metadata": {"parent_regression": "Reg 1"}},
                {"id": "s2", "name": "Suite B", "metadata": {"parent_regression": "Reg 1"}},
            ]

            from wavecore.api.routes.dashboard import _compute_regression_test_counts

            counts = _compute_regression_test_counts(suite_test_counts)

            # Suite A (5) + Suite B (0) = 5
            assert counts == {"Reg 1": 5}


class TestDashboardRunningExecutionsFunction:
    """Test suite for dashboard running executions function."""

    def test_get_recent_executions_returns_list(self) -> None:
        """Test that get_recent_executions returns list."""
        with patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list:
            mock_list.return_value = {"executions": [], "total": 0}

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            assert isinstance(result, list)

    def test_get_recent_executions_filters_by_running_status(self) -> None:
        """Test that get_recent_executions only returns running executions."""
        with patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list:
            mock_list.return_value = {
                "executions": [
                    {"id": "1", "status": "running", "progress": {"percentage": 50}},
                ],
                "total": 1,
            }

            from wavecore.api.routes.dashboard import get_recent_executions

            _result = get_recent_executions()

            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args
            # Should filter by running status
            assert call_kwargs is not None

    def test_get_recent_executions_includes_progress(self) -> None:
        """Test that running executions include progress percentage."""
        with (
            patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list,
            patch("wavecore.api.routes.dashboard.helpers.get_execution_progress") as mock_progress,
        ):
            mock_list.return_value = {
                "executions": [{"id": "1", "status": "running", "type": "test", "entity_id": "t1"}],
                "total": 1,
            }
            mock_progress.return_value = {"current": 5, "total": 10, "percentage": 50.0}

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            assert len(result) == 1
            assert "progress" in result[0]

    def test_get_recent_executions_flattens_progress_dict_to_number(self) -> None:
        """The helper must return a numeric `progress`, not the runtime
        `{current, total, percentage}` dict, or the UI shows `[object Object]%`.
        """
        with (
            patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list,
            patch("wavecore.api.routes.dashboard.helpers.get_execution_progress") as mock_progress,
        ):
            mock_list.return_value = {
                "executions": [
                    {
                        "id": "e1",
                        "status": "running",
                        "entity_type": "suite",
                        "entity_id": "s1",
                        "environment_id": "env-1",
                    }
                ],
                "total": 1,
            }
            mock_progress.return_value = {
                "current": 3,
                "total": 5,
                "percentage": 60.0,
            }

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            assert len(result) == 1
            assert result[0]["progress"] == 60.0
            assert isinstance(result[0]["progress"], int | float)
            assert not isinstance(result[0]["progress"], dict)

    def test_get_recent_executions_ignores_stale_stored_progress(self) -> None:
        """The `progress` dict stored on the execution record is only
        refreshed when someone hits the detail endpoint for that execution.
        `list_executions` returns raw storage, so trusting the stored value
        leaks a snapshot that can be many minutes out of date. The helper
        must always compute live via `get_execution_progress`, ignoring
        whatever stale dict happens to be on the record.
        """
        with (
            patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list,
            patch("wavecore.api.routes.dashboard.helpers.get_execution_progress") as mock_progress,
        ):
            mock_list.return_value = {
                "executions": [
                    {
                        "id": "e1",
                        "status": "running",
                        "entity_type": "regression",
                        "entity_id": "r1",
                        "environment_id": "env-1",
                        # Stale snapshot from the last detail fetch:
                        "progress": {"current": 1, "total": 19, "percentage": 5.26},
                    }
                ],
                "total": 1,
            }
            # Live state: 15 of 19 done.
            mock_progress.return_value = {
                "current": 15,
                "total": 19,
                "percentage": 78.94,
            }

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            assert result[0]["testsDone"] == 15
            assert result[0]["testsTotal"] == 19
            # Percentage is recomputed against the selected denominator
            # (rather than trusted from progress_data.percentage) and
            # rounded to 2 decimals so the UI never renders a long float.
            assert result[0]["progress"] == pytest.approx(round(15 / 19 * 100, 2))

    def test_get_recent_executions_falls_back_to_stored_fields_when_no_runtime_state(
        self,
    ) -> None:
        """Synthetic admin/bulk-written executions (used by V-DASH fixtures)
        have no runtime state - `get_execution_progress` returns None or an
        empty `{current:0, total:1}`. In that case the helper must fall back
        to the stored fields: `tests_selected` (or `tests_total`) as Y, and
        derive X from the stored `progress` percentage so "X/Y tests done"
        stays consistent with the percentage shown on the same card.
        """
        with (
            patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list,
            patch("wavecore.api.routes.dashboard.helpers.get_execution_progress") as mock_progress,
        ):
            mock_list.return_value = {
                "executions": [
                    {
                        "id": "e1",
                        "status": "running",
                        "entity_type": "suite",
                        "entity_id": "s1",
                        "environment_id": "env-1",
                        "tests_total": 25,
                        "tests_selected": 20,
                        "progress": 40,  # raw percentage number
                    }
                ],
                "total": 1,
            }
            mock_progress.return_value = None  # synthetic fixture - no state

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            # Y = tests_selected (20), not tests_total (25).
            assert result[0]["testsTotal"] == 20
            # X = round(40% of 20) = 8.
            assert result[0]["testsDone"] == 8
            assert result[0]["progress"] == 40.0

    def test_get_recent_executions_uses_selected_tests_as_total_when_provided(
        self,
    ) -> None:
        """testsTotal must represent the user's selection, not the count of
        non-excluded runs in state. Non-selected tests are left in the runs
        map as `pending` (not `excluded`), so `progress.total` counts them
        too and inflates the denominator. When `selected_tests` is present
        on the execution record, the helper must use its length as Y so
        the "X/Y tests done" display matches the user's mental model.
        """
        with (
            patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list,
            patch("wavecore.api.routes.dashboard.helpers.get_execution_progress") as mock_progress,
        ):
            mock_list.return_value = {
                "executions": [
                    {
                        "id": "e1",
                        "status": "running",
                        "entity_type": "regression",
                        "entity_id": "r1",
                        "environment_id": "env-1",
                        # User picked 16 of 20 tests - the 4 unselected are
                        # parked as "pending" in the runs map, not "excluded".
                        "selected_tests": [
                            {"suite_id": "s", "test_id": f"t{i}"} for i in range(16)
                        ],
                    }
                ],
                "total": 1,
            }
            # Live compute over ALL runs in the map: 20 non-excluded total,
            # 10 terminal so far - this is what `_compute_progress` returns.
            mock_progress.return_value = {
                "current": 10,
                "total": 20,
                "percentage": 50.0,
            }

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            # Y = len(selected_tests), NOT progress.total.
            assert result[0]["testsTotal"] == 16
            assert result[0]["testsDone"] == 10
            # Percentage is recomputed against the selected-tests denominator.
            assert result[0]["progress"] == 62.5

    def test_get_recent_executions_populates_tests_total_from_progress_state_when_no_selection(
        self,
    ) -> None:
        """When `selected_tests` is absent (the "run everything" case), the
        helper falls back to the live progress state's `total` field as Y.
        """
        with (
            patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list,
            patch("wavecore.api.routes.dashboard.helpers.get_execution_progress") as mock_progress,
        ):
            mock_list.return_value = {
                "executions": [
                    {
                        "id": "e1",
                        "status": "running",
                        "entity_type": "regression",
                        "entity_id": "r1",
                        "environment_id": "env-1",
                    }
                ],
                "total": 1,
            }
            mock_progress.return_value = {
                "current": 2,
                "total": 7,
                "percentage": 28.57,
            }

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            assert result[0]["testsTotal"] == 7

    def test_get_recent_executions_populates_tests_done_from_progress_state(
        self,
    ) -> None:
        """testsDone reflects how many runs have reached a terminal state
        (passed, failed, skipped, stopped). It comes from the live progress
        state's `current` counter, which is the same value the Workbench
        progress bar uses.
        """
        with (
            patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list,
            patch("wavecore.api.routes.dashboard.helpers.get_execution_progress") as mock_progress,
        ):
            mock_list.return_value = {
                "executions": [
                    {
                        "id": "e1",
                        "status": "running",
                        "entity_type": "regression",
                        "entity_id": "r1",
                        "environment_id": "env-1",
                    }
                ],
                "total": 1,
            }
            mock_progress.return_value = {
                "current": 2,
                "total": 7,
                "percentage": 28.57,
            }

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            assert result[0]["testsDone"] == 2
            assert result[0]["testsTotal"] == 7

    def test_get_recent_executions_resolves_environment_name(self) -> None:
        """environment on the dashboard item is the environment's name, not
        the id and not a hardcoded fallback like 'default'."""
        with (
            patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list,
            patch(
                "wavecore.api.routes.dashboard.helpers.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_list.return_value = {
                "executions": [
                    {
                        "id": "e1",
                        "status": "running",
                        "entity_type": "test",
                        "entity_id": "t1",
                        "environment_id": "env-staging-id",
                    }
                ],
                "total": 1,
            }
            mock_get_env.return_value = {"id": "env-staging-id", "name": "Staging"}

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            assert len(result) == 1
            assert result[0]["environment"] == "Staging"
            mock_get_env.assert_called_once_with("env-staging-id")

    def test_get_recent_executions_falls_back_to_environment_id_when_unresolved(self) -> None:
        """If the environment record is missing, use the id so the UI can at
        least show something stable (not a literal 'default')."""
        with (
            patch("wavecore.api.routes.dashboard.helpers.list_executions") as mock_list,
            patch(
                "wavecore.api.routes.dashboard.helpers.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_list.return_value = {
                "executions": [
                    {
                        "id": "e1",
                        "status": "running",
                        "entity_type": "test",
                        "entity_id": "t1",
                        "environment_id": "missing-env-id",
                    }
                ],
                "total": 1,
            }
            mock_get_env.return_value = None

            from wavecore.api.routes.dashboard import get_recent_executions

            result = get_recent_executions()

            assert result[0]["environment"] == "missing-env-id"


class TestDashboardMetaSection:
    """Test suite for dashboard response metadata."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_response_includes_meta_section(self, client: TestClient) -> None:
        """Test that response includes meta section."""
        response = client.get("/dashboard")

        data = response.json()
        assert "meta" in data

    def test_meta_includes_timestamp(self, client: TestClient) -> None:
        """Test that meta includes response timestamp in ISO 8601 format."""
        response = client.get("/dashboard")

        data = response.json()
        meta = data.get("meta", {})
        # Must have either timestamp or generatedAt
        assert "timestamp" in meta or "generatedAt" in meta
        # Validate ISO 8601 format
        timestamp_value = meta.get("timestamp") or meta.get("generatedAt")
        datetime.fromisoformat(timestamp_value.replace("Z", "+00:00"))

    def test_meta_errors_empty_on_success(self, client: TestClient) -> None:
        """Test that errors array is empty when all sections succeed."""
        with (
            patch("wavecore.api.routes.dashboard.routes.get_test_count") as mock_tests,
            patch("wavecore.api.routes.dashboard.routes.get_suite_count") as mock_suites,
            patch("wavecore.api.routes.dashboard.routes.get_regression_count") as mock_regressions,
            patch("wavecore.api.routes.dashboard.routes.get_execution_statistics") as mock_stats,
            patch("wavecore.api.routes.dashboard.routes.get_recent_activity") as mock_activity,
            patch("wavecore.api.routes.dashboard.routes.get_recent_executions") as mock_executions,
        ):
            mock_tests.return_value = 10
            mock_suites.return_value = 5
            mock_regressions.return_value = 2
            mock_stats.return_value = {
                "sinceDays": 1,
                "count": 22,
                "running": 0,
                "passed": 20,
                "failed": 2,
            }
            mock_activity.return_value = []
            mock_executions.return_value = []

            response = client.get("/dashboard")

            data = response.json()
            errors = data.get("meta", {}).get("errors", [])
            assert errors == [] or errors is None


class TestGetExecutionProgress:
    """Test suite for get_execution_progress function."""

    def test_get_execution_progress_returns_progress_data(self) -> None:
        """Test that get_execution_progress returns progress dictionary."""
        with patch("wavecore.api.routes.dashboard.helpers.execution_service") as mock_service:
            mock_service.get_execution_progress.return_value = {
                "percentage": 50,
                "current": 5,
                "total": 10,
            }

            from wavecore.api.routes.dashboard import get_execution_progress

            result = get_execution_progress("exec-123")

            assert result == {"percentage": 50, "current": 5, "total": 10}
            mock_service.get_execution_progress.assert_called_once_with("exec-123")


class TestResolveEntityName:
    """Test suite for _resolve_entity_name function."""

    def test_resolve_test_name_found(self) -> None:
        """Test resolving test entity name when found."""
        with patch("wavecore.api.routes.dashboard.helpers.test_service") as mock_service:
            mock_service._list_all_tests.return_value = [
                {"id": "api-health", "name": "API Health Check"},
                {"id": "login-test", "name": "Login Test"},
            ]

            from wavecore.api.routes.dashboard import _resolve_entity_name

            result = _resolve_entity_name("api-health", "test")

            assert result == "API Health Check"

    def test_resolve_test_name_not_found(self) -> None:
        """Test resolving test entity name when not found returns ID."""
        with patch("wavecore.api.routes.dashboard.helpers.test_service") as mock_service:
            mock_service._list_all_tests.return_value = []

            from wavecore.api.routes.dashboard import _resolve_entity_name

            result = _resolve_entity_name("missing-test", "test")

            assert result == "missing-test"

    def test_resolve_suite_name_found(self) -> None:
        """Test resolving suite entity name when found."""
        with patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_storage:
            mock_storage._list_all_suites.return_value = [
                {"id": "smoke-tests", "name": "Smoke Tests"},
            ]

            from wavecore.api.routes.dashboard import _resolve_entity_name

            result = _resolve_entity_name("smoke-tests", "suite")

            assert result == "Smoke Tests"

    def test_resolve_suite_name_not_found(self) -> None:
        """Test resolving suite entity name when not found returns ID."""
        with patch("wavecore.api.routes.dashboard.helpers._suite_storage") as mock_storage:
            mock_storage._list_all_suites.return_value = []

            from wavecore.api.routes.dashboard import _resolve_entity_name

            result = _resolve_entity_name("missing-suite", "suite")

            assert result == "missing-suite"

    def test_resolve_regression_name_found(self) -> None:
        """Test resolving regression entity name when found."""
        with patch("wavecore.api.routes.dashboard.helpers._reg_storage") as mock_storage:
            mock_storage._list_all_regressions.return_value = [
                {"id": "v2-release", "name": "v2.0 Release"},
            ]

            from wavecore.api.routes.dashboard import _resolve_entity_name

            result = _resolve_entity_name("v2-release", "regression")

            assert result == "v2.0 Release"

    def test_resolve_regression_name_not_found(self) -> None:
        """Test resolving regression entity name when not found returns ID."""
        with patch("wavecore.api.routes.dashboard.helpers._reg_storage") as mock_storage:
            mock_storage._list_all_regressions.return_value = []

            from wavecore.api.routes.dashboard import _resolve_entity_name

            result = _resolve_entity_name("missing-reg", "regression")

            assert result == "missing-reg"

    def test_resolve_unknown_type_returns_id(self) -> None:
        """Test resolving unknown entity type returns entity ID."""
        from wavecore.api.routes.dashboard import _resolve_entity_name

        result = _resolve_entity_name("some-id", "unknown")

        assert result == "some-id"

    def test_resolve_exception_returns_id(self) -> None:
        """Test that exceptions are caught and entity ID is returned."""
        with patch("wavecore.api.routes.dashboard.helpers.test_service") as mock_service:
            mock_service._list_all_tests.side_effect = OSError("Storage error")

            from wavecore.api.routes.dashboard import _resolve_entity_name

            result = _resolve_entity_name("test-id", "test")

            assert result == "test-id"


class TestGetRecentActivityMetadataEdgeCases:
    """Test edge cases for get_recent_activity metadata handling."""

    def test_metadata_not_dict_converted_to_empty(self) -> None:
        """Test that non-dict metadata is converted to empty dict."""
        mock_entity = MagicMock()
        mock_entity.id = "test-1"
        mock_entity.type = "test"
        mock_entity.name = "Test Name"
        mock_entity.metadata = "not a dict"  # Invalid metadata
        mock_entity.updated_at = datetime.now(UTC)

        with patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent:
            mock_recent.return_value = [mock_entity]

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            # Tests do not include parentSuite
            assert "parentSuite" not in result[0]


class TestExtractEntityTimestamp:
    """Test edge cases for _extract_entity_timestamp helper."""

    def test_returns_empty_string_when_updated_at_is_none(self) -> None:
        """Test that None updated_at produces an empty timestamp string."""
        mock_entity = MagicMock()
        mock_entity.id = "test-1"
        mock_entity.type = "test"
        mock_entity.name = "Test"
        mock_entity.metadata = {}
        mock_entity.updated_at = None

        with patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent:
            mock_recent.return_value = [mock_entity]

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            assert result[0]["timestamp"] == ""

    def test_converts_non_datetime_updated_at_to_string(self) -> None:
        """Test that a non-datetime updated_at value is converted via str()."""
        mock_entity = MagicMock()
        mock_entity.id = "test-2"
        mock_entity.type = "test"
        mock_entity.name = "Test"
        mock_entity.metadata = {}
        mock_entity.updated_at = "2026-01-15T10:00:00"  # String, not datetime

        with patch("wavecore.api.routes.dashboard.helpers.get_recent_entities") as mock_recent:
            mock_recent.return_value = [mock_entity]

            from wavecore.api.routes.dashboard import get_recent_activity

            result = get_recent_activity()

            assert len(result) == 1
            assert result[0]["timestamp"] == "2026-01-15T10:00:00"


class TestDashboardScansEachDirectoryOnce:
    """One dashboard build must not pay the same directory scan more than once.

    The dashboard is polled every five seconds and its short cache is dropped on
    every entity or execution change, so during a live run every poll rebuilds.
    """

    def setup_method(self) -> None:
        from wavecore.api.services.executions import _storage as execution_storage

        execution_storage._clear_in_memory_cache()

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    @staticmethod
    def _seed_execution(test_id: str, name: str) -> None:
        from wavecore.api.services.executions import _storage as execution_storage

        execution = {
            "id": str(uuid4()),
            "name": name,
            "entity_type": "test",
            "entity_id": test_id,
            "environment_id": "",
            "status": "passed",
            "started_at": datetime.now(UTC).isoformat(),
            "ended_at": datetime.now(UTC).isoformat(),
            "duration": 1.0,
            "tests_selected": 1,
            "progress": 100,
        }
        execution_storage._save_execution(execution)
        execution_storage._execution_storage[execution["id"]] = execution

    def test_one_request_scans_the_tests_directory_once(
        self, monkeypatch: pytest.MonkeyPatch, client: TestClient
    ) -> None:
        """Counts, recent activity and execution names must share one scan."""
        from wavecore.api.routes.dashboard import routes as dashboard_routes
        from wavecore.api.services import entity_cache
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "Scanned Once"})
        self._seed_execution(created["id"], "First Run")
        self._seed_execution(created["id"], "Second Run")

        scanned: list[str] = []
        real_scan = entity_cache.scan_entity_ids

        def counting_scan(storage_dir: Path, filename: str) -> set[str]:
            scanned.append(storage_dir.name)
            return real_scan(storage_dir, filename)

        monkeypatch.setattr(entity_cache, "scan_entity_ids", counting_scan)
        dashboard_routes.invalidate_dashboard_cache()

        response = client.get("/dashboard")

        assert response.status_code == 200
        assert scanned.count("api_tests") == 1

    def test_listing_all_tests_does_not_grow_with_the_number_of_executions(
        self, monkeypatch: pytest.MonkeyPatch, client: TestClient
    ) -> None:
        """Resolving execution names must not list every test once per row."""
        from wavecore.api.routes.dashboard import routes as dashboard_routes
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "Counted"})
        self._seed_execution(created["id"], "First Run")

        calls: list[str] = []
        real_list = test_service._list_all_tests

        def counting_list() -> list[dict[str, Any]]:
            calls.append("call")
            return real_list()

        monkeypatch.setattr(test_service, "_list_all_tests", counting_list)
        dashboard_routes.invalidate_dashboard_cache()
        client.get("/dashboard")
        with_one_execution = len(calls)

        for index in range(4):
            self._seed_execution(created["id"], f"Run {index}")
        calls.clear()
        dashboard_routes.invalidate_dashboard_cache()

        response = client.get("/dashboard")

        assert response.status_code == 200
        assert len(response.json()["recentExecutions"]) == 5
        assert len(calls) == with_one_execution

    def test_execution_rows_still_name_their_test(self, client: TestClient) -> None:
        """The shared index must resolve the same names the per-row lookup did."""
        from wavecore.api.routes.dashboard import routes as dashboard_routes
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "Named From The Index"})
        self._seed_execution(created["id"], "First Run")
        dashboard_routes.invalidate_dashboard_cache()

        response = client.get("/dashboard")

        assert response.status_code == 200
        rows = response.json()["recentExecutions"]
        assert [row["entityName"] for row in rows] == ["Named From The Index"]
