"""Shared fixtures and fabrication helpers for the MCP server tests."""

import contextlib
import socket
import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import yaml

_BASE_TIME = datetime(2026, 7, 16, 9, 30, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Runtime-state isolation
# ---------------------------------------------------------------------------


def _reset_mcp_runtime_state() -> None:
    with contextlib.suppress(ImportError):
        from wavecore.mcp import state as mcp_state

        mcp_state.set_until_restart(False)
        mcp_state.set_last_error(None)
        mcp_state.clear_sessions()
        mcp_state.clear_activity()
    # A run-borrowed ownership slot only releases on the run's terminal; with the
    # engine mocked inert that terminal never fires, so the slot must be reset here.
    from wavecore.api.services.workbench import ownership

    ownership.clear()


@pytest.fixture(autouse=True)
def reset_mcp_runtime() -> Generator[None, None, None]:
    """Reset the in-memory MCP runtime state (flag, sessions, activity, error)."""
    _reset_mcp_runtime_state()
    yield
    _reset_mcp_runtime_state()


# ---------------------------------------------------------------------------
# Networking helpers
# ---------------------------------------------------------------------------


def free_port() -> int:
    """Grab an ephemeral localhost port that is free right now."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def port_is_open(port: int) -> bool:
    """True when a TCP connect to 127.0.0.1:port succeeds."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Registry seeding (mirrors app.py startup registration)
# ---------------------------------------------------------------------------


@pytest.fixture
def seed_registries() -> Generator[None, None, None]:
    """Register all 15 core controls and all 39 plugins like app startup does."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins import (
        CSVParserPlugin,
        ExcelParserPlugin,
        FileIOPlugin,
        HelmInstallPlugin,
        HelmRollbackPlugin,
        HelmStatusPlugin,
        HelmTestPlugin,
        HelmUninstallPlugin,
        HelmUpgradePlugin,
        HTTPClientPlugin,
        JSONParserPlugin,
        K8sApplyPlugin,
        K8sConnectPlugin,
        K8sCopyPlugin,
        K8sDeletePlugin,
        K8sEventsPlugin,
        K8sExecPlugin,
        K8sGetPlugin,
        K8sLogsPlugin,
        K8sRolloutPlugin,
        K8sScalePlugin,
        K8sScriptPlugin,
        K8sTopPlugin,
        LogPlugin,
        NetcatPlugin,
        OpenSearchPlugin,
        PingPlugin,
        PythonPlugin,
        SFTPPlugin,
        ShellExecPlugin,
        ShellScriptPlugin,
        SQLClientPlugin,
        SSHSessionClosePlugin,
        SSHSessionExecPlugin,
        SSHSessionOpenPlugin,
        SSHSessionScriptPlugin,
        SSHTunnelClosePlugin,
        SSHTunnelOpenPlugin,
        XMLParserPlugin,
    )

    plugin_classes: list[type] = [
        CSVParserPlugin,
        ExcelParserPlugin,
        FileIOPlugin,
        HelmInstallPlugin,
        HelmRollbackPlugin,
        HelmStatusPlugin,
        HelmTestPlugin,
        HelmUninstallPlugin,
        HelmUpgradePlugin,
        HTTPClientPlugin,
        JSONParserPlugin,
        K8sApplyPlugin,
        K8sConnectPlugin,
        K8sCopyPlugin,
        K8sDeletePlugin,
        K8sEventsPlugin,
        K8sExecPlugin,
        K8sGetPlugin,
        K8sLogsPlugin,
        K8sRolloutPlugin,
        K8sScalePlugin,
        K8sScriptPlugin,
        K8sTopPlugin,
        LogPlugin,
        NetcatPlugin,
        OpenSearchPlugin,
        PingPlugin,
        PythonPlugin,
        SFTPPlugin,
        ShellExecPlugin,
        ShellScriptPlugin,
        SQLClientPlugin,
        SSHSessionClosePlugin,
        SSHSessionExecPlugin,
        SSHSessionOpenPlugin,
        SSHSessionScriptPlugin,
        SSHTunnelClosePlugin,
        SSHTunnelOpenPlugin,
        XMLParserPlugin,
    ]

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    for plugin_class in plugin_classes:
        register_plugin(plugin_class())
    yield
    # Fully undo the seeding: register_all_core_controls skip-if-present would
    # otherwise let test-local subclass versions leak into later test files.
    clear_registry()
    _registry.clear()


REAL_PLUGIN_IDS = {
    "csv-parser",
    "excel-parser",
    "file-io",
    "http-client",
    "json-parser",
    "k8s-apply",
    "k8s-connect",
    "k8s-copy",
    "k8s-delete",
    "k8s-events",
    "k8s-exec",
    "k8s-get",
    "k8s-logs",
    "k8s-rollout",
    "k8s-scale",
    "k8s-script",
    "k8s-top",
    "helm-install",
    "helm-upgrade",
    "helm-rollback",
    "helm-uninstall",
    "helm-test",
    "helm-status",
    "log",
    "netcat",
    "opensearch",
    "ping",
    "python",
    "sftp",
    "shell-exec",
    "shell-script",
    "ssh-session-close",
    "ssh-session-exec",
    "ssh-session-open",
    "ssh-session-script",
    "ssh-tunnel-close",
    "ssh-tunnel-open",
    "sql-client",
    "xml-parser",
}

CONTROL_IDS = {
    "if-else",
    "switch-case",
    "assert",
    "for",
    "for-each",
    "while",
    "break",
    "continue",
    "parallel",
    "try-catch-finally",
    "halt",
    "variable-setter",
    "delay",
    "wait-until",
    "note",
}


# ---------------------------------------------------------------------------
# Execution-state isolation + workbench mock
# ---------------------------------------------------------------------------


def _clear_execution_state() -> None:
    from wavecore.api.services import log_streaming_service
    from wavecore.api.services.executions import _storage as exec_storage
    from wavecore.api.services.workbench import _common as wb_common

    exec_storage._clear_storage()
    wb_common._clear_sessions_sync()
    log_streaming_service._session_logs.clear()
    log_streaming_service._clear_cache()
    from wavecore.api.services.reports import jobs

    jobs.clear_jobs()


@pytest.fixture
def clear_execution_state(temp_storage_path: Path) -> Generator[None, None, None]:
    """Isolate executions storage, workbench sessions, log buffers, report jobs."""
    _clear_execution_state()
    yield
    _clear_execution_state()


@pytest.fixture
def mock_workbench_start() -> Generator[Any, None, None]:
    """No-op the workbench engine so test-type executions start without a run."""
    from wavecore.api.services.workbench import service as workbench_service

    with patch.object(workbench_service, "start_workbench_run") as mock_start:
        mock_start.return_value = {
            "session_id": "mock-session",
            "status": "running",
            "websocket_topic": "workbench:mock-session",
            "warnings": [],
        }
        yield mock_start


@pytest.fixture
def mock_sequential_start() -> Generator[Any, None, None]:
    """No-op the sequential driver so suite/regression executions stay inert."""
    with patch(
        "wavecore.api.services.executions._sequential.start_sequential_execution"
    ) as mock_start:
        mock_start.return_value = None
        yield mock_start


# ---------------------------------------------------------------------------
# Entity seeding helpers
# ---------------------------------------------------------------------------


def make_log_workflow() -> dict[str, Any]:
    """Minimal valid canvas: start-node edge into one Log plugin node."""
    return {
        "nodes": [
            {
                "id": "node-log-1",
                "type": "workflowNode",
                "position": {"x": 100, "y": 100},
                "data": {
                    "label": "Say Hello",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {"values": {"message": "hello from mcp"}},
                },
            }
        ],
        "edges": [{"id": "edge-start-node-log-1", "source": "start-node", "target": "node-log-1"}],
    }


def create_test_entity(
    name: str,
    *,
    description: str = "",
    variables: dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    from wavecore.api.services.tests import service as test_service

    payload: dict[str, Any] = {
        "name": name,
        "description": description,
        "workflow": make_log_workflow(),
    }
    if variables is not None:
        payload["variables"] = variables
    if tags is not None:
        payload["metadata"] = {"tags": tags}
    return test_service.create_test(payload)


def write_raw_test(name: str) -> str:
    """Write a test.yaml directly to disk, bypassing the create-time name gate."""
    from wavecore.api.services.storage_paths import get_tests_storage_path
    from wavecore.api.services.tests.service import _clear_in_memory_cache

    test_id = str(uuid.uuid4())
    test_dir = get_tests_storage_path() / test_id
    test_dir.mkdir(parents=True, exist_ok=True)
    (test_dir / "test.yaml").write_text(
        yaml.dump(
            {
                "id": test_id,
                "name": name,
                "version": "1.0.0",
                "description": "",
                "workflow": make_log_workflow(),
                "variables": {},
                "metadata": {},
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        )
    )
    _clear_in_memory_cache()
    return test_id


# ---------------------------------------------------------------------------
# Execution fabrication (modeled on tests/api/reports/conftest.py)
# ---------------------------------------------------------------------------


def iso(offset_seconds: float) -> str:
    return (_BASE_TIME + timedelta(seconds=offset_seconds)).isoformat()


def ts(offset_seconds: float) -> str:
    moment = _BASE_TIME + timedelta(seconds=offset_seconds)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log_entry(
    level: str,
    message: str,
    source: str = "SYSTEM",
    *,
    block_id: str | None = None,
    at: float = 0.0,
) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "timestamp": ts(at),
        "level": level,
        "message": message,
        "source": source,
        "blockId": block_id,
    }


def store_execution(execution: dict[str, Any]) -> None:
    from wavecore.api.services.executions import _storage as exec_storage

    exec_storage._save_execution(execution)
    exec_storage._execution_storage[execution["id"]] = execution


def make_artifact_dir(execution_id: str) -> str:
    from wavecore.api.services.storage_paths import get_artifacts_storage_path

    dir_name = f"20260716-093000-{execution_id}"
    (get_artifacts_storage_path() / dir_name).mkdir(parents=True, exist_ok=True)
    return dir_name


def make_minimal_execution(
    status: str,
    *,
    name: str = "Guard Execution",
    entity_type: str = "test",
    triggered_by: str = "dev",
    started_offset: float = 0.0,
    duration: float = 1,
    with_artifact_dir: bool = False,
) -> str:
    """Bare cover sheet + composition, enough for listing and guard paths."""
    from wavecore.api.services.executions import _storage as exec_storage

    execution_id = str(uuid.uuid4())
    execution: dict[str, Any] = {
        "id": execution_id,
        "name": name,
        "entity_type": entity_type,
        "entity_id": str(uuid.uuid4()),
        "environment_id": str(uuid.uuid4()),
        "triggered_by": triggered_by,
        "status": status,
        "started_at": iso(started_offset),
        "run_id": execution_id,
    }
    if status in ("passed", "failed", "stopped", "skipped"):
        execution["ended_at"] = iso(started_offset + duration)
        execution["duration"] = duration
    if with_artifact_dir:
        execution["artifact_dir"] = make_artifact_dir(execution_id)
    store_execution(execution)
    exec_storage._save_composition(execution_id, {"suites": []})
    return execution_id


def make_terminal_test_execution(
    status: str = "passed",
    *,
    test_id: str | None = None,
    test_name: str = "MCP Report Source",
) -> dict[str, Any]:
    """Terminal test-type execution with logs, snapshot, and an artifact dir."""
    from wavecore.api.services.executions import _storage as exec_storage

    execution_id = str(uuid.uuid4())
    test_id = test_id or str(uuid.uuid4())
    workflow = {
        "nodes": [
            {
                "id": "node-init",
                "type": "workflowNode",
                "data": {"nodeType": "plugin", "label": "Init_Session"},
            },
            {
                "id": "node-check",
                "type": "workflowNode",
                "data": {"nodeType": "plugin", "label": "Check_Status"},
            },
        ],
        "edges": [
            {"id": "e1", "source": "node-init", "target": "node-check", "sourceHandle": None}
        ],
    }
    execution: dict[str, Any] = {
        "id": execution_id,
        "name": test_name,
        "entity_type": "test",
        "entity_id": test_id,
        "environment_id": str(uuid.uuid4()),
        "triggered_by": "mcp:pytest-client",
        "status": status,
        "started_at": iso(0.0),
        "ended_at": iso(3.0),
        "duration": 3,
        "run_id": execution_id,
        "artifact_dir": make_artifact_dir(execution_id),
        "workflow_snapshot": workflow,
    }
    store_execution(execution)
    exec_storage._save_composition(
        execution_id,
        {
            "suites": [
                {
                    "id": None,
                    "name": "",
                    "tests": [{"id": test_id, "name": test_name, "run_id": execution_id}],
                }
            ]
        },
    )
    exec_storage._append_status(
        execution_id,
        {"run_id": execution_id, "status": status, "ended_at": iso(3.0), "duration": 3.0},
    )
    for entry in [
        log_entry(
            "INFO", "Session initialized", "Log : Init_Session", block_id="node-init", at=0.1
        ),
        log_entry("INFO", "Status checked", "Log : Check_Status", block_id="node-check", at=2.5),
    ]:
        exec_storage._append_log(execution_id, execution_id, entry)
    exec_storage._save_snapshot(
        execution_id,
        execution_id,
        {
            "run_id": execution_id,
            "test_id": test_id,
            "status": status,
            "block_states": {"node-init": "passed", "node-check": "passed"},
            "variables": {},
            "workflow": workflow,
        },
    )
    return {"execution_id": execution_id, "test_id": test_id}


def make_failed_suite_execution() -> dict[str, Any]:
    """Terminal failed suite: run 0 passed, run 1 failed (block-level ERROR),
    run 2 skipped; logs cover DEBUG/INFO (excluded) and WARN/ERROR/FATAL."""
    from wavecore.api.services.executions import _storage as exec_storage

    execution_id = str(uuid.uuid4())
    suite_id = str(uuid.uuid4())
    test_names = ["Alpha Passes", "Bravo Fails", "Charlie Skipped"]
    test_ids = [str(uuid.uuid4()) for _ in test_names]
    run_ids = [str(uuid.uuid4()) for _ in test_names]

    execution: dict[str, Any] = {
        "id": execution_id,
        "name": "MCP Failure Source",
        "entity_type": "suite",
        "entity_id": suite_id,
        "environment_id": str(uuid.uuid4()),
        "triggered_by": "dev",
        "status": "failed",
        "started_at": iso(0.0),
        "ended_at": iso(20.0),
        "duration": 20,
        "artifact_dir": make_artifact_dir(execution_id),
    }
    store_execution(execution)

    exec_storage._save_composition(
        execution_id,
        {
            "suites": [
                {
                    "id": suite_id,
                    "name": "MCP Failure Source",
                    "tests": [
                        {"id": tid, "name": name, "run_id": rid}
                        for tid, name, rid in zip(test_ids, test_names, run_ids, strict=True)
                    ],
                }
            ]
        },
    )

    for index in range(2):
        exec_storage._append_run(
            execution_id,
            {"run_id": run_ids[index], "test_id": test_ids[index], "suite_id": suite_id},
        )

    transitions: list[dict[str, Any]] = [
        {"run_id": run_ids[0], "status": "running", "started_at": iso(0.1)},
        {"run_id": run_ids[0], "status": "passed", "ended_at": iso(5.0), "duration": 4.9},
        {"run_id": run_ids[1], "status": "running", "started_at": iso(5.1)},
        {"run_id": run_ids[1], "status": "failed", "ended_at": iso(12.0), "duration": 6.9},
        {"run_id": run_ids[2], "status": "skipped", "ended_at": iso(12.1), "duration": 0.0},
    ]
    for transition in transitions:
        exec_storage._append_status(execution_id, transition)

    exec_storage._append_chronology(
        execution_id,
        {
            "type": "suite",
            **log_entry("INFO", "Suite 'MCP Failure Source' execution started", at=0.0),
        },
    )
    for run_id in run_ids[:2]:
        exec_storage._append_chronology(execution_id, {"type": "test", "run_id": run_id})

    passed_logs = [
        log_entry("INFO", "Connection pool ready", "Log : Init", block_id="node-init", at=0.2),
    ]
    failed_logs = [
        log_entry(
            "DEBUG",
            "Executing 'SELECT count(*) FROM stock_levels'",
            "Sql : Fetch_Current_Stock",
            block_id="node-sql",
            at=6.0,
        ),
        log_entry(
            "INFO",
            "Fetched 409 rows",
            "Sql : Fetch_Current_Stock",
            block_id="node-sql",
            at=6.5,
        ),
        log_entry(
            "WARN",
            "Auth header rejected for token ********",
            "Http : Refresh_Token",
            block_id="node-sql",
            at=7.0,
        ),
        log_entry(
            "ERROR",
            "Downstream validation rejected payload: expected 412 rows, got 409",
            "Assert : Validate_Stock_Levels",
            block_id="node-validate",
            at=11.0,
        ),
        log_entry(
            "FATAL",
            "Reconciliation aborted: settlement total mismatch exceeds tolerance",
            "SYSTEM",
            block_id=None,
            at=11.9,
        ),
    ]
    for entry in passed_logs:
        exec_storage._append_log(execution_id, run_ids[0], entry)
    for entry in failed_logs:
        exec_storage._append_log(execution_id, run_ids[1], entry)

    exec_storage._save_snapshot(
        execution_id,
        run_ids[0],
        {
            "run_id": run_ids[0],
            "test_id": test_ids[0],
            "status": "passed",
            "block_states": {"node-init": "passed"},
            "variables": {},
            "workflow": {
                "nodes": [
                    {
                        "id": "node-init",
                        "type": "workflowNode",
                        "data": {"nodeType": "plugin", "label": "Init"},
                    }
                ],
                "edges": [],
            },
        },
    )
    exec_storage._save_snapshot(
        execution_id,
        run_ids[1],
        {
            "run_id": run_ids[1],
            "test_id": test_ids[1],
            "status": "failed",
            "block_states": {"node-sql": "passed", "node-validate": "failed"},
            "variables": {},
            "workflow": {
                "nodes": [
                    {
                        "id": "node-sql",
                        "type": "workflowNode",
                        "data": {"nodeType": "plugin", "label": "Fetch_Current_Stock"},
                    },
                    {
                        "id": "node-validate",
                        "type": "workflowNode",
                        "data": {"nodeType": "plugin", "label": "Validate_Stock_Levels"},
                    },
                ],
                "edges": [
                    {
                        "id": "e1",
                        "source": "node-sql",
                        "target": "node-validate",
                        "sourceHandle": None,
                    }
                ],
            },
        },
    )
    return {
        "execution_id": execution_id,
        "suite_id": suite_id,
        "test_ids": test_ids,
        "test_names": test_names,
        "run_ids": run_ids,
    }
