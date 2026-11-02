"""Shared fixtures for execution artifact tests (REQ-3.7.1.x)."""

from collections.abc import Generator
from pathlib import Path

import pytest

from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.workbench import _common as wb_common


@pytest.fixture(autouse=True)
def clear_execution_and_session_state(
    temp_storage_path: Path,
) -> Generator[None, None, None]:
    """Isolate executions storage and workbench sessions per test."""
    exec_storage._clear_storage()
    wb_common._clear_sessions_sync()
    yield
    wb_common._clear_sessions_sync()
