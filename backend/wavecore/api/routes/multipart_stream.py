"""Streaming multipart reader: parts arrive as events, so a file is never buffered whole.

Fields are handed over complete; a file part arrives as a start, its chunks and an
end, letting a route write the bytes out as fast as they land.
"""

from collections.abc import AsyncGenerator
from dataclasses import dataclass

from multipart.exceptions import MultipartParseError
from multipart.multipart import MultipartParser, parse_options_header
from starlette.requests import Request

from wavecore.api.exceptions import ValidationException

_MALFORMED_REQUEST = "Malformed multipart request"
_FIELD_TOO_LARGE = "Multipart field is too large"
_FIELD_MAX_BYTES = 1024 * 1024
_CHUNK_BYTES = 1024 * 1024


@dataclass(frozen=True)
class Field:
    """One form field, complete."""

    name: str
    value: str


@dataclass(frozen=True)
class FileStart:
    """A file part begins; its bytes follow as chunks."""

    name: str
    filename: str


@dataclass(frozen=True)
class FileChunk:
    """A slice of the file part being read."""

    data: bytes


@dataclass(frozen=True)
class FileEnd:
    """The file part is complete."""


Event = Field | FileStart | FileChunk | FileEnd


def _decode(raw: bytes | bytearray, charset: str) -> str:
    try:
        return bytes(raw).decode(charset)
    except (UnicodeDecodeError, LookupError):
        return bytes(raw).decode("latin-1")


class _PartCollector:
    """The parser callbacks turned into a queue of events the caller drains."""

    def __init__(self, charset: str) -> None:
        self._charset = charset
        self._events: list[Event] = []
        self._header_name = b""
        self._header_value = b""
        self._disposition = b""
        self._name = ""
        self._filename: str | None = None
        self._buffer = bytearray()

    def drain(self) -> list[Event]:
        """Take everything collected since the last call."""
        events, self._events = self._events, []
        return events

    def on_part_begin(self) -> None:
        self._disposition = b""
        self._name = ""
        self._filename = None
        self._buffer.clear()

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self._header_name += data[start:end]

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self._header_value += data[start:end]

    def on_header_end(self) -> None:
        if self._header_name.lower() == b"content-disposition":
            self._disposition = self._header_value
        self._header_name = b""
        self._header_value = b""

    def on_headers_finished(self) -> None:
        _, options = parse_options_header(self._disposition)
        if b"name" not in options:
            raise ValidationException(_MALFORMED_REQUEST)
        self._name = _decode(options[b"name"], self._charset)
        if b"filename" in options:
            self._filename = _decode(options[b"filename"], self._charset)
            self._events.append(FileStart(name=self._name, filename=self._filename))

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        self._buffer.extend(data[start:end])
        if self._filename is None:
            if len(self._buffer) > _FIELD_MAX_BYTES:
                raise ValidationException(_FIELD_TOO_LARGE)
        elif len(self._buffer) >= _CHUNK_BYTES:
            self._flush()

    def on_part_end(self) -> None:
        if self._filename is None:
            self._events.append(Field(name=self._name, value=_decode(self._buffer, self._charset)))
        else:
            self._flush()
            self._events.append(FileEnd())

    def _flush(self) -> None:
        if self._buffer:
            self._events.append(FileChunk(data=bytes(self._buffer)))
            self._buffer.clear()


def _feed(parser: MultipartParser, collector: _PartCollector, chunk: bytes) -> list[Event]:
    try:
        parser.write(chunk)
    except MultipartParseError as exc:
        raise ValidationException(_MALFORMED_REQUEST) from exc
    return collector.drain()


async def iter_events(request: Request) -> AsyncGenerator[Event, None]:
    """Yield one event per multipart part boundary as the request body arrives."""
    _, params = parse_options_header(request.headers.get("content-type", ""))
    boundary = params.get(b"boundary")
    if boundary is None:
        raise ValidationException(_MALFORMED_REQUEST)
    collector = _PartCollector(params.get(b"charset", b"utf-8").decode("latin-1"))
    parser = MultipartParser(
        boundary,
        {
            "on_part_begin": collector.on_part_begin,
            "on_part_data": collector.on_part_data,
            "on_part_end": collector.on_part_end,
            "on_header_field": collector.on_header_field,
            "on_header_value": collector.on_header_value,
            "on_header_end": collector.on_header_end,
            "on_headers_finished": collector.on_headers_finished,
        },
    )
    async for chunk in request.stream():
        for event in _feed(parser, collector, chunk):
            yield event
    parser.finalize()
