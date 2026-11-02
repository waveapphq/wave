"""Unit tests for connection profile endpoints (REQ-5.2.4.8).

This module tests the connection profile endpoints providing lifecycle operations
for connection profiles enabling creation, modification, connectivity testing,
type discovery, and schema retrieval.

Test Coverage:
- Profile CRUD: Create, read, update, delete profile operations
- Profile listing: List all profiles with metadata
- Profile types: Enumerate supported profile types with descriptions
- Type schemas: JSON Schema retrieval for type-specific configuration
- Connectivity testing: Verify profile configuration correctness
- Secret handling: Credential masking in responses (password, api_key, private_key, token,
  client_key)
- Validation: Type validation, configuration schema validation with field paths
- Error handling: Not found, conflict with referencing entities, bad request
- Caching and performance: Cache headers, connectivity test caching
- Description field: Optional documentation field support
- External credentials: Environment variable and Kubernetes secret references
"""

import re
import uuid
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException, ValidationException

# Valid profile types as defined in OpenAPI spec
VALID_PROFILE_TYPES = [
    "database",
    "ssh",
    "http",
    "kubernetes",
    "opensearch",
    "custom",
]

CLIENT_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBg\n-----END PRIVATE KEY-----\n"
DATABASE_SCHEMA_FIELDS = [
    {"name": "host", "type": "string", "required": False, "secret": False, "plain": True},
    {
        "name": "port",
        "type": "integer",
        "required": False,
        "secret": False,
        "minimum": 1,
        "maximum": 65535,
    },
    {"name": "database", "type": "string", "required": False, "secret": False},
    {"name": "username", "type": "string", "required": False, "secret": False},
    {"name": "password", "type": "string", "required": False, "secret": True},
    {"name": "verify_ssl", "type": "boolean", "required": False, "secret": False, "default": True},
    {"name": "ca_cert", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "client_cert", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "client_key", "type": "string", "required": False, "secret": True},
    {"name": "driver_options", "type": "map", "required": False, "secret": False, "default": {}},
]
OPENSEARCH_TYPE_DESCRIPTION = (
    "Search cluster connections with a cluster URL, credentials and TLS trust material"
)
OPENSEARCH_SCHEMA_FIELDS = [
    {"name": "url", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "username", "type": "string", "required": False, "secret": False},
    {"name": "password", "type": "string", "required": False, "secret": True},
    {"name": "api_key", "type": "string", "required": False, "secret": True},
    {"name": "bearer_token", "type": "string", "required": False, "secret": True},
    {"name": "verify_ssl", "type": "boolean", "required": False, "secret": False, "default": True},
    {"name": "ca_cert", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "client_cert", "type": "string", "required": False, "secret": False, "plain": True},
    {"name": "client_key", "type": "string", "required": False, "secret": True},
]


class TestListProfilesEndpoint:
    """Test suite for GET /profiles endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_profiles_returns_200_with_profiles(self, client: TestClient) -> None:
        """Test that GET /profiles returns list of profiles."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost", "port": 5432},
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                }
            ]

            response = client.get("/profiles")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["data"]) == 1
            assert data["data"][0]["name"] == "my-database"
            mock_list.assert_called_once()

    def test_list_profiles_returns_empty_list_when_no_profiles(self, client: TestClient) -> None:
        """Test that GET /profiles returns empty list when no profiles exist."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = []

            response = client.get("/profiles")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_profiles_includes_response_metadata(self, client: TestClient) -> None:
        """Test that GET /profiles response includes standard metadata."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = []

            response = client.get("/profiles")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]
            assert "timestamp" in data["meta"]


class TestCreateProfileEndpoint:
    """Test suite for POST /profiles endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_profile_returns_201_on_success(self, client: TestClient) -> None:
        """Test that POST /profiles creates profile and returns 201."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost", "port": 5432},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost", "port": 5432},
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == profile_id
            assert data["data"]["name"] == "my-database"

    def test_create_profile_requires_name_field(self, client: TestClient) -> None:
        """Test that POST /profiles requires 'name' field."""
        response = client.post(
            "/profiles",
            json={"type": "database", "config": {}},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'name' is required$",
            data["error"]["message"],
        )

    def test_create_profile_requires_type_field(self, client: TestClient) -> None:
        """Test that POST /profiles requires 'type' field."""
        response = client.post(
            "/profiles",
            json={"name": "my-profile", "config": {}},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'type' is required$",
            data["error"]["message"],
        )

    def test_create_profile_validates_type_enum(self, client: TestClient) -> None:
        """Test that POST /profiles validates type against allowed values."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.side_effect = ValidationException(
                "Invalid profile type 'invalid_type': valid types are "
                "database, ssh, http, kubernetes, opensearch, custom"
            )

            response = client.post(
                "/profiles",
                json={
                    "name": "my-profile",
                    "type": "invalid_type",
                    "config": {},
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Invalid profile type" in data["error"]["message"]

    def test_create_profile_rejects_sftp_type(self, client: TestClient) -> None:
        """Test that the unmocked POST /profiles refuses the removed sftp type (REQ-4.7.3)."""
        response = client.post(
            "/profiles",
            json={
                "name": "file-drop",
                "type": "sftp",
                "config": {"host": "files.example.com", "username": "deploy"},
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"
        assert data["error"]["message"] == (
            "Invalid profile type 'sftp': valid types are "
            "database, ssh, http, kubernetes, opensearch, custom"
        )

    @pytest.mark.parametrize("profile_type", VALID_PROFILE_TYPES)
    def test_create_profile_accepts_valid_types(
        self, client: TestClient, profile_type: str
    ) -> None:
        """Test that POST /profiles accepts all valid profile types."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": f"my-{profile_type}",
                "type": profile_type,
                "config": {},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": f"my-{profile_type}",
                    "type": profile_type,
                    "config": {},
                },
            )

            assert response.status_code == 201

    def test_create_profile_returns_409_on_duplicate_name(self, client: TestClient) -> None:
        """Test that POST /profiles returns 409 when name already exists."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.side_effect = ConflictException(
                "Profile with name 'my-database' already exists"
            )

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {},
                },
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "already exists" in data["error"]["message"]

    def test_create_profile_validates_config_against_schema(self, client: TestClient) -> None:
        """Test that POST /profiles validates config against type schema."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.side_effect = ValidationException(
                "Configuration validation failed: 'host' is a required field"
            )

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {"port": 5432},  # Missing 'host'
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "validation failed" in data["error"]["message"].lower()

    def test_create_profile_masks_secrets_in_response(self, client: TestClient) -> None:
        """Test that POST /profiles masks secret fields in response."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {
                    "host": "localhost",
                    "port": 5432,
                    "password": "********",
                },
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {
                        "host": "localhost",
                        "port": 5432,
                        "password": "secret123",
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["config"]["password"] == "********"

    def test_create_profile_with_description(self, client: TestClient) -> None:
        """Test that POST /profiles accepts optional description field (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "description": "Production database connection",
                "config": {"host": "localhost"},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "description": "Production database connection",
                    "config": {"host": "localhost"},
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["description"] == "Production database connection"

    def test_create_profile_with_env_var_credential_reference(self, client: TestClient) -> None:
        """Test that POST /profiles accepts env var credential references (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {
                    "host": "localhost",
                    "password": "${DB_PASSWORD}",
                },
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {
                        "host": "localhost",
                        "password": "${DB_PASSWORD}",
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            # Env var references should be stored as-is (not resolved at create time)
            assert data["data"]["config"]["password"] == "${DB_PASSWORD}"

    def test_create_profile_with_k8s_secret_credential_reference(self, client: TestClient) -> None:
        """Test that POST /profiles accepts K8s secret references (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {
                    "host": "localhost",
                    "password": "${k8s:secret/db-credentials/password}",
                },
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {
                        "host": "localhost",
                        "password": "${k8s:secret/db-credentials/password}",
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            # K8s secret references should be stored as-is
            assert data["data"]["config"]["password"] == "${k8s:secret/db-credentials/password}"

    def test_create_profile_validation_error_includes_field_path(self, client: TestClient) -> None:
        """Test that validation errors include field path details (REQ-5.2.4.8)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.side_effect = ValidationException(
                "Configuration validation failed at 'config.port': " "expected integer, got string"
            )

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost", "port": "invalid"},
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            # Error should include field path
            assert "config.port" in data["error"]["message"]


class TestGetProfileEndpoint:
    """Test suite for GET /profiles/{profile_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_profile_returns_200_with_profile(self, client: TestClient) -> None:
        """Test that GET /profiles/{profile_id} returns profile details."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost", "port": 5432},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == profile_id
            assert data["data"]["name"] == "my-database"
            mock_get.assert_called_once_with(profile_id)

    def test_get_profile_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /profiles/{profile_id} returns 404 when not found."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = None

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Profile with ID '{profile_id}' not found$",
                data["error"]["message"],
            )

    def test_get_profile_validates_uuid_format(self, client: TestClient) -> None:
        """Test that GET /profiles/{profile_id} validates UUID format."""
        response = client.get("/profiles/invalid-uuid-format")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for profile_id: 'invalid-uuid-format'$",
            data["error"]["message"],
        )

    def test_get_profile_masks_secrets(self, client: TestClient) -> None:
        """Test that GET /profiles/{profile_id} masks secret fields."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {
                    "host": "localhost",
                    "password": "********",
                },
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["config"]["password"] == "********"


class TestUpdateProfileEndpoint:
    """Test suite for PUT /profiles/{profile_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_profile_returns_200_on_success(self, client: TestClient) -> None:
        """Test that PUT /profiles/{profile_id} updates profile."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "updated-name",
                "type": "database",
                "config": {"host": "newhost", "port": 5432},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={
                    "name": "updated-name",
                    "config": {"host": "newhost", "port": 5432},
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["name"] == "updated-name"

    def test_update_profile_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that PUT /profiles/{profile_id} returns 404 when not found."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = None

            response = client.put(
                f"/profiles/{profile_id}",
                json={"name": "updated-name"},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_update_profile_validates_config_against_schema(self, client: TestClient) -> None:
        """Test that PUT /profiles/{profile_id} validates config."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.side_effect = ValidationException(
                "Configuration validation failed: invalid port value"
            )

            response = client.put(
                f"/profiles/{profile_id}",
                json={"config": {"port": "not-a-number"}},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "validation failed" in data["error"]["message"].lower()

    def test_update_profile_validates_uuid_format(self, client: TestClient) -> None:
        """Test that PUT /profiles/{profile_id} validates UUID format."""
        response = client.put(
            "/profiles/invalid-uuid",
            json={"name": "test"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_update_profile_partial_update_name_only(self, client: TestClient) -> None:
        """Test that PUT /profiles/{profile_id} allows partial updates."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "new-name",
                "type": "database",
                "config": {"host": "localhost"},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"name": "new-name"},
            )

            assert response.status_code == 200
            mock_update.assert_called_once_with(profile_id, name="new-name", config=None)

    def test_update_profile_partial_update_config_only(self, client: TestClient) -> None:
        """Test that PUT /profiles/{profile_id} allows config-only updates."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "original-name",
                "type": "database",
                "config": {"host": "newhost"},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"config": {"host": "newhost"}},
            )

            assert response.status_code == 200
            mock_update.assert_called_once_with(profile_id, name=None, config={"host": "newhost"})

    def test_update_profile_with_environment_values(self, client: TestClient) -> None:
        """Test that PUT /profiles/{profile_id} accepts environment_values."""
        profile_id = str(uuid.uuid4())
        env_id = str(uuid.uuid4())
        env_values = {env_id: {"host": "env-specific-host", "port": 5433}}

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "test-profile",
                "type": "database",
                "config": {"host": "localhost", "port": 5432},
                "environment_values": env_values,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"environment_values": env_values},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["environment_values"] == env_values
            # Verify environment_values was passed to service
            mock_update.assert_called_once()
            call_kwargs = mock_update.call_args[1]
            assert call_kwargs["environment_values"] == env_values

    def test_update_profile_forwards_description(self, client: TestClient) -> None:
        """Test that PUT /profiles/{id} forwards an edited description to the service
        (REQ-4.7.4).
        """
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "description": "Updated documentation",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"description": "Updated documentation"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["description"] == "Updated documentation"
            mock_update.assert_called_once()
            call_kwargs = mock_update.call_args[1]
            assert call_kwargs["description"] == "Updated documentation"

    def test_update_profile_clears_description_with_empty_string(self, client: TestClient) -> None:
        """Test that PUT /profiles/{id} forwards an empty description to clear it (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "description": "",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"description": ""},
            )

            assert response.status_code == 200
            mock_update.assert_called_once()
            call_kwargs = mock_update.call_args[1]
            assert call_kwargs["description"] == ""

    def test_update_profile_omitting_description_does_not_forward_it(
        self, client: TestClient
    ) -> None:
        """Test that PUT /profiles/{id} without a description leaves it unchanged (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "new-name",
                "type": "database",
                "config": {"host": "localhost"},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"name": "new-name"},
            )

            assert response.status_code == 200
            mock_update.assert_called_once()
            call_kwargs = mock_update.call_args[1]
            assert "description" not in call_kwargs


class TestDeleteProfileEndpoint:
    """Test suite for DELETE /profiles/{profile_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_profile_returns_204_on_success(self, client: TestClient) -> None:
        """Test that DELETE /profiles/{profile_id} deletes profile."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.delete_profile"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/profiles/{profile_id}")

            assert response.status_code == 204
            mock_delete.assert_called_once_with(profile_id)

    def test_delete_profile_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE /profiles/{profile_id} returns 404 when not found."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.delete_profile"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/profiles/{profile_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_delete_profile_returns_409_when_in_use(self, client: TestClient) -> None:
        """Test that DELETE /profiles/{profile_id} returns 409 when in use."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.delete_profile"
        ) as mock_delete:
            mock_delete.side_effect = ConflictException(
                f"Profile '{profile_id}' is in use by 3 tests"
            )

            response = client.delete(f"/profiles/{profile_id}")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "in use" in data["error"]["message"].lower()

    def test_delete_profile_conflict_includes_referencing_entities(
        self, client: TestClient
    ) -> None:
        """Test that 409 response includes referencing entity information (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.delete_profile"
        ) as mock_delete:
            mock_delete.side_effect = ConflictException(
                f"Profile '{profile_id}' is in use by: "
                "test-login-flow, test-checkout, test-payment-processing"
            )

            response = client.delete(f"/profiles/{profile_id}")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            # Error should include the names of referencing entities
            assert "test-login-flow" in data["error"]["message"]
            assert "test-checkout" in data["error"]["message"]
            assert "test-payment-processing" in data["error"]["message"]

    def test_delete_profile_validates_uuid_format(self, client: TestClient) -> None:
        """Test that DELETE /profiles/{profile_id} validates UUID format."""
        response = client.delete("/profiles/not-a-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]


class TestTestProfileConnectivityEndpoint:
    """Test suite for POST /profiles/{profile_id}/test endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_test_connectivity_returns_200_on_success(self, client: TestClient) -> None:
        """Test that POST /profiles/{profile_id}/test returns success result."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.test_connectivity"
        ) as mock_test:
            mock_test.return_value = {
                "connected": True,
                "latency": 15,
            }

            response = client.post(f"/profiles/{profile_id}/test")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["connected"] is True
            assert data["data"]["latency"] == 15
            mock_test.assert_called_once_with(profile_id)

    def test_test_connectivity_returns_failure_result(self, client: TestClient) -> None:
        """Test that POST /profiles/{profile_id}/test returns failure details."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.test_connectivity"
        ) as mock_test:
            mock_test.return_value = {
                "connected": False,
                "error": "Connection refused: host unreachable",
            }

            response = client.post(f"/profiles/{profile_id}/test")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True  # API call succeeded
            assert data["data"]["connected"] is False
            assert "Connection refused" in data["data"]["error"]

    def test_test_connectivity_returns_404_when_profile_not_found(self, client: TestClient) -> None:
        """Test that POST /profiles/{profile_id}/test returns 404 when not found."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.test_connectivity"
        ) as mock_test:
            mock_test.return_value = None

            response = client.post(f"/profiles/{profile_id}/test")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_test_connectivity_validates_uuid_format(self, client: TestClient) -> None:
        """Test that POST /profiles/{profile_id}/test validates UUID format."""
        response = client.post("/profiles/bad-uuid/test")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid UUID format" in data["error"]["message"]

    def test_test_connectivity_includes_latency_measurement(self, client: TestClient) -> None:
        """Test that connectivity test includes latency measurement (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.test_connectivity"
        ) as mock_test:
            mock_test.return_value = {
                "connected": True,
                "latency": 42,
            }

            response = client.post(f"/profiles/{profile_id}/test")

            assert response.status_code == 200
            data = response.json()
            assert "latency" in data["data"]
            assert isinstance(data["data"]["latency"], int)

    def test_test_connectivity_is_non_destructive(self, client: TestClient) -> None:
        """Test that connectivity test is read-only operation (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.test_connectivity"
        ) as mock_test:
            mock_test.return_value = {"connected": True, "latency": 10}

            # Multiple calls should be safe
            response1 = client.post(f"/profiles/{profile_id}/test")
            response2 = client.post(f"/profiles/{profile_id}/test")

            assert response1.status_code == 200
            assert response2.status_code == 200
            assert mock_test.call_count == 2

    def test_test_connectivity_returns_501_when_not_implemented(self, client: TestClient) -> None:
        """Test that POST /profiles/{profile_id}/test returns 501 when not implemented."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.test_connectivity"
        ) as mock_test:
            mock_test.side_effect = NotImplementedError(
                "Connectivity testing for 'database' profiles requires "
                "plugin implementations (planned for future phase)"
            )

            response = client.post(f"/profiles/{profile_id}/test")

            assert response.status_code == 501
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "NOT_IMPLEMENTED"
            assert "plugin implementations" in data["error"]["message"]


class TestListProfileTypesEndpoint:
    """Test suite for GET /profiles/types endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_types_returns_200_with_types(self, client: TestClient) -> None:
        """Test that GET /profiles/types returns list of types."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profile_types"
        ) as mock_list:
            mock_list.return_value = VALID_PROFILE_TYPES

            response = client.get("/profiles/types")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert set(data["data"]) == set(VALID_PROFILE_TYPES)

    def test_list_types_includes_all_supported_types(self, client: TestClient) -> None:
        """Test that GET /profiles/types includes all supported types (REQ-5.2.4.8)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profile_types"
        ) as mock_list:
            mock_list.return_value = VALID_PROFILE_TYPES

            response = client.get("/profiles/types")

            assert response.status_code == 200
            data = response.json()
            # Verify all documented types are present
            assert "database" in data["data"]
            assert "ssh" in data["data"]
            assert "http" in data["data"]
            assert "kubernetes" in data["data"]
            assert "opensearch" in data["data"]
            assert "custom" in data["data"]

    def test_list_types_sets_cache_headers(self, client: TestClient) -> None:
        """Test that GET /profiles/types sets cache headers (static data)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profile_types"
        ) as mock_list:
            mock_list.return_value = VALID_PROFILE_TYPES

            response = client.get("/profiles/types")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers

    def test_list_types_excludes_ldap(self, client: TestClient) -> None:
        """Test that GET /profiles/types does not offer ldap (REQ-4.7.3)."""
        response = client.get("/profiles/types")

        assert response.status_code == 200
        assert "ldap" not in response.json()["data"]

    def test_list_types_returns_the_six_supported_types_in_order(self, client: TestClient) -> None:
        """Test that the unmocked GET /profiles/types offers no sftp type (REQ-4.7.3)."""
        response = client.get("/profiles/types")

        assert response.status_code == 200
        assert response.json()["data"] == [
            "database",
            "ssh",
            "http",
            "kubernetes",
            "opensearch",
            "custom",
        ]

    def test_list_types_with_descriptions_lists_six_types_without_sftp(
        self, client: TestClient
    ) -> None:
        """Test that the unmocked described type list has six entries and no sftp (REQ-4.7.3)."""
        response = client.get("/profiles/types?include_descriptions=true")

        assert response.status_code == 200
        assert [item["type"] for item in response.json()["data"]] == [
            "database",
            "ssh",
            "http",
            "kubernetes",
            "opensearch",
            "custom",
        ]

    def test_list_types_returns_types_with_descriptions(self, client: TestClient) -> None:
        """Test that GET /profiles/types returns types with descriptions (REQ-5.2.4.8)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profile_types_with_descriptions"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "type": "database",
                    "description": "Relational database connections with host, port, "
                    "database name, and authentication",
                },
                {
                    "type": "ssh",
                    "description": "Remote shell access with host, port, username, "
                    "and key or password authentication",
                },
                {
                    "type": "http",
                    "description": "Base URLs with default headers, credentials, TLS "
                    "trust and client identity, and timeout configuration",
                },
                {
                    "type": "kubernetes",
                    "description": "Cluster access with a service account token or "
                    "client certificate",
                },
                {
                    "type": "opensearch",
                    "description": OPENSEARCH_TYPE_DESCRIPTION,
                },
                {
                    "type": "custom",
                    "description": "Extensible type for systems not covered by " "predefined types",
                },
            ]

            response = client.get("/profiles/types?include_descriptions=true")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            # Each type should have both type and description
            for item in data["data"]:
                assert "type" in item
                assert "description" in item
                assert len(item["description"]) > 0

    def test_list_types_describes_opensearch_by_its_cluster_url(self, client: TestClient) -> None:
        """Test the unmocked opensearch type description (REQ-4.7.3, REQ-3.4.1.15)."""
        response = client.get("/profiles/types?include_descriptions=true")

        assert response.status_code == 200
        described = {item["type"]: item["description"] for item in response.json()["data"]}
        assert described["opensearch"] == OPENSEARCH_TYPE_DESCRIPTION


class TestGetProfileTypeSchemaEndpoint:
    """Test suite for GET /profiles/types/{type}/schema endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_schema_returns_200_with_schema(self, client: TestClient) -> None:
        """Test that GET /profiles/types/{type}/schema returns JSON Schema."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.get_type_schema"
        ) as mock_get:
            mock_get.return_value = {
                "type": "object",
                "required": ["host"],
                "properties": {
                    "host": {"type": "string"},
                    "port": {"type": "integer", "default": 5432},
                    "password": {"type": "string", "secret": True},
                },
            }

            response = client.get("/profiles/types/database/schema")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["type"] == "object"
            assert "host" in data["data"]["properties"]
            mock_get.assert_called_once_with("database")

    def test_get_schema_returns_404_for_invalid_type(self, client: TestClient) -> None:
        """Test that GET /profiles/types/{type}/schema returns 404 for invalid type."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.get_type_schema"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get("/profiles/types/invalid_type/schema")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    @pytest.mark.parametrize("profile_type", VALID_PROFILE_TYPES)
    def test_get_schema_returns_schema_for_all_valid_types(
        self, client: TestClient, profile_type: str
    ) -> None:
        """Test that GET /profiles/types/{type}/schema works for all types."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.get_type_schema"
        ) as mock_get:
            mock_get.return_value = {
                "type": "object",
                "properties": {},
            }

            response = client.get(f"/profiles/types/{profile_type}/schema")

            assert response.status_code == 200
            mock_get.assert_called_once_with(profile_type)

    def test_get_schema_includes_secret_field_markers(self, client: TestClient) -> None:
        """Test that schema identifies secret fields (REQ-5.2.4.8)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.get_type_schema"
        ) as mock_get:
            mock_get.return_value = {
                "type": "object",
                "properties": {
                    "username": {"type": "string"},
                    "password": {"type": "string", "secret": True},
                    "api_key": {"type": "string", "secret": True},
                },
            }

            response = client.get("/profiles/types/database/schema")

            assert response.status_code == 200
            data = response.json()
            # Secret fields should be marked
            assert data["data"]["properties"]["password"].get("secret") is True
            assert data["data"]["properties"]["api_key"].get("secret") is True
            assert data["data"]["properties"]["username"].get("secret") is not True

    def test_get_schema_sets_cache_headers(self, client: TestClient) -> None:
        """Test that GET /profiles/types/{type}/schema sets cache headers."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.get_type_schema"
        ) as mock_get:
            mock_get.return_value = {"type": "object", "properties": {}}

            response = client.get("/profiles/types/database/schema")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers

    def test_get_schema_forwards_declared_starting_values(self, client: TestClient) -> None:
        """Test that the schema response carries a default per declared field (REQ-4.7.7)."""
        response = client.get("/profiles/types/kubernetes/schema")

        assert response.status_code == 200
        fields = {f["name"]: f for f in response.json()["data"]["fields"]}
        assert fields["namespace"]["default"] == "default"
        assert fields["verify_ssl"]["default"] is True

    def test_get_schema_omits_default_for_fields_without_one(self, client: TestClient) -> None:
        """Test that a field with no declared starting value carries no default key."""
        response = client.get("/profiles/types/kubernetes/schema")

        assert response.status_code == 200
        fields = {f["name"]: f for f in response.json()["data"]["fields"]}
        assert "default" not in fields["api_url"]

    @pytest.mark.parametrize("profile_type", VALID_PROFILE_TYPES)
    def test_get_schema_never_returns_enum(self, client: TestClient, profile_type: str) -> None:
        """Test that the schema response carries no choice list for any type (REQ-4.7.3)."""
        response = client.get(f"/profiles/types/{profile_type}/schema")

        assert response.status_code == 200
        for field in response.json()["data"]["fields"]:
            assert "enum" not in field

    def test_get_schema_returns_404_for_ldap(self, client: TestClient) -> None:
        """Test that the removed ldap type has no schema (REQ-4.7.3)."""
        response = client.get("/profiles/types/ldap/schema")

        assert response.status_code == 404

    def test_get_schema_returns_404_for_sftp(self, client: TestClient) -> None:
        """Test that the removed sftp type has no schema (REQ-4.7.3)."""
        response = client.get("/profiles/types/sftp/schema")

        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "NOT_FOUND"
        assert data["error"]["message"] == "Profile type 'sftp' not found"

    def test_get_database_schema_lists_the_sql_block_target_fields(
        self, client: TestClient
    ) -> None:
        """Test the unmocked database schema body (REQ-4.7.3, REQ-4.7.5, SQL-14)."""
        response = client.get("/profiles/types/database/schema")

        assert response.status_code == 200
        assert response.json()["data"] == {"type": "database", "fields": DATABASE_SCHEMA_FIELDS}

    def test_get_opensearch_schema_lists_the_opensearch_block_target_fields(
        self, client: TestClient
    ) -> None:
        """Test the unmocked opensearch schema body (REQ-4.7.3, REQ-3.4.1.15)."""
        response = client.get("/profiles/types/opensearch/schema")

        assert response.status_code == 200
        assert response.json()["data"] == {
            "type": "opensearch",
            "fields": OPENSEARCH_SCHEMA_FIELDS,
        }


class TestSecretHandling:
    """Test suite for secret handling across profile endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_profiles_masks_secrets(self, client: TestClient) -> None:
        """Test that GET /profiles masks secrets in all profiles."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "id": profile_id,
                    "name": "my-db",
                    "type": "database",
                    "config": {
                        "host": "localhost",
                        "password": "********",
                    },
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                }
            ]

            response = client.get("/profiles")

            assert response.status_code == 200
            data = response.json()
            assert data["data"][0]["config"]["password"] == "********"

    def test_update_profile_accepts_secrets(self, client: TestClient) -> None:
        """Test that PUT /profiles/{profile_id} accepts secret values."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "my-db",
                "type": "database",
                "config": {
                    "host": "localhost",
                    "password": "********",
                },
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"config": {"password": "new_secret"}},
            )

            assert response.status_code == 200
            data = response.json()
            # Response should have masked value
            assert data["data"]["config"]["password"] == "********"

    def test_create_profile_masks_token_secret(self, client: TestClient) -> None:
        """Test that POST /profiles masks token fields in response (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-http-service",
                "type": "http",
                "config": {
                    "base_url": "https://api.example.com",
                    "auth_token": "********",
                },
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-http-service",
                    "type": "http",
                    "config": {
                        "base_url": "https://api.example.com",
                        "auth_token": "bearer_token_12345",
                    },
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["config"]["auth_token"] == "********"

    def test_get_profile_masks_all_secret_types(self, client: TestClient) -> None:
        """Test that GET /profiles/{id} masks all secret field types (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = {
                "id": profile_id,
                "name": "multi-secret-profile",
                "type": "custom",
                "config": {
                    "password": "********",
                    "api_key": "********",
                    "private_key": "********",
                    "token": "********",
                    "non_secret": "visible_value",
                },
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 200
            data = response.json()
            # All secret fields should be masked
            assert data["data"]["config"]["password"] == "********"
            assert data["data"]["config"]["api_key"] == "********"
            assert data["data"]["config"]["private_key"] == "********"
            assert data["data"]["config"]["token"] == "********"
            # Non-secret fields should be visible
            assert data["data"]["config"]["non_secret"] == "visible_value"


class TestDatabaseProfileSecrets:
    """A database profile's password and client key are sealed and never returned (REQ-4.7.11)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def created(self, client: TestClient) -> dict[str, Any]:
        """A database profile created through the unmocked endpoint."""
        response = client.post(
            "/profiles",
            json={
                "name": "orders-db",
                "type": "database",
                "config": {"host": "db", "password": "s3cret-pass", "client_key": CLIENT_KEY_PEM},
            },
        )
        assert response.status_code == 201, response.text
        data: dict[str, Any] = response.json()["data"]
        return data

    def test_create_masks_password_and_client_key(self, created: dict[str, Any]) -> None:
        """Test that POST /profiles answers both credentials masked."""
        assert created["config"] == {
            "host": "db",
            "password": "********",
            "client_key": "********",
        }

    def test_get_masks_password_and_client_key(
        self, client: TestClient, created: dict[str, Any]
    ) -> None:
        """Test that GET /profiles/{id} answers both credentials masked."""
        response = client.get(f"/profiles/{created['id']}")

        assert response.status_code == 200
        assert response.json()["data"]["config"] == {
            "host": "db",
            "password": "********",
            "client_key": "********",
        }

    def test_both_credentials_are_stored_sealed(self, created: dict[str, Any]) -> None:
        """Test that the stored profile holds both credentials as sealed envelopes."""
        from wavecore.api.services.profiles import _common as profile_common
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        stored = profile_common._profile_storage[created["id"]]["config"]

        assert is_secret_envelope(stored["password"])
        assert is_secret_envelope(stored["client_key"])
        assert unseal_all(stored["client_key"]) == CLIENT_KEY_PEM


class TestErrorHandling:
    """Test suite for error handling across profile endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_internal_error_returns_500_with_request_id(self, client: TestClient) -> None:
        """Test that internal errors return 500 with request identifier in meta."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.side_effect = RuntimeError("Unexpected error")

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "request_id" in data["meta"]

    def test_malformed_json_returns_error(self, client: TestClient) -> None:
        """Test that malformed JSON returns an error response."""
        response = client.post(
            "/profiles",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )

        # Malformed JSON is caught by middleware as unhandled exception
        assert response.status_code in (400, 422, 500)
        data = response.json()
        assert data["success"] is False


class TestCachingAndPerformance:
    """Test suite for caching and performance behavior."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_profile_sets_cache_headers(self, client: TestClient) -> None:
        """Test that GET /profiles/{profile_id} sets cache headers."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = {
                "id": profile_id,
                "name": "my-db",
                "type": "database",
                "config": {},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers

    def test_create_profile_invalidates_cache(self, client: TestClient) -> None:
        """Test that POST /profiles invalidates list cache."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "new-profile",
                "type": "database",
                "config": {},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={"name": "new-profile", "type": "database"},
            )

            assert response.status_code == 201
            assert "X-Cache-Invalidated" in response.headers

    def test_update_profile_invalidates_cache(self, client: TestClient) -> None:
        """Test that PUT /profiles/{profile_id} invalidates cache."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "updated",
                "type": "database",
                "config": {},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"name": "updated"},
            )

            assert response.status_code == 200
            assert "X-Cache-Invalidated" in response.headers

    def test_delete_profile_invalidates_cache(self, client: TestClient) -> None:
        """Test that DELETE /profiles/{profile_id} invalidates cache."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.delete_profile"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/profiles/{profile_id}")

            assert response.status_code == 204
            assert "X-Cache-Invalidated" in response.headers

    def test_connectivity_test_sets_brief_cache_headers(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/test sets brief cache headers (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.test_connectivity"
        ) as mock_test:
            mock_test.return_value = {"connected": True, "latency": 15}

            response = client.post(f"/profiles/{profile_id}/test")

            assert response.status_code == 200
            # Connectivity test results should have brief cache duration
            assert "Cache-Control" in response.headers
            # Brief cache (e.g., max-age <= 60 seconds)
            cache_control = response.headers["Cache-Control"]
            assert "max-age=" in cache_control

    def test_connectivity_test_cache_invalidated_on_profile_update(
        self, client: TestClient
    ) -> None:
        """Test that profile update invalidates connectivity test cache (REQ-5.2.4.8)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "updated",
                "type": "database",
                "config": {"host": "newhost"},
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"config": {"host": "newhost"}},
            )

            assert response.status_code == 200
            # Cache invalidation header should indicate connectivity test cache cleared
            assert "X-Cache-Invalidated" in response.headers
            cache_invalidated = response.headers["X-Cache-Invalidated"]
            assert (
                "connectivity" in cache_invalidated.lower()
                or "profiles" in cache_invalidated.lower()
            )


class TestRouteOrdering:
    """Test suite for route ordering (static routes before parameterized)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_types_route_not_captured_as_profile_id(self, client: TestClient) -> None:
        """Test that /profiles/types is not captured by /profiles/{profile_id}."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profile_types"
        ) as mock_list:
            mock_list.return_value = VALID_PROFILE_TYPES

            response = client.get("/profiles/types")

            # Should hit list_profile_types, not get_profile
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data["data"], list)
            mock_list.assert_called_once()

    def test_types_schema_route_not_captured_as_profile_id(self, client: TestClient) -> None:
        """Test that /profiles/types/{type}/schema is routed correctly."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.get_type_schema"
        ) as mock_get:
            mock_get.return_value = {"type": "object", "properties": {}}

            response = client.get("/profiles/types/database/schema")

            assert response.status_code == 200
            mock_get.assert_called_once_with("database")


class TestProfileTagsEndpoints:
    """Test suite for profile tags in REST API endpoints (REQ-4.7.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_profile_with_tags_returns_201(self, client: TestClient) -> None:
        """Test that POST /profiles accepts tags field (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["production", "critical"],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production", "critical"],
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["tags"] == ["production", "critical"]
            mock_create.assert_called_once()
            call_kwargs = mock_create.call_args[1]
            assert call_kwargs["tags"] == ["production", "critical"]

    def test_create_profile_tags_in_response(self, client: TestClient) -> None:
        """Test that POST /profiles returns tags in response (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["env:prod", "team:platform"],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["env:prod", "team:platform"],
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert "tags" in data["data"]
            assert data["data"]["tags"] == ["env:prod", "team:platform"]

    def test_create_profile_empty_tags_array(self, client: TestClient) -> None:
        """Test that POST /profiles accepts empty tags array (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["tags"] == []

    def test_create_profile_without_tags_defaults_to_empty(self, client: TestClient) -> None:
        """Test that POST /profiles without tags defaults to empty list (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                },
            )

            assert response.status_code == 201
            call_kwargs = mock_create.call_args[1]
            # Should pass empty list or None for tags
            assert call_kwargs.get("tags") in ([], None)

    def test_create_profile_validates_tags_are_list(self, client: TestClient) -> None:
        """Test that POST /profiles validates tags is a list (REQ-4.7.4)."""
        response = client.post(
            "/profiles",
            json={
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": "not-a-list",
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'tags' must be a list of strings$",
            data["error"]["message"],
        )

    def test_create_profile_validates_tags_contain_strings(self, client: TestClient) -> None:
        """Test that POST /profiles validates tags contain only strings (REQ-4.7.4)."""
        response = client.post(
            "/profiles",
            json={
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["valid", 123, "also-valid"],
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'tags' must contain only strings$",
            data["error"]["message"],
        )

    def test_update_profile_with_tags(self, client: TestClient) -> None:
        """Test that PUT /profiles/{id} accepts tags field (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["new-tag", "another-tag"],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"tags": ["new-tag", "another-tag"]},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["tags"] == ["new-tag", "another-tag"]
            mock_update.assert_called_once()
            call_kwargs = mock_update.call_args[1]
            assert call_kwargs["tags"] == ["new-tag", "another-tag"]

    def test_update_profile_clears_tags_with_empty_list(self, client: TestClient) -> None:
        """Test that PUT /profiles/{id} with empty tags clears all tags (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": [],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"tags": []},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["tags"] == []

    def test_update_profile_validates_tags_are_list(self, client: TestClient) -> None:
        """Test that PUT /profiles/{id} validates tags is a list (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        response = client.put(
            f"/profiles/{profile_id}",
            json={"tags": "not-a-list"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'tags' must be a list of strings$",
            data["error"]["message"],
        )

    def test_update_profile_validates_tags_contain_strings(self, client: TestClient) -> None:
        """Test that PUT /profiles/{id} validates tags contain only strings (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        response = client.put(
            f"/profiles/{profile_id}",
            json={"tags": ["valid", 456]},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'tags' must contain only strings$",
            data["error"]["message"],
        )

    def test_list_profiles_includes_tags(self, client: TestClient) -> None:
        """Test that GET /profiles returns tags for each profile (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "id": profile_id,
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production", "tier-1"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            ]

            response = client.get("/profiles")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "tags" in data["data"][0]
            assert data["data"][0]["tags"] == ["production", "tier-1"]

    def test_list_profiles_filter_by_tags(self, client: TestClient) -> None:
        """Test that GET /profiles supports tags filter (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "id": profile_id,
                    "name": "prod-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            ]

            response = client.get("/profiles?tags=production")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["tags"] == ["production"]

    def test_list_profiles_filter_by_multiple_tags(self, client: TestClient) -> None:
        """Test that GET /profiles supports multiple tags filter (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "id": profile_id,
                    "name": "prod-critical-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production", "critical"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            ]

            response = client.get("/profiles?tags=production&tags=critical")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert set(call_kwargs["tags"]) == {"production", "critical"}

    def test_get_profile_includes_tags(self, client: TestClient) -> None:
        """Test that GET /profiles/{id} returns tags field (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["staging", "internal"],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 200
            data = response.json()
            assert "tags" in data["data"]
            assert data["data"]["tags"] == ["staging", "internal"]


class TestProfileTypeFilter:
    """Test suite for profile type filtering in list endpoint (REQ-4.7.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_profiles_filter_by_type(self, client: TestClient) -> None:
        """Test that GET /profiles supports type filter (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "id": profile_id,
                    "name": "my-ssh",
                    "type": "ssh",
                    "config": {"host": "localhost"},
                    "tags": [],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            ]

            response = client.get("/profiles?type=ssh")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["profile_type"] == "ssh"

    def test_list_profiles_filter_by_type_and_tags(self, client: TestClient) -> None:
        """Test that GET /profiles supports both type and tags filters (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "id": profile_id,
                    "name": "prod-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            ]

            response = client.get("/profiles?type=database&tags=production")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["profile_type"] == "database"
            assert call_kwargs["tags"] == ["production"]


class TestProfileSearchEndpoint:
    """Test suite for profile search in list endpoint (REQ-4.7.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_profiles_search_by_name(self, client: TestClient) -> None:
        """Test that GET /profiles supports search parameter (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "id": profile_id,
                    "name": "production-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": [],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            ]

            response = client.get("/profiles?search=production")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["search"] == "production"

    def test_list_profiles_combined_search_type_tags(self, client: TestClient) -> None:
        """Test that GET /profiles supports all filters together (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = [
                {
                    "id": profile_id,
                    "name": "prod-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["production"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            ]

            response = client.get("/profiles?search=prod&type=database&tags=production")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["search"] == "prod"
            assert call_kwargs["profile_type"] == "database"
            assert call_kwargs["tags"] == ["production"]


class TestProfileListPagination:
    """Test suite for profile list pagination in REST API (REQ-4.7.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_profiles_returns_pagination_object(self, client: TestClient) -> None:
        """Test that GET /profiles returns pagination metadata (REQ-4.7.4)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = {
                "profiles": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/profiles")

            assert response.status_code == 200
            data = response.json()
            assert "pagination" in data
            assert data["pagination"]["page"] == 1
            assert data["pagination"]["per_page"] == 20
            assert data["pagination"]["total"] == 0
            assert data["pagination"]["total_pages"] == 0

    def test_list_profiles_accepts_page_parameter(self, client: TestClient) -> None:
        """Test that GET /profiles accepts page query parameter (REQ-4.7.4)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = {
                "profiles": [],
                "total": 100,
                "page": 2,
                "per_page": 20,
                "total_pages": 5,
            }

            response = client.get("/profiles?page=2")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["page"] == 2

    def test_list_profiles_accepts_per_page_parameter(self, client: TestClient) -> None:
        """Test that GET /profiles accepts per_page query parameter (REQ-4.7.4)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = {
                "profiles": [],
                "total": 100,
                "page": 1,
                "per_page": 50,
                "total_pages": 2,
            }

            response = client.get("/profiles?per_page=50")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["per_page"] == 50

    def test_list_profiles_validates_page_minimum(self, client: TestClient) -> None:
        """Test that GET /profiles validates page >= 1 (REQ-4.7.4)."""
        response = client.get("/profiles?page=0")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Page must be at least 1$",
            data["error"]["message"],
        )

    def test_list_profiles_validates_per_page_minimum(self, client: TestClient) -> None:
        """Test that GET /profiles validates per_page >= 1 (REQ-4.7.4)."""
        response = client.get("/profiles?per_page=0")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Per page must be between 1 and 100$",
            data["error"]["message"],
        )

    def test_list_profiles_validates_per_page_maximum(self, client: TestClient) -> None:
        """Test that GET /profiles validates per_page <= 100 (REQ-4.7.4)."""
        response = client.get("/profiles?per_page=101")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Per page must be between 1 and 100$",
            data["error"]["message"],
        )


class TestProfileListSorting:
    """Test suite for profile list sorting in REST API (REQ-4.7.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_profiles_accepts_sort_by_parameter(self, client: TestClient) -> None:
        """Test that GET /profiles accepts sort_by query parameter (REQ-4.7.4)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = {
                "profiles": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/profiles?sort_by=name")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["sort_by"] == "name"

    def test_list_profiles_accepts_sort_order_parameter(self, client: TestClient) -> None:
        """Test that GET /profiles accepts sort_order query parameter (REQ-4.7.4)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = {
                "profiles": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/profiles?sort_by=name&sort_order=desc")

            assert response.status_code == 200
            mock_list.assert_called_once()
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["sort_by"] == "name"
            assert call_kwargs["sort_order"] == "desc"

    def test_list_profiles_defaults_sort_order_to_asc(self, client: TestClient) -> None:
        """Test that GET /profiles defaults sort_order to asc (REQ-4.7.4)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = {
                "profiles": [],
                "total": 0,
                "page": 1,
                "per_page": 20,
                "total_pages": 0,
            }

            response = client.get("/profiles?sort_by=name")

            assert response.status_code == 200
            call_kwargs = mock_list.call_args[1]
            assert call_kwargs["sort_order"] == "asc"

    def test_list_profiles_validates_sort_order_values(self, client: TestClient) -> None:
        """Test that GET /profiles validates sort_order is asc or desc (REQ-4.7.4)."""
        response = client.get("/profiles?sort_order=invalid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Sort order must be 'asc' or 'desc'$",
            data["error"]["message"],
        )


class TestProfileTagsValidation:
    """Test suite for profile tags edge case validation (REQ-4.7.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_profile_rejects_empty_string_tag(self, client: TestClient) -> None:
        """Test that POST /profiles rejects empty string tags (REQ-4.7.4)."""
        response = client.post(
            "/profiles",
            json={
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["valid", "", "also-valid"],
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Tags cannot contain empty strings$",
            data["error"]["message"],
        )

    def test_create_profile_rejects_whitespace_only_tag(self, client: TestClient) -> None:
        """Test that POST /profiles rejects whitespace-only tags (REQ-4.7.4)."""
        response = client.post(
            "/profiles",
            json={
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["valid", "   ", "also-valid"],
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Tags cannot contain empty or whitespace-only strings$",
            data["error"]["message"],
        )

    def test_update_profile_rejects_empty_string_tag(self, client: TestClient) -> None:
        """Test that PUT /profiles/{id} rejects empty string tags (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        response = client.put(
            f"/profiles/{profile_id}",
            json={"tags": ["valid", ""]},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Tags cannot contain empty strings$",
            data["error"]["message"],
        )

    def test_update_profile_rejects_whitespace_only_tag(self, client: TestClient) -> None:
        """Test that PUT /profiles/{id} rejects whitespace-only tags (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        response = client.put(
            f"/profiles/{profile_id}",
            json={"tags": ["valid", "\t\n"]},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Tags cannot contain empty or whitespace-only strings$",
            data["error"]["message"],
        )

    def test_create_profile_trims_tag_whitespace(self, client: TestClient) -> None:
        """Test that POST /profiles trims leading/trailing whitespace from tags (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "tags": ["production", "critical"],
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "my-database",
                    "type": "database",
                    "config": {"host": "localhost"},
                    "tags": ["  production  ", "  critical  "],
                },
            )

            assert response.status_code == 201
            call_kwargs = mock_create.call_args[1]
            # Tags should be trimmed
            assert call_kwargs["tags"] == ["production", "critical"]


class TestDuplicateProfileEndpoint:
    """Test suite for POST /profiles/{id}/duplicate endpoint (REQ-4.7.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_duplicate_profile_returns_201_with_new_profile(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/duplicate creates a copy (REQ-4.7.4)."""
        original_id = str(uuid.uuid4())
        new_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get,
            patch(
                "wavecore.api.routes.profiles.routes.profile_service.duplicate_profile"
            ) as mock_duplicate,
        ):
            mock_get.return_value = {
                "id": original_id,
                "name": "Production Database",
                "type": "database",
                "description": "Production PostgreSQL",
                "tags": ["production", "critical"],
                "config": {"host": "localhost", "port": 5432},
                "usage": 5,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }
            mock_duplicate.return_value = {
                "id": new_id,
                "name": "Production Database (Copy)",
                "type": "database",
                "description": "Production PostgreSQL",
                "tags": ["production", "critical"],
                "config": {"host": "localhost", "port": 5432},
                "usage": 0,  # New duplicate has no tests referencing it
                "created_at": "2025-01-15T12:00:00Z",
                "updated_at": "2025-01-15T12:00:00Z",
            }

            response = client.post(f"/profiles/{original_id}/duplicate")

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["id"] == new_id
            assert data["data"]["name"] == "Production Database (Copy)"
            assert data["data"]["usage"] == 0

    def test_duplicate_profile_with_custom_name(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/duplicate accepts custom name (REQ-4.7.4)."""
        original_id = str(uuid.uuid4())
        new_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get,
            patch(
                "wavecore.api.routes.profiles.routes.profile_service.duplicate_profile"
            ) as mock_duplicate,
        ):
            mock_get.return_value = {
                "id": original_id,
                "name": "Production Database",
                "type": "database",
                "config": {"host": "localhost"},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }
            mock_duplicate.return_value = {
                "id": new_id,
                "name": "Custom Copy Name",
                "type": "database",
                "config": {"host": "localhost"},
                "usage": 0,
                "created_at": "2025-01-15T12:00:00Z",
                "updated_at": "2025-01-15T12:00:00Z",
            }

            response = client.post(
                f"/profiles/{original_id}/duplicate",
                json={"new_name": "Custom Copy Name"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["name"] == "Custom Copy Name"
            mock_duplicate.assert_called_once_with(original_id, new_name="Custom Copy Name")

    def test_duplicate_profile_preserves_config_and_tags(self, client: TestClient) -> None:
        """Test that duplicate preserves config and tags from original (REQ-4.7.4)."""
        original_id = str(uuid.uuid4())
        new_id = str(uuid.uuid4())
        original_config = {
            "host": "db.prod.example.com",
            "port": 5432,
            "database": "app",
            "username": "app_user",
            "password": "********",
        }
        original_tags = ["production", "database", "critical"]

        with (
            patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get,
            patch(
                "wavecore.api.routes.profiles.routes.profile_service.duplicate_profile"
            ) as mock_duplicate,
        ):
            mock_get.return_value = {
                "id": original_id,
                "name": "Production Database",
                "type": "database",
                "config": original_config,
                "tags": original_tags,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }
            mock_duplicate.return_value = {
                "id": new_id,
                "name": "Production Database (Copy)",
                "type": "database",
                "config": original_config,  # Same config
                "tags": original_tags,  # Same tags
                "usage": 0,
                "created_at": "2025-01-15T12:00:00Z",
                "updated_at": "2025-01-15T12:00:00Z",
            }

            response = client.post(f"/profiles/{original_id}/duplicate")

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["config"] == original_config
            assert data["data"]["tags"] == original_tags

    def test_duplicate_profile_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/duplicate returns 404 for missing profile (REQ-4.7.4)."""
        missing_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = None

            response = client.post(f"/profiles/{missing_id}/duplicate")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_duplicate_profile_returns_409_for_duplicate_name(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/duplicate returns 409 when name exists (REQ-4.7.4)."""
        original_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get,
            patch(
                "wavecore.api.routes.profiles.routes.profile_service.duplicate_profile"
            ) as mock_duplicate,
        ):
            mock_get.return_value = {
                "id": original_id,
                "name": "Production Database",
                "type": "database",
                "config": {"host": "localhost"},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }
            mock_duplicate.side_effect = ConflictException(
                "Profile with name 'Existing Name' already exists"
            )

            response = client.post(
                f"/profiles/{original_id}/duplicate",
                json={"new_name": "Existing Name"},
            )

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert "already exists" in data["error"]["message"].lower()

    def test_duplicate_profile_validates_new_name_not_empty(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/duplicate rejects empty new_name (REQ-4.7.4)."""
        original_id = str(uuid.uuid4())

        response = client.post(
            f"/profiles/{original_id}/duplicate",
            json={"new_name": ""},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Name cannot be empty$",
            data["error"]["message"],
        )

    def test_duplicate_profile_validates_new_name_not_whitespace(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/duplicate rejects whitespace-only name (REQ-4.7.4)."""
        original_id = str(uuid.uuid4())

        response = client.post(
            f"/profiles/{original_id}/duplicate",
            json={"new_name": "   "},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Name cannot be empty$",
            data["error"]["message"],
        )

    def test_duplicate_profile_validates_new_name_must_be_string(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/duplicate rejects non-string new_name (REQ-4.7.4)."""
        original_id = str(uuid.uuid4())

        response = client.post(
            f"/profiles/{original_id}/duplicate",
            json={"new_name": 12345},  # Number instead of string
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["message"] == "Name cannot be empty"

    def test_duplicate_profile_returns_404_when_auto_generating_name(
        self, client: TestClient
    ) -> None:
        """Test that POST /profiles/{id}/duplicate returns 404 when auto-generating name for missing
        profile.
        """
        missing_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            # Return None (not raise exception) for get_profile
            mock_get.return_value = None

            response = client.post(f"/profiles/{missing_id}/duplicate")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_duplicate_profile_returns_404_when_service_returns_none(
        self, client: TestClient
    ) -> None:
        """Test that POST /profiles/{id}/duplicate returns 404 when duplicate_profile returns
        None.
        """
        original_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get,
            patch(
                "wavecore.api.routes.profiles.routes.profile_service.duplicate_profile"
            ) as mock_duplicate,
        ):
            mock_get.return_value = {
                "id": original_id,
                "name": "Production Database",
                "type": "database",
                "config": {"host": "localhost"},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }
            # duplicate_profile returns None (profile deleted between get and duplicate)
            mock_duplicate.return_value = None

            response = client.post(f"/profiles/{original_id}/duplicate")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_duplicate_profile_handles_conflict_value_error(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/duplicate handles CONFLICT: ValueError."""
        original_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get,
            patch(
                "wavecore.api.routes.profiles.routes.profile_service.duplicate_profile"
            ) as mock_duplicate,
        ):
            mock_get.return_value = {
                "id": original_id,
                "name": "Production Database",
                "type": "database",
                "config": {"host": "localhost"},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }
            # Raise ValueError with CONFLICT: prefix
            mock_duplicate.side_effect = ConflictException(
                "Profile with name 'Existing' already exists"
            )

            response = client.post(f"/profiles/{original_id}/duplicate")

            assert response.status_code == 409
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "CONFLICT"
            assert "already exists" in data["error"]["message"].lower()
            # CONFLICT: prefix should be stripped
            assert not data["error"]["message"].startswith("CONFLICT:")

    def test_duplicate_profile_handles_generic_value_error(self, client: TestClient) -> None:
        """Test that POST /profiles/{id}/duplicate handles generic ValueError."""
        original_id = str(uuid.uuid4())

        with (
            patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get,
            patch(
                "wavecore.api.routes.profiles.routes.profile_service.duplicate_profile"
            ) as mock_duplicate,
        ):
            mock_get.return_value = {
                "id": original_id,
                "name": "Production Database",
                "type": "database",
                "config": {"host": "localhost"},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }
            # Raise generic ValueError (not CONFLICT:)
            mock_duplicate.side_effect = ValidationException("Invalid configuration parameter")

            response = client.post(f"/profiles/{original_id}/duplicate")

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "VALIDATION_ERROR"
            assert data["error"]["message"] == "Invalid configuration parameter"


class TestListProfileTagsEndpoint:
    """Test suite for GET /profiles/tags endpoint (REQ-4.7.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_tags_returns_200_with_unique_tags(self, client: TestClient) -> None:
        """Test that GET /profiles/tags returns all unique tags (REQ-4.7.4)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = [
                "critical",
                "database",
                "http",
                "kubernetes",
                "production",
                "staging",
            ]

            response = client.get("/profiles/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == [
                "critical",
                "database",
                "http",
                "kubernetes",
                "production",
                "staging",
            ]
            mock_list_tags.assert_called_once()

    def test_list_tags_returns_empty_array_when_no_tags(self, client: TestClient) -> None:
        """Test that GET /profiles/tags returns empty array when no profiles have tags
        (REQ-4.7.4).
        """
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_all_tags"
        ) as mock_list_tags:
            mock_list_tags.return_value = []

            response = client.get("/profiles/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_tags_returns_sorted_tags(self, client: TestClient) -> None:
        """Test that GET /profiles/tags returns tags in alphabetical order (REQ-4.7.4)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_all_tags"
        ) as mock_list_tags:
            # Return sorted from service
            mock_list_tags.return_value = ["alpha", "beta", "gamma", "zeta"]

            response = client.get("/profiles/tags")

            assert response.status_code == 200
            data = response.json()
            assert data["data"] == ["alpha", "beta", "gamma", "zeta"]

    def test_list_tags_excludes_duplicates(self, client: TestClient) -> None:
        """Test that GET /profiles/tags returns each tag only once (REQ-4.7.4)."""
        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_all_tags"
        ) as mock_list_tags:
            # Service should already de-duplicate
            mock_list_tags.return_value = ["production", "staging"]

            response = client.get("/profiles/tags")

            assert response.status_code == 200
            data = response.json()
            # Each tag appears only once
            assert len(data["data"]) == len(set(data["data"]))


class TestProfileUsageCount:
    """Test suite for profile usage count field (REQ-4.7.4)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_profiles_includes_usage_count(self, client: TestClient) -> None:
        """Test that GET /profiles includes usage count for each profile (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.list_profiles"
        ) as mock_list:
            mock_list.return_value = {
                "profiles": [
                    {
                        "id": profile_id,
                        "name": "Production Database",
                        "type": "database",
                        "config": {"host": "localhost"},
                        "usage": 5,
                        "created_at": "2025-01-01T00:00:00Z",
                        "updated_at": "2025-01-01T00:00:00Z",
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 20,
                "total_pages": 1,
            }

            response = client.get("/profiles")

            assert response.status_code == 200
            data = response.json()
            assert "usage" in data["data"][0]
            assert data["data"][0]["usage"] == 5

    def test_get_profile_includes_usage_count(self, client: TestClient) -> None:
        """Test that GET /profiles/{id} includes usage count (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = {
                "id": profile_id,
                "name": "Production Database",
                "type": "database",
                "config": {"host": "localhost"},
                "usage": 3,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 200
            data = response.json()
            assert "usage" in data["data"]
            assert data["data"]["usage"] == 3

    def test_new_profile_has_zero_usage(self, client: TestClient) -> None:
        """Test that newly created profiles have usage count of 0 (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.create_profile"
        ) as mock_create:
            mock_create.return_value = {
                "id": profile_id,
                "name": "New Profile",
                "type": "database",
                "config": {"host": "localhost"},
                "usage": 0,
                "created_at": "2025-01-15T12:00:00Z",
                "updated_at": "2025-01-15T12:00:00Z",
            }

            response = client.post(
                "/profiles",
                json={
                    "name": "New Profile",
                    "type": "database",
                    "config": {"host": "localhost"},
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["data"]["usage"] == 0

    def test_usage_count_is_integer(self, client: TestClient) -> None:
        """Test that usage count is a non-negative integer (REQ-4.7.4)."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = {
                "id": profile_id,
                "name": "Production Database",
                "type": "database",
                "config": {"host": "localhost"},
                "usage": 10,
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 200
            data = response.json()
            assert isinstance(data["data"]["usage"], int)
            assert data["data"]["usage"] >= 0


class TestProfileConcurrencyControl:
    """Test suite for concurrency control via ETag/If-Match (REQ-5.2.4.3)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_profile_returns_etag_header(self, client: TestClient) -> None:
        """Test that GET /profiles/{id} returns ETag header."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost", "port": 5432},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.get(f"/profiles/{profile_id}")

            assert response.status_code == 200
            assert "ETag" in response.headers
            assert response.headers["ETag"].startswith('"')

    def test_update_with_if_match_succeeds_when_matching(self, client: TestClient) -> None:
        """Test that PUT with matching If-Match header succeeds."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "Updated Profile",
                "type": "database",
                "config": {"host": "newhost", "port": 5432},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"name": "Updated Profile"},
                headers={"If-Match": '"abc123"'},
            )

            assert response.status_code == 200
            mock_update.assert_called_once()
            call_kwargs = mock_update.call_args[1]
            assert call_kwargs.get("etag") == '"abc123"'

    def test_update_with_if_match_fails_when_mismatched(self, client: TestClient) -> None:
        """Test that PUT with mismatched If-Match returns 412."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            exc = ConflictException("Precondition failed: resource has been modified")
            exc.status_code = 412
            exc.error_code = "PRECONDITION_FAILED"
            mock_update.side_effect = exc

            response = client.put(
                f"/profiles/{profile_id}",
                json={"name": "Updated Profile"},
                headers={"If-Match": '"stale-etag"'},
            )

            assert response.status_code == 412
            data = response.json()
            assert data["success"] is False
            assert "Precondition failed" in data["error"]["message"]

    def test_update_returns_new_etag_header(self, client: TestClient) -> None:
        """Test that PUT returns new ETag header after successful update."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.update_profile"
        ) as mock_update:
            mock_update.return_value = {
                "id": profile_id,
                "name": "Updated Profile",
                "type": "database",
                "config": {"host": "newhost"},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
            }

            response = client.put(
                f"/profiles/{profile_id}",
                json={"name": "Updated Profile"},
            )

            assert response.status_code == 200
            assert "ETag" in response.headers

    def test_delete_with_if_match_fails_when_mismatched(self, client: TestClient) -> None:
        """Test that DELETE with mismatched If-Match returns 412."""
        profile_id = str(uuid.uuid4())

        with patch("wavecore.api.routes.profiles.routes.profile_service.get_profile") as mock_get:
            mock_get.return_value = {
                "id": profile_id,
                "name": "my-database",
                "type": "database",
                "config": {"host": "localhost"},
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
            }

            response = client.delete(
                f"/profiles/{profile_id}",
                headers={"If-Match": '"definitely-wrong-etag"'},
            )

            assert response.status_code == 412
            data = response.json()
            assert data["success"] is False
            assert "Precondition failed" in data["error"]["message"]

    def test_delete_without_if_match_succeeds(self, client: TestClient) -> None:
        """Test that DELETE without If-Match header still works."""
        profile_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.profiles.routes.profile_service.delete_profile"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/profiles/{profile_id}")

            assert response.status_code == 204
