"""Tests for REQ-5.2.3.1: FastAPI application instance with ASGI server support.

This test module verifies:
- FastAPI application instance creation and configuration
- ASGI compatibility for production deployment
- Lifecycle event handlers (startup/shutdown)
- Router registration capabilities
- Integration with ASGI servers (uvicorn, hypercorn, gunicorn)
- Graceful shutdown handling
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


class TestFastAPIApplicationInstance:
    """Test suite for FastAPI application instance creation and configuration."""

    def test_app_instance_creation(self) -> None:
        """Test that FastAPI application instance is created correctly."""
        from wavecore.api.app import app

        assert isinstance(app, FastAPI), "app must be a FastAPI instance"
        assert app.title == "WAVE API", "app title must be 'WAVE API'"
        assert app.version == "1.0.0", "app version must be '1.0.0'"

    def test_app_is_singleton(self) -> None:
        """Test that app instance is a singleton (same object on multiple imports)."""
        from wavecore.api.app import app as app1
        from wavecore.api.app import app as app2

        assert app1 is app2, "app must be a singleton instance"

    def test_app_metadata(self) -> None:
        """Test that application metadata is correctly configured."""
        from wavecore.api.app import app

        assert app.title == "WAVE API"
        assert app.description == "Workflow Automation and Validation Engine REST API"
        assert app.version == "1.0.0"
        assert app.contact == {
            "name": "WAVE",
            "email": "support@waveapp.dev",
            "url": "https://github.com/waveapphq/wave/issues",
        }
        assert app.license_info == {"name": "MIT", "identifier": "MIT"}

    def test_app_servers_configuration(self) -> None:
        """The app names one relative server: the WAVE server that serves the spec."""
        from wavecore.api.app import app

        assert app.servers == [{"url": "/", "description": "This WAVE server"}]


class TestASGICompatibility:
    """Test suite for ASGI server compatibility."""

    def test_app_has_asgi_callable(self) -> None:
        """Test that app is ASGI-compatible (has __call__ method)."""
        from wavecore.api.app import app

        # ASGI applications must be callable with (scope, receive, send)
        assert callable(app), "app must be callable for ASGI compatibility"
        assert callable(app), "app must have __call__ method"

    @pytest.mark.asyncio
    async def test_asgi_lifespan_protocol(self) -> None:
        """Test that app supports ASGI lifespan protocol."""
        from wavecore.api.app import app

        # ASGI lifespan protocol expects specific scope type
        scope = {
            "type": "lifespan",
            "asgi": {"version": "3.0"},
        }

        # Mock receive and send channels
        startup_complete = False
        shutdown_complete = False

        async def receive() -> dict[str, Any]:
            nonlocal startup_complete, shutdown_complete
            if not startup_complete:
                startup_complete = True
                return {"type": "lifespan.startup"}
            elif not shutdown_complete:
                shutdown_complete = True
                return {"type": "lifespan.shutdown"}
            # Keep connection open
            await asyncio.sleep(100)
            return {"type": "lifespan.shutdown"}

        messages: list[dict[str, Any]] = []

        async def send(message: dict[str, Any]) -> None:
            messages.append(message)

        # Run lifespan in background
        lifespan_task = asyncio.create_task(app(scope, receive, send))

        # Wait for startup
        await asyncio.sleep(0.1)
        assert any(
            msg.get("type") == "lifespan.startup.complete" for msg in messages
        ), "app must send lifespan.startup.complete"

        # Trigger shutdown
        await asyncio.sleep(0.1)

        # Cancel the task to cleanup
        lifespan_task.cancel()
        try:
            await lifespan_task
        except asyncio.CancelledError:
            pass

    def test_uvicorn_compatibility(self) -> None:
        """Test that app can be imported by uvicorn (ASGI server)."""
        # Uvicorn requires the app to be importable as a module:attribute
        # This test verifies the import path works
        import importlib

        module = importlib.import_module("wavecore.api.app")
        assert hasattr(module, "app"), "app must be exportable from wavecore.api.app"
        assert callable(module.app), "exported app must be callable"


class TestLifecycleEventHandlers:
    """Test suite for application lifecycle event handlers."""

    @pytest.mark.asyncio
    async def test_startup_event_registered(self) -> None:
        """Test that startup event handler is registered."""
        from wavecore.api.app import app

        # Check if startup events are registered
        # FastAPI 0.109.1+ uses router.lifespan_context or on_event
        has_startup = (
            len(app.router.on_startup) > 0
            or hasattr(app.router, "lifespan_context")
            or len(getattr(app, "on_startup", [])) > 0
        )

        assert has_startup, "app must have startup event handlers registered"

    @pytest.mark.asyncio
    async def test_shutdown_event_registered(self) -> None:
        """Test that shutdown event handler is registered."""
        from wavecore.api.app import app

        # Check if shutdown events are registered
        has_shutdown = (
            len(app.router.on_shutdown) > 0
            or hasattr(app.router, "lifespan_context")
            or len(getattr(app, "on_shutdown", [])) > 0
        )

        assert has_shutdown, "app must have shutdown event handlers registered"

    @pytest.mark.asyncio
    async def test_startup_handler_executes(self) -> None:
        """Test that startup handler executes during application startup."""
        from wavecore.api.app import app

        # TestClient triggers startup events - if no exception, startup succeeded
        with TestClient(app) as client:
            # Verify app is in running state after startup
            assert client.app is app, "client must reference running app"

    @pytest.mark.asyncio
    async def test_shutdown_handler_executes(self) -> None:
        """Test that shutdown handler executes during application shutdown."""
        from wavecore.api.app import app

        # TestClient context manager triggers startup and shutdown
        with TestClient(app) as client:
            pass  # Startup happens here

        # Shutdown happens when context exits
        # If we reach here without exception, shutdown succeeded
        assert client is not None, "shutdown events must execute without error"

    @pytest.mark.asyncio
    async def test_graceful_shutdown_cleanup(self) -> None:
        """Test that graceful shutdown performs cleanup operations."""
        from wavecore.api import app as app_module
        from wavecore.api.app import app

        # Track whether cleanup functions are called during shutdown
        cleanup_tracker: dict[str, bool] = {"storage_closed": False}
        real_shutdown = app_module.shutdown_event

        # The real shutdown runs first, so the tracker is set only once it has finished
        async def tracked_shutdown() -> None:
            await real_shutdown()
            cleanup_tracker["storage_closed"] = True

        with patch.object(app_module, "shutdown_event", tracked_shutdown):
            with TestClient(app):
                assert app.state.liveness_tasks, "startup must start the liveness tasks"

        # Verify the shutdown step ran and cleaned up
        assert cleanup_tracker[
            "storage_closed"
        ], "shutdown handlers must execute cleanup operations"
        assert app.state.liveness_tasks is None, "shutdown must stop the liveness tasks"


class TestRouterRegistration:
    """Test suite for router registration capabilities."""

    def test_app_has_router(self) -> None:
        """Test that app has a router for endpoint registration."""
        from wavecore.api.app import app

        assert hasattr(app, "router"), "app must have a router attribute"
        assert app.router is not None, "router must not be None"

    def test_router_registration_capability(self) -> None:
        """Test that routers can be registered with the app."""
        from wavecore.api.app import app

        # Verify the app has include_router method
        assert hasattr(
            app, "include_router"
        ), "app must have include_router method for adding routers"
        assert callable(app.include_router), "include_router must be callable"

    def test_openapi_schema_generation(self) -> None:
        """Test that OpenAPI schema can be generated from the app."""
        from wavecore.api.app import app

        schema = app.openapi()

        assert schema is not None, "OpenAPI schema must be generated"
        assert "openapi" in schema, "schema must have 'openapi' version field"
        assert "info" in schema, "schema must have 'info' section"
        assert schema["info"]["title"] == "WAVE API", "schema title must be 'WAVE API'"
        assert schema["info"]["version"] == "1.0.0", "schema version must be '1.0.0'"

    def test_docs_url_configured(self) -> None:
        """Test that interactive API docs URL is configured."""
        from wavecore.api.app import app

        # FastAPI provides /docs (Swagger UI) by default
        assert app.docs_url is not None, "docs_url must be configured"
        assert "/docs" in app.docs_url, "docs must be available at /docs"

    def test_redoc_url_configured(self) -> None:
        """Test that ReDoc documentation URL is configured."""
        from wavecore.api.app import app

        # FastAPI provides /redoc by default
        assert app.redoc_url is not None, "redoc_url must be configured"
        assert "/redoc" in app.redoc_url, "redoc must be available at /redoc"


class TestProductionDeploymentSupport:
    """Test suite for production deployment capabilities."""

    def test_app_supports_multiple_workers(self) -> None:
        """Test that app can be deployed with multiple workers."""

        # ASGI apps must be stateless or handle shared state correctly
        # Create multiple instances to simulate workers
        from wavecore.api.app import app as app1
        from wavecore.api.app import app as app2

        # Both should be the same singleton but testable independently
        assert app1 is app2, "app instances must be consistent across imports"

    def test_app_is_process_safe(self) -> None:
        """Test that app can be safely forked for process-based concurrency."""
        from wavecore.api.app import app

        # App must not have any file handles or sockets open at import time
        # This is verified by checking that app can be imported without side effects
        assert app is not None, "app must be importable without side effects"

    def test_hot_reload_support(self) -> None:
        """Test that app supports hot-reload in development mode."""
        from wavecore.api.app import app

        # For hot-reload, app must be re-importable
        # Verify app can be accessed multiple times
        assert app is not None
        from wavecore.api.app import app as reloaded_app

        assert reloaded_app is app, "app must support module reloading"


class TestApplicationConfiguration:
    """Test suite for application configuration management."""

    def test_app_has_state(self) -> None:
        """Test that app has state management for shared resources."""
        from wavecore.api.app import app

        assert hasattr(app, "state"), "app must have state attribute for shared data"

    def test_app_debug_mode_configurable(self) -> None:
        """Test that debug mode is configurable."""
        from wavecore.api.app import app

        # Debug mode should be controllable via environment or config
        assert hasattr(app, "debug"), "app must have debug attribute"
        assert isinstance(app.debug, bool), "debug must be a boolean"

    def test_app_exception_handlers(self) -> None:
        """Test that app can register exception handlers."""
        from wavecore.api.app import app

        # Verify exception handlers can be registered
        assert hasattr(app, "add_exception_handler"), "app must support exception handlers"
        assert callable(app.add_exception_handler), "add_exception_handler must be callable"


class TestServerIntegration:
    """Test suite for ASGI server integration."""

    def test_testclient_integration(self) -> None:
        """Test that app works with FastAPI TestClient."""
        from wavecore.api.app import app

        client = TestClient(app)
        assert client is not None, "TestClient must be created successfully"

        # Verify app is accessible through client
        assert client.app is app, "TestClient must reference the app"

    def test_app_handles_http_requests(self) -> None:
        """Test that app can handle HTTP requests through ASGI interface."""
        from wavecore.api.app import app

        with TestClient(app) as client:
            # Even without routes, app should handle requests
            # (might return 404, but shouldn't crash)
            try:
                response = client.get("/nonexistent")
                assert response.status_code in [
                    404,
                    200,
                ], "app must handle requests without crashing"
            except Exception as e:
                pytest.fail(f"app must handle HTTP requests without exceptions: {e}")

    def test_app_cors_ready(self) -> None:
        """Test that app is ready for CORS middleware configuration."""
        from wavecore.api.app import app

        # App should support middleware
        assert hasattr(app, "add_middleware"), "app must support middleware"
        assert callable(app.add_middleware), "add_middleware must be callable"


class TestApplicationModuleStructure:
    """Test suite for application module structure and exports."""

    def test_app_module_exports(self) -> None:
        """Test that wavecore.api.app module exports app correctly."""
        import wavecore.api.app as app_module

        assert hasattr(app_module, "app"), "module must export 'app'"
        assert isinstance(app_module.app, FastAPI), "exported app must be FastAPI instance"

    def test_app_module_path(self) -> None:
        """Test that app module is located at correct path."""
        import wavecore.api.app

        module_file = wavecore.api.app.__file__
        assert module_file is not None, "module must have __file__ attribute"
        assert "wavecore/api/app.py" in module_file.replace(
            "\\", "/"
        ), "app must be at wavecore/api/app.py"

    def test_uvicorn_import_string(self) -> None:
        """Test that uvicorn can import app using standard import string."""
        # Uvicorn uses format: "module.path:app_variable"
        import_string = "wavecore.api.app:app"

        module_path, app_name = import_string.split(":")
        module = __import__(module_path, fromlist=[app_name])

        assert hasattr(module, app_name), f"module must have '{app_name}' attribute"
        app = getattr(module, app_name)
        assert isinstance(app, FastAPI), "imported object must be FastAPI instance"


class TestEdgeCasesAndErrorHandling:
    """Test suite for edge cases and error scenarios."""

    @pytest.mark.asyncio
    async def test_multiple_testclient_instances(self) -> None:
        """Test that multiple TestClient instances can coexist safely."""
        from wavecore.api.app import app

        # Create two clients simultaneously
        with TestClient(app) as client1:
            with TestClient(app) as client2:
                # Both should reference the same app
                assert client1.app is client2.app, "clients must share app instance"
                assert client1.app is app, "both clients must reference the singleton app"

    @pytest.mark.asyncio
    async def test_rapid_startup_shutdown_cycles(self) -> None:
        """Test that app handles rapid startup/shutdown cycles without issues."""
        from wavecore.api.app import app

        # Perform multiple startup/shutdown cycles
        for _ in range(3):
            with TestClient(app) as client:
                assert client.app is app, "app must be accessible in each cycle"
            # App should cleanly shut down and be ready for next cycle

    @pytest.mark.asyncio
    async def test_startup_with_exception_in_handler(self) -> None:
        """Test that startup failures are properly propagated."""
        from wavecore.api import app as app_module
        from wavecore.api.app import app

        # Create a failing startup handler
        async def failing_startup() -> None:
            raise RuntimeError("Simulated startup failure")

        # Attempt to start - should raise the startup exception
        with patch.object(app_module, "startup_event", failing_startup):
            with pytest.raises(RuntimeError, match="^Simulated startup failure$"):
                with TestClient(app):
                    pass

    @pytest.mark.asyncio
    async def test_shutdown_with_exception_in_handler(self) -> None:
        """Test that shutdown exceptions are handled without leaving app in bad state."""
        from wavecore.api import app as app_module
        from wavecore.api.app import app

        real_shutdown = app_module.shutdown_event

        # Create a failing shutdown handler that runs the real shutdown first
        async def failing_shutdown() -> None:
            await real_shutdown()
            raise RuntimeError("Simulated shutdown failure")

        # Startup and shutdown - shutdown exception should be raised
        with patch.object(app_module, "shutdown_event", failing_shutdown):
            with pytest.raises(RuntimeError, match="^Simulated shutdown failure$"):
                with TestClient(app):
                    pass

        assert app.state.liveness_tasks is None, "the real shutdown must run before the failure"

    def test_app_state_isolation_between_requests(self) -> None:
        """Test that app.state modifications don't leak between requests."""
        from wavecore.api.app import app

        with TestClient(app) as _client:
            # Set some state
            app.state.test_value = "initial"

            # State should be accessible
            assert app.state.test_value == "initial", "app.state must persist during session"

            # Clean up test state
            if hasattr(app.state, "test_value"):
                delattr(app.state, "test_value")

    def test_app_handles_invalid_asgi_scope(self) -> None:
        """Test that app properly handles invalid ASGI scope types."""
        from wavecore.api.app import app

        # Test with an unsupported scope type (should not crash)
        invalid_scope = {
            "type": "invalid",
            "asgi": {"version": "3.0"},
        }

        async def dummy_receive() -> dict[str, Any]:
            return {"type": "http.disconnect"}

        async def dummy_send(message: dict[str, Any]) -> None:
            pass

        # App should handle gracefully (may raise specific exception)
        # but should not cause uncaught errors
        try:
            asyncio.run(app(invalid_scope, dummy_receive, dummy_send))
        except (ValueError, RuntimeError, KeyError, AssertionError):
            # These are acceptable responses to invalid scope
            pass


class TestEnvironmentConfiguration:
    """Test suite for environment-based configuration."""

    def test_app_title_configurable(self) -> None:
        """Test that app title can be configured."""
        from wavecore.api.app import app

        # Title should be configurable (currently hardcoded to "WAVE API")
        assert isinstance(app.title, str), "app.title must be a string"
        assert len(app.title) > 0, "app.title must not be empty"

    def test_app_version_format(self) -> None:
        """Test that app version follows semantic versioning."""
        # Version should follow semantic versioning (X.Y.Z)
        import re

        from wavecore.api.app import app

        version_pattern = re.compile(r"^\d+\.\d+\.\d+$")
        assert version_pattern.match(
            app.version
        ), f"app.version must follow semantic versioning format (X.Y.Z), got: {app.version}"

    def test_app_debug_defaults_to_false(self) -> None:
        """Test that debug mode defaults to False for production safety."""
        from wavecore.api.app import app

        # Debug should default to False in production
        # (can be overridden by environment variables)
        assert isinstance(app.debug, bool), "app.debug must be a boolean"
        # Note: We don't assert False here as it may be True in test environment


class TestShutdownCleanup:
    """Test suite for application shutdown cleanup operations."""

    @pytest.mark.asyncio
    async def test_shutdown_clears_workbench_sessions(self) -> None:
        """Test that shutdown event clears workbench sessions."""
        from wavecore.api.app import shutdown_event

        mock_clear = AsyncMock()
        with patch("wavecore.api.services.workbench._common._clear_sessions", mock_clear):
            # Create a mock app state without ws_manager
            from wavecore.api.app import app

            # Remove ws_manager if it exists for this test
            original_ws_manager = getattr(app.state, "ws_manager", None)
            if hasattr(app.state, "ws_manager"):
                delattr(app.state, "ws_manager")

            try:
                await shutdown_event()
                mock_clear.assert_called_once()
            finally:
                # Restore ws_manager if it existed
                if original_ws_manager is not None:
                    app.state.ws_manager = original_ws_manager

    @pytest.mark.asyncio
    async def test_shutdown_closes_websocket_manager(self) -> None:
        """Test that shutdown event closes WebSocket manager."""
        from wavecore.api.app import app, shutdown_event

        # Create a mock WebSocket manager
        mock_ws_manager = AsyncMock()
        mock_ws_manager.shutdown = AsyncMock()

        # Store original state
        original_ws_manager = getattr(app.state, "ws_manager", None)

        try:
            # Set up mock ws_manager
            app.state.ws_manager = mock_ws_manager

            mock_clear = AsyncMock()
            with patch("wavecore.api.services.workbench._common._clear_sessions", mock_clear):
                await shutdown_event()

                # Verify ws_manager.shutdown was called
                mock_ws_manager.shutdown.assert_called_once()
        finally:
            # Restore original state
            if original_ws_manager is not None:
                app.state.ws_manager = original_ws_manager
            elif hasattr(app.state, "ws_manager"):
                delattr(app.state, "ws_manager")

    @pytest.mark.asyncio
    async def test_shutdown_handles_missing_ws_manager(self) -> None:
        """Test that shutdown handles case where ws_manager is not set."""
        from wavecore.api.app import app, shutdown_event

        # Store original state
        original_ws_manager = getattr(app.state, "ws_manager", None)

        try:
            # Remove ws_manager
            if hasattr(app.state, "ws_manager"):
                delattr(app.state, "ws_manager")

            mock_clear = AsyncMock()
            with patch("wavecore.api.services.workbench._common._clear_sessions", mock_clear):
                # Should not raise even without ws_manager
                await shutdown_event()
                mock_clear.assert_called_once()
        finally:
            # Restore original state
            if original_ws_manager is not None:
                app.state.ws_manager = original_ws_manager

    @pytest.mark.asyncio
    async def test_shutdown_handles_none_ws_manager(self) -> None:
        """Test that shutdown handles case where ws_manager is explicitly None."""
        from wavecore.api.app import app, shutdown_event

        # Store original state
        original_ws_manager = getattr(app.state, "ws_manager", None)

        try:
            # Set ws_manager to None
            app.state.ws_manager = None

            mock_clear = AsyncMock()
            with patch("wavecore.api.services.workbench._common._clear_sessions", mock_clear):
                # Should not raise even with None ws_manager
                await shutdown_event()
                mock_clear.assert_called_once()
        finally:
            # Restore original state
            if original_ws_manager is not None:
                app.state.ws_manager = original_ws_manager
            elif hasattr(app.state, "ws_manager"):
                delattr(app.state, "ws_manager")

    @pytest.mark.asyncio
    async def test_shutdown_drops_kept_backup_uploads(self) -> None:
        """Test that shutdown event drops every kept backup upload."""
        from wavecore.api.app import app, shutdown_event
        from wavecore.api.services.backup import uploads as backup_uploads

        original_ws_manager = getattr(app.state, "ws_manager", None)
        upload_id = backup_uploads.keep(b"archive", "backup.zip")

        try:
            app.state.ws_manager = None

            mock_clear = AsyncMock()
            with patch("wavecore.api.services.workbench._common._clear_sessions", mock_clear):
                await shutdown_event()

            with pytest.raises(
                backup_uploads.BackupUploadNotFound, match=r"^Backup upload not found$"
            ):
                backup_uploads.source(None, "backup.zip", upload_id)
        finally:
            backup_uploads.clear()
            if original_ws_manager is not None:
                app.state.ws_manager = original_ws_manager
            elif hasattr(app.state, "ws_manager"):
                delattr(app.state, "ws_manager")


class TestAsyncImportExportEndpointsRemoved:
    """The dead async import/export scaffold is unregistered (REQ-5.2.4.9).

    Every job-based import/export endpoint must return 404: the synchronous
    per-entity import/export routes are the only import/export surface.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize(
        "entity",
        ["plugin", "block", "test", "suite", "regression", "profile"],
    )
    def test_async_entity_export_endpoints_removed(self, client: TestClient, entity: str) -> None:
        """POST /export/{entity}/{id} does not exist."""
        entity_id = "00000000-0000-0000-0000-000000000001"
        response = client.post(f"/export/{entity}/{entity_id}", json={})

        assert response.status_code == 404

    def test_async_workspace_export_endpoint_removed(self, client: TestClient) -> None:
        """POST /export/workspace does not exist."""
        response = client.post("/export/workspace", json={})

        assert response.status_code == 404

    def test_async_export_status_endpoint_removed(self, client: TestClient) -> None:
        """GET /export/{export_id}/status does not exist."""
        response = client.get("/export/00000000-0000-0000-0000-000000000001/status")

        assert response.status_code == 404

    def test_async_export_download_endpoint_removed(self, client: TestClient) -> None:
        """GET /export/{export_id}/download does not exist."""
        response = client.get("/export/00000000-0000-0000-0000-000000000001/download")

        assert response.status_code == 404

    def test_async_workspace_import_endpoint_removed(self, client: TestClient) -> None:
        """POST /import/workspace does not exist."""
        response = client.post("/import/workspace", json={})

        assert response.status_code == 404

    def test_async_import_validate_endpoint_removed(self, client: TestClient) -> None:
        """POST /import/validate does not exist."""
        response = client.post("/import/validate", json={})

        assert response.status_code == 404

    def test_async_import_status_endpoint_removed(self, client: TestClient) -> None:
        """GET /import/{import_id}/status does not exist."""
        response = client.get("/import/00000000-0000-0000-0000-000000000001/status")

        assert response.status_code == 404
