"""Shared fixtures for workbench session-ownership tests.

Resets the in-memory ownership registry and workbench-session store around every
test. The ownership reset is guarded so the whole suite still collects.
"""

import contextlib
from collections.abc import Generator
from typing import Any

import pytest

from wavecore.api.services.workbench import _common as wb_common


class FrozenClock:
    """Deterministic stand-in for the monotonic clock, so grace windows are exact."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def frozen_clock(monkeypatch: pytest.MonkeyPatch) -> FrozenClock:
    """Replace ownership's monotonic source so away-reservation windows are exact."""
    from wavecore.api.services.workbench import ownership

    ticker = FrozenClock()
    monkeypatch.setattr(ownership, "_now", ticker)
    return ticker


def _current_app() -> Any:
    """The app object ownership will read.

    Resolved per test, never bound at import: another suite reloads
    ``wavecore.api.app``, which swaps in a fresh app carrying its own live
    WebSocket manager. An import-time binding would isolate the stale object
    while the code under test reads the new one.
    """
    from wavecore.api.app import app

    return app


@pytest.fixture(autouse=True)
def _reset_ownership() -> Generator[None, None, None]:
    _clear_ownership()
    wb_common._clear_sessions_sync()
    # Ownership recounts read app.state.ws_manager; isolate service-level tests
    # from the shared manager so a claim's recount is a deterministic no-op
    # (tests that need a manager set it explicitly).
    app = _current_app()
    original_ws_manager = getattr(app.state, "ws_manager", None)
    app.state.ws_manager = None
    yield
    app.state.ws_manager = original_ws_manager
    _clear_ownership()
    wb_common._clear_sessions_sync()


def _clear_ownership() -> None:
    with contextlib.suppress(ImportError):
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import events

        ownership.clear()
        # Emit tasks self-discard through a done callback, so a task scheduled
        # on an event loop that closed before it ran lingers in the set and
        # leaks into the next test's view of it.
        events._emit_tasks.clear()
