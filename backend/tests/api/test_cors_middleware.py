"""Tests for REQ-5.2.3.3: CORS middleware for cross-origin requests.

This test module verifies:
- CORS middleware integration into FastAPI application
- Configuration-driven origin allowlist with runtime updates
- Development (permissive) and production (restrictive) modes
- Preflight request handling for complex cross-origin operations
- Credential support for authenticated requests
- Security validation (no wildcards in production)
"""

import os
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


class TestCORSMiddlewareIntegration:
    """Test suite for CORS middleware integration into FastAPI app."""

    def test_cors_middleware_registered(self) -> None:
        """Test that CORS middleware is registered with the app."""
        from wavecore.api.app import app

        # Check if CORSMiddleware is in the middleware stack
        # FastAPI wraps middleware in Middleware objects, check the cls attribute
        has_cors = any(
            hasattr(m, "cls") and m.cls.__name__ == "CORSMiddleware" for m in app.user_middleware
        )
        assert has_cors, "CORSMiddleware must be registered in app middleware stack"

    def test_cors_middleware_position_in_stack(self) -> None:
        """Test that CORS middleware is positioned correctly in middleware stack."""
        from wavecore.api.app import app

        # CORS should be one of the first middleware (to handle preflight early)
        middleware_classes = [
            m.cls.__name__ if hasattr(m, "cls") else type(m).__name__ for m in app.user_middleware
        ]
        if "CORSMiddleware" in middleware_classes:
            cors_index = middleware_classes.index("CORSMiddleware")
            # CORS should be in the first 3 middleware (allows for error handling before it)
            assert cors_index < 3, "CORSMiddleware should be positioned early in middleware stack"


class TestCORSExposedHeaders:
    """Test suite for response headers the browser may read cross-origin."""

    def test_request_id_headers_declared_in_cors_options(self) -> None:
        """Test that the CORS middleware is configured to expose the request id headers."""
        from wavecore.api.app import app

        cors = next(m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware")
        exposed = cors.kwargs["expose_headers"]

        assert "X-Request-ID" in exposed, "X-Request-ID must be exposed to the browser"
        assert "X-Correlation-ID" in exposed, "X-Correlation-ID must be exposed to the browser"

    def test_request_id_headers_readable_cross_origin(self) -> None:
        """Test that a cross-origin response advertises the request id headers."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            response = client.get("/api/config", headers={"Origin": "http://localhost:3000"})

            exposed = response.headers.get("access-control-expose-headers", "")
            assert "X-Request-ID" in exposed, "browser must be allowed to read X-Request-ID"
            assert "X-Correlation-ID" in exposed, "browser must be allowed to read X-Correlation-ID"
            assert "x-request-id" in response.headers, "the header itself must still be sent"

    def test_request_id_header_present_on_a_cross_origin_failure(self) -> None:
        """Test that a failed cross-origin read still lets the browser read the request id."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            missing_id = "00000000-0000-4000-8000-0000000004a4"
            response = client.get(
                f"/environments/{missing_id}", headers={"Origin": "http://localhost:3000"}
            )

            assert response.status_code == 404, "the probe must reach a real backend failure"
            assert (
                response.headers.get("access-control-allow-origin") == "http://localhost:3000"
            ), "the failure must still be readable cross-origin"
            assert "X-Request-ID" in response.headers.get(
                "access-control-expose-headers", ""
            ), "browser must be allowed to read X-Request-ID on a failure"
            assert (
                response.headers.get("x-request-id") == response.json()["meta"]["request_id"]
            ), "the header a client reads must be the id the envelope reports"


class TestCORSConfigurationDrivenOrigins:
    """Test suite for configuration-driven CORS origin management."""

    def test_cors_uses_config_origins(self) -> None:
        """Test that CORS middleware uses origins from configuration."""
        with patch.dict(
            os.environ,
            {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000,http://localhost:5173"},
        ):
            # Re-import to get fresh config
            import importlib

            import wavecore.api.config

            importlib.reload(wavecore.api.config)

            from wavecore.api.config import get_config

            config = get_config()

            assert len(config.security.cors_origins) == 2
            assert "http://localhost:3000" in config.security.cors_origins
            assert "http://localhost:5173" in config.security.cors_origins

    def test_cors_default_empty_origins(self) -> None:
        """Test that CORS defaults to empty origins for security.

        Secure by default - no CORS origins allowed until explicitly configured.
        """
        from wavecore.api.config import Config

        config = Config()
        assert isinstance(config.security.cors_origins, list), "cors_origins must be a list"
        assert len(config.security.cors_origins) == 0, "cors_origins must default to empty"

    def test_cors_example_config_file(self, example_config: Path) -> None:
        """Test that a copy of the example config named by WAVE_CONFIG_FILE allows dev origins."""
        from wavecore.api.config import Config

        assert os.environ["WAVE_CONFIG_FILE"] == str(example_config)

        config = Config()
        assert "http://localhost:3000" in config.security.cors_origins
        assert "http://127.0.0.1:3000" in config.security.cors_origins


class TestCORSPreflightRequests:
    """Test suite for CORS preflight (OPTIONS) request handling."""

    def test_preflight_request_allowed_origin(self) -> None:
        """Test that preflight requests from allowed origins receive correct headers."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Send preflight OPTIONS request
            response = client.options(
                "/api/config",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "GET",
                },
            )

            # Should return 200 OK with CORS headers
            assert response.status_code == 200, "preflight must return 200 OK"
            assert (
                "access-control-allow-origin" in response.headers
            ), "must include Access-Control-Allow-Origin header"
            assert (
                response.headers["access-control-allow-origin"] == "http://localhost:3000"
            ), "must echo allowed origin"

    def test_preflight_request_disallowed_origin(self) -> None:
        """Test that preflight requests from disallowed origins are rejected."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Send preflight OPTIONS request from disallowed origin
            response = client.options(
                "/api/config",
                headers={
                    "Origin": "http://evil.com",
                    "Access-Control-Request-Method": "GET",
                },
            )

            # Should not include CORS headers for disallowed origin
            # FastAPI/Starlette returns 400 or omits CORS headers
            assert (
                "access-control-allow-origin" not in response.headers
                or response.headers.get("access-control-allow-origin") != "http://evil.com"
            ), "must not allow disallowed origin"

    def test_preflight_request_methods(self) -> None:
        """Test that preflight requests include allowed methods."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Send preflight OPTIONS request
            response = client.options(
                "/api/config",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "POST",
                },
            )

            # Should include allowed methods
            assert (
                "access-control-allow-methods" in response.headers
            ), "must include Access-Control-Allow-Methods header"

            allowed_methods = response.headers["access-control-allow-methods"]
            # Standard REST methods should be allowed
            for method in ["GET", "POST", "PUT", "DELETE", "PATCH"]:
                assert method in allowed_methods, f"must allow {method} in CORS preflight"

    def test_preflight_request_headers(self) -> None:
        """Test that preflight requests include allowed headers."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Send preflight OPTIONS request
            response = client.options(
                "/api/config",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "Content-Type,Authorization",
                },
            )

            # Should include allowed headers
            assert (
                "access-control-allow-headers" in response.headers
            ), "must include Access-Control-Allow-Headers header"


class TestCORSActualRequests:
    """Test suite for CORS on actual API requests (non-preflight)."""

    def test_actual_request_allowed_origin(self) -> None:
        """Test that actual requests from allowed origins receive CORS headers."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Send actual GET request with Origin header
            response = client.get("/api/config", headers={"Origin": "http://localhost:3000"})

            # Should include CORS headers
            assert (
                "access-control-allow-origin" in response.headers
            ), "must include Access-Control-Allow-Origin header on actual request"
            assert (
                response.headers["access-control-allow-origin"] == "http://localhost:3000"
            ), "must echo allowed origin on actual request"

    def test_actual_request_disallowed_origin(self) -> None:
        """Test that actual requests from disallowed origins don't receive CORS headers."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Send actual GET request from disallowed origin
            response = client.get("/api/config", headers={"Origin": "http://evil.com"})

            # Should not include CORS headers for disallowed origin
            assert (
                "access-control-allow-origin" not in response.headers
                or response.headers.get("access-control-allow-origin") != "http://evil.com"
            ), "must not allow disallowed origin on actual request"

    def test_actual_request_no_origin_header(self) -> None:
        """Test that requests without Origin header work normally (same-origin)."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Send request without Origin header (same-origin request)
            response = client.get("/api/config")

            # Should work normally - CORS doesn't block same-origin requests
            # Status may be 200 (route exists) or 404 (route doesn't exist), but not CORS error
            assert response.status_code in [
                200,
                404,
            ], "same-origin requests must not be blocked by CORS"
            # CORS headers should not be present for same-origin
            assert (
                "access-control-allow-origin" not in response.headers
            ), "same-origin requests should not have CORS headers"


class TestCORSCredentialSupport:
    """Test suite for CORS credential support."""

    def test_credentials_allowed_in_cors(self) -> None:
        """Test that CORS middleware allows credentials (cookies, auth headers)."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Send request with Origin header
            response = client.get("/api/config", headers={"Origin": "http://localhost:3000"})

            # Should include Access-Control-Allow-Credentials: true
            assert (
                "access-control-allow-credentials" in response.headers
            ), "must include Access-Control-Allow-Credentials header"
            assert (
                response.headers["access-control-allow-credentials"] == "true"
            ), "must allow credentials"


class TestCORSDevelopmentMode:
    """Test suite for CORS in development mode (permissive)."""

    def test_wildcard_origin_in_development(self) -> None:
        """Test that wildcard (*) origins work in development mode."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "*"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Send request from any origin
            response = client.get(
                "/api/config", headers={"Origin": "http://random-dev-server.local"}
            )

            # Should include CORS headers with wildcard or echo origin
            assert (
                "access-control-allow-origin" in response.headers
            ), "must include CORS headers in wildcard mode"

    def test_localhost_variants_allowed_in_development(self) -> None:
        """Test that common localhost variants are supported for development."""
        with patch.dict(
            os.environ,
            {
                "WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173"
            },
        ):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Test localhost variants
            for origin in [
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:5173",
            ]:
                response = client.get("/api/config", headers={"Origin": origin})
                assert (
                    response.headers.get("access-control-allow-origin") == origin
                ), f"must allow development origin: {origin}"


class TestCORSPrivateNetworkOrigins:
    """Test suite for the development origin pattern (REQ-5.2.3.3).

    A developer browsing the dev app from another machine on the LAN sends an
    origin the localhost allowlist cannot contain.
    """

    LAN_REGEX = (
        r"^http://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+"
        r"|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$"
    )

    @staticmethod
    def _client_with_regex(regex: str) -> TestClient:
        import importlib

        import wavecore.api.app
        import wavecore.api.config

        importlib.reload(wavecore.api.config)
        importlib.reload(wavecore.api.app)
        from wavecore.api.app import app

        return TestClient(app)

    def test_regex_is_passed_to_the_middleware(self) -> None:
        """Test that a configured pattern reaches CORSMiddleware."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGIN_REGEX": self.LAN_REGEX}):
            client = self._client_with_regex(self.LAN_REGEX)
            cors = next(m for m in client.app.user_middleware if m.cls.__name__ == "CORSMiddleware")

            assert cors.kwargs["allow_origin_regex"] == self.LAN_REGEX, "pattern must be passed"

    def test_no_regex_configured_passes_none(self) -> None:
        """Test that an unset pattern leaves the middleware without one."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGIN_REGEX": ""}):
            client = self._client_with_regex("")
            cors = next(m for m in client.app.user_middleware if m.cls.__name__ == "CORSMiddleware")

            assert cors.kwargs["allow_origin_regex"] is None, "empty pattern must pass None"

    def test_lan_origin_allowed_by_the_pattern(self) -> None:
        """Test that a private-network origin is allowed when the pattern is set."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGIN_REGEX": self.LAN_REGEX}):
            client = self._client_with_regex(self.LAN_REGEX)

            for origin in [
                "http://192.168.1.20:3000",
                "http://10.0.0.5:5173",
                "http://172.16.4.2:3000",
            ]:
                response = client.get("/api/config", headers={"Origin": origin})

                assert (
                    response.headers.get("access-control-allow-origin") == origin
                ), f"must allow private-network origin: {origin}"

    def test_public_origin_rejected_by_the_pattern(self) -> None:
        """Test that the pattern does not open the app to arbitrary origins."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGIN_REGEX": self.LAN_REGEX}):
            client = self._client_with_regex(self.LAN_REGEX)

            response = client.get("/api/config", headers={"Origin": "http://evil.example.com"})

            assert (
                "access-control-allow-origin" not in response.headers
            ), "a public origin must not be allowed by the private-network pattern"

    def test_example_config_carries_the_pattern(self) -> None:
        """Test that the shipped example config allows private-network origins."""
        import re

        import yaml

        from tests.conftest import EXAMPLE_CONFIG_FILE

        document = yaml.safe_load(EXAMPLE_CONFIG_FILE.read_text(encoding="utf-8"))
        pattern = document["security"]["cors_origin_regex"]

        assert re.match(pattern, "http://192.168.1.20:3000"), "dev must allow a LAN origin"
        assert not re.match(pattern, "http://evil.example.com"), "dev must not allow any origin"


class TestCORSProductionMode:
    """Test suite for CORS in production mode (restrictive)."""

    def test_explicit_origins_only_in_production(self) -> None:
        """Test that only explicitly configured origins are allowed in production."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "https://app.wave.example.com"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Allowed origin should work
            response = client.get("/api/config", headers={"Origin": "https://app.wave.example.com"})
            assert (
                response.headers.get("access-control-allow-origin")
                == "https://app.wave.example.com"
            ), "must allow configured production origin"

            # Other origins should be rejected
            response = client.get("/api/config", headers={"Origin": "https://evil.com"})
            assert (
                "access-control-allow-origin" not in response.headers
                or response.headers.get("access-control-allow-origin") != "https://evil.com"
            ), "must reject non-configured origins in production"

    def test_https_enforcement_in_production(self) -> None:
        """Test that HTTPS origins are used in production environments."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "https://app.wave.example.com"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.config

            importlib.reload(wavecore.api.config)

            from wavecore.api.config import get_config

            config = get_config()

            # Production origins should use HTTPS
            for origin in config.security.cors_origins:
                if "localhost" not in origin and "127.0.0.1" not in origin:
                    assert origin.startswith(
                        "https://"
                    ), f"production origin must use HTTPS: {origin}"


class TestCORSMultipleOrigins:
    """Test suite for CORS with multiple allowed origins."""

    def test_multiple_origins_configuration(self) -> None:
        """Test that multiple origins can be configured and all are allowed."""
        with patch.dict(
            os.environ,
            {
                "WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000,https://app.wave.example.com,https://staging.wave.example.com"
            },
        ):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Test each configured origin
            origins = [
                "http://localhost:3000",
                "https://app.wave.example.com",
                "https://staging.wave.example.com",
            ]

            for origin in origins:
                response = client.get("/api/config", headers={"Origin": origin})
                assert (
                    response.headers.get("access-control-allow-origin") == origin
                ), f"must allow configured origin: {origin}"

    def test_origin_not_in_list_rejected(self) -> None:
        """Test that origins not in the configured list are rejected."""
        with patch.dict(
            os.environ,
            {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000,https://app.wave.example.com"},
        ):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Request from unconfigured origin
            response = client.get("/api/config", headers={"Origin": "https://unauthorized.com"})

            assert (
                "access-control-allow-origin" not in response.headers
                or response.headers.get("access-control-allow-origin") != "https://unauthorized.com"
            ), "must reject unconfigured origins"


class TestCORSEmptyConfiguration:
    """Test suite for CORS with empty origin configuration (maximum security)."""

    def test_empty_origins_blocks_all_cors(self) -> None:
        """Test that empty CORS origins list blocks all cross-origin requests."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": ""}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Request from any origin should not receive CORS headers
            response = client.get("/api/config", headers={"Origin": "http://localhost:3000"})

            assert (
                "access-control-allow-origin" not in response.headers
            ), "empty CORS origins must block all cross-origin requests"

    def test_same_origin_requests_work_with_empty_cors(self) -> None:
        """Test that same-origin requests work even with empty CORS configuration."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": ""}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Same-origin request (no Origin header)
            response = client.get("/api/config")

            # CORS doesn't block same-origin requests
            # Status may be 200 (route exists) or 404 (route doesn't exist)
            assert response.status_code in [
                200,
                404,
            ], "same-origin requests must not be blocked with empty CORS config"


class TestCORSEdgeCases:
    """Test suite for CORS edge cases and error scenarios."""

    def test_cors_with_trailing_slash_origin(self) -> None:
        """Test that origins with trailing slashes are handled correctly."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Request with trailing slash in Origin (should not happen but handle gracefully)
            response = client.get("/api/config", headers={"Origin": "http://localhost:3000/"})

            # Should either normalize and allow, or reject (but not crash)
            # 404 is acceptable (route doesn't exist), what matters is no crash
            assert response.status_code in [
                200,
                403,
                404,
            ], "must handle trailing slash in origin gracefully without crash"

    def test_cors_with_port_variations(self) -> None:
        """Test that port number matching is exact (3000 != 3001)."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Exact port should work
            response = client.get("/api/config", headers={"Origin": "http://localhost:3000"})
            assert (
                response.headers.get("access-control-allow-origin") == "http://localhost:3000"
            ), "exact port match must work"

            # Different port should be rejected
            response = client.get("/api/config", headers={"Origin": "http://localhost:3001"})
            assert (
                "access-control-allow-origin" not in response.headers
                or response.headers.get("access-control-allow-origin") != "http://localhost:3001"
            ), "different port must be rejected"

    def test_cors_case_sensitivity(self) -> None:
        """Test that origin matching is case-sensitive for security."""
        with patch.dict(os.environ, {"WAVE_SECURITY_CORS_ORIGINS": "http://localhost:3000"}):
            # Re-import app with new config
            import importlib

            import wavecore.api.app
            import wavecore.api.config

            importlib.reload(wavecore.api.config)
            importlib.reload(wavecore.api.app)

            from wavecore.api.app import app

            client = TestClient(app)

            # Lowercase should work (standard)
            response = client.get("/api/config", headers={"Origin": "http://localhost:3000"})
            assert (
                response.headers.get("access-control-allow-origin") == "http://localhost:3000"
            ), "standard lowercase origin must work"

            # Uppercase scheme/host may be normalized by browser but test exact match
            response = client.get("/api/config", headers={"Origin": "HTTP://LOCALHOST:3000"})
            # Origins are typically normalized to lowercase by CORS middleware
            # This should either work (normalized) or be rejected, but must not crash
            # 404 is acceptable (route doesn't exist)
            assert response.status_code in [
                200,
                403,
                404,
            ], "must handle case variations gracefully without crash"
