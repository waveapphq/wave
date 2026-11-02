"""Shared fixtures for the app startup tests."""

import sys
from collections.abc import AsyncGenerator, Callable, Generator
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
async def _close_variable_pushes() -> AsyncGenerator[None, None]:
    """Cancel the variable pushes a test left pending, on the test's own event loop."""
    yield
    app_module = sys.modules.get("wavecore.api.app")
    service = getattr(app_module.app.state, "variable_push_service", None) if app_module else None
    if service is not None:
        await service.close()


@pytest.fixture
def exit_call() -> Generator[MagicMock, None, None]:
    from wavecore.api import app as app_module

    with patch.object(app_module.os, "_exit", side_effect=SystemExit(1)) as mock_exit:
        yield mock_exit


@pytest.fixture
def startup_messages() -> Callable[[pytest.LogCaptureFixture, int], list[str]]:
    """Read back what the app module logged at one level."""
    from wavecore.api import app as app_module

    def _messages(caplog: pytest.LogCaptureFixture, level: int) -> list[str]:
        return [
            record.getMessage()
            for record in caplog.records
            if record.name == app_module.__name__ and record.levelno == level
        ]

    return _messages
