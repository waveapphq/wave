"""Test data cannot be changed while the test is running (REQ-3.4.3.2)."""

import io
import uuid
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from tests.api.services.tests.conftest import TEST_NAME, seed_file, store
from wavecore.api.exceptions import ConflictException
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.tests import testdata_service
from wavecore.api.services.workbench import _common as workbench_common
from wavecore.api.services.workbench import service as workbench_service

_RUNNING = rf"^Test '{TEST_NAME}' is running; test data cannot be changed until it finishes$"


def _holders(tracked: list[str], sessions: list[str]) -> tuple[Any, Any]:
    """Both running-test lookups, patched for the duration of a with block."""
    return (
        patch.object(exec_storage, "get_active_executions_holding_test", return_value=tracked),
        patch.object(workbench_service, "sessions_running_test", return_value=sessions),
    )


class TestAssertNotRunning:
    """The refusal combines tracked executions and workbench sessions."""

    def test_it_passes_when_nothing_holds_the_test(self, test_id: str) -> None:
        """No tracked run and no workbench session means the files are free."""
        tracked, sessions = _holders([], [])
        with tracked, sessions:
            testdata_service.assert_not_running(test_id)

    def test_a_tracked_execution_refuses_with_the_running_message(self, test_id: str) -> None:
        """The message names the test, not the id."""
        tracked, sessions = _holders(["exec-1"], [])
        with tracked, sessions, pytest.raises(ConflictException, match=_RUNNING):
            testdata_service.assert_not_running(test_id)

    def test_a_workbench_session_refuses_too(self, test_id: str) -> None:
        """A paused or running workbench session holds the files as well."""
        tracked, sessions = _holders([], ["session-1"])
        with tracked, sessions, pytest.raises(ConflictException, match=_RUNNING):
            testdata_service.assert_not_running(test_id)

    def test_the_details_carry_the_tracked_execution_ids(self, test_id: str) -> None:
        """The 409 body names what is holding the test."""
        tracked, sessions = _holders(["exec-1", "exec-2"], [])
        with tracked, sessions:
            with pytest.raises(ConflictException) as raised:
                testdata_service.assert_not_running(test_id)

        assert raised.value.details is not None
        assert raised.value.details["execution_ids"] == ["exec-1", "exec-2"]

    def test_the_details_carry_the_session_ids_too(self, test_id: str) -> None:
        """Workbench sessions land in the same list."""
        tracked, sessions = _holders([], ["session-1"])
        with tracked, sessions:
            with pytest.raises(ConflictException) as raised:
                testdata_service.assert_not_running(test_id)

        assert raised.value.details is not None
        assert raised.value.details["execution_ids"] == ["session-1"]

    def test_both_sources_are_reported_together(self, test_id: str) -> None:
        """One list holds everything that blocks the change."""
        tracked, sessions = _holders(["exec-1"], ["session-1"])
        with tracked, sessions:
            with pytest.raises(ConflictException) as raised:
                testdata_service.assert_not_running(test_id)

        assert raised.value.details is not None
        assert set(raised.value.details["execution_ids"]) == {"exec-1", "session-1"}

    def test_both_lookups_are_asked_about_the_test(self, test_id: str) -> None:
        """Each source is queried with the test id."""
        with (
            patch.object(
                exec_storage, "get_active_executions_holding_test", return_value=[]
            ) as tracked,
            patch.object(workbench_service, "sessions_running_test", return_value=[]) as sessions,
        ):
            testdata_service.assert_not_running(test_id)

        tracked.assert_called_once_with(test_id)
        sessions.assert_called_once_with(test_id)


@pytest.fixture
def tracked_runs(temp_storage_path: Path) -> Generator[None, None, None]:
    """Start with no tracked execution and leave none in memory."""
    exec_storage._clear_storage()
    yield
    exec_storage._clear_in_memory_cache()


def _track_run(entity_type: str, entity_id: str, carried_test_id: str | None = None) -> None:
    """Record one running execution; a Suite or Regression run also carries a Test."""
    execution_id = f"exec-{entity_type}"
    exec_storage._execution_storage[execution_id] = {
        "id": execution_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "status": "running",
    }
    if carried_test_id is not None:
        exec_storage._record_run_dispatched(execution_id, "run-1", carried_test_id, None)


def _open_session(monkeypatch: pytest.MonkeyPatch, test_id: str, status: str) -> None:
    """Put one workbench session on the test into the session map."""
    session_id = str(uuid.uuid4())
    monkeypatch.setitem(
        workbench_common._workbench_sessions,
        session_id,
        {"session_id": session_id, "test_id": test_id, "status": status},
    )


@pytest.mark.usefixtures("tracked_runs")
class TestIsRunning:
    """The lookup answers what the guard refuses on, and raises nothing (REQ-5.2.4.9.6)."""

    def test_a_tracked_run_of_the_test_counts(self, test_id: str) -> None:
        """A running execution of the Test itself holds it."""
        _track_run("test", test_id)

        assert testdata_service.is_running(test_id) is True

    @pytest.mark.parametrize("entity_type", ["suite", "regression"])
    def test_a_suite_or_regression_run_that_carries_it_counts(
        self, test_id: str, entity_type: str
    ) -> None:
        """A running parent execution that dispatched the Test holds it too."""
        _track_run(entity_type, str(uuid.uuid4()), carried_test_id=test_id)

        assert testdata_service.is_running(test_id) is True

    @pytest.mark.parametrize("status", ["running", "paused"])
    def test_a_workbench_session_that_is_running_or_paused_counts(
        self, test_id: str, status: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A live workbench session on the Test holds it."""
        _open_session(monkeypatch, test_id, status)

        assert testdata_service.is_running(test_id) is True

    def test_a_workbench_session_that_only_has_the_test_open_does_not_count(
        self, test_id: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A session that is neither running nor paused does not hold the Test."""
        _open_session(monkeypatch, test_id, "idle")

        assert testdata_service.is_running(test_id) is False

    def test_an_idle_test_is_not_running(self, test_id: str, other_test_id: str) -> None:
        """Nothing holds the Test, also while another Test is running."""
        _track_run("test", other_test_id)

        assert testdata_service.is_running(test_id) is False


class TestMutatingEntryPointsAreGuarded:
    """Upload, folder create, rename and delete all run the guard."""

    def test_begin_upload_runs_the_guard(self, test_id: str) -> None:
        """A running test refuses new files."""
        with patch.object(testdata_service, "assert_not_running") as guard:
            store(test_id, "a.csv", b"x")

        guard.assert_called_once_with(test_id)

    def test_check_space_runs_the_guard(self, test_id: str) -> None:
        """The pre-check refuses while the test runs, before the client sends anything."""
        with patch.object(testdata_service, "assert_not_running") as guard:
            testdata_service.check_space(test_id, 1, "a.csv")

        guard.assert_called_once_with(test_id)

    def test_create_folder_runs_the_guard(self, test_id: str) -> None:
        """A running test refuses a new folder."""
        with patch.object(testdata_service, "assert_not_running") as guard:
            testdata_service.create_folder(test_id, "fixtures")

        guard.assert_called_once_with(test_id)

    def test_rename_entry_runs_the_guard(self, test_id: str) -> None:
        """A running test refuses a rename."""
        seed_file(test_id, "a.csv", b"x")

        with patch.object(testdata_service, "assert_not_running") as guard:
            testdata_service.rename_entry(test_id, "a.csv", "b.csv")

        guard.assert_called_once_with(test_id)

    def test_delete_entry_runs_the_guard(self, test_id: str) -> None:
        """A running test refuses a delete."""
        seed_file(test_id, "a.csv", b"x")

        with patch.object(testdata_service, "assert_not_running") as guard:
            testdata_service.delete_entry(test_id, "a.csv")

        guard.assert_called_once_with(test_id)

    def test_a_running_test_refuses_an_upload(self, test_id: str) -> None:
        """The refusal reaches the caller unchanged."""
        tracked, sessions = _holders(["exec-1"], [])
        with tracked, sessions, pytest.raises(ConflictException, match=_RUNNING):
            store(test_id, "a.csv", b"x")

    def test_a_running_test_refuses_a_delete(self, test_id: str) -> None:
        """Nothing is removed while the test runs."""
        seed_file(test_id, "a.csv", b"x")

        tracked, sessions = _holders([], ["session-1"])
        with tracked, sessions, pytest.raises(ConflictException, match=_RUNNING):
            testdata_service.delete_entry(test_id, "a.csv")


class TestReadsAreNeverBlocked:
    """A running test can still be inspected and downloaded."""

    def test_list_entries_does_not_run_the_guard(self, test_id: str) -> None:
        """Listing is a read."""
        seed_file(test_id, "a.csv", b"x")

        with patch.object(testdata_service, "assert_not_running") as guard:
            testdata_service.list_entries(test_id)

        guard.assert_not_called()

    def test_resolve_entry_does_not_run_the_guard(self, test_id: str) -> None:
        """Resolution is a read."""
        seed_file(test_id, "a.csv", b"x")

        with patch.object(testdata_service, "assert_not_running") as guard:
            testdata_service.resolve_entry(test_id, "a.csv")

        guard.assert_not_called()

    def test_content_path_does_not_run_the_guard(self, test_id: str) -> None:
        """Downloading a file is a read."""
        seed_file(test_id, "a.csv", b"x")

        with patch.object(testdata_service, "assert_not_running") as guard:
            testdata_service.content_path(test_id, "a.csv")

        guard.assert_not_called()

    def test_zip_entry_does_not_run_the_guard(self, test_id: str) -> None:
        """Downloading the folder is a read."""
        seed_file(test_id, "a.csv", b"x")

        with patch.object(testdata_service, "assert_not_running") as guard:
            testdata_service.zip_entry(test_id, "", io.BytesIO())

        guard.assert_not_called()

    def test_iter_files_does_not_run_the_guard(self, test_id: str) -> None:
        """Export and backup read a running test's files."""
        seed_file(test_id, "a.csv", b"x")

        with patch.object(testdata_service, "assert_not_running") as guard:
            list(testdata_service.iter_files(test_id))

        guard.assert_not_called()

    def test_a_running_test_can_still_be_listed(self, test_id: str) -> None:
        """The listing answers normally while the test runs."""
        seed_file(test_id, "a.csv", b"x")

        tracked, sessions = _holders(["exec-1"], ["session-1"])
        with tracked, sessions:
            result = testdata_service.list_entries(test_id)

        assert [entry["path"] for entry in result["entries"]] == ["a.csv"]
