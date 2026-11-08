"""Unit tests for test workflow endpoints (REQ-5.2.4.3).

This module tests the test workflow endpoints providing lifecycle operations
for test entities enabling creation, modification, version control, workflow
management, variable configuration, and validation.

Test Coverage:
- CRUD operations: Create, Read, Update, Delete tests
- Batch operations: Create/update/delete multiple tests
- Version control: Version history tracking, semantic versioning, restore
- Workflow management: Workflow graph retrieval for visualization
- Variable management: Test-level variable declarations with scoping
- Validation: Workflow graph validation, block reference validation
- Clone operations: Test derivation through cloning
- Dependency analysis: Block references and version constraints
- Execution history: Links to past runs for trend analysis
- Error handling: Validation errors, conflicts, not found, internal errors
- Caching and performance: Multi-layer caching with TTL policies
- Concurrency control: Optimistic concurrency via ETag/If-Match headers
- Standalone workflow validation: POST /workflows/validate endpoint
- Detailed validation errors: Cycle detection, reachability, termination
- Variable binding completeness: Undeclared variable detection
- Parameter consistency: Type checking for block parameters
- Block version compatibility: Version constraint validation
- Validation warnings: Non-fatal issues returned alongside errors
- Computed variables: Expression syntax and reference validation
- Secret variable masking: Masked values in API responses
- Response envelope consistency: Standard {success, data, meta} format
"""

import re
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.api.body_shape_support import (
    NOT_ARRAY_BODIES,
    NOT_OBJECT_BODIES,
    assert_refused,
    send_text,
)


class TestListTestsEndpoint:
    """Test suite for GET /tests endpoint (list all tests)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_tests_returns_200_with_empty_list(self, client: TestClient) -> None:
        """Test that GET /tests returns 200 with empty list when no tests exist."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_tests") as mock_list:
            mock_list.return_value = {
                "tests": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/tests")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []
            assert data["pagination"]["total"] == 0
            assert data["pagination"]["page"] == 1
            assert data["pagination"]["per_page"] == 20
            assert data["pagination"]["total_pages"] == 0

    def test_list_tests_returns_200_with_tests(self, client: TestClient) -> None:
        """Test that GET /tests returns 200 with list of tests."""
        test1_id = str(uuid.uuid4())
        test2_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.list_tests") as mock_list:
            mock_list.return_value = {
                "tests": [
                    {
                        "id": test1_id,
                        "name": "Login Test",
                        "version": "1.0.0",
                        "description": "Test user login workflow",
                        "workflow": {"nodes": [], "edges": []},
                        "variables": {},
                        "metadata": {},
                        "created_at": now,
                        "updated_at": now,
                    },
                    {
                        "id": test2_id,
                        "name": "API Health Check",
                        "version": "1.2.0",
                        "description": "Verify API endpoints respond",
                        "workflow": {"nodes": [], "edges": []},
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

            response = client.get("/tests")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 2
            assert data["data"][0]["id"] == test1_id
            assert data["data"][0]["name"] == "Login Test"
            assert data["data"][1]["id"] == test2_id
            assert data["pagination"]["total"] == 2

    def test_list_tests_supports_page_based_pagination(self, client: TestClient) -> None:
        """Test that GET /tests supports page-based pagination (REQ-5.2.4.3)."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_tests") as mock_list:
            mock_list.return_value = {
                "tests": [],
                "total": 100,
                "page": 2,
                "per_page": 10,
                "total_pages": 10,
            }

            response = client.get("/tests?page=2&per_page=10")

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
                suite_ids=None,
                tags=None,
                status=None,
                sort_by=None,
                sort_order="asc",
            )

    def test_list_tests_supports_suite_ids_filter(self, client: TestClient) -> None:
        """Test that GET /tests supports filtering by suite_ids (REQ-5.2.4.3)."""
        suite_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.list_tests") as mock_list:
            mock_list.return_value = {
                "tests": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get(f"/tests?suite_ids={suite_id}")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search=None,
                suite_ids=[suite_id],
                tags=None,
                status=None,
                sort_by=None,
                sort_order="asc",
            )

    def test_list_tests_supports_tags_filter(self, client: TestClient) -> None:
        """Test that GET /tests supports filtering by tags (REQ-5.2.4.3)."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_tests") as mock_list:
            mock_list.return_value = {
                "tests": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            # Tags are sent comma-separated (matches other lists)
            response = client.get("/tests?tags=smoke,login")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search=None,
                suite_ids=None,
                tags=["smoke", "login"],
                status=None,
                sort_by=None,
                sort_order="asc",
            )

    def test_list_tests_supports_text_search(self, client: TestClient) -> None:
        """Test that GET /tests supports text search across names and descriptions."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_tests") as mock_list:
            mock_list.return_value = {
                "tests": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/tests?search=login")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search="login",
                suite_ids=None,
                tags=None,
                status=None,
                sort_by=None,
                sort_order="asc",
            )

    def test_list_tests_validates_suite_ids_format(self, client: TestClient) -> None:
        """Test that GET /tests validates suite_ids parameter as valid UUIDs."""
        response = client.get("/tests?suite_ids=invalid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for suite_id: 'invalid-uuid'$",
            data["error"]["message"],
        )

    def test_list_tests_supports_comma_separated_status_filter(self, client: TestClient) -> None:
        """Test that GET /tests parses comma-separated status values."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_tests") as mock_list:
            mock_list.return_value = {
                "tests": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/tests?status=passed,failed,never_run")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search=None,
                suite_ids=None,
                tags=None,
                status=["passed", "failed", "never_run"],
                sort_by=None,
                sort_order="asc",
            )

    def test_list_tests_validates_page_minimum(self, client: TestClient) -> None:
        """Test that GET /tests validates page parameter minimum value."""
        response = client.get("/tests?page=0")

        assert response.status_code == 400

    def test_list_tests_validates_per_page_maximum(self, client: TestClient) -> None:
        """Test that GET /tests validates per_page parameter maximum value."""
        response = client.get("/tests?per_page=101")

        assert response.status_code == 400

    def test_list_tests_sets_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /tests sets Cache-Control header (REQ-5.2.4.3)."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_tests") as mock_list:
            mock_list.return_value = {
                "tests": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/tests")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert "max-age=" in response.headers["Cache-Control"]


class TestCreateTestEndpoint:
    """Test suite for POST /tests endpoint (create new test)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_test_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /tests returns 201 when creating test with valid data."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "1.0.0",
                "description": "Test user login workflow",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/tests",
                json={
                    "name": "Login Test",
                    "description": "Test user login workflow",
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == test_id
            assert data["data"]["name"] == "Login Test"
            assert data["data"]["version"] == "1.0.0"

    def test_create_test_requires_name_field(self, client: TestClient) -> None:
        """Test that POST /tests returns 400 when name field is missing."""
        response = client.post(
            "/tests",
            json={"description": "Some description"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(r"^Field 'name' is required$", data["error"]["message"])

    def test_create_test_validates_name_length(self, client: TestClient) -> None:
        """Test that POST /tests validates test name length."""
        response = client.post(
            "/tests",
            json={"name": "A" * 256},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Test name must be between 1 and 255 characters$",
            data["error"]["message"],
        )

    def test_create_test_allows_special_characters_in_name(self, client: TestClient) -> None:
        """Test that POST /tests allows special characters in test name.

        Naming restrictions removed - all characters are valid.
        Future: REQ-6.4.1 will add proper sanitization for security.
        """
        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.return_value = {
                "id": "test-123",
                "name": "Test@Name!With#Special$Chars",
                "version": 1,
            }

            response = client.post(
                "/tests",
                json={"name": "Test@Name!With#Special$Chars"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Test@Name!With#Special$Chars"

    def test_create_test_returns_409_when_name_exists(self, client: TestClient) -> None:
        """Test that POST /tests returns 409 when test name already exists."""
        from wavecore.api.exceptions import ConflictException

        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.side_effect = ConflictException(
                "Test with name 'Login Test' already exists"
            )

            response = client.post(
                "/tests",
                json={"name": "Login Test"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Test with name 'Login Test' already exists$",
                data["error"]["message"],
            )

    def test_create_test_returns_422_on_save_validation_error(self, client: TestClient) -> None:
        """Cover the SaveValidationError branch on POST /tests."""
        from wavecore.api.services.tests.service import SaveValidationError

        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.side_effect = SaveValidationError(
                [{"code": "FOO", "message": "Body invalid", "severity": "error"}]
            )
            response = client.post("/tests", json={"name": "X"})
            assert response.status_code == 422
            assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_create_test_accepts_workflow_definition(self, client: TestClient) -> None:
        """Test that POST /tests accepts workflow graph definition."""
        test_id = str(uuid.uuid4())
        start_node_id = str(uuid.uuid4())
        end_node_id = str(uuid.uuid4())
        edge_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "1.0.0",
                "description": "Test user login workflow",
                "workflow": {
                    "nodes": [
                        {"id": start_node_id, "type": "start"},
                        {"id": end_node_id, "type": "end"},
                    ],
                    "edges": [
                        {"id": edge_id, "source": start_node_id, "target": end_node_id},
                    ],
                },
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/tests",
                json={
                    "name": "Login Test",
                    "workflow": {
                        "nodes": [
                            {"id": start_node_id, "type": "start"},
                            {"id": end_node_id, "type": "end"},
                        ],
                        "edges": [
                            {"id": edge_id, "source": start_node_id, "target": end_node_id},
                        ],
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert len(data["data"]["workflow"]["nodes"]) == 2
            assert len(data["data"]["workflow"]["edges"]) == 1

    def test_create_test_accepts_variables(self, client: TestClient) -> None:
        """Test that POST /tests accepts variable declarations."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {
                    "username": {"type": "string", "value": "testuser"},
                    "timeout": {"type": "integer", "value": 30},
                },
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/tests",
                json={
                    "name": "Login Test",
                    "variables": {
                        "username": {"type": "string", "value": "testuser"},
                        "timeout": {"type": "integer", "value": 30},
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert "username" in data["data"]["variables"]
            assert "timeout" in data["data"]["variables"]

    def test_create_test_accepts_metadata(self, client: TestClient) -> None:
        """Test that POST /tests accepts metadata."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {"author": "test-user", "tags": ["smoke", "login"]},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/tests",
                json={
                    "name": "Login Test",
                    "metadata": {"author": "test-user", "tags": ["smoke", "login"]},
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["metadata"]["author"] == "test-user"
            assert data["data"]["metadata"]["tags"] == ["smoke", "login"]

    def test_create_test_sets_cache_invalidation_header(self, client: TestClient) -> None:
        """Test that POST /tests sets cache invalidation header (REQ-5.2.4.3)."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/tests",
                json={"name": "Login Test"},
            )

            assert response.status_code == 201
            assert "X-Cache-Invalidated" in response.headers
            assert response.headers["X-Cache-Invalidated"] == "tests_list"


class TestBatchCreateTestsEndpoint:
    """Test suite for POST /tests/batch endpoint (batch create tests)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_batch_create_tests_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /tests/batch returns 201 when creating multiple tests."""
        test1_id = str(uuid.uuid4())
        test2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.batch_create_tests"
        ) as mock_batch:
            mock_batch.return_value = {
                "created": [test1_id, test2_id],
                "failed": [],
            }

            response = client.post(
                "/tests/batch",
                json=[
                    {"name": "Login Test"},
                    {"name": "Logout Test"},
                ],
            )

            assert response.status_code == 201
            data = response.json()
            assert len(data["created"]) == 2
            assert test1_id in data["created"]
            assert test2_id in data["created"]
            assert len(data["failed"]) == 0

    def test_batch_create_tests_returns_partial_success(self, client: TestClient) -> None:
        """Test that POST /tests/batch handles partial failures."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.batch_create_tests"
        ) as mock_batch:
            mock_batch.return_value = {
                "created": [test_id],
                "failed": [{"index": 1, "error": "Test with name 'Duplicate' already exists"}],
            }

            response = client.post(
                "/tests/batch",
                json=[
                    {"name": "New Test"},
                    {"name": "Duplicate"},
                ],
            )

            assert response.status_code == 201
            data = response.json()
            assert len(data["created"]) == 1
            assert len(data["failed"]) == 1
            assert data["failed"][0]["index"] == 1

    def test_a_refused_save_is_reported_in_failed(self, client: TestClient) -> None:
        changing = {
            "rows": {"type": "array", "value": [1]},
            "sneaky": {"type": "string", "value": "rows.append(9)", "isExpression": True},
        }

        response = client.post(
            "/tests/batch",
            json=[{"name": "Changing Test", "variables": changing}],
        )

        assert response.status_code == 201
        assert response.json() == {
            "created": [],
            "failed": [
                {
                    "index": 0,
                    "error": "The append method changes data. An expression can only read "
                    "data, not change it. To change a variable, add a Variable Setter Block. "
                    "Variable: sneaky.",
                }
            ],
        }


class TestBatchUpdateTestsEndpoint:
    """Test suite for PATCH /tests/batch endpoint (batch update tests)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_batch_update_tests_returns_200_with_valid_data(self, client: TestClient) -> None:
        """Test that PATCH /tests/batch returns 200 when updating multiple tests."""
        test1_id = str(uuid.uuid4())
        test2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.batch_update_tests"
        ) as mock_batch:
            mock_batch.return_value = {
                "updated": [test1_id, test2_id],
                "failed": [],
            }

            response = client.patch(
                "/tests/batch",
                json=[
                    {"id": test1_id, "update": {"description": "Updated description 1"}},
                    {"id": test2_id, "update": {"description": "Updated description 2"}},
                ],
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["updated"]) == 2
            assert len(data["failed"]) == 0

    def test_batch_update_tests_handles_not_found(self, client: TestClient) -> None:
        """Test that PATCH /tests/batch handles tests not found."""
        test_id = str(uuid.uuid4())
        missing_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.batch_update_tests"
        ) as mock_batch:
            mock_batch.return_value = {
                "updated": [test_id],
                "failed": [{"index": 1, "error": f"Test with ID '{missing_id}' not found"}],
            }

            response = client.patch(
                "/tests/batch",
                json=[
                    {"id": test_id, "update": {"description": "Updated"}},
                    {"id": missing_id, "update": {"description": "Updated"}},
                ],
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["updated"]) == 1
            assert len(data["failed"]) == 1


class TestBatchDeleteTestsEndpoint:
    """Test suite for DELETE /tests/batch endpoint (batch delete tests)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_batch_delete_tests_returns_200_when_successful(self, client: TestClient) -> None:
        """Test that DELETE /tests/batch returns 200 when deleting multiple tests."""
        test1_id = str(uuid.uuid4())
        test2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.batch_delete_tests"
        ) as mock_batch:
            mock_batch.return_value = {
                "deleted": [test1_id, test2_id],
                "failed": [],
            }

            response = client.request(
                "DELETE",
                "/tests/batch",
                json=[test1_id, test2_id],
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["deleted"]) == 2
            assert len(data["failed"]) == 0

    def test_batch_delete_tests_handles_dependencies(self, client: TestClient) -> None:
        """Test that DELETE /tests/batch handles tests with suite dependencies."""
        test1_id = str(uuid.uuid4())
        test2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.batch_delete_tests"
        ) as mock_batch:
            mock_batch.return_value = {
                "deleted": [test1_id],
                "failed": [
                    {
                        "index": 1,
                        "error": f"Cannot delete test '{test2_id}': 2 suites reference it",
                    }
                ],
            }

            response = client.request(
                "DELETE",
                "/tests/batch",
                json=[test1_id, test2_id],
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["deleted"]) == 1
            assert len(data["failed"]) == 1


class TestGetTestEndpoint:
    """Test suite for GET /tests/{test_id} endpoint (get test by ID)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_test_returns_200_with_valid_id(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id} returns 200 with test details."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.get_test") as mock_get:
            mock_get.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "1.0.0",
                "description": "Test user login workflow",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/tests/{test_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == test_id
            assert data["data"]["name"] == "Login Test"

    def test_get_test_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id} returns 404 when test does not exist."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test") as mock_get:
            mock_get.return_value = None

            response = client.get(f"/tests/{test_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_get_test_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id} validates test_id is valid UUID."""
        response = client.get("/tests/invalid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )

    def test_get_test_returns_etag_header(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id} returns ETag header for concurrency control."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.get_test") as mock_get:
            mock_get.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/tests/{test_id}")

            assert response.status_code == 200
            assert "ETag" in response.headers


class TestUpdateTestEndpoint:
    """Test suite for PUT /tests/{test_id} endpoint (update test)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_test_returns_200_with_valid_data(self, client: TestClient) -> None:
        """Test that PUT /tests/{test_id} returns 200 when update succeeds."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.update_test") as mock_update:
            mock_update.return_value = {
                "id": test_id,
                "name": "Updated Login Test",
                "version": "1.1.0",
                "description": "Updated description",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/tests/{test_id}",
                json={
                    "name": "Updated Login Test",
                    "description": "Updated description",
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Updated Login Test"
            assert data["data"]["version"] == "1.1.0"

    def test_update_test_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PUT /tests/{test_id} returns 404 when test does not exist."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.update_test") as mock_update:
            mock_update.return_value = None

            response = client.put(
                f"/tests/{test_id}",
                json={"name": "Updated Name"},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_update_test_validates_uuid_format(self, client: TestClient) -> None:
        """Test that PUT /tests/{test_id} validates test_id is valid UUID."""
        response = client.put(
            "/tests/invalid-uuid",
            json={"name": "Updated Name"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )

    def test_update_test_allows_special_characters_in_name(self, client: TestClient) -> None:
        """Test that PUT /tests/{test_id} allows special characters in name.

        Naming restrictions removed - all characters are valid.
        Future: REQ-6.4.1 will add proper sanitization for security.
        """
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.update_test") as mock_update:
            mock_update.return_value = {
                "id": test_id,
                "name": "Test@Name!With#Chars",
                "version": 2,
            }

            response = client.put(
                f"/tests/{test_id}",
                json={"name": "Test@Name!With#Chars"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Test@Name!With#Chars"

    def test_update_test_returns_422_on_save_validation_error(self, client: TestClient) -> None:
        """Test that PUT /tests/{test_id} returns 422 when SaveValidationError is raised."""
        from wavecore.api.services.tests.service import SaveValidationError

        test_id = str(uuid.uuid4())
        errors = [{"code": "UNDECLARED_VARIABLE", "message": "Variable 'x' not declared"}]

        with patch("wavecore.api.routes.tests.routes.test_service.update_test") as mock_update:
            mock_update.side_effect = SaveValidationError(errors)

            response = client.put(
                f"/tests/{test_id}",
                json={"name": "Trigger Save Validation"},
            )

            assert response.status_code == 422
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "VALIDATION_ERROR"
            assert len(data["error"]["details"]) == 1
            assert data["error"]["details"][0]["code"] == "UNDECLARED_VARIABLE"

    def test_update_test_returns_409_for_a_name_another_test_holds(
        self, client: TestClient
    ) -> None:
        """PUT /tests/{test_id} refuses a rename onto another Test's name."""
        client.post("/tests", json={"name": "Taken Name"})
        own_id = client.post("/tests", json={"name": "Own Name"}).json()["data"]["id"]

        response = client.put(f"/tests/{own_id}", json={"name": "Taken Name"})

        assert response.status_code == 409
        assert response.json() == {
            "success": False,
            "error": {"message": "Test with name 'Taken Name' already exists", "code": "CONFLICT"},
        }
        assert client.get(f"/tests/{own_id}").json()["data"]["name"] == "Own Name"


class TestUpdateTestMetadataEndpoint:
    """Test suite for PATCH /tests/{test_id}/metadata endpoint (update metadata only)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_metadata_returns_200_when_successful(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/metadata returns 200 with updated test."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_metadata"
        ) as mock_update:
            mock_update.return_value = {
                "id": test_id,
                "name": "Updated Test",
                "description": "New description",
                "version": "1.0.0",  # Version should NOT increment
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {"tags": ["tag1"], "suite_id": None},
                "created_at": now,
                "updated_at": now,
            }

            response = client.patch(
                f"/tests/{test_id}/metadata",
                json={"name": "Updated Test", "description": "New description", "tags": ["tag1"]},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Updated Test"
            assert data["data"]["description"] == "New description"
            assert data["data"]["version"] == "1.0.0"  # Version unchanged

    def test_update_metadata_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/metadata returns 404 when test not found."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_metadata"
        ) as mock_update:
            mock_update.return_value = None

            response = client.patch(
                f"/tests/{test_id}/metadata",
                json={"name": "Updated Test"},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_update_metadata_validates_uuid_format(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/metadata validates UUID format."""
        response = client.patch(
            "/tests/invalid-uuid/metadata",
            json={"name": "Updated Test"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )

    def test_update_metadata_allows_special_characters_in_name(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/metadata allows special characters.

        Naming restrictions removed - all characters are valid.
        Future: REQ-6.4.1 will add proper sanitization for security.
        """
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_metadata"
        ) as mock_update:
            mock_update.return_value = {
                "id": test_id,
                "name": "Test@Name!With#Chars",
                "version": 1,
            }

            response = client.patch(
                f"/tests/{test_id}/metadata",
                json={"name": "Test@Name!With#Chars"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Test@Name!With#Chars"

    def test_update_metadata_returns_409_for_duplicate_name(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/metadata returns 409 for duplicate name."""
        from wavecore.api.exceptions import ConflictException

        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_metadata"
        ) as mock_update:
            mock_update.side_effect = ConflictException(
                "Test with name 'Existing Test' already exists"
            )

            response = client.patch(
                f"/tests/{test_id}/metadata",
                json={"name": "Existing Test"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "already exists" in data["error"]["message"]

    def test_update_metadata_returns_412_for_precondition_failed(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/metadata returns 412 for ETag mismatch."""
        from wavecore.api.exceptions import ConflictException

        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_metadata"
        ) as mock_update:
            mock_update.side_effect = ConflictException(
                "Precondition failed: resource has been modified"
            )

            response = client.patch(
                f"/tests/{test_id}/metadata",
                json={"name": "Updated Test"},
                headers={"If-Match": '"stale-etag"'},
            )

            assert response.status_code == 412

    def test_update_metadata_value_error_is_400_whatever_its_text(self, client: TestClient) -> None:
        """Only the typed conflict answers 412; a plain ValueError stays a 400."""
        test_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_metadata"
        ) as mock_update:
            mock_update.side_effect = ValueError("Precondition failed: stale etag")
            response = client.patch(f"/tests/{test_id}/metadata", json={"name": "X"})
        assert response.status_code == 400
        assert response.json() == {
            "success": False,
            "error": {"message": "Precondition failed: stale etag", "code": "VALIDATION_ERROR"},
        }


class TestDeleteTestEndpoint:
    """Test suite for DELETE /tests/{test_id} endpoint (delete test)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_test_returns_204_when_successful(self, client: TestClient) -> None:
        """Test that DELETE /tests/{test_id} returns 204 when deletion succeeds."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.delete_test") as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/tests/{test_id}")

            assert response.status_code == 204

    def test_delete_test_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /tests/{test_id} returns 404 when test does not exist."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.delete_test") as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/tests/{test_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_delete_test_returns_404_for_invalid_uuid(self, client: TestClient) -> None:
        """Test that DELETE /tests/{test_id} returns 404 for invalid UUID (not found).

        Delete skips UUID format validation so invalid IDs can be cleaned up.
        """
        response = client.delete("/tests/invalid-uuid")

        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert "not found" in data["error"]["message"].lower()

    def test_delete_test_returns_400_for_generic_value_error(self, client: TestClient) -> None:
        """Test that DELETE returns 400 for generic ValueError from service."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.delete_test") as mock_delete:
            mock_delete.side_effect = ValueError("Some generic validation error")

            response = client.delete(f"/tests/{test_id}")

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Some generic validation error" in data["error"]["message"]

    def test_delete_test_returns_409_with_active_executions(self, client: TestClient) -> None:
        """DELETE /tests/{id} returns 409 with execution_ids in details when
        a tracked execution is running or paused."""
        from wavecore.api.exceptions import ConflictException

        test_id = str(uuid.uuid4())
        blocking = [str(uuid.uuid4())]

        with patch("wavecore.api.routes.tests.routes.test_service.delete_test") as mock_delete:
            mock_delete.side_effect = ConflictException(
                "Cannot delete test: execution is running",
                details={"execution_ids": blocking},
            )

            response = client.delete(f"/tests/{test_id}")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"
            assert data["error"]["details"] == {"execution_ids": blocking}


class TestAddTestVersionEndpoint:
    """Test suite for POST /tests/{test_id}/versions endpoint (add version)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_add_test_version_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/versions returns 201 when adding version."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.add_test_version") as mock_add:
            mock_add.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "1.1.0",
                "description": "Updated version",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/tests/{test_id}/versions",
                json={"description": "Updated version"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["version"] == "1.1.0"

    def test_add_test_version_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/versions returns 404 when test not found."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.add_test_version") as mock_add:
            mock_add.return_value = None

            response = client.post(
                f"/tests/{test_id}/versions",
                json={"description": "New version"},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_add_test_version_validates_uuid_format(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/versions validates test_id is valid UUID."""
        response = client.post(
            "/tests/invalid-uuid/versions",
            json={"description": "New version"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestDeleteTestVersionEndpoint:
    """Test suite for DELETE /tests/{test_id}/versions/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_test_version_returns_204_when_successful(self, client: TestClient) -> None:
        """Test that DELETE /tests/{test_id}/versions/{version} returns 204."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.delete_test_version"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/tests/{test_id}/versions/1.0.0")

            assert response.status_code == 204

    def test_delete_test_version_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /tests/{test_id}/versions/{version} returns 404."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.delete_test_version"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/tests/{test_id}/versions/9.9.9")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Version '9.9.9' not found for test '{test_id}'$",
                data["error"]["message"],
            )

    def test_delete_test_version_returns_409_with_references(self, client: TestClient) -> None:
        """Test that DELETE /tests/{test_id}/versions/{version} returns 409."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.delete_test_version"
        ) as mock_delete:
            mock_delete.side_effect = ValueError(
                "Cannot delete version '1.0.0': 3 suites reference this version"
            )

            response = client.delete(f"/tests/{test_id}/versions/1.0.0")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "suites reference" in data["error"]["message"]

    def test_delete_test_version_returns_400_for_other_errors(self, client: TestClient) -> None:
        """Test that DELETE /tests/{test_id}/versions/{version} returns 400 for other errors."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.delete_test_version"
        ) as mock_delete:
            mock_delete.side_effect = ValueError("Some other validation error")

            response = client.delete(f"/tests/{test_id}/versions/1.0.0")

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False


class TestGetTestWorkflowEndpoint:
    """Test suite for GET /tests/{test_id}/workflow endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_test_workflow_returns_200_with_workflow(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/workflow returns 200 with workflow graph."""
        test_id = str(uuid.uuid4())
        start_id = str(uuid.uuid4())
        block_id = str(uuid.uuid4())
        end_id = str(uuid.uuid4())
        edge1_id = str(uuid.uuid4())
        edge2_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_workflow") as mock_get:
            mock_get.return_value = {
                "nodes": [
                    {"id": start_id, "type": "start"},
                    {"id": block_id, "type": "block", "block_id": str(uuid.uuid4())},
                    {"id": end_id, "type": "end"},
                ],
                "edges": [
                    {"id": edge1_id, "source": start_id, "target": block_id},
                    {"id": edge2_id, "source": block_id, "target": end_id},
                ],
            }

            response = client.get(f"/tests/{test_id}/workflow")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]["nodes"]) == 3
            assert len(data["data"]["edges"]) == 2

    def test_get_test_workflow_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/workflow returns 404 when test not found."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_workflow") as mock_get:
            mock_get.return_value = None

            response = client.get(f"/tests/{test_id}/workflow")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_get_test_workflow_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/workflow validates test_id is valid UUID."""
        response = client.get("/tests/invalid-uuid/workflow")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestGetTestVariablesEndpoint:
    """Test suite for GET /tests/{test_id}/variables endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_test_variables_returns_200_with_variables(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/variables returns 200 with variables."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_variables") as mock_get:
            mock_get.return_value = {
                "username": {"type": "string", "value": "testuser"},
                "timeout": {"type": "integer", "value": 30},
                "api_key": {"type": "string", "secret": True},
            }

            response = client.get(f"/tests/{test_id}/variables")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "username" in data["data"]
            assert "timeout" in data["data"]
            assert data["data"]["api_key"]["secret"] is True

    def test_get_test_variables_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/variables returns 404 when test not found."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_variables") as mock_get:
            mock_get.return_value = None

            response = client.get(f"/tests/{test_id}/variables")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_get_test_variables_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/variables validates test_id is valid UUID."""
        response = client.get("/tests/invalid-uuid/variables")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestUpdateTestVariablesEndpoint:
    """Test suite for PATCH /tests/{test_id}/variables endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_test_variables_returns_200_with_valid_data(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/variables returns 200."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_variables"
        ) as mock_update:
            mock_update.return_value = {
                "username": {"type": "string", "value": "newuser"},
                "timeout": {"type": "integer", "value": 60},
            }

            response = client.patch(
                f"/tests/{test_id}/variables",
                json={
                    "variables": {
                        "username": {"type": "string", "value": "newuser"},
                        "timeout": {"type": "integer", "value": 60},
                    }
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["username"]["value"] == "newuser"
            assert data["data"]["timeout"]["value"] == 60

    def test_update_test_variables_supports_merge_mode(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/variables supports merge mode."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_variables"
        ) as mock_update:
            mock_update.return_value = {
                "username": {"type": "string", "value": "testuser"},
                "timeout": {"type": "integer", "value": 60},
                "new_var": {"type": "string", "value": "value"},
            }

            response = client.patch(
                f"/tests/{test_id}/variables",
                json={
                    "variables": {"new_var": {"type": "string", "value": "value"}},
                    "merge": True,
                },
            )

            assert response.status_code == 200
            mock_update.assert_called_once()
            call_args = mock_update.call_args
            assert call_args[1]["merge"] is True

    def test_update_test_variables_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/variables returns 404 when not found."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_variables"
        ) as mock_update:
            mock_update.return_value = None

            response = client.patch(
                f"/tests/{test_id}/variables",
                json={"variables": {}},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_update_test_variables_requires_variables_field(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/variables requires variables field."""
        test_id = str(uuid.uuid4())

        response = client.patch(
            f"/tests/{test_id}/variables",
            json={"merge": True},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(r"^Field 'variables' is required$", data["error"]["message"])

    def test_update_test_variables_validates_type_consistency(self, client: TestClient) -> None:
        """Test that PATCH /tests/{test_id}/variables validates type consistency."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_variables"
        ) as mock_update:
            mock_update.side_effect = ValueError(
                "Type mismatch for variable 'timeout': expected 'integer', got 'string'"
            )

            response = client.patch(
                f"/tests/{test_id}/variables",
                json={
                    "variables": {"timeout": {"type": "string", "value": "invalid"}},
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Type mismatch" in data["error"]["message"]


class TestValidateTestEndpoint:
    """Test suite for POST /tests/{test_id}/validate endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_test_returns_200_when_valid(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/validate returns 200 when test is valid."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "fatal": False,
                "errors": [],
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["fatal"] is False
            assert len(data["data"]["errors"]) == 0

    def test_validate_test_returns_422_with_validation_errors(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/validate returns 422 with errors."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "fatal": False,
                "errors": [
                    {
                        "path": "nodes[0]",
                        "node_id": "n1",
                        "node_label": None,
                        "element_type": None,
                        "code": "INVALID_NODE_TYPE",
                        "message": "Node type must be 'workflowNode'",
                        "severity": "error",
                        "fix_action": "Remove block",
                    },
                ],
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 422
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "VALIDATION_ERRORS"
            assert len(data["error"]["details"]) == 1
            assert data["error"]["details"][0]["fatal"] is False
            assert len(data["error"]["details"][0]["errors"]) == 1

    def test_validate_test_returns_422_with_fatal_errors(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/validate returns 422 with fatal errors."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "fatal": True,
                "errors": [
                    {
                        "path": "workflow",
                        "node_id": None,
                        "node_label": None,
                        "element_type": None,
                        "code": "MISSING_WORKFLOW",
                        "message": "Test must have a workflow",
                        "severity": "error",
                        "fix_action": None,
                    },
                ],
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 422
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "VALIDATION_ERRORS"
            assert data["error"]["details"][0]["fatal"] is True

    def test_validate_test_accepts_context_parameter(self, client: TestClient) -> None:
        """Test that validate endpoint accepts context query parameter."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "fatal": False,
                "errors": [],
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/validate?context=run")

            assert response.status_code == 200
            mock_validate.assert_called_once_with(test_id, context="run")

    def test_validate_test_checks_an_unsaved_body_in_place_of_the_stored_test(
        self, client: TestClient
    ) -> None:
        """An unsaved workflow and its variables are checked instead of the stored test."""
        test_id = str(uuid.uuid4())
        workflow = {"nodes": [{"id": "delay-1"}], "edges": []}
        variables = {"limit": {"type": "integer", "value": 3}}

        with (
            patch("wavecore.api.routes.tests.routes.test_service.validate_test") as stored,
            patch("wavecore.api.routes.tests.routes.test_service.validate_unsaved_test") as unsaved,
        ):
            unsaved.return_value = {"fatal": False, "errors": [], "warnings": []}

            response = client.post(
                f"/tests/{test_id}/validate?context=run",
                json={"workflow": workflow, "variables": variables},
            )

            assert response.status_code == 200
            unsaved.assert_called_once_with(test_id, workflow, variables, context="run")
            stored.assert_not_called()

    def test_validate_test_leaves_the_variables_to_the_stored_test_when_the_body_has_none(
        self, client: TestClient
    ) -> None:
        """An unsaved body without variables is checked against the stored test's variables."""
        test_id = str(uuid.uuid4())
        workflow = {"nodes": [], "edges": []}

        with patch(
            "wavecore.api.routes.tests.routes.test_service.validate_unsaved_test"
        ) as unsaved:
            unsaved.return_value = {"fatal": False, "errors": [], "warnings": []}

            response = client.post(
                f"/tests/{test_id}/validate?context=run", json={"workflow": workflow}
            )

            assert response.status_code == 200
            unsaved.assert_called_once_with(test_id, workflow, None, context="run")

    @pytest.mark.parametrize(
        ("body", "message"),
        [
            ({"variables": {}}, r"^Field 'workflow' must be an object$"),
            ({"workflow": []}, r"^Field 'workflow' must be an object$"),
            (
                {"workflow": {"nodes": [], "edges": []}, "variables": []},
                r"^Field 'variables' must be an object$",
            ),
        ],
    )
    def test_validate_test_refuses_a_malformed_unsaved_body(
        self, client: TestClient, body: dict[str, Any], message: str
    ) -> None:
        """An unsaved body needs a workflow object, and variables, when given, as an object."""
        test_id = str(uuid.uuid4())

        response = client.post(f"/tests/{test_id}/validate?context=run", json=body)

        assert response.status_code == 400
        data = response.json()
        assert data["error"]["code"] == "INVALID_PARAMETER"
        assert re.match(message, data["error"]["message"])

    def test_validate_test_rejects_invalid_context(self, client: TestClient) -> None:
        """Test that validate endpoint rejects invalid context values."""
        test_id = str(uuid.uuid4())

        response = client.post(f"/tests/{test_id}/validate?context=invalid")

        assert response.status_code == 400
        data = response.json()
        assert "Invalid validation context" in data["error"]["message"]

    def test_validate_test_rejects_save_context(self, client: TestClient) -> None:
        """Test that validate endpoint rejects save context (save validates inline via PUT)."""
        test_id = str(uuid.uuid4())

        response = client.post(f"/tests/{test_id}/validate?context=save")

        assert response.status_code == 400
        data = response.json()
        assert "Invalid validation context" in data["error"]["message"]

    def test_validate_test_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/validate returns 404 when not found."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = None

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_validate_test_validates_uuid_format(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/validate validates test_id is valid UUID."""
        response = client.post("/tests/invalid-uuid/validate")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestFixTestEndpoint:
    """Test suite for POST /tests/{test_id}/fix endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_fix_test_returns_200_with_fixed_data(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/fix returns 200 with fixed test."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.fix_test") as mock_fix:
            mock_fix.return_value = {
                "test": {
                    "id": test_id,
                    "name": "Fixed Test",
                    "workflow": {"nodes": [], "edges": []},
                },
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/fix")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Fixed Test"
            assert data["warnings"] == []

    def test_fix_test_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/fix returns 404 when not found."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.fix_test") as mock_fix:
            mock_fix.return_value = None

            response = client.post(f"/tests/{test_id}/fix")

            assert response.status_code == 404

    def test_fix_test_returns_400_on_fatal_errors(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/fix returns 400 when test has fatal errors."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.fix_test") as mock_fix:
            mock_fix.side_effect = ValueError("Test has fatal errors that cannot be auto-fixed")

            response = client.post(f"/tests/{test_id}/fix")

            assert response.status_code == 400
            data = response.json()
            assert "fatal errors" in data["error"]["message"]

    def test_fix_test_validates_uuid_format(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/fix validates UUID format."""
        response = client.post("/tests/invalid-uuid/fix")

        assert response.status_code == 400
        data = response.json()
        assert "Invalid UUID format" in data["error"]["message"]


class TestCloneTestEndpoint:
    """Test suite for POST /tests/{test_id}/clone endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_clone_test_returns_201_with_valid_data(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/clone returns 201 when clone succeeds."""
        test_id = str(uuid.uuid4())
        clone_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.clone_test") as mock_clone:
            mock_clone.return_value = {
                "id": clone_id,
                "name": "Login Test Copy",
                "version": "1.0.0",
                "description": "Cloned from Login Test",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {"cloned_from": test_id},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/tests/{test_id}/clone",
                json={"new_name": "Login Test Copy"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == clone_id
            assert data["data"]["name"] == "Login Test Copy"
            assert data["data"]["metadata"]["cloned_from"] == test_id

    def test_clone_test_auto_generates_name_when_not_provided(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/clone auto-generates name when not provided."""
        test_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.tests.routes.test_service.get_test") as mock_get,
            patch("wavecore.api.routes.tests.routes.test_service.clone_test") as mock_clone,
        ):
            mock_get.return_value = {
                "id": test_id,
                "name": "Original Test",
                "version": "1.0.0",
            }
            mock_clone.return_value = {
                "id": str(uuid.uuid4()),
                "name": "Original Test (Copy)",
                "version": "1.0.0",
                "metadata": {"cloned_from": test_id},
            }

            response = client.post(
                f"/tests/{test_id}/clone",
                json={},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Original Test (Copy)"
            # Verify clone_test was called with auto-generated name
            mock_clone.assert_called_once()
            call_args = mock_clone.call_args
            assert call_args[0][1] == "Original Test (Copy)"  # new_name argument

    def test_clone_test_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/clone returns 404 when test not found."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.clone_test") as mock_clone:
            mock_clone.return_value = None

            response = client.post(
                f"/tests/{test_id}/clone",
                json={"new_name": "Clone Name"},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_clone_test_validates_uuid_format(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/clone validates test_id is valid UUID."""
        response = client.post(
            "/tests/invalid-uuid/clone",
            json={"new_name": "Clone Name"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )

    def test_clone_test_accepts_new_version(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/clone accepts new_version parameter."""
        test_id = str(uuid.uuid4())
        clone_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.clone_test") as mock_clone:
            mock_clone.return_value = {
                "id": clone_id,
                "name": "Login Test Copy",
                "version": "2.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                f"/tests/{test_id}/clone",
                json={"new_name": "Login Test Copy", "new_version": "2.0.0"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["version"] == "2.0.0"

    def test_clone_test_validates_version_format(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/clone validates version format."""
        test_id = str(uuid.uuid4())

        response = client.post(
            f"/tests/{test_id}/clone",
            json={"new_name": "Clone", "new_version": "invalid"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid version format 'invalid': must follow semantic versioning "
            r"\(MAJOR\.MINOR\.PATCH\)$",
            data["error"]["message"],
        )

    def test_clone_test_handles_empty_request_body(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/clone handles empty/missing request body."""
        test_id = str(uuid.uuid4())
        clone_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.tests.routes.test_service.get_test") as mock_get,
            patch("wavecore.api.routes.tests.routes.test_service.clone_test") as mock_clone,
        ):
            mock_get.return_value = {
                "id": test_id,
                "name": "Original Test",
                "version": "1.0.0",
            }
            mock_clone.return_value = {
                "id": clone_id,
                "name": "Original Test (Copy)",
                "version": "1.0.0",
            }

            # Send request with no body at all (Content-Length: 0)
            response = client.post(
                f"/tests/{test_id}/clone",
                content="",
                headers={"Content-Type": "application/json"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "Original Test (Copy)"

    def test_clone_test_uses_fallback_name_when_original_not_found(
        self, client: TestClient
    ) -> None:
        """Test that POST /tests/{test_id}/clone uses fallback name when original test not found."""
        test_id = str(uuid.uuid4())
        clone_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.tests.routes.test_service.get_test") as mock_get,
            patch("wavecore.api.routes.tests.routes.test_service.clone_test") as mock_clone,
        ):
            # get_test returns None - original not found
            mock_get.return_value = None
            mock_clone.return_value = {
                "id": clone_id,
                "name": "Test (Copy)",
                "version": "1.0.0",
            }

            response = client.post(
                f"/tests/{test_id}/clone",
                json={},  # No new_name provided
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            # Should use fallback "Test (Copy)" when original not found
            mock_clone.assert_called_once()
            call_args = mock_clone.call_args
            assert call_args[0][1] == "Test (Copy)"  # new_name argument is fallback


class TestGetTestDependencyGraphEndpoint:
    """Test suite for GET /tests/{test_id}/dependency-graph endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_dependency_graph_returns_200_with_graph(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/dependency-graph returns 200."""
        test_id = str(uuid.uuid4())
        block1_id = str(uuid.uuid4())
        block2_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.get_test_dependency_graph"
        ) as mock_get:
            mock_get.return_value = {
                "nodes": [
                    {"id": block1_id, "type": "block", "version": "1.0.0"},
                    {"id": block2_id, "type": "block", "version": "2.1.0"},
                ],
                "edges": [
                    {"source": test_id, "target": block1_id},
                    {"source": test_id, "target": block2_id},
                ],
            }

            response = client.get(f"/tests/{test_id}/dependency-graph")

            assert response.status_code == 200
            data = response.json()
            assert len(data["nodes"]) == 2
            assert len(data["edges"]) == 2

    def test_get_dependency_graph_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/dependency-graph returns 404."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.get_test_dependency_graph"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/tests/{test_id}/dependency-graph")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_get_dependency_graph_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/dependency-graph validates UUID."""
        response = client.get("/tests/invalid-uuid/dependency-graph")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestGetTestExecutionsEndpoint:
    """Test suite for GET /tests/{test_id}/executions endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_test_executions_returns_200_with_history(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/executions returns 200."""
        test_id = str(uuid.uuid4())
        exec1_id = str(uuid.uuid4())
        exec2_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_executions") as mock_get:
            mock_get.return_value = {
                "executions": [
                    {
                        "id": exec1_id,
                        "status": "passed",
                        "started_at": now,
                        "duration_ms": 1234,
                    },
                    {
                        "id": exec2_id,
                        "status": "failed",
                        "started_at": now,
                        "duration_ms": 5678,
                    },
                ],
                "total": 2,
                "page": 1,
                "per_page": 20,
            }

            response = client.get(f"/tests/{test_id}/executions")

            assert response.status_code == 200
            data = response.json()
            assert len(data["data"]) == 2
            assert data["data"][0]["status"] == "passed"
            assert data["data"][1]["status"] == "failed"

    def test_get_test_executions_supports_pagination(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/executions supports pagination."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_executions") as mock_get:
            mock_get.return_value = {
                "executions": [],
                "total": 50,
                "page": 2,
                "per_page": 10,
            }

            response = client.get(f"/tests/{test_id}/executions?page=2&per_page=10")

            assert response.status_code == 200
            mock_get.assert_called_once_with(test_id, page=2, per_page=10)

    def test_get_test_executions_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/executions returns 404."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_executions") as mock_get:
            mock_get.return_value = None

            response = client.get(f"/tests/{test_id}/executions")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_get_test_executions_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/executions validates UUID format."""
        response = client.get("/tests/invalid-uuid/executions")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestGetTestHistoryEndpoint:
    """Test suite for GET /tests/{test_id}/history endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_test_history_returns_200_with_history(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/history returns 200 with version history."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_history") as mock_get:
            mock_get.return_value = {
                "versions": [
                    {
                        "version": "2.0.0",
                        "created_at": now,
                        "created_by": "user1",
                        "changes": "Major refactoring",
                    },
                    {
                        "version": "1.1.0",
                        "created_at": now,
                        "created_by": "user2",
                        "changes": "Bug fixes",
                    },
                    {
                        "version": "1.0.0",
                        "created_at": now,
                        "created_by": "user1",
                        "changes": "Initial version",
                    },
                ]
            }

            response = client.get(f"/tests/{test_id}/history")

            assert response.status_code == 200
            data = response.json()
            assert len(data["versions"]) == 3
            assert data["versions"][0]["version"] == "2.0.0"
            assert data["versions"][2]["changes"] == "Initial version"

    def test_get_test_history_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/history returns 404 when test not found."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_history") as mock_get:
            mock_get.return_value = None

            response = client.get(f"/tests/{test_id}/history")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_get_test_history_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/history validates test_id is valid UUID."""
        response = client.get("/tests/invalid-uuid/history")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestRestoreTestVersionEndpoint:
    """Test suite for POST /tests/{test_id}/restore/{version} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_restore_test_version_returns_200_when_successful(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/restore/{version} returns 200."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch(
            "wavecore.api.routes.tests.routes.test_service.restore_test_version"
        ) as mock_restore:
            mock_restore.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "2.1.0",
                "description": "Restored from 1.0.0",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {"restored_from": "1.0.0"},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(f"/tests/{test_id}/restore/1.0.0")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["version"] == "2.1.0"
            assert data["data"]["metadata"]["restored_from"] == "1.0.0"

    def test_restore_test_version_returns_404_when_test_not_found(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/restore/{version} returns 404."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.restore_test_version"
        ) as mock_restore:
            mock_restore.return_value = None

            response = client.post(f"/tests/{test_id}/restore/1.0.0")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(rf"^Test with ID '{test_id}' not found$", data["error"]["message"])

    def test_restore_test_version_returns_404_when_version_not_found(
        self, client: TestClient
    ) -> None:
        """Test that POST /tests/{test_id}/restore/{version} returns 404 for version."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.restore_test_version"
        ) as mock_restore:
            mock_restore.side_effect = ValueError(f"Version '9.9.9' not found for test '{test_id}'")

            response = client.post(f"/tests/{test_id}/restore/9.9.9")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_restore_test_version_validates_uuid_format(self, client: TestClient) -> None:
        """Test that POST /tests/{test_id}/restore/{version} validates UUID."""
        response = client.post("/tests/invalid-uuid/restore/1.0.0")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for test_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestTestEndpointCachingBehavior:
    """Test suite for caching behavior across test endpoints (REQ-5.2.4.3)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_tests_cache_invalidated_on_create(self, client: TestClient) -> None:
        """Test that list cache is invalidated when test is created."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.return_value = {
                "id": test_id,
                "name": "New Test",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post("/tests", json={"name": "New Test"})

            assert response.status_code == 201
            assert "X-Cache-Invalidated" in response.headers


class TestTestEndpointConcurrencyControl:
    """Test suite for concurrency control via ETag/If-Match (REQ-5.2.4.3)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_test_returns_etag_header(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id} returns ETag header."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.get_test") as mock_get:
            mock_get.return_value = {
                "id": test_id,
                "name": "Test",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/tests/{test_id}")

            assert response.status_code == 200
            assert "ETag" in response.headers
            assert response.headers["ETag"].startswith('"')

    def test_update_with_if_match_succeeds_when_matching(self, client: TestClient) -> None:
        """Test that update with matching If-Match succeeds."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.update_test") as mock_update:
            mock_update.return_value = {
                "id": test_id,
                "name": "Updated Test",
                "version": "1.1.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.put(
                f"/tests/{test_id}",
                json={"name": "Updated Test"},
                headers={"If-Match": '"abc123"'},
            )

            assert response.status_code == 200
            mock_update.assert_called_once()
            call_kwargs = mock_update.call_args[1]
            assert call_kwargs.get("etag") == '"abc123"'

    def test_update_with_if_match_fails_when_mismatched(self, client: TestClient) -> None:
        """Test that update with mismatched If-Match returns 412."""
        from wavecore.api.exceptions import ConflictException

        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.update_test") as mock_update:
            mock_update.side_effect = ConflictException(
                "Precondition failed: resource has been modified"
            )

            response = client.put(
                f"/tests/{test_id}",
                json={"name": "Updated Test"},
                headers={"If-Match": '"stale-etag"'},
            )

            assert response.status_code == 412
            data = response.json()
            assert data["success"] is False
            assert "Precondition failed" in data["error"]["message"]

    def test_update_returns_409_on_other_conflict(self, client: TestClient) -> None:
        """ConflictException without 'Precondition failed' string → 409."""
        from wavecore.api.exceptions import ConflictException

        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.update_test") as mock_update:
            mock_update.side_effect = ConflictException(
                "Test with name 'Existing Test' already exists"
            )

            response = client.put(
                f"/tests/{test_id}",
                json={"name": "Existing Test"},
            )

            assert response.status_code == 409
            assert "already exists" in response.json()["error"]["message"]

    def test_update_value_error_is_400_whatever_its_text(self, client: TestClient) -> None:
        """Only the typed conflict answers 412; a plain ValueError stays a 400."""
        test_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.tests.routes.test_service.update_test") as mock_update:
            mock_update.side_effect = ValueError("Precondition failed: stale etag")
            response = client.put(f"/tests/{test_id}", json={"name": "X"})
        assert response.status_code == 400
        assert response.json() == {
            "success": False,
            "error": {"message": "Precondition failed: stale etag", "code": "VALIDATION_ERROR"},
        }

    @pytest.mark.parametrize(
        ("method", "path_suffix"),
        [("put", ""), ("patch", "/metadata")],
    )
    def test_stale_if_match_on_stored_test_returns_412(
        self, client: TestClient, method: str, path_suffix: str
    ) -> None:
        """A stale If-Match against a stored Test answers 412 and leaves the Test as it was."""
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "Stale ETag Test"})

        response = client.request(
            method,
            f"/tests/{created['id']}{path_suffix}",
            json={"name": "Renamed"},
            headers={"If-Match": '"stale-etag"'},
        )

        assert response.status_code == 412
        assert response.json() == {
            "success": False,
            "error": {
                "message": "Precondition failed: resource has been modified",
                "code": "CONFLICT",
            },
        }
        stored = test_service.get_test(created["id"])
        assert stored is not None
        assert stored["name"] == "Stale ETag Test"
        assert stored["version"] == created["version"]

    def test_delete_with_if_match_succeeds_when_matching(self, client: TestClient) -> None:
        """Test that delete with matching If-Match succeeds."""
        test_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.tests.routes.test_service.get_test") as mock_get,
            patch("wavecore.api.routes.tests.routes.test_service.delete_test") as mock_delete,
        ):
            mock_get.return_value = {
                "id": test_id,
                "version": "1.0.0",
                "updated_at": "2024-01-01T00:00:00Z",
            }
            mock_delete.return_value = True

            _response = client.delete(
                f"/tests/{test_id}",
                headers={"If-Match": '"matching-etag"'},
            )

            # Should check ETag before deleting
            mock_get.assert_called_once()


class TestTestEndpointInternalErrors:
    """Test suite for internal error handling (REQ-5.2.4.3)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_test_returns_500_on_internal_error(self, client: TestClient) -> None:
        """Test that POST /tests returns 500 with correlation ID on internal error."""
        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.side_effect = RuntimeError("Database connection failed")

            response = client.post("/tests", json={"name": "Test"})

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "correlation_id" in data["error"]


class TestValidateWorkflowEndpoint:
    """Test suite for POST /workflows/validate endpoint (REQ-5.2.4.3).

    This endpoint enables validating workflow structures independently of test context,
    supporting cycle detection, reachability analysis, and termination verification.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_workflow_returns_200_when_valid(self, client: TestClient) -> None:
        """Test that POST /workflows/validate returns 200 when workflow is valid."""
        start_id = str(uuid.uuid4())
        end_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.workflow_service.validate_workflow"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": True,
                "errors": [],
                "warnings": [],
            }

            response = client.post(
                "/workflows/validate",
                json={
                    "nodes": [
                        {"id": start_id, "type": "start"},
                        {"id": end_id, "type": "end"},
                    ],
                    "edges": [
                        {"source": start_id, "target": end_id},
                    ],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["valid"] is True
            assert len(data["data"]["errors"]) == 0

    def test_validate_workflow_detects_cycles(self, client: TestClient) -> None:
        """Test that POST /workflows/validate detects cycles in workflow graph."""
        node1_id = str(uuid.uuid4())
        node2_id = str(uuid.uuid4())
        node3_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.workflow_service.validate_workflow"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": [
                    f"Workflow graph contains cycle: {node1_id} -> {node2_id} -> {node3_id} -> "
                    f"{node1_id}"
                ],
                "warnings": [],
            }

            response = client.post(
                "/workflows/validate",
                json={
                    "nodes": [
                        {"id": node1_id, "type": "block"},
                        {"id": node2_id, "type": "block"},
                        {"id": node3_id, "type": "block"},
                    ],
                    "edges": [
                        {"source": node1_id, "target": node2_id},
                        {"source": node2_id, "target": node3_id},
                        {"source": node3_id, "target": node1_id},
                    ],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["valid"] is False
            assert any("cycle" in err.lower() for err in data["data"]["errors"])

    def test_validate_workflow_detects_unreachable_nodes(self, client: TestClient) -> None:
        """Test that POST /workflows/validate detects unreachable nodes."""
        start_id = str(uuid.uuid4())
        end_id = str(uuid.uuid4())
        orphan_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.workflow_service.validate_workflow"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": [f"Node '{orphan_id}' is unreachable from start node"],
                "warnings": [],
            }

            response = client.post(
                "/workflows/validate",
                json={
                    "nodes": [
                        {"id": start_id, "type": "start"},
                        {"id": end_id, "type": "end"},
                        {"id": orphan_id, "type": "block"},
                    ],
                    "edges": [
                        {"source": start_id, "target": end_id},
                    ],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["valid"] is False
            assert any("unreachable" in err.lower() for err in data["data"]["errors"])

    def test_validate_workflow_detects_termination_issues(self, client: TestClient) -> None:
        """Test that POST /workflows/validate detects termination issues."""
        start_id = str(uuid.uuid4())
        block_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.workflow_service.validate_workflow"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": [
                    f"Node '{block_id}' has no path to end node - workflow may not terminate"
                ],
                "warnings": [],
            }

            response = client.post(
                "/workflows/validate",
                json={
                    "nodes": [
                        {"id": start_id, "type": "start"},
                        {"id": block_id, "type": "block"},
                    ],
                    "edges": [
                        {"source": start_id, "target": block_id},
                    ],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["valid"] is False
            assert any(
                "terminate" in err.lower() or "end node" in err.lower()
                for err in data["data"]["errors"]
            )

    def test_validate_workflow_returns_400_for_malformed_request(self, client: TestClient) -> None:
        """Test that POST /workflows/validate returns 400 for malformed request."""
        response = client.post(
            "/workflows/validate",
            json={"invalid": "data"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False

    def test_validate_workflow_returns_400_for_missing_edges(self, client: TestClient) -> None:
        """Test that POST /workflows/validate returns 400 when edges field is missing."""
        response = client.post(
            "/workflows/validate",
            json={"nodes": [{"id": "start", "type": "start"}]},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "edges" in data["error"]["message"].lower()

    def test_validate_workflow_validates_block_references(self, client: TestClient) -> None:
        """Test that POST /workflows/validate validates block reference existence."""
        start_id = str(uuid.uuid4())
        block_id = str(uuid.uuid4())
        missing_block_ref = str(uuid.uuid4())
        end_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.workflow_service.validate_workflow"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": [f"Block reference '{missing_block_ref}' not found"],
                "warnings": [],
            }

            response = client.post(
                "/workflows/validate",
                json={
                    "nodes": [
                        {"id": start_id, "type": "start"},
                        {"id": block_id, "type": "block", "block_ref": missing_block_ref},
                        {"id": end_id, "type": "end"},
                    ],
                    "edges": [
                        {"source": start_id, "target": block_id},
                        {"source": block_id, "target": end_id},
                    ],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["valid"] is False
            assert any("not found" in err.lower() for err in data["data"]["errors"])


class TestValidationDetailedErrors:
    """Test suite for detailed validation errors (REQ-5.2.4.3).

    Tests cover cycle detection, reachability analysis, termination verification,
    variable binding completeness, and parameter consistency.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_test_detects_cycle_in_workflow(self, client: TestClient) -> None:
        """Test that validation detects cycles in workflow graph."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": ["Workflow graph contains cycle: node-A -> node-B -> node-C -> node-A"],
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 422
            data = response.json()
            result = data["error"]["details"][0]
            assert result["valid"] is False
            assert any("cycle" in err.lower() for err in result["errors"])

    def test_validate_test_detects_termination_issues(self, client: TestClient) -> None:
        """Test that validation detects workflows that may not terminate."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": ["Workflow cannot terminate: no path from node 'block-xyz' to end node"],
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 422
            data = response.json()
            result = data["error"]["details"][0]
            assert result["valid"] is False
            assert any(
                "terminate" in err.lower() or "end node" in err.lower() for err in result["errors"]
            )

    def test_validate_test_checks_variable_binding_completeness(self, client: TestClient) -> None:
        """Test that validation checks variable binding completeness."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": [
                    "Variable 'api_endpoint' referenced in block 'http-request' but not declared"
                ],
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 422
            data = response.json()
            result = data["error"]["details"][0]
            assert result["valid"] is False
            assert any(
                "variable" in err.lower() and "not declared" in err.lower()
                for err in result["errors"]
            )

    def test_validate_test_checks_parameter_consistency(self, client: TestClient) -> None:
        """Test that validation checks parameter consistency for blocks."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": [
                    "Parameter 'timeout' in block 'http-request' expects integer but received "
                    "string"
                ],
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 422
            data = response.json()
            result = data["error"]["details"][0]
            assert result["valid"] is False
            assert any("parameter" in err.lower() for err in result["errors"])

    def test_validate_test_checks_block_version_compatibility(self, client: TestClient) -> None:
        """Test that validation checks block reference version compatibility."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": [
                    "Block 'http-request' version '1.0.0' is incompatible with required version "
                    "'^2.0.0'"
                ],
                "warnings": [],
            }

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 422
            data = response.json()
            result = data["error"]["details"][0]
            assert result["valid"] is False
            assert any(
                "version" in err.lower() and "incompatible" in err.lower()
                for err in result["errors"]
            )

    def test_validate_test_returns_warnings(self, client: TestClient) -> None:
        """Test that validation returns warnings alongside errors."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.validate_test") as mock_validate:
            mock_validate.return_value = {
                "valid": True,
                "errors": [],
                "warnings": [
                    "Variable 'debug_mode' is declared but never used",
                    "Block 'log-output' has no outgoing edges (dead end)",
                ],
            }

            response = client.post(f"/tests/{test_id}/validate")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["valid"] is True
            assert "warnings" in data["data"]
            assert len(data["data"]["warnings"]) == 2


class TestComputedVariableValidation:
    """Test suite for computed variable expression syntax validation (REQ-5.2.4.3)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_variables_validates_computed_expression_syntax(
        self, client: TestClient
    ) -> None:
        """Test that PATCH /tests/{test_id}/variables validates computed expression syntax."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_variables"
        ) as mock_update:
            mock_update.side_effect = ValueError(
                "Invalid expression syntax for computed variable 'total': "
                "unexpected token 'then' at position 15"
            )

            response = client.patch(
                f"/tests/{test_id}/variables",
                json={
                    "variables": {
                        "total": {
                            "type": "integer",
                            "computed": True,
                            "expression": "if count > 0 then count * price",
                        }
                    }
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "expression syntax" in data["error"]["message"].lower()

    def test_update_variables_validates_computed_expression_references(
        self, client: TestClient
    ) -> None:
        """Test that computed expressions reference valid variables."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_variables"
        ) as mock_update:
            mock_update.side_effect = ValueError(
                "Computed variable 'total' references undefined variable 'price'"
            )

            response = client.patch(
                f"/tests/{test_id}/variables",
                json={
                    "variables": {
                        "total": {
                            "type": "integer",
                            "computed": True,
                            "expression": "count * price",
                        }
                    }
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "undefined variable" in data["error"]["message"].lower()

    def test_update_variables_accepts_valid_computed_expression(self, client: TestClient) -> None:
        """Test that valid computed expressions are accepted."""
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.update_test_variables"
        ) as mock_update:
            mock_update.return_value = {
                "count": {"type": "integer", "value": 1},
                "price": {"type": "float", "value": 9.99},
                "total": {
                    "type": "float",
                    "computed": True,
                    "expression": "count * price",
                },
            }

            response = client.patch(
                f"/tests/{test_id}/variables",
                json={
                    "variables": {
                        "total": {
                            "type": "float",
                            "computed": True,
                            "expression": "count * price",
                        }
                    },
                    "merge": True,
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["total"]["computed"] is True


class TestSecretVariableMasking:
    """Test suite for secret variable masking behavior (REQ-5.2.4.3)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_variables_masks_secret_values(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/variables masks secret variable values."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_variables") as mock_get:
            mock_get.return_value = {
                "username": {"type": "string", "value": "admin"},
                "password": {
                    "type": "string",
                    "secret": True,
                    "value": "********",
                    "masked": True,
                },
                "api_key": {
                    "type": "string",
                    "secret": True,
                    "value": "********",
                    "masked": True,
                },
            }

            response = client.get(f"/tests/{test_id}/variables")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["password"]["masked"] is True
            assert data["data"]["password"]["value"] == "********"
            assert data["data"]["api_key"]["masked"] is True
            assert "admin" in data["data"]["username"]["value"]

    def test_get_test_masks_secret_variables_in_response(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id} masks secret variable values."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.get_test") as mock_get:
            mock_get.return_value = {
                "id": test_id,
                "name": "Login Test",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {
                    "username": {"type": "string", "value": "admin"},
                    "password": {
                        "type": "string",
                        "secret": True,
                        "value": "********",
                        "masked": True,
                    },
                },
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.get(f"/tests/{test_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["variables"]["password"]["masked"] is True
            assert data["data"]["variables"]["password"]["value"] == "********"

    def test_create_test_accepts_secret_variables(self, client: TestClient) -> None:
        """Test that POST /tests accepts secret variable declarations."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.create_test") as mock_create:
            mock_create.return_value = {
                "id": test_id,
                "name": "Secure Test",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {
                    "api_key": {
                        "type": "string",
                        "secret": True,
                        "value": "********",
                        "masked": True,
                    },
                },
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }

            response = client.post(
                "/tests",
                json={
                    "name": "Secure Test",
                    "variables": {
                        "api_key": {
                            "type": "string",
                            "secret": True,
                            "value": "super-secret-key",
                        },
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["variables"]["api_key"]["secret"] is True
            assert data["data"]["variables"]["api_key"]["masked"] is True


class TestResponseEnvelopeConsistency:
    """Test suite for response envelope consistency across endpoints (REQ-5.2.4.3).

    All endpoints should return responses in the standard envelope format:
    {success: bool, data: ..., meta: ...} or {success: bool, error: {...}}
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_dependency_graph_uses_standard_envelope(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/dependency-graph uses standard response envelope."""
        test_id = str(uuid.uuid4())
        block1_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.routes.test_service.get_test_dependency_graph"
        ) as mock_get:
            mock_get.return_value = {
                "nodes": [{"id": block1_id, "type": "block", "version": "1.0.0"}],
                "edges": [{"source": test_id, "target": block1_id}],
            }

            response = client.get(f"/tests/{test_id}/dependency-graph")

            assert response.status_code == 200
            data = response.json()
            assert "success" in data
            assert data["success"] is True
            assert "data" in data
            assert "nodes" in data["data"]
            assert "edges" in data["data"]

    def test_get_test_history_uses_standard_envelope(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/history uses standard response envelope."""
        test_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_history") as mock_get:
            mock_get.return_value = {
                "versions": [
                    {"version": "1.0.0", "created_at": now, "changes": "Initial"},
                ]
            }

            response = client.get(f"/tests/{test_id}/history")

            assert response.status_code == 200
            data = response.json()
            assert "success" in data
            assert data["success"] is True
            assert "data" in data
            assert "versions" in data["data"]

    def test_get_test_executions_uses_standard_envelope(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/executions uses standard response envelope."""
        test_id = str(uuid.uuid4())
        exec_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_executions") as mock_get:
            mock_get.return_value = {
                "executions": [
                    {"id": exec_id, "status": "passed", "started_at": now},
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get(f"/tests/{test_id}/executions")

            assert response.status_code == 200
            data = response.json()
            assert "success" in data
            assert data["success"] is True
            assert "data" in data
            assert "pagination" in data
            assert data["pagination"]["total_pages"] == 1

    def test_get_test_executions_includes_total_pages(self, client: TestClient) -> None:
        """Test that GET /tests/{test_id}/executions includes total_pages in pagination."""
        test_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.tests.routes.test_service.get_test_executions") as mock_get:
            mock_get.return_value = {
                "executions": [],
                "total": 100,
                "page": 1,
                "per_page": 20,
                "total_pages": 5,
            }

            response = client.get(f"/tests/{test_id}/executions")

            assert response.status_code == 200
            data = response.json()
            assert "pagination" in data
            assert data["pagination"]["total"] == 100
            assert data["pagination"]["total_pages"] == 5
            assert data["pagination"]["page"] == 1
            assert data["pagination"]["per_page"] == 20


class TestListTestTagsEndpoint:
    """Test suite for GET /tests/tags endpoint (REQ-9.5.3.1)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_tags_returns_200_with_unique_tags(self, client: TestClient) -> None:
        """Test that GET /tests/tags returns 200 with all unique tags."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_all_tags") as mock_list_tags:
            mock_list_tags.return_value = [
                "api",
                "e2e",
                "integration",
                "smoke",
                "unit",
            ]

            response = client.get("/tests/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == ["api", "e2e", "integration", "smoke", "unit"]
            mock_list_tags.assert_called_once()

    def test_list_tags_returns_200_with_empty_array_when_no_tags(self, client: TestClient) -> None:
        """Test that GET /tests/tags returns 200 with empty array when no tags exist."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_all_tags") as mock_list_tags:
            mock_list_tags.return_value = []

            response = client.get("/tests/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_tags_returns_sorted_tags(self, client: TestClient) -> None:
        """Test that GET /tests/tags returns tags in alphabetical order."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_all_tags") as mock_list_tags:
            # Service returns sorted tags
            mock_list_tags.return_value = ["alpha", "beta", "gamma", "zeta"]

            response = client.get("/tests/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["data"] == ["alpha", "beta", "gamma", "zeta"]

    def test_list_tags_includes_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /tests/tags includes Cache-Control header."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_all_tags") as mock_list_tags:
            mock_list_tags.return_value = ["tag1", "tag2"]

            response = client.get("/tests/tags")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert response.headers["Cache-Control"] == "max-age=60"

    def test_list_tags_includes_meta_in_response(self, client: TestClient) -> None:
        """Test that GET /tests/tags includes meta information in response."""
        with patch("wavecore.api.routes.tests.routes.test_service.list_all_tags") as mock_list_tags:
            mock_list_tags.return_value = ["tag1"]

            response = client.get("/tests/tags")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]


class TestNumbersAreStoredInWireForm:
    """REQ-3.1.3.14: a Test save stores each typed number a REST client sends in wire form."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture(autouse=True)
    def _registered_blocks(self) -> None:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.http_client import HTTPClientPlugin

        register_all_core_controls(_registry)
        register_plugin(HTTPClientPlugin())

    def _created(self, client: TestClient, **body: Any) -> dict[str, Any]:
        response = client.post("/tests", json={"name": "Wire Numbers", **body})
        assert response.status_code == 201, response.json()
        created: dict[str, Any] = response.json()["data"]
        return created

    def _read(self, client: TestClient, test_id: str) -> dict[str, Any]:
        read: dict[str, Any] = client.get(f"/tests/{test_id}").json()["data"]
        return read

    def test_block_fields_and_variables_are_stored_in_wire_form(self, client: TestClient) -> None:
        from tests.api.wire_number_cases import (
            SENT_HTTP_NUMBERS,
            SENT_VARIABLES,
            STORED_HTTP_NUMBERS,
            STORED_VARIABLES,
            http_node,
            http_numbers,
        )
        from wavecore.api.services.tests import service as test_service

        created = self._created(
            client,
            workflow={"nodes": [http_node(**SENT_HTTP_NUMBERS)], "edges": []},
            variables=SENT_VARIABLES,
        )
        read = self._read(client, created["id"])
        stored = test_service._load_test(created["id"])
        assert stored is not None

        for test in (created, read, stored):
            assert http_numbers(test["workflow"]["nodes"][0]) == STORED_HTTP_NUMBERS
            assert test["variables"] == STORED_VARIABLES

    def test_an_update_stores_its_numbers_in_wire_form(self, client: TestClient) -> None:
        from tests.api.wire_number_cases import http_node, http_numbers

        created = self._created(client, workflow={"nodes": [http_node()], "edges": []})
        sent = {"retry_delay": 0.00001, "retry_backoff_factor": 2.5, "max_size": 30}
        response = client.put(
            f"/tests/{created['id']}",
            json={"workflow": {"nodes": [http_node(**sent)], "edges": []}},
        )
        assert response.status_code == 200, response.json()

        assert http_numbers(self._read(client, created["id"])["workflow"]["nodes"][0]) == {
            "retry_delay": "0.00001",
            "retry_backoff_factor": 2.5,
            "max_size": 30,
        }

    def test_a_local_function_stores_its_declarations_body_and_inputs(
        self, client: TestClient
    ) -> None:
        from tests.api.wire_number_cases import BIG, TINY, http_node, http_numbers

        definition = {
            "name": "scale",
            "inputs": [{"name": "rate", "type": "float", "required": False, "default": TINY}],
            "outputs": [{"name": "total", "type": "integer", "default": BIG}],
            "variables": [{"name": "step", "type": "float", "value": 30.0}],
            "workflow": {
                "nodes": [http_node("body", retry_delay=TINY)],
                "edges": [{"id": "e0", "source": "start-node", "target": "body"}],
            },
        }
        block = {
            "id": "fn",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "local",
                "label": "Scale",
                "localDefinition": definition,
                "config": {"values": {"rate": 30.0}},
            },
        }

        created = self._created(client, workflow={"nodes": [block], "edges": []})
        data = self._read(client, created["id"])["workflow"]["nodes"][0]["data"]
        local = data["localDefinition"]

        assert [
            local["inputs"][0]["default"],
            local["outputs"][0]["default"],
            local["variables"][0]["value"],
            http_numbers(local["workflow"]["nodes"][0]),
            data["config"]["values"],
        ] == [
            "0.0000001",
            "1234567890123456789",
            "30.0",
            {"retry_delay": "0.0000001"},
            {"rate": "30.0"},
        ]

    def test_setter_rows_and_compare_to_values_are_stored_in_wire_form(
        self, client: TestClient
    ) -> None:
        from tests.api.wire_number_cases import BIG, SENT_VARIABLES, TINY

        rows = {"rate": TINY, "big": BIG, "whole": 30.0, "half": 2.5, "count": 30}
        setter = {
            "id": "set",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "elementType": "variable-setter",
                "nodeType": "control",
                "version": "1.0.0",
                "label": "Set",
                "variableTypes": {name: SENT_VARIABLES[name]["type"] for name in rows},
                "config": {"values": {"variables": rows}},
            },
        }
        checks = [
            {
                "id": f"a{index}",
                "type": "literal",
                "variable": name,
                "value_type": SENT_VARIABLES[name]["type"],
                "operator": "equals",
                "reference_value": value,
                "reference_is_expression": False,
            }
            for index, (name, value) in enumerate(rows.items())
        ]
        check = {
            "id": "check",
            "type": "workflowNode",
            "position": {"x": 0, "y": 100},
            "data": {
                "elementType": "assert",
                "nodeType": "control",
                "version": "1.0.0",
                "label": "Check",
                "config": {"values": {"assertions": checks}},
            },
        }

        created = self._created(
            client,
            workflow={
                "nodes": [setter, check],
                "edges": [{"id": "e1", "source": "set", "target": "check"}],
            },
            variables=SENT_VARIABLES,
        )
        nodes = self._read(client, created["id"])["workflow"]["nodes"]
        stored = ["0.0000001", "1234567890123456789", "30.0", 2.5, 30]

        assert list(nodes[0]["data"]["config"]["values"]["variables"].values()) == stored
        assert [
            row["reference_value"] for row in nodes[1]["data"]["config"]["values"]["assertions"]
        ] == stored

    def test_a_variables_patch_stores_its_numbers_in_wire_form(self, client: TestClient) -> None:
        from tests.api.wire_number_cases import SENT_VARIABLES, STORED_VARIABLES

        created = self._created(client)
        response = client.patch(
            f"/tests/{created['id']}/variables", json={"variables": SENT_VARIABLES}
        )

        assert response.status_code == 200, response.json()
        assert response.json()["data"] == STORED_VARIABLES
        assert self._read(client, created["id"])["variables"] == STORED_VARIABLES

    def test_a_variables_patch_refuses_a_value_that_breaks_the_number_rule(
        self, client: TestClient
    ) -> None:
        created = self._created(client)
        response = client.patch(
            f"/tests/{created['id']}/variables",
            json={"variables": {"n": {"type": "integer", "value": 2.5}}},
        )

        assert response.status_code == 400
        assert re.match(
            r"^Value for variable 'n' is not a valid integer$", response.json()["error"]["message"]
        )
        assert self._read(client, created["id"])["variables"] == {}


class TestTypedSettingEntriesOfAFunctionBlock:
    """REQ-3.1.3.14, REQ-3.1.3.19: a Function Block's typed list input follows the number rule
    item by item, and a save stores each item in wire form."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def _block(self, ids: list[Any]) -> dict[str, Any]:
        return {
            "id": "fn",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "local",
                "label": "Scale",
                "localDefinition": {
                    "name": "scale",
                    "inputs": [{"name": "ids", "type": "array", "required": True}],
                    "outputs": [],
                    "workflow": {"nodes": [], "edges": []},
                },
                "elementTypes": {"ids": ["integer", "integer"]},
                "config": {"values": {"ids": ids}},
            },
        }

    def test_an_item_that_breaks_the_number_rule_is_refused(self, client: TestClient) -> None:
        response = client.post(
            "/tests",
            json={
                "name": "Typed Items",
                "workflow": {"nodes": [self._block([1, "1e5"])], "edges": []},
            },
        )

        assert response.status_code == 422, response.json()
        assert [
            (detail["code"], detail["message"]) for detail in response.json()["error"]["details"]
        ] == [
            (
                "INVALID_SETTING_TYPE",
                "Setting 'ids' of block 'scale' at item 2 is not a valid integer",
            )
        ]

    def test_an_item_past_2_to_the_53_is_stored_as_its_digits(self, client: TestClient) -> None:
        from tests.api.wire_number_cases import BIG

        response = client.post(
            "/tests",
            json={
                "name": "Typed Items",
                "workflow": {"nodes": [self._block([30, BIG])], "edges": []},
            },
        )
        assert response.status_code == 201, response.json()

        read = client.get(f"/tests/{response.json()['data']['id']}").json()["data"]
        assert read["workflow"]["nodes"][0]["data"]["config"]["values"] == {
            "ids": [30, "1234567890123456789"]
        }


class TestABodyThatIsNotAJsonObject:
    """A Test write whose body is not a JSON object is a bad request and writes nothing."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    BODIES = [
        pytest.param('"name"', "The request body must be a JSON object", id="string"),
        pytest.param("[1, 2]", "The request body must be a JSON object", id="list"),
        pytest.param("5", "The request body must be a JSON object", id="number"),
        pytest.param("{not json", "The request body is not valid JSON", id="not-json"),
    ]

    def _send(self, client: TestClient, method: str, path: str, text: str) -> Any:
        return client.request(
            method, path, content=text, headers={"content-type": "application/json"}
        )

    @pytest.mark.parametrize(("text", "message"), BODIES)
    def test_a_create_is_refused_and_writes_nothing(
        self, client: TestClient, text: str, message: str
    ) -> None:
        before = client.get("/tests").json()["data"]

        response = self._send(client, "POST", "/tests", text)

        assert response.status_code == 400, response.json()
        assert response.json()["error"]["message"] == message
        assert client.get("/tests").json()["data"] == before

    @pytest.mark.parametrize("route", ["", "/metadata", "/variables"])
    @pytest.mark.parametrize(("text", "message"), BODIES)
    def test_an_update_is_refused_and_changes_nothing(
        self, client: TestClient, route: str, text: str, message: str
    ) -> None:
        created = client.post("/tests", json={"name": f"Body Shape {uuid.uuid4().hex[:8]}"})
        assert created.status_code == 201, created.json()
        test_id = created.json()["data"]["id"]
        before = client.get(f"/tests/{test_id}").json()["data"]
        method = "PUT" if route == "" else "PATCH"

        response = self._send(client, method, f"/tests/{test_id}{route}", text)

        assert response.status_code == 400, response.json()
        assert response.json()["error"]["message"] == message
        assert client.get(f"/tests/{test_id}").json()["data"] == before

    @pytest.mark.parametrize(("text", "message"), BODIES)
    def test_a_workflow_check_is_refused(self, client: TestClient, text: str, message: str) -> None:
        response = self._send(client, "POST", "/workflows/validate", text)

        assert response.status_code == 400, response.json()
        assert response.json()["error"]["message"] == message

    def test_a_clone_with_a_body_that_is_not_an_object_takes_the_defaults(
        self, client: TestClient
    ) -> None:
        created = client.post("/tests", json={"name": f"Clone Source {uuid.uuid4().hex[:8]}"})
        test_id = created.json()["data"]["id"]

        response = self._send(client, "POST", f"/tests/{test_id}/clone", '"x"')

        assert response.status_code == 201, response.json()
        assert response.json()["data"]["name"].endswith("(Copy)")

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            pytest.param("POST", "/tests/export", id="export"),
            pytest.param("POST", "/tests/{id}/versions", id="add-version"),
        ],
    )
    @pytest.mark.parametrize(("text", "message"), NOT_OBJECT_BODIES)
    def test_every_other_write_is_refused(
        self, client: TestClient, method: str, path: str, text: str, message: str
    ) -> None:
        response = send_text(client, method, path.format(id=uuid.uuid4()), text)

        assert_refused(response, message)


class TestATestBatchBodyThatIsNotAJsonArray:
    """A Test batch whose body is not a JSON array is a bad request."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE"])
    @pytest.mark.parametrize(("text", "message"), NOT_ARRAY_BODIES)
    def test_it_is_refused(self, client: TestClient, method: str, text: str, message: str) -> None:
        assert_refused(send_text(client, method, "/tests/batch", text), message)

    def test_a_delete_takes_the_ids_of_an_object(self, client: TestClient) -> None:
        test_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.tests.batch_routes.test_service.batch_delete_tests"
        ) as batch_delete:
            batch_delete.return_value = {"deleted": [test_id], "failed": []}
            response = client.request("DELETE", "/tests/batch", json={"ids": [test_id]})

        assert response.status_code == 200, response.json()
        batch_delete.assert_called_once_with([test_id])

    def test_a_delete_whose_ids_are_not_an_array_is_refused(self, client: TestClient) -> None:
        response = send_text(client, "DELETE", "/tests/batch", '{"ids": "x"}')

        assert_refused(response, "The request body must be a JSON array")
