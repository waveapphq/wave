"""Unit tests for per-test log persistence (REQ-6.1.4)."""

import subprocess
import sys
import uuid
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any

import pytest

from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.storage_paths import get_artifacts_storage_path
from wavecore.core.artifacts import log_writer


@pytest.fixture(autouse=True)
def _isolate_storage(temp_storage_path: Path) -> Generator[None, None, None]:
    exec_storage._clear_storage()
    yield


def _seed_execution(
    entity_type: str,
    composition: dict[str, Any],
    *,
    run_id_for_test: str | None = None,
    stamp: str = "20260609-120000",
) -> tuple[dict[str, Any], Path]:
    """Seed an execution record, its composition, and an artifact dir."""
    execution_id = str(uuid.uuid4())
    dir_name = f"{stamp}-{execution_id}"
    artifact_dir = get_artifacts_storage_path() / dir_name
    artifact_dir.mkdir(parents=True, exist_ok=True)
    record: dict[str, Any] = {
        "id": execution_id,
        "name": "log-writer-test",
        "entity_type": entity_type,
        "entity_id": str(uuid.uuid4()),
        "status": "passed",
        "started_at": "2026-06-09T12:00:00+00:00",
        "ended_at": "2026-06-09T12:01:00+00:00",
        "run_id": run_id_for_test or execution_id,
        "artifact_dir": dir_name,
    }
    exec_storage._save_execution(record)
    exec_storage._execution_storage[execution_id] = record
    exec_storage._save_composition(execution_id, composition)
    return record, artifact_dir


def _append(execution_id: str, run_id: str, level: str, message: str) -> None:
    exec_storage._append_log(
        execution_id,
        run_id,
        {
            "level": level,
            "message": message,
            "blockId": None,
            "source": "PLUGIN",
            "timestamp": "2026-06-09T12:00:30Z",
        },
    )


class TestStandaloneTestLogs:
    """A test-type execution writes ``logs/<test>.log`` (no suite directory)."""

    def test_writes_log_file_for_the_test(self) -> None:
        run_id = str(uuid.uuid4())
        composition = {
            "suites": [
                {
                    "id": None,
                    "name": "",
                    "tests": [
                        {"id": str(uuid.uuid4()), "name": "login_test", "run_id": run_id},
                    ],
                }
            ]
        }
        record, artifact_dir = _seed_execution("test", composition, run_id_for_test=run_id)
        _append(record["id"], run_id, "INFO", "starting login")
        _append(record["id"], run_id, "INFO", "login complete")

        log_writer.write_execution_logs(record)

        log_file = artifact_dir / "logs" / "login_test.log"
        assert log_file.is_file()
        content = log_file.read_text()
        assert "starting login" in content
        assert "login complete" in content
        assert content.index("starting login") < content.index("login complete")

    def test_full_stream_is_persisted_unfiltered(self) -> None:
        run_id = str(uuid.uuid4())
        composition = {
            "suites": [
                {
                    "id": None,
                    "name": "",
                    "tests": [
                        {"id": str(uuid.uuid4()), "name": "noisy_test", "run_id": run_id},
                    ],
                }
            ]
        }
        record, artifact_dir = _seed_execution("test", composition, run_id_for_test=run_id)
        _append(record["id"], run_id, "INFO", "info line")
        _append(record["id"], run_id, "WARN", "warn line")
        _append(record["id"], run_id, "ERROR", "error line")

        log_writer.write_execution_logs(record)

        content = (artifact_dir / "logs" / "noisy_test.log").read_text()
        assert "info line" in content
        assert "warn line" in content
        assert "error line" in content


class TestSuiteLogs:
    """A suite execution writes ``logs/<suite>/<test>.log`` per child test."""

    def test_each_test_gets_its_own_file_under_the_suite(self) -> None:
        run_a = str(uuid.uuid4())
        run_b = str(uuid.uuid4())
        composition = {
            "suites": [
                {
                    "id": str(uuid.uuid4()),
                    "name": "smoke_suite",
                    "tests": [
                        {"id": str(uuid.uuid4()), "name": "test_a", "run_id": run_a},
                        {"id": str(uuid.uuid4()), "name": "test_b", "run_id": run_b},
                    ],
                }
            ]
        }
        record, artifact_dir = _seed_execution("suite", composition)
        _append(record["id"], run_a, "INFO", "from test a")
        _append(record["id"], run_b, "INFO", "from test b")

        log_writer.write_execution_logs(record)

        file_a = artifact_dir / "logs" / "smoke_suite" / "test_a.log"
        file_b = artifact_dir / "logs" / "smoke_suite" / "test_b.log"
        assert file_a.is_file()
        assert file_b.is_file()
        assert "from test a" in file_a.read_text()
        assert "from test b" in file_b.read_text()
        assert "from test b" not in file_a.read_text()

    def test_test_without_run_id_is_skipped(self) -> None:
        composition = {
            "suites": [
                {
                    "id": str(uuid.uuid4()),
                    "name": "skip_suite",
                    "tests": [
                        {"id": str(uuid.uuid4()), "name": "no_run", "run_id": None},
                    ],
                }
            ]
        }
        record, artifact_dir = _seed_execution("suite", composition)

        log_writer.write_execution_logs(record)

        assert not (artifact_dir / "logs" / "skip_suite" / "no_run.log").exists()


class TestNoArtifactDir:
    """An execution without an artifact dir writes nothing (no-op)."""

    def test_missing_artifact_dir_is_noop(self) -> None:
        log_writer.write_execution_logs({"id": str(uuid.uuid4())})

        assert not list(get_artifacts_storage_path().rglob("*.log"))


LOCALE_LINE = "Grüße 測試"
STORED_LOCALE_ENTRY = f"- seq: 0\n  level: INFO\n  message: {LOCALE_LINE}\n"

CHILD_WRITES_LOGS = """\
import sys

from wavecore.api.services import storage_paths
from wavecore.core.artifacts import log_writer

storage_paths.set_base_path(sys.argv[1])
log_writer.write_execution_logs({"id": sys.argv[2], "artifact_dir": sys.argv[3]})
"""


class TestLocaleIndependence:
    """Log files are UTF-8 on a WAVE host whose locale is not UTF-8 (REQ-4.6.9)."""

    @pytest.fixture
    def execution(self) -> tuple[dict[str, Any], str, Path]:
        """A standalone test execution: its record, its run id and its log file."""
        run_id = str(uuid.uuid4())
        composition = {
            "suites": [
                {
                    "id": None,
                    "name": "",
                    "tests": [
                        {"id": str(uuid.uuid4()), "name": "locale_test", "run_id": run_id},
                    ],
                }
            ]
        }
        record, artifact_dir = _seed_execution("test", composition, run_id_for_test=run_id)
        return record, run_id, artifact_dir / "logs" / "locale_test.log"

    @pytest.fixture
    def write_logs_in_child(
        self, tmp_path: Path, temp_storage_path: Path, non_utf8_child_env: dict[str, str]
    ) -> Callable[[dict[str, Any]], subprocess.CompletedProcess[bytes]]:
        """Run the log writer in a child Python on a host that is not UTF-8."""

        def _run(record: dict[str, Any]) -> subprocess.CompletedProcess[bytes]:
            script = tmp_path / "child.py"
            script.write_text(CHILD_WRITES_LOGS, encoding="utf-8")
            return subprocess.run(
                [
                    sys.executable,
                    str(script),
                    str(temp_storage_path),
                    record["id"],
                    record["artifact_dir"],
                ],
                env=non_utf8_child_env,
                capture_output=True,
                timeout=30,
                check=False,
            )

        return _run

    def test_line_outside_ascii_is_written_as_utf8(
        self,
        execution: tuple[dict[str, Any], str, Path],
        write_logs_in_child: Callable[[dict[str, Any]], subprocess.CompletedProcess[bytes]],
    ) -> None:
        # Starts a child Python.
        record, run_id, log_file = execution
        _append(record["id"], run_id, "INFO", LOCALE_LINE)

        done = write_logs_in_child(record)

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
        assert LOCALE_LINE in log_file.read_bytes().decode("utf-8")

    def test_line_stored_as_utf8_reaches_the_log_file(
        self,
        execution: tuple[dict[str, Any], str, Path],
        write_logs_in_child: Callable[[dict[str, Any]], subprocess.CompletedProcess[bytes]],
    ) -> None:
        # Starts a child Python.
        record, run_id, log_file = execution
        stored = exec_storage._log_file(record["id"], run_id)
        stored.parent.mkdir(parents=True, exist_ok=True)
        stored.write_bytes(STORED_LOCALE_ENTRY.encode("utf-8"))

        done = write_logs_in_child(record)

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
        assert LOCALE_LINE in log_file.read_bytes().decode("utf-8")
