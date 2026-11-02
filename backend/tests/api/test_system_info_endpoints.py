"""Unit tests for system info endpoints (REQ-5.2.1.42).

This module tests the system info endpoint providing read-only access
to application version, build information, and support links for
the Settings About tab.

Test Coverage:
- System info retrieval: Version, build, support links
- Response structure: Standard success format, metadata
- Caching: Long cache for static system info
- Error handling: Internal errors with correlation ID
"""

import re
from typing import Any
from unittest.mock import patch

import pytest
from fastapi import Request, Response
from fastapi.testclient import TestClient

SYSTEM_INFO_KEYS = {"version", "build", "build_date", "runtime", "support"}
INFO_PATH = "/api/v1/system/info"
SUPPORT_LINKS = {
    "documentation_url": "https://github.com/waveapphq/wave#readme",
    "issues_url": "https://github.com/waveapphq/wave/issues",
    "contact_email": "support@waveapp.dev",
}


def _request(path: str = INFO_PATH) -> Request:
    """A bare GET request the envelope helper can read its path from."""
    scope: dict[str, Any] = {
        "type": "http",
        "method": "GET",
        "scheme": "http",
        "server": ("testserver", 80),
        "path": path,
        "query_string": b"",
        "headers": [],
    }
    return Request(scope)


class TestGetSystemInfoEndpoint:
    """Test suite for GET /system/info endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_system_info_returns_200(self, client: TestClient) -> None:
        """Test that GET /system/info returns 200 with system info."""
        with patch("wavecore.api.routes.system.system_service.get_system_info") as mock_get:
            mock_get.return_value = {
                "version": "1.0.0",
                "build": "abc123def",
                "build_date": "2025-01-01T00:00:00Z",
            }

            response = client.get("/api/v1/system/info")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            mock_get.assert_called_once()

    def test_get_system_info_includes_version(self, client: TestClient) -> None:
        """Test that GET /system/info includes version number."""
        with patch("wavecore.api.routes.system.system_service.get_system_info") as mock_get:
            mock_get.return_value = {
                "version": "2.1.0",
                "build": "abc123",
            }

            response = client.get("/api/v1/system/info")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["version"] == "2.1.0"

    def test_get_system_info_includes_build_identifier(self, client: TestClient) -> None:
        """Test that GET /system/info includes build identifier."""
        with patch("wavecore.api.routes.system.system_service.get_system_info") as mock_get:
            mock_get.return_value = {
                "version": "1.0.0",
                "build": "e4687a6c04953bba83c42654274",
            }

            response = client.get("/api/v1/system/info")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["build"] == "e4687a6c04953bba83c42654274"

    def test_get_system_info_includes_build_date(self, client: TestClient) -> None:
        """Test that GET /system/info includes build date."""
        with patch("wavecore.api.routes.system.system_service.get_system_info") as mock_get:
            mock_get.return_value = {
                "version": "1.0.0",
                "build": "abc123",
                "build_date": "2025-01-15T10:30:00Z",
            }

            response = client.get("/api/v1/system/info")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["build_date"] == "2025-01-15T10:30:00Z"

    def test_get_system_info_includes_support_links(self, client: TestClient) -> None:
        """Test that GET /system/info includes support links."""
        with patch("wavecore.api.routes.system.system_service.get_system_info") as mock_get:
            mock_get.return_value = {
                "version": "1.0.0",
                "build": "abc123",
                "support": SUPPORT_LINKS,
            }

            response = client.get("/api/v1/system/info")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["support"] == SUPPORT_LINKS

    def test_get_system_info_includes_response_metadata(self, client: TestClient) -> None:
        """Test that GET /system/info includes standard metadata."""
        with patch("wavecore.api.routes.system.system_service.get_system_info") as mock_get:
            mock_get.return_value = {
                "version": "1.0.0",
                "build": "abc123",
            }

            response = client.get("/api/v1/system/info")

            assert response.status_code == 200
            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]
            assert "timestamp" in data["meta"]

    def test_get_system_info_sets_long_cache_headers(self, client: TestClient) -> None:
        """Test that GET /system/info sets long cache headers (static data)."""
        with patch("wavecore.api.routes.system.system_service.get_system_info") as mock_get:
            mock_get.return_value = {
                "version": "1.0.0",
                "build": "abc123",
            }

            response = client.get("/api/v1/system/info")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            # System info is static, should have long cache
            cache_control = response.headers["Cache-Control"]
            assert "max-age=" in cache_control

    def test_get_system_info_keeps_the_one_hour_cache(self, client: TestClient) -> None:
        """The envelope helper's default header is unchanged for static data."""
        response = client.get("/api/v1/system/info")

        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "max-age=3600"

    def test_get_system_info_has_no_environment(self, client: TestClient) -> None:
        """The About data holds version, build, runtime and support, and no environment name."""
        response = client.get("/api/v1/system/info")

        assert response.status_code == 200
        assert set(response.json()["data"]) == SYSTEM_INFO_KEYS

    def test_get_system_info_includes_python_version(self, client: TestClient) -> None:
        """Test that GET /system/info includes Python version."""
        with patch("wavecore.api.routes.system.system_service.get_system_info") as mock_get:
            mock_get.return_value = {
                "version": "1.0.0",
                "build": "abc123",
                "runtime": {
                    "python_version": "3.12.0",
                },
            }

            response = client.get("/api/v1/system/info")

            assert response.status_code == 200
            data = response.json()
            assert "runtime" in data["data"]
            assert data["data"]["runtime"]["python_version"] == "3.12.0"


class TestSystemInfoErrorHandling:
    """Test suite for error handling in system info endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_internal_error_returns_500_with_correlation_id(self, client: TestClient) -> None:
        """Test that internal errors return 500 with correlation ID."""
        with patch("wavecore.api.routes.system.system_service.get_system_info") as mock_get:
            mock_get.side_effect = RuntimeError("Unexpected error")

            response = client.get("/api/v1/system/info")

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "correlation_id" in data["error"]


class TestSuccessEnvelope:
    """The shared success envelope sets the cache header its caller asks for."""

    def test_the_default_header_is_the_one_hour_cache(self) -> None:
        from wavecore.api.routes import system

        response = Response()

        body = system._success_response(_request(), response, {"version": "1.0.0"})

        assert response.headers["Cache-Control"] == "max-age=3600"
        assert set(body) == {"success", "data", "meta"}
        assert body["success"] is True
        assert body["data"] == {"version": "1.0.0"}
        assert body["meta"]["path"] == INFO_PATH

    @pytest.mark.parametrize("value", ["no-store", "max-age=60"])
    def test_the_header_is_the_cache_control_argument(self, value: str) -> None:
        from wavecore.api.routes import system

        response = Response()

        body = system._success_response(
            _request(), response, {"version": "1.0.0"}, cache_control=value
        )

        assert response.headers["Cache-Control"] == value
        assert body["data"] == {"version": "1.0.0"}


class TestSystemServiceGetInfo:
    """Test suite for system service get_system_info operation."""

    def test_get_system_info_returns_version(self) -> None:
        """Test that get_system_info returns version."""
        from wavecore.api.services import system_service

        result = system_service.get_system_info()

        assert "version" in result
        assert isinstance(result["version"], str)
        # Version should follow semver pattern
        assert re.match(r"^\d+\.\d+\.\d+", result["version"])

    def test_get_system_info_returns_build(self) -> None:
        """Test that get_system_info returns build identifier."""
        from wavecore.api.services import system_service

        result = system_service.get_system_info()

        assert "build" in result
        assert isinstance(result["build"], str)
        assert len(result["build"]) > 0

    def test_get_system_info_returns_build_date(self) -> None:
        """Test that get_system_info returns build date."""
        from wavecore.api.services import system_service

        result = system_service.get_system_info()

        assert "build_date" in result
        assert isinstance(result["build_date"], str)

    def test_get_system_info_returns_support_info(self) -> None:
        """The support links point at the public project and its contact address."""
        from wavecore.api.services import system_service

        result = system_service.get_system_info()

        assert result["support"] == SUPPORT_LINKS

    def test_get_system_info_has_no_environment(self) -> None:
        """The info holds version, build, runtime and support, and no environment name."""
        from wavecore.api.services import system_service

        result = system_service.get_system_info()

        assert set(result) == SYSTEM_INFO_KEYS

    def test_wave_env_changes_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from wavecore.api.services import system_service

        monkeypatch.setenv("WAVE_ENV", "production")
        as_production = system_service.get_system_info()
        monkeypatch.setenv("WAVE_ENV", "staging")

        assert system_service.get_system_info() == as_production

    def test_the_environment_reader_is_gone(self) -> None:
        from wavecore.api.services import system_service

        assert not hasattr(system_service, "_get_environment")

    def test_get_system_info_returns_runtime_info(self) -> None:
        """Test that get_system_info returns runtime information."""
        from wavecore.api.services import system_service

        result = system_service.get_system_info()

        assert "runtime" in result
        assert "python_version" in result["runtime"]

    def test_get_system_info_consistent_on_repeated_calls(self) -> None:
        """Test that get_system_info returns consistent values."""
        from wavecore.api.services import system_service

        result1 = system_service.get_system_info()
        result2 = system_service.get_system_info()

        # Version and build should be consistent
        assert result1["version"] == result2["version"]
        assert result1["build"] == result2["build"]
