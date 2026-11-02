"""Shared fixtures for workbench session artifact tests (REQ-3.7.1.4)."""

from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

import pytest

from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.workbench import _common as wb_common


@pytest.fixture(autouse=True)
def clear_workbench_and_execution_state(
    temp_storage_path: Path,
) -> Generator[None, None, None]:
    """Isolate workbench sessions and executions storage per test."""
    wb_common._clear_sessions_sync()
    exec_storage._clear_storage()
    yield
    wb_common._clear_sessions_sync()


def make_log_node(node_id: str = "node-log") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Log",
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": {"message": "'ok'", "level": "INFO"}, "profileBindings": []},
            "disabled": False,
            "displayName": "Log",
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def make_test_record(test_id: str, node_id: str = "node-log") -> dict[str, Any]:
    return {
        "id": test_id,
        "name": "Artifact Lifecycle Test",
        "workflow": {"nodes": [make_log_node(node_id)], "edges": []},
        "variables": {},
    }


def _close_and_mock(coro: Any, *_args: Any, **_kwargs: Any) -> Mock:
    """Stand-in for create_task: the run is never scheduled, so its coroutine is closed."""
    coro.close()
    return Mock()


@pytest.fixture
def workbench_run_mocks() -> Generator[dict[str, Any], None, None]:
    """Patch the workbench run preconditions; tests set holder["test"]."""
    holder: dict[str, Any] = {"test": None}
    with (
        patch(
            "wavecore.api.services.workbench.service.test_service.get_test",
            side_effect=lambda _tid: holder["test"],
        ),
        patch(
            "wavecore.api.services.workbench.service.test_service.validate_test",
            return_value={"fatal": False, "errors": [], "warnings": []},
        ),
        patch(
            "wavecore.api.services.workbench.service.environment_service.get_environment",
            return_value={"id": "env", "name": "Env"},
        ),
        patch(
            "wavecore.api.services.workbench.service.asyncio.create_task",
            side_effect=_close_and_mock,
        ),
    ):
        yield holder


def seed_tracked_execution(execution_id: str, artifact_dir: str) -> dict[str, Any]:
    """Seed an execution record (with artifact_dir) on disk and in cache."""
    import uuid

    record = {
        "id": execution_id,
        "name": "tracked-execution",
        "entity_type": "test",
        "entity_id": str(uuid.uuid4()),
        "environment_id": str(uuid.uuid4()),
        "status": "running",
        "started_at": "2026-06-09T12:00:00+00:00",
        "artifact_dir": artifact_dir,
    }
    exec_storage._save_execution(record)
    exec_storage._execution_storage[execution_id] = record
    return record
