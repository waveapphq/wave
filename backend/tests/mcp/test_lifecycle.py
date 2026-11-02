"""MCP listener lifecycle + runtime state contract.

Covers wavecore.mcp.server (effective_enabled, start/stop/restart/reconcile,
bind-failure surfacing, status aggregation incl. the URL rule) and
wavecore.mcp.state (until-restart flag, sessions registry, activity ring
buffer, last_error).
"""

import asyncio
import contextlib
import re
import socket
from collections import namedtuple
from collections.abc import AsyncGenerator, Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import uvicorn

from tests.mcp.conftest import free_port, port_is_open

pytestmark = pytest.mark.timeout(60)

STATUS_KEYS = {
    "running",
    "enabled",
    "until_restart_active",
    "port",
    "bind",
    "urls",
    "connected_clients",
    "sessions",
    "recent_activity",
    "last_error",
}


@pytest.fixture(autouse=True)
async def stop_listener_after_test() -> AsyncGenerator[None, None]:
    yield
    with contextlib.suppress(ImportError):
        from wavecore.mcp import server as mcp_server

        await mcp_server.stop()


class TestEffectiveEnabled:
    async def test_disabled_by_default(self) -> None:
        from wavecore.mcp import server as mcp_server

        assert mcp_server.effective_enabled() is False

    async def test_persisted_enabled_alone(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(enabled=True)
        assert mcp_server.effective_enabled() is True

    async def test_until_restart_flag_alone(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import state as mcp_state

        mcp_state.set_until_restart(True)
        assert mcp_server.effective_enabled() is True

    async def test_both_sources_enabled(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        mcp_settings.update_settings(enabled=True)
        mcp_state.set_until_restart(True)
        assert mcp_server.effective_enabled() is True

    async def test_until_restart_flag_is_never_persisted(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        mcp_state.set_until_restart(True)
        mcp_settings.update_settings(port=9001)

        assert mcp_settings.get_settings()["enabled"] is False
        assert config_on_disk()["mcp"] == {"port": 9001}
        assert "until_restart" not in config_file.read_text(encoding="utf-8")

    async def test_enabled_in_the_config_file_alone(self, load_config: Callable[..., Any]) -> None:
        from wavecore.mcp import server as mcp_server

        load_config({"mcp": {"enabled": True}})

        assert mcp_server.effective_enabled() is True

    async def test_until_restart_flag_is_not_read_from_the_config_file(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import state as mcp_state

        load_config({"mcp": {"until_restart": True}})

        assert mcp_state.is_until_restart() is False
        assert mcp_server.effective_enabled() is False


class TestRuntimeState:
    async def test_register_and_list_sessions(self) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "192.0.2.7")

        sessions = mcp_state.list_sessions()
        assert len(sessions) == 1
        row = sessions[0]
        assert set(row.keys()) == {
            "session_id",
            "client",
            "client_version",
            "ip",
            "connected_at",
            "last_activity",
        }
        assert row["session_id"] == "sess-1"
        assert row["client"] == "claude-code"
        assert row["client_version"] == "2.1.0"
        assert row["ip"] == "192.0.2.7"
        assert isinstance(row["connected_at"], str)

    async def test_touch_session_records_activity(self) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "127.0.0.1")
        mcp_state.touch_session("sess-1", "list_blocks")

        activity = mcp_state.get_activity()
        assert len(activity) == 1
        entry = activity[0]
        assert set(entry.keys()) == {"timestamp", "client", "tool"}
        assert entry["client"] == "claude-code"
        assert entry["tool"] == "list_blocks"

    async def test_activity_is_newest_first_and_capped_at_50(self) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "127.0.0.1")
        for index in range(55):
            mcp_state.touch_session("sess-1", f"tool-{index}")

        activity = mcp_state.get_activity()
        assert len(activity) == 50
        assert activity[0]["tool"] == "tool-54"
        assert activity[-1]["tool"] == "tool-5"

    async def test_close_session_invalidates_and_reports_unknown(self) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "127.0.0.1")

        assert mcp_state.close_session("sess-1") is True
        assert mcp_state.is_session_closed("sess-1") is True
        assert mcp_state.list_sessions() == []
        assert mcp_state.close_session("ghost") is False

    async def test_clear_sessions_empties_registry(self) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "127.0.0.1")
        mcp_state.register_session("sess-2", "inspector", "1.0.0", "127.0.0.1")

        mcp_state.clear_sessions()

        assert mcp_state.list_sessions() == []

    async def test_clear_activity_empties_feed(self) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "127.0.0.1")
        mcp_state.touch_session("sess-1", "list_blocks")

        mcp_state.clear_activity()

        assert mcp_state.get_activity() == []

    async def test_last_error_round_trip(self) -> None:
        from wavecore.mcp import state as mcp_state

        assert mcp_state.get_last_error() is None
        mcp_state.set_last_error("Port already in use")
        assert mcp_state.get_last_error() == "Port already in use"
        mcp_state.set_last_error(None)
        assert mcp_state.get_last_error() is None


class TestListenerLifecycle:
    async def test_start_serves_and_stop_releases_the_port(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(port=port)
        mcp_state.set_until_restart(True)

        await mcp_server.start()
        assert mcp_server.is_running() is True
        assert port_is_open(port)

        await mcp_server.stop()
        assert mcp_server.is_running() is False
        assert not port_is_open(port)

    async def test_stop_when_not_running_is_a_no_op(self) -> None:
        from wavecore.mcp import server as mcp_server

        await mcp_server.stop()
        assert mcp_server.is_running() is False

    async def test_start_clears_previous_last_error(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        mcp_settings.update_settings(port=free_port())
        mcp_state.set_last_error("previous failure")

        await mcp_server.start()

        assert mcp_state.get_last_error() is None

    async def test_bind_failure_records_error_without_raising(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        occupied_port = blocker.getsockname()[1]
        try:
            mcp_settings.update_settings(port=occupied_port)

            await mcp_server.start()

            assert mcp_server.is_running() is False
            error = mcp_state.get_last_error()
            assert error
        finally:
            blocker.close()

    async def test_stop_clears_sessions(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        mcp_settings.update_settings(port=free_port())
        await mcp_server.start()
        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "127.0.0.1")

        await mcp_server.stop()

        assert mcp_state.list_sessions() == []

    async def test_uvicorn_startup_failure_records_error_and_releases_the_port(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(port=port)

        with patch.object(
            uvicorn.Server, "startup", AsyncMock(side_effect=RuntimeError("startup boom"))
        ):
            await mcp_server.start()

        assert mcp_server.is_running() is False
        assert mcp_state.get_last_error() == "startup boom"
        assert not port_is_open(port)

    async def test_uvicorn_should_exit_records_error_and_releases_the_port(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(port=port)

        async def startup_flags_exit(self: uvicorn.Server, sockets: Any = None) -> None:
            self.should_exit = True

        with patch.object(uvicorn.Server, "startup", startup_flags_exit):
            await mcp_server.start()

        assert mcp_server.is_running() is False
        assert mcp_state.get_last_error() == "MCP listener failed to start"
        assert not port_is_open(port)

    async def test_canceled_listener_task_closes_its_socket(self) -> None:
        from wavecore.mcp import server as mcp_server

        sock = mcp_server._bind_socket("127.0.0.1", free_port())
        entered = asyncio.Event()

        async def hang_forever() -> None:
            entered.set()
            await asyncio.Event().wait()

        task = asyncio.create_task(
            mcp_server._run_listener(SimpleNamespace(main_loop=hang_forever), sock)
        )
        await entered.wait()

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert sock.fileno() == -1

    async def test_stop_cancels_a_listener_that_outlives_the_grace_period(self) -> None:
        from wavecore.mcp import server as mcp_server

        async def never_exits() -> None:
            await asyncio.Event().wait()

        task = asyncio.create_task(never_exits())
        mcp_server._listener_task = task
        mcp_server._listener_server = SimpleNamespace(should_exit=False)

        with patch.object(mcp_server, "_SHUTDOWN_GRACE_SECONDS", -2):
            await mcp_server.stop()

        assert task.cancelled()
        assert mcp_server.is_running() is False

    async def test_restart_moves_the_listener_to_the_new_port(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port_a = free_port()
        mcp_settings.update_settings(port=port_a)
        mcp_state.set_until_restart(True)
        await mcp_server.start()
        assert port_is_open(port_a)

        port_b = free_port()
        mcp_settings.update_settings(port=port_b)
        await mcp_server.restart()

        assert mcp_server.is_running() is True
        assert port_is_open(port_b)
        assert not port_is_open(port_a)


class TestReconcile:
    async def test_reconcile_keeps_disabled_listener_stopped(self) -> None:
        from wavecore.mcp import server as mcp_server

        await mcp_server.reconcile()
        assert mcp_server.is_running() is False

    async def test_reconcile_starts_when_effective_enabled(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(port=port)
        mcp_state.set_until_restart(True)

        await mcp_server.reconcile()

        assert mcp_server.is_running() is True
        assert port_is_open(port)

    async def test_reconcile_stops_when_effective_disabled(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        mcp_settings.update_settings(port=free_port())
        mcp_state.set_until_restart(True)
        await mcp_server.reconcile()
        assert mcp_server.is_running() is True

        mcp_state.set_until_restart(False)
        await mcp_server.reconcile()

        assert mcp_server.is_running() is False

    async def test_reconcile_is_idempotent(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(port=port)
        mcp_state.set_until_restart(True)

        await mcp_server.reconcile()
        await mcp_server.reconcile()

        assert mcp_server.is_running() is True
        assert port_is_open(port)

    async def test_reconcile_restarts_on_config_change(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port_a = free_port()
        mcp_settings.update_settings(port=port_a)
        mcp_state.set_until_restart(True)
        await mcp_server.reconcile()
        assert port_is_open(port_a)

        port_b = free_port()
        mcp_settings.update_settings(port=port_b)
        await mcp_server.reconcile()

        assert mcp_server.is_running() is True
        assert port_is_open(port_b)
        assert not port_is_open(port_a)

    async def test_reconcile_starts_the_endpoint_enabled_in_the_config_file(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.mcp import server as mcp_server

        port = free_port()
        load_config({"mcp": {"enabled": True, "port": port}})

        await mcp_server.reconcile()

        assert mcp_server.is_running() is True
        assert port_is_open(port)

    async def test_saved_enabled_endpoint_comes_back_after_a_restart(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        port = free_port()
        mcp_settings.update_settings(enabled=True, port=port)

        load_config()
        await mcp_server.reconcile()

        assert mcp_server.is_running() is True
        assert port_is_open(port)


class TestReadOnlyConfig:
    @staticmethod
    async def _put_settings(payload: dict[str, Any]) -> httpx.Response:
        from wavecore.api.app import app

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver:8000"
        ) as http:
            return await http.put("/mcp/settings", json=payload)

    @staticmethod
    def _assert_refused(response: httpx.Response, config_file: Path) -> None:
        assert response.status_code == 500
        error = response.json()["error"]
        assert error["code"] == "INTERNAL_ERROR"
        assert error["message"] == (
            f"Settings cannot be saved: the config file {config_file} is read-only"
        )

    async def test_refused_port_change_keeps_the_running_listener(
        self, request: pytest.FixtureRequest
    ) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port_a = free_port()
        mcp_settings.update_settings(port=port_a)
        mcp_state.set_until_restart(True)
        await mcp_server.reconcile()
        assert port_is_open(port_a)
        config_file: Path = request.getfixturevalue("read_only_config")
        port_b = free_port()

        response = await self._put_settings({"port": port_b})

        self._assert_refused(response, config_file)
        assert mcp_server.is_running() is True
        assert port_is_open(port_a)
        assert not port_is_open(port_b)
        assert mcp_state.is_until_restart() is True
        assert mcp_settings.get_settings()["port"] == port_a

    async def test_refused_enable_keeps_the_listener_stopped(self, read_only_config: Path) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import state as mcp_state

        port = free_port()

        response = await self._put_settings({"until_restart": True, "port": port})

        self._assert_refused(response, read_only_config)
        assert mcp_server.is_running() is False
        assert not port_is_open(port)
        assert mcp_state.is_until_restart() is False

    async def test_refused_disable_keeps_the_listener_running(
        self, request: pytest.FixtureRequest
    ) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        port = free_port()
        mcp_settings.update_settings(enabled=True, port=port)
        await mcp_server.reconcile()
        assert port_is_open(port)
        config_file: Path = request.getfixturevalue("read_only_config")

        response = await self._put_settings({"enabled": False})

        self._assert_refused(response, config_file)
        assert mcp_server.is_running() is True
        assert port_is_open(port)
        assert mcp_settings.get_settings()["enabled"] is True

    async def test_until_restart_alone_is_refused_when_the_file_says_enabled(
        self, request: pytest.FixtureRequest
    ) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(enabled=True, port=port)
        await mcp_server.reconcile()
        assert port_is_open(port)
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        response = await self._put_settings({"until_restart": True})

        self._assert_refused(response, config_file)
        assert config_file.read_bytes() == before
        assert mcp_state.is_until_restart() is False
        assert mcp_server.is_running() is True
        assert port_is_open(port)
        assert mcp_settings.get_settings()["enabled"] is True

    async def test_until_restart_alone_starts_the_listener_with_a_read_only_config(
        self, request: pytest.FixtureRequest, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(enabled=True, port=port)
        mcp_settings.update_settings(enabled=False)
        assert config_on_disk()["mcp"] == {"enabled": False, "port": port}
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        response = await self._put_settings({"until_restart": True})

        assert response.status_code == 200
        assert response.json()["until_restart_active"] is True
        assert response.json()["enabled"] is False
        assert mcp_state.is_until_restart() is True
        assert mcp_server.is_running() is True
        assert port_is_open(port)
        assert config_file.read_bytes() == before


class TestStatus:
    async def test_stopped_status_shape_and_defaults(self) -> None:
        from wavecore.mcp import server as mcp_server

        status = mcp_server.get_status()

        assert set(status.keys()) == STATUS_KEYS
        assert status["running"] is False
        assert status["enabled"] is False
        assert status["until_restart_active"] is False
        assert status["port"] == 8765
        assert status["bind"] == "local"
        assert status["urls"] == []
        assert status["connected_clients"] == 0
        assert status["sessions"] == []
        assert status["recent_activity"] == []
        assert status["last_error"] is None

    async def test_stopped_status_reads_the_config_file(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.mcp import server as mcp_server

        load_config({"mcp": {"enabled": True, "port": 9101, "bind": "network"}})

        status = mcp_server.get_status()

        assert status["running"] is False
        assert status["enabled"] is True
        assert status["port"] == 9101
        assert status["bind"] == "network"
        assert status["urls"] == []

    async def test_running_local_status_reports_loopback_url(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(port=port, bind="local")
        mcp_state.set_until_restart(True)
        await mcp_server.start()

        status = mcp_server.get_status()

        assert status["running"] is True
        assert status["until_restart_active"] is True
        assert status["port"] == port
        assert status["urls"] == [f"http://127.0.0.1:{port}/mcp"]

    async def test_running_network_status_lists_reachable_addresses(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(port=port, bind="network")
        mcp_state.set_until_restart(True)
        await mcp_server.start()

        snic = namedtuple("snic", ["family", "address"])
        interfaces = {
            "lo": [snic(socket.AF_INET, "127.0.0.1"), snic(socket.AF_INET6, "::1")],
            "eth0": [
                snic(socket.AF_INET, "192.0.2.20"),
                snic(socket.AF_INET6, "fe80::1"),
            ],
            "eth1": [snic(socket.AF_INET, "192.0.2.20")],
            "wg0": [snic(socket.AF_INET, "192.0.2.2")],
        }
        with patch("psutil.net_if_addrs", return_value=interfaces):
            status = mcp_server.get_status()

        assert status["running"] is True
        assert status["bind"] == "network"
        assert status["urls"] == [
            f"http://127.0.0.1:{port}/mcp",
            f"http://192.0.2.20:{port}/mcp",
            f"http://192.0.2.2:{port}/mcp",
        ]

    async def test_running_network_addresses_are_numeric_ipv4(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(port=port, bind="network")
        mcp_state.set_until_restart(True)
        await mcp_server.start()

        urls = mcp_server.get_status()["urls"]

        assert urls[0] == f"http://127.0.0.1:{port}/mcp"
        assert len(urls) == len(set(urls))
        for url in urls:
            assert re.match(rf"^http://\d+\.\d+\.\d+\.\d+:{port}/mcp$", url)

    async def test_status_reflects_sessions_and_last_error(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "127.0.0.1")
        mcp_state.touch_session("sess-1", "list_blocks")
        mcp_state.set_last_error("Port already in use")

        status = mcp_server.get_status()

        assert status["connected_clients"] == 1
        assert status["sessions"][0]["session_id"] == "sess-1"
        assert status["recent_activity"][0]["tool"] == "list_blocks"
        assert status["last_error"] == "Port already in use"


class TestEnsurePortAvailable:
    def _blocker(self) -> socket.socket:
        blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        return blocker

    def test_occupied_port_raises_when_enabling(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        blocker = self._blocker()
        occupied_port = blocker.getsockname()[1]
        try:
            prospective = {**mcp_settings.get_settings(), "port": occupied_port}
            with pytest.raises(
                ValidationException, match=rf"^Port {occupied_port} is already in use$"
            ):
                mcp_server.ensure_port_available(prospective, until_restart=True)
        finally:
            blocker.close()

    def test_occupied_port_ignored_while_disabled(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        blocker = self._blocker()
        occupied_port = blocker.getsockname()[1]
        try:
            prospective = {**mcp_settings.get_settings(), "port": occupied_port}
            mcp_server.ensure_port_available(prospective, until_restart=False)
        finally:
            blocker.close()

    def test_free_port_passes(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        prospective = {**mcp_settings.get_settings(), "port": free_port(), "enabled": True}

        mcp_server.ensure_port_available(prospective, until_restart=False)

    async def test_own_running_port_is_skipped(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(port=port)
        mcp_state.set_until_restart(True)
        await mcp_server.start()
        assert mcp_server.is_running() is True

        prospective = {**mcp_settings.get_settings(), "bind": "network"}

        mcp_server.ensure_port_available(prospective, until_restart=True)


class TestToolDispatch:
    async def test_on_loop_passes_sync_result_through(self) -> None:
        from wavecore.mcp import server as mcp_server

        def handler(*, value: int) -> dict[str, int]:
            return {"value": value}

        adapter = mcp_server._on_loop(handler)

        assert await adapter(value=3) == {"value": 3}

    async def test_on_loop_awaits_async_handlers(self) -> None:
        from wavecore.mcp import server as mcp_server

        async def handler(*, value: int) -> dict[str, int]:
            return {"value": value}

        adapter = mcp_server._on_loop(handler)

        assert await adapter(value=7) == {"value": 7}
