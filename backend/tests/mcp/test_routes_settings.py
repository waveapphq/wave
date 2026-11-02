"""GET/PUT /mcp/settings on the config file's mcp section (REQ-5.2.7.1); reconcile is mocked."""

import os
import re
import socket
from collections.abc import Callable, Generator, Mapping
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import yaml
from fastapi.testclient import TestClient

from tests.mcp.conftest import free_port
from wavecore.core.secrets.cipher import ENVELOPE_PREFIX

SETTINGS_KEYS = {
    "enabled",
    "until_restart_active",
    "port",
    "bind",
    "auth_enabled",
    "auth_username",
    "auth_password_set",
    "running",
    "server_port",
}

PORT_MESSAGE = r"^Port must be an integer between 1024 and 65535$"
BIND_MESSAGE = r"^Bind scope must be 'local' or 'network'$"
USERNAME_MESSAGE = r"^Username is required when authentication is enabled$"
PASSWORD_MESSAGE = r"^Password is required when authentication is enabled$"


def read_only_message(config_file: Path) -> str:
    return f"Settings cannot be saved: the config file {config_file} is read-only"


def assert_refused(response: Any, config_file: Path) -> None:
    assert response.status_code == 500
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert body["error"]["message"] == read_only_message(config_file)


def assert_password_required(response: Any) -> None:
    assert response.status_code == 400
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert re.match(PASSWORD_MESSAGE, body["error"]["message"])


def record_replaces(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    replaced: list[Path] = []
    real_replace = os.replace

    def recording_replace(src: Any, dst: Any, **kwargs: Any) -> None:
        replaced.append(Path(os.fspath(dst)).resolve())
        real_replace(src, dst, **kwargs)

    monkeypatch.setattr(os, "replace", recording_replace)
    return replaced


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def mock_reconcile() -> Generator[AsyncMock, None, None]:
    with patch("wavecore.mcp.server.reconcile", new_callable=AsyncMock) as mocked:
        yield mocked


class TestGetSettings:
    def test_default_shape_and_values(self, client: TestClient) -> None:
        response = client.get("/mcp/settings")

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == SETTINGS_KEYS
        assert body["enabled"] is False
        assert body["until_restart_active"] is False
        assert body["port"] == 8765
        assert body["bind"] == "local"
        assert body["auth_enabled"] is False
        assert body["auth_username"] == ""
        assert body["auth_password_set"] is False
        assert body["running"] is False
        assert body["server_port"] == 80

    def test_password_never_returned(self, client: TestClient) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )

        response = client.get("/mcp/settings")

        body = response.json()
        assert body["auth_password_set"] is True
        assert "auth_password" not in body
        assert "hunter2-secret" not in response.text
        assert ENVELOPE_PREFIX not in response.text

    def test_running_reflects_listener_state(self, client: TestClient) -> None:
        with patch("wavecore.mcp.server.is_running", return_value=True):
            response = client.get("/mcp/settings")

        assert response.json()["running"] is True

    def test_until_restart_reflects_runtime_flag(self, client: TestClient) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.set_until_restart(True)

        response = client.get("/mcp/settings")

        body = response.json()
        assert body["until_restart_active"] is True
        assert body["enabled"] is False


class TestPutSettings:
    def test_put_subset_applies_and_persists(self, client: TestClient) -> None:
        response = client.put("/mcp/settings", json={"port": 9001})

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == SETTINGS_KEYS
        assert body["port"] == 9001
        assert body["bind"] == "local"
        assert client.get("/mcp/settings").json()["port"] == 9001

    def test_put_empty_body_changes_nothing(self, client: TestClient) -> None:
        response = client.put("/mcp/settings", json={})

        assert response.status_code == 200
        body = response.json()
        assert body["enabled"] is False
        assert body["port"] == 8765

    def test_put_enabled_persists(self, client: TestClient) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=free_port())

        response = client.put("/mcp/settings", json={"enabled": True})

        assert response.status_code == 200
        assert response.json()["enabled"] is True
        assert mcp_settings.get_settings()["enabled"] is True

    def test_put_until_restart_sets_runtime_flag_only(self, client: TestClient) -> None:
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        mcp_settings.update_settings(port=free_port())

        response = client.put("/mcp/settings", json={"until_restart": True})

        assert response.status_code == 200
        body = response.json()
        assert body["until_restart_active"] is True
        assert body["enabled"] is False
        assert mcp_state.is_until_restart() is True
        assert mcp_settings.get_settings()["enabled"] is False

    def test_put_until_restart_false_clears_flag(self, client: TestClient) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.set_until_restart(True)

        response = client.put("/mcp/settings", json={"until_restart": False})

        assert response.status_code == 200
        assert response.json()["until_restart_active"] is False
        assert mcp_state.is_until_restart() is False

    def test_put_reconciles_the_listener(
        self, client: TestClient, mock_reconcile: AsyncMock
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=free_port())

        client.put("/mcp/settings", json={"until_restart": True})

        mock_reconcile.assert_awaited()

    def test_put_password_is_write_only_and_sealed(
        self,
        client: TestClient,
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        response = client.put(
            "/mcp/settings",
            json={
                "auth_enabled": True,
                "auth_username": "ops",
                "auth_password": "hunter2-secret",
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["auth_enabled"] is True
        assert body["auth_username"] == "ops"
        assert body["auth_password_set"] is True
        assert "auth_password" not in body
        assert "hunter2-secret" not in response.text

        assert "hunter2-secret" not in config_file.read_text(encoding="utf-8")
        on_disk = config_on_disk()["mcp"]
        assert on_disk["auth_password"].startswith(ENVELOPE_PREFIX)
        assert on_disk["auth_enabled"] is True
        assert on_disk["auth_username"] == "ops"


class TestSettingsStorage:
    def test_get_reads_the_mcp_section_of_the_config_file(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.core.secrets.sealing import seal_value

        load_config(
            {
                "mcp": {
                    "enabled": True,
                    "port": 9100,
                    "bind": "network",
                    "auth_enabled": True,
                    "auth_username": "ops",
                    "auth_password": seal_value("hunter2-secret"),
                }
            }
        )

        response = client.get("/mcp/settings")

        body = response.json()
        assert body["enabled"] is True
        assert body["port"] == 9100
        assert body["bind"] == "network"
        assert body["auth_enabled"] is True
        assert body["auth_username"] == "ops"
        assert body["auth_password_set"] is True
        assert ENVELOPE_PREFIX not in response.text

    def test_put_writes_the_mcp_section_of_the_config_file(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        response = client.put("/mcp/settings", json={"port": 9001, "bind": "network"})

        assert response.status_code == 200
        assert config_on_disk()["mcp"] == {"port": 9001, "bind": "network"}

    def test_put_with_the_port_as_its_digits_saves_the_number(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        response = client.put("/mcp/settings", json={"port": "9001"})

        assert response.status_code == 200
        assert response.json()["port"] == 9001
        assert config_on_disk()["mcp"] == {"port": 9001}

    def test_put_writes_nothing_into_the_data_folder(
        self, client: TestClient, temp_storage_path: Path
    ) -> None:
        response = client.put("/mcp/settings", json={"port": 9001})

        assert response.status_code == 200
        assert not (temp_storage_path / "mcp").exists()

    def test_put_survives_a_restart(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        saved = client.put(
            "/mcp/settings",
            json={
                "port": 9001,
                "bind": "network",
                "auth_enabled": True,
                "auth_username": "ops",
                "auth_password": "hunter2-secret",
            },
        )
        assert saved.status_code == 200

        load_config()

        assert client.get("/mcp/settings").json() == saved.json()
        assert saved.json()["port"] == 9001
        assert saved.json()["auth_password_set"] is True

    def test_enabling_with_a_port_change_is_one_save(
        self,
        client: TestClient,
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from wavecore.api.config import loader

        port = free_port()
        saves: list[dict[str, Any]] = []
        real_save = loader.Config.save

        def recording_save(
            config: Any, changes: Mapping[str, Any], *args: Any, **kwargs: Any
        ) -> None:
            saves.append(dict(changes))
            real_save(config, changes, *args, **kwargs)

        monkeypatch.setattr(loader.Config, "save", recording_save)
        replaced = record_replaces(monkeypatch)

        response = client.put("/mcp/settings", json={"enabled": True, "port": port})

        assert response.status_code == 200
        assert saves == [{"mcp.enabled": True, "mcp.port": port}]
        assert replaced.count(config_file.resolve()) == 1
        assert config_on_disk()["mcp"] == {"enabled": True, "port": port}

    def test_put_until_restart_is_never_written(
        self,
        client: TestClient,
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        from wavecore.mcp import state as mcp_state

        port = free_port()

        response = client.put("/mcp/settings", json={"until_restart": True, "port": port})

        assert response.status_code == 200
        assert mcp_state.is_until_restart() is True
        assert config_on_disk() == {"mcp": {"port": port}}
        assert "until_restart" not in config_file.read_text(encoding="utf-8")

    @pytest.mark.parametrize("payload", [{}, {"until_restart": False}])
    def test_put_without_a_stored_field_leaves_the_file_untouched(
        self, client: TestClient, config_file: Path, payload: dict[str, Any]
    ) -> None:
        before = config_file.read_bytes()

        response = client.put("/mcp/settings", json=payload)

        assert response.status_code == 200
        assert config_file.read_bytes() == before

    @pytest.mark.parametrize("empty", ["", None])
    def test_put_empty_password_clears_the_stored_one_while_auth_is_off(
        self,
        client: TestClient,
        config_on_disk: Callable[[], dict[str, Any]],
        empty: str | None,
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(auth_username="ops", auth_password="hunter2-secret")

        response = client.put("/mcp/settings", json={"auth_password": empty})

        assert response.status_code == 200
        assert response.json()["auth_password_set"] is False
        assert config_on_disk()["mcp"] == {"auth_username": "ops", "auth_password": None}
        assert mcp_settings.get_unsealed_password() is None

    def test_get_does_not_return_an_unknown_key_of_the_mcp_section(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        load_config({"mcp": {"port": 9100, "note": "kept-in-the-file"}})

        response = client.get("/mcp/settings")

        body = response.json()
        assert set(body.keys()) == SETTINGS_KEYS
        assert body["port"] == 9100
        assert "kept-in-the-file" not in response.text

    def test_put_keeps_an_unknown_key_in_the_file_and_out_of_the_answer(
        self,
        client: TestClient,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config({"mcp": {"port": 9100, "note": "kept-in-the-file"}})

        response = client.put("/mcp/settings", json={"bind": "network"})

        assert response.status_code == 200
        assert set(response.json().keys()) == SETTINGS_KEYS
        assert "kept-in-the-file" not in response.text
        assert config_on_disk()["mcp"] == {
            "port": 9100,
            "note": "kept-in-the-file",
            "bind": "network",
        }


class TestPutPasswordRequiredWhileAuthIsOn:
    @pytest.mark.parametrize("empty", ["", None])
    def test_auth_cannot_be_turned_on_with_an_empty_password(
        self, client: TestClient, config_file: Path, empty: str | None
    ) -> None:
        before = config_file.read_bytes()

        response = client.put(
            "/mcp/settings",
            json={"auth_enabled": True, "auth_username": "ops", "auth_password": empty},
        )

        assert_password_required(response)
        assert config_file.read_bytes() == before
        body = client.get("/mcp/settings").json()
        assert body["auth_enabled"] is False
        assert body["auth_username"] == ""
        assert body["auth_password_set"] is False

    @pytest.mark.parametrize("empty", ["", None])
    def test_password_cannot_be_cleared_while_auth_is_on(
        self,
        client: TestClient,
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
        empty: str | None,
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )
        envelope = mcp_settings.get_settings()["auth_password"]
        before = config_file.read_bytes()

        response = client.put("/mcp/settings", json={"auth_password": empty})

        assert_password_required(response)
        assert config_file.read_bytes() == before
        assert config_on_disk()["mcp"]["auth_password"] == envelope
        assert mcp_settings.get_unsealed_password() == "hunter2-secret"
        body = client.get("/mcp/settings").json()
        assert body["auth_enabled"] is True
        assert body["auth_password_set"] is True

    @pytest.mark.parametrize("empty", ["", None])
    def test_auth_cannot_be_turned_on_while_clearing_the_stored_password(
        self, client: TestClient, config_file: Path, empty: str | None
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(auth_username="ops", auth_password="hunter2-secret")
        before = config_file.read_bytes()

        response = client.put("/mcp/settings", json={"auth_enabled": True, "auth_password": empty})

        assert_password_required(response)
        assert config_file.read_bytes() == before
        assert mcp_settings.get_unsealed_password() == "hunter2-secret"
        body = client.get("/mcp/settings").json()
        assert body["auth_enabled"] is False
        assert body["auth_password_set"] is True

    def test_refused_password_change_does_not_touch_the_listener(
        self, client: TestClient, mock_reconcile: AsyncMock
    ) -> None:
        response = client.put(
            "/mcp/settings",
            json={"auth_enabled": True, "auth_username": "ops", "auth_password": ""},
        )

        assert_password_required(response)
        mock_reconcile.assert_not_awaited()


class TestPutNothingToSave:
    def test_until_restart_alone_turns_on_with_a_read_only_config(
        self,
        client: TestClient,
        request: pytest.FixtureRequest,
        config_on_disk: Callable[[], dict[str, Any]],
        mock_reconcile: AsyncMock,
    ) -> None:
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        port = free_port()
        mcp_settings.update_settings(enabled=True, port=port)
        mcp_settings.update_settings(enabled=False)
        assert config_on_disk()["mcp"] == {"enabled": False, "port": port}
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        response = client.put("/mcp/settings", json={"until_restart": True})

        assert response.status_code == 200
        body = response.json()
        assert body["until_restart_active"] is True
        assert body["enabled"] is False
        assert mcp_state.is_until_restart() is True
        assert config_file.read_bytes() == before
        mock_reconcile.assert_awaited_once()

    def test_until_restart_alone_is_refused_when_the_file_says_enabled(
        self,
        client: TestClient,
        request: pytest.FixtureRequest,
        mock_reconcile: AsyncMock,
    ) -> None:
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        mcp_settings.update_settings(enabled=True, port=free_port())
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        response = client.put("/mcp/settings", json={"until_restart": True})

        assert_refused(response, config_file)
        assert config_file.read_bytes() == before
        assert mcp_state.is_until_restart() is False
        body = client.get("/mcp/settings").json()
        assert body["enabled"] is True
        assert body["until_restart_active"] is False
        mock_reconcile.assert_not_awaited()

    def test_put_repeating_the_saved_port_and_bind_writes_nothing(
        self,
        client: TestClient,
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=9001, bind="network")
        assert config_on_disk()["mcp"] == {"port": 9001, "bind": "network"}
        before = config_file.read_bytes()
        replaced = record_replaces(monkeypatch)

        response = client.put("/mcp/settings", json={"port": 9001, "bind": "network"})

        assert response.status_code == 200
        assert response.json()["port"] == 9001
        assert response.json()["bind"] == "network"
        assert config_file.resolve() not in replaced
        assert config_file.read_bytes() == before

    def test_put_repeating_the_saved_port_and_bind_passes_on_a_read_only_config(
        self,
        client: TestClient,
        request: pytest.FixtureRequest,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=9001, bind="network")
        assert config_on_disk()["mcp"] == {"port": 9001, "bind": "network"}
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        response = client.put("/mcp/settings", json={"port": 9001, "bind": "network"})

        assert response.status_code == 200
        assert config_file.read_bytes() == before

    def test_put_changing_the_bind_beside_a_repeated_port_is_refused_whole(
        self, client: TestClient, request: pytest.FixtureRequest
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=9001, bind="network")
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        response = client.put("/mcp/settings", json={"port": 9001, "bind": "local"})

        assert_refused(response, config_file)
        assert config_file.read_bytes() == before
        assert client.get("/mcp/settings").json()["bind"] == "network"

    def test_until_restart_alone_turns_on_with_a_fresh_read_only_config(
        self, client: TestClient, read_only_config: Path, mock_reconcile: AsyncMock
    ) -> None:
        from wavecore.mcp import state as mcp_state

        before = read_only_config.read_bytes()
        assert yaml.safe_load(before) == {}

        # The default port may be taken on this machine; the probe is not under test.
        with patch("wavecore.mcp.server.ensure_port_available"):
            response = client.put("/mcp/settings", json={"until_restart": True})

        assert response.status_code == 200
        body = response.json()
        assert body["until_restart_active"] is True
        assert body["enabled"] is False
        assert mcp_state.is_until_restart() is True
        assert read_only_config.read_bytes() == before
        mock_reconcile.assert_awaited_once()

    @pytest.mark.parametrize("read_only", [False, True])
    def test_put_repeating_the_default_port_and_bind_writes_nothing_on_a_fresh_file(
        self,
        client: TestClient,
        request: pytest.FixtureRequest,
        config_file: Path,
        read_only: bool,
    ) -> None:
        if read_only:
            request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()
        assert yaml.safe_load(before) == {}

        response = client.put("/mcp/settings", json={"port": 8765, "bind": "local"})

        assert response.status_code == 200
        assert response.json()["port"] == 8765
        assert response.json()["bind"] == "local"
        assert config_file.read_bytes() == before

    def test_put_writes_only_the_value_that_differs_from_its_default(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        response = client.put("/mcp/settings", json={"port": 8765, "bind": "network"})

        assert response.status_code == 200
        assert config_on_disk() == {"mcp": {"bind": "network"}}

    def test_put_changing_one_value_on_a_fresh_read_only_config_is_refused(
        self, client: TestClient, read_only_config: Path
    ) -> None:
        before = read_only_config.read_bytes()
        assert yaml.safe_load(before) == {}

        response = client.put("/mcp/settings", json={"port": 8765, "bind": "network"})

        assert_refused(response, read_only_config)
        assert read_only_config.read_bytes() == before
        assert client.get("/mcp/settings").json()["bind"] == "local"


class TestPutSettingsRefusedSave:
    def test_read_only_config_returns_500_with_exact_message(
        self, client: TestClient, read_only_config: Path, mock_reconcile: AsyncMock
    ) -> None:
        before = read_only_config.read_bytes()

        response = client.put("/mcp/settings", json={"port": 9001, "bind": "network"})

        assert_refused(response, read_only_config)
        assert read_only_config.read_bytes() == before
        body = client.get("/mcp/settings").json()
        assert body["port"] == 8765
        assert body["bind"] == "local"
        mock_reconcile.assert_not_awaited()

    def test_refused_enable_leaves_the_endpoint_disabled(
        self, client: TestClient, read_only_config: Path
    ) -> None:
        from wavecore.mcp import server as mcp_server

        response = client.put("/mcp/settings", json={"enabled": True, "port": free_port()})

        assert_refused(response, read_only_config)
        body = client.get("/mcp/settings").json()
        assert body["enabled"] is False
        assert body["port"] == 8765
        assert body["running"] is False
        assert mcp_server.effective_enabled() is False

    def test_refused_save_does_not_turn_until_restart_on(
        self, client: TestClient, read_only_config: Path
    ) -> None:
        from wavecore.mcp import state as mcp_state

        response = client.put("/mcp/settings", json={"until_restart": True, "port": free_port()})

        assert_refused(response, read_only_config)
        assert mcp_state.is_until_restart() is False
        assert client.get("/mcp/settings").json()["until_restart_active"] is False

    def test_refused_save_does_not_turn_until_restart_off(
        self, client: TestClient, read_only_config: Path
    ) -> None:
        from wavecore.mcp import state as mcp_state

        mcp_state.set_until_restart(True)

        response = client.put("/mcp/settings", json={"enabled": True, "port": free_port()})

        assert_refused(response, read_only_config)
        assert mcp_state.is_until_restart() is True
        body = client.get("/mcp/settings").json()
        assert body["until_restart_active"] is True
        assert body["enabled"] is False

    def test_refused_password_save_stores_nothing(
        self, client: TestClient, read_only_config: Path
    ) -> None:
        response = client.put(
            "/mcp/settings",
            json={"auth_username": "ops", "auth_password": "hunter2-secret"},
        )

        assert_refused(response, read_only_config)
        assert "hunter2-secret" not in response.text
        assert ENVELOPE_PREFIX not in read_only_config.read_text(encoding="utf-8")
        assert client.get("/mcp/settings").json()["auth_password_set"] is False


class TestPutSettingsValidation:
    @pytest.mark.parametrize(
        ("payload", "message"),
        [
            ({"port": 80}, PORT_MESSAGE),
            ({"port": 70000}, PORT_MESSAGE),
            ({"port": 1023}, PORT_MESSAGE),
            ({"port": 65536}, PORT_MESSAGE),
            ({"bind": "wan"}, BIND_MESSAGE),
            ({"auth_enabled": True, "auth_password": "pw-123456"}, USERNAME_MESSAGE),
            ({"auth_enabled": True, "auth_username": "ops"}, PASSWORD_MESSAGE),
        ],
    )
    def test_invalid_payload_returns_400_with_exact_message(
        self, client: TestClient, payload: dict[str, Any], message: str
    ) -> None:
        response = client.put("/mcp/settings", json=payload)

        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert re.match(message, body["error"]["message"])

    def test_failed_put_does_not_change_settings(self, client: TestClient) -> None:
        response = client.put("/mcp/settings", json={"port": 80, "enabled": True})

        assert response.status_code == 400
        body = client.get("/mcp/settings").json()
        assert body["enabled"] is False
        assert body["port"] == 8765

    def test_failed_put_leaves_the_config_file_untouched(
        self, client: TestClient, config_file: Path
    ) -> None:
        before = config_file.read_bytes()

        response = client.put("/mcp/settings", json={"port": 9001, "bind": "wan"})

        assert response.status_code == 400
        assert config_file.read_bytes() == before


class TestPutValueTheNextStartWouldRefuse:
    @pytest.mark.parametrize(
        ("body", "message"),
        [
            ({"enabled": "yes"}, "mcp.enabled must be true or false"),
            ({"auth_username": 5}, "mcp.auth_username must be text"),
        ],
        ids=["switch-as-text", "username-as-number"],
    )
    def test_put_answers_400_with_the_rule_and_changes_nothing(
        self,
        client: TestClient,
        config_file: Path,
        mock_reconcile: AsyncMock,
        body: dict[str, Any],
        message: str,
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=free_port())
        before = config_file.read_bytes()
        in_force = client.get("/mcp/settings").json()

        response = client.put("/mcp/settings", json=body)

        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["message"] == message
        assert config_file.read_bytes() == before
        assert client.get("/mcp/settings").json() == in_force
        mock_reconcile.assert_not_awaited()


class TestPutPortAvailability:
    @pytest.fixture
    def occupied_port(self) -> Generator[int, None, None]:
        blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        try:
            yield int(blocker.getsockname()[1])
        finally:
            blocker.close()

    def test_enabling_onto_an_occupied_port_is_rejected(
        self, client: TestClient, occupied_port: int
    ) -> None:
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        mcp_settings.update_settings(port=occupied_port)

        response = client.put("/mcp/settings", json={"until_restart": True})

        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert re.match(rf"^Port {occupied_port} is already in use$", body["error"]["message"])
        assert mcp_state.is_until_restart() is False

    def test_port_change_to_an_occupied_port_is_rejected_and_not_persisted(
        self, client: TestClient, occupied_port: int
    ) -> None:
        response = client.put("/mcp/settings", json={"enabled": True, "port": occupied_port})

        assert response.status_code == 400
        assert re.match(
            rf"^Port {occupied_port} is already in use$",
            response.json()["error"]["message"],
        )
        body = client.get("/mcp/settings").json()
        assert body["enabled"] is False
        assert body["port"] == 8765

    def test_occupied_port_leaves_the_config_file_untouched(
        self, client: TestClient, occupied_port: int, config_file: Path
    ) -> None:
        before = config_file.read_bytes()

        response = client.put("/mcp/settings", json={"enabled": True, "port": occupied_port})

        assert response.status_code == 400
        assert config_file.read_bytes() == before

    def test_occupied_port_is_accepted_while_the_endpoint_stays_disabled(
        self, client: TestClient, occupied_port: int
    ) -> None:
        response = client.put("/mcp/settings", json={"port": occupied_port})

        assert response.status_code == 200
        assert response.json()["port"] == occupied_port
        assert client.get("/mcp/settings").json()["port"] == occupied_port


class TestEnablementExclusivity:
    def test_enabling_persistent_clears_until_restart(self, client: TestClient) -> None:
        from wavecore.mcp import settings as mcp_settings
        from wavecore.mcp import state as mcp_state

        mcp_settings.update_settings(port=free_port())
        mcp_state.set_until_restart(True)

        response = client.put("/mcp/settings", json={"enabled": True})

        assert response.status_code == 200
        body = response.json()
        assert body["enabled"] is True
        assert body["until_restart_active"] is False
        assert mcp_state.is_until_restart() is False

    def test_enabling_until_restart_clears_persistent(self, client: TestClient) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=free_port(), enabled=True)

        response = client.put("/mcp/settings", json={"until_restart": True})

        assert response.status_code == 200
        body = response.json()
        assert body["enabled"] is False
        assert body["until_restart_active"] is True
        assert mcp_settings.get_settings()["enabled"] is False

    def test_both_enables_in_one_request_rejected(self, client: TestClient) -> None:
        from wavecore.mcp import state as mcp_state

        response = client.put("/mcp/settings", json={"enabled": True, "until_restart": True})

        assert response.status_code == 400
        assert re.match(
            r"^Only one enablement mode can be turned on at a time$",
            response.json()["error"]["message"],
        )
        body = client.get("/mcp/settings").json()
        assert body["enabled"] is False
        assert mcp_state.is_until_restart() is False

    def test_turning_one_off_leaves_the_other(self, client: TestClient) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=free_port(), enabled=True)

        response = client.put("/mcp/settings", json={"until_restart": False})

        assert response.status_code == 200
        body = response.json()
        assert body["enabled"] is True
        assert body["until_restart_active"] is False
