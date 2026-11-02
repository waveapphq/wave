"""The MCP endpoint refuses a request holding text UTF-8 cannot write (REQ-4.6.9).

The endpoint is its own application, so it runs the same check as the REST
application on every POST body and answers in the JSON-RPC error shape its
other refusals use. A refused request never reaches the SDK application.
"""

import json
from typing import Any

from starlette.testclient import TestClient

from wavecore.mcp import server as mcp_server
from wavecore.mcp import state as mcp_state

MCP_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}
_REFUSED = (
    "The request has a character at params.arguments.recipe that cannot be encoded as UTF-8, "
    "so it was refused: remove or replace it"
)


def _tool_call(recipe: str) -> bytes:
    """A create_test_from_recipe call as the bytes a client sends."""
    message = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {"name": "create_test_from_recipe", "arguments": {"recipe": recipe}},
    }
    return json.dumps(message).encode()


def _endpoint(reached: list[bytes]) -> TestClient:
    """The endpoint wrapper around an application that records the bodies it is handed."""

    async def sdk_app(_scope: Any, receive: Any, send: Any) -> None:
        reached.append((await receive())["body"])
        await send({"type": "http.response.start", "status": 202, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    return TestClient(
        mcp_server._McpEndpointApp(sdk_app, auth_enabled=False, username="", password="")
    )


class TestUnencodableTextRefused:
    def test_a_tool_call_holding_a_lone_surrogate_is_refused(self) -> None:
        body = _tool_call("name: cafe\udce9")
        assert rb"cafe\udce9" in body

        with TestClient(mcp_server.build_mcp_app()) as client:
            response = client.post("/mcp", content=body, headers=MCP_HEADERS)

        assert response.status_code == 422
        assert response.json() == {
            "jsonrpc": "2.0",
            "id": "server-error",
            "error": {"code": -32600, "message": _REFUSED},
        }
        assert mcp_state.list_sessions() == []
        assert mcp_state.get_activity() == []

    def test_a_refused_request_never_reaches_the_sdk_application(self) -> None:
        reached: list[bytes] = []

        response = _endpoint(reached).post(
            "/mcp", content=_tool_call("name: cafe\udce9"), headers=MCP_HEADERS
        )

        assert response.status_code == 422
        assert reached == []

    def test_a_clean_request_reaches_the_sdk_application_unchanged(self) -> None:
        reached: list[bytes] = []
        body = _tool_call("name: café 😀")

        response = _endpoint(reached).post("/mcp", content=body, headers=MCP_HEADERS)

        assert response.status_code == 202
        assert reached == [body]
