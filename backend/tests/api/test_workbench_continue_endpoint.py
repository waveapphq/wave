"""Unit tests for POST /workbench/{session_id}/continue.

Resumes a paused debug session (REQ-3.2.2.3).

Error contract:
    - 404 body: ``^Workbench session '[^']+' not found$``
    - 409 body: ``^Cannot continue: session is '[^']+', not paused$``
"""

import re
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException

_NOT_FOUND_RE = re.compile(r"^Workbench session '[^']+' not found$")
_CONFLICT_RE = re.compile(r"^Cannot continue: session is '[^']+', not paused$")


class TestContinueSuccess:
    """POST /workbench/{session_id}/continue happy-path."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    def test_200_transitions_status_to_running(self, client: TestClient, session_id: str) -> None:
        """Continue transitions paused -> running and returns the new status."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.continue_session"
        ) as mock_continue:
            mock_continue.return_value = {
                "session_id": session_id,
                "status": "running",
            }

            response = client.post(f"/workbench/{session_id}/continue")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["session_id"] == session_id
            assert data["data"]["status"] == "running"
            mock_continue.assert_called_once_with(session_id=session_id)

    def test_200_requires_no_request_body(self, client: TestClient, session_id: str) -> None:
        """Continue endpoint accepts an empty POST body."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.continue_session"
        ) as mock_continue:
            mock_continue.return_value = {
                "session_id": session_id,
                "status": "running",
            }

            response = client.post(f"/workbench/{session_id}/continue")

            assert response.status_code == 200


class TestContinueErrors:
    """Continue error paths with exact message contracts."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    def test_404_when_session_not_found_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """404 body matches ``^Workbench session '[^']+' not found$``."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.continue_session"
        ) as mock_continue:
            mock_continue.side_effect = LookupError(f"Workbench session '{session_id}' not found")

            response = client.post(f"/workbench/{session_id}/continue")

            assert response.status_code == 404
            body = response.json()
            assert body["success"] is False
            assert body["error"]["code"] == "NOT_FOUND"
            assert _NOT_FOUND_RE.match(body["error"]["message"]) is not None

    def test_409_when_session_not_paused_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """409 body matches the anchored ``Cannot continue: ..., not paused`` message."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.continue_session"
        ) as mock_continue:
            mock_continue.side_effect = ConflictException(
                "Cannot continue: session is 'running', not paused"
            )

            response = client.post(f"/workbench/{session_id}/continue")

            assert response.status_code == 409
            body = response.json()
            assert body["success"] is False
            assert _CONFLICT_RE.match(body["error"]["message"]) is not None

    def test_409_when_session_is_terminal_matches_anchored_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """Terminal sessions (passed/failed/stopped) produce the 409 pattern too."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.continue_session"
        ) as mock_continue:
            mock_continue.side_effect = ConflictException(
                "Cannot continue: session is 'passed', not paused"
            )

            response = client.post(f"/workbench/{session_id}/continue")

            assert response.status_code == 409
            assert _CONFLICT_RE.match(response.json()["error"]["message"]) is not None

    def test_400_for_invalid_session_id_uuid_format(self, client: TestClient) -> None:
        """Non-UUID path segment fails UUID validation."""
        response = client.post("/workbench/not-a-uuid/continue")

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for session_id" in body["error"]["message"]
