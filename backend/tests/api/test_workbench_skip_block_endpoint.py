"""Unit tests for POST /workbench/{session_id}/skip-block.

Skips the current paused node, advances, and re-pauses BEFORE the next node
(REQ-3.2.2.2).

Error contract:
    - 404 body: ``^Workbench session '[^']+' not found$``
    - 409 body: ``^Cannot skip: session is '[^']+', not paused$``
"""

import re
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException

_NOT_FOUND_RE = re.compile(r"^Workbench session '[^']+' not found$")
_CONFLICT_RE = re.compile(r"^Cannot skip: session is '[^']+', not paused$")


class TestSkipBlockSuccess:
    """POST /workbench/{session_id}/skip-block happy-path."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    def test_200_returns_skipped_node_id_and_paused_status(
        self, client: TestClient, session_id: str
    ) -> None:
        """Skip returns the id of the node that was skipped and keeps status=paused."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.skip_current_block"
        ) as mock_skip:
            skipped_node_id = str(uuid.uuid4())
            mock_skip.return_value = {
                "session_id": session_id,
                "status": "paused",
                "skipped_node_id": skipped_node_id,
            }

            response = client.post(f"/workbench/{session_id}/skip-block")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["session_id"] == session_id
            assert data["data"]["status"] == "paused"
            assert data["data"]["skipped_node_id"] == skipped_node_id
            mock_skip.assert_called_once_with(session_id=session_id)

    def test_200_accepts_empty_body(self, client: TestClient, session_id: str) -> None:
        """skip-block accepts a bodyless POST."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.skip_current_block"
        ) as mock_skip:
            mock_skip.return_value = {
                "session_id": session_id,
                "status": "paused",
                "skipped_node_id": "node-a",
            }

            response = client.post(f"/workbench/{session_id}/skip-block")

            assert response.status_code == 200


class TestSkipBlockErrors:
    """Skip-block error paths with exact message contracts."""

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
            "wavecore.api.routes.workbench.workbench_service.skip_current_block"
        ) as mock_skip:
            mock_skip.side_effect = LookupError(f"Workbench session '{session_id}' not found")

            response = client.post(f"/workbench/{session_id}/skip-block")

            assert response.status_code == 404
            body = response.json()
            assert body["error"]["code"] == "NOT_FOUND"
            assert _NOT_FOUND_RE.match(body["error"]["message"]) is not None

    def test_409_when_session_running_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """Skip is only valid from paused state: running yields 409."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.skip_current_block"
        ) as mock_skip:
            mock_skip.side_effect = ConflictException(
                "Cannot skip: session is 'running', not paused"
            )

            response = client.post(f"/workbench/{session_id}/skip-block")

            assert response.status_code == 409
            assert _CONFLICT_RE.match(response.json()["error"]["message"]) is not None

    def test_409_when_session_terminal_matches_anchored_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """Terminal sessions (passed/failed/stopped) produce the 409 pattern too."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.skip_current_block"
        ) as mock_skip:
            mock_skip.side_effect = ConflictException(
                "Cannot skip: session is 'stopped', not paused"
            )

            response = client.post(f"/workbench/{session_id}/skip-block")

            assert response.status_code == 409
            assert _CONFLICT_RE.match(response.json()["error"]["message"]) is not None

    def test_400_for_invalid_session_id_uuid_format(self, client: TestClient) -> None:
        """Non-UUID path segment fails UUID validation."""
        response = client.post("/workbench/not-a-uuid/skip-block")

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for session_id" in body["error"]["message"]
