"""Writes each test's full log stream of a finished execution to its own artifact (REQ-6.1.4)."""

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def write_execution_logs(execution: dict[str, Any]) -> None:
    """Persist every test's log stream under the execution's ``logs/`` dir."""
    from wavecore.api.services.executions._storage import _load_composition, _load_test_logs
    from wavecore.api.services.storage_paths import get_artifacts_storage_path

    artifact_dir = execution.get("artifact_dir")
    if not artifact_dir:
        return
    execution_id = execution["id"]
    logs_root = get_artifacts_storage_path() / str(artifact_dir) / "logs"
    composition = _load_composition(execution_id)
    for suite in composition.get("suites", []):
        suite_name = suite.get("name") or ""
        for test in suite.get("tests", []):
            run_id = test.get("run_id")
            if not run_id:
                continue
            entries = _load_test_logs(execution_id, run_id)
            _write_test_log(logs_root, suite_name, test.get("name") or run_id, entries)


def _write_test_log(
    logs_root: Path, suite_name: str, test_name: str, entries: list[dict[str, Any]]
) -> None:
    directory = logs_root / suite_name if suite_name else logs_root
    directory.mkdir(parents=True, exist_ok=True)
    body = "".join(f"{_format_entry(entry)}\n" for entry in entries)
    (directory / f"{test_name}.log").write_text(body, encoding="utf-8")


def _format_entry(entry: dict[str, Any]) -> str:
    timestamp = entry.get("timestamp", "")
    level = entry.get("level", "")
    message = entry.get("message", "")
    return f"{timestamp} {level} {message}".strip()
