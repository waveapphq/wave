"""Unit tests for execution control and monitoring endpoints (REQ-5.2.4.6).

This module tests the execution control and monitoring endpoints providing lifecycle
operations for test, suite, regression, block, and plugin executions enabling
initiation, state management, progress tracking, and observability.

Test Coverage:
- Lifecycle Management: Create, get, list executions with unique identifiers
- State Transitions: Pause, resume, stop, cancel (DELETE) with state machine validation
- Progress Tracking: Current position, percentage completion at plugin boundaries
- Runtime Variable Snapshot: Current variable state during execution with secret masking
- Log Retrieval: Timestamped entries with severity levels and source attribution
- Timeline Analysis: Per-block timing, durations, and completion status
- Execution History: Entity-specific previous executions with pagination
- Statistics Aggregation: Total counts, success/failure rates, duration metrics
- Listing and Filtering: Status, type, entity, temporal range filters with pagination
- Plugin Testing: Isolated plugin execution outside workflow context
- Error Handling: Not found, conflict (invalid state transitions), bad request
- Concurrency Management: Independent variable scopes, execution isolation
"""

import io
import re
import uuid
import zipfile
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.api.download_name_helpers import EXPORT_STEM, assert_whole_name
from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException

# Valid execution states as defined in OpenAPI spec
VALID_EXECUTION_STATES = [
    "running",
    "paused",
    "passed",
    "failed",
    "stopped",
]

# Valid entity types for executions
VALID_ENTITY_TYPES = ["test", "suite", "regression"]

# Shared environment ID used across endpoint tests
TEST_ENVIRONMENT_ID = "env-00000000-0000-0000-0000-000000000001"


class TestListExecutionsEndpoint:
    """Test suite for GET /executions endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_execution_users_endpoint(self, client: TestClient) -> None:
        """Test that GET /executions/users returns unique triggered_by values."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_execution_users"
        ) as mock_users:
            mock_users.return_value = ["alice", "bob", "carol"]
            response = client.get("/executions/users")
            assert response.status_code == 200
            data = response.json()
            assert data["data"] == ["alice", "bob", "carol"]
            mock_users.assert_called_once()

    def test_list_executions_returns_200_with_executions(self, client: TestClient) -> None:
        """Test that GET /executions returns list of executions."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [
                    {
                        "id": execution_id,
                        "type": "test",
                        "entity_id": entity_id,
                        "status": "running",
                        "progress": {"current": 5, "total": 10, "percentage": 50.0},
                        "started_at": "2024-01-01T00:00:00Z",
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/executions")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 1
            assert data["data"][0]["status"] == "running"
            mock_list.assert_called_once()

    def test_list_executions_returns_empty_list_when_no_executions(
        self, client: TestClient
    ) -> None:
        """Test that GET /executions returns empty list when no executions exist."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/executions")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_executions_includes_response_metadata(self, client: TestClient) -> None:
        """Test that GET /executions response includes standard metadata."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/executions")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]
            assert "timestamp" in data["meta"]

    def test_list_executions_includes_pagination_info(self, client: TestClient) -> None:
        """Test that GET /executions includes pagination information."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 100,
                "page": 2,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/executions?page=2&per_page=20")

            assert response.status_code == 200
            data = response.json()
            assert "pagination" in data
            assert data["pagination"]["total"] == 100
            assert data["pagination"]["page"] == 2
            assert data["pagination"]["per_page"] == 20

    @pytest.mark.parametrize("status", VALID_EXECUTION_STATES)
    def test_list_executions_filters_by_status(self, client: TestClient, status: str) -> None:
        """Test that GET /executions filters by status parameter."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get(f"/executions?status={status}")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            # Route parses comma-separated list (even single value becomes list)
            assert call_kwargs.get("status") == [status]

    @pytest.mark.parametrize("entity_type", VALID_ENTITY_TYPES)
    def test_list_executions_filters_by_type(self, client: TestClient, entity_type: str) -> None:
        """Test that GET /executions filters by type parameter."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get(f"/executions?type={entity_type}")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            # Route parses comma-separated list (even single value becomes list)
            assert call_kwargs.get("entity_type") == [entity_type]

    def test_list_executions_filters_by_entity_id(self, client: TestClient) -> None:
        """Test that GET /executions filters by entity_id parameter."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get(f"/executions?entity_id={entity_id}")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("entity_id") == entity_id

    def test_list_executions_filters_by_date_range(self, client: TestClient) -> None:
        """Test that GET /executions filters by from_date and to_date parameters."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get(
                "/executions?from_date=2024-01-01T00:00:00Z&to_date=2024-01-31T23:59:59Z"
            )

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("from_date") is not None
            assert call_kwargs.get("to_date") is not None


class TestStartExecutionEndpoint:
    """Test suite for POST /executions endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_start_execution_returns_201_on_success(self, client: TestClient) -> None:
        """Test that POST /executions creates execution and returns 201."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "environment_id": TEST_ENVIRONMENT_ID,
                "status": "pending",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/executions",
                json={
                    "type": "test",
                    "id": entity_id,
                    "environment_id": TEST_ENVIRONMENT_ID,
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == execution_id
            assert data["data"]["status"] == "pending"

    def test_start_execution_requires_type_field(self, client: TestClient) -> None:
        """Test that POST /executions requires 'type' field."""
        entity_id = str(uuid.uuid4())

        response = client.post(
            "/executions",
            json={"id": entity_id, "environment_id": TEST_ENVIRONMENT_ID},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'type' is required$",
            data["error"]["message"],
        )

    def test_start_execution_requires_id_field(self, client: TestClient) -> None:
        """Test that POST /executions requires 'id' field."""
        response = client.post(
            "/executions",
            json={"type": "test", "environment_id": TEST_ENVIRONMENT_ID},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'id' is required$",
            data["error"]["message"],
        )

    @pytest.mark.parametrize("entity_type", VALID_ENTITY_TYPES)
    def test_start_execution_accepts_valid_types(
        self, client: TestClient, entity_type: str
    ) -> None:
        """Test that POST /executions accepts all valid entity types."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.return_value = {
                "id": execution_id,
                "type": entity_type,
                "entity_id": entity_id,
                "status": "pending",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/executions",
                json={
                    "type": entity_type,
                    "id": entity_id,
                    "environment_id": TEST_ENVIRONMENT_ID,
                },
            )

            assert response.status_code == 201

    def test_start_execution_validates_type_enum(self, client: TestClient) -> None:
        """Test that POST /executions validates type against allowed values."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.side_effect = ValidationException(
                "Invalid entity type 'invalid': valid types are test, suite, regression"
            )

            response = client.post(
                "/executions",
                json={
                    "type": "invalid",
                    "id": entity_id,
                    "environment_id": TEST_ENVIRONMENT_ID,
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Invalid entity type" in data["error"]["message"]

    def test_start_execution_returns_404_when_entity_not_found(self, client: TestClient) -> None:
        """Test that POST /executions returns 404 when entity does not exist."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.side_effect = LookupError(f"Test with ID '{entity_id}' not found")

            response = client.post(
                "/executions",
                json={
                    "type": "test",
                    "id": entity_id,
                    "environment_id": TEST_ENVIRONMENT_ID,
                },
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_start_execution_accepts_optional_version(self, client: TestClient) -> None:
        """Test that POST /executions accepts optional version parameter."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "entity_version": "1.2.3",
                "status": "pending",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/executions",
                json={
                    "type": "test",
                    "id": entity_id,
                    "environment_id": TEST_ENVIRONMENT_ID,
                    "version": "1.2.3",
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["entity_version"] == "1.2.3"

    def test_start_execution_accepts_optional_profile(self, client: TestClient) -> None:
        """Test that POST /executions accepts optional profile parameter."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.return_value = {
                "id": execution_id,
                "type": "regression",
                "entity_id": entity_id,
                "status": "pending",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/executions",
                json={
                    "type": "regression",
                    "id": entity_id,
                    "environment_id": TEST_ENVIRONMENT_ID,
                    "profile": profile_id,
                },
            )

            assert response.status_code == 201
            mock_start.assert_called_once()
            call_kwargs = mock_start.call_args[1]
            assert call_kwargs.get("profile_id") == profile_id

    def test_start_execution_accepts_variable_overrides(self, client: TestClient) -> None:
        """Test that POST /executions accepts variable overrides."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "status": "pending",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/executions",
                json={
                    "type": "test",
                    "id": entity_id,
                    "environment_id": TEST_ENVIRONMENT_ID,
                    "variables": {"env": "staging", "timeout": 60},
                },
            )

            assert response.status_code == 201
            mock_start.assert_called_once()
            call_kwargs = mock_start.call_args[1]
            assert call_kwargs.get("variables") == {"env": "staging", "timeout": 60}

    def test_start_execution_requires_environment_id(self, client: TestClient) -> None:
        """Test that POST /executions without environment_id is rejected as validation error."""
        entity_id = str(uuid.uuid4())

        response = client.post(
            "/executions",
            json={
                "type": "test",
                "id": entity_id,
            },
        )

        # Middleware normalizes Pydantic 422 to 400 validation error response
        assert response.status_code in (400, 422)

    def test_start_execution_with_environment_id(self, client: TestClient) -> None:
        """Test that POST /executions with valid environment_id creates execution."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())
        environment_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "environment_id": environment_id,
                "status": "pending",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/executions",
                json={
                    "type": "test",
                    "id": entity_id,
                    "environment_id": environment_id,
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["environment_id"] == environment_id
            mock_start.assert_called_once()
            call_kwargs = mock_start.call_args[1]
            assert call_kwargs.get("environment_id") == environment_id

    def test_start_execution_invalid_environment_id(self, client: TestClient) -> None:
        """Test that POST /executions with non-existent environment_id returns 404."""
        entity_id = str(uuid.uuid4())
        bad_env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.side_effect = LookupError(f"Environment with ID '{bad_env_id}' not found")

            response = client.post(
                "/executions",
                json={
                    "type": "test",
                    "id": entity_id,
                    "environment_id": bad_env_id,
                },
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_start_execution_environment_id_in_response(self, client: TestClient) -> None:
        """Test that environment_id is included in execution detail response."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())
        environment_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "environment_id": environment_id,
                "status": "pending",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/executions",
                json={
                    "type": "test",
                    "id": entity_id,
                    "environment_id": environment_id,
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["environment_id"] == environment_id

    def test_start_execution_environment_id_in_list(self, client: TestClient) -> None:
        """Test that environment_id appears in execution list response."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())
        environment_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [
                    {
                        "id": execution_id,
                        "type": "test",
                        "entity_id": entity_id,
                        "environment_id": environment_id,
                        "status": "pending",
                        "started_at": "2024-01-01T00:00:00Z",
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/executions")

            assert response.status_code == 200
            data = response.json()
            assert data["data"][0]["environment_id"] == environment_id


class TestGetExecutionEndpoint:
    """Test suite for GET /executions/{execution_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_execution_returns_200_with_execution(self, client: TestClient) -> None:
        """Test that GET /executions/{execution_id} returns execution details."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution"
        ) as mock_get:
            mock_get.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "status": "running",
                "progress": {"current": 5, "total": 10, "percentage": 50.0},
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.get(f"/executions/{execution_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == execution_id
            assert data["data"]["status"] == "running"
            mock_get.assert_called_once_with(execution_id)

    def test_get_execution_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /executions/{execution_id} returns 404 when not found."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/executions/{execution_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Execution with ID '{execution_id}' not found$",
                data["error"]["message"],
            )

    def test_get_execution_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /executions/{execution_id} validates UUID format."""
        response = client.get("/executions/invalid-uuid-format")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for execution_id: 'invalid-uuid-format'$",
            data["error"]["message"],
        )

    def test_get_execution_includes_progress_information(self, client: TestClient) -> None:
        """Test that GET /executions/{execution_id} includes progress info."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution"
        ) as mock_get:
            mock_get.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "status": "running",
                "progress": {"current": 7, "total": 10, "percentage": 70.0},
                "current_block": str(uuid.uuid4()),
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.get(f"/executions/{execution_id}")

            assert response.status_code == 200
            data = response.json()
            assert "progress" in data["data"]
            assert data["data"]["progress"]["current"] == 7
            assert data["data"]["progress"]["total"] == 10
            assert data["data"]["progress"]["percentage"] == 70.0

    def test_get_execution_includes_error_for_failed_execution(self, client: TestClient) -> None:
        """Test that GET /executions/{execution_id} includes error for failed."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution"
        ) as mock_get:
            mock_get.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "status": "failed",
                "started_at": "2024-01-01T00:00:00Z",
                "ended_at": "2024-01-01T00:01:00Z",
                "error": "Assertion failed: expected 200, got 500",
            }

            response = client.get(f"/executions/{execution_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["status"] == "failed"
            assert "error" in data["data"]
            assert "Assertion failed" in data["data"]["error"]


class TestDeleteExecutionEndpoint:
    """Test suite for DELETE /executions/{execution_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_execution_returns_204_on_success(self, client: TestClient) -> None:
        """Test that DELETE /executions/{execution_id} deletes completed execution."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.delete_execution"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/executions/{execution_id}")

            assert response.status_code == 204
            mock_delete.assert_called_once_with(execution_id)

    def test_delete_execution_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /executions/{execution_id} returns 404 when not found."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.delete_execution"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/executions/{execution_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_delete_execution_returns_409_for_running_execution(self, client: TestClient) -> None:
        """Test that DELETE returns 409 when deleting running execution."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.delete_execution"
        ) as mock_delete:
            mock_delete.side_effect = ConflictException(
                "Cannot delete execution in 'running' state. " "Stop the execution first."
            )

            response = client.delete(f"/executions/{execution_id}")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"
            assert "running" in data["error"]["message"]

    def test_delete_execution_with_invalid_uuid_returns_404(self, client: TestClient) -> None:
        """Test that DELETE /executions/{execution_id} with invalid UUID returns 404 (not found)."""
        # Delete skips UUID validation so invalid IDs can be cleaned up; unknown IDs get 404.
        response = client.delete("/executions/not-a-valid-uuid")

        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert "not found" in data["error"]["message"].lower()


class TestPauseExecutionEndpoint:
    """Test suite for PUT /executions/{execution_id}/pause endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_pause_execution_returns_200_on_success(self, client: TestClient) -> None:
        """Test that PUT /executions/{execution_id}/pause pauses execution."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.pause_execution"
        ) as mock_pause:
            mock_pause.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "status": "paused",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.put(f"/executions/{execution_id}/pause")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["status"] == "paused"
            mock_pause.assert_called_once_with(execution_id)

    def test_pause_execution_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PUT /executions/{execution_id}/pause returns 404 when not found."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.pause_execution"
        ) as mock_pause:
            mock_pause.return_value = None

            response = client.put(f"/executions/{execution_id}/pause")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_pause_execution_returns_409_for_non_running_execution(
        self, client: TestClient
    ) -> None:
        """Test that PUT /pause returns 409 when pausing non-running execution."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.pause_execution"
        ) as mock_pause:
            mock_pause.side_effect = ConflictException(
                "Cannot pause execution in 'pending' state. "
                "Valid source states for pause: running"
            )

            response = client.put(f"/executions/{execution_id}/pause")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"

    def test_pause_execution_validates_uuid_format(self, client: TestClient) -> None:
        """Test that PUT /executions/{execution_id}/pause validates UUID format."""
        response = client.put("/executions/bad-uuid/pause")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]


class TestResumeExecutionEndpoint:
    """Test suite for PUT /executions/{execution_id}/resume endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_resume_execution_returns_200_on_success(self, client: TestClient) -> None:
        """Test that PUT /executions/{execution_id}/resume resumes execution."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.resume_execution"
        ) as mock_resume:
            mock_resume.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "status": "running",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.put(f"/executions/{execution_id}/resume")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["status"] == "running"
            mock_resume.assert_called_once_with(execution_id)

    def test_resume_execution_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PUT /executions/{execution_id}/resume returns 404 when not found."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.resume_execution"
        ) as mock_resume:
            mock_resume.return_value = None

            response = client.put(f"/executions/{execution_id}/resume")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_resume_execution_returns_409_for_non_paused_execution(
        self, client: TestClient
    ) -> None:
        """Test that PUT /resume returns 409 when resuming non-paused execution."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.resume_execution"
        ) as mock_resume:
            mock_resume.side_effect = ConflictException(
                "Cannot resume execution in 'running' state. "
                "Valid source states for resume: paused"
            )

            response = client.put(f"/executions/{execution_id}/resume")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"

    def test_resume_preserves_variable_context(self, client: TestClient) -> None:
        """Test that resume preserves variable context from pause point."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.resume_execution"
        ) as mock_resume:
            mock_resume.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "status": "running",
                "started_at": "2024-01-01T00:00:00Z",
            }

            response = client.put(f"/executions/{execution_id}/resume")

            assert response.status_code == 200
            # The service is responsible for preserving context;
            # route just passes through the call
            mock_resume.assert_called_once_with(execution_id)


class TestStopExecutionEndpoint:
    """Test suite for PUT /executions/{execution_id}/stop endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_stop_execution_returns_200_on_success(self, client: TestClient) -> None:
        """Test that PUT /executions/{execution_id}/stop stops execution gracefully."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.stop_execution"
        ) as mock_stop:
            mock_stop.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "status": "passed",
                "started_at": "2024-01-01T00:00:00Z",
                "ended_at": "2024-01-01T00:01:00Z",
            }

            response = client.put(f"/executions/{execution_id}/stop")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            mock_stop.assert_called_once_with(execution_id)

    def test_stop_execution_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PUT /executions/{execution_id}/stop returns 404 when not found."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.stop_execution"
        ) as mock_stop:
            mock_stop.return_value = None

            response = client.put(f"/executions/{execution_id}/stop")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_stop_execution_allows_finalization_blocks(self, client: TestClient) -> None:
        """Test that stop allows finalization blocks to execute."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.stop_execution"
        ) as mock_stop:
            # Stop is graceful - allows finalization, status may be passed
            mock_stop.return_value = {
                "id": execution_id,
                "type": "test",
                "entity_id": entity_id,
                "status": "passed",  # Graceful termination
                "started_at": "2024-01-01T00:00:00Z",
                "ended_at": "2024-01-01T00:01:00Z",
            }

            response = client.put(f"/executions/{execution_id}/stop")

            assert response.status_code == 200
            data = response.json()
            # Graceful stop allows cleanup
            assert data["data"]["status"] in ["passed", "failed"]


class TestGetExecutionLogsEndpoint:
    """Cursor-paginated merged console log endpoint.

    ``GET /executions/{execution_id}/logs`` walks the execution's
    ``runs.yaml`` in reverse and collects up to ``limit`` entries older
    than ``before``. Returns ``{entries, prev_cursor}``.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_logs_returns_entries_and_cursor(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.paginate_execution_logs"
        ) as mock_paginate:
            mock_paginate.return_value = {
                "entries": [
                    {"run_id": "r1", "seq": 0, "level": "INFO", "message": "a"},
                    {"run_id": "r1", "seq": 1, "level": "ERROR", "message": "b"},
                ],
                "prev_cursor": "r1:0",
            }
            response = client.get(f"/executions/{execution_id}/logs?limit=2")
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]["entries"]) == 2
            assert data["data"]["prev_cursor"] == "r1:0"

    def test_get_logs_passes_cursor_through(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.paginate_execution_logs"
        ) as mock_paginate:
            mock_paginate.return_value = {"entries": [], "prev_cursor": None}
            response = client.get(f"/executions/{execution_id}/logs?before=7:3&limit=5")
            assert response.status_code == 200
            args = mock_paginate.call_args[0]
            assert args[1] == (7, 3)
            assert args[2] == 5

    def test_get_logs_accepts_not_in_child_cursor(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.paginate_execution_logs"
        ) as mock_paginate:
            mock_paginate.return_value = {"entries": [], "prev_cursor": None}
            response = client.get(f"/executions/{execution_id}/logs?before=4:x&limit=5")
            assert response.status_code == 200
            args = mock_paginate.call_args[0]
            assert args[1] == (4, None)

    def test_get_logs_rejects_malformed_cursor(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        response = client.get(f"/executions/{execution_id}/logs?before=garbage")
        assert response.status_code == 400

    def test_get_logs_returns_404_when_not_found(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.paginate_execution_logs"
        ) as mock_paginate:
            mock_paginate.return_value = None
            response = client.get(f"/executions/{execution_id}/logs")
            assert response.status_code == 404


class TestGetExecutionProgressEndpoint:
    """Test suite for GET /executions/{execution_id}/progress endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_progress_returns_200_with_progress(self, client: TestClient) -> None:
        """Test that GET /executions/{execution_id}/progress returns progress."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_progress"
        ) as mock_progress:
            mock_progress.return_value = {
                "current": 5,
                "total": 10,
                "percentage": 50.0,
            }

            response = client.get(f"/executions/{execution_id}/progress")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["current"] == 5
            assert data["data"]["total"] == 10
            assert data["data"]["percentage"] == 50.0
            mock_progress.assert_called_once_with(execution_id)

    def test_get_progress_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /executions/{execution_id}/progress returns 404."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_progress"
        ) as mock_progress:
            mock_progress.return_value = None

            response = client.get(f"/executions/{execution_id}/progress")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_get_progress_includes_eta(self, client: TestClient) -> None:
        """Test that progress may include ETA estimate."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_progress"
        ) as mock_progress:
            mock_progress.return_value = {
                "current": 5,
                "total": 10,
                "percentage": 50.0,
                "eta": "2024-01-01T00:05:00Z",
            }

            response = client.get(f"/executions/{execution_id}/progress")

            assert response.status_code == 200
            data = response.json()
            assert "eta" in data["data"]


class TestGetExecutionVariablesEndpoint:
    """Test suite for GET /executions/{execution_id}/variables endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_variables_returns_200_with_variables(self, client: TestClient) -> None:
        """Test that GET /executions/{execution_id}/variables returns runtime vars."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_variables"
        ) as mock_vars:
            mock_vars.return_value = {
                "env": "production",
                "api_response": {"status": 200, "data": "OK"},
                "counter": 42,
            }

            response = client.get(f"/executions/{execution_id}/variables")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["env"] == "production"
            assert data["data"]["counter"] == 42
            mock_vars.assert_called_once_with(execution_id)

    def test_get_variables_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /executions/{execution_id}/variables returns 404."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_variables"
        ) as mock_vars:
            mock_vars.return_value = None

            response = client.get(f"/executions/{execution_id}/variables")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_get_variables_masks_secrets(self, client: TestClient) -> None:
        """Test that GET /variables masks secret variables."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_variables"
        ) as mock_vars:
            mock_vars.return_value = {
                "username": "admin",
                "password": "********",
                "api_key": "********",
            }

            response = client.get(f"/executions/{execution_id}/variables")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["password"] == "********"
            assert data["data"]["api_key"] == "********"
            assert data["data"]["username"] == "admin"


class TestGetExecutionStatisticsEndpoint:
    """Test suite for GET /executions/statistics endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_statistics_returns_200_with_stats(self, client: TestClient) -> None:
        """Test that GET /executions/statistics returns aggregate statistics."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_statistics"
        ) as mock_stats:
            mock_stats.return_value = {
                "total_executions": 1000,
                "success_rate": 0.95,
                "failure_rate": 0.05,
                "average_duration_ms": 45000,
            }

            response = client.get("/executions/statistics")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["total_executions"] == 1000
            assert data["data"]["success_rate"] == 0.95
            mock_stats.assert_called_once()

    def test_get_statistics_filters_by_entity_type(self, client: TestClient) -> None:
        """Test that GET /statistics filters by entity_type."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_statistics"
        ) as mock_stats:
            mock_stats.return_value = {
                "total_executions": 500,
                "success_rate": 0.90,
                "failure_rate": 0.10,
                "average_duration_ms": 30000,
            }

            response = client.get("/executions/statistics?entity_type=test")

            assert response.status_code == 200
            mock_stats.assert_called_once()
            call_kwargs = mock_stats.call_args[1]
            assert call_kwargs.get("entity_type") == "test"

    def test_get_statistics_filters_by_entity_id(self, client: TestClient) -> None:
        """Test that GET /statistics filters by specific entity_id."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_statistics"
        ) as mock_stats:
            mock_stats.return_value = {
                "total_executions": 50,
                "success_rate": 0.98,
                "failure_rate": 0.02,
                "average_duration_ms": 25000,
            }

            response = client.get(f"/executions/statistics?entity_id={entity_id}")

            assert response.status_code == 200
            mock_stats.assert_called_once()
            call_kwargs = mock_stats.call_args[1]
            assert call_kwargs.get("entity_id") == entity_id

    def test_get_statistics_filters_by_date_range(self, client: TestClient) -> None:
        """Test that GET /statistics filters by date range."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_statistics"
        ) as mock_stats:
            mock_stats.return_value = {
                "total_executions": 200,
                "success_rate": 0.92,
                "failure_rate": 0.08,
                "average_duration_ms": 35000,
            }

            response = client.get(
                "/executions/statistics?"
                "from_date=2024-01-01T00:00:00Z&"
                "to_date=2024-01-31T23:59:59Z"
            )

            assert response.status_code == 200
            mock_stats.assert_called_once()
            call_kwargs = mock_stats.call_args[1]
            assert call_kwargs.get("from_date") is not None
            assert call_kwargs.get("to_date") is not None

    def test_get_statistics_includes_trends(self, client: TestClient) -> None:
        """Test that GET /statistics may include trend data."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_statistics"
        ) as mock_stats:
            mock_stats.return_value = {
                "total_executions": 1000,
                "success_rate": 0.95,
                "failure_rate": 0.05,
                "average_duration_ms": 45000,
                "trends": [
                    {"date": "2024-01-01", "success_rate": 0.93},
                    {"date": "2024-01-02", "success_rate": 0.95},
                    {"date": "2024-01-03", "success_rate": 0.97},
                ],
            }

            response = client.get("/executions/statistics")

            assert response.status_code == 200
            data = response.json()
            assert "trends" in data["data"]


class TestErrorHandling:
    """Test suite for error handling across execution endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_internal_error_returns_500_with_correlation_id(self, client: TestClient) -> None:
        """Test that internal errors return 500 with correlation identifier."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution"
        ) as mock_get:
            mock_get.side_effect = RuntimeError("Unexpected database error")

            response = client.get(f"/executions/{execution_id}")

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "request_id" in data["meta"]

    def test_malformed_json_returns_400(self, client: TestClient) -> None:
        """Test that malformed JSON returns 400 Bad Request."""
        response = client.post(
            "/executions",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )

        assert response.status_code == 400

    def test_conflict_error_includes_current_state(self, client: TestClient) -> None:
        """Test that state transition conflicts include current state info."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.pause_execution"
        ) as mock_pause:
            mock_pause.side_effect = ConflictException(
                "Cannot pause execution in 'passed' state. "
                "Valid source states for pause: running"
            )

            response = client.put(f"/executions/{execution_id}/pause")

            assert response.status_code == 409
            data = response.json()
            assert "passed" in data["error"]["message"]
            assert "running" in data["error"]["message"]


class TestStateTransitions:
    """Test suite for execution state machine transitions."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_pause_only_valid_from_running(self, client: TestClient) -> None:
        """Test that pause is only valid from running state."""
        execution_id = str(uuid.uuid4())

        for invalid_state in ["pending", "paused", "passed", "failed", "stopped"]:
            with patch(
                "wavecore.api.routes.executions.routes.execution_service.pause_execution"
            ) as mock_pause:
                mock_pause.side_effect = ConflictException(
                    f"Cannot pause execution in '{invalid_state}' state. "
                    f"Valid source states for pause: running"
                )

                response = client.put(f"/executions/{execution_id}/pause")

                assert response.status_code == 409

    def test_resume_only_valid_from_paused(self, client: TestClient) -> None:
        """Test that resume is only valid from paused state."""
        execution_id = str(uuid.uuid4())

        for invalid_state in ["pending", "running", "passed", "failed", "stopped"]:
            with patch(
                "wavecore.api.routes.executions.routes.execution_service.resume_execution"
            ) as mock_resume:
                mock_resume.side_effect = ConflictException(
                    f"Cannot resume execution in '{invalid_state}' state. "
                    f"Valid source states for resume: paused"
                )

                response = client.put(f"/executions/{execution_id}/resume")

                assert response.status_code == 409

    def test_stop_valid_from_running_and_paused(self, client: TestClient) -> None:
        """Test that stop is valid from running and paused states."""
        execution_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())

        for _valid_state in ["running", "paused"]:
            with patch(
                "wavecore.api.routes.executions.routes.execution_service.stop_execution"
            ) as mock_stop:
                mock_stop.return_value = {
                    "id": execution_id,
                    "type": "test",
                    "entity_id": entity_id,
                    "status": "passed",
                    "started_at": "2024-01-01T00:00:00Z",
                    "ended_at": "2024-01-01T00:01:00Z",
                }

                response = client.put(f"/executions/{execution_id}/stop")

                assert response.status_code == 200

    def test_delete_valid_from_terminal_states(self, client: TestClient) -> None:
        """Test that delete is valid from passed, failed, and stopped states."""
        execution_id = str(uuid.uuid4())

        for _terminal_state in ["passed", "failed", "stopped"]:
            with patch(
                "wavecore.api.routes.executions.routes.execution_service.delete_execution"
            ) as mock_delete:
                mock_delete.return_value = True

                response = client.delete(f"/executions/{execution_id}")

                assert response.status_code == 204


class TestStopExecutionInvalidStates:
    """Test suite for stop execution invalid state transitions."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_stop_execution_returns_409_for_pending_execution(self, client: TestClient) -> None:
        """Test that PUT /stop returns 409 when stopping pending execution."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.stop_execution"
        ) as mock_stop:
            mock_stop.side_effect = ConflictException(
                "Cannot stop execution in 'pending' state. "
                "Valid source states for stop: running, paused"
            )

            response = client.put(f"/executions/{execution_id}/stop")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"
            assert "pending" in data["error"]["message"]

    def test_stop_execution_returns_409_for_passed_execution(self, client: TestClient) -> None:
        """Test that PUT /stop returns 409 when stopping passed execution."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.stop_execution"
        ) as mock_stop:
            mock_stop.side_effect = ConflictException(
                "Cannot stop execution in 'passed' state. "
                "Valid source states for stop: running, paused"
            )

            response = client.put(f"/executions/{execution_id}/stop")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"

    def test_stop_execution_returns_409_for_failed_execution(self, client: TestClient) -> None:
        """Test that PUT /stop returns 409 when stopping failed execution."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.stop_execution"
        ) as mock_stop:
            mock_stop.side_effect = ConflictException(
                "Cannot stop execution in 'failed' state. "
                "Valid source states for stop: running, paused"
            )

            response = client.put(f"/executions/{execution_id}/stop")

            assert response.status_code == 409

    def test_stop_execution_returns_409_for_stopped_execution(self, client: TestClient) -> None:
        """Test that PUT /stop returns 409 when stopping already-stopped execution."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.stop_execution"
        ) as mock_stop:
            mock_stop.side_effect = ConflictException(
                "Cannot stop execution in 'stopped' state. "
                "Valid source states for stop: running, paused"
            )

            response = client.put(f"/executions/{execution_id}/stop")

            assert response.status_code == 409


class TestEntityExecutionHistoryEndpoints:
    """Test suite for entity-specific execution history endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_test_executions_returns_200_with_history(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/executions returns execution history."""
        test_id = str(uuid.uuid4())
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.get_test_executions"
        ) as mock_history:
            mock_history.return_value = {
                "executions": [
                    {
                        "id": execution_id,
                        "type": "test",
                        "entity_id": test_id,
                        "status": "passed",
                        "started_at": "2024-01-01T00:00:00Z",
                        "ended_at": "2024-01-01T00:01:00Z",
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get(f"/tests/{test_id}/executions")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 1
            assert data["data"][0]["entity_id"] == test_id
            mock_history.assert_called_once()

    def test_get_test_executions_returns_404_for_unknown_test(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/executions returns 404 for unknown test."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.get_test_executions"
        ) as mock_history:
            mock_history.return_value = None

            response = client.get(f"/tests/{test_id}/executions")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_get_test_executions_supports_pagination(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/executions supports pagination."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.get_test_executions"
        ) as mock_history:
            mock_history.return_value = {
                "executions": [],
                "total": 100,
                "page": 2,
                "per_page": 10,
            }

            response = client.get(f"/tests/{test_id}/executions?page=2&per_page=10")

            assert response.status_code == 200
            data = response.json()
            assert data["pagination"]["page"] == 2
            assert data["pagination"]["per_page"] == 10
            assert data["pagination"]["total"] == 100


class TestListExecutionsSortOrdering:
    """Test suite for list executions sort ordering."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_executions_sorts_by_started_at_desc(self, client: TestClient) -> None:
        """Test that GET /executions supports sort by started_at descending."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/executions?sort=started_at&order=desc")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("sort") == "started_at"
            assert call_kwargs.get("order") == "desc"

    def test_list_executions_sorts_by_started_at_asc(self, client: TestClient) -> None:
        """Test that GET /executions supports sort by started_at ascending."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/executions?sort=started_at&order=asc")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("sort") == "started_at"
            assert call_kwargs.get("order") == "asc"

    def test_list_executions_defaults_to_desc_order(self, client: TestClient) -> None:
        """Test that GET /executions defaults to descending order."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.list_executions"
        ) as mock_list:
            mock_list.return_value = {
                "executions": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/executions?sort=started_at")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs.get("order") in ["desc", None]


class TestStatisticsPercentileDurations:
    """Test suite for statistics percentile duration metrics."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_statistics_includes_percentile_durations(self, client: TestClient) -> None:
        """Test that GET /executions/statistics includes percentile durations."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_statistics"
        ) as mock_stats:
            mock_stats.return_value = {
                "total_executions": 1000,
                "success_rate": 0.95,
                "failure_rate": 0.05,
                "average_duration_ms": 45000,
                "p50_duration_ms": 40000,
                "p90_duration_ms": 80000,
                "p95_duration_ms": 95000,
                "p99_duration_ms": 120000,
            }

            response = client.get("/executions/statistics")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "p50_duration_ms" in data["data"]
            assert "p90_duration_ms" in data["data"]
            assert "p95_duration_ms" in data["data"]
            assert "p99_duration_ms" in data["data"]
            assert data["data"]["p50_duration_ms"] == 40000
            assert data["data"]["p95_duration_ms"] == 95000


class TestLogsCursorPagination:
    """Test suite for cursor-based log pagination over per-test storage."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_limit_above_bound_rejected(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        response = client.get(f"/executions/{execution_id}/logs?limit=5000")
        # FastAPI Query(ge=1, le=1000) rejects values above the bound.
        assert response.status_code in (400, 422)

    def test_prev_cursor_none_when_history_exhausted(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.paginate_execution_logs"
        ) as mock_paginate:
            mock_paginate.return_value = {"entries": [], "prev_cursor": None}
            response = client.get(f"/executions/{execution_id}/logs")
            assert response.status_code == 200
            assert response.json()["data"]["prev_cursor"] is None


class TestRouteOrdering:
    """Test suite for route ordering (static routes before parameterized)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_statistics_route_not_captured_as_execution_id(self, client: TestClient) -> None:
        """Test that /executions/statistics is not captured by /executions/{id}."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.get_execution_statistics"
        ) as mock_stats:
            mock_stats.return_value = {
                "total_executions": 100,
                "success_rate": 0.95,
                "failure_rate": 0.05,
                "average_duration_ms": 30000,
            }

            response = client.get("/executions/statistics")

            # Should hit get_execution_statistics, not get_execution
            assert response.status_code == 200
            data = response.json()
            assert "total_executions" in data["data"]
            mock_stats.assert_called_once()


class TestUUIDValidation:
    """Test suite for UUID validation across execution endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_execution_with_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test that GET /executions/{id} with invalid UUID returns 400."""
        response = client.get("/executions/invalid-uuid-format")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "uuid" in data["error"]["message"].lower()

    def test_delete_execution_with_invalid_uuid_returns_404(self, client: TestClient) -> None:
        """Test that DELETE /executions/{id} with invalid UUID returns 404 (not found)."""
        # Delete skips UUID validation so invalid IDs can be cleaned up; unknown IDs get 404.
        response = client.delete("/executions/not-a-uuid")

        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert "not found" in data["error"]["message"].lower()

    def test_pause_execution_with_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test that PUT /executions/{id}/pause with invalid UUID returns 400."""
        response = client.put("/executions/bad-uuid/pause")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "uuid" in data["error"]["message"].lower()

    def test_resume_execution_with_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test that PUT /executions/{id}/resume with invalid UUID returns 400."""
        response = client.put("/executions/xyz/resume")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "uuid" in data["error"]["message"].lower()

    def test_stop_execution_with_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test that PUT /executions/{id}/stop with invalid UUID returns 400."""
        response = client.put("/executions/abc123/stop")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "uuid" in data["error"]["message"].lower()

    def test_get_execution_logs_with_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test that GET /executions/{id}/logs with invalid UUID returns 400."""
        response = client.get("/executions/invalid/logs")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "uuid" in data["error"]["message"].lower()

    def test_get_execution_progress_with_invalid_uuid_returns_400(self, client: TestClient) -> None:
        """Test that GET /executions/{id}/progress with invalid UUID returns 400."""
        response = client.get("/executions/bad_id/progress")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "uuid" in data["error"]["message"].lower()

    def test_get_execution_variables_with_invalid_uuid_returns_400(
        self, client: TestClient
    ) -> None:
        """Test that GET /executions/{id}/variables with invalid UUID returns 400."""
        response = client.get("/executions/wrong/variables")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "uuid" in data["error"]["message"].lower()


class TestNonConflictValueErrors:
    """Test suite for non-CONFLICT ValueError exceptions that get re-raised."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_start_execution_non_conflict_valueerror_returns_400(self, client: TestClient) -> None:
        """Test that non-CONFLICT ValueError returns 400."""
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.start_execution"
        ) as mock_start:
            mock_start.side_effect = ValidationException("Invalid entity type")

            response = client.post(
                "/executions",
                json={
                    "entity_type": "test",
                    "entity_id": str(uuid.uuid4()),
                    "environment_id": TEST_ENVIRONMENT_ID,
                },
            )

            # Non-CONFLICT ValueError should be re-raised and return 400
            assert response.status_code == 400

    def test_pause_execution_non_conflict_valueerror_returns_500(self, client: TestClient) -> None:
        """Test that non-CONFLICT ValueError on pause gets re-raised as 500."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.pause_execution"
        ) as mock_pause:
            # ValidationException is caught by middleware and returns 400
            mock_pause.side_effect = ValidationException("Invalid execution ID")

            response = client.put(f"/executions/{execution_id}/pause")

            assert response.status_code == 400

    def test_resume_execution_non_conflict_valueerror_returns_500(self, client: TestClient) -> None:
        """Test that non-CONFLICT ValueError on resume gets re-raised as 500."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.resume_execution"
        ) as mock_resume:
            mock_resume.side_effect = ValidationException("Invalid execution ID")

            response = client.put(f"/executions/{execution_id}/resume")

            assert response.status_code == 400

    def test_stop_execution_non_conflict_valueerror_returns_500(self, client: TestClient) -> None:
        """Test that non-CONFLICT ValueError on stop gets re-raised as 500."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.stop_execution"
        ) as mock_stop:
            mock_stop.side_effect = ValidationException("Invalid execution ID")

            response = client.put(f"/executions/{execution_id}/stop")

            assert response.status_code == 400

    def test_delete_execution_non_conflict_valueerror_returns_500(self, client: TestClient) -> None:
        """Test that non-CONFLICT ValueError on delete gets re-raised as 500."""
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.executions.routes.execution_service.delete_execution"
        ) as mock_delete:
            # ValidationException is caught by middleware and returns 400
            mock_delete.side_effect = ValidationException("Invalid execution state")

            response = client.delete(f"/executions/{execution_id}")

            assert response.status_code == 400


class TestHistoricalTestCanvasEndpoint:
    """``GET /executions/history/{run_id}`` against the per-run storage.

    Payload is assembled from ``snapshots/<run_id>.yaml`` (workflow +
    block_states + variables) and ``logs/<run_id>.yaml``, with the
    parent execution's own environment/timing lookup.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def _seed_test_execution(
        self,
        test_id: str,
        status: str = "passed",
    ) -> str:
        from wavecore.api.services.executions import _storage as store

        execution_id = str(uuid.uuid4())
        record = {
            "id": execution_id,
            "run_id": execution_id,
            "name": "hist-canvas",
            "entity_type": "test",
            "entity_id": test_id,
            "environment_id": TEST_ENVIRONMENT_ID,
            "status": status,
            "started_at": "2026-04-18T10:00:00+00:00",
            "ended_at": "2026-04-18T10:00:05+00:00",
            "triggered_by": "dev",
        }
        store._execution_storage[execution_id] = record
        store._save_execution(record)
        composition = {
            "suites": [
                {
                    "id": None,
                    "name": "",
                    "tests": [{"id": test_id, "name": "T", "run_id": execution_id}],
                }
            ]
        }
        store._save_composition(execution_id, composition)
        store._init_runtime_state(execution_id, record["started_at"], composition, {execution_id})
        store._record_run_transition(
            execution_id,
            execution_id,
            status=status,
            started_at=record["started_at"],
            ended_at=record["ended_at"],
            duration=5.0,
        )
        store._save_snapshot(
            execution_id,
            execution_id,
            {
                "run_id": execution_id,
                "test_id": test_id,
                "status": status,
                "block_states": {"node-log": status},
                "variables": {"x": 42, "password": "hunter2"},
                "workflow": {
                    "nodes": [{"id": "node-start"}],
                    "edges": [{"id": "e1", "source": "node-start", "target": "node-log"}],
                },
            },
        )
        store._append_log(
            execution_id,
            execution_id,
            {"level": "INFO", "message": "hello", "source": "Log"},
        )
        return execution_id

    def _seed_suite_execution(self, suite_id: str, test_id: str) -> tuple[str, str]:
        from wavecore.api.services.executions import _storage as store

        exec_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        record = {
            "id": exec_id,
            "name": "suite-exec",
            "entity_type": "suite",
            "entity_id": suite_id,
            "environment_id": TEST_ENVIRONMENT_ID,
            "status": "passed",
            "started_at": "2026-04-18T10:00:00+00:00",
            "ended_at": "2026-04-18T10:00:05+00:00",
            "triggered_by": "dev",
        }
        store._execution_storage[exec_id] = record
        store._save_execution(record)
        composition = {
            "suites": [
                {
                    "id": suite_id,
                    "name": "S1",
                    "tests": [{"id": test_id, "name": "T", "run_id": run_id}],
                }
            ]
        }
        store._save_composition(exec_id, composition)
        store._init_runtime_state(exec_id, record["started_at"], composition, {run_id})
        store._record_run_dispatched(exec_id, run_id, test_id, suite_id)
        store._record_run_transition(
            exec_id,
            run_id,
            status="passed",
            started_at=record["started_at"],
            ended_at=record["ended_at"],
            duration=5.0,
        )
        store._save_snapshot(
            exec_id,
            run_id,
            {
                "run_id": run_id,
                "test_id": test_id,
                "status": "passed",
                "block_states": {"node-log": "passed"},
                "variables": {"suite_only": 1},
                "workflow": {"nodes": [], "edges": []},
            },
        )
        store._append_log(
            exec_id,
            run_id,
            {"level": "INFO", "message": "child", "source": "Log"},
        )
        return exec_id, run_id

    def test_returns_snapshot_payload_for_test_execution(self, client: TestClient) -> None:
        from wavecore.api.services.executions import _storage as store

        store._clear_storage()
        test_id = str(uuid.uuid4())
        execution_id = self._seed_test_execution(test_id, status="passed")

        response = client.get(f"/executions/history/{execution_id}")
        assert response.status_code == 200
        data = response.json().get("data")
        assert data["run_id"] == execution_id
        assert data["execution_id"] == execution_id
        assert data["test_id"] == test_id
        assert data["suite_id"] is None
        assert data["status"] == "passed"
        assert data["block_states"]["node-log"] == "passed"
        assert data["variables"]["x"] == 42
        # Snapshots serve what was written; names never trigger masking.
        assert data["variables"]["password"] == "hunter2"
        assert data["logs"][0]["message"] == "hello"
        assert data["logs"][0]["run_id"] == execution_id
        # Source test was never seeded - definitions fall back to {} so the
        # FE has nothing to render in the eye-OFF view (it then collapses
        # to the runtime snapshot, see HistoryVariableManager).
        assert data["variable_definitions"] == {}

    def test_returns_variable_definitions_when_source_test_exists(self, client: TestClient) -> None:
        """The source test's declarations come back under ``variable_definitions``."""
        from wavecore.api.services.executions import _storage as store
        from wavecore.api.services.tests import service as test_service

        store._clear_storage()
        test_service._clear_storage()

        test_id = str(uuid.uuid4())
        # Seed a real test entity carrying variable declarations - the
        # historical canvas will pull these via test_service.get_test_variables.
        test_service._save_test(
            {
                "id": test_id,
                "name": "Login smoke",
                "version": "1",
                "variables": {
                    "x": {"type": "integer", "value": 0, "scope": "test"},
                    "password": {
                        "type": "string",
                        "value": "letmein",
                        "scope": "test",
                        "secret": True,
                    },
                },
            }
        )

        execution_id = self._seed_test_execution(test_id, status="passed")

        response = client.get(f"/executions/history/{execution_id}")
        assert response.status_code == 200
        data = response.json().get("data")

        defs = data["variable_definitions"]
        assert set(defs.keys()) == {"x", "password"}
        assert defs["x"]["type"] == "integer"
        assert defs["x"]["value"] == 0
        # Secret-flagged DECLARATIONS mask at the API boundary; the runtime
        # snapshot serves what was written (masked on write when the run
        # carried a registry - this seed wrote raw; no name guessing).
        assert defs["password"]["secret"] is True
        assert defs["password"]["value"] == "********"
        # The runtime snapshot remains the eye-ON view.
        assert data["variables"]["x"] == 42
        assert data["variables"]["password"] == "hunter2"

    def test_returns_per_run_payload_for_suite_child(self, client: TestClient) -> None:
        from wavecore.api.services.executions import _storage as store

        store._clear_storage()
        suite_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())
        exec_id, run_id = self._seed_suite_execution(suite_id, test_id)

        response = client.get(f"/executions/history/{run_id}")
        assert response.status_code == 200
        data = response.json().get("data")
        assert data["run_id"] == run_id
        assert data["execution_id"] == exec_id
        assert data["test_id"] == test_id
        assert data["suite_id"] == suite_id
        assert data["status"] == "passed"
        assert data["variables"]["suite_only"] == 1
        assert data["logs"][0]["message"] == "child"

    def test_unknown_run_id_returns_404(self, client: TestClient) -> None:
        from wavecore.api.services.executions import _storage as store

        store._clear_storage()
        response = client.get(f"/executions/history/{uuid.uuid4()}")
        assert response.status_code == 404

    def test_resolves_suite_child_from_cold_cache(self, client: TestClient) -> None:
        from wavecore.api.services.executions import _storage as store

        store._clear_storage()
        suite_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())
        exec_id, run_id = self._seed_suite_execution(suite_id, test_id)
        # Drop only runtime-state cache so _locate_run must walk runs.yaml.
        store._runtime_state.clear()

        response = client.get(f"/executions/history/{run_id}")
        assert response.status_code == 200
        assert response.json()["data"]["execution_id"] == exec_id


class TestExportExecutionEndpoint:
    """Test suite for GET /executions/{execution_id}/export endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_export_json_streams_file_with_content_disposition(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        payload = '{"id": "x"}'
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.export_execution",
            return_value=(payload, "run-123.json"),
        ):
            response = client.get(f"/executions/{execution_id}/export?format=json")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert 'filename="run-123.json"' in response.headers["content-disposition"]
        assert response.text == payload

    def test_export_yaml_uses_yaml_content_type(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.export_execution",
            return_value=("id: x\n", "run-123.yaml"),
        ):
            response = client.get(f"/executions/{execution_id}/export?format=yaml")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-yaml")

    def test_export_rejects_invalid_execution_uuid(self, client: TestClient) -> None:
        response = client.get("/executions/not-a-uuid/export")
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "INVALID_UUID"

    def test_export_rejects_invalid_format(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        response = client.get(f"/executions/{execution_id}/export?format=xml")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "INVALID_PARAMETER"

    def test_export_rejects_invalid_test_id_csv_entry(self, client: TestClient) -> None:
        """A malformed element inside ``test_ids`` returns 400 with the
        invalid value echoed in the message."""
        execution_id = str(uuid.uuid4())
        good = str(uuid.uuid4())
        response = client.get(f"/executions/{execution_id}/export?test_ids={good},not-uuid")
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "INVALID_UUID"
        assert "not-uuid" in body["error"]["message"]

    def test_export_passes_parsed_test_ids_to_service(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        tid_a = str(uuid.uuid4())
        tid_b = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.export_execution",
            return_value=("{}", "f.json"),
        ) as mock_export:
            response = client.get(f"/executions/{execution_id}/export?test_ids={tid_a},{tid_b}")
        assert response.status_code == 200
        mock_export.assert_called_once()
        args = mock_export.call_args[0]
        assert args[1] == [tid_a, tid_b]

    def test_export_returns_404_when_service_raises_not_found(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.export_execution",
            side_effect=NotFoundException("missing test"),
        ):
            response = client.get(f"/executions/{execution_id}/export")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"

    def test_export_returns_404_when_service_returns_none(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.export_execution",
            return_value=None,
        ):
            response = client.get(f"/executions/{execution_id}/export")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"


def _recording_single_export(
    records: list[dict[str, Any]],
    results: dict[str, tuple[str, str] | None] | None = None,
) -> Any:
    """Build a fake single-export function recording its bound arguments.

    Returns per-id results from ``results`` when provided; otherwise a
    JSON body and filename derived from the execution id.
    """

    def fake(execution_id: str, test_ids: Any, format: str) -> tuple[str, str] | None:
        records.append(
            {
                "execution_id": execution_id,
                "test_ids": test_ids,
                "format": format,
            }
        )
        if results is not None:
            return results[execution_id]
        ext = "json" if format == "json" else "yaml"
        return (f'{{"id": "{execution_id}"}}', f"run-{execution_id[:8]}.{ext}")

    return fake


class TestBulkExportExecutionsEndpoint:
    """Test suite for POST /executions/export endpoint (REQ-5.2.4.9)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_single_id_returns_single_file_not_zip(self, client: TestClient) -> None:
        """One execution id downloads a single file whose body equals the
        single-export body."""
        execution_id = str(uuid.uuid4())
        payload = '{"id": "single"}'
        with patch(
            "wavecore.api.services.executions.service.export_execution",
            new=_recording_single_export([], {execution_id: (payload, "my-run.json")}),
        ):
            response = client.post("/executions/export", json={"execution_ids": [execution_id]})

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert 'filename="my-run.json"' in response.headers["content-disposition"]
        assert response.text == payload

    def test_single_id_yaml_format_uses_yaml_content_type(self, client: TestClient) -> None:
        """YAML format on a single id produces a YAML download."""
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.services.executions.service.export_execution",
            new=_recording_single_export([], {execution_id: ("id: single\n", "my-run.yaml")}),
        ):
            response = client.post(
                "/executions/export",
                json={"execution_ids": [execution_id], "format": "yaml"},
            )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-yaml")
        assert 'filename="my-run.yaml"' in response.headers["content-disposition"]

    def test_format_defaults_to_json_with_whole_execution(self, client: TestClient) -> None:
        """Omitted format defaults to json; each id exports the whole execution.

        Executions carry no secrets choice: snapshots are masked at write, so the
        export service takes no mask/secrets argument.
        """
        execution_id = str(uuid.uuid4())
        records: list[dict[str, Any]] = []
        with patch(
            "wavecore.api.services.executions.service.export_execution",
            new=_recording_single_export(records),
        ):
            response = client.post("/executions/export", json={"execution_ids": [execution_id]})

        assert response.status_code == 200
        assert records == [
            {
                "execution_id": execution_id,
                "test_ids": None,
                "format": "json",
            }
        ]

    def test_multiple_ids_return_zip_with_one_entry_per_execution(self, client: TestClient) -> None:
        """Two or more ids download a ZIP named executions-export.zip."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        results: dict[str, tuple[str, str] | None] = {
            id1: ('{"id": "first"}', "first-run.json"),
            id2: ('{"id": "second"}', "second-run.json"),
        }
        with patch(
            "wavecore.api.services.executions.service.export_execution",
            new=_recording_single_export([], results),
        ):
            response = client.post("/executions/export", json={"execution_ids": [id1, id2]})

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/zip")
        assert 'filename="executions-export.zip"' in response.headers["content-disposition"]
        zf = zipfile.ZipFile(io.BytesIO(response.content))
        assert sorted(zf.namelist()) == ["first-run.json", "second-run.json"]
        assert zf.read("first-run.json") == b'{"id": "first"}'
        assert zf.read("second-run.json") == b'{"id": "second"}'

    def test_zip_disambiguates_duplicate_filenames(self, client: TestClient) -> None:
        """Duplicate export filenames gain -2, -3 suffixes inside the ZIP."""
        ids = [str(uuid.uuid4()) for _ in range(3)]
        results: dict[str, tuple[str, str] | None] = {
            ids[0]: ('{"n": 1}', "run.json"),
            ids[1]: ('{"n": 2}', "run.json"),
            ids[2]: ('{"n": 3}', "run.json"),
        }
        with patch(
            "wavecore.api.services.executions.service.export_execution",
            new=_recording_single_export([], results),
        ):
            response = client.post("/executions/export", json={"execution_ids": ids})

        assert response.status_code == 200
        zf = zipfile.ZipFile(io.BytesIO(response.content))
        assert sorted(zf.namelist()) == ["run-2.json", "run-3.json", "run.json"]
        assert zf.read("run.json") == b'{"n": 1}'
        assert zf.read("run-2.json") == b'{"n": 2}'
        assert zf.read("run-3.json") == b'{"n": 3}'

    def test_empty_id_list_returns_400(self, client: TestClient) -> None:
        """An empty execution_ids list returns 400 with exact message."""
        response = client.post("/executions/export", json={"execution_ids": []})

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "execution_ids must be a non-empty list"

    def test_invalid_format_returns_400(self, client: TestClient) -> None:
        """Invalid format returns 400 with exact message."""
        response = client.post(
            "/executions/export",
            json={"execution_ids": [str(uuid.uuid4())], "format": "xml"},
        )

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"] == "Invalid format: 'xml'. Must be 'yaml' or 'json'"
        )

    def test_invalid_uuid_in_list_returns_400(self, client: TestClient) -> None:
        """A malformed id in execution_ids returns 400 with exact message."""
        response = client.post(
            "/executions/export",
            json={"execution_ids": [str(uuid.uuid4()), "not-a-uuid"]},
        )

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid UUID format for execution_id: 'not-a-uuid'"
        )

    def test_unknown_execution_returns_404(self, client: TestClient) -> None:
        """An id that resolves to no execution returns 404 with exact message."""
        execution_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.services.executions.service.export_execution",
            new=_recording_single_export([], {execution_id: None}),
        ):
            response = client.post("/executions/export", json={"execution_ids": [execution_id]})

        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "NOT_FOUND"
        assert body["error"]["message"] == f"Execution not found: {execution_id}"


class TestExportKeepsTheWholeFileName:
    """An export name with text outside plain ASCII is sent whole (REQ-4.6.9)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_single_export(self, client: TestClient) -> None:
        name = f"{EXPORT_STEM}.json"
        with patch(
            "wavecore.api.routes.executions.routes.execution_service.export_execution",
            return_value=('{"id": "x"}', name),
        ):
            response = client.get(f"/executions/{uuid.uuid4()}/export?format=json")

        assert_whole_name(response, name)

    def test_bulk_export_of_one(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())
        name = f"{EXPORT_STEM}.json"
        with patch(
            "wavecore.api.services.executions.service.export_execution",
            new=_recording_single_export([], {execution_id: ('{"id": "x"}', name)}),
        ):
            response = client.post("/executions/export", json={"execution_ids": [execution_id]})

        assert_whole_name(response, name)
