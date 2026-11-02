"""Shared fixtures for browser-session-registry / WS-manager tracking tests.

The registry reset is guarded so the whole suite still collects.
"""

import contextlib
from collections.abc import Generator

import pytest


def _reset_session_registry() -> None:
    with contextlib.suppress(ImportError):
        from wavecore.api.websocket import session_registry

        session_registry.clear_sessions()


@pytest.fixture(autouse=True)
def reset_session_registry() -> Generator[None, None, None]:
    """Reset the in-memory browser-session registry before and after each test."""
    _reset_session_registry()
    yield
    _reset_session_registry()
