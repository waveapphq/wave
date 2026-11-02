"""Failure reasons and texts, and the error answer shapes (REQ-5.1.2, OS-11)."""

import json
from decimal import Decimal
from http.client import responses
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from ._json_text import dumps

if TYPE_CHECKING:
    from ._rest import Answer

UNREACHABLE = "Unreachable"
AUTH_FAILED = "AuthFailed"
REQUEST_FAILED = "RequestFailed"
TIMEOUT = "Timeout"
VALIDATION = "Validation"

DASHBOARDS = (
    "This is the OpenSearch Dashboards address. The block needs the cluster address, "
    "usually port 9200"
)
_DASHBOARDS_KEYS = {"statusCode", "error", "message"}
_NOT_JSON = object()
_KINDS = {
    dict: "a map",
    list: "an array",
    str: "a string",
    bool: "a boolean",
    int: "an integer",
    float: "a float",
    Decimal: "a float",
}


class OpenSearchFailure(Exception):
    """A failure the OpenSearch core raises itself, with the reason the block reports."""

    def __init__(self, message: str, reason: str, *, forbidden: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason
        # A 403 security_exception: the credentials may not do this.
        self.forbidden = forbidden


def cut(text: str, limit: int) -> str:
    """The text, or its first `limit` characters plus `...`."""
    return text if len(text) <= limit else f"{text[:limit]}..."


def kind_of(value: Any) -> str:
    """The value's kind with its article, as the messages name it."""
    return _KINDS.get(type(value), "null")


def unreachable(where: str, error: BaseException) -> OpenSearchFailure:
    return OpenSearchFailure(f"Could not connect to OpenSearch at {where}: {error}", UNREACHABLE)


def connect_timeout(where: str, seconds: float) -> OpenSearchFailure:
    return OpenSearchFailure(
        f"Could not connect to OpenSearch at {where}: "
        f"no answer within {seconds} seconds (Connect timeout)",
        UNREACHABLE,
    )


def no_answer(where: str, error: BaseException) -> OpenSearchFailure:
    return OpenSearchFailure(
        f"OpenSearch at {where} closed the connection without an answer: {error}", UNREACHABLE
    )


def timeout_message(seconds: float) -> str:
    return (
        f"Timed out after {seconds} seconds; the connection was shut down, "
        "so OpenSearch ends the search"
    )


def failure_for(answer: "Answer", query_as_sent: Any = None) -> OpenSearchFailure:
    """The failure an answer that is not a 2xx JSON object stands for."""
    parsed = _parsed(answer.body)
    if _is_dashboards(answer, parsed):
        return OpenSearchFailure(DASHBOARDS, VALIDATION)
    status = answer.status
    reason = AUTH_FAILED if status == 401 else REQUEST_FAILED
    error = parsed.get("error") if isinstance(parsed, dict) else None
    if isinstance(error, dict):
        return _envelope_failure(status, error, query_as_sent)
    if isinstance(error, str):
        return OpenSearchFailure(error, reason)
    text = answer.body.decode("utf-8", "replace").strip()
    if not text:
        phrase = answer.reason or responses.get(status, "")
        return OpenSearchFailure(f"HTTP {status} {phrase} (no body)", reason)
    if parsed is _NOT_JSON:
        not_json = "the answer is not JSON: " if 200 <= status < 300 else ""
        return OpenSearchFailure(f"HTTP {status}: {not_json}{text.splitlines()[0][:200]}", reason)
    return OpenSearchFailure(f"HTTP {status}: {dumps(parsed)[:200]}", reason)


def _parsed(body: bytes) -> Any:
    try:
        return json.loads(body, parse_float=Decimal)
    except ValueError:
        return _NOT_JSON


def _is_dashboards(answer: "Answer", parsed: Any) -> bool:
    location = urlsplit(answer.headers.get("location", "")).path
    return (
        "osd-name" in answer.headers
        or (300 <= answer.status < 400 and location.startswith("/app/"))
        or (isinstance(parsed, dict) and parsed.keys() == _DASHBOARDS_KEYS)
    )


def _envelope_failure(status: int, error: dict[str, Any], query_as_sent: Any) -> OpenSearchFailure:
    kind, text = error.get("type"), error.get("reason")
    if kind == "search_phase_execution_exception" and text == "all shards failed":
        causes = error.get("root_cause") or [
            shard.get("reason") for shard in error.get("failed_shards") or []
        ]
        first = f"First root cause: {causes[0]['type']}: {causes[0]['reason']}. " if causes else ""
        query = cut(dumps(query_as_sent), 4000)
        return OpenSearchFailure(f"{kind}: {text}. {first}Query as sent: {query}", REQUEST_FAILED)
    forbidden = status == 403 and kind == "security_exception"
    return OpenSearchFailure(
        _own_words(error),
        AUTH_FAILED if status == 401 or forbidden else REQUEST_FAILED,
        forbidden=forbidden,
    )


def _own_words(error: dict[str, Any]) -> str:
    """The first root cause when it names one: a wrapper exception hides the author's mistake."""
    first = (error.get("root_cause") or [None])[0]
    if isinstance(first, dict) and first.get("type") and first.get("reason"):
        return f"{first['type']}: {first['reason']}"
    return f"{error.get('type')}: {error.get('reason')}"
