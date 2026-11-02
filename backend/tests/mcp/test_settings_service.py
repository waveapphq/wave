"""MCP settings in the config file's mcp section (REQ-5.2.7.1): defaults, saves, sealed password."""

import os
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import yaml

from wavecore.api.exceptions import ValidationException
from wavecore.core.secrets.cipher import ENVELOPE_PREFIX

DEFAULT_SETTINGS = {
    "enabled": False,
    "port": 8765,
    "bind": "local",
    "auth_enabled": False,
    "auth_username": "",
    "auth_password": None,
}

PORT_MESSAGE = r"^Port must be an integer between 1024 and 65535$"
BIND_MESSAGE = r"^Bind scope must be 'local' or 'network'$"
USERNAME_MESSAGE = r"^Username is required when authentication is enabled$"
PASSWORD_MESSAGE = r"^Password is required when authentication is enabled$"


def read_only_message(config_file: Path) -> str:
    path = re.escape(str(config_file))
    return rf"^Settings cannot be saved: the config file {path} is read-only$"


def record_replaces(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    replaced: list[Path] = []
    real_replace = os.replace

    def recording_replace(src: Any, dst: Any, **kwargs: Any) -> None:
        replaced.append(Path(os.fspath(dst)).resolve())
        real_replace(src, dst, **kwargs)

    monkeypatch.setattr(os, "replace", recording_replace)
    return replaced


class TestDefaults:
    def test_config_without_mcp_section_returns_exact_defaults(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        assert mcp_settings.get_settings() == DEFAULT_SETTINGS

    def test_defaults_are_the_instance_settings_defaults(self) -> None:
        from wavecore.api.config import instance_settings
        from wavecore.mcp import settings as mcp_settings

        assert instance_settings.SECTION_DEFAULTS["mcp"] == DEFAULT_SETTINGS
        assert mcp_settings.get_settings() == instance_settings.SECTION_DEFAULTS["mcp"]

    def test_partial_section_is_merged_over_defaults(self, load_config: Callable[..., Any]) -> None:
        from wavecore.mcp import settings as mcp_settings

        load_config({"mcp": {"enabled": True}})

        result = mcp_settings.get_settings()

        assert result == {**DEFAULT_SETTINGS, "enabled": True}

    def test_unsealed_password_is_none_by_default(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        assert mcp_settings.get_unsealed_password() is None


class TestConfigFileStorage:
    def test_settings_are_read_from_the_mcp_section(self, load_config: Callable[..., Any]) -> None:
        from wavecore.core.secrets.sealing import seal_value
        from wavecore.mcp import settings as mcp_settings

        stored = {
            "enabled": True,
            "port": 9100,
            "bind": "network",
            "auth_enabled": True,
            "auth_username": "ops",
            "auth_password": seal_value("hunter2-secret"),
        }
        load_config({"mcp": stored})

        assert mcp_settings.get_settings() == stored
        assert mcp_settings.get_unsealed_password() == "hunter2-secret"

    def test_unknown_key_in_the_mcp_section_is_not_returned(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        load_config({"mcp": {"port": 9100, "note": "kept"}})

        assert mcp_settings.get_settings() == {**DEFAULT_SETTINGS, "port": 9100}

        saved = mcp_settings.update_settings(bind="network")

        assert saved == {**DEFAULT_SETTINGS, "port": 9100, "bind": "network"}
        assert mcp_settings.get_settings() == saved
        assert config_on_disk()["mcp"] == {"port": 9100, "note": "kept", "bind": "network"}

    def test_data_folder_settings_file_is_not_read(self, temp_storage_path: Path) -> None:
        from wavecore.mcp import settings as mcp_settings

        old_file = temp_storage_path / "mcp" / "settings.yaml"
        old_file.parent.mkdir(parents=True)
        old_file.write_text(yaml.safe_dump({"enabled": True, "port": 9001}), encoding="utf-8")

        assert mcp_settings.get_settings() == DEFAULT_SETTINGS

    def test_update_writes_nothing_into_the_data_folder(self, temp_storage_path: Path) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(enabled=True, port=9001)

        assert not (temp_storage_path / "mcp").exists()

    def test_storage_paths_has_no_mcp_settings_path(self) -> None:
        from wavecore.api.services import storage_paths

        assert not hasattr(storage_paths, "get_mcp_settings_file_path")


class TestUpdatePersistence:
    def test_update_returns_full_settings_and_persists(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        result = mcp_settings.update_settings(enabled=True, port=9001)

        assert result == {**DEFAULT_SETTINGS, "enabled": True, "port": 9001}
        assert config_on_disk()["mcp"] == {"enabled": True, "port": 9001}

    def test_update_result_matches_fresh_read(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        result = mcp_settings.update_settings(bind="network")

        assert result == mcp_settings.get_settings()

    def test_partial_update_leaves_other_fields_unchanged(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(enabled=True, port=9001, bind="network")
        result = mcp_settings.update_settings(port=9002)

        assert result["port"] == 9002
        assert result["enabled"] is True
        assert result["bind"] == "network"

    def test_boundary_ports_are_accepted(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        assert mcp_settings.update_settings(port=1024)["port"] == 1024
        assert mcp_settings.update_settings(port=65535)["port"] == 65535

    def test_both_bind_scopes_are_accepted(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        assert mcp_settings.update_settings(bind="network")["bind"] == "network"
        assert mcp_settings.update_settings(bind="local")["bind"] == "local"

    def test_update_writes_only_the_provided_keys(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        load_config({"logging": {"level": "INFO"}, "mcp": {"port": 9100, "note": "kept"}})

        mcp_settings.update_settings(bind="network")

        assert config_on_disk() == {
            "logging": {"level": "INFO"},
            "mcp": {"port": 9100, "note": "kept", "bind": "network"},
        }
        assert mcp_settings.get_settings()["port"] == 9100

    def test_update_changes_the_running_config(self) -> None:
        from wavecore.api.config import get_config
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=9001, bind="network")

        assert get_config().get("mcp.port") == 9001
        assert get_config().get("mcp.bind") == "network"

    def test_update_survives_a_restart(self, load_config: Callable[..., Any]) -> None:
        from wavecore.mcp import settings as mcp_settings

        saved = mcp_settings.update_settings(
            enabled=True, port=9001, bind="network", auth_username="ops"
        )

        load_config()

        assert mcp_settings.get_settings() == saved
        assert saved == {
            **DEFAULT_SETTINGS,
            "enabled": True,
            "port": 9001,
            "bind": "network",
            "auth_username": "ops",
        }

    def test_until_restart_is_never_written(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(port=9001, until_restart=True)

        assert config_on_disk()["mcp"] == {"port": 9001}
        assert "until_restart" not in config_file.read_text(encoding="utf-8")

    def test_preview_writes_nothing(self, config_file: Path) -> None:
        from wavecore.mcp import settings as mcp_settings

        before = config_file.read_bytes()

        prospective = mcp_settings.preview_settings(enabled=True, port=9001)

        assert prospective == {**DEFAULT_SETTINGS, "enabled": True, "port": 9001}
        assert config_file.read_bytes() == before
        assert mcp_settings.get_settings() == DEFAULT_SETTINGS


class TestPasswordSealing:
    def test_password_is_sealed_at_rest_and_unsealable(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )

        raw = config_file.read_text(encoding="utf-8")
        assert "hunter2-secret" not in raw
        on_disk = config_on_disk()["mcp"]["auth_password"]
        assert isinstance(on_disk, str)
        assert on_disk.startswith(ENVELOPE_PREFIX)
        stored = mcp_settings.get_settings()["auth_password"]
        assert stored == on_disk
        assert mcp_settings.get_unsealed_password() == "hunter2-secret"

    def test_omitted_password_keeps_stored_value(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )
        sealed_before = mcp_settings.get_settings()["auth_password"]

        result = mcp_settings.update_settings(port=9002)

        assert result["auth_password"] == sealed_before
        assert mcp_settings.get_unsealed_password() == "hunter2-secret"

    def test_new_password_replaces_stored_value(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="first-secret"
        )
        mcp_settings.update_settings(auth_password="second-secret")

        assert mcp_settings.get_unsealed_password() == "second-secret"

    def test_sealed_password_survives_a_restart(self, load_config: Callable[..., Any]) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )
        sealed_before = mcp_settings.get_settings()["auth_password"]
        assert sealed_before.startswith(ENVELOPE_PREFIX)

        load_config()

        assert mcp_settings.get_settings()["auth_password"] == sealed_before
        assert mcp_settings.get_unsealed_password() == "hunter2-secret"

    @pytest.mark.parametrize("empty", ["", None])
    def test_empty_password_with_none_stored_stays_null(
        self, empty: str | None, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        result = mcp_settings.update_settings(auth_password=empty)

        assert result["auth_password"] is None
        assert mcp_settings.get_settings()["auth_password"] is None
        assert mcp_settings.get_unsealed_password() is None
        assert config_on_disk().get("mcp", {}).get("auth_password") is None

    @pytest.mark.parametrize("empty", ["", None])
    def test_empty_password_clears_the_stored_one_while_auth_is_off(
        self, empty: str | None, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(auth_username="ops", auth_password="hunter2-secret")

        result = mcp_settings.update_settings(auth_password=empty)

        assert config_on_disk()["mcp"] == {"auth_username": "ops", "auth_password": None}
        assert result["auth_password"] is None
        assert mcp_settings.get_settings()["auth_password"] is None
        assert mcp_settings.get_unsealed_password() is None

    def test_turning_auth_off_and_clearing_the_password_in_one_update(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )

        result = mcp_settings.update_settings(auth_enabled=False, auth_password="")

        assert result["auth_enabled"] is False
        assert result["auth_password"] is None
        assert config_on_disk()["mcp"] == {
            "auth_enabled": False,
            "auth_username": "ops",
            "auth_password": None,
        }


class TestPasswordRequiredWhileAuthIsOn:
    @pytest.mark.parametrize("empty", ["", None])
    def test_auth_cannot_be_turned_on_with_an_empty_password(
        self, empty: str | None, config_file: Path
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        before = config_file.read_bytes()

        with pytest.raises(ValidationException, match=PASSWORD_MESSAGE):
            mcp_settings.update_settings(
                auth_enabled=True, auth_username="ops", auth_password=empty
            )

        assert mcp_settings.get_settings() == DEFAULT_SETTINGS
        assert config_file.read_bytes() == before

    @pytest.mark.parametrize("empty", ["", None])
    def test_preview_refuses_turning_auth_on_with_an_empty_password(
        self, empty: str | None
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        with pytest.raises(ValidationException, match=PASSWORD_MESSAGE):
            mcp_settings.preview_settings(
                auth_enabled=True, auth_username="ops", auth_password=empty
            )

    @pytest.mark.parametrize("empty", ["", None])
    def test_password_cannot_be_cleared_while_auth_is_on(
        self,
        empty: str | None,
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        stored = mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )
        before = config_file.read_bytes()

        with pytest.raises(ValidationException, match=PASSWORD_MESSAGE):
            mcp_settings.update_settings(auth_password=empty)

        assert mcp_settings.get_settings() == stored
        assert mcp_settings.get_unsealed_password() == "hunter2-secret"
        assert config_file.read_bytes() == before
        assert config_on_disk()["mcp"]["auth_password"] == stored["auth_password"]

    @pytest.mark.parametrize("empty", ["", None])
    def test_preview_refuses_clearing_the_password_while_auth_is_on(
        self, empty: str | None
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )

        with pytest.raises(ValidationException, match=PASSWORD_MESSAGE):
            mcp_settings.preview_settings(auth_password=empty)

    @pytest.mark.parametrize("empty", ["", None])
    def test_auth_cannot_be_turned_on_while_clearing_the_stored_password(
        self, empty: str | None, config_file: Path
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        stored = mcp_settings.update_settings(auth_username="ops", auth_password="hunter2-secret")
        before = config_file.read_bytes()

        with pytest.raises(ValidationException, match=PASSWORD_MESSAGE):
            mcp_settings.update_settings(auth_enabled=True, auth_password=empty)

        assert mcp_settings.get_settings() == stored
        assert mcp_settings.get_unsealed_password() == "hunter2-secret"
        assert config_file.read_bytes() == before


class TestValidation:
    @pytest.mark.parametrize(
        "port", [1023, 65536, 0, -1, "abc", "+8765", "8765.0", 8765.0, True, "1023"]
    )
    def test_invalid_port_rejected(self, port: object) -> None:
        from wavecore.mcp import settings as mcp_settings

        with pytest.raises(ValidationException, match=PORT_MESSAGE):
            mcp_settings.update_settings(port=port)

    def test_a_port_sent_as_its_digits_is_the_number(self) -> None:
        from wavecore.api.config import get_config
        from wavecore.mcp import settings as mcp_settings

        assert mcp_settings.preview_settings(port="9100")["port"] == 9100
        assert mcp_settings.update_settings(port="9100")["port"] == 9100
        assert get_config().get("mcp.port") == 9100

    def test_port_bounds_are_the_instance_settings_bounds(self) -> None:
        from wavecore.api.config import instance_settings
        from wavecore.mcp import settings as mcp_settings

        lowest = instance_settings.MCP_PORT_MIN
        highest = instance_settings.MCP_PORT_MAX

        assert PORT_MESSAGE == rf"^Port must be an integer between {lowest} and {highest}$"
        assert mcp_settings.update_settings(port=lowest)["port"] == lowest
        assert mcp_settings.update_settings(port=highest)["port"] == highest
        with pytest.raises(ValidationException, match=PORT_MESSAGE):
            mcp_settings.update_settings(port=lowest - 1)
        with pytest.raises(ValidationException, match=PORT_MESSAGE):
            mcp_settings.update_settings(port=highest + 1)

    def test_bind_scopes_are_the_instance_settings_binds(self) -> None:
        from wavecore.api.config import instance_settings
        from wavecore.mcp import settings as mcp_settings

        assert instance_settings.MCP_BINDS == ("local", "network")
        for bind in instance_settings.MCP_BINDS:
            assert mcp_settings.update_settings(bind=bind)["bind"] == bind

    def test_invalid_bind_rejected(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        with pytest.raises(ValidationException, match=BIND_MESSAGE):
            mcp_settings.update_settings(bind="wan")

    def test_auth_enabled_requires_username(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        with pytest.raises(ValidationException, match=USERNAME_MESSAGE):
            mcp_settings.update_settings(auth_enabled=True, auth_password="pw-123456")

    def test_auth_enabled_requires_password_when_none_stored(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        with pytest.raises(ValidationException, match=PASSWORD_MESSAGE):
            mcp_settings.update_settings(auth_enabled=True, auth_username="ops")

    def test_auth_enabled_accepts_previously_stored_password(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )
        mcp_settings.update_settings(auth_enabled=False)

        result = mcp_settings.update_settings(auth_enabled=True)

        assert result["auth_enabled"] is True
        assert mcp_settings.get_unsealed_password() == "hunter2-secret"

    def test_failed_validation_does_not_persist(self, config_file: Path) -> None:
        from wavecore.mcp import settings as mcp_settings

        before = config_file.read_bytes()

        with pytest.raises(ValidationException, match=PORT_MESSAGE):
            mcp_settings.update_settings(port=80, enabled=True)

        assert mcp_settings.get_settings() == DEFAULT_SETTINGS
        assert config_file.read_bytes() == before

    def test_validation_message_is_exact(self) -> None:
        from wavecore.mcp import settings as mcp_settings

        with pytest.raises(ValidationException) as exc_info:
            mcp_settings.update_settings(port=99999)

        assert re.fullmatch(r"Port must be an integer between 1024 and 65535", str(exc_info.value))


class TestNothingToSave:
    def test_repeating_the_saved_values_does_not_replace_the_file(
        self,
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        saved = mcp_settings.update_settings(port=9001, bind="network")
        assert config_on_disk()["mcp"] == {"port": 9001, "bind": "network"}
        before = config_file.read_bytes()
        replaced = record_replaces(monkeypatch)

        result = mcp_settings.update_settings(port=9001, bind="network")

        assert result == saved
        assert config_file.resolve() not in replaced
        assert config_file.read_bytes() == before

    def test_repeating_the_saved_values_passes_on_a_read_only_config(
        self, request: pytest.FixtureRequest, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        saved = mcp_settings.update_settings(port=9001, bind="network")
        assert config_on_disk()["mcp"] == {"port": 9001, "bind": "network"}
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        result = mcp_settings.update_settings(port=9001, bind="network")

        assert result == saved
        assert config_file.read_bytes() == before

    def test_one_changed_value_among_repeated_ones_is_refused_whole(
        self, request: pytest.FixtureRequest
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError
        from wavecore.mcp import settings as mcp_settings

        saved = mcp_settings.update_settings(port=9001, bind="network")
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        with pytest.raises(ConfigWriteError, match=read_only_message(config_file)):
            mcp_settings.update_settings(port=9001, bind="local")

        assert mcp_settings.get_settings() == saved
        assert config_file.read_bytes() == before

    @pytest.mark.parametrize("read_only", [False, True])
    def test_repeating_the_defaults_writes_nothing_on_a_fresh_file(
        self, request: pytest.FixtureRequest, config_file: Path, read_only: bool
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        if read_only:
            request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()
        assert yaml.safe_load(before) == {}

        result = mcp_settings.update_settings(enabled=False, port=8765, bind="local")

        assert result == DEFAULT_SETTINGS
        assert config_file.read_bytes() == before

    def test_only_the_value_that_differs_from_its_default_is_written(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.mcp import settings as mcp_settings

        result = mcp_settings.update_settings(enabled=False, port=8765, bind="network")

        assert result == {**DEFAULT_SETTINGS, "bind": "network"}
        assert config_on_disk() == {"mcp": {"bind": "network"}}

    def test_one_changed_value_on_a_fresh_read_only_file_is_refused(
        self, read_only_config: Path
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError
        from wavecore.mcp import settings as mcp_settings

        before = read_only_config.read_bytes()

        with pytest.raises(ConfigWriteError, match=read_only_message(read_only_config)):
            mcp_settings.update_settings(port=8765, bind="network")

        assert mcp_settings.get_settings() == DEFAULT_SETTINGS
        assert read_only_config.read_bytes() == before


class TestRefusedSave:
    def test_read_only_config_refuses_the_update(self, read_only_config: Path) -> None:
        from wavecore.api.config.write_back import ConfigWriteError
        from wavecore.mcp import settings as mcp_settings

        before = read_only_config.read_bytes()

        with pytest.raises(ConfigWriteError, match=read_only_message(read_only_config)):
            mcp_settings.update_settings(enabled=True, port=9001)

        assert mcp_settings.get_settings() == DEFAULT_SETTINGS
        assert read_only_config.read_bytes() == before

    def test_refused_password_save_stores_nothing(self, read_only_config: Path) -> None:
        from wavecore.api.config.write_back import ConfigWriteError
        from wavecore.mcp import settings as mcp_settings

        with pytest.raises(ConfigWriteError, match=read_only_message(read_only_config)):
            mcp_settings.update_settings(auth_username="ops", auth_password="hunter2-secret")

        assert mcp_settings.get_unsealed_password() is None
        assert mcp_settings.get_settings() == DEFAULT_SETTINGS
        assert ENVELOPE_PREFIX not in read_only_config.read_text(encoding="utf-8")
