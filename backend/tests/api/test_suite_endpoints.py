"""Unit tests for suite management endpoints (REQ-5.2.4.4).

This module tests the suite management endpoints providing lifecycle operations
for test suites enabling creation, modification, version control, test composition,
ordering, and validation.

Test Coverage:
- CRUD operations: Create, Read, Update, Delete suites
- Batch operations: Create/update/delete multiple suites
- Version control: Version history tracking, semantic versioning
- Test composition: Add/remove tests, ordering management
- Variable management: Suite-level variable declarations with scoping
- Clone operations: Suite derivation through cloning
- Discovery and filtering: Search, pagination
- Error handling: Validation errors, conflicts, not found, internal errors
- Caching and performance: Multi-layer caching with TTL policies
- Concurrency control: Optimistic concurrency via ETag/If-Match headers
- Response envelope consistency: Standard {success, data, meta} format
"""

import re
import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException, ValidationException


class TestListSuitesEndpoint:
    """Test suite for GET /suites endpoint (list all suites)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_suites_returns_200_with_empty_list(self, client: TestClient) -> None:
        """Test that GET /suites returns 200 with empty list when no suites exist."""
        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/suites")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []
            assert data["pagination"]["total"] == 0
            assert data["pagination"]["page"] == 1
            assert data["pagination"]["per_page"] == 20
            assert data["pagination"]["total_pages"] == 0

    def test_list_suites_returns_200_with_suites(self, client: TestClient) -> None:
        """Test that GET /suites returns 200 with list of suites."""
        suite1_id = str(uuid.uuid4())
        suite2_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [
                    {
                        "id": suite1_id,
                        "name": "Smoke Test Suite",
                        "version": "1.0.0",
                        "description": "Basic smoke tests",
                        "tests": [],
                        "variables": {},
                        "metadata": {},
                        "created_at": now,
                        "updated_at": now,
                    },
                    {
                        "id": suite2_id,
                        "name": "Regression Suite",
                        "version": "2.1.0",
                        "description": "Full regression tests",
                        "tests": [],
                        "variables": {},
                        "metadata": {},
                        "created_at": now,
                        "updated_at": now,
                    },
                ],
                "total": 2,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/suites")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 2
            assert data["data"][0]["id"] == suite1_id
            assert data["data"][0]["name"] == "Smoke Test Suite"
            assert data["data"][1]["id"] == suite2_id
            assert data["pagination"]["total"] == 2

    def test_list_suites_supports_page_based_pagination(self, client: TestClient) -> None:
        """Test that GET /suites supports page-based pagination (REQ-5.2.4.4)."""
        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [],
                "total": 100,
                "page": 2,
                "per_page": 10,
                "total_pages": 10,
            }

            response = client.get("/suites?page=2&per_page=10")

            assert response.status_code == 200
            data = response.json()
            assert data["pagination"]["page"] == 2
            assert data["pagination"]["per_page"] == 10
            assert data["pagination"]["total"] == 100
            assert data["pagination"]["total_pages"] == 10
            mock_list.assert_called_once_with(
                page=2,
                per_page=10,
                search=None,
                status=None,
                tags=None,
                sort_by=None,
                sort_order=None,
            )

    def test_list_suites_supports_text_search(self, client: TestClient) -> None:
        """Test that GET /suites supports text search across names and descriptions."""
        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/suites?search=smoke")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search="smoke",
                status=None,
                tags=None,
                sort_by=None,
                sort_order=None,
            )

    def test_list_suites_validates_page_minimum(self, client: TestClient) -> None:
        """Test that GET /suites validates page parameter minimum value."""
        response = client.get("/suites?page=0")

        assert response.status_code == 400

    def test_list_suites_validates_per_page_maximum(self, client: TestClient) -> None:
        """Test that GET /suites validates per_page parameter maximum value."""
        response = client.get("/suites?per_page=101")

        assert response.status_code == 400

    def test_list_suites_sets_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /suites sets Cache-Control header (REQ-5.2.4.4)."""
        with patch("wavecore.api.routes.suites.routes.suite_service.list_suites") as mock_list:
            mock_list.return_value = {
                "suites": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/suites")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert "max-age=" in response.headers["Cache-Control"]


class TestCreateSuiteEndpoint:
    """Test suite for POST /suites endpoint (create new suite)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_suite_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /suites returns 201 when creating suite with valid data."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite") as mock_create:
            mock_create.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "Basic smoke tests",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/suites",
                json={
                    "name": "Smoke Test Suite",
                    "description": "Basic smoke tests",
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == suite_id
            assert data["data"]["name"] == "Smoke Test Suite"
            assert data["data"]["version"] == "1.0.0"

    def test_create_suite_requires_name_field(self, client: TestClient) -> None:
        """Test that POST /suites returns 400 when name field is missing."""
        response = client.post(
            "/suites",
            json={"description": "Some description"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(r"^Field 'name' is required$", data["error"]["message"])

    def test_create_suite_validates_name_length(self, client: TestClient) -> None:
        """Test that POST /suites validates suite name length."""
        response = client.post(
            "/suites",
            json={"name": "A" * 256},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Suite name must be between 1 and 255 characters$",
            data["error"]["message"],
        )

    def test_create_suite_validates_naming_convention(self, client: TestClient) -> None:
        """Test that POST /suites validates suite name format (REQ-5.2.4.4)."""
        response = client.post(
            "/suites",
            json={"name": "Invalid@Suite!Name"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Suite name 'Invalid@Suite!Name' violates naming convention: must contain only "
            r"alphanumeric characters, spaces, hyphens, and underscores$",
            data["error"]["message"],
        )

    def test_create_suite_returns_409_when_name_exists(self, client: TestClient) -> None:
        """Test that POST /suites returns 409 when suite name already exists."""
        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite") as mock_create:
            mock_create.side_effect = ConflictException(
                "Suite with name 'Smoke Test Suite' already exists"
            )

            response = client.post(
                "/suites",
                json={"name": "Smoke Test Suite"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Suite with name 'Smoke Test Suite' already exists$",
                data["error"]["message"],
            )

    def test_create_suite_accepts_test_references(self, client: TestClient) -> None:
        """Test that POST /suites accepts test references."""
        suite_id = str(uuid.uuid4())
        test1_id = str(uuid.uuid4())
        test2_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite") as mock_create:
            mock_create.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "",
                "tests": [test1_id, test2_id],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/suites",
                json={
                    "name": "Smoke Test Suite",
                    "tests": [test1_id, test2_id],
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert len(data["data"]["tests"]) == 2
            assert test1_id in data["data"]["tests"]
            assert test2_id in data["data"]["tests"]

    def test_create_suite_accepts_variables(self, client: TestClient) -> None:
        """Test that POST /suites accepts variable declarations."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite") as mock_create:
            mock_create.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "",
                "tests": [],
                "variables": {
                    "env": {"type": "string", "value": "staging"},
                    "timeout": {"type": "integer", "value": 60},
                },
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/suites",
                json={
                    "name": "Smoke Test Suite",
                    "variables": {
                        "env": {"type": "string", "value": "staging"},
                        "timeout": {"type": "integer", "value": 60},
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert "env" in data["data"]["variables"]
            assert "timeout" in data["data"]["variables"]

    def test_create_suite_accepts_metadata(self, client: TestClient) -> None:
        """Test that POST /suites accepts metadata."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite") as mock_create:
            mock_create.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {"author": "test-user", "priority": "high"},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/suites",
                json={
                    "name": "Smoke Test Suite",
                    "metadata": {"author": "test-user", "priority": "high"},
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["metadata"]["author"] == "test-user"
            assert data["data"]["metadata"]["priority"] == "high"

    def test_create_suite_sets_cache_invalidation_header(self, client: TestClient) -> None:
        """Test that POST /suites sets X-Cache-Invalidated header."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite") as mock_create:
            mock_create.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/suites",
                json={"name": "Smoke Test Suite"},
            )

            assert response.status_code == 201
            assert "X-Cache-Invalidated" in response.headers
            assert response.headers["X-Cache-Invalidated"] == "suites_list"

    def test_create_suite_returns_500_on_internal_error(self, client: TestClient) -> None:
        """Test that POST /suites returns 500 with request_id on internal error."""
        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite") as mock_create:
            mock_create.side_effect = RuntimeError("Database connection failed")

            response = client.post(
                "/suites",
                json={"name": "Smoke Test Suite"},
            )

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "request_id" in data["meta"]


class TestGetSuiteEndpoint:
    """Test suite for GET /suites/{suite_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_suite_returns_200_with_valid_id(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id} returns 200 with valid ID."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.get_suite") as mock_get:
            mock_get.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "Basic smoke tests",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/suites/{suite_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == suite_id
            assert data["data"]["name"] == "Smoke Test Suite"

    def test_get_suite_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id} returns 404 when suite not found."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.get_suite") as mock_get:
            mock_get.return_value = None

            response = client.get(f"/suites/{suite_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Suite with ID '{suite_id}' not found$",
                data["error"]["message"],
            )

    def test_get_suite_returns_400_with_invalid_uuid(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id} returns 400 with invalid UUID."""
        response = client.get("/suites/invalid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for suite_id: 'invalid-uuid'$",
            data["error"]["message"],
        )

    def test_get_suite_sets_etag_header(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id} sets ETag header for concurrency control."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.get_suite") as mock_get:
            mock_get.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/suites/{suite_id}")

            assert response.status_code == 200
            assert "ETag" in response.headers


class TestUpdateSuiteEndpoint:
    """Test suite for PUT /suites/{suite_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_suite_returns_200_with_valid_data(self, client: TestClient) -> None:
        """Test that PUT /suites/{suite_id} returns 200 with valid update data."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.update_suite") as mock_update:
            mock_update.return_value = {
                "id": suite_id,
                "name": "Updated Suite Name",
                "version": "1.1.0",
                "description": "Updated description",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/suites/{suite_id}",
                json={
                    "name": "Updated Suite Name",
                    "description": "Updated description",
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Updated Suite Name"
            assert data["data"]["version"] == "1.1.0"

    def test_update_suite_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PUT /suites/{suite_id} returns 404 when suite not found."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.update_suite") as mock_update:
            mock_update.return_value = None

            response = client.put(
                f"/suites/{suite_id}",
                json={"name": "Updated Suite Name"},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Suite with ID '{suite_id}' not found$",
                data["error"]["message"],
            )

    def test_update_suite_validates_name_if_provided(self, client: TestClient) -> None:
        """Test that PUT /suites/{suite_id} validates name if provided."""
        suite_id = str(uuid.uuid4())

        response = client.put(
            f"/suites/{suite_id}",
            json={"name": "Invalid@Name!"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Suite name 'Invalid@Name!' violates naming convention: must contain only "
            r"alphanumeric characters, spaces, hyphens, and underscores$",
            data["error"]["message"],
        )

    def test_update_suite_supports_optimistic_concurrency(self, client: TestClient) -> None:
        """Test that PUT /suites/{suite_id} supports If-Match header for concurrency."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.update_suite") as mock_update:
            mock_update.side_effect = ConflictException(
                "Precondition failed: resource has been modified"
            )

            response = client.put(
                f"/suites/{suite_id}",
                json={"name": "Updated Suite Name"},
                headers={"If-Match": '"old-etag"'},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "Precondition failed" in data["error"]["message"]

    def test_update_suite_sets_new_etag_header(self, client: TestClient) -> None:
        """Test that PUT /suites/{suite_id} sets new ETag header after update."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.update_suite") as mock_update:
            mock_update.return_value = {
                "id": suite_id,
                "name": "Updated Suite Name",
                "version": "1.1.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/suites/{suite_id}",
                json={"name": "Updated Suite Name"},
            )

            assert response.status_code == 200
            assert "ETag" in response.headers


class TestDeleteSuiteEndpoint:
    """Test suite for DELETE /suites/{suite_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_suite_returns_204_on_success(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id} returns 204 on successful deletion."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.delete_suite") as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/suites/{suite_id}")

            assert response.status_code == 204

    def test_delete_suite_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id} returns 404 when suite not found."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.delete_suite") as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/suites/{suite_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Suite with ID '{suite_id}' not found$",
                data["error"]["message"],
            )

    def test_delete_suite_returns_409_with_active_executions(self, client: TestClient) -> None:
        """DELETE /suites/{id} returns 409 with execution_ids in details when
        a suite-type tracked execution is running or paused."""
        suite_id = str(uuid.uuid4())
        blocking = [str(uuid.uuid4())]

        with patch("wavecore.api.routes.suites.routes.suite_service.delete_suite") as mock_delete:
            mock_delete.side_effect = ConflictException(
                "Cannot delete suite: execution is running",
                details={"execution_ids": blocking},
            )

            response = client.delete(f"/suites/{suite_id}")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"
            assert data["error"]["details"] == {"execution_ids": blocking}

    def test_delete_suite_supports_if_match_header(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id} supports If-Match header."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.get_suite") as mock_get:
            mock_get.return_value = {
                "id": suite_id,
                "name": "Suite",
                "version": "1.0.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
            with patch(
                "wavecore.api.routes.suites.routes.suite_service.delete_suite"
            ) as mock_delete:
                mock_delete.return_value = True

                response = client.delete(
                    f"/suites/{suite_id}",
                    headers={"If-Match": '"some-etag"'},
                )

                # Should either succeed or fail precondition (409 for etag mismatch)
                assert response.status_code in [204, 409]

    def test_delete_suite_returns_400_for_generic_value_error(self, client: TestClient) -> None:
        """Test that DELETE returns 400 for generic ValueError from service."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.delete_suite") as mock_delete:
            mock_delete.side_effect = ValidationException("Some generic validation error")

            response = client.delete(f"/suites/{suite_id}")

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Some generic validation error" in data["error"]["message"]


class TestBatchDeleteSuitesEndpoint:
    """Test suite for DELETE /suites/batch endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_batch_delete_suites_returns_200_with_valid_data(self, client: TestClient) -> None:
        """Test that DELETE /suites/batch returns 200 with valid data."""
        suite1_id = str(uuid.uuid4())
        suite2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.batch_routes.suite_service.batch_delete_suites"
        ) as mock_batch:
            mock_batch.return_value = {
                "deleted": [suite1_id, suite2_id],
                "failed": [],
            }

            response = client.request(
                "DELETE",
                "/suites/batch",
                json=[suite1_id, suite2_id],
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["deleted"]) == 2
            assert len(data["failed"]) == 0

    def test_batch_clone_suites_returns_200_with_valid_data(self, client: TestClient) -> None:
        """POST /suites/batch/clone clones suites and returns results."""
        suite1_id = str(uuid.uuid4())
        suite2_id = str(uuid.uuid4())
        clone1_id = str(uuid.uuid4())
        clone2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.batch_routes.suite_service.batch_clone_suites"
        ) as mock_batch:
            mock_batch.return_value = {
                "cloned": [
                    {"original_id": suite1_id, "cloned_id": clone1_id},
                    {"original_id": suite2_id, "cloned_id": clone2_id},
                ],
                "failed": [],
            }

            response = client.post(
                "/suites/batch/clone",
                json=[suite1_id, suite2_id],
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["cloned"]) == 2
        assert data["failed"] == []
        mock_batch.assert_called_once_with([suite1_id, suite2_id])


class TestListSuiteVersionsEndpoint:
    """Test suite for GET /suites/{suite_id}/versions endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_suite_versions_returns_200_with_versions(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/versions returns 200 with version list."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.list_suite_versions"
        ) as mock_list:
            mock_list.return_value = ["1.0.0", "1.1.0", "2.0.0"]

            response = client.get(f"/suites/{suite_id}/versions")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == ["1.0.0", "1.1.0", "2.0.0"]

    def test_list_suite_versions_returns_404_when_suite_not_found(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/versions returns 404 when suite not found."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.list_suite_versions"
        ) as mock_list:
            mock_list.return_value = None

            response = client.get(f"/suites/{suite_id}/versions")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Suite with ID '{suite_id}' not found$",
                data["error"]["message"],
            )


class TestAddSuiteVersionEndpoint:
    """Test suite for POST /suites/{suite_id}/versions endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_add_suite_version_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/versions returns 201 with valid data."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.add_suite_version"
        ) as mock_add:
            mock_add.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.1.0",
                "description": "Updated for new version",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/suites/{suite_id}/versions",
                json={"description": "Updated for new version"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["version"] == "1.1.0"

    def test_add_suite_version_returns_404_when_suite_not_found(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/versions returns 404 when suite not found."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.add_suite_version"
        ) as mock_add:
            mock_add.return_value = None

            response = client.post(
                f"/suites/{suite_id}/versions",
                json={"description": "New version"},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False


class TestGetSuiteVersionEndpoint:
    """Test suite for GET /suites/{suite_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_suite_version_returns_200_with_valid_version(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/versions/{version} returns 200."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.get_suite_version"
        ) as mock_get:
            mock_get.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
                "is_latest": False,
            }

            response = client.get(f"/suites/{suite_id}/versions/1.0.0")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["version"] == "1.0.0"

    def test_get_suite_version_returns_404_when_version_not_found(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/versions/{version} returns 404."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.get_suite_version"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/suites/{suite_id}/versions/9.9.9")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Suite version '9\.9\.9' not found for suite '{suite_id}'$",
                data["error"]["message"],
            )

    def test_get_suite_version_sets_long_cache_for_historical(self, client: TestClient) -> None:
        """Test that historical versions get longer cache TTL."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.get_suite_version"
        ) as mock_get:
            mock_get.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
                "is_latest": False,
            }

            response = client.get(f"/suites/{suite_id}/versions/1.0.0")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            # Historical versions should have longer cache
            assert "max-age=3600" in response.headers["Cache-Control"]


class TestUpdateSuiteVersionEndpoint:
    """Test suite for PUT /suites/{suite_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_suite_version_returns_200_with_valid_data(self, client: TestClient) -> None:
        """Test that PUT /suites/{suite_id}/versions/{version} returns 200."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.update_suite_version"
        ) as mock_update:
            mock_update.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.0.0",
                "description": "Updated description",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/suites/{suite_id}/versions/1.0.0",
                json={"description": "Updated description"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_update_suite_version_returns_409_when_published(self, client: TestClient) -> None:
        """Test that PUT returns 409 when trying to modify published version."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.update_suite_version"
        ) as mock_update:
            mock_update.side_effect = ConflictException(
                "Cannot modify published version '1.0.0'. Published versions are immutable."
            )

            response = client.put(
                f"/suites/{suite_id}/versions/1.0.0",
                json={"description": "Try to modify"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Cannot modify published version '1\.0\.0'\. Published versions are immutable\.$",
                data["error"]["message"],
            )


class TestDeleteSuiteVersionEndpoint:
    """Test suite for DELETE /suites/{suite_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_suite_version_returns_204_on_success(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id}/versions/{version} returns 204."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.delete_suite_version"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/suites/{suite_id}/versions/1.0.0")

            assert response.status_code == 204

    def test_delete_suite_version_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE returns 404 when version not found."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.delete_suite_version"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/suites/{suite_id}/versions/9.9.9")

            assert response.status_code == 404

    def test_delete_suite_version_returns_409_when_referenced(self, client: TestClient) -> None:
        """Test that DELETE returns 409 when version has regression references."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.delete_suite_version"
        ) as mock_delete:
            mock_delete.side_effect = ConflictException(
                "Cannot delete version '1.0.0': 3 regressions reference this version"
            )

            response = client.delete(f"/suites/{suite_id}/versions/1.0.0")

            assert response.status_code == 409
            data = response.json()
            assert re.match(
                r"^Cannot delete version '1\.0\.0': 3 regressions reference this version$",
                data["error"]["message"],
            )


class TestAddTestToSuiteEndpoint:
    """Test suite for POST /suites/{suite_id}/tests endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_add_test_to_suite_returns_200_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/tests returns 200 with valid data."""
        suite_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.add_test_to_suite"
        ) as mock_add:
            mock_add.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.1.0",
                "description": "",
                "tests": [test_id],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/suites/{suite_id}/tests",
                json={"test_id": test_id},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert test_id in data["data"]["tests"]

    def test_add_test_to_suite_with_order(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/tests accepts order parameter."""
        suite_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.add_test_to_suite"
        ) as mock_add:
            mock_add.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.1.0",
                "description": "",
                "tests": [test_id],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/suites/{suite_id}/tests",
                json={"test_id": test_id, "order": 0},
            )

            assert response.status_code == 200
            mock_add.assert_called_once()

    def test_add_test_to_suite_returns_400_when_test_not_found(self, client: TestClient) -> None:
        """Test that POST returns 400 when test doesn't exist."""
        suite_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.add_test_to_suite"
        ) as mock_add:
            mock_add.side_effect = ValidationException(f"Test with ID '{test_id}' not found")

            response = client.post(
                f"/suites/{suite_id}/tests",
                json={"test_id": test_id},
            )

            assert response.status_code == 400
            data = response.json()
            assert re.match(
                rf"^Test with ID '{test_id}' not found$",
                data["error"]["message"],
            )

    def test_add_test_to_suite_returns_404_when_suite_not_found(self, client: TestClient) -> None:
        """Test that POST returns 404 when suite doesn't exist."""
        suite_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.add_test_to_suite"
        ) as mock_add:
            mock_add.return_value = None

            response = client.post(
                f"/suites/{suite_id}/tests",
                json={"test_id": test_id},
            )

            assert response.status_code == 404

    def test_add_test_to_suite_requires_test_id(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/tests requires test_id field."""
        suite_id = str(uuid.uuid4())

        response = client.post(
            f"/suites/{suite_id}/tests",
            json={"order": 0},
        )

        assert response.status_code == 400
        data = response.json()
        assert re.match(
            r"^Field 'test_id' is required$",
            data["error"]["message"],
        )


class TestRemoveTestFromSuiteEndpoint:
    """Test suite for DELETE /suites/{suite_id}/tests/{test_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_remove_test_from_suite_returns_200_on_success(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id}/tests/{test_id} returns 200."""
        suite_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.remove_test_from_suite"
        ) as mock_remove:
            mock_remove.return_value = {
                "id": suite_id,
                "name": "Smoke Test Suite",
                "version": "1.2.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.delete(f"/suites/{suite_id}/tests/{test_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_remove_test_from_suite_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE returns 404 when test not in suite."""
        suite_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.remove_test_from_suite"
        ) as mock_remove:
            mock_remove.return_value = None

            response = client.delete(f"/suites/{suite_id}/tests/{test_id}")

            assert response.status_code == 404


class TestCloneSuiteEndpoint:
    """Test suite for POST /suites/{suite_id}/clone endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_clone_suite_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/clone returns 201 with valid data."""
        source_id = str(uuid.uuid4())
        clone_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.clone_suite"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": clone_id,
                "name": "Cloned Suite",
                "version": "1.0.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {"cloned_from": source_id},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/suites/{source_id}/clone",
                json={"new_name": "Cloned Suite"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == clone_id
            assert data["data"]["metadata"]["cloned_from"] == source_id

    def test_clone_suite_with_new_version(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/clone accepts new_version parameter."""
        source_id = str(uuid.uuid4())
        clone_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.clone_suite"
        ) as mock_clone:
            mock_clone.return_value = {
                "id": clone_id,
                "name": "Cloned Suite",
                "version": "2.0.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {"cloned_from": source_id},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/suites/{source_id}/clone",
                json={"new_name": "Cloned Suite", "new_version": "2.0.0"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["version"] == "2.0.0"

    def test_clone_suite_returns_404_when_source_not_found(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/clone returns 404 when source not found."""
        source_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.clone_suite"
        ) as mock_clone:
            mock_clone.return_value = None

            response = client.post(
                f"/suites/{source_id}/clone",
                json={"new_name": "Cloned Suite"},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_clone_suite_requires_new_name_field(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/clone requires new_name field."""
        source_id = str(uuid.uuid4())

        response = client.post(
            f"/suites/{source_id}/clone",
            json={},
        )

        assert response.status_code == 400
        data = response.json()
        assert re.match(
            r"^Field 'new_name' is required$",
            data["error"]["message"],
        )

    def test_clone_suite_validates_new_version_format(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/clone validates new_version format."""
        source_id = str(uuid.uuid4())

        response = client.post(
            f"/suites/{source_id}/clone",
            json={"new_name": "Cloned Suite", "new_version": "invalid"},
        )

        assert response.status_code == 400
        data = response.json()
        assert re.match(
            r"^Version 'invalid' does not follow semantic versioning format \(x\.y\.z\)$",
            data["error"]["message"],
        )


class TestSuiteVariablesEndpoint:
    """Test suite for suite variables endpoints (REQ-5.2.4.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_suite_variables_returns_200(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/variables returns 200."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.composition_routes.suite_service.get_suite_variables"
        ) as mock_get:
            mock_get.return_value = {
                "env": {"type": "string", "value": "staging"},
                "timeout": {"type": "integer", "value": 60},
            }

            response = client.get(f"/suites/{suite_id}/variables")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "env" in data["data"]
            assert "timeout" in data["data"]

    def test_get_suite_variables_returns_404_when_suite_not_found(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/variables returns 404 for missing suite."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.composition_routes.suite_service.get_suite_variables"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/suites/{suite_id}/variables")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Suite with ID '{suite_id}' not found$",
                data["error"]["message"],
            )

    def test_get_suite_variables_includes_secret_indicator(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/variables indicates secret variables."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.composition_routes.suite_service.get_suite_variables"
        ) as mock_get:
            mock_get.return_value = {
                "api_key": {"type": "string", "secret": True, "value": "***"},
                "env": {"type": "string", "secret": False, "value": "staging"},
            }

            response = client.get(f"/suites/{suite_id}/variables")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["api_key"]["secret"] is True
            assert data["data"]["env"]["secret"] is False

    def test_put_suite_variables_returns_200_and_delegates_to_update_suite(
        self, client: TestClient
    ) -> None:
        """PUT /suites/{id}/variables replaces the variable map via update_suite."""
        suite_id = str(uuid.uuid4())
        payload = {
            "timeout": {"type": "integer", "value": 30},
            "env": {"type": "string", "value": "staging"},
        }

        with patch(
            "wavecore.api.routes.suites.composition_routes.suite_service.update_suite"
        ) as mock_update:
            mock_update.return_value = {
                "id": suite_id,
                "name": "S",
                "variables": payload,
            }

            response = client.put(f"/suites/{suite_id}/variables", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["variables"] == payload
        mock_update.assert_called_once_with(suite_id, {"variables": payload})

    def test_put_suite_variables_returns_404_when_suite_not_found(self, client: TestClient) -> None:
        """PUT /suites/{id}/variables returns 404 when update_suite returns None."""
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.composition_routes.suite_service.update_suite"
        ) as mock_update:
            mock_update.return_value = None

            response = client.put(
                f"/suites/{suite_id}/variables",
                json={"timeout": {"type": "integer", "value": 30}},
            )

        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert suite_id in data["error"]["message"]

    def test_put_suite_variables_rejects_invalid_variable_type(self, client: TestClient) -> None:
        """PUT /suites/{id}/variables rejects bodies that fail variable type validation."""
        suite_id = str(uuid.uuid4())

        # An unknown variable type should be rejected by validate_variable_types
        response = client.put(
            f"/suites/{suite_id}/variables",
            json={"bad_var": {"type": "not-a-real-type", "value": 0}},
        )

        assert response.status_code == 400


class TestUpdateSuiteCacheInvalidation:
    """Test suite for cache invalidation on update operations (REQ-5.2.4.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_suite_sets_cache_invalidation_header(self, client: TestClient) -> None:
        """Test that PUT /suites/{suite_id} sets X-Cache-Invalidated header."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.update_suite") as mock_update:
            mock_update.return_value = {
                "id": suite_id,
                "name": "Updated Suite",
                "version": "1.1.0",
                "description": "",
                "tests": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/suites/{suite_id}",
                json={"name": "Updated Suite"},
            )

            assert response.status_code == 200
            assert "X-Cache-Invalidated" in response.headers
            assert f"suite_{suite_id}" in response.headers["X-Cache-Invalidated"]

    def test_delete_suite_sets_cache_invalidation_header(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id} sets X-Cache-Invalidated header."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.delete_suite") as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/suites/{suite_id}")

            assert response.status_code == 204
            assert "X-Cache-Invalidated" in response.headers
            assert "suites_list" in response.headers["X-Cache-Invalidated"]


class TestUpdateSuiteNamingConflict:
    """Test suite for naming uniqueness on update operations (REQ-5.2.4.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_suite_returns_409_when_name_conflicts(self, client: TestClient) -> None:
        """Test that PUT /suites/{suite_id} returns 409 when name already exists."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.suites.routes.suite_service.update_suite") as mock_update:
            mock_update.side_effect = ConflictException(
                "Suite with name 'Existing Suite' already exists"
            )

            response = client.put(
                f"/suites/{suite_id}",
                json={"name": "Existing Suite"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Suite with name 'Existing Suite' already exists$",
                data["error"]["message"],
            )


class TestComputedVariableValidation:
    """Test suite for computed variable expression validation (REQ-5.2.4.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_suite_validates_computed_variable_expression(self, client: TestClient) -> None:
        """Test that POST /suites validates computed variable expressions."""
        response = client.post(
            "/suites",
            json={
                "name": "Suite with Computed Vars",
                "variables": {
                    "computed_value": {
                        "type": "string",
                        "computed": True,
                        "expression": "invalid {{ syntax",
                    },
                },
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid expression syntax for computed variable 'computed_value': unclosed template "
            r"tag$",
            data["error"]["message"],
        )

    def test_create_suite_accepts_valid_computed_variable(self, client: TestClient) -> None:
        """Test that POST /suites accepts valid computed variable expressions."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite") as mock_create:
            mock_create.return_value = {
                "id": suite_id,
                "name": "Suite with Computed Vars",
                "version": "1.0.0",
                "description": "",
                "tests": [],
                "variables": {
                    "base_url": {"type": "string", "value": "http://api.example.com"},
                    "full_url": {
                        "type": "string",
                        "computed": True,
                        "expression": "{{ base_url }}/v1",
                    },
                },
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/suites",
                json={
                    "name": "Suite with Computed Vars",
                    "variables": {
                        "base_url": {"type": "string", "value": "http://api.example.com"},
                        "full_url": {
                            "type": "string",
                            "computed": True,
                            "expression": "{{ base_url }}/v1",
                        },
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["variables"]["full_url"]["computed"] is True


class TestSuiteEndpointInvalidUUIDErrors:
    """Test invalid UUID error handling across suite endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_suite_versions_with_invalid_uuid(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/versions returns 400 for invalid UUID."""
        response = client.get("/suites/not-a-valid-uuid/versions")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_add_suite_version_with_invalid_uuid(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/versions returns 400 for invalid UUID."""
        response = client.post(
            "/suites/not-a-valid-uuid/versions", json={"description": "New version"}
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_get_suite_version_with_invalid_uuid(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/versions/{version} returns 400 for invalid UUID."""
        response = client.get("/suites/not-a-valid-uuid/versions/1.0.0")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_update_suite_version_with_invalid_uuid(self, client: TestClient) -> None:
        """Test that PUT /suites/{suite_id}/versions/{version} returns 400 for invalid UUID."""
        response = client.put(
            "/suites/not-a-valid-uuid/versions/1.0.0", json={"description": "Updated"}
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_delete_suite_version_with_invalid_uuid(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id}/versions/{version} returns 400 for invalid UUID."""
        response = client.delete("/suites/not-a-valid-uuid/versions/1.0.0")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_add_test_to_suite_with_invalid_uuid(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/tests returns 400 for invalid UUID."""
        response = client.post(
            "/suites/not-a-valid-uuid/tests", json={"test_id": str(uuid.uuid4())}
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_remove_test_with_invalid_suite_uuid(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id}/tests/{test_id} returns 400 for invalid suite
        UUID.
        """
        test_id = str(uuid.uuid4())
        response = client.delete(f"/suites/not-a-valid-uuid/tests/{test_id}")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_remove_test_with_invalid_test_uuid(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id}/tests/{test_id} returns 400 for invalid test UUID."""
        suite_id = str(uuid.uuid4())
        response = client.delete(f"/suites/{suite_id}/tests/not-a-valid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_get_suite_variables_with_invalid_uuid(self, client: TestClient) -> None:
        """Test that GET /suites/{suite_id}/variables returns 400 for invalid UUID."""
        response = client.get("/suites/not-a-valid-uuid/variables")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_clone_suite_with_invalid_uuid(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/clone returns 400 for invalid UUID."""
        response = client.post("/suites/not-a-valid-uuid/clone", json={"new_name": "Clone"})

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_delete_suite_with_invalid_uuid_returns_404(self, client: TestClient) -> None:
        """Test that DELETE /suites/{suite_id} returns 404 for invalid UUID (not found)."""
        # Delete skips UUID validation so invalid IDs can be cleaned up; unknown IDs get 404.
        response = client.delete("/suites/not-a-valid-uuid")

        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert "not found" in data["error"]["message"].lower()


class TestSuiteEndpointVersionCaching:
    """Test version-specific caching behavior."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_latest_version_sets_short_cache(self, client: TestClient) -> None:
        """Test that getting latest version sets short cache TTL."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.get_suite_version"
        ) as mock_get:
            mock_get.return_value = {
                "id": suite_id,
                "name": "Test Suite",
                "version": "1.0.0",
                "is_latest": True,
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/suites/{suite_id}/versions/1.0.0")

            assert response.status_code == 200
            assert response.headers.get("Cache-Control") == "max-age=60"

    def test_get_historical_version_sets_long_cache(self, client: TestClient) -> None:
        """Test that getting historical version sets long cache TTL."""
        suite_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.get_suite_version"
        ) as mock_get:
            mock_get.return_value = {
                "id": suite_id,
                "name": "Test Suite",
                "version": "1.0.0",
                "is_latest": False,
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/suites/{suite_id}/versions/1.0.0")

            assert response.status_code == 200
            assert response.headers.get("Cache-Control") == "max-age=3600"


class TestUpdateSuiteVersionNotFound:
    """Test update suite version 404 cases."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_suite_version_returns_404_when_version_not_found(
        self, client: TestClient
    ) -> None:
        """Test that PUT /suites/{suite_id}/versions/{version} returns 404 when version not
        found.
        """
        suite_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.version_routes._suite_version_svc.update_suite_version"
        ) as mock_update:
            mock_update.return_value = None

            response = client.put(
                f"/suites/{suite_id}/versions/9.9.9", json={"description": "Updated"}
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "NOT_FOUND"


class TestAddTestToSuiteCollisionEndpoint:
    """Test 409 collision response on POST /suites/{suite_id}/tests."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_add_test_returns_409_on_variable_type_collision(self, client: TestClient) -> None:
        """Test that POST /suites/{suite_id}/tests returns 409 on variable collision."""
        suite_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.suites.composition_routes._suite_version_svc.add_test_to_suite"
        ) as mock_add:
            mock_add.side_effect = ConflictException(
                "Variable type collision: variable 'env' is 'string' here but 'integer' in suite "
                "'Other'",
                details={
                    "collisions": [
                        {
                            "variable": "env",
                            "this_type": "string",
                            "other_suite": "Other",
                            "other_suite_id": "other-id",
                            "other_type": "integer",
                        }
                    ]
                },
            )

            response = client.post(
                f"/suites/{suite_id}/tests",
                json={"test_id": test_id},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"
            assert "Variable type collision" in data["error"]["message"]


class TestListSuiteTagsEndpoint:
    """Test suite for GET /suites/tags endpoint (REQ-9.5.3.2)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_tags_returns_200_with_unique_tags(self, client: TestClient) -> None:
        """Test that GET /suites/tags returns 200 with all unique tags."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = [
                "api",
                "e2e",
                "integration",
                "smoke",
                "unit",
            ]

            response = client.get("/suites/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == ["api", "e2e", "integration", "smoke", "unit"]
            mock_list_tags.assert_called_once()

    def test_list_tags_returns_200_with_empty_array_when_no_tags(self, client: TestClient) -> None:
        """Test that GET /suites/tags returns 200 with empty array when no tags exist."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = []

            response = client.get("/suites/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_tags_returns_sorted_tags(self, client: TestClient) -> None:
        """Test that GET /suites/tags returns tags in alphabetical order."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_all_tags"
        ) as mock_list_tags:
            # Service returns sorted tags
            mock_list_tags.return_value = ["alpha", "beta", "gamma", "zeta"]

            response = client.get("/suites/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["data"] == ["alpha", "beta", "gamma", "zeta"]

    def test_list_tags_includes_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /suites/tags includes Cache-Control header."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = ["tag1", "tag2"]

            response = client.get("/suites/tags")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert response.headers["Cache-Control"] == "max-age=60"

    def test_list_tags_includes_meta_in_response(self, client: TestClient) -> None:
        """Test that GET /suites/tags includes meta information in response."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = ["tag1"]

            response = client.get("/suites/tags")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]


class TestListSuiteNamesEndpoint:
    """Test suite for GET /suites/names endpoint (REQ-9.5.3.5)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_names_returns_200_with_all_suites(self, client: TestClient) -> None:
        """Test that GET /suites/names returns 200 with all suites."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_suite_names"
        ) as mock_list_names:
            mock_list_names.return_value = [
                {"id": "suite-1", "name": "Alpha Suite"},
                {"id": "suite-2", "name": "Beta Suite"},
                {"id": "suite-3", "name": "Gamma Suite"},
            ]

            response = client.get("/suites/names")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 3
            assert data["data"][0]["name"] == "Alpha Suite"
            assert data["data"][1]["name"] == "Beta Suite"
            assert data["data"][2]["name"] == "Gamma Suite"
            mock_list_names.assert_called_once()

    def test_list_names_returns_only_id_and_name(self, client: TestClient) -> None:
        """Test that GET /suites/names returns only id and name fields."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_suite_names"
        ) as mock_list_names:
            mock_list_names.return_value = [
                {"id": "suite-1", "name": "Smoke Tests"},
            ]

            response = client.get("/suites/names")

            assert response.status_code == 200
            data = response.json()
            suite = data["data"][0]
            assert set(suite.keys()) == {"id", "name"}

    def test_list_names_returns_200_with_empty_array_when_no_suites(
        self, client: TestClient
    ) -> None:
        """Test that GET /suites/names returns 200 with empty array when no suites."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_suite_names"
        ) as mock_list_names:
            mock_list_names.return_value = []

            response = client.get("/suites/names")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_names_includes_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /suites/names includes Cache-Control header."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_suite_names"
        ) as mock_list_names:
            mock_list_names.return_value = [
                {"id": "suite-1", "name": "Test Suite"},
            ]

            response = client.get("/suites/names")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert response.headers["Cache-Control"] == "max-age=60"

    def test_list_names_includes_meta_in_response(self, client: TestClient) -> None:
        """Test that GET /suites/names includes meta information in response."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_suite_names"
        ) as mock_list_names:
            mock_list_names.return_value = []

            response = client.get("/suites/names")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]

    def test_list_names_does_not_include_pagination(self, client: TestClient) -> None:
        """Test that GET /suites/names does not include pagination metadata."""
        with patch(
            "wavecore.api.routes.suites.routes.suite_service.list_suite_names"
        ) as mock_list_names:
            mock_list_names.return_value = [
                {"id": "suite-1", "name": "Suite A"},
                {"id": "suite-2", "name": "Suite B"},
            ]

            response = client.get("/suites/names")

            assert response.status_code == 200
            data = response.json()
            assert "pagination" not in data


class TestSuiteNumbersAreStoredInWireForm:
    """REQ-3.1.3.14: a Suite save stores each typed number a REST client sends in wire form."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_and_a_variables_put_store_numbers_in_wire_form(
        self, client: TestClient
    ) -> None:
        from tests.api.wire_number_cases import SENT_VARIABLES, STORED_VARIABLES

        response = client.post(
            "/suites", json={"name": "Wire Numbers", "variables": SENT_VARIABLES}
        )
        assert response.status_code == 201, response.text
        created = response.json()["data"]
        suite_id = created["id"]

        assert created["variables"] == STORED_VARIABLES
        assert client.get(f"/suites/{suite_id}").json()["data"]["variables"] == STORED_VARIABLES

        put = client.put(
            f"/suites/{suite_id}/variables", json={"small": {"type": "float", "value": 0.00001}}
        )
        assert put.status_code == 200, put.text
        assert client.get(f"/suites/{suite_id}").json()["data"]["variables"] == {
            "small": {"type": "float", "value": "0.00001"}
        }


class TestASuiteBodyThatIsNotAJsonObject:
    """A Suite write whose body is not a JSON object is a bad request and writes nothing."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    BODIES = [
        pytest.param('"name"', "The request body must be a JSON object", id="string"),
        pytest.param("[1, 2]", "The request body must be a JSON object", id="list"),
        pytest.param("{not json", "The request body is not valid JSON", id="not-json"),
    ]

    @pytest.mark.parametrize(("text", "message"), BODIES)
    def test_a_create_is_refused(self, client: TestClient, text: str, message: str) -> None:
        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite") as create:
            response = client.post(
                "/suites", content=text, headers={"content-type": "application/json"}
            )

        assert response.status_code == 400, response.json()
        assert response.json()["error"]["message"] == message
        create.assert_not_called()

    @pytest.mark.parametrize(("text", "message"), BODIES)
    def test_an_update_is_refused(self, client: TestClient, text: str, message: str) -> None:
        with patch("wavecore.api.routes.suites.routes.suite_service.update_suite") as update:
            response = client.put(
                f"/suites/{uuid.uuid4()}",
                content=text,
                headers={"content-type": "application/json"},
            )

        assert response.status_code == 400, response.json()
        assert response.json()["error"]["message"] == message
        update.assert_not_called()
