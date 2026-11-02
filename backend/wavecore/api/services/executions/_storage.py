"""File persistence and in-memory runtime state for the execution service.

On-disk layout (v2 - append-only):

    data/api_executions/<exec_id>/
      execution.yaml       cover sheet; rewritten only at start and at terminal
      composition.yaml     static suite/test tree; written once
      runs.yaml            append-only; one entry per dispatched test
      status.yaml          append-only; one entry per test state transition
      logs/<run_id>.yaml   append-only; per-test console output
      snapshots/<run_id>.yaml  per-test terminal snapshot; written once
      variables.yaml       (test-type executions only) end-of-run variables

No file that grows with the size of a run is ever rewritten. Every live write
is an append or a write-once-then-forget. Polls read the in-memory
``_runtime_state`` map which is mutated on every transition and rebuilt from
disk on startup.
"""

import logging
import shutil
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services.entity_cache import DirectoryCache
from wavecore.api.services.storage_paths import get_executions_storage_path
from wavecore.core.namespace_base import is_engine_injected
from wavecore.core.secrets.masking import mask_structure
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.secrets.render_scope import render_scope
from wavecore.core.variables.decimal_value import decimal_to_str
from wavecore.core.variables.wire_form import wire_values

# libyaml's C-accelerated loader/dumper where available; fall back to pure
# Python otherwise. Execution hot paths still serialize YAML on every state
# transition and log line, so the 5-7x speedup matters even with the
# append-only layout.
_YAML_LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
_YAML_DUMPER = getattr(yaml, "CSafeDumper", yaml.SafeDumper)

_EXECUTION_FILENAME = "execution.yaml"

logger = logging.getLogger(__name__)

VALID_EXECUTION_STATES = [
    "running",
    "paused",
    "passed",
    "failed",
    "stopped",
    "skipped",
]

VALID_ENTITY_TYPES = ["test", "suite", "regression"]

STATE_TRANSITIONS: dict[str, tuple[list[str], str]] = {
    "pause": (["running"], "paused"),
    "resume": (["paused"], "running"),
    "stop": (["running", "paused"], "stopped"),
}

_TZ_UTC_SUFFIX = "+00:00"

TERMINAL_STATUSES: frozenset[str] = frozenset({"passed", "failed", "stopped", "skipped"})
TERMINAL_RUN_STATUSES: frozenset[str] = frozenset(
    {"passed", "failed", "stopped", "skipped", "excluded"}
)


# ---------------------------------------------------------------------------
# In-memory caches
# ---------------------------------------------------------------------------

# Execution cover sheets, keyed by exec_id. Mirrors execution.yaml on disk.
_execution_storage: dict[str, dict[str, Any]] = {}

# Static suite/test composition per execution. Written once; cached forever.
_composition_cache: dict[str, dict[str, Any]] = {}

# Runtime state per execution. Rebuilt from runs.yaml + status.yaml on load;
# mutated in place on every transition and serialized by appending one row
# to status.yaml (no rewrite). Keys: status, started_at, ended_at, duration,
# runs: {run_id: {test_id, suite_id, status, started_at, ended_at, duration}}.
_runtime_state: dict[str, dict[str, Any]] = {}

# Next log-sequence counter per (exec_id, run_id). Starts at 0 and
# increments per append. Rehydrated from the file's last seq on restart.
_log_seq: dict[tuple[str, str], int] = {}

# Optional per-execution variables cache (test-type executions only). Kept for
# the existing /executions/{id}/variables endpoint.
_execution_variables: dict[str, dict[str, Any]] = {}

_cache_loaded: bool = False

# Executions deliberately never reconcile against their directory: the list is the
# cheapest in the product and executions have no upper bound. Only the guarded read.
_execution_reader = DirectoryCache(
    label="execution",
    filename=_EXECUTION_FILENAME,
    storage_dir=get_executions_storage_path,
    cache=lambda: _execution_storage,
    logger=logger,
)


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------


def _ensure_storage_dir() -> None:
    get_executions_storage_path().mkdir(parents=True, exist_ok=True)


def _get_execution_dir(execution_id: str) -> Path:
    return get_executions_storage_path() / execution_id


def _logs_dir(execution_id: str) -> Path:
    return _get_execution_dir(execution_id) / "logs"


def _snapshots_dir(execution_id: str) -> Path:
    return _get_execution_dir(execution_id) / "snapshots"


def _log_file(execution_id: str, run_id: str) -> Path:
    return _logs_dir(execution_id) / f"{run_id}.yaml"


def _snapshot_file(execution_id: str, run_id: str) -> Path:
    return _snapshots_dir(execution_id) / f"{run_id}.yaml"


# ---------------------------------------------------------------------------
# Small-file I/O primitives
# ---------------------------------------------------------------------------


def _yaml_load(path: Path) -> Any:
    """Best-effort YAML load that returns ``None`` on error or missing file."""
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.load(f, Loader=_YAML_LOADER)
    except (yaml.YAMLError, OSError, UnicodeDecodeError):
        return None


def _yaml_write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False, Dumper=_YAML_DUMPER)


def _yaml_append_entry(path: Path, entry: dict[str, Any]) -> None:
    """Append a single-document YAML list item to ``path`` without rewriting.

    The file is the list literal (``- item: ...``) produced by ``yaml.dump``
    with ``default_flow_style=False``. Since each append emits the dumped
    single-element list (``- ...\\n  ...``) with the leading ``- `` and matching
    indentation, concatenating those fragments produces a valid YAML sequence
    equivalent to dumping the full list in one go. Each append is one
    open-write-close; O(1) regardless of existing file size.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fragment = yaml.dump(
        [entry],
        default_flow_style=False,
        sort_keys=False,
        Dumper=_YAML_DUMPER,
    )
    with open(path, "a", encoding="utf-8") as f:
        f.write(fragment)


def _yaml_load_list(path: Path) -> list[dict[str, Any]]:
    data = _yaml_load(path)
    if isinstance(data, list):
        return data
    return []


# ---------------------------------------------------------------------------
# execution.yaml
# ---------------------------------------------------------------------------


def _execution_file(execution_id: str) -> Path:
    return _get_execution_dir(execution_id) / _EXECUTION_FILENAME


def _load_execution(execution_id: str) -> dict[str, Any] | None:
    """One stored execution, or None when its file cannot be turned into one."""
    return _execution_reader.read(execution_id)


def _forget_execution(execution_id: str) -> None:
    """Drop an execution from every map keyed by its id."""
    _execution_storage.pop(execution_id, None)
    _composition_cache.pop(execution_id, None)
    _runtime_state.pop(execution_id, None)
    _execution_variables.pop(execution_id, None)
    for key in [k for k in _log_seq if k[0] == execution_id]:
        del _log_seq[key]


def _save_execution(execution: dict[str, Any]) -> None:
    _ensure_storage_dir()
    _yaml_write(_execution_file(execution["id"]), execution)


# ---------------------------------------------------------------------------
# composition.yaml
# ---------------------------------------------------------------------------


def _save_composition(execution_id: str, composition: dict[str, Any]) -> None:
    _yaml_write(_get_execution_dir(execution_id) / "composition.yaml", composition)
    _composition_cache[execution_id] = composition


def _load_composition(execution_id: str) -> dict[str, Any]:
    cached = _composition_cache.get(execution_id)
    if cached is not None:
        return cached
    data = _yaml_load(_get_execution_dir(execution_id) / "composition.yaml")
    composition: dict[str, Any] = data if isinstance(data, dict) else {"suites": []}
    _composition_cache[execution_id] = composition
    return composition


# ---------------------------------------------------------------------------
# runs.yaml (append-only)
# ---------------------------------------------------------------------------


def _append_run(execution_id: str, run_entry: dict[str, Any]) -> None:
    _yaml_append_entry(_get_execution_dir(execution_id) / "runs.yaml", run_entry)


def _load_runs(execution_id: str) -> list[dict[str, Any]]:
    return _yaml_load_list(_get_execution_dir(execution_id) / "runs.yaml")


# ---------------------------------------------------------------------------
# status.yaml (append-only)
# ---------------------------------------------------------------------------


def _append_status(execution_id: str, status_entry: dict[str, Any]) -> None:
    _yaml_append_entry(_get_execution_dir(execution_id) / "status.yaml", status_entry)


def _load_status(execution_id: str) -> list[dict[str, Any]]:
    return _yaml_load_list(_get_execution_dir(execution_id) / "status.yaml")


# ---------------------------------------------------------------------------
# Per-test logs (append-only, one file per run_id)
# ---------------------------------------------------------------------------


def _append_log(execution_id: str, run_id: str, entry: dict[str, Any]) -> int:
    """Append ``entry`` to ``logs/<run_id>.yaml``, stamping a ``seq`` field.

    Returns the assigned ``seq`` so the caller can include it in the WS push.
    Sequence counters are in-memory per (exec_id, run_id), rehydrated from the
    on-disk tail if the process just started.
    """
    key = (execution_id, run_id)
    if key not in _log_seq:
        existing = _yaml_load_list(_log_file(execution_id, run_id))
        if existing:
            _log_seq[key] = max(e.get("seq", -1) for e in existing) + 1
        else:
            _log_seq[key] = 0
    seq = _log_seq[key]
    _log_seq[key] = seq + 1
    stamped = {"seq": seq, **entry}
    _yaml_append_entry(_log_file(execution_id, run_id), stamped)
    return seq


def _load_test_logs(execution_id: str, run_id: str) -> list[dict[str, Any]]:
    return _yaml_load_list(_log_file(execution_id, run_id))


# ---------------------------------------------------------------------------
# logs.yaml (scope chronology, append-only)
# ---------------------------------------------------------------------------


def _append_chronology(execution_id: str, entry: dict[str, Any]) -> None:
    """Append a scope-chronology row to ``logs.yaml``.

    Three entry shapes:
    - ``{type: "regression", ...log-fields}`` - a regression-level log.
    - ``{type: "suite", suite_id, ...log-fields}`` - a suite-level log.
    - ``{type: "test", run_id}`` - a reference to a per-test log file.
      Written once at test dispatch; the test's own log entries live in
      ``logs/<run_id>.yaml`` and are not repeated here.
    """
    _yaml_append_entry(_get_execution_dir(execution_id) / "logs.yaml", entry)


def _load_chronology(execution_id: str) -> list[dict[str, Any]]:
    return _yaml_load_list(_get_execution_dir(execution_id) / "logs.yaml")


def _resolve_chronology(execution_id: str) -> list[dict[str, Any]]:
    """Chronology entries for the merged console.

    Test-type executions write no logs.yaml, so fall back to a single
    reference built from the cover-sheet ``run_id``.
    """
    chronology = _load_chronology(execution_id)
    if chronology:
        return chronology
    execution = _execution_storage.get(execution_id) or _load_execution(execution_id)
    run_id = (execution or {}).get("run_id")
    return [{"type": "test", "run_id": run_id}] if run_id else []


def _load_merged_logs(execution_id: str) -> list[dict[str, Any]]:
    """Full forward chronological walk of the merged log stream.

    Expands ``{type: "test", run_id}`` references into the per-run log file
    entries.
    """
    chronology = _resolve_chronology(execution_id)
    if not chronology:
        return []

    merged: list[dict[str, Any]] = []
    for entry in chronology:
        entry_type = entry.get("type")
        if entry_type == "test":
            run_id = entry.get("run_id")
            if run_id:
                merged.extend(
                    {**log, "run_id": run_id, "scope_kind": "test"}
                    for log in _load_test_logs(execution_id, run_id)
                )
        elif entry_type in ("regression", "suite"):
            merged.append({**entry, "scope_kind": entry_type})
    return merged


# Cursor shape for the merged console walker:
#   (chronology_index, child_seq_exclusive | None)
# - chronology_index: position in logs.yaml (0-based).
# - child_seq_exclusive: when the cursor points INTO a test-reference,
#   we're mid-test; this is the seq of the oldest entry the client
#   already has, and we yield entries with seq strictly less than it.
#   ``None`` means "not inside a child" - the cursor is just before the
#   chronology entry at ``chronology_index``.
MergedCursor = tuple[int, int | None]


def _tail_logs(
    execution_id: str,
    before: MergedCursor | None,
    limit: int,
) -> tuple[list[dict[str, Any]], MergedCursor | None]:
    """Paginated merged console reader.

    Walks ``logs.yaml`` backwards, yielding:
    - literal ``regression`` / ``suite`` entries as-is,
    - for each ``test`` reference, the per-run log file's entries in
      reverse order.

    Returns ``(entries, prev_cursor)`` with entries in CHRONOLOGICAL
    order (oldest first) and ``prev_cursor`` opaque to the caller.
    ``prev_cursor`` is ``None`` when the start of history has been
    reached.
    """
    chronology = _resolve_chronology(execution_id)
    if not chronology:
        return [], None

    collected: list[dict[str, Any]] = []
    start_index, start_child_seq = _resolve_start(before, len(chronology))

    for idx in range(start_index, -1, -1):
        if len(collected) >= limit:
            break
        entry = chronology[idx]
        entry_type = entry.get("type")

        if entry_type == "test":
            run_id = entry.get("run_id")
            if run_id:
                _collect_test_entries_reverse(
                    execution_id,
                    run_id,
                    limit,
                    collected,
                    start_child_seq if idx == start_index else None,
                )
            start_child_seq = None
            continue

        start_child_seq = None
        if entry_type in ("regression", "suite"):
            collected.append({**entry, "scope_kind": entry_type})

    prev_cursor = _compute_prev_cursor(chronology, collected)
    collected.reverse()
    return collected, prev_cursor


def _resolve_start(before: MergedCursor | None, length: int) -> tuple[int, int | None]:
    if before is None:
        return length - 1, None
    chronology_index, child_seq_exclusive = before
    return min(chronology_index, length - 1), child_seq_exclusive


def _collect_test_entries_reverse(
    execution_id: str,
    run_id: str,
    limit: int,
    collected: list[dict[str, Any]],
    start_seq_exclusive: int | None,
) -> None:
    entries = _load_test_logs(execution_id, run_id)
    if start_seq_exclusive is not None:
        entries = [e for e in entries if e.get("seq", 0) < start_seq_exclusive]
    for entry in reversed(entries):
        collected.append({**entry, "run_id": run_id, "scope_kind": "test"})
        if len(collected) >= limit:
            return


def _compute_prev_cursor(
    chronology: list[dict[str, Any]],
    collected: list[dict[str, Any]],
) -> MergedCursor | None:
    """Derive the cursor for the NEXT older page from the oldest
    collected entry.

    The cursor's ``chronology_index`` points at the chronology row whose
    earlier-in-time neighbors are still unread, and ``child_seq_exclusive``
    pins the exact position within a test file when the oldest entry
    came from inside one.
    """
    if not collected:
        return None
    oldest = collected[-1]
    kind = oldest.get("scope_kind")
    if kind == "test":
        run_id = oldest.get("run_id")
        seq = int(oldest.get("seq", 0))
        # There is more of this test if seq > 0, otherwise move to the
        # chronology row before the test-reference we were expanding.
        idx = _find_chronology_index_for_test(chronology, run_id)
        if idx < 0:
            return None
        if seq > 0:
            return (idx, seq)
        return _next_older_cursor(chronology, idx)

    idx = _find_scope_entry_index(chronology, oldest)
    if idx < 0:
        return None
    return _next_older_cursor(chronology, idx)


def _find_chronology_index_for_test(chronology: list[dict[str, Any]], run_id: Any) -> int:
    for i in range(len(chronology) - 1, -1, -1):
        entry = chronology[i]
        if entry.get("type") == "test" and entry.get("run_id") == run_id:
            return i
    return -1


def _find_scope_entry_index(chronology: list[dict[str, Any]], entry: dict[str, Any]) -> int:
    entry_id = entry.get("id")
    for i in range(len(chronology) - 1, -1, -1):
        candidate = chronology[i]
        if candidate.get("type") in ("regression", "suite") and candidate.get("id") == entry_id:
            return i
    return -1


def _next_older_cursor(_chronology: list[dict[str, Any]], idx: int) -> MergedCursor | None:
    """Cursor for the chronology entry strictly older than ``idx``."""
    if idx <= 0:
        return None
    return (idx - 1, None)


# ---------------------------------------------------------------------------
# Snapshots (write once per test terminal)
# ---------------------------------------------------------------------------


def _yaml_safe(value: Any) -> Any:
    """Coerce a Python value to a type that ``yaml.safe_dump`` can represent.

    Plugin code is free to return whatever Python objects it wants (lxml
    element strings, numpy scalars, enum members, custom classes), but
    everything persisted on the tracked-execution path ultimately goes
    through ``yaml.safe_dump``. YAML's SafeRepresenter refuses non-exact
    types - even a ``str`` subclass like lxml's ``_ElementUnicodeResult``
    raises ``RepresenterError('cannot represent an object', 'Alpha')``.
    Sanitize at the storage boundary so a single user plugin returning an
    unsafe value cannot stall the terminal callback and leave an execution
    frozen in ``running``.

    Coercion rules:
      - ``None`` / ``bool`` / exact ``int`` / exact ``float`` / exact ``str``: pass through
      - ``str`` / ``int`` / ``float`` subclasses: coerce to the base type
      - ``dict``: coerce keys to ``str`` and values recursively
      - ``list``/``tuple``: coerce items recursively (tuples become lists)
      - anything else: fall back to ``str(value)``
    """
    if value is None or isinstance(value, bool):
        return value
    if type(value) is int or type(value) is float or type(value) is str:
        return value
    if isinstance(value, str):
        return str(value)
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    # Exact float values persist as plain decimal strings, never E notation (REQ-3.1.3.14).
    if isinstance(value, Decimal):
        return decimal_to_str(value)
    if isinstance(value, dict):
        return {str(k): _yaml_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_yaml_safe(v) for v in value]
    return str(value)


def _save_snapshot(
    execution_id: str,
    run_id: str,
    snapshot: dict[str, Any],
    registry: SecretRegistry | None = None,
) -> None:
    """Persist a run snapshot; stored variables are always masked at rest so a
    temporary reveal can never bake plaintext onto disk (execution records are a
    masked surface - export offers no secrets choice)."""
    if "variables" in snapshot:
        variables = _drop_engine_injected(snapshot["variables"])
        if registry is not None:
            variables = mask_structure(variables, registry)
        snapshot = {**snapshot, "variables": wire_values(variables)}
    # A value _yaml_safe stringifies (a Table) masks its cells before it lays them out.
    with render_scope(registry, None):
        _yaml_write(_snapshot_file(execution_id, run_id), _yaml_safe(snapshot))


def _load_snapshot(execution_id: str, run_id: str) -> dict[str, Any] | None:
    data = _yaml_load(_snapshot_file(execution_id, run_id))
    return data if isinstance(data, dict) else None


# ---------------------------------------------------------------------------
# Variables (optional, test-type executions)
# ---------------------------------------------------------------------------


def _drop_engine_injected(variables: dict[str, Any]) -> dict[str, Any]:
    """Engine-injected entries (namespace objects, dotted alias shortcuts like
    ``creds.api_key``) are expression machinery and may carry live credentials -
    they never persist."""
    return {k: v for k, v in variables.items() if not is_engine_injected(k, v)}


def _save_variables(
    execution_id: str,
    variables: dict[str, Any],
    registry: SecretRegistry | None = None,
) -> None:
    payload = _drop_engine_injected(variables)
    if registry is not None:
        payload = mask_structure(payload, registry)
    with render_scope(registry, None):
        _yaml_write(
            _get_execution_dir(execution_id) / "variables.yaml", _yaml_safe(wire_values(payload))
        )


def _load_variables(execution_id: str) -> dict[str, Any]:
    data = _yaml_load(_get_execution_dir(execution_id) / "variables.yaml")
    return data if isinstance(data, dict) else {}


# ---------------------------------------------------------------------------
# Runtime state (the authoritative view during a running execution)
# ---------------------------------------------------------------------------


def _init_runtime_state(
    execution_id: str,
    started_at: str,
    composition: dict[str, Any],
    selected_run_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Initialize in-memory runtime state for a fresh execution.

    Seeds one ``runs`` entry per test in composition with status ``pending``
    (when the test is selected or ``selected_run_ids`` is ``None``) or
    ``excluded`` (otherwise).
    """
    selected = set(selected_run_ids) if selected_run_ids is not None else None
    runs: dict[str, dict[str, Any]] = {}
    for suite in composition.get("suites", []):
        for test in suite.get("tests", []):
            run_id = test.get("run_id")
            if not run_id:
                continue
            is_selected = selected is None or run_id in selected
            runs[run_id] = {
                "test_id": test.get("id"),
                "suite_id": suite.get("id"),
                "status": "pending" if is_selected else "excluded",
                "started_at": None,
                "ended_at": None,
                "duration": 0 if not is_selected else None,
            }
    state: dict[str, Any] = {
        "status": "running",
        "started_at": started_at,
        "ended_at": None,
        "duration": None,
        "runs": runs,
    }
    _runtime_state[execution_id] = state
    return state


def _get_runtime_state(execution_id: str) -> dict[str, Any] | None:
    state = _runtime_state.get(execution_id)
    if state is not None:
        return state
    if _load_execution(execution_id) is None:
        return None
    return _rebuild_runtime_state(execution_id)


def _rebuild_runtime_state(execution_id: str) -> dict[str, Any]:
    """Rebuild runtime state from disk for a process that just started.

    Walks the static composition to seed the ``runs`` map, then replays
    ``runs.yaml`` (dispatch order) and ``status.yaml`` (transitions) so each
    run carries its latest known state.
    """
    composition = _load_composition(execution_id)
    execution = _load_execution(execution_id) or {}
    state: dict[str, Any] = {
        "status": execution.get("status", "running"),
        "started_at": execution.get("started_at"),
        "ended_at": execution.get("ended_at"),
        "duration": execution.get("duration"),
        "runs": _seed_runs_from_composition(composition),
    }
    _apply_status_replay(state["runs"], _load_status(execution_id))
    _runtime_state[execution_id] = state
    return state


def _seed_runs_from_composition(
    composition: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Build an initial ``runs`` map with every composition test pinned
    to ``pending``. Composition entries without a ``run_id`` are
    ignored."""
    runs: dict[str, dict[str, Any]] = {}
    for suite in composition.get("suites", []):
        for test in suite.get("tests", []):
            run_id = test.get("run_id")
            if not run_id:
                continue
            runs[run_id] = {
                "test_id": test.get("id"),
                "suite_id": suite.get("id"),
                "status": "pending",
                "started_at": None,
                "ended_at": None,
                "duration": None,
            }
    return runs


_REPLAY_FIELDS = ("status", "started_at", "ended_at", "duration")


def _apply_status_replay(
    runs: dict[str, dict[str, Any]],
    status_entries: list[dict[str, Any]],
) -> None:
    """Replay status.yaml transitions onto an already-seeded runs map.
    Entries whose run_id is not in the composition are dropped so stale
    transitions don't leak new run records."""
    for entry in status_entries:
        run_id = entry.get("run_id")
        if not run_id or run_id not in runs:
            continue
        run = runs[run_id]
        for field in _REPLAY_FIELDS:
            if entry.get(field) is not None:
                run[field] = entry[field]


def _record_run_dispatched(
    execution_id: str,
    run_id: str,
    test_id: str,
    suite_id: str | None,
) -> None:
    """Persist a runs.yaml entry and ensure a matching in-memory slot."""
    _append_run(
        execution_id,
        {"run_id": run_id, "test_id": test_id, "suite_id": suite_id},
    )
    state = _runtime_state.setdefault(
        execution_id,
        {
            "status": "running",
            "started_at": None,
            "ended_at": None,
            "duration": None,
            "runs": {},
        },
    )
    state["runs"].setdefault(
        run_id,
        {
            "test_id": test_id,
            "suite_id": suite_id,
            "status": "pending",
            "started_at": None,
            "ended_at": None,
            "duration": None,
        },
    )


def _record_run_transition(
    execution_id: str,
    run_id: str,
    *,
    status: str | None = None,
    started_at: str | None = None,
    ended_at: str | None = None,
    duration: float | None = None,
) -> None:
    """Append a status.yaml entry and mutate in-memory runtime state to match."""
    entry: dict[str, Any] = {"run_id": run_id}
    if status is not None:
        entry["status"] = status
    if started_at is not None:
        entry["started_at"] = started_at
    if ended_at is not None:
        entry["ended_at"] = ended_at
    if duration is not None:
        entry["duration"] = duration
    _append_status(execution_id, entry)

    state = _runtime_state.get(execution_id)
    if state is None:
        return
    run = state["runs"].setdefault(
        run_id,
        {
            "test_id": None,
            "suite_id": None,
            "status": "pending",
            "started_at": None,
            "ended_at": None,
            "duration": None,
        },
    )
    if status is not None:
        run["status"] = status
    if started_at is not None:
        run["started_at"] = started_at
    if ended_at is not None:
        run["ended_at"] = ended_at
    if duration is not None:
        run["duration"] = duration


def _compute_live_duration(started_at: str | None, now: datetime | None = None) -> float | None:
    """Seconds elapsed since ``started_at``. ``None`` when no start yet."""
    if not started_at:
        return None
    now = now or datetime.now(UTC)
    start = datetime.fromisoformat(started_at.replace("Z", _TZ_UTC_SUFFIX))
    return round((now - start).total_seconds(), 3)


# ---------------------------------------------------------------------------
# Cache lifecycle
# ---------------------------------------------------------------------------


def _delete_execution_files(execution_id: str) -> None:
    exec_dir = _get_execution_dir(execution_id)
    if exec_dir.exists():
        shutil.rmtree(exec_dir)


def _load_all_executions() -> list[dict[str, Any]]:
    _ensure_storage_dir()
    executions = []
    storage_dir = get_executions_storage_path()
    if storage_dir.exists():
        for exec_dir in storage_dir.iterdir():
            if exec_dir.is_dir():
                execution = _load_execution(exec_dir.name)
                if execution:
                    executions.append(execution)
    return executions


def _recover_orphaned_executions() -> None:
    """Mark orphaned running/paused executions as stopped on startup.

    For each orphan, also appends a FATAL scope log to ``logs.yaml`` so
    the merged console makes it clear the run was cut short by a
    backend restart (the SIGKILL path where no in-process cancellation
    handler got to write anything).
    """
    storage_dir = get_executions_storage_path()
    if not storage_dir.exists():
        return

    now_iso = datetime.now(UTC).isoformat()
    for exec_dir in storage_dir.iterdir():
        if not exec_dir.is_dir():
            continue
        execution = _load_execution(exec_dir.name)
        if execution is None:
            continue
        if execution.get("status") in ("running", "paused"):
            execution["status"] = "stopped"
            execution["ended_at"] = now_iso
            started_at = execution.get("started_at")
            if started_at:
                execution["duration"] = _compute_duration_seconds(started_at, now_iso)
            _save_execution(execution)
            _append_orphan_recovery_log(exec_dir.name, execution)


def _append_orphan_recovery_log(execution_id: str, execution: dict[str, Any]) -> None:
    """Append a FATAL scope-log row to ``logs.yaml`` noting the
    backend-restart cause. Uses a regression/suite banner variant so
    the frontend renders it with the matching distinctive style."""
    entity_type = execution.get("entity_type") or "execution"
    entity_name = execution.get("name") or execution_id
    label = entity_type.capitalize() if entity_type else "Execution"
    variant = "regression-banner" if entity_type == "regression" else "suite-banner"
    scope_kind = "regression" if entity_type == "regression" else "suite"
    entry: dict[str, Any] = {
        "type": scope_kind,
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "level": "FATAL",
        "message": f"{label} '{entity_name}' canceled by backend restart",
        "source": "SYSTEM",
        "blockId": None,
        "variant": variant,
    }
    _append_chronology(execution_id, entry)


def _ensure_cache_loaded() -> None:
    global _cache_loaded
    if _cache_loaded:
        return
    _recover_orphaned_executions()
    _execution_storage.clear()
    _runtime_state.clear()
    _composition_cache.clear()
    _log_seq.clear()
    _execution_variables.clear()
    for execution in _load_all_executions():
        _execution_storage[execution["id"]] = execution
    _cache_loaded = True


def _clear_in_memory_cache() -> None:
    global _cache_loaded
    _execution_reader.clear()
    _runtime_state.clear()
    _composition_cache.clear()
    _log_seq.clear()
    _execution_variables.clear()
    _cache_loaded = False


def _clear_storage() -> None:
    """Test utility: clear both in-memory and on-disk state."""
    global _cache_loaded
    _execution_reader.clear()
    _runtime_state.clear()
    _composition_cache.clear()
    _log_seq.clear()
    _execution_variables.clear()
    _cache_loaded = True
    storage_dir = get_executions_storage_path()
    if storage_dir.exists():
        shutil.rmtree(storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Active-execution lookup (shared by entity delete guards)
# ---------------------------------------------------------------------------


_ACTIVE_EXECUTION_STATUSES: frozenset[str] = frozenset({"running", "paused"})


def get_active_tracked_executions(entity_type: str, entity_id: str) -> list[str]:
    """Return execution IDs that currently hold the given entity.

    An execution "holds" the entity when its ``entity_type`` and ``entity_id``
    match and its ``status`` is non-terminal (``running`` or ``paused``). The
    three entity delete services call this to decide whether to reject the
    delete with a ``409 Conflict`` and surface the blocking IDs to the caller.
    """
    _ensure_cache_loaded()
    return [
        record["id"]
        for record in _execution_storage.values()
        if record.get("entity_type") == entity_type
        and record.get("entity_id") == entity_id
        and record.get("status") in _ACTIVE_EXECUTION_STATUSES
    ]


def get_active_executions_holding_test(test_id: str) -> list[str]:
    """Active execution IDs whose entity is the test or whose runs carry it.

    Widens ``get_active_tracked_executions`` to suite and regression records
    running the test as a child, read from the runtime state or ``runs.yaml``.
    """
    _ensure_cache_loaded()
    return [
        record["id"]
        for record in _execution_storage.values()
        if record.get("status") in _ACTIVE_EXECUTION_STATUSES
        and _execution_holds_test(record, test_id)
    ]


def _execution_holds_test(record: dict[str, Any], test_id: str) -> bool:
    if record.get("entity_type") == "test" and record.get("entity_id") == test_id:
        return True
    execution_id = record["id"]
    state = _runtime_state.get(execution_id)
    if state is not None and any(run.get("test_id") == test_id for run in state["runs"].values()):
        return True
    return any(run.get("test_id") == test_id for run in _load_runs(execution_id))


# ---------------------------------------------------------------------------
# Entity / plugin helpers (unchanged from v1)
# ---------------------------------------------------------------------------


def _validate_entity(entity_type: str, entity_id: str) -> dict[str, Any] | None:
    from wavecore.api.services.tests import service as test_service

    if entity_type == "test":
        return test_service.validate_test(entity_id, context="run")
    return None


def _get_entity(entity_type: str, entity_id: str) -> dict[str, Any] | None:
    from wavecore.api.services.regressions import service as regression_service
    from wavecore.api.services.suites import service as suite_service
    from wavecore.api.services.tests import service as test_service

    if entity_type == "test":
        return test_service.get_test(entity_id)
    if entity_type == "suite":
        return suite_service.get_suite(entity_id)
    if entity_type == "regression":
        return regression_service.get_regression(entity_id)
    return None


def _validate_state_transition(current_state: str, _target_state: str, operation: str) -> None:
    if operation not in STATE_TRANSITIONS:
        raise ValidationException(f"Unknown operation '{operation}'")
    valid_sources, _ = STATE_TRANSITIONS[operation]
    if current_state not in valid_sources:
        raise ConflictException(
            f"Cannot {operation} execution in '{current_state}' state. "
            f"Valid source states for {operation}: {', '.join(valid_sources)}"
        )


def _compute_duration_seconds(started_at: str, ended_at: str) -> int:
    start = datetime.fromisoformat(started_at.replace("Z", _TZ_UTC_SUFFIX))
    end = datetime.fromisoformat(ended_at.replace("Z", _TZ_UTC_SUFFIX))
    return int((end - start).total_seconds())


def _update_execution_status(execution_id: str, status: str) -> None:
    _ensure_cache_loaded()
    if execution_id not in _execution_storage:
        return
    _execution_storage[execution_id]["status"] = status
    if status in TERMINAL_STATUSES:
        ended_at = datetime.now(UTC).isoformat()
        _execution_storage[execution_id]["ended_at"] = ended_at
        started_at = _execution_storage[execution_id].get("started_at")
        if started_at:
            _execution_storage[execution_id]["duration"] = _compute_duration_seconds(
                started_at, ended_at
            )
        state = _runtime_state.get(execution_id)
        if state is not None:
            state["status"] = status
            state["ended_at"] = ended_at
            state["duration"] = _execution_storage[execution_id].get("duration")
    else:
        state = _runtime_state.get(execution_id)
        if state is not None:
            state["status"] = status
    _save_execution(_execution_storage[execution_id])


def _check_entity_validation(entity_type: str, entity_id: str) -> None:
    validation = _validate_entity(entity_type, entity_id)
    if validation is None:
        return
    errors = validation.get("errors", [])
    if validation.get("fatal"):
        fatal_msgs = [e["message"] for e in errors if e.get("message")]
        raise ValidationException(
            f"Cannot start execution: test has fatal validation errors: {'; '.join(fatal_msgs)}"
        )
    if errors:
        error_msgs = [e["message"] for e in errors if e.get("message")]
        raise ValidationException(
            f"Cannot start execution: test has validation errors: {'; '.join(error_msgs)}"
        )


_STATUS_ORDER: dict[str, int] = {"running": 0, "passed": 1, "failed": 2, "stopped": 3}


def _filter_executions(
    items: list[dict[str, Any]],
    status: list[str] | None,
    entity_type: list[str] | None,
    triggered_by: list[str] | None,
    entity_id: str | None,
    search: str | None,
    from_date: datetime | None,
    to_date: datetime | None,
) -> list[dict[str, Any]]:
    if search:
        search_lower = search.lower()
        items = [
            e
            for e in items
            if search_lower in e.get("name", "").lower()
            or search_lower in e.get("triggered_by", "").lower()
        ]
    if status:
        items = [e for e in items if e.get("status") in status]
    if entity_type:
        items = [e for e in items if e.get("entity_type") in entity_type]
    if triggered_by:
        items = [e for e in items if e.get("triggered_by") in triggered_by]
    if entity_id:
        items = [e for e in items if e.get("entity_id") == entity_id]
    if from_date:
        items = [
            e
            for e in items
            if datetime.fromisoformat(e.get("started_at", "").replace("Z", _TZ_UTC_SUFFIX))
            >= from_date
        ]
    if to_date:
        items = [
            e
            for e in items
            if datetime.fromisoformat(e.get("started_at", "").replace("Z", _TZ_UTC_SUFFIX))
            <= to_date
        ]
    return items


def _sort_executions(items: list[dict[str, Any]], sort: str, order: str) -> None:
    reverse = order == "desc"
    sort_keys: dict[str, Any] = {
        "started_at": lambda x: x.get("started_at", ""),
        "name": lambda x: (x.get("name") or "").lower(),
        "status": lambda x: _STATUS_ORDER.get(x.get("status", ""), 99),
        "triggered_by": lambda x: (x.get("triggered_by") or "").lower(),
        "type": lambda x: x.get("entity_type", ""),
        "entity_type": lambda x: x.get("entity_type", ""),
        "duration": lambda x: (
            float(x["duration"]) if x.get("duration") is not None else float("inf")
        ),
        "completed_at": lambda x: x.get("completed_at") or "",
    }
    key_fn = sort_keys.get(sort)
    if key_fn is not None:
        items.sort(key=key_fn, reverse=reverse)
