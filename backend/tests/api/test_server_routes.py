"""GET /server/status + /server/sessions/* disconnect contract (contract file 4).

Status aggregates frontend/backend server facts and the browser-session roster;
DELETE / disconnect-others / disconnect-all tombstone sessions.
"""

import contextlib
import re
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
import yaml
from fastapi.testclient import TestClient

STATUS_KEYS = {
    "frontend",
    "backend",
    "session_count",
    "sessions",
    "active_session_id",
    "watching_session_ids",
    "data_folder",
    "config_file",
}

FACT_KEYS = {"running", "urls", "port", "bind"}

SESSION_ROW_KEYS = {
    "session_id",
    "client",
    "ip",
    "connected_at",
    "last_activity",
}


def _reset_session_registry() -> None:
    with contextlib.suppress(ImportError):
        from wavecore.api.websocket import session_registry

        session_registry.clear_sessions()
    with contextlib.suppress(ImportError):
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import events

        ownership.clear()
        events._emit_tasks.clear()


@pytest.fixture(autouse=True)
def reset_session_registry() -> Generator[None, None, None]:
    from wavecore.api.app import app

    _reset_session_registry()
    prev_manager = getattr(app.state, "ws_manager", None)
    app.state.ws_manager = None
    yield
    app.state.ws_manager = prev_manager
    _reset_session_registry()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


class TestServerStatus:
    """GET /server/status shape, server facts, and roster round-trip."""

    def test_status_returns_expected_top_level_keys(self, client: TestClient) -> None:
        response = client.get("/server/status")

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == STATUS_KEYS

    def test_frontend_and_backend_fact_shape(self, client: TestClient) -> None:
        body = client.get("/server/status").json()

        for facts in (body["frontend"], body["backend"]):
            assert set(facts.keys()) == FACT_KEYS
            assert isinstance(facts["running"], bool)
            assert isinstance(facts["urls"], list)
            assert isinstance(facts["port"], int)
            assert isinstance(facts["bind"], str)
        assert body["backend"]["running"] is True

    def test_frontend_facts_from_request_origin(self, client: TestClient) -> None:
        body = client.get("/server/status", headers={"origin": "http://localhost:3000"}).json()

        assert body["frontend"]["running"] is True
        assert body["frontend"]["urls"] == ["http://localhost:3000"]
        assert body["frontend"]["port"] == 3000
        assert body["frontend"]["bind"] == "local"

    def test_frontend_facts_fall_back_to_referer(self, client: TestClient) -> None:
        # The dev proxy strips Origin on same-origin calls; the page Referer
        # identifies the one frontend serving this browser (port echoed, path dropped).
        body = client.get(
            "/server/status",
            headers={"referer": "http://localhost:3001/settings/server"},
        ).json()

        assert body["frontend"]["running"] is True
        assert body["frontend"]["urls"] == ["http://localhost:3001"]
        assert body["frontend"]["port"] == 3001

    def test_frontend_facts_never_lists_multiple_origins(self, client: TestClient) -> None:
        # Without Origin/Referer, fall back to a single origin - never the whole
        # CORS list (which would surface a parallel dev frontend as this one).
        body = client.get("/server/status").json()

        assert len(body["frontend"]["urls"]) <= 1

    def test_frontend_facts_report_not_running_with_nothing_to_go_on(
        self, client: TestClient, monkeypatch: Any
    ) -> None:
        # No Origin, no Referer, no configured CORS origin: there is no frontend
        # to name. Asserted explicitly so this does not depend on ambient config.
        from wavecore.api.routes import server as server_routes

        monkeypatch.setattr(server_routes, "_frontend_origin", lambda _request: None)
        body = client.get("/server/status").json()

        assert body["frontend"] == {"running": False, "urls": [], "port": 0, "bind": "unknown"}

    def test_backend_facts_reflect_the_serving_socket_bind(self) -> None:
        # A loopback-bound server advertises only loopback - never a LAN address
        # it does not listen on (the serving socket, not config, sets bind scope).
        from wavecore.api.app import app

        loopback_client = TestClient(app, base_url="http://127.0.0.1:8000")
        body = loopback_client.get("/server/status").json()

        assert body["backend"]["bind"] == "local"
        assert body["backend"]["urls"] == ["http://127.0.0.1:8000"]
        assert body["backend"]["port"] == 8000

    def test_status_lists_registered_sessions(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")
        session_registry.register_session("s2", "Firefox (Windows)", "10.0.0.6")

        body = client.get("/server/status").json()

        assert body["session_count"] == 2
        assert len(body["sessions"]) == 2
        assert body["session_count"] == len(body["sessions"])
        rows = {row["session_id"]: row for row in body["sessions"]}
        assert set(rows.keys()) == {"s1", "s2"}
        row = rows["s1"]
        assert set(row.keys()) == SESSION_ROW_KEYS
        assert row["client"] == "Chrome (macOS)"
        assert row["ip"] == "10.0.0.5"
        assert isinstance(row["connected_at"], str)
        assert isinstance(row["last_activity"], str)

    def test_status_reports_active_and_watching_roles(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.app import app
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import session_registry

        session_registry.register_session("h", "Chrome (macOS)", "10.0.0.5")
        session_registry.register_session("w", "Firefox (Windows)", "10.0.0.6")
        monkeypatch.setattr(
            ownership,
            "get_holder",
            lambda: {"id": "h", "label": "Chrome (macOS)", "kind": "person"},
        )
        manager = MagicMock()
        manager.draft_watcher_ids.return_value = {"h", "w"}
        app.state.ws_manager = manager

        body = client.get("/server/status").json()

        assert body["active_session_id"] == "h"
        assert body["watching_session_ids"] == ["w"]

    def test_status_roles_empty_without_holder_or_manager(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services.workbench import ownership

        monkeypatch.setattr(ownership, "get_holder", lambda: None)

        body = client.get("/server/status").json()

        assert body["active_session_id"] is None
        assert body["watching_session_ids"] == []


class TestServerStatusDataFolder:
    """GET /server/status names the data folder in use by absolute path (REQ-4.7.13)."""

    def test_data_folder_is_the_folder_in_use(
        self, client: TestClient, temp_storage_path: Path
    ) -> None:
        body = client.get("/server/status").json()

        assert body["data_folder"] == str(temp_storage_path)

    def test_data_folder_is_the_resolved_absolute_path_of_the_setting(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.config import loader
        from wavecore.api.config.loader import Config
        from wavecore.api.services import storage_paths

        monkeypatch.delenv("WAVE_STORAGE_BASE_PATH", raising=False)
        launch = tmp_path / "launch"
        launch.mkdir()
        monkeypatch.chdir(launch)
        config_folder = tmp_path / "install" / "config"
        config_folder.mkdir(parents=True)
        config_file = config_folder / "wave.yaml"
        config_file.write_text(
            yaml.safe_dump({"storage": {"base_path": "../data"}}), encoding="utf-8"
        )
        monkeypatch.setattr(loader, "_config_instance", Config(config_file=str(config_file)))
        storage_paths.reset_path_cache()

        body = client.get("/server/status").json()

        shown = Path(body["data_folder"])
        assert shown.is_absolute()
        assert ".." not in shown.parts
        assert shown.resolve() == (tmp_path / "install" / "data").resolve()


class TestServerStatusConfigFile:
    """GET /server/status names the config file in use by absolute path (REQ-4.7.15)."""

    def test_config_file_is_the_file_in_use(self, client: TestClient, config_file: Path) -> None:
        body = client.get("/server/status").json()

        assert body.get("config_file") == str(config_file)
        assert Path(body["config_file"]).is_absolute()

    def test_config_file_follows_the_running_config(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.config import loader
        from wavecore.api.config.loader import Config

        other = tmp_path / "install" / "config" / "wave.yaml"
        other.parent.mkdir(parents=True)
        other.write_text("{}\n", encoding="utf-8")
        monkeypatch.setattr(loader, "_config_instance", Config(config_file=str(other)))

        body = client.get("/server/status").json()

        assert body.get("config_file") == str(other)


class TestDisconnectSession:
    """DELETE /server/sessions/{id} tombstones on success, 404 on unknown."""

    def test_delete_session_returns_204_and_tombstones(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Chrome (macOS)", "10.0.0.5")

        response = client.delete("/server/sessions/s1")

        assert response.status_code == 204
        assert response.content == b""
        assert session_registry.is_session_closed("s1") is True

    def test_delete_unknown_session_returns_404_with_exact_message(
        self, client: TestClient
    ) -> None:
        response = client.delete("/server/sessions/ghost")

        assert response.status_code == 404
        body = response.json()
        assert body["success"] is False
        assert re.match(r"^Browser session with ID 'ghost' not found$", body["error"]["message"])

    def test_delete_session_terminates_the_live_socket(self, client: TestClient) -> None:
        from unittest.mock import AsyncMock

        from wavecore.api.app import app
        from wavecore.api.websocket import session_registry

        session_registry.register_session("live-1", "Chrome (macOS)", "10.0.0.5")
        manager = AsyncMock()
        app.state.ws_manager = manager
        try:
            response = client.delete("/server/sessions/live-1")
        finally:
            app.state.ws_manager = None

        assert response.status_code == 204
        manager.terminate_session.assert_awaited_once_with("live-1")


class TestDisconnectOthers:
    """POST /server/sessions/disconnect-others tombstones all but the requester."""

    def test_disconnect_others_tombstones_all_except_requester(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("me", "Chrome (macOS)", "10.0.0.5")
        session_registry.register_session("a", "Firefox (Windows)", "10.0.0.6")
        session_registry.register_session("b", "Safari (macOS)", "10.0.0.7")

        response = client.post(
            "/server/sessions/disconnect-others",
            json={"requester_session_id": "me"},
        )

        assert response.status_code == 200
        assert response.json() == {"disconnected": 2}
        assert session_registry.is_session_closed("me") is False
        assert session_registry.is_session_closed("a") is True
        assert session_registry.is_session_closed("b") is True

    def test_disconnect_others_missing_requester_returns_422(self, client: TestClient) -> None:
        response = client.post("/server/sessions/disconnect-others", json={})

        assert response.status_code == 422
        body = response.json()
        assert body["success"] is False
        assert re.match(r"^requester_session_id is required$", body["error"]["message"])


class TestDisconnectAll:
    """POST /server/sessions/disconnect-all tombstones every session."""

    def test_disconnect_all_tombstones_every_session(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("me", "Chrome (macOS)", "10.0.0.5")
        session_registry.register_session("a", "Firefox (Windows)", "10.0.0.6")
        session_registry.register_session("b", "Safari (macOS)", "10.0.0.7")

        response = client.post("/server/sessions/disconnect-all", json={})

        assert response.status_code == 200
        assert response.json() == {"disconnected": 3}
        assert session_registry.is_session_closed("me") is True
        assert session_registry.is_session_closed("a") is True
        assert session_registry.is_session_closed("b") is True


class TestAdminTerminationReleasesOwnership:
    """A session ended by an admin never leaves a holder behind it.

    All three admin paths go through the
    same choke point, so all three are asserted here - and none of them may
    depend on a live WebSocket manager (this module runs with none).
    """

    @staticmethod
    def _claim(holder_id: str, label: str = "Chrome (macOS)") -> None:
        from wavecore.api.services.workbench import ownership

        ownership.claim(holder_id, label, "person")

    @staticmethod
    def _holder() -> dict[str, str] | None:
        from wavecore.api.services.workbench import ownership

        return ownership.get_holder()

    def test_delete_releases_the_ownership_the_session_held(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("h1", "Chrome (macOS)", "10.0.0.5")
        self._claim("h1")

        response = client.delete("/server/sessions/h1")

        assert response.status_code == 204
        assert self._holder() is None

    def test_delete_leaves_a_different_holder_alone(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Firefox (Windows)", "10.0.0.6")
        session_registry.register_session("h2", "Chrome (macOS)", "10.0.0.5")
        self._claim("h2")

        response = client.delete("/server/sessions/s1")

        assert response.status_code == 204
        assert self._holder() == {"id": "h2", "label": "Chrome (macOS)", "kind": "person"}

    def test_delete_of_a_session_holding_nothing_still_succeeds(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Firefox (Windows)", "10.0.0.6")

        response = client.delete("/server/sessions/s1")

        assert response.status_code == 204
        assert self._holder() is None

    def test_delete_grants_a_pending_takeover_the_way_release_does(
        self, client: TestClient
    ) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import session_registry

        session_registry.register_session("h1", "Chrome (macOS)", "10.0.0.5")
        self._claim("h1")
        ownership.request_takeover("w1", "Firefox (Windows)")

        response = client.delete("/server/sessions/h1")

        assert response.status_code == 204
        assert self._holder() == {"id": "w1", "label": "Firefox (Windows)", "kind": "person"}
        assert ownership.get_ownership()["pending_takeover"] is None

    def test_disconnect_others_releases_the_terminated_holder(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("me", "Chrome (macOS)", "10.0.0.5")
        session_registry.register_session("a", "Firefox (Windows)", "10.0.0.6")
        self._claim("a", "Firefox (Windows)")

        response = client.post(
            "/server/sessions/disconnect-others",
            json={"requester_session_id": "me"},
        )

        assert response.status_code == 200
        assert self._holder() is None

    def test_disconnect_others_keeps_the_requesters_own_ownership(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("me", "Chrome (macOS)", "10.0.0.5")
        session_registry.register_session("a", "Firefox (Windows)", "10.0.0.6")
        self._claim("me")

        response = client.post(
            "/server/sessions/disconnect-others",
            json={"requester_session_id": "me"},
        )

        assert response.status_code == 200
        assert self._holder() == {"id": "me", "label": "Chrome (macOS)", "kind": "person"}

    def test_disconnect_all_releases_the_holder(self, client: TestClient) -> None:
        from wavecore.api.websocket import session_registry

        session_registry.register_session("me", "Chrome (macOS)", "10.0.0.5")
        session_registry.register_session("a", "Firefox (Windows)", "10.0.0.6")
        self._claim("me")

        response = client.post("/server/sessions/disconnect-all", json={})

        assert response.status_code == 200
        assert self._holder() is None

    def test_disconnect_all_leaves_no_holder_when_the_roster_is_empty(
        self, client: TestClient
    ) -> None:
        response = client.post("/server/sessions/disconnect-all", json={})

        assert response.status_code == 200
        assert response.json() == {"disconnected": 0}
        assert self._holder() is None

    def test_an_assistant_holder_is_untouched_by_a_browser_termination(
        self, client: TestClient
    ) -> None:
        """An MCP holder is not a browser session; ending one must not free it."""
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import session_registry

        session_registry.register_session("s1", "Firefox (Windows)", "10.0.0.6")
        ownership.claim("mcp-1", "Claude", "mcp")

        response = client.delete("/server/sessions/s1")

        assert response.status_code == 204
        assert self._holder() == {"id": "mcp-1", "label": "Claude", "kind": "mcp"}
