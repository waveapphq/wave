"""Sessionless-revision refusal at the MCP endpoint app.

WAVE identity is session-based: requests declaring a protocol revision
without sessions are refused with the exact rejection a pre-2.0 server
emits, which auto-negotiating clients answer by falling back to the
session-forming handshake. Handshake-era requests pass through untouched.
"""

import base64
from collections.abc import Callable
from typing import Any

from starlette.testclient import TestClient

WWW_AUTHENTICATE = 'Basic realm="WAVE MCP"'

MCP_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}

MODERN_HEADERS = {**MCP_HEADERS, "MCP-Protocol-Version": "2026-07-28"}

REJECTION_BODY = {
    "jsonrpc": "2.0",
    "id": "server-error",
    "error": {"code": -32600, "message": "Bad Request: Missing session ID"},
}

DISCOVER_BODY = {"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": {}}

TOOLS_CALL_BODY = {
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {"name": "list_environments", "arguments": {}},
}

INITIALIZE_BODY = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "era-probe", "version": "0.0.1"},
    },
}


def _client() -> TestClient:
    from wavecore.mcp import server as mcp_server

    return TestClient(mcp_server.build_mcp_app())


def _basic(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {token}"


class TestSessionlessRevisionRefused:
    def test_discover_post_gets_the_missing_session_rejection(self) -> None:
        with _client() as client:
            response = client.post(
                "/mcp",
                json=DISCOVER_BODY,
                headers={**MODERN_HEADERS, "Mcp-Method": "server/discover"},
            )

        assert response.status_code == 400
        assert response.json() == REJECTION_BODY
        assert "mcp-session-id" not in response.headers

    def test_tools_call_is_refused_and_nothing_is_recorded(self) -> None:
        from wavecore.mcp import state as mcp_state

        with _client() as client:
            response = client.post(
                "/mcp",
                json=TOOLS_CALL_BODY,
                headers={
                    **MODERN_HEADERS,
                    "Mcp-Method": "tools/call",
                    "Mcp-Name": "list_environments",
                },
            )

        assert response.status_code == 400
        assert response.json() == REJECTION_BODY
        assert mcp_state.list_sessions() == []
        assert mcp_state.get_activity() == []

    def test_unknown_future_revision_is_refused(self) -> None:
        with _client() as client:
            response = client.post(
                "/mcp",
                json=DISCOVER_BODY,
                headers={**MCP_HEADERS, "MCP-Protocol-Version": "2099-01-01"},
            )

        assert response.status_code == 400
        assert response.json() == REJECTION_BODY

    def test_get_with_a_sessionless_revision_is_refused(self) -> None:
        with _client() as client:
            response = client.get("/mcp", headers=MODERN_HEADERS)

        assert response.status_code == 400
        assert response.json() == REJECTION_BODY

    def test_delete_with_a_sessionless_revision_is_refused(self) -> None:
        with _client() as client:
            response = client.delete("/mcp", headers=MODERN_HEADERS)

        assert response.status_code == 400
        assert response.json() == REJECTION_BODY

    def test_auth_challenge_wins_over_the_refusal(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )
        with TestClient(mcp_server.build_mcp_app()) as client:
            response = client.post("/mcp", json=DISCOVER_BODY, headers=MODERN_HEADERS)

        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == WWW_AUTHENTICATE

    def test_auth_stored_in_the_config_file_wins_over_the_refusal(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.core.secrets.sealing import seal_value
        from wavecore.mcp import server as mcp_server

        load_config(
            {
                "mcp": {
                    "auth_enabled": True,
                    "auth_username": "ops",
                    "auth_password": seal_value("hunter2-secret"),
                }
            }
        )
        with TestClient(mcp_server.build_mcp_app()) as client:
            challenged = client.post("/mcp", json=DISCOVER_BODY, headers=MODERN_HEADERS)
            refused = client.post(
                "/mcp",
                json=DISCOVER_BODY,
                headers={**MODERN_HEADERS, "Authorization": _basic("ops", "hunter2-secret")},
            )

        assert challenged.status_code == 401
        assert challenged.headers["WWW-Authenticate"] == WWW_AUTHENTICATE
        assert refused.status_code == 400
        assert refused.json() == REJECTION_BODY


class TestHandshakeEraPassesThrough:
    def test_initialize_with_a_handshake_version_header_passes(self) -> None:
        with _client() as client:
            response = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "MCP-Protocol-Version": "2025-03-26"},
            )

        assert response.status_code == 200

    def test_request_without_a_version_header_passes(self) -> None:
        with _client() as client:
            response = client.post("/mcp", json=INITIALIZE_BODY, headers=MCP_HEADERS)

        assert response.status_code == 200


class TestBodyLimit:
    def test_oversized_post_is_rejected_entity_too_large(self) -> None:
        oversized = b"x" * (4 * 1024 * 1024 + 1)

        with _client() as client:
            response = client.post("/mcp", content=oversized, headers=MCP_HEADERS)

        assert response.status_code == 413
