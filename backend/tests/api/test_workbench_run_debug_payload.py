"""Unit tests for the debug-run payload shape on POST /workbench/run.

The Debug UI (REQ-3.2.1.2, REQ-3.2.2.1, REQ-3.2.2.5) replaces the
single ``debug_mode: bool`` flag with two independent fields:

    - ``breakpoints: list[str] | None``
    - ``debug_options: {pause_on_first_block: bool, pause_on_errors: bool} | None``

Both ``None`` = regular run. At least one non-``None`` = debug run. Tracked
executions never send either field.
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


class TestWorkbenchRunRegularPayload:
    """POST /workbench/run without breakpoints + debug_options = regular run."""

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

    def test_regular_run_omits_breakpoints_and_debug_options(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """Regular run sends no breakpoints/debug_options to the service."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            session_id = str(uuid.uuid4())
            mock_run.return_value = {
                "session_id": session_id,
                "status": "running",
                "test_id": test_id,
                "environment_id": environment_id,
                "websocket_topic": f"workbench:{session_id}",
                "warnings": [],
            }

            response = client.post(
                "/workbench/run",
                json={"test_id": test_id, "environment_id": environment_id},
            )

            assert response.status_code == 200
            mock_run.assert_called_once()
            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs["debug"].breakpoints is None
            assert call_kwargs["debug"].options is None

    def test_regular_run_does_not_accept_debug_mode_field(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """A ``debug_mode`` field is not part of the request model."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.return_value = {
                "session_id": str(uuid.uuid4()),
                "status": "running",
                "websocket_topic": "workbench:mock",
                "warnings": [],
            }

            client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "debug_mode": True,
                },
            )

            assert mock_run.called
            call_kwargs = mock_run.call_args.kwargs
            assert "debug_mode" not in call_kwargs


class TestWorkbenchRunDebugPayload:
    """POST /workbench/run with breakpoints + debug_options = debug run."""

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

    def test_debug_run_forwards_breakpoints_and_debug_options(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """Debug run sends the breakpoint ids and debug options to the service."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            session_id = str(uuid.uuid4())
            mock_run.return_value = {
                "session_id": session_id,
                "status": "running",
                "test_id": test_id,
                "environment_id": environment_id,
                "websocket_topic": f"workbench:{session_id}",
                "warnings": [],
                "breakpoints": ["node-a", "node-b"],
                "debug_options": {
                    "pause_on_first_block": True,
                    "pause_on_errors": False,
                },
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "breakpoints": ["node-a", "node-b"],
                    "debug_options": {
                        "pause_on_first_block": True,
                        "pause_on_errors": False,
                    },
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
                    breakpoints=["node-a", "node-b"],
                    options={
                        "pause_on_first_block": True,
                        "pause_on_errors": False,
                    },
                ),
                target=workbench_service.RunTarget(),
                scope=workbench_service.ScopedRunOptions(
                    mode="test",
                    function_node_id=None,
                ),
                workflow=None,
                variables=None,
                function_variables=[],
            )
            data = response.json()["data"]
            assert data["breakpoints"] == ["node-a", "node-b"]
            assert data["debug_options"] == {
                "pause_on_first_block": True,
                "pause_on_errors": False,
            }

    def test_debug_run_with_empty_breakpoints_is_still_debug_mode(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """Empty list + options both False still opens a debug session."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.return_value = {
                "session_id": str(uuid.uuid4()),
                "status": "running",
                "websocket_topic": "workbench:mock",
                "warnings": [],
                "breakpoints": [],
                "debug_options": {
                    "pause_on_first_block": False,
                    "pause_on_errors": False,
                },
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "breakpoints": [],
                    "debug_options": {
                        "pause_on_first_block": False,
                        "pause_on_errors": False,
                    },
                },
            )

            assert response.status_code == 200
            mock_run.assert_called_once()
            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs["debug"].breakpoints == []
            assert call_kwargs["debug"].options == {
                "pause_on_first_block": False,
                "pause_on_errors": False,
            }

    def test_debug_run_rejects_unknown_debug_option_keys(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """Only the two documented debug options are accepted."""
        response = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": environment_id,
                "debug_options": {
                    "pause_on_first_block": True,
                    "pause_on_errors": False,
                    "step_into_on_start": True,
                },
            },
        )
        # The app-wide validation_exception_handler converts Pydantic
        # validation errors to 400 (rather than FastAPI's default 422) so the
        # pre-existing test contract across the codebase stays consistent.
        assert response.status_code == 400

    def test_debug_run_with_only_breakpoints_treats_as_debug(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """``breakpoints`` alone (no debug_options) is a debug run."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.return_value = {
                "session_id": str(uuid.uuid4()),
                "status": "running",
                "websocket_topic": "workbench:mock",
                "warnings": [],
                "breakpoints": ["node-a"],
                "debug_options": None,
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "breakpoints": ["node-a"],
                },
            )

            assert response.status_code == 200
            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs["debug"].breakpoints == ["node-a"]
            assert call_kwargs["debug"].options is None

    def test_debug_run_with_only_debug_options_treats_as_debug(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """``debug_options`` alone (no breakpoints) is a debug run."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.return_value = {
                "session_id": str(uuid.uuid4()),
                "status": "running",
                "websocket_topic": "workbench:mock",
                "warnings": [],
                "breakpoints": None,
                "debug_options": {
                    "pause_on_first_block": True,
                    "pause_on_errors": True,
                },
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "debug_options": {
                        "pause_on_first_block": True,
                        "pause_on_errors": True,
                    },
                },
            )

            assert response.status_code == 200
            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs["debug"].breakpoints is None
            assert call_kwargs["debug"].options == {
                "pause_on_first_block": True,
                "pause_on_errors": True,
            }

    def test_debug_run_keeps_session_id_and_skipped_nodes(
        self, client: TestClient, test_id: str, environment_id: str
    ) -> None:
        """Debug run composes with session_id + skipped_node_ids (existing fields)."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            client_session_id = str(uuid.uuid4())
            mock_run.return_value = {
                "session_id": client_session_id,
                "status": "running",
                "websocket_topic": f"workbench:{client_session_id}",
                "warnings": [],
                "breakpoints": ["node-1"],
                "debug_options": {
                    "pause_on_first_block": False,
                    "pause_on_errors": True,
                },
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": environment_id,
                    "session_id": client_session_id,
                    "skipped_node_ids": ["node-skip"],
                    "breakpoints": ["node-1"],
                    "debug_options": {
                        "pause_on_first_block": False,
                        "pause_on_errors": True,
                    },
                },
            )

            assert response.status_code == 200
            from wavecore.api.services.workbench import service as workbench_service

            mock_run.assert_called_once_with(
                test_id=test_id,
                environment_id=environment_id,
                session_id=client_session_id,
                skipped_node_ids=["node-skip"],
                debug=workbench_service.DebugRunOptions(
                    breakpoints=["node-1"],
                    options={
                        "pause_on_first_block": False,
                        "pause_on_errors": True,
                    },
                ),
                target=workbench_service.RunTarget(),
                scope=workbench_service.ScopedRunOptions(
                    mode="test",
                    function_node_id=None,
                ),
                workflow=None,
                variables=None,
                function_variables=[],
            )
