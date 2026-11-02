"""GET /mcp/status + DELETE /mcp/sessions/{id} contract.

Status aggregates settings, runtime flag, sessions, and the activity ring
buffer (newest-first, cap 50); DELETE invalidates a session.
"""

import re
import socket
from collections import namedtuple
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

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

SESSION_ROW_KEYS = {
    "session_id",
    "client",
    "client_version",
    "ip",
    "connected_at",
    "last_activity",
}


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


class TestStatusEndpoint:
    def test_default_stopped_status(self, client: TestClient) -> None:
        response = client.get("/mcp/status")

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == STATUS_KEYS
        assert body["running"] is False
        assert body["enabled"] is False
        assert body["until_restart_active"] is False
        assert body["port"] == 8765
        assert body["bind"] == "local"
        assert body["urls"] == []
        assert body["connected_clients"] == 0
        assert body["sessions"] == []
        assert body["recent_activity"] == []
        assert body["last_error"] is None

    def test_status_lists_registered_sessions(self, client: TestClient) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "192.0.2.7")
        mcp_state.register_session("sess-2", "inspector", "0.9.1", "127.0.0.1")

        body = client.get("/mcp/status").json()

        assert body["connected_clients"] == 2
        rows = {row["session_id"]: row for row in body["sessions"]}
        assert set(rows.keys()) == {"sess-1", "sess-2"}
        row = rows["sess-1"]
        assert set(row.keys()) == SESSION_ROW_KEYS
        assert row["client"] == "claude-code"
        assert row["client_version"] == "2.1.0"
        assert row["ip"] == "192.0.2.7"

    def test_status_urls_local_bind_is_loopback_only(self, client: TestClient) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=9101, bind="local")

        with patch("wavecore.mcp.server.is_running", return_value=True):
            body = client.get("/mcp/status").json()

        assert body["running"] is True
        assert body["urls"] == ["http://127.0.0.1:9101/mcp"]

    def test_status_urls_network_bind_lists_machine_addresses(self, client: TestClient) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=9101, bind="network")

        snic = namedtuple("snic", ["family", "address"])
        interfaces = {
            "lo": [snic(socket.AF_INET, "127.0.0.1"), snic(socket.AF_INET6, "::1")],
            "eth0": [snic(socket.AF_INET, "192.0.2.20")],
        }
        with (
            patch("wavecore.mcp.server.is_running", return_value=True),
            patch("psutil.net_if_addrs", return_value=interfaces),
        ):
            body = client.get("/mcp/status").json()

        assert body["urls"] == [
            "http://127.0.0.1:9101/mcp",
            "http://192.0.2.20:9101/mcp",
        ]

    def test_status_urls_empty_when_stopped(self, client: TestClient) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=9101, enabled=True)

        body = client.get("/mcp/status").json()

        assert body["running"] is False
        assert body["urls"] == []

    def test_status_reads_the_mcp_section_of_the_config_file(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        load_config({"mcp": {"enabled": True, "port": 9101, "bind": "network"}})

        body = client.get("/mcp/status").json()

        assert set(body.keys()) == STATUS_KEYS
        assert body["enabled"] is True
        assert body["port"] == 9101
        assert body["bind"] == "network"
        assert body["running"] is False
        assert body["urls"] == []

    def test_running_status_url_uses_the_port_in_the_config_file(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        load_config({"mcp": {"port": 9101}})

        with patch("wavecore.mcp.server.is_running", return_value=True):
            body = client.get("/mcp/status").json()

        assert body["urls"] == ["http://127.0.0.1:9101/mcp"]

    def test_saved_settings_show_in_status_after_a_restart(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(enabled=True, port=9101, bind="network")
        load_config()

        body = client.get("/mcp/status").json()

        assert body["enabled"] is True
        assert body["port"] == 9101
        assert body["bind"] == "network"

    def test_refused_save_leaves_status_unchanged(
        self, client: TestClient, read_only_config: Path
    ) -> None:
        before = client.get("/mcp/status").json()

        response = client.put("/mcp/settings", json={"port": 9101, "bind": "network"})

        assert response.status_code == 500
        assert response.json()["error"]["code"] == "INTERNAL_ERROR"
        assert response.json()["error"]["message"] == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert client.get("/mcp/status").json() == before

    def test_status_surfaces_last_error(self, client: TestClient) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.set_last_error("Port already in use")

        body = client.get("/mcp/status").json()

        assert body["last_error"] == "Port already in use"

    def test_status_reflects_until_restart_flag(self, client: TestClient) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.set_until_restart(True)

        body = client.get("/mcp/status").json()

        assert body["until_restart_active"] is True
        assert body["enabled"] is False

    def test_activity_is_newest_first_and_capped_at_50(self, client: TestClient) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "127.0.0.1")
        for index in range(55):
            mcp_state.touch_session("sess-1", f"tool-{index}")

        body = client.get("/mcp/status").json()

        activity = body["recent_activity"]
        assert len(activity) == 50
        assert activity[0]["tool"] == "tool-54"
        assert activity[-1]["tool"] == "tool-5"
        assert set(activity[0].keys()) == {"timestamp", "client", "tool"}
        assert activity[0]["client"] == "claude-code"


class TestDisconnectSession:
    def test_delete_session_returns_204_and_removes_it(self, client: TestClient) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("sess-1", "claude-code", "2.1.0", "127.0.0.1")

        response = client.delete("/mcp/sessions/sess-1")

        assert response.status_code == 204
        assert response.content == b""
        assert mcp_state.is_session_closed("sess-1") is True

        body = client.get("/mcp/status").json()
        assert body["connected_clients"] == 0
        assert body["sessions"] == []

    def test_delete_unknown_session_returns_404_with_exact_message(
        self, client: TestClient
    ) -> None:
        response = client.delete("/mcp/sessions/ghost")

        assert response.status_code == 404
        body = response.json()
        assert body["success"] is False
        assert re.match(r"^MCP session with ID 'ghost' not found$", body["error"]["message"])
