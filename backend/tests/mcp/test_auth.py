"""HTTP Basic auth on the MCP endpoint app.

Drives the ASGI app returned by wavecore.mcp.server.build_mcp_app: requests
without/with wrong credentials get 401 + the exact WWW-Authenticate header;
correct credentials and auth-disabled requests pass through to the protocol
layer (never 401).
"""

import base64
from collections.abc import Callable
from typing import Any

import pytest
from starlette.testclient import TestClient

WWW_AUTHENTICATE = 'Basic realm="WAVE MCP"'

INITIALIZE_BODY = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "auth-probe", "version": "0.0.1"},
    },
}

MCP_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}


def _basic(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {token}"


def _client_with_auth_enabled() -> TestClient:
    from wavecore.mcp import server as mcp_server
    from wavecore.mcp import settings as mcp_settings

    mcp_settings.update_settings(
        auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
    )
    return TestClient(mcp_server.build_mcp_app())


class TestAuthEnabled:
    def test_missing_credentials_rejected_with_challenge(self) -> None:
        with _client_with_auth_enabled() as client:
            response = client.post("/mcp", json=INITIALIZE_BODY, headers=MCP_HEADERS)

        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == WWW_AUTHENTICATE

    def test_wrong_credentials_rejected(self) -> None:
        with _client_with_auth_enabled() as client:
            response = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "Authorization": _basic("ops", "wrong-pass")},
            )

        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == WWW_AUTHENTICATE

    def test_wrong_username_rejected(self) -> None:
        with _client_with_auth_enabled() as client:
            response = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "Authorization": _basic("intruder", "hunter2-secret")},
            )

        assert response.status_code == 401

    def test_malformed_authorization_header_rejected(self) -> None:
        with _client_with_auth_enabled() as client:
            response = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "Authorization": "Bearer not-basic"},
            )

        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == WWW_AUTHENTICATE

    def test_invalid_base64_credentials_rejected(self) -> None:
        with _client_with_auth_enabled() as client:
            response = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "Authorization": "Basic %%%not-base64%%%"},
            )

        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == WWW_AUTHENTICATE

    def test_credentials_without_colon_separator_rejected(self) -> None:
        token = base64.b64encode(b"opshunter2-secret").decode()
        with _client_with_auth_enabled() as client:
            response = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "Authorization": f"Basic {token}"},
            )

        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == WWW_AUTHENTICATE

    def test_correct_credentials_pass_through(self) -> None:
        with _client_with_auth_enabled() as client:
            response = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "Authorization": _basic("ops", "hunter2-secret")},
            )

        assert response.status_code == 200
        assert "WWW-Authenticate" not in response.headers


class TestAuthDisabled:
    def test_requests_pass_through_without_credentials(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(auth_enabled=False)
        with TestClient(mcp_server.build_mcp_app()) as client:
            response = client.post("/mcp", json=INITIALIZE_BODY, headers=MCP_HEADERS)

        assert response.status_code == 200
        assert "WWW-Authenticate" not in response.headers


class TestAuthIsSettingsDriven:
    def test_disabling_auth_after_enabling_takes_effect_on_rebuild(self) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )
        mcp_settings.update_settings(auth_enabled=False)

        with TestClient(mcp_server.build_mcp_app()) as client:
            response = client.post("/mcp", json=INITIALIZE_BODY, headers=MCP_HEADERS)

        assert response.status_code == 200


class TestAuthFromTheConfigFile:
    @pytest.fixture
    def sealed_auth_in_config(self, load_config: Callable[..., Any]) -> None:
        from wavecore.core.secrets.sealing import seal_value

        load_config(
            {
                "mcp": {
                    "auth_enabled": True,
                    "auth_username": "ops",
                    "auth_password": seal_value("hunter2-secret"),
                }
            }
        )

    def test_missing_credentials_rejected_with_challenge(self, sealed_auth_in_config: None) -> None:
        from wavecore.mcp import server as mcp_server

        with TestClient(mcp_server.build_mcp_app()) as client:
            response = client.post("/mcp", json=INITIALIZE_BODY, headers=MCP_HEADERS)

        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == WWW_AUTHENTICATE

    def test_only_the_sealed_password_from_the_file_authenticates(
        self, sealed_auth_in_config: None
    ) -> None:
        from wavecore.mcp import server as mcp_server

        with TestClient(mcp_server.build_mcp_app()) as client:
            wrong = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "Authorization": _basic("ops", "wrong-pass")},
            )
            correct = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "Authorization": _basic("ops", "hunter2-secret")},
            )

        assert wrong.status_code == 401
        assert wrong.headers["WWW-Authenticate"] == WWW_AUTHENTICATE
        assert correct.status_code == 200
        assert "WWW-Authenticate" not in correct.headers

    def test_saved_credentials_authenticate_after_a_restart(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.mcp import server as mcp_server
        from wavecore.mcp import settings as mcp_settings

        mcp_settings.update_settings(
            auth_enabled=True, auth_username="ops", auth_password="hunter2-secret"
        )
        load_config()

        with TestClient(mcp_server.build_mcp_app()) as client:
            missing = client.post("/mcp", json=INITIALIZE_BODY, headers=MCP_HEADERS)
            correct = client.post(
                "/mcp",
                json=INITIALIZE_BODY,
                headers={**MCP_HEADERS, "Authorization": _basic("ops", "hunter2-secret")},
            )

        assert missing.status_code == 401
        assert correct.status_code == 200
