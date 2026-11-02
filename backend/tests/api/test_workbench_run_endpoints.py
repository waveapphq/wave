"""Unit tests for Workbench Run endpoint (V-CANVAS-14 / REQ-3.2.1.1).

This module tests the ephemeral Workbench execution endpoint that enables users
to run workflows directly from the canvas during test development. Unlike tracked
executions, Workbench runs do NOT create Execution entities.

Focus: WAVE-specific business logic, NOT library validation (Pydantic/FastAPI).
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


class TestWorkbenchRunEndpoint:
    """Test suite for POST /workbench/run endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def valid_test_id(self) -> str:
        """Return a valid test UUID."""
        return str(uuid.uuid4())

    @pytest.fixture
    def valid_environment_id(self) -> str:
        """Return a valid environment UUID."""
        return str(uuid.uuid4())

    # =========================================================================
    # Core WAVE Functionality: Ephemeral Execution
    # =========================================================================

    def test_workbench_run_returns_session_id_for_websocket_subscription(
        self, client: TestClient, valid_test_id: str, valid_environment_id: str
    ) -> None:
        """Test that workbench run returns session_id for WebSocket event subscription."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            session_id = str(uuid.uuid4())
            mock_run.return_value = {
                "session_id": session_id,
                "status": "running",
                "test_id": valid_test_id,
                "environment_id": valid_environment_id,
                "debug_mode": False,
                "websocket_topic": f"workbench:{session_id}",
                "warnings": [],
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": valid_test_id,
                    "environment_id": valid_environment_id,
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            # Session ID for ephemeral run (NOT execution_id)
            assert data["data"]["session_id"] == session_id
            # WebSocket topic for subscribing to execution events
            assert data["data"]["websocket_topic"] == f"workbench:{session_id}"
            # Must NOT contain execution_id (that's for tracked executions)
            assert "execution_id" not in data["data"]

    def test_workbench_run_with_client_provided_session_id(
        self, client: TestClient, valid_test_id: str, valid_environment_id: str
    ) -> None:
        """Test V-CANVAS-04: Client can provide session_id to subscribe to WebSocket before run
        starts.
        """
        client_session_id = str(uuid.uuid4())
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.return_value = {
                "session_id": client_session_id,
                "status": "running",
                "test_id": valid_test_id,
                "environment_id": valid_environment_id,
                "websocket_topic": f"workbench:{client_session_id}",
                "warnings": [],
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": valid_test_id,
                    "environment_id": valid_environment_id,
                    "session_id": client_session_id,
                },
            )

            assert response.status_code == 200
            data = response.json()
            # Server uses the client-provided session_id
            assert data["data"]["session_id"] == client_session_id
            assert data["data"]["websocket_topic"] == f"workbench:{client_session_id}"
            from wavecore.api.services.workbench import service as workbench_service

            mock_run.assert_called_once_with(
                test_id=valid_test_id,
                environment_id=valid_environment_id,
                session_id=client_session_id,
                skipped_node_ids=None,
                debug=workbench_service.DebugRunOptions(
                    breakpoints=None,
                    options=None,
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

    # =========================================================================
    # Entity Resolution: Test and Environment Lookup
    # =========================================================================

    def test_workbench_run_returns_404_when_test_not_found(
        self, client: TestClient, valid_test_id: str, valid_environment_id: str
    ) -> None:
        """Test that workbench run returns 404 when test entity doesn't exist."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.side_effect = LookupError(f"Test with ID '{valid_test_id}' not found")

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": valid_test_id,
                    "environment_id": valid_environment_id,
                },
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "NOT_FOUND"
            assert f"Test with ID '{valid_test_id}' not found" in data["error"]["message"]

    def test_workbench_run_returns_404_when_environment_not_found(
        self, client: TestClient, valid_test_id: str, valid_environment_id: str
    ) -> None:
        """Test that workbench run returns 404 when environment doesn't exist."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.side_effect = LookupError(
                f"Environment with ID '{valid_environment_id}' not found"
            )

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": valid_test_id,
                    "environment_id": valid_environment_id,
                },
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "NOT_FOUND"
            assert (
                f"Environment with ID '{valid_environment_id}' not found"
                in data["error"]["message"]
            )

    # =========================================================================
    # Pre-flight Validation: Profile Completeness (REQ-3.2.1.1)
    # =========================================================================

    def test_workbench_run_returns_profile_warnings_without_blocking(
        self, client: TestClient, valid_test_id: str, valid_environment_id: str
    ) -> None:
        """Test that incomplete profiles generate warnings but don't block execution.

        Per REQ-3.2.1.1: Pre-flight validation warns about missing profile values
        but allows the user to proceed ("Cancel" / "Run Anyway").
        """
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.return_value = {
                "session_id": str(uuid.uuid4()),
                "status": "running",  # Still running despite warnings
                "test_id": valid_test_id,
                "environment_id": valid_environment_id,
                "debug_mode": False,
                "websocket_topic": f"workbench:{str(uuid.uuid4())}",
                "warnings": [
                    {
                        "type": "INCOMPLETE_PROFILE",
                        "profile_name": "Database Connection",
                        "message": "Profile 'Database Connection' has no value for this "
                        "environment",
                    },
                ],
            }

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": valid_test_id,
                    "environment_id": valid_environment_id,
                },
            )

            # Execution proceeds (200 OK) with warnings
            assert response.status_code == 200
            data = response.json()
            assert data["data"]["status"] == "running"
            assert len(data["data"]["warnings"]) == 1
            assert data["data"]["warnings"][0]["type"] == "INCOMPLETE_PROFILE"

    # =========================================================================
    # Test Validation: Workflow Must Have Blocks
    # =========================================================================

    def test_workbench_run_returns_400_when_test_has_no_workflow_blocks(
        self, client: TestClient, valid_test_id: str, valid_environment_id: str
    ) -> None:
        """Test that workbench run fails when test has no executable blocks.

        A test must have at least one workflow block to be executable.
        """
        with patch(
            "wavecore.api.routes.workbench.workbench_service.start_workbench_run"
        ) as mock_run:
            mock_run.side_effect = ValueError("Test must have at least one workflow block defined")

            response = client.post(
                "/workbench/run",
                json={
                    "test_id": valid_test_id,
                    "environment_id": valid_environment_id,
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "at least one workflow block" in data["error"]["message"]

    # =========================================================================
    # UUID Validation
    # =========================================================================

    def test_workbench_run_returns_400_for_invalid_test_id_uuid_format(
        self, client: TestClient, valid_environment_id: str
    ) -> None:
        """Test that workbench run fails with invalid test_id UUID format."""
        response = client.post(
            "/workbench/run",
            json={
                "test_id": "not-a-valid-uuid",
                "environment_id": valid_environment_id,
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for test_id" in data["error"]["message"]

    def test_workbench_run_returns_400_for_invalid_environment_id_uuid_format(
        self, client: TestClient, valid_test_id: str
    ) -> None:
        """Test that workbench run fails with invalid environment_id UUID format."""
        response = client.post(
            "/workbench/run",
            json={
                "test_id": valid_test_id,
                "environment_id": "invalid-env-uuid",
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for environment_id" in data["error"]["message"]


class TestWorkbenchStopEndpoint:
    """Test suite for POST /workbench/{session_id}/stop endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def valid_session_id(self) -> str:
        """Return a valid session UUID."""
        return str(uuid.uuid4())

    def test_workbench_stop_terminates_running_session(
        self, client: TestClient, valid_session_id: str
    ) -> None:
        """Test that stop terminates a running workbench session."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.stop_workbench_run"
        ) as mock_stop:
            mock_stop.return_value = {
                "session_id": valid_session_id,
                "status": "stopped",
            }

            response = client.post(f"/workbench/{valid_session_id}/stop")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["status"] == "stopped"

    def test_workbench_stop_returns_404_when_session_not_found(
        self, client: TestClient, valid_session_id: str
    ) -> None:
        """Test that stop returns 404 for non-existent session."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.stop_workbench_run"
        ) as mock_stop:
            mock_stop.side_effect = LookupError(f"Workbench session '{valid_session_id}' not found")

            response = client.post(f"/workbench/{valid_session_id}/stop")

            assert response.status_code == 404
            data = response.json()
            assert data["error"]["code"] == "NOT_FOUND"

    def test_workbench_stop_returns_400_for_invalid_session_id_uuid_format(
        self, client: TestClient
    ) -> None:
        """Test that stop returns 400 for invalid session_id UUID format."""
        response = client.post("/workbench/not-a-valid-uuid/stop")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for session_id" in data["error"]["message"]


class TestWorkbenchStatusEndpoint:
    """Test suite for GET /workbench/{session_id}/status endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def valid_session_id(self) -> str:
        """Return a valid session UUID."""
        return str(uuid.uuid4())

    def test_workbench_status_returns_execution_progress(
        self, client: TestClient, valid_session_id: str
    ) -> None:
        """Test that status returns current execution progress for live updates."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.get_workbench_status"
        ) as mock_status:
            current_block_id = str(uuid.uuid4())
            mock_status.return_value = {
                "session_id": valid_session_id,
                "status": "running",
                "current_block": {
                    "block_id": current_block_id,
                    "block_name": "Execute SQL Query",
                },
                "progress": {
                    "current": 3,
                    "total": 10,
                    "percentage": 30.0,
                },
            }

            response = client.get(f"/workbench/{valid_session_id}/status")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["status"] == "running"
            assert data["data"]["current_block"]["block_id"] == current_block_id
            assert data["data"]["progress"]["percentage"] == 30.0

    def test_workbench_status_returns_404_when_session_not_found(
        self, client: TestClient, valid_session_id: str
    ) -> None:
        """Test that status returns 404 for non-existent or expired session."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.get_workbench_status"
        ) as mock_status:
            mock_status.return_value = None

            response = client.get(f"/workbench/{valid_session_id}/status")

            assert response.status_code == 404
            data = response.json()
            assert data["error"]["code"] == "NOT_FOUND"

    def test_workbench_status_returns_400_for_invalid_session_id_uuid_format(
        self, client: TestClient
    ) -> None:
        """Test that status returns 400 for invalid session_id UUID format."""
        response = client.get("/workbench/not-a-valid-uuid/status")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for session_id" in data["error"]["message"]


class TestWorkbenchSessionEndpoint:
    """Test suite for GET /workbench/session endpoint (session recovery).

    This endpoint enables frontend session recovery on mount. When the user
    navigates to the Workbench page (after refresh, navigation, or browser reopen),
    the frontend queries this endpoint to recover any active session state.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    # =========================================================================
    # Session Recovery: No Active Session
    # =========================================================================

    def test_workbench_session_returns_null_when_no_session_exists(
        self, client: TestClient
    ) -> None:
        """Test that GET /workbench/session returns null when user has no session.

        This is the normal case when user first opens Workbench or after a reset.
        """
        with patch(
            "wavecore.api.routes.workbench.workbench_service.get_session_for_user"
        ) as mock_get_session:
            mock_get_session.return_value = None

            response = client.get("/workbench/session")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] is None

    # =========================================================================
    # Session Recovery: Active Running Session
    # =========================================================================

    def test_workbench_session_returns_session_when_running(self, client: TestClient) -> None:
        """Test that GET /workbench/session returns session data when running.

        User refreshed page while execution was in progress - should recover state.
        """
        with patch(
            "wavecore.api.routes.workbench.workbench_service.get_session_for_user"
        ) as mock_get_session:
            session_id = str(uuid.uuid4())
            test_id = str(uuid.uuid4())
            mock_get_session.return_value = {
                "session_id": session_id,
                "status": "running",
                "test_id": test_id,
                "websocket_topic": f"workbench:{session_id}",
                "current_block": {
                    "block_id": "block-1",
                    "block_name": "Execute Query",
                },
                "progress": {
                    "current": 3,
                    "total": 10,
                    "percentage": 30.0,
                },
            }

            response = client.get("/workbench/session")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["session_id"] == session_id
            assert data["data"]["status"] == "running"
            assert data["data"]["test_id"] == test_id
            assert data["data"]["websocket_topic"] == f"workbench:{session_id}"
            assert data["data"]["current_block"]["block_name"] == "Execute Query"
            assert data["data"]["progress"]["percentage"] == 30.0

    # =========================================================================
    # Session Recovery: Terminal States (passed, failed, stopped)
    # =========================================================================

    def test_workbench_session_returns_session_when_passed(self, client: TestClient) -> None:
        """Test that GET /workbench/session returns session data when passed.

        User refreshed after execution completed successfully - show results.
        """
        with patch(
            "wavecore.api.routes.workbench.workbench_service.get_session_for_user"
        ) as mock_get_session:
            session_id = str(uuid.uuid4())
            mock_get_session.return_value = {
                "session_id": session_id,
                "status": "passed",
                "test_id": str(uuid.uuid4()),
                "websocket_topic": f"workbench:{session_id}",
                "current_block": None,
                "progress": {"current": 5, "total": 5, "percentage": 100.0},
            }

            response = client.get("/workbench/session")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["status"] == "passed"

    def test_workbench_session_returns_session_when_failed(self, client: TestClient) -> None:
        """Test that GET /workbench/session returns session data when failed.

        User refreshed after execution failed - show error state.
        """
        with patch(
            "wavecore.api.routes.workbench.workbench_service.get_session_for_user"
        ) as mock_get_session:
            session_id = str(uuid.uuid4())
            mock_get_session.return_value = {
                "session_id": session_id,
                "status": "failed",
                "test_id": str(uuid.uuid4()),
                "websocket_topic": f"workbench:{session_id}",
                "error": "Connection timeout",
                "current_block": {"block_id": "block-2", "block_name": "SSH Connect"},
                "progress": {"current": 2, "total": 5, "percentage": 40.0},
            }

            response = client.get("/workbench/session")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["status"] == "failed"
            assert data["data"]["error"] == "Connection timeout"

    def test_workbench_session_returns_session_when_stopped(self, client: TestClient) -> None:
        """Test that GET /workbench/session returns session data when stopped.

        User manually stopped execution then refreshed - show stopped state.
        """
        with patch(
            "wavecore.api.routes.workbench.workbench_service.get_session_for_user"
        ) as mock_get_session:
            session_id = str(uuid.uuid4())
            mock_get_session.return_value = {
                "session_id": session_id,
                "status": "stopped",
                "test_id": str(uuid.uuid4()),
                "websocket_topic": f"workbench:{session_id}",
                "current_block": None,
                "progress": {"current": 3, "total": 5, "percentage": 60.0},
            }

            response = client.get("/workbench/session")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["status"] == "stopped"

    def test_workbench_session_serializes_when_internal_state_has_namespace_object(
        self, client: TestClient
    ) -> None:
        """GET /workbench/session must succeed even when the live
        session dict contains non-JSON-serializable runtime objects, such as the
        ``SystemObject`` the engine stores while a test runs.
        """
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.system_object import SystemObject

        session_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "passed",
            "test_id": test_id,
            "test_name": "Sample Test",
            "websocket_topic": f"workbench:{session_id}",
            "current_block": None,
            "progress": {"current": 5, "total": 5, "percentage": 100.0},
            "block_states": {"block-a": "passed"},
            "user_id": _wb_common.DEFAULT_USER_ID,
            "variables": {"system": SystemObject({"host": "localhost"})},
        }
        _wb_common._user_active_session[_wb_common.DEFAULT_USER_ID] = session_id

        try:
            response = client.get("/workbench/session")
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["session_id"] == session_id
            assert data["data"]["status"] == "passed"
            assert data["data"]["test_id"] == test_id
            assert data["data"]["block_states"] == {"block-a": "passed"}
            assert "variables" not in data["data"]
        finally:
            _wb_common._workbench_sessions.pop(session_id, None)
            _wb_common._user_active_session.pop(_wb_common.DEFAULT_USER_ID, None)


class TestWorkbenchClearSessionEndpoint:
    """Test suite for DELETE /workbench/session endpoint.

    This endpoint clears the current user's session, used for explicit reset
    or when frontend detects stale session state.
    """

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_workbench_clear_session_removes_user_session(self, client: TestClient) -> None:
        """Test that DELETE /workbench/session clears the user's session."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.clear_session_for_user"
        ) as mock_clear:
            mock_clear.return_value = {"cleared": True}

            response = client.delete("/workbench/session")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            mock_clear.assert_called_once()

    def test_workbench_clear_session_succeeds_when_no_session_exists(
        self, client: TestClient
    ) -> None:
        """Test that DELETE /workbench/session is idempotent (no error if no session).

        Clearing when no session exists should succeed - idempotent operation.
        """
        with patch(
            "wavecore.api.routes.workbench.workbench_service.clear_session_for_user"
        ) as mock_clear:
            mock_clear.return_value = {"cleared": False}

            response = client.delete("/workbench/session")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_workbench_clear_session_returns_500_on_service_error(self, client: TestClient) -> None:
        """Test that DELETE /workbench/session returns 500 on unexpected errors."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.clear_session_for_user"
        ) as mock_clear:
            mock_clear.side_effect = RuntimeError("Database connection lost")

            response = client.delete("/workbench/session")

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "Database connection lost" in data["error"]["message"]


class TestWorkbenchSkipUpdateEndpoint:
    """Test suite for POST /workbench/{session_id}/skip endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def valid_session_id(self) -> str:
        """Return a valid session UUID."""
        return str(uuid.uuid4())

    def test_workbench_skip_update_succeeds_for_running_session(
        self, client: TestClient, valid_session_id: str
    ) -> None:
        """Test that skip update modifies skipped node IDs during execution."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_skipped_nodes"
        ) as mock_update:
            mock_update.return_value = {
                "session_id": valid_session_id,
                "skipped_node_ids": ["node-1", "node-2"],
            }

            response = client.post(
                f"/workbench/{valid_session_id}/skip",
                json={"skipped_node_ids": ["node-1", "node-2"]},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["session_id"] == valid_session_id
            assert data["data"]["skipped_node_ids"] == ["node-1", "node-2"]

    def test_workbench_skip_update_returns_404_when_session_not_found(
        self, client: TestClient, valid_session_id: str
    ) -> None:
        """Test that skip update returns 404 for non-existent session."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_skipped_nodes"
        ) as mock_update:
            mock_update.side_effect = LookupError(
                f"Workbench session '{valid_session_id}' not found"
            )

            response = client.post(
                f"/workbench/{valid_session_id}/skip",
                json={"skipped_node_ids": ["node-1"]},
            )

            assert response.status_code == 404
            data = response.json()
            assert data["error"]["code"] == "NOT_FOUND"

    def test_workbench_skip_update_returns_400_when_session_not_running(
        self, client: TestClient, valid_session_id: str
    ) -> None:
        """Test that skip update returns 400 for non-running session."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_skipped_nodes"
        ) as mock_update:
            mock_update.side_effect = ValueError(
                "Cannot update skipped blocks: session is 'passed', not running"
            )

            response = client.post(
                f"/workbench/{valid_session_id}/skip",
                json={"skipped_node_ids": ["node-1"]},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["error"]["code"] == "VALIDATION_ERROR"

    def test_workbench_skip_update_returns_400_for_invalid_uuid(self, client: TestClient) -> None:
        """Test that skip update returns 400 for invalid session_id UUID format."""
        response = client.post(
            "/workbench/not-a-valid-uuid/skip",
            json={"skipped_node_ids": []},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for session_id" in data["error"]["message"]


class TestWorkbenchSessionErrorHandling:
    """Test suite for error handling in workbench session endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_workbench_get_session_returns_500_on_service_error(self, client: TestClient) -> None:
        """Test that GET /workbench/session returns 500 on unexpected errors."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.get_session_for_user"
        ) as mock_get_session:
            mock_get_session.side_effect = RuntimeError("Internal service failure")

            response = client.get("/workbench/session")

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "Internal service failure" in data["error"]["message"]
