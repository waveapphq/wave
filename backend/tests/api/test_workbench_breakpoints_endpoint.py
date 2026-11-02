"""Unit tests for PATCH /workbench/{session_id}/breakpoints.

Updates the live breakpoint set on a running or
paused workbench session. Mirrors the existing ``/workbench/{id}/skip``
semantics (REQ-3.2.2.1).

Error contract:
    - 404 body: ``^Workbench session '[^']+' not found$``
    - 409 body: ``^Cannot update breakpoints: session is '[^']+', not running$``
"""

import re
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException

_NOT_FOUND_RE = re.compile(r"^Workbench session '[^']+' not found$")
_CONFLICT_RE = re.compile(r"^Cannot update breakpoints: session is '[^']+', not running$")


class TestUpdateBreakpointsSuccess:
    """PATCH /workbench/{session_id}/breakpoints happy-path."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    def test_200_returns_updated_breakpoint_list(self, client: TestClient, session_id: str) -> None:
        """Successful PATCH returns the new breakpoint set."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_breakpoints"
        ) as mock_update:
            mock_update.return_value = {
                "session_id": session_id,
                "breakpoints": ["node-a", "node-b"],
            }

            response = client.patch(
                f"/workbench/{session_id}/breakpoints",
                json={"breakpoints": ["node-a", "node-b"]},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["session_id"] == session_id
            assert data["data"]["breakpoints"] == ["node-a", "node-b"]
            mock_update.assert_called_once_with(
                session_id=session_id,
                breakpoints=["node-a", "node-b"],
            )

    def test_200_accepts_empty_list_to_clear_breakpoints(
        self, client: TestClient, session_id: str
    ) -> None:
        """Empty list clears all live breakpoints."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_breakpoints"
        ) as mock_update:
            mock_update.return_value = {
                "session_id": session_id,
                "breakpoints": [],
            }

            response = client.patch(
                f"/workbench/{session_id}/breakpoints",
                json={"breakpoints": []},
            )

            assert response.status_code == 200
            assert response.json()["data"]["breakpoints"] == []


class TestUpdateBreakpointsErrors:
    """Error paths with exact message contracts."""

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
            "wavecore.api.routes.workbench.workbench_service.update_breakpoints"
        ) as mock_update:
            mock_update.side_effect = LookupError(f"Workbench session '{session_id}' not found")

            response = client.patch(
                f"/workbench/{session_id}/breakpoints",
                json={"breakpoints": ["node-a"]},
            )

            assert response.status_code == 404
            body = response.json()
            assert body["success"] is False
            assert body["error"]["code"] == "NOT_FOUND"
            assert _NOT_FOUND_RE.match(body["error"]["message"]) is not None

    def test_409_when_session_not_running_or_paused_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """409 body matches the anchored ``Cannot update breakpoints`` message."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_breakpoints"
        ) as mock_update:
            mock_update.side_effect = ConflictException(
                "Cannot update breakpoints: session is 'passed', not running"
            )

            response = client.patch(
                f"/workbench/{session_id}/breakpoints",
                json={"breakpoints": ["node-a"]},
            )

            assert response.status_code == 409
            body = response.json()
            assert body["success"] is False
            assert _CONFLICT_RE.match(body["error"]["message"]) is not None

    def test_400_for_invalid_session_id_uuid_format(self, client: TestClient) -> None:
        """Non-UUID path segment fails UUID validation."""
        response = client.patch(
            "/workbench/not-a-uuid/breakpoints",
            json={"breakpoints": ["node-a"]},
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert "Invalid UUID format for session_id" in body["error"]["message"]

    def test_400_when_breakpoints_field_missing(self, client: TestClient, session_id: str) -> None:
        """Missing required ``breakpoints`` field fails pydantic validation."""
        response = client.patch(
            f"/workbench/{session_id}/breakpoints",
            json={},
        )
        # Matches the app-wide validation_exception_handler convention of
        # 400 for all Pydantic validation errors (body, query, or JSON shape).
        assert response.status_code == 400


class TestUpdateBreakpointsServiceAllowsRunningAndPaused:
    """PATCH succeeds for BOTH running and paused sessions."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.mark.parametrize("live_status", ["running", "paused"])
    def test_patch_succeeds_when_session_is_running_or_paused(
        self, client: TestClient, session_id: str, live_status: str
    ) -> None:
        """Service returns 200 for both running and paused sessions."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_breakpoints"
        ) as mock_update:
            mock_update.return_value = {
                "session_id": session_id,
                "breakpoints": ["bp"],
                "session_status": live_status,
            }

            response = client.patch(
                f"/workbench/{session_id}/breakpoints",
                json={"breakpoints": ["bp"]},
            )

            assert response.status_code == 200
