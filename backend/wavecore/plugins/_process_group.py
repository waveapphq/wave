"""The one launcher and group kill every local process rides (REQ-3.2.2.4)."""

import os
import signal
import subprocess
from collections.abc import Callable
from contextlib import suppress
from contextvars import ContextVar
from typing import Any


def launch(argv: list[str], **settings: Any) -> subprocess.Popen[Any]:
    """Start argv as the leader of a fresh process group; settings pass through to Popen."""
    return subprocess.Popen(argv, start_new_session=True, **settings)


def kill_group(handle: subprocess.Popen[Any] | int) -> None:
    """Kill the whole group the handle (or group id) names; silent when it is already gone."""
    pgid = handle if isinstance(handle, int) else handle.pid
    _signal_group(pgid, signal.SIGKILL)


def terminate_group(pgid: int) -> None:
    """Send TERM to the whole group so its shell may run an exit handler; silent when gone."""
    _signal_group(pgid, signal.SIGTERM)


class HeldGroups:
    """The groups and cancels one caller holds; after a stop, one held late ends on arrival."""

    def __init__(self) -> None:
        self.handles: list[subprocess.Popen[Any]] = []
        self.cancels: list[Callable[[], None]] = []
        self.stopped = False

    def hold(self, handle: subprocess.Popen[Any]) -> None:
        # Held before the flag is read, so a stop running alongside either finds it or is seen here.
        self.handles.append(handle)
        if self.stopped:
            kill_group(handle)

    def release(self, handle: subprocess.Popen[Any]) -> None:
        self.handles.remove(handle)

    def hold_cancel(self, cancel: Callable[[], None]) -> None:
        """Hold an out-of-band cancel, such as a database's own statement cancel."""
        self.cancels.append(cancel)
        if self.stopped:
            _call(cancel)

    def release_cancel(self, cancel: Callable[[], None]) -> None:
        self.cancels.remove(cancel)

    def stop(self) -> None:
        self.stopped = True
        for handle in self.handles.copy():
            kill_group(handle)
        for cancel in self.cancels.copy():
            _call(cancel)


# The groups of the run in progress, for whatever launches a process or opens a connection.
RUNNING: ContextVar[HeldGroups] = ContextVar("wave_running")


def _call(cancel: Callable[[], None]) -> None:
    # One failing cancel never keeps the others from running.
    with suppress(Exception):
        cancel()


def _signal_group(pgid: int, signum: int) -> None:
    # 0 names the caller's own group and 1 is init, so only a launched group id is signaled.
    if pgid <= 1:
        return
    with suppress(ProcessLookupError):
        os.killpg(pgid, signum)
