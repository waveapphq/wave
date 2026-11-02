"""Template override (REQ-3.1.3.15): a template re-arms lazily and never pushes."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Generator
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench._common import DEFAULT_USER_ID
from wavecore.api.services.workbench.lazy_variables import LazyVariables


@pytest.fixture(autouse=True)
def _clean_sessions() -> Generator[None, None, None]:
    _wb_common._clear_sessions_sync()
    yield
    _wb_common._clear_sessions_sync()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _seed_session(
    session_id: str,
    *,
    variables: Any,
    status: str = "paused",
) -> dict[str, Any]:
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": status,
        "test_id": "test-1",
        "user_id": DEFAULT_USER_ID,
        "block_states": {},
        "variables": variables,
        "variable_types": {"user": "string", "greeting": "string"},
    }
    _wb_common._workbench_sessions[session_id] = session
    return session


class TestSetVariableOverrideServiceTemplate:
    """Template overrides: re-arm the source, no push at override time."""

    def test_template_override_rearms_pending_and_returns_pending_payload(self) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({"user": "Ada"})
        _seed_session(session_id, variables=lazy)

        result = workbench_service.set_variable_override(
            session_id, "greeting", template="Hi {{user}}", declared_type="string"
        )

        assert result == {"name": "greeting", "value": None, "pending": True}
        # Pending template: reachable but not yet realized.
        assert "greeting" in lazy
        assert "greeting" not in lazy.copy()

    def test_template_override_reevaluates_new_source_on_next_reference(self) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({"user": "Ada", "greeting": "stale"})
        _seed_session(session_id, variables=lazy)

        workbench_service.set_variable_override(
            session_id, "greeting", template="Hello {{user}}", declared_type="string"
        )

        # The prior realized value is discarded; next reference renders the source.
        assert lazy["greeting"] == "Hello Ada"

    async def test_template_override_does_not_push(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"user": "Ada"}))

        recorded: list[tuple[str, str, Any]] = []

        async def fake_push(sid: str, name: str, value: Any) -> None:
            recorded.append((sid, name, value))

        with patch(
            "wavecore.api.services.workbench._common._push_single_variable_change",
            new=fake_push,
        ):
            workbench_service.set_variable_override(
                session_id, "greeting", template="Hi {{user}}", declared_type="string"
            )
            await asyncio.gather(
                *[t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
            )

        assert recorded == []


class TestSetVariableOverrideServiceTemplateGates:
    """Run-state gate and the extended three-way request-shape guard."""

    def test_running_session_with_template_raises_conflict(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"user": "Ada"}), status="running")

        with pytest.raises(
            ConflictException,
            match=r"^Cannot override variable 'greeting' while the session is running$",
        ):
            workbench_service.set_variable_override(
                session_id, "greeting", template="Hi {{user}}", declared_type="string"
            )

    def test_value_and_template_raises_exactly_one_of(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}))

        with pytest.raises(
            ValueError,
            match=(
                r"^Override request must provide exactly one of "
                r"'value', 'expression', or 'template'$"
            ),
        ):
            workbench_service.set_variable_override(
                session_id,
                "greeting",
                value="x",
                value_given=True,
                template="Hi",
                declared_type="string",
            )

    def test_expression_and_template_raises_exactly_one_of(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}))

        with pytest.raises(
            ValueError,
            match=(
                r"^Override request must provide exactly one of "
                r"'value', 'expression', or 'template'$"
            ),
        ):
            workbench_service.set_variable_override(
                session_id,
                "greeting",
                expression="user",
                template="Hi {{user}}",
                declared_type="string",
            )


class TestVariableOverrideTemplateEndpoint:
    """PATCH /workbench/{session_id}/variables/{name} template contract."""

    def test_patch_template_returns_200_pending_payload(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({"user": "Ada"})
        _seed_session(session_id, variables=lazy)

        response = client.patch(
            f"/workbench/{session_id}/variables/greeting",
            json={"template": "Hi {{user}}", "type": "string"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"] == {"name": "greeting", "value": None, "pending": True}
        # Re-armed, lazily rendered on next reference.
        assert lazy["greeting"] == "Hi Ada"

    def test_patch_running_session_with_template_409(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"user": "Ada"}), status="running")

        response = client.patch(
            f"/workbench/{session_id}/variables/greeting",
            json={"template": "Hi {{user}}", "type": "string"},
        )

        assert response.status_code == 409
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "CONFLICT"
        assert (
            body["error"]["message"]
            == "Cannot override variable 'greeting' while the session is running"
        )

    def test_patch_value_and_template_400_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}))

        response = client.patch(
            f"/workbench/{session_id}/variables/greeting",
            json={"value": "x", "template": "Hi", "type": "string"},
        )

        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == (
            "Override request must provide exactly one of 'value', 'expression', or 'template'"
        )
