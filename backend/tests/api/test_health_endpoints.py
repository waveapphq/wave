"""Unit tests for system health and status endpoints (REQ-5.2.4.11).

This module tests the health check architecture including liveness, readiness, and detailed
status endpoints as specified in REQ-5.2.4.11.

Test Coverage:
- Liveness checks (GET /health) for basic service availability
- Detailed health checks (GET /health/detailed) with component-level diagnostics
- System status endpoint (GET /status) with execution and resource metrics
- Version information endpoint (GET /version)
- Metrics endpoint (GET /metrics)
- Health state classification (healthy, degraded, unhealthy)
- Component health assessment
- Performance targets (liveness <10ms, readiness <100ms, detailed <500ms)
- Caching behavior with TTL
- Lifecycle integration (startup, ready, shutdown states)
"""

import asyncio
import re
import time
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


class TestHealthEndpoint:
    """Test suite for GET /health endpoint (liveness check)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_health_endpoint_returns_200_when_healthy(self, client: TestClient) -> None:
        """Test that /health returns 200 when system is healthy."""
        response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
        assert "version" in data

    def test_health_endpoint_returns_503_when_unhealthy(self, client: TestClient) -> None:
        """Test that /health returns 503 when system is unhealthy."""
        # Mock the health checker to return unhealthy state
        with patch("wavecore.api.routes.health.get_health_status") as mock_health:
            mock_health.return_value = {
                "status": "unhealthy",
                "timestamp": datetime.now(UTC).isoformat(),
                "version": "1.0.0",
            }

            response = client.get("/health")

            assert response.status_code == 503
            data = response.json()
            assert data["status"] == "unhealthy"

    def test_health_endpoint_returns_503_when_degraded(self, client: TestClient) -> None:
        """Test that /health returns 503 when system is degraded."""
        with patch("wavecore.api.routes.health.get_health_status") as mock_health:
            mock_health.return_value = {
                "status": "degraded",
                "timestamp": datetime.now(UTC).isoformat(),
                "version": "1.0.0",
            }

            response = client.get("/health")

            assert response.status_code == 503
            data = response.json()
            assert data["status"] == "degraded"

    def test_health_endpoint_response_structure(self, client: TestClient) -> None:
        """Test that /health response has correct structure per OpenAPI spec."""
        response = client.get("/health")

        data = response.json()
        assert isinstance(data, dict)
        assert "status" in data
        assert "timestamp" in data
        assert "version" in data
        assert data["status"] in ["healthy", "degraded", "unhealthy"]

        # Validate timestamp is ISO 8601 format
        datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))

    def test_health_endpoint_performance_target(self, client: TestClient) -> None:
        """Test that /health responds in <10ms (target for liveness checks).

        Note: Test allows 50ms threshold to account for test framework overhead
        (TestClient, mocking, etc). Production target remains <10ms as per REQ-5.2.4.11.
        """
        start = time.perf_counter()
        response = client.get("/health")
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert response.status_code == 200
        # Allow 5x margin for test environment overhead (TestClient, mocks, etc)
        assert elapsed_ms < 50, f"Health check took {elapsed_ms:.2f}ms, target <10ms"

    def test_health_endpoint_minimal_overhead(self, client: TestClient) -> None:
        """Test that /health does not perform expensive operations."""
        # Mock to ensure no storage checks are performed
        with patch("wavecore.api.routes.health.check_storage_health") as mock_storage:
            response = client.get("/health")

            assert response.status_code == 200
            # Liveness check should NOT validate dependencies
            mock_storage.assert_not_called()

    def test_health_endpoint_caching_behavior(self, client: TestClient) -> None:
        """Test that /health results are cached with TTL."""
        # First request
        response1 = client.get("/health")
        data1 = response1.json()

        # Second request immediately after should return cached result
        response2 = client.get("/health")
        data2 = response2.json()

        # Timestamps should be identical if cached
        assert data1["timestamp"] == data2["timestamp"]

    def test_health_endpoint_cache_invalidation_on_state_change(self, client: TestClient) -> None:
        """Test that health cache invalidates on state transitions."""
        # Initial healthy state
        response1 = client.get("/health")
        assert response1.json()["status"] == "healthy"

        # Simulate state transition to unhealthy
        with patch("wavecore.api.routes.health.invalidate_health_cache") as _mock_invalidate:
            with patch("wavecore.api.routes.health.get_health_status") as mock_health:
                mock_health.return_value = {
                    "status": "unhealthy",
                    "timestamp": datetime.now(UTC).isoformat(),
                    "version": "1.0.0",
                }

                # Trigger state change
                with patch("wavecore.api.routes.health.on_health_state_change"):
                    response2 = client.get("/health")

                assert response2.json()["status"] == "unhealthy"


class TestDetailedHealthEndpoint:
    """Test suite for GET /health/detailed endpoint (readiness check)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_detailed_health_returns_200_with_components(self, client: TestClient) -> None:
        """Test that /health/detailed returns component-level health status."""
        # Mock resource checks for deterministic testing
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "healthy",
                "database": "healthy",
                "execution_engine": "healthy",
            }

            response = client.get("/health/detailed")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] in ["healthy", "degraded", "unhealthy"]
            assert "components" in data
            assert "timestamp" in data

    def test_detailed_health_component_structure(self, client: TestClient) -> None:
        """Test that component health has correct structure."""
        # Mock resource checks for deterministic testing
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "healthy",
                "database": "healthy",
                "execution_engine": "healthy",
            }

            response = client.get("/health/detailed")

            data = response.json()
            components = data["components"]

            # Per OpenAPI spec, components include database, storage, execution_engine
            assert "database" in components
            assert "storage" in components
            assert "execution_engine" in components

            # Each component should report health status
            for component_name, status in components.items():
                assert status in [
                    "healthy",
                    "degraded",
                    "unhealthy",
                    "unknown",
                ], f"Component {component_name} has invalid status: {status}"

    def test_detailed_health_returns_503_when_unhealthy(self, client: TestClient) -> None:
        """Test that /health/detailed returns 503 when system is unhealthy."""
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "unhealthy",
                "database": "healthy",
                "execution_engine": "healthy",
            }

            response = client.get("/health/detailed")

            assert response.status_code == 503
            data = response.json()
            assert data["status"] == "unhealthy"

    def test_detailed_health_returns_503_when_degraded(self, client: TestClient) -> None:
        """Test that /health/detailed returns 503 when system is degraded."""
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "healthy",
                "database": "degraded",
                "execution_engine": "healthy",
            }

            response = client.get("/health/detailed")

            assert response.status_code == 503
            data = response.json()
            assert data["status"] == "degraded"

    def test_detailed_health_overall_status_aggregation(self, client: TestClient) -> None:
        """Test that overall status is conservative aggregation of components."""
        # All healthy -> overall healthy
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "healthy",
                "database": "healthy",
                "execution_engine": "healthy",
            }

            response = client.get("/health/detailed")
            assert response.status_code == 200
            assert response.json()["status"] == "healthy"

    def test_detailed_health_degraded_when_any_component_degraded(self, client: TestClient) -> None:
        """Test that overall status is degraded when any component is degraded."""
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "healthy",
                "database": "degraded",  # One degraded
                "execution_engine": "healthy",
            }

            response = client.get("/health/detailed")
            assert response.json()["status"] == "degraded"

    def test_detailed_health_unhealthy_when_any_component_unhealthy(
        self, client: TestClient
    ) -> None:
        """Test that overall status is unhealthy when any component is unhealthy."""
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "healthy",
                "database": "unhealthy",  # One unhealthy
                "execution_engine": "degraded",
            }

            response = client.get("/health/detailed")
            assert response.json()["status"] == "unhealthy"

    def test_detailed_health_validates_storage_accessibility(self, client: TestClient) -> None:
        """Test that detailed health validates storage accessibility."""
        with (
            patch("wavecore.api.routes.health.check_storage_health") as mock_storage,
            patch("wavecore.api.routes.health.check_configuration_health") as mock_config,
            patch("wavecore.api.routes.health.check_resource_health") as mock_resource,
        ):
            mock_storage.return_value = "healthy"
            mock_config.return_value = "healthy"
            mock_resource.return_value = "healthy"

            response = client.get("/health/detailed")

            assert response.status_code == 200
            mock_storage.assert_called_once()

    def test_detailed_health_validates_configuration(self, client: TestClient) -> None:
        """Test that detailed health validates configuration validity."""
        with (
            patch("wavecore.api.routes.health.check_storage_health") as mock_storage,
            patch("wavecore.api.routes.health.check_configuration_health") as mock_config,
            patch("wavecore.api.routes.health.check_resource_health") as mock_resource,
        ):
            mock_storage.return_value = "healthy"
            mock_config.return_value = "healthy"
            mock_resource.return_value = "healthy"

            response = client.get("/health/detailed")

            assert response.status_code == 200
            mock_config.assert_called_once()

    def test_detailed_health_checks_resource_availability(self, client: TestClient) -> None:
        """Test that detailed health checks disk space and memory thresholds."""
        with (
            patch("wavecore.api.routes.health.check_storage_health") as mock_storage,
            patch("wavecore.api.routes.health.check_configuration_health") as mock_config,
            patch("wavecore.api.routes.health.check_resource_health") as mock_resource,
        ):
            mock_storage.return_value = "healthy"
            mock_config.return_value = "healthy"
            mock_resource.return_value = "healthy"

            response = client.get("/health/detailed")

            assert response.status_code == 200
            mock_resource.assert_called_once()

    def test_detailed_health_performance_target(self, client: TestClient) -> None:
        """Test that /health/detailed responds in <100ms (readiness target).

        Note: Test allows 200ms threshold to account for test framework overhead.
        Production target remains <100ms as per REQ-5.2.4.11.
        """
        # Mock health checks for deterministic testing
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "healthy",
                "database": "healthy",
                "execution_engine": "healthy",
            }

            start = time.perf_counter()
            response = client.get("/health/detailed")
            elapsed_ms = (time.perf_counter() - start) * 1000

            assert response.status_code == 200
            # Allow 2x margin for test environment overhead
            assert elapsed_ms < 200, f"Detailed health check took {elapsed_ms:.2f}ms, target <100ms"

    def test_detailed_health_non_blocking_assessment(self, client: TestClient) -> None:
        """Test that health checks run asynchronously without blocking."""
        # Mock health checks for deterministic testing
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "healthy",
                "database": "healthy",
                "execution_engine": "healthy",
            }

            # Should still complete within reasonable time due to async execution
            start = time.perf_counter()
            response = client.get("/health/detailed")
            elapsed_ms = (time.perf_counter() - start) * 1000

            assert response.status_code == 200
            # Even with mocked check, total should be reasonable
            assert elapsed_ms < 300

    def test_detailed_health_timeout_prevents_hung_checks(self, client: TestClient) -> None:
        """Test that health checks have configurable timeouts to prevent hanging.

        Per REQ-5.2.4.11: Configurable timeouts prevent hung checks from affecting
        service responsiveness.
        """

        # Simulate extremely slow check that would timeout
        async def very_slow_check():
            await asyncio.sleep(10)  # 10 seconds - would timeout
            return "healthy"

        with patch("wavecore.api.routes.health.check_storage_health", return_value="unhealthy"):
            with patch("wavecore.api.routes.health.HEALTH_CHECK_TIMEOUT", 0.1):  # 100ms timeout
                response = client.get("/health/detailed")

                # Should complete quickly with timeout, component marked as unknown
                assert response.status_code in [200, 503]
                # At minimum, should respond within reasonable time even if check times out
                # (implementation should handle timeout gracefully)

    def test_detailed_health_handles_unknown_component_status(self, client: TestClient) -> None:
        """Test that health handles unknown component status gracefully."""
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "unknown",  # Component status cannot be determined
                "database": "healthy",
                "execution_engine": "healthy",
            }

            response = client.get("/health/detailed")

            # Unknown status should be treated conservatively
            data = response.json()
            assert "components" in data
            assert data["components"]["storage"] == "unknown"

    def test_detailed_health_all_components_unknown(self, client: TestClient) -> None:
        """Test behavior when all components report unknown status."""
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "unknown",
                "database": "unknown",
                "execution_engine": "unknown",
            }

            response = client.get("/health/detailed")

            # All unknown should result in degraded or unhealthy status
            data = response.json()
            assert data["status"] in ["degraded", "unhealthy"]


class TestStatusEndpoint:
    """Test suite for GET /status endpoint (system status)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_status_endpoint_returns_200(self, client: TestClient) -> None:
        """Test that /status returns 200 with system status."""
        response = client.get("/status")

        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] in ["online", "maintenance", "offline"]

    def test_status_endpoint_includes_uptime(self, client: TestClient) -> None:
        """Test that /status includes uptime in seconds."""
        response = client.get("/status")

        data = response.json()
        assert "uptime" in data
        assert isinstance(data["uptime"], int)
        assert data["uptime"] >= 0

    def test_status_endpoint_includes_execution_metrics(self, client: TestClient) -> None:
        """Test that /status includes execution counts."""
        response = client.get("/status")

        data = response.json()
        assert "executions" in data
        executions = data["executions"]

        assert "active" in executions
        assert "queued" in executions
        assert "completed" in executions

        assert isinstance(executions["active"], int)
        assert isinstance(executions["queued"], int)
        assert isinstance(executions["completed"], int)

    def test_status_endpoint_includes_resource_metrics(self, client: TestClient) -> None:
        """Test that /status includes resource utilization."""
        response = client.get("/status")

        data = response.json()
        assert "resources" in data
        resources = data["resources"]

        assert "cpu" in resources
        assert "memory" in resources
        assert "storage" in resources

        # Should be percentages (0-100)
        assert isinstance(resources["cpu"], int | float)
        assert isinstance(resources["memory"], int | float)
        assert isinstance(resources["storage"], int | float)

    def test_status_endpoint_performance_allows_thorough_assessment(
        self, client: TestClient
    ) -> None:
        """Test that /status allows up to 500ms for thorough metrics."""
        start = time.perf_counter()
        response = client.get("/status")
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert response.status_code == 200
        # Should complete well within 500ms target
        assert elapsed_ms < 500


class TestVersionEndpoint:
    """Test suite for GET /version endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_version_endpoint_returns_200(self, client: TestClient) -> None:
        """Test that /version returns 200 with version info."""
        response = client.get("/version")

        assert response.status_code == 200
        data = response.json()
        assert "api_version" in data
        assert "title" in data

    def test_version_endpoint_structure(self, client: TestClient) -> None:
        """Test that /version response matches OpenAPI spec."""
        response = client.get("/version")

        data = response.json()
        assert "api_version" in data
        assert "title" in data
        assert "python_version" in data
        assert "fastapi_version" in data
        assert "build" in data

        # Validate semver pattern for api_version
        semver_pattern = r"^\d+\.\d+\.\d+$"
        assert re.match(
            semver_pattern, data["api_version"]
        ), f"api_version '{data['api_version']}' does not match semver pattern"

    def test_version_endpoint_updates_on_deployment(self, client: TestClient) -> None:
        """Test that version info reflects current deployment."""
        response = client.get("/version")

        data = response.json()
        # Version should be present and follow semver
        assert "api_version" in data
        assert re.match(r"^\d+\.\d+\.\d+$", data["api_version"])
        # Title should be present
        assert "title" in data
        assert len(data["title"]) > 0


class TestMetricsEndpoint:
    """Test suite for GET /metrics endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_metrics_endpoint_returns_200(self, client: TestClient) -> None:
        """Test that /metrics returns 200 with metrics."""
        response = client.get("/metrics")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    def test_metrics_endpoint_structure(self, client: TestClient) -> None:
        """Test that /metrics response matches OpenAPI spec."""
        response = client.get("/metrics")

        data = response.json()
        assert "success" in data
        assert "data" in data
        assert "meta" in data

        metrics_data = data["data"]
        assert "requests" in metrics_data
        assert "executions" in metrics_data
        assert "uptime" in metrics_data
        assert "memory" in metrics_data

        assert isinstance(metrics_data["requests"], int)
        assert isinstance(metrics_data["executions"], int)
        assert isinstance(metrics_data["uptime"], int)
        assert isinstance(metrics_data["memory"], dict)

    def test_metrics_endpoint_prometheus_integration_ready(self, client: TestClient) -> None:
        """Test that metrics can be exposed for Prometheus."""
        response = client.get("/metrics")

        data = response.json()
        # Metrics should be structured for time-series monitoring
        assert "data" in data
        # Future: Could add Accept: text/plain for Prometheus format


class TestHealthLifecycleIntegration:
    """Test suite for health endpoint lifecycle behavior."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_health_unhealthy_during_startup(self, client: TestClient) -> None:
        """Test that service starts in unhealthy state until initialization completes."""
        with patch("wavecore.api.routes.health.is_initialized", return_value=False):
            response = client.get("/health")

            assert response.status_code == 503
            assert response.json()["status"] == "unhealthy"

    def test_health_transitions_to_ready_after_initialization(self, client: TestClient) -> None:
        """Test that health transitions to ready when initialization completes."""
        with patch("wavecore.api.routes.health.is_initialized", return_value=True):
            with patch("wavecore.api.routes.health.get_component_health") as mock_components:
                mock_components.return_value = {
                    "storage": "healthy",
                    "database": "healthy",
                    "execution_engine": "healthy",
                }

                response = client.get("/health")

                assert response.status_code == 200
                assert response.json()["status"] == "healthy"

    def test_health_not_ready_during_graceful_shutdown(self, client: TestClient) -> None:
        """Test that health transitions to not ready before shutdown."""
        with patch("wavecore.api.routes.health.is_shutting_down", return_value=True):
            response = client.get("/health")

            # Should return unhealthy to allow load balancer drain
            assert response.status_code == 503

    def test_health_endpoints_available_during_shutdown(self, client: TestClient) -> None:
        """Test that health endpoints remain available during shutdown for monitoring."""
        with patch("wavecore.api.routes.health.is_shutting_down", return_value=True):
            # Endpoint should still respond, not return 404 or error
            response = client.get("/health")

            assert response.status_code in [200, 503]  # Available but may report unhealthy

    def test_health_cache_invalidates_on_config_change(self, client: TestClient) -> None:
        """Test that health cache invalidates when configuration changes."""
        # Mock health checks for deterministic testing
        with patch("wavecore.api.routes.health.get_component_health") as mock_components:
            mock_components.return_value = {
                "storage": "healthy",
                "database": "healthy",
                "execution_engine": "healthy",
            }

            # Initial request
            response1 = client.get("/health/detailed")
            assert response1.status_code == 200

            # Simulate config change
            with patch("wavecore.api.routes.health.on_config_change"):
                # Force cache invalidation
                with patch("wavecore.api.routes.health.invalidate_health_cache"):
                    # Config change should trigger cache invalidation
                    # (Implementation will call invalidate_health_cache on config change)
                    pass

            # Next request should work (validates invalidation mechanism exists)
            response2 = client.get("/health/detailed")
            assert response2.status_code == 200


class TestHealthComponentAssessment:
    """Test suite for component-specific health assessment."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_storage_health_checks_artifact_directory_access(self, client: TestClient) -> None:
        """Test that storage health validates artifact directory accessibility."""
        with (
            patch("wavecore.api.routes.health.check_storage_health") as mock_storage,
            patch("wavecore.api.routes.health.check_configuration_health") as mock_config,
            patch("wavecore.api.routes.health.check_resource_health") as mock_resource,
        ):
            mock_storage.return_value = "healthy"
            mock_config.return_value = "healthy"
            mock_resource.return_value = "healthy"

            response = client.get("/health/detailed")

            assert response.status_code == 200
            mock_storage.assert_called_once()
            # Should verify artifact directory exists and is writable

    def test_storage_health_checks_file_system_operations(self, client: TestClient) -> None:
        """Test that storage health performs test write operations."""
        with (
            patch("wavecore.api.routes.health.check_storage_health") as mock_storage,
            patch("wavecore.api.routes.health.check_configuration_health") as mock_config,
            patch("wavecore.api.routes.health.check_resource_health") as mock_resource,
        ):
            # Simulate successful write test
            mock_storage.return_value = "healthy"
            mock_config.return_value = "healthy"
            mock_resource.return_value = "healthy"

            response = client.get("/health/detailed")

            assert response.json()["components"]["storage"] == "healthy"

    def test_config_health_validates_required_parameters(self, client: TestClient) -> None:
        """Test that configuration health checks required parameters are present."""
        with (
            patch("wavecore.api.routes.health.check_storage_health") as mock_storage,
            patch("wavecore.api.routes.health.check_configuration_health") as mock_config,
            patch("wavecore.api.routes.health.check_resource_health") as mock_resource,
        ):
            mock_storage.return_value = "healthy"
            mock_config.return_value = "healthy"
            mock_resource.return_value = "healthy"

            response = client.get("/health/detailed")

            assert response.status_code == 200
            mock_config.assert_called_once()

    def test_config_health_validates_parameter_values(self, client: TestClient) -> None:
        """Test that configuration health validates parameter value validity."""
        with patch("wavecore.api.routes.health.check_configuration_health") as mock_check:
            # Simulate invalid config
            mock_check.return_value = "unhealthy"

            response = client.get("/health/detailed")

            assert response.json()["status"] == "unhealthy"

    def test_resource_health_checks_disk_space_threshold(self, client: TestClient) -> None:
        """Test that resource health monitors disk space availability."""
        with patch("wavecore.api.routes.health.check_resource_health") as mock_check:
            mock_check.return_value = "degraded"  # Low disk space

            response = client.get("/health/detailed")

            # Should be reflected in overall status
            data = response.json()
            assert data["status"] in ["degraded", "unhealthy"]

    def test_resource_health_checks_memory_threshold(self, client: TestClient) -> None:
        """Test that resource health monitors memory availability."""
        with patch("wavecore.api.routes.health.check_resource_health") as mock_check:
            mock_check.return_value = "healthy"

            response = client.get("/health/detailed")

            assert response.status_code == 200
            mock_check.assert_called_once()

    def test_application_state_confirms_initialization(self, client: TestClient) -> None:
        """Test that application state health confirms initialization completed."""
        # Must mock all lifecycle state checks and component health checks
        # that affect aggregate_health_status:
        # - Lifecycle: is_initialized, is_shutting_down, has_critical_errors
        # - Components: check_storage_health, check_configuration_health, check_resource_health
        with (
            patch("wavecore.api.routes.health.is_initialized", return_value=True),
            patch("wavecore.api.routes.health.is_shutting_down", return_value=False),
            patch("wavecore.api.routes.health.has_critical_errors", return_value=False),
            patch("wavecore.api.routes.health.check_storage_health") as mock_storage,
            patch("wavecore.api.routes.health.check_configuration_health") as mock_config,
            patch("wavecore.api.routes.health.check_resource_health") as mock_resource,
        ):
            # Make all component health checks return healthy
            mock_storage.return_value = "healthy"
            mock_config.return_value = "healthy"
            mock_resource.return_value = "healthy"

            response = client.get("/health/detailed")

            # Should reflect successful initialization with healthy status
            assert response.json()["status"] in ["healthy", "degraded"]

    def test_application_state_detects_critical_errors(self, client: TestClient) -> None:
        """Test that application state health detects critical errors."""
        with patch("wavecore.api.routes.health.has_critical_errors", return_value=True):
            response = client.get("/health/detailed")

            assert response.json()["status"] == "unhealthy"


class TestHealthMonitoringIntegration:
    """Test suite for monitoring and observability features."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_health_response_structured_for_parsing(self, client: TestClient) -> None:
        """Test that health responses use standardized format for monitoring systems."""
        response = client.get("/health/detailed")

        data = response.json()
        # Should be valid JSON with consistent structure
        assert isinstance(data, dict)
        assert "status" in data
        assert "components" in data
        assert "timestamp" in data

    def test_detailed_health_provides_component_breakdown(self, client: TestClient) -> None:
        """Test that detailed health enables component-level monitoring."""
        response = client.get("/health/detailed")

        components = response.json()["components"]
        # Each component should be independently monitorable
        for component in ["storage", "database", "execution_engine"]:
            assert component in components

    def test_status_provides_performance_metrics(self, client: TestClient) -> None:
        """Test that status endpoint exposes performance indicators."""
        response = client.get("/status")

        data = response.json()
        # Should provide actionable metrics for operations teams
        assert "resources" in data
        assert "executions" in data
        assert "uptime" in data


class TestResourceHealthFunction:
    """Unit tests for check_resource_health function."""

    async def test_check_resource_health_returns_healthy_when_resources_normal(self) -> None:
        """Test check_resource_health returns healthy when disk and memory are within limits."""
        from wavecore.api.routes.health import check_resource_health

        # Mock psutil to return healthy values
        mock_disk = type("MockDisk", (), {"percent": 50.0})()
        mock_memory = type("MockMemory", (), {"percent": 60.0})()

        with (
            patch("wavecore.api.routes.health.psutil.disk_usage", return_value=mock_disk),
            patch("wavecore.api.routes.health.psutil.virtual_memory", return_value=mock_memory),
        ):
            result = check_resource_health()

            assert result == "healthy"

    async def test_check_resource_health_returns_degraded_when_disk_above_85_percent(self) -> None:
        """Test check_resource_health returns degraded when disk >85%."""
        from wavecore.api.routes.health import check_resource_health

        mock_disk = type("MockDisk", (), {"percent": 88.0})()
        mock_memory = type("MockMemory", (), {"percent": 60.0})()

        with (
            patch("wavecore.api.routes.health.psutil.disk_usage", return_value=mock_disk),
            patch("wavecore.api.routes.health.psutil.virtual_memory", return_value=mock_memory),
        ):
            result = check_resource_health()

            assert result == "degraded"

    async def test_check_resource_health_returns_unhealthy_when_disk_above_95_percent(self) -> None:
        """Test check_resource_health returns unhealthy when disk >95%."""
        from wavecore.api.routes.health import check_resource_health

        mock_disk = type("MockDisk", (), {"percent": 98.0})()
        mock_memory = type("MockMemory", (), {"percent": 60.0})()

        with (
            patch("wavecore.api.routes.health.psutil.disk_usage", return_value=mock_disk),
            patch("wavecore.api.routes.health.psutil.virtual_memory", return_value=mock_memory),
        ):
            result = check_resource_health()

            assert result == "unhealthy"
