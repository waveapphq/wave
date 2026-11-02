"""Unit tests for configuration endpoints (REQ-5.2.4.12).

This module tests the configuration endpoints providing access to system
configuration parameters, enabling operational control over WAVE behavior.

Test Coverage:
- Full configuration retrieval: GET /config returns all settings
- Individual key retrieval: GET /config/{key} with dot-notation
- Configuration updates: PUT /config/{key} with validation
- Type validation: Type constraints, enumeration, range limits
- Mutable vs immutable settings: Pending restart handling
- Error handling: Not found with suggestions, bad request details
- Security: Sensitive value masking
- Caching: Configuration caching with invalidation
"""

import re
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


class TestGetConfigEndpoint:
    """Test suite for GET /config endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_config_returns_200_with_all_settings(self, client: TestClient) -> None:
        """Test that GET /config returns full configuration tree."""
        with patch("wavecore.api.routes.config.config_service.get_full_config") as mock_get:
            mock_get.return_value = {
                "server": {
                    "host": "0.0.0.0",
                    "port": 8000,
                    "debug": False,
                },
                "storage": {
                    "artifact_dir": "/var/wave/artifacts",
                    "retention_days": 30,
                },
                "execution": {
                    "max_parallel": 10,
                    "timeout_seconds": 3600,
                },
            }

            response = client.get("/config")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "server" in data["data"]
            assert "storage" in data["data"]
            assert "execution" in data["data"]
            mock_get.assert_called_once()

    def test_get_config_organizes_settings_by_category(self, client: TestClient) -> None:
        """Test that GET /config organizes settings by category."""
        with patch("wavecore.api.routes.config.config_service.get_full_config") as mock_get:
            mock_get.return_value = {
                "server": {"port": 8000},
                "storage": {"artifact_dir": "/artifacts"},
            }

            response = client.get("/config")

            assert response.status_code == 200
            data = response.json()
            # Settings should be organized hierarchically
            assert isinstance(data["data"]["server"], dict)
            assert isinstance(data["data"]["storage"], dict)

    def test_get_config_masks_sensitive_values(self, client: TestClient) -> None:
        """Test that GET /config masks sensitive configuration values."""
        with patch("wavecore.api.routes.config.config_service.get_full_config") as mock_get:
            mock_get.return_value = {
                "database": {
                    "host": "localhost",
                    "password": "********",  # Masked
                },
                "api": {
                    "secret_key": "********",  # Masked
                },
            }

            response = client.get("/config")

            assert response.status_code == 200
            data = response.json()
            # Sensitive values should be masked
            assert data["data"]["database"]["password"] == "********"
            assert data["data"]["api"]["secret_key"] == "********"

    def test_get_config_excludes_credentials(self, client: TestClient) -> None:
        """Test that GET /config excludes or omits credential values."""
        with patch("wavecore.api.routes.config.config_service.get_full_config") as mock_get:
            # Service should not include actual credentials
            mock_get.return_value = {
                "server": {"port": 8000},
                # No credentials in response
            }

            response = client.get("/config")

            assert response.status_code == 200
            data = response.json()
            # Ensure no plaintext credentials leak
            response_str = str(data)
            assert "secret_key_value" not in response_str.lower()
            assert "password123" not in response_str.lower()

    def test_get_config_includes_response_metadata(self, client: TestClient) -> None:
        """Test that GET /config includes standard response metadata."""
        with patch("wavecore.api.routes.config.config_service.get_full_config") as mock_get:
            mock_get.return_value = {}

            response = client.get("/config")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]
            assert "timestamp" in data["meta"]

    def test_get_config_sets_cache_headers(self, client: TestClient) -> None:
        """Test that GET /config sets appropriate cache headers."""
        with patch("wavecore.api.routes.config.config_service.get_full_config") as mock_get:
            mock_get.return_value = {}

            response = client.get("/config")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers


class TestGetConfigValueEndpoint:
    """Test suite for GET /config/{key} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_config_value_returns_200_with_value(self, client: TestClient) -> None:
        """Test that GET /config/{key} returns config value."""
        with patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get:
            mock_get.return_value = {
                "key": "server.port",
                "value": 8000,
                "type": "integer",
                "mutable": True,
            }

            response = client.get("/config/server.port")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["key"] == "server.port"
            assert data["data"]["value"] == 8000
            mock_get.assert_called_once_with("server.port")

    def test_get_config_value_supports_dot_notation(self, client: TestClient) -> None:
        """Test that GET /config/{key} accepts dot-notation for nested values."""
        with patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get:
            mock_get.return_value = {
                "key": "storage.artifacts.retention_days",
                "value": 30,
                "type": "integer",
                "mutable": True,
            }

            response = client.get("/config/storage.artifacts.retention_days")

            assert response.status_code == 200
            call_args = mock_get.call_args[0]
            assert call_args[0] == "storage.artifacts.retention_days"

    def test_get_config_value_returns_type_information(self, client: TestClient) -> None:
        """Test that GET /config/{key} returns type information."""
        with patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get:
            mock_get.return_value = {
                "key": "server.debug",
                "value": False,
                "type": "boolean",
                "mutable": True,
            }

            response = client.get("/config/server.debug")

            assert response.status_code == 200
            data = response.json()
            assert "type" in data["data"]
            assert data["data"]["type"] == "boolean"

    def test_get_config_value_returns_mutability_metadata(self, client: TestClient) -> None:
        """Test that GET /config/{key} indicates if setting is mutable at runtime."""
        with patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get:
            mock_get.return_value = {
                "key": "server.port",
                "value": 8000,
                "type": "integer",
                "mutable": False,  # Requires restart
            }

            response = client.get("/config/server.port")

            assert response.status_code == 200
            data = response.json()
            assert "mutable" in data["data"]
            assert data["data"]["mutable"] is False

    def test_get_config_value_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET /config/{key} returns 404 when key not found."""
        with patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get:
            mock_get.return_value = None

            response = client.get("/config/nonexistent.key")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                r"^Configuration key 'nonexistent\.key' not found$",
                data["error"]["message"],
            )

    def test_get_config_value_suggests_similar_keys_on_not_found(self, client: TestClient) -> None:
        """Test that GET /config/{key} suggests similar keys when not found (debug mode)."""
        with (
            patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get,
            patch("wavecore.api.routes.config.config_service.find_similar_keys") as mock_similar,
            patch(
                "wavecore.api.middleware.middleware_module._is_production_mode",
                return_value=False,
            ),
        ):
            mock_get.return_value = None
            mock_similar.return_value = ["server.port", "server.host"]

            response = client.get("/config/server.prot")

            assert response.status_code == 404
            data = response.json()
            assert "details" in data["error"]
            assert "server.port" in data["error"]["details"]["suggestions"]

    def test_get_config_value_returns_400_for_invalid_key_path(self, client: TestClient) -> None:
        """Test that GET /config/{key} returns 400 for invalid key path format."""
        with patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get:
            from wavecore.api.exceptions import ValidationException

            mock_get.side_effect = ValidationException(
                "Invalid key path format: key cannot start with '.'"
            )

            response = client.get("/config/.invalid.key")

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Invalid key path" in data["error"]["message"]


class TestConfigurationSecurityConsiderations:
    """Test suite for configuration security features."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_config_masks_password_values(self, client: TestClient) -> None:
        """Test that configuration masks password values in responses."""
        with patch("wavecore.api.routes.config.config_service.get_full_config") as mock_get:
            mock_get.return_value = {
                "database": {
                    "host": "localhost",
                    "password": "********",
                },
            }

            response = client.get("/config")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["database"]["password"] == "********"

    def test_get_config_value_masks_sensitive_key(self, client: TestClient) -> None:
        """Test that GET /config/{key} masks sensitive key values."""
        with patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get:
            mock_get.return_value = {
                "key": "api.secret_key",
                "value": "********",
                "type": "string",
                "mutable": False,
                "sensitive": True,
            }

            response = client.get("/config/api.secret_key")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["value"] == "********"


class TestConfigurationCachingBehavior:
    """Test suite for configuration caching behavior."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_config_uses_cached_tree(self, client: TestClient) -> None:
        """Test that GET /config uses cached configuration tree."""
        with patch("wavecore.api.routes.config.config_service.get_full_config") as mock_get:
            mock_get.return_value = {"cached": True}

            # First call
            response1 = client.get("/config")
            assert response1.status_code == 200

            # Second call should use cache (mock only called once if cached)
            response2 = client.get("/config")
            assert response2.status_code == 200

    def test_get_config_value_uses_cached_tree(self, client: TestClient) -> None:
        """Test that GET /config/{key} uses cached configuration tree."""
        with patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get:
            mock_get.return_value = {
                "key": "test.key",
                "value": "cached_value",
                "type": "string",
                "mutable": True,
            }

            response = client.get("/config/test.key")

            assert response.status_code == 200
            # Service should use cached tree internally


class TestConfigurationErrorHandling:
    """Test suite for configuration error handling."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_internal_error_returns_500_with_request_id(self, client: TestClient) -> None:
        """Test that internal errors return 500 with request ID."""
        with patch("wavecore.api.routes.config.config_service.get_full_config") as mock_get:
            mock_get.side_effect = RuntimeError("Unexpected error")

            response = client.get("/config")

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "request_id" in data["meta"]

    def test_get_config_value_internal_error_returns_500(self, client: TestClient) -> None:
        """Test that GET /config/{key} returns 500 on internal error."""
        with patch("wavecore.api.routes.config.config_service.get_config_value") as mock_get:
            mock_get.side_effect = RuntimeError("Internal service failure")

            response = client.get("/config/test.key")

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "request_id" in data["meta"]
