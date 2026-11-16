"""The error replies the shared error handler gives, as every API test reads them."""

from typing import Any

INTERNAL_ERROR_MESSAGE = "An internal server error occurred"


def assert_internal_error(response: Any, internal_text: str) -> None:
    """An unexpected fault: 500, the generic message and a request id, never the fault's text."""
    assert response.status_code == 500, response.text
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert body["error"]["message"] == INTERNAL_ERROR_MESSAGE
    assert body["meta"]["request_id"]
    assert response.headers["X-Request-ID"] == body["meta"]["request_id"]
    assert internal_text not in response.text


def assert_error_reply(response: Any, status_code: int, code: str, message: str) -> None:
    """An expected refusal: the status, code and exact message, with a request id."""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code
    assert body["error"]["message"] == message
    assert body["meta"]["request_id"]
    assert response.headers["X-Request-ID"] == body["meta"]["request_id"]
