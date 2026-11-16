"""The watchdog relays the program's status and kills the group (REQ-3.2.2.4).

SHRUN-15: WAVE starts the watchdog, the watchdog starts the program in the watchdog's own
group, and that group is killed when the lifeline breaks or once the program has ended. A
group TERM (a pattern stop) is for the program: the watchdog keeps waiting and relays. The
cases here run in-process with os, signal and subprocess patched, so no signal reaches a
real group and no handler is installed in the test process.
"""

import asyncio
import os
import runpy
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from wavecore.plugins import _local_process, _local_process_watchdog
from wavecore.plugins._local_process import LaunchSpec, run_local_process
from wavecore.plugins._local_process_watchdog import main, status_line, watch_lifeline

WATCHDOG_FILE = Path(str(_local_process_watchdog.__file__))

_HELD_FDS: list[int] = []


def held_lifeline() -> int:
    """A lifeline read end whose write end stays open, so the reader thread never wakes."""
    read_fd, write_fd = os.pipe()
    _HELD_FDS.append(write_fd)
    return read_fd


def held_status() -> tuple[int, int]:
    """A status pipe whose write end outlives the call, so reading it needs no EOF."""
    read_fd, write_fd = os.pipe()
    _HELD_FDS.append(write_fd)
    return read_fd, write_fd


def status_text(read_fd: int) -> str:
    """Whatever the watchdog wrote back to WAVE."""
    os.set_blocking(read_fd, False)
    try:
        return os.read(read_fd, 4096).decode()
    except BlockingIOError:
        return ""
    finally:
        os.close(read_fd)


def no_kill(pgid: int) -> None:
    """The group kill is inert while the launch itself is under test."""


class KillRecorder:
    """Stands in for os.killpg, so a group kill is observed and never delivered."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, int]] = []

    def __call__(self, pgid: int, signal_number: int) -> None:
        self.calls.append((pgid, signal_number))


class SignalRecorder:
    """Stands in for signal.signal, so a handler is observed and never installed."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, Any]] = []

    def __call__(self, signal_number: int, handler: Any) -> None:
        self.calls.append((signal_number, handler))

    def handler_for(self, signal_number: int) -> Any:
        return dict(self.calls)[signal_number]


class FakeChild:
    def __init__(self, returncode: int) -> None:
        self.pid = -1
        self.returncode = returncode

    def wait(self) -> int:
        return self.returncode


class PopenRecorder:
    """Stands in for subprocess.Popen: records the call, then answers or fails."""

    def __init__(self, returncode: int = 0, error: OSError | None = None) -> None:
        self.calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
        self.returncode = returncode
        self.error = error

    def __call__(self, *args: Any, **kwargs: Any) -> FakeChild:
        self.calls.append((args, kwargs))
        if self.error is not None:
            raise self.error
        return FakeChild(self.returncode)


class PopenAfterHandler(PopenRecorder):
    """A spawn that notes whether the TERM handler was already in place when it ran."""

    def __init__(self, handlers: SignalRecorder) -> None:
        super().__init__(returncode=0)
        self.handlers = handlers
        self.term_handled_at_spawn = False

    def __call__(self, *args: Any, **kwargs: Any) -> FakeChild:
        self.term_handled_at_spawn = signal.SIGTERM in dict(self.handlers.calls)
        return super().__call__(*args, **kwargs)


class FakeProcess:
    """A watchdog that ends at once without writing to either stream."""

    def __init__(self) -> None:
        self.pid = -1
        self.returncode = 0

    async def wait(self) -> int:
        return 0


def lead_own_group(monkeypatch: pytest.MonkeyPatch, leads: bool) -> None:
    """Whether the watchdog leads its group, the way start_new_session makes it lead."""
    pid = os.getpid()
    monkeypatch.setattr(os, "getpgrp", lambda: pid if leads else pid + 1)


@pytest.fixture
def killed(monkeypatch: pytest.MonkeyPatch) -> KillRecorder:
    recorder = KillRecorder()
    monkeypatch.setattr(os, "killpg", recorder)
    lead_own_group(monkeypatch, leads=True)
    return recorder


@pytest.fixture
def not_leading(monkeypatch: pytest.MonkeyPatch, killed: KillRecorder) -> KillRecorder:
    lead_own_group(monkeypatch, leads=False)
    return killed


@pytest.fixture(autouse=True)
def handlers(monkeypatch: pytest.MonkeyPatch) -> SignalRecorder:
    recorder = SignalRecorder()
    monkeypatch.setattr(signal, "signal", recorder)
    return recorder


def relay(monkeypatch: pytest.MonkeyPatch, popen: PopenRecorder, program: list[str]) -> str:
    """Run the watchdog over one program and hand back what it wrote to WAVE."""
    monkeypatch.setattr(subprocess, "Popen", popen)
    status_r, status_w = held_status()
    main([str(held_lifeline()), str(status_w), *program])
    return status_text(status_r)


def quiet_spec(cwd: Path) -> LaunchSpec:
    return LaunchSpec(
        argv=["/bin/sh", "-c", "true"],
        cwd=str(cwd),
        env=dict(os.environ),
        timeout=10.0,
        stream_output=False,
        secret_streams=frozenset(),
        pass_re=None,
        fail_re=None,
        logger=None,
    )


class TestStatusLine:
    """The exit code WAVE reads back, with a signal death counted the way a shell counts it."""

    def test_the_status_line_of_a_normal_exit(self) -> None:
        assert status_line(3) == "exit 3"

    def test_the_status_line_of_a_signal_death(self) -> None:
        assert status_line(-9) == "exit 137"


class TestStatusRelay:
    """The status goes to WAVE first, then the group dies."""

    def test_the_exit_status_is_relayed_then_the_group_is_killed(
        self, monkeypatch: pytest.MonkeyPatch, killed: KillRecorder
    ) -> None:
        status = relay(monkeypatch, PopenRecorder(returncode=3), ["/bin/sh", "-c", "exit 3"])

        assert status == "exit 3\n"
        assert killed.calls == [(0, signal.SIGKILL)]

    def test_a_spawn_error_is_relayed_then_the_group_is_killed(
        self, monkeypatch: pytest.MonkeyPatch, killed: KillRecorder
    ) -> None:
        popen = PopenRecorder(error=OSError(13, "Permission denied"))

        status = relay(monkeypatch, popen, ["/no/such/program"])

        assert status == "spawn-error Permission denied\n"
        assert killed.calls == [(0, signal.SIGKILL)]

    def test_the_program_stays_in_the_watchdogs_own_group(
        self, monkeypatch: pytest.MonkeyPatch, killed: KillRecorder
    ) -> None:
        popen = PopenRecorder(returncode=0)

        relay(monkeypatch, popen, ["/bin/sh", "-c", "true"])

        args, kwargs = popen.calls[0]
        assert args[0] == ["/bin/sh", "-c", "true"]
        assert kwargs["close_fds"] is True
        assert not kwargs.get("start_new_session")
        assert kwargs.get("stdout") is None
        assert kwargs.get("stderr") is None

    def test_the_watchdog_writes_nothing_to_stdout_or_stderr(
        self,
        monkeypatch: pytest.MonkeyPatch,
        killed: KillRecorder,
        capfd: pytest.CaptureFixture[str],
    ) -> None:
        relay(monkeypatch, PopenRecorder(returncode=0), ["/bin/sh", "-c", "true"])

        captured = capfd.readouterr()
        assert captured.out == ""
        assert captured.err == ""


class TestGroupTerm:
    """A TERM sent to the group is for the program; the watchdog keeps waiting."""

    def test_the_watchdog_holds_a_no_op_term_handler(
        self, monkeypatch: pytest.MonkeyPatch, killed: KillRecorder, handlers: SignalRecorder
    ) -> None:
        relay(monkeypatch, PopenRecorder(returncode=0), ["/bin/sh", "-c", "sleep 30"])

        handler = handlers.handler_for(signal.SIGTERM)
        assert callable(handler)
        assert handler not in (signal.SIG_IGN, signal.SIG_DFL)
        assert handler(signal.SIGTERM, None) is None

    def test_the_handler_is_in_place_before_the_program_starts(
        self, monkeypatch: pytest.MonkeyPatch, killed: KillRecorder, handlers: SignalRecorder
    ) -> None:
        popen = PopenAfterHandler(handlers)

        relay(monkeypatch, popen, ["/bin/sh", "-c", "sleep 30"])

        assert popen.term_handled_at_spawn is True

    def test_the_program_is_not_started_with_term_ignored(
        self, monkeypatch: pytest.MonkeyPatch, killed: KillRecorder, handlers: SignalRecorder
    ) -> None:
        relay(monkeypatch, PopenRecorder(returncode=0), ["/bin/sh", "-c", "sleep 30"])

        assert signal.SIG_IGN not in [handler for _, handler in handlers.calls]

    def test_a_status_is_still_relayed_after_the_handler_ran(
        self, monkeypatch: pytest.MonkeyPatch, killed: KillRecorder, handlers: SignalRecorder
    ) -> None:
        status = relay(monkeypatch, PopenRecorder(returncode=-15), ["/bin/sh", "-c", "sleep 30"])

        handlers.handler_for(signal.SIGTERM)(signal.SIGTERM, None)
        assert status == "exit 143\n"
        assert killed.calls == [(0, signal.SIGKILL)]


class TestLifelineWatch:
    """WAVE closing the lifeline, or dying, kills the group the watchdog leads."""

    def test_lifeline_eof_kills_the_watchdogs_group(self, killed: KillRecorder) -> None:
        read_fd, write_fd = os.pipe()
        os.close(write_fd)

        watch_lifeline(read_fd)

        assert killed.calls == [(0, signal.SIGKILL)]
        os.close(read_fd)

    def test_a_broken_lifeline_kills_the_watchdogs_group(self, killed: KillRecorder) -> None:
        read_fd, write_fd = os.pipe()
        os.close(read_fd)
        os.close(write_fd)

        watch_lifeline(read_fd)

        assert killed.calls == [(0, signal.SIGKILL)]


class TestOwnGroupOnly:
    """The watchdog kills only a group it leads, never the group of whoever started it."""

    def test_the_group_the_watchdog_leads_is_killed_after_the_relay(
        self, monkeypatch: pytest.MonkeyPatch, killed: KillRecorder
    ) -> None:
        relay(monkeypatch, PopenRecorder(returncode=0), ["/bin/sh", "-c", "true"])

        assert killed.calls == [(0, signal.SIGKILL)]

    def test_a_group_the_watchdog_does_not_lead_is_not_killed_after_the_relay(
        self, monkeypatch: pytest.MonkeyPatch, not_leading: KillRecorder
    ) -> None:
        status = relay(monkeypatch, PopenRecorder(returncode=0), ["/bin/sh", "-c", "true"])

        assert status == "exit 0\n"
        assert not_leading.calls == []

    def test_a_group_the_watchdog_does_not_lead_is_not_killed_when_the_lifeline_ends(
        self, not_leading: KillRecorder
    ) -> None:
        read_fd, write_fd = os.pipe()
        os.close(write_fd)

        watch_lifeline(read_fd)

        assert not_leading.calls == []
        os.close(read_fd)


class TestEntryPoint:
    """How the watchdog is entered, and how WAVE starts it."""

    def test_the_main_entry_runs_the_watchdog(
        self, monkeypatch: pytest.MonkeyPatch, killed: KillRecorder
    ) -> None:
        monkeypatch.setattr(subprocess, "Popen", PopenRecorder(returncode=0))
        status_r, status_w = held_status()
        argv = [
            str(WATCHDOG_FILE),
            str(held_lifeline()),
            str(status_w),
            "/bin/sh",
            "-c",
            "true",
        ]
        monkeypatch.setattr(sys, "argv", argv)

        runpy.run_path(str(WATCHDOG_FILE), run_name="__main__")

        assert status_text(status_r) == "exit 0\n"
        assert killed.calls == [(0, signal.SIGKILL)]

    async def test_wave_starts_the_watchdog_isolated_by_absolute_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        recorded: list[Any] = []

        async def fake_exec(*args: Any, **kwargs: Any) -> FakeProcess:
            recorded.extend(args)
            return FakeProcess()

        monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
        monkeypatch.setattr(_local_process, "_kill_group", no_kill)

        await run_local_process(quiet_spec(tmp_path))

        assert recorded[0] == sys.executable
        assert recorded[1] == "-I"
        assert Path(recorded[2]) == WATCHDOG_FILE
        assert WATCHDOG_FILE.is_absolute()
        assert _local_process.WATCHDOG_PATH == WATCHDOG_FILE
        assert "-m" not in recorded
