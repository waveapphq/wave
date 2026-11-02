"""App startup refuses a host whose encoding is not UTF-8 (REQ-4.6.9)."""

import logging
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from wavecore.api import app as app_module

BACKEND_ROOT = Path(str(app_module.__file__)).resolve().parents[2]

NOT_UTF8 = (
    "WAVE needs UTF-8 and this host's encoding is {encoding}: "
    "set PYTHONUTF8=1 in the environment that starts WAVE"
)
NOT_UTF8_LINE = re.compile(
    r"^WAVE needs UTF-8 and this host's encoding is \S+: "
    r"set PYTHONUTF8=1 in the environment that starts WAVE$"
)
ERROR_LINE = re.compile(r"^\d{2}:\d{2}:\d{2}\.\d{3} ERROR (.+)$")


def _host_encoding(encoding: str) -> Any:
    """Make the host report this file-name encoding."""
    return patch.object(sys, "getfilesystemencoding", return_value=encoding)


def _start_wave(tmp_path: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """Import the app in a child Python, which is as far as a refused start gets."""
    script = tmp_path / "start_wave.py"
    script.write_text("import wavecore.api.app\n", encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(script)],
        cwd=str(tmp_path),
        env={**env, "PYTHONPATH": str(BACKEND_ROOT)},
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
        check=False,
    )


def _error_lines(done: subprocess.CompletedProcess[str]) -> list[str]:
    """The message of every ERROR line on the child's error output."""
    found = [ERROR_LINE.match(line) for line in done.stderr.splitlines()]
    return [match.group(1) for match in found if match]


class TestTextEncodingRefusals:
    @pytest.mark.parametrize("encoding", ["ascii", "iso8859-1", "Latin-1"])
    def test_other_encoding_logs_the_error_and_exits(
        self,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
        encoding: str,
    ) -> None:
        with _host_encoding(encoding), caplog.at_level(logging.INFO, logger=app_module.__name__):
            with pytest.raises(SystemExit):
                app_module._check_text_encoding()

        exit_call.assert_called_once_with(1)
        assert startup_messages(caplog, logging.ERROR) == [NOT_UTF8.format(encoding=encoding)]


class TestTextEncodingInUse:
    @pytest.mark.parametrize("encoding", ["utf-8", "UTF-8", "Utf-8"])
    def test_utf8_in_any_letter_case_is_not_refused(
        self,
        caplog: pytest.LogCaptureFixture,
        exit_call: MagicMock,
        startup_messages: Callable[..., list[str]],
        encoding: str,
    ) -> None:
        with _host_encoding(encoding), caplog.at_level(logging.INFO, logger=app_module.__name__):
            app_module._check_text_encoding()

        exit_call.assert_not_called()
        assert startup_messages(caplog, logging.ERROR) == []


class TestStartInAChildPython:
    def test_host_that_is_not_utf8_is_refused_with_exit_code_one(
        self, tmp_path: Path, non_utf8_child_env: dict[str, str]
    ) -> None:
        # Starts a child Python.
        done = _start_wave(tmp_path, non_utf8_child_env)

        assert done.returncode == 1
        errors = _error_lines(done)
        assert len(errors) == 1
        assert NOT_UTF8_LINE.match(errors[0])

    def test_same_host_with_utf8_mode_on_starts(
        self, tmp_path: Path, non_utf8_child_env: dict[str, str]
    ) -> None:
        # Starts a child Python.
        done = _start_wave(tmp_path, {**non_utf8_child_env, "PYTHONUTF8": "1"})

        assert done.returncode == 0
        assert _error_lines(done) == []

    def test_host_with_no_language_setting_starts(
        self, tmp_path: Path, non_utf8_child_env: dict[str, str]
    ) -> None:
        # Starts a child Python.
        left_to_python = {"PYTHONUTF8", "PYTHONCOERCECLOCALE"}
        env = {key: value for key, value in non_utf8_child_env.items() if key not in left_to_python}

        done = _start_wave(tmp_path, env)

        assert done.returncode == 0
        assert _error_lines(done) == []


class TestStartupSequence:
    def test_encoding_is_refused_before_any_other_startup_step(
        self, tmp_path: Path, non_utf8_child_env: dict[str, str]
    ) -> None:
        # Starts a child Python.
        unusable = {"WAVE_CONFIG_FILE": str(tmp_path / "missing.yaml"), "WAVE_LOG_LEVEL": "verbose"}

        done = _start_wave(tmp_path, {**non_utf8_child_env, **unusable})

        assert done.returncode == 1
        errors = _error_lines(done)
        assert len(errors) == 1
        assert NOT_UTF8_LINE.match(errors[0])
