"""App startup loads the config file and applies the log level (REQ-4.7.15, REQ-4.7.18)."""

import logging
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from wavecore.api import app as app_module
from wavecore.api.app import app
from wavecore.api.config import get_config, loader

pytestmark = pytest.mark.usefixtures("restore_log_levels")

UNKNOWN_ENV_LEVEL = "WAVE_LOG_LEVEL must be one of DEBUG, INFO, WARN, ERROR, FATAL: verbose"


@pytest.fixture(autouse=True)
def no_environment_level(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WAVE_LOG_LEVEL", raising=False)


def _start_with(monkeypatch: pytest.MonkeyPatch, config_file: Path | str) -> None:
    """Name the config file and drop the running config, as a fresh process finds them."""
    monkeypatch.setenv("WAVE_CONFIG_FILE", str(config_file))
    loader._config_instance = None


class TestConfigFileRefusals:
    def test_missing_file_logs_the_error_and_exits(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        missing = tmp_path / "missing.yaml"
        _start_with(monkeypatch, missing)

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            with pytest.raises(SystemExit):
                app_module._load_config()

        exit_call.assert_called_once_with(1)
        assert startup_messages(caplog, logging.ERROR) == [
            f"Config file not found: {missing} (set WAVE_CONFIG_FILE to use another file)"
        ]

    def test_relative_environment_path_logs_the_error_and_exits(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        _start_with(monkeypatch, "conf/wave.yaml")

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            with pytest.raises(SystemExit):
                app_module._load_config()

        exit_call.assert_called_once_with(1)
        assert startup_messages(caplog, logging.ERROR) == [
            "WAVE_CONFIG_FILE must be an absolute path: conf/wave.yaml"
        ]

    @pytest.mark.parametrize(
        ("content", "message"),
        [
            pytest.param(
                "- storage\n- logging\n",
                "Config file {path} does not hold a YAML mapping",
                id="not-a-mapping",
            ),
            pytest.param(
                "logging:\n  level: verbose\n",
                "Config file {path}: logging.level must be one of DEBUG, INFO, WARN, ERROR, FATAL",
                id="invalid-instance-setting",
            ),
            pytest.param(
                "server:\n  port: 70000\n",
                "Config file {path}: server.port must be a whole number from 1 to 65535",
                id="invalid-port",
            ),
        ],
    )
    def test_unusable_file_logs_the_error_and_exits(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
        content: str,
        message: str,
    ) -> None:
        path = tmp_path / "wave.yaml"
        path.write_text(content, encoding="utf-8")
        _start_with(monkeypatch, path)

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            with pytest.raises(SystemExit):
                app_module._load_config()

        exit_call.assert_called_once_with(1)
        assert startup_messages(caplog, logging.ERROR) == [message.format(path=path)]

    def test_unparsable_file_logs_one_line_and_exits(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        path = tmp_path / "wave.yaml"
        path.write_text("logging: [level\nstorage: {\n", encoding="utf-8")
        _start_with(monkeypatch, path)

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            with pytest.raises(SystemExit):
                app_module._load_config()

        exit_call.assert_called_once_with(1)
        errors = startup_messages(caplog, logging.ERROR)
        assert len(errors) == 1
        assert re.match(rf"^Config file {re.escape(str(path))} cannot be read: .+$", errors[0])
        assert "\n" not in errors[0]


class TestConfigFileInUse:
    def test_usable_file_is_loaded_and_returned(
        self,
        config_file: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        config_file.write_text("logging:\n  level: ERROR\n", encoding="utf-8")
        _start_with(monkeypatch, config_file)

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            config = app_module._load_config()

        exit_call.assert_not_called()
        assert config is get_config()
        assert config.config_file == config_file
        assert config.logging.level == "ERROR"
        assert startup_messages(caplog, logging.ERROR) == []

    def test_running_config_is_returned_as_it_is(self, exit_call: MagicMock) -> None:
        running = get_config()

        assert app_module._load_config() is running
        exit_call.assert_not_called()


class TestLogLevelAtStartup:
    def test_unknown_environment_level_logs_the_error_and_exits(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        monkeypatch.setenv("WAVE_LOG_LEVEL", "verbose")
        root_logger = logging.getLogger()
        before = root_logger.level

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            with pytest.raises(SystemExit):
                app_module._apply_log_level()

        exit_call.assert_called_once_with(1)
        assert startup_messages(caplog, logging.ERROR) == [UNKNOWN_ENV_LEVEL]
        assert root_logger.level == before

    def test_file_level_is_in_force_when_the_variable_is_unset(
        self, load_config: Callable[..., Any], exit_call: MagicMock
    ) -> None:
        load_config({"logging": {"level": "DEBUG"}})

        app_module._apply_log_level()

        exit_call.assert_not_called()
        assert logging.getLogger().level == logging.DEBUG

    def test_environment_level_overrides_the_file(
        self,
        load_config: Callable[..., Any],
        monkeypatch: pytest.MonkeyPatch,
        exit_call: MagicMock,
    ) -> None:
        monkeypatch.setenv("WAVE_LOG_LEVEL", "ERROR")
        load_config({"logging": {"level": "DEBUG"}})

        app_module._apply_log_level()

        exit_call.assert_not_called()
        assert logging.getLogger().level == logging.ERROR

    def test_empty_environment_level_is_not_refused_and_the_file_level_is_in_force(
        self,
        load_config: Callable[..., Any],
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        monkeypatch.setenv("WAVE_LOG_LEVEL", "")
        load_config({"logging": {"level": "DEBUG"}})

        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            app_module._apply_log_level()

        exit_call.assert_not_called()
        assert startup_messages(caplog, logging.ERROR) == []
        assert logging.getLogger().level == logging.DEBUG

    def test_level_is_info_when_neither_names_one(self, exit_call: MagicMock) -> None:
        logging.getLogger().setLevel(logging.ERROR)

        app_module._apply_log_level()

        exit_call.assert_not_called()
        assert logging.getLogger().level == logging.INFO

    @pytest.mark.parametrize(
        ("value", "python_level"),
        [
            ("debug", logging.DEBUG),
            ("warn", logging.WARNING),
            ("warning", logging.WARNING),
            ("CRITICAL", logging.CRITICAL),
            ("FATAL", logging.CRITICAL),
        ],
    )
    def test_environment_level_is_read_in_any_case_and_by_python_name(
        self,
        monkeypatch: pytest.MonkeyPatch,
        exit_call: MagicMock,
        value: str,
        python_level: int,
    ) -> None:
        monkeypatch.setenv("WAVE_LOG_LEVEL", value)

        app_module._apply_log_level()

        exit_call.assert_not_called()
        assert logging.getLogger().level == python_level

    @pytest.mark.parametrize(
        ("value", "python_level"),
        [
            ("debug", logging.DEBUG),
            ("WARN", logging.WARNING),
            ("warning", logging.WARNING),
            ("CRITICAL", logging.CRITICAL),
            ("fatal", logging.CRITICAL),
        ],
    )
    def test_file_level_is_read_in_any_case_and_by_python_name(
        self,
        load_config: Callable[..., Any],
        exit_call: MagicMock,
        value: str,
        python_level: int,
    ) -> None:
        load_config({"logging": {"level": value}})

        app_module._apply_log_level()

        exit_call.assert_not_called()
        assert logging.getLogger().level == python_level


class TestStartupSequence:
    def test_config_file_is_named_before_the_data_folder(
        self,
        config_file: Path,
        temp_storage_path: Path,
        caplog: pytest.LogCaptureFixture,
        startup_messages: Callable[..., list[str]],
    ) -> None:
        with caplog.at_level(logging.INFO, logger=app_module.__name__):
            with TestClient(app):
                pass

        lines = startup_messages(caplog, logging.INFO)
        config_line = f"Config file: {config_file}"
        data_line = f"Data folder: {temp_storage_path}"
        assert lines.count(config_line) == 1
        assert lines.count(data_line) == 1
        assert lines.index(config_line) < lines.index(data_line)
