"""Suite/regression execution orchestration.

Builds the static ``composition`` tree for tracked suite and regression runs,
seeds the initial per-test runtime state, and drives the sequential per-test
workbench iteration, appending runs.yaml / status.yaml entries as each child
progresses.

Status vocabulary (per-run):
- pending: entry awaiting execution start
- running: workbench is currently driving this entry
- passed / failed: terminal outcome of a completed workbench run
- stopped: entry canceled mid-run by user stop
- skipped: entry terminated mid-run (halt fan-out, stop fan-out, or a
  per-entry halt with status=skipped)
- excluded: entry never selected at dispatch time

The regression variant records both suite_id and test_id on every
composition entry so a test that appears in multiple suites of the same
regression is independently addressable per suite context.
"""

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

# ---------------------------------------------------------------------------
# Composition building
# ---------------------------------------------------------------------------


def _is_pair_selected(
    suite_id: str,
    test_id: str,
    selected_pairs: list[dict[str, Any]] | None,
) -> bool:
    if selected_pairs is None:
        return True
    return any(
        pair.get("suite_id") == suite_id and pair.get("test_id") == test_id
        for pair in selected_pairs
    )


def build_suite_composition(
    suite_entity: dict[str, Any],
    selected_test_ids: list[str] | None,
    test_lookup: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], set[str]]:
    """Return ``(composition, selected_run_ids)`` for a suite execution.

    The composition lists every test the suite declares in declared order.
    Each test gets a fresh ``run_id`` (the filename/key used by logs,
    snapshots, and the Historical Test Canvas URL). Non-selected tests still
    appear - their run_id just isn't in ``selected_run_ids`` so the driver
    seeds them as ``excluded``.
    """
    suite_id = suite_entity.get("id")
    suite_name = suite_entity.get("name", "")
    tests: list[dict[str, Any]] = []
    selected_run_ids: set[str] = set()
    for test_id in suite_entity.get("tests", []) or []:
        test = test_lookup.get(test_id, {})
        run_id = str(uuid.uuid4())
        tests.append(
            {
                "id": test_id,
                "name": test.get("name", ""),
                "run_id": run_id,
            }
        )
        if selected_test_ids is None or test_id in selected_test_ids:
            selected_run_ids.add(run_id)
    composition = {
        "suites": [
            {
                "id": suite_id,
                "name": suite_name,
                "tests": tests,
            }
        ]
    }
    return composition, selected_run_ids


def build_regression_composition(
    regression_entity: dict[str, Any],
    selected_pairs: list[dict[str, Any]] | None,
    suite_lookup: dict[str, dict[str, Any]],
    test_lookup: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], set[str]]:
    """Return ``(composition, selected_run_ids)`` for a regression execution.

    Respects ``regression.suites`` declaration order, then each suite's tests.
    Every (suite_id, test_id) pair gets a unique ``run_id`` so duplicate
    tests across suites stay independently addressable.
    """
    suites: list[dict[str, Any]] = []
    selected_run_ids: set[str] = set()
    for suite_id in regression_entity.get("suites", []) or []:
        suite = suite_lookup.get(suite_id)
        if suite is None:
            continue
        tests: list[dict[str, Any]] = []
        for test_id in suite.get("tests", []) or []:
            test = test_lookup.get(test_id, {})
            run_id = str(uuid.uuid4())
            tests.append(
                {
                    "id": test_id,
                    "name": test.get("name", ""),
                    "run_id": run_id,
                }
            )
            if _is_pair_selected(suite_id, test_id, selected_pairs):
                selected_run_ids.add(run_id)
        suites.append(
            {
                "id": suite_id,
                "name": suite.get("name", ""),
                "tests": tests,
            }
        )
    return {"suites": suites}, selected_run_ids


def iter_composition_runs(composition: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten the composition into an ordered list of ``{run_id, test_id,
    test_name, suite_id, suite_name}`` dicts matching the sequential driver's
    dispatch order."""
    flat: list[dict[str, Any]] = []
    for suite in composition.get("suites", []):
        for test in suite.get("tests", []):
            flat.append(
                {
                    "run_id": test.get("run_id"),
                    "test_id": test.get("id"),
                    "test_name": test.get("name", ""),
                    "suite_id": suite.get("id"),
                    "suite_name": suite.get("name", ""),
                }
            )
    return flat


# ---------------------------------------------------------------------------
# Terminal status aggregation
# ---------------------------------------------------------------------------


_BENIGN_STATUSES = frozenset({"passed", "skipped", "excluded"})


def aggregate_final_status(runs: dict[str, dict[str, Any]]) -> str:
    """Compute the execution's terminal status from the per-run state map.

    Rules:
    - any 'stopped' => 'stopped' (user stop takes precedence)
    - any run that isn't passed/skipped/excluded (i.e. failed, or leftover
      pending/running) => 'failed'
    - all SELECTED runs (excluded does not count) were 'skipped' => 'skipped'
    - any 'passed' among selected runs => 'passed'
    - empty selection (all excluded or no runs) => 'passed' (nothing failed)
    """
    has_failed = False
    has_passed = False
    has_skipped = False
    for run in runs.values():
        status = run.get("status")
        if status == "stopped":
            return "stopped"
        if status not in _BENIGN_STATUSES:
            has_failed = True
            continue
        if status == "passed":
            has_passed = True
        elif status == "skipped":
            has_skipped = True
        # excluded: not selected, not counted

    if has_failed:
        return "failed"
    if has_passed:
        return "passed"
    if has_skipped:
        return "skipped"
    return "passed"


# ---------------------------------------------------------------------------
# Sequential execution driver
# ---------------------------------------------------------------------------


RunTestFn = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class _Halt:
    __slots__ = ("scope", "status")

    def __init__(self, scope: str, status: str) -> None:
        self.scope = scope
        self.status = status


def _mark_remaining_skipped(
    flat_runs: list[dict[str, Any]],
    start_index: int,
    runs_state: dict[str, dict[str, Any]],
    mark: Callable[[str], None],
) -> None:
    """Cascade 'skipped' across every remaining pending entry from ``start_index``."""
    for entry in flat_runs[start_index:]:
        run_id = entry["run_id"]
        run = runs_state.get(run_id)
        if run is not None and run.get("status") == "pending":
            mark(run_id)


def _mark_remaining_in_suite_skipped(
    flat_runs: list[dict[str, Any]],
    start_index: int,
    suite_id: str | None,
    runs_state: dict[str, dict[str, Any]],
    mark: Callable[[str], None],
) -> None:
    """Cascade 'skipped' within the current suite only. Stops at the first
    entry outside the suite so the next suite still runs."""
    for entry in flat_runs[start_index:]:
        if entry.get("suite_id") != suite_id:
            return
        run_id = entry["run_id"]
        run = runs_state.get(run_id)
        if run is not None and run.get("status") == "pending":
            mark(run_id)


def _apply_halt_fanout(
    flat_runs: list[dict[str, Any]],
    next_index: int,
    entry: dict[str, Any],
    scope: str,
    status: str,
    runs_state: dict[str, dict[str, Any]],
    mark: Callable[[str], None],
    single_suite: bool,
) -> _Halt | None:
    if scope == "regression":
        _mark_remaining_skipped(flat_runs, next_index, runs_state, mark)
        return _Halt("regression", status)
    suite_id = entry.get("suite_id")
    _mark_remaining_in_suite_skipped(flat_runs, next_index, suite_id, runs_state, mark)
    if single_suite:
        return _Halt("suite", status)
    return None


async def drive_sequential_execution(
    flat_runs: list[dict[str, Any]],
    runs_state: dict[str, dict[str, Any]],
    run_test: RunTestFn,
    mark_skipped: Callable[[str], None],
    *,
    stop_requested: Callable[[], bool] = lambda: False,
    single_suite: bool = True,
) -> str:
    """Iterate the composition-flattened dispatch list, driving each pending
    entry to terminal and returning the aggregated parent status.

    ``runs_state`` is the mutable per-run state map carried on the execution's
    runtime state; the driver reads ``status`` to skip excluded/non-pending
    entries. ``mark_skipped(run_id)`` is called for every entry that needs to
    cascade to 'skipped' (via halt fan-out or user stop); the caller wires
    this to the status-append helper so the transition is persisted.

    ``run_test(entry)`` resolves with ``{status, duration, halt_scope}``:
    - ``halt_scope`` None or "test" for normal termination (no fan-out).
    - ``halt_scope == "suite"`` cascades 'skipped' across the rest of that
      suite; a single-suite execution ends here, a regression continues.
    - ``halt_scope == "regression"`` cascades 'skipped' across every
      remaining pending entry and ends the loop.
    """
    if stop_requested():
        _cascade_pending_skipped(flat_runs, runs_state, mark_skipped)
        return "stopped"

    halt: _Halt | None = None

    for i, entry in enumerate(flat_runs):
        run = runs_state.get(entry["run_id"])
        if run is None or run.get("status") != "pending":
            continue

        result = await run_test(entry)

        halt_scope = result.get("halt_scope")
        if halt_scope in ("suite", "regression"):
            halt = _apply_halt_fanout(
                flat_runs,
                i + 1,
                entry,
                halt_scope,
                result["status"],
                runs_state,
                mark_skipped,
                single_suite,
            )
            if halt is not None:
                break
            continue

        if result["status"] == "stopped" or stop_requested():
            _cascade_pending_skipped(flat_runs[i + 1 :], runs_state, mark_skipped)
            return "stopped"

    if halt is not None:
        return halt.status
    return aggregate_final_status(runs_state)


def _cascade_pending_skipped(
    entries: list[dict[str, Any]],
    runs_state: dict[str, dict[str, Any]],
    mark_skipped: Callable[[str], None],
) -> None:
    """Mark every ``pending`` entry in ``entries`` as skipped via the
    caller-supplied ``mark_skipped`` callback."""
    for entry in entries:
        run = runs_state.get(entry["run_id"])
        if run is not None and run.get("status") == "pending":
            mark_skipped(entry["run_id"])
