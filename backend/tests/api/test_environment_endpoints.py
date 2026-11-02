"""Unit tests for environment endpoints (REQ-5.2.1.42).

This module tests the environment endpoints providing lifecycle operations
for environment management enabling creation, modification, listing,
and deletion with usage protection.

Test Coverage:
- Environment CRUD: Create, read, update, delete operations
- Environment listing: List all environments with pagination
- Validation: Name validation, required fields
- Error handling: Not found, conflict (duplicate names, delete protection)
- Usage calculation: Profile count for each environment
- Caching: Cache headers, cache invalidation
- Response structure: Standard success/error format, metadata
"""

import re
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException, ValidationException


class TestListEnvironmentsEndpoint:
    """Test suite for GET /environments endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_environments_serves_canonical_path_without_redirect(
        self, client: TestClient
    ) -> None:
        """GET /environments must serve directly, never via 307 -> /environments/.

        The dev FE routes through Vite's /api proxy. If FastAPI 307-redirects
        a missing trailing slash, the relative Location header points at a
        path that no longer has /api, so the browser bypasses the proxy and
        the page hangs. Pinning the route at the bare path keeps both modes
        (dev proxy and direct) working.
        """
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }
            response = client.get("/environments", follow_redirects=False)
            assert response.status_code == 200, (
                f"Expected 200 at /environments, got {response.status_code}. "
                "Route must use empty path string, not '/' - see fix in routes.py."
            )

    def test_create_environment_serves_canonical_path_without_redirect(
        self, client: TestClient
    ) -> None:
        """POST /environments must serve directly, never via 307 -> /environments/."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.create_environment"
        ) as mock_create:
            mock_create.return_value = {
                "id": str(uuid.uuid4()),
                "name": "test",
                "description": None,
                "tags": [],
                "usage": 0,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }
            response = client.post(
                "/environments",
                json={"name": "test"},
                follow_redirects=False,
            )
            assert response.status_code == 201, (
                f"Expected 201 at POST /environments, got {response.status_code}. "
                "Route must use empty path string, not '/' - see fix in routes.py."
            )

    def test_list_environments_returns_200_with_environments(self, client: TestClient) -> None:
        """Test that GET /environments returns list of environments."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [
                    {
                        "id": env_id,
                        "name": "production",
                        "description": "Production environment",
                        "usage": 3,
                        "created_at": "2025-01-01T00:00:00Z",
                        "updated_at": "2025-01-01T00:00:00Z",
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/environments")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 1
            assert data["data"][0]["name"] == "production"
            assert data["data"][0]["usage"] == 3
            mock_list.assert_called_once()

    def test_list_environments_returns_empty_list(self, client: TestClient) -> None:
        """Test that GET /environments returns empty list when none exist."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/environments")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_environments_includes_response_metadata(self, client: TestClient) -> None:
        """Test that GET /environments includes standard metadata."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/environments")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]
            assert "timestamp" in data["meta"]

    def test_list_environments_includes_pagination_info(self, client: TestClient) -> None:
        """Test that GET /environments includes pagination info."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [],
                "total": 50,
                "page": 2,
                "per_page": 20,
                "total_pages": 3,
            }

            response = client.get("/environments?page=2&per_page=20")

            assert response.status_code == 200
            data = response.json()
            assert "pagination" in data
            assert data["pagination"]["total"] == 50
            assert data["pagination"]["page"] == 2
            assert data["pagination"]["per_page"] == 20
            assert data["pagination"]["total_pages"] == 3

    def test_list_environments_accepts_page_parameter(self, client: TestClient) -> None:
        """Test that GET /environments accepts page query parameter."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [],
                "total": 0,
                "page": 3,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/environments?page=3")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=3,
                per_page=20,
                search=None,
                tags=None,
            )

    def test_list_environments_accepts_per_page_parameter(self, client: TestClient) -> None:
        """Test that GET /environments accepts per_page query parameter."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [],
                "total": 0,
                "page": 1,
                "per_page": 50,
                "total_pages": 0,
            }

            response = client.get("/environments?per_page=50")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=50,
                search=None,
                tags=None,
            )

    def test_list_environments_accepts_search_parameter(self, client: TestClient) -> None:
        """Test that GET /environments accepts search query parameter."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/environments?search=prod")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search="prod",
                tags=None,
            )

    def test_list_environments_validates_page_minimum(self, client: TestClient) -> None:
        """Test that GET /environments validates page >= 1."""
        response = client.get("/environments?page=0")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False

    def test_list_environments_validates_per_page_maximum(self, client: TestClient) -> None:
        """Test that GET /environments validates per_page <= 100."""
        response = client.get("/environments?per_page=200")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False

    def test_list_environments_validates_per_page_minimum(self, client: TestClient) -> None:
        """Test that GET /environments validates per_page >= 1."""
        response = client.get("/environments?per_page=0")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False

    def test_list_environments_accepts_sort_parameter(self, client: TestClient) -> None:
        """Test that GET /environments accepts sort query parameter."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/environments?sort=name:asc")

            assert response.status_code == 200
            mock_list.assert_called_once_with(
                page=1,
                per_page=20,
                search=None,
                tags=None,
                sort_by="name",
                sort_direction="asc",
            )

    def test_list_environments_validates_sort_field(self, client: TestClient) -> None:
        """Test that GET /environments validates sort field."""
        response = client.get("/environments?sort=invalid_field:asc")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "invalid" in data["error"]["message"].lower()

    def test_list_environments_validates_sort_direction(self, client: TestClient) -> None:
        """Test that GET /environments validates sort direction."""
        response = client.get("/environments?sort=name:invalid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False

    def test_list_environments_sets_cache_headers(self, client: TestClient) -> None:
        """Test that GET /environments sets cache headers."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environments"
        ) as mock_list:
            mock_list.return_value = {
                "environments": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/environments")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers


class TestCreateEnvironmentEndpoint:
    """Test suite for POST /environments endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_environment_returns_201_on_success(self, client: TestClient) -> None:
        """Test that POST /environments creates environment and returns 201."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.create_environment"
        ) as mock_create:
            mock_create.return_value = {
                "id": env_id,
                "name": "production",
                "description": "Production environment",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(
                "/environments",
                json={
                    "name": "production",
                    "description": "Production environment",
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == env_id
            assert data["data"]["name"] == "production"

    def test_create_environment_requires_name_field(self, client: TestClient) -> None:
        """Test that POST /environments requires 'name' field."""
        response = client.post(
            "/environments",
            json={"description": "Some description"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'name' is required$",
            data["error"]["message"],
        )

    def test_create_environment_accepts_optional_description(self, client: TestClient) -> None:
        """Test that POST /environments accepts optional description."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.create_environment"
        ) as mock_create:
            mock_create.return_value = {
                "id": env_id,
                "name": "staging",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(
                "/environments",
                json={"name": "staging"},
            )

            assert response.status_code == 201

    def test_create_environment_returns_409_on_duplicate_name(self, client: TestClient) -> None:
        """Test that POST /environments returns 409 for duplicate name."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.create_environment"
        ) as mock_create:
            mock_create.side_effect = ConflictException(
                "Environment with name 'production' already exists"
            )

            response = client.post(
                "/environments",
                json={"name": "production"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "already exists" in data["error"]["message"]
            assert data["error"]["code"] == "CONFLICT"

    def test_create_environment_validates_empty_name(self, client: TestClient) -> None:
        """Test that POST /environments validates non-empty name."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.create_environment"
        ) as mock_create:
            mock_create.side_effect = ValidationException(
                "Environment name is required and cannot be empty"
            )

            response = client.post(
                "/environments",
                json={"name": ""},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "required" in data["error"]["message"].lower()

    def test_create_environment_validates_name_length(self, client: TestClient) -> None:
        """Test that POST /environments validates name length."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.create_environment"
        ) as mock_create:
            mock_create.side_effect = ValidationException(
                "Environment name must be between 1 and 255 characters"
            )

            response = client.post(
                "/environments",
                json={"name": "a" * 300},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "255 characters" in data["error"]["message"]

    def test_create_environment_includes_response_metadata(self, client: TestClient) -> None:
        """Test that POST /environments includes response metadata."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.create_environment"
        ) as mock_create:
            mock_create.return_value = {
                "id": env_id,
                "name": "dev",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(
                "/environments",
                json={"name": "dev"},
            )

            assert response.status_code == 201
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]

    def test_create_environment_invalidates_cache(self, client: TestClient) -> None:
        """Test that POST /environments invalidates list cache."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.create_environment"
        ) as mock_create:
            mock_create.return_value = {
                "id": env_id,
                "name": "new-env",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(
                "/environments",
                json={"name": "new-env"},
            )

            assert response.status_code == 201
            assert "X-Cache-Invalidated" in response.headers


class TestGetEnvironmentEndpoint:
    """Test suite for GET /environments/{environment_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_environment_returns_200_with_environment(self, client: TestClient) -> None:
        """Test that GET /environments/{id} returns environment details."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.get_environment"
        ) as mock_get:
            mock_get.return_value = {
                "id": env_id,
                "name": "production",
                "description": "Production environment",
                "usage": 5,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.get(f"/environments/{env_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == env_id
            assert data["data"]["name"] == "production"
            assert data["data"]["usage"] == 5
            mock_get.assert_called_once_with(env_id)

    def test_get_environment_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /environments/{id} returns 404 when not found."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.get_environment"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/environments/{env_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Environment with ID '{env_id}' not found$",
                data["error"]["message"],
            )

    def test_get_environment_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /environments/{id} validates UUID format."""
        response = client.get("/environments/invalid-uuid-format")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for environment_id: 'invalid-uuid-format'$",
            data["error"]["message"],
        )

    def test_get_environment_includes_usage_count(self, client: TestClient) -> None:
        """Test that GET /environments/{id} includes usage count."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.get_environment"
        ) as mock_get:
            mock_get.return_value = {
                "id": env_id,
                "name": "staging",
                "usage": 3,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.get(f"/environments/{env_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["usage"] == 3

    def test_get_environment_sets_cache_headers(self, client: TestClient) -> None:
        """Test that GET /environments/{id} sets cache headers."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.get_environment"
        ) as mock_get:
            mock_get.return_value = {
                "id": env_id,
                "name": "production",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.get(f"/environments/{env_id}")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers


class TestUpdateEnvironmentEndpoint:
    """Test suite for PUT /environments/{environment_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_environment_returns_200_on_success(self, client: TestClient) -> None:
        """Test that PUT /environments/{id} updates environment."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.update_environment"
        ) as mock_update:
            mock_update.return_value = {
                "id": env_id,
                "name": "updated-name",
                "description": "Updated description",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/environments/{env_id}",
                json={
                    "name": "updated-name",
                    "description": "Updated description",
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "updated-name"

    def test_update_environment_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PUT /environments/{id} returns 404 when not found."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.update_environment"
        ) as mock_update:
            mock_update.return_value = None

            response = client.put(
                f"/environments/{env_id}",
                json={"name": "updated-name"},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_update_environment_returns_409_on_duplicate_name(self, client: TestClient) -> None:
        """Test that PUT /environments/{id} returns 409 for duplicate name."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.update_environment"
        ) as mock_update:
            mock_update.side_effect = ConflictException(
                "Environment with name 'existing' already exists"
            )

            response = client.put(
                f"/environments/{env_id}",
                json={"name": "existing"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "already exists" in data["error"]["message"]

    def test_update_environment_validates_uuid_format(self, client: TestClient) -> None:
        """Test that PUT /environments/{id} validates UUID format."""
        response = client.put(
            "/environments/invalid-uuid",
            json={"name": "test"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_update_environment_partial_update_name_only(self, client: TestClient) -> None:
        """Test that PUT /environments/{id} allows partial update (name only)."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.update_environment"
        ) as mock_update:
            mock_update.return_value = {
                "id": env_id,
                "name": "new-name",
                "description": "Original description",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/environments/{env_id}",
                json={"name": "new-name"},
            )

            assert response.status_code == 200
            mock_update.assert_called_once_with(
                environment_id=env_id,
                name="new-name",
                description=None,
                tags=None,
            )

    def test_update_environment_partial_update_description_only(self, client: TestClient) -> None:
        """Test that PUT /environments/{id} allows partial update (description only)."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.update_environment"
        ) as mock_update:
            mock_update.return_value = {
                "id": env_id,
                "name": "original-name",
                "description": "New description",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/environments/{env_id}",
                json={"description": "New description"},
            )

            assert response.status_code == 200
            mock_update.assert_called_once_with(
                environment_id=env_id,
                name=None,
                description="New description",
                tags=None,
            )

    def test_update_environment_invalidates_cache(self, client: TestClient) -> None:
        """Test that PUT /environments/{id} invalidates cache."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.update_environment"
        ) as mock_update:
            mock_update.return_value = {
                "id": env_id,
                "name": "updated",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/environments/{env_id}",
                json={"name": "updated"},
            )

            assert response.status_code == 200
            assert "X-Cache-Invalidated" in response.headers

    def test_update_environment_empty_body_returns_400(self, client: TestClient) -> None:
        """Test that PUT /environments/{id} with empty body returns 400."""
        env_id = str(uuid.uuid4())

        response = client.put(
            f"/environments/{env_id}",
            json={},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False


class TestDeleteEnvironmentEndpoint:
    """Test suite for DELETE /environments/{environment_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_environment_returns_204_on_success(self, client: TestClient) -> None:
        """Test that DELETE /environments/{id} returns 204 on success."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.delete_environment"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/environments/{env_id}")

            assert response.status_code == 204
            mock_delete.assert_called_once_with(env_id)

    def test_delete_environment_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /environments/{id} returns 404 when not found."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.delete_environment"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/environments/{env_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_delete_environment_succeeds_when_in_use(self, client: TestClient) -> None:
        """DELETE /environments/{id} does not block on usage; cascade-removes."""
        from wavecore.api.services.environments import service as environment_service
        from wavecore.api.services.profiles import _common as _profile_common

        environment_service._clear_storage()
        _profile_common._clear_storage()

        created = environment_service.create_environment(name="prod")
        env_id = created["id"]

        profile_id = str(uuid.uuid4())
        _profile_common._profile_storage[profile_id] = {
            "id": profile_id,
            "name": "p",
            "type": "custom",
            "config": {},
            "environment_values": {
                env_id: {"k": {"type": "string", "secret": False, "value": "v"}},
            },
            "updated_at": "2026-01-01T00:00:00Z",
        }

        response = client.delete(f"/environments/{env_id}")

        assert response.status_code == 204
        # Profile retained but values for this env are gone.
        assert env_id not in _profile_common._profile_storage[profile_id]["environment_values"]

    def test_delete_environment_validates_uuid_format(self, client: TestClient) -> None:
        """Test that DELETE /environments/{id} validates UUID format."""
        response = client.delete("/environments/not-a-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_delete_environment_invalidates_cache(self, client: TestClient) -> None:
        """Test that DELETE /environments/{id} invalidates cache."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.delete_environment"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/environments/{env_id}")

            assert response.status_code == 204
            assert "X-Cache-Invalidated" in response.headers


class TestDuplicateEnvironmentEndpoint:
    """Test suite for POST /environments/{environment_id}/duplicate endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_duplicate_environment_returns_201_on_success(self, client: TestClient) -> None:
        """Test that POST /environments/{id}/duplicate creates copy."""
        source_id = str(uuid.uuid4())
        new_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.duplicate_environment"
        ) as mock_duplicate:
            mock_duplicate.return_value = {
                "id": new_id,
                "name": "production (Copy)",
                "description": "Production environment",
                "created_at": "2025-01-02T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.post(f"/environments/{source_id}/duplicate")

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == new_id
            assert data["data"]["name"] == "production (Copy)"
            mock_duplicate.assert_called_once_with(source_id)

    def test_duplicate_environment_returns_404_when_source_not_found(
        self, client: TestClient
    ) -> None:
        """Test that POST /environments/{id}/duplicate returns 404 when not found."""
        source_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.duplicate_environment"
        ) as mock_duplicate:
            mock_duplicate.return_value = None

            response = client.post(f"/environments/{source_id}/duplicate")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_duplicate_environment_validates_uuid_format(self, client: TestClient) -> None:
        """Test that POST /environments/{id}/duplicate validates UUID format."""
        response = client.post("/environments/bad-uuid/duplicate")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_duplicate_environment_invalidates_cache(self, client: TestClient) -> None:
        """Test that POST /environments/{id}/duplicate invalidates cache."""
        source_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.duplicate_environment"
        ) as mock_duplicate:
            mock_duplicate.return_value = {
                "id": str(uuid.uuid4()),
                "name": "Copy",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(f"/environments/{source_id}/duplicate")

            assert response.status_code == 201
            assert "X-Cache-Invalidated" in response.headers

    def test_duplicate_environment_includes_response_metadata(self, client: TestClient) -> None:
        """Test that POST /environments/{id}/duplicate includes metadata."""
        source_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.duplicate_environment"
        ) as mock_duplicate:
            mock_duplicate.return_value = {
                "id": str(uuid.uuid4()),
                "name": "Copy",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(f"/environments/{source_id}/duplicate")

            assert response.status_code == 201
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]


class TestEnvironmentErrorHandling:
    """Test suite for error handling across environment endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_internal_error_returns_500_with_correlation_id(self, client: TestClient) -> None:
        """Test that internal errors return 500 with correlation ID."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.get_environment"
        ) as mock_get:
            mock_get.side_effect = RuntimeError("Unexpected error")

            response = client.get(f"/environments/{env_id}")

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "request_id" in data["meta"]

    def test_malformed_json_returns_error(self, client: TestClient) -> None:
        """Test that malformed JSON returns an error response."""
        response = client.post(
            "/environments",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )

        assert response.status_code in (400, 422, 500)
        data = response.json()
        assert data["success"] is False


class TestEnvironmentRouteOrdering:
    """Test suite for route ordering (specific routes before parameterized)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_duplicate_route_not_captured_as_environment_id(self, client: TestClient) -> None:
        """Test that /environments/{id}/duplicate is routed correctly."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.duplicate_environment"
        ) as mock_duplicate:
            mock_duplicate.return_value = {
                "id": str(uuid.uuid4()),
                "name": "Copy",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            _response = client.post(f"/environments/{env_id}/duplicate")

            # Should hit duplicate_environment, not some other handler
            mock_duplicate.assert_called_once_with(env_id)


class TestListEnvironmentTagsEndpoint:
    """Test suite for GET /environments/tags endpoint (REQ-9.5.3.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_tags_returns_200_with_unique_tags(self, client: TestClient) -> None:
        """Test that GET /environments/tags returns 200 with all unique tags."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = [
                "development",
                "eu-west",
                "production",
                "staging",
                "us-east",
            ]

            response = client.get("/environments/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == [
                "development",
                "eu-west",
                "production",
                "staging",
                "us-east",
            ]
            mock_list_tags.assert_called_once()

    def test_list_tags_returns_200_with_empty_array_when_no_tags(self, client: TestClient) -> None:
        """Test that GET /environments/tags returns 200 with empty array when no tags exist."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = []

            response = client.get("/environments/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_tags_returns_sorted_tags(self, client: TestClient) -> None:
        """Test that GET /environments/tags returns tags in alphabetical order."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_all_tags"
        ) as mock_list_tags:
            # Service returns sorted tags
            mock_list_tags.return_value = ["alpha", "beta", "gamma", "zeta"]

            response = client.get("/environments/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["data"] == ["alpha", "beta", "gamma", "zeta"]

    def test_list_tags_includes_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /environments/tags includes Cache-Control header."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = ["tag1", "tag2"]

            response = client.get("/environments/tags")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert response.headers["Cache-Control"] == "max-age=60"

    def test_list_tags_includes_meta_in_response(self, client: TestClient) -> None:
        """Test that GET /environments/tags includes meta information in response."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = ["tag1"]

            response = client.get("/environments/tags")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]


class TestListEnvironmentNamesEndpoint:
    """Test suite for GET /environments/names endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_names_returns_200_with_all_environments(self, client: TestClient) -> None:
        """Test that GET /environments/names returns 200 with all environments."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environment_names"
        ) as mock_list_names:
            mock_list_names.return_value = [
                {"id": "env-1", "name": "Alpha", "tags": ["prod"]},
                {"id": "env-2", "name": "Beta", "tags": []},
                {"id": "env-3", "name": "Gamma", "tags": ["dev", "test"]},
            ]

            response = client.get("/environments/names")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 3
            assert data["data"][0]["name"] == "Alpha"
            assert data["data"][1]["name"] == "Beta"
            assert data["data"][2]["name"] == "Gamma"
            mock_list_names.assert_called_once()

    def test_list_names_returns_only_id_name_tags(self, client: TestClient) -> None:
        """Test that GET /environments/names returns only id, name, and tags."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environment_names"
        ) as mock_list_names:
            mock_list_names.return_value = [
                {"id": "env-1", "name": "Production", "tags": ["prod"]},
            ]

            response = client.get("/environments/names")

            assert response.status_code == 200
            data = response.json()
            env = data["data"][0]
            assert set(env.keys()) == {"id", "name", "tags"}

    def test_list_names_returns_200_with_empty_array_when_no_environments(
        self, client: TestClient
    ) -> None:
        """Test that GET /environments/names returns 200 with empty array when no environments."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environment_names"
        ) as mock_list_names:
            mock_list_names.return_value = []

            response = client.get("/environments/names")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_names_includes_cache_control_header(self, client: TestClient) -> None:
        """Test that GET /environments/names includes Cache-Control header."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environment_names"
        ) as mock_list_names:
            mock_list_names.return_value = [
                {"id": "env-1", "name": "Test", "tags": []},
            ]

            response = client.get("/environments/names")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert response.headers["Cache-Control"] == "max-age=60"

    def test_list_names_includes_meta_in_response(self, client: TestClient) -> None:
        """Test that GET /environments/names includes meta information in response."""
        with patch(
            "wavecore.api.routes.environments.routes.environment_service.list_environment_names"
        ) as mock_list_names:
            mock_list_names.return_value = []

            response = client.get("/environments/names")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]


class TestEnvironmentConcurrencyControl:
    """Test suite for concurrency control via ETag/If-Match (REQ-5.2.4.3)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_environment_returns_etag_header(self, client: TestClient) -> None:
        """Test that GET /environments/{id} returns ETag header."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.get_environment"
        ) as mock_get:
            mock_get.return_value = {
                "id": env_id,
                "name": "production",
                "description": "Production environment",
                "tags": [],
                "usage": 0,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.get(f"/environments/{env_id}")

            assert response.status_code == 200
            assert "ETag" in response.headers
            assert response.headers["ETag"].startswith('"')

    def test_update_with_if_match_succeeds_when_matching(self, client: TestClient) -> None:
        """Test that PUT with matching If-Match header succeeds."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.update_environment"
        ) as mock_update:
            mock_update.return_value = {
                "id": env_id,
                "name": "Updated Env",
                "description": "Updated",
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/environments/{env_id}",
                json={"name": "Updated Env"},
                headers={"If-Match": '"abc123"'},
            )

            assert response.status_code == 200
            mock_update.assert_called_once()
            call_kwargs = mock_update.call_args[1]
            assert call_kwargs.get("etag") == '"abc123"'

    def test_update_with_if_match_fails_when_mismatched(self, client: TestClient) -> None:
        """Test that PUT with mismatched If-Match returns 412."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.update_environment"
        ) as mock_update:
            exc = ConflictException("Precondition failed: resource has been modified")
            exc.status_code = 412
            exc.error_code = "PRECONDITION_FAILED"
            mock_update.side_effect = exc

            response = client.put(
                f"/environments/{env_id}",
                json={"name": "Updated Env"},
                headers={"If-Match": '"stale-etag"'},
            )

            assert response.status_code == 412
            data = response.json()
            assert data["success"] is False
            assert "Precondition failed" in data["error"]["message"]

    def test_update_returns_new_etag_header(self, client: TestClient) -> None:
        """Test that PUT returns new ETag header after successful update."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.update_environment"
        ) as mock_update:
            mock_update.return_value = {
                "id": env_id,
                "name": "Updated Env",
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/environments/{env_id}",
                json={"name": "Updated Env"},
            )

            assert response.status_code == 200
            assert "ETag" in response.headers

    def test_delete_with_if_match_fails_when_mismatched(self, client: TestClient) -> None:
        """Test that DELETE with mismatched If-Match returns 412."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.get_environment"
        ) as mock_get:
            mock_get.return_value = {
                "id": env_id,
                "name": "production",
                "tags": [],
                "usage": 0,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.delete(
                f"/environments/{env_id}",
                headers={"If-Match": '"definitely-wrong-etag"'},
            )

            assert response.status_code == 412
            data = response.json()
            assert data["success"] is False
            assert "Precondition failed" in data["error"]["message"]

    def test_delete_without_if_match_succeeds(self, client: TestClient) -> None:
        """Test that DELETE without If-Match header still works."""
        env_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.environments.routes.environment_service.delete_environment"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/environments/{env_id}")

            assert response.status_code == 204
