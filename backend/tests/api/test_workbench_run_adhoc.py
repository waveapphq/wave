"""Unit tests for ad-hoc Workbench Run fields.

REQ-3.2.1.5 (Ad-hoc block execution) extends the existing
``WorkbenchRunRequest`` Pydantic model with two optional, mutually-exclusive
fields:

    - ``start_node_id: str | None``: Engine entry-point override. Traversal
      starts at this node and continues through every reachable downstream
      node until the workflow drains. Pre-start nodes never execute.
    - ``single_node_id: str | None``: Bounded sub-tree execution. Only the
      target node and its structural sub-tree (per ``_compute_subtree_boundary``)
      execute; outgoing edges that LEAVE the sub-tree are pruned.

Both ``None`` = full traversal from Start (pre-existing behavior).

Validation paths under test:

    - Both fields set on the same request rejects with HTTP 400 and
      the exact, anchored message ``start_node_id and single_node_id are
      mutually exclusive``. (The codebase-wide ``validation_exception_handler``
      converts FastAPI's default 422 to 400 with a ``{"success", "error"}``
      envelope; the asserted message lives in ``error.message``.)
    - ``single_node_id`` whose target is a Break, Continue, or Note
      node rejects with HTTP 400 and exact message
      ``single_node_id targets a non-runnable block type``.
    - ``start_node_id`` or ``single_node_id`` not present in the
      workflow rejects with HTTP 404 and exact message
      ``block not found in workflow``.

End-to-end engine wiring tests verify that the service forwards the new
fields to the engine entry point and that ephemeral session creation
follows the existing path (no execution-store side effects).
"""

import asyncio
import re
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ValidationException
from wavecore.api.services.workbench import _common as _wb_common

_MUTUALLY_EXCLUSIVE_RE = r"^start_node_id and single_node_id are mutually exclusive$"
_NON_RUNNABLE_RE = r"^single_node_id targets a non-runnable block type$"
_NODE_NOT_FOUND_RE = r"^block not found in workflow$"


# ---------------------------------------------------------------------------
# Endpoint-level tests (POST /workbench/run)
# ---------------------------------------------------------------------------


class TestWorkbenchRunAdhocEndpointPayload:
    """Request payload shape: new fields are accepted and forwarded."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def test_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture
    def environment_id(self) -> str:
        return str(uuid.uuid4())

    def test_run_with_start_node_id_only_forwards_field(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """``start_node_id`` alone is accepted and forwarded to the service."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            session_id = str(uuid.uuid4())
            mock_run.return_value = {
                "session_id": session_id,
                "status": "running",
                "websocket_topic": f"workbench:{session_id}",
                "warnings": [],
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "start_node_id": "node-mid",
                },
            )

            assert response.status_code == 200
            from wavecore.api.services.workbench import service as workbench_service

            mock_run.assert_called_once()
            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs["target"] == workbench_service.RunTarget(start_node_id="node-mid")

    def test_run_with_single_node_id_only_forwards_field(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """``single_node_id`` alone is accepted and forwarded to the service."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            session_id = str(uuid.uuid4())
            mock_run.return_value = {
                "session_id": session_id,
                "status": "running",
                "websocket_topic": f"workbench:{session_id}",
                "warnings": [],
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "single_node_id": "node-target",
                },
            )

            assert response.status_code == 200
            from wavecore.api.services.workbench import service as workbench_service

            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs["target"] == workbench_service.RunTarget(
                single_node_id="node-target"
            )

    def test_run_with_neither_field_omits_both_in_call(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """Plain run (no ad-hoc fields) forwards None for both new fields."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            session_id = str(uuid.uuid4())
            mock_run.return_value = {
                "session_id": session_id,
                "status": "running",
                "websocket_topic": f"workbench:{session_id}",
                "warnings": [],
            }

            response = client.post(
                "/workbench/run",
                json={"test_id": test_id, "environment_id": environment_id},
            )

            assert response.status_code == 200
            from wavecore.api.services.workbench import service as workbench_service

            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs["target"] == workbench_service.RunTarget()

    def test_run_with_start_node_id_composes_with_breakpoints_and_debug_options(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """The ad-hoc fields compose with the existing debug-mode fields."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            session_id = str(uuid.uuid4())
            mock_run.return_value = {
                "session_id": session_id,
                "status": "running",
                "websocket_topic": f"workbench:{session_id}",
                "warnings": [],
                "breakpoints": [],
                "debug_options": {"pause_on_first_block": True, "pause_on_errors": False},
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "start_node_id": "node-mid",
                    "breakpoints": [],
                    "debug_options": {"pause_on_first_block": True, "pause_on_errors": False},
                },
            )

            assert response.status_code == 200
            from wavecore.api.services.workbench import service as workbench_service

            mock_run.assert_called_once_with(
                test_id=test_id,
                environment_id=environment_id,
                session_id=None,
                skipped_node_ids=None,
                debug=workbench_service.DebugRunOptions(
                    breakpoints=[],
                    options={"pause_on_first_block": True, "pause_on_errors": False},
                ),
                target=workbench_service.RunTarget(start_node_id="node-mid"),
                scope=workbench_service.ScopedRunOptions(mode="test", function_node_id=None),
                workflow=None,
                variables=None,
                function_variables=[],
            )

    def test_run_with_function_path_forwards_the_path_of_the_drilled_canvas(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """A target inside a Function body is named by its instance path plus its node id."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            session_id = str(uuid.uuid4())
            mock_run.return_value = {
                "session_id": session_id,
                "status": "running",
                "websocket_topic": f"workbench:{session_id}",
                "warnings": [],
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "single_node_id": "body-log",
                    "function_path": ["outer-fn", "inner-fn"],
                },
            )

            assert response.status_code == 200
            from wavecore.api.services.workbench import service as workbench_service

            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs["target"] == workbench_service.RunTarget(single_node_id="body-log")
            assert call_kwargs["scope"] == workbench_service.ScopedRunOptions(
                mode="test", function_node_id=None, function_path=("outer-fn", "inner-fn")
            )


class TestWorkbenchRunAdhocMutualExclusion:
    """``start_node_id`` and ``single_node_id`` are mutually exclusive."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def test_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture
    def environment_id(self) -> str:
        return str(uuid.uuid4())

    def test_both_fields_set_returns_400_with_exact_message(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """Both fields set produces 400 with the exact anchored message."""
        response = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": environment_id,
                "start_node_id": "node-a",
                "single_node_id": "node-b",
            },
        )

        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert re.match(
            _MUTUALLY_EXCLUSIVE_RE, body["error"]["message"]
        ), f"Expected anchored mutual-exclusion message, got: {body['error']['message']!r}"

    def test_both_fields_set_does_not_call_service(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """Mutual-exclusion rejection happens before the service is invoked."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "start_node_id": "node-a",
                    "single_node_id": "node-b",
                },
            )

            mock_run.assert_not_called()


class TestWorkbenchRunAdhocBlockedNodeTypes:
    """``single_node_id`` targeting Break / Continue / Note rejects."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def test_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture
    def environment_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.mark.parametrize("blocked_element", ["break", "continue", "note"])
    def test_single_node_id_targeting_blocked_element_returns_400(
        self,
        client: TestClient,
        test_id: str,
        environment_id: str,
        blocked_element: str,
    ) -> None:
        """Break/Continue/Note are non-runnable for single-node execution."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.side_effect = ValidationException(
                "single_node_id targets a non-runnable block type"
            )

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "single_node_id": f"{blocked_element}-node-id",
                },
            )

            assert response.status_code == 400
            body = response.json()
            assert body["success"] is False
            assert re.match(
                _NON_RUNNABLE_RE, body["error"]["message"]
            ), f"Expected anchored non-runnable message, got: {body['error']['message']!r}"


class TestWorkbenchRunAdhocNodeNotFound:
    """Unknown ``start_node_id`` or ``single_node_id`` returns 404."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def test_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture
    def environment_id(self) -> str:
        return str(uuid.uuid4())

    def test_unknown_start_node_id_returns_404(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.side_effect = LookupError("block not found in workflow")

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "start_node_id": "ghost-node",
                },
            )

            assert response.status_code == 404
            body = response.json()
            assert body["success"] is False
            assert re.match(
                _NODE_NOT_FOUND_RE, body["error"]["message"]
            ), f"Expected anchored node-not-found message, got: {body['error']['message']!r}"

    def test_unknown_single_node_id_returns_404(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.side_effect = LookupError("block not found in workflow")

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "single_node_id": "ghost-node",
                },
            )

            assert response.status_code == 404
            body = response.json()
            assert body["success"] is False
            assert re.match(_NODE_NOT_FOUND_RE, body["error"]["message"])


# ---------------------------------------------------------------------------
# Service-level tests (start_workbench_run forwards to engine + validates)
# ---------------------------------------------------------------------------


def _log_node(node_id: str, label: str = "Log", message: str = "'ok'") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _control_node(node_id: str, element_type: str, label: str = "") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label or element_type,
            "elementType": element_type,
            "nodeType": "control",
            "version": "1.0.0",
            "config": {"values": {}, "profileBindings": []},
            "disabled": False,
            "displayName": label or element_type,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _make_test_record(
    test_id: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "id": test_id,
        "name": "Ad-hoc Test",
        "workflow": {"nodes": nodes, "edges": edges},
        "variables": {},
    }


class TestStartWorkbenchRunMutualExclusion:
    """Service rejects mutual-exclusion violation before constructing a session."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        _wb_common._clear_sessions_sync()
        with patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task:
            mock_task.return_value = Mock()
            yield mock_task
        _wb_common._clear_sessions_sync()

    @pytest.fixture
    def test_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture
    def environment_id(self) -> str:
        return str(uuid.uuid4())

    def test_both_fields_set_raises_validation_exception_with_exact_message(
        self, test_id: str, environment_id: str
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        with pytest.raises(ValidationException) as exc_info:
            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                target=workbench_service.RunTarget(start_node_id="node-a", single_node_id="node-b"),
            )

        assert re.match(
            _MUTUALLY_EXCLUSIVE_RE, str(exc_info.value)
        ), f"Expected anchored mutual-exclusion message, got: {exc_info.value!r}"


class TestStartWorkbenchRunBlockedNodeTypes:
    """Service rejects ``single_node_id`` targeting Break/Continue/Note."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        _wb_common._clear_sessions_sync()
        with patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task:
            mock_task.return_value = Mock()
            yield mock_task
        _wb_common._clear_sessions_sync()

    @pytest.fixture
    def test_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture
    def environment_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.mark.parametrize("blocked_element", ["break", "continue", "note"])
    def test_blocked_element_type_raises_validation_exception(
        self,
        test_id: str,
        environment_id: str,
        blocked_element: str,
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        nodes = [
            _control_node("blocked-1", element_type=blocked_element),
            _log_node("after"),
        ]
        edges = [
            {"source": "start-node", "target": "blocked-1"},
            {"source": "blocked-1", "target": "after"},
        ]
        test_record = _make_test_record(test_id, nodes, edges)
        environment = {"id": environment_id, "name": "Env"}

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test"
            ) as mock_validate,
        ):
            mock_get_test.return_value = test_record
            mock_get_env.return_value = environment
            mock_validate.return_value = {"fatal": False, "errors": [], "warnings": []}

            with pytest.raises(ValidationException) as exc_info:
                workbench_service.start_workbench_run(
                    test_id=test_id,
                    environment_id=environment_id,
                    target=workbench_service.RunTarget(single_node_id="blocked-1"),
                )

            assert re.match(_NON_RUNNABLE_RE, str(exc_info.value)), (
                f"Expected anchored non-runnable message for "
                f"{blocked_element!r}, got: {exc_info.value!r}"
            )


class TestStartWorkbenchRunNodeNotFound:
    """Service rejects unknown node ids with anchored ``block not found in workflow``."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        _wb_common._clear_sessions_sync()
        with patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task:
            mock_task.return_value = Mock()
            yield mock_task
        _wb_common._clear_sessions_sync()

    @pytest.fixture
    def test_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture
    def environment_id(self) -> str:
        return str(uuid.uuid4())

    def test_unknown_start_node_id_raises_lookup_error_with_exact_message(
        self, test_id: str, environment_id: str
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        nodes = [_log_node("known-node")]
        edges = [{"source": "start-node", "target": "known-node"}]
        test_record = _make_test_record(test_id, nodes, edges)
        environment = {"id": environment_id, "name": "Env"}

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test"
            ) as mock_validate,
        ):
            mock_get_test.return_value = test_record
            mock_get_env.return_value = environment
            mock_validate.return_value = {"fatal": False, "errors": [], "warnings": []}

            with pytest.raises(LookupError) as exc_info:
                workbench_service.start_workbench_run(
                    test_id=test_id,
                    environment_id=environment_id,
                    target=workbench_service.RunTarget(start_node_id="ghost-node"),
                )

            assert re.match(_NODE_NOT_FOUND_RE, str(exc_info.value))

    def test_unknown_single_node_id_raises_lookup_error_with_exact_message(
        self, test_id: str, environment_id: str
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        nodes = [_log_node("known-node")]
        edges = [{"source": "start-node", "target": "known-node"}]
        test_record = _make_test_record(test_id, nodes, edges)
        environment = {"id": environment_id, "name": "Env"}

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test"
            ) as mock_validate,
        ):
            mock_get_test.return_value = test_record
            mock_get_env.return_value = environment
            mock_validate.return_value = {"fatal": False, "errors": [], "warnings": []}

            with pytest.raises(LookupError) as exc_info:
                workbench_service.start_workbench_run(
                    test_id=test_id,
                    environment_id=environment_id,
                    target=workbench_service.RunTarget(single_node_id="ghost-node"),
                )

            assert re.match(_NODE_NOT_FOUND_RE, str(exc_info.value))


class TestStartWorkbenchRunForwardsAdhocFieldsToEngine:
    """Service threads ad-hoc fields through to ``_execute_workflow``."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.fixture
    def test_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture
    def environment_id(self) -> str:
        return str(uuid.uuid4())

    def test_start_node_id_forwarded_to_execute_workflow(
        self, test_id: str, environment_id: str
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        nodes = [
            _log_node("node-a"),
            _log_node("node-b"),
            _log_node("node-c"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
            {"source": "node-b", "target": "node-c"},
        ]
        test_record = _make_test_record(test_id, nodes, edges)
        environment = {"id": environment_id, "name": "Env"}

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test"
            ) as mock_validate,
            patch(
                "wavecore.api.services.workbench.service._execute_workflow",
                new_callable=AsyncMock,
            ) as mock_execute,
            patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task,
        ):
            mock_get_test.return_value = test_record
            mock_get_env.return_value = environment
            mock_validate.return_value = {"fatal": False, "errors": [], "warnings": []}
            mock_task.return_value = Mock()

            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                target=workbench_service.RunTarget(start_node_id="node-b"),
            )

            assert mock_task.called
            assert mock_execute.call_args.kwargs.get("start_node_id") == "node-b"
            assert mock_execute.call_args.kwargs.get("single_node_id") is None

    def test_single_node_id_forwarded_to_execute_workflow(
        self, test_id: str, environment_id: str
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        nodes = [_log_node("node-a"), _log_node("node-b")]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
        ]
        test_record = _make_test_record(test_id, nodes, edges)
        environment = {"id": environment_id, "name": "Env"}

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test"
            ) as mock_validate,
            patch(
                "wavecore.api.services.workbench.service._execute_workflow",
                new_callable=AsyncMock,
            ) as mock_execute,
            patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task,
        ):
            mock_get_test.return_value = test_record
            mock_get_env.return_value = environment
            mock_validate.return_value = {"fatal": False, "errors": [], "warnings": []}
            mock_task.return_value = Mock()

            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                target=workbench_service.RunTarget(single_node_id="node-a"),
            )

            assert mock_execute.call_args.kwargs.get("single_node_id") == "node-a"
            assert mock_execute.call_args.kwargs.get("start_node_id") is None

    def test_neither_field_set_forwards_none_for_both(
        self, test_id: str, environment_id: str
    ) -> None:
        """Default full-traversal preserves None for both new fields."""
        from wavecore.api.services.workbench import service as workbench_service

        nodes = [_log_node("node-a")]
        edges = [{"source": "start-node", "target": "node-a"}]
        test_record = _make_test_record(test_id, nodes, edges)
        environment = {"id": environment_id, "name": "Env"}

        with (
            patch("wavecore.api.services.workbench.service.test_service.get_test") as mock_get_test,
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment"
            ) as mock_get_env,
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test"
            ) as mock_validate,
            patch(
                "wavecore.api.services.workbench.service._execute_workflow",
                new_callable=AsyncMock,
            ) as mock_execute,
            patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task,
        ):
            mock_get_test.return_value = test_record
            mock_get_env.return_value = environment
            mock_validate.return_value = {"fatal": False, "errors": [], "warnings": []}
            mock_task.return_value = Mock()

            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
            )

            assert mock_execute.call_args.kwargs.get("start_node_id") is None
            assert mock_execute.call_args.kwargs.get("single_node_id") is None


# ---------------------------------------------------------------------------
# Engine-level tests: single_node_id execution boundary
# ---------------------------------------------------------------------------


class TestExecuteWorkflowSingleNodeBoundary:
    """``single_node_id`` execution: only the bounded sub-tree runs."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_single_atomic_node_executes_only_target(self) -> None:
        """Atomic Log plugin: only the target's status changes."""
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "adhoc-single-atomic"
        session: dict[str, Any] = {
            "session_id": session_id,
            "status": "running",
            "test_name": "Adhoc Single",
            "current_block": None,
            "progress": {"current": 0, "total": 0, "percentage": 0.0},
            "block_states": {},
            "scope_failed": False,
            "breakpoints": set(),
            "debug_options": None,
            "pause_event": asyncio.Event(),
            "paused_node_id": None,
        }
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "A", "'a'"),
            _log_node("node-b", "B", "'b'"),
            _log_node("node-c", "C", "'c'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
            {"source": "node-b", "target": "node-c"},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {},
            single_node_id="node-b",
        )

        assert session["block_states"].get("node-b") == "passed"
        assert "node-a" not in session["block_states"]
        assert "node-c" not in session["block_states"]

    @pytest.mark.asyncio
    async def test_single_for_loop_executes_target_and_body_only(self) -> None:
        """Composite single-egress For-loop: target + body iterations only.

        After-loop sibling stays untouched; pre-loop sibling stays untouched.
        """
        from wavecore.api.services.workbench import service as workbench_service

        session_id = "adhoc-single-for"
        session: dict[str, Any] = {
            "session_id": session_id,
            "status": "running",
            "test_name": "Adhoc For",
            "current_block": None,
            "progress": {"current": 0, "total": 0, "percentage": 0.0},
            "block_states": {},
            "scope_failed": False,
            "breakpoints": set(),
            "debug_options": None,
            "pause_event": asyncio.Event(),
            "paused_node_id": None,
        }
        _wb_common._workbench_sessions[session_id] = session

        for_node = _control_node("for-1", "for", "Loop")
        for_node["data"]["config"] = {
            "values": {"mode": "count", "count": 2},
            "profileBindings": [],
            "outputBindings": {"index": "i"},
        }

        nodes = [
            _log_node("pre", "Pre", "'pre'"),
            for_node,
            _log_node("body-log", "Body", "'iter'"),
            _log_node("after", "After", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "pre"},
            {"source": "pre", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {"i": None},
            single_node_id="for-1",
        )

        assert session["block_states"].get("for-1") == "passed"
        assert session["block_states"].get("body-log") == "passed"
        assert (
            "pre" not in session["block_states"]
        ), "pre-target node must not execute when single_node_id is set"
        assert (
            "after" not in session["block_states"]
        ), "after-egress node must not execute when single_node_id is set"


# ---------------------------------------------------------------------------
# Ad-hoc state inheritance (preserve previous-run variables and block_states)
# ---------------------------------------------------------------------------


class TestAdHocInheritsPreviousSessionState:
    """Ad-hoc Run/Debug Current and Run/Debug from Here are incremental dev tools.

    Both must inherit ``variables`` AND ``block_states`` from the previous
    terminal session for the same test, so the canvas keeps prior status
    badges and the new block can read upstream outputs.
    """

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        _wb_common._clear_sessions_sync()
        with patch("wavecore.api.services.workbench.service.asyncio.create_task") as mock_task:
            mock_task.return_value = Mock()
            yield mock_task
        _wb_common._clear_sessions_sync()

    @pytest.fixture(autouse=True)
    def _raw_variables_seam(self) -> Any:
        """The run path reads variables via the raw getter, not masked get_test."""
        from wavecore.api.services.workbench import service as workbench_service_module

        def _raw(tid: str) -> dict[str, Any]:
            test = workbench_service_module.test_service.get_test(tid)
            return (test or {}).get("variables", {})

        with patch(
            "wavecore.api.services.workbench.service.test_service.get_test_variables_raw",
            side_effect=_raw,
        ):
            yield

    @pytest.fixture
    def test_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture
    def environment_id(self) -> str:
        return str(uuid.uuid4())

    @staticmethod
    def _seed_previous_session(
        *,
        user_id: str,
        test_id: str,
        status: str,
        variables: dict[str, Any],
        block_states: dict[str, str],
    ) -> str:
        previous_session_id = f"prev-session-{uuid.uuid4()}"
        _wb_common._workbench_sessions[previous_session_id] = {
            "session_id": previous_session_id,
            "status": status,
            "test_id": test_id,
            "variables": variables,
            "block_states": block_states,
        }
        _wb_common._user_active_session[user_id] = previous_session_id
        return previous_session_id

    def _common_patches(self, test_record: dict[str, Any], environment: dict[str, Any]) -> Any:
        """Build the patcher set for a happy-path service call."""
        return (
            patch(
                "wavecore.api.services.workbench.service.test_service.get_test",
                return_value=test_record,
            ),
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment",
                return_value=environment,
            ),
            patch(
                "wavecore.api.services.workbench.service.test_service.validate_test",
                return_value={"fatal": False, "errors": [], "warnings": []},
            ),
            patch(
                "wavecore.api.services.workbench.service._execute_workflow",
                new_callable=AsyncMock,
            ),
        )

    @pytest.mark.parametrize(
        "field,value",
        [("single_node_id", "node-a"), ("start_node_id", "node-a")],
    )
    def test_adhoc_inherits_variables_from_previous_terminal_session(
        self,
        test_id: str,
        environment_id: str,
        field: str,
        value: str,
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        self._seed_previous_session(
            user_id=workbench_service.DEFAULT_USER_ID,
            test_id=test_id,
            status="passed",
            variables={"v": 42},
            block_states={"node-prev": "passed"},
        )

        nodes = [_log_node("node-a"), _log_node("node-prev")]
        edges = [{"source": "start-node", "target": "node-a"}]
        test_record = _make_test_record(test_id, nodes, edges)
        # Test definition's vars should be IGNORED in favor of inherited.
        test_record["variables"] = {"v": {"value": 0, "type": "integer"}}
        environment = {"id": environment_id, "name": "Env"}

        get_test_p, get_env_p, validate_p, exec_p = self._common_patches(test_record, environment)
        with get_test_p, get_env_p, validate_p, exec_p as mock_execute:
            result = workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                target=workbench_service.RunTarget(**{field: value}),
            )

            forwarded_vars = mock_execute.call_args.args[3]
            assert forwarded_vars == {
                "v": 42
            }, "ad-hoc must inherit variables from the previous terminal session"
            assert result["block_states"] == {"node-prev": "passed"}

    def test_adhoc_inherits_live_ssh_session_registry(
        self, test_id: str, environment_id: str
    ) -> None:
        # An immediate-stopped run leaves its SSH sessions open; the follow-up
        # ad-hoc run must reuse that live registry so a remote block can run on it.
        from wavecore.api.services.workbench import service as workbench_service
        from wavecore.core.ssh.session_registry import SSHSessionRegistry

        registry = SSHSessionRegistry()
        registry.register("live-sess", MagicMock(), None, "host-1", None, None, connect_timeout=30)

        prev_id = self._seed_previous_session(
            user_id=workbench_service.DEFAULT_USER_ID,
            test_id=test_id,
            status="stopped",
            variables={},
            block_states={},
        )
        _wb_common._workbench_sessions[prev_id]["ssh_session_registry"] = registry

        nodes = [_log_node("node-a")]
        edges = [{"source": "start-node", "target": "node-a"}]
        test_record = _make_test_record(test_id, nodes, edges)
        environment = {"id": environment_id, "name": "Env"}

        get_test_p, get_env_p, validate_p, exec_p = self._common_patches(test_record, environment)
        with get_test_p, get_env_p, validate_p, exec_p:
            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                target=workbench_service.RunTarget(single_node_id="node-a"),
            )

        new_session_id = _wb_common._user_active_session[workbench_service.DEFAULT_USER_ID]
        new_session = _wb_common._workbench_sessions[new_session_id]
        assert new_session["ssh_session_registry"] is registry
        assert new_session["ssh_session_registry"].get("live-sess") is not None

    def test_adhoc_includes_new_test_variable_not_in_inherited_state(
        self, test_id: str, environment_id: str
    ) -> None:
        # A variable created AFTER the previous run (not in inherited
        # state) must still reach an ad-hoc run - else referencing it fails
        # "Variable '<name>' is not defined". Inherited values still override.
        from wavecore.api.services.workbench import service as workbench_service

        self._seed_previous_session(
            user_id=workbench_service.DEFAULT_USER_ID,
            test_id=test_id,
            status="stopped",
            variables={"v": 42},
            block_states={},
        )

        nodes = [_log_node("node-a")]
        edges = [{"source": "start-node", "target": "node-a"}]
        test_record = _make_test_record(test_id, nodes, edges)
        test_record["variables"] = {
            "v": {"value": 0, "type": "integer"},
            "ssh_user": {"value": "will", "type": "string", "secret": True},
        }
        environment = {"id": environment_id, "name": "Env"}

        get_test_p, get_env_p, validate_p, exec_p = self._common_patches(test_record, environment)
        with get_test_p, get_env_p, validate_p, exec_p as mock_execute:
            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                target=workbench_service.RunTarget(single_node_id="node-a"),
            )

        forwarded_vars = mock_execute.call_args.args[3]
        assert forwarded_vars["v"] == 42  # inherited value wins for existing vars
        assert forwarded_vars["ssh_user"] == "will"  # new var is still available

    def test_full_run_does_not_inherit_state(self, test_id: str, environment_id: str) -> None:
        """A non-ad-hoc full run uses the test's defaults, not the previous run."""
        from wavecore.api.services.workbench import service as workbench_service

        self._seed_previous_session(
            user_id=workbench_service.DEFAULT_USER_ID,
            test_id=test_id,
            status="passed",
            variables={"v": 42},
            block_states={"node-prev": "passed"},
        )

        nodes = [_log_node("node-a")]
        edges = [{"source": "start-node", "target": "node-a"}]
        test_record = _make_test_record(test_id, nodes, edges)
        test_record["variables"] = {"v": {"value": 0, "type": "integer"}}
        environment = {"id": environment_id, "name": "Env"}

        get_test_p, get_env_p, validate_p, exec_p = self._common_patches(test_record, environment)
        with get_test_p, get_env_p, validate_p, exec_p as mock_execute:
            result = workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
            )

            forwarded_vars = mock_execute.call_args.args[3]
            assert forwarded_vars == {
                "v": 0
            }, "non-ad-hoc full run must use the test's defaults, not the previous session"
            assert result["block_states"] == {}

    @pytest.mark.parametrize("non_terminal_status", ["running", "paused", "idle"])
    def test_adhoc_does_not_inherit_from_non_terminal_session(
        self,
        test_id: str,
        environment_id: str,
        non_terminal_status: str,
    ) -> None:
        """Inheritance only kicks in if the previous session reached a terminal state."""
        from wavecore.api.services.workbench import service as workbench_service

        self._seed_previous_session(
            user_id=workbench_service.DEFAULT_USER_ID,
            test_id=test_id,
            status=non_terminal_status,
            variables={"v": 99},
            block_states={"node-prev": "running"},
        )

        nodes = [_log_node("node-a")]
        edges = [{"source": "start-node", "target": "node-a"}]
        test_record = _make_test_record(test_id, nodes, edges)
        test_record["variables"] = {"v": {"value": 0, "type": "integer"}}
        environment = {"id": environment_id, "name": "Env"}

        # When the previous session is non-terminal, _validate_run_preconditions
        # raises a ConflictException ("active session"). Mock that out so the
        # service still runs and we can inspect the variables it forwards.
        get_test_p, get_env_p, validate_p, exec_p = self._common_patches(test_record, environment)
        with (
            patch(
                "wavecore.api.services.workbench.service.get_active_session_for_user",
                return_value=None,
            ),
            get_test_p,
            get_env_p,
            validate_p,
            exec_p as mock_execute,
        ):
            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                target=workbench_service.RunTarget(single_node_id="node-a"),
            )

            forwarded_vars = mock_execute.call_args.args[3]
            assert forwarded_vars == {
                "v": 0
            }, "ad-hoc must not inherit from a non-terminal previous session"

    def test_adhoc_does_not_inherit_from_different_test(
        self, test_id: str, environment_id: str
    ) -> None:
        """Variables are scoped per-test; inheritance only applies within the same test."""
        from wavecore.api.services.workbench import service as workbench_service

        other_test_id = str(uuid.uuid4())
        self._seed_previous_session(
            user_id=workbench_service.DEFAULT_USER_ID,
            test_id=other_test_id,
            status="passed",
            variables={"v": 42},
            block_states={"node-prev": "passed"},
        )

        nodes = [_log_node("node-a")]
        edges = [{"source": "start-node", "target": "node-a"}]
        test_record = _make_test_record(test_id, nodes, edges)
        test_record["variables"] = {"v": {"value": 0, "type": "integer"}}
        environment = {"id": environment_id, "name": "Env"}

        get_test_p, get_env_p, validate_p, exec_p = self._common_patches(test_record, environment)
        with get_test_p, get_env_p, validate_p, exec_p as mock_execute:
            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                target=workbench_service.RunTarget(single_node_id="node-a"),
            )

            forwarded_vars = mock_execute.call_args.args[3]
            assert forwarded_vars == {"v": 0}, "ad-hoc must not inherit across different tests"

    def test_adhoc_with_no_previous_session_uses_defaults(
        self, test_id: str, environment_id: str
    ) -> None:
        """Ad-hoc with no prior session falls back to the test's variable defaults."""
        from wavecore.api.services.workbench import service as workbench_service

        nodes = [_log_node("node-a")]
        edges = [{"source": "start-node", "target": "node-a"}]
        test_record = _make_test_record(test_id, nodes, edges)
        test_record["variables"] = {"v": {"value": 7, "type": "integer"}}
        environment = {"id": environment_id, "name": "Env"}

        get_test_p, get_env_p, validate_p, exec_p = self._common_patches(test_record, environment)
        with get_test_p, get_env_p, validate_p, exec_p as mock_execute:
            workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id=environment_id,
                target=workbench_service.RunTarget(single_node_id="node-a"),
            )

            forwarded_vars = mock_execute.call_args.args[3]
            assert forwarded_vars == {"v": 7}
