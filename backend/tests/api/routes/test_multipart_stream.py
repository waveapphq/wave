"""Streaming multipart reader: parts arrive as events while the body is still coming in."""

import pytest
from starlette.requests import Request

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes import multipart_stream

_BOUNDARY = "stream-boundary"
_CONTENT_TYPE = f"multipart/form-data; boundary={_BOUNDARY}"


def _part(name: str, filename: str | None, content: bytes) -> bytes:
    disposition = f'form-data; name="{name}"'
    if filename is not None:
        disposition += f'; filename="{filename}"'
    head = f"--{_BOUNDARY}\r\nContent-Disposition: {disposition}\r\n\r\n".encode()
    return head + content + b"\r\n"


def _closing() -> bytes:
    return f"--{_BOUNDARY}--\r\n".encode()


def _request(chunks: list[bytes], content_type: str = _CONTENT_TYPE) -> Request:
    """A Request whose body arrives as the given ASGI chunks."""
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/upload",
        "headers": [(b"content-type", content_type.encode())],
    }
    pending = list(chunks)

    async def receive() -> dict[str, object]:
        if pending:
            return {"type": "http.request", "body": pending.pop(0), "more_body": bool(pending)}
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request(scope, receive)


async def _events(chunks: list[bytes], content_type: str = _CONTENT_TYPE) -> list[object]:
    return [event async for event in multipart_stream.iter_events(_request(chunks, content_type))]


class TestEventOrder:
    """Fields arrive whole; a file arrives as a start, its chunks and an end."""

    async def test_a_field_arrives_as_one_event(self) -> None:
        events = await _events([_part("path", None, b"fixtures") + _closing()])

        assert events == [multipart_stream.Field(name="path", value="fixtures")]

    async def test_a_file_arrives_as_start_chunk_and_end(self) -> None:
        events = await _events([_part("files", "a.csv", b"id,name\n") + _closing()])

        assert events == [
            multipart_stream.FileStart(name="files", filename="a.csv"),
            multipart_stream.FileChunk(data=b"id,name\n"),
            multipart_stream.FileEnd(),
        ]

    async def test_fields_keep_their_place_before_the_file(self) -> None:
        body = (
            _part("path", None, b"")
            + _part("replace", None, b"true")
            + _part("files", "a.csv", b"x")
            + _closing()
        )

        events = await _events([body])

        assert [type(event).__name__ for event in events] == [
            "Field",
            "Field",
            "FileStart",
            "FileChunk",
            "FileEnd",
        ]

    async def test_two_file_parts_each_get_their_own_events(self) -> None:
        body = _part("files", "a.csv", b"a") + _part("files", "b.csv", b"b") + _closing()

        events = await _events([body])

        assert [event for event in events if isinstance(event, multipart_stream.FileStart)] == [
            multipart_stream.FileStart(name="files", filename="a.csv"),
            multipart_stream.FileStart(name="files", filename="b.csv"),
        ]

    async def test_an_empty_file_part_has_no_chunks(self) -> None:
        events = await _events([_part("files", "a.csv", b"") + _closing()])

        assert events == [
            multipart_stream.FileStart(name="files", filename="a.csv"),
            multipart_stream.FileEnd(),
        ]

    async def test_a_body_that_ends_mid_part_never_ends_the_file(self) -> None:
        events = await _events([_part("files", "a.csv", b"half")])

        assert not any(isinstance(event, multipart_stream.FileEnd) for event in events)


class TestFileChunking:
    """File bytes are handed over as they arrive, never held as one whole body."""

    async def test_a_body_split_across_asgi_chunks_reassembles(self) -> None:
        body = _part("files", "a.csv", b"0123456789") + _closing()

        events = await _events([body[:20], body[20:40], body[40:]])

        data = b"".join(
            event.data for event in events if isinstance(event, multipart_stream.FileChunk)
        )
        assert data == b"0123456789"

    async def test_a_large_part_is_handed_over_in_several_chunks(self) -> None:
        payload = b"z" * (3 * 1024 * 1024)
        body = _part("files", "big.bin", payload) + _closing()

        events = await _events([body[i : i + 65536] for i in range(0, len(body), 65536)])

        chunks = [event for event in events if isinstance(event, multipart_stream.FileChunk)]
        assert len(chunks) > 1
        assert b"".join(chunk.data for chunk in chunks) == payload


class TestMalformedRequests:
    """Everything the parser cannot make sense of is one refusal."""

    async def test_a_missing_boundary_is_refused(self) -> None:
        with pytest.raises(ValidationException, match=r"^Malformed multipart request$"):
            await _events([b"anything"], "multipart/form-data")

    async def test_a_body_that_is_not_multipart_is_refused(self) -> None:
        with pytest.raises(ValidationException, match=r"^Malformed multipart request$"):
            await _events([b"plain bytes, no boundary in sight"])

    async def test_a_part_without_a_name_is_refused(self) -> None:
        body = b"--" + _BOUNDARY.encode() + b"\r\nContent-Disposition: form-data\r\n\r\nx\r\n"

        with pytest.raises(ValidationException, match=r"^Malformed multipart request$"):
            await _events([body + _closing()])

    async def test_an_oversized_field_value_is_refused(self) -> None:
        body = _part("path", None, b"x" * (1024 * 1024 + 1)) + _closing()

        with pytest.raises(ValidationException, match=r"^Multipart field is too large$"):
            await _events([body])


class TestCharset:
    """Field and file names follow the request charset, with a byte-safe fallback."""

    async def test_a_declared_charset_is_used(self) -> None:
        content_type = f"{_CONTENT_TYPE}; charset=utf-8"

        events = await _events([_part("path", None, "café".encode()) + _closing()], content_type)

        assert events == [multipart_stream.Field(name="path", value="café")]

    async def test_an_unknown_charset_falls_back_to_latin_1(self) -> None:
        content_type = f"{_CONTENT_TYPE}; charset=not-a-codec"

        events = await _events([_part("path", None, b"\xe9") + _closing()], content_type)

        assert events == [multipart_stream.Field(name="path", value="é")]
