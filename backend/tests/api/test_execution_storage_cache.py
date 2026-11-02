"""Tests for the execution cache and its storage directory.

Executions do not get the per-request directory reconcile the other entity types
get: the list is the cheapest one in the product and executions have no upper
bound, so a scan per request would dominate it. What they do get is eviction: a
read that finds no file drops the entry and every satellite map keyed by the same
id, so nothing is left behind in memory.
"""

import logging
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.storage_paths import get_executions_storage_path
from wavecore.api.services.workbench import service as workbench_service

TEST_ENV_ID = "env-test-00000000-0000-0000-0000-000000000001"
_LOGGER_NAME = "wavecore.api.services.executions._storage"


def _start_execution() -> dict[str, Any]:
    """Start a test-type execution without needing a stored Test to run."""
    entity_id = str(uuid.uuid4())
    with (
        patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ),
        patch.object(
            workbench_service,
            "start_workbench_run",
            return_value={
                "session_id": "mock-session",
                "status": "running",
                "websocket_topic": "workbench:mock-session",
                "warnings": [],
            },
        ),
    ):
        return execution_service.start_execution(
            entity_type="test",
            entity_id=entity_id,
            environment_id=TEST_ENV_ID,
        )


def _remove_execution_dir(execution_id: str) -> None:
    """Delete an execution's whole directory behind the product's back."""
    import shutil

    shutil.rmtree(get_executions_storage_path() / execution_id)


def _seed_satellites(execution_id: str) -> None:
    """Fill every map keyed by the execution id, as a real run would."""
    exec_storage._composition_cache[execution_id] = {"suites": []}
    exec_storage._runtime_state[execution_id] = {"status": "passed", "runs": {}}
    exec_storage._log_seq[(execution_id, "run-1")] = 3
    exec_storage._execution_variables[execution_id] = {"count": 1}


def _satellite_keys(execution_id: str) -> list[str]:
    """Names of the maps that still hold this execution id."""
    held = []
    if execution_id in exec_storage._composition_cache:
        held.append("composition")
    if execution_id in exec_storage._runtime_state:
        held.append("runtime_state")
    if any(key[0] == execution_id for key in exec_storage._log_seq):
        held.append("log_seq")
    if execution_id in exec_storage._execution_variables:
        held.append("variables")
    return held


class TestReadEvictsAMissingExecution:
    """A read that finds nothing must leave no trace of that execution in memory."""

    def setup_method(self) -> None:
        exec_storage._clear_storage()

    def test_get_execution_returns_none_and_drops_the_cache_entry(self) -> None:
        started = _start_execution()
        _remove_execution_dir(started["id"])

        assert execution_service.get_execution(started["id"]) is None
        assert started["id"] not in exec_storage._execution_storage

    def test_eviction_drops_every_map_keyed_by_the_execution(self) -> None:
        started = _start_execution()
        _seed_satellites(started["id"])
        _remove_execution_dir(started["id"])

        assert execution_service.get_execution(started["id"]) is None
        assert _satellite_keys(started["id"]) == []

    def test_deleting_through_the_product_drops_every_map_too(self) -> None:
        started = _start_execution()
        exec_storage._update_execution_status(started["id"], "passed")
        _seed_satellites(started["id"])

        assert execution_service.delete_execution(started["id"]) is True
        assert started["id"] not in exec_storage._execution_storage
        assert _satellite_keys(started["id"]) == []

    def test_list_drops_the_execution_once_a_read_has_evicted_it(self) -> None:
        kept = _start_execution()
        gone = _start_execution()
        _remove_execution_dir(gone["id"])

        assert execution_service.get_execution(gone["id"]) is None

        listed = {row["id"] for row in execution_service.list_executions()["executions"]}
        assert listed == {kept["id"]}

    def test_progress_and_variables_report_nothing_for_a_deleted_execution(self) -> None:
        started = _start_execution()
        _remove_execution_dir(started["id"])

        assert execution_service.get_execution(started["id"]) is None
        assert execution_service.get_execution_progress(started["id"]) is None
        assert execution_service.get_execution_variables(started["id"]) is None


class TestListingDoesNotScanTheDirectory:
    """The executions list stays a memory read; it must not stat the directory."""

    def setup_method(self) -> None:
        exec_storage._clear_storage()

    def test_list_does_not_read_the_storage_directory(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _start_execution()
        scans: list[str] = []
        import os

        real_scandir = os.scandir

        def counting_scandir(path: Any = ".") -> Any:
            scans.append(str(path))
            return real_scandir(path)

        monkeypatch.setattr(os, "scandir", counting_scandir)
        execution_service.list_executions()

        assert scans == []

    def test_list_still_shows_an_execution_deleted_behind_the_products_back(self) -> None:
        started = _start_execution()
        _remove_execution_dir(started["id"])

        listed = {row["id"] for row in execution_service.list_executions()["executions"]}
        assert listed == {started["id"]}


class TestOrdinaryLifecycleIsUnchanged:
    """Start, read, list and delete through the product still behave."""

    def setup_method(self) -> None:
        exec_storage._clear_storage()

    def test_start_read_list_delete_cycle(self) -> None:
        started = _start_execution()
        execution_id = started["id"]

        fetched = execution_service.get_execution(execution_id)
        assert fetched is not None
        assert fetched["id"] == execution_id

        listed = {row["id"] for row in execution_service.list_executions()["executions"]}
        assert listed == {execution_id}

        exec_storage._update_execution_status(execution_id, "passed")
        assert execution_service.delete_execution(execution_id) is True
        assert execution_service.get_execution(execution_id) is None
        assert execution_service.list_executions()["total"] == 0

    def test_a_running_execution_cannot_be_deleted(self) -> None:
        started = _start_execution()

        with pytest.raises(ConflictException, match="Cannot delete execution in 'running' state"):
            execution_service.delete_execution(started["id"])

    def test_a_running_execution_is_not_evicted_by_a_read(self) -> None:
        started = _start_execution()

        assert execution_service.get_execution(started["id"]) is not None
        assert started["id"] in exec_storage._execution_storage


def _execution_file(execution_id: str) -> Path:
    return get_executions_storage_path() / execution_id / "execution.yaml"


def _write_raw_bytes(execution_id: str, contents: bytes) -> Path:
    """Write raw bytes where an execution's record belongs."""
    directory = get_executions_storage_path() / execution_id
    directory.mkdir(parents=True, exist_ok=True)
    execution_file = directory / "execution.yaml"
    execution_file.write_bytes(contents)
    return execution_file


def _warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.levelno >= logging.WARNING and record.name == _LOGGER_NAME
    ]


def _reload_from_disk() -> dict[str, Any]:
    """Drop the cache so the next list rebuilds it from the storage directory."""
    exec_storage._clear_in_memory_cache()
    return execution_service.list_executions()


class TestUnreadableExecutionFileDoesNotBreakTheList:
    """One unreadable execution file must not take down the whole list."""

    def setup_method(self) -> None:
        exec_storage._clear_storage()

    def test_list_survives_an_execution_file_that_is_not_utf8(self) -> None:
        kept = _start_execution()
        _write_raw_bytes(str(uuid.uuid4()), b"\xff\xfe\x00broken")

        listed = {row["id"] for row in _reload_from_disk()["executions"]}

        assert listed == {kept["id"]}

    def test_list_survives_an_unparsable_execution_file(self) -> None:
        kept = _start_execution()
        _write_raw_bytes(str(uuid.uuid4()), b"name: Broken\n  bad: [indent\n")

        listed = {row["id"] for row in _reload_from_disk()["executions"]}

        assert listed == {kept["id"]}

    def test_list_survives_an_execution_file_the_process_cannot_read(self) -> None:
        kept = _start_execution()
        unreadable = _write_raw_bytes(str(uuid.uuid4()), b"id: x\n")
        unreadable.chmod(0o000)

        try:
            listed = {row["id"] for row in _reload_from_disk()["executions"]}
        finally:
            unreadable.chmod(0o644)

        assert listed == {kept["id"]}

    def test_list_survives_a_directory_where_the_execution_file_should_be(self) -> None:
        kept = _start_execution()
        (get_executions_storage_path() / str(uuid.uuid4()) / "execution.yaml").mkdir(parents=True)

        listed = {row["id"] for row in _reload_from_disk()["executions"]}

        assert listed == {kept["id"]}

    def test_skipped_file_is_logged_with_its_path_and_reason(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        _start_execution()
        broken_id = str(uuid.uuid4())
        _write_raw_bytes(broken_id, b"\xff\xfe\x00broken")

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            _reload_from_disk()

        assert len(_warnings(caplog)) == 1
        assert str(_execution_file(broken_id)) in _warnings(caplog)[0]
        assert "UnicodeDecodeError" in _warnings(caplog)[0]

    def test_an_unreadable_file_is_reported_once_not_once_per_read(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        broken_id = str(uuid.uuid4())
        _write_raw_bytes(broken_id, b"name: Broken\n  bad: [indent\n")

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            exec_storage._load_execution(broken_id)
            exec_storage._load_execution(broken_id)
            exec_storage._load_execution(broken_id)

        assert len(_warnings(caplog)) == 1

    def test_a_file_that_is_simply_absent_is_not_reported(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            assert exec_storage._load_execution(str(uuid.uuid4())) is None

        assert _warnings(caplog) == []

    def test_reading_an_execution_survives_a_satellite_file_that_is_not_utf8(self) -> None:
        started = _start_execution()
        (get_executions_storage_path() / started["id"] / "composition.yaml").write_bytes(
            b"\xff\xfe\x00broken"
        )
        exec_storage._composition_cache.clear()

        fetched = execution_service.get_execution(started["id"])

        assert fetched is not None
        assert fetched["id"] == started["id"]

    def test_a_repaired_file_rejoins_the_list(self) -> None:
        kept = _start_execution()
        broken_id = str(uuid.uuid4())
        _write_raw_bytes(broken_id, b"\xff\xfe\x00broken")
        _reload_from_disk()

        _write_raw_bytes(
            broken_id,
            f"id: {broken_id}\nstatus: passed\nstarted_at: '2026-08-23T00:00:00+00:00'\n".encode(),
        )
        listed = {row["id"] for row in _reload_from_disk()["executions"]}

        assert listed == {kept["id"], broken_id}
