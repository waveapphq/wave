"""Unit tests for the active-execution lookups.

``get_active_tracked_executions`` is the single source of truth used by the
three entity-delete guards (tests, suites, regressions) to decide whether a
delete is blocked by an in-flight tracked execution.
``get_active_executions_holding_test`` widens that to suite and regression
records whose runs carry the test. Both return the blocking execution
identifiers (not just a boolean) so the route layer can surface them in the
409 response payload.
"""

from __future__ import annotations

import pytest

from wavecore.api.services.executions import _storage as _exec_storage


@pytest.fixture(autouse=True)
def _reset_execution_cache():
    _exec_storage._clear_storage()
    yield
    _exec_storage._clear_storage()


def _seed_execution(
    *,
    execution_id: str,
    entity_type: str,
    entity_id: str,
    status: str,
) -> None:
    """Seed a single tracked execution in the in-memory cache.

    The helper only needs the minimum fields that the query reads so we avoid
    the full orchestrator boilerplate and keep tests fast.
    """
    _exec_storage._execution_storage[execution_id] = {
        "id": execution_id,
        "name": f"exec-{execution_id}",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "environment_id": "env-1",
        "status": status,
        "started_at": "2026-04-20T10:00:00+00:00",
        "triggered_by": "dev",
    }


class TestGetActiveTrackedExecutions:
    """Covers the filter contract: match by entity_type + entity_id + status."""

    def test_returns_empty_when_no_executions(self) -> None:
        result = _exec_storage.get_active_tracked_executions("test", "t1")
        assert result == []

    def test_returns_running_execution_id(self) -> None:
        _seed_execution(
            execution_id="exec-1",
            entity_type="test",
            entity_id="t1",
            status="running",
        )
        result = _exec_storage.get_active_tracked_executions("test", "t1")
        assert result == ["exec-1"]

    def test_returns_paused_execution_id(self) -> None:
        _seed_execution(
            execution_id="exec-2",
            entity_type="test",
            entity_id="t1",
            status="paused",
        )
        result = _exec_storage.get_active_tracked_executions("test", "t1")
        assert result == ["exec-2"]

    def test_returns_multiple_active_execution_ids(self) -> None:
        _seed_execution(
            execution_id="exec-1",
            entity_type="test",
            entity_id="t1",
            status="running",
        )
        _seed_execution(
            execution_id="exec-2",
            entity_type="test",
            entity_id="t1",
            status="paused",
        )
        result = _exec_storage.get_active_tracked_executions("test", "t1")
        assert set(result) == {"exec-1", "exec-2"}

    def test_excludes_terminal_statuses(self) -> None:
        for idx, terminal_status in enumerate(("passed", "failed", "stopped", "skipped")):
            _seed_execution(
                execution_id=f"exec-{idx}",
                entity_type="test",
                entity_id="t1",
                status=terminal_status,
            )
        result = _exec_storage.get_active_tracked_executions("test", "t1")
        assert result == []

    def test_filters_by_entity_type(self) -> None:
        _seed_execution(
            execution_id="exec-test",
            entity_type="test",
            entity_id="same-id",
            status="running",
        )
        _seed_execution(
            execution_id="exec-suite",
            entity_type="suite",
            entity_id="same-id",
            status="running",
        )

        test_result = _exec_storage.get_active_tracked_executions("test", "same-id")
        suite_result = _exec_storage.get_active_tracked_executions("suite", "same-id")

        assert test_result == ["exec-test"]
        assert suite_result == ["exec-suite"]

    def test_filters_by_entity_id(self) -> None:
        _seed_execution(
            execution_id="exec-a",
            entity_type="test",
            entity_id="t1",
            status="running",
        )
        _seed_execution(
            execution_id="exec-b",
            entity_type="test",
            entity_id="t2",
            status="running",
        )

        result = _exec_storage.get_active_tracked_executions("test", "t1")
        assert result == ["exec-a"]

    def test_supports_suite_entity_type(self) -> None:
        _seed_execution(
            execution_id="exec-s",
            entity_type="suite",
            entity_id="s1",
            status="running",
        )
        result = _exec_storage.get_active_tracked_executions("suite", "s1")
        assert result == ["exec-s"]

    def test_supports_regression_entity_type(self) -> None:
        _seed_execution(
            execution_id="exec-r",
            entity_type="regression",
            entity_id="r1",
            status="paused",
        )
        result = _exec_storage.get_active_tracked_executions("regression", "r1")
        assert result == ["exec-r"]

    def test_ensures_cache_loaded_on_first_call(self) -> None:
        """Helper must work even when the cache has been cleared and not
        pre-populated via seeding the dict directly."""
        _exec_storage._clear_in_memory_cache()
        result = _exec_storage.get_active_tracked_executions("test", "never-existed")
        assert result == []


def _seed_child_run(
    *,
    execution_id: str,
    test_id: str,
    persist_only: bool = False,
) -> None:
    """Attach one dispatched child run of ``test_id`` to a parent execution.

    ``persist_only`` writes runs.yaml alone, the shape a process that just
    started sees before any runtime state exists.
    """
    run_id = f"run-{execution_id}"
    if persist_only:
        _exec_storage._append_run(
            execution_id,
            {"run_id": run_id, "test_id": test_id, "suite_id": "s1"},
        )
        return
    _exec_storage._record_run_dispatched(execution_id, run_id, test_id, "s1")


class TestGetActiveExecutionsHoldingTest:
    """Active records whose own entity is the test, plus active parents running it."""

    def test_returns_empty_when_nothing_holds_the_test(self) -> None:
        assert _exec_storage.get_active_executions_holding_test("t1") == []

    def test_returns_the_tests_own_running_execution(self) -> None:
        _seed_execution(
            execution_id="exec-own",
            entity_type="test",
            entity_id="t1",
            status="running",
        )

        assert _exec_storage.get_active_executions_holding_test("t1") == ["exec-own"]

    def test_returns_the_tests_own_paused_execution(self) -> None:
        _seed_execution(
            execution_id="exec-own",
            entity_type="test",
            entity_id="t1",
            status="paused",
        )

        assert _exec_storage.get_active_executions_holding_test("t1") == ["exec-own"]

    def test_excludes_the_tests_own_terminal_execution(self) -> None:
        _seed_execution(
            execution_id="exec-own",
            entity_type="test",
            entity_id="t1",
            status="passed",
        )

        assert _exec_storage.get_active_executions_holding_test("t1") == []

    def test_returns_an_active_suite_running_the_test(self) -> None:
        _seed_execution(
            execution_id="exec-suite",
            entity_type="suite",
            entity_id="s1",
            status="running",
        )
        _seed_child_run(execution_id="exec-suite", test_id="t1")

        assert _exec_storage.get_active_executions_holding_test("t1") == ["exec-suite"]

    def test_returns_an_active_suite_whose_runs_live_only_on_disk(self) -> None:
        _seed_execution(
            execution_id="exec-suite",
            entity_type="suite",
            entity_id="s1",
            status="running",
        )
        _seed_child_run(execution_id="exec-suite", test_id="t1", persist_only=True)

        assert _exec_storage.get_active_executions_holding_test("t1") == ["exec-suite"]

    def test_returns_an_active_regression_running_the_test(self) -> None:
        _seed_execution(
            execution_id="exec-reg",
            entity_type="regression",
            entity_id="r1",
            status="paused",
        )
        _seed_child_run(execution_id="exec-reg", test_id="t1")

        assert _exec_storage.get_active_executions_holding_test("t1") == ["exec-reg"]

    def test_excludes_a_terminal_suite_that_ran_the_test(self) -> None:
        _seed_execution(
            execution_id="exec-suite",
            entity_type="suite",
            entity_id="s1",
            status="passed",
        )
        _seed_child_run(execution_id="exec-suite", test_id="t1")

        assert _exec_storage.get_active_executions_holding_test("t1") == []

    def test_excludes_a_suite_running_another_test(self) -> None:
        _seed_execution(
            execution_id="exec-suite",
            entity_type="suite",
            entity_id="s1",
            status="running",
        )
        _seed_child_run(execution_id="exec-suite", test_id="t2")

        assert _exec_storage.get_active_executions_holding_test("t1") == []

    def test_reports_an_execution_once_when_it_matches_both_ways(self) -> None:
        _seed_execution(
            execution_id="exec-own",
            entity_type="test",
            entity_id="t1",
            status="running",
        )
        _seed_child_run(execution_id="exec-own", test_id="t1")

        assert _exec_storage.get_active_executions_holding_test("t1") == ["exec-own"]

    def test_reports_every_holder(self) -> None:
        _seed_execution(
            execution_id="exec-own",
            entity_type="test",
            entity_id="t1",
            status="running",
        )
        _seed_execution(
            execution_id="exec-suite",
            entity_type="suite",
            entity_id="s1",
            status="running",
        )
        _seed_child_run(execution_id="exec-suite", test_id="t1")

        assert set(_exec_storage.get_active_executions_holding_test("t1")) == {
            "exec-own",
            "exec-suite",
        }

    def test_ensures_cache_loaded_on_first_call(self) -> None:
        _exec_storage._clear_in_memory_cache()

        assert _exec_storage.get_active_executions_holding_test("never-existed") == []
