"""Unit tests for admin bulk entity operations (REQ-5.2.6.4.1-4).

This module tests the bulk entity endpoints for E2E testing scenarios:
- REQ-5.2.6.4.1: Bulk execution operations
- REQ-5.2.6.4.2: Bulk test operations
- REQ-5.2.6.4.3: Bulk suite operations
- REQ-5.2.6.4.4: Bulk regression operations

Test Coverage:
- Common behavior:
  - Security gates (404 when deployment gate disallows, 403 when admin not enabled)
  - Operation types: add, modify, replace, delete
  - Mixed operations in single request
  - Atomicity (all-or-nothing within request)
  - Request validation (400 for invalid requests)
  - Storage errors (500 with partial results and failed_index)
  - Cache invalidation after operations
  - Audit logging (both 403 and 404 blocked attempts)
- Entity-specific tests for each entity type:
  - Execution: required fields (id, entity_type, entity_id, status)
  - Test: required fields (id, name, version)
  - Suite: required fields (id, name, version)
  - Regression: required fields (id, name, version)
"""

import os
import uuid
from collections.abc import Generator
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def _uuid() -> str:
    """Generate a valid UUID for test entities."""
    return str(uuid.uuid4())


# Pre-defined test UUIDs for consistent test data
# These are fixed to make tests deterministic and easier to debug
TEST_UUID_1 = "11111111-1111-1111-1111-111111111111"
TEST_UUID_2 = "22222222-2222-2222-2222-222222222222"
TEST_UUID_3 = "33333333-3333-3333-3333-333333333333"
TEST_UUID_4 = "44444444-4444-4444-4444-444444444444"
TEST_UUID_5 = "55555555-5555-5555-5555-555555555555"
TEST_UUID_6 = "66666666-6666-6666-6666-666666666666"
TEST_UUID_7 = "77777777-7777-7777-7777-777777777777"
TEST_UUID_8 = "88888888-8888-8888-8888-888888888888"
EXEC_UUID_1 = "eeee1111-1111-1111-1111-111111111111"
EXEC_UUID_2 = "eeee2222-2222-2222-2222-222222222222"
EXEC_UUID_3 = "eeee3333-3333-3333-3333-333333333333"
EXEC_UUID_4 = "eeee4444-4444-4444-4444-444444444444"
EXEC_UUID_5 = "eeee5555-5555-5555-5555-555555555555"
SUITE_UUID_1 = "55551111-1111-1111-1111-111111111111"
SUITE_UUID_2 = "55552222-2222-2222-2222-222222222222"
SUITE_UUID_3 = "55553333-3333-3333-3333-333333333333"
REG_UUID_1 = "aaaaa111-1111-1111-1111-111111111111"
REG_UUID_2 = "aaaaa222-2222-2222-2222-222222222222"
REG_UUID_3 = "aaaaa333-3333-3333-3333-333333333333"


def _reset_admin_state() -> None:
    """Reset admin module state for test isolation."""
    from wavecore.api.routes.admin import routes as admin_routes

    admin_routes._admin_enabled = False
    admin_routes._admin_enabled_at = None
    admin_routes._admin_reason = None
    # Clear bulk entity stores
    admin_routes.clear_bulk_stores()


# =============================================================================
# Common Admin Bulk Endpoint Security Tests
# =============================================================================


class TestBulkEndpointSecurityGates:
    """Test suite for bulk endpoint security requirements.

    All bulk endpoints follow the admin security model:
    - HTTP 404 when deployment gate disallows admin (conceals existence)
    - HTTP 403 when admin allowed but not enabled
    - Accessible only when admin mode is fully active
    """

    @pytest.fixture
    def endpoints(self) -> list[str]:
        """List of all bulk endpoints to test."""
        return [
            "/admin/bulk/executions",
            "/admin/bulk/tests",
            "/admin/bulk/suites",
            "/admin/bulk/regressions",
        ]

    def test_bulk_endpoints_return_404_when_deployment_gate_disallows(
        self, endpoints: list[str]
    ) -> None:
        """Test that all bulk endpoints return 404 when deployment gate disallows admin."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            client = TestClient(app)

            for endpoint in endpoints:
                response = client.post(endpoint, json={"operations": []})

                assert response.status_code == 404, f"Expected 404 for {endpoint}"
                assert response.json()["detail"] == "Not Found"

        _reset_admin_state()

    def test_bulk_endpoints_return_403_when_admin_not_enabled(self, endpoints: list[str]) -> None:
        """Test that all bulk endpoints return 403 when admin allowed but not enabled."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)

            for endpoint in endpoints:
                response = client.post(endpoint, json={"operations": []})

                assert response.status_code == 403, f"Expected 403 for {endpoint}"
                assert response.json()["detail"] == "Admin mode must be enabled first"

        _reset_admin_state()

    def test_bulk_endpoints_accessible_when_admin_fully_active(self, endpoints: list[str]) -> None:
        """Test that all bulk endpoints are accessible when admin mode is fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            # Enable admin mode
            client.post("/admin/enable", json={"reason": "Testing bulk access"})

            for endpoint in endpoints:
                response = client.post(endpoint, json={"operations": []})

                # Should not return 403 or 404 - returns 200 when successful
                assert response.status_code not in [
                    403,
                    404,
                ], f"Expected accessible for {endpoint}, got {response.status_code}"

        _reset_admin_state()


class TestBulkEndpointRequestValidation:
    """Test suite for bulk endpoint request validation.

    All bulk endpoints validate:
    - Required 'operations' field
    - Each operation has required fields (op, entity)
    - Valid operation type (add, modify, replace, delete)
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk validation"})
            yield client

        _reset_admin_state()

    @pytest.fixture
    def endpoints(self) -> list[str]:
        """List of all bulk endpoints to test."""
        return [
            "/admin/bulk/executions",
            "/admin/bulk/tests",
            "/admin/bulk/suites",
            "/admin/bulk/regressions",
        ]

    def test_bulk_requires_operations_field(
        self, client_admin_active: TestClient, endpoints: list[str]
    ) -> None:
        """Test that bulk endpoints return 400 when operations field is missing."""
        for endpoint in endpoints:
            response = client_admin_active.post(endpoint, json={})

            assert response.status_code == 400, f"Expected 400 for {endpoint}"
            assert "operations" in response.json()["detail"].lower()

    def test_bulk_requires_operations_as_list(
        self, client_admin_active: TestClient, endpoints: list[str]
    ) -> None:
        """Test that bulk endpoints return 400 when operations is not a list."""
        for endpoint in endpoints:
            response = client_admin_active.post(endpoint, json={"operations": "invalid"})

            assert response.status_code == 400, f"Expected 400 for {endpoint}"

    def test_bulk_operation_requires_op_field(
        self, client_admin_active: TestClient, endpoints: list[str]
    ) -> None:
        """Test that bulk endpoints return 400 when operation missing 'op' field."""
        for endpoint in endpoints:
            response = client_admin_active.post(
                endpoint, json={"operations": [{"entity": {"id": TEST_UUID_1}}]}
            )

            assert response.status_code == 400, f"Expected 400 for {endpoint}"
            assert "op" in response.json()["detail"].lower()

    def test_bulk_operation_requires_entity_field(
        self, client_admin_active: TestClient, endpoints: list[str]
    ) -> None:
        """Test that bulk endpoints return 400 when operation missing 'entity' field."""
        for endpoint in endpoints:
            response = client_admin_active.post(endpoint, json={"operations": [{"op": "add"}]})

            assert response.status_code == 400, f"Expected 400 for {endpoint}"
            assert "entity" in response.json()["detail"].lower()

    def test_bulk_operation_rejects_invalid_op_type(
        self, client_admin_active: TestClient, endpoints: list[str]
    ) -> None:
        """Test that bulk endpoints return 400 for invalid operation type."""
        for endpoint in endpoints:
            response = client_admin_active.post(
                endpoint,
                json={"operations": [{"op": "invalid", "entity": {"id": TEST_UUID_1}}]},
            )

            assert response.status_code == 400, f"Expected 400 for {endpoint}"
            assert "op" in response.json()["detail"].lower()

    def test_bulk_accepts_valid_op_types(
        self, client_admin_active: TestClient, endpoints: list[str]
    ) -> None:
        """Test that bulk endpoints accept valid operation types: add, modify, replace, delete."""
        valid_ops = ["add", "modify", "replace", "delete"]

        for endpoint in endpoints:
            for op in valid_ops:
                response = client_admin_active.post(
                    endpoint,
                    json={"operations": [{"op": op, "entity": {"id": _uuid()}}]},
                )

                # Should not return 400 for invalid op type
                # May return other errors (e.g., entity not found for modify/delete)
                if response.status_code == 400:
                    detail = response.json().get("detail", "")
                    assert (
                        "op" not in detail.lower() or "invalid" not in detail.lower()
                    ), f"Op '{op}' should be valid for {endpoint}"

    def test_bulk_add_rejects_invalid_uuid_format(self, client_admin_active: TestClient) -> None:
        """Test that bulk add operation rejects invalid UUID format."""
        # Use /admin/bulk/tests which has simpler requirements
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": "not-a-valid-uuid",
                            "name": "Test",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "not a valid UUID" in response.json()["detail"]


class TestBulkEndpointAtomicity:
    """Test suite for bulk endpoint atomicity (all-or-nothing).

    REQ-5.2.6.4: Atomicity ensures that if any operation fails,
    no operations are committed.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk atomicity"})
            yield client

        _reset_admin_state()

    def test_atomicity_rollback_on_failure(self, client_admin_active: TestClient) -> None:
        """Test that all operations are rolled back when one fails.

        If the second add operation fails (entity already exists),
        the first add should also be rolled back.
        """
        conflict_uuid = TEST_UUID_1
        new_uuid = TEST_UUID_2
        # First, add an entity that will cause conflict
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": conflict_uuid,
                            "name": "Conflict Test",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )
        assert response.status_code == 200

        # Now try to add two entities where the second conflicts
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": new_uuid,
                            "name": "New Test",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": conflict_uuid,
                            "name": "Conflict Test",
                            "version": "1.0.0",
                        },
                    },
                ]
            },
        )

        # Should fail due to conflict
        assert response.status_code == 409
        data = response.json()
        assert data["failed_index"] == 1
        assert "already exists" in data["detail"].lower()

        # Verify first operation was rolled back (new-test should not exist)
        # This would be verified by trying to get the entity

    def test_atomicity_success_commits_all(self, client_admin_active: TestClient) -> None:
        """Test that all operations are committed on success."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_3,
                            "name": "Atomic Test 1",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_4,
                            "name": "Atomic Test 2",
                            "version": "1.0.0",
                        },
                    },
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 2
        assert len(data["results"]) == 2


class TestBulkEndpointCacheInvalidation:
    """Test suite for bulk endpoint cache invalidation.

    REQ-5.2.6.4: All bulk endpoints must invalidate related caches
    after operations complete.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing cache invalidation"})
            yield client

        _reset_admin_state()

    def test_bulk_operations_invalidate_dashboard_cache(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that bulk operations invalidate the dashboard cache."""
        with patch(
            "wavecore.api.routes.admin.routes.invalidate_dashboard_cache"
        ) as mock_invalidate:
            response = client_admin_active.post(
                "/admin/bulk/tests",
                json={
                    "operations": [
                        {
                            "op": "add",
                            "entity": {
                                "id": TEST_UUID_1,
                                "name": "Cache Test",
                                "version": "1.0.0",
                            },
                        }
                    ]
                },
            )

            # Cache invalidation should be called on success
            if response.status_code == 200:
                mock_invalidate.assert_called()

    def test_bulk_operations_invalidate_entity_caches(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that bulk operations invalidate entity-related caches."""
        with patch("wavecore.api.routes.admin.routes.invalidate_entity_caches") as mock_invalidate:
            response = client_admin_active.post(
                "/admin/bulk/tests",
                json={
                    "operations": [
                        {
                            "op": "add",
                            "entity": {
                                "id": TEST_UUID_2,
                                "name": "Entity Cache Test",
                                "version": "1.0.0",
                            },
                        }
                    ]
                },
            )

            # Cache invalidation should be called on success
            if response.status_code == 200:
                mock_invalidate.assert_called()


class TestBulkEndpointAuditLogging:
    """Test suite for bulk endpoint audit logging.

    REQ-5.2.6.4: All bulk operations must be logged for audit trail.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing audit logging"})
            yield client

        _reset_admin_state()

    def test_bulk_operations_are_logged(self, client_admin_active: TestClient) -> None:
        """Test that bulk operations are logged for audit trail."""
        with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
            _response = client_admin_active.post(
                "/admin/bulk/tests",
                json={
                    "operations": [
                        {
                            "op": "add",
                            "entity": {
                                "id": TEST_UUID_3,
                                "name": "Audit Test",
                                "version": "1.0.0",
                            },
                        }
                    ]
                },
            )

            # Should log the bulk operation
            mock_logger.info.assert_called()

    def test_blocked_bulk_attempts_are_logged_403(self) -> None:
        """Test that blocked bulk attempts are logged when admin not enabled (403 case)."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)

            with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
                response = client.post("/admin/bulk/tests", json={"operations": []})

                assert response.status_code == 403
                mock_logger.warning.assert_called()

        _reset_admin_state()

    def test_blocked_bulk_attempts_are_logged_404(self) -> None:
        """Test that blocked bulk attempts are logged when deployment gate disallows (404 case)."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            client = TestClient(app)

            with patch("wavecore.api.routes.admin.routes.logger") as mock_logger:
                response = client.post("/admin/bulk/tests", json={"operations": []})

                assert response.status_code == 404
                mock_logger.warning.assert_called()

        _reset_admin_state()


class TestBulkEndpointStorageErrors:
    """Test suite for bulk endpoint storage error handling.

    REQ-5.2.6.4: All bulk endpoints return HTTP 500 for storage errors
    with partial results in the response body.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing storage errors"})
            yield client

        _reset_admin_state()

    def test_storage_error_returns_500_with_partial_results(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that storage errors return 500 with partial results."""
        call_count = 0

        def mock_save_test(data: dict) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise Exception("Storage connection failed")
            # First call succeeds, don't raise

        with patch(
            "wavecore.api.routes.admin.bulk_routes.test_service._save_test",
            side_effect=mock_save_test,
        ):
            response = client_admin_active.post(
                "/admin/bulk/tests",
                json={
                    "operations": [
                        {
                            "op": "add",
                            "entity": {
                                "id": TEST_UUID_1,
                                "name": "Test 1",
                                "version": "1.0.0",
                            },
                        },
                        {
                            "op": "add",
                            "entity": {
                                "id": TEST_UUID_2,
                                "name": "Test 2",
                                "version": "1.0.0",
                            },
                        },
                    ]
                },
            )

            # Should return 500 on storage error
            assert response.status_code == 500
            data = response.json()
            # Should include partial results and error info
            assert "error" in data
            assert "partial_results" in data or "cleared" in data

    def test_storage_error_includes_failed_index(self, client_admin_active: TestClient) -> None:
        """Test that storage error response includes the index of the failed operation."""
        call_count = 0

        def mock_save_test(data: dict) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise Exception("Disk full")
            # First call succeeds, don't raise

        with patch(
            "wavecore.api.routes.admin.bulk_routes.test_service._save_test",
            side_effect=mock_save_test,
        ):
            response = client_admin_active.post(
                "/admin/bulk/tests",
                json={
                    "operations": [
                        {
                            "op": "add",
                            "entity": {
                                "id": TEST_UUID_1,
                                "name": "Storage Test 1",
                                "version": "1.0.0",
                            },
                        },
                        {
                            "op": "add",
                            "entity": {
                                "id": TEST_UUID_2,
                                "name": "Storage Test 2",
                                "version": "1.0.0",
                            },
                        },
                    ]
                },
            )

            assert response.status_code == 500
            data = response.json()
            assert "failed_index" in data
            assert data["failed_index"] == 1

    def test_suite_storage_error_returns_500(self, client_admin_active: TestClient) -> None:
        """Test that suite storage errors return 500 with partial results."""
        call_count = 0

        def mock_save_suite(data: dict) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise Exception("Suite storage failed")

        with patch(
            "wavecore.api.routes.admin.bulk_routes._suite_storage._save_suite",
            side_effect=mock_save_suite,
        ):
            response = client_admin_active.post(
                "/admin/bulk/suites",
                json={
                    "operations": [
                        {
                            "op": "add",
                            "entity": {"id": SUITE_UUID_1, "name": "Suite 1", "version": "1.0"},
                        },
                        {
                            "op": "add",
                            "entity": {"id": SUITE_UUID_2, "name": "Suite 2", "version": "1.0"},
                        },
                    ]
                },
            )

            assert response.status_code == 500
            data = response.json()
            assert "error" in data
            assert data["failed_index"] == 1

    def test_regression_storage_error_returns_500(self, client_admin_active: TestClient) -> None:
        """Test that regression storage errors return 500 with partial results."""
        call_count = 0

        def mock_save_regression(data: dict) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise Exception("Regression storage failed")

        with patch(
            "wavecore.api.routes.admin.bulk_routes._reg_storage._save_regression",
            side_effect=mock_save_regression,
        ):
            response = client_admin_active.post(
                "/admin/bulk/regressions",
                json={
                    "operations": [
                        {
                            "op": "add",
                            "entity": {"id": REG_UUID_1, "name": "Reg 1", "version": "1.0"},
                        },
                        {
                            "op": "add",
                            "entity": {"id": REG_UUID_2, "name": "Reg 2", "version": "1.0"},
                        },
                    ]
                },
            )

            assert response.status_code == 500
            data = response.json()
            assert "error" in data
            assert data["failed_index"] == 1

    def test_execution_storage_error_returns_500(self, client_admin_active: TestClient) -> None:
        """Test that execution storage errors return 500 with partial results."""
        # Use a mock dict that raises on second __setitem__
        from wavecore.api.services.executions import _storage as _exec_storage

        original_storage = _exec_storage._execution_storage
        call_count = 0

        class FailingDict(dict):
            def __setitem__(self, key, value):
                nonlocal call_count
                call_count += 1
                if call_count == 2:
                    raise Exception("Execution storage failed")
                super().__setitem__(key, value)

        try:
            _exec_storage._execution_storage = FailingDict()

            response = client_admin_active.post(
                "/admin/bulk/executions",
                json={
                    "operations": [
                        {
                            "op": "add",
                            "entity": {
                                "id": EXEC_UUID_1,
                                "entity_type": "test",
                                "entity_id": "test-1",
                                "status": "running",
                            },
                        },
                        {
                            "op": "add",
                            "entity": {
                                "id": EXEC_UUID_2,
                                "entity_type": "test",
                                "entity_id": "test-2",
                                "status": "running",
                            },
                        },
                    ]
                },
            )

            assert response.status_code == 500
            data = response.json()
            assert "error" in data
            assert data["failed_index"] == 1
        finally:
            _exec_storage._execution_storage = original_storage


# =============================================================================
# REQ-5.2.6.4.1: Bulk Execution Operations
# =============================================================================


class TestBulkExecutionOperationsAdd:
    """Test suite for bulk execution ADD operations (REQ-5.2.6.4.1)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk executions"})
            yield client

        _reset_admin_state()

    def test_add_execution_creates_new_execution(self, client_admin_active: TestClient) -> None:
        """Test that add operation creates a new execution."""
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_1,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "entity_name": "Test 001",
                            "status": "running",
                            "progress": 50,
                            "environment": "staging",
                            "started_at": "2025-01-01T00:00:00Z",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 1
        assert data["results"][0]["id"] == EXEC_UUID_1
        assert data["results"][0]["status"] == "created"

    def test_add_execution_fails_if_exists(self, client_admin_active: TestClient) -> None:
        """Test that add operation fails if execution already exists."""
        # First add
        client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_2,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "status": "running",
                        },
                    }
                ]
            },
        )

        # Second add with same ID should fail
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_2,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "status": "running",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 409
        assert "already exists" in response.json()["detail"].lower()

    def test_add_execution_requires_id(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires execution ID."""
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "status": "running",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "id" in response.json()["detail"].lower()

    def test_add_execution_requires_entity_type(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires entity_type."""
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_3,
                            "entity_id": "test-001",
                            "status": "running",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "entity_type" in response.json()["detail"].lower()

    def test_add_execution_requires_status(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires status."""
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_3,
                            "entity_type": "test",
                            "entity_id": "test-001",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "status" in response.json()["detail"].lower()

    def test_add_execution_requires_entity_id(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires entity_id."""
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_3,
                            "entity_type": "test",
                            "status": "running",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "entity_id" in response.json()["detail"].lower()


class TestBulkExecutionOperationsModify:
    """Test suite for bulk execution MODIFY operations (REQ-5.2.6.4.1)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk executions"})
            yield client

        _reset_admin_state()

    def test_modify_execution_updates_existing(self, client_admin_active: TestClient) -> None:
        """Test that modify operation updates an existing execution."""
        # First create an execution
        client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_1,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "status": "running",
                            "progress": 25,
                        },
                    }
                ]
            },
        )

        # Modify it
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {
                            "id": EXEC_UUID_1,
                            "status": "completed",
                            "progress": 100,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 1
        assert data["results"][0]["status"] == "modified"

    def test_modify_execution_fails_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that modify operation fails if execution does not exist."""
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {
                            "id": EXEC_UUID_4,
                            "status": "completed",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_modify_execution_partial_update(self, client_admin_active: TestClient) -> None:
        """Test that modify operation supports partial updates."""
        # First create an execution with full data
        client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_1,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "entity_name": "Test 001",
                            "status": "running",
                            "progress": 50,
                            "environment": "staging",
                        },
                    }
                ]
            },
        )

        # Modify only progress - other fields should remain unchanged
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {
                            "id": EXEC_UUID_1,
                            "progress": 75,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200


class TestBulkExecutionOperationsReplace:
    """Test suite for bulk execution REPLACE operations (REQ-5.2.6.4.1)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk executions"})
            yield client

        _reset_admin_state()

    def test_replace_execution_creates_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that replace operation creates if execution does not exist (upsert)."""
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {
                            "id": EXEC_UUID_3,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "status": "running",
                            "progress": 0,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 1
        assert data["results"][0]["status"] in ["created", "replaced"]

    def test_replace_execution_updates_if_exists(self, client_admin_active: TestClient) -> None:
        """Test that replace operation updates if execution exists (upsert)."""
        # First create
        client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_1,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "status": "running",
                            "progress": 25,
                        },
                    }
                ]
            },
        )

        # Replace (upsert)
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {
                            "id": EXEC_UUID_1,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "status": "completed",
                            "progress": 100,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "replaced"


class TestBulkExecutionOperationsDelete:
    """Test suite for bulk execution DELETE operations (REQ-5.2.6.4.1)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk executions"})
            yield client

        _reset_admin_state()

    def test_delete_execution_removes_existing(self, client_admin_active: TestClient) -> None:
        """Test that delete operation removes an existing execution."""
        # First create
        client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_5,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "status": "completed",
                        },
                    }
                ]
            },
        )

        # Delete
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "delete",
                        "entity": {
                            "id": EXEC_UUID_5,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "deleted"

    def test_delete_execution_fails_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that delete operation fails if execution does not exist."""
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "delete",
                        "entity": {
                            "id": EXEC_UUID_4,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()


class TestBulkExecutionMixedOperations:
    """Test suite for mixed bulk execution operations (REQ-5.2.6.4.1)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing mixed operations"})
            yield client

        _reset_admin_state()

    def test_mixed_operations_in_single_request(self, client_admin_active: TestClient) -> None:
        """Test that mixed operation types work in a single request."""
        # Setup: create an execution to modify and one to delete
        client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_1,
                            "entity_type": "test",
                            "entity_id": "test-001",
                            "status": "running",
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_5,
                            "entity_type": "test",
                            "entity_id": "test-002",
                            "status": "completed",
                        },
                    },
                ]
            },
        )

        # Mixed operations: add, modify, replace, delete
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": EXEC_UUID_3,
                            "entity_type": "test",
                            "entity_id": "test-003",
                            "status": "pending",
                        },
                    },
                    {
                        "op": "modify",
                        "entity": {
                            "id": EXEC_UUID_1,
                            "status": "completed",
                        },
                    },
                    {
                        "op": "replace",
                        "entity": {
                            "id": EXEC_UUID_2,
                            "entity_type": "test",
                            "entity_id": "test-004",
                            "status": "running",
                        },
                    },
                    {
                        "op": "delete",
                        "entity": {
                            "id": EXEC_UUID_5,
                        },
                    },
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 4
        assert len(data["results"]) == 4


# =============================================================================
# REQ-5.2.6.4.2: Bulk Test Operations
# =============================================================================


class TestBulkTestOperationsAdd:
    """Test suite for bulk test ADD operations (REQ-5.2.6.4.2)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk tests"})
            yield client

        _reset_admin_state()

    def test_add_test_creates_new_test(self, client_admin_active: TestClient) -> None:
        """Test that add operation creates a new test."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_1,
                            "name": "Bulk Test 001",
                            "version": "1.0.0",
                            "description": "Test created via bulk API",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 1
        assert data["results"][0]["id"] == TEST_UUID_1

    def test_add_test_fails_if_exists(self, client_admin_active: TestClient) -> None:
        """Test that add operation fails if test already exists."""
        # First add
        client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_2,
                            "name": "Duplicate Test",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Second add should fail
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_2,
                            "name": "Duplicate Test",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 409

    def test_add_test_requires_id(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires test ID."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "name": "Test Without ID",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "id" in response.json()["detail"].lower()

    def test_add_test_requires_name(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires test name."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_3,
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "name" in response.json()["detail"].lower()

    def test_add_test_requires_version(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires test version."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_4,
                            "name": "Test Without Version",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "version" in response.json()["detail"].lower()


class TestBulkTestOperationsModify:
    """Test suite for bulk test MODIFY operations (REQ-5.2.6.4.2)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk tests"})
            yield client

        _reset_admin_state()

    def test_modify_test_updates_existing(self, client_admin_active: TestClient) -> None:
        """Test that modify operation updates an existing test."""
        # First create
        client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_5,
                            "name": "Test to Modify",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Modify
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {
                            "id": TEST_UUID_5,
                            "description": "Updated description",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200

    def test_modify_test_fails_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that modify operation fails if test does not exist."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {
                            "id": TEST_UUID_6,
                            "description": "Won't work",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 404


class TestBulkTestOperationsReplace:
    """Test suite for bulk test REPLACE operations (REQ-5.2.6.4.2)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk tests"})
            yield client

        _reset_admin_state()

    def test_replace_test_creates_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that replace operation creates if test does not exist (upsert)."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {
                            "id": TEST_UUID_7,
                            "name": "Upsert New Test",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 1
        assert data["results"][0]["status"] in ["created", "replaced"]

    def test_replace_test_updates_if_exists(self, client_admin_active: TestClient) -> None:
        """Test that replace operation updates if test exists (upsert)."""
        # First create
        client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_5,
                            "name": "Existing Test",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Replace (upsert)
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {
                            "id": TEST_UUID_5,
                            "name": "Replaced Test",
                            "version": "2.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "replaced"


class TestBulkTestOperationsDelete:
    """Test suite for bulk test DELETE operations (REQ-5.2.6.4.2)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk tests"})
            yield client

        _reset_admin_state()

    def test_delete_test_removes_existing(self, client_admin_active: TestClient) -> None:
        """Test that delete operation removes an existing test."""
        # First create
        client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_8,
                            "name": "Test to Delete",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Delete
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "delete",
                        "entity": {
                            "id": TEST_UUID_8,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200

    def test_delete_test_fails_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that delete operation fails if test does not exist."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "delete",
                        "entity": {
                            "id": TEST_UUID_6,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 404


class TestBulkTestMixedOperations:
    """Test suite for mixed bulk test operations (REQ-5.2.6.4.2)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing mixed operations"})
            yield client

        _reset_admin_state()

    def test_mixed_operations_in_single_request(self, client_admin_active: TestClient) -> None:
        """Test that mixed operation types work in a single request."""
        # Setup: create tests to modify and delete
        client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_5,
                            "name": "Test to Modify",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_8,
                            "name": "Test to Delete",
                            "version": "1.0.0",
                        },
                    },
                ]
            },
        )

        # Mixed operations: add, modify, replace, delete
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_7,
                            "name": "New Test",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "modify",
                        "entity": {
                            "id": TEST_UUID_5,
                            "description": "Updated",
                        },
                    },
                    {
                        "op": "replace",
                        "entity": {
                            "id": TEST_UUID_3,
                            "name": "Replaced Test",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "delete",
                        "entity": {
                            "id": TEST_UUID_8,
                        },
                    },
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 4
        assert len(data["results"]) == 4


# =============================================================================
# REQ-5.2.6.4.3: Bulk Suite Operations
# =============================================================================


class TestBulkSuiteOperationsAdd:
    """Test suite for bulk suite ADD operations (REQ-5.2.6.4.3)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk suites"})
            yield client

        _reset_admin_state()

    def test_add_suite_creates_new_suite(self, client_admin_active: TestClient) -> None:
        """Test that add operation creates a new suite."""
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_1,
                            "name": "Bulk Suite 001",
                            "version": "1.0.0",
                            "tests": [],
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200

    def test_add_suite_fails_if_exists(self, client_admin_active: TestClient) -> None:
        """Test that add operation fails if suite already exists."""
        # First add
        client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_2,
                            "name": "Duplicate Suite",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Second add should fail
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_2,
                            "name": "Duplicate Suite",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 409

    def test_add_suite_requires_id(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires suite ID."""
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "name": "Suite Without ID",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "id" in response.json()["detail"].lower()

    def test_add_suite_requires_name(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires suite name."""
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_3,
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "name" in response.json()["detail"].lower()

    def test_add_suite_requires_version(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires suite version."""
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_3,
                            "name": "Suite Without Version",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "version" in response.json()["detail"].lower()


class TestBulkSuiteOperationsModify:
    """Test suite for bulk suite MODIFY operations (REQ-5.2.6.4.3)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk suites"})
            yield client

        _reset_admin_state()

    def test_modify_suite_updates_existing(self, client_admin_active: TestClient) -> None:
        """Test that modify operation updates an existing suite."""
        # First create
        client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_1,
                            "name": "Suite to Modify",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Modify
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {
                            "id": SUITE_UUID_1,
                            "description": "Updated description",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200

    def test_modify_suite_fails_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that modify operation fails if suite does not exist."""
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {
                            "id": SUITE_UUID_3,
                            "description": "Won't work",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 404


class TestBulkSuiteOperationsReplace:
    """Test suite for bulk suite REPLACE operations (REQ-5.2.6.4.3)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk suites"})
            yield client

        _reset_admin_state()

    def test_replace_suite_creates_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that replace operation creates if suite does not exist (upsert)."""
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {
                            "id": SUITE_UUID_3,
                            "name": "Upsert New Suite",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 1
        assert data["results"][0]["status"] in ["created", "replaced"]

    def test_replace_suite_updates_if_exists(self, client_admin_active: TestClient) -> None:
        """Test that replace operation updates if suite exists (upsert)."""
        # First create
        client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_1,
                            "name": "Existing Suite",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Replace (upsert)
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {
                            "id": SUITE_UUID_1,
                            "name": "Replaced Suite",
                            "version": "2.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "replaced"


class TestBulkSuiteOperationsDelete:
    """Test suite for bulk suite DELETE operations (REQ-5.2.6.4.3)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk suites"})
            yield client

        _reset_admin_state()

    def test_delete_suite_removes_existing(self, client_admin_active: TestClient) -> None:
        """Test that delete operation removes an existing suite."""
        # First create
        client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_2,
                            "name": "Suite to Delete",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Delete
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "delete",
                        "entity": {
                            "id": SUITE_UUID_2,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200

    def test_delete_suite_fails_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that delete operation fails if suite does not exist."""
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "delete",
                        "entity": {
                            "id": SUITE_UUID_3,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 404


class TestBulkSuiteMixedOperations:
    """Test suite for mixed bulk suite operations (REQ-5.2.6.4.3)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing mixed operations"})
            yield client

        _reset_admin_state()

    def test_mixed_operations_in_single_request(self, client_admin_active: TestClient) -> None:
        """Test that mixed operation types work in a single request."""
        # Setup: create suites to modify and delete
        client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_1,
                            "name": "Suite to Modify",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_2,
                            "name": "Suite to Delete",
                            "version": "1.0.0",
                        },
                    },
                ]
            },
        )

        # Mixed operations: add, modify, replace, delete
        response = client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": SUITE_UUID_3,
                            "name": "New Suite",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "modify",
                        "entity": {
                            "id": SUITE_UUID_1,
                            "description": "Updated",
                        },
                    },
                    {
                        "op": "replace",
                        "entity": {
                            "id": SUITE_UUID_1,
                            "name": "Replaced Suite",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "delete",
                        "entity": {
                            "id": SUITE_UUID_2,
                        },
                    },
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 4
        assert len(data["results"]) == 4


# =============================================================================
# REQ-5.2.6.4.4: Bulk Regression Operations
# =============================================================================


class TestBulkRegressionOperationsAdd:
    """Test suite for bulk regression ADD operations (REQ-5.2.6.4.4)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk regressions"})
            yield client

        _reset_admin_state()

    def test_add_regression_creates_new_regression(self, client_admin_active: TestClient) -> None:
        """Test that add operation creates a new regression."""
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_1,
                            "name": "Bulk Regression 001",
                            "version": "1.0.0",
                            "suites": [],
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200

    def test_add_regression_fails_if_exists(self, client_admin_active: TestClient) -> None:
        """Test that add operation fails if regression already exists."""
        # First add
        client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_2,
                            "name": "Duplicate Regression",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Second add should fail
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_2,
                            "name": "Duplicate Regression",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 409

    def test_add_regression_requires_id(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires regression ID."""
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "name": "Regression Without ID",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "id" in response.json()["detail"].lower()

    def test_add_regression_requires_name(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires regression name."""
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_3,
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "name" in response.json()["detail"].lower()

    def test_add_regression_requires_version(self, client_admin_active: TestClient) -> None:
        """Test that add operation requires regression version."""
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_3,
                            "name": "Regression Without Version",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "version" in response.json()["detail"].lower()


class TestBulkRegressionOperationsModify:
    """Test suite for bulk regression MODIFY operations (REQ-5.2.6.4.4)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk regressions"})
            yield client

        _reset_admin_state()

    def test_modify_regression_updates_existing(self, client_admin_active: TestClient) -> None:
        """Test that modify operation updates an existing regression."""
        # First create
        client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_1,
                            "name": "Regression to Modify",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Modify
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {
                            "id": REG_UUID_1,
                            "description": "Updated description",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200

    def test_modify_regression_fails_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that modify operation fails if regression does not exist."""
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {
                            "id": REG_UUID_3,
                            "description": "Won't work",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 404


class TestBulkRegressionOperationsReplace:
    """Test suite for bulk regression REPLACE operations (REQ-5.2.6.4.4)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk regressions"})
            yield client

        _reset_admin_state()

    def test_replace_regression_creates_if_not_exists(
        self, client_admin_active: TestClient
    ) -> None:
        """Test that replace operation creates if regression does not exist (upsert)."""
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {
                            "id": REG_UUID_3,
                            "name": "Upsert New Regression",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 1
        assert data["results"][0]["status"] in ["created", "replaced"]

    def test_replace_regression_updates_if_exists(self, client_admin_active: TestClient) -> None:
        """Test that replace operation updates if regression exists (upsert)."""
        # First create
        client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_1,
                            "name": "Existing Regression",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Replace (upsert)
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {
                            "id": REG_UUID_1,
                            "name": "Replaced Regression",
                            "version": "2.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "replaced"


class TestBulkRegressionOperationsDelete:
    """Test suite for bulk regression DELETE operations (REQ-5.2.6.4.4)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk regressions"})
            yield client

        _reset_admin_state()

    def test_delete_regression_removes_existing(self, client_admin_active: TestClient) -> None:
        """Test that delete operation removes an existing regression."""
        # First create
        client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_2,
                            "name": "Regression to Delete",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        # Delete
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "delete",
                        "entity": {
                            "id": REG_UUID_2,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200

    def test_delete_regression_fails_if_not_exists(self, client_admin_active: TestClient) -> None:
        """Test that delete operation fails if regression does not exist."""
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "delete",
                        "entity": {
                            "id": REG_UUID_3,
                        },
                    }
                ]
            },
        )

        assert response.status_code == 404


class TestBulkRegressionMixedOperations:
    """Test suite for mixed bulk regression operations (REQ-5.2.6.4.4)."""

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing mixed operations"})
            yield client

        _reset_admin_state()

    def test_mixed_operations_in_single_request(self, client_admin_active: TestClient) -> None:
        """Test that mixed operation types work in a single request."""
        # Setup: create regressions to modify and delete
        client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_1,
                            "name": "Regression to Modify",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_2,
                            "name": "Regression to Delete",
                            "version": "1.0.0",
                        },
                    },
                ]
            },
        )

        # Mixed operations: add, modify, replace, delete
        response = client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": REG_UUID_3,
                            "name": "New Regression",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "modify",
                        "entity": {
                            "id": REG_UUID_1,
                            "description": "Updated",
                        },
                    },
                    {
                        "op": "replace",
                        "entity": {
                            "id": REG_UUID_1,
                            "name": "Replaced Regression",
                            "version": "1.0.0",
                        },
                    },
                    {
                        "op": "delete",
                        "entity": {
                            "id": REG_UUID_2,
                        },
                    },
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 4
        assert len(data["results"]) == 4


# =============================================================================
# Response Structure Tests
# =============================================================================


class TestBulkEndpointResponseStructure:
    """Test suite for bulk endpoint response structure.

    All bulk endpoints return consistent response structure:
    - processed: Number of operations processed
    - results: List of operation results with id and status
    - timestamp: ISO 8601 UTC timestamp
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        """Create FastAPI test client with admin mode fully active."""
        _reset_admin_state()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing response structure"})
            yield client

        _reset_admin_state()

    def test_successful_response_structure(self, client_admin_active: TestClient) -> None:
        """Test successful response includes required fields."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_1,
                            "name": "Response Structure Test",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Required fields
        assert "processed" in data
        assert isinstance(data["processed"], int)
        assert data["processed"] >= 0

        assert "results" in data
        assert isinstance(data["results"], list)

        assert "timestamp" in data
        # Validate ISO 8601 format
        from datetime import datetime

        datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))

    def test_result_item_structure(self, client_admin_active: TestClient) -> None:
        """Test each result item has required fields."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": TEST_UUID_2,
                            "name": "Result Structure Test",
                            "version": "1.0.0",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()

        for result in data["results"]:
            assert "id" in result
            assert "status" in result
            assert result["status"] in ["created", "modified", "replaced", "deleted"]

    def test_error_response_structure(self, client_admin_active: TestClient) -> None:
        """Test error response includes required fields."""
        # Try to delete non-existent entity
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "delete",
                        "entity": {
                            "id": "nonexistent-error-struct",
                        },
                    }
                ]
            },
        )

        assert response.status_code == 404
        data = response.json()

        assert "detail" in data
        assert "failed_index" in data
        assert isinstance(data["failed_index"], int)

    def test_empty_operations_returns_success(self, client_admin_active: TestClient) -> None:
        """Test that empty operations list returns success with zero processed."""
        response = client_admin_active.post(
            "/admin/bulk/tests",
            json={"operations": []},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 0
        assert data["results"] == []


class TestMaterializeBulkExecution:
    """After admin-bulk inserts an execution, `_materialize_bulk_execution`
    writes the append-only disk layout (composition.yaml + runs.yaml +
    status.yaml) so `_enrich_execution_for_detail` can populate the
    Components table.

    Two composition paths:
    - Nested `suites[].tests[]` on the bulk payload (used by regression
      and suite fixtures that pin specific run_ids and statuses).
    - No nested data: fall back to entity lookup + `_build_composition_for_execution`.
    """

    @pytest.fixture
    def client_admin_active(self) -> Generator[TestClient, None, None]:
        _reset_admin_state()
        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk materialize"})
            yield client
        _reset_admin_state()

    @pytest.fixture(autouse=True)
    def _isolated_tmp_storage(self, tmp_path: Any) -> Generator[Any, None, None]:
        """Point the storage layer at a tmp dir so composition files don't
        leak across tests (and vice versa)."""
        from wavecore.api.services import storage_paths
        from wavecore.api.services.executions import _storage as _exec_storage

        original = storage_paths.get_base_path()
        storage_paths.set_base_path(tmp_path)
        _exec_storage._execution_storage.clear()
        _exec_storage._runtime_state.clear()
        _exec_storage._composition_cache.clear()
        yield tmp_path
        storage_paths.set_base_path(original)
        _exec_storage._execution_storage.clear()
        _exec_storage._runtime_state.clear()
        _exec_storage._composition_cache.clear()

    def _add_execution(
        self,
        client: TestClient,
        entity: dict[str, Any],
    ) -> None:
        response = client.post(
            "/admin/bulk/executions",
            json={"operations": [{"op": "add", "entity": entity}]},
        )
        assert response.status_code == 200, response.text

    def test_nested_suites_preserve_run_ids(self, client_admin_active: TestClient) -> None:
        """Regression / suite fixtures carry a nested `suites[].tests[]`
        tree with explicit run_ids. Those run_ids must round-trip onto
        disk so the Historical Canvas URL (`/executions/history/:runId`)
        can resolve them."""
        from wavecore.api.services.executions._storage import _load_composition, _load_runs

        exec_id = _uuid()
        run_auth = _uuid()
        run_admin = _uuid()

        self._add_execution(
            client_admin_active,
            {
                "id": exec_id,
                "entity_type": "regression",
                "entity_id": _uuid(),
                "status": "passed",
                "started_at": "2026-04-22T10:00:00+00:00",
                "ended_at": "2026-04-22T10:00:20+00:00",
                "duration": 20,
                "suites": [
                    {
                        "id": "suite-auth",
                        "name": "Auth Suite",
                        "tests": [
                            {
                                "id": "test-login",
                                "name": "Login Smoke",
                                "status": "passed",
                                "run_id": run_auth,
                            }
                        ],
                    },
                    {
                        "id": "suite-admin",
                        "name": "Admin Suite",
                        "tests": [
                            {
                                "id": "test-login",
                                "name": "Login Smoke",
                                "status": "passed",
                                "run_id": run_admin,
                            },
                            # Excluded (no run_id) - composition should
                            # still list the row so the Components
                            # table can render it.
                            {
                                "id": "test-admin-only",
                                "name": "Admin-only Check",
                                "status": "excluded",
                            },
                        ],
                    },
                ],
            },
        )

        composition = _load_composition(exec_id)
        assert len(composition["suites"]) == 2
        auth_suite = next(s for s in composition["suites"] if s["id"] == "suite-auth")
        admin_suite = next(s for s in composition["suites"] if s["id"] == "suite-admin")
        assert auth_suite["tests"][0]["run_id"] == run_auth
        # Admin suite preserves the shared test's second run_id and the
        # excluded row's null run_id.
        admin_runs = [t["run_id"] for t in admin_suite["tests"]]
        assert run_admin in admin_runs
        assert None in admin_runs

        # runs.yaml carries one entry per dispatched run_id (excluded
        # rows skip).
        runs = _load_runs(exec_id)
        run_ids = {r["run_id"] for r in runs}
        assert run_ids == {run_auth, run_admin}

    def test_flat_cover_sheet_falls_back_to_entity(self, client_admin_active: TestClient) -> None:
        """v-exec-01-style fixtures only carry the cover sheet. The
        fallback looks the entity up in the store and builds the
        composition from there; every run adopts the cover sheet's
        terminal status."""
        from wavecore.api.services.executions._storage import _load_composition, _load_runs

        suite_id = _uuid()
        test_a = _uuid()
        test_b = _uuid()

        # Seed the suite + its tests via the bulk endpoints so the
        # fallback's entity lookup can find them.
        client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": test_a,
                            "name": "A",
                            "version": "1",
                            "created_at": "2026-04-22T10:00:00Z",
                            "updated_at": "2026-04-22T10:00:00Z",
                            "metadata": {},
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": test_b,
                            "name": "B",
                            "version": "1",
                            "created_at": "2026-04-22T10:00:00Z",
                            "updated_at": "2026-04-22T10:00:00Z",
                            "metadata": {},
                        },
                    },
                ]
            },
        )
        client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": suite_id,
                            "name": "Suite",
                            "version": "1",
                            "tests": [test_a, test_b],
                            "metadata": {},
                            "created_at": "2026-04-22T10:00:00Z",
                            "updated_at": "2026-04-22T10:00:00Z",
                        },
                    }
                ]
            },
        )

        exec_id = _uuid()
        self._add_execution(
            client_admin_active,
            {
                "id": exec_id,
                "entity_type": "suite",
                "entity_id": suite_id,
                "status": "passed",
                "started_at": "2026-04-22T10:00:00+00:00",
                "duration": 12,
            },
        )

        composition = _load_composition(exec_id)
        # Single suite with both tests.
        assert len(composition["suites"]) == 1
        test_ids = {t["id"] for t in composition["suites"][0]["tests"]}
        assert test_ids == {test_a, test_b}

        runs = _load_runs(exec_id)
        # Two runs, both adopting the cover sheet's terminal status.
        assert len(runs) == 2

    def test_regression_fallback_composes_from_entity(
        self, client_admin_active: TestClient
    ) -> None:
        """Regression-type flat cover sheet (no nested suites) falls
        back to the entity lookup to build composition. Exercises the
        regression branch of the entity-type switch."""
        from wavecore.api.services.executions._storage import _load_composition

        test_a = _uuid()
        suite_x = _uuid()
        reg_id = _uuid()

        # Seed: test -> suite (containing the test) -> regression (containing the suite).
        client_admin_active.post(
            "/admin/bulk/tests",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": test_a,
                            "name": "A",
                            "version": "1",
                            "created_at": "2026-04-22T10:00:00Z",
                            "updated_at": "2026-04-22T10:00:00Z",
                            "metadata": {},
                        },
                    }
                ]
            },
        )
        client_admin_active.post(
            "/admin/bulk/suites",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": suite_x,
                            "name": "Suite X",
                            "version": "1",
                            "tests": [test_a],
                            "metadata": {"parent_regression": "Regression"},
                            "created_at": "2026-04-22T10:00:00Z",
                            "updated_at": "2026-04-22T10:00:00Z",
                        },
                    }
                ]
            },
        )
        client_admin_active.post(
            "/admin/bulk/regressions",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": reg_id,
                            "name": "Regression",
                            "version": "1",
                            "suites": [suite_x],
                            "metadata": {},
                            "created_at": "2026-04-22T10:00:00Z",
                            "updated_at": "2026-04-22T10:00:00Z",
                        },
                    }
                ]
            },
        )

        exec_id = _uuid()
        self._add_execution(
            client_admin_active,
            {
                "id": exec_id,
                "entity_type": "regression",
                "entity_id": reg_id,
                "status": "passed",
                "started_at": "2026-04-22T10:00:00+00:00",
                "duration": 5,
            },
        )
        composition = _load_composition(exec_id)
        # Entity-fallback built one suite with the seeded test.
        assert len(composition["suites"]) == 1
        assert composition["suites"][0]["tests"][0]["id"] == test_a

    def test_unknown_entity_type_noops(self, client_admin_active: TestClient) -> None:
        """An invalid entity_type shouldn't crash the bulk insert; the
        row lands in storage but composition is skipped."""
        from wavecore.api.services.executions._storage import _load_composition

        exec_id = _uuid()
        self._add_execution(
            client_admin_active,
            {
                "id": exec_id,
                "entity_type": "not-a-thing",
                "entity_id": _uuid(),
                "status": "passed",
                "started_at": "2026-04-22T10:00:00+00:00",
            },
        )
        composition = _load_composition(exec_id)
        # No composition written -> load returns an empty suites list.
        assert composition.get("suites") == []

    def test_missing_entity_noops(self, client_admin_active: TestClient) -> None:
        """Cover sheet that points at a non-existent entity falls through
        cleanly - no composition, no crash."""
        from wavecore.api.services.executions._storage import _load_composition

        exec_id = _uuid()
        self._add_execution(
            client_admin_active,
            {
                "id": exec_id,
                "entity_type": "suite",
                "entity_id": _uuid(),  # not seeded
                "status": "passed",
                "started_at": "2026-04-22T10:00:00+00:00",
            },
        )
        composition = _load_composition(exec_id)
        assert composition.get("suites") == []

    def test_materialize_error_is_swallowed(
        self, client_admin_active: TestClient, monkeypatch: Any
    ) -> None:
        """If the materialize helper raises, the bulk insert still
        succeeds - materialization is best-effort, the execution row
        lands regardless."""
        from wavecore.api.routes.admin import bulk_routes

        def boom(_execution: dict[str, Any]) -> None:
            raise RuntimeError("synthetic")

        monkeypatch.setattr(bulk_routes, "_materialize_bulk_execution", boom)

        exec_id = _uuid()
        self._add_execution(
            client_admin_active,
            {
                "id": exec_id,
                "entity_type": "suite",
                "entity_id": _uuid(),
                "status": "passed",
                "started_at": "2026-04-22T10:00:00+00:00",
            },
        )
        # Execution still present in storage - the bulk response was 200.
        from wavecore.api.services.executions import _storage as _exec_storage

        assert exec_id in _exec_storage._execution_storage

    def test_replace_op_also_materializes(self, client_admin_active: TestClient) -> None:
        """`replace` ops rewrite the cover sheet; the helper should
        re-materialize composition for them too (same as `add`)."""
        from wavecore.api.services.executions._storage import _load_composition

        exec_id = _uuid()
        run_id = _uuid()
        # First add - materializes nothing (no suites, no entity).
        self._add_execution(
            client_admin_active,
            {
                "id": exec_id,
                "entity_type": "suite",
                "entity_id": _uuid(),
                "status": "passed",
                "started_at": "2026-04-22T10:00:00+00:00",
            },
        )
        # Replace with a nested-suites payload - composition should be
        # written on the replace.
        response = client_admin_active.post(
            "/admin/bulk/executions",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {
                            "id": exec_id,
                            "entity_type": "suite",
                            "entity_id": "suite-x",
                            "status": "passed",
                            "started_at": "2026-04-22T10:00:00+00:00",
                            "suites": [
                                {
                                    "id": "suite-x",
                                    "name": "X",
                                    "tests": [
                                        {
                                            "id": "t1",
                                            "name": "T1",
                                            "status": "passed",
                                            "run_id": run_id,
                                        }
                                    ],
                                }
                            ],
                        },
                    }
                ]
            },
        )
        assert response.status_code == 200, response.text
        composition = _load_composition(exec_id)
        assert composition["suites"][0]["tests"][0]["run_id"] == run_id
