"""MCP endpoint assembly and listener lifecycle.

The endpoint is a second in-process uvicorn server on its own port hosting the
official SDK's streamable-HTTP app. An ASGI wrapper enforces optional Basic
auth, refuses sessionless protocol revisions, rejects disconnected sessions,
and feeds the sessions/activity registry.
"""

import asyncio
import base64
import contextlib
import functools
import hmac
import inspect
import json
import logging
import socket
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

import psutil
import uvicorn
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp_types.version import HANDSHAKE_PROTOCOL_VERSIONS

from wavecore.api.exceptions import ValidationException
from wavecore.api.middleware.utf8_guard import buffer_body, refusal
from wavecore.mcp import settings as mcp_settings
from wavecore.mcp import state as mcp_state
from wavecore.mcp.tools import author, discover, organize, report, watch
from wavecore.mcp.tools import run as run_tools
from wavecore.mcp.tools import secrets as secret_tools
from wavecore.mcp.tools import testdata as testdata_tools

logger = logging.getLogger(__name__)

_Scope = MutableMapping[str, Any]
_Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
_Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]

_WWW_AUTHENTICATE = 'Basic realm="WAVE MCP"'
_SESSION_ID_HEADER = "mcp-session-id"
_PROTOCOL_VERSION_HEADER = "mcp-protocol-version"
_RESPONSE_START = "http.response.start"
_SHUTDOWN_GRACE_SECONDS = 3


def _rejection(message: str) -> dict[str, Any]:
    """A refusal in the JSON-RPC error shape a pre-2.0 server answers with."""
    return {"jsonrpc": "2.0", "id": "server-error", "error": {"code": -32600, "message": message}}


_SESSIONLESS_REJECTION = _rejection("Bad Request: Missing session ID")

_listener_task: asyncio.Task[None] | None = None
_listener_server: uvicorn.Server | None = None
_active_config: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Effective state / status
# ---------------------------------------------------------------------------


def effective_enabled() -> bool:
    """Persisted enable OR the runtime until-restart flag."""
    return bool(mcp_settings.get_settings()["enabled"]) or mcp_state.is_until_restart()


def is_running() -> bool:
    """True while the listener task is alive."""
    return _listener_task is not None and not _listener_task.done()


def _machine_hosts(bind: str) -> list[str]:
    """Concrete IPv4 hosts the endpoint is reachable on, loopback first.

    Numeric IPv4 only: the listener binds IPv4, and 'localhost' may resolve
    to ::1 where nothing is listening.
    """
    hosts = ["127.0.0.1"]
    if bind != "network":
        return hosts
    for addresses in psutil.net_if_addrs().values():
        for address in addresses:
            if address.family != socket.AF_INET or address.address.startswith("127."):
                continue
            if address.address not in hosts:
                hosts.append(address.address)
    return hosts


def get_status() -> dict[str, Any]:
    """Aggregate status for the System Config section (reachable-address list)."""
    settings = mcp_settings.get_settings()
    running = is_running()
    port = settings["port"]
    if running:
        urls = [f"http://{host}:{port}/mcp" for host in _machine_hosts(settings["bind"])]
    else:
        urls = []
    sessions = mcp_state.list_sessions()
    return {
        "running": running,
        "enabled": bool(settings["enabled"]),
        "until_restart_active": mcp_state.is_until_restart(),
        "port": port,
        "bind": settings["bind"],
        "urls": urls,
        "connected_clients": len(sessions),
        "sessions": sessions,
        "recent_activity": mcp_state.get_activity(),
        "last_error": mcp_state.get_last_error(),
    }


# ---------------------------------------------------------------------------
# App assembly
# ---------------------------------------------------------------------------


def _client_name_from(ctx: Context | None) -> str | None:
    """The calling session's clientInfo name from the injected tool context."""
    if ctx is None:
        return None
    try:
        params = ctx.session.client_params
    except ValueError:
        return None
    if params is None or params.client_info is None:
        return None
    return str(params.client_info.name)


def _session_id_from(ctx: Context | None) -> str | None:
    """The calling session's mcp-session-id from the injected tool context."""
    if ctx is None:
        return None
    try:
        headers = ctx.headers
    except ValueError:
        return None
    if headers is None:
        return None
    session_id = headers.get(_SESSION_ID_HEADER)
    return str(session_id) if session_id else None


def _create_test_from_recipe_tool(recipe: str, ctx: Context | None = None) -> dict[str, Any]:
    """Compile and persist through the strict create pipeline, or create nothing."""
    return author.run_held_write(
        _session_id_from(ctx),
        "created",
        lambda: author.create_test_from_recipe(recipe),
    )


def _amend_test_from_recipe_tool(
    test_ref: str, recipe: str, ctx: Context | None = None
) -> dict[str, Any]:
    """Recompile a fully-expressible test from a revised recipe, or amend nothing."""
    return author.run_held_write(
        _session_id_from(ctx),
        "amended",
        lambda: author.amend_test_from_recipe(test_ref, recipe),
    )


async def _build_test_from_recipe_tool(recipe: str, ctx: Context | None = None) -> dict[str, Any]:
    """Build a test live through the workbench session, revealing it step by step."""
    return await watch.build_test_from_recipe(recipe, session_id=_session_id_from(ctx))


def _start_execution_tool(
    entity_type: str,
    ref: str,
    environment: str,
    profile: str | None = None,
    variables: dict[str, Any] | None = None,
    ctx: Context | None = None,
) -> dict[str, Any]:
    """Start a test, suite, or regression execution attributed to this client."""
    return run_tools.start_execution(
        entity_type,
        ref,
        environment,
        profile=profile,
        variables=variables,
        client_name=_client_name_from(ctx),
        session_id=_session_id_from(ctx),
    )


def _on_loop(handler: Callable[..., Any]) -> Callable[..., Awaitable[Any]]:
    """Async pass-through keeping sync tools on the event loop, off SDK worker threads."""

    @functools.wraps(handler)
    async def adapter(**kwargs: Any) -> Any:
        result = handler(**kwargs)
        if inspect.isawaitable(result):
            return await result
        return result

    return adapter


def _register_tools(server: MCPServer) -> None:
    handlers = (
        discover.list_blocks,
        discover.get_block,
        discover.list_functions,
        discover.get_function,
        discover.list_tests,
        discover.get_test,
        discover.list_testdata,
        discover.list_suites,
        discover.get_suite,
        discover.list_regressions,
        discover.get_regression,
        discover.list_environments,
        discover.list_profiles,
        discover.list_variables,
        discover.list_executions,
        run_tools.get_execution,
        report.get_failure_report,
        report.get_run_report,
        author.get_recipe_guide,
        author.validate_recipe,
        author.get_test_recipe,
        organize.create_suite,
        organize.update_suite,
        organize.create_regression,
        organize.update_regression,
        organize.create_profile,
        organize.update_profile,
        organize.update_variables,
        testdata_tools.write_testdata,
        testdata_tools.create_testdata_folder,
        testdata_tools.rename_testdata,
        testdata_tools.delete_testdata,
        secret_tools.reveal_secret,
    )
    for handler in handlers:
        server.add_tool(_on_loop(handler), structured_output=False)
    server.add_tool(
        _on_loop(_start_execution_tool), name="start_execution", structured_output=False
    )
    server.add_tool(
        _on_loop(_create_test_from_recipe_tool),
        name="create_test_from_recipe",
        structured_output=False,
    )
    server.add_tool(
        _on_loop(_amend_test_from_recipe_tool),
        name="amend_test_from_recipe",
        structured_output=False,
    )
    server.add_tool(
        _build_test_from_recipe_tool, name="build_test_from_recipe", structured_output=False
    )


def build_mcp_app() -> Any:
    """The MCP endpoint ASGI app: SDK server + tools + auth/session wrapper."""
    settings = mcp_settings.get_settings()
    server = MCPServer(name="WAVE")
    _register_tools(server)
    auth_enabled = bool(settings["auth_enabled"])
    password = mcp_settings.get_unsealed_password() if auth_enabled else None
    # Host-header (DNS-rebinding) validation off: it rejects network-bind and
    # hostname access; the endpoint's protection layer is the Basic auth below.
    return _McpEndpointApp(
        server.streamable_http_app(
            transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)
        ),
        auth_enabled=auth_enabled,
        username=str(settings["auth_username"] or ""),
        password=password or "",
    )


class _McpEndpointApp:
    """ASGI wrapper: Basic auth, sessionless refusal, closed-session rejection, registry hooks."""

    def __init__(self, app: Any, *, auth_enabled: bool, username: str, password: str) -> None:
        self._app = app
        self._auth_enabled = auth_enabled
        self._username = username.encode()
        self._password = password.encode()

    async def __call__(self, scope: _Scope, receive: _Receive, send: _Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers") or []
        }

        if self._auth_enabled and not self._authorized(headers.get("authorization")):
            await _send_json(
                send,
                401,
                {"error": "Unauthorized"},
                extra_headers=[(b"www-authenticate", _WWW_AUTHENTICATE.encode())],
            )
            return

        protocol_version = headers.get(_PROTOCOL_VERSION_HEADER)
        if protocol_version and protocol_version not in HANDSHAKE_PROTOCOL_VERSIONS:
            # Identity is session-based; the pre-2.0 rejection makes clients fall back.
            await _send_json(send, 400, _SESSIONLESS_REJECTION)
            return

        session_id = headers.get(_SESSION_ID_HEADER)
        if session_id and mcp_state.is_session_closed(session_id):
            await _send_json(send, 404, {"error": "Session terminated"})
            return

        wrapped_receive = receive
        message: dict[str, Any] | None = None
        if scope.get("method") == "POST":
            body, wrapped_receive = await buffer_body(receive)
            refused = refusal(body)
            if refused is not None:
                await _send_json(send, 422, _rejection(refused))
                return
            message = _parse_json_rpc(body)

        wrapped_send = _session_tracking_send(send, scope, message, session_id)
        await self._app(scope, wrapped_receive, wrapped_send)

    def _authorized(self, header: str | None) -> bool:
        if not header or not header.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(header[len("Basic ") :], validate=True)
        except (ValueError, TypeError):
            return False
        username, sep, password = decoded.partition(b":")
        if not sep:
            return False
        username_ok = hmac.compare_digest(username, self._username)
        password_ok = hmac.compare_digest(password, self._password)
        return username_ok and password_ok


def _session_tracking_send(
    send: _Send,
    scope: _Scope,
    message: dict[str, Any] | None,
    session_id: str | None,
) -> _Send:
    """Pick the send wrapper that keeps the sessions/activity registry current."""
    if message is not None:
        method = message.get("method")
        if method == "tools/call" and session_id:
            tool = (message.get("params") or {}).get("name") or ""
            mcp_state.touch_session(session_id, str(tool))
        elif method == "initialize":
            client_info = (message.get("params") or {}).get("clientInfo") or {}
            client_host = (scope.get("client") or ("", 0))[0]
            return _registering_send(send, client_info, str(client_host or ""))
    elif scope.get("method") == "DELETE" and session_id:
        # Client-initiated session termination: drop the registry row.
        return _closing_send(send, session_id)
    return send


def _parse_json_rpc(body: bytes) -> dict[str, Any] | None:
    try:
        parsed = json.loads(body)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _registering_send(send: _Send, client_info: dict[str, Any], ip: str) -> _Send:
    """Register the session when the initialize response carries a session id."""

    async def wrapped(event: MutableMapping[str, Any]) -> None:
        if event["type"] == _RESPONSE_START and 200 <= event["status"] < 300:
            for key, value in event.get("headers") or []:
                if key.decode("latin-1").lower() == _SESSION_ID_HEADER:
                    mcp_state.register_session(
                        value.decode("latin-1"),
                        str(client_info.get("name") or "client"),
                        str(client_info.get("version") or ""),
                        ip,
                    )
                    break
        await send(event)

    return wrapped


def _closing_send(send: _Send, session_id: str) -> _Send:
    """Remove the session from the registry when its termination succeeds."""

    async def wrapped(event: MutableMapping[str, Any]) -> None:
        if event["type"] == _RESPONSE_START and 200 <= event["status"] < 300:
            mcp_state.close_session(session_id)
        await send(event)

    return wrapped


async def _send_json(
    send: _Send,
    status: int,
    payload: dict[str, Any],
    extra_headers: list[tuple[bytes, bytes]] | None = None,
) -> None:
    body = json.dumps(payload).encode()
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode()),
    ]
    headers.extend(extra_headers or [])
    await send({"type": _RESPONSE_START, "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


# ---------------------------------------------------------------------------
# Listener lifecycle
# ---------------------------------------------------------------------------


def ensure_port_available(prospective: dict[str, Any], *, until_restart: bool) -> None:
    """Reject a prospective config whose port cannot be bound (apply-time check)."""
    if not (bool(prospective["enabled"]) or until_restart):
        return
    port = int(prospective["port"])
    active = _active_config if is_running() else None
    if active is not None and int(active["port"]) == port:
        return  # this listener holds the port; a restart rebinds it
    host = "127.0.0.1" if prospective["bind"] == "local" else "0.0.0.0"
    try:
        _bind_socket(host, port).close()
    except OSError as exc:
        raise ValidationException(f"Port {port} is already in use") from exc


def _bind_socket(host: str, port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((host, port))
        sock.listen(128)
    except OSError:
        sock.close()
        raise
    sock.set_inheritable(True)
    return sock


async def _run_listener(server: uvicorn.Server, sock: socket.socket) -> None:
    try:
        await server.main_loop()
        await server.shutdown(sockets=[sock])
    except asyncio.CancelledError:
        with contextlib.suppress(OSError):
            sock.close()
        raise


async def start() -> None:
    """Start the listener per current settings; bind failures set last_error."""
    global _listener_task, _listener_server, _active_config
    await stop()
    mcp_state.set_last_error(None)
    settings = mcp_settings.get_settings()
    host = "127.0.0.1" if settings["bind"] == "local" else "0.0.0.0"
    port = int(settings["port"])

    try:
        sock = _bind_socket(host, port)
    except OSError as exc:
        mcp_state.set_last_error(str(exc))
        logger.error("MCP listener failed to bind %s:%s: %s", host, port, exc)
        return

    config = uvicorn.Config(
        build_mcp_app(),
        host=host,
        port=port,
        log_config=None,
        access_log=False,
        lifespan="on",
        timeout_graceful_shutdown=_SHUTDOWN_GRACE_SECONDS,
    )
    server = uvicorn.Server(config)
    config.load()
    server.lifespan = config.lifespan_class(config)
    try:
        await server.startup(sockets=[sock])
    except Exception as exc:  # noqa: BLE001 - surface any startup failure as state
        mcp_state.set_last_error(str(exc))
        with contextlib.suppress(OSError):
            sock.close()
        return
    if server.should_exit:
        mcp_state.set_last_error("MCP listener failed to start")
        with contextlib.suppress(OSError):
            sock.close()
        return

    _listener_server = server
    _listener_task = asyncio.create_task(_run_listener(server, sock))
    _active_config = _config_snapshot(settings)
    logger.info("MCP endpoint listening on %s:%s", host, port)


async def stop() -> None:
    """Stop the listener if running; always clears the sessions registry."""
    global _listener_task, _listener_server, _active_config
    task = _listener_task
    server = _listener_server
    _listener_task = None
    _listener_server = None
    _active_config = None
    if task is not None and not task.done() and server is not None:
        server.should_exit = True
        try:
            await asyncio.wait_for(task, timeout=_SHUTDOWN_GRACE_SECONDS + 2)
        except (TimeoutError, asyncio.CancelledError):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    mcp_state.clear_sessions()


async def restart() -> None:
    """Stop then start with the current settings."""
    await stop()
    await start()


async def reconcile() -> None:
    """Bring the listener in line with effective enablement + current settings."""
    if not effective_enabled():
        await stop()
        return
    if not is_running():
        await start()
        return
    if _active_config != _config_snapshot(mcp_settings.get_settings()):
        await restart()


def _config_snapshot(settings: dict[str, Any]) -> dict[str, Any]:
    return {
        key: settings[key]
        for key in ("port", "bind", "auth_enabled", "auth_username", "auth_password")
    }
