"""Browser-session id projection on the ownership state.

Covers the browser_session_id field added to the /workbench/ownership GET
projection: it mirrors mcp_session_id but is set from the holder id only when
the holder kind is person.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


class TestGetOwnershipBrowserId:
    def test_browser_session_id_is_holder_id_when_person_holds(self, client: TestClient) -> None:
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "u1", "holder_label": "User One"},
        )

        response = client.get("/workbench/ownership", params={"holder_id": "u1"})

        data = response.json()["data"]
        assert data["browser_session_id"] == "u1"
        assert data["mcp_session_id"] is None

    def test_browser_session_id_is_none_when_no_holder(self, client: TestClient) -> None:
        response = client.get("/workbench/ownership", params={"holder_id": "u1"})

        assert response.json()["data"]["browser_session_id"] is None

    def test_browser_session_id_is_none_when_mcp_holds(self, client: TestClient) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.mcp import state as mcp_state

        mcp_state.register_session("s1", "claude-code", "2.1.0", "127.0.0.1")
        with patch.object(ownership, "_emit"):
            ownership.claim("s1", mcp_state.mcp_holder_label("s1"), "mcp")

        response = client.get("/workbench/ownership", params={"holder_id": "s1"})

        data = response.json()["data"]
        assert data["browser_session_id"] is None
        assert data["mcp_session_id"] == "s1"
