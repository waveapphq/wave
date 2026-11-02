"""The log level service: the level WAVE starts with and the Save path (REQ-4.7.18)."""

import logging
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from wavecore.api.config import ConfigValidationError, get_config
from wavecore.api.config.write_back import ConfigWriteError
from wavecore.api.services import log_level
from wavecore.core.logging import formatter

pytestmark = pytest.mark.usefixtures("restore_log_levels")

UNKNOWN_ENV_LEVEL = r"^WAVE_LOG_LEVEL must be one of DEBUG, INFO, WARN, ERROR, FATAL: verbose$"
INVALID_LEVEL = r"^Invalid log level: 'verbose'\. Must be one of: DEBUG, INFO, WARN, ERROR, FATAL$"


@pytest.fixture(autouse=True)
def no_environment_level(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WAVE_LOG_LEVEL", raising=False)


def _read_only_message(config_file: Path) -> str:
    path = re.escape(str(config_file))
    return rf"^Settings cannot be saved: the config file {path} is read-only$"


class TestEnvironmentVariable:
    def test_name_is_wave_log_level(self) -> None:
        assert log_level.ENV_VAR == "WAVE_LOG_LEVEL"


class TestStartupLevel:
    def test_file_level_when_the_variable_is_unset(self, load_config: Callable[..., Any]) -> None:
        load_config({"logging": {"level": "DEBUG"}})

        assert log_level.startup_level() == "DEBUG"

    def test_info_when_the_file_names_no_level(self) -> None:
        assert log_level.startup_level() == "INFO"

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("ERROR", "ERROR"),
            ("error", "ERROR"),
            ("Warn", "WARN"),
            ("warning", "WARN"),
            ("CRITICAL", "FATAL"),
            ("fatal", "FATAL"),
        ],
    )
    def test_canonical_environment_level_when_the_variable_is_set(
        self,
        load_config: Callable[..., Any],
        monkeypatch: pytest.MonkeyPatch,
        value: str,
        expected: str,
    ) -> None:
        load_config({"logging": {"level": "DEBUG"}})
        monkeypatch.setenv("WAVE_LOG_LEVEL", value)

        assert log_level.startup_level() == expected

    def test_unknown_environment_level_is_refused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("WAVE_LOG_LEVEL", "verbose")

        with pytest.raises(ConfigValidationError, match=UNKNOWN_ENV_LEVEL):
            log_level.startup_level()

    def test_empty_environment_level_counts_as_not_set(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        load_config({"logging": {"level": "DEBUG"}})
        monkeypatch.setenv("WAVE_LOG_LEVEL", "")

        assert log_level.startup_level() == "DEBUG"

    @pytest.mark.parametrize(
        ("written", "expected"),
        [
            ("warning", "WARN"),
            ("WARNING", "WARN"),
            ("critical", "FATAL"),
            ("debug", "DEBUG"),
        ],
    )
    def test_file_level_is_answered_by_its_canonical_name(
        self, load_config: Callable[..., Any], written: str, expected: str
    ) -> None:
        load_config({"logging": {"level": written}})

        assert log_level.startup_level() == expected
        assert get_config().logging.level == written

    def test_reading_the_level_does_not_apply_it(self, load_config: Callable[..., Any]) -> None:
        formatter.set_log_level("ERROR")
        load_config({"logging": {"level": "DEBUG"}})

        log_level.startup_level()

        assert formatter.get_log_level() == "ERROR"


class TestApplyStartupLevel:
    def test_applies_the_file_level(self, load_config: Callable[..., Any]) -> None:
        formatter.set_log_level("ERROR")
        load_config({"logging": {"level": "DEBUG"}})

        log_level.apply_startup_level()

        assert logging.getLogger().level == logging.DEBUG
        assert formatter.get_log_level() == "DEBUG"

    def test_applies_the_environment_level_over_the_file(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        load_config({"logging": {"level": "DEBUG"}})
        monkeypatch.setenv("WAVE_LOG_LEVEL", "ERROR")

        log_level.apply_startup_level()

        assert logging.getLogger().level == logging.ERROR
        assert formatter.get_log_level() == "ERROR"

    def test_unknown_environment_level_is_refused_and_nothing_is_applied(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        formatter.set_log_level("ERROR")
        monkeypatch.setenv("WAVE_LOG_LEVEL", "verbose")

        with pytest.raises(ConfigValidationError, match=UNKNOWN_ENV_LEVEL):
            log_level.apply_startup_level()

        assert formatter.get_log_level() == "ERROR"

    def test_empty_environment_level_applies_the_file_level(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        formatter.set_log_level("ERROR")
        load_config({"logging": {"level": "DEBUG"}})
        monkeypatch.setenv("WAVE_LOG_LEVEL", "")

        log_level.apply_startup_level()

        assert logging.getLogger().level == logging.DEBUG
        assert formatter.get_log_level() == "DEBUG"


class TestSave:
    def test_writes_the_file_applies_the_level_and_returns_it(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        formatter.set_log_level("ERROR")

        result = log_level.save("debug")

        assert result == "DEBUG"
        assert config_on_disk() == {"logging": {"level": "DEBUG"}}
        assert logging.getLogger().level == logging.DEBUG
        assert formatter.get_log_level() == "DEBUG"
        assert get_config().logging.level == "DEBUG"

    @pytest.mark.parametrize(
        ("given", "expected"),
        [("warning", "WARN"), ("CRITICAL", "FATAL"), ("Error", "ERROR")],
    )
    def test_writes_and_returns_the_canonical_name(
        self, config_on_disk: Callable[[], dict[str, Any]], given: str, expected: str
    ) -> None:
        assert log_level.save(given) == expected
        assert config_on_disk()["logging"]["level"] == expected
        assert formatter.get_log_level() == expected

    def test_changes_only_the_level_in_the_file(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        load_config(
            {
                "logging": {"level": "INFO", "output_dest": "stdout"},
                "secret_masking": {"run_output": True},
            }
        )

        log_level.save("ERROR")

        assert config_on_disk() == {
            "logging": {"level": "ERROR", "output_dest": "stdout"},
            "secret_masking": {"run_output": True},
        }

    def test_saved_level_is_the_startup_level_after_a_restart(
        self, load_config: Callable[..., Any]
    ) -> None:
        log_level.save("debug")

        load_config()

        assert get_config().logging.level == "DEBUG"
        assert log_level.startup_level() == "DEBUG"

    def test_environment_level_still_wins_at_the_next_start(
        self, config_on_disk: Callable[[], dict[str, Any]], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("WAVE_LOG_LEVEL", "ERROR")
        formatter.set_log_level("ERROR")

        result = log_level.save("debug")

        assert result == "DEBUG"
        assert config_on_disk()["logging"]["level"] == "DEBUG"
        assert formatter.get_log_level() == "DEBUG"
        assert log_level.startup_level() == "ERROR"

    def test_unknown_level_is_refused_and_nothing_changes(self, config_file: Path) -> None:
        formatter.set_log_level("ERROR")
        before = config_file.read_bytes()

        with pytest.raises(ValueError, match=INVALID_LEVEL):
            log_level.save("verbose")

        assert config_file.read_bytes() == before
        assert formatter.get_log_level() == "ERROR"
        assert get_config().logging.level == "INFO"

    def test_refused_write_leaves_the_level_and_the_file_unchanged(
        self, read_only_config: Path
    ) -> None:
        formatter.set_log_level("ERROR")
        before = read_only_config.read_bytes()

        with pytest.raises(ConfigWriteError, match=_read_only_message(read_only_config)):
            log_level.save("DEBUG")

        assert read_only_config.read_bytes() == before
        assert formatter.get_log_level() == "ERROR"
        assert get_config().logging.level == "INFO"
