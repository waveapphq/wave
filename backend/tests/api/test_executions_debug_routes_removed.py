"""Unit tests asserting the execution-debug routes do not exist.

No ``/executions/{execution_id}/...`` debug route exists:

    GET    /executions/{id}/breakpoints
    POST   /executions/{id}/breakpoints
    DELETE /executions/{id}/breakpoints/{bp_id}
    PATCH  /executions/{id}/breakpoints/{bp_id}
    POST   /executions/{id}/step-over
    POST   /executions/{id}/step-into
    POST   /executions/{id}/continue
    POST   /executions/{id}/re-execute
    POST   /executions/{id}/skip-block

These tests check three levels:
    1. The ``debug_routes`` module does not exist.
    2. ``app.routes`` contains no path matching these patterns.
    3. Live HTTP calls return 404 with FastAPI's default ``detail`` body
       (NOT the WAVE ``{"success": False, ...}`` envelope that a WAVE
       route handler would produce).
"""

import importlib
import uuid

import pytest
from fastapi.testclient import TestClient

_LEGACY_METHOD_PATHS: list[tuple[str, str]] = [
    ("GET", "/executions/{execution_id}/breakpoints"),
    ("POST", "/executions/{execution_id}/breakpoints"),
    ("DELETE", "/executions/{execution_id}/breakpoints/{breakpoint_id}"),
    ("PATCH", "/executions/{execution_id}/breakpoints/{breakpoint_id}"),
    ("POST", "/executions/{execution_id}/step-over"),
    ("POST", "/executions/{execution_id}/step-into"),
    ("POST", "/executions/{execution_id}/continue"),
    ("POST", "/executions/{execution_id}/re-execute"),
    ("POST", "/executions/{execution_id}/skip-block"),
]


class TestLegacyDebugModulesGone:
    """The ``debug_routes`` and ``debug_actions`` modules do not exist."""

    def test_debug_routes_module_no_longer_importable(self) -> None:
        """``wavecore.api.routes.executions.debug_routes`` must not exist."""
        with pytest.raises(ModuleNotFoundError):
            importlib.import_module("wavecore.api.routes.executions.debug_routes")

    def test_debug_actions_module_no_longer_importable(self) -> None:
        """``wavecore.api.services.executions.debug_actions`` must not exist."""
        with pytest.raises(ModuleNotFoundError):
            importlib.import_module("wavecore.api.services.executions.debug_actions")

    def test_executions_package_does_not_re_export_debug_router(self) -> None:
        """``routes.executions.__init__`` must not re-export ``debug_router``."""
        executions_pkg = importlib.import_module("wavecore.api.routes.executions")
        assert not hasattr(executions_pkg, "debug_router")
        assert "debug_router" not in getattr(executions_pkg, "__all__", [])


class TestLegacyDebugRoutesNotRegistered:
    """``app.routes`` contains none of these debug paths."""

    def test_no_legacy_debug_path_registered(self) -> None:
        """Scan ``app.routes`` and confirm no debug route is registered."""
        from wavecore.api.app import app

        registered_paths = {getattr(route, "path", "") for route in app.routes}
        for _method, path in _LEGACY_METHOD_PATHS:
            assert path not in registered_paths, f"legacy route {path!r} must not be registered"


class TestLegacyDebugRoutesReturn404:
    """Live HTTP calls to these paths return a non-WAVE 404."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize("method,path_template", _LEGACY_METHOD_PATHS)
    def test_legacy_debug_route_returns_fastapi_not_found(
        self, client: TestClient, method: str, path_template: str
    ) -> None:
        """These endpoints return FastAPI's default 404, not a WAVE 404."""
        path = path_template.format(
            execution_id=str(uuid.uuid4()),
            breakpoint_id=str(uuid.uuid4()),
        )
        response = client.request(method, path)
        assert response.status_code == 404
        # FastAPI's default 404 shape: ``{"detail": "Not Found"}``.
        # A WAVE route handler would answer with its ``{"success": false, ...}`` envelope.
        body = response.json()
        assert body == {"detail": "Not Found"}
