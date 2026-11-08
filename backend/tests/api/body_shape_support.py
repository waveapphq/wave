"""Request bodies of the wrong JSON shape and the 400 messages the shared body readers give."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

NOT_JSON = "The request body is not valid JSON"
NOT_AN_OBJECT = "The request body must be a JSON object"
NOT_AN_ARRAY = "The request body must be a JSON array"

NOT_OBJECT_BODIES = [
    pytest.param('"name"', NOT_AN_OBJECT, id="string"),
    pytest.param("[1, 2]", NOT_AN_OBJECT, id="list"),
    pytest.param("5", NOT_AN_OBJECT, id="number"),
    pytest.param("{not json", NOT_JSON, id="not-json"),
]

NOT_ARRAY_BODIES = [
    pytest.param('"name"', NOT_AN_ARRAY, id="string"),
    pytest.param('{"name": 1}', NOT_AN_ARRAY, id="object"),
    pytest.param("5", NOT_AN_ARRAY, id="number"),
    pytest.param("{not json", NOT_JSON, id="not-json"),
]

NOT_AN_OBJECT_ITEM = "The item must be a JSON object"
NOT_AN_ID_ITEM = "The item must be an ID string"

NOT_OBJECT_ITEMS = [
    pytest.param(1, id="number"),
    pytest.param("name", id="string"),
    pytest.param([1], id="list"),
    pytest.param(None, id="null"),
]

NOT_ID_ITEMS = [
    pytest.param(1, id="number"),
    pytest.param({"id": "x"}, id="object"),
    pytest.param(["x"], id="list"),
    pytest.param(None, id="null"),
]


def send_text(client: TestClient, method: str, path: str, text: str) -> Any:
    """Send `text` as the JSON request body, whatever it holds."""
    return client.request(method, path, content=text, headers={"content-type": "application/json"})


def assert_refused(response: Any, message: str) -> None:
    """The request was a bad request with exactly `message`."""
    assert response.status_code == 400, response.json()
    assert response.json()["error"]["message"] == message
