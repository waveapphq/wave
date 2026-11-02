"""Unit tests for PATCH /workbench/{session_id}/debug-options.

Live debug-options patch endpoint used by the canvas right-click menu
toggles (Pause on Error / Pause on First Block) so that flipping a flag
mid-session is pushed to the running engine without re-starting the run.

Error contract:
    - 404 body: ``^Workbench session '[^']+' not found$``
    - 409 body: ``^Cannot update debug options: session is '[^']+', not running$``
"""

import asyncio
import re
import uuid
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import _common as _wb_common

_NOT_FOUND_RE = re.compile(r"^Workbench session '[^']+' not found$")
_CONFLICT_RE = re.compile(r"^Cannot update debug options: session is '[^']+', not running$")


def _make_session(
    session_id: str,
    *,
    status: str = "running",
    pause_on_first_block: bool = False,
    pause_on_errors: bool = False,
) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": status,
        "pause_event": asyncio.Event(),
        "debug_options": {
            "pause_on_first_block": pause_on_first_block,
            "pause_on_errors": pause_on_errors,
        },
    }


class TestUpdateDebugOptionsEndpoint:
    """Endpoint-level happy-path and error-path tests."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    def test_200_returns_updated_debug_options(self, client: TestClient, session_id: str) -> None:
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_debug_options"
        ) as mock_update:
            mock_update.return_value = {
                "session_id": session_id,
                "debug_options": {"pause_on_first_block": True, "pause_on_errors": True},
            }

            response = client.patch(
                f"/workbench/{session_id}/debug-options",
                json={"pause_on_first_block": True, "pause_on_errors": True},
            )

            assert response.status_code == 200
            body = response.json()
            assert body["success"] is True
            assert body["data"]["debug_options"] == {
                "pause_on_first_block": True,
                "pause_on_errors": True,
            }
            mock_update.assert_called_once_with(
                session_id=session_id,
                pause_on_first_block=True,
                pause_on_errors=True,
            )

    def test_200_partial_update_omits_unset_flag(self, client: TestClient, session_id: str) -> None:
        """Patching only one flag forwards None for the other so the service preserves it."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_debug_options"
        ) as mock_update:
            mock_update.return_value = {
                "session_id": session_id,
                "debug_options": {"pause_on_first_block": True, "pause_on_errors": False},
            }

            response = client.patch(
                f"/workbench/{session_id}/debug-options",
                json={"pause_on_first_block": True},
            )

            assert response.status_code == 200
            mock_update.assert_called_once_with(
                session_id=session_id,
                pause_on_first_block=True,
                pause_on_errors=None,
            )

    def test_404_when_session_not_found_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_debug_options"
        ) as mock_update:
            mock_update.side_effect = LookupError(f"Workbench session '{session_id}' not found")

            response = client.patch(
                f"/workbench/{session_id}/debug-options",
                json={"pause_on_errors": True},
            )

            assert response.status_code == 404
            body = response.json()
            assert body["success"] is False
            assert body["error"]["code"] == "NOT_FOUND"
            assert _NOT_FOUND_RE.match(body["error"]["message"]) is not None

    def test_409_when_session_not_running_or_paused_exact_message(
        self, client: TestClient, session_id: str
    ) -> None:
        with patch(
            "wavecore.api.routes.workbench.workbench_service.update_debug_options"
        ) as mock_update:
            mock_update.side_effect = ConflictException(
                "Cannot update debug options: session is 'passed', not running"
            )

            response = client.patch(
                f"/workbench/{session_id}/debug-options",
                json={"pause_on_errors": True},
            )

            assert response.status_code == 409
            body = response.json()
            assert body["success"] is False
            assert _CONFLICT_RE.match(body["error"]["message"]) is not None

    def test_400_for_invalid_session_id_uuid_format(self, client: TestClient) -> None:
        response = client.patch(
            "/workbench/not-a-uuid/debug-options",
            json={"pause_on_errors": True},
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_400_for_unknown_field(self, client: TestClient, session_id: str) -> None:
        """Extra fields are rejected by the strict-extra Pydantic model."""
        response = client.patch(
            f"/workbench/{session_id}/debug-options",
            json={"unknown_flag": True},
        )
        assert response.status_code == 400


class TestUpdateDebugOptionsService:
    """Direct calls against ``workbench_service.update_debug_options``."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    def test_raises_lookup_error_for_unknown_session(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        with pytest.raises(LookupError, match=r"^Workbench session 'missing' not found$"):
            workbench_service.update_debug_options("missing", pause_on_errors=True)

    def test_raises_conflict_for_idle_session(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        sid = "sess-idle"
        _wb_common._workbench_sessions[sid] = _make_session(sid, status="idle")
        with pytest.raises(
            ConflictException,
            match=r"^Cannot update debug options: session is 'idle', not running$",
        ):
            workbench_service.update_debug_options(sid, pause_on_errors=True)

    @pytest.mark.parametrize("live_status", ["running", "paused"])
    def test_patches_running_or_paused_session_partial_update(self, live_status: str) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        sid = f"sess-{live_status}"
        _wb_common._workbench_sessions[sid] = _make_session(
            sid,
            status=live_status,
            pause_on_first_block=False,
            pause_on_errors=False,
        )

        result = workbench_service.update_debug_options(sid, pause_on_errors=True)

        assert result["debug_options"]["pause_on_errors"] is True
        # Other flag preserved when not provided.
        assert result["debug_options"]["pause_on_first_block"] is False
        assert _wb_common._workbench_sessions[sid]["debug_options"]["pause_on_errors"] is True
        assert _wb_common._workbench_sessions[sid]["debug_options"]["pause_on_first_block"] is False

    def test_patches_both_flags_when_both_provided(self) -> None:
        from wavecore.api.services.workbench import service as workbench_service

        sid = "sess-both"
        _wb_common._workbench_sessions[sid] = _make_session(sid, status="running")

        result = workbench_service.update_debug_options(
            sid,
            pause_on_first_block=True,
            pause_on_errors=True,
        )

        assert result["debug_options"] == {
            "pause_on_first_block": True,
            "pause_on_errors": True,
        }

    def test_no_op_when_neither_flag_provided(self) -> None:
        """Calling with both args None preserves existing options."""
        from wavecore.api.services.workbench import service as workbench_service

        sid = "sess-noop"
        _wb_common._workbench_sessions[sid] = _make_session(
            sid,
            status="running",
            pause_on_first_block=True,
            pause_on_errors=False,
        )

        result = workbench_service.update_debug_options(sid)

        assert result["debug_options"] == {
            "pause_on_first_block": True,
            "pause_on_errors": False,
        }
