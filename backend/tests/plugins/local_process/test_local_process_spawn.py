"""Local-process spawn: argv, cwd, environment, stdin, exit status and start errors.

REQ-3.4.1.1 and REQ-3.4.1.18: Shell Script and Shell Exec share one runtime core that
starts a program under the watchdog (SHRUN-15) and relays how it ended. The core builds no
block message; judge_outcome turns a start failure into the StartFailed text.
"""

import os
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Any

import pytest

from wavecore.plugins._local_process import (
    LaunchSpec,
    ProcessOutcome,
    _read_status,
    run_local_process,
)
from wavecore.plugins._local_process_runtime import judge_outcome

Spec = Callable[..., LaunchSpec]


@pytest.fixture
def spec(tmp_path: Path) -> Spec:
    """A quiet launch in tmp_path: no console, no patterns, a generous deadline."""

    def build(argv: list[str], **overrides: Any) -> LaunchSpec:
        fields: dict[str, Any] = {
            "argv": argv,
            "cwd": str(tmp_path),
            "env": dict(os.environ),
            "timeout": 10.0,
            "stream_output": False,
            "secret_streams": frozenset(),
            "pass_re": None,
            "fail_re": None,
            "logger": None,
        }
        fields.update(overrides)
        return LaunchSpec(**fields)

    return build


def status_of(payload: bytes) -> tuple[bool, int, str | None]:
    """Parse one status-pipe payload the way the core reads the watchdog's line."""
    read_fd, write_fd = os.pipe()
    os.write(write_fd, payload)
    os.close(write_fd)
    try:
        return _read_status(read_fd)
    finally:
        with suppress(OSError):
            os.close(read_fd)


@pytest.fixture
async def spawn_failure(tmp_path: Path, spec: Spec) -> ProcessOutcome:
    """A directory as argv[0]: executable, so Popen fails with EACCES."""
    return await run_local_process(spec([str(tmp_path)]))


class TestArgvCwdAndEnvironment:
    """What the author configured is what the program is started with."""

    async def test_argument_rows_reach_the_program_in_order(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(["/bin/sh", "-c", 'printf "%s|%s|%s" "$1" "$2" "$3"', "sh", "one", "", "two two"])
        )

        assert outcome.stdout == "one||two two"
        assert outcome.exit_code == 0
        assert outcome.ended_on_own is True
        assert outcome.stop is None
        assert outcome.start_error is None

    async def test_cwd_is_the_programs_working_directory(self, tmp_path: Path, spec: Spec) -> None:
        outcome = await run_local_process(spec(["/bin/sh", "-c", "pwd"], cwd=str(tmp_path)))

        assert os.path.realpath(outcome.stdout.strip()) == os.path.realpath(str(tmp_path))

    async def test_environment_reaches_the_program(self, spec: Spec) -> None:
        env = {**os.environ, "GREETING": "hello"}

        outcome = await run_local_process(
            spec(["/bin/sh", "-c", 'printf "%s" "$GREETING"'], env=env)
        )

        assert outcome.stdout == "hello"

    async def test_the_program_sees_the_launch_environment_only(
        self, monkeypatch: pytest.MonkeyPatch, spec: Spec
    ) -> None:
        monkeypatch.setenv("WAVE_LOCAL_PROCESS_PROBE", "server-value")

        outcome = await run_local_process(
            spec(["/bin/sh", "-c", 'printf "[%s]" "$WAVE_LOCAL_PROCESS_PROBE"'], env={"PATH": ""})
        )

        assert outcome.stdout == "[]"


class TestStandardInput:
    """The program is started on /dev/null, so nothing waits for input."""

    async def test_a_program_reading_stdin_gets_eof_at_once(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "if read line; then printf GOT; else printf EOF; fi"])
        )

        assert outcome.stdout == "EOF"
        assert outcome.exit_code == 0


class TestExitStatus:
    """The watchdog relays how the program ended."""

    async def test_a_non_zero_exit_is_relayed(self, spec: Spec) -> None:
        outcome = await run_local_process(spec(["/bin/sh", "-c", "exit 3"]))

        assert outcome.exit_code == 3
        assert outcome.ended_on_own is True

    async def test_death_by_signal_is_128_plus_the_signal(self, spec: Spec) -> None:
        outcome = await run_local_process(spec(["/bin/sh", "-c", "kill -TERM $$"]))

        assert outcome.exit_code == 143
        assert outcome.ended_on_own is True


class TestStatusPipeParsing:
    """The status line the watchdog writes back."""

    def test_an_exit_line_is_the_programs_own_end(self) -> None:
        assert status_of(b"exit 3\n") == (True, 3, None)

    def test_a_spawn_error_line_carries_the_os_text(self) -> None:
        assert status_of(b"spawn-error Permission denied\n") == (False, -1, "Permission denied")

    def test_an_empty_status_means_wave_killed_it(self) -> None:
        assert status_of(b"") == (False, 137, None)


class TestStartErrors:
    """A program that never started: exit code -1 and the StartFailed text (SHRUN-9)."""

    async def test_a_spawn_error_is_relayed_with_exit_code_minus_one(
        self, spawn_failure: ProcessOutcome
    ) -> None:
        assert spawn_failure.start_error == "Permission denied"
        assert spawn_failure.exit_code == -1
        assert spawn_failure.ended_on_own is False

    async def test_the_script_wording_of_a_start_failure(
        self, spawn_failure: ProcessOutcome
    ) -> None:
        assert judge_outcome(spawn_failure, "Script", 300, frozenset()) == (
            "Could not start the script: Permission denied",
            "StartFailed",
        )

    async def test_the_command_wording_of_a_start_failure(
        self, spawn_failure: ProcessOutcome
    ) -> None:
        assert judge_outcome(spawn_failure, "Command", 300, frozenset()) == (
            "Could not start the command: Permission denied",
            "StartFailed",
        )

    async def test_a_missing_working_directory_is_a_start_error(
        self, tmp_path: Path, spec: Spec
    ) -> None:
        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "true"], cwd=str(tmp_path / "gone"))
        )

        assert outcome.start_error == "No such file or directory"
        assert outcome.exit_code == -1
        assert outcome.ended_on_own is False
