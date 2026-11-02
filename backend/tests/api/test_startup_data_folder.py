"""App startup checks the data folder before serving (REQ-4.7.13).

A data folder that is not set, set through a relative environment override, or
cannot be created is logged at ERROR and the process exits with code 1. A usable
folder is created when missing and named by absolute path in one INFO line.
"""

import logging
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import yaml
from fastapi.testclient import TestClient

from wavecore.api import app as app_module
from wavecore.api.app import app
from wavecore.api.config import loader
from wavecore.api.config.loader import Config
from wavecore.api.services import storage_paths

NOT_SET = (
    "Data folder not set: add storage.base_path to the config file or set WAVE_STORAGE_BASE_PATH"
)


@pytest.fixture(autouse=True)
def launch_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty launch folder with no data folder settings in the environment."""
    monkeypatch.delenv("WAVE_STORAGE_BASE_PATH", raising=False)
    launch = tmp_path / "launch"
    launch.mkdir()
    monkeypatch.chdir(launch)
    return launch


def _install_config(
    monkeypatch: pytest.MonkeyPatch, folder: Path, storage: dict[str, Any] | None
) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    config_file = folder / "wave.yaml"
    data = {} if storage is None else {"storage": storage}
    config_file.write_text(yaml.safe_dump(data), encoding="utf-8")
    monkeypatch.setattr(loader, "_config_instance", Config(config_file=str(config_file)))
    storage_paths.reset_path_cache()


def _same_place(shown: Path, expected: Path) -> bool:
    return shown.is_absolute() and ".." not in shown.parts and shown.resolve() == expected.resolve()


class TestDataFolderRefusals:
    def test_missing_setting_logs_the_error_and_exits(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        _install_config(monkeypatch, tmp_path / "install", None)

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            with pytest.raises(SystemExit):
                app_module._check_data_folder()

        exit_call.assert_called_once_with(1)
        assert startup_messages(caplog, logging.ERROR) == [NOT_SET]
        assert startup_messages(caplog, logging.INFO) == []

    def test_relative_environment_override_logs_the_error_and_exits(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", "data")
        _install_config(monkeypatch, tmp_path / "install", {"base_path": str(tmp_path / "ok")})

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            with pytest.raises(SystemExit):
                app_module._check_data_folder()

        exit_call.assert_called_once_with(1)
        assert startup_messages(caplog, logging.ERROR) == [
            "WAVE_STORAGE_BASE_PATH must be an absolute path: data"
        ]
        assert not (tmp_path / "ok").exists()

    def test_uncreatable_folder_logs_the_error_and_exits(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        blocker = tmp_path / "blocker"
        blocker.write_text("", encoding="utf-8")
        target = blocker / "data"
        _install_config(monkeypatch, tmp_path / "install", {"base_path": str(target)})

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            with pytest.raises(SystemExit):
                app_module._check_data_folder()

        exit_call.assert_called_once_with(1)
        errors = startup_messages(caplog, logging.ERROR)
        assert len(errors) == 1
        assert re.match(rf"^Data folder {re.escape(str(target))} cannot be created: .+$", errors[0])
        assert startup_messages(caplog, logging.INFO) == []


class TestDataFolderInUse:
    def test_relative_setting_is_created_and_named_by_absolute_path(
        self,
        tmp_path: Path,
        launch_folder: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        install = tmp_path / "install"
        expected = install / "var" / "wave-data"
        _install_config(monkeypatch, install / "config", {"base_path": "../var/wave-data"})

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            app_module._check_data_folder()

        exit_call.assert_not_called()
        assert expected.is_dir()
        assert not (launch_folder / "var").exists()
        lines = startup_messages(caplog, logging.INFO)
        assert len(lines) == 1
        shown = re.match(r"^Data folder: (/.+)$", lines[0])
        assert shown is not None
        assert _same_place(Path(shown.group(1)), expected)
        assert startup_messages(caplog, logging.ERROR) == []

    def test_existing_folder_is_named_and_kept(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        folder = tmp_path / "wave-data"
        folder.mkdir()
        (folder / "system_variables.yaml").write_text("variables: {}\n", encoding="utf-8")
        _install_config(monkeypatch, tmp_path / "install", {"base_path": str(folder)})

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            app_module._check_data_folder()

        exit_call.assert_not_called()
        assert startup_messages(caplog, logging.INFO) == [f"Data folder: {folder}"]
        assert (folder / "system_variables.yaml").read_text(encoding="utf-8") == "variables: {}\n"

    def test_absolute_environment_override_is_the_folder_in_use(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        from_env = tmp_path / "from-env"
        monkeypatch.setenv("WAVE_STORAGE_BASE_PATH", str(from_env))
        _install_config(monkeypatch, tmp_path / "install", {"base_path": "data"})

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            app_module._check_data_folder()

        exit_call.assert_not_called()
        assert from_env.is_dir()
        assert not (tmp_path / "install" / "data").exists()
        assert startup_messages(caplog, logging.INFO) == [f"Data folder: {from_env}"]

    def test_programmatic_folder_wins_over_the_config(
        self,
        tmp_path: Path,
        temp_storage_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        # The suite's isolated folder is set programmatically; startup must use it.
        _install_config(monkeypatch, tmp_path / "install", None)
        storage_paths.set_base_path(temp_storage_path)

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            app_module._check_data_folder()

        exit_call.assert_not_called()
        assert startup_messages(caplog, logging.INFO) == [f"Data folder: {temp_storage_path}"]


class TestStartupSequence:
    def test_data_folder_check_runs_before_the_key_check(self) -> None:
        order: list[str] = []

        with (
            patch.object(
                app_module, "_check_data_folder", side_effect=lambda: order.append("data folder")
            ),
            patch.object(
                app_module,
                "_check_encryption_key",
                side_effect=lambda: order.append("encryption key"),
            ),
            TestClient(app),
        ):
            pass

        assert order == ["data folder", "encryption key"]
