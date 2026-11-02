"""Unit tests for admin mode endpoints (REQ-5.2.6.1, REQ-5.2.6.2, REQ-5.2.6.3).

This module tests the two-layer admin mode security model that prevents accidental
or unauthorized use of dangerous state manipulation operations.

Test Coverage:
- REQ-5.2.6.1: Admin mode toggle (startup flag + API)
  - Deployment gate configuration (WAVE_ADMIN_ALLOWED environment variable)
  - Security state matrix (fully disabled, allowed but inactive, fully active)
  - Runtime activation endpoints (enable, disable)
  - Error handling (missing reason, unauthorized access)
  - Activation lifecycle (instance-scoped, persists for server lifetime)
  - Idempotent behavior of enable/disable endpoints
  - require_admin_active() guard function for protected endpoints
- REQ-5.2.6.2: Admin mode status endpoint
  - Status endpoint returns enabled state, activation time, reason
  - Conditional response content (null fields when inactive, populated when active)
  - Access control (404 when gate disallows, accessible when allowed)
  - ISO 8601 UTC timestamp format with 'Z' suffix
  - Complete response structure validation (exactly 4 fields)
- REQ-5.2.6.3: State reset endpoint (clear all entities and executions)
  - Security requirements (404 when deployment gate disallows, 403 when admin inactive)
  - Confirmation parameter validation (400 when missing/false)
  - Selective reset with scope parameter
  - Duplicate scope category handling (deduplication)
  - Full reset when scope omitted (all categories)
  - Response structure with counts per category and timestamp
  - Partial success handling (failures isolated per category)
  - Cache invalidation after clearing
  - Audit logging with timestamp, admin session details, counts
  - Audit logging for blocked attempts (both 404 and 403 cases)
  - System infrastructure preservation (plugins, config, credentials NOT cleared)
"""

import logging
import os
from collections.abc import Callable, Generator
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import asyncssh
import pytest
import yaml
from cryptography.hazmat.primitives import hashes
from fastapi import HTTPException
from fastapi.testclient import TestClient

from tests.plugins.http.tls_material import make_credential


def _reset_admin_state() -> None:
    """Reset admin module state between tests by setting its module-level variables."""
    from wavecore.api.routes.admin import routes as _admin_routes

    _admin_routes._admin_enabled = False
    _admin_routes._admin_enabled_at = None
    _admin_routes._admin_reason = None


class TestAdminDeploymentGateConfiguration:
    """Test suite for deployment gate configuration (Layer 1 security)."""

    def test_admin_allowed_defaults_to_disabled(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED defaults to disabled when not set."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        # Ensure env var is not set
        with patch.dict(os.environ, {}, clear=True):
            # Remove any existing WAVE_ADMIN_ALLOWED
            if "WAVE_ADMIN_ALLOWED" in os.environ:
                del os.environ["WAVE_ADMIN_ALLOWED"]

            result = is_admin_allowed()

            assert result is False

    def test_admin_allowed_accepts_true_lowercase(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts 'true' (lowercase)."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            result = is_admin_allowed()

            assert result is True

    def test_admin_allowed_accepts_true_uppercase(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts 'TRUE' (uppercase)."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "TRUE"}):
            result = is_admin_allowed()

            assert result is True

    def test_admin_allowed_accepts_true_mixed_case(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts 'True' (mixed case)."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "True"}):
            result = is_admin_allowed()

            assert result is True

    def test_admin_allowed_accepts_1(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts '1'."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "1"}):
            result = is_admin_allowed()

            assert result is True

    def test_admin_allowed_accepts_yes_lowercase(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts 'yes' (lowercase)."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "yes"}):
            result = is_admin_allowed()

            assert result is True

    def test_admin_allowed_accepts_yes_uppercase(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts 'YES' (uppercase)."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "YES"}):
            result = is_admin_allowed()

            assert result is True

    def test_admin_allowed_accepts_false_lowercase(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts 'false' (lowercase)."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            result = is_admin_allowed()

            assert result is False

    def test_admin_allowed_accepts_false_uppercase(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts 'FALSE' (uppercase)."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "FALSE"}):
            result = is_admin_allowed()

            assert result is False

    def test_admin_allowed_accepts_0(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts '0'."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "0"}):
            result = is_admin_allowed()

            assert result is False

    def test_admin_allowed_accepts_no_lowercase(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts 'no' (lowercase)."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "no"}):
            result = is_admin_allowed()

            assert result is False

    def test_admin_allowed_accepts_no_uppercase(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED accepts 'NO' (uppercase)."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "NO"}):
            result = is_admin_allowed()

            assert result is False

    def test_admin_allowed_treats_invalid_values_as_disabled(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED treats invalid values as disabled."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        # Various invalid values should all result in disabled (safe default)
        invalid_values = ["invalid", "enable", "on", "off", "maybe", "", "2", "-1"]

        for invalid_value in invalid_values:
            with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": invalid_value}):
                result = is_admin_allowed()

                assert result is False, f"Expected False for invalid value '{invalid_value}'"

    def test_admin_allowed_treats_empty_string_as_disabled(self) -> None:
        """Test that WAVE_ADMIN_ALLOWED treats empty string as disabled."""
        from wavecore.api.routes.admin.routes import is_admin_allowed

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": ""}):
            result = is_admin_allowed()

            assert result is False


class TestSecurityStateMatrixFullyDisabled:
    """Test suite for State 1 (Fully Disabled): deployment gate disallows admin mode."""

    @pytest.fixture
    def client_admin_disabled(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode disabled."""
        # Clear admin state before test

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            yield TestClient(app)

        # Clean up after test
        _reset_admin_state()

    def test_admin_enable_returns_404_when_fully_disabled(
        self, client_admin_disabled: TestClient
    ) -> None:
        """Test that POST /admin/enable returns 404 when deployment gate disallows."""
        response = client_admin_disabled.post(
            "/admin/enable", json={"reason": "Testing admin mode"}
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Not Found"

    def test_admin_disable_returns_404_when_fully_disabled(
        self, client_admin_disabled: TestClient
    ) -> None:
        """Test that POST /admin/disable returns 404 when deployment gate disallows."""
        response = client_admin_disabled.post("/admin/disable")

        assert response.status_code == 404
        assert response.json()["detail"] == "Not Found"

    def test_admin_status_returns_404_when_fully_disabled(
        self, client_admin_disabled: TestClient
    ) -> None:
        """Test that GET /admin/status returns 404 when deployment gate disallows."""
        response = client_admin_disabled.get("/admin/status")

        assert response.status_code == 404
        assert response.json()["detail"] == "Not Found"

    def test_admin_endpoints_conceal_existence_when_fully_disabled(
        self, client_admin_disabled: TestClient
    ) -> None:
        """Test that admin endpoints appear as if they don't exist (capability enumeration
        prevention).
        """
        # All admin endpoints should return identical 404 responses
        endpoints = [
            ("POST", "/admin/enable"),
            ("POST", "/admin/disable"),
            ("GET", "/admin/status"),
        ]

        for method, path in endpoints:
            if method == "POST":
                response = client_admin_disabled.post(path, json={"reason": "test"})
            else:
                response = client_admin_disabled.get(path)

            # Response should be identical to a truly non-existent endpoint
            assert response.status_code == 404, f"Expected 404 for {method} {path}"


class TestSecurityStateMatrixAllowedButInactive:
    """Test suite for State 2 (Allowed but Inactive): deployment gate allows but admin not
    activated.
    """

    @pytest.fixture
    def client_admin_allowed(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode allowed but not activated."""
        # Clear admin state before test

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            yield TestClient(app)

        # Clean up after test
        _reset_admin_state()

    def test_admin_status_accessible_when_allowed_but_inactive(
        self, client_admin_allowed: TestClient
    ) -> None:
        """Test that GET /admin/status is accessible when allowed but not activated."""
        response = client_admin_allowed.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is False
        assert data["allowed"] is True

    def test_admin_enable_accessible_when_allowed_but_inactive(
        self, client_admin_allowed: TestClient
    ) -> None:
        """Test that POST /admin/enable is accessible when allowed but not activated."""
        response = client_admin_allowed.post("/admin/enable", json={"reason": "Testing admin mode"})

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is True

    def test_disable_accessible_when_allowed_but_inactive(
        self, client_admin_allowed: TestClient
    ) -> None:
        """Test that POST /admin/disable is accessible when allowed but not activated.

        Even when admin is not active, the disable endpoint is accessible (idempotent no-op).
        """
        response = client_admin_allowed.post("/admin/disable")

        assert response.status_code == 200
        assert response.json()["enabled"] is False


class TestRequireAdminActiveGuard:
    """Test suite for require_admin_active() guard function.

    Per REQ-5.2.6.1: State manipulation endpoints return HTTP 403 Forbidden when admin
    mode is allowed but not activated, with an error message indicating admin mode must
    be enabled first. This creates a clear distinction: 404 means admin is not available
    in this deployment, while 403 means admin is available but not currently activated.

    This class tests the require_admin_active() guard function that will be used by
    future protected endpoints (e.g., /admin/clear-cache, /admin/seed-data).
    """

    def test_require_admin_active_raises_403_when_inactive(self) -> None:
        """Test that require_admin_active() raises 403 when admin is not activated."""
        from wavecore.api.routes.admin.routes import require_admin_active

        _reset_admin_state()

        with pytest.raises(HTTPException) as exc_info:
            require_admin_active()

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Admin mode must be enabled first"

        _reset_admin_state()

    def test_require_admin_active_passes_when_active(self) -> None:
        """Test that require_admin_active() does not raise when admin is active."""
        from wavecore.api.routes.admin import routes as _admin_routes
        from wavecore.api.routes.admin.routes import require_admin_active

        _reset_admin_state()

        # Activate admin state directly
        _admin_routes._admin_enabled = True

        # Should not raise
        require_admin_active()

        _reset_admin_state()

    def test_require_admin_active_checks_enabled_flag_only(self) -> None:
        """Test that require_admin_active() only checks the enabled flag."""
        from wavecore.api.routes.admin import routes as _admin_routes
        from wavecore.api.routes.admin.routes import require_admin_active

        _reset_admin_state()

        # Set enabled without timestamp/reason (edge case)
        _admin_routes._admin_enabled = True
        _admin_routes._admin_enabled_at = None
        _admin_routes._admin_reason = None

        # Should still pass - only checks _admin_enabled
        require_admin_active()

        _reset_admin_state()


class TestSecurityStateMatrixFullyActive:
    """Test suite for State 3 (Fully Active): deployment gate allows AND admin activated."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        # Clear admin state before test

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            # Activate admin mode
            client.post("/admin/enable", json={"reason": "Test setup"})
            yield client

        # Clean up after test
        _reset_admin_state()

    def test_admin_status_shows_active_when_fully_active(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that GET /admin/status shows enabled=true when fully active."""
        response = client_admin_active.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is True
        assert data["allowed"] is True
        assert "enabled_at" in data
        assert "reason" in data

    def test_admin_disable_accessible_when_fully_active(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that POST /admin/disable is accessible when fully active."""
        response = client_admin_active.post("/admin/disable")

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is False
        assert "disabled_at" in data
        assert "duration_seconds" in data


class TestAdminEnableEndpoint:
    """Test suite for POST /admin/enable endpoint."""

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode allowed."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            yield TestClient(app)

        _reset_admin_state()

    def test_enable_requires_reason_parameter(self, client: TestClient) -> None:
        """Test that POST /admin/enable requires a reason parameter."""
        response = client.post("/admin/enable", json={})

        assert response.status_code == 400
        assert response.json()["detail"] == "Reason is required and cannot be empty"

    def test_enable_rejects_empty_reason(self, client: TestClient) -> None:
        """Test that POST /admin/enable rejects empty reason."""
        response = client.post("/admin/enable", json={"reason": ""})

        assert response.status_code == 400
        assert response.json()["detail"] == "Reason is required and cannot be empty"

    def test_enable_rejects_whitespace_only_reason(self, client: TestClient) -> None:
        """Test that POST /admin/enable rejects whitespace-only reason."""
        response = client.post("/admin/enable", json={"reason": "   "})

        assert response.status_code == 400
        assert response.json()["detail"] == "Reason is required and cannot be empty"

    def test_enable_returns_activation_timestamp(self, client: TestClient) -> None:
        """Test that POST /admin/enable returns activation timestamp."""
        response = client.post("/admin/enable", json={"reason": "Testing admin mode"})

        assert response.status_code == 200
        data = response.json()
        assert "enabled_at" in data

        # Validate timestamp is ISO 8601 format
        datetime.fromisoformat(data["enabled_at"].replace("Z", "+00:00"))

    def test_enable_returns_provided_reason(self, client: TestClient) -> None:
        """Test that POST /admin/enable returns the provided reason."""
        reason = "Debugging production issue #12345"
        response = client.post("/admin/enable", json={"reason": reason})

        assert response.status_code == 200
        data = response.json()
        assert data["reason"] == reason

    def test_enable_returns_capabilities_list(self, client: TestClient) -> None:
        """Test that POST /admin/enable returns list of available capabilities."""
        response = client.post("/admin/enable", json={"reason": "Testing admin mode"})

        assert response.status_code == 200
        data = response.json()
        assert "capabilities" in data
        assert isinstance(data["capabilities"], list)

    def test_enable_returns_enabled_flag(self, client: TestClient) -> None:
        """Test that POST /admin/enable response confirms activation with enabled=true."""
        response = client.post("/admin/enable", json={"reason": "Testing admin mode"})

        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        assert data["enabled"] is True

    def test_enable_is_idempotent(self, client: TestClient) -> None:
        """Test that POST /admin/enable is idempotent (calling when already enabled updates
        reason/timestamp).

        REQ-5.2.6.1: Activation is idempotent; calling enable when already enabled
        updates the reason and refreshes the activation timestamp.
        """
        import time

        # First enable
        response1 = client.post("/admin/enable", json={"reason": "First reason"})
        assert response1.status_code == 200
        data1 = response1.json()
        first_timestamp = data1["enabled_at"]

        # Small delay to ensure timestamp difference is detectable
        time.sleep(0.01)

        # Second enable with different reason
        response2 = client.post("/admin/enable", json={"reason": "Second reason"})
        assert response2.status_code == 200
        data2 = response2.json()
        second_timestamp = data2["enabled_at"]

        # Should update reason
        assert data2["reason"] == "Second reason"
        # Should update or maintain enabled state
        assert data2["enabled"] is True
        # Should refresh the activation timestamp
        assert (
            second_timestamp != first_timestamp
        ), "Timestamp should be refreshed on idempotent enable"
        assert second_timestamp > first_timestamp, "New timestamp should be later than original"

    def test_enable_logs_activation(self, client: TestClient) -> None:
        """Test that POST /admin/enable logs the activation for audit trail."""
        with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
            response = client.post("/admin/enable", json={"reason": "Testing audit"})

            assert response.status_code == 200
            # Verify logging occurred
            mock_logger.info.assert_called()


class TestAdminDisableEndpoint:
    """Test suite for POST /admin/disable endpoint."""

    @pytest.fixture
    def client_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode active."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Test setup"})
            yield client

        _reset_admin_state()

    @pytest.fixture
    def client_inactive(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode allowed but not active."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            yield TestClient(app)

        _reset_admin_state()

    def test_disable_requires_no_body(self, client_active: TestClient) -> None:
        """Test that POST /admin/disable requires no request body."""
        response = client_active.post("/admin/disable")

        assert response.status_code == 200

    def test_disable_returns_deactivation_timestamp(self, client_active: TestClient) -> None:
        """Test that POST /admin/disable returns deactivation timestamp."""
        response = client_active.post("/admin/disable")

        assert response.status_code == 200
        data = response.json()
        assert "disabled_at" in data

        # Validate timestamp is ISO 8601 format
        datetime.fromisoformat(data["disabled_at"].replace("Z", "+00:00"))

    def test_disable_returns_duration(self, client_active: TestClient) -> None:
        """Test that POST /admin/disable returns the duration admin was active."""
        response = client_active.post("/admin/disable")

        assert response.status_code == 200
        data = response.json()
        assert "duration_seconds" in data
        assert isinstance(data["duration_seconds"], int | float)
        assert data["duration_seconds"] >= 0

    def test_disable_is_idempotent(self, client_inactive: TestClient) -> None:
        """Test that POST /admin/disable is idempotent (calling when already disabled has no
        effect).

        When disable is called on an already-inactive state:
        - Returns 200 OK (idempotent success)
        - Returns enabled=false
        - disabled_at is null (no active session to end)
        - duration_seconds is null (no active session to measure)
        """
        # First disable (when already inactive)
        response1 = client_inactive.post("/admin/disable")
        assert response1.status_code == 200
        data1 = response1.json()
        assert data1["enabled"] is False
        assert data1["disabled_at"] is None
        assert data1["duration_seconds"] is None

        # Second disable - same behavior
        response2 = client_inactive.post("/admin/disable")
        assert response2.status_code == 200
        data2 = response2.json()
        assert data2["enabled"] is False
        assert data2["disabled_at"] is None
        assert data2["duration_seconds"] is None

    def test_disable_logs_deactivation(self, client_active: TestClient) -> None:
        """Test that POST /admin/disable logs the deactivation for audit trail."""
        with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
            response = client_active.post("/admin/disable")

            assert response.status_code == 200
            # Verify logging occurred
            mock_logger.info.assert_called()


class TestAdminStatusEndpoint:
    """Test suite for GET /admin/status endpoint."""

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode allowed."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            yield TestClient(app)

        _reset_admin_state()

    def test_status_returns_allowed_flag(self, client: TestClient) -> None:
        """Test that GET /admin/status returns the allowed flag."""
        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        assert "allowed" in data
        assert data["allowed"] is True

    def test_status_returns_enabled_flag(self, client: TestClient) -> None:
        """Test that GET /admin/status returns the enabled flag."""
        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        assert isinstance(data["enabled"], bool)

    def test_status_shows_inactive_when_not_enabled(self, client: TestClient) -> None:
        """Test that GET /admin/status shows enabled=false when not activated."""
        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is False

    def test_status_shows_active_when_enabled(self, client: TestClient) -> None:
        """Test that GET /admin/status shows enabled=true when activated."""
        # Enable admin mode
        client.post("/admin/enable", json={"reason": "Testing status"})

        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is True
        assert "enabled_at" in data
        assert "reason" in data

    def test_status_includes_reason_when_enabled(self, client: TestClient) -> None:
        """Test that GET /admin/status includes reason when admin is enabled."""
        reason = "Investigating issue"
        client.post("/admin/enable", json={"reason": reason})

        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        assert data["reason"] == reason

    def test_status_includes_enabled_at_when_enabled(self, client: TestClient) -> None:
        """Test that GET /admin/status includes enabled_at timestamp when admin is enabled."""
        client.post("/admin/enable", json={"reason": "Testing status"})

        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        assert "enabled_at" in data
        # Validate timestamp is ISO 8601 format
        datetime.fromisoformat(data["enabled_at"].replace("Z", "+00:00"))

    def test_status_excludes_reason_when_not_enabled(self, client: TestClient) -> None:
        """Test that GET /admin/status excludes reason when admin is not enabled."""
        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        # reason should be None or not present when not enabled
        assert data.get("reason") is None

    def test_status_excludes_enabled_at_when_not_enabled(self, client: TestClient) -> None:
        """Test that GET /admin/status excludes enabled_at when admin is not enabled."""
        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        # enabled_at should be None or not present when not enabled
        assert data.get("enabled_at") is None

    def test_status_enabled_at_uses_utc_z_suffix(self, client: TestClient) -> None:
        """Test that enabled_at timestamp uses 'Z' suffix for UTC format.

        REQ-5.2.6.2 specifies ISO 8601 UTC format for audit trail support.
        The 'Z' suffix explicitly indicates UTC timezone.
        """
        client.post("/admin/enable", json={"reason": "UTC format test"})

        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        assert data["enabled_at"].endswith("Z"), "Timestamp must use 'Z' suffix for UTC"

    def test_status_response_structure_when_active(self, client: TestClient) -> None:
        """Test complete response structure when admin is active.

        REQ-5.2.6.2: When active, all four fields are populated:
        - allowed (deployment gate status)
        - enabled (activation status)
        - enabled_at (ISO 8601 UTC timestamp)
        - reason (activation reason)
        """
        reason = "Testing complete response"
        client.post("/admin/enable", json={"reason": reason})

        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        # All four fields must be present and populated
        assert data["allowed"] is True
        assert data["enabled"] is True
        assert data["enabled_at"] is not None
        assert data["reason"] == reason
        # Verify exact field set (no extra fields)
        assert set(data.keys()) == {"allowed", "enabled", "enabled_at", "reason"}

    def test_status_response_structure_when_inactive(self, client: TestClient) -> None:
        """Test complete response structure when admin is inactive.

        REQ-5.2.6.2: When inactive, timestamp and reason are null.
        The allowed field still indicates deployment gate status.
        """
        response = client.get("/admin/status")

        assert response.status_code == 200
        data = response.json()
        # All four fields must be present
        assert data["allowed"] is True
        assert data["enabled"] is False
        assert data["enabled_at"] is None
        assert data["reason"] is None
        # Verify exact field set (no extra fields)
        assert set(data.keys()) == {"allowed", "enabled", "enabled_at", "reason"}


class TestAdminActivationLifecycle:
    """Test suite for admin activation lifecycle behavior."""

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode allowed."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            yield TestClient(app)

        _reset_admin_state()

    def test_activation_persists_across_requests(self, client: TestClient) -> None:
        """Test that admin activation persists across multiple requests."""
        # Enable admin mode
        client.post("/admin/enable", json={"reason": "Persistence test"})

        # Multiple subsequent requests should see enabled state
        for _ in range(3):
            response = client.get("/admin/status")
            assert response.status_code == 200
            assert response.json()["enabled"] is True

    def test_deactivation_persists_across_requests(self, client: TestClient) -> None:
        """Test that admin deactivation persists across multiple requests."""
        # Enable then disable
        client.post("/admin/enable", json={"reason": "Persistence test"})
        client.post("/admin/disable")

        # Multiple subsequent requests should see disabled state
        for _ in range(3):
            response = client.get("/admin/status")
            assert response.status_code == 200
            assert response.json()["enabled"] is False

    def test_server_restart_clears_activation(self) -> None:
        """Test that admin activation is cleared on server restart (state reset).

        Admin mode activation is instance-scoped and persists only for the lifetime
        of the server process. Server restart returns the system to the allowed-but-inactive
        state, requiring explicit re-activation.
        """
        from wavecore.api.routes.admin import routes as _admin_routes

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)

            # Enable admin mode
            client.post("/admin/enable", json={"reason": "Restart test"})

            # Verify enabled
            response = client.get("/admin/status")
            assert response.json()["enabled"] is True

            # Simulate server restart by clearing state (directly manipulating module state)
            _admin_routes._admin_enabled = False
            _admin_routes._admin_enabled_at = None
            _admin_routes._admin_reason = None

            # Should return to inactive state
            response = client.get("/admin/status")
            assert response.json()["enabled"] is False


class TestAdminEndpointErrorHandling:
    """Test suite for admin endpoint error handling."""

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode allowed."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            yield TestClient(app)

        _reset_admin_state()

    def test_enable_with_invalid_json_returns_400(self, client: TestClient) -> None:
        """Test that POST /admin/enable with invalid JSON returns 400."""
        response = client.post(
            "/admin/enable",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )

        assert response.status_code == 400

    def test_enable_with_wrong_content_type_returns_400(self, client: TestClient) -> None:
        """Test that POST /admin/enable with wrong content type returns 400."""
        response = client.post(
            "/admin/enable",
            content="reason=test",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        # Should return 400 or 422 for invalid content type
        assert response.status_code in [400, 422]

    def test_status_is_read_only(self, client: TestClient) -> None:
        """Test that /admin/status only accepts GET requests."""
        # POST should not be allowed
        response = client.post("/admin/status", json={})
        assert response.status_code == 405

        # PUT should not be allowed
        response = client.put("/admin/status", json={})
        assert response.status_code == 405

        # DELETE should not be allowed
        response = client.delete("/admin/status")
        assert response.status_code == 405

    def test_enable_only_accepts_post(self, client: TestClient) -> None:
        """Test that /admin/enable only accepts POST requests."""
        # GET should not be allowed
        response = client.get("/admin/enable")
        assert response.status_code == 405

        # PUT should not be allowed
        response = client.put("/admin/enable", json={"reason": "test"})
        assert response.status_code == 405

        # DELETE should not be allowed
        response = client.delete("/admin/enable")
        assert response.status_code == 405

    def test_disable_only_accepts_post(self, client: TestClient) -> None:
        """Test that /admin/disable only accepts POST requests."""
        # GET should not be allowed
        response = client.get("/admin/disable")
        assert response.status_code == 405

        # PUT should not be allowed
        response = client.put("/admin/disable", json={})
        assert response.status_code == 405

        # DELETE should not be allowed
        response = client.delete("/admin/disable")
        assert response.status_code == 405


class TestAdminEndpointLogging:
    """Test suite for admin endpoint logging/audit trail behavior."""

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode allowed."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            yield TestClient(app)

        _reset_admin_state()

    def test_blocked_enable_attempt_is_logged_when_disabled(self) -> None:
        """Test that blocked enable attempts are logged when deployment gate disallows."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            client = TestClient(app)

            with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
                response = client.post("/admin/enable", json={"reason": "Blocked attempt"})

                assert response.status_code == 404
                # Server-side logging should capture the blocked attempt
                mock_logger.warning.assert_called()

        _reset_admin_state()

    def test_blocked_disable_attempt_is_logged_when_disabled(self) -> None:
        """Test that blocked disable attempts are logged when deployment gate disallows."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            client = TestClient(app)

            with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
                response = client.post("/admin/disable")

                assert response.status_code == 404
                # Server-side logging should capture the blocked attempt
                mock_logger.warning.assert_called()

        _reset_admin_state()

    def test_blocked_status_attempt_is_logged_when_disabled(self) -> None:
        """Test that blocked status attempts are logged when deployment gate disallows."""

        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            client = TestClient(app)

            with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
                response = client.get("/admin/status")

                assert response.status_code == 404
                # Server-side logging should capture the blocked attempt
                mock_logger.warning.assert_called()

        _reset_admin_state()


# =============================================================================
# REQ-5.2.6.3: State Reset Endpoint Tests
# =============================================================================


class TestStateResetSecurityGates:
    """Test suite for state reset endpoint security requirements.

    REQ-5.2.6.3: The reset endpoint follows the admin security model:
    - HTTP 404 when deployment gate disallows admin (conceals existence)
    - HTTP 403 when admin allowed but not enabled
    - Accessible only when admin mode is fully active
    """

    def test_reset_returns_404_when_deployment_gate_disallows(self) -> None:
        """Test that POST /admin/reset returns 404 when deployment gate disallows admin."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            client = TestClient(app)

            response = client.post("/admin/reset", json={"confirm": True})

            assert response.status_code == 404
            assert response.json()["detail"] == "Not Found"

        _reset_admin_state()

    def test_reset_returns_403_when_admin_not_enabled(self) -> None:
        """Test that POST /admin/reset returns 403 when admin allowed but not enabled."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)

            response = client.post("/admin/reset", json={"confirm": True})

            assert response.status_code == 403
            assert response.json()["detail"] == "Admin mode must be enabled first"

        _reset_admin_state()

    def test_reset_accessible_when_admin_fully_active(self) -> None:
        """Test that POST /admin/reset is accessible when admin mode is fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            # Enable admin mode
            client.post("/admin/enable", json={"reason": "Testing reset access"})

            response = client.post("/admin/reset", json={"confirm": True})

            # Should not return 403 or 404 - returns 200 when successful
            assert response.status_code == 200

        _reset_admin_state()


class TestStateResetConfirmationParameter:
    """Test suite for state reset confirmation parameter validation.

    REQ-5.2.6.3: Beyond requiring active admin mode, the endpoint requires
    an explicit confirmation parameter set to true in the request body.
    Requests without confirmation return HTTP 400 Bad Request.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        _reset_admin_state()

    def test_reset_requires_confirm_parameter(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset returns 400 when confirm parameter is missing."""
        response = client_admin_active.post("/admin/reset", json={})

        assert response.status_code == 400
        assert response.json()["detail"] == "Confirmation required: set confirm=true"

    def test_reset_requires_confirm_true(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset returns 400 when confirm is not true."""
        response = client_admin_active.post("/admin/reset", json={"confirm": False})

        assert response.status_code == 400
        assert response.json()["detail"] == "Confirmation required: set confirm=true"

    def test_reset_rejects_confirm_null(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset returns 400 when confirm is null."""
        response = client_admin_active.post("/admin/reset", json={"confirm": None})

        assert response.status_code == 400
        assert response.json()["detail"] == "Confirmation required: set confirm=true"

    def test_reset_accepts_confirm_true(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset accepts confirm=true."""
        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200


class TestStateResetScopeParameter:
    """Test suite for state reset scope parameter (selective reset).

    REQ-5.2.6.3: An optional scope parameter accepts a list of categories to clear.
    When omitted, all categories are cleared. Valid categories are:
    - entities (tests, suites, regressions)
    - blocks (workflow components)
    - executions (records, logs, variables, timelines, breakpoints)
    - artifacts (generated outputs, reports)
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        _reset_admin_state()

    def test_reset_clears_all_categories_when_scope_omitted(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that POST /admin/reset clears all categories when scope is omitted."""
        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        data = response.json()
        # All categories should be present in response
        assert "cleared" in data
        cleared = data["cleared"]
        assert "entities" in cleared
        assert "blocks" in cleared
        assert "executions" in cleared
        assert "artifacts" in cleared
        assert "testdata" in cleared

    def test_reset_accepts_scope_as_list(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset accepts scope as a list of categories."""
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["entities", "executions"]}
        )

        assert response.status_code == 200
        data = response.json()
        # Only requested categories should be cleared
        cleared = data["cleared"]
        assert "entities" in cleared
        assert "executions" in cleared

    def test_reset_with_single_category_scope(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset works with a single category in scope."""
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["executions"]}
        )

        assert response.status_code == 200
        data = response.json()
        assert "executions" in data["cleared"]

    def test_reset_with_empty_scope_clears_nothing(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset with empty scope list clears nothing."""
        response = client_admin_active.post("/admin/reset", json={"confirm": True, "scope": []})

        assert response.status_code == 200
        data = response.json()
        # Empty scope means no categories cleared
        assert data["cleared"] == {}

    def test_reset_rejects_invalid_scope_category(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset returns 400 for invalid scope category."""
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["invalid_category"]}
        )

        assert response.status_code == 400
        assert "Invalid scope category" in response.json()["detail"]

    def test_reset_rejects_mixed_valid_invalid_scope(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset returns 400 if any scope category is invalid."""
        response = client_admin_active.post(
            "/admin/reset",
            json={"confirm": True, "scope": ["entities", "invalid", "executions"]},
        )

        assert response.status_code == 400
        assert "Invalid scope category" in response.json()["detail"]

    def test_reset_accepts_all_valid_categories(self, client_admin_active: TestClient) -> None:
        """Test that POST /admin/reset accepts all valid category names."""
        valid_categories = ["entities", "blocks", "executions", "artifacts"]
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": valid_categories}
        )

        assert response.status_code == 200
        data = response.json()
        for category in valid_categories:
            assert category in data["cleared"]

    def test_reset_handles_duplicate_scope_categories(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that POST /admin/reset handles duplicate categories in scope.

        Duplicate categories should be deduplicated (idempotent behavior).
        The category should only be cleared once and appear once in response.
        """
        response = client_admin_active.post(
            "/admin/reset",
            json={"confirm": True, "scope": ["entities", "entities", "executions"]},
        )

        assert response.status_code == 200
        data = response.json()
        # Should deduplicate and process each category once
        assert "entities" in data["cleared"]
        assert "executions" in data["cleared"]
        # Count of unique categories in response
        assert len(data["cleared"]) == 2


class TestStateResetWithData:
    """Test suite for state reset with actual data to delete.

    Tests that reset correctly clears data when entities exist.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset with data"})
            yield client

        _reset_admin_state()

    def test_reset_clears_seeded_suites_and_regressions(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that reset correctly clears suites and regressions via service layer."""
        import uuid

        suite_id_1 = str(uuid.uuid4())
        suite_id_2 = str(uuid.uuid4())
        reg_id_1 = str(uuid.uuid4())

        # Seed some suites and regressions
        client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {"id": suite_id_1, "name": "Suite 1", "version": "1.0"},
                    },
                    {
                        "op": "add",
                        "entity": {"id": suite_id_2, "name": "Suite 2", "version": "1.0"},
                    },
                ]
            },
        )

        client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {"op": "add", "entity": {"id": reg_id_1, "name": "Reg 1", "version": "1.0"}},
                ]
            },
        )

        # Now reset entities
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["entities"]}
        )

        assert response.status_code == 200
        data = response.json()
        # Should have cleared suites + regressions + any tests
        assert data["cleared"]["entities"] >= 3

    def test_reset_clears_seeded_executions(self, client_admin_active: TestClient) -> None:
        """Test that reset correctly clears executions."""
        import uuid

        from wavecore.api.services.executions import _storage as _exec_storage

        exec_id_1 = str(uuid.uuid4())
        exec_id_2 = str(uuid.uuid4())
        test_id_1 = str(uuid.uuid4())
        test_id_2 = str(uuid.uuid4())

        # Clear any existing executions first
        _exec_storage._execution_storage.clear()

        # Seed some executions
        client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": exec_id_1,
                            "entity_type": "test",
                            "entity_id": test_id_1,
                            "status": "running",
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": exec_id_2,
                            "entity_type": "test",
                            "entity_id": test_id_2,
                            "status": "completed",
                        },
                    },
                ]
            },
        )

        # Now reset executions
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["executions"]}
        )

        assert response.status_code == 200
        data = response.json()
        # Should have cleared the 2 executions
        assert data["cleared"]["executions"] == 2

    def test_reset_clears_seeded_blocks(self, client_admin_active: TestClient) -> None:
        """Test that reset correctly clears blocks via service layer."""
        # Seed some blocks via the block service directly
        from wavecore.api.services.blocks import _storage as _block_storage

        _block_storage._save_block({"id": "block-1", "name": "Block 1", "type": "shell-script"})
        _block_storage._save_block({"id": "block-2", "name": "Block 2", "type": "python"})

        # Now reset blocks
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["blocks"]}
        )

        assert response.status_code == 200
        data = response.json()
        # Should have cleared the 2 blocks
        assert data["cleared"]["blocks"] == 2


class TestStateResetExplicitSystemCategories:
    """Test suite for explicit reset of system categories (environments, profiles).

    Unlike test data categories, environments and profiles are system infrastructure
    and are NOT cleared by default reset. They require explicit scope parameter.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        _reset_admin_state()

    def test_reset_clears_environments_when_explicitly_scoped(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that reset clears environments when explicitly included in scope."""
        from wavecore.api.services.environments import service as environment_service

        # Clear autouse seed environment; seed only the ones we want to count
        environment_service._environments.clear()
        environment_service._environments["env1"] = {"id": "env1", "name": "Test Env 1"}
        environment_service._environments["env2"] = {"id": "env2", "name": "Test Env 2"}
        assert len(environment_service._environments) == 2

        # Reset with explicit environments scope
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["environments"]}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["cleared"]["environments"] == 2
        assert len(environment_service._environments) == 0

    def test_reset_clears_profiles_when_explicitly_scoped(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that reset clears profiles when explicitly included in scope."""
        from wavecore.api.services.profiles import _common as _profile_common

        # Clear any existing profiles first
        _profile_common._clear_storage()

        # Seed some profiles
        _profile_common._profile_storage["prof1"] = {"id": "prof1", "name": "Test Profile 1"}
        _profile_common._profile_storage["prof2"] = {"id": "prof2", "name": "Test Profile 2"}
        _profile_common._profile_storage["prof3"] = {"id": "prof3", "name": "Test Profile 3"}
        assert len(_profile_common._profile_storage) == 3

        # Reset with explicit profiles scope
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["profiles"]}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["cleared"]["profiles"] == 3
        assert len(_profile_common._profile_storage) == 0


class TestStateResetMcpActivity:
    """Test suite for the mcp reset category (in-memory assistant activity history).

    REQ-5.2.6.3: The activity history the MCP endpoint accumulates in memory is
    clearable, but only when explicitly scoped - default reset stays confined to
    stored test data. Live client sessions belong to the connect/disconnect
    lifecycle and survive reset.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        from wavecore.mcp import state as mcp_state

        mcp_state.clear_activity()
        mcp_state.clear_sessions()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        mcp_state.clear_activity()
        mcp_state.clear_sessions()
        _reset_admin_state()

    @staticmethod
    def _seed_activity(entries: int) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sid-1", "assistant", "1.0.0", "127.0.0.1")
        for index in range(entries):
            mcp_state.touch_session("sid-1", f"list_tests_{index}")

    def test_default_reset_leaves_mcp_activity_untouched(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that POST /admin/reset without a scope does not clear MCP activity."""
        from wavecore.mcp import state as mcp_state

        self._seed_activity(3)

        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        assert "mcp" not in response.json()["cleared"]
        assert len(mcp_state.get_activity()) == 3

    def test_reset_clears_mcp_activity_when_explicitly_scoped(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that reset clears MCP activity when 'mcp' is the only scoped category."""
        from wavecore.mcp import state as mcp_state

        self._seed_activity(2)

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["mcp"]}
        )

        assert response.status_code == 200
        assert response.json()["cleared"] == {"mcp": 2}
        assert mcp_state.get_activity() == []

    def test_reset_reports_zero_when_no_mcp_activity_recorded(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that the mcp category reports zero when nothing was recorded."""
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["mcp"]}
        )

        assert response.status_code == 200
        assert response.json()["cleared"] == {"mcp": 0}

    def test_reset_leaves_connected_mcp_sessions_intact(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that reset clears activity history but not live client sessions."""
        from wavecore.mcp import state as mcp_state

        self._seed_activity(1)
        assert len(mcp_state.list_sessions()) == 1

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["mcp"]}
        )

        assert response.status_code == 200
        assert mcp_state.get_activity() == []
        assert len(mcp_state.list_sessions()) == 1


_DEFAULT_NETWORK = {
    "ssh_hosts": {"lock_trusted_hosts": False, "default_block_action": "disabled"},
    "certificates": {"public_source": "builtin"},
    "proxy": {
        "enabled": False,
        "source": "host",
        "host": "",
        "port": None,
        "username": "",
        "password": None,
        "list_mode": "except",
        "entries": [],
        "proxy_local_addresses": False,
    },
}
_SAVED_NETWORK = {
    "ssh_hosts": {"lock_trusted_hosts": True, "default_block_action": "strict"},
    "certificates": {"public_source": "host"},
    "proxy": {
        "enabled": True,
        "source": "custom",
        "host": "proxy.lab.example",
        "port": 3128,
        "username": "svc-proxy",
        "password": None,
        "list_mode": "only",
        "entries": [
            {"kind": "exact", "address": "https://api.lab.example"},
            {"kind": "regex", "address": "^https://.+[.]lab[.]example$"},
        ],
        "proxy_local_addresses": True,
    },
}
_SEEDED_AT = "2026-09-01T08:00:00Z"


def _write_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    return loaded or {}


def _running_network() -> dict[str, Any]:
    """The network settings of the running config."""
    from wavecore.api.config import get_config

    config = get_config()
    return {
        "ssh_hosts": {
            "lock_trusted_hosts": config.get("network.ssh_hosts.lock_trusted_hosts"),
            "default_block_action": config.get("network.ssh_hosts.default_block_action"),
        },
        "certificates": {
            "public_source": config.get("network.certificates.public_source"),
        },
        "proxy": {key: config.get(f"network.proxy.{key}") for key in _DEFAULT_NETWORK["proxy"]},
    }


class TestStateResetNetworkCategories:
    """The ``network`` and ``ssh-hosts`` reset scopes (REQ-4.5.14, REQ-4.5.16, REQ-4.7.14)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        _reset_admin_state()

    @pytest.fixture(scope="class")
    def saved_hosts(self) -> list[dict[str, Any]]:
        keys = [
            asyncssh.generate_private_key("ssh-ed25519").convert_to_public(),
            asyncssh.generate_private_key("ecdsa-sha2-nistp256").convert_to_public(),
        ]
        return [
            {
                "id": entry_id,
                "host": host,
                "port": port,
                "public_key": key.export_public_key("openssh").decode().strip(),
                "added": _SEEDED_AT,
            }
            for entry_id, host, port, key in [
                ("a" * 32, "db1", 22, keys[0]),
                ("b" * 32, "jump-02", 2222, keys[1]),
            ]
        ]

    @pytest.fixture(scope="class")
    def saved_certificate(self) -> dict[str, Any]:
        root = make_credential("Reset Lab Root", key_kind="ec256", is_ca=True)
        return {
            "id": root.cert.fingerprint(hashes.SHA256()).hex(),
            "pem": root.cert_pem,
            "added": _SEEDED_AT,
        }

    @pytest.fixture
    def hosts_file(self, temp_storage_path: Path) -> Path:
        return temp_storage_path / "network" / "ssh_hosts.yaml"

    @pytest.fixture
    def certificates_file(self, temp_storage_path: Path) -> Path:
        return temp_storage_path / "network" / "certificates.yaml"

    @pytest.fixture
    def saved_network(
        self,
        load_config: Callable[..., Any],
        hosts_file: Path,
        certificates_file: Path,
        saved_hosts: list[dict[str, Any]],
        saved_certificate: dict[str, Any],
    ) -> None:
        load_config({"network": _SAVED_NETWORK})
        _write_yaml(hosts_file, {"hosts": saved_hosts})
        _write_yaml(certificates_file, {"certificates": [saved_certificate]})

    def test_both_are_valid_but_not_default_scope_categories(self) -> None:
        from wavecore.api.routes.admin.routes import (
            DEFAULT_RESET_CATEGORIES,
            VALID_RESET_CATEGORIES,
        )

        assert {"network", "ssh-hosts"} <= VALID_RESET_CATEGORIES
        assert not {"network", "ssh-hosts"} & DEFAULT_RESET_CATEGORIES

    @pytest.mark.usefixtures("saved_network")
    def test_network_resets_the_host_key_policy_and_keeps_the_hosts(
        self,
        client_admin_active: TestClient,
        hosts_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        hosts_before = hosts_file.read_bytes()

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["network"]}
        )

        assert response.status_code == 200
        assert list(response.json()["cleared"]) == ["network"]
        assert config_on_disk()["network"]["ssh_hosts"] == _DEFAULT_NETWORK["ssh_hosts"]
        assert hosts_file.read_bytes() == hosts_before

    @pytest.mark.usefixtures("saved_network")
    def test_network_returns_certificates_to_the_builtin_list_without_additions(
        self,
        client_admin_active: TestClient,
        certificates_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["network"]}
        )

        assert response.status_code == 200
        assert config_on_disk()["network"]["certificates"] == _DEFAULT_NETWORK["certificates"]
        assert _read_yaml(certificates_file) == {"certificates": []}

    def test_network_returns_the_proxy_to_its_defaults(
        self,
        client_admin_active: TestClient,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        from wavecore.core.secrets.key_provider import get_cipher

        saved_proxy = {**_SAVED_NETWORK["proxy"], "password": get_cipher().seal("pr0xy-s3cret")}
        load_config({"network": {**_SAVED_NETWORK, "proxy": saved_proxy}})

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["network"]}
        )

        assert response.status_code == 200
        assert list(response.json()["cleared"]) == ["network"]
        assert config_on_disk()["network"]["proxy"] == _DEFAULT_NETWORK["proxy"]
        assert _running_network()["proxy"] == _DEFAULT_NETWORK["proxy"]

    def test_network_without_saved_settings_writes_the_defaults_into_the_config_file(
        self,
        client_admin_active: TestClient,
        hosts_file: Path,
        certificates_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["network"]}
        )

        assert response.status_code == 200
        assert list(response.json()["cleared"]) == ["network"]
        assert config_on_disk() == {"network": _DEFAULT_NETWORK}
        assert not hosts_file.exists()
        assert _read_yaml(certificates_file) == {"certificates": []}

    @pytest.mark.usefixtures("saved_network")
    def test_network_is_in_force_at_once_and_after_a_restart(
        self, client_admin_active: TestClient, load_config: Callable[..., Any]
    ) -> None:
        assert _running_network() == _SAVED_NETWORK

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["network"]}
        )

        assert response.status_code == 200
        assert _running_network() == _DEFAULT_NETWORK
        load_config()
        assert _running_network() == _DEFAULT_NETWORK

    def test_network_keeps_every_other_setting_in_the_config_file(
        self,
        client_admin_active: TestClient,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        others = {"logging": {"level": "DEBUG"}, "secret_masking": {"run_output": True}}
        load_config({**others, "network": _SAVED_NETWORK})

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["network"]}
        )

        assert response.status_code == 200
        assert config_on_disk() == {**others, "network": _DEFAULT_NETWORK}

    @pytest.mark.usefixtures("saved_network")
    def test_ssh_hosts_empties_the_hosts_and_keeps_the_policy(
        self, client_admin_active: TestClient, hosts_file: Path, config_file: Path
    ) -> None:
        config_before = config_file.read_bytes()

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["ssh-hosts"]}
        )

        assert response.status_code == 200
        assert response.json()["cleared"] == {"ssh-hosts": 2}
        assert _read_yaml(hosts_file) == {"hosts": []}
        assert config_file.read_bytes() == config_before
        assert _running_network() == _SAVED_NETWORK

    def test_ssh_hosts_drops_a_leftover_policy_from_the_hosts_file(
        self,
        client_admin_active: TestClient,
        hosts_file: Path,
        saved_hosts: list[dict[str, Any]],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        _write_yaml(hosts_file, {"policy": dict(_SAVED_NETWORK["ssh_hosts"]), "hosts": saved_hosts})

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["ssh-hosts"]}
        )

        assert response.status_code == 200
        assert response.json()["cleared"] == {"ssh-hosts": 2}
        assert _read_yaml(hosts_file) == {"hosts": []}
        assert config_on_disk() == {}

    @pytest.mark.usefixtures("saved_network")
    def test_ssh_hosts_leaves_the_certificates_file_untouched(
        self, client_admin_active: TestClient, certificates_file: Path
    ) -> None:
        before = certificates_file.read_bytes()

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["ssh-hosts"]}
        )

        assert response.status_code == 200
        assert certificates_file.read_bytes() == before

    def test_ssh_hosts_without_a_saved_file_clears_nothing(
        self, client_admin_active: TestClient, hosts_file: Path, config_file: Path
    ) -> None:
        config_before = config_file.read_bytes()

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["ssh-hosts"]}
        )

        assert response.status_code == 200
        assert response.json()["cleared"] == {"ssh-hosts": 0}
        assert _read_yaml(hosts_file) in ({}, {"hosts": []})
        assert config_file.read_bytes() == config_before

    @pytest.mark.usefixtures("saved_network")
    def test_both_scopes_together_reset_everything_network(
        self,
        client_admin_active: TestClient,
        hosts_file: Path,
        certificates_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["network", "ssh-hosts"]}
        )

        assert response.status_code == 200
        assert set(response.json()["cleared"]) == {"network", "ssh-hosts"}
        assert response.json()["cleared"]["ssh-hosts"] == 2
        assert config_on_disk() == {"network": _DEFAULT_NETWORK}
        assert _read_yaml(hosts_file) == {"hosts": []}
        assert _read_yaml(certificates_file) == {"certificates": []}

    @pytest.mark.usefixtures("saved_network")
    def test_default_reset_leaves_the_network_settings_untouched(
        self,
        client_admin_active: TestClient,
        hosts_file: Path,
        certificates_file: Path,
        config_file: Path,
    ) -> None:
        hosts_before = hosts_file.read_bytes()
        certificates_before = certificates_file.read_bytes()
        config_before = config_file.read_bytes()

        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        assert "network" not in response.json()["cleared"]
        assert "ssh-hosts" not in response.json()["cleared"]
        assert hosts_file.read_bytes() == hosts_before
        assert certificates_file.read_bytes() == certificates_before
        assert config_file.read_bytes() == config_before
        assert _running_network() == _SAVED_NETWORK

    @pytest.mark.usefixtures("saved_network")
    @pytest.mark.parametrize("category", ["ssh_hosts", "certificates"])
    def test_an_unknown_category_is_named_and_nothing_is_reset(
        self,
        client_admin_active: TestClient,
        hosts_file: Path,
        certificates_file: Path,
        config_file: Path,
        category: str,
    ) -> None:
        hosts_before = hosts_file.read_bytes()
        certificates_before = certificates_file.read_bytes()
        config_before = config_file.read_bytes()

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["network", "ssh-hosts", category]}
        )

        assert response.status_code == 400
        assert response.json()["detail"] == f"Invalid scope category: {category}"
        assert hosts_file.read_bytes() == hosts_before
        assert certificates_file.read_bytes() == certificates_before
        assert config_file.read_bytes() == config_before


class TestStateResetTestData:
    """Test suite for the ``testdata`` reset scope.

    REQ-5.2.6.3: the per-test file zone is cleared by the default reset and by
    an explicit ``testdata`` scope; the zone directory itself is kept.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        _reset_admin_state()

    @staticmethod
    def _seed_testdata_file() -> Path:
        from wavecore.api.services.storage_paths import get_test_testdata_path

        path = get_test_testdata_path("test-1") / "fixtures" / "customers.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"id,name\n")
        return path

    def test_testdata_is_a_valid_scope_category(self) -> None:
        """Test that 'testdata' is accepted by the scope validator."""
        from wavecore.api.routes.admin.routes import VALID_RESET_CATEGORIES

        assert "testdata" in VALID_RESET_CATEGORIES

    def test_testdata_is_a_default_scope_category(self) -> None:
        """Test that 'testdata' is cleared when scope is omitted."""
        from wavecore.api.routes.admin.routes import DEFAULT_RESET_CATEGORIES

        assert "testdata" in DEFAULT_RESET_CATEGORIES

    def test_clear_category_empties_the_zone(self) -> None:
        """Test that clear_category('testdata') removes every test's files."""
        from wavecore.api.routes.admin.routes import clear_category
        from wavecore.api.services.storage_paths import get_testdata_storage_path

        self._seed_testdata_file()

        clear_category("testdata")

        assert list(get_testdata_storage_path().iterdir()) == []

    def test_clear_category_keeps_the_zone_directory(self) -> None:
        """Test that the testdata zone directory survives the reset."""
        from wavecore.api.routes.admin.routes import clear_category
        from wavecore.api.services.storage_paths import get_testdata_storage_path

        self._seed_testdata_file()

        clear_category("testdata")

        assert get_testdata_storage_path().is_dir()

    def test_reset_with_testdata_scope_clears_the_zone(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that POST /admin/reset with scope ['testdata'] empties the zone."""
        path = self._seed_testdata_file()

        response = client_admin_active.post(
            "/admin/reset", json={"confirm": True, "scope": ["testdata"]}
        )

        assert response.status_code == 200
        assert "testdata" in response.json()["cleared"]
        assert not path.exists()

    def test_default_reset_clears_the_zone(self, client_admin_active: TestClient) -> None:
        """Test that a scope-less reset also empties the test data zone."""
        path = self._seed_testdata_file()

        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        assert not path.exists()


class TestStateResetResponseStructure:
    """Test suite for state reset response structure.

    REQ-5.2.6.3: Response includes item counts per category and ISO 8601 UTC timestamp.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        _reset_admin_state()

    def test_reset_response_includes_cleared_counts(self, client_admin_active: TestClient) -> None:
        """Test that reset response includes counts per category."""
        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        data = response.json()
        assert "cleared" in data
        # Each cleared category should have a count
        for _category, count in data["cleared"].items():
            assert isinstance(count, int)
            assert count >= 0

    def test_reset_response_includes_timestamp(self, client_admin_active: TestClient) -> None:
        """Test that reset response includes ISO 8601 UTC timestamp."""
        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        data = response.json()
        assert "timestamp" in data
        # Validate ISO 8601 format with Z suffix
        timestamp = data["timestamp"]
        assert timestamp.endswith("Z")
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))

    def test_reset_response_structure_complete(self, client_admin_active: TestClient) -> None:
        """Test complete reset response structure."""
        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        data = response.json()
        # Required fields
        assert "cleared" in data
        assert "timestamp" in data
        # Cleared should be a dict with category counts
        assert isinstance(data["cleared"], dict)

    def test_reset_response_cleared_categories_are_integers(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that cleared category counts are integers."""
        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        data = response.json()
        for category, count in data["cleared"].items():
            assert isinstance(count, int), f"Count for {category} should be int"


class TestStateResetErrorHandling:
    """Test suite for state reset error handling.

    REQ-5.2.6.3 error handling:
    - HTTP 404 when deployment gate disallows admin
    - HTTP 403 when admin not enabled
    - HTTP 400 for missing confirmation
    - HTTP 500 for storage errors with partial results in response body
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        _reset_admin_state()

    def test_reset_storage_error_returns_500_with_partial_results(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that storage errors return 500 with partial results."""
        # Mock storage to fail on one category
        with patch("wavecore.api.routes.admin.routes.clear_category") as mock_clear:
            # First call succeeds, second fails
            mock_clear.side_effect = [
                {"entities": 5},
                Exception("Storage error"),
            ]

            response = client_admin_active.post(
                "/admin/reset", json={"confirm": True, "scope": ["entities", "blocks"]}
            )

            # Should return 500 on storage error
            assert response.status_code == 500
            data = response.json()
            # Should include partial results
            assert "cleared" in data
            assert "error" in data

    def test_reset_invalid_json_returns_400(self, client_admin_active: TestClient) -> None:
        """Test that invalid JSON returns 400."""
        response = client_admin_active.post(
            "/admin/reset",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )

        # FastAPI returns 400 for JSON parse errors
        assert response.status_code == 400

    def test_reset_only_accepts_post(self, client_admin_active: TestClient) -> None:
        """Test that /admin/reset only accepts POST requests."""
        # GET should not be allowed
        response = client_admin_active.get("/admin/reset")
        assert response.status_code == 405

        # PUT should not be allowed
        response = client_admin_active.put("/admin/reset", json={"confirm": True})
        assert response.status_code == 405

        # DELETE should not be allowed
        response = client_admin_active.delete("/admin/reset")
        assert response.status_code == 405


class TestStateResetCacheInvalidation:
    """Test suite for state reset cache invalidation.

    REQ-5.2.6.3: All related caches (including dashboard cache) are invalidated
    after clearing.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        _reset_admin_state()

    def test_reset_invalidates_dashboard_cache(self, client_admin_active: TestClient) -> None:
        """Test that reset invalidates the dashboard cache."""
        with patch(
            "wavecore.api.routes.admin.routes.invalidate_dashboard_cache"
        ) as mock_invalidate:
            response = client_admin_active.post("/admin/reset", json={"confirm": True})

            assert response.status_code == 200
            # Cache invalidation should be called
            mock_invalidate.assert_called_once()

    def test_reset_invalidates_entity_caches(self, client_admin_active: TestClient) -> None:
        """Test that reset invalidates entity-related caches."""
        with patch("wavecore.api.routes.admin.routes.invalidate_entity_caches") as mock_invalidate:
            response = client_admin_active.post("/admin/reset", json={"confirm": True})

            assert response.status_code == 200
            # Entity cache invalidation should be called
            mock_invalidate.assert_called_once()


class TestStateResetAuditLogging:
    """Test suite for state reset audit logging.

    REQ-5.2.6.3: Reset operations are logged with timestamp, admin session details,
    and counts per category cleared.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset audit"})
            yield client

        _reset_admin_state()

    def test_reset_logs_operation(self, client_admin_active: TestClient) -> None:
        """Test that reset operation is logged for audit trail."""
        with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
            response = client_admin_active.post("/admin/reset", json={"confirm": True})

            assert response.status_code == 200
            # Should log the reset operation
            mock_logger.info.assert_called()

    def test_reset_logs_admin_session_details(self, client_admin_active: TestClient) -> None:
        """Test that reset log includes admin session details."""
        with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
            response = client_admin_active.post("/admin/reset", json={"confirm": True})

            assert response.status_code == 200
            # Verify log call contains session info
            calls = mock_logger.info.call_args_list
            # At least one info call should contain reset details
            log_messages = [str(call) for call in calls]
            assert any("reset" in msg.lower() for msg in log_messages)

    def test_reset_logs_counts_per_category(self, client_admin_active: TestClient) -> None:
        """Test that reset log includes counts per category."""
        with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
            response = client_admin_active.post("/admin/reset", json={"confirm": True})

            assert response.status_code == 200
            # Log should be called with reset details
            mock_logger.info.assert_called()

    def test_blocked_reset_attempt_logged_when_gate_disallows(self) -> None:
        """Test that blocked reset attempts are logged when deployment gate disallows."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            client = TestClient(app)

            with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
                response = client.post("/admin/reset", json={"confirm": True})

                assert response.status_code == 404
                mock_logger.warning.assert_called()

        _reset_admin_state()

    def test_blocked_reset_attempt_logged_when_admin_not_enabled(self) -> None:
        """Test that blocked reset attempts are logged when admin allowed but not enabled.

        REQ-5.2.6.3: When admin is allowed but not activated (HTTP 403 case),
        the blocked attempt should be logged for audit trail.
        """
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            # Do NOT enable admin mode - leave in allowed-but-inactive state

            with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
                response = client.post("/admin/reset", json={"confirm": True})

                assert response.status_code == 403
                assert response.json()["detail"] == "Admin mode must be enabled first"
                # Should log the blocked attempt
                mock_logger.warning.assert_called()

        _reset_admin_state()


class TestStateResetIdempotency:
    """Test suite for state reset idempotency behavior.

    Multiple reset calls should be safe and produce consistent results.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset"})
            yield client

        _reset_admin_state()

    def test_reset_is_idempotent(self, client_admin_active: TestClient) -> None:
        """Test that multiple resets produce consistent results."""
        # First reset
        response1 = client_admin_active.post("/admin/reset", json={"confirm": True})
        assert response1.status_code == 200

        # Second reset - should also succeed (clearing empty categories)
        response2 = client_admin_active.post("/admin/reset", json={"confirm": True})
        assert response2.status_code == 200

        # Both should have same response structure
        data1 = response1.json()
        data2 = response2.json()
        assert set(data1["cleared"].keys()) == set(data2["cleared"].keys())

    def test_reset_after_reset_returns_zero_counts(self, client_admin_active: TestClient) -> None:
        """Test that reset after reset returns zero counts (nothing to clear)."""
        # First reset clears everything
        client_admin_active.post("/admin/reset", json={"confirm": True})

        # Second reset should clear zero items
        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        data = response.json()
        # All counts should be zero after second reset
        for category, count in data["cleared"].items():
            assert count == 0, f"Expected 0 items for {category} on second reset"


class TestStateResetPreservesSystemInfrastructure:
    """Test suite for verifying system infrastructure is preserved during reset.

    REQ-5.2.6.3: System infrastructure is preserved: plugins, configuration,
    and credential profiles remain untouched during reset operations.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing reset preservation"})
            yield client

        _reset_admin_state()

    def test_reset_does_not_clear_plugins(self, client_admin_active: TestClient) -> None:
        """Test that reset does NOT clear registered plugins.

        Plugins are system infrastructure and must remain available after reset.
        """
        with patch("wavecore.api.routes.admin.routes.get_registered_plugins") as mock_get_plugins:
            # Setup: plugins exist before reset
            mock_get_plugins.return_value = [
                {"name": "shell-script", "version": "1.0.0"},
                {"name": "http", "version": "1.0.0"},
            ]

            # Perform reset
            response = client_admin_active.post("/admin/reset", json={"confirm": True})
            assert response.status_code == 200

            # Verify plugins were NOT cleared (clear function not called for plugins)
            data = response.json()
            assert "plugins" not in data["cleared"]

    def test_reset_does_not_clear_configuration(self, client_admin_active: TestClient) -> None:
        """Test that reset does NOT clear system configuration.

        Configuration is system infrastructure and must remain intact after reset.
        """
        with patch("wavecore.api.routes.admin.routes.get_system_config") as mock_get_config:
            # Setup: configuration exists before reset
            mock_get_config.return_value = {
                "storage_path": "/var/wave/data",
                "log_level": "INFO",
            }

            # Perform reset
            response = client_admin_active.post("/admin/reset", json={"confirm": True})
            assert response.status_code == 200

            # Verify configuration was NOT cleared
            data = response.json()
            assert "configuration" not in data["cleared"]
            assert "config" not in data["cleared"]

    def test_reset_does_not_clear_credential_profiles(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that reset does NOT clear credential profiles.

        Credential profiles are system infrastructure and must remain secure after reset.
        """
        with patch("wavecore.api.routes.admin.routes.get_credential_profiles") as mock_get_profiles:
            # Setup: credential profiles exist before reset
            mock_get_profiles.return_value = [
                {"name": "production", "type": "ssh"},
                {"name": "staging", "type": "kubernetes"},
            ]

            # Perform reset
            response = client_admin_active.post("/admin/reset", json={"confirm": True})
            assert response.status_code == 200

            # Verify credentials were NOT cleared
            data = response.json()
            assert "credentials" not in data["cleared"]
            assert "profiles" not in data["cleared"]

    def test_reset_only_clears_test_data_categories(self, client_admin_active: TestClient) -> None:
        """Test that reset ONLY clears test data categories, not system infrastructure.

        Valid clearable categories are: entities, blocks, executions, artifacts, testdata.
        System infrastructure (plugins, configuration, credentials) must NOT be clearable.
        """
        response = client_admin_active.post("/admin/reset", json={"confirm": True})

        assert response.status_code == 200
        data = response.json()
        cleared_categories = set(data["cleared"].keys())

        # Only test data categories should be in cleared
        valid_test_data_categories = {"entities", "blocks", "executions", "artifacts", "testdata"}
        assert cleared_categories.issubset(
            valid_test_data_categories
        ), f"Unexpected categories cleared: {cleared_categories - valid_test_data_categories}"

        # System infrastructure must NOT be cleared
        system_infrastructure = {"plugins", "configuration", "config", "credentials", "profiles"}
        assert cleared_categories.isdisjoint(system_infrastructure), (
            f"System infrastructure should not be cleared: "
            f"{cleared_categories & system_infrastructure}"
        )


class TestSystemInfrastructurePlaceholderFunctions:
    """Test suite for system infrastructure placeholder functions.

    These functions are placeholders for future implementation. They exist to:
    1. Support mocking in tests that verify reset doesn't clear infrastructure
    2. Define the interface for future integration with plugin, config, and credential systems

    These tests verify the placeholder contract (returning empty collections).
    """

    def test_get_registered_plugins_returns_empty_list(self) -> None:
        """Test that get_registered_plugins returns an empty list (placeholder)."""
        from wavecore.api.routes.admin.routes import get_registered_plugins

        result = get_registered_plugins()

        assert result == []
        assert isinstance(result, list)

    def test_get_system_config_returns_empty_dict(self) -> None:
        """Test that get_system_config returns an empty dict (placeholder)."""
        from wavecore.api.routes.admin.routes import get_system_config

        result = get_system_config()

        assert result == {}
        assert isinstance(result, dict)

    def test_get_credential_profiles_returns_empty_list(self) -> None:
        """Test that get_credential_profiles returns an empty list (placeholder)."""
        from wavecore.api.routes.admin.routes import get_credential_profiles

        result = get_credential_profiles()

        assert result == []
        assert isinstance(result, list)


class TestLogLevelEndpoints:
    """Tests for log level management endpoints (REQ-3.7.2.6)."""

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        """Create test client with admin allowed."""
        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            with TestClient(app) as client:
                yield client

    def test_get_log_level_returns_current_level(self, client: TestClient) -> None:
        """GET /admin/log-level returns current log level."""
        response = client.get("/admin/log-level")

        assert response.status_code == 200
        data = response.json()
        assert "level" in data
        assert data["level"] in ("DEBUG", "INFO", "WARN", "ERROR", "FATAL")
        assert "timestamp" in data

    def test_set_log_level_to_debug(self, client: TestClient) -> None:
        """PUT /admin/log-level sets level to DEBUG."""
        response = client.put("/admin/log-level", json={"level": "DEBUG"})

        assert response.status_code == 200
        data = response.json()
        assert data["level"] == "DEBUG"
        assert "timestamp" in data

    def test_set_log_level_to_info(self, client: TestClient) -> None:
        """PUT /admin/log-level sets level to INFO."""
        response = client.put("/admin/log-level", json={"level": "INFO"})

        assert response.status_code == 200
        assert response.json()["level"] == "INFO"

    def test_set_log_level_to_warn(self, client: TestClient) -> None:
        """PUT /admin/log-level sets level to WARN."""
        response = client.put("/admin/log-level", json={"level": "WARN"})

        assert response.status_code == 200
        assert response.json()["level"] == "WARN"

    def test_set_log_level_to_error(self, client: TestClient) -> None:
        """PUT /admin/log-level sets level to ERROR."""
        response = client.put("/admin/log-level", json={"level": "ERROR"})

        assert response.status_code == 200
        assert response.json()["level"] == "ERROR"

    def test_set_log_level_to_fatal(self, client: TestClient) -> None:
        """PUT /admin/log-level sets level to FATAL."""
        response = client.put("/admin/log-level", json={"level": "FATAL"})

        assert response.status_code == 200
        assert response.json()["level"] == "FATAL"

    def test_set_log_level_normalizes_lowercase(self, client: TestClient) -> None:
        """PUT /admin/log-level normalizes lowercase input."""
        response = client.put("/admin/log-level", json={"level": "debug"})

        assert response.status_code == 200
        assert response.json()["level"] == "DEBUG"

    def test_set_log_level_rejects_invalid_level(self, client: TestClient) -> None:
        """PUT /admin/log-level returns 400 for invalid level."""
        response = client.put("/admin/log-level", json={"level": "INVALID"})

        assert response.status_code == 400
        assert "Invalid log level" in response.json()["detail"]

    def test_log_level_does_not_require_admin_mode(self, client: TestClient) -> None:
        """Log level endpoints work without admin mode enabled."""
        # Ensure admin is NOT enabled
        from wavecore.api.routes.admin import routes as _admin_routes

        _admin_routes._admin_enabled = False

        response = client.get("/admin/log-level")
        assert response.status_code == 200

        response = client.put("/admin/log-level", json={"level": "INFO"})
        assert response.status_code == 200


@pytest.mark.usefixtures("restore_log_levels")
class TestLogLevelStorage:
    """PUT /admin/log-level writes the config file, then applies the level (REQ-4.7.18)."""

    @pytest.fixture(autouse=True)
    def no_environment_level(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("WAVE_LOG_LEVEL", raising=False)

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def level_in_force(self, restore_log_levels: None) -> str:
        from wavecore.core.logging.formatter import set_log_level

        return set_log_level("ERROR")

    def test_get_returns_the_level_in_force_and_nothing_about_its_source(
        self, client: TestClient, load_config: Callable[..., Any], level_in_force: str
    ) -> None:
        load_config({"logging": {"level": "DEBUG"}})

        response = client.get("/admin/log-level")

        assert response.status_code == 200
        body = response.json()
        assert set(body) == {"level", "timestamp"}
        assert body["level"] == level_in_force
        assert body["timestamp"].endswith("Z")

    @pytest.mark.usefixtures("level_in_force")
    def test_put_writes_the_config_file_and_the_next_get_reads_the_new_level(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        response = client.put("/admin/log-level", json={"level": "debug"})

        assert response.status_code == 200
        body = response.json()
        assert set(body) == {"level", "timestamp"}
        assert body["level"] == "DEBUG"
        assert config_on_disk() == {"logging": {"level": "DEBUG"}}
        assert logging.getLogger().level == logging.DEBUG
        assert client.get("/admin/log-level").json()["level"] == "DEBUG"

    @pytest.mark.parametrize(
        ("given", "expected"),
        [("warning", "WARN"), ("CRITICAL", "FATAL"), ("Error", "ERROR")],
    )
    def test_put_answers_with_and_writes_the_canonical_name(
        self,
        client: TestClient,
        config_on_disk: Callable[[], dict[str, Any]],
        given: str,
        expected: str,
    ) -> None:
        response = client.put("/admin/log-level", json={"level": given})

        assert response.status_code == 200
        assert response.json()["level"] == expected
        assert config_on_disk()["logging"]["level"] == expected
        assert client.get("/admin/log-level").json()["level"] == expected

    def test_put_changes_only_the_level_in_the_config_file(
        self,
        client: TestClient,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(
            {
                "logging": {"level": "INFO", "output_dest": "stdout"},
                "secret_masking": {"run_output": True},
            }
        )

        response = client.put("/admin/log-level", json={"level": "ERROR"})

        assert response.status_code == 200
        assert config_on_disk() == {
            "logging": {"level": "ERROR", "output_dest": "stdout"},
            "secret_masking": {"run_output": True},
        }

    def test_saved_level_survives_a_restart(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        response = client.put("/admin/log-level", json={"level": "DEBUG"})

        assert response.status_code == 200
        assert load_config().logging.level == "DEBUG"

    @pytest.mark.usefixtures("level_in_force")
    def test_put_saves_and_applies_while_the_environment_names_a_level(
        self,
        client: TestClient,
        config_on_disk: Callable[[], dict[str, Any]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("WAVE_LOG_LEVEL", "ERROR")

        response = client.put("/admin/log-level", json={"level": "DEBUG"})

        assert response.status_code == 200
        assert response.json()["level"] == "DEBUG"
        assert config_on_disk()["logging"]["level"] == "DEBUG"
        assert client.get("/admin/log-level").json()["level"] == "DEBUG"

    def test_invalid_level_keeps_the_exact_400_and_changes_nothing(
        self, client: TestClient, config_file: Path, level_in_force: str
    ) -> None:
        before = config_file.read_bytes()

        response = client.put("/admin/log-level", json={"level": "verbose"})

        assert response.status_code == 400
        assert response.json()["detail"] == (
            "Invalid log level: 'verbose'. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL"
        )
        assert config_file.read_bytes() == before
        assert client.get("/admin/log-level").json()["level"] == level_in_force

    def test_read_only_config_file_refuses_the_save_and_the_level_stays(
        self, client: TestClient, read_only_config: Path, level_in_force: str
    ) -> None:
        from wavecore.api.config import get_config

        before = read_only_config.read_bytes()

        response = client.put("/admin/log-level", json={"level": "DEBUG"})

        assert response.status_code == 500
        error = response.json()["error"]
        assert error["code"] == "INTERNAL_ERROR"
        assert error["message"] == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert read_only_config.read_bytes() == before
        assert client.get("/admin/log-level").json()["level"] == level_in_force
        assert logging.getLogger().level == logging.ERROR
        assert get_config().logging.level == "INFO"
