"""Assistant-held runs: borrow the workbench slot for the run.

Covers: only TEST-type executions claim and mirror; a take-over against an
assistant run-holder grants immediately; and the synchronous active-session
guard, so the conflict lands in the tool reply instead of a background launch
failure.
"""

from typing import Any
from unittest.mock import patch

import pytest

from tests.mcp.conftest import create_test_entity
from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import ownership

TEST_ENVIRONMENT_ID = "env-test-00000000-0000-0000-0000-000000000001"

ACTIVE_SESSION_MESSAGE = (
    r"^User already has an active (workbench|tracked execution) session: .+\. "
    r"Stop the current workbench or tracked execution before starting a new one\.$"
)

RUN_STATE: dict[str, Any] = {
    "session_id": "sess-1",
    "test_id": "test-1",
    "test_name": "Nightly Smoke",
    "environment_id": "env-1",
    "environment_name": "Staging",
    "status": "running",
}


@pytest.fixture(autouse=True)
def _run_isolation(
    seed_registries: None,
    clear_execution_state: None,
    mock_workbench_start: Any,
    mock_sequential_start: Any,
) -> Any:
    """Registries seeded, executions isolated, engine and driver inert, slot free."""
    ownership.clear()
    with patch.object(ownership, "_emit"):
        yield
    ownership.clear()


def _register_client(session_id: str = "mcp-sess-1", client: str = "claude-code") -> str:
    from wavecore.mcp import state as mcp_state

    mcp_state.register_session(session_id, client, "1.0.0", "127.0.0.1")
    return session_id


def _seed_active_workbench_session(*, tracked: bool = False) -> str:
    session_id = "live-session-1"
    wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "status": "running",
        "execution_id": session_id if tracked else None,
    }
    wb_common._user_active_session[wb_common.DEFAULT_USER_ID] = session_id
    return session_id


def _stored_executions() -> dict[str, Any]:
    from wavecore.api.services.executions import _storage as exec_storage

    return exec_storage._execution_storage


class TestTestRunBorrowsTheSession:
    """A TEST execution the assistant starts holds the slot for the run."""

    def test_claims_the_slot_as_the_mcp_holder(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        session_id = _register_client()
        test = create_test_entity("Mirrored Run")

        run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=session_id,
        )

        assert ownership.get_holder() == {
            "id": session_id,
            "label": "claude-code (MCP)",
            "kind": "mcp",
        }

    def test_reports_the_run_as_mirrored(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Mirrored Flag")

        result = run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=_register_client(),
        )

        assert result["mirrored"] is True

    def test_keeps_returning_the_execution_id_and_status(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Mirrored Payload")

        result = run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=_register_client(),
        )

        assert {"execution_id", "status", "mirrored"} == set(result.keys())
        assert result["status"] == "running"

    def test_without_a_session_id_holds_under_the_default_id(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Default Holder Run")

        run_tools.start_execution("test", test["id"], TEST_ENVIRONMENT_ID)

        assert ownership.get_holder() == {"id": "mcp", "label": "client (MCP)", "kind": "mcp"}

    def test_auto_yields_a_clean_idle_person_holder(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        ownership.claim("h1", "Holder One")
        test = create_test_entity("Auto Yield Run")

        result = run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=_register_client(),
        )

        assert result["mirrored"] is True
        assert ownership.get_holder()["kind"] == "mcp"


class TestLaunchFailureReleasesTheSlot:
    """A launch that dies after a successful claim must not leak the borrow."""

    def test_release_on_launch_failure(self) -> None:
        from wavecore.api.services.executions import service as execution_service
        from wavecore.mcp.tools import run as run_tools

        session_id = _register_client()
        test = create_test_entity("Doomed Run")

        with (
            patch.object(execution_service, "start_execution", side_effect=RuntimeError("boom")),
            pytest.raises(RuntimeError, match=r"^boom$"),
        ):
            run_tools.start_execution(
                "test",
                test["id"],
                TEST_ENVIRONMENT_ID,
                client_name="claude-code",
                session_id=session_id,
            )

        assert ownership.get_holder() is None


class TestClaimConflictStillRuns:
    """A refused claim never blocks the run; it only loses the mirror."""

    def test_run_starts_unmirrored_when_the_slot_is_held(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        ownership.claim("h1", "Holder One")
        ownership.set_holder_dirty("h1", True)
        test = create_test_entity("Unmirrored Run")

        result = run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=_register_client(),
        )

        assert result["mirrored"] is False
        assert result["status"] == "running"
        assert result["execution_id"] in _stored_executions()

    def test_the_dirty_holder_keeps_the_slot(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        ownership.claim("h1", "Holder One")
        ownership.set_holder_dirty("h1", True)
        test = create_test_entity("Holder Kept")

        run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=_register_client(),
        )

        assert ownership.get_holder() == {"id": "h1", "label": "Holder One", "kind": "person"}


class TestSuiteAndRegressionNeverMirror:
    """Only the workbench-shaped TEST run occupies the surface."""

    def test_suite_run_does_not_claim(self) -> None:
        from wavecore.api.services.suites import _storage as suite_storage
        from wavecore.api.services.suites import service as suite_service
        from wavecore.mcp.tools import run as run_tools

        suite_storage._clear_storage()
        test = create_test_entity("Suite Member")
        suite_service.create_suite({"name": "Mirror Suite", "tests": [test["id"]]})

        result = run_tools.start_execution(
            "suite",
            "Mirror Suite",
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=_register_client(),
        )

        assert result["mirrored"] is False
        assert ownership.get_holder() is None

    def test_regression_run_does_not_claim(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import _storage as suite_storage
        from wavecore.api.services.suites import service as suite_service
        from wavecore.mcp.tools import run as run_tools

        suite_storage._clear_storage()
        test = create_test_entity("Regression Member")
        suite = suite_service.create_suite({"name": "Reg Suite", "tests": [test["id"]]})
        regression_service.create_regression({"name": "Mirror Regression", "suites": [suite["id"]]})

        result = run_tools.start_execution(
            "regression",
            "Mirror Regression",
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=_register_client(),
        )

        assert result["mirrored"] is False
        assert ownership.get_holder() is None


class TestTerminalReleasesTheSlot:
    """The run's terminal state hands the surface back."""

    def _start(self) -> str:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Terminal Run")
        result = run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=_register_client(),
        )
        return str(result["execution_id"])

    def test_terminal_releases_the_holder(self) -> None:
        execution_id = self._start()

        wb_common._notify_terminal(execution_id, "passed")

        assert ownership.get_holder() is None

    def test_a_failed_run_releases_too(self) -> None:
        execution_id = self._start()

        wb_common._notify_terminal(execution_id, "failed")

        assert ownership.get_holder() is None

    def test_another_sessions_terminal_keeps_the_holder(self) -> None:
        self._start()

        wb_common._notify_terminal("some-other-session", "passed")

        assert ownership.get_holder() is not None

    def test_a_stale_terminal_does_not_release_a_later_holder(self) -> None:
        execution_id = self._start()
        wb_common._notify_terminal(execution_id, "passed")
        ownership.claim("h1", "Holder One")

        wb_common._notify_terminal(execution_id, "passed")

        assert ownership.get_holder() == {"id": "h1", "label": "Holder One", "kind": "person"}


class TestActiveSessionGuard:
    """The conflict is raised before anything is persisted."""

    def test_test_run_raises_the_service_message(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        _seed_active_workbench_session()
        test = create_test_entity("Guarded Run")

        with pytest.raises(ConflictException, match=ACTIVE_SESSION_MESSAGE):
            run_tools.start_execution(
                "test", test["id"], TEST_ENVIRONMENT_ID, client_name="claude-code"
            )

    def test_tracked_session_wording_is_preserved(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        session_id = _seed_active_workbench_session(tracked=True)
        test = create_test_entity("Guarded Tracked Run")

        with pytest.raises(ConflictException) as exc_info:
            run_tools.start_execution(
                "test", test["id"], TEST_ENVIRONMENT_ID, client_name="claude-code"
            )

        assert exc_info.value.message == (
            f"User already has an active tracked execution session: {session_id}. "
            "Stop the current workbench or tracked execution before starting a new one."
        )

    def test_guard_persists_no_execution_record(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        _seed_active_workbench_session()
        test = create_test_entity("Guarded No Record")
        before = set(_stored_executions())

        with pytest.raises(ConflictException):
            run_tools.start_execution(
                "test", test["id"], TEST_ENVIRONMENT_ID, client_name="claude-code"
            )

        assert set(_stored_executions()) == before

    def test_guard_leaves_the_slot_untouched(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        _seed_active_workbench_session()
        test = create_test_entity("Guarded No Claim")

        with pytest.raises(ConflictException):
            run_tools.start_execution(
                "test", test["id"], TEST_ENVIRONMENT_ID, client_name="claude-code"
            )

        assert ownership.get_holder() is None

    def test_suite_run_is_guarded_too(self) -> None:
        from wavecore.api.services.suites import _storage as suite_storage
        from wavecore.api.services.suites import service as suite_service
        from wavecore.mcp.tools import run as run_tools

        suite_storage._clear_storage()
        test = create_test_entity("Guarded Suite Member")
        suite_service.create_suite({"name": "Guarded Suite", "tests": [test["id"]]})
        _seed_active_workbench_session()

        with pytest.raises(ConflictException, match=ACTIVE_SESSION_MESSAGE):
            run_tools.start_execution(
                "suite", "Guarded Suite", TEST_ENVIRONMENT_ID, client_name="claude-code"
            )

    def test_terminal_session_does_not_trip_the_guard(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        session_id = _seed_active_workbench_session()
        wb_common._workbench_sessions[session_id]["status"] = "passed"
        test = create_test_entity("Ungated Run")

        result = run_tools.start_execution(
            "test", test["id"], TEST_ENVIRONMENT_ID, client_name="claude-code"
        )

        assert result["status"] == "running"


class TestTakeoverAgainstARunHolder:
    """A run has no atomic step to finish, so the request grants at once."""

    def test_request_against_an_assistant_run_holder_grants_immediately(self) -> None:
        ownership.claim("s1", "claude-code (MCP)", "mcp")
        ownership.set_run_state(RUN_STATE)

        result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "granted"
        assert ownership.get_holder() == {"id": "r1", "label": "Requester One", "kind": "person"}
        assert ownership._pending_takeover is None

    def test_an_assistant_build_holder_still_awaits_release(self) -> None:
        ownership.claim("s1", "claude-code (MCP)", "mcp")

        result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "awaiting_release"
        assert ownership.get_holder()["id"] == "s1"

    def test_a_build_holder_awaits_release_while_a_past_holder_run_is_announced(self) -> None:
        """Only the holder's OWN run grants at once; another session's run does not."""
        ownership.claim("h1", "Holder One")
        ownership.set_run_state(RUN_STATE)
        ownership.release("h1")
        ownership.claim("s1", "claude-code (MCP)", "mcp")

        result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "awaiting_release"
        assert ownership.get_holder()["id"] == "s1"
        assert ownership._pending_takeover == {
            "requester_id": "r1",
            "requester_label": "Requester One",
        }

    def test_a_reused_assistant_id_does_not_inherit_a_past_run_announcement(self) -> None:
        """Assistant ids repeat, so identity alone must not match a stale announcement."""
        ownership.claim("mcp", "claude-code (MCP)", "mcp")
        ownership.set_run_state(RUN_STATE)
        ownership.release("mcp")
        ownership.claim("mcp", "claude-code (MCP)", "mcp")

        result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "awaiting_release"
        assert ownership.get_holder()["id"] == "mcp"
        assert ownership._pending_takeover == {
            "requester_id": "r1",
            "requester_label": "Requester One",
        }

    def test_a_distinct_assistant_id_does_not_inherit_a_past_run_announcement(self) -> None:
        """The paired probe: a fresh id must behave exactly like the reused one above."""
        ownership.claim("s1", "claude-code (MCP)", "mcp")
        ownership.set_run_state(RUN_STATE)
        ownership.release("s1")
        ownership.claim("s2", "claude-code (MCP)", "mcp")

        result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "awaiting_release"
        assert ownership.get_holder()["id"] == "s2"
        assert ownership._pending_takeover == {
            "requester_id": "r1",
            "requester_label": "Requester One",
        }

    def test_a_run_announced_with_no_holder_does_not_grant_at_once(self) -> None:
        ownership.set_run_state(RUN_STATE)
        ownership.claim("s1", "claude-code (MCP)", "mcp")

        result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "awaiting_release"
        assert ownership.get_holder()["id"] == "s1"

    def test_a_person_run_holder_still_awaits_approval(self) -> None:
        ownership.claim("h1", "Holder One")
        ownership.set_run_state(RUN_STATE)

        result = ownership.request_takeover("r1", "Requester One")

        assert result["outcome"] == "awaiting_approval"
        assert ownership.get_holder()["id"] == "h1"

    def test_the_tracked_run_record_is_unaffected_by_the_take_over(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Take Over Run")
        started = run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            client_name="claude-code",
            session_id=_register_client(),
        )
        ownership.set_run_state({**RUN_STATE, "session_id": started["execution_id"]})

        ownership.request_takeover("r1", "Requester One")

        assert _stored_executions()[started["execution_id"]]["status"] == "running"
