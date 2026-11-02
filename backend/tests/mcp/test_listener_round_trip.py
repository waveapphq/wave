"""End-to-end MCP protocol round-trip on a real localhost listener.

Uses the official ``mcp`` python SDK client over streamable HTTP against the
listener started by wavecore.mcp.server on an ephemeral port: initialize,
list_tools, tool calls, session/activity bookkeeping (client name + ip from
the wire), Basic auth over the wire, and disconnect invalidation.
"""

import base64
from collections.abc import AsyncGenerator, Callable
from typing import Any

import httpx
import pytest

from tests.mcp.conftest import create_test_entity, free_port

pytestmark = pytest.mark.timeout(120)

CLIENT_NAME = "pytest-client"
CLIENT_VERSION = "1.2.3"

EXPECTED_TOOLS = {
    "list_blocks",
    "get_block",
    "list_functions",
    "get_function",
    "list_tests",
    "get_test",
    "list_suites",
    "get_suite",
    "list_regressions",
    "get_regression",
    "list_environments",
    "list_profiles",
    "list_variables",
    "list_executions",
    "start_execution",
    "get_execution",
    "get_failure_report",
    "get_run_report",
    "get_recipe_guide",
    "validate_recipe",
    "create_test_from_recipe",
    "list_testdata",
    "write_testdata",
    "create_testdata_folder",
    "rename_testdata",
    "delete_testdata",
}

INITIALIZE_BODY = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": CLIENT_NAME, "version": CLIENT_VERSION},
    },
}


@pytest.fixture
async def running_endpoint(
    seed_registries: None, clear_execution_state: None
) -> AsyncGenerator[str, None]:
    from wavecore.mcp import server as mcp_server
    from wavecore.mcp import settings as mcp_settings
    from wavecore.mcp import state as mcp_state

    port = free_port()
    mcp_settings.update_settings(port=port)
    mcp_state.set_until_restart(True)
    await mcp_server.start()
    assert mcp_server.is_running() is True
    yield f"http://127.0.0.1:{port}/mcp"
    await mcp_server.stop()


def _client_session(url: str, headers: dict[str, str] | None = None) -> Any:
    """Async context manager yielding an initialized ClientSession + session-id getter."""
    from contextlib import asynccontextmanager

    import httpx2
    from mcp import ClientSession, types
    from mcp.client.streamable_http import streamable_http_client

    @asynccontextmanager
    async def _cm() -> Any:
        captured: dict[str, str] = {}

        async def _capture(response: httpx2.Response) -> None:
            session_id = response.headers.get("mcp-session-id")
            if session_id:
                captured["session_id"] = session_id

        async with httpx2.AsyncClient(
            headers=headers, event_hooks={"response": [_capture]}
        ) as http_client:
            async with streamable_http_client(url, http_client=http_client) as (
                read_stream,
                write_stream,
            ):
                async with ClientSession(
                    read_stream,
                    write_stream,
                    client_info=types.Implementation(name=CLIENT_NAME, version=CLIENT_VERSION),
                ) as session:
                    await session.initialize()
                    yield session, lambda: captured.get("session_id")

    return _cm()


class TestProtocolRoundTrip:
    async def test_initialize_and_list_tools(self, running_endpoint: str) -> None:
        async with _client_session(running_endpoint) as (session, _get_session_id):
            result = await session.list_tools()

        tool_names = {tool.name for tool in result.tools}
        assert EXPECTED_TOOLS.issubset(tool_names)

    async def test_initialize_registers_the_session_with_client_and_ip(
        self, running_endpoint: str
    ) -> None:
        from wavecore.mcp import state as mcp_state

        async with _client_session(running_endpoint) as (_session, get_session_id):
            sessions = mcp_state.list_sessions()
            assert len(sessions) == 1
            row = sessions[0]
            assert row["client"] == CLIENT_NAME
            assert row["client_version"] == CLIENT_VERSION
            assert row["ip"] == "127.0.0.1"
            assert row["session_id"] == get_session_id()

    async def test_tool_call_succeeds_and_records_activity(self, running_endpoint: str) -> None:
        from wavecore.mcp import state as mcp_state

        async with _client_session(running_endpoint) as (session, _get_session_id):
            result = await session.call_tool("list_environments", {})

        assert result.is_error is False
        activity = mcp_state.get_activity()
        assert activity[0]["tool"] == "list_environments"
        assert activity[0]["client"] == CLIENT_NAME

    async def test_start_execution_attributes_the_wire_client(
        self, running_endpoint: str, mock_workbench_start: Any
    ) -> None:
        from wavecore.api.services.executions import _storage as exec_storage
        from wavecore.mcp import state as mcp_state

        test = create_test_entity("Wire Attribution")

        async with _client_session(running_endpoint) as (session, _get_session_id):
            result = await session.call_tool(
                "start_execution",
                {
                    "entity_type": "test",
                    "ref": test["id"],
                    "environment": "Test Environment",
                },
            )

        assert result.is_error is False
        executions = list(exec_storage._execution_storage.values())
        assert len(executions) == 1
        assert executions[0]["triggered_by"] == f"mcp:{CLIENT_NAME}"
        assert mcp_state.get_activity()[0]["tool"] == "start_execution"


class TestRequestPlumbing:
    async def test_malformed_json_post_gets_a_parse_error_not_a_crash(
        self, running_endpoint: str
    ) -> None:
        async with httpx.AsyncClient() as http:
            response = await http.post(
                running_endpoint,
                content=b"{not json",
                headers={
                    "Accept": "application/json, text/event-stream",
                    "Content-Type": "application/json",
                },
            )

        assert response.status_code == 400

    async def test_buffer_body_replays_a_disconnect_first_stream(self) -> None:
        from wavecore.api.middleware import utf8_guard

        events: list[dict[str, Any]] = [{"type": "http.disconnect"}]

        async def receive() -> dict[str, Any]:
            return events.pop(0)

        body, replay = await utf8_guard.buffer_body(receive)

        assert body == b""
        assert await replay() == {"type": "http.disconnect"}


class TestBasicAuthOverTheWire:
    @pytest.fixture
    async def auth_endpoint(self, seed_registries: None) -> AsyncGenerator[str, None]:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(
            port=port,
            auth_enabled=True,
            auth_username="ops",
            auth_password="hunter2-secret",
        )
        mcp_state.set_until_restart(True)
        await mcp_server.start()
        assert mcp_server.is_running() is True
        yield f"http://127.0.0.1:{port}/mcp"
        await mcp_server.stop()

    async def test_missing_credentials_get_401_with_challenge(self, auth_endpoint: str) -> None:
        async with httpx.AsyncClient() as http:
            response = await http.post(
                auth_endpoint,
                json=INITIALIZE_BODY,
                headers={"Accept": "application/json, text/event-stream"},
            )

        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == 'Basic realm="WAVE MCP"'

    async def test_correct_credentials_complete_the_handshake(self, auth_endpoint: str) -> None:
        token = base64.b64encode(b"ops:hunter2-secret").decode()

        async with _client_session(auth_endpoint, headers={"Authorization": f"Basic {token}"}) as (
            session,
            _get_session_id,
        ):
            result = await session.list_tools()

        assert EXPECTED_TOOLS.issubset({tool.name for tool in result.tools})


class TestEndpointFromTheConfigFile:
    @pytest.fixture
    async def config_file_endpoint(
        self, seed_registries: None, load_config: Callable[..., Any]
    ) -> AsyncGenerator[str, None]:
        from wavecore.core.secrets.sealing import seal_value
        from wavecore.mcp import server as mcp_server

        port = free_port()
        load_config(
            {
                "mcp": {
                    "enabled": True,
                    "port": port,
                    "auth_enabled": True,
                    "auth_username": "ops",
                    "auth_password": seal_value("hunter2-secret"),
                }
            }
        )
        await mcp_server.reconcile()
        yield f"http://127.0.0.1:{port}/mcp"
        await mcp_server.stop()

    @pytest.fixture
    async def stop_listener(self) -> AsyncGenerator[None, None]:
        from wavecore.mcp import server as mcp_server

        yield
        await mcp_server.stop()

    async def test_listener_runs_on_the_port_in_the_config_file(
        self, config_file_endpoint: str
    ) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import state as mcp_state

        assert mcp_server.is_running() is True
        assert mcp_state.is_until_restart() is False
        assert mcp_server.get_status()["urls"] == [config_file_endpoint]

    async def test_sealed_password_in_the_config_file_guards_the_wire(
        self, config_file_endpoint: str
    ) -> None:
        from wavecore.mcp import server as mcp_server

        assert mcp_server.is_running() is True
        async with httpx.AsyncClient() as http:
            response = await http.post(
                config_file_endpoint,
                json=INITIALIZE_BODY,
                headers={"Accept": "application/json, text/event-stream"},
            )
        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == 'Basic realm="WAVE MCP"'

        token = base64.b64encode(b"ops:hunter2-secret").decode()
        async with _client_session(
            config_file_endpoint, headers={"Authorization": f"Basic {token}"}
        ) as (session, _get_session_id):
            result = await session.list_tools()

        assert EXPECTED_TOOLS.issubset({tool.name for tool in result.tools})

    async def test_saved_endpoint_serves_again_after_a_restart(
        self, seed_registries: None, stop_listener: None, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        port = free_port()
        mcp_settings.update_settings(
            enabled=True,
            port=port,
            auth_enabled=True,
            auth_username="ops",
            auth_password="hunter2-secret",
        )
        load_config()
        await mcp_server.reconcile()
        assert mcp_server.is_running() is True
        token = base64.b64encode(b"ops:hunter2-secret").decode()

        async with _client_session(
            f"http://127.0.0.1:{port}/mcp", headers={"Authorization": f"Basic {token}"}
        ) as (session, _get_session_id):
            result = await session.list_tools()

        assert EXPECTED_TOOLS.issubset({tool.name for tool in result.tools})


class TestAuthorToolsOverTheWire:
    async def test_create_test_from_recipe_round_trip(self, running_endpoint: str) -> None:
        import json

        from wavecore.api.services.tests import service as test_service

        recipe = (
            "test:\n"
            "  name: Wire Recipe Test\n"
            "flow:\n"
            "  - block: log\n"
            "    settings:\n"
            "      message: created over the wire\n"
        )

        async with _client_session(running_endpoint) as (session, _get_session_id):
            result = await session.call_tool("create_test_from_recipe", {"recipe": recipe})

        assert result.is_error is False
        payload = json.loads(result.content[0].text)
        assert payload["created"] is True
        assert payload["name"] == "Wire Recipe Test"
        assert payload["version"] == "1.0.0"

        stored = test_service.get_test(payload["test_id"])
        assert stored is not None
        assert stored["name"] == "Wire Recipe Test"
        assert len(stored["workflow"]["nodes"]) == 1

    async def test_validate_recipe_reports_findings_over_the_wire(
        self, running_endpoint: str
    ) -> None:
        import json

        recipe = "test:\n  name: Wire Invalid\nflow:\n  - block: no-such-block\n"

        async with _client_session(running_endpoint) as (session, _get_session_id):
            result = await session.call_tool("validate_recipe", {"recipe": recipe})

        assert result.is_error is False
        payload = json.loads(result.content[0].text)
        assert payload["valid"] is False
        assert [f["code"] for f in payload["findings"]] == ["UNKNOWN_BLOCK"]


class TestDisconnect:
    async def test_closed_session_is_rejected_on_next_request(self, running_endpoint: str) -> None:
        import anyio
        from mcp.shared.exceptions import MCPError

        from wavecore.mcp import state as mcp_state

        async with _client_session(running_endpoint) as (session, get_session_id):
            first = await session.call_tool("list_environments", {})
            assert first.is_error is False

            session_id = get_session_id()
            assert mcp_state.close_session(session_id) is True

            with pytest.raises(
                (
                    MCPError,
                    httpx.HTTPError,
                    anyio.ClosedResourceError,
                    anyio.BrokenResourceError,
                    TimeoutError,
                )
            ):
                await session.call_tool("list_environments", {})


class TestAutoNegotiationFallback:
    async def test_modern_client_falls_back_and_registers_a_session(
        self, running_endpoint: str
    ) -> None:
        from mcp import types
        from mcp.client import Client
        from mcp_types.version import HANDSHAKE_PROTOCOL_VERSIONS

        from wavecore.mcp import state as mcp_state

        async with Client(
            running_endpoint,
            client_info=types.Implementation(name=CLIENT_NAME, version=CLIENT_VERSION),
        ) as client:
            assert client.protocol_version in HANDSHAKE_PROTOCOL_VERSIONS
            result = await client.call_tool("list_environments", {})
            assert result.is_error is False

            sessions = mcp_state.list_sessions()
            assert len(sessions) == 1
            assert sessions[0]["client"] == CLIENT_NAME
            assert sessions[0]["client_version"] == CLIENT_VERSION
            assert sessions[0]["ip"] == "127.0.0.1"

        activity = mcp_state.get_activity()
        assert activity[0]["tool"] == "list_environments"
        assert activity[0]["client"] == CLIENT_NAME
