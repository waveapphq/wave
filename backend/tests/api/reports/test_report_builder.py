"""Unit tests for the canonical report model builder (REQ-3.7.2.2..3.7.2.7).

Covers summary counts, run/block timelines, error entries,
merged chronological logs, secret masking, and the workbench session variant.
"""

import uuid
from datetime import datetime
from typing import Any

import pytest

from tests.api.reports.conftest import (
    REGRESSION_EXEC_NAME,
    SUITE_EXEC_NAME,
    TEST_EXEC_NAME,
    iso,
    log_entry,
    make_function_test_execution,
    make_regression_execution,
    make_suite_execution,
    make_test_execution,
    ts,
)
from wavecore.api.exceptions import NotFoundException
from wavecore.api.services.executions import _storage as exec_storage


def _build(execution_id: str, **kwargs: Any) -> dict[str, Any]:
    from wavecore.api.services.reports import builder

    return builder.build_execution_report(execution_id, **kwargs)


def _build_session(session: dict[str, Any], logs: list[dict[str, Any]]) -> dict[str, Any]:
    from wavecore.api.services.reports import builder

    return builder.build_session_report(session, logs)


def _blocks_by_id(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {block["block_id"]: block for block in report["timeline"]["blocks"]}


class TestModelIdentity:
    """Top-level model shape and execution identity fields."""

    def test_execution_identity_fields(self) -> None:
        record = make_test_execution()

        report = _build(record["execution_id"])

        execution = report["execution"]
        assert execution["id"] == record["execution_id"]
        assert execution["name"] == TEST_EXEC_NAME
        assert execution["entity_type"] == "test"
        assert execution["entity_id"] == record["test_id"]
        assert execution["triggered_by"] == "dev"
        assert execution["status"] == "passed"
        assert execution["started_at"] is not None
        assert execution["ended_at"] is not None
        assert execution["duration"] == 4

    def test_schema_version_and_generated_at(self) -> None:
        record = make_test_execution()

        report = _build(record["execution_id"])

        assert report["schema_version"] == 1
        datetime.fromisoformat(report["generated_at"].replace("Z", "+00:00"))

    def test_environment_name_falls_back_to_id(self) -> None:
        record = make_test_execution()

        report = _build(record["execution_id"])

        assert report["execution"]["environment"] == record["environment_id"]

    def test_optional_profile_and_entity_version_included_when_set(self) -> None:
        record = make_test_execution(profile_id="profile-7", entity_version="1.2.0")

        report = _build(record["execution_id"])

        assert report["execution"]["profile_id"] == "profile-7"
        assert report["execution"]["entity_version"] == "1.2.0"

    def test_optional_fields_absent_when_unset(self) -> None:
        record = make_test_execution()

        report = _build(record["execution_id"])

        assert "profile_id" not in report["execution"]
        assert "entity_version" not in report["execution"]

    def test_unknown_execution_raises_not_found(self) -> None:
        execution_id = str(uuid.uuid4())

        with pytest.raises(
            NotFoundException, match=f"^Execution with ID '{execution_id}' not found$"
        ):
            _build(execution_id)


class TestSummary:
    """REQ-3.7.2.2: per-test outcome counts matching the detail surface."""

    def test_suite_summary_counts(self) -> None:
        record = make_suite_execution()

        report = _build(record["execution_id"])

        assert report["summary"]["status"] == "failed"
        assert report["summary"]["duration"] == 21
        assert report["summary"]["counts"] == {
            "total": 5,
            "passed": 2,
            "failed": 1,
            "skipped": 1,
            "stopped": 0,
            "excluded": 1,
            "pending": 0,
        }

    def test_test_summary_counts(self) -> None:
        record = make_test_execution()

        report = _build(record["execution_id"])

        assert report["summary"]["counts"] == {
            "total": 1,
            "passed": 1,
            "failed": 0,
            "skipped": 0,
            "stopped": 0,
            "excluded": 0,
            "pending": 0,
        }


class TestRunTimeline:
    """REQ-3.7.2.3: dispatched runs in dispatch order with timing."""

    def test_suite_runs_in_dispatch_order(self) -> None:
        record = make_suite_execution()

        runs = _build(record["execution_id"])["timeline"]["runs"]

        assert [run["order"] for run in runs] == [1, 2, 3]
        assert [run["run_id"] for run in runs] == record["run_ids"][:3]
        assert [run["test_id"] for run in runs] == record["test_ids"][:3]
        assert [run["test_name"] for run in runs] == record["test_names"][:3]
        assert [run["status"] for run in runs] == ["passed", "passed", "failed"]
        for run in runs:
            assert run["suite_id"] == record["suite_id"]
            assert run["suite_name"] == SUITE_EXEC_NAME

    def test_suite_run_timing_from_status_replay(self) -> None:
        record = make_suite_execution()

        runs = _build(record["execution_id"])["timeline"]["runs"]

        assert runs[0]["started_at"] is not None
        assert runs[0]["ended_at"] is not None
        assert [run["duration"] for run in runs] == [4.2, 6.1, 4.4]

    def test_run_variables_are_never_masked_by_name(self) -> None:
        """Snapshot values pass through as written; names never trigger masking."""
        record = make_suite_execution()

        runs = _build(record["execution_id"])["timeline"]["runs"]

        assert runs[0]["variables"] == {"username": "alice", "db_password": "hunter2"}

    def test_test_type_run_variables_are_never_masked_by_name(self) -> None:
        record = make_test_execution()

        runs = _build(record["execution_id"])["timeline"]["runs"]

        assert len(runs) == 1
        assert runs[0]["variables"] == {
            "region": "us-west",
            "api_token": "secret-token-value",
        }

    def test_run_variables_masked_by_flag_via_registry_written_snapshot(self) -> None:
        """Flagged variables arrive masked because the snapshot is masked on write."""
        from wavecore.core.secrets.registry import SecretRegistry

        record = make_test_execution()
        run_id = record["execution_id"]
        registry = SecretRegistry()
        registry.register("api_token", "secret-token-value", "declared")
        exec_storage._save_snapshot(
            record["execution_id"],
            run_id,
            {
                "run_id": run_id,
                "test_id": record["test_id"],
                "status": "passed",
                "block_states": {},
                "variables": {"region": "us-west", "api_token": "secret-token-value"},
            },
            registry=registry,
        )

        runs = _build(record["execution_id"])["timeline"]["runs"]

        assert runs[0]["variables"] == {"region": "us-west", "api_token": "********"}

    def test_regression_runs_carry_per_suite_names(self) -> None:
        record = make_regression_execution()

        runs = _build(record["execution_id"])["timeline"]["runs"]

        assert [run["order"] for run in runs] == [1, 2, 3]
        assert [run["suite_name"] for run in runs] == [
            "Nightly API Suite",
            "Nightly API Suite",
            "Platform Health Suite",
        ]
        assert [run["suite_id"] for run in runs] == [
            record["suite_ids"][0],
            record["suite_ids"][0],
            record["suite_ids"][1],
        ]

    def test_suite_without_dispatched_runs_has_empty_run_timeline(self) -> None:
        execution_id = str(uuid.uuid4())
        execution = {
            "id": execution_id,
            "name": "Empty Suite",
            "entity_type": "suite",
            "entity_id": str(uuid.uuid4()),
            "environment_id": str(uuid.uuid4()),
            "triggered_by": "dev",
            "status": "stopped",
            "started_at": iso(0.0),
            "ended_at": iso(0.5),
            "duration": 0,
        }
        exec_storage._save_execution(execution)
        exec_storage._execution_storage[execution_id] = execution
        exec_storage._save_composition(execution_id, {"suites": []})

        report = _build(execution_id)

        assert report["timeline"]["runs"] == []
        assert report["summary"]["counts"]["total"] == 0

    def test_suite_and_regression_have_no_block_timeline(self) -> None:
        suite_record = make_suite_execution()
        regression_record = make_regression_execution()

        assert _build(suite_record["execution_id"])["timeline"]["blocks"] == []
        assert _build(regression_record["execution_id"])["timeline"]["blocks"] == []


class TestBlockTimeline:
    """REQ-3.7.2.3: per-canvas-node rows for test executions."""

    def test_one_row_per_workflow_node(self) -> None:
        record = make_test_execution()

        blocks = _build(record["execution_id"])["timeline"]["blocks"]

        assert [block["block_id"] for block in blocks] == [
            "node-init",
            "node-loop",
            "node-fetch",
            "node-final",
            "node-unrun",
            "node-bare",
        ]
        assert [block["order"] for block in blocks] == [1, 2, 3, 4, 5, 6]

    def test_never_reached_nodes_stay_in_the_model(self) -> None:
        """The JSON report is the full record; the step list is filtered at
        render time, so machine consumers keep every step."""
        record = make_test_execution()

        blocks = _blocks_by_id(_build(record["execution_id"]))

        assert blocks["node-unrun"]["status"] == "pending"

    def test_deliberately_skipped_nodes_carry_their_recorded_status(self) -> None:
        record = make_test_execution()

        blocks = _blocks_by_id(_build(record["execution_id"]))

        assert blocks["node-bare"]["status"] == "skipped"

    def test_non_workflow_nodes_produce_no_rows(self) -> None:
        record = make_test_execution()

        blocks = _blocks_by_id(_build(record["execution_id"]))

        assert "node-start" not in blocks

    def test_iteration_spans_aggregate_first_start_to_last_end(self) -> None:
        record = make_test_execution()

        blocks = _blocks_by_id(_build(record["execution_id"]))

        assert blocks["node-loop"]["started_at"] == ts(0.1)
        assert blocks["node-loop"]["ended_at"] == ts(1.4)
        assert blocks["node-loop"]["duration"] == pytest.approx(1.3)
        assert blocks["node-fetch"]["started_at"] == ts(0.4)
        assert blocks["node-fetch"]["ended_at"] == ts(2.9)
        assert blocks["node-fetch"]["duration"] == pytest.approx(2.5)

    def test_nested_block_carries_container_path(self) -> None:
        record = make_test_execution()

        blocks = _blocks_by_id(_build(record["execution_id"]))

        assert blocks["node-fetch"]["block_path"] == "Poll_Sync_Status / Fetch_Status"
        assert blocks["node-loop"]["block_path"] == "Poll_Sync_Status"
        assert blocks["node-init"]["block_path"] == "Init_Session"

    def test_block_name_falls_back_to_node_id(self) -> None:
        record = make_test_execution()

        blocks = _blocks_by_id(_build(record["execution_id"]))

        assert blocks["node-bare"]["block_path"] == "node-bare"

    def test_block_statuses_from_snapshot_block_states(self) -> None:
        record = make_test_execution()

        blocks = _blocks_by_id(_build(record["execution_id"]))

        assert blocks["node-init"]["status"] == "passed"
        assert blocks["node-loop"]["status"] == "passed"
        assert blocks["node-unrun"]["status"] == "pending"

    def test_blocks_without_logs_have_no_timing(self) -> None:
        record = make_test_execution()

        blocks = _blocks_by_id(_build(record["execution_id"]))

        assert blocks["node-unrun"]["started_at"] is None
        assert blocks["node-unrun"]["ended_at"] is None
        assert blocks["node-unrun"]["duration"] is None


class TestFunctionBlockTimeline:
    """Execution-order rows and Function-body expansion (path prefixing into
    function definitions)."""

    def test_blocks_follow_edge_order_not_array_order(self) -> None:
        record = make_function_test_execution()

        blocks = _build(record["execution_id"])["timeline"]["blocks"]

        assert [block["block_id"] for block in blocks] == [
            "node-before",
            "node-fn",
            "inner-log",
            "node-after",
        ]
        assert [block["order"] for block in blocks] == [1, 2, 3, 4]

    def test_function_body_rows_carry_function_path_prefix(self) -> None:
        record = make_function_test_execution()

        blocks = _blocks_by_id(_build(record["execution_id"]))

        assert blocks["inner-log"]["block_path"] == "Sync_Function / Fn_Log"
        assert blocks["inner-log"]["status"] == "passed"
        assert blocks["inner-log"]["started_at"] == ts(0.8)
        assert blocks["node-fn"]["block_path"] == "Sync_Function"
        assert blocks["node-fn"]["started_at"] == ts(0.5)
        assert blocks["node-fn"]["ended_at"] == ts(1.2)

    def test_function_body_error_carries_prefixed_path(self) -> None:
        record = make_function_test_execution()
        exec_storage._append_log(
            record["execution_id"],
            record["execution_id"],
            log_entry("ERROR", "Body assertion failed", block_id="inner-log", at=1.0),
        )

        errors = _build(record["execution_id"])["errors"]

        assert len(errors) == 1
        assert errors[0]["block_path"] == "Sync_Function / Fn_Log"

    def test_unresolvable_function_definitions_render_no_body_rows(self) -> None:
        execution_id = str(uuid.uuid4())
        workflow = {
            "nodes": [
                {
                    "id": "node-fn-shared",
                    "type": "workflowNode",
                    "data": {
                        "nodeType": "function",
                        "label": "Ghost_Function",
                        "functionLifecycle": "shared",
                        "functionId": "",
                    },
                },
                {
                    "id": "node-fn-bodyless",
                    "type": "workflowNode",
                    "data": {
                        "nodeType": "function",
                        "label": "Bodyless_Function",
                        "functionLifecycle": "local",
                        "localDefinition": {"name": "Bodyless_Function"},
                    },
                },
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "node-fn-shared",
                    "target": "node-fn-bodyless",
                    "sourceHandle": None,
                },
                {
                    "id": "e2",
                    "source": "node-fn-bodyless",
                    "target": "node-gone",
                    "sourceHandle": None,
                },
            ],
        }
        execution = {
            "id": execution_id,
            "name": "Broken Function Test",
            "entity_type": "test",
            "entity_id": str(uuid.uuid4()),
            "environment_id": str(uuid.uuid4()),
            "triggered_by": "dev",
            "status": "failed",
            "started_at": iso(0.0),
            "ended_at": iso(1.0),
            "duration": 1,
            "run_id": execution_id,
            "workflow_snapshot": workflow,
        }
        exec_storage._save_execution(execution)
        exec_storage._execution_storage[execution_id] = execution
        exec_storage._save_composition(execution_id, {"suites": []})

        blocks = _build(execution_id)["timeline"]["blocks"]

        assert [block["block_id"] for block in blocks] == ["node-fn-shared", "node-fn-bodyless"]


class TestErrors:
    """REQ-3.7.2.4: error entries with identity and no log context."""

    def test_suite_errors_extracted_in_chronological_order(self) -> None:
        record = make_suite_execution()

        errors = _build(record["execution_id"])["errors"]

        assert [error["level"] for error in errors] == ["ERROR", "FATAL"]
        first = errors[0]
        assert first["run_id"] == record["run_ids"][2]
        assert first["test_id"] == record["test_ids"][2]
        assert first["test_name"] == "Inventory Sync Validation"
        assert first["suite_name"] == SUITE_EXEC_NAME
        assert first["block_path"] == "Validate_Stock_Levels"
        assert (
            first["message"] == "Downstream validation rejected payload: expected 412 rows, got 409"
        )
        assert first["timestamp"] == ts(14.5)
        assert errors[1]["block_path"] == "Reconcile_Totals"

    def test_error_entries_carry_no_log_context(self) -> None:
        record = make_suite_execution()

        errors = _build(record["execution_id"])["errors"]

        for error in errors:
            assert "context" not in error
            assert "logs" not in error

    def test_scope_level_fatal_becomes_error_with_suite_identity(self) -> None:
        record = make_regression_execution()

        errors = _build(record["execution_id"])["errors"]

        suite_scope = [e for e in errors if e["suite_name"] == "Platform Health Suite"]
        assert len(suite_scope) == 1
        assert suite_scope[0]["level"] == "FATAL"
        assert suite_scope[0]["run_id"] is None
        assert suite_scope[0]["test_id"] is None
        assert suite_scope[0]["test_name"] is None
        assert suite_scope[0]["block_path"] is None
        assert (
            suite_scope[0]["message"]
            == "Suite 'Platform Health Suite' canceled by backend shutdown"
        )

    def test_error_without_block_id_has_no_block_path(self) -> None:
        record = make_test_execution()
        exec_storage._append_log(
            record["execution_id"],
            record["execution_id"],
            log_entry("ERROR", "Engine-level failure", block_id=None, at=3.9),
        )

        errors = _build(record["execution_id"])["errors"]

        assert len(errors) == 1
        assert errors[0]["block_path"] is None
        assert errors[0]["message"] == "Engine-level failure"

    def test_passing_execution_has_empty_errors(self) -> None:
        record = make_test_execution()

        assert _build(record["execution_id"])["errors"] == []


class TestMergedLogs:
    """REQ-3.7.2.7: forward chronological walk of the scope chronology."""

    def test_suite_walk_interleaves_scope_and_test_entries(self) -> None:
        record = make_suite_execution()

        merged = exec_storage._load_merged_logs(record["execution_id"])

        assert [entry["scope_kind"] for entry in merged] == [
            "suite",
            "test",
            "test",
            "test",
            "test",
            "test",
            "test",
            "suite",
        ]
        assert merged[0]["message"] == f"Suite '{SUITE_EXEC_NAME}' execution started"
        assert merged[-1]["message"] == f"Suite '{SUITE_EXEC_NAME}' finished with status: failed"
        assert [entry.get("run_id") for entry in merged[1:7]] == [
            record["run_ids"][0],
            record["run_ids"][0],
            record["run_ids"][1],
            record["run_ids"][2],
            record["run_ids"][2],
            record["run_ids"][2],
        ]
        assert [entry["seq"] for entry in merged[1:7]] == [0, 1, 0, 0, 1, 2]

    def test_regression_walk_preserves_chronology_order(self) -> None:
        record = make_regression_execution()

        merged = exec_storage._load_merged_logs(record["execution_id"])

        assert [entry["scope_kind"] for entry in merged] == [
            "regression",
            "suite",
            "test",
            "test",
            "suite",
            "test",
            "suite",
            "regression",
        ]
        assert merged[0]["message"] == f"Regression '{REGRESSION_EXEC_NAME}' execution started"

    def test_missing_test_log_file_reference_is_skipped(self) -> None:
        record = make_suite_execution()
        exec_storage._append_chronology(
            record["execution_id"], {"type": "test", "run_id": "no-such-run"}
        )

        merged = exec_storage._load_merged_logs(record["execution_id"])

        assert len(merged) == 8

    def test_test_type_falls_back_to_cover_sheet_run_log(self) -> None:
        record = make_test_execution()

        merged = exec_storage._load_merged_logs(record["execution_id"])

        assert len(merged) == 7
        assert [entry["seq"] for entry in merged] == [0, 1, 2, 3, 4, 5, 6]
        for entry in merged:
            assert entry["run_id"] == record["execution_id"]
            assert entry["scope_kind"] == "test"

    def test_test_type_without_run_id_yields_no_logs(self) -> None:
        record = make_test_execution(with_run_id=False)

        assert exec_storage._load_merged_logs(record["execution_id"]) == []

    def test_builder_logs_use_merged_walk(self) -> None:
        record = make_suite_execution()

        logs = _build(record["execution_id"])["logs"]

        assert len(logs) == 8
        assert logs[0]["scope_kind"] == "suite"
        assert logs[1]["run_id"] == record["run_ids"][0]
        for entry in logs:
            assert entry["level"] in ("DEBUG", "INFO", "WARN", "ERROR", "FATAL")
            assert "timestamp" in entry
            assert "source" in entry
            assert "message" in entry


class TestProgressCallback:
    """Determinate progress, one callback per processed run."""

    def test_callback_invoked_once_per_dispatched_run(self) -> None:
        record = make_suite_execution()
        calls: list[int] = []

        _build(record["execution_id"], on_run_processed=lambda: calls.append(1))

        assert len(calls) == 3


class TestSessionModel:
    """Workbench session report variant."""

    @staticmethod
    def _session(status: str = "failed") -> dict[str, Any]:
        return {
            "session_id": "11111111-2222-3333-4444-555555555555",
            "status": status,
            "test_id": "66666666-7777-8888-9999-000000000000",
            "test_name": "Scratch Inventory Test",
            "environment_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "user_id": "dev",
            "started_at": "2026-06-10T11:06:52+00:00",
            "variables": {},
            "block_states": {"node-a": "passed", "node-b": "failed"},
            "execution_id": None,
            "parent_execution_id": None,
            "artifacts_dir": None,
        }

    @staticmethod
    def _logs() -> list[dict[str, Any]]:
        return [
            {
                "id": "log-1",
                "sequence": 0,
                "timestamp": ts(0.2),
                "level": "INFO",
                "message": "Block A done",
                "source": "Log : A",
                "blockId": "node-a",
            },
            {
                "id": "log-2",
                "sequence": 1,
                "timestamp": ts(1.7),
                "level": "ERROR",
                "message": "Assertion failed: totals mismatch",
                "source": "Assert : B",
                "blockId": "node-b",
            },
        ]

    def test_session_replaces_execution_identity(self) -> None:
        report = _build_session(self._session(), self._logs())

        assert "execution" not in report
        assert report["session"] == {
            "session_id": "11111111-2222-3333-4444-555555555555",
            "test_id": "66666666-7777-8888-9999-000000000000",
            "test_name": "Scratch Inventory Test",
            "environment_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "status": "failed",
            "started_at": "2026-06-10T11:06:52+00:00",
        }
        assert report["schema_version"] == 1
        assert report["summary"]["status"] == "failed"

    def test_session_blocks_from_states_and_log_timing(self) -> None:
        report = _build_session(self._session(), self._logs())

        blocks = {block["block_id"]: block for block in report["timeline"]["blocks"]}
        assert blocks["node-a"]["status"] == "passed"
        assert blocks["node-a"]["block_path"] == "node-a"
        assert blocks["node-a"]["started_at"] == ts(0.2)
        assert blocks["node-b"]["status"] == "failed"
        assert blocks["node-b"]["ended_at"] == ts(1.7)

    def test_session_blocks_resolve_paths_from_engine_node_map(self) -> None:
        session = self._session()
        session["_node_map"] = {
            "node-start": {"id": "node-start", "type": "input", "data": {}},
            "node-b": {
                "id": "node-b",
                "type": "workflowNode",
                "data": {"nodeType": "plugin", "label": "Assert_Totals"},
            },
            "node-a": {
                "id": "node-a",
                "type": "workflowNode",
                "data": {"nodeType": "plugin", "label": "Init_Session"},
            },
        }
        session["_adj"] = {
            "node-start": [("node-a", None)],
            "node-a": [("node-b", None)],
        }

        logs = [
            *self._logs(),
            {
                "id": "log-3",
                "sequence": 2,
                "timestamp": ts(2.0),
                "level": "FATAL",
                "message": "Session torn down",
                "source": "SYSTEM",
                "blockId": None,
            },
        ]

        report = _build_session(session, logs)

        blocks = report["timeline"]["blocks"]
        assert [block["block_id"] for block in blocks] == ["node-a", "node-b"]
        assert blocks[0]["block_path"] == "Init_Session"
        assert blocks[0]["status"] == "passed"
        assert blocks[0]["started_at"] == ts(0.2)
        assert report["errors"][0]["block_path"] == "Assert_Totals"
        assert report["errors"][1]["block_path"] is None

    def test_session_never_reached_blocks_stay_in_the_model(self) -> None:
        session = self._session()
        session["_node_map"] = {
            "node-a": {
                "id": "node-a",
                "type": "workflowNode",
                "data": {"nodeType": "plugin", "label": "Init_Session"},
            },
            "node-b": {
                "id": "node-b",
                "type": "workflowNode",
                "data": {"nodeType": "plugin", "label": "Assert_Totals"},
            },
            "node-c": {
                "id": "node-c",
                "type": "workflowNode",
                "data": {"nodeType": "plugin", "label": "Cleanup_Tmp"},
            },
        }
        session["_adj"] = {"node-a": [("node-b", None)], "node-b": [("node-c", None)]}

        report = _build_session(session, self._logs())

        blocks = {block["block_id"]: block for block in report["timeline"]["blocks"]}
        assert blocks["node-c"]["status"] == "pending"

    def test_session_logs_keep_sequence_key(self) -> None:
        report = _build_session(self._session(), self._logs())

        assert [entry["sequence"] for entry in report["logs"]] == [0, 1]
        for entry in report["logs"]:
            assert "seq" not in entry

    def test_session_errors_extracted_without_context(self) -> None:
        report = _build_session(self._session(), self._logs())

        assert len(report["errors"]) == 1
        error = report["errors"][0]
        assert error["level"] == "ERROR"
        assert error["message"] == "Assertion failed: totals mismatch"
        assert error["block_path"] == "node-b"
        assert error["timestamp"] == ts(1.7)
        assert "context" not in error
