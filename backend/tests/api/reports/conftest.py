"""Shared fixtures for the report generation tests (REQ-3.7.2.1..3.7.2.8).

Fabricates terminal execution records with the executions storage primitives
so builder/endpoint tests run against the exact append-only on-disk layout
production writes (execution.yaml, composition.yaml, runs.yaml, status.yaml,
logs.yaml, logs/<run_id>.yaml, snapshots/<run_id>.yaml).
"""

import contextlib
import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services import log_streaming_service
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.storage_paths import get_artifacts_storage_path
from wavecore.api.services.workbench import _common as wb_common

ARTIFACT_DIR_STAMP = "20260610-110000"

TEST_EXEC_NAME = "Inventory Sync Validation"
SUITE_EXEC_NAME = "Nightly API Suite"
REGRESSION_EXEC_NAME = "Quarterly Regression"

_BASE_TIME = datetime(2026, 6, 10, 11, 6, 52, tzinfo=UTC)


@pytest.fixture(autouse=True)
def clear_report_state(temp_storage_path: Path) -> Generator[None, None, None]:
    """Isolate executions storage, workbench sessions, log buffers, and jobs."""
    _clear_all_state()
    yield
    _clear_all_state()


def _clear_all_state() -> None:
    exec_storage._clear_storage()
    wb_common._clear_sessions_sync()
    log_streaming_service._session_logs.clear()
    log_streaming_service._clear_cache()
    with contextlib.suppress(ImportError):
        from wavecore.api.services.reports import jobs

        jobs.clear_jobs()


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    """Context-managed client: report job tasks spawned during a request keep
    running on the portal loop so tests can await them."""
    from wavecore.api.app import app

    with TestClient(app) as test_client:
        yield test_client


def ts(offset_seconds: float) -> str:
    """Z-suffixed log timestamp at a fixed instant plus ``offset_seconds``."""
    moment = _BASE_TIME + timedelta(seconds=offset_seconds)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def iso(offset_seconds: float) -> str:
    """Cover-sheet style (+00:00) timestamp at the same fixed instant."""
    return (_BASE_TIME + timedelta(seconds=offset_seconds)).isoformat()


def log_entry(
    level: str,
    message: str,
    source: str = "SYSTEM",
    *,
    block_id: str | None = None,
    variant: str | None = None,
    at: float = 0.0,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "timestamp": ts(at),
        "level": level,
        "message": message,
        "source": source,
        "blockId": block_id,
    }
    if variant is not None:
        entry["variant"] = variant
    return entry


def make_artifact_dir(execution_id: str) -> str:
    dir_name = f"{ARTIFACT_DIR_STAMP}-{execution_id}"
    (get_artifacts_storage_path() / dir_name).mkdir(parents=True, exist_ok=True)
    return dir_name


def artifact_dir_path(artifact_dir: str) -> Path:
    return get_artifacts_storage_path() / artifact_dir


def _store_execution(execution: dict[str, Any]) -> None:
    exec_storage._save_execution(execution)
    exec_storage._execution_storage[execution["id"]] = execution


def _node(node_id: str, label: str | None) -> dict[str, Any]:
    data: dict[str, Any] = {"nodeType": "plugin"}
    if label is not None:
        data["label"] = label
    return {"id": node_id, "type": "workflowNode", "data": data}


def make_test_workflow() -> dict[str, Any]:
    """Canvas with a While body (nested path), a never-reached node, a
    label-less node, and a non-workflow start node."""
    return {
        "nodes": [
            {"id": "node-start", "type": "input", "data": {}},
            _node("node-init", "Init_Session"),
            _node("node-loop", "Poll_Sync_Status"),
            _node("node-fetch", "Fetch_Status"),
            _node("node-final", "Log_Summary"),
            _node("node-unrun", "Cleanup_Tmp"),
            _node("node-bare", None),
        ],
        "edges": [
            {"id": "e0", "source": "node-start", "target": "node-init", "sourceHandle": None},
            {"id": "e1", "source": "node-init", "target": "node-loop", "sourceHandle": None},
            {"id": "e2", "source": "node-loop", "target": "node-fetch", "sourceHandle": "body"},
            {"id": "e3", "source": "node-loop", "target": "node-final", "sourceHandle": "then"},
            {"id": "e4", "source": "node-final", "target": "node-unrun", "sourceHandle": None},
            {"id": "e5", "source": "node-unrun", "target": "node-bare", "sourceHandle": None},
        ],
    }


def make_function_workflow() -> dict[str, Any]:
    """Canvas whose nodes array order differs from edge order and whose
    Function node carries a local definition body."""
    function_data: dict[str, Any] = {
        "nodeType": "function",
        "label": "Sync_Function",
        "functionLifecycle": "local",
        "localDefinition": {
            "name": "Sync_Function",
            "inputs": [],
            "outputs": [],
            "workflow": {
                "nodes": [
                    {"id": "start-node", "type": "startNode", "data": {}},
                    _node("inner-log", "Fn_Log"),
                ],
                "edges": [
                    {
                        "id": "be1",
                        "source": "start-node",
                        "target": "inner-log",
                        "sourceHandle": None,
                    }
                ],
            },
        },
    }
    return {
        "nodes": [
            {"id": "node-start", "type": "input", "data": {}},
            _node("node-after", "Log_After"),
            {"id": "node-fn", "type": "workflowNode", "data": function_data},
            _node("node-before", "Log_Before"),
        ],
        "edges": [
            {"id": "e0", "source": "node-start", "target": "node-before", "sourceHandle": None},
            {"id": "e1", "source": "node-before", "target": "node-fn", "sourceHandle": None},
            {"id": "e2", "source": "node-fn", "target": "node-after", "sourceHandle": None},
        ],
    }


def make_function_test_execution(status: str = "passed") -> dict[str, Any]:
    """Terminal test-type execution over make_function_workflow with logs
    from the Function entry/result shim and the function-body block."""
    execution_id = str(uuid.uuid4())
    test_id = str(uuid.uuid4())
    workflow = make_function_workflow()
    execution: dict[str, Any] = {
        "id": execution_id,
        "name": "Function Order Test",
        "entity_type": "test",
        "entity_id": test_id,
        "environment_id": str(uuid.uuid4()),
        "triggered_by": "dev",
        "status": status,
        "started_at": iso(0.0),
        "ended_at": iso(2.0),
        "duration": 2,
        "run_id": execution_id,
        "artifact_dir": make_artifact_dir(execution_id),
        "workflow_snapshot": workflow,
    }
    _store_execution(execution)
    exec_storage._save_composition(
        execution_id,
        {
            "suites": [
                {
                    "id": None,
                    "name": "",
                    "tests": [
                        {"id": test_id, "name": "Function Order Test", "run_id": execution_id}
                    ],
                }
            ]
        },
    )
    exec_storage._append_status(
        execution_id,
        {"run_id": execution_id, "status": status, "ended_at": iso(2.0), "duration": 2.0},
    )
    for entry in [
        log_entry(
            "INFO", "Before the function", "Log : Log_Before", block_id="node-before", at=0.1
        ),
        log_entry(
            "INFO", "Entering Function 'Sync_Function'", "FUNCTION", block_id="node-fn", at=0.5
        ),
        log_entry("INFO", "Inside function", "Log : Fn_Log", block_id="inner-log", at=0.8),
        log_entry(
            "INFO",
            "Function 'Sync_Function' completed with status passed",
            "FUNCTION",
            block_id="node-fn",
            at=1.2,
        ),
        log_entry("INFO", "After the function", "Log : Log_After", block_id="node-after", at=1.5),
    ]:
        exec_storage._append_log(execution_id, execution_id, entry)
    exec_storage._save_snapshot(
        execution_id,
        execution_id,
        {
            "run_id": execution_id,
            "test_id": test_id,
            "status": status,
            "block_states": {
                "node-before": "passed",
                "node-fn": "passed",
                "inner-log": "passed",
                "node-after": "passed",
            },
            "variables": {},
            "workflow": workflow,
        },
    )
    return {"execution_id": execution_id, "test_id": test_id}


def make_test_execution(
    status: str = "passed",
    *,
    with_artifact_dir: bool = True,
    with_run_id: bool = True,
    profile_id: str | None = None,
    entity_version: str | None = None,
) -> dict[str, Any]:
    """Terminal test-type execution: no runs.yaml, no logs.yaml (workbench
    path), per-run log file keyed by the cover-sheet run_id."""
    execution_id = str(uuid.uuid4())
    test_id = str(uuid.uuid4())
    environment_id = str(uuid.uuid4())
    workflow = make_test_workflow()

    execution: dict[str, Any] = {
        "id": execution_id,
        "name": TEST_EXEC_NAME,
        "entity_type": "test",
        "entity_id": test_id,
        "environment_id": environment_id,
        "triggered_by": "dev",
        "status": status,
        "started_at": iso(0.0),
        "ended_at": iso(4.0),
        "duration": 4,
        "workflow_snapshot": workflow,
    }
    if with_run_id:
        execution["run_id"] = execution_id
    if profile_id is not None:
        execution["profile_id"] = profile_id
    if entity_version is not None:
        execution["entity_version"] = entity_version
    if with_artifact_dir:
        execution["artifact_dir"] = make_artifact_dir(execution_id)
    _store_execution(execution)

    exec_storage._save_composition(
        execution_id,
        {
            "suites": [
                {
                    "id": None,
                    "name": "",
                    "tests": [{"id": test_id, "name": TEST_EXEC_NAME, "run_id": execution_id}],
                }
            ]
        },
    )
    exec_storage._append_status(
        execution_id,
        {"run_id": execution_id, "status": status, "ended_at": iso(4.0), "duration": 4.0},
    )
    for entry in [
        log_entry("INFO", f"Test '{TEST_EXEC_NAME}' execution started (5 blocks)", at=0.0),
        log_entry(
            "INFO", "Set 2 variables", "VarSet : Init_Session", block_id="node-init", at=0.01
        ),
        log_entry(
            "DEBUG",
            "Iteration 1: sync status pending",
            "While : Poll_Sync_Status",
            block_id="node-loop",
            at=0.1,
        ),
        log_entry(
            "DEBUG",
            "Fetched status: pending",
            "Http : Fetch_Status",
            block_id="node-fetch",
            at=0.4,
        ),
        log_entry(
            "DEBUG",
            "Iteration 2: sync status complete",
            "While : Poll_Sync_Status",
            block_id="node-loop",
            at=1.4,
        ),
        log_entry(
            "INFO",
            "Fetched status: complete",
            "Http : Fetch_Status",
            block_id="node-fetch",
            at=2.9,
        ),
        log_entry(
            "INFO", "Inventory sync validated", "Log : Log_Summary", block_id="node-final", at=3.4
        ),
    ]:
        exec_storage._append_log(execution_id, execution_id, entry)
    exec_storage._save_snapshot(
        execution_id,
        execution_id,
        {
            "run_id": execution_id,
            "test_id": test_id,
            "status": status,
            "block_states": {
                "node-init": "passed",
                "node-loop": "passed",
                "node-fetch": "passed",
                "node-final": "passed",
                "node-bare": "skipped",
            },
            "variables": {"region": "us-west", "api_token": "secret-token-value"},
            "workflow": workflow,
        },
    )
    return {
        "execution_id": execution_id,
        "test_id": test_id,
        "environment_id": environment_id,
        "artifact_dir": execution.get("artifact_dir"),
        "workflow": workflow,
    }


def make_suite_execution(status: str = "failed") -> dict[str, Any]:
    """Terminal suite execution: 5 composition tests, 3 dispatched (passed,
    passed, failed), 1 skipped, 1 excluded; scope banners in logs.yaml."""
    execution_id = str(uuid.uuid4())
    suite_id = str(uuid.uuid4())
    environment_id = str(uuid.uuid4())
    test_names = [
        "Auth Token Refresh",
        "Order Pipeline Smoke",
        "Inventory Sync Validation",
        "Quota Enforcement Sweep",
        "Audit Trail Integrity",
    ]
    test_ids = [str(uuid.uuid4()) for _ in test_names]
    run_ids = [str(uuid.uuid4()) for _ in test_names]

    execution: dict[str, Any] = {
        "id": execution_id,
        "name": SUITE_EXEC_NAME,
        "entity_type": "suite",
        "entity_id": suite_id,
        "environment_id": environment_id,
        "triggered_by": "dev",
        "status": status,
        "started_at": iso(0.0),
        "ended_at": iso(21.0),
        "duration": 21,
        "artifact_dir": make_artifact_dir(execution_id),
    }
    _store_execution(execution)

    exec_storage._save_composition(
        execution_id,
        {
            "suites": [
                {
                    "id": suite_id,
                    "name": SUITE_EXEC_NAME,
                    "tests": [
                        {"id": tid, "name": name, "run_id": rid}
                        for tid, name, rid in zip(test_ids, test_names, run_ids, strict=True)
                    ],
                }
            ]
        },
    )

    for index in range(3):
        exec_storage._append_run(
            execution_id,
            {"run_id": run_ids[index], "test_id": test_ids[index], "suite_id": suite_id},
        )

    transitions: list[dict[str, Any]] = [
        {"run_id": run_ids[0], "status": "running", "started_at": iso(0.01)},
        {"run_id": run_ids[0], "status": "passed", "ended_at": iso(4.21), "duration": 4.2},
        {"run_id": run_ids[1], "status": "running", "started_at": iso(4.3)},
        {"run_id": run_ids[1], "status": "passed", "ended_at": iso(10.4), "duration": 6.1},
        {"run_id": run_ids[2], "status": "running", "started_at": iso(10.5)},
        {"run_id": run_ids[2], "status": "failed", "ended_at": iso(14.9), "duration": 4.4},
        {"run_id": run_ids[3], "status": "skipped", "ended_at": iso(15.0), "duration": 0.0},
        {"run_id": run_ids[4], "status": "excluded", "duration": 0},
    ]
    for transition in transitions:
        exec_storage._append_status(execution_id, transition)

    exec_storage._append_chronology(
        execution_id,
        {
            "type": "suite",
            **log_entry(
                "INFO",
                f"Suite '{SUITE_EXEC_NAME}' execution started",
                variant="suite-banner",
                at=0.0,
            ),
        },
    )
    for run_id in run_ids[:3]:
        exec_storage._append_chronology(execution_id, {"type": "test", "run_id": run_id})
    exec_storage._append_chronology(
        execution_id,
        {
            "type": "suite",
            **log_entry(
                "INFO",
                f"Suite '{SUITE_EXEC_NAME}' finished with status: {status}",
                variant="suite-banner",
                at=21.0,
            ),
        },
    )

    run_logs: dict[str, list[dict[str, Any]]] = {
        run_ids[0]: [
            log_entry(
                "INFO",
                "Connection pool initialized with 8 workers",
                "Log : Init",
                block_id="node-init",
                at=0.1,
            ),
            log_entry(
                "DEBUG",
                "POST /oauth/token returned 200 (118ms)",
                "Http : Refresh_Token",
                block_id="node-http",
                at=0.5,
            ),
        ],
        run_ids[1]: [
            log_entry(
                "WARN",
                "Retrying request after transient timeout (attempt 2/3)",
                "Http : Submit_Order",
                block_id="node-submit",
                at=5.0,
            ),
        ],
        run_ids[2]: [
            log_entry(
                "DEBUG",
                "Executing 'SELECT count(*) FROM stock_levels'",
                "Sql : Fetch_Current_Stock",
                block_id="node-sql",
                at=11.0,
            ),
            log_entry(
                "ERROR",
                "Downstream validation rejected payload: expected 412 rows, got 409",
                "Assert : Validate_Stock_Levels",
                block_id="node-validate",
                at=14.5,
            ),
            log_entry(
                "FATAL",
                "Reconciliation aborted: settlement total mismatch exceeds tolerance",
                "Assert : Reconcile_Totals",
                block_id="node-reconcile",
                at=14.8,
            ),
        ],
    }
    for run_id, entries in run_logs.items():
        for entry in entries:
            exec_storage._append_log(execution_id, run_id, entry)

    exec_storage._save_snapshot(
        execution_id,
        run_ids[0],
        {
            "run_id": run_ids[0],
            "test_id": test_ids[0],
            "status": "passed",
            "block_states": {"node-init": "passed", "node-http": "passed"},
            "variables": {"username": "alice", "db_password": "hunter2"},
        },
    )
    exec_storage._save_snapshot(
        execution_id,
        run_ids[2],
        {
            "run_id": run_ids[2],
            "test_id": test_ids[2],
            "status": "failed",
            "block_states": {"node-sql": "passed", "node-validate": "failed"},
            "variables": {},
            "workflow": {
                "nodes": [
                    _node("node-sql", "Fetch_Current_Stock"),
                    _node("node-validate", "Validate_Stock_Levels"),
                    _node("node-reconcile", "Reconcile_Totals"),
                ],
                "edges": [],
            },
        },
    )
    return {
        "execution_id": execution_id,
        "suite_id": suite_id,
        "environment_id": environment_id,
        "artifact_dir": execution["artifact_dir"],
        "test_ids": test_ids,
        "test_names": test_names,
        "run_ids": run_ids,
    }


def make_regression_execution(status: str = "stopped") -> dict[str, Any]:
    """Terminal regression execution: two suites (2 + 1 dispatched runs),
    regression/suite banners, and one FATAL suite-scope banner."""
    execution_id = str(uuid.uuid4())
    regression_id = str(uuid.uuid4())
    environment_id = str(uuid.uuid4())
    suite_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
    suite_names = ["Nightly API Suite", "Platform Health Suite"]
    test_names = ["Auth Token Refresh", "Order Pipeline Smoke", "Cluster Failover Recovery"]
    test_ids = [str(uuid.uuid4()) for _ in test_names]
    run_ids = [str(uuid.uuid4()) for _ in test_names]
    run_suite_index = [0, 0, 1]

    execution: dict[str, Any] = {
        "id": execution_id,
        "name": REGRESSION_EXEC_NAME,
        "entity_type": "regression",
        "entity_id": regression_id,
        "environment_id": environment_id,
        "triggered_by": "dev",
        "status": status,
        "started_at": iso(0.0),
        "ended_at": iso(23.0),
        "duration": 23,
        "artifact_dir": make_artifact_dir(execution_id),
    }
    _store_execution(execution)

    exec_storage._save_composition(
        execution_id,
        {
            "suites": [
                {
                    "id": suite_ids[0],
                    "name": suite_names[0],
                    "tests": [
                        {"id": test_ids[0], "name": test_names[0], "run_id": run_ids[0]},
                        {"id": test_ids[1], "name": test_names[1], "run_id": run_ids[1]},
                    ],
                },
                {
                    "id": suite_ids[1],
                    "name": suite_names[1],
                    "tests": [{"id": test_ids[2], "name": test_names[2], "run_id": run_ids[2]}],
                },
            ]
        },
    )

    for index, run_id in enumerate(run_ids):
        exec_storage._append_run(
            execution_id,
            {
                "run_id": run_id,
                "test_id": test_ids[index],
                "suite_id": suite_ids[run_suite_index[index]],
            },
        )

    transitions: list[dict[str, Any]] = [
        {"run_id": run_ids[0], "status": "running", "started_at": iso(0.1)},
        {"run_id": run_ids[0], "status": "passed", "ended_at": iso(4.3), "duration": 4.2},
        {"run_id": run_ids[1], "status": "running", "started_at": iso(4.4)},
        {"run_id": run_ids[1], "status": "passed", "ended_at": iso(10.5), "duration": 6.1},
        {"run_id": run_ids[2], "status": "running", "started_at": iso(11.2)},
        {"run_id": run_ids[2], "status": "passed", "ended_at": iso(22.5), "duration": 11.3},
    ]
    for transition in transitions:
        exec_storage._append_status(execution_id, transition)

    exec_storage._append_chronology(
        execution_id,
        {
            "type": "regression",
            **log_entry(
                "INFO",
                f"Regression '{REGRESSION_EXEC_NAME}' execution started",
                variant="regression-banner",
                at=0.0,
            ),
        },
    )
    exec_storage._append_chronology(
        execution_id,
        {
            "type": "suite",
            "suite_id": suite_ids[0],
            **log_entry(
                "INFO",
                f"Suite '{suite_names[0]}' execution started",
                variant="suite-banner",
                at=0.05,
            ),
        },
    )
    exec_storage._append_chronology(execution_id, {"type": "test", "run_id": run_ids[0]})
    exec_storage._append_chronology(execution_id, {"type": "test", "run_id": run_ids[1]})
    exec_storage._append_chronology(
        execution_id,
        {
            "type": "suite",
            "suite_id": suite_ids[1],
            **log_entry(
                "INFO",
                f"Suite '{suite_names[1]}' execution started",
                variant="suite-banner",
                at=11.0,
            ),
        },
    )
    exec_storage._append_chronology(execution_id, {"type": "test", "run_id": run_ids[2]})
    exec_storage._append_chronology(
        execution_id,
        {
            "type": "suite",
            "suite_id": suite_ids[1],
            **log_entry(
                "FATAL",
                f"Suite '{suite_names[1]}' canceled by backend shutdown",
                variant="suite-banner",
                at=22.9,
            ),
        },
    )
    exec_storage._append_chronology(
        execution_id,
        {
            "type": "regression",
            **log_entry(
                "FATAL",
                f"Regression '{REGRESSION_EXEC_NAME}' canceled by backend shutdown",
                variant="regression-banner",
                at=23.0,
            ),
        },
    )

    for index, run_id in enumerate(run_ids):
        exec_storage._append_log(
            execution_id,
            run_id,
            log_entry(
                "INFO",
                f"Test '{test_names[index]}' completed",
                block_id=None,
                at=1.0 + index,
            ),
        )

    return {
        "execution_id": execution_id,
        "regression_id": regression_id,
        "environment_id": environment_id,
        "artifact_dir": execution["artifact_dir"],
        "suite_ids": suite_ids,
        "suite_names": suite_names,
        "test_ids": test_ids,
        "test_names": test_names,
        "run_ids": run_ids,
    }


def make_minimal_execution(
    status: str,
    *,
    with_artifact_dir: bool = True,
    name: str = "Guard Execution",
    entity_type: str = "test",
    triggered_by: str = "dev",
    started_offset: float = 0.0,
    duration: float = 1,
) -> str:
    """Bare cover sheet + composition for endpoint guard and listing tests."""
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
    _store_execution(execution)
    exec_storage._save_composition(execution_id, {"suites": []})
    return execution_id
