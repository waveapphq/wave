"""Unit tests for execution artifact directory allocation (REQ-6.1.4).

Every tracked execution gets one isolated artifact directory named
``{YYYYMMDD-HHMMSS}-{execution_id}`` under the artifact root, created at
execution start. The directory name is persisted once on the execution record
(``artifact_dir``) so lookup never globs. Suite/regression executions share
the single parent directory. Low disk space logs a WARNING and never
blocks execution.
"""

import logging
import re
import uuid
from collections import namedtuple
from unittest.mock import patch

import pytest

from wavecore.api.services import artifact_service
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.executions._storage import (
    _load_execution,
    _update_execution_status,
)
from wavecore.api.services.storage_paths import get_artifacts_storage_path

# Shared test environment ID (must match conftest.py seed_test_environment fixture)
TEST_ENV_ID = "env-test-00000000-0000-0000-0000-000000000001"

_DiskUsage = namedtuple("_DiskUsage", ["total", "used", "free"])

_GIB = 1024**3


def _start_test_execution(entity_id: str | None = None) -> dict:
    entity_id = entity_id or str(uuid.uuid4())
    with (
        patch.object(
            execution_service,
            "_get_entity",
            return_value={"id": entity_id, "name": "artifact-dir-test"},
        ),
        patch.object(execution_service, "_launch_execution_runner"),
    ):
        return execution_service.start_execution(
            entity_type="test",
            entity_id=entity_id,
            environment_id=TEST_ENV_ID,
        )


def _start_suite_execution(test_ids: list[str]) -> dict:
    suite_id = str(uuid.uuid4())
    entity = {"id": suite_id, "name": "artifact-dir-suite", "tests": test_ids}
    with (
        patch.object(execution_service, "_get_entity", return_value=entity),
        patch.object(execution_service, "_launch_execution_runner"),
    ):
        return execution_service.start_execution(
            entity_type="suite",
            entity_id=suite_id,
            environment_id=TEST_ENV_ID,
        )


class TestExecutionArtifactDirAllocation:
    """Directory created at start_execution with the timestamped name."""

    def test_record_carries_timestamped_artifact_dir(self) -> None:
        execution = _start_test_execution()

        execution_id = execution["id"]
        assert re.match(rf"^\d{{8}}-\d{{6}}-{re.escape(execution_id)}$", execution["artifact_dir"])

    def test_directory_exists_under_artifact_root(self) -> None:
        execution = _start_test_execution()

        directory = get_artifacts_storage_path() / execution["artifact_dir"]
        assert directory.is_dir()

    def test_artifact_dir_persisted_on_execution_record(self) -> None:
        execution = _start_test_execution()

        persisted = _load_execution(execution["id"])
        assert persisted is not None
        assert persisted["artifact_dir"] == execution["artifact_dir"]

    def test_artifact_dir_survives_terminal_status_update(self) -> None:
        execution = _start_test_execution()
        allocated = execution["artifact_dir"]

        _update_execution_status(execution["id"], "passed")

        persisted = _load_execution(execution["id"])
        assert persisted is not None
        assert persisted["artifact_dir"] == allocated

    def test_suite_execution_gets_single_shared_directory(self) -> None:
        test_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

        execution = _start_suite_execution(test_ids)

        root = get_artifacts_storage_path()
        execution_dirs = [p for p in root.iterdir() if p.is_dir() and p.name != "sessions"]
        assert [p.name for p in execution_dirs] == [execution["artifact_dir"]]
        assert execution["artifact_dir"].endswith(execution["id"])


class TestDeleteExecutionPurgesArtifactDir:
    """delete_execution removes the execution's artifact directory so its
    artifacts and reports do not orphan on disk when the execution is deleted."""

    def test_delete_removes_artifact_dir_with_artifacts_and_reports(self) -> None:
        execution = _start_test_execution()
        directory = get_artifacts_storage_path() / execution["artifact_dir"]
        (directory / "report.json").write_text("{}")
        (directory / "output.txt").write_text("data")
        _update_execution_status(execution["id"], "passed")
        assert directory.exists()

        assert execution_service.delete_execution(execution["id"]) is True

        assert not directory.exists()

    def test_purge_is_a_noop_when_no_artifact_dir_exists(self) -> None:
        # Resolver returns None for an unknown id; purge must not raise.
        artifact_service.purge_execution_artifact_dir(str(uuid.uuid4()))


class TestAllocateExecutionArtifactDir:
    """Service-level allocation helper (artifact_service)."""

    def test_allocation_creates_directory_and_returns_name(self) -> None:
        execution_id = str(uuid.uuid4())

        dir_name = artifact_service.allocate_execution_artifact_dir(execution_id)

        assert re.match(rf"^\d{{8}}-\d{{6}}-{re.escape(execution_id)}$", dir_name)
        assert (get_artifacts_storage_path() / dir_name).is_dir()

    def test_low_disk_space_logs_warning_and_proceeds(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        execution_id = str(uuid.uuid4())
        low = _DiskUsage(total=10 * _GIB, used=10 * _GIB - 512 * 1024**2, free=512 * 1024**2)

        with patch("shutil.disk_usage", return_value=low):
            with caplog.at_level(logging.WARNING):
                dir_name = artifact_service.allocate_execution_artifact_dir(execution_id)

        assert (get_artifacts_storage_path() / dir_name).is_dir()
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert any("disk space" in r.getMessage().lower() for r in warnings)

    def test_sufficient_disk_space_logs_no_warning(self, caplog: pytest.LogCaptureFixture) -> None:
        execution_id = str(uuid.uuid4())
        plenty = _DiskUsage(total=100 * _GIB, used=10 * _GIB, free=90 * _GIB)

        with patch("shutil.disk_usage", return_value=plenty):
            with caplog.at_level(logging.WARNING):
                artifact_service.allocate_execution_artifact_dir(execution_id)

        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert not any("disk space" in r.getMessage().lower() for r in warnings)
