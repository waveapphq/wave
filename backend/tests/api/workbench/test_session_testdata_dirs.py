"""Unit tests for the session's testdata_dirs key and the running-session lookup.

Every session that runs a test carries the test's own test data folder; a
standalone Function session carries none. ``sessions_running_test`` is the
workbench half of the running-test guard.
"""

import uuid
from pathlib import Path
from typing import Any

from tests.api.workbench.conftest import make_test_record
from wavecore.api.services import storage_paths
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench._common import DEFAULT_USER_ID


def _function_node(node_id: str = "fn-1") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": {"nodes": [], "edges": []},
            "displayName": "Fn",
            "label": "Fn",
        },
    }


def _seed_session(test_id: str, status: str) -> str:
    session_id = str(uuid.uuid4())
    wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "test_id": test_id,
        "status": status,
        "user_id": DEFAULT_USER_ID,
        "variables": {},
        "block_states": {},
    }
    return session_id


class TestSessionTestDataDirs:
    """The session dict carries the test's own test data folder."""

    def test_run_session_carries_the_tests_folder(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        test_id = str(uuid.uuid4())
        workbench_run_mocks["test"] = make_test_record(test_id)

        result = workbench_service.start_workbench_run(
            test_id=test_id, environment_id=str(uuid.uuid4())
        )

        session = wb_common._workbench_sessions[result["session_id"]]
        assert session["testdata_dirs"] == [str(storage_paths.get_test_testdata_path(test_id))]

    def test_child_session_carries_its_own_test_id(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        test_id = str(uuid.uuid4())
        workbench_run_mocks["test"] = make_test_record(test_id)

        result = workbench_service.start_workbench_run(
            test_id=test_id,
            environment_id=str(uuid.uuid4()),
            lineage=workbench_service.RunLineage(parent_execution_id=str(uuid.uuid4())),
        )

        session = wb_common._workbench_sessions[result["session_id"]]
        assert session["testdata_dirs"] == [str(storage_paths.get_test_testdata_path(test_id))]

    def test_the_folder_path_sits_under_the_testdata_zone(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        test_id = str(uuid.uuid4())
        workbench_run_mocks["test"] = make_test_record(test_id)

        result = workbench_service.start_workbench_run(
            test_id=test_id, environment_id=str(uuid.uuid4())
        )

        session = wb_common._workbench_sessions[result["session_id"]]
        assert Path(session["testdata_dirs"][0]).name == test_id
        assert Path(session["testdata_dirs"][0]).parent.name == "testdata"

    def test_scoped_function_session_carries_the_parent_tests_folder(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        test_id = str(uuid.uuid4())
        record = make_test_record(test_id)
        record["workflow"]["nodes"].append(_function_node())
        workbench_run_mocks["test"] = record

        result = workbench_service.start_workbench_run(
            test_id=test_id,
            environment_id=str(uuid.uuid4()),
            scope=workbench_service.ScopedRunOptions(mode="function", function_node_id="fn-1"),
        )

        session = wb_common._workbench_sessions[result["session_id"]]
        assert session["testdata_dirs"] == [str(storage_paths.get_test_testdata_path(test_id))]

    def test_standalone_function_session_carries_no_folder(
        self, workbench_run_mocks: dict[str, Any]
    ) -> None:
        result = workbench_service.start_standalone_function_run(
            function_def={"nodes": [], "edges": []},
            function_name="Fn",
            function_id=str(uuid.uuid4()),
            environment_id=str(uuid.uuid4()),
        )

        session = wb_common._workbench_sessions[result["session_id"]]
        assert session["testdata_dirs"] == []


class TestSessionsRunningTest:
    """sessions_running_test reports the sessions that hold a test."""

    def test_running_session_is_reported(self) -> None:
        test_id = str(uuid.uuid4())
        session_id = _seed_session(test_id, "running")

        assert workbench_service.sessions_running_test(test_id) == [session_id]

    def test_paused_session_is_reported(self) -> None:
        test_id = str(uuid.uuid4())
        session_id = _seed_session(test_id, "paused")

        assert workbench_service.sessions_running_test(test_id) == [session_id]

    def test_terminal_sessions_are_ignored(self) -> None:
        test_id = str(uuid.uuid4())
        for status in ("idle", "passed", "failed", "stopped", "skipped"):
            _seed_session(test_id, status)

        assert workbench_service.sessions_running_test(test_id) == []

    def test_sessions_of_another_test_are_ignored(self) -> None:
        test_id = str(uuid.uuid4())
        _seed_session(str(uuid.uuid4()), "running")

        assert workbench_service.sessions_running_test(test_id) == []

    def test_no_sessions_at_all(self) -> None:
        assert workbench_service.sessions_running_test(str(uuid.uuid4())) == []

    def test_several_live_sessions_are_all_reported(self) -> None:
        test_id = str(uuid.uuid4())
        first = _seed_session(test_id, "running")
        second = _seed_session(test_id, "paused")

        assert set(workbench_service.sessions_running_test(test_id)) == {first, second}
