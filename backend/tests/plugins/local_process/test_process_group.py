"""The shared process-group launcher (REQ-3.2.2.4).

SHRUN-15: a block owns every process it starts, and a stop ends them, on the WAVE server and
on an execution host alike. This module is the one mechanism behind that rule. It starts a
child in a process group of its own, hands back a handle, and kills that whole group, so a
grandchild the child started dies with it. It stays standard library only and free of any
wavecore import, so the remote bundle can vendor it the way it vendors the file core.
"""

import ast
import contextvars
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import suppress
from pathlib import Path
from typing import Any, cast

import pytest

from wavecore.plugins import _process_group
from wavecore.plugins._process_group import HeldGroups, kill_group, launch, terminate_group

WAIT_S = 2.0
POLL_S = 0.005

_SOURCE = Path(str(_process_group.__file__)).read_text(encoding="utf-8")


def _imported_roots(source: str) -> set[str]:
    """The top-level package of every module the source imports."""
    roots: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            roots.add((node.module or "").split(".")[0])
    return roots


def _background_job(pid_file: Path) -> list[str]:
    """A shell that starts a grandchild, records its pid, then waits on it."""
    return ["/bin/sh", "-c", f'sleep 999 &\necho $! > "{pid_file}"\nwait\n']


def _gone(pid: int) -> bool:
    """Dead: no entry under /proc, or a zombie nobody has reaped yet."""
    try:
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    except OSError:
        return True
    return stat.rsplit(") ", 1)[-1].split(" ", 1)[0] == "Z"


def _until(check: Callable[[], bool], message: str) -> None:
    """Poll a condition to a short bound; the wait ends the moment it holds."""
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(POLL_S)
    raise AssertionError(message)


def _recorded_pid(pid_file: Path) -> int:
    """The pid the child wrote down for the grandchild it started."""
    _until(
        lambda: pid_file.exists() and pid_file.read_text(encoding="utf-8").strip() != "",
        f"{pid_file} was never written",
    )
    return int(pid_file.read_text(encoding="utf-8").strip())


def _end_group(pid: int) -> None:
    """Clean up what the test started, and only that."""
    with suppress(ProcessLookupError, PermissionError):
        group = os.getpgid(pid)
        if group not in (0, os.getpgid(0)):
            os.killpg(group, signal.SIGKILL)


@pytest.fixture
def started() -> Iterator[Callable[..., Any]]:
    """Starts children through the launcher and ends whatever outlives the test."""
    handles: list[Any] = []

    def start(argv: list[str], **settings: Any) -> Any:
        handle = launch(argv, **settings)
        handles.append(handle)
        return handle

    yield start
    for handle in handles:
        _end_group(handle.pid)
        with suppress(subprocess.TimeoutExpired):
            handle.wait(timeout=WAIT_S)


class TestAFreshProcessGroup:
    """A launched child leads a group of its own, and the handle names that child."""

    def test_the_child_leads_a_group_of_its_own(
        self, started: Callable[..., Any], tmp_path: Path
    ) -> None:
        handle = started(_background_job(tmp_path / "grandchild.pid"))

        assert os.getpgid(handle.pid) == handle.pid

    def test_the_child_is_not_in_the_callers_group(
        self, started: Callable[..., Any], tmp_path: Path
    ) -> None:
        handle = started(_background_job(tmp_path / "grandchild.pid"))

        assert os.getpgid(handle.pid) != os.getpgid(0)

    def test_the_handle_reports_how_the_child_ended(self, started: Callable[..., Any]) -> None:
        handle = started(["/bin/sh", "-c", "exit 7"])

        assert handle.wait(timeout=WAIT_S) == 7

    def test_launch_settings_reach_the_child(
        self, started: Callable[..., Any], tmp_path: Path
    ) -> None:
        written = tmp_path / "pwd.txt"

        with written.open("w") as stream:
            handle = started(["/bin/sh", "-c", "pwd"], cwd=str(tmp_path), stdout=stream)
            assert handle.wait(timeout=WAIT_S) == 0

        reported = written.read_text(encoding="utf-8").strip()
        assert os.path.realpath(reported) == os.path.realpath(str(tmp_path))


class TestTheGroupKill:
    """One call ends the child and everything the child started, and never complains."""

    def test_killing_ends_the_child(self, started: Callable[..., Any], tmp_path: Path) -> None:
        handle = started(_background_job(tmp_path / "grandchild.pid"))

        kill_group(handle)

        assert handle.wait(timeout=WAIT_S) == -signal.SIGKILL

    def test_killing_ends_a_grandchild_too(
        self, started: Callable[..., Any], tmp_path: Path
    ) -> None:
        pid_file = tmp_path / "grandchild.pid"
        handle = started(_background_job(pid_file))
        grandchild = _recorded_pid(pid_file)

        kill_group(handle)

        handle.wait(timeout=WAIT_S)
        _until(lambda: _gone(grandchild), f"pid {grandchild} is still running")

    def test_killing_a_group_that_already_ended_is_silent(
        self, started: Callable[..., Any]
    ) -> None:
        handle = started(["/bin/sh", "-c", "exit 0"])
        assert handle.wait(timeout=WAIT_S) == 0

        assert kill_group(handle) is None

    def test_killing_twice_is_silent(self, started: Callable[..., Any], tmp_path: Path) -> None:
        handle = started(_background_job(tmp_path / "grandchild.pid"))
        kill_group(handle)
        handle.wait(timeout=WAIT_S)

        assert kill_group(handle) is None


class KillRecorder:
    """Stands in for os.killpg, so a group signal is observed and never delivered."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, int]] = []

    def __call__(self, pgid: int, signal_number: int) -> None:
        self.calls.append((pgid, signal_number))


class FakeHandle:
    """A handle that only names the group its child leads."""

    def __init__(self, pid: int) -> None:
        self.pid = pid


@pytest.fixture
def signaled(monkeypatch: pytest.MonkeyPatch) -> KillRecorder:
    recorder = KillRecorder()
    monkeypatch.setattr(os, "killpg", recorder)
    return recorder


class TestTheGroupTerminate:
    """TERM reaches the child and everything the child started, and never complains."""

    def test_terminating_ends_the_child_with_term(
        self, started: Callable[..., Any], tmp_path: Path
    ) -> None:
        handle = started(_background_job(tmp_path / "grandchild.pid"))

        terminate_group(handle.pid)

        assert handle.wait(timeout=WAIT_S) == -signal.SIGTERM

    def test_terminating_reaches_a_grandchild_too(
        self, started: Callable[..., Any], tmp_path: Path
    ) -> None:
        pid_file = tmp_path / "grandchild.pid"
        handle = started(_background_job(pid_file))
        grandchild = _recorded_pid(pid_file)

        terminate_group(handle.pid)

        handle.wait(timeout=WAIT_S)
        _until(lambda: _gone(grandchild), f"pid {grandchild} is still running")

    def test_terminating_a_group_that_already_ended_is_silent(
        self, started: Callable[..., Any]
    ) -> None:
        handle = started(["/bin/sh", "-c", "exit 0"])
        assert handle.wait(timeout=WAIT_S) == 0

        assert terminate_group(handle.pid) is None

    def test_terminate_sends_term_to_the_named_group(self, signaled: KillRecorder) -> None:
        terminate_group(4242)

        assert signaled.calls == [(4242, signal.SIGTERM)]


class TestOnlyALaunchedGroupIsSignaled:
    """A group id of 0 (the caller's own group), 1 (init) or below is never signaled."""

    @pytest.mark.parametrize("pgid", [0, 1, -1])
    def test_kill_sends_nothing_to_a_group_id_that_names_no_launched_group(
        self, signaled: KillRecorder, pgid: int
    ) -> None:
        kill_group(pgid)

        assert signaled.calls == []

    @pytest.mark.parametrize("pgid", [0, 1, -1])
    def test_terminate_sends_nothing_to_a_group_id_that_names_no_launched_group(
        self, signaled: KillRecorder, pgid: int
    ) -> None:
        terminate_group(pgid)

        assert signaled.calls == []

    def test_kill_sends_kill_to_the_group_a_handle_leads(self, signaled: KillRecorder) -> None:
        kill_group(cast(subprocess.Popen[Any], FakeHandle(4242)))

        assert signaled.calls == [(4242, signal.SIGKILL)]

    def test_kill_sends_kill_to_a_group_id_above_one(self, signaled: KillRecorder) -> None:
        kill_group(2)

        assert signaled.calls == [(2, signal.SIGKILL)]


def _handle(pid: int) -> subprocess.Popen[Any]:
    return cast(subprocess.Popen[Any], FakeHandle(pid))


class TestHeldGroups:
    """A stop ends every group a caller holds; a group held after the stop ends on arrival."""

    def test_holding_a_group_signals_nothing_before_a_stop(self, signaled: KillRecorder) -> None:
        held = HeldGroups()

        held.hold(_handle(4242))

        assert signaled.calls == []

    def test_a_stop_kills_every_group_still_held(self, signaled: KillRecorder) -> None:
        held = HeldGroups()
        held.hold(_handle(4242))
        held.hold(_handle(4343))

        held.stop()

        assert signaled.calls == [(4242, signal.SIGKILL), (4343, signal.SIGKILL)]

    def test_a_group_released_before_the_stop_is_left_alone(self, signaled: KillRecorder) -> None:
        held = HeldGroups()
        handle = _handle(4242)
        held.hold(handle)
        held.release(handle)

        held.stop()

        assert signaled.calls == []

    def test_a_group_held_after_the_stop_is_killed_as_it_is_held(
        self, signaled: KillRecorder
    ) -> None:
        held = HeldGroups()
        held.stop()

        held.hold(_handle(4242))

        assert signaled.calls == [(4242, signal.SIGKILL)]


class CancelRecorder:
    """Out-of-band cancels that record their own name when called, and may raise."""

    def __init__(self, events: list[tuple[str, Any]] | None = None) -> None:
        self.events: list[tuple[str, Any]] = [] if events is None else events

    def cancel(self, name: str, error: Exception | None = None) -> Callable[[], None]:
        def call() -> None:
            self.events.append(("cancel", name))
            if error is not None:
                raise error

        return call

    def called(self) -> list[str]:
        return sorted(name for kind, name in self.events if kind == "cancel")


class TestHeldCancels:
    """A stop also calls every cancel a caller holds; a cancel held after the stop runs at once."""

    def test_holding_a_cancel_calls_nothing_before_a_stop(self, signaled: KillRecorder) -> None:
        held, cancels = HeldGroups(), CancelRecorder()

        held.hold_cancel(cancels.cancel("statement"))

        assert cancels.events == []

    def test_a_stop_calls_every_held_cancel_once(self, signaled: KillRecorder) -> None:
        held, cancels = HeldGroups(), CancelRecorder()
        held.hold_cancel(cancels.cancel("first"))
        held.hold_cancel(cancels.cancel("second"))

        held.stop()

        assert cancels.called() == ["first", "second"]

    def test_a_stop_kills_the_held_groups_and_calls_the_held_cancels(
        self, signaled: KillRecorder
    ) -> None:
        held, cancels = HeldGroups(), CancelRecorder()
        held.hold(_handle(4242))
        held.hold_cancel(cancels.cancel("statement"))

        held.stop()

        assert signaled.calls == [(4242, signal.SIGKILL)]
        assert cancels.called() == ["statement"]

    def test_the_groups_are_killed_before_any_cancel_is_called(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        events: list[tuple[str, Any]] = []
        monkeypatch.setattr(os, "killpg", lambda pgid, _signal: events.append(("kill", pgid)))
        held, cancels = HeldGroups(), CancelRecorder(events)
        held.hold_cancel(cancels.cancel("statement"))
        held.hold(_handle(4242))

        held.stop()

        assert events == [("kill", 4242), ("cancel", "statement")]

    def test_a_cancel_released_before_the_stop_is_never_called(
        self, signaled: KillRecorder
    ) -> None:
        held, cancels = HeldGroups(), CancelRecorder()
        released = cancels.cancel("released")
        held.hold_cancel(released)
        held.hold_cancel(cancels.cancel("kept"))
        held.release_cancel(released)

        held.stop()

        assert cancels.called() == ["kept"]

    def test_a_cancel_held_after_the_stop_is_called_as_it_is_held(
        self, signaled: KillRecorder
    ) -> None:
        held, cancels = HeldGroups(), CancelRecorder()
        held.stop()

        held.hold_cancel(cancels.cancel("late"))

        assert cancels.called() == ["late"]

    @pytest.mark.parametrize(
        "raising",
        ["first", "second", "third"],
        ids=["raising first", "raising in the middle", "raising last"],
    )
    def test_one_raising_cancel_does_not_stop_the_others(
        self, raising: str, signaled: KillRecorder
    ) -> None:
        held, cancels = HeldGroups(), CancelRecorder()
        for name in ("first", "second", "third"):
            error = OSError("cancel refused") if name == raising else None
            held.hold_cancel(cancels.cancel(name, error))
        held.hold(_handle(4242))

        held.stop()

        assert cancels.called() == ["first", "second", "third"]
        assert signaled.calls == [(4242, signal.SIGKILL)]

    def test_a_raising_cancel_never_reaches_the_caller_of_stop(
        self, signaled: KillRecorder
    ) -> None:
        held, cancels = HeldGroups(), CancelRecorder()
        held.hold_cancel(cancels.cancel("statement", RuntimeError("socket closed")))

        assert held.stop() is None

        assert cancels.called() == ["statement"]


class TestTheRunningGroups:
    """RUNNING carries the groups of the run in progress to whatever launches or connects."""

    def test_running_is_a_context_variable_named_wave_running(self) -> None:
        assert isinstance(_process_group.RUNNING, contextvars.ContextVar)
        assert _process_group.RUNNING.name == "wave_running"

    def test_running_is_unset_in_a_fresh_context(self) -> None:
        assert contextvars.Context().run(_process_group.RUNNING.get, None) is None


class TestTheLauncherStaysVendorable:
    """The module is copied verbatim onto a host, so it may lean on nothing but the stdlib."""

    def test_the_source_was_found(self) -> None:
        assert _SOURCE.strip()

    def test_imports_only_the_standard_library(self) -> None:
        assert _imported_roots(_SOURCE) <= set(sys.stdlib_module_names)

    def test_imports_nothing_from_wavecore(self) -> None:
        assert "wavecore" not in _imported_roots(_SOURCE)

    def test_makes_no_relative_import(self) -> None:
        assert not [
            node
            for node in ast.walk(ast.parse(_SOURCE))
            if isinstance(node, ast.ImportFrom) and node.level
        ]
