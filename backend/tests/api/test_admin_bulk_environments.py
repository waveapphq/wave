"""Unit tests for admin bulk environment operations (REQ-5.2.6.4.5).

This module tests the admin bulk environment endpoints providing
controlled data manipulation for E2E testing scenarios.

Test Coverage:
- Bulk add operations
- Bulk modify operations
- Bulk replace operations
- Bulk delete operations
- Error handling (not found, conflict, validation)
- Environment usage counting
"""

import os
import uuid
from collections.abc import Generator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# Pre-generated UUIDs for consistent test data
ENV_UUID_1 = "11111111-1111-1111-1111-111111111111"
ENV_UUID_2 = "22222222-2222-2222-2222-222222222222"
ENV_UUID_DUP = "33333333-3333-3333-3333-333333333333"
ENV_UUID_MOD = "44444444-4444-4444-4444-444444444444"
ENV_UUID_REP = "55555555-5555-5555-5555-555555555555"
ENV_UUID_DEL = "66666666-6666-6666-6666-666666666666"
ENV_UUID_NONEXISTENT = "99999999-9999-9999-9999-999999999999"
PROF_UUID_1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
PROF_UUID_2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
PROF_UUID_DUP = "cccccccc-cccc-cccc-cccc-cccccccccccc"
PROF_UUID_MOD = "dddddddd-dddd-dddd-dddd-dddddddddddd"
PROF_UUID_REP = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
PROF_UUID_DEL = "ffffffff-ffff-ffff-ffff-ffffffffffff"
PROF_UUID_NONEXISTENT = "00000000-0000-0000-0000-000000000000"


def _reset_admin_state() -> None:
    """Reset admin module state for test isolation."""
    from wavecore.api.routes.admin import routes as admin_routes

    admin_routes._admin_enabled = False
    admin_routes._admin_enabled_at = None
    admin_routes._admin_reason = None


def _clear_services() -> None:
    """Clear service storage for test isolation."""
    from wavecore.api.services.environments import service as environment_service
    from wavecore.api.services.profiles import _common as _profile_common

    environment_service._clear_storage()
    _profile_common._clear_storage()


class TestBulkEnvironmentsEndpoint:
    """Test suite for POST /admin/bulk/environments endpoint."""

    @pytest.fixture
    def admin_client(self) -> Generator[TestClient, None, None]:
        """Create admin-enabled test client."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            # Enable admin mode via API
            client.post("/admin/enable", json={"reason": "Testing bulk operations"})
            yield client

        _reset_admin_state()

    def test_bulk_add_environments_creates_entries(self, admin_client: TestClient) -> None:
        """Test that bulk add creates new environments."""
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": ENV_UUID_1,
                            "name": "Production",
                            "description": "Prod environment",
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": ENV_UUID_2,
                            "name": "Staging",
                        },
                    },
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 2
        assert len(data["results"]) == 2
        assert data["results"][0]["status"] == "created"
        assert data["results"][1]["status"] == "created"

    def test_bulk_add_returns_409_on_duplicate(self, admin_client: TestClient) -> None:
        """Test that bulk add returns 409 for duplicate ID."""
        # First add
        admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {"op": "add", "entity": {"id": ENV_UUID_DUP, "name": "Test"}},
                ],
            },
        )

        # Try to add again
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {"op": "add", "entity": {"id": ENV_UUID_DUP, "name": "Test2"}},
                ],
            },
        )

        assert response.status_code == 409
        data = response.json()
        assert "already exists" in data["detail"]

    def test_bulk_modify_updates_existing(self, admin_client: TestClient) -> None:
        """Test that bulk modify updates existing environments."""
        # First add
        admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {"id": ENV_UUID_MOD, "name": "Original"},
                    },
                ],
            },
        )

        # Modify
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {"id": ENV_UUID_MOD, "name": "Modified"},
                    },
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "modified"

    def test_bulk_modify_returns_404_when_not_found(self, admin_client: TestClient) -> None:
        """Test that bulk modify returns 404 for non-existent ID."""
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {
                        "op": "modify",
                        "entity": {"id": ENV_UUID_NONEXISTENT, "name": "Test"},
                    },
                ],
            },
        )

        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"]

    def test_bulk_replace_creates_or_updates(self, admin_client: TestClient) -> None:
        """Test that bulk replace creates or updates environments."""
        # Replace non-existent (creates)
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {"id": ENV_UUID_REP, "name": "New"},
                    },
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "created"

        # Replace existing (replaces)
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {
                        "op": "replace",
                        "entity": {"id": ENV_UUID_REP, "name": "Replaced"},
                    },
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "replaced"

    def test_bulk_delete_removes_entry(self, admin_client: TestClient) -> None:
        """Test that bulk delete removes environments."""
        # First add
        admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {"op": "add", "entity": {"id": ENV_UUID_DEL, "name": "ToDelete"}},
                ],
            },
        )

        # Delete
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {"op": "delete", "entity": {"id": ENV_UUID_DEL}},
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "deleted"

    def test_bulk_delete_returns_404_when_not_found(self, admin_client: TestClient) -> None:
        """Test that bulk delete returns 404 for non-existent ID."""
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {"op": "delete", "entity": {"id": ENV_UUID_NONEXISTENT}},
                ],
            },
        )

        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"]

    def test_bulk_requires_id_field(self, admin_client: TestClient) -> None:
        """Test that bulk operations require id field."""
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {"op": "add", "entity": {"name": "NoId"}},
                ],
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert "'id' is required" in data["detail"]

    def test_bulk_add_requires_name_field(self, admin_client: TestClient) -> None:
        """Test that bulk add requires name field."""
        env_uuid_noname = str(uuid.uuid4())
        response = admin_client.post(
            "/admin/bulk/environments",
            json={
                "operations": [
                    {"op": "add", "entity": {"id": env_uuid_noname}},
                ],
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert "name" in data["detail"].lower()


class TestBulkProfilesEndpoint:
    """Test suite for POST /admin/bulk/profiles endpoint."""

    @pytest.fixture
    def admin_client(self) -> Generator[TestClient, None, None]:
        """Create admin-enabled test client."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing bulk operations"})
            yield client

        _reset_admin_state()

    def test_bulk_add_profiles_creates_entries(self, admin_client: TestClient) -> None:
        """Test that bulk add creates new profiles."""
        response = admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {
                        "op": "add",
                        "entity": {
                            "id": PROF_UUID_1,
                            "name": "DB Connection",
                            "environment_id": ENV_UUID_1,
                        },
                    },
                    {
                        "op": "add",
                        "entity": {
                            "id": PROF_UUID_2,
                            "name": "API Key",
                        },
                    },
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["processed"] == 2
        assert len(data["results"]) == 2
        assert data["results"][0]["status"] == "created"

    def test_bulk_add_returns_409_on_duplicate(self, admin_client: TestClient) -> None:
        """Test that bulk add returns 409 for duplicate ID."""
        # First add
        admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "add", "entity": {"id": PROF_UUID_DUP, "name": "Test"}},
                ],
            },
        )

        # Try to add again
        response = admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "add", "entity": {"id": PROF_UUID_DUP, "name": "Test2"}},
                ],
            },
        )

        assert response.status_code == 409

    def test_bulk_modify_updates_existing(self, admin_client: TestClient) -> None:
        """Test that bulk modify updates existing profiles."""
        # First add
        admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "add", "entity": {"id": PROF_UUID_MOD, "name": "Original"}},
                ],
            },
        )

        # Modify
        response = admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "modify", "entity": {"id": PROF_UUID_MOD, "name": "Modified"}},
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "modified"

    def test_bulk_modify_returns_404_when_not_found(self, admin_client: TestClient) -> None:
        """Test that bulk modify returns 404 for non-existent ID."""
        response = admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "modify", "entity": {"id": PROF_UUID_NONEXISTENT, "name": "Test"}},
                ],
            },
        )

        assert response.status_code == 404

    def test_bulk_replace_creates_or_updates(self, admin_client: TestClient) -> None:
        """Test that bulk replace creates or updates profiles."""
        # Replace non-existent (creates)
        response = admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "replace", "entity": {"id": PROF_UUID_REP, "name": "New"}},
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "created"

        # Replace existing
        response = admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "replace", "entity": {"id": PROF_UUID_REP, "name": "Replaced"}},
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "replaced"

    def test_bulk_delete_removes_entry(self, admin_client: TestClient) -> None:
        """Test that bulk delete removes profiles."""
        # First add
        admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "add", "entity": {"id": PROF_UUID_DEL, "name": "ToDelete"}},
                ],
            },
        )

        # Delete
        response = admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "delete", "entity": {"id": PROF_UUID_DEL}},
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "deleted"

    def test_bulk_delete_returns_404_when_not_found(self, admin_client: TestClient) -> None:
        """Test that bulk delete returns 404 for non-existent ID."""
        response = admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "delete", "entity": {"id": PROF_UUID_NONEXISTENT}},
                ],
            },
        )

        assert response.status_code == 404

    def test_bulk_requires_id_field(self, admin_client: TestClient) -> None:
        """Test that bulk operations require id field."""
        response = admin_client.post(
            "/admin/bulk/profiles",
            json={
                "operations": [
                    {"op": "add", "entity": {"name": "NoId"}},
                ],
            },
        )

        assert response.status_code == 400


class TestBulkEnvironmentsSecurityAndEdgeCases:
    """Test suite for security gates and edge cases in bulk environment operations."""

    def test_bulk_environments_returns_403_when_admin_not_enabled(self) -> None:
        """Test that bulk/environments returns 403 when admin allowed but not enabled."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            # Do NOT enable admin mode

            response = client.post(
                "/admin/bulk/environments",
                json={"operations": []},
            )

            assert response.status_code == 403
            assert "Admin mode must be enabled first" in response.json()["detail"]

        _reset_admin_state()

    def test_bulk_environments_returns_404_when_deployment_gate_disallows(self) -> None:
        """Test that bulk/environments returns 404 when deployment gate disallows."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            client = TestClient(app)

            response = client.post(
                "/admin/bulk/environments",
                json={"operations": []},
            )

            assert response.status_code == 404
            assert response.json()["detail"] == "Not Found"

        _reset_admin_state()

    def test_bulk_environments_empty_operations_returns_success(self) -> None:
        """Test that empty operations list returns success with 0 processed."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing empty operations"})

            response = client.post(
                "/admin/bulk/environments",
                json={"operations": []},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["processed"] == 0
            assert data["results"] == []
            assert "timestamp" in data

        _reset_admin_state()


class TestBulkProfilesSecurityAndEdgeCases:
    """Test suite for security gates and edge cases in bulk profile operations."""

    def test_bulk_profiles_returns_403_when_admin_not_enabled(self) -> None:
        """Test that bulk/profiles returns 403 when admin allowed but not enabled."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            # Do NOT enable admin mode

            response = client.post(
                "/admin/bulk/profiles",
                json={"operations": []},
            )

            assert response.status_code == 403
            assert "Admin mode must be enabled first" in response.json()["detail"]

        _reset_admin_state()

    def test_bulk_profiles_returns_404_when_deployment_gate_disallows(self) -> None:
        """Test that bulk/profiles returns 404 when deployment gate disallows."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"}):
            from wavecore.api.app import app

            client = TestClient(app)

            response = client.post(
                "/admin/bulk/profiles",
                json={"operations": []},
            )

            assert response.status_code == 404
            assert response.json()["detail"] == "Not Found"

        _reset_admin_state()

    def test_bulk_profiles_empty_operations_returns_success(self) -> None:
        """Test that empty operations list returns success with 0 processed."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing empty operations"})

            response = client.post(
                "/admin/bulk/profiles",
                json={"operations": []},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["processed"] == 0
            assert data["results"] == []
            assert "timestamp" in data

        _reset_admin_state()


class TestBulkValidationErrors:
    """Test suite for validation errors that propagate through exception handler."""

    def test_bulk_environments_invalid_op_returns_400(self) -> None:
        """Test that invalid op type in environments returns 400."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing validation"})

            response = client.post(
                "/admin/bulk/environments",
                json={
                    "operations": [
                        {"op": "invalid_operation", "entity": {"id": ENV_UUID_1, "name": "Env 1"}},
                    ],
                },
            )

            assert response.status_code == 400
            assert "invalid op type" in response.json()["detail"]

        _reset_admin_state()

    def test_bulk_profiles_invalid_op_returns_400(self) -> None:
        """Test that invalid op type in profiles returns 400."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing validation"})

            response = client.post(
                "/admin/bulk/profiles",
                json={
                    "operations": [
                        {
                            "op": "invalid_operation",
                            "entity": {"id": PROF_UUID_1, "name": "Prof 1"},
                        },
                    ],
                },
            )

            assert response.status_code == 400
            assert "invalid op type" in response.json()["detail"]

        _reset_admin_state()


class TestBulkStorageErrorHandling:
    """Test suite for storage error handling in bulk operations."""

    def test_environment_storage_error_returns_500(self) -> None:
        """Test that environment storage errors return 500 with partial results."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app
            from wavecore.api.services.environments import service as environment_service

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing storage error"})

            # Create a dict subclass that fails on second __setitem__
            class FailingDict(dict):
                def __init__(self, *args, **kwargs):
                    super().__init__(*args, **kwargs)
                    self._call_count = 0

                def __setitem__(self, key, value):
                    self._call_count += 1
                    if self._call_count == 2:
                        raise Exception("Storage connection failed")
                    super().__setitem__(key, value)

            # Replace the storage
            original_storage = environment_service._environments
            environment_service._environments = FailingDict()

            try:
                response = client.post(
                    "/admin/bulk/environments",
                    json={
                        "operations": [
                            {"op": "add", "entity": {"id": ENV_UUID_1, "name": "Env 1"}},
                            {"op": "add", "entity": {"id": ENV_UUID_2, "name": "Env 2"}},
                        ],
                    },
                )

                assert response.status_code == 500
                data = response.json()
                assert "error" in data
                assert data["failed_index"] == 1
            finally:
                environment_service._environments = original_storage

        _reset_admin_state()

    def test_profile_storage_error_returns_500(self) -> None:
        """Test that profile storage errors return 500 with partial results."""
        _reset_admin_state()
        _clear_services()

        with patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "true"}):
            from wavecore.api.app import app
            from wavecore.api.services.profiles import _common as _profile_common

            client = TestClient(app)
            client.post("/admin/enable", json={"reason": "Testing storage error"})

            # Create a dict subclass that fails on second __setitem__
            class FailingDict(dict):
                def __init__(self, *args, **kwargs):
                    super().__init__(*args, **kwargs)
                    self._call_count = 0

                def __setitem__(self, key, value):
                    self._call_count += 1
                    if self._call_count == 2:
                        raise Exception("Storage connection failed")
                    super().__setitem__(key, value)

            # Replace the storage
            original_storage = _profile_common._profile_storage
            _profile_common._profile_storage = FailingDict()

            try:
                response = client.post(
                    "/admin/bulk/profiles",
                    json={
                        "operations": [
                            {"op": "add", "entity": {"id": PROF_UUID_1, "name": "Prof 1"}},
                            {"op": "add", "entity": {"id": PROF_UUID_2, "name": "Prof 2"}},
                        ],
                    },
                )

                assert response.status_code == 500
                data = response.json()
                assert "error" in data
                assert data["failed_index"] == 1
            finally:
                _profile_common._profile_storage = original_storage

        _reset_admin_state()


class TestEnvironmentUsageCount:
    """Test suite for environment usage counting with profiles."""

    def test_usage_count_reflects_profile_references(self) -> None:
        """Test that usage count correctly counts profile references."""
        from wavecore.api.services.environments import service as environment_service
        from wavecore.api.services.profiles import _common as _profile_common

        _reset_admin_state()
        environment_service._clear_storage()
        _profile_common._clear_storage()

        # Create environment directly in storage
        env_id = "env-for-usage"
        environment_service._environments[env_id] = {
            "id": env_id,
            "name": "Test Environment",
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        # Create profiles that reference this environment via environment_values dict
        _profile_common._profile_storage["prof-1"] = {
            "id": "prof-1",
            "name": "Profile 1",
            "type": "database",
            "environment_values": {env_id: {"host": "localhost"}},
        }
        _profile_common._profile_storage["prof-2"] = {
            "id": "prof-2",
            "name": "Profile 2",
            "type": "ssh",
            "environment_values": {env_id: {"host": "server.local"}},
        }
        _profile_common._profile_storage["prof-3"] = {
            "id": "prof-3",
            "name": "Profile 3",
            "type": "http",
            "environment_values": {"other-env": {"base_url": "http://example.com"}},
        }

        # Check usage count
        usage = environment_service._count_profile_usage(env_id)
        assert usage == 2

    def test_usage_count_returns_zero_when_no_profiles(self) -> None:
        """Test that usage count returns 0 when no profiles reference environment."""
        from wavecore.api.services.environments import service as environment_service
        from wavecore.api.services.profiles import _common as _profile_common

        _reset_admin_state()
        environment_service._clear_storage()
        _profile_common._clear_storage()

        # Create environment directly in storage
        env_id = "env-no-profiles"
        environment_service._environments[env_id] = {
            "id": env_id,
            "name": "Unused Environment",
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }

        # Check usage count
        usage = environment_service._count_profile_usage(env_id)
        assert usage == 0
