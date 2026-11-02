"""The held cancel and whole-block deadline a connecting core runs under (REQ-3.2.2.4, SQL-5)."""

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from typing import Any

from wavecore.plugins._process_group import RUNNING, HeldGroups

# The Timeout timer: DEADLINE(seconds, callback).
DEADLINE = threading.Timer


class Stopped(Exception):
    """A stopped run leaves at once; nobody awaits its outcome any more."""


class Live:
    """The run's resource as Stop and the deadline reach it."""

    def __init__(
        self,
        seconds: float,
        cancel: Callable[[Any], None],
        timeout_failure: Callable[[], Exception],
    ) -> None:
        self.seconds = seconds
        self._cancel = cancel
        self._timeout_failure = timeout_failure
        # Reentrant: on a remote host a stop can arrive as a signal on the thread holding it.
        self.lock = threading.RLock()
        self.resource: Any = None
        self.ended = False
        self.expired = False

    def stop(self) -> None:
        self._end()

    def expire(self) -> None:
        self.expired = True
        self._end()

    def _end(self) -> None:
        with self.lock:
            first = not self.ended
            self.ended = True
            resource = self.resource
        if first and resource is not None:
            self._canceled(resource)

    def _canceled(self, resource: Any) -> None:
        with suppress(Exception):
            self._cancel(resource)

    def attach(self, resource: Any) -> None:
        """Hand the cancel the resource; one that arrives after the end is canceled at once."""
        with self.lock:
            ended = self.ended
            self.resource = None if ended else resource
        if ended:
            self._canceled(resource)
        self.check()

    def detach(self, resource: Any) -> None:
        with self.lock:
            if self.resource is resource:
                self.resource = None

    def timed_out(self) -> None:
        if self.expired:
            raise self._timeout_failure()

    def check(self) -> None:
        self.timed_out()
        if self.ended:
            raise Stopped


@contextmanager
def held(live: Live) -> Iterator[Live]:
    """Hold the run's stop on `live` and arm its deadline while the core works."""
    running = RUNNING.get(None) or HeldGroups()
    running.hold_cancel(live.stop)
    timer = DEADLINE(live.seconds, live.expire)
    timer.daemon = True
    timer.start()
    try:
        yield live
    finally:
        running.release_cancel(live.stop)
        timer.cancel()
