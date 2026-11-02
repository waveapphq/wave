"""Refuses a request body that holds text UTF-8 cannot write (REQ-4.6.9)."""

import codecs
import json

from multipart.multipart import parse_options_header
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from wavecore.api.exceptions import UnencodableTextException
from wavecore.core.utf8_text import first_unencodable, may_hold_unencodable

_MULTIPART = b"multipart/"
_FORM_START = b"--"
_UTF8 = "utf-8"


def refusal(body: bytes) -> str | None:
    """Why a request body is refused, or None when all its text can be written as UTF-8."""
    if not may_hold_unencodable(body):
        return None
    try:
        document = json.loads(body)
    except ValueError:
        return None
    where = first_unencodable(document, "the body")
    if where is None:
        return None
    return (
        f"The request has a character at {where} that cannot be encoded as UTF-8, "
        "so it was refused: remove or replace it"
    )


def _replaying(read: list[Message], receive: Receive) -> Receive:
    """A receive that hands out what was read already, then goes on with the connection."""

    async def replay() -> Message:
        if read:
            return read.pop(0)
        return await receive()

    return replay


async def buffer_body(receive: Receive) -> tuple[bytes, Receive]:
    """Drain the request body, returning it plus a receive that replays it."""
    buffered: list[Message] = []
    chunks: list[bytes] = []
    while True:
        event = await receive()
        buffered.append(event)
        if event["type"] != "http.request":
            break
        chunks.append(event.get("body", b""))
        if not event.get("more_body"):
            break
    return b"".join(chunks), _replaying(buffered, receive)


async def _body_start(receive: Receive) -> tuple[bytes, Receive]:
    """The body's first bytes after any white space, plus a receive that replays what was read."""
    read: list[Message] = []
    start = b""
    while not start:
        event = await receive()
        read.append(event)
        if event["type"] != "http.request":
            break
        start = event.get("body", b"").lstrip()
        if not event.get("more_body"):
            break
    return start, _replaying(read, receive)


def _content_type(scope: Scope) -> tuple[bytes, dict[bytes, bytes]]:
    """The request's media type and its parameters, both empty when it names none."""
    headers: list[tuple[bytes, bytes]] = scope["headers"]
    for name, value in headers:
        if name == b"content-type":
            media_type, params = parse_options_header(value)
            return media_type.lower(), params
    return b"", {}


def _is_utf8(charset: str) -> bool:
    try:
        return codecs.lookup(charset).name == _UTF8
    except LookupError:
        return False


def upload_refusal(media_type: bytes, params: dict[bytes, bytes]) -> str | None:
    """Why an upload is refused, or None: a form's names and fields are read as UTF-8 only."""
    charset = params.get(b"charset")
    if charset is None or not media_type.startswith(_MULTIPART):
        return None
    named = charset.decode("latin-1")
    if _is_utf8(named):
        return None
    return (
        f"The upload names the charset {named}, and WAVE reads UTF-8 only, "
        "so it was refused: send it as UTF-8"
    )


async def _body_refusal(media_type: bytes, receive: Receive) -> tuple[str | None, Receive]:
    """Why the body is refused, if it is; a form upload is handed on after its first piece."""
    if media_type.startswith(_MULTIPART):
        start, receive = await _body_start(receive)
        if start.startswith(_FORM_START):
            return None, receive
    body, receive = await buffer_body(receive)
    return refusal(body), receive


class Utf8Guard:
    """Reads a request body before any handler does and refuses one UTF-8 cannot write."""

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            media_type, params = _content_type(scope)
            refused = upload_refusal(media_type, params)
            if refused is None:
                refused, receive = await _body_refusal(media_type, receive)
            if refused is not None:
                raise UnencodableTextException(refused)
        await self._app(scope, receive, send)
