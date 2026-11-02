"""Execution storage persistence tests.

Covers the append-only on-disk layout under ``data/api_executions/<exec_id>/``:

- ``execution.yaml`` - rewritten only at start and terminal.
- ``composition.yaml`` - written once, never rewritten.
- ``runs.yaml`` - APPEND-ONLY, one entry per dispatched test.
- ``status.yaml`` - APPEND-ONLY, one entry per state transition.
- ``logs/<run_id>.yaml`` - per-test append-only console.
- ``snapshots/<run_id>.yaml`` - per-test terminal snapshot, written once.
- ``variables.yaml`` - test-type executions only.
- ``breakpoints.yaml`` - debug-mode executions only.

Plus runtime-state rebuild from disk after restart, orphan recovery, and
lookup helpers.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from wavecore.api.services import storage_paths
from wavecore.api.services.executions import _storage as store
from wavecore.core.table import Table

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_storage(tmp_path: Any) -> Any:
    storage_paths.set_base_path(Path(tmp_path))
    store._clear_storage()
    yield tmp_path
    store._clear_storage()


def _seed_execution(
    entity_type: str = "suite",
    composition_tests: list[tuple[str, str, str]] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Seed a minimal execution + composition on disk and in memory."""
    exec_id = str(uuid.uuid4())
    execution = {
        "id": exec_id,
        "name": "test-exec",
        "entity_type": entity_type,
        "entity_id": str(uuid.uuid4()),
        "environment_id": "env",
        "status": "running",
        "started_at": datetime.now(UTC).isoformat(),
    }
    store._save_execution(execution)
    store._execution_storage[exec_id] = execution

    tests = composition_tests or [(str(uuid.uuid4()), "Test A", str(uuid.uuid4()))]
    composition = {
        "suites": [
            {
                "id": None if entity_type == "test" else str(uuid.uuid4()),
                "name": "S",
                "tests": [{"id": tid, "name": name, "run_id": rid} for tid, name, rid in tests],
            }
        ]
    }
    store._save_composition(exec_id, composition)
    return exec_id, composition


# ---------------------------------------------------------------------------
# execution.yaml + composition.yaml
# ---------------------------------------------------------------------------


class TestExecutionCoverSheet:
    def test_save_and_load_execution(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        execution = {"id": exec_id, "name": "x", "entity_type": "test", "status": "running"}
        store._save_execution(execution)
        assert store._load_execution(exec_id) == execution

    def test_load_missing_execution_returns_none(self, tmp_storage: Any) -> None:
        assert store._load_execution(str(uuid.uuid4())) is None

    def test_load_corrupted_execution_returns_none(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        exec_dir = store._get_execution_dir(exec_id)
        exec_dir.mkdir(parents=True)
        (exec_dir / "execution.yaml").write_text("{not: valid: yaml:")
        assert store._load_execution(exec_id) is None

    def test_load_execution_with_non_dict_returns_none(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        exec_dir = store._get_execution_dir(exec_id)
        exec_dir.mkdir(parents=True)
        (exec_dir / "execution.yaml").write_text("- a\n- b\n")
        assert store._load_execution(exec_id) is None


class TestComposition:
    def test_save_and_load_composition(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        composition = {"suites": [{"id": "s1", "name": "S", "tests": []}]}
        store._save_composition(exec_id, composition)
        store._composition_cache.clear()
        assert store._load_composition(exec_id) == composition

    def test_load_composition_missing_returns_empty(self, tmp_storage: Any) -> None:
        assert store._load_composition(str(uuid.uuid4())) == {"suites": []}

    def test_composition_cached_after_first_load(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._save_composition(exec_id, {"suites": []})
        store._composition_cache.clear()
        first = store._load_composition(exec_id)
        (store._get_execution_dir(exec_id) / "composition.yaml").write_text("suites: [{id: x}]")
        second = store._load_composition(exec_id)
        assert first is second


# ---------------------------------------------------------------------------
# runs.yaml, status.yaml (append-only)
# ---------------------------------------------------------------------------


class TestRunsFile:
    def test_append_and_load(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._append_run(exec_id, {"run_id": "r1", "test_id": "t1", "suite_id": None})
        store._append_run(exec_id, {"run_id": "r2", "test_id": "t2", "suite_id": "s1"})
        runs = store._load_runs(exec_id)
        assert [r["run_id"] for r in runs] == ["r1", "r2"]

    def test_append_is_o1_no_rewrite(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        for i in range(3):
            store._append_run(exec_id, {"run_id": f"r{i}", "test_id": f"t{i}"})
        path = store._get_execution_dir(exec_id) / "runs.yaml"
        size_before = path.stat().st_size
        store._append_run(exec_id, {"run_id": "r-new", "test_id": "t-new"})
        delta = path.stat().st_size - size_before
        assert 0 < delta < size_before

    def test_load_runs_missing_returns_empty(self, tmp_storage: Any) -> None:
        assert store._load_runs(str(uuid.uuid4())) == []


class TestStatusFile:
    def test_transitions_accumulate(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._append_status(exec_id, {"run_id": "r1", "status": "running", "started_at": "t0"})
        store._append_status(exec_id, {"run_id": "r1", "status": "passed", "duration": 1.2})
        transitions = store._load_status(exec_id)
        assert [t["status"] for t in transitions] == ["running", "passed"]
        assert transitions[-1]["duration"] == 1.2


# ---------------------------------------------------------------------------
# Per-test logs + tail walker
# ---------------------------------------------------------------------------


class TestPerTestLogs:
    def test_append_assigns_monotonic_seq(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        run_id = "r1"
        seq0 = store._append_log(exec_id, run_id, {"message": "a"})
        seq1 = store._append_log(exec_id, run_id, {"message": "b"})
        seq2 = store._append_log(exec_id, run_id, {"message": "c"})
        assert (seq0, seq1, seq2) == (0, 1, 2)
        entries = store._load_test_logs(exec_id, run_id)
        assert [e["seq"] for e in entries] == [0, 1, 2]

    def test_seq_rehydrates_from_existing_file(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        run_id = "r1"
        store._append_log(exec_id, run_id, {"message": "a"})
        store._append_log(exec_id, run_id, {"message": "b"})
        store._log_seq.clear()
        seq = store._append_log(exec_id, run_id, {"message": "c"})
        assert seq == 2


class TestTailLogs:
    """Merged-console pagination walks logs.yaml (scope chronology) and
    expands per-test references into their logs/<run_id>.yaml file."""

    def _seed(self, exec_id: str, run_ids: list[str], per_run: int) -> None:
        for rid in run_ids:
            store._append_run(exec_id, {"run_id": rid, "test_id": "t", "suite_id": None})
            store._append_chronology(exec_id, {"type": "test", "run_id": rid})
            for i in range(per_run):
                store._append_log(exec_id, rid, {"message": f"{rid}-{i}"})

    def test_tail_empty_when_no_chronology(self, tmp_storage: Any) -> None:
        assert store._tail_logs(str(uuid.uuid4()), None, 10) == ([], None)

    def test_tail_without_cursor_gets_latest(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        self._seed(exec_id, ["r1", "r2"], per_run=2)
        entries, prev = store._tail_logs(exec_id, None, 10)
        assert len(entries) == 4
        assert entries[0]["run_id"] == "r1"
        assert entries[-1]["run_id"] == "r2"
        assert prev is None

    def test_cursor_scrolls_back(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        self._seed(exec_id, ["r1", "r2", "r3"], per_run=3)
        batch_a, prev_a = store._tail_logs(exec_id, None, 4)
        assert prev_a is not None
        batch_b, _ = store._tail_logs(exec_id, prev_a, 4)
        assert (batch_b[-1]["run_id"], batch_b[-1]["seq"]) != (
            batch_a[0]["run_id"],
            batch_a[0]["seq"],
        )

    def test_scope_logs_interleave_with_test_refs(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._append_chronology(
            exec_id,
            {"type": "regression", "message": "Started", "level": "INFO", "id": "r1"},
        )
        store._append_chronology(exec_id, {"type": "test", "run_id": "rA"})
        for i in range(2):
            store._append_log(exec_id, "rA", {"message": f"A-{i}"})
        store._append_chronology(
            exec_id,
            {"type": "suite", "message": "Suite X started", "level": "INFO", "id": "s1"},
        )
        entries, _ = store._tail_logs(exec_id, None, 10)
        # Chronological order: regression banner, test A's two logs, suite banner.
        assert [e.get("scope_kind") for e in entries] == [
            "regression",
            "test",
            "test",
            "suite",
        ]


class TestPrevCursorHelpers:
    """Cursor computation corner cases on the backward merged-console
    reader."""

    def test_compute_prev_cursor_returns_none_for_empty_collected(self) -> None:
        assert store._compute_prev_cursor([{"type": "test", "run_id": "r1"}], []) is None

    def test_compute_prev_cursor_test_entry_missing_from_chronology(self) -> None:
        """Oldest collected entry is a test log but chronology has no
        matching test reference: cursor returns None."""
        chronology = [
            {"type": "regression", "id": "r1"},
        ]
        collected = [{"scope_kind": "test", "run_id": "missing-run", "seq": 0}]
        assert store._compute_prev_cursor(chronology, collected) is None

    def test_compute_prev_cursor_scope_entry_missing_from_chronology(self) -> None:
        """Oldest collected entry is a scope log but chronology has no
        matching id: cursor returns None."""
        chronology = [
            {"type": "regression", "id": "r1"},
        ]
        collected = [{"scope_kind": "suite", "id": "ghost"}]
        assert store._compute_prev_cursor(chronology, collected) is None

    def test_find_chronology_index_for_test_returns_negative_when_missing(self) -> None:
        assert store._find_chronology_index_for_test([{"type": "regression"}], "rX") == -1

    def test_find_scope_entry_index_returns_negative_when_missing(self) -> None:
        assert (
            store._find_scope_entry_index([{"type": "test", "run_id": "rA"}], {"id": "ghost"}) == -1
        )

    def test_next_older_cursor_returns_previous_index(self) -> None:
        assert store._next_older_cursor([], 3) == (2, None)

    def test_next_older_cursor_returns_none_at_start(self) -> None:
        assert store._next_older_cursor([], 0) is None


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------


class TestSnapshots:
    def test_save_and_load_snapshot(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        snapshot = {"run_id": "r1", "status": "passed", "variables": {"x": 1}}
        store._save_snapshot(exec_id, "r1", snapshot)
        assert store._load_snapshot(exec_id, "r1") == snapshot

    def test_load_missing_snapshot_returns_none(self, tmp_storage: Any) -> None:
        assert store._load_snapshot(str(uuid.uuid4()), "nope") is None

    def test_save_snapshot_without_variables_key_is_unchanged(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        snapshot = {"run_id": "r1", "status": "passed", "block_states": {"n1": "passed"}}
        store._save_snapshot(exec_id, "r1", snapshot)
        assert store._load_snapshot(exec_id, "r1") == snapshot

    def test_save_snapshot_drops_dotted_alias_entries(self, tmp_storage: Any) -> None:
        """Leak guard: injected profile/namespace aliases carry live
        credentials (``creds.api_key``) and must never persist."""
        exec_id = str(uuid.uuid4())
        snapshot = {
            "run_id": "r1",
            "status": "passed",
            "variables": {"plain": "x", "creds.api_key": "cnrB-real-credential-bytes"},
        }
        store._save_snapshot(exec_id, "r1", snapshot)
        loaded = store._load_snapshot(exec_id, "r1")
        assert loaded is not None
        assert loaded["variables"] == {"plain": "x"}

    def test_snapshot_non_dict_returns_none(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._snapshots_dir(exec_id).mkdir(parents=True)
        store._snapshot_file(exec_id, "r1").write_text("- a\n- b\n")
        assert store._load_snapshot(exec_id, "r1") is None


class TestYamlSafeCoercion:
    """`_yaml_safe` must sanitize every
    value type a user plugin might return so `yaml.safe_dump` never raises
    from inside the terminal-callback persistence path.
    """

    def test_yaml_safe_passes_through_none_and_bool(self) -> None:
        assert store._yaml_safe(None) is None
        assert store._yaml_safe(True) is True
        assert store._yaml_safe(False) is False

    def test_yaml_safe_coerces_str_subclass_to_plain_str(self) -> None:
        class LxmlLikeStr(str):
            pass

        result = store._yaml_safe(LxmlLikeStr("Alpha"))
        assert result == "Alpha"
        assert type(result) is str

    def test_yaml_safe_coerces_int_subclass_to_plain_int(self) -> None:
        class NumpyLikeInt(int):
            pass

        result = store._yaml_safe(NumpyLikeInt(42))
        assert result == 42
        assert type(result) is int

    def test_yaml_safe_coerces_float_subclass_to_plain_float(self) -> None:
        class NumpyLikeFloat(float):
            pass

        result = store._yaml_safe(NumpyLikeFloat(3.14))
        assert result == 3.14
        assert type(result) is float

    def test_yaml_safe_falls_back_to_str_for_unknown_class(self) -> None:
        class Custom:
            def __str__(self) -> str:
                return "custom-value"

        assert store._yaml_safe(Custom()) == "custom-value"

    def test_yaml_safe_recurses_into_nested_containers(self) -> None:
        class LxmlLikeStr(str):
            pass

        result = store._yaml_safe({"outer": [LxmlLikeStr("a"), {"nested": LxmlLikeStr("b")}]})
        assert result == {"outer": ["a", {"nested": "b"}]}
        assert type(result["outer"][0]) is str
        assert type(result["outer"][1]["nested"]) is str

    def test_save_snapshot_succeeds_when_variables_contain_str_subclass(
        self, tmp_storage: Any
    ) -> None:
        """End-to-end: the storage boundary must absorb an unsafe type so
        `yaml.safe_dump` never raises during snapshot persistence.
        """

        class LxmlLikeStr(str):
            pass

        exec_id = str(uuid.uuid4())
        snapshot = {
            "run_id": "r1",
            "status": "passed",
            "variables": {"xml_text": LxmlLikeStr("Alpha")},
        }
        # Would raise `RepresenterError('cannot represent an object', 'Alpha')`
        # without `_yaml_safe`.
        store._save_snapshot(exec_id, "r1", snapshot)
        loaded = store._load_snapshot(exec_id, "r1")
        assert loaded is not None
        assert loaded["variables"]["xml_text"] == "Alpha"


# ---------------------------------------------------------------------------
# Variables + breakpoints
# ---------------------------------------------------------------------------


class TestVariables:
    def test_save_and_load_variables(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._save_variables(exec_id, {"a": 1, "b": "two"})
        assert store._load_variables(exec_id) == {"a": 1, "b": "two"}

    def test_load_missing_variables_returns_empty(self, tmp_storage: Any) -> None:
        assert store._load_variables(str(uuid.uuid4())) == {}

    def test_namespace_objects_dropped(self, tmp_storage: Any) -> None:
        from wavecore.core.namespace_base import NamespaceObjectBase

        class _FakeNS(NamespaceObjectBase):
            def __init__(self) -> None:
                super().__init__()

        exec_id = str(uuid.uuid4())
        store._save_variables(exec_id, {"keep": 1, "drop": _FakeNS()})
        loaded = store._load_variables(exec_id)
        assert "keep" in loaded and "drop" not in loaded

    def test_dotted_alias_entries_dropped(self, tmp_storage: Any) -> None:
        """Leak guard: injected profile/namespace aliases carry live
        credentials (``creds.api_key``) and must never persist."""
        exec_id = str(uuid.uuid4())
        store._save_variables(
            exec_id,
            {
                "keep": 1,
                "creds.api_key": "cnrB-real-credential-bytes",
                "system.region": "us-west-2",
            },
        )
        assert store._load_variables(exec_id) == {"keep": 1}


class TestRuntimeState:
    def test_init_seeds_pending_and_excluded(self, tmp_storage: Any) -> None:
        _, composition = _seed_execution(
            composition_tests=[
                ("t1", "A", "r1"),
                ("t2", "B", "r2"),
                ("t3", "C", "r3"),
            ]
        )
        state = store._init_runtime_state("x", "t0", composition, {"r1", "r3"})
        runs = state["runs"]
        assert runs["r1"]["status"] == "pending"
        assert runs["r2"]["status"] == "excluded"
        assert runs["r3"]["status"] == "pending"

    def test_init_all_pending_when_no_subset(self, tmp_storage: Any) -> None:
        _, composition = _seed_execution(composition_tests=[("t1", "A", "r1"), ("t2", "B", "r2")])
        state = store._init_runtime_state("x", "t0", composition, None)
        assert all(r["status"] == "pending" for r in state["runs"].values())

    def test_record_run_dispatched_appends(self, tmp_storage: Any) -> None:
        exec_id, _ = _seed_execution()
        store._record_run_dispatched(exec_id, "rA", "tA", "sA")
        runs = store._load_runs(exec_id)
        assert runs[0]["run_id"] == "rA"

    def test_record_run_transition_updates_memory_and_disk(self, tmp_storage: Any) -> None:
        exec_id, composition = _seed_execution(composition_tests=[("t1", "A", "r1")])
        state = store._init_runtime_state(exec_id, "t0", composition, None)
        store._record_run_transition(exec_id, "r1", status="running", started_at="t1")
        store._record_run_transition(exec_id, "r1", status="passed", ended_at="t2", duration=0.5)
        assert state["runs"]["r1"]["status"] == "passed"
        on_disk = store._load_status(exec_id)
        assert [t["status"] for t in on_disk] == ["running", "passed"]

    def test_rebuild_from_disk_replays_transitions(self, tmp_storage: Any) -> None:
        exec_id, composition = _seed_execution(
            composition_tests=[("t1", "A", "r1"), ("t2", "B", "r2")]
        )
        store._init_runtime_state(exec_id, "t0", composition, None)
        store._record_run_transition(exec_id, "r1", status="running", started_at="t1")
        store._record_run_transition(exec_id, "r1", status="passed", ended_at="t2", duration=0.5)
        store._runtime_state.clear()
        rebuilt = store._rebuild_runtime_state(exec_id)
        assert rebuilt["runs"]["r1"]["status"] == "passed"
        assert rebuilt["runs"]["r1"]["duration"] == 0.5
        assert rebuilt["runs"]["r2"]["status"] == "pending"

    def test_get_runtime_state_missing_execution(self, tmp_storage: Any) -> None:
        assert store._get_runtime_state(str(uuid.uuid4())) is None

    def test_get_runtime_state_rebuilds_if_absent(self, tmp_storage: Any) -> None:
        exec_id, composition = _seed_execution()
        store._init_runtime_state(exec_id, "t0", composition, None)
        store._runtime_state.clear()
        assert store._get_runtime_state(exec_id) is not None

    def test_init_runtime_state_skips_tests_without_run_id(self, tmp_storage: Any) -> None:
        """Malformed composition entries without a run_id are ignored when
        seeding the runtime state map."""
        exec_id = str(uuid.uuid4())
        composition = {
            "suites": [
                {
                    "id": "s1",
                    "tests": [
                        {"id": "t1", "run_id": "r1"},
                        {"id": "t-bad"},  # missing run_id
                    ],
                }
            ]
        }
        state = store._init_runtime_state(exec_id, "t0", composition, None)
        assert list(state["runs"].keys()) == ["r1"]

    def test_rebuild_runtime_state_skips_tests_without_run_id(self, tmp_storage: Any) -> None:
        """Rebuild path drops composition entries without a run_id the
        same way as the initial seed."""
        exec_id = str(uuid.uuid4())
        execution = {
            "id": exec_id,
            "status": "running",
            "started_at": "2026-04-21T00:00:00+00:00",
        }
        store._save_execution(execution)
        composition = {
            "suites": [
                {
                    "id": "s1",
                    "tests": [
                        {"id": "t1", "run_id": "r1"},
                        {"id": "t-bad"},
                    ],
                }
            ]
        }
        store._save_composition(exec_id, composition)
        rebuilt = store._rebuild_runtime_state(exec_id)
        assert list(rebuilt["runs"].keys()) == ["r1"]

    def test_rebuild_runtime_state_skips_status_entries_with_unknown_run_id(
        self, tmp_storage: Any
    ) -> None:
        """Status transitions whose run_id is not in the composition are
        dropped during the replay so runtime state stays consistent."""
        exec_id, _composition = _seed_execution(composition_tests=[("t1", "A", "r1")])
        store._append_status(exec_id, {"run_id": "r-missing", "status": "passed"})
        store._append_status(exec_id, {"run_id": "r1", "status": "passed"})
        rebuilt = store._rebuild_runtime_state(exec_id)
        assert "r-missing" not in rebuilt["runs"]
        assert rebuilt["runs"]["r1"]["status"] == "passed"

    def test_record_run_transition_without_runtime_state_only_appends(
        self, tmp_storage: Any
    ) -> None:
        """If the execution is not in the runtime state map we still
        append the status row but leave in-memory state untouched."""
        exec_id, _ = _seed_execution()
        store._runtime_state.pop(exec_id, None)
        store._record_run_transition(exec_id, "r1", status="passed", duration=0.5)
        status = store._load_status(exec_id)
        assert status[-1]["run_id"] == "r1"
        assert exec_id not in store._runtime_state


class TestLiveDuration:
    def test_none_when_no_start(self) -> None:
        assert store._compute_live_duration(None) is None

    def test_handles_z_suffix(self) -> None:
        now = datetime(2026, 4, 21, 0, 0, 10, tzinfo=UTC)
        assert store._compute_live_duration("2026-04-21T00:00:00Z", now) == 10.0


# ---------------------------------------------------------------------------
# Orphan recovery + cache
# ---------------------------------------------------------------------------


class TestOrphanRecovery:
    def test_running_marked_stopped(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._save_execution(
            {
                "id": exec_id,
                "name": "x",
                "status": "running",
                "started_at": "2026-04-21T00:00:00+00:00",
            }
        )
        store._recover_orphaned_executions()
        loaded = store._load_execution(exec_id)
        assert loaded is not None and loaded["status"] == "stopped"

    def test_terminal_untouched(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._save_execution(
            {"id": exec_id, "status": "passed", "started_at": "t0", "ended_at": "t1"}
        )
        store._recover_orphaned_executions()
        assert store._load_execution(exec_id)["status"] == "passed"

    def test_noop_when_missing(self, tmp_storage: Any) -> None:
        storage_paths.set_base_path(Path(tmp_storage) / "gone")
        store._recover_orphaned_executions()

    def test_recover_ignores_non_directory_entries(self, tmp_storage: Any) -> None:
        """Stray files in the storage directory are ignored rather than
        crashing the recovery sweep."""
        storage_dir = storage_paths.get_executions_storage_path()
        storage_dir.mkdir(parents=True, exist_ok=True)
        (storage_dir / "junk.txt").write_text("not a directory")
        store._recover_orphaned_executions()

    def test_recover_skips_directories_without_execution_yaml(self, tmp_storage: Any) -> None:
        """Empty directories that don't hold an execution.yaml are
        silently skipped."""
        storage_dir = storage_paths.get_executions_storage_path()
        (storage_dir / "orphan-dir").mkdir(parents=True, exist_ok=True)
        store._recover_orphaned_executions()


class TestCacheLifecycle:
    def test_ensure_loaded_hydrates(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._save_execution({"id": exec_id, "status": "passed", "started_at": "t0"})
        store._clear_in_memory_cache()
        store._ensure_cache_loaded()
        assert exec_id in store._execution_storage

    def test_clear_memory_preserves_disk(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._save_execution({"id": exec_id, "status": "passed"})
        store._execution_storage[exec_id] = {"id": exec_id}
        store._clear_in_memory_cache()
        assert exec_id not in store._execution_storage
        assert store._load_execution(exec_id) is not None

    def test_clear_storage_wipes_both(self, tmp_storage: Any) -> None:
        exec_id = str(uuid.uuid4())
        store._save_execution({"id": exec_id, "status": "passed"})
        store._execution_storage[exec_id] = {"id": exec_id}
        store._clear_storage()
        assert exec_id not in store._execution_storage
        assert store._load_execution(exec_id) is None


class TestDeletion:
    def test_delete_files_removes_directory(self, tmp_storage: Any) -> None:
        exec_id, _ = _seed_execution()
        assert store._get_execution_dir(exec_id).exists()
        store._delete_execution_files(exec_id)
        assert not store._get_execution_dir(exec_id).exists()


# ---------------------------------------------------------------------------
# Status transitions + secret masking + filters + sorts
# ---------------------------------------------------------------------------


class TestStatusTransitionValidation:
    def test_pause_from_running_ok(self) -> None:
        store._validate_state_transition("running", "paused", "pause")

    def test_pause_from_passed_raises(self) -> None:
        from wavecore.api.exceptions import ConflictException

        with pytest.raises(ConflictException):
            store._validate_state_transition("passed", "paused", "pause")

    def test_unknown_operation_raises(self) -> None:
        from wavecore.api.exceptions import ValidationException

        with pytest.raises(ValidationException):
            store._validate_state_transition("running", "passed", "finish")


class TestNameHeuristicMaskingDeleted:
    """No name-guessing anywhere; the secret flag is the only authority."""

    def test_mask_secrets_helper_is_deleted(self) -> None:
        assert not hasattr(store, "_mask_secrets")

    def test_secret_field_patterns_constant_is_deleted(self) -> None:
        assert not hasattr(store, "SECRET_FIELD_PATTERNS")


def _write_registry() -> Any:
    from wavecore.core.secrets.registry import SecretRegistry

    registry = SecretRegistry()
    registry.register("login", "s3cretlogin99", "declared")
    return registry


class TestMaskOnWrite:
    """Snapshot and variables.yaml are display files, masked ON WRITE."""

    def test_save_snapshot_masks_flagged_and_copied_values(self) -> None:
        execution_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        snapshot = {
            "run_id": run_id,
            "test_id": "test-1",
            "status": "passed",
            "block_states": {"node-1": "passed"},
            "variables": {
                "login": "s3cretlogin99",
                "copied": "Bearer s3cretlogin99",
                "password": "hunter2",
                "count": 7,
            },
        }

        store._save_snapshot(execution_id, run_id, snapshot, registry=_write_registry())

        loaded = store._load_snapshot(execution_id, run_id)
        assert loaded is not None
        assert loaded["variables"]["login"] == "********"
        assert loaded["variables"]["copied"] == "Bearer ********"
        assert loaded["variables"]["password"] == "hunter2"
        assert loaded["variables"]["count"] == 7
        assert loaded["status"] == "passed"
        assert loaded["block_states"] == {"node-1": "passed"}

    def test_save_snapshot_collapses_flagged_container_to_placeholder(self) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("creds", {"user": "u", "pass": "p"}, "declared")
        execution_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        snapshot = {
            "run_id": run_id,
            "test_id": "test-1",
            "status": "passed",
            "block_states": {},
            "variables": {"creds": {"user": "u", "pass": "p"}},
        }

        store._save_snapshot(execution_id, run_id, snapshot, registry=registry)

        loaded = store._load_snapshot(execution_id, run_id)
        assert loaded is not None
        assert loaded["variables"]["creds"] == "********"

    def test_save_snapshot_without_registry_writes_raw(self) -> None:
        execution_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        snapshot = {
            "run_id": run_id,
            "test_id": "test-1",
            "status": "passed",
            "block_states": {},
            "variables": {"password": "hunter2"},
        }

        store._save_snapshot(execution_id, run_id, snapshot)

        loaded = store._load_snapshot(execution_id, run_id)
        assert loaded is not None
        assert loaded["variables"]["password"] == "hunter2"

    def test_save_snapshot_drops_dotted_aliases_and_masks_flagged(self) -> None:
        execution_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        snapshot = {
            "run_id": run_id,
            "test_id": "test-1",
            "status": "passed",
            "block_states": {},
            "variables": {
                "login": "s3cretlogin99",
                "creds.api_key": "cnrB-real-credential-bytes",
            },
        }

        store._save_snapshot(execution_id, run_id, snapshot, registry=_write_registry())

        loaded = store._load_snapshot(execution_id, run_id)
        assert loaded is not None
        assert loaded["variables"] == {"login": "********"}

    def test_save_variables_masks_flagged_and_copied_values(self) -> None:
        execution_id = str(uuid.uuid4())

        store._save_variables(
            execution_id,
            {
                "login": "s3cretlogin99",
                "copied": "token s3cretlogin99 here",
                "password": "hunter2",
            },
            registry=_write_registry(),
        )

        loaded = store._load_variables(execution_id)
        assert loaded["login"] == "********"
        assert loaded["copied"] == "token ******** here"
        assert loaded["password"] == "hunter2"

    def test_save_variables_without_registry_writes_raw(self) -> None:
        execution_id = str(uuid.uuid4())

        store._save_variables(execution_id, {"password": "hunter2"})

        loaded = store._load_variables(execution_id)
        assert loaded["password"] == "hunter2"

    def test_save_variables_masks_a_table_cell_before_measuring_it(self) -> None:
        execution_id = str(uuid.uuid4())
        table = Table(columns=[("name", "string"), ("token", "string")])
        table.add_row(["payments-api", "s3cretlogin99"])

        store._save_variables(execution_id, {"t": table}, registry=_write_registry())

        stored = store._load_variables(execution_id)["t"]
        assert "s3cretlogin99" not in stored
        assert "********" in stored
        # The rule run is the mask's width, not the secret's, so the padding
        # discloses nothing about the value it replaced.
        assert "  --------\n" in stored

    def test_save_snapshot_masks_a_table_cell_before_measuring_it(self) -> None:
        execution_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        table = Table(columns=[("name", "string"), ("token", "string")])
        table.add_row(["payments-api", "s3cretlogin99"])
        snapshot = {
            "run_id": run_id,
            "test_id": "test-1",
            "status": "passed",
            "block_states": {},
            "variables": {"t": table},
        }

        store._save_snapshot(execution_id, run_id, snapshot, registry=_write_registry())

        loaded = store._load_snapshot(execution_id, run_id)
        assert loaded is not None
        stored = loaded["variables"]["t"]
        assert "s3cretlogin99" not in stored
        assert "********" in stored
        assert "  --------\n" in stored

    def test_save_variables_table_without_registry_renders_raw(self) -> None:
        execution_id = str(uuid.uuid4())
        table = Table(columns=[("name", "string"), ("token", "string")])
        table.add_row(["payments-api", "s3cretlogin99"])

        store._save_variables(execution_id, {"t": table})

        assert "s3cretlogin99" in store._load_variables(execution_id)["t"]


class TestFilterAndSort:
    def _rows(self) -> list[dict[str, Any]]:
        return [
            {
                "id": "1",
                "name": "alpha",
                "triggered_by": "a",
                "status": "passed",
                "entity_type": "test",
                "entity_id": "e1",
                "started_at": "2026-04-01T00:00:00+00:00",
                "duration": 10,
            },
            {
                "id": "2",
                "name": "beta",
                "triggered_by": "b",
                "status": "failed",
                "entity_type": "suite",
                "entity_id": "e2",
                "started_at": "2026-04-05T00:00:00+00:00",
                "duration": 5,
            },
        ]

    def test_filter_by_status(self) -> None:
        out = store._filter_executions(self._rows(), ["passed"], None, None, None, None, None, None)
        assert [r["id"] for r in out] == ["1"]

    def test_filter_by_search(self) -> None:
        out = store._filter_executions(self._rows(), None, None, None, None, "BET", None, None)
        assert [r["id"] for r in out] == ["2"]

    def test_filter_by_type_and_user(self) -> None:
        out = store._filter_executions(self._rows(), None, ["suite"], ["b"], None, None, None, None)
        assert [r["id"] for r in out] == ["2"]

    def test_filter_by_entity_id(self) -> None:
        out = store._filter_executions(self._rows(), None, None, None, "e1", None, None, None)
        assert [r["id"] for r in out] == ["1"]

    def test_filter_by_date_range(self) -> None:
        out = store._filter_executions(
            self._rows(),
            None,
            None,
            None,
            None,
            None,
            from_date=datetime(2026, 4, 2, tzinfo=UTC),
            to_date=datetime(2026, 4, 10, tzinfo=UTC),
        )
        assert [r["id"] for r in out] == ["2"]

    def test_sort_by_started_at_desc(self) -> None:
        rows = self._rows()
        store._sort_executions(rows, "started_at", "desc")
        assert [r["id"] for r in rows] == ["2", "1"]

    def test_sort_by_duration_asc(self) -> None:
        rows = self._rows()
        store._sort_executions(rows, "duration", "asc")
        assert [r["id"] for r in rows] == ["2", "1"]

    def test_sort_unknown_key_is_noop(self) -> None:
        rows = self._rows()
        store._sort_executions(rows, "nope", "asc")
        assert [r["id"] for r in rows] == ["1", "2"]


class TestDurationHelper:
    def test_compute_duration_seconds(self) -> None:
        assert (
            store._compute_duration_seconds(
                "2026-04-21T00:00:00+00:00", "2026-04-21T00:00:05+00:00"
            )
            == 5
        )


class TestCheckEntityValidation:
    def test_passes_when_none(self) -> None:
        store._check_entity_validation("suite", str(uuid.uuid4()))

    def test_fatal_raises(self, monkeypatch: Any) -> None:
        from wavecore.api.exceptions import ValidationException

        monkeypatch.setattr(
            store,
            "_validate_entity",
            lambda *a, **k: {"fatal": True, "errors": [{"message": "boom"}]},
        )
        with pytest.raises(ValidationException):
            store._check_entity_validation("test", "x")

    def test_non_fatal_errors_raise(self, monkeypatch: Any) -> None:
        from wavecore.api.exceptions import ValidationException

        monkeypatch.setattr(
            store,
            "_validate_entity",
            lambda *a, **k: {"fatal": False, "errors": [{"message": "bad"}]},
        )
        with pytest.raises(ValidationException):
            store._check_entity_validation("test", "x")


class TestUpdateExecutionStatus:
    def test_terminal_stamps_ended_at_and_duration(self, tmp_storage: Any) -> None:
        exec_id, _ = _seed_execution()
        store._update_execution_status(exec_id, "passed")
        ex = store._execution_storage[exec_id]
        assert ex["status"] == "passed"
        assert "ended_at" in ex and "duration" in ex

    def test_non_terminal_status_updates_memory(self, tmp_storage: Any) -> None:
        exec_id, _ = _seed_execution()
        store._update_execution_status(exec_id, "running")
        assert store._execution_storage[exec_id]["status"] == "running"

    def test_unknown_execution_is_noop(self, tmp_storage: Any) -> None:
        store._update_execution_status("missing", "passed")


class TestValidateEntity:
    def test_test_entity_delegates(self, monkeypatch: Any) -> None:
        sentinel = {"errors": []}
        monkeypatch.setattr(
            "wavecore.api.services.tests.service.validate_test",
            lambda *a, **k: sentinel,
        )
        assert store._validate_entity("test", "x") is sentinel

    def test_suite_entity_returns_none(self) -> None:
        assert store._validate_entity("suite", "x") is None


class TestYamlSafeDecimal:
    """`_yaml_safe` renders Decimal values as plain decimal strings so the
    persisted snapshot never carries `E` notation (REQ-3.1.3.14).
    """

    def test_decimal_serializes_as_plain_string(self) -> None:
        result = store._yaml_safe(Decimal("1.08"))
        assert result == "1.08"
        assert type(result) is str

    def test_positive_exponent_decimal_expands_to_plain_string(self) -> None:
        # str(Decimal('1E+3')) would persist as '1E+3'.
        result = store._yaml_safe(Decimal("1E+3"))
        assert result == "1000"
        assert "E" not in result

    def test_negative_exponent_decimal_expands_to_plain_string(self) -> None:
        result = store._yaml_safe(Decimal("1E-7"))
        assert result == "0.0000001"
        assert "E" not in result

    def test_high_precision_decimal_is_exact(self) -> None:
        result = store._yaml_safe(Decimal("-2123.123213123123699999"))
        assert result == "-2123.123213123123699999"

    def test_decimal_inside_nested_container(self) -> None:
        result = store._yaml_safe({"price": Decimal("1E+3"), "items": [Decimal("1.5")]})
        assert result == {"price": "1000", "items": ["1.5"]}
