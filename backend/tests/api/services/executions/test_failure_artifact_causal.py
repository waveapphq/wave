"""Unit tests for the causal failure summary error.json (REQ-3.7.1.1).

A failed execution writes a single per-execution ``error.json`` (unversioned)
aggregating the ERROR/FATAL log entries that caused the failure - not a copy of
the whole log stream, and not one file per run. Shape:

    {"execution_id": <id>,
     "failures": [{"block_id", "scope_path", "level", "message", "timestamp"}]}

Each failure projects a causal log entry. INFO/WARN entries are excluded. A
passed run writes nothing.
"""

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import patch

from wavecore.api.services.executions import _sequential
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.storage_paths import get_artifacts_storage_path
from wavecore.api.services.workbench import _common as wb_common

TEST_ENV_ID = "env-test-00000000-0000-0000-0000-000000000001"

_FAILURE_KEYS = {"block_id", "scope_path", "level", "message", "timestamp"}


def _start_test_execution(entity_id: str) -> dict[str, Any]:
    with (
        patch.object(
            execution_service,
            "_get_entity",
            return_value={"id": entity_id, "name": "causal-error-test"},
        ),
        patch.object(execution_service, "_launch_execution_runner"),
    ):
        return execution_service.start_execution(
            entity_type="test",
            entity_id=entity_id,
            environment_id=TEST_ENV_ID,
        )


def _prime_session(session_id: str, test_id: str, *, error: str | None = "boom") -> None:
    session: dict[str, Any] = {
        "session_id": session_id,
        "test_id": test_id,
        "status": "running",
        "user_id": wb_common.DEFAULT_USER_ID,
        "variables": {},
        "block_states": {},
    }
    if error is not None:
        session["error"] = error
    wb_common._workbench_sessions[session_id] = session


def _append_log(execution_id: str, run_id: str, level: str, message: str, block_id: str) -> None:
    exec_storage._append_log(
        execution_id,
        run_id,
        {
            "level": level,
            "message": message,
            "blockId": block_id,
            "source": "PLUGIN",
            "timestamp": "2026-06-09T12:00:30Z",
        },
    )


def _execution_dir(execution: dict[str, Any]) -> Path:
    return get_artifacts_storage_path() / execution["artifact_dir"]


class TestCausalErrorArtifact:
    """A failed run writes error.json aggregating causal log entries."""

    def test_failed_run_writes_single_unversioned_error_json(self) -> None:
        entity_id = str(uuid.uuid4())
        execution = _start_test_execution(entity_id)
        run_id = execution["id"]
        _append_log(execution["id"], run_id, "ERROR", "db connection refused", "blk-db")
        _prime_session(execution["id"], entity_id)

        execution_service._on_workbench_session_terminated(execution["id"], "failed")

        directory = _execution_dir(execution)
        assert (directory / "error.json").is_file()
        assert sorted(p.name for p in directory.glob("error*.json")) == ["error.json"]

    def test_error_json_shape_and_projection(self) -> None:
        entity_id = str(uuid.uuid4())
        execution = _start_test_execution(entity_id)
        run_id = execution["id"]
        _append_log(execution["id"], run_id, "ERROR", "db connection refused", "blk-db")
        _prime_session(execution["id"], entity_id)

        execution_service._on_workbench_session_terminated(execution["id"], "failed")

        payload = json.loads((_execution_dir(execution) / "error.json").read_text())
        assert payload["execution_id"] == execution["id"]
        assert isinstance(payload["failures"], list)
        failure = next(f for f in payload["failures"] if f["message"] == "db connection refused")
        assert set(failure.keys()) == _FAILURE_KEYS
        assert failure["level"] == "ERROR"
        assert failure["block_id"] == "blk-db"
        assert failure["timestamp"] == "2026-06-09T12:00:30Z"
        assert isinstance(failure["scope_path"], str)

    def test_only_error_and_fatal_levels_are_aggregated(self) -> None:
        entity_id = str(uuid.uuid4())
        execution = _start_test_execution(entity_id)
        run_id = execution["id"]
        _append_log(execution["id"], run_id, "INFO", "starting", "blk-1")
        _append_log(execution["id"], run_id, "WARN", "slow query", "blk-2")
        _append_log(execution["id"], run_id, "ERROR", "query failed", "blk-3")
        _append_log(execution["id"], run_id, "FATAL", "engine panic", "blk-4")
        _prime_session(execution["id"], entity_id)

        execution_service._on_workbench_session_terminated(execution["id"], "failed")

        payload = json.loads((_execution_dir(execution) / "error.json").read_text())
        levels = {f["level"] for f in payload["failures"]}
        messages = {f["message"] for f in payload["failures"]}
        assert levels == {"ERROR", "FATAL"}
        assert messages == {"query failed", "engine panic"}
        assert "starting" not in messages
        assert "slow query" not in messages

    def test_passed_run_writes_no_error_json(self) -> None:
        entity_id = str(uuid.uuid4())
        execution = _start_test_execution(entity_id)
        run_id = execution["id"]
        _append_log(execution["id"], run_id, "ERROR", "transient", "blk-1")
        _prime_session(execution["id"], entity_id)

        execution_service._on_workbench_session_terminated(execution["id"], "passed")

        directory = _execution_dir(execution)
        assert not (directory / "error.json").exists()
        assert list(directory.glob("error*.json")) == []

    def test_terminal_callback_is_idempotent(self) -> None:
        entity_id = str(uuid.uuid4())
        execution = _start_test_execution(entity_id)
        run_id = execution["id"]
        _append_log(execution["id"], run_id, "ERROR", "once", "blk-1")
        _prime_session(execution["id"], entity_id)

        execution_service._on_workbench_session_terminated(execution["id"], "failed")
        execution_service._on_workbench_session_terminated(execution["id"], "failed")

        directory = _execution_dir(execution)
        assert sorted(p.name for p in directory.glob("error*.json")) == ["error.json"]


def _start_suite_execution(suite_id: str, test_ids: list[str]) -> dict[str, Any]:
    entity = {"id": suite_id, "name": "causal-error-suite", "tests": test_ids}
    with (
        patch.object(execution_service, "_get_entity", return_value=entity),
        patch.object(execution_service, "_launch_execution_runner"),
    ):
        return execution_service.start_execution(
            entity_type="suite",
            entity_id=suite_id,
            environment_id=TEST_ENV_ID,
        )


class TestSuiteChildCausalError:
    """A failed sequential child refreshes the parent's causal error.json."""

    def _register_child(self, execution_id: str, run_id: str) -> str:
        child_id = str(uuid.uuid4())
        _sequential._child_sessions[child_id] = {
            "parent_id": execution_id,
            "run_id": run_id,
            "event": asyncio.Event(),
            "result": {"status": "failed", "halt_scope": None},
        }
        return child_id

    def test_failed_child_writes_parent_causal_error_json(self) -> None:
        suite_id = str(uuid.uuid4())
        execution = _start_suite_execution(suite_id, [str(uuid.uuid4())])
        run_id = exec_storage._load_composition(execution["id"])["suites"][0]["tests"][0]["run_id"]
        exec_storage._append_chronology(execution["id"], {"type": "test", "run_id": run_id})
        _append_log(execution["id"], run_id, "ERROR", "child boom", "blk-c")
        try:
            child_id = self._register_child(execution["id"], run_id)
            execution_service._on_workbench_session_terminated(child_id, "failed")
        finally:
            _sequential._child_sessions.clear()

        payload = json.loads((_execution_dir(execution) / "error.json").read_text())
        assert payload["execution_id"] == execution["id"]
        assert "child boom" in {failure["message"] for failure in payload["failures"]}

    def test_passed_child_writes_no_error_json(self) -> None:
        suite_id = str(uuid.uuid4())
        execution = _start_suite_execution(suite_id, [str(uuid.uuid4())])
        run_id = exec_storage._load_composition(execution["id"])["suites"][0]["tests"][0]["run_id"]
        try:
            child_id = self._register_child(execution["id"], run_id)
            execution_service._on_workbench_session_terminated(child_id, "passed")
        finally:
            _sequential._child_sessions.clear()

        assert not (_execution_dir(execution) / "error.json").exists()


class TestScopePathsByRun:
    """_scope_paths_by_run maps run_id -> <suite>/<test>, skipping run-less tests."""

    def test_skips_run_less_tests_and_handles_suiteless_tests(self) -> None:
        composition = {
            "suites": [
                {
                    "name": "smoke",
                    "tests": [{"name": "not-started"}, {"run_id": "r2", "name": "login"}],
                },
                {"name": "", "tests": [{"run_id": "r3", "name": "standalone"}]},
            ]
        }

        scopes = execution_service._scope_paths_by_run(composition)

        assert scopes == {"r2": "smoke/login", "r3": "standalone"}
