"""Orchestrator composition and sequential driver tests."""

from typing import Any

import pytest

from wavecore.api.services.executions import orchestrator

# ---------------------------------------------------------------------------
# Composition building
# ---------------------------------------------------------------------------


class TestSuiteComposition:
    def test_suite_composition_mints_run_ids(self) -> None:
        suite = {
            "id": "s1",
            "name": "S1",
            "tests": ["t1", "t2"],
        }
        test_lookup = {
            "t1": {"id": "t1", "name": "T1"},
            "t2": {"id": "t2", "name": "T2"},
        }
        composition, selected = orchestrator.build_suite_composition(
            suite, selected_test_ids=None, test_lookup=test_lookup
        )
        tests = composition["suites"][0]["tests"]
        assert [t["id"] for t in tests] == ["t1", "t2"]
        assert all(t["run_id"] for t in tests)
        # With no subset, every run_id is selected.
        assert {t["run_id"] for t in tests} == selected

    def test_suite_composition_narrows_selection(self) -> None:
        suite = {"id": "s1", "name": "S", "tests": ["a", "b"]}
        lookup = {"a": {"id": "a"}, "b": {"id": "b"}}
        composition, selected = orchestrator.build_suite_composition(
            suite, selected_test_ids=["a"], test_lookup=lookup
        )
        tests = composition["suites"][0]["tests"]
        assert len(selected) == 1
        # Only the run_id for test "a" is in the selected set.
        a_run_id = next(t["run_id"] for t in tests if t["id"] == "a")
        assert selected == {a_run_id}


class TestRegressionComposition:
    def test_orders_by_suite_then_test_declaration(self) -> None:
        regression = {"id": "r1", "suites": ["sA", "sB"]}
        suites = {
            "sA": {"id": "sA", "name": "A", "tests": ["t1", "t2"]},
            "sB": {"id": "sB", "name": "B", "tests": ["t3"]},
        }
        tests = {
            "t1": {"id": "t1", "name": "T1"},
            "t2": {"id": "t2", "name": "T2"},
            "t3": {"id": "t3", "name": "T3"},
        }
        composition, selected = orchestrator.build_regression_composition(
            regression, selected_pairs=None, suite_lookup=suites, test_lookup=tests
        )
        flat = orchestrator.iter_composition_runs(composition)
        assert [(f["suite_id"], f["test_id"]) for f in flat] == [
            ("sA", "t1"),
            ("sA", "t2"),
            ("sB", "t3"),
        ]
        assert len(selected) == 3

    def test_duplicate_test_ids_across_suites_get_distinct_run_ids(self) -> None:
        regression = {"id": "r1", "suites": ["sA", "sB"]}
        suites = {
            "sA": {"id": "sA", "tests": ["t1"]},
            "sB": {"id": "sB", "tests": ["t1"]},
        }
        tests = {"t1": {"id": "t1", "name": "T1"}}
        composition, _ = orchestrator.build_regression_composition(
            regression, selected_pairs=None, suite_lookup=suites, test_lookup=tests
        )
        flat = orchestrator.iter_composition_runs(composition)
        assert len(flat) == 2
        assert flat[0]["run_id"] != flat[1]["run_id"]

    def test_selected_pairs_filter(self) -> None:
        regression = {"id": "r1", "suites": ["sA"]}
        suites = {"sA": {"id": "sA", "tests": ["t1", "t2"]}}
        tests = {"t1": {"id": "t1"}, "t2": {"id": "t2"}}
        composition, selected = orchestrator.build_regression_composition(
            regression,
            selected_pairs=[{"suite_id": "sA", "test_id": "t2"}],
            suite_lookup=suites,
            test_lookup=tests,
        )
        flat = orchestrator.iter_composition_runs(composition)
        t2_run_id = next(f["run_id"] for f in flat if f["test_id"] == "t2")
        assert selected == {t2_run_id}

    def test_missing_suite_is_skipped(self) -> None:
        regression = {"id": "r1", "suites": ["ghost"]}
        composition, _ = orchestrator.build_regression_composition(
            regression, selected_pairs=None, suite_lookup={}, test_lookup={}
        )
        assert composition == {"suites": []}


# ---------------------------------------------------------------------------
# Status aggregation
# ---------------------------------------------------------------------------


class TestAggregateFinalStatus:
    def test_all_benign_returns_passed(self) -> None:
        runs = {
            "r1": {"status": "passed"},
            "r2": {"status": "skipped"},
            "r3": {"status": "excluded"},
        }
        assert orchestrator.aggregate_final_status(runs) == "passed"

    def test_any_failed_returns_failed(self) -> None:
        runs = {"r1": {"status": "passed"}, "r2": {"status": "failed"}}
        assert orchestrator.aggregate_final_status(runs) == "failed"

    def test_stopped_wins_over_failed(self) -> None:
        runs = {"r1": {"status": "failed"}, "r2": {"status": "stopped"}}
        assert orchestrator.aggregate_final_status(runs) == "stopped"

    def test_lingering_non_terminal_counts_as_failed(self) -> None:
        runs = {"r1": {"status": "pending"}}
        assert orchestrator.aggregate_final_status(runs) == "failed"

    def test_all_selected_skipped_returns_skipped(self) -> None:
        # If every selected run ended in skipped (and
        # none passed / failed / stopped), the parent execution is
        # skipped - not passed.
        runs = {
            "r1": {"status": "skipped"},
            "r2": {"status": "skipped"},
            "r3": {"status": "skipped"},
        }
        assert orchestrator.aggregate_final_status(runs) == "skipped"

    def test_skipped_plus_excluded_still_skipped(self) -> None:
        # Excluded rows don't count towards aggregation; a suite where
        # the selected tests all skipped is still "skipped" even if
        # other rows in the composition were excluded.
        runs = {
            "r1": {"status": "skipped"},
            "r2": {"status": "excluded"},
        }
        assert orchestrator.aggregate_final_status(runs) == "skipped"

    def test_any_passed_wins_over_skipped(self) -> None:
        # If even one selected test actually passed, the parent is
        # "passed" - skipped-ness requires ALL selected to have skipped.
        runs = {
            "r1": {"status": "passed"},
            "r2": {"status": "skipped"},
            "r3": {"status": "skipped"},
        }
        assert orchestrator.aggregate_final_status(runs) == "passed"

    def test_empty_or_all_excluded_returns_passed(self) -> None:
        # Nothing ran and nothing failed - default to "passed" so the
        # parent doesn't misrepresent an empty selection as a halt.
        assert orchestrator.aggregate_final_status({}) == "passed"
        assert (
            orchestrator.aggregate_final_status(
                {"r1": {"status": "excluded"}, "r2": {"status": "excluded"}}
            )
            == "passed"
        )


# ---------------------------------------------------------------------------
# Sequential driver
# ---------------------------------------------------------------------------


def _marker(tracking: list[str], runs_state: dict[str, dict[str, Any]] | None = None) -> Any:
    def mark(run_id: str) -> None:
        tracking.append(run_id)
        if runs_state is not None and run_id in runs_state:
            runs_state[run_id]["status"] = "skipped"

    return mark


def _runs_map(ids: list[str]) -> dict[str, dict[str, Any]]:
    return {rid: {"status": "pending"} for rid in ids}


def _flat(run_ids: list[str], suite_id: str | None = "s1") -> list[dict[str, Any]]:
    return [
        {
            "run_id": rid,
            "test_id": f"t-{rid}",
            "test_name": rid,
            "suite_id": suite_id,
            "suite_name": "S",
        }
        for rid in run_ids
    ]


@pytest.mark.asyncio
async def test_driver_marks_all_skipped_when_stop_requested_up_front() -> None:
    run_ids = ["r1", "r2"]
    runs_state = _runs_map(run_ids)
    tracking: list[str] = []

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:  # pragma: no cover
        raise AssertionError("should not run")

    terminal = await orchestrator.drive_sequential_execution(
        _flat(run_ids),
        runs_state,
        run_test,
        _marker(tracking, runs_state),
        stop_requested=lambda: True,
    )
    assert terminal == "stopped"
    assert tracking == run_ids


@pytest.mark.asyncio
async def test_driver_dispatches_each_pending_entry() -> None:
    run_ids = ["r1", "r2"]
    runs_state = _runs_map(run_ids)
    order: list[str] = []

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:
        order.append(entry["run_id"])
        runs_state[entry["run_id"]]["status"] = "passed"
        return {"status": "passed", "duration": 1.0, "halt_scope": None}

    terminal = await orchestrator.drive_sequential_execution(
        _flat(run_ids), runs_state, run_test, _marker([], runs_state)
    )
    assert terminal == "passed"
    assert order == run_ids


@pytest.mark.asyncio
async def test_halt_scope_suite_cascades_within_suite() -> None:
    run_ids = ["r1", "r2", "r3"]
    runs_state = _runs_map(run_ids)
    tracking: list[str] = []

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:
        if entry["run_id"] == "r1":
            runs_state["r1"]["status"] = "skipped"
            return {"status": "skipped", "duration": 0.0, "halt_scope": "suite"}
        runs_state[entry["run_id"]]["status"] = "passed"
        return {"status": "passed", "duration": 1.0, "halt_scope": None}

    terminal = await orchestrator.drive_sequential_execution(
        _flat(run_ids, suite_id="s1"),
        runs_state,
        run_test,
        _marker(tracking, runs_state),
    )
    # Single-suite execution: halt scope=suite ends the run.
    assert terminal == "skipped"
    # Only r1 actually ran; r2, r3 cascaded.
    assert tracking == ["r2", "r3"]


@pytest.mark.asyncio
async def test_halt_scope_regression_stops_everywhere() -> None:
    run_ids = ["r1", "r2", "r3"]
    runs_state = _runs_map(run_ids)
    tracking: list[str] = []

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:
        if entry["run_id"] == "r1":
            return {"status": "failed", "duration": 0.0, "halt_scope": "regression"}
        return {"status": "passed", "duration": 1.0, "halt_scope": None}

    terminal = await orchestrator.drive_sequential_execution(
        _flat(run_ids),
        runs_state,
        run_test,
        _marker(tracking, runs_state),
    )
    assert terminal == "failed"
    assert tracking == ["r2", "r3"]


@pytest.mark.asyncio
async def test_stopped_result_cascades_skipped() -> None:
    run_ids = ["r1", "r2"]
    runs_state = _runs_map(run_ids)
    tracking: list[str] = []

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:
        runs_state[entry["run_id"]]["status"] = "stopped"
        return {"status": "stopped", "duration": 0.0, "halt_scope": None}

    terminal = await orchestrator.drive_sequential_execution(
        _flat(run_ids),
        runs_state,
        run_test,
        _marker(tracking, runs_state),
    )
    assert terminal == "stopped"
    assert tracking == ["r2"]


@pytest.mark.asyncio
async def test_stop_requested_midflight() -> None:
    run_ids = ["r1", "r2"]
    runs_state = _runs_map(run_ids)
    stop_after_first = {"called": False}
    tracking: list[str] = []

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:
        runs_state[entry["run_id"]]["status"] = "passed"
        stop_after_first["called"] = True
        return {"status": "passed", "duration": 1.0, "halt_scope": None}

    terminal = await orchestrator.drive_sequential_execution(
        _flat(run_ids),
        runs_state,
        run_test,
        _marker(tracking, runs_state),
        stop_requested=lambda: stop_after_first["called"],
    )
    assert terminal == "stopped"
    assert tracking == ["r2"]


@pytest.mark.asyncio
async def test_excluded_entries_are_skipped_by_driver() -> None:
    run_ids = ["r1", "r2", "r3"]
    runs_state = _runs_map(run_ids)
    runs_state["r2"]["status"] = "excluded"
    order: list[str] = []

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:
        order.append(entry["run_id"])
        runs_state[entry["run_id"]]["status"] = "passed"
        return {"status": "passed", "duration": 1.0, "halt_scope": None}

    await orchestrator.drive_sequential_execution(
        _flat(run_ids), runs_state, run_test, _marker([], runs_state)
    )
    assert order == ["r1", "r3"]


@pytest.mark.asyncio
async def test_halt_scope_suite_in_regression_continues_to_next_suite() -> None:
    """In regression-mode, halt_scope=suite cascades within suite A only,
    then the driver continues with suite B."""
    flat = [
        {"run_id": "r1", "test_id": "t1", "suite_id": "sA", "suite_name": "A"},
        {"run_id": "r2", "test_id": "t2", "suite_id": "sA", "suite_name": "A"},
        {"run_id": "r3", "test_id": "t3", "suite_id": "sB", "suite_name": "B"},
    ]
    runs_state = _runs_map(["r1", "r2", "r3"])
    tracking: list[str] = []
    order: list[str] = []

    async def run_test(entry: dict[str, Any]) -> dict[str, Any]:
        order.append(entry["run_id"])
        if entry["run_id"] == "r1":
            runs_state["r1"]["status"] = "failed"
            return {"status": "failed", "duration": 0.0, "halt_scope": "suite"}
        runs_state[entry["run_id"]]["status"] = "passed"
        return {"status": "passed", "duration": 1.0, "halt_scope": None}

    terminal = await orchestrator.drive_sequential_execution(
        flat,
        runs_state,
        run_test,
        _marker(tracking, runs_state),
        single_suite=False,
    )
    # r1 ran and failed; r2 cascaded to skipped (same suite); r3 ran in the
    # next suite.
    assert order == ["r1", "r3"]
    assert tracking == ["r2"]
    # Aggregated terminal is failed (r1 failed, r3 passed).
    assert terminal == "failed"
