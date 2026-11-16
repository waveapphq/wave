"""Run tools contract + executions attribution.

Ref/environment/profile resolution (id first, then unique name), the
triggered_by="mcp:<client>" attribution with sanitization and fallback, and
the enriched get_execution detail. Also pins the extension of the
executions service (optional triggered_by, default unchanged for existing
callers). The workbench engine and sequential driver are mocked; real
end-to-end runs are the integration test's job.
"""

from types import SimpleNamespace
from typing import Any

import pytest

from tests.mcp.conftest import create_test_entity, make_minimal_execution, write_raw_test
from wavecore.api.exceptions import NotFoundException, ValidationException

TEST_ENVIRONMENT_ID = "env-test-00000000-0000-0000-0000-000000000001"
TEST_ENVIRONMENT_NAME = "Test Environment"


@pytest.fixture(autouse=True)
def _run_isolation(
    seed_registries: None,
    clear_execution_state: None,
    mock_workbench_start: Any,
    mock_sequential_start: Any,
) -> None:
    """Registries seeded, executions isolated, engine and driver inert."""


def _stored_execution(execution_id: str) -> dict[str, Any]:
    from wavecore.api.services.executions import _storage as exec_storage

    return exec_storage._execution_storage[execution_id]


class TestExecutionsServiceAttributionExtension:
    def test_default_stays_dev_for_existing_callers(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        test = create_test_entity("Attribution Default")
        execution = execution_service.start_execution("test", test["id"], TEST_ENVIRONMENT_ID)

        assert execution["triggered_by"] == "dev"

    def test_explicit_triggered_by_is_recorded(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        test = create_test_entity("Attribution Explicit")
        execution = execution_service.start_execution(
            "test", test["id"], TEST_ENVIRONMENT_ID, triggered_by="mcp:claude-code"
        )

        assert execution["triggered_by"] == "mcp:claude-code"

    def test_triggered_by_none_resolves_to_default(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        test = create_test_entity("Attribution None")
        execution = execution_service.start_execution(
            "test", test["id"], TEST_ENVIRONMENT_ID, triggered_by=None
        )

        assert execution["triggered_by"] == "dev"

    def test_triggered_by_is_persisted(self) -> None:
        from wavecore.api.services.executions import _storage as exec_storage
        from wavecore.api.services.executions import service as execution_service

        test = create_test_entity("Attribution Persisted")
        execution = execution_service.start_execution(
            "test", test["id"], TEST_ENVIRONMENT_ID, triggered_by="mcp:claude-code"
        )

        on_disk = exec_storage._load_execution(execution["id"])
        assert on_disk is not None
        assert on_disk["triggered_by"] == "mcp:claude-code"


class TestStartExecution:
    def test_returns_execution_id_and_initial_status(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Run Me")

        result = run_tools.start_execution(
            "test", test["id"], TEST_ENVIRONMENT_ID, client_name="claude-code"
        )

        assert {"execution_id", "status"}.issubset(result.keys())
        assert result["status"] == "running"
        assert _stored_execution(result["execution_id"])["entity_id"] == test["id"]

    def test_resolves_test_and_environment_by_unique_name(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Named Run")

        result = run_tools.start_execution(
            "test", "Named Run", TEST_ENVIRONMENT_NAME, client_name="claude-code"
        )

        execution = _stored_execution(result["execution_id"])
        assert execution["entity_id"] == test["id"]
        assert execution["environment_id"] == TEST_ENVIRONMENT_ID

    def test_attribution_carries_the_client_name(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Attributed Run")

        result = run_tools.start_execution(
            "test", test["id"], TEST_ENVIRONMENT_ID, client_name="claude-code"
        )

        assert _stored_execution(result["execution_id"])["triggered_by"] == "mcp:claude-code"

    def test_attribution_sanitizes_invalid_characters(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Sanitized Run")

        result = run_tools.start_execution(
            "test", test["id"], TEST_ENVIRONMENT_ID, client_name="Claude Code"
        )

        assert _stored_execution(result["execution_id"])["triggered_by"] == "mcp:Claude-Code"

    def test_attribution_truncates_to_40_characters(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Long Name Run")

        result = run_tools.start_execution(
            "test", test["id"], TEST_ENVIRONMENT_ID, client_name="x" * 50
        )

        assert _stored_execution(result["execution_id"])["triggered_by"] == "mcp:" + "x" * 40

    def test_attribution_falls_back_without_client_info(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Fallback Run")

        result = run_tools.start_execution("test", test["id"], TEST_ENVIRONMENT_ID)

        assert _stored_execution(result["execution_id"])["triggered_by"] == "mcp:client"

    def test_variables_are_passed_through(self) -> None:
        from wavecore.api.services.executions import service as execution_service
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Vars Run")

        result = run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            variables={"region": "emea"},
            client_name="claude-code",
        )

        assert execution_service.get_execution_variables(result["execution_id"]) == {
            "region": "emea"
        }

    def test_profile_resolves_by_name(self) -> None:
        from wavecore.api.services.profiles import _common as profile_common
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.mcp.tools import run as run_tools

        profile_common._clear_in_memory_cache()
        profile = profile_service.create_profile(
            name="mcp-run-profile", profile_type="custom", config={}
        )
        test = create_test_entity("Profile Run")

        result = run_tools.start_execution(
            "test",
            test["id"],
            TEST_ENVIRONMENT_ID,
            profile="mcp-run-profile",
            client_name="claude-code",
        )

        assert _stored_execution(result["execution_id"])["profile_id"] == profile["id"]

    def test_suite_run_starts(self) -> None:
        from wavecore.api.services.suites import _storage as suite_storage
        from wavecore.api.services.suites import service as suite_service
        from wavecore.mcp.tools import run as run_tools

        suite_storage._clear_storage()
        test = create_test_entity("Suite Member")
        suite = suite_service.create_suite({"name": "MCP Run Suite", "tests": [test["id"]]})

        result = run_tools.start_execution(
            "suite", "MCP Run Suite", TEST_ENVIRONMENT_ID, client_name="claude-code"
        )

        execution = _stored_execution(result["execution_id"])
        assert execution["entity_type"] == "suite"
        assert execution["entity_id"] == suite["id"]


class TestStartExecutionResolutionErrors:
    def test_unknown_entity_type_names_the_valid_vocabulary(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.mcp.tools import run as run_tools

        with pytest.raises(
            ValidationException,
            match=r"^Invalid entity_type 'workflow': valid types are test, suite, regression$",
        ):
            run_tools.start_execution("workflow", "demo", TEST_ENVIRONMENT_ID)

    def test_unknown_test_ref(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        with pytest.raises(NotFoundException, match=r"^Test 'ghost' not found$"):
            run_tools.start_execution("test", "ghost", TEST_ENVIRONMENT_ID)

    def test_ambiguous_test_name(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        write_raw_test("dup")
        write_raw_test("dup")

        with pytest.raises(ValidationException, match=r"^Multiple tests named 'dup'; use the id$"):
            run_tools.start_execution("test", "dup", TEST_ENVIRONMENT_ID)

    def test_unknown_environment_ref(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Env Missing Run")

        with pytest.raises(NotFoundException, match=r"^Environment 'nowhere' not found$"):
            run_tools.start_execution("test", test["id"], "nowhere")

    def test_unknown_profile_ref(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Profile Missing Run")

        with pytest.raises(NotFoundException, match=r"^Profile 'nope' not found$"):
            run_tools.start_execution("test", test["id"], TEST_ENVIRONMENT_ID, profile="nope")

    def test_unknown_suite_ref(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        with pytest.raises(NotFoundException, match=r"^Suite 'ghost' not found$"):
            run_tools.start_execution("suite", "ghost", TEST_ENVIRONMENT_ID)


class TestRefusedStartLeavesNoExecution:
    """A start the run checks refuse leaves no execution of the test behind."""

    @pytest.fixture
    def mock_workbench_start(self) -> None:
        """The real engine: its run-start checks do the refusing."""

    def test_undeclared_override_writes_no_execution_and_the_test_deletes(self) -> None:
        from wavecore.api.services.executions import _storage as exec_storage
        from wavecore.api.services.storage_paths import get_artifacts_storage_path
        from wavecore.api.services.tests import service as test_service
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity(
            "Refused Override", variables={"tier": {"type": "integer", "value": 1}}
        )

        with pytest.raises(
            ValidationException, match=r"^Variable 'nope' is not declared by this test$"
        ):
            run_tools.start_execution(
                "test",
                test["id"],
                TEST_ENVIRONMENT_ID,
                variables={"nope": 1},
                client_name="claude-code",
            )

        artifact_root = get_artifacts_storage_path()
        assert exec_storage._execution_storage == {}
        assert exec_storage._load_all_executions() == []
        assert not (artifact_root.exists() and any(artifact_root.iterdir()))
        assert test_service.delete_test(test["id"]) is True


class TestGetExecution:
    def test_returns_enriched_detail(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        test = create_test_entity("Detail Run")
        started = run_tools.start_execution(
            "test", test["id"], TEST_ENVIRONMENT_ID, client_name="claude-code"
        )

        detail = run_tools.get_execution(started["execution_id"])

        assert detail["id"] == started["execution_id"]
        assert detail["status"] == "running"
        assert detail["triggered_by"] == "mcp:claude-code"
        assert "progress" in detail
        assert isinstance(detail["tests"], list)
        assert set(detail["counts"].keys()) == {
            "total",
            "passed",
            "failed",
            "pending",
            "skipped",
            "excluded",
            "stopped",
        }

    def test_terminal_execution_detail_gains_progress(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        execution_id = make_minimal_execution("passed")

        detail = run_tools.get_execution(execution_id)

        assert detail["status"] == "passed"
        assert detail["progress"] == {"current": 0, "total": 1, "percentage": 0.0}

    def test_unknown_execution_raises_exact_message(self) -> None:
        from wavecore.mcp.tools import run as run_tools

        with pytest.raises(NotFoundException, match=r"^Execution 'ghost' not found$"):
            run_tools.get_execution("ghost")

    def test_a_reference_walking_back_into_the_folder_is_not_found(self) -> None:
        from wavecore.api.services.executions import _storage as exec_storage
        from wavecore.mcp.tools import run as run_tools

        execution_id = make_minimal_execution("passed")
        exec_storage._execution_storage.clear()
        ref = f"../api_executions/{execution_id}"

        with pytest.raises(NotFoundException, match=rf"^Execution '{ref}' not found$"):
            run_tools.get_execution(ref)


class TestStartExecutionToolClientContext:
    def test_without_request_context_falls_back_to_client(self) -> None:
        from wavecore.mcp import server as mcp_server

        test = create_test_entity("No Context Run")

        result = mcp_server._start_execution_tool("test", test["id"], TEST_ENVIRONMENT_ID)

        assert _stored_execution(result["execution_id"])["triggered_by"] == "mcp:client"

    def test_session_without_client_params_falls_back(self) -> None:
        from wavecore.mcp import server as mcp_server

        test = create_test_entity("No Params Run")
        ctx = SimpleNamespace(session=SimpleNamespace(client_params=None), headers=None)
        result = mcp_server._start_execution_tool("test", test["id"], TEST_ENVIRONMENT_ID, ctx=ctx)

        assert _stored_execution(result["execution_id"])["triggered_by"] == "mcp:client"

    def test_session_without_client_info_falls_back(self) -> None:
        from wavecore.mcp import server as mcp_server

        test = create_test_entity("No Client Info Run")
        params = SimpleNamespace(client_info=None)
        ctx = SimpleNamespace(session=SimpleNamespace(client_params=params), headers=None)
        result = mcp_server._start_execution_tool("test", test["id"], TEST_ENVIRONMENT_ID, ctx=ctx)

        assert _stored_execution(result["execution_id"])["triggered_by"] == "mcp:client"
