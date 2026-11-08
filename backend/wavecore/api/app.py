"""The WAVE FastAPI app, with CORS and error handling (REQ-5.2.3.1, REQ-5.2.3.3, REQ-5.2.3.4)."""

import asyncio
import contextlib
import logging
import os
import sys
from collections.abc import AsyncIterator
from typing import NoReturn

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from wavecore.api.config import Config, ConfigValidationError, get_config
from wavecore.api.middleware.middleware_module import (
    add_error_handling_middleware,
    add_request_response_logging_middleware,
)
from wavecore.api.middleware.utf8_guard import Utf8Guard
from wavecore.api.routes.admin.bulk_routes import router as admin_bulk_router
from wavecore.api.routes.admin.log_routes import router as admin_log_router
from wavecore.api.routes.admin.masking_routes import router as admin_masking_router
from wavecore.api.routes.admin.routes import router as admin_router
from wavecore.api.routes.artifacts import router as artifacts_router
from wavecore.api.routes.backup import router as backup_router
from wavecore.api.routes.blocks.import_export_routes import router as blocks_import_export_router
from wavecore.api.routes.blocks.routes import router as blocks_router
from wavecore.api.routes.blocks.version_routes import router as blocks_version_router
from wavecore.api.routes.config import router as config_router
from wavecore.api.routes.dashboard.routes import router as dashboard_router
from wavecore.api.routes.environments.import_export_routes import (
    router as environments_import_export_router,
)
from wavecore.api.routes.environments.routes import router as environments_router
from wavecore.api.routes.executions.routes import router as executions_router
from wavecore.api.routes.functions.import_export_routes import (
    router as functions_import_export_router,
)
from wavecore.api.routes.functions.routes import router as functions_router
from wavecore.api.routes.functions.run_routes import router as functions_run_router
from wavecore.api.routes.health import router as health_router
from wavecore.api.routes.mcp import router as mcp_router
from wavecore.api.routes.network.certificates import router as network_certificates_router
from wavecore.api.routes.network.proxy import router as network_proxy_router
from wavecore.api.routes.network.ssh_hosts import router as network_ssh_hosts_router
from wavecore.api.routes.openapi import router as openapi_router
from wavecore.api.routes.opensearch_tools import router as opensearch_tools_router
from wavecore.api.routes.profiles.import_export_routes import (
    router as profiles_import_export_router,
)
from wavecore.api.routes.profiles.routes import router as profiles_router
from wavecore.api.routes.python_tools import router as python_tools_router
from wavecore.api.routes.regressions.batch_routes import router as regressions_batch_router
from wavecore.api.routes.regressions.composition_routes import (
    router as regressions_composition_router,
)
from wavecore.api.routes.regressions.import_export_routes import (
    router as regressions_import_export_router,
)
from wavecore.api.routes.regressions.routes import router as regressions_router
from wavecore.api.routes.regressions.version_routes import router as regressions_version_router
from wavecore.api.routes.reports import router as reports_router
from wavecore.api.routes.server import router as server_router
from wavecore.api.routes.sql_tools import router as sql_tools_router
from wavecore.api.routes.suites.batch_routes import router as suites_batch_router
from wavecore.api.routes.suites.composition_routes import router as suites_composition_router
from wavecore.api.routes.suites.import_export_routes import router as suites_import_export_router
from wavecore.api.routes.suites.routes import router as suites_router
from wavecore.api.routes.suites.version_routes import router as suites_version_router
from wavecore.api.routes.system import router as system_router
from wavecore.api.routes.tests.batch_routes import router as tests_batch_router
from wavecore.api.routes.tests.import_export_routes import router as tests_import_export_router
from wavecore.api.routes.tests.lifecycle_routes import router as tests_lifecycle_router
from wavecore.api.routes.tests.routes import router as tests_router
from wavecore.api.routes.tests.testdata_routes import router as tests_testdata_router
from wavecore.api.routes.tests.version_routes import router as tests_version_router
from wavecore.api.routes.variables.expression_routes import (
    router as variables_expression_router,
)
from wavecore.api.routes.variables.routes import router as variables_router
from wavecore.api.routes.workbench import router as workbench_router

# Configure unified logging format (REQ-3.7.2.5, REQ-3.7.2.6, REQ-5.2.3.5)
from wavecore.core.logging.formatter import configure_unified_logging

configure_unified_logging()  # bootstrap; the config file's level is applied below

logger = logging.getLogger(__name__)


def _refuse_to_start(message: str) -> NoReturn:
    """Log why WAVE cannot start and end the process with exit code 1."""
    logger.critical("%s", message)
    # A raised error in the startup event leaves the server hung, so the process ends here.
    os._exit(1)


def _check_text_encoding() -> None:
    """Refuse to start on a host whose encoding is not UTF-8 (REQ-4.6.9)."""
    encoding = sys.getfilesystemencoding()
    if encoding.lower() != "utf-8":
        _refuse_to_start(
            f"WAVE needs UTF-8 and this host's encoding is {encoding}: "
            "set PYTHONUTF8=1 in the environment that starts WAVE"
        )


def _load_config() -> Config:
    """Load the config file, or log why it cannot be used and exit (REQ-4.7.15)."""
    try:
        return get_config()
    except ConfigValidationError as exc:
        _refuse_to_start(str(exc))


def _apply_log_level() -> None:
    """Put the startup log level in force, or refuse an unknown one and exit (REQ-4.7.18)."""
    from wavecore.api.services import log_level

    try:
        log_level.apply_startup_level()
    except ConfigValidationError as exc:
        _refuse_to_start(str(exc))


def _check_encryption_key() -> None:
    """Refuse to start when the secret encryption key is missing, malformed or the wrong one."""
    from wavecore.api.services.secret_seal_sweep import (
        EncryptionKeyMismatchError,
        verify_encryption_key,
    )
    from wavecore.core.secrets.key_provider import get_key_provider

    try:
        get_key_provider().get_key()
        verify_encryption_key()
    except (ValueError, EncryptionKeyMismatchError) as exc:
        _refuse_to_start(str(exc))


def _check_data_folder() -> None:
    """Refuse to start without a usable data folder, else name it (REQ-4.7.13)."""
    from wavecore.api.services import storage_paths

    try:
        folder = storage_paths.get_base_path()
    except ConfigValidationError as exc:
        _refuse_to_start(str(exc))
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        _refuse_to_start(f"Data folder {folder} cannot be created: {exc}")
    logger.info("Data folder: %s", folder)


@contextlib.asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Run the startup steps, serve, then run the shutdown steps."""
    await startup_event()
    try:
        yield
    finally:
        await shutdown_event()


_check_text_encoding()

# Create the FastAPI application instance
app = FastAPI(
    title="WAVE API",
    description="Workflow Automation and Validation Engine REST API",
    version="1.0.0",
    contact={
        "name": "WAVE",
        "email": "support@waveapp.dev",
        "url": "https://github.com/waveapphq/wave/issues",
    },
    license_info={"name": "MIT", "identifier": "MIT"},
    servers=[{"url": "/", "description": "This WAVE server"}],
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=_lifespan,
)

# CORS origins come from the configuration (REQ-5.2.3.3)
app_config = _load_config()
_apply_log_level()
cors_origins = app_config.security.cors_origins
cors_origin_regex = app_config.security.cors_origin_regex or None

# Added first, so its refusal gets the standard error body and a log line (REQ-4.6.9)
app.add_middleware(Utf8Guard)

# Added before CORS so error responses carry the CORS headers (REQ-5.2.3.4)
add_error_handling_middleware(app)

# Added after error handling so a failed request gets its log line too (REQ-5.2.3.5)
add_request_response_logging_middleware(app)

# Add CORS middleware with configuration-driven origins (REQ-5.2.3.3)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
    # Without this a browser hides both from JavaScript on cross-origin responses.
    expose_headers=["X-Request-ID", "X-Correlation-ID", "Content-Disposition"],
)

# Include API routers
app.include_router(health_router)
app.include_router(config_router)
app.include_router(artifacts_router)
app.include_router(openapi_router)
app.include_router(blocks_import_export_router)
app.include_router(blocks_version_router)
app.include_router(blocks_router)
app.include_router(tests_batch_router)
app.include_router(tests_import_export_router)
app.include_router(tests_version_router)
app.include_router(tests_lifecycle_router)
app.include_router(tests_testdata_router)
app.include_router(tests_router)
app.include_router(functions_import_export_router)
app.include_router(functions_run_router)
app.include_router(functions_router)
app.include_router(suites_batch_router)
app.include_router(suites_import_export_router)
app.include_router(suites_version_router)
app.include_router(suites_composition_router)
app.include_router(suites_router)
app.include_router(regressions_batch_router)
app.include_router(regressions_composition_router)
app.include_router(regressions_version_router)
app.include_router(regressions_import_export_router)
app.include_router(regressions_router)
app.include_router(variables_expression_router)
app.include_router(variables_router)
app.include_router(profiles_import_export_router)
app.include_router(profiles_router)
app.include_router(environments_import_export_router)
app.include_router(environments_router)
app.include_router(system_router)
app.include_router(executions_router)
app.include_router(reports_router)
app.include_router(dashboard_router)
app.include_router(admin_bulk_router)
app.include_router(admin_log_router)
app.include_router(admin_masking_router)
app.include_router(admin_router)
app.include_router(workbench_router)
app.include_router(python_tools_router)
app.include_router(sql_tools_router)
app.include_router(opensearch_tools_router)
app.include_router(backup_router)
app.include_router(mcp_router)
app.include_router(network_certificates_router)
app.include_router(network_proxy_router)
app.include_router(network_ssh_hosts_router)
app.include_router(server_router)


# Custom exception handler to convert validation errors to appropriate status codes
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Every validation error is 400, never FastAPI's 422."""
    errors = exc.errors()
    first_error = errors[0] if errors else {}
    error_msg = first_error.get("msg", "Validation error")
    error_loc = first_error.get("loc", [])
    field_name = error_loc[-1] if error_loc else "unknown"

    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "success": False,
            "error": {
                "message": f"Validation error for '{field_name}': {error_msg}",
                "code": "VALIDATION_ERROR",
            },
        },
    )


async def _cancel_liveness_tasks() -> None:
    """Cancel + drain liveness sweep tasks; tolerate a closed loop (per-test loops in tests)."""
    tasks = getattr(app.state, "liveness_tasks", None) or []
    for task in tasks:
        with contextlib.suppress(RuntimeError):
            task.cancel()
    for task in tasks:
        with contextlib.suppress(RuntimeError, asyncio.CancelledError):
            await task


async def _close_variable_push_service() -> None:
    """Cancel the pending variable pushes of the service in place, if one is."""
    service = getattr(app.state, "variable_push_service", None)
    if service is not None:
        await service.close()


async def startup_event() -> None:
    """Run the startup steps before WAVE takes requests."""
    # Must run after Uvicorn sets up its loggers
    from wavecore.core.logging.formatter import suppress_uvicorn_access_logs

    suppress_uvicorn_access_logs()

    logger.info("Config file: %s", get_config().config_file)
    _check_data_folder()

    # A blank CA trusts what Settings > Network > Certificates holds (REQ-4.5.16)
    from wavecore.api.services.network import certificates

    certificates.register_trust_resolver()

    # Web requests from the WAVE host follow Settings > Network > Proxy (REQ-4.7.14)
    from wavecore.api.services.network import proxy as network_proxy

    network_proxy.register_proxy_resolver()

    # Initialize WebSocket manager and register route
    from wavecore.api.websocket.manager import WebSocketManager, create_websocket_route

    ws_manager = WebSocketManager(enable_message_queue=True)
    create_websocket_route(app, ws_manager)

    # Store manager in app state for access from services
    app.state.ws_manager = ws_manager

    # Initialize VariablePushService for real-time variable updates (REQ-3.1.3.12)
    from wavecore.api.services.variable_push import VariablePushService

    await _close_variable_push_service()
    app.state.variable_push_service = VariablePushService(ws_manager)

    # Register all core controls (REQ-3.5.0.12)
    from wavecore.controls.registry import _registry, register_all_core_controls

    register_all_core_controls(_registry, freeze_after=False)

    # Register all plugins
    from wavecore.core.plugin_registry import register_plugin
    from wavecore.plugins import (
        CSVParserPlugin,
        ExcelParserPlugin,
        FileIOPlugin,
        HelmInstallPlugin,
        HelmRollbackPlugin,
        HelmStatusPlugin,
        HelmTestPlugin,
        HelmUninstallPlugin,
        HelmUpgradePlugin,
        HTTPClientPlugin,
        JSONParserPlugin,
        K8sApplyPlugin,
        K8sConnectPlugin,
        K8sCopyPlugin,
        K8sDeletePlugin,
        K8sEventsPlugin,
        K8sExecPlugin,
        K8sGetPlugin,
        K8sLogsPlugin,
        K8sRolloutPlugin,
        K8sScalePlugin,
        K8sScriptPlugin,
        K8sTopPlugin,
        LogPlugin,
        NetcatPlugin,
        OpenSearchPlugin,
        PingPlugin,
        PythonPlugin,
        SFTPPlugin,
        ShellExecPlugin,
        ShellScriptPlugin,
        SQLClientPlugin,
        SSHSessionClosePlugin,
        SSHSessionExecPlugin,
        SSHSessionOpenPlugin,
        SSHSessionScriptPlugin,
        SSHTunnelClosePlugin,
        SSHTunnelOpenPlugin,
        XMLParserPlugin,
    )

    plugin_classes: list[type] = [
        CSVParserPlugin,
        ExcelParserPlugin,
        FileIOPlugin,
        HelmInstallPlugin,
        HelmRollbackPlugin,
        HelmStatusPlugin,
        HelmTestPlugin,
        HelmUninstallPlugin,
        HelmUpgradePlugin,
        HTTPClientPlugin,
        JSONParserPlugin,
        K8sApplyPlugin,
        K8sConnectPlugin,
        K8sCopyPlugin,
        K8sDeletePlugin,
        K8sEventsPlugin,
        K8sExecPlugin,
        K8sGetPlugin,
        K8sLogsPlugin,
        K8sRolloutPlugin,
        K8sScalePlugin,
        K8sScriptPlugin,
        K8sTopPlugin,
        LogPlugin,
        NetcatPlugin,
        OpenSearchPlugin,
        PingPlugin,
        PythonPlugin,
        SFTPPlugin,
        ShellExecPlugin,
        ShellScriptPlugin,
        SQLClientPlugin,
        SSHSessionClosePlugin,
        SSHSessionExecPlugin,
        SSHSessionOpenPlugin,
        SSHSessionScriptPlugin,
        SSHTunnelClosePlugin,
        SSHTunnelOpenPlugin,
        XMLParserPlugin,
    ]
    for plugin_class in plugin_classes:
        register_plugin(plugin_class())

    # The key is checked before the sweep seals any stored plaintext
    from wavecore.api.services.secret_seal_sweep import run_seal_sweep

    _check_encryption_key()
    run_seal_sweep()

    # Eagerly load test cache so first request is fast
    from wavecore.api.services.tests.service import _reconcile_cache

    _reconcile_cache()

    # Workbench sessions live in memory, so their artifact dirs cannot outlive a restart.
    from wavecore.api.services.artifact_service import sweep_session_artifacts
    from wavecore.plugins._local_process_common import sweep_private_dirs

    sweep_session_artifacts()
    sweep_private_dirs()

    # Start periodic backup scheduler if enabled
    from wavecore.api.services.backup import scheduler as backup_scheduler

    await backup_scheduler.start_scheduler()

    # Start the MCP endpoint when persistently enabled
    from wavecore.mcp import server as mcp_server

    await mcp_server.reconcile()

    # Liveness sweeps: WS heartbeat pings + workbench ownership stale-holder release
    from wavecore.api.services.workbench import ownership

    await _cancel_liveness_tasks()
    app.state.liveness_tasks = [
        asyncio.create_task(ws_manager.run_heartbeat_loop()),
        asyncio.create_task(ws_manager.run_stale_cleanup_loop()),
        asyncio.create_task(ownership.run_stale_sweep_loop()),
    ]


async def shutdown_event() -> None:
    """Stop background work, end workbench sessions and close WebSocket connections."""
    # Stop periodic backup scheduler
    from wavecore.api.services.backup import scheduler as backup_scheduler

    await backup_scheduler.stop_scheduler()

    # Drop the kept backup uploads
    from wavecore.api.services.backup import uploads as backup_uploads

    backup_uploads.clear()

    # Stop the MCP endpoint listener
    from wavecore.mcp import server as mcp_server

    await mcp_server.stop()

    # Cancel all running workbench sessions
    from wavecore.api.services.workbench._common import _clear_sessions

    await _clear_sessions()

    # Stop the liveness sweep tasks
    await _cancel_liveness_tasks()
    app.state.liveness_tasks = None

    await _close_variable_push_service()

    # Close all WebSocket connections
    if hasattr(app.state, "ws_manager") and app.state.ws_manager is not None:
        await app.state.ws_manager.shutdown()
