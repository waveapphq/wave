"""Unit tests for regression suite endpoints (REQ-5.2.4.5).

This module tests the regression suite endpoints providing lifecycle operations
for regressions enabling creation, modification, version control, suite composition,
ordering, and validation.

Test Coverage:
- CRUD operations: Create, Read, Update, Delete regressions
- Version control: Version history tracking, semantic versioning
- Suite composition: Add/remove suites, ordering management
- Variable management: Regression-level variable declarations with scoping
- Discovery and filtering: Search, pagination
- Error handling: Validation errors, conflicts, not found, internal errors
- Caching and performance: Multi-layer caching with TTL policies
- Concurrency control: Optimistic concurrency via ETag/If-Match headers
- Response envelope consistency: Standard {success, data, meta} format
- Active execution reference checking: Prevent deletion with active executions
"""

import re
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.api.body_shape_support import (
    NOT_AN_ID_ITEM,
    NOT_ARRAY_BODIES,
    NOT_ID_ITEMS,
    NOT_OBJECT_BODIES,
    assert_refused,
    send_text,
)
from tests.api.error_reply_support import assert_error_reply, assert_internal_error
from wavecore.api.exceptions import ConflictException, ValidationException


class TestListRegressionsEndpoint:
    """Test suite for GET /regressions endpoint (list all regressions)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_regressions_returns_200_with_empty_list(self, client: TestClient) -> None:
        """Test that GET /regressions returns 200 with empty list when none exist."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []
            assert data["pagination"]["total"] == 0
            assert data["pagination"]["page"] == 1
            assert data["pagination"]["per_page"] == 20
            assert data["pagination"]["total_pages"] == 0

    def test_list_regressions_returns_200_with_regressions(self, client: TestClient) -> None:
        """Test that GET /regressions returns 200 with list of regressions."""
        regression1_id = str(uuid.uuid4())
        regression2_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [
                    {
                        "id": regression1_id,
                        "name": "Nightly Regression",
                        "version": "1.0.0",
                        "description": "Nightly regression test campaign",
                        "suites": [],
                        "variables": {},
                        "metadata": {},
                        "created_at": now,
                        "updated_at": now,
                    },
                    {
                        "id": regression2_id,
                        "name": "Release Regression",
                        "version": "2.1.0",
                        "description": "Full release regression tests",
                        "suites": [],
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

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 2
            assert data["data"][0]["id"] == regression1_id
            assert data["data"][0]["name"] == "Nightly Regression"
            assert data["data"][1]["id"] == regression2_id
            assert data["pagination"]["total"] == 2

    def test_list_regressions_supports_page_based_pagination(self, client: TestClient) -> None:
        """Test that GET /regressions supports page-based pagination (REQ-5.2.4.5)."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 100,
                "page": 2,
                "per_page": 10,
                "total_pages": 10,
            }

            response = client.get("/regressions?page=2&per_page=10")

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
                sort_direction=None,
            )

    def test_list_regressions_supports_text_search(self, client: TestClient) -> None:
        """Test that GET /regressions supports text search across names and descriptions."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions?search=nightly")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search="nightly",
                status=None,
                tags=None,
                sort_by=None,
                sort_direction=None,
            )

    def test_list_regressions_validates_page_minimum(self, client: TestClient) -> None:
        """Test that GET /regressions validates page parameter minimum value."""
        response = client.get("/regressions?page=0")

        assert response.status_code == 400

    def test_list_regressions_validates_per_page_maximum(self, client: TestClient) -> None:
        """Test that GET /regressions validates per_page parameter maximum value."""
        response = client.get("/regressions?per_page=101")

        assert response.status_code == 400

    def test_list_regressions_sets_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /regressions sets Cache-Control header (REQ-5.2.4.5)."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert "max-age=" in response.headers["Cache-Control"]


class TestCreateRegressionEndpoint:
    """Test suite for POST /regressions endpoint (create new regression)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_regression_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /regressions returns 201 when creating with valid data."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "Nightly regression test campaign",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/regressions",
                json={
                    "name": "Nightly Regression",
                    "description": "Nightly regression test campaign",
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == regression_id
            assert data["data"]["name"] == "Nightly Regression"
            assert data["data"]["version"] == "1.0.0"

    def test_create_regression_requires_name_field(self, client: TestClient) -> None:
        """Test that POST /regressions returns 400 when name field is missing."""
        response = client.post(
            "/regressions",
            json={"description": "Some description"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(r"^Field 'name' is required$", data["error"]["message"])

    def test_create_regression_validates_name_length(self, client: TestClient) -> None:
        """Test that POST /regressions validates regression name length."""
        response = client.post(
            "/regressions",
            json={"name": "A" * 256},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Regression name must be between 1 and 255 characters$",
            data["error"]["message"],
        )

    def test_create_regression_validates_naming_convention(self, client: TestClient) -> None:
        """Test that POST /regressions validates regression name format (REQ-5.2.4.5)."""
        response = client.post(
            "/regressions",
            json={"name": "Invalid@Regression!Name"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Regression name 'Invalid@Regression!Name' violates naming convention: must contain "
            r"only alphanumeric characters, spaces, hyphens, underscores, periods, and "
            r"parentheses$",
            data["error"]["message"],
        )

    def test_create_regression_returns_409_when_name_exists(self, client: TestClient) -> None:
        """Test that POST /regressions returns 409 when regression name already exists."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.side_effect = ConflictException(
                "Regression with name 'Nightly Regression' already exists"
            )

            response = client.post(
                "/regressions",
                json={"name": "Nightly Regression"},
            )

            assert_error_reply(
                response,
                409,
                "CONFLICT",
                "Regression with name 'Nightly Regression' already exists",
            )

    def test_create_regression_accepts_suite_references(self, client: TestClient) -> None:
        """Test that POST /regressions accepts suite references with ordering."""
        regression_id = str(uuid.uuid4())
        suite1_id = str(uuid.uuid4())
        suite2_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [suite1_id, suite2_id],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/regressions",
                json={
                    "name": "Nightly Regression",
                    "suites": [suite1_id, suite2_id],
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert len(data["data"]["suites"]) == 2
            assert suite1_id in data["data"]["suites"]
            assert suite2_id in data["data"]["suites"]

    def test_create_regression_accepts_variables(self, client: TestClient) -> None:
        """Test that POST /regressions accepts variable declarations."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {
                    "env": {"type": "string", "default": "staging"},
                    "timeout": {"type": "integer", "default": 60},
                },
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/regressions",
                json={
                    "name": "Nightly Regression",
                    "variables": {
                        "env": {"type": "string", "default": "staging"},
                        "timeout": {"type": "integer", "default": 60},
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert "env" in data["data"]["variables"]
            assert "timeout" in data["data"]["variables"]

    def test_create_regression_accepts_metadata(self, client: TestClient) -> None:
        """Test that POST /regressions accepts metadata."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {"author": "test-user", "priority": "high"},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/regressions",
                json={
                    "name": "Nightly Regression",
                    "metadata": {"author": "test-user", "priority": "high"},
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["metadata"]["author"] == "test-user"
            assert data["data"]["metadata"]["priority"] == "high"

    def test_create_regression_sets_cache_invalidation_header(self, client: TestClient) -> None:
        """Test that POST /regressions sets X-Cache-Invalidated header."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/regressions",
                json={"name": "Nightly Regression"},
            )

            assert response.status_code == 201
            assert "X-Cache-Invalidated" in response.headers
            assert response.headers["X-Cache-Invalidated"] == "regressions_list"

    def test_create_regression_returns_500_on_internal_error(self, client: TestClient) -> None:
        """Test that POST /regressions returns the generic 500 with a request id."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.side_effect = RuntimeError("Database connection failed")

            response = client.post(
                "/regressions",
                json={"name": "Nightly Regression"},
            )

            assert_internal_error(response, "Database connection failed")


class TestGetRegressionEndpoint:
    """Test suite for GET /regressions/{regression_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_regression_returns_200_with_valid_id(self, client: TestClient) -> None:
        """Test that GET /regressions/{regression_id} returns 200 with valid ID."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.get_regression"
        ) as mock_get:
            mock_get.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "Nightly regression test campaign",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/regressions/{regression_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == regression_id
            assert data["data"]["name"] == "Nightly Regression"

    def test_get_regression_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /regressions/{regression_id} returns 404 when not found."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.get_regression"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/regressions/{regression_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "NOT_FOUND"

    def test_get_regression_returns_400_for_invalid_uuid(self, client: TestClient) -> None:
        """Test that GET /regressions/{regression_id} returns 400 for invalid UUID."""
        response = client.get("/regressions/not-a-valid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for regression_id: 'not-a-valid-uuid'$",
            data["error"]["message"],
        )

    def test_get_regression_sets_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /regressions/{regression_id} sets Cache-Control header."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.get_regression"
        ) as mock_get:
            mock_get.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/regressions/{regression_id}")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers

    def test_get_regression_returns_etag_header(self, client: TestClient) -> None:
        """Test that GET /regressions/{regression_id} returns ETag header."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.get_regression"
        ) as mock_get:
            mock_get.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/regressions/{regression_id}")

            assert response.status_code == 200
            assert "ETag" in response.headers


class TestUpdateRegressionEndpoint:
    """Test suite for PUT /regressions/{regression_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_regression_returns_200_with_valid_data(self, client: TestClient) -> None:
        """Test that PUT /regressions/{regression_id} returns 200 with valid data."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.update_regression"
        ) as mock_update:
            mock_update.return_value = {
                "id": regression_id,
                "name": "Updated Regression",
                "version": "1.1.0",
                "description": "Updated description",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/regressions/{regression_id}",
                json={
                    "name": "Updated Regression",
                    "description": "Updated description",
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Updated Regression"
            assert data["data"]["version"] == "1.1.0"

    def test_update_regression_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PUT /regressions/{regression_id} returns 404 when not found."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.update_regression"
        ) as mock_update:
            mock_update.return_value = None

            response = client.put(
                f"/regressions/{regression_id}",
                json={"name": "Updated Regression"},
            )

            assert response.status_code == 404

    def test_update_regression_validates_name_length(self, client: TestClient) -> None:
        """Test that PUT /regressions validates regression name length."""
        regression_id = str(uuid.uuid4())

        response = client.put(
            f"/regressions/{regression_id}",
            json={"name": "A" * 256},
        )

        assert response.status_code == 400
        data = response.json()
        assert re.match(
            r"^Regression name must be between 1 and 255 characters$",
            data["error"]["message"],
        )

    def test_update_regression_returns_409_on_naming_conflict(self, client: TestClient) -> None:
        """Test that PUT /regressions returns 409 on naming conflict."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.update_regression"
        ) as mock_update:
            mock_update.side_effect = ConflictException(
                "Regression with name 'Existing Regression' already exists"
            )

            response = client.put(
                f"/regressions/{regression_id}",
                json={"name": "Existing Regression"},
            )

            assert_error_reply(
                response,
                409,
                "CONFLICT",
                "Regression with name 'Existing Regression' already exists",
            )

    def test_update_regression_sets_cache_invalidation_header(self, client: TestClient) -> None:
        """Test that PUT /regressions sets X-Cache-Invalidated header."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.update_regression"
        ) as mock_update:
            mock_update.return_value = {
                "id": regression_id,
                "name": "Updated Regression",
                "version": "1.1.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/regressions/{regression_id}",
                json={"name": "Updated Regression"},
            )

            assert response.status_code == 200
            assert "X-Cache-Invalidated" in response.headers

    def test_update_regression_supports_optimistic_concurrency(self, client: TestClient) -> None:
        """Test that PUT /regressions supports If-Match header for concurrency control."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.update_regression"
        ) as mock_update:
            mock_update.return_value = {
                "id": regression_id,
                "name": "Updated Regression",
                "version": "1.1.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/regressions/{regression_id}",
                json={"name": "Updated Regression"},
                headers={"If-Match": '"abc123"'},
            )

            assert response.status_code in [200, 412]


class TestDeleteRegressionEndpoint:
    """Test suite for DELETE /regressions/{regression_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_regression_returns_204_on_success(self, client: TestClient) -> None:
        """Test that DELETE /regressions/{regression_id} returns 204 on success."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.delete_regression"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/regressions/{regression_id}")

            assert response.status_code == 204

    def test_delete_regression_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /regressions/{regression_id} returns 404 when not found."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.delete_regression"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/regressions/{regression_id}")

            assert response.status_code == 404

    def test_delete_regression_returns_409_with_active_executions(self, client: TestClient) -> None:
        """DELETE /regressions/{id} returns 409 with execution_ids in details
        when a regression-type tracked execution is running or paused."""
        from wavecore.api.exceptions import ConflictException

        regression_id = str(uuid.uuid4())
        blocking = [str(uuid.uuid4()), str(uuid.uuid4())]

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.delete_regression"
        ) as mock_delete:
            mock_delete.side_effect = ConflictException(
                f"Cannot delete regression '{regression_id}': execution is running",
                details={"execution_ids": blocking},
            )

            response = client.delete(f"/regressions/{regression_id}")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"
            assert data["error"]["details"] == {"execution_ids": blocking}

    def test_delete_regression_sets_cache_invalidation_header(self, client: TestClient) -> None:
        """Test that DELETE /regressions sets X-Cache-Invalidated header."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.delete_regression"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/regressions/{regression_id}")

            assert response.status_code == 204
            assert "X-Cache-Invalidated" in response.headers

    def test_delete_regression_returns_500_for_an_unexpected_value_error(
        self, client: TestClient
    ) -> None:
        """Test that DELETE answers the generic 500 for an unexpected ValueError from service."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.delete_regression"
        ) as mock_delete:
            mock_delete.side_effect = ValueError("Some generic validation error")

            response = client.delete(f"/regressions/{regression_id}")

            assert_internal_error(response, "Some generic validation error")


class TestListRegressionVersionsEndpoint:
    """Test suite for GET /regressions/{regression_id}/versions endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_versions_returns_200_with_versions(self, client: TestClient) -> None:
        """Test that GET /regressions/{id}/versions returns 200 with version list."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.list_regression_versions"
        ) as mock_list:
            mock_list.return_value = {
                "versions": [
                    {"version": "1.0.0", "created_at": now, "published": False},
                    {"version": "1.1.0", "created_at": now, "published": True},
                ],
                "total": 2,
            }

            response = client.get(f"/regressions/{regression_id}/versions")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]["versions"]) == 2
            assert data["data"]["versions"][0]["version"] == "1.0.0"
            assert data["data"]["versions"][1]["version"] == "1.1.0"

    def test_list_versions_returns_404_when_regression_not_found(self, client: TestClient) -> None:
        """Test that GET /regressions/{id}/versions returns 404 when not found."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.list_regression_versions"
        ) as mock_list:
            mock_list.return_value = None

            response = client.get(f"/regressions/{regression_id}/versions")

            assert response.status_code == 404


class TestAddRegressionVersionEndpoint:
    """Test suite for POST /regressions/{regression_id}/versions endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_add_version_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /regressions/{id}/versions returns 201 with valid data."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.add_regression_version"
        ) as mock_add:
            mock_add.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.1.0",
                "description": "Updated version",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/regressions/{regression_id}/versions",
                json={
                    "description": "Updated version",
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["version"] == "1.1.0"

    def test_add_version_returns_400_on_validation_error(self, client: TestClient) -> None:
        """Test that POST /regressions/{id}/versions returns 400 on validation error."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.add_regression_version"
        ) as mock_add:
            mock_add.side_effect = ValidationException("Suite with ID 'abc123' not found")

            response = client.post(
                f"/regressions/{regression_id}/versions",
                json={"suites": ["abc123"]},
            )

            assert_error_reply(
                response, 400, "VALIDATION_ERROR", "Suite with ID 'abc123' not found"
            )

    def test_add_version_returns_404_when_regression_not_found(self, client: TestClient) -> None:
        """Test that POST /regressions/{id}/versions returns 404 when not found."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.add_regression_version"
        ) as mock_add:
            mock_add.return_value = None

            response = client.post(
                f"/regressions/{regression_id}/versions",
                json={"description": "New version"},
            )

            assert response.status_code == 404


class TestGetRegressionVersionEndpoint:
    """Test suite for GET /regressions/{regression_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_version_returns_200_with_valid_version(self, client: TestClient) -> None:
        """Test that GET /regressions/{id}/versions/{version} returns 200."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.get_regression_version"
        ) as mock_get:
            mock_get.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "Original version",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/regressions/{regression_id}/versions/1.0.0")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["version"] == "1.0.0"

    def test_get_version_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /regressions/{id}/versions/{version} returns 404 when not found."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.get_regression_version"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/regressions/{regression_id}/versions/99.99.99")

            assert response.status_code == 404

    def test_get_version_validates_semver_format(self, client: TestClient) -> None:
        """Test that GET /regressions/{id}/versions/{version} validates semver format."""
        regression_id = str(uuid.uuid4())

        response = client.get(f"/regressions/{regression_id}/versions/invalid")

        assert_error_reply(
            response,
            400,
            "VALIDATION_ERROR",
            "Invalid version format 'invalid': "
            "must follow semantic versioning (MAJOR.MINOR.PATCH)",
        )

    def test_get_version_sets_long_cache_ttl_for_historical(self, client: TestClient) -> None:
        """Test that historical versions get long Cache-Control TTL."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.get_regression_version"
        ) as mock_get:
            mock_get.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
                "is_historical": True,
            }

            response = client.get(f"/regressions/{regression_id}/versions/1.0.0")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers


class TestUpdateRegressionVersionEndpoint:
    """Test suite for PUT /regressions/{regression_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_version_returns_200_with_valid_data(self, client: TestClient) -> None:
        """Test that PUT /regressions/{id}/versions/{version} returns 200."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.update_regression_version"
        ) as mock_update:
            mock_update.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "Updated description",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/regressions/{regression_id}/versions/1.0.0",
                json={"description": "Updated description"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_update_version_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PUT /regressions/{id}/versions/{version} returns 404 when not found."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.update_regression_version"
        ) as mock_update:
            mock_update.return_value = None

            response = client.put(
                f"/regressions/{regression_id}/versions/1.0.0",
                json={"description": "Updated"},
            )

            assert response.status_code == 404

    def test_update_version_returns_409_for_published_version(self, client: TestClient) -> None:
        """Test that PUT returns 409 when attempting to update published version."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.update_regression_version"
        ) as mock_update:
            mock_update.side_effect = ConflictException(
                "Cannot modify published version '1.0.0': version is immutable"
            )

            response = client.put(
                f"/regressions/{regression_id}/versions/1.0.0",
                json={"description": "Updated"},
            )

            assert_error_reply(
                response,
                409,
                "CONFLICT",
                "Cannot modify published version '1.0.0': version is immutable",
            )

    def test_update_version_supports_optimistic_concurrency(self, client: TestClient) -> None:
        """Test that PUT /regressions/{id}/versions/{version} supports If-Match header."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.update_regression_version"
        ) as mock_update:
            mock_update.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "Updated",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/regressions/{regression_id}/versions/1.0.0",
                json={"description": "Updated"},
                headers={"If-Match": '"abc123"'},
            )

            assert response.status_code in [200, 412]


class TestDeleteRegressionVersionEndpoint:
    """Test suite for DELETE /regressions/{regression_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_version_returns_204_on_success(self, client: TestClient) -> None:
        """Test that DELETE /regressions/{id}/versions/{version} returns 204."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.delete_regression_version"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/regressions/{regression_id}/versions/1.0.0")

            assert response.status_code == 204

    def test_delete_version_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /regressions/{id}/versions/{version} returns 404."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.delete_regression_version"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/regressions/{regression_id}/versions/1.0.0")

            assert response.status_code == 404

    def test_delete_version_returns_409_with_dependencies(self, client: TestClient) -> None:
        """Test that DELETE returns 409 when version has execution dependencies."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.delete_regression_version"
        ) as mock_delete:
            mock_delete.side_effect = ConflictException(
                "Cannot delete version '1.0.0': scheduled executions reference this version"
            )

            response = client.delete(f"/regressions/{regression_id}/versions/1.0.0")

            assert_error_reply(
                response,
                409,
                "CONFLICT",
                "Cannot delete version '1.0.0': scheduled executions reference this version",
            )


class TestRegressionVariableManagement:
    """Test suite for regression-level variable management."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_regression_with_typed_variables(self, client: TestClient) -> None:
        """Test creating regression with typed variable declarations."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {
                    "environment": {"type": "string", "default": "staging"},
                    "max_retries": {"type": "integer", "default": 3},
                    "debug_mode": {"type": "boolean", "default": False},
                },
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/regressions",
                json={
                    "name": "Nightly Regression",
                    "variables": {
                        "environment": {"type": "string", "default": "staging"},
                        "max_retries": {"type": "integer", "default": 3},
                        "debug_mode": {"type": "boolean", "default": False},
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["variables"]["environment"]["type"] == "string"
            assert data["data"]["variables"]["max_retries"]["type"] == "integer"

    def test_create_regression_with_computed_variables(self, client: TestClient) -> None:
        """Test creating regression with expression-based computed variables."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {
                    "base_url": {"type": "string", "default": "https://api.example.com"},
                    "full_url": {
                        "type": "string",
                        "computed": True,
                        "expression": "f'{base_url}/v1'",
                    },
                },
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/regressions",
                json={
                    "name": "Nightly Regression",
                    "variables": {
                        "base_url": {"type": "string", "default": "https://api.example.com"},
                        "full_url": {
                            "type": "string",
                            "computed": True,
                            "expression": "f'{base_url}/v1'",
                        },
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["variables"]["full_url"]["computed"] is True

    def test_create_regression_with_secret_variables(self, client: TestClient) -> None:
        """Test creating regression with secret variables and masking indicators."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {
                    "api_key": {
                        "type": "string",
                        "secret": True,
                        "masked": True,
                    },
                },
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/regressions",
                json={
                    "name": "Nightly Regression",
                    "variables": {
                        "api_key": {
                            "type": "string",
                            "secret": True,
                            "default": "secret-value",
                        },
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["variables"]["api_key"]["secret"] is True
            assert data["data"]["variables"]["api_key"]["masked"] is True


def _member_suite(client: TestClient) -> str:
    """A stored suite a regression can list."""
    return str(client.post("/suites", json={"name": "Member Suite"}).json()["data"]["id"])


def _listed_twice(suite_id: str) -> str:
    return f"Suite with ID '{suite_id}' is listed more than once"


class TestRegressionValidation:
    """Test suite for regression validation operations."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_regression_validates_suite_references(self, client: TestClient) -> None:
        """Test that create validates all suite references exist."""
        response = client.post(
            "/regressions",
            json={
                "name": "Nightly Regression",
                "suites": ["abc123"],
            },
        )

        assert_error_reply(response, 400, "VALIDATION_ERROR", "Suite with ID 'abc123' not found")

    def test_create_regression_validates_ordering_consistency(self, client: TestClient) -> None:
        """A create that lists one suite twice is refused and saves nothing."""
        suite_id = _member_suite(client)

        response = client.post(
            "/regressions",
            json={"name": "Nightly Regression", "suites": [suite_id, suite_id]},
        )

        assert_error_reply(response, 400, "VALIDATION_ERROR", _listed_twice(suite_id))
        assert client.get("/regressions").json()["data"] == []

    @pytest.mark.parametrize(
        ("method", "suffix"), [("PUT", ""), ("POST", "/versions")], ids=["update", "add-version"]
    )
    def test_a_save_that_lists_a_suite_twice_is_refused(
        self, client: TestClient, method: str, suffix: str
    ) -> None:
        """An update or a new version that lists one suite twice is refused and changes nothing."""
        from tests.api.regression_test_helpers import load_regression_file

        suite_id = _member_suite(client)
        created = client.post(
            "/regressions", json={"name": "Nightly Regression", "suites": [suite_id]}
        )
        regression_id = created.json()["data"]["id"]
        stored = load_regression_file(regression_id)

        response = client.request(
            method, f"/regressions/{regression_id}{suffix}", json={"suites": [suite_id, suite_id]}
        )

        assert_error_reply(response, 400, "VALIDATION_ERROR", _listed_twice(suite_id))
        assert load_regression_file(regression_id) == stored

    def test_a_new_version_naming_an_unknown_suite_is_refused(self, client: TestClient) -> None:
        """A new version that lists a suite ID that matches nothing is refused by its ID."""
        created = client.post("/regressions", json={"name": "Nightly Regression"})
        regression_id = created.json()["data"]["id"]

        response = client.post(f"/regressions/{regression_id}/versions", json={"suites": [7]})

        assert_error_reply(response, 400, "VALIDATION_ERROR", "Suite with ID '7' not found")

    @pytest.mark.parametrize("suites", [5, None, True, "abc"])
    @pytest.mark.parametrize(
        ("method", "suffix"),
        [("POST", None), ("PUT", ""), ("POST", "/versions")],
        ids=["create", "update", "add-version"],
    )
    def test_suites_that_are_not_a_list_are_a_bad_request(
        self, client: TestClient, method: str, suffix: str | None, suites: Any
    ) -> None:
        """A save whose suites field is not a list is refused with 400, never a server error."""
        path = "/regressions"
        if suffix is not None:
            created = client.post("/regressions", json={"name": "Nightly Regression"})
            path = f"/regressions/{created.json()['data']['id']}{suffix}"

        response = client.request(method, path, json={"name": "Listed", "suites": suites})

        assert_error_reply(
            response, 400, "VALIDATION_ERROR", "'suites' must be a list of ID strings"
        )

    def test_create_regression_validates_variable_binding(self, client: TestClient) -> None:
        """Test that create validates variable type consistency at boundaries."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.side_effect = ValidationException(
                "Variable binding validation failed: type mismatch for 'timeout'"
            )

            response = client.post(
                "/regressions",
                json={
                    "name": "Nightly Regression",
                    "variables": {
                        "timeout": {"type": "string", "default": "not-a-number"},
                    },
                },
            )

            assert_error_reply(
                response,
                400,
                "VALIDATION_ERROR",
                "Variable binding validation failed: type mismatch for 'timeout'",
            )

    def test_create_regression_enforces_naming_uniqueness(self, client: TestClient) -> None:
        """Test that create enforces naming uniqueness (REQ-5.2.4.5)."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.side_effect = ConflictException(
                "Regression with name 'Existing Regression' already exists"
            )

            response = client.post(
                "/regressions",
                json={"name": "Existing Regression"},
            )

            assert_error_reply(
                response,
                409,
                "CONFLICT",
                "Regression with name 'Existing Regression' already exists",
            )


class TestRegressionEndpointInvalidUUIDErrors:
    """Test suite for invalid UUID error handling across regression endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_regression_returns_400_for_invalid_uuid(self, client: TestClient) -> None:
        """Test GET /regressions/{id} returns 400 for invalid UUID."""
        response = client.get("/regressions/invalid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert re.match(
            r"^Invalid UUID format for regression_id: 'invalid-uuid'$",
            data["error"]["message"],
        )

    def test_update_regression_returns_400_for_invalid_uuid(self, client: TestClient) -> None:
        """Test PUT /regressions/{id} returns 400 for invalid UUID."""
        response = client.put(
            "/regressions/invalid-uuid",
            json={"name": "Updated"},
        )

        assert response.status_code == 400

    def test_delete_regression_returns_400_for_invalid_uuid(self, client: TestClient) -> None:
        """Test DELETE /regressions/{id} returns 400 for invalid UUID."""
        response = client.delete("/regressions/invalid-uuid")

        assert_error_reply(
            response,
            400,
            "VALIDATION_ERROR",
            "Invalid UUID format for regression_id: 'invalid-uuid'",
        )


class TestRegressionCachingBehavior:
    """Test suite for regression caching and performance behavior."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_regressions_cached_with_invalidation(self, client: TestClient) -> None:
        """Test that list results are cached with invalidation on modifications."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers

    def test_individual_regression_cached_per_version(self, client: TestClient) -> None:
        """Test that individual regressions are cached per version with long TTLs."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.version_routes._reg_version_svc.get_regression_version"
        ) as mock_get:
            mock_get.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/regressions/{regression_id}/versions/1.0.0")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers


class TestRegressionOptimisticConcurrency:
    """Test suite for regression optimistic concurrency control."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_regression_with_if_match_header(self, client: TestClient) -> None:
        """Test that update supports If-Match header for concurrency control."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.update_regression"
        ) as mock_update:
            mock_update.return_value = {
                "id": regression_id,
                "name": "Updated Regression",
                "version": "1.1.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/regressions/{regression_id}",
                json={"name": "Updated Regression"},
                headers={"If-Match": '"abc123"'},
            )

            assert response.status_code in [200, 412]

    def test_update_regression_returns_412_on_etag_mismatch(self, client: TestClient) -> None:
        """Test that update returns 412 when ETag doesn't match."""
        regression_id = str(uuid.uuid4())
        stored = {"id": regression_id, "version": "1.0.0", "updated_at": "2026-01-01T00:00:00"}

        with (
            patch(
                "wavecore.api.routes.regressions.routes.regression_service.get_regression",
                return_value=stored,
            ),
            patch(
                "wavecore.api.routes.regressions.routes.regression_service.update_regression"
            ) as mock_update,
        ):
            response = client.put(
                f"/regressions/{regression_id}",
                json={"name": "Updated Regression"},
                headers={"If-Match": '"stale-etag"'},
            )

            assert_error_reply(
                response,
                412,
                "PRECONDITION_REQUIRED",
                "Precondition failed: resource has been modified",
            )
            mock_update.assert_not_called()

    def test_delete_regression_with_if_match_header(self, client: TestClient) -> None:
        """Test that delete supports If-Match header for concurrency control."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.delete_regression"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(
                f"/regressions/{regression_id}",
                headers={"If-Match": '"abc123"'},
            )

            assert response.status_code in [204, 412]

    def test_delete_regression_returns_412_on_etag_mismatch(self, client: TestClient) -> None:
        """Test that delete returns 412 when ETag doesn't match."""
        regression_id = str(uuid.uuid4())
        stored = {"id": regression_id, "version": "1.0.0", "updated_at": "2026-01-01T00:00:00"}

        with (
            patch(
                "wavecore.api.routes.regressions.routes.regression_service.get_regression",
                return_value=stored,
            ),
            patch(
                "wavecore.api.routes.regressions.routes.regression_service.delete_regression"
            ) as mock_delete,
        ):
            response = client.delete(
                f"/regressions/{regression_id}",
                headers={"If-Match": '"stale-etag"'},
            )

            assert_error_reply(
                response,
                412,
                "PRECONDITION_REQUIRED",
                "Precondition failed: resource has been modified",
            )
            mock_delete.assert_not_called()


class TestRegressionResponseEnvelope:
    """Test suite for regression response envelope consistency."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_response_has_standard_envelope(self, client: TestClient) -> None:
        """Test that list response follows {success, data, meta, pagination} format."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert "success" in data
            assert "data" in data
            assert "meta" in data
            assert "pagination" in data

    def test_get_response_has_standard_envelope(self, client: TestClient) -> None:
        """Test that get response follows {success, data, meta} format."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.get_regression"
        ) as mock_get:
            mock_get.return_value = {
                "id": regression_id,
                "name": "Nightly Regression",
                "version": "1.0.0",
                "description": "",
                "suites": [],
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/regressions/{regression_id}")

            assert response.status_code == 200
            data = response.json()
            assert "success" in data
            assert "data" in data
            assert "meta" in data

    def test_error_response_has_standard_envelope(self, client: TestClient) -> None:
        """Test that error responses follow {success, error} format."""
        response = client.get("/regressions/invalid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "error" in data
        assert "code" in data["error"]
        assert "message" in data["error"]

    def test_meta_includes_request_info(self, client: TestClient) -> None:
        """Test that meta field includes request timestamp and version info."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_regressions"
        ) as mock_list:
            mock_list.return_value = {
                "regressions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/regressions")

            assert response.status_code == 200
            data = response.json()
            assert "timestamp" in data["meta"]
            assert "version" in data["meta"]


class TestRegressionValidationEdgeCases:
    """Test suite for validation edge cases in regression endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_regression_validates_invalid_variable_type(self, client: TestClient) -> None:
        """Test create validates invalid variable types."""
        response = client.post(
            "/regressions",
            json={
                "name": "Test Regression",
                "variables": {"var": {"type": "invalid_type"}},
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert "Invalid variable type" in data["error"]["message"]

    def test_create_regression_validates_computed_expression_syntax(
        self, client: TestClient
    ) -> None:
        """Test create validates computed variable expression syntax."""
        response = client.post(
            "/regressions",
            json={
                "name": "Test Regression",
                "variables": {
                    "computed_var": {
                        "type": "string",
                        "computed": True,
                        "expression": "{{ unclosed",
                    }
                },
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert "unclosed template tag" in data["error"]["message"]

    def test_update_regression_etag_validation_in_route(self, client: TestClient) -> None:
        """Test that route-level ETag validation returns 412 on mismatch."""
        regression_id = str(uuid.uuid4())

        # Mock get_regression to return a regression (for ETag generation)
        # Mock update_regression to succeed
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.get_regression"
        ) as mock_get:
            now = datetime.now(UTC).isoformat()
            mock_get.return_value = {
                "id": regression_id,
                "name": "Test",
                "version": "1.0.0",
                "updated_at": now,
            }

            response = client.put(
                f"/regressions/{regression_id}",
                json={"name": "Updated"},
                headers={"If-Match": '"wrong-etag"'},
            )

            assert response.status_code == 412

    def test_delete_regression_etag_validation_in_route(self, client: TestClient) -> None:
        """Test that route-level ETag validation for delete returns 412 on mismatch."""
        regression_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.get_regression"
        ) as mock_get:
            now = datetime.now(UTC).isoformat()
            mock_get.return_value = {
                "id": regression_id,
                "name": "Test",
                "version": "1.0.0",
                "updated_at": now,
            }

            response = client.delete(
                f"/regressions/{regression_id}",
                headers={"If-Match": '"wrong-etag"'},
            )

            assert response.status_code == 412

    def test_list_versions_returns_400_for_invalid_uuid(self, client: TestClient) -> None:
        """Test that list_regression_versions returns 400 for invalid UUID."""
        response = client.get("/regressions/not-a-uuid/versions")

        assert_error_reply(
            response,
            400,
            "VALIDATION_ERROR",
            "Invalid UUID format for regression_id: 'not-a-uuid'",
        )

    def test_get_version_applies_cache_header_for_historical_version(
        self, client: TestClient
    ) -> None:
        """Test that historical version gets longer cache-control header."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with (
            patch(
                "wavecore.api.routes.regressions.version_routes._reg_version_svc.get_regression_version"
            ) as mock_get_version,
            patch(
                "wavecore.api.routes.regressions.routes.regression_service.get_regression"
            ) as mock_get,
        ):
            # Return historical version (1.0.0) while current is 2.0.0
            mock_get_version.return_value = {
                "id": regression_id,
                "name": "Test",
                "version": "1.0.0",
                "created_at": now,
                "updated_at": now,
            }
            mock_get.return_value = {
                "id": regression_id,
                "name": "Test",
                "version": "2.0.0",  # Current version is different
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/regressions/{regression_id}/versions/1.0.0")

            assert response.status_code == 200
            assert response.headers.get("Cache-Control") == "max-age=3600"

    def test_update_version_returns_500_for_an_unexpected_value_error(
        self, client: TestClient
    ) -> None:
        """Test that update_regression_version hides an unexpected ValueError behind a 500."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with (
            patch(
                "wavecore.api.routes.regressions.routes.regression_service.get_regression"
            ) as mock_get,
            patch(
                "wavecore.api.routes.regressions.version_routes._reg_version_svc.update_regression_version"
            ) as mock_update,
        ):
            mock_get.return_value = {
                "id": regression_id,
                "name": "Test",
                "version": "1.0.0",
                "created_at": now,
                "updated_at": now,
            }
            mock_update.side_effect = ValueError("Invalid field value")

            response = client.put(
                f"/regressions/{regression_id}/versions/1.0.0",
                json={"notes": "test"},
            )

            assert_internal_error(response, "Invalid field value")

    def test_delete_version_returns_500_for_an_unexpected_value_error(
        self, client: TestClient
    ) -> None:
        """Test that delete_regression_version hides an unexpected ValueError behind a 500."""
        regression_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with (
            patch(
                "wavecore.api.routes.regressions.routes.regression_service.get_regression"
            ) as mock_get,
            patch(
                "wavecore.api.routes.regressions.version_routes._reg_version_svc.delete_regression_version"
            ) as mock_delete,
        ):
            mock_get.return_value = {
                "id": regression_id,
                "name": "Test",
                "version": "1.0.0",
                "created_at": now,
                "updated_at": now,
            }
            mock_delete.side_effect = ValueError("Invalid version format")

            response = client.delete(f"/regressions/{regression_id}/versions/1.0.0")

            assert_internal_error(response, "Invalid version format")


class TestListRegressionTagsEndpoint:
    """Test suite for GET /regressions/tags endpoint (REQ-9.5.3.3)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_tags_returns_200_with_unique_tags(self, client: TestClient) -> None:
        """Test that GET /regressions/tags returns 200 with all unique tags."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = [
                "nightly",
                "quarterly",
                "release-1.0",
                "weekly",
            ]

            response = client.get("/regressions/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == ["nightly", "quarterly", "release-1.0", "weekly"]
            mock_list_tags.assert_called_once()

    def test_list_tags_returns_200_with_empty_array_when_no_tags(self, client: TestClient) -> None:
        """Test that GET /regressions/tags returns 200 with empty array when no tags exist."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = []

            response = client.get("/regressions/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_tags_returns_sorted_tags(self, client: TestClient) -> None:
        """Test that GET /regressions/tags returns tags in alphabetical order."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_all_tags"
        ) as mock_list_tags:
            # Service returns sorted tags
            mock_list_tags.return_value = ["alpha", "beta", "gamma", "zeta"]

            response = client.get("/regressions/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["data"] == ["alpha", "beta", "gamma", "zeta"]

    def test_list_tags_includes_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /regressions/tags includes Cache-Control header."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = ["tag1", "tag2"]

            response = client.get("/regressions/tags")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert response.headers["Cache-Control"] == "max-age=60"

    def test_list_tags_includes_meta_in_response(self, client: TestClient) -> None:
        """Test that GET /regressions/tags includes meta information in response."""
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = ["tag1"]

            response = client.get("/regressions/tags")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]


class TestRegressionBatchEndpoints:
    """Test suite for DELETE /regressions/batch and POST /regressions/batch/clone."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_batch_delete_regressions_returns_result_envelope(self, client: TestClient) -> None:
        """DELETE /regressions/batch returns deleted + failed lists."""
        reg1 = str(uuid.uuid4())
        reg2 = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.batch_routes.regression_service.batch_delete_regressions"
        ) as mock_batch:
            mock_batch.return_value = {
                "deleted": [reg1, reg2],
                "failed": [],
            }

            response = client.request(
                "DELETE",
                "/regressions/batch",
                json=[reg1, reg2],
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["deleted"]) == 2
        assert data["failed"] == []
        mock_batch.assert_called_once_with([reg1, reg2])

    def test_batch_clone_regressions_returns_result_envelope(self, client: TestClient) -> None:
        """POST /regressions/batch/clone returns cloned + failed lists."""
        reg1 = str(uuid.uuid4())
        reg2 = str(uuid.uuid4())
        clone1 = str(uuid.uuid4())
        clone2 = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.regressions.batch_routes.regression_service.batch_clone_regressions"
        ) as mock_batch:
            mock_batch.return_value = {
                "cloned": [
                    {"original_id": reg1, "cloned_id": clone1},
                    {"original_id": reg2, "cloned_id": clone2},
                ],
                "failed": [],
            }

            response = client.post(
                "/regressions/batch/clone",
                json=[reg1, reg2],
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["cloned"]) == 2
        assert data["failed"] == []
        mock_batch.assert_called_once_with([reg1, reg2])


class TestRegressionNumbersAreStoredInWireForm:
    """REQ-3.1.3.14: a Regression save stores each typed number a client sends in wire form."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_and_update_store_numbers_in_wire_form(self, client: TestClient) -> None:
        from tests.api.wire_number_cases import SENT_VARIABLES, STORED_VARIABLES
        from wavecore.api.services.regressions import _storage

        response = client.post(
            "/regressions", json={"name": "Wire Numbers", "variables": SENT_VARIABLES}
        )
        assert response.status_code == 201, response.text
        created = response.json()["data"]
        regression_id = created["id"]

        assert created["variables"] == STORED_VARIABLES
        assert (
            client.get(f"/regressions/{regression_id}").json()["data"]["variables"]
            == STORED_VARIABLES
        )

        put = client.put(
            f"/regressions/{regression_id}",
            json={"variables": {"small": {"type": "float", "value": 0.00001}}},
        )
        assert put.status_code == 200, put.text
        stored = {"small": {"type": "float", "value": "0.00001"}}
        assert client.get(f"/regressions/{regression_id}").json()["data"]["variables"] == stored
        assert [row["snapshot"]["variables"] for row in _storage._load_versions(regression_id)] == [
            STORED_VARIABLES,
            stored,
        ]


class TestRegressionVariableValueRefusals:
    """REQ-3.1.3.14: a Regression save refuses a bad integer variable by its name."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize(
        ("value", "message"),
        [
            ("80.5", "Value for variable 'retries' is not a valid integer"),
            (
                "12345678901234567890",
                "Value for variable 'retries' allows at most 19 digits, got 20",
            ),
        ],
    )
    def test_create_refuses_the_value_with_400_naming_the_variable(
        self, client: TestClient, value: str, message: str
    ) -> None:
        response = client.post(
            "/regressions",
            json={
                "name": "Refused Numbers",
                "variables": {"retries": {"type": "integer", "value": value}},
            },
        )
        assert response.status_code == 400, response.text
        assert response.json()["error"]["message"] == message

    def test_create_answers_a_service_conflict_with_its_status(self, client: TestClient) -> None:
        from wavecore.api.exceptions import ConflictException

        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as mock_create:
            mock_create.side_effect = ConflictException(
                "Regression with name 'Nightly Regression' already exists"
            )
            response = client.post("/regressions", json={"name": "Nightly Regression"})

        assert response.status_code == 409, response.text
        assert (
            response.json()["error"]["message"]
            == "Regression with name 'Nightly Regression' already exists"
        )


class TestARegressionBodyThatIsNotAJsonObject:
    """A Regression write whose body is not a JSON object is a bad request and writes nothing."""

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
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.create_regression"
        ) as create:
            response = client.post(
                "/regressions", content=text, headers={"content-type": "application/json"}
            )

        assert response.status_code == 400, response.json()
        assert response.json()["error"]["message"] == message
        create.assert_not_called()

    @pytest.mark.parametrize(("text", "message"), BODIES)
    def test_an_update_is_refused(self, client: TestClient, text: str, message: str) -> None:
        with patch(
            "wavecore.api.routes.regressions.routes.regression_service.update_regression"
        ) as update:
            response = client.put(
                f"/regressions/{uuid.uuid4()}",
                content=text,
                headers={"content-type": "application/json"},
            )

        assert response.status_code == 400, response.json()
        assert response.json()["error"]["message"] == message
        update.assert_not_called()

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            pytest.param("POST", "/regressions/{id}/clone", id="clone"),
            pytest.param("POST", "/regressions/export", id="export"),
            pytest.param("POST", "/regressions/{id}/versions", id="add-version"),
            pytest.param("PUT", "/regressions/{id}/versions/1.0.0", id="update-version"),
        ],
    )
    @pytest.mark.parametrize(("text", "message"), NOT_OBJECT_BODIES)
    def test_every_other_write_is_refused(
        self, client: TestClient, method: str, path: str, text: str, message: str
    ) -> None:
        response = send_text(client, method, path.format(id=uuid.uuid4()), text)

        assert_refused(response, message)


class TestARegressionBatchBodyThatIsNotAJsonArray:
    """A Regression batch whose body is not a JSON array is a bad request."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            pytest.param("DELETE", "/regressions/batch", id="delete"),
            pytest.param("POST", "/regressions/batch/clone", id="clone"),
        ],
    )
    @pytest.mark.parametrize(("text", "message"), NOT_ARRAY_BODIES)
    def test_it_is_refused(
        self, client: TestClient, method: str, path: str, text: str, message: str
    ) -> None:
        assert_refused(send_text(client, method, path, text), message)


class TestARegressionBatchItemThatIsNotAnId:
    """A Regression batch item that is not an ID string fails; the other items still run."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def _create(self, client: TestClient) -> str:
        response = client.post("/regressions", json={"name": f"Batch Item {uuid.uuid4().hex[:8]}"})
        return str(response.json()["data"]["id"])

    @pytest.mark.parametrize("item", NOT_ID_ITEMS)
    def test_a_delete_item_fails(self, client: TestClient, item: Any) -> None:
        regression_id = self._create(client)

        response = client.request("DELETE", "/regressions/batch", json=[item, regression_id])

        assert response.status_code == 200, response.json()
        assert response.json() == {
            "deleted": [regression_id],
            "failed": [{"index": 0, "error": NOT_AN_ID_ITEM}],
        }

    @pytest.mark.parametrize("item", NOT_ID_ITEMS)
    def test_a_clone_item_fails(self, client: TestClient, item: Any) -> None:
        regression_id = self._create(client)

        response = client.post("/regressions/batch/clone", json=[item, regression_id])

        assert response.status_code == 200, response.json()
        body = response.json()
        assert body["failed"] == [{"index": 0, "error": NOT_AN_ID_ITEM}]
        assert [entry["original_id"] for entry in body["cloned"]] == [regression_id]


class TestStoredVersionThatIsNotSemantic:
    """A regression whose stored version is not MAJOR.MINOR.PATCH refuses a change with 400."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize(
        ("method", "suffix"),
        [("PUT", ""), ("POST", "/versions")],
        ids=["update", "add-version"],
    )
    def test_refuses_the_change(self, client: TestClient, method: str, suffix: str) -> None:
        from tests.api.regression_test_helpers import (
            load_regression_file,
            save_regression_file,
        )

        created = client.post("/regressions", json={"name": f"Short {uuid.uuid4().hex[:8]}"})
        regression_id = created.json()["data"]["id"]
        stored = load_regression_file(regression_id)
        assert stored is not None
        stored["version"] = "1"
        save_regression_file(stored)

        response = client.request(
            method, f"/regressions/{regression_id}{suffix}", json={"description": "x"}
        )

        assert response.status_code == 400, response.json()
        assert response.json()["error"]["message"] == (
            "Invalid version format '1': must follow semantic versioning (MAJOR.MINOR.PATCH)"
        )
        assert load_regression_file(regression_id) == stored


_INTERNAL_TEXT = "internal regression detail that stays in the server log"
_MISSING_ID = "6f1c2b9e-4d3a-4c5b-9e8f-000000000392"


def _raise_internal(*_args: Any, **_kwargs: Any) -> Any:
    raise ValueError(_INTERNAL_TEXT)


class TestARegressionRouteFault:
    """An unexpected fault behind a Regression route answers the generic 500, never its text."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize(
        ("module", "function", "method", "path", "kwargs"),
        [
            pytest.param("service", "list_regressions", "GET", "/regressions", {}, id="list"),
            pytest.param(
                "service",
                "create_regression",
                "POST",
                "/regressions",
                {"json": {"name": "Fault Regression"}},
                id="create",
            ),
            pytest.param("service", "get_regression", "GET", "/regressions/{id}", {}, id="get"),
            pytest.param(
                "service",
                "update_regression",
                "PUT",
                "/regressions/{id}",
                {"json": {"description": "x"}},
                id="update",
            ),
            pytest.param(
                "service", "delete_regression", "DELETE", "/regressions/{id}", {}, id="delete"
            ),
            pytest.param(
                "version_service",
                "list_regression_versions",
                "GET",
                "/regressions/{id}/versions",
                {},
                id="list-versions",
            ),
            pytest.param(
                "version_service",
                "add_regression_version",
                "POST",
                "/regressions/{id}/versions",
                {"json": {}},
                id="add-version",
            ),
            pytest.param(
                "version_service",
                "get_regression_version",
                "GET",
                "/regressions/{id}/versions/1.0.0",
                {},
                id="get-version",
            ),
            pytest.param(
                "version_service",
                "update_regression_version",
                "PUT",
                "/regressions/{id}/versions/1.0.0",
                {"json": {}},
                id="update-version",
            ),
            pytest.param(
                "version_service",
                "delete_regression_version",
                "DELETE",
                "/regressions/{id}/versions/1.0.0",
                {},
                id="delete-version",
            ),
            pytest.param(
                "service",
                "get_regression_suites_with_tests",
                "GET",
                "/regressions/{id}/suites",
                {},
                id="suites",
            ),
            pytest.param(
                "version_service",
                "clone_regression",
                "POST",
                "/regressions/{id}/clone",
                {"json": {}},
                id="clone",
            ),
        ],
    )
    def test_answers_the_generic_internal_error(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
        module: str,
        function: str,
        method: str,
        path: str,
        kwargs: dict[str, Any],
    ) -> None:
        from importlib import import_module

        monkeypatch.setattr(
            import_module(f"wavecore.api.services.regressions.{module}"), function, _raise_internal
        )

        response = client.request(method, path.format(id=_MISSING_ID), **kwargs)

        assert_internal_error(response, _INTERNAL_TEXT)


_BAD_REGRESSION_ID = "Invalid UUID format for regression_id: 'not-a-uuid'"
_NO_REGRESSION = f"Regression with ID '{_MISSING_ID}' not found"
_NO_REGRESSION_VERSION = f"Version '1.0.0' not found for regression '{_MISSING_ID}'"
_BAD_REGRESSION_NAME = (
    "Regression name 'Bad@Name' violates naming convention: must contain only "
    "alphanumeric characters, spaces, hyphens, underscores, periods, and parentheses"
)


def _variable_type_message() -> str:
    from wavecore.api.routes.shared import VALID_VAR_TYPES

    return (
        "Invalid variable type 'bogus' for variable 'x'. "
        f"Allowed types: {', '.join(VALID_VAR_TYPES)}"
    )


class TestARegressionRefusalReply:
    """A Regression refusal answers in the shared error envelope with status, code and message."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def _create(self, client: TestClient) -> str:
        response = client.post("/regressions", json={"name": f"Reply {uuid.uuid4().hex[:8]}"})
        return str(response.json()["data"]["id"])

    @pytest.mark.parametrize(
        ("method", "path", "kwargs", "status", "code", "message"),
        [
            pytest.param(
                "GET",
                "/regressions?status=bogus",
                {},
                400,
                "VALIDATION_ERROR",
                "Invalid status filter: 'bogus' must be one of: passed, failed, never_run",
                id="list-bad-status",
            ),
            pytest.param(
                "GET",
                "/regressions?sort=a:b:c",
                {},
                400,
                "VALIDATION_ERROR",
                "Invalid sort format: 'a:b:c'. Use 'field:direction'",
                id="list-bad-sort-format",
            ),
            pytest.param(
                "GET",
                "/regressions?sort=bogus",
                {},
                400,
                "VALIDATION_ERROR",
                "Invalid sort field: 'bogus' must be one of: name, version, status, last_run, "
                "suites_count, tests_count",
                id="list-bad-sort-field",
            ),
            pytest.param(
                "GET",
                "/regressions?sort=name:up",
                {},
                400,
                "VALIDATION_ERROR",
                "Invalid sort direction: 'up' must be 'asc' or 'desc'",
                id="list-bad-sort-direction",
            ),
            pytest.param(
                "POST",
                "/regressions",
                {"json": {}},
                400,
                "VALIDATION_ERROR",
                "Field 'name' is required",
                id="create-no-name",
            ),
            pytest.param(
                "POST",
                "/regressions",
                {"json": {"name": ""}},
                400,
                "VALIDATION_ERROR",
                "Regression name must be between 1 and 255 characters",
                id="create-empty-name",
            ),
            pytest.param(
                "POST",
                "/regressions",
                {"json": {"name": 5}},
                400,
                "VALIDATION_ERROR",
                "Field 'name' must be a string",
                id="create-name-not-a-string",
            ),
            pytest.param(
                "PUT",
                "/regressions/{id}",
                {"json": {"name": ["x"]}},
                400,
                "VALIDATION_ERROR",
                "Field 'name' must be a string",
                id="update-name-not-a-string",
            ),
            pytest.param(
                "POST",
                "/regressions/{id}/clone",
                {"json": {"name": 5}},
                400,
                "VALIDATION_ERROR",
                "Field 'name' must be a string",
                id="clone-name-not-a-string",
            ),
            pytest.param(
                "POST",
                "/regressions",
                {"json": {"name": "Bad@Name"}},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_NAME,
                id="create-bad-name",
            ),
            pytest.param(
                "POST",
                "/regressions",
                {
                    "json": {
                        "name": "Computed",
                        "variables": {"x": {"computed": True, "expression": "{{ a"}},
                    }
                },
                400,
                "VALIDATION_ERROR",
                "Invalid expression syntax for computed variable 'x': unclosed template tag",
                id="create-unclosed-expression",
            ),
            pytest.param(
                "GET",
                "/regressions/not-a-uuid",
                {},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_ID,
                id="get-bad-id",
            ),
            pytest.param(
                "GET", "/regressions/{id}", {}, 404, "NOT_FOUND", _NO_REGRESSION, id="get-missing"
            ),
            pytest.param(
                "PUT",
                "/regressions/not-a-uuid",
                {"json": {}},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_ID,
                id="update-bad-id",
            ),
            pytest.param(
                "PUT",
                "/regressions/{id}",
                {"json": {"description": "x"}},
                404,
                "NOT_FOUND",
                _NO_REGRESSION,
                id="update-missing",
            ),
            pytest.param(
                "PUT",
                "/regressions/{id}",
                {"json": {"name": "Bad@Name"}},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_NAME,
                id="update-bad-name",
            ),
            pytest.param(
                "DELETE",
                "/regressions/{id}",
                {},
                404,
                "NOT_FOUND",
                _NO_REGRESSION,
                id="delete-missing",
            ),
            pytest.param(
                "GET",
                "/regressions/not-a-uuid/versions",
                {},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_ID,
                id="list-versions-bad-id",
            ),
            pytest.param(
                "GET",
                "/regressions/{id}/versions",
                {},
                404,
                "NOT_FOUND",
                _NO_REGRESSION,
                id="list-versions-missing",
            ),
            pytest.param(
                "POST",
                "/regressions/not-a-uuid/versions",
                {"json": {}},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_ID,
                id="add-version-bad-id",
            ),
            pytest.param(
                "POST",
                "/regressions/{id}/versions",
                {"json": {}},
                404,
                "NOT_FOUND",
                _NO_REGRESSION,
                id="add-version-missing",
            ),
            pytest.param(
                "GET",
                "/regressions/not-a-uuid/versions/1.0.0",
                {},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_ID,
                id="get-version-bad-id",
            ),
            pytest.param(
                "GET",
                "/regressions/{id}/versions/1.0",
                {},
                400,
                "VALIDATION_ERROR",
                "Invalid version format '1.0': "
                "must follow semantic versioning (MAJOR.MINOR.PATCH)",
                id="get-version-bad-version",
            ),
            pytest.param(
                "GET",
                "/regressions/{id}/versions/1.0.0",
                {},
                404,
                "NOT_FOUND",
                f"Regression version '1.0.0' not found for regression '{_MISSING_ID}'",
                id="get-version-missing",
            ),
            pytest.param(
                "PUT",
                "/regressions/not-a-uuid/versions/1.0.0",
                {"json": {}},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_ID,
                id="update-version-bad-id",
            ),
            pytest.param(
                "PUT",
                "/regressions/{id}/versions/1.0.0",
                {"json": {}},
                404,
                "NOT_FOUND",
                _NO_REGRESSION_VERSION,
                id="update-version-missing",
            ),
            pytest.param(
                "DELETE",
                "/regressions/not-a-uuid/versions/1.0.0",
                {},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_ID,
                id="delete-version-bad-id",
            ),
            pytest.param(
                "DELETE",
                "/regressions/{id}/versions/1.0.0",
                {},
                404,
                "NOT_FOUND",
                _NO_REGRESSION_VERSION,
                id="delete-version-missing",
            ),
            pytest.param(
                "GET",
                "/regressions/not-a-uuid/suites",
                {},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_ID,
                id="suites-bad-id",
            ),
            pytest.param(
                "GET",
                "/regressions/{id}/suites",
                {},
                404,
                "NOT_FOUND",
                _NO_REGRESSION,
                id="suites-missing",
            ),
            pytest.param(
                "POST",
                "/regressions/not-a-uuid/clone",
                {"json": {}},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_ID,
                id="clone-bad-id",
            ),
            pytest.param(
                "POST",
                "/regressions/{id}/clone",
                {"json": {"name": "Bad@Name"}},
                400,
                "VALIDATION_ERROR",
                _BAD_REGRESSION_NAME,
                id="clone-bad-name",
            ),
            pytest.param(
                "POST",
                "/regressions/{id}/clone",
                {"json": {}},
                404,
                "NOT_FOUND",
                _NO_REGRESSION,
                id="clone-missing",
            ),
        ],
    )
    def test_answers_in_the_shared_envelope(
        self,
        client: TestClient,
        method: str,
        path: str,
        kwargs: dict[str, Any],
        status: int,
        code: str,
        message: str,
    ) -> None:
        response = client.request(method, path.format(id=_MISSING_ID), **kwargs)

        assert_error_reply(response, status, code, message)

    def test_an_unknown_variable_type_is_refused(self, client: TestClient) -> None:
        response = client.post(
            "/regressions", json={"name": "Typed", "variables": {"x": {"type": "bogus"}}}
        )

        assert_error_reply(response, 400, "VALIDATION_ERROR", _variable_type_message())

    @pytest.mark.parametrize("method", ["PUT", "DELETE"])
    def test_a_stale_if_match_is_a_failed_precondition(
        self, client: TestClient, method: str
    ) -> None:
        regression_id = self._create(client)
        before = client.get(f"/regressions/{regression_id}").json()["data"]

        response = client.request(
            method,
            f"/regressions/{regression_id}",
            headers={"If-Match": '"stale"'},
            json={"description": "Changed"},
        )

        assert_error_reply(
            response,
            412,
            "PRECONDITION_REQUIRED",
            "Precondition failed: resource has been modified",
        )
        after = client.get(f"/regressions/{regression_id}").json()["data"]
        assert after["description"] == before["description"]
        assert after["version"] == before["version"]

    def test_a_stale_if_match_on_a_version_update_is_a_failed_precondition(
        self, client: TestClient
    ) -> None:
        regression_id = self._create(client)
        before = client.get(f"/regressions/{regression_id}").json()["data"]

        response = client.put(
            f"/regressions/{regression_id}/versions/1.0.0",
            headers={"If-Match": '"stale"'},
            json={"description": "Changed"},
        )

        assert_error_reply(
            response,
            412,
            "PRECONDITION_REQUIRED",
            "Precondition failed: resource has been modified",
        )
        assert client.get(f"/regressions/{regression_id}").json()["data"] == before

    def test_the_current_if_match_on_a_version_update_is_accepted(self, client: TestClient) -> None:
        regression_id = self._create(client)
        etag = client.get(f"/regressions/{regression_id}").headers["ETag"]

        response = client.put(
            f"/regressions/{regression_id}/versions/1.0.0",
            headers={"If-Match": etag},
            json={"description": "Changed"},
        )

        assert response.status_code == 200, response.text
        assert response.json()["data"]["description"] == "Changed"


class TestAnUnexpectedFaultOnARegressionBatchItem:
    """A fault on a Regression batch item fails it with the generic text, never its own."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize(
        ("method", "path", "patched", "answer_key"),
        [
            pytest.param(
                "DELETE",
                "/regressions/batch",
                "wavecore.api.services.regressions.service.delete_regression",
                "deleted",
                id="delete",
            ),
            pytest.param(
                "POST",
                "/regressions/batch/clone",
                "wavecore.api.services.regressions.version_service.clone_regression",
                "cloned",
                id="clone",
            ),
        ],
    )
    def test_it_fails_with_the_generic_message(
        self, client: TestClient, method: str, path: str, patched: str, answer_key: str
    ) -> None:
        from tests.api.error_reply_support import INTERNAL_ERROR_MESSAGE

        internal_text = "internal regression batch fault"
        regression_id = str(uuid.uuid4())
        with patch(patched, side_effect=ValueError(internal_text)):
            response = client.request(method, path, json=[regression_id])

        assert response.status_code == 200, response.text
        assert response.json() == {
            answer_key: [],
            "failed": [{"index": 0, "error": INTERNAL_ERROR_MESSAGE}],
        }
        assert internal_text not in response.text
