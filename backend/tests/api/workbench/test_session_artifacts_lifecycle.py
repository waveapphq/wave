"""Unit tests for the workbench session artifact lifecycle.

Session creation computes the session's ``artifacts_dir``:
tracked sessions resolve to the execution's artifact directory, sequential
children to the parent execution's directory, and ephemeral sessions to a
temporary ``{root}/sessions/{session_id}`` dir. The dir follows the session
state semantics: it transfers on run-without-reset inheritance, is wiped on
reset/replacement/clear, and all ``sessions/*`` are swept at startup.
"""

import uuid
from pathlib import Path
from typing import Any

from tests.api.workbench.conftest import make_test_record, seed_tracked_execution
from wavecore.api.services import artifact_service
from wavecore.api.services.executions import _storage as exec_storage
from wavecore.api.services.storage_paths import get_artifacts_storage_path
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench._common import DEFAULT_USER_ID


def _sessions_root() -> Path:
    return get_artifacts_storage_path() / "sessions"


def _start_run(holder: dict[str, Any], test_id: str, **kwargs: Any) -> dict[str, Any]:
    holder["test"] = make_test_record(test_id)
    return workbench_service.start_workbench_run(
        test_id=test_id,
        environment_id=str(uuid.uuid4()),
        **kwargs,
    )


def _prime_terminal_session(
    test_id: str,
    *,
    status: str = "passed",
    with_file: str | None = "carry.txt",
) -> tuple[str, Path]:
    """Register a previous terminal session owning a sessions/{id} dir."""
    session_id = str(uuid.uuid4())
    session_dir = _sessions_root() / session_id
    session_dir.mkdir(parents=True)
    if with_file is not None:
        (session_dir / with_file).write_text("carried")
    wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "test_id": test_id,
        "status": status,
        "user_id": DEFAULT_USER_ID,
        "started_at": "2026-06-09T00:00:00+00:00",
        "variables": {},
        "block_states": {},
        "artifacts_dir": str(session_dir),
    }
    wb_common._user_active_session[DEFAULT_USER_ID] = session_id
    return session_id, session_dir


class TestSessionArtifactsDirComputation:
    """artifacts_dir is computed at every session creation site."""

    def test_ephemeral_session_gets_sessions_dir(self, workbench_run_mocks: dict[str, Any]) -> None:
        result = _start_run(workbench_run_mocks, str(uuid.uuid4()))

        session_id = result["session_id"]
        session = wb_common._workbench_sessions[session_id]
        expected = _sessions_root() / session_id
        assert Path(session["artifacts_dir"]) == expected
        assert expected.is_dir()

    def test_tracked_session_uses_execution_artifact_dir(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        execution_id = str(uuid.uuid4())
        artifact_dir = f"20260609-120000-{execution_id}"
        execution_dir = get_artifacts_storage_path() / artifact_dir
        execution_dir.mkdir(parents=True)
        seed_tracked_execution(execution_id, artifact_dir)

        result = _start_run(
            workbench_run_mocks,
            str(uuid.uuid4()),
            session_id=execution_id,
            lineage=workbench_service.RunLineage(execution_id=execution_id),
        )

        session = wb_common._workbench_sessions[result["session_id"]]
        assert Path(session["artifacts_dir"]) == execution_dir
        assert not (_sessions_root() / execution_id).exists()

    def test_child_session_uses_parent_execution_artifact_dir(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        parent_execution_id = str(uuid.uuid4())
        artifact_dir = f"20260609-130000-{parent_execution_id}"
        parent_dir = get_artifacts_storage_path() / artifact_dir
        parent_dir.mkdir(parents=True)
        seed_tracked_execution(parent_execution_id, artifact_dir)

        result = _start_run(
            workbench_run_mocks,
            str(uuid.uuid4()),
            lineage=workbench_service.RunLineage(parent_execution_id=parent_execution_id),
        )

        session = wb_common._workbench_sessions[result["session_id"]]
        assert Path(session["artifacts_dir"]) == parent_dir
        assert not (_sessions_root() / result["session_id"]).exists()

    def test_tracked_session_without_artifact_dir_record_gets_none(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        """Records lacking artifact_dir resolve to no artifacts dir (no sessions dir either)."""
        execution_id = str(uuid.uuid4())
        exec_storage._execution_storage[execution_id] = {
            "id": execution_id,
            "status": "running",
            "entity_type": "test",
            "entity_id": str(uuid.uuid4()),
        }

        result = _start_run(
            workbench_run_mocks,
            str(uuid.uuid4()),
            session_id=execution_id,
            lineage=workbench_service.RunLineage(execution_id=execution_id),
        )

        session = wb_common._workbench_sessions[result["session_id"]]
        assert session["artifacts_dir"] is None
        assert not (_sessions_root() / execution_id).exists()

    def test_standalone_function_session_gets_sessions_dir(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        result = workbench_service.start_standalone_function_run(
            function_def={"nodes": [], "edges": []},
            function_name="Fn",
            function_id=str(uuid.uuid4()),
            environment_id=str(uuid.uuid4()),
        )

        session_id = result["session_id"]
        session = wb_common._workbench_sessions[session_id]
        expected = _sessions_root() / session_id
        assert Path(session["artifacts_dir"]) == expected
        assert expected.is_dir()


class TestRunWithoutResetInheritance:
    """The dir transfers with the inherited state on ad-hoc runs."""

    def test_adhoc_run_transfers_previous_session_dir(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        test_id = str(uuid.uuid4())
        _old_session_id, old_dir = _prime_terminal_session(test_id)

        result = _start_run(
            workbench_run_mocks,
            test_id,
            target=workbench_service.RunTarget(start_node_id="node-log"),
        )

        new_session_id = result["session_id"]
        new_dir = _sessions_root() / new_session_id
        session = wb_common._workbench_sessions[new_session_id]
        assert Path(session["artifacts_dir"]) == new_dir
        assert (new_dir / "carry.txt").read_text() == "carried"
        assert not old_dir.exists()

    def test_normal_run_does_not_inherit_and_wipes_previous_dir(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        test_id = str(uuid.uuid4())
        _old_session_id, old_dir = _prime_terminal_session(test_id)

        result = _start_run(workbench_run_mocks, test_id)

        new_dir = _sessions_root() / result["session_id"]
        assert not old_dir.exists()
        assert new_dir.is_dir()
        assert not (new_dir / "carry.txt").exists()


class TestSessionArtifactWipe:
    """Reset/clear paths wipe the ephemeral session dir."""

    def test_clear_session_for_user_wipes_session_dir(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        result = _start_run(workbench_run_mocks, str(uuid.uuid4()))
        session_dir = _sessions_root() / result["session_id"]
        (session_dir / "produced.txt").write_text("data")

        cleared = workbench_service.clear_session_for_user()

        assert cleared == {"cleared": True}
        assert not session_dir.exists()

    def test_clear_session_for_user_preserves_tracked_execution_dir(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        execution_id = str(uuid.uuid4())
        artifact_dir = f"20260609-140000-{execution_id}"
        execution_dir = get_artifacts_storage_path() / artifact_dir
        execution_dir.mkdir(parents=True)
        seed_tracked_execution(execution_id, artifact_dir)
        _start_run(
            workbench_run_mocks,
            str(uuid.uuid4()),
            session_id=execution_id,
            lineage=workbench_service.RunLineage(execution_id=execution_id),
        )
        (execution_dir / "tracked.txt").write_text("keep")

        workbench_service.clear_session_for_user()

        assert (execution_dir / "tracked.txt").exists()

    def test_clear_sessions_sync_wipes_ephemeral_session_dirs(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        result = _start_run(workbench_run_mocks, str(uuid.uuid4()))
        first_dir = _sessions_root() / result["session_id"]

        second_session_id = str(uuid.uuid4())
        second_dir = _sessions_root() / second_session_id
        second_dir.mkdir(parents=True)
        wb_common._workbench_sessions[second_session_id] = {
            "session_id": second_session_id,
            "test_id": str(uuid.uuid4()),
            "status": "passed",
            "user_id": "other-user",
            "variables": {},
            "block_states": {},
            "artifacts_dir": str(second_dir),
        }

        wb_common._clear_sessions_sync()

        assert not first_dir.exists()
        assert not second_dir.exists()


class TestListSessionArtifactsWithoutADir:
    """A session that never got an artifacts dir lists nothing rather than failing."""

    def test_a_session_without_an_artifacts_dir_lists_no_items(self) -> None:
        session_id, _dir = _prime_terminal_session(str(uuid.uuid4()))
        wb_common._workbench_sessions[session_id]["artifacts_dir"] = None

        assert workbench_service.list_session_artifacts() == {"items": []}


class TestSessionArtifactServiceHelpers:
    """artifact_service session helpers."""

    def test_session_artifacts_dir_is_under_sessions_root(self) -> None:
        session_id = str(uuid.uuid4())

        result = artifact_service.session_artifacts_dir(session_id)

        assert result == _sessions_root() / session_id

    def test_wipe_session_artifacts_removes_dir(self) -> None:
        session_id = str(uuid.uuid4())
        session_dir = _sessions_root() / session_id
        session_dir.mkdir(parents=True)
        (session_dir / "file.txt").write_text("x")

        artifact_service.wipe_session_artifacts(session_id)

        assert not session_dir.exists()

    def test_wipe_session_artifacts_is_noop_for_missing_dir(self) -> None:
        artifact_service.wipe_session_artifacts(str(uuid.uuid4()))

    def test_sweep_removes_all_session_dirs_at_startup(self) -> None:
        for _ in range(2):
            session_dir = _sessions_root() / str(uuid.uuid4())
            session_dir.mkdir(parents=True)
            (session_dir / "leftover.txt").write_text("x")
        execution_dir = get_artifacts_storage_path() / f"20260609-150000-{uuid.uuid4()}"
        execution_dir.mkdir(parents=True)
        (execution_dir / "kept.txt").write_text("x")

        artifact_service.sweep_session_artifacts()

        sessions_root = _sessions_root()
        assert not sessions_root.exists() or list(sessions_root.iterdir()) == []
        assert (execution_dir / "kept.txt").exists()

    def test_sweep_is_noop_when_sessions_area_missing(self) -> None:
        artifact_service.sweep_session_artifacts()
