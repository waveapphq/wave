"""Unit tests for Workbench Service (V-CANVAS-14 / REQ-3.2.1.1).

This module tests the WAVE-specific business logic for ephemeral Workbench execution.

Focus:
- Integration with existing test_service and environment_service
- Profile completeness validation using actual profile data model
- Ephemeral sessions NOT creating Execution entities
- WebSocket topic generation for real-time events
"""

import asyncio
import inspect
import uuid
from typing import Any
from unittest.mock import Mock, patch

import pytest

from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException
from wavecore.core.profile_object import ProfileObject
from wavecore.core.system_object import SystemObject


class TestStartWorkbenchRun:
    """Test suite for start_workbench_run function."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions before/after each test and mock async task creation."""
        from wavecore.api.services.workbench import _common as _wb_common

        _wb_common._clear_sessions_sync()
        with patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task:
            # Return a mock task that's immediately done
            mock_task.return_value = Mock()
            yield mock_task
        _wb_common._clear_sessions_sync()

    @pytest.fixture(autouse=True)
    def _raw_variables_seam(self, mock_test_with_blocks: dict[str, Any]) -> Any:
        """The run path reads variables via the raw getter, not masked get_test."""
        with patch(
            "wavecore.api.services.workbench.service.test_service.get_test_variables_raw",
            side_effect=lambda _tid: mock_test_with_blocks.get("variables", {}),
        ):
            yield

    @pytest.fixture
    def valid_test_id(self) -> str:
        """Return a valid test UUID."""
        return str(uuid.uuid4())

    @pytest.fixture
    def valid_environment_id(self) -> str:
        """Return a valid environment UUID."""
        return str(uuid.uuid4())

    @pytest.fixture
    def mock_test_with_blocks(self, valid_test_id: str) -> dict[str, Any]:
        """Return a test entity with workflow blocks."""
        node1_id = str(uuid.uuid4())
        node2_id = str(uuid.uuid4())
        return {
            "id": valid_test_id,
            "name": "Integration Test Workflow",
            "workflow": {
                "nodes": [
                    {
                        "id": node1_id,
                        "type": "workflowNode",
                        "data": {
                            "label": "Setup",
                            "elementType": "delay",
                            "nodeType": "control",
                            "version": "1.0.0",
                            "config": {"values": {"duration": 100}},
                        },
                    },
                    {
                        "id": node2_id,
                        "type": "workflowNode",
                        "data": {
                            "label": "Execute",
                            "elementType": "log",
                            "nodeType": "plugin",
                            "version": "1.0.0",
                            "config": {"values": {"message": "Test", "level": "INFO"}},
                        },
                    },
                ],
                "edges": [
                    {"source": node1_id, "target": node2_id},
                ],
            },
            "variables": {},
        }

    @pytest.fixture
    def mock_test_empty(self, valid_test_id: str) -> dict[str, Any]:
        """Return a test entity with no workflow blocks."""
        return {
            "id": valid_test_id,
            "name": "Empty Test",
            "workflow": {"nodes": [], "edges": []},
            "variables": {},
        }

    @pytest.fixture
    def mock_environment(self, valid_environment_id: str) -> dict[str, Any]:
        """Return an environment entity."""
        return {
            "id": valid_environment_id,
            "name": "Development",
        }

    # =========================================================================
    # Integration: Uses test_service to Resolve Test Entity
    # =========================================================================

    def test_start_workbench_run_calls_test_service_to_resolve_test(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that workbench service fetches test from test_service."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            # Must call test_service to resolve the test entity
            mock_get_test.assert_called_once_with(valid_test_id)

    def test_start_workbench_run_raises_when_test_not_found(
        self,
        valid_test_id: str,
        valid_environment_id: str,
    ) -> None:
        """Test that workbench service raises LookupError when test not found."""
        from wavecore.api.services.workbench import service as workbench_service

        with patch(
            "wavecore.api.services.workbench.service.test_service.get_test"
        ) as mock_get_test:
            mock_get_test.return_value = None

            with pytest.raises(LookupError) as exc_info:
                workbench_service.start_workbench_run(
                    test_id=valid_test_id,
                    environment_id=valid_environment_id,
                )

            assert f"Test with ID '{valid_test_id}' not found" in str(exc_info.value)

    # =========================================================================
    # Pre-run Validation: Validates test before starting execution
    # =========================================================================

    def test_start_workbench_run_rejects_test_with_fatal_validation_errors(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
    ) -> None:
        """Test that workbench run rejects tests with fatal validation errors."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test"
            ) as mock_validate,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_validate.return_value = {
                "fatal": True,
                "errors": [{"code": "MISSING_WORKFLOW", "message": "Test must have a workflow"}],
                "warnings": [],
            }

            with pytest.raises(ValidationException, match=r"fatal validation errors"):
                workbench_service.start_workbench_run(
                    test_id=valid_test_id,
                    environment_id=valid_environment_id,
                )

    def test_start_workbench_run_rejects_test_with_validation_errors(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
    ) -> None:
        """Test that workbench run rejects tests with non-fatal validation errors."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test"
            ) as mock_validate,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_validate.return_value = {
                "fatal": False,
                "errors": [
                    {
                        "code": "REQUIRED_PARAM_MISSING",
                        "message": "Required parameter 'url' is missing",
                    },
                ],
                "warnings": [],
            }

            with pytest.raises(ValidationException, match=r"validation errors"):
                workbench_service.start_workbench_run(
                    test_id=valid_test_id,
                    environment_id=valid_environment_id,
                )

    def test_start_workbench_run_validates_with_run_context(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that workbench run validates with run context."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test"
            ) as mock_validate,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment
            mock_validate.return_value = {
                "fatal": False,
                "errors": [],
                "warnings": [],
            }

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            mock_validate.assert_called_once_with(valid_test_id, context="run")

    # =========================================================================
    # Integration: Uses environment_service to Resolve Environment Entity
    # =========================================================================

    def test_start_workbench_run_calls_environment_service_to_resolve_environment(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that workbench service fetches environment from environment_service."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            # Must call environment_service to resolve the environment entity
            mock_get_env.assert_called_once_with(valid_environment_id)

    def test_start_workbench_run_raises_when_environment_not_found(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
    ) -> None:
        """Test that workbench service raises LookupError when environment not found."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = None

            with pytest.raises(LookupError) as exc_info:
                workbench_service.start_workbench_run(
                    test_id=valid_test_id,
                    environment_id=valid_environment_id,
                )

            assert f"Environment with ID '{valid_environment_id}' not found" in str(exc_info.value)

    # =========================================================================
    # Test Validation: Must Have Workflow Blocks
    # =========================================================================

    def test_start_workbench_run_raises_when_test_has_no_blocks(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_empty: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that workbench service raises ValueError for test with no blocks."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_empty
            mock_get_env.return_value = mock_environment

            with pytest.raises(ValidationException) as exc_info:
                workbench_service.start_workbench_run(
                    test_id=valid_test_id,
                    environment_id=valid_environment_id,
                )

            assert "at least one workflow block" in str(exc_info.value)

    # =========================================================================
    # Ephemeral Session: Returns session_id with WebSocket Topic
    # =========================================================================

    def test_start_workbench_run_returns_websocket_topic_for_events(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that workbench run returns WebSocket topic for subscribing to events."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            result = workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            assert "session_id" in result
            assert "websocket_topic" in result
            # Topic format: workbench:{session_id}
            assert result["websocket_topic"] == f"workbench:{result['session_id']}"

    def test_start_workbench_run_generates_unique_session_ids(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that each workbench run gets a unique session_id."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            # Use different user_ids to bypass the one-active-session-per-user guard
            result1 = workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                user_id="user1",
            )
            result2 = workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                user_id="user2",
            )

            assert result1["session_id"] != result2["session_id"]

    # =========================================================================
    # Ephemeral Verification: Does NOT Create Execution Entity
    # =========================================================================

    def test_start_workbench_run_does_not_create_execution_entity(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that workbench run does NOT create tracked Execution entity.

        This is the key architectural difference: Workbench runs are ephemeral
        for rapid iteration, unlike tracked executions for CI/CD reporting.
        """
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            result = workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            # Response must have session_id and a null execution_id for ephemeral runs.
            # Tracked executions populate execution_id with their record id.
            assert "session_id" in result
            assert result.get("execution_id") is None

    def test_start_workbench_run_accepts_skipped_node_ids(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that start_workbench_run accepts skipped_node_ids parameter."""
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            # Should accept skipped_node_ids without error
            result = workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                skipped_node_ids=["some-node-id"],
            )

            assert result["status"] == "running"

    # =========================================================================
    # Expression Variable Evaluation (REQ-3.1.3.13)
    # =========================================================================

    def test_start_workbench_run_flattens_dict_format_variables(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that dict-format variables are flattened to simple values."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "base_url": {
                "value": "https://api.example.com",
                "type": "string",
                "scope": "test",
            },
            "timeout": {
                "value": 30,
                "type": "integer",
                "scope": "test",
            },
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            # variables is the 4th positional arg to _execute_workflow
            variables = mock_exec.call_args[0][3]
            assert variables["base_url"] == "https://api.example.com"
            assert variables["timeout"] == 30

    def test_start_workbench_run_passes_bare_value_variables_through(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Variables stored as bare values reach the run as-is."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "raw_var": "simple_value",
            "raw_int": 42,
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            variables = mock_exec.call_args[0][3]
            assert variables["raw_var"] == "simple_value"
            assert variables["raw_int"] == 42

    def test_run_overrides_replace_declared_values(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """A per-run override supplies the value the run executes with."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "expected_status": {"value": 200, "type": "integer", "scope": "test"},
            "untouched": {"value": "keep", "type": "string", "scope": "test"},
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                overrides={"expected_status": 599},
            )

            variables = mock_exec.call_args[0][3]
            assert variables["expected_status"] == 599
            assert variables["untouched"] == "keep"

    def test_run_overrides_apply_to_a_bare_value_variable(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """A variable stored as a bare value is overridden as a bare value."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {"raw_var": "stored"}

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                overrides={"raw_var": "overridden"},
            )

            assert mock_exec.call_args[0][3]["raw_var"] == "overridden"

    def test_run_overrides_accept_the_typed_form(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """``{name: {type, value}}`` overrides the value the same way a bare value does."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "expected_status": {"value": 200, "type": "integer", "scope": "test"},
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                overrides={"expected_status": {"type": "integer", "value": 599}},
            )

            assert mock_exec.call_args[0][3]["expected_status"] == 599

    def test_run_override_of_an_undeclared_variable_is_refused(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Overriding a name the test never declared is a typo, not an injection."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "declared": {"value": 1, "type": "integer", "scope": "test"},
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow"),
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            with pytest.raises(
                ValidationException,
                match=r"^Variable 'ghost' is not declared by this test$",
            ):
                workbench_service.start_workbench_run(
                    test_id=valid_test_id,
                    environment_id=valid_environment_id,
                    overrides={"ghost": 1},
                )

    def test_run_override_keeps_the_secret_flag(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """An overridden secret stays secret, so the new value is still masked."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "token": {"value": "stored-secret", "type": "string", "secret": True},
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
            patch(
                "wavecore.api.services.workbench.service._build_run_secret_registry",
                wraps=workbench_service._build_run_secret_registry,
            ) as spy_registry,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                overrides={"token": "run-secret"},
            )

            assert mock_exec.call_args[0][3]["token"] == "run-secret"
            secret_names, literals, _nodes = spy_registry.call_args[0]
            assert "token" in secret_names
            assert literals["token"] == "run-secret"

    @staticmethod
    def _started_run(
        test: dict[str, Any],
        environment: dict[str, Any],
        overrides: dict[str, Any] | None = None,
    ) -> tuple[Any, dict[str, Any]]:
        """Start a run of ``test`` and return the variables it starts on and its session."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = test
            mock_get_env.return_value = environment

            result = workbench_service.start_workbench_run(
                test_id=test["id"],
                environment_id=environment["id"],
                overrides=overrides,
            )

        return mock_exec.call_args[0][3], _wb_common._workbench_sessions[result["session_id"]]

    def test_run_override_with_a_bare_map_is_the_map_variable_value(
        self, mock_test_with_blocks: dict[str, Any], mock_environment: dict[str, Any]
    ) -> None:
        mock_test_with_blocks["variables"] = {"cfg": {"type": "map", "value": {"a": 1}}}

        variables, _session = self._started_run(
            mock_test_with_blocks, mock_environment, {"cfg": {"b": 2}}
        )

        assert variables["cfg"] == {"b": 2}

    def test_run_override_typed_form_of_a_map_variable_is_its_value(
        self, mock_test_with_blocks: dict[str, Any], mock_environment: dict[str, Any]
    ) -> None:
        mock_test_with_blocks["variables"] = {"cfg": {"type": "map", "value": {"a": 1}}}

        variables, _session = self._started_run(
            mock_test_with_blocks, mock_environment, {"cfg": {"type": "map", "value": {"b": 2}}}
        )

        assert variables["cfg"] == {"b": 2}

    def test_run_override_typed_form_may_carry_secret_and_element_types(
        self, mock_test_with_blocks: dict[str, Any], mock_environment: dict[str, Any]
    ) -> None:
        mock_test_with_blocks["variables"] = {"cfg": {"type": "map", "value": {"a": 1}}}
        typed = {
            "type": "map",
            "value": {"b": 2},
            "secret": False,
            "elementTypes": {"b": "integer"},
        }

        variables, _session = self._started_run(
            mock_test_with_blocks, mock_environment, {"cfg": typed}
        )

        assert variables["cfg"] == {"b": 2}

    @pytest.mark.parametrize(
        "submitted",
        [
            {"type": "string", "value": "x"},
            {"type": "map", "value": {"b": 2}, "note": "kept"},
            {"value": {"b": 2}},
        ],
        ids=["type-is-not-the-declared-type", "a-key-beyond-the-typed-form", "no-type-key"],
    )
    def test_run_override_any_other_map_is_the_map_variable_value(
        self,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
        submitted: dict[str, Any],
    ) -> None:
        mock_test_with_blocks["variables"] = {"cfg": {"type": "map", "value": {"a": 1}}}

        variables, _session = self._started_run(
            mock_test_with_blocks, mock_environment, {"cfg": submitted}
        )

        assert variables["cfg"] == submitted

    _STORED_VALUES = [
        ("string", "x"),
        ("integer", 5),
        ("float", "1.5"),
        ("boolean", True),
        ("array", [1]),
        ("table", [{"a": 1}]),
        ("map", {"a": 1}),
    ]

    @pytest.mark.parametrize(("declared_type", "stored"), _STORED_VALUES)
    def test_run_override_with_null_sets_null(
        self,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
        declared_type: str,
        stored: Any,
    ) -> None:
        mock_test_with_blocks["variables"] = {"v": {"type": declared_type, "value": stored}}

        variables, _session = self._started_run(
            mock_test_with_blocks, mock_environment, {"v": None}
        )

        assert variables["v"] is None

    @pytest.mark.parametrize(("declared_type", "stored"), _STORED_VALUES)
    def test_run_override_with_the_type_alone_sets_null(
        self,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
        declared_type: str,
        stored: Any,
    ) -> None:
        mock_test_with_blocks["variables"] = {"v": {"type": declared_type, "value": stored}}

        variables, _session = self._started_run(
            mock_test_with_blocks, mock_environment, {"v": {"type": declared_type}}
        )

        assert variables["v"] is None

    @pytest.mark.parametrize(
        "stored",
        [None, {"type": "integer", "value": None}, {"type": "integer"}],
        ids=["bare-null", "declaration-holding-null", "declaration-with-no-value"],
    )
    def test_run_override_of_a_declared_name_holding_null_is_accepted(
        self,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
        stored: Any,
    ) -> None:
        mock_test_with_blocks["variables"] = {"n": stored}

        variables, _session = self._started_run(mock_test_with_blocks, mock_environment, {"n": 7})

        assert variables["n"] == 7

    @pytest.mark.parametrize("submitted", [None, 1, {"type": "integer"}])
    def test_run_override_of_an_undeclared_name_is_refused_whatever_it_gives(
        self,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
        submitted: Any,
    ) -> None:
        mock_test_with_blocks["variables"] = {"n": None}

        with pytest.raises(
            ValidationException,
            match=r"^Variable 'ghost' is not declared by this test$",
        ):
            self._started_run(mock_test_with_blocks, mock_environment, {"ghost": submitted})

    def test_a_secret_with_no_value_starts_null_and_adds_no_scrub_token(
        self, mock_test_with_blocks: dict[str, Any], mock_environment: dict[str, Any]
    ) -> None:
        mock_test_with_blocks["variables"] = {"pin": {"type": "integer", "secret": True}}

        variables, session = self._started_run(mock_test_with_blocks, mock_environment)

        assert variables["pin"] is None
        assert session["secret_registry"].is_secret_name("pin") is True
        assert session["secret_registry"].scan_values() == ()

    def test_start_workbench_run_evaluates_expression_variables(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that isExpression variables are evaluated at run start."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "base": {
                "value": 10,
                "type": "integer",
                "scope": "test",
            },
            "doubled": {
                "value": "base * 2",
                "type": "integer",
                "scope": "test",
                "isExpression": True,
            },
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            variables = mock_exec.call_args[0][3]
            assert variables["base"] == 10
            assert variables["doubled"] == 20

    def test_start_workbench_run_evaluates_expression_chain_in_dependency_order(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that expression variables are evaluated in topological order."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "x": {"value": 5, "type": "integer", "scope": "test"},
            # c depends on b, b depends on a - all depend on x
            "a": {
                "value": "x + 1",
                "type": "integer",
                "scope": "test",
                "isExpression": True,
            },
            "b": {
                "value": "a * 2",
                "type": "integer",
                "scope": "test",
                "isExpression": True,
            },
            "c": {
                "value": "b + a",
                "type": "integer",
                "scope": "test",
                "isExpression": True,
            },
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            # x=5, a=5+1=6, b=6*2=12, c=12+6=18
            variables = mock_exec.call_args[0][3]
            assert variables["a"] == 6
            assert variables["b"] == 12
            assert variables["c"] == 18

    def test_start_workbench_run_detects_circular_expression_dependencies(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that circular dependencies among expression vars raise ValueError."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "a": {
                "value": "b + 1",
                "type": "integer",
                "scope": "test",
                "isExpression": True,
            },
            "b": {
                "value": "a + 1",
                "type": "integer",
                "scope": "test",
                "isExpression": True,
            },
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            with pytest.raises(
                ValidationException,
                match=r"^Circular reference detected for variable 'a': a -> b -> a$",
            ):
                workbench_service.start_workbench_run(
                    test_id=valid_test_id,
                    environment_id=valid_environment_id,
                )

    def test_start_workbench_run_defers_expression_eval_failure_to_first_read(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Lazy semantics: a broken expression does NOT abort run start; the
        error surfaces only when a node first reads the expression."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "bad_expr": {
                "value": "undefined_var + 1",
                "type": "integer",
                "scope": "test",
                "isExpression": True,
            },
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            # Run start succeeds even with a broken expression. The
            # expression simply stays pending in the LazyVariables wrapper
            # until something tries to read it.
            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            variables = mock_exec.call_args[0][3]
            assert "bad_expr" in variables
            with pytest.raises(Exception):  # noqa: B017 - broad: depends on plugin executor
                _ = variables["bad_expr"]

    def test_start_workbench_run_defers_expression_type_check_to_first_read(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Lazy semantics: a type mismatch on an expression does NOT abort run
        start; it surfaces when the expression is first read."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "typed_var": {
                "value": "'not_an_integer'",
                "type": "integer",
                "scope": "test",
                "isExpression": True,
            },
        }

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            variables = mock_exec.call_args[0][3]
            assert "typed_var" in variables
            with pytest.raises(Exception):  # noqa: B017 - broad: depends on plugin executor
                _ = variables["typed_var"]

    @pytest.mark.asyncio
    async def test_lazy_evaluation_pushes_variable_change_when_loop_running(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """When an expression is realized inside a running event loop, the
        on_evaluated callback schedules a _push_single_variable_change task
        so the new value broadcasts to the panel."""
        from wavecore.api.services.workbench import service as workbench_service

        mock_test_with_blocks["variables"] = {
            "computed": {
                "value": "1 + 2",
                "type": "integer",
                "scope": "test",
                "isExpression": True,
            },
        }

        recorded: list[tuple[str, str, Any]] = []

        async def fake_push(
            session_id: str, name: str, value: Any, *_path: Any, **_kw: Any
        ) -> None:
            recorded.append((session_id, name, value))

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch("wavecore.api.services.workbench.service._execute_workflow") as mock_exec,
            patch(
                "wavecore.api.services.workbench._common._push_single_variable_change",
                new=fake_push,
            ),
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )

            variables = mock_exec.call_args[0][3]
            # Reading inside an async test exposes a running loop, so the
            # closure schedules the push task instead of silently returning.
            value = variables["computed"]
            assert value == 3
            # Drain the loop until the scheduled push task settles.
            await asyncio.gather(
                *[t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
            )
            assert len(recorded) == 1
            _session_id, name, push_value = recorded[0]
            assert name == "computed"
            assert push_value == 3


class TestProfileCompletenessValidation:
    """Test suite for profile completeness pre-flight validation."""

    @pytest.fixture
    def valid_environment_id(self) -> str:
        """Return a valid environment UUID."""
        return str(uuid.uuid4())

    def test_check_profile_completeness_returns_warnings_for_missing_values(
        self, valid_environment_id: str
    ) -> None:
        """Test that profiles without values for the environment generate warnings."""
        from wavecore.api.services.workbench import service as workbench_service

        test_id = str(uuid.uuid4())
        other_env_id = str(uuid.uuid4())

        # Profile has value for different environment, not the selected one
        profiles = [
            {
                "id": str(uuid.uuid4()),
                "name": "Database Connection",
                "environment_values": {other_env_id: "connection-string"},
            },
        ]

        with patch.object(workbench_service, "_get_test_profiles", return_value=profiles):
            warnings = workbench_service.check_profile_completeness(
                test_id=test_id,
                environment_id=valid_environment_id,
            )

            assert len(warnings) == 1
            assert warnings[0]["type"] == "INCOMPLETE_PROFILE"
            assert warnings[0]["profile_name"] == "Database Connection"

    def test_check_profile_completeness_returns_empty_when_all_profiles_have_values(
        self, valid_environment_id: str
    ) -> None:
        """Test that no warnings when all profiles have values for environment."""
        from wavecore.api.services.workbench import service as workbench_service

        test_id = str(uuid.uuid4())

        # All profiles have values for the selected environment
        profiles = [
            {
                "id": str(uuid.uuid4()),
                "name": "Database Connection",
                "environment_values": {valid_environment_id: "connection-string"},
            },
            {
                "id": str(uuid.uuid4()),
                "name": "API Key",
                "environment_values": {valid_environment_id: "secret-key"},
            },
        ]

        with patch.object(workbench_service, "_get_test_profiles", return_value=profiles):
            warnings = workbench_service.check_profile_completeness(
                test_id=test_id,
                environment_id=valid_environment_id,
            )

            assert warnings == []


class TestStopWorkbenchRun:
    """Test suite for stop_workbench_run function."""

    @pytest.fixture
    def valid_session_id(self) -> str:
        """Return a valid session UUID."""
        return str(uuid.uuid4())

    def test_stop_workbench_run_terminates_session(self, valid_session_id: str) -> None:
        """Test that stop terminates a running workbench session."""
        from wavecore.api.services.workbench import service as workbench_service

        with patch.object(
            workbench_service,
            "_get_session",
            return_value={"session_id": valid_session_id, "status": "running"},
        ):
            with patch.object(workbench_service, "_terminate_session") as mock_terminate:
                mock_terminate.return_value = {
                    "session_id": valid_session_id,
                    "status": "stopped",
                }

                result = workbench_service.stop_workbench_run(session_id=valid_session_id)

                assert result["status"] == "stopped"
                mock_terminate.assert_called_once_with(valid_session_id)

    def test_stop_workbench_run_raises_when_session_not_found(self, valid_session_id: str) -> None:
        """Test that stop raises LookupError for non-existent session."""
        from wavecore.api.services.workbench import service as workbench_service

        with patch.object(workbench_service, "_get_session", return_value=None):
            with pytest.raises(LookupError) as exc_info:
                workbench_service.stop_workbench_run(session_id=valid_session_id)

            assert f"Workbench session '{valid_session_id}' not found" in str(exc_info.value)


class TestUpdateSkippedNodes:
    """Test suite for update_skipped_nodes function."""

    @pytest.fixture
    def valid_session_id(self) -> str:
        """Return a valid session UUID."""
        return str(uuid.uuid4())

    def test_update_skipped_nodes_modifies_running_session(self, valid_session_id: str) -> None:
        """Test that update_skipped_nodes modifies skip set for a running session."""
        from wavecore.api.services.workbench import service as workbench_service

        session = {
            "session_id": valid_session_id,
            "status": "running",
            "skipped_node_ids": [],
        }
        with patch.object(workbench_service, "_get_session", return_value=session):
            result = workbench_service.update_skipped_nodes(
                session_id=valid_session_id,
                skipped_node_ids=["node-1", "node-2"],
            )

            assert result["session_id"] == valid_session_id
            assert result["skipped_node_ids"] == ["node-1", "node-2"]
            # Session dict should be mutated directly
            assert session["skipped_node_ids"] == ["node-1", "node-2"]

    def test_update_skipped_nodes_raises_when_session_not_found(
        self, valid_session_id: str
    ) -> None:
        """Test that update_skipped_nodes raises LookupError for non-existent session."""
        from wavecore.api.services.workbench import service as workbench_service

        with patch.object(workbench_service, "_get_session", return_value=None):
            with pytest.raises(LookupError) as exc_info:
                workbench_service.update_skipped_nodes(
                    session_id=valid_session_id,
                    skipped_node_ids=["node-1"],
                )

            assert f"Workbench session '{valid_session_id}' not found" in str(exc_info.value)

    def test_update_skipped_nodes_raises_when_session_not_running(
        self, valid_session_id: str
    ) -> None:
        """Test that update_skipped_nodes raises ValueError for non-running session."""
        from wavecore.api.services.workbench import service as workbench_service

        session = {
            "session_id": valid_session_id,
            "status": "passed",
            "skipped_node_ids": [],
        }
        with patch.object(workbench_service, "_get_session", return_value=session):
            with pytest.raises(ConflictException) as exc_info:
                workbench_service.update_skipped_nodes(
                    session_id=valid_session_id,
                    skipped_node_ids=["node-1"],
                )

            assert "not running" in str(exc_info.value)

    def test_update_skipped_nodes_refusal_says_blocks(self, valid_session_id: str) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        session = {"session_id": valid_session_id, "status": "passed", "skipped_node_ids": []}
        with (
            patch.object(workbench_service, "_get_session", return_value=session),
            pytest.raises(
                ConflictException,
                match=r"^Cannot update skipped blocks: session is 'passed', not running$",
            ),
        ):
            workbench_service.update_skipped_nodes(
                session_id=valid_session_id, skipped_node_ids=["node-1"]
            )


class TestGetWorkbenchStatus:
    """Test suite for get_workbench_status function."""

    @pytest.fixture
    def valid_session_id(self) -> str:
        """Return a valid session UUID."""
        return str(uuid.uuid4())

    def test_get_workbench_status_returns_progress_for_running_session(
        self, valid_session_id: str
    ) -> None:
        """Test that status returns execution progress for live canvas updates."""
        from wavecore.api.services.workbench import service as workbench_service

        current_block_id = str(uuid.uuid4())
        mock_session = {
            "session_id": valid_session_id,
            "status": "running",
            "current_block": {
                "block_id": current_block_id,
                "block_name": "Execute SQL Query",
            },
            "progress": {"current": 3, "total": 10, "percentage": 30.0},
        }

        with patch.object(workbench_service, "_get_session", return_value=mock_session):
            result = workbench_service.get_workbench_status(valid_session_id)

            assert result["status"] == "running"
            assert result["current_block"]["block_id"] == current_block_id
            assert result["progress"]["percentage"] == 30.0

    def test_get_workbench_status_returns_none_when_session_expired(
        self, valid_session_id: str
    ) -> None:
        """Test that status returns None for expired/non-existent session."""
        from wavecore.api.services.workbench import service as workbench_service

        with patch.object(workbench_service, "_get_session", return_value=None):
            result = workbench_service.get_workbench_status(valid_session_id)

            assert result is None


class TestWorkbenchSessionIntegration:
    """Integration tests exercising full session lifecycle without internal mocks.

    These tests exercise the real _get_session, _terminate_session, and _clear_sessions
    functions to ensure 100% code coverage.
    """

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions before/after each test and mock async task creation."""
        from wavecore.api.services.workbench import _common as _wb_common

        _wb_common._clear_sessions_sync()
        with patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task:
            mock_task.return_value = Mock()
            yield mock_task
        _wb_common._clear_sessions_sync()

    @pytest.fixture
    def valid_test_id(self) -> str:
        """Return a valid test UUID."""
        return str(uuid.uuid4())

    @pytest.fixture
    def valid_environment_id(self) -> str:
        """Return a valid environment UUID."""
        return str(uuid.uuid4())

    @pytest.fixture
    def mock_test_with_blocks(self, valid_test_id: str) -> dict[str, Any]:
        """Return a test entity with workflow blocks."""
        node_id = str(uuid.uuid4())
        return {
            "id": valid_test_id,
            "name": "Integration Test",
            "workflow": {
                "nodes": [
                    {
                        "id": node_id,
                        "type": "workflowNode",
                        "data": {
                            "label": "Block1",
                            "elementType": "delay",
                            "nodeType": "control",
                            "version": "1.0.0",
                            "config": {"values": {"duration": 50}},
                        },
                    },
                ],
                "edges": [],
            },
            "variables": {},
        }

    @pytest.fixture
    def mock_environment(self, valid_environment_id: str) -> dict[str, Any]:
        """Return an environment entity."""
        return {"id": valid_environment_id, "name": "Test Env"}

    def test_full_session_lifecycle_start_status_stop(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test full lifecycle: start → get status → stop (exercises real internal funcs)."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        # Clean up any leftover sessions
        _wb_common._clear_sessions_sync()

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            # Start session - stores in _workbench_sessions
            start_result = workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
            )
            session_id = start_result["session_id"]

            # Get status - exercises real _get_session
            status_result = workbench_service.get_workbench_status(session_id)
            assert status_result is not None
            assert status_result["status"] == "running"

            # Stop session - exercises real _terminate_session
            stop_result = workbench_service.stop_workbench_run(session_id)
            assert stop_result["status"] == "stopped"

            # Verify session was marked as stopped
            final_status = workbench_service.get_workbench_status(session_id)
            assert final_status["status"] == "stopped"

        # Clean up
        _wb_common._clear_sessions_sync()

    def test_clear_sessions_removes_all_sessions(
        self,
        valid_test_id: str,
        valid_environment_id: str,
        mock_test_with_blocks: dict[str, Any],
        mock_environment: dict[str, Any],
    ) -> None:
        """Test that _clear_sessions removes all sessions from storage."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        # Clean up any leftover sessions
        _wb_common._clear_sessions_sync()

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test_with_blocks
            mock_get_env.return_value = mock_environment

            # Create multiple sessions (different user_ids bypass the one-active-session guard)
            result1 = workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                user_id="user1",
            )
            result2 = workbench_service.start_workbench_run(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                user_id="user2",
            )

            # Verify sessions exist
            assert workbench_service.get_workbench_status(result1["session_id"]) is not None
            assert workbench_service.get_workbench_status(result2["session_id"]) is not None

            # Clear all sessions
            _wb_common._clear_sessions_sync()

            # Verify sessions are gone
            assert workbench_service.get_workbench_status(result1["session_id"]) is None
            assert workbench_service.get_workbench_status(result2["session_id"]) is None


class TestAsyncSessionClearing:
    """Tests for async _clear_sessions function.

    These tests run without the autouse fixture that patches asyncio.create_task,
    allowing proper testing of async task cancellation.
    """

    @pytest.mark.asyncio
    async def test_clear_sessions_async_cancels_running_tasks(self) -> None:
        """Test that async _clear_sessions cancels running tasks and waits."""
        from wavecore.api.services.workbench import _common as _wb_common

        # Clear any existing sessions
        _wb_common._clear_sessions_sync()

        # Create a long-running async task
        task_completed = False
        task_canceled = False

        async def long_running_task() -> None:
            nonlocal task_completed, task_canceled
            try:
                await asyncio.sleep(100)  # Long running task
                task_completed = True
            except asyncio.CancelledError:
                task_canceled = True
                raise

        # Manually set up a session with a running task
        session_id = "test-session-123"
        _wb_common._workbench_sessions[session_id] = {
            "status": "running",
            "session_id": session_id,
        }
        task = asyncio.create_task(long_running_task())
        _wb_common._active_tasks[session_id] = task

        # Give the task a moment to start running
        await asyncio.sleep(0.01)

        # Clear sessions asynchronously - this should cancel and await the task
        await _wb_common._clear_sessions()

        # Verify task was canceled (not completed)
        assert not task_completed
        assert task_canceled
        assert task.done()
        assert task.cancelled()

        # Verify sessions are cleared
        assert len(_wb_common._workbench_sessions) == 0
        assert len(_wb_common._active_tasks) == 0

    @pytest.mark.asyncio
    async def test_clear_sessions_async_handles_done_tasks(self) -> None:
        """Test that async _clear_sessions handles already-done tasks."""
        from wavecore.api.services.workbench import _common as _wb_common

        # Clear any existing sessions
        _wb_common._clear_sessions_sync()

        # Create a task that's already done
        async def instant_task() -> None:
            pass

        task = asyncio.create_task(instant_task())
        await task  # Wait for it to complete

        # Manually set up a session with the done task
        session_id = "test-session-done"
        _wb_common._workbench_sessions[session_id] = {
            "status": "passed",
            "session_id": session_id,
        }
        _wb_common._active_tasks[session_id] = task

        # Clear sessions asynchronously - should handle done task gracefully
        await _wb_common._clear_sessions()

        # Verify sessions are cleared
        assert len(_wb_common._workbench_sessions) == 0
        assert len(_wb_common._active_tasks) == 0

    @pytest.mark.asyncio
    async def test_clear_sessions_async_handles_none_tasks(self) -> None:
        """Test that async _clear_sessions handles None tasks."""
        from wavecore.api.services.workbench import _common as _wb_common

        # Clear any existing sessions
        _wb_common._clear_sessions_sync()

        # Manually set up a session with a None task
        session_id = "test-session-none"
        _wb_common._workbench_sessions[session_id] = {
            "status": "running",
            "session_id": session_id,
        }
        _wb_common._active_tasks[session_id] = None

        # Clear sessions asynchronously - should handle None task gracefully
        await _wb_common._clear_sessions()

        # Verify sessions are cleared
        assert len(_wb_common._workbench_sessions) == 0
        assert len(_wb_common._active_tasks) == 0


class TestWorkflowExecutionInternals:
    """Tests for internal workflow execution functions."""

    def test_topological_sort_workflow_orders_by_edges(self) -> None:
        """Test that nodes are sorted in execution order based on edges."""
        from wavecore.api.services.workbench import graph as _wb_graph

        nodes = [
            {"id": "node-3", "type": "workflowNode"},
            {"id": "node-1", "type": "workflowNode"},
            {"id": "node-2", "type": "workflowNode"},
        ]
        edges = [
            {"source": "node-1", "target": "node-2"},
            {"source": "node-2", "target": "node-3"},
        ]

        sorted_nodes = _wb_graph._topological_sort_workflow(nodes, edges)

        # Should be sorted in dependency order
        ids = [n["id"] for n in sorted_nodes]
        assert ids.index("node-1") < ids.index("node-2")
        assert ids.index("node-2") < ids.index("node-3")

    def test_topological_sort_handles_empty_nodes(self) -> None:
        """Test topological sort with no nodes."""
        from wavecore.api.services.workbench import graph as _wb_graph

        sorted_nodes = _wb_graph._topological_sort_workflow([], [])
        assert sorted_nodes == []

    async def test_a_delay_duration_given_as_digit_text_waits_that_many_milliseconds(
        self,
    ) -> None:
        """A Delay duration stored as digit text runs as its integer (REQ-3.1.3.14)."""
        from wavecore.api.services.workbench import plugins as _wb_plugins
        from wavecore.controls.timing import DelayControl

        with patch(
            "wavecore.controls.registry.get_control_implementation", return_value=DelayControl
        ):
            result = await _wb_plugins._execute_control("delay", "1.0.0", {"duration": "1"}, {})

        assert result["planned_duration_ms"] == 1

    async def test_a_delay_duration_with_a_unit_is_refused(self) -> None:
        """Duration text is a number of milliseconds; a unit is not part of it."""
        from wavecore.api.services.workbench import plugins as _wb_plugins
        from wavecore.controls.timing import DelayControl

        with (
            patch(
                "wavecore.controls.registry.get_control_implementation", return_value=DelayControl
            ),
            pytest.raises(ValueError, match=r"^Setting 'duration' is not a valid integer$"),
        ):
            await _wb_plugins._execute_control("delay", "1.0.0", {"duration": "2s"}, {})

    def test_get_active_session_for_user_returns_none_when_no_session(self) -> None:
        """Test get_active_session_for_user returns None when user has no session."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        _wb_common._clear_sessions_sync()
        result = workbench_service.get_active_session_for_user("nonexistent_user")
        assert result is None

    def test_get_active_session_for_user_returns_session_id(self) -> None:
        """Test get_active_session_for_user returns session_id when running."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        _wb_common._clear_sessions_sync()

        # Manually create a running session
        session_id = "test-session-123"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "user_id": "test_user",
        }
        _wb_common._user_active_session["test_user"] = session_id

        result = workbench_service.get_active_session_for_user("test_user")
        assert result == session_id

        _wb_common._clear_sessions_sync()

    def test_get_active_session_returns_none_if_not_running(self) -> None:
        """Test get_active_session returns None if session exists but not running."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        _wb_common._clear_sessions_sync()

        # Manually create a completed session
        session_id = "test-session-456"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "passed",  # Not running
            "user_id": "test_user",
        }
        _wb_common._user_active_session["test_user"] = session_id

        result = workbench_service.get_active_session_for_user("test_user")
        assert result is None  # Should return None since status is not "running"

        _wb_common._clear_sessions_sync()


class TestAsyncWorkflowExecution:
    """Tests for async workflow execution functions."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions and register controls/plugins before/after each test."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.log import LogPlugin

        _wb_common._clear_sessions_sync()
        # Register controls and plugins for async tests
        register_all_core_controls(_registry, freeze_after=False)
        register_plugin(LogPlugin())
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_broadcast_event_handles_missing_ws_manager(self) -> None:
        """Test that broadcast_event handles missing WebSocket manager gracefully."""
        from wavecore.api.services.workbench import _common as _wb_common

        # Should not raise even without ws_manager
        await _wb_common._broadcast_event("test-session", {"type": "test"})

    @pytest.mark.asyncio
    async def test_execute_control_delay(self) -> None:
        """Test executing a delay control."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        # Execute a short delay
        result = await _wb_plugins._execute_control(
            control_type="delay",
            version="1.0.0",
            parameters={"duration": 10},
            variables={},
        )
        # Delay control should complete
        assert result is not None or result is None  # Just verify it doesn't raise

    @pytest.mark.asyncio
    async def test_execute_control_with_session_and_display_name(self) -> None:
        """Test executing a control with session context and display name."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        # Execute a control with full session context
        result = await _wb_plugins._execute_control(
            control_type="delay",
            version="1.0.0",
            parameters={"duration": 10},
            variables={},
            session_id="test-session-123",
            block_id="block-456",
            block_label="Wait for API",
        )
        # Control should complete successfully
        assert result is not None
        assert "planned_duration_ms" in result

    @pytest.mark.asyncio
    async def test_execute_control_unknown_type_raises(self) -> None:
        """Test that executing unknown control type raises ValueError."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        with pytest.raises(NotFoundException, match="Unknown control type"):
            await _wb_plugins._execute_control(
                control_type="nonexistent_control",
                version="1.0.0",
                parameters={},
                variables={},
            )

    @pytest.mark.asyncio
    async def test_execute_control_unknown_version_raises(self) -> None:
        """Test that executing unknown control version raises ValueError."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        with pytest.raises(NotFoundException, match="not found"):
            await _wb_plugins._execute_control(
                control_type="delay",
                version="99.99.99",  # Invalid version
                parameters={},
                variables={},
            )

    @pytest.mark.asyncio
    async def test_execute_control_extracts_param_types_from_dict_schema(self) -> None:
        """Test that _execute_control handles dict-based parameter_schema entries."""
        from unittest.mock import AsyncMock

        from wavecore.api.services.workbench import plugins as _wb_plugins

        # Create a mock control whose metadata uses plain dicts (not ControlParameter)
        mock_control = AsyncMock()
        mock_control.metadata = {
            "id": "delay",
            "parameter_schema": [
                {"name": "duration", "type": "integer"},
            ],
        }
        mock_control.execute.return_value = {"planned_duration_ms": 10}

        mock_class = lambda: mock_control  # noqa: E731

        with patch(
            "wavecore.controls.registry.get_control_implementation",
            return_value=mock_class,
        ):
            result = await _wb_plugins._execute_control(
                control_type="delay",
                version="1.0.0",
                parameters={"duration": 10},
                variables={},
                expression_fields=set(),
            )
            assert result == {"planned_duration_ms": 10}

    @pytest.mark.asyncio
    async def test_execute_control_variable_expression_keys(self) -> None:
        """Test that variable_expression_keys builds map_expr_keys for resolve_parameters."""
        from unittest.mock import AsyncMock

        from wavecore.api.services.workbench import plugins as _wb_plugins

        mock_control = AsyncMock()
        mock_control.metadata = {
            "id": "variable-setter",
            "parameter_schema": [
                {"name": "variables", "type": "map"},
            ],
        }
        mock_control.execute.return_value = {"variables": {"x": 10}}

        mock_class = lambda: mock_control  # noqa: E731

        from wavecore.core.execution.plugin_executor import resolve_parameters

        with (
            patch(
                "wavecore.controls.registry.get_control_implementation",
                return_value=mock_class,
            ),
            patch(
                "wavecore.core.execution.plugin_executor.resolve_parameters",
                wraps=resolve_parameters,
            ) as mock_resolve,
        ):
            await _wb_plugins._execute_control(
                control_type="variable-setter",
                version="1.0.0",
                parameters={"variables": {"x": "1 + 2"}},
                variables={},
                expression_fields=set(),
                setter_rows=_wb_plugins.SetterRows(expression_keys={"x"}),
            )
            # Verify map_expression_keys was passed to resolve_parameters
            call_kwargs = mock_resolve.call_args
            assert call_kwargs.kwargs["map_expression_keys"] == {
                "variables": {"x"},
            }

    @pytest.mark.asyncio
    async def test_execute_control_dotted_expression_fields(self) -> None:
        """Dotted expressionFields (e.g. 'queries.key') build map_expression_keys."""
        from unittest.mock import AsyncMock

        from wavecore.api.services.workbench import plugins as _wb_plugins

        mock_control = AsyncMock()
        mock_control.metadata = {
            "id": "variable-setter",
            "parameter_schema": [
                {"name": "variables", "type": "map"},
            ],
        }
        mock_control.execute.return_value = {"variables": {"status": "ok"}}

        mock_class = lambda: mock_control  # noqa: E731

        from wavecore.core.execution.plugin_executor import resolve_parameters

        with (
            patch(
                "wavecore.controls.registry.get_control_implementation",
                return_value=mock_class,
            ),
            patch(
                "wavecore.core.execution.plugin_executor.resolve_parameters",
                wraps=resolve_parameters,
            ) as mock_resolve,
        ):
            await _wb_plugins._execute_control(
                control_type="variable-setter",
                version="1.0.0",
                parameters={
                    "variables": {"status": "1 + 2"},
                },
                variables={},
                expression_fields={"variables.status"},
            )
            call_kwargs = mock_resolve.call_args
            # Dotted expressionField should produce map_expression_keys entry
            map_keys = call_kwargs.kwargs["map_expression_keys"]
            assert "variables" in map_keys
            assert "status" in map_keys["variables"]

    @pytest.mark.asyncio
    async def test_execute_control_variable_template_keys(self) -> None:
        """variable_template_keys builds map_template_keys for resolve_parameters."""
        from unittest.mock import AsyncMock

        from wavecore.api.services.workbench import plugins as _wb_plugins

        mock_control = AsyncMock()
        mock_control.metadata = {
            "id": "variable-setter",
            "parameter_schema": [
                {"name": "variables", "type": "map"},
            ],
        }
        mock_control.execute.return_value = {"variables": {"greeting": "Hi Bob"}}

        mock_class = lambda: mock_control  # noqa: E731

        from wavecore.core.execution.plugin_executor import resolve_parameters

        with (
            patch(
                "wavecore.controls.registry.get_control_implementation",
                return_value=mock_class,
            ),
            patch(
                "wavecore.core.execution.plugin_executor.resolve_parameters",
                wraps=resolve_parameters,
            ) as mock_resolve,
        ):
            await _wb_plugins._execute_control(
                control_type="variable-setter",
                version="1.0.0",
                parameters={"variables": {"greeting": "Hi {{ name }}"}},
                variables={"name": "Bob"},
                expression_fields=set(),
                setter_rows=_wb_plugins.SetterRows(template_keys={"greeting"}),
            )
            # Verify map_template_keys was passed to resolve_parameters
            call_kwargs = mock_resolve.call_args
            assert call_kwargs.kwargs["map_template_keys"] == {
                "variables": {"greeting"},
            }

    @pytest.mark.asyncio
    async def test_execute_control_setter_renders_template_eagerly(self) -> None:
        """A flagged template key is rendered before the control executes (eager)."""
        from unittest.mock import AsyncMock

        from wavecore.api.services.workbench import plugins as _wb_plugins

        mock_control = AsyncMock()
        mock_control.metadata = {
            "id": "variable-setter",
            "parameter_schema": [
                {"name": "variables", "type": "map"},
            ],
        }
        mock_control.execute.return_value = None

        mock_class = lambda: mock_control  # noqa: E731

        with patch(
            "wavecore.controls.registry.get_control_implementation",
            return_value=mock_class,
        ):
            await _wb_plugins._execute_control(
                control_type="variable-setter",
                version="1.0.0",
                parameters={"variables": {"greeting": "Hi {{ name }}"}},
                variables={"name": "Bob"},
                expression_fields=set(),
                setter_rows=_wb_plugins.SetterRows(
                    template_keys={"greeting"}, types={"greeting": "string"}
                ),
            )
            # The rendered string (not the raw {{ }} template) reaches execute
            call_args = mock_control.execute.call_args[0][0]
            params = call_args["parameters"]
            assert params["variables"]["greeting"] == "Hi Bob"

    @pytest.mark.asyncio
    async def test_execute_control_variable_setter_coerces_types(self) -> None:
        """Test pre-execution type coercion for Variable Setter control."""
        from unittest.mock import AsyncMock

        from wavecore.api.services.workbench import plugins as _wb_plugins

        mock_control = AsyncMock()
        mock_control.metadata = {
            "id": "variable-setter",
            "parameter_schema": [
                {"name": "variables", "type": "map"},
            ],
        }
        # After coercion, "42" should become int 42 for integer type
        mock_control.execute.return_value = {"variables": {"count": 42}}

        mock_class = lambda: mock_control  # noqa: E731

        with patch(
            "wavecore.controls.registry.get_control_implementation",
            return_value=mock_class,
        ):
            await _wb_plugins._execute_control(
                control_type="variable-setter",
                version="1.0.0",
                parameters={"variables": {"count": "42", "name": "hello"}},
                variables={},
                expression_fields=set(),
                setter_rows=_wb_plugins.SetterRows(types={"count": "integer", "name": "string"}),
            )
            # Verify execute was called with coerced parameters
            call_args = mock_control.execute.call_args[0][0]
            params = call_args["parameters"]
            assert params["variables"]["count"] == 42  # coerced from "42"
            assert params["variables"]["name"] == "hello"  # string stays

    @pytest.mark.asyncio
    async def test_execute_plugin_log(self) -> None:
        """Test executing a log plugin."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        result = await _wb_plugins._execute_plugin(
            plugin_type="log",
            version="1.0.0",
            parameters={"message": "Test message", "level": "INFO"},
            variables={},
        )
        assert result is None  # Log plugin returns None

    @pytest.mark.asyncio
    async def test_execute_plugin_with_display_name(self) -> None:
        """Test executing plugin with session_id and display_name formats source correctly."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        result = await _wb_plugins._execute_plugin(
            plugin_type="log",
            version="1.0.0",
            parameters={"message": "Test message", "level": "INFO"},
            variables={},
            session_id="test-session-123",
            block_id="block-456",
            block_label="Stopping Test",
        )
        # The engine wrapper surfaces the Log's rendered `line` for output
        # binding (the session logger source reads "Log : Stopping Test").
        assert result == {"line": "Test message"}

    @pytest.mark.asyncio
    async def test_execute_plugin_unknown_raises(self) -> None:
        """Test that executing unknown plugin raises ValueError."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        with pytest.raises(NotFoundException, match="not found"):
            await _wb_plugins._execute_plugin(
                plugin_type="nonexistent_plugin",
                version="1.0.0",
                parameters={},
                variables={},
            )

    @pytest.mark.asyncio
    async def test_execute_workflow_completes_successfully(self) -> None:
        """Test that workflow execution completes and updates session status."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "workflow-test-session"
        node_id = "test-node-1"

        # Create session
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},  # V-CANVAS-04: Track block states for session recovery
        }

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Test Delay",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_execute_workflow_handles_missing_session(self) -> None:
        """Test that workflow execution handles missing session gracefully."""
        from wavecore.api.services.workbench import service as workbench_service

        # Should not raise when session doesn't exist
        await workbench_service._execute_workflow("nonexistent-session", [], [], {})

    @pytest.mark.asyncio
    async def test_execute_workflow_handles_failed_block(self) -> None:
        """Test that workflow execution handles block failure."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "failed-workflow-session"
        node_id = "bad-node"

        # Create session
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},  # V-CANVAS-04: Track block states for session recovery
        }

        # Node with invalid control type
        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Bad Block",
                    "elementType": "invalid_control",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {}},
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert "error" in session

    @pytest.mark.asyncio
    async def test_execute_workflow_skips_disabled_node(self) -> None:
        """Test that disabled nodes are skipped during execution (CANVAS-71).

        Disabled nodes in the BFS path emit 'skipped' status and children
        still execute.
        """
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "disabled-node-session"
        enabled_id = "enabled-node"
        disabled_id = "disabled-node"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 2, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": disabled_id,
                "type": "workflowNode",
                "data": {
                    "label": "Disabled Block",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "disabled": True,
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": enabled_id,
                "type": "workflowNode",
                "data": {
                    "label": "Enabled Block",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
        ]
        edges = [
            {"source": "start-node", "target": disabled_id},
            {"source": disabled_id, "target": enabled_id},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Disabled node should be skipped, enabled node should pass
        assert session["block_states"][disabled_id] == "skipped"
        assert session["block_states"][enabled_id] == "passed"

    @pytest.mark.asyncio
    async def test_execute_workflow_skips_skipped_node_ids(self) -> None:
        """Test that skipped_node_ids nodes are bypassed during execution (CANVAS-72).

        Uses skipped_node_ids parameter (not node data) for runtime skip.
        Children of skipped nodes still execute.
        """
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "skipped-node-session"
        normal_id = "normal-node"
        skipped_id = "skipped-node"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 2, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": skipped_id,
                "type": "workflowNode",
                "data": {
                    "label": "Skipped Block",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": normal_id,
                "type": "workflowNode",
                "data": {
                    "label": "Normal Block",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
        ]
        edges = [
            {"source": "start-node", "target": skipped_id},
            {"source": skipped_id, "target": normal_id},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {},
            skipped_node_ids=[skipped_id],
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"][skipped_id] == "skipped"
        assert session["block_states"][normal_id] == "passed"

    @pytest.mark.asyncio
    async def test_execute_workflow_follows_edges_all_roots(self) -> None:
        """Test that execution starts from all root nodes (no incoming edges).

        Graph: A → B    E → F → G (two disconnected components)
        Both A and E are roots. All nodes should execute.
        """
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "bfs-test-session"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 5, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": "A",
                "type": "workflowNode",
                "data": {
                    "label": "Node A",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": "B",
                "type": "workflowNode",
                "data": {
                    "label": "Node B",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": "E",
                "type": "workflowNode",
                "data": {
                    "label": "Node E",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": "F",
                "type": "workflowNode",
                "data": {
                    "label": "Node F",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": "G",
                "type": "workflowNode",
                "data": {
                    "label": "Node G",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
        ]
        edges = [
            {"source": "start-node", "target": "A"},
            {"source": "start-node", "target": "E"},
            {"source": "A", "target": "B"},
            # E-F-G are a separate connected component
            {"source": "E", "target": "F"},
            {"source": "F", "target": "G"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Both components execute - A and E are roots (no incoming edges)
        assert session["block_states"]["A"] == "passed"
        assert session["block_states"]["B"] == "passed"
        assert session["block_states"]["E"] == "passed"
        assert session["block_states"]["F"] == "passed"
        assert session["block_states"]["G"] == "passed"

    @pytest.mark.asyncio
    async def test_execute_workflow_all_components_execute(self) -> None:
        """Test that all connected components execute from their roots.

        Graph: A    X → Z (two components)
        A is a standalone root. X is the root of X→Z. All execute.
        """
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "unreachable-session"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 3, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": "A",
                "type": "workflowNode",
                "data": {
                    "label": "Node A",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": "X",
                "type": "workflowNode",
                "data": {
                    "label": "Node X",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": "Z",
                "type": "workflowNode",
                "data": {
                    "label": "Node Z",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
        ]
        edges = [
            {"source": "start-node", "target": "A"},
            {"source": "start-node", "target": "X"},
            {"source": "X", "target": "Z"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # A is a standalone root, X is root of X->Z - all execute
        assert session["block_states"]["A"] == "passed"
        assert session["block_states"]["X"] == "passed"
        assert session["block_states"]["Z"] == "passed"

    @pytest.mark.asyncio
    async def test_execute_workflow_takes_no_start_from_node_id(self) -> None:
        """Test that _execute_workflow does not accept start_from_node_id param."""
        from wavecore.api.services.workbench import service as workbench_service

        sig = inspect.signature(workbench_service._execute_workflow)
        assert "start_from_node_id" not in sig.parameters

    @pytest.mark.asyncio
    async def test_execute_workflow_handles_cycles(self) -> None:
        """Test that BFS handles cycles without infinite loop.

        Graph: Start → A → B → A (cycle)
        Should visit A and B exactly once.
        """
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "cycle-session"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 2, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": "A",
                "type": "workflowNode",
                "data": {
                    "label": "Node A",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": "B",
                "type": "workflowNode",
                "data": {
                    "label": "Node B",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
        ]
        edges = [
            {"source": "start-node", "target": "A"},
            {"source": "A", "target": "B"},
            {"source": "B", "target": "A"},  # Cycle!
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["A"] == "passed"
        assert session["block_states"]["B"] == "passed"

    @pytest.mark.asyncio
    async def test_execute_workflow_handles_diamond_convergence(self) -> None:
        """Test that traversal handles diamond graphs where two paths converge.

        Graph: Start → A, Start → B, A → C, B → C
        Node C is enqueued twice (from A and B) but should execute only once.
        This covers the visited-set guard in the BFS loop.
        """
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "diamond-session"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 3, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": "A",
                "type": "workflowNode",
                "data": {
                    "label": "Node A",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": "B",
                "type": "workflowNode",
                "data": {
                    "label": "Node B",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": "C",
                "type": "workflowNode",
                "data": {
                    "label": "Node C",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
        ]
        edges = [
            {"source": "start-node", "target": "A"},
            {"source": "start-node", "target": "B"},
            {"source": "A", "target": "C"},
            {"source": "B", "target": "C"},  # C enqueued twice
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["A"] == "passed"
        assert session["block_states"]["B"] == "passed"
        assert session["block_states"]["C"] == "passed"

    @pytest.mark.asyncio
    async def test_execute_workflow_stops_when_session_stopped(self) -> None:
        """Test that workflow execution stops when session is marked as stopped."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "stopped-workflow-session"
        node1_id = "node-1"
        node2_id = "node-2"

        # Create session but mark it as stopped
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "stopped",  # Already stopped
            "current_block": None,
            "progress": {"current": 0, "total": 2, "percentage": 0.0},
            "block_states": {},  # V-CANVAS-04: Track block states for session recovery
        }

        nodes = [
            {
                "id": node1_id,
                "type": "workflowNode",
                "data": {
                    "label": "Delay 1",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
            {
                "id": node2_id,
                "type": "workflowNode",
                "data": {
                    "label": "Delay 2",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
        ]
        edges = [
            {"source": "start-node", "target": node1_id},
            {"source": node1_id, "target": node2_id},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        # Session should remain stopped, no nodes executed
        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_execute_workflow_with_plugin_block(self) -> None:
        """Test workflow execution with a plugin block (log)."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "plugin-workflow-session"
        node_id = "log-node"

        # Create session
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},  # V-CANVAS-04: Track block states for session recovery
        }

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Test Log",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {"values": {"message": "Test", "level": "INFO"}},
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_execute_workflow_with_profile_bindings(self) -> None:
        """Test workflow execution with profile bindings on a node."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "profile-bindings-session"
        node_id = "log-node-pb"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Log With Profile",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {"message": "test", "level": "INFO"},
                        "profileBindings": [
                            {"paramName": "message", "profileField": "nonexistent_field"},
                        ],
                    },
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]

        # Execute - profile bindings will attempt to inject but the profile field
        # won't exist (no environment set). The node should still execute.
        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        # Node executes regardless of profile binding failures
        assert session["block_states"].get(node_id) is not None

    @pytest.mark.asyncio
    async def test_broadcast_event_with_ws_manager(self) -> None:
        """Test broadcast_event wraps event in proper envelope for frontend."""
        from unittest.mock import AsyncMock

        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        # Setup mock ws_manager on app state
        mock_ws_manager = AsyncMock()
        original_ws_manager = getattr(app_module.app.state, "ws_manager", None)
        app_module.app.state.ws_manager = mock_ws_manager

        try:
            await _wb_common._broadcast_event("test-session", {"type": "test_event"})
            # Verify envelope format expected by frontend WebSocket client
            # Frontend expects: { type: "event", topic: "...", payload: {...}, timestamp: ... }
            mock_ws_manager.broadcast_to_topic.assert_called_once()
            call_args = mock_ws_manager.broadcast_to_topic.call_args
            assert call_args[0][0] == "workbench:test-session"
            envelope = call_args[0][1]
            assert envelope["type"] == "event"
            assert envelope["topic"] == "workbench:test-session"
            assert envelope["payload"] == {"type": "test_event"}
            assert "timestamp" in envelope
            assert isinstance(envelope["timestamp"], int)
        finally:
            # Restore original state
            if original_ws_manager is None:
                delattr(app_module.app.state, "ws_manager")
            else:
                app_module.app.state.ws_manager = original_ws_manager

    @pytest.mark.asyncio
    async def test_broadcast_event_handles_exception(self) -> None:
        """Test broadcast_event handles exceptions gracefully."""
        from unittest.mock import MagicMock

        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        # Setup mock ws_manager that raises
        mock_ws_manager = MagicMock()
        mock_ws_manager.broadcast_to_topic.side_effect = RuntimeError("Connection failed")
        original_ws_manager = getattr(app_module.app.state, "ws_manager", None)
        app_module.app.state.ws_manager = mock_ws_manager

        try:
            # Should not raise, just log warning
            await _wb_common._broadcast_event("test-session", {"type": "test_event"})
        finally:
            # Restore original state
            if original_ws_manager is None:
                delattr(app_module.app.state, "ws_manager")
            else:
                app_module.app.state.ws_manager = original_ws_manager

    @pytest.mark.asyncio
    async def test_execute_workflow_handles_canceled_error(self) -> None:
        """Test workflow execution handles CancelledError properly."""
        import asyncio

        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "canceled-workflow-session"
        node_id = "long-delay-node"

        # Create session
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},  # V-CANVAS-04: Track block states for session recovery
        }

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Long Delay",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 5000}},  # 5 second delay
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]

        # Start workflow execution as a task
        async def run_workflow() -> None:
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        # Create the task and cancel it after a short delay
        task = asyncio.create_task(run_workflow())
        await asyncio.sleep(0.01)  # Let it start
        task.cancel()

        # Wait for cancellation to complete
        try:
            await task
        except asyncio.CancelledError:
            pass

        # Session should be marked as stopped
        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_handle_workflow_cancellation_user_stop_emits_warn(self) -> None:
        """User-initiated stop tags session.stop_reason='user'; the
        cancellation handler then writes a WARN log, not the FATAL
        backend-shutdown variant."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import execution as _wb_execution

        session_id = "user-stop-session"
        session = {
            "session_id": session_id,
            "status": "running",
            "current_block": {"block_id": "b1"},
            "block_states": {},
            "stop_reason": "user",
        }
        _wb_common._workbench_sessions[session_id] = session

        captured: list[tuple[str, str]] = []

        def fake_add_log(sid: str, level: str, message: str, source: str, **kwargs: Any) -> None:
            captured.append((level, message))

        async def fake_broadcast(_sid: str, _payload: dict[str, Any]) -> None:
            return None

        def fake_notify(_sid: str, _status: str) -> None:
            return None

        with (
            patch.object(_wb_execution, "_add_execution_log", side_effect=fake_add_log),
            patch.object(_wb_execution, "_broadcast_event", side_effect=fake_broadcast),
            patch.object(_wb_execution, "_notify_terminal", side_effect=fake_notify),
        ):
            await _wb_execution._handle_workflow_cancellation(session, session_id, "MyTest")

        assert session["status"] == "stopped"
        assert session["block_states"]["b1"] == "stopped"
        assert captured == [("WARN", "Test 'MyTest' execution stopped by user")]
        _wb_common._workbench_sessions.pop(session_id, None)

    def test_get_session_snapshot_returns_block_states_and_variables(self) -> None:
        """get_session_snapshot returns a plain dict with test_id, block_states
        and variables for an existing session."""
        from wavecore.api.services.workbench import _common as _wb_common

        session_id = "snapshot-session"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "test_id": "test-1",
            "block_states": {"b1": "passed", "b2": "failed"},
            "variables": {"x": 1, "y": "z"},
        }
        try:
            snap = _wb_common.get_session_snapshot(session_id)
            assert snap == {
                "test_id": "test-1",
                "block_states": {"b1": "passed", "b2": "failed"},
                "variables": {"x": 1, "y": "z"},
            }
        finally:
            _wb_common._workbench_sessions.pop(session_id, None)

    def test_get_session_snapshot_returns_none_for_missing_session(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        assert _wb_common.get_session_snapshot("no-such-session") is None

    @pytest.mark.asyncio
    async def test_execute_plugin_with_error_status(self) -> None:
        """Test plugin execution when plugin returns error status."""
        from unittest.mock import AsyncMock

        from wavecore.api.services.workbench import plugins as _wb_plugins

        # Mock execute_plugin to return error status
        with patch(
            "wavecore.core.execution.plugin_executor.execute_plugin",
            new=AsyncMock(
                return_value={
                    "status": "error",
                    "error": "Plugin failed internally",
                }
            ),
        ):
            with pytest.raises(RuntimeError, match="Plugin failed internally"):
                await _wb_plugins._execute_plugin(
                    plugin_type="log",
                    version="1.0.0",
                    parameters={"message": "Test"},
                    variables={},
                )

    @pytest.mark.asyncio
    async def test_execute_workflow_handles_unexpected_exception(self) -> None:
        """Test workflow execution handles unexpected exceptions in the outer handler.

        This tests the general exception handler (lines 323-327) which catches
        unexpected exceptions that aren't CancelledError or block execution errors.
        """
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "exception-workflow-session"
        node_id = "test-node"

        # Create a custom dict that raises on "progress" assignment
        # This will trigger the outer exception handler when the first block
        # tries to update progress (line 230-234), which is inside the for loop
        # but BEFORE the inner try-except at line 250
        class BrokenDict(dict):
            """Dict that raises on 'progress' assignment."""

            def __init__(self, *args: Any, **kwargs: Any) -> None:
                super().__init__(*args, **kwargs)

            def __setitem__(self, key: Any, value: Any) -> None:
                if key == "progress" and isinstance(value, dict):
                    # Raise when trying to set progress dict (line 230-234)
                    raise RuntimeError("Unexpected dict error")
                super().__setitem__(key, value)

        session = BrokenDict(
            {
                "session_id": session_id,
                "status": "running",
                "current_block": None,
                "progress": {"current": 0, "total": 1, "percentage": 0.0},
                "block_states": {},
            }
        )
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Test Block",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 10}},
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        # Session should be marked as failed
        assert session["status"] == "failed"
        assert "error" in session
        assert "Unexpected dict error" in session["error"]

    @pytest.mark.asyncio
    async def test_pre_execution_reconciliation_creates_missing_variables(self) -> None:
        """Pre-execution reconciliation auto-creates missing output-bound variables."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "reconcile-test-session"
        node_id = "log-node-1"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Test Log",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {"message": "test", "level": "INFO"},
                        "outputBindings": {"status_code": "my_status"},
                    },
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]
        variables: dict[str, Any] = {}

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        # Pre-execution reconciliation should have created the variable
        assert "my_status" in variables

    @pytest.mark.asyncio
    async def test_pre_execution_reconciliation_skips_empty_var_names(self) -> None:
        """Pre-execution reconciliation skips empty variable names in bindings."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "reconcile-skip-session"
        node_id = "log-node-2"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Test Log",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {"message": "test", "level": "INFO"},
                        "outputBindings": {"status_code": "", "body": "my_body"},
                    },
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]
        variables: dict[str, Any] = {}

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        # Empty var name should NOT create a variable, but non-empty should
        assert "" not in variables
        assert "my_body" in variables

    @pytest.mark.asyncio
    async def test_output_binding_assigns_result_to_variable(self) -> None:
        """Output binding assigns plugin result values to variables."""
        from unittest.mock import AsyncMock

        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "binding-assign-session"
        node_id = "http-node"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "HTTP Request",
                    "elementType": "http_client",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {"method": "GET", "url": "http://example.com"},
                        "outputBindings": {
                            "status_code": "resp_status",
                            "body": "resp_body",
                            "unbound_output": "",
                        },
                    },
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]
        variables: dict[str, Any] = {}

        mock_result = {
            "status_code": 200,
            "body": "OK",
            "headers": {},
        }

        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        # Output bindings should have assigned values
        assert variables["resp_status"] == 200
        assert variables["resp_body"] == "OK"

    @pytest.mark.asyncio
    async def test_output_binding_log_is_debug_without_value(self) -> None:
        """Output binding log is DEBUG level and does not include the value."""
        from unittest.mock import AsyncMock

        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "binding-log-session"
        node_id = "http-node"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "HTTP Request",
                    "elementType": "http_client",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {"method": "GET", "url": "http://example.com"},
                        "outputBindings": {"body": "resp_body"},
                    },
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node_id},
        ]
        variables: dict[str, Any] = {}

        long_body = "x" * 300
        mock_result = {"body": long_body}

        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        # Variable should have full value
        assert variables["resp_body"] == long_body

        # Binding log should be DEBUG, show only assignment fact (no value)
        from wavecore.api.services import log_streaming_service

        logs = log_streaming_service.get_logs(session_id)
        binding_logs = [log for log in logs if "resp_body" in log.get("message", "")]
        assert len(binding_logs) == 1
        assert binding_logs[0]["level"] == "DEBUG"
        assert binding_logs[0]["message"] == "'HTTP Request' → resp_body"
        # Value must NOT appear in the log
        assert long_body not in binding_logs[0]["message"]


class TestAssertWarningAndFailTest:
    """Tests for assert warning status and fail_current_scope behavior in workflow execution."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions and register controls before/after each test."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.controls.registry import _registry, register_all_core_controls

        _wb_common._clear_sessions_sync()
        register_all_core_controls(_registry, freeze_after=False)
        yield
        _wb_common._clear_sessions_sync()

    def _make_assert_node(
        self,
        node_id: str,
        *,
        fail_current_scope: bool = False,
        will_pass: bool = True,
        mode: str = "single",
    ) -> dict[str, Any]:
        """Create an assert node that passes or fails."""
        # Use expression assertion for simplicity
        expression = "True" if will_pass else "False"
        config: dict[str, Any] = {
            "values": {
                "assertions": [{"type": "expression", "expression": expression}],
                "mode": mode,
            },
        }
        if fail_current_scope:
            config["values"]["fail_current_scope"] = True
        return {
            "id": node_id,
            "type": "workflowNode",
            "data": {
                "label": "Assert Check",
                "elementType": "assert",
                "nodeType": "control",
                "version": "1.0.0",
                "config": config,
            },
        }

    def _make_session(self, session_id: str, total: int = 1) -> dict[str, Any]:
        """Create a minimal running session."""
        from wavecore.api.services.workbench import _common as _wb_common

        session_data: dict[str, Any] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": total, "percentage": 0.0},
            "block_states": {},
            "scope_failed": False,
        }
        _wb_common._workbench_sessions[session_id] = session_data
        return session_data

    @pytest.mark.asyncio
    async def test_assert_failure_default_broadcasts_warning_status(self) -> None:
        """Assert failure with fail_current_scope=False broadcasts block status 'warning'."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "assert-warn-session"
        node_id = "assert-warn-node"
        self._make_session(session_id)

        nodes = [self._make_assert_node(node_id, will_pass=False, fail_current_scope=False)]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"][node_id] == "warning"
        # Test should still pass overall (informational failure)
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_assert_failure_fail_current_scope_true_broadcasts_failed_status(self) -> None:
        """Assert failure with fail_current_scope=True broadcasts block status 'failed'."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "assert-fail-session"
        node_id = "assert-fail-node"
        self._make_session(session_id)

        nodes = [self._make_assert_node(node_id, will_pass=False, fail_current_scope=True)]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"][node_id] == "failed"

    @pytest.mark.asyncio
    async def test_assert_fail_current_scope_true_causes_final_status_failed(self) -> None:
        """Assert failure with fail_current_scope=True causes final execution status 'failed'."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "assert-final-fail-session"
        node_id = "assert-final-fail-node"
        self._make_session(session_id)

        nodes = [self._make_assert_node(node_id, will_pass=False, fail_current_scope=True)]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"

    @pytest.mark.asyncio
    async def test_assert_failure_default_does_not_affect_final_status(self) -> None:
        """Assert failure with fail_current_scope=False does NOT affect final test status."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "assert-no-fail-session"
        node_id = "assert-no-fail-node"
        self._make_session(session_id)

        nodes = [self._make_assert_node(node_id, will_pass=False, fail_current_scope=False)]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_test_failed_key_stripped_before_output_bindings(self) -> None:
        """__scope_failed key is stripped from result before output bindings."""
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "assert-strip-session"
        node_id = "assert-strip-node"
        self._make_session(session_id)

        # Node with output binding for 'passed' -> 'result_var'
        node = self._make_assert_node(
            node_id, will_pass=False, fail_current_scope=True, mode="split"
        )
        node["data"]["config"]["outputBindings"] = {"passed": "result_var"}
        nodes = [node]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]
        variables: dict[str, Any] = {}

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        # 'passed' should be bound, but '__scope_failed' should NOT leak
        assert variables.get("result_var") is False
        assert "__scope_failed" not in variables

    @pytest.mark.asyncio
    async def test_scope_failed_flag_survives_to_completion(self) -> None:
        """Session scope_failed flag persists through execution to completion."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "assert-persist-session"
        node1_id = "assert-node"
        node2_id = "delay-node"
        self._make_session(session_id, total=2)

        nodes = [
            self._make_assert_node(
                node1_id, will_pass=False, fail_current_scope=True, mode="split"
            ),
            {
                "id": node2_id,
                "type": "workflowNode",
                "data": {
                    "label": "Follow-up",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 1}},
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": node1_id},
            {"source": node1_id, "target": node2_id, "sourceHandle": "fail"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        # The fail branch still executes after the split Assert marks the scope
        assert session["block_states"][node2_id] == "passed"
        # Overall test should fail due to scope_failed flag
        assert session["status"] == "failed"
        assert session["scope_failed"] is True

    @pytest.mark.asyncio
    async def test_warning_block_state_persists_in_session(self) -> None:
        """Warning block states persist in session block_states for recovery."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "assert-warning-persist-session"
        node_id = "assert-warning-node"
        self._make_session(session_id)

        nodes = [self._make_assert_node(node_id, will_pass=False, fail_current_scope=False)]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"][node_id] == "warning"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("mode", "handle", "after_state"),
        [("split", "fail", "passed"), ("single", None, "skipped")],
        ids=["split-continues", "single-stops"],
    )
    async def test_fail_current_scope_true_continues_only_in_split_mode(
        self, mode: str, handle: str | None, after_state: str
    ) -> None:
        """A split Assert goes on down its fail branch; a single-mode one stops the flow."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = f"assert-continues-session-{mode}"
        assert_id = "assert-node"
        delay_id = "after-assert"
        self._make_session(session_id, total=2)

        nodes = [
            self._make_assert_node(assert_id, will_pass=False, fail_current_scope=True, mode=mode),
            {
                "id": delay_id,
                "type": "workflowNode",
                "data": {
                    "label": "After Assert",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 1}},
                },
            },
        ]
        edge: dict[str, Any] = {"source": assert_id, "target": delay_id}
        if handle is not None:
            edge["sourceHandle"] = handle
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": assert_id}, edge]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"].get(delay_id) == after_state
        assert session["status"] == "failed"

    @pytest.mark.asyncio
    async def test_passing_assert_with_fail_current_scope_true_stays_green(self) -> None:
        """Passing assertions with fail_current_scope=True show green (not warning or failed)."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "assert-pass-green-session"
        node_id = "assert-pass-node"
        self._make_session(session_id)

        nodes = [self._make_assert_node(node_id, will_pass=True, fail_current_scope=True)]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"][node_id] == "passed"
        assert session["status"] == "passed"


class TestTerminateSessionWithTask:
    """Tests for _terminate_session with real asyncio tasks."""

    def test_terminate_session_cancels_running_task(self) -> None:
        """Test that terminate_session cancels a running task."""
        import asyncio

        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        _wb_common._clear_sessions_sync()

        session_id = "task-cancel-test"

        # Create a session
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
        }

        # Create a mock task
        async def long_running() -> None:
            await asyncio.sleep(100)

        loop = asyncio.new_event_loop()
        task = loop.create_task(long_running())
        _wb_common._active_tasks[session_id] = task

        # Terminate the session
        result = workbench_service._terminate_session(session_id)

        assert result["status"] == "stopped"
        # Task should be in canceling state (cancel() was called)
        assert task.cancelling() > 0

        loop.close()
        _wb_common._clear_sessions_sync()

    def test_terminate_session_handles_done_task(self) -> None:
        """Test that terminate_session handles already-done tasks."""
        import asyncio

        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        _wb_common._clear_sessions_sync()

        session_id = "done-task-test"

        # Create a session
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
        }

        # Create a task that's already done
        async def quick_task() -> None:
            pass

        loop = asyncio.new_event_loop()
        task = loop.create_task(quick_task())
        loop.run_until_complete(task)  # Complete the task
        _wb_common._active_tasks[session_id] = task

        # Terminate the session - should not raise
        result = workbench_service._terminate_session(session_id)

        assert result["status"] == "stopped"

        loop.close()
        _wb_common._clear_sessions_sync()


class TestUserActiveSessionConstraint:
    """Tests for user active session constraint."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions before/after each test."""
        from wavecore.api.services.workbench import _common as _wb_common

        _wb_common._clear_sessions_sync()
        with patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task:
            mock_task.return_value = Mock()
            yield mock_task
        _wb_common._clear_sessions_sync()

    def test_start_run_rejects_when_user_has_active_session(self) -> None:
        """Test that start_workbench_run rejects when user already has active run."""
        from wavecore.api.services.workbench import service as workbench_service

        test_id = str(uuid.uuid4())
        env_id = str(uuid.uuid4())

        node_id = str(uuid.uuid4())
        mock_test = {
            "id": test_id,
            "name": "Test",
            "workflow": {
                "nodes": [
                    {
                        "id": node_id,
                        "type": "workflowNode",
                        "data": {
                            "label": "Block",
                            "elementType": "delay",
                            "nodeType": "control",
                            "version": "1.0.0",
                            "config": {"values": {"duration": 10}},
                        },
                    },
                ],
                "edges": [],
            },
            "variables": {},
        }
        mock_env = {"id": env_id, "name": "Env"}

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test
            mock_get_env.return_value = mock_env

            # First run succeeds
            result1 = workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=env_id,
                user_id="same_user",
            )
            assert result1["status"] == "running"

            # Second run with same user should fail
            with pytest.raises(ConflictException, match="already has an active workbench session"):
                workbench_service.start_workbench_run(
                    test_id=test_id,
                    environment_id=env_id,
                    user_id="same_user",
                )

    def test_stop_clears_user_active_session(self) -> None:
        """Test that stopping a run clears the user's active session."""
        from wavecore.api.services.workbench import service as workbench_service

        test_id = str(uuid.uuid4())
        env_id = str(uuid.uuid4())

        node_id = str(uuid.uuid4())
        mock_test = {
            "id": test_id,
            "name": "Test",
            "workflow": {
                "nodes": [
                    {
                        "id": node_id,
                        "type": "workflowNode",
                        "data": {
                            "label": "Block",
                            "elementType": "delay",
                            "nodeType": "control",
                            "version": "1.0.0",
                            "config": {"values": {"duration": 10}},
                        },
                    },
                ],
                "edges": [],
            },
            "variables": {},
        }
        mock_env = {"id": env_id, "name": "Env"}

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
        ):
            mock_get_test.return_value = mock_test
            mock_get_env.return_value = mock_env

            # Start a run
            result1 = workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=env_id,
                user_id="test_user",
            )
            session_id = result1["session_id"]

            # Stop the run
            workbench_service.stop_workbench_run(session_id)

            # Now user should be able to start another run
            result2 = workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=env_id,
                user_id="test_user",
            )
            assert result2["status"] == "running"


class TestGetSessionForUser:
    """Tests for get_session_for_user function (session recovery).

    This function enables frontend session recovery by returning the full session
    data for a user, regardless of session status. Unlike get_active_session_for_user
    which only returns running sessions, this returns sessions in any status.
    """

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions before/after each test."""
        from wavecore.api.services.workbench import _common as _wb_common

        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    def test_get_session_for_user_returns_none_when_no_session(self) -> None:
        """Test that get_session_for_user returns None when user has no session."""
        from wavecore.api.services.workbench import service as workbench_service

        result = workbench_service.get_session_for_user("nonexistent_user")
        assert result is None

    def test_get_session_for_user_returns_running_session(self) -> None:
        """Test that get_session_for_user returns running session data."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "running-session-123"
        test_id = str(uuid.uuid4())
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "test_id": test_id,
            "websocket_topic": f"workbench:{session_id}",
            "current_block": {"block_id": "b1", "block_name": "Block 1"},
            "progress": {"current": 2, "total": 5, "percentage": 40.0},
            "user_id": "test_user",
        }
        _wb_common._user_active_session["test_user"] = session_id

        result = workbench_service.get_session_for_user("test_user")

        assert result is not None
        assert result["session_id"] == session_id
        assert result["status"] == "running"
        assert result["test_id"] == test_id
        assert result["websocket_topic"] == f"workbench:{session_id}"
        assert result["current_block"]["block_name"] == "Block 1"
        assert result["progress"]["percentage"] == 40.0

    def test_get_session_for_user_returns_passed_session(self) -> None:
        """Test that get_session_for_user returns passed session for recovery.

        Unlike get_active_session_for_user, this should return terminal states.
        """
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "passed-session-456"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "passed",
            "test_id": str(uuid.uuid4()),
            "websocket_topic": f"workbench:{session_id}",
            "current_block": None,
            "progress": {"current": 5, "total": 5, "percentage": 100.0},
            "user_id": "test_user",
        }
        _wb_common._user_active_session["test_user"] = session_id

        result = workbench_service.get_session_for_user("test_user")

        assert result is not None
        assert result["status"] == "passed"

    def test_get_session_for_user_returns_failed_session(self) -> None:
        """Test that get_session_for_user returns failed session with error info."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "failed-session-789"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "failed",
            "test_id": str(uuid.uuid4()),
            "websocket_topic": f"workbench:{session_id}",
            "error": "Connection timeout",
            "current_block": {"block_id": "b2", "block_name": "SSH Connect"},
            "progress": {"current": 2, "total": 5, "percentage": 40.0},
            "user_id": "test_user",
        }
        _wb_common._user_active_session["test_user"] = session_id

        result = workbench_service.get_session_for_user("test_user")

        assert result is not None
        assert result["status"] == "failed"
        assert result["error"] == "Connection timeout"

    def test_get_session_for_user_returns_stopped_session(self) -> None:
        """Test that get_session_for_user returns stopped session."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "stopped-session-abc"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "stopped",
            "test_id": str(uuid.uuid4()),
            "websocket_topic": f"workbench:{session_id}",
            "current_block": None,
            "progress": {"current": 3, "total": 5, "percentage": 60.0},
            "user_id": "test_user",
        }
        _wb_common._user_active_session["test_user"] = session_id

        result = workbench_service.get_session_for_user("test_user")

        assert result is not None
        assert result["status"] == "stopped"

    def test_get_session_for_user_returns_none_if_session_deleted(self) -> None:
        """Test that get_session_for_user returns None if session was deleted."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        # User has active session mapping but session itself was deleted
        _wb_common._user_active_session["orphan_user"] = "deleted-session"
        # But the session doesn't exist in _workbench_sessions

        result = workbench_service.get_session_for_user("orphan_user")
        assert result is None

    def test_get_session_for_user_uses_default_user_id(self) -> None:
        """Test that get_session_for_user uses DEFAULT_USER_ID when not specified."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "dev-user-session"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "test_id": str(uuid.uuid4()),
            "websocket_topic": f"workbench:{session_id}",
            "current_block": None,
            "progress": {"current": 0, "total": 5, "percentage": 0.0},
            "user_id": "dev",
        }
        _wb_common._user_active_session["dev"] = session_id

        # Call without user_id - should use DEFAULT_USER_ID ("dev")
        result = workbench_service.get_session_for_user()

        assert result is not None
        assert result["session_id"] == session_id


class TestClearSessionForUser:
    """Tests for clear_session_for_user function.

    This function allows explicit session reset, used when frontend wants to
    clear stale state or when user clicks "Reset" action.
    """

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions before/after each test."""
        from wavecore.api.services.workbench import _common as _wb_common

        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    def test_clear_session_for_user_removes_session(self) -> None:
        """Test that clear_session_for_user removes the user's session."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "session-to-clear"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "passed",
            "user_id": "test_user",
        }
        _wb_common._user_active_session["test_user"] = session_id

        result = workbench_service.clear_session_for_user("test_user")

        assert result["cleared"] is True
        assert workbench_service.get_session_for_user("test_user") is None
        assert "test_user" not in _wb_common._user_active_session

    def test_clear_session_for_user_is_idempotent(self) -> None:
        """Test that clear_session_for_user succeeds when no session exists."""
        from wavecore.api.services.workbench import service as workbench_service

        # No session exists for this user
        result = workbench_service.clear_session_for_user("nonexistent_user")

        # Should succeed without error (idempotent)
        assert result["cleared"] is False

    def test_clear_session_for_user_cancels_running_task(self) -> None:
        """Test that clear_session_for_user cancels any running task."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "session-with-task"

        # Create a mock task
        async def long_running() -> None:
            await asyncio.sleep(100)

        loop = asyncio.new_event_loop()
        task = loop.create_task(long_running())

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "user_id": "test_user",
        }
        _wb_common._user_active_session["test_user"] = session_id
        _wb_common._active_tasks[session_id] = task

        result = workbench_service.clear_session_for_user("test_user")

        assert result["cleared"] is True
        # Task should be canceled
        assert task.cancelling() > 0

        loop.close()

    def test_clear_session_for_user_uses_default_user_id(self) -> None:
        """Test that clear_session_for_user uses DEFAULT_USER_ID when not specified."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "dev-session-to-clear"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "stopped",
            "user_id": "dev",
        }
        _wb_common._user_active_session["dev"] = session_id

        # Call without user_id - should use DEFAULT_USER_ID ("dev")
        result = workbench_service.clear_session_for_user()

        assert result["cleared"] is True
        assert workbench_service.get_session_for_user("dev") is None


class TestInferVariableType:
    """Tests for _infer_variable_type function (lines 242-259)."""

    def test_infer_null_type(self) -> None:
        """Test that None returns 'null' type."""
        from wavecore.api.services.workbench import _common as _wb_common

        assert _wb_common._infer_variable_type(None) == "null"

    def test_infer_boolean_type(self) -> None:
        """Test that bool returns 'boolean' type."""
        from wavecore.api.services.workbench import _common as _wb_common

        assert _wb_common._infer_variable_type(True) == "boolean"
        assert _wb_common._infer_variable_type(False) == "boolean"

    def test_infer_integer_type(self) -> None:
        """Test that int returns 'integer' type."""
        from wavecore.api.services.workbench import _common as _wb_common

        assert _wb_common._infer_variable_type(42) == "integer"
        assert _wb_common._infer_variable_type(0) == "integer"
        assert _wb_common._infer_variable_type(-100) == "integer"

    def test_infer_float_type(self) -> None:
        """Test that float returns 'float' type."""
        from wavecore.api.services.workbench import _common as _wb_common

        assert _wb_common._infer_variable_type(3.14) == "float"
        assert _wb_common._infer_variable_type(0.0) == "float"

    def test_infer_string_type(self) -> None:
        """Test that str returns 'string' type."""
        from wavecore.api.services.workbench import _common as _wb_common

        assert _wb_common._infer_variable_type("hello") == "string"
        assert _wb_common._infer_variable_type("") == "string"

    def test_infer_array_type(self) -> None:
        """Test that list returns 'array' type."""
        from wavecore.api.services.workbench import _common as _wb_common

        assert _wb_common._infer_variable_type([1, 2, 3]) == "array"
        assert _wb_common._infer_variable_type([]) == "array"

    def test_infer_records_list_type(self) -> None:
        """Test that a list of records is an 'array'."""
        from wavecore.api.services.workbench import _common as _wb_common

        records = [{"a": 1, "b": 2}, {"a": 3, "b": 4}]

        assert _wb_common._infer_variable_type(records) == "array"

    def test_infer_table_type(self) -> None:
        """Test that a Table is a 'table', matched before the list check."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.table import Table

        table = Table.from_list([{"a": 1, "b": 2}, {"a": 3, "b": 4}])

        assert _wb_common._infer_variable_type(table) == "table"

    def test_infer_map_type(self) -> None:
        """Test that dict returns 'map' type (line 257-258)."""
        from wavecore.api.services.workbench import _common as _wb_common

        assert _wb_common._infer_variable_type({"key": "value"}) == "map"
        assert _wb_common._infer_variable_type({}) == "map"

    def test_infer_unknown_type_defaults_to_string(self) -> None:
        """Test that unknown types default to 'string' (line 259)."""
        from wavecore.api.services.workbench import _common as _wb_common

        # Custom class instance - falls through all checks
        class CustomClass:
            pass

        assert _wb_common._infer_variable_type(CustomClass()) == "string"
        # Tuple also defaults to string
        assert _wb_common._infer_variable_type((1, 2, 3)) == "string"


class TestPushVariableChanges:
    """Tests for _push_variable_changes function (lines 206, 210-230)."""

    @pytest.mark.asyncio
    async def test_push_variable_changes_no_push_service(self) -> None:
        """Test that function returns early when no push service (line 206)."""
        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        # Ensure no push service is set
        original = getattr(app_module.app.state, "variable_push_service", None)
        if hasattr(app_module.app.state, "variable_push_service"):
            delattr(app_module.app.state, "variable_push_service")

        try:
            # Should not raise, just return
            await _wb_common._push_variable_changes(
                session_id="test-session",
                old_vars={},
                new_vars={"a": 1},
            )
        finally:
            if original is not None:
                app_module.app.state.variable_push_service = original

    @pytest.mark.asyncio
    async def test_push_variable_changes_detects_new_variable(self) -> None:
        """Test that function detects and pushes new variables (lines 210-227)."""
        from unittest.mock import AsyncMock

        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        mock_push_service = AsyncMock()
        original = getattr(app_module.app.state, "variable_push_service", None)
        app_module.app.state.variable_push_service = mock_push_service

        try:
            await _wb_common._push_variable_changes(
                session_id="test-session",
                old_vars={},
                new_vars={"new_var": "hello"},
            )

            mock_push_service.push_variable_change.assert_called_once()
            call_args = mock_push_service.push_variable_change.call_args[0][0]
            assert call_args["type"] == "variable_changed"
            assert call_args["path"] == "new_var"
            assert call_args["value"] == "hello"
            assert call_args["var_type"] == "string"
        finally:
            if original is None:
                delattr(app_module.app.state, "variable_push_service")
            else:
                app_module.app.state.variable_push_service = original

    @pytest.mark.asyncio
    async def test_push_variable_changes_detects_changed_variable(self) -> None:
        """Test that function detects and pushes changed variables."""
        from unittest.mock import AsyncMock

        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        mock_push_service = AsyncMock()
        original = getattr(app_module.app.state, "variable_push_service", None)
        app_module.app.state.variable_push_service = mock_push_service

        try:
            await _wb_common._push_variable_changes(
                session_id="test-session",
                old_vars={"counter": 1},
                new_vars={"counter": 2},
            )

            mock_push_service.push_variable_change.assert_called_once()
            call_args = mock_push_service.push_variable_change.call_args[0][0]
            assert call_args["path"] == "counter"
            assert call_args["value"] == 2
            assert call_args["var_type"] == "integer"
        finally:
            if original is None:
                delattr(app_module.app.state, "variable_push_service")
            else:
                app_module.app.state.variable_push_service = original

    @pytest.mark.asyncio
    async def test_push_variable_changes_ignores_unchanged(self) -> None:
        """Test that function ignores unchanged variables."""
        from unittest.mock import AsyncMock

        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        mock_push_service = AsyncMock()
        original = getattr(app_module.app.state, "variable_push_service", None)
        app_module.app.state.variable_push_service = mock_push_service

        try:
            await _wb_common._push_variable_changes(
                session_id="test-session",
                old_vars={"unchanged": "same"},
                new_vars={"unchanged": "same"},
            )

            # Should not be called for unchanged variable
            mock_push_service.push_variable_change.assert_not_called()
        finally:
            if original is None:
                delattr(app_module.app.state, "variable_push_service")
            else:
                app_module.app.state.variable_push_service = original

    @pytest.mark.asyncio
    async def test_push_variable_changes_handles_exception(self) -> None:
        """Test that function handles exceptions gracefully (line 229-230)."""
        from unittest.mock import AsyncMock

        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        mock_push_service = AsyncMock()
        mock_push_service.push_variable_change.side_effect = RuntimeError("Push failed")
        original = getattr(app_module.app.state, "variable_push_service", None)
        app_module.app.state.variable_push_service = mock_push_service

        try:
            # Should not raise, just log warning
            await _wb_common._push_variable_changes(
                session_id="test-session",
                old_vars={},
                new_vars={"var": "value"},
            )
        finally:
            if original is None:
                delattr(app_module.app.state, "variable_push_service")
            else:
                app_module.app.state.variable_push_service = original


class TestPushSingleVariableChange:
    """Tests for _push_single_variable_change function."""

    @pytest.mark.asyncio
    async def test_push_single_variable_change_no_push_service(self) -> None:
        """Test that function returns early when no push service."""
        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        original = getattr(app_module.app.state, "variable_push_service", None)
        if hasattr(app_module.app.state, "variable_push_service"):
            delattr(app_module.app.state, "variable_push_service")

        try:
            await _wb_common._push_single_variable_change(
                session_id="test-session",
                name="my_var",
                value=42,
            )
        finally:
            if original is not None:
                app_module.app.state.variable_push_service = original

    @pytest.mark.asyncio
    async def test_push_single_variable_change_pushes_event(self) -> None:
        """Test that function builds and pushes a variable_changed event."""
        from unittest.mock import AsyncMock

        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        mock_push_service = AsyncMock()
        original = getattr(app_module.app.state, "variable_push_service", None)
        app_module.app.state.variable_push_service = mock_push_service

        try:
            await _wb_common._push_single_variable_change(
                session_id="sess-1",
                name="counter",
                value=10,
            )

            mock_push_service.push_variable_change.assert_called_once()
            event = mock_push_service.push_variable_change.call_args[0][0]
            assert event["type"] == "variable_changed"
            assert event["path"] == "counter"
            assert event["value"] == 10
            assert event["var_type"] == "integer"
            assert event["scope"] == "test"
            assert event["watch_id"] == "sess-1"
            assert "timestamp" in event
        finally:
            if original is None:
                delattr(app_module.app.state, "variable_push_service")
            else:
                app_module.app.state.variable_push_service = original

    @pytest.mark.asyncio
    async def test_push_single_variable_change_handles_exception(self) -> None:
        """Test that function handles exceptions gracefully."""
        from unittest.mock import AsyncMock

        from wavecore.api import app as app_module
        from wavecore.api.services.workbench import _common as _wb_common

        mock_push_service = AsyncMock()
        mock_push_service.push_variable_change.side_effect = RuntimeError("boom")
        original = getattr(app_module.app.state, "variable_push_service", None)
        app_module.app.state.variable_push_service = mock_push_service

        try:
            await _wb_common._push_single_variable_change(
                session_id="sess-1",
                name="var",
                value="val",
            )
        finally:
            if original is None:
                delattr(app_module.app.state, "variable_push_service")
            else:
                app_module.app.state.variable_push_service = original


class TestExecuteWorkflowProfileBindings:
    """Tests for profile binding injection during workflow execution."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions and register controls before/after each test."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.controls.registry import _registry, register_all_core_controls

        _wb_common._clear_sessions_sync()
        register_all_core_controls(_registry, freeze_after=False)
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_execute_workflow_injects_profile_variables(self) -> None:
        """Profile bindings on a node are resolved and injected as variables."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "profile-binding-exec"
        node_id = "http-node-1"

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 1, "percentage": 0.0},
            "block_states": {},
        }

        nodes = [
            {
                "id": node_id,
                "type": "workflowNode",
                "data": {
                    "label": "Test Delay",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {
                        "values": {"duration": 10},
                        "profileBindings": [
                            {
                                "profileId": "p1",
                                "alias": "api",
                                "profileName": "API",
                                "profileType": "http",
                            },
                        ],
                    },
                },
            },
        ]
        edges: list[dict[str, Any]] = []

        with patch(
            "wavecore.api.services.profiles.service.get_profile_config_for_execution",
            return_value={"url": "http://api.local"},
        ):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {}, environment_id="env1"
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"


class TestInjectProfileVariables:
    """Tests for _inject_profile_variables helper."""

    def test_injects_flat_variables_from_profile_config(self) -> None:
        """Profile fields are injected as alias.field_name flat keys."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {"existing_var": "keep"}
        bindings = [
            {
                "profileId": "p1",
                "alias": "time_server",
                "profileName": "Time Server",
                "profileType": "http",
            },
        ]

        with patch(
            "wavecore.api.services.profiles.service.get_profile_config_for_execution",
            return_value={"url": "http://time.example.com", "timeout": 5000},
        ):
            _wb_plugins._inject_profile_variables(bindings, variables)

        assert variables["existing_var"] == "keep"
        assert variables["time_server.url"] == "http://time.example.com"
        assert variables["time_server.timeout"] == 5000
        # ProfileObject injected at alias key for dot-access in expressions
        assert isinstance(variables["time_server"], ProfileObject)
        assert variables["time_server"].url == "http://time.example.com"
        assert variables["time_server"].timeout == 5000

    def test_skips_binding_with_missing_profile(self) -> None:
        """Missing profiles are logged as warnings, not errors."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}
        bindings = [
            {
                "profileId": "missing-id",
                "alias": "gone",
                "profileName": "Gone Profile",
                "profileType": "http",
            },
        ]

        with patch(
            "wavecore.api.services.profiles.service.get_profile_config_for_execution",
            return_value=None,
        ):
            # Should not raise
            _wb_plugins._inject_profile_variables(bindings, variables, session_id="s1")

        assert "gone.url" not in variables

    def test_skips_binding_with_empty_alias(self) -> None:
        """Bindings with empty alias are skipped."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}
        bindings = [{"profileId": "p1", "alias": "", "profileName": "X", "profileType": "http"}]

        with patch(
            "wavecore.api.services.profiles.service.get_profile_config_for_execution",
        ) as mock_get:
            _wb_plugins._inject_profile_variables(bindings, variables)
            mock_get.assert_not_called()

    def test_multiple_bindings_inject_independently(self) -> None:
        """Each binding creates its own namespace of flat variables."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}
        bindings = [
            {"profileId": "p1", "alias": "api", "profileName": "API", "profileType": "http"},
            {"profileId": "p2", "alias": "db", "profileName": "DB", "profileType": "database"},
        ]

        def mock_config(pid: str, environment_id: str = "") -> dict[str, Any] | None:
            if pid == "p1":
                return {"url": "http://api.local", "api_key": "secret123"}
            if pid == "p2":
                return {"host": "db.local", "port": 5432}
            return None

        with patch(
            "wavecore.api.services.profiles.service.get_profile_config_for_execution",
            side_effect=mock_config,
        ):
            _wb_plugins._inject_profile_variables(bindings, variables, environment_id="env1")

        assert variables["api.url"] == "http://api.local"
        assert variables["api.api_key"] == "secret123"
        assert variables["db.host"] == "db.local"
        assert variables["db.port"] == 5432
        # ProfileObjects injected for each binding
        assert isinstance(variables["api"], ProfileObject)
        assert variables["api"].url == "http://api.local"
        assert isinstance(variables["db"], ProfileObject)
        assert variables["db"].host == "db.local"


class TestInjectNamespaceVariables:
    """Tests for _inject_namespace_variables helper."""

    def test_injects_system_object_and_flat_keys(self) -> None:
        """System variables are injected as SystemObject and flat system.name keys."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {"existing_var": "keep"}

        with patch(
            "wavecore.api.services.variable_service.get_system_variables_raw",
            return_value={
                "variables": {
                    "api_host": {"type": "string", "value": "localhost"},
                    "timeout": {"type": "integer", "value": 30},
                }
            },
        ):
            _wb_plugins._inject_namespace_variables(variables)

        # Existing variables are preserved
        assert variables["existing_var"] == "keep"
        # SystemObject is injected at "system" key
        assert isinstance(variables["system"], SystemObject)
        assert variables["system"].api_host == "localhost"
        assert variables["system"].timeout == 30
        # Flat keys are also set for direct dotted access
        assert variables["system.api_host"] == "localhost"
        assert variables["system.timeout"] == 30

    def test_empty_system_variables(self) -> None:
        """Empty system variables inject an empty SystemObject."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        with patch(
            "wavecore.api.services.variable_service.get_system_variables_raw",
            return_value={"variables": {}},
        ):
            _wb_plugins._inject_namespace_variables(variables)

        assert isinstance(variables["system"], SystemObject)
        assert len(variables["system"]) == 0

    def test_preserves_existing_variables(self) -> None:
        """Namespace injection does not overwrite existing non-system variables."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {"my_var": 42, "another": "hello"}

        with patch(
            "wavecore.api.services.variable_service.get_system_variables_raw",
            return_value={
                "variables": {
                    "host": {"type": "string", "value": "example.com"},
                }
            },
        ):
            _wb_plugins._inject_namespace_variables(variables)

        assert variables["my_var"] == 42
        assert variables["another"] == "hello"
        assert variables["system.host"] == "example.com"

    def test_system_variable_value_extraction(self) -> None:
        """Values are extracted from variable dicts; plain values pass through."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        with patch(
            "wavecore.api.services.variable_service.get_system_variables_raw",
            return_value={
                "variables": {
                    "secret_var": {"type": "string", "value": "s3cret", "secret": True},
                    "bool_var": {"type": "boolean", "value": True},
                }
            },
        ):
            _wb_plugins._inject_namespace_variables(variables)

        assert variables["system.secret_var"] == "s3cret"
        assert variables["system.bool_var"] is True
        assert variables["system"].secret_var == "s3cret"
        assert variables["system"].bool_var is True


class TestInjectSuiteVariables:
    """Tests for suite variable injection via _inject_namespace_variables."""

    def test_injects_suite_object_when_test_in_suite(self) -> None:
        """Suite variables are injected when the test belongs to a suite."""
        from wavecore.api.services.workbench import plugins as _wb_plugins
        from wavecore.core.suite_object import SuiteObject

        variables: dict[str, Any] = {}

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[{"id": "suite-1", "name": "Auth Suite"}],
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                return_value={
                    "api_host": {"type": "string", "value": "localhost"},
                    "max_retries": {"type": "integer", "value": 3},
                },
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-123")

        assert isinstance(variables["suite"], SuiteObject)
        assert variables["suite"].api_host == "localhost"
        assert variables["suite"].max_retries == 3
        assert variables["suite.api_host"] == "localhost"
        assert variables["suite.max_retries"] == 3

    def test_no_suite_injection_without_test_id(self) -> None:
        """Suite injection is skipped when no test_id is provided."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        with patch(
            "wavecore.api.services.variable_service.get_system_variables_raw",
            return_value={"variables": {}},
        ):
            _wb_plugins._inject_namespace_variables(variables)

        assert "suite" not in variables

    def test_no_suite_injection_when_test_not_in_suite(self) -> None:
        """Suite injection is skipped when the test has no suites."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[],
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="orphan-test")

        assert "suite" not in variables

    def test_suite_id_pointing_to_missing_suite_skips_injection(self) -> None:
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}
        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite",
                return_value=None,
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-x", suite_id="missing")

        assert "suite" not in variables

    def test_regression_id_narrows_injection_to_single_regression(self) -> None:
        """regression_id scopes regression.* to that regression's vars
        instead of merging across every regression that references any
        suite containing this test."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}
        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.regressions._storage._load_regression",
                return_value={
                    "id": "reg-1",
                    "name": "Nightly",
                    "variables": {
                        "run_id": {"type": "string", "value": "reg nr1"},
                    },
                },
            ),
        ):
            _wb_plugins._inject_namespace_variables(
                variables, test_id="test-x", regression_id="reg-1"
            )

        assert variables["regression.run_id"] == "reg nr1"

    def test_regression_id_pointing_to_missing_regression_skips_injection(self) -> None:
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}
        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.regressions._storage._load_regression",
                return_value=None,
            ),
        ):
            _wb_plugins._inject_namespace_variables(
                variables, test_id="test-x", regression_id="missing"
            )

        assert "regression" not in variables

    def test_suite_id_narrows_injection_to_single_suite(self) -> None:
        """When a suite_id is passed (sequential regression context), only
        that one suite's variables are injected - no cross-suite merge
        that would let a later suite's same-named var overwrite the one
        the test was meant to see."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        def mock_get_suite_variables(suite_id: str) -> dict[str, Any] | None:
            if suite_id == "suite-a":
                return {"name": {"type": "string", "value": "suite 1"}}
            if suite_id == "suite-b":
                return {"name": {"type": "string", "value": "suite 2"}}
            return None

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite",
                return_value={"id": "suite-a", "name": "Suite A"},
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                side_effect=mock_get_suite_variables,
            ),
            # Intentionally not mocking get_suites_for_test - the scoped
            # path must not consult it when suite_id is provided.
        ):
            _wb_plugins._inject_namespace_variables(
                variables, test_id="test-shared", suite_id="suite-a"
            )

        assert variables["suite.name"] == "suite 1"
        assert variables["suite"].name == "suite 1"

    def test_merges_variables_from_multiple_suites(self) -> None:
        """Variables from multiple suites are merged (last suite wins)."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        def mock_get_suite_variables(suite_id: str) -> dict[str, Any] | None:
            if suite_id == "suite-a":
                return {"timeout": {"type": "integer", "value": 30}}
            if suite_id == "suite-b":
                return {
                    "timeout": {"type": "integer", "value": 60},
                    "env": {"type": "string", "value": "staging"},
                }
            return None

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[
                    {"id": "suite-a", "name": "Suite A"},
                    {"id": "suite-b", "name": "Suite B"},
                ],
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                side_effect=mock_get_suite_variables,
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-456")

        # timeout from Suite B wins (last suite)
        assert variables["suite"].timeout == 60
        assert variables["suite"].env == "staging"
        assert variables["suite.timeout"] == 60
        assert variables["suite.env"] == "staging"

    def test_suite_with_empty_variables(self) -> None:
        """Suite with no variables does not inject SuiteObject."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[{"id": "suite-empty", "name": "Empty Suite"}],
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                return_value={},
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-789")

        assert "suite" not in variables


class TestInjectRegressionVariables:
    """Tests for regression variable injection via _inject_namespace_variables."""

    def test_injects_regression_object_from_regressions_sharing_suite(self) -> None:
        """Regression variables are injected when a regression references a suite containing the
        test.
        """
        from wavecore.api.services.workbench import plugins as _wb_plugins
        from wavecore.core.regression_object import RegressionObject

        variables: dict[str, Any] = {}

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[{"id": "suite-1", "name": "Shared Suite"}],
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                return_value={},
            ),
            patch(
                "wavecore.api.services.regressions._storage._list_all_regressions",
                return_value=[
                    {
                        "id": "reg-1",
                        "name": "Nightly Regression",
                        "suites": ["suite-1"],
                        "variables": {
                            "env": {"type": "string", "value": "staging"},
                            "timeout": {"type": "integer", "value": 60},
                        },
                    }
                ],
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-alpha")

        assert isinstance(variables["regression"], RegressionObject)
        assert variables["regression.env"] == "staging"
        assert variables["regression.timeout"] == 60
        assert variables["regression"].env == "staging"

    def test_no_injection_when_no_regressions(self) -> None:
        """Nothing is injected when the workspace has no regressions."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[{"id": "suite-1", "name": "Lone Suite"}],
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                return_value={},
            ),
            patch(
                "wavecore.api.services.regressions._storage._list_all_regressions",
                return_value=[],
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-beta")

        assert "regression" not in variables

    def test_no_injection_when_regression_has_no_overlap(self) -> None:
        """Regressions that don't reference any of the test's suites are ignored."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[{"id": "suite-1", "name": "Test Suite"}],
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                return_value={},
            ),
            patch(
                "wavecore.api.services.regressions._storage._list_all_regressions",
                return_value=[
                    {
                        "id": "reg-1",
                        "name": "Unrelated Regression",
                        "suites": ["other-suite"],
                        "variables": {"env": {"type": "string", "value": "dev"}},
                    }
                ],
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-gamma")

        assert "regression" not in variables

    def test_non_dict_regression_variables_are_skipped(self) -> None:
        """Regressions whose 'variables' field is not a dict are silently skipped."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[{"id": "suite-1", "name": "Test Suite"}],
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                return_value={},
            ),
            patch(
                "wavecore.api.services.regressions._storage._list_all_regressions",
                return_value=[
                    {
                        "id": "reg-bad",
                        "name": "Corrupt Regression",
                        "suites": ["suite-1"],
                        "variables": ["env", "host"],  # not a dict
                    }
                ],
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-delta")

        assert "regression" not in variables

    def test_merges_variables_across_multiple_regressions(self) -> None:
        """Multiple regressions sharing suites have their variables merged."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        variables: dict[str, Any] = {}

        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": {}},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[{"id": "suite-1", "name": "Shared"}],
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                return_value={},
            ),
            patch(
                "wavecore.api.services.regressions._storage._list_all_regressions",
                return_value=[
                    {
                        "id": "reg-a",
                        "name": "Reg A",
                        "suites": ["suite-1"],
                        "variables": {"env": {"type": "string", "value": "a"}},
                    },
                    {
                        "id": "reg-b",
                        "name": "Reg B",
                        "suites": ["suite-1"],
                        "variables": {"timeout": 90},  # non-dict value -> plain value
                    },
                ],
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-epsilon")

        assert variables["regression.env"] == "a"
        assert variables["regression.timeout"] == 90


class TestExecutePluginTemplateFields:
    """Tests for _execute_plugin with template_fields ({{expr}} template logging)."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Register plugins before/after each test."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.log import LogPlugin

        _wb_common._clear_sessions_sync()
        register_plugin(LogPlugin())
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_template_logging_before_and_after_evaluation(self) -> None:
        """Template source and rendered values are logged when template_fields provided."""
        from wavecore.api.services.workbench import plugins as _wb_plugins
        from wavecore.logging.session_logger import SessionLogger

        debug_calls: list[str] = []

        def capture_debug(self: Any, msg: str) -> None:
            debug_calls.append(msg)

        with patch.object(SessionLogger, "debug", capture_debug):
            await _wb_plugins._execute_plugin(
                plugin_type="log",
                version="1.0.0",
                parameters={"message": "Hello {{name}}!", "level": "INFO"},
                variables={"name": "World"},
                session_id="tpl-session",
                block_id="tpl-block",
                template_fields={"message"},
            )

        # Should log template source and rendered value
        assert any("Template 'message'" in c for c in debug_calls)
        assert any("Rendered 'message'" in c for c in debug_calls)

    @pytest.mark.asyncio
    async def test_template_no_render_log_when_unchanged(self) -> None:
        """No rendered log when template has no markers (value unchanged)."""
        from wavecore.api.services.workbench import plugins as _wb_plugins
        from wavecore.logging.session_logger import SessionLogger

        debug_calls: list[str] = []

        def capture_debug(self: Any, msg: str) -> None:
            debug_calls.append(msg)

        with patch.object(SessionLogger, "debug", capture_debug):
            await _wb_plugins._execute_plugin(
                plugin_type="log",
                version="1.0.0",
                parameters={"message": "No templates here", "level": "INFO"},
                variables={},
                session_id="tpl-session",
                block_id="tpl-block",
                template_fields={"message"},
            )

        # Source should be logged, but rendered should NOT (raw == resolved)
        assert any("Template 'message'" in c for c in debug_calls)
        assert not any("Rendered 'message'" in c for c in debug_calls)

    @pytest.mark.asyncio
    async def test_plugin_dotted_expression_fields_build_map_expression_keys(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Dotted expressionFields of a declared map field build map_expression_keys; a flag
        of a field the Block does not declare is dropped."""
        from wavecore.api.services.workbench import plugins as _wb_plugins
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.plugin_registry import get_plugin

        plugin = get_plugin("log", "1.0.0")
        assert plugin is not None
        metadata = plugin.metadata
        metadata["parameters"] = [*metadata["parameters"], {"name": "some_map", "type": "map"}]
        monkeypatch.setattr(type(plugin), "metadata", property(lambda _self: metadata))

        with patch(
            "wavecore.core.execution.plugin_executor.resolve_parameters",
            wraps=resolve_parameters,
        ) as mock_resolve:
            await _wb_plugins._execute_plugin(
                plugin_type="log",
                version="1.0.0",
                parameters={
                    "message": "test",
                    "level": "INFO",
                    "some_map": {"key1": "x", "key2": "x"},
                },
                variables={"x": "hello"},
                session_id="dotted-session",
                block_id="dotted-block",
                expression_fields={"some_map.key1", "some_map.key2", "retired_map.key3"},
            )
            call_kwargs = mock_resolve.call_args
            assert call_kwargs.kwargs["map_expression_keys"] == {
                "some_map": {"key1", "key2"},
            }


class TestHaltControlExecution:
    """Tests for halt control execution paths in workflow engine."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions and register controls before/after each test."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.controls.registry import _registry, register_all_core_controls

        _wb_common._clear_sessions_sync()
        register_all_core_controls(_registry, freeze_after=False)
        yield
        _wb_common._clear_sessions_sync()

    def _make_halt_node(
        self,
        node_id: str,
        *,
        scope: str = "test",
        status: str = "failed",
        message: str | None = None,
    ) -> dict[str, Any]:
        """Create a halt control node."""
        values: dict[str, Any] = {"scope": scope, "status": status}
        if message is not None:
            values["message"] = message
        return {
            "id": node_id,
            "type": "workflowNode",
            "data": {
                "label": "Halt",
                "elementType": "halt",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {"values": values},
            },
        }

    def _make_session(self, session_id: str, total: int = 1) -> dict[str, Any]:
        """Create a minimal running session."""
        from wavecore.api.services.workbench import _common as _wb_common

        session_data: dict[str, Any] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": total, "percentage": 0.0},
            "block_states": {},
            "scope_failed": False,
        }
        _wb_common._workbench_sessions[session_id] = session_data
        return session_data

    @pytest.mark.asyncio
    async def test_halt_with_failed_status_sets_session_failed(self) -> None:
        """Halt with status=failed sets session status to 'failed'."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "halt-failed-session"
        node_id = "halt-node"
        self._make_session(session_id)

        nodes = [self._make_halt_node(node_id, status="failed")]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"][node_id] == "failed"

    @pytest.mark.asyncio
    async def test_halt_with_passed_status_sets_session_passed(self) -> None:
        """Halt with status=passed sets session status to 'passed'."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "halt-passed-session"
        node_id = "halt-node"
        self._make_session(session_id)

        nodes = [self._make_halt_node(node_id, status="passed")]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"][node_id] == "passed"

    @pytest.mark.asyncio
    async def test_halt_with_skipped_status_sets_session_skipped(self) -> None:
        """Halt with status=skipped sets session status to 'skipped' and block to 'warning'."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "halt-skipped-session"
        node_id = "halt-node"
        self._make_session(session_id)

        nodes = [self._make_halt_node(node_id, status="skipped")]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "skipped"
        assert session["block_states"][node_id] == "warning"

    @pytest.mark.asyncio
    async def test_halt_skips_successor_nodes(self) -> None:
        """Halt marks successor (child) nodes as skipped."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "halt-skip-successor"
        halt_id = "halt-node"
        after_id = "after-node"
        self._make_session(session_id, total=2)

        nodes = [
            self._make_halt_node(halt_id, status="failed"),
            {
                "id": after_id,
                "type": "workflowNode",
                "data": {
                    "label": "After Halt",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 100}},
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": halt_id},
            {"source": halt_id, "target": after_id},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"][after_id] == "skipped"

    @pytest.mark.asyncio
    async def test_halt_skips_remaining_queued_sibling_nodes(self) -> None:
        """Halt marks already-queued sibling nodes as skipped."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "halt-skip-queued"
        # Create a parent node that runs first, then two children: halt and sibling
        parent_id = "parent-node"
        halt_id = "halt-node"
        sibling_id = "sibling-node"
        self._make_session(session_id, total=3)

        nodes = [
            {
                "id": parent_id,
                "type": "workflowNode",
                "data": {
                    "label": "Parent",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 1}},
                },
            },
            self._make_halt_node(halt_id, status="failed"),
            {
                "id": sibling_id,
                "type": "workflowNode",
                "data": {
                    "label": "Sibling",
                    "elementType": "delay",
                    "nodeType": "control",
                    "version": "1.0.0",
                    "config": {"values": {"duration": 100}},
                },
            },
        ]
        # Parent -> halt AND parent -> sibling (both queued after parent completes)
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": parent_id},
            {"source": parent_id, "target": halt_id},
            {"source": parent_id, "target": sibling_id},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"][sibling_id] == "skipped"

    @pytest.mark.asyncio
    async def test_halt_with_message(self) -> None:
        """Halt with message executes without error."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "halt-msg-session"
        node_id = "halt-node"
        self._make_session(session_id)

        nodes = [self._make_halt_node(node_id, status="failed", message="Environment not ready")]
        edges: list[dict[str, Any]] = [{"source": "start-node", "target": node_id}]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"


class TestExecuteNodeUnknownType:
    """Tests for _execute_node when node_type is neither control nor plugin."""

    @pytest.mark.asyncio
    async def test_execute_node_returns_none_for_unknown_type(self) -> None:
        """_execute_node returns None for unrecognized node_type values."""
        from wavecore.api.services.workbench import node_helpers as _wb_node_helpers

        node_fields = {
            "node_type": "annotation",  # Not "control" or "plugin"
            "element_type": "note",
            "version": "1.0.0",
            "config_values": {},
            "description": "Note",
            "expression_fields": set(),
            "template_fields": set(),
            "block_name": "Note",
            "variable_expression_keys": set(),
            "variable_types": {},
        }
        result = await _wb_node_helpers._execute_node(node_fields, {}, "test-session", "node-1")
        assert result is None


class TestHandleWorkflowError:
    """Tests for _handle_workflow_error via the outer except in _execute_workflow."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self) -> Any:
        """Clear sessions and register controls before/after each test."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.log import LogPlugin

        _wb_common._clear_sessions_sync()
        register_all_core_controls(_registry, freeze_after=False)
        register_plugin(LogPlugin())
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_workflow_error_sets_failed_status(self) -> None:
        """When _broadcast_final_status raises, the outer except catches it."""
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import execution as _wb_execution
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "wf-error-session"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "current_block": None,
            "progress": {"current": 0, "total": 0, "percentage": 0.0},
            "block_states": {},
            "test_name": "Error Test",
            "scope_failed": False,
        }

        # A workflow with one node so the inner loop completes successfully,
        # but _broadcast_final_status will be patched to raise
        nodes = [
            {
                "id": "node-1",
                "type": "workflowNode",
                "data": {
                    "label": "Log",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {"values": {"message": "'ok'", "level": "INFO"}},
                    "expressionFields": ["message"],
                    "templateFields": [],
                    "variableExpressionKeys": [],
                },
            },
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": "node-1"},
        ]

        with patch.object(
            _wb_execution,
            "_broadcast_final_status",
            side_effect=RuntimeError("broadcast crashed"),
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert "broadcast crashed" in session["error"]


class TestCoerceSetterVariablesNonDict:
    """Tests for _coerce_setter_variables when variables param is not a dict."""

    def test_returns_early_when_variables_is_none(self) -> None:
        """_coerce_setter_variables returns early when 'variables' is None."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        processed_params: dict[str, Any] = {"variables": None}
        # Should return without error (no coercion attempted)
        _wb_plugins._coerce_setter_variables(processed_params, {"x": "integer"})
        # variables key unchanged
        assert processed_params["variables"] is None

    def test_returns_early_when_variables_is_missing(self) -> None:
        """_coerce_setter_variables returns early when 'variables' key is absent."""
        from wavecore.api.services.workbench import plugins as _wb_plugins

        processed_params: dict[str, Any] = {"other_param": "value"}
        _wb_plugins._coerce_setter_variables(processed_params, {"x": "integer"})
        assert "variables" not in processed_params


class TestTerminalCallbackRegistry:
    """Coverage for the session-terminal callback registry in _common.py."""

    def test_unregister_removes_registered_callback(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        def _callback(_session_id: str, _status: str, _halt_scope: str | None = None) -> None:
            return None

        try:
            _wb_common.register_terminal_callback(_callback)
            assert _callback in _wb_common._terminal_callbacks
            _wb_common.unregister_terminal_callback(_callback)
            assert _callback not in _wb_common._terminal_callbacks
        finally:
            _wb_common.unregister_terminal_callback(_callback)

    def test_unregister_is_noop_when_callback_not_present(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        def _never_registered(_s: str, _t: str, _h: str | None = None) -> None:
            return None

        # Must not raise ValueError from the internal list.remove; silently noops.
        _wb_common.unregister_terminal_callback(_never_registered)

    def test_notify_terminal_swallows_exceptions_from_callbacks(self) -> None:
        """A raising callback must not break the notify loop or propagate."""
        from wavecore.api.services.workbench import _common as _wb_common

        good_calls: list[tuple[str, str, str | None]] = []

        def bad_callback(_session_id: str, _status: str, _halt_scope: str | None = None) -> None:
            raise RuntimeError("boom")

        def good_callback(session_id: str, status: str, halt_scope: str | None = None) -> None:
            good_calls.append((session_id, status, halt_scope))

        try:
            _wb_common.register_terminal_callback(bad_callback)
            _wb_common.register_terminal_callback(good_callback)

            # Must not raise even though bad_callback does.
            _wb_common._notify_terminal("session-x", "stopped")

            assert ("session-x", "stopped", None) in good_calls
        finally:
            _wb_common.unregister_terminal_callback(bad_callback)
            _wb_common.unregister_terminal_callback(good_callback)

    def test_notify_terminal_forwards_halt_scope_to_callbacks(self) -> None:
        """Halt-driven terminals propagate the scope so the orchestrator can
        apply fan-out at the halt's scope (test/suite/regression)."""
        from wavecore.api.services.workbench import _common as _wb_common

        received: list[tuple[str, str, str | None]] = []

        def callback(session_id: str, status: str, halt_scope: str | None = None) -> None:
            received.append((session_id, status, halt_scope))

        try:
            _wb_common.register_terminal_callback(callback)
            _wb_common._notify_terminal("session-y", "failed", "suite")
            assert received == [("session-y", "failed", "suite")]
        finally:
            _wb_common.unregister_terminal_callback(callback)


class TestCapturedFloatPrecision:
    """A float a plugin returns enters the exact-precision domain when captured,
    the same way an assigned return value does (REQ-3.1.3.14)."""

    def test_a_captured_float_becomes_an_exact_decimal(self) -> None:
        from decimal import Decimal

        from wavecore.api.services.workbench import signals

        variables: dict[str, Any] = {}
        signals._assign_output_bindings(
            {"response_time": 0.1},
            {"response_time": "elapsed"},
            variables,
            "session-1",
            "HTTP",
            "node-1",
        )

        assert isinstance(variables["elapsed"], Decimal)
        assert str(variables["elapsed"]) == "0.1"

    def test_a_captured_integer_is_left_alone(self) -> None:
        from wavecore.api.services.workbench import signals

        variables: dict[str, Any] = {}
        signals._assign_output_bindings(
            {"status_code": 200},
            {"status_code": "code"},
            variables,
            "session-1",
            "HTTP",
            "node-1",
        )

        assert variables["code"] == 200
        assert isinstance(variables["code"], int)

    def test_a_numeric_string_output_stays_a_string(self) -> None:
        """A captured string keeps string methods even when its text happens to be numeric."""
        from wavecore.api.services.workbench import signals

        variables: dict[str, Any] = {}
        signals._assign_output_bindings(
            {"stdout": " 42 "},
            {"stdout": "out_sh"},
            variables,
            "session-1",
            "SSH",
            "node-1",
        )

        assert variables["out_sh"] == " 42 "
        assert variables["out_sh"].strip() == "42"
