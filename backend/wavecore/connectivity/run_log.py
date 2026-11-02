"""The once-per-run log sink a block run carries for its connection lines (REQ-4.5.16)."""

import threading
from collections.abc import Callable
from contextvars import ContextVar


class RunLog:
    """One block run's log writer and the lines it already wrote."""

    def __init__(self, write: Callable[[str, str], object]) -> None:
        self._write = write
        self._written: set[tuple[str, str]] = set()
        self._guard = threading.Lock()

    def once(self, level: str, message: str) -> None:
        """Write the line unless this run already wrote it."""
        with self._guard:
            if (level, message) in self._written:
                return
            self._written.add((level, message))
        self._write(level, message)


RUN_LOG: ContextVar[RunLog | None] = ContextVar("wave_run_log", default=None)


def log_once(level: str, message: str) -> None:
    """Write a line once per block run; outside a run nothing is written."""
    sink = RUN_LOG.get()
    if sink is not None:
        sink.once(level, message)
