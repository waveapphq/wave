"""HTTP request body modes (REQ-3.4.1.4, HTTP-8/HTTP-9/HTTP-10).

A body may accompany ANY method; body params
are gated by `body_mode` alone. Modes: text (raw string), form (URL-encoded
from form_fields), multipart (form-data assembled from text + file parts),
file (a single file as the body). Multipart and file bodies stream from disk
without buffering; file sources are artifact:// / testdata:// references or
absolute paths, resolved where the node runs.

Builder contract: form -> httpx `data=`, multipart -> streaming
`files=` (+ `data=` for text parts), file -> streaming `content=`. Wire-level
correctness is asserted against the local recording server.

Generated body headers: `body_auto_headers` (default true)
owns the mode-implied Content-Type - form sends url-encoded, file sends
`file_content_type` (or extension detection on "auto"), multipart is FORCED
generated (transport owns the boundary). When WAVE generates a Content-Type
it silently overwrites same-named map rows; with the checkbox off WAVE sets
nothing and manual rows forward as ordinary headers.

Auto content type (REQ-3.4.3.10): a file body and a multipart file part on
"auto" take their type from the extension in WAVE's own file-type table, never
from the WAVE host's file-type configuration.
"""

import email
import mimetypes
import urllib.parse
from typing import Any
from unittest.mock import Mock

import pytest

from tests.plugins.http.httpx_fakes import make_mock_client, patch_async_client

_AUTO_TYPES = {
    "sheet.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "values.yaml": "application/yaml",
    "values.yml": "application/yaml",
    "events.jsonl": "application/jsonl",
    "client.ts": "text/typescript",
    "rows.csv": "text/csv",
    "payload.unknownext": "application/octet-stream",
}


def _context(parameters: dict[str, Any], **extra: Any) -> dict[str, Any]:
    context: dict[str, Any] = {"parameters": parameters, "logger": Mock(), "variables": {}}
    context.update(extra)
    return context


@pytest.fixture
def host_file_types(monkeypatch: pytest.MonkeyPatch) -> Mock:
    """Spy on the host's file-type lookup; the lookup itself still answers."""
    spy = Mock(wraps=mimetypes)
    monkeypatch.setattr(mimetypes, "guess_type", spy.guess_type)
    monkeypatch.setattr(mimetypes, "init", spy.init)
    return spy


def _file_part_types(request: dict[str, Any]) -> dict[str, str | None]:
    """The Content-Type the wire body declares for each file part, by file name."""
    head = f"Content-Type: {request['headers']['content-type']}\r\n\r\n".encode()
    message = email.message_from_bytes(head + request["body"])
    return {
        part.get_filename(): part["Content-Type"]
        for part in message.get_payload()
        if part.get_filename()
    }


class TestBodyModeMetadata:
    """New body-mode parameters."""

    def test_body_mode_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        body_mode = params["body_mode"]
        assert body_mode["type"] == "string"
        assert body_mode["required"] is False
        assert body_mode["default"] == "text"
        assert body_mode["enum_values"] == ["text", "form", "multipart", "file"]

    def test_form_fields_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        form_fields = params["form_fields"]
        assert form_fields["type"] == "map"
        assert form_fields["required"] is False

    def test_parts_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        parts = params["parts"]
        assert parts["type"] == "array"
        assert parts["required"] is False

    def test_file_source_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        file_source = params["file_source"]
        assert file_source["type"] == "string"

    def test_body_parameter_survives_unchanged(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        body = params["body"]
        assert body["type"] == "string"
        assert body["required"] is False

    def test_body_auto_headers_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        auto_headers = params["body_auto_headers"]
        assert auto_headers["type"] == "boolean"
        assert auto_headers["required"] is False
        assert auto_headers["default"] is True

    def test_file_content_type_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        file_ct = params["file_content_type"]
        assert file_ct["type"] == "string"
        assert file_ct["required"] is False
        assert file_ct["default"] == "auto"
        assert file_ct["trim"] is True
        assert file_ct["enum_values"] == [
            "auto",
            "application/json",
            "application/xml",
            "text/plain",
            "text/html",
            "application/yaml",
            "application/octet-stream",
        ]


class TestBodyModeValidation:
    """Enum + conditional-requirement validation."""

    @pytest.mark.asyncio
    async def test_invalid_body_mode_rejected_with_enum_message(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'body_mode' must be one of: "
                r"text, form, multipart, file; "
                r"Actual value was 'INVALID'\.$"
            ),
        ):
            await plugin.validate(
                {"method": "POST", "url": "http://example.com", "body_mode": "INVALID"}
            )

    @pytest.mark.asyncio
    async def test_file_mode_requires_file_source(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Missing required parameter: file_source$"):
            await plugin.validate(
                {"method": "PUT", "url": "http://example.com", "body_mode": "file"}
            )

    @pytest.mark.asyncio
    async def test_valid_modes_accepted(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        # Should not raise
        await plugin.validate(
            {
                "method": "POST",
                "url": "http://example.com",
                "body_mode": "form",
                "form_fields": {"a": "1"},
            }
        )
        await plugin.validate(
            {
                "method": "POST",
                "url": "http://example.com",
                "body_mode": "multipart",
                "parts": [{"kind": "text", "name": "a", "value": "1"}],
            }
        )

    @pytest.mark.asyncio
    async def test_invalid_file_content_type_rejected_with_enum_message(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'file_content_type' must be one of: "
                r"auto, application/json, application/xml, text/plain, "
                r"text/html, application/yaml, application/octet-stream; "
                r"Actual value was 'INVALID'\.$"
            ),
        ):
            await plugin.validate(
                {
                    "method": "PUT",
                    "url": "http://example.com",
                    "body_mode": "file",
                    "file_source": "/data/payload.bin",
                    "file_content_type": "INVALID",
                }
            )

    @pytest.mark.asyncio
    async def test_body_auto_headers_must_be_boolean(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match=r"^Parameter 'body_auto_headers' must be a boolean$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "body_auto_headers": "yes"}
            )


class TestBodyOnAnyMethod:
    """The `_METHODS_WITH_BODY` gate is deleted: content forwards whenever
    body config is present, whatever the method."""

    @pytest.mark.asyncio
    async def test_get_with_body_forwards_content(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": "http://example.com/_search",
                        "body": '{"query": {"match_all": {}}}',
                    }
                )
            )

        call_kwargs = client.request.call_args.kwargs
        assert call_kwargs["method"] == "GET"
        assert call_kwargs["content"] == '{"query": {"match_all": {}}}'

    @pytest.mark.asyncio
    async def test_options_with_body_forwards_content(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context(
                    {
                        "method": "OPTIONS",
                        "url": "http://example.com",
                        "body": "opt-body",
                    }
                )
            )

        assert client.request.call_args.kwargs["content"] == "opt-body"

    @pytest.mark.asyncio
    async def test_empty_body_sends_nothing(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(_context({"method": "POST", "url": "http://example.com"}))

        assert client.request.call_args.kwargs.get("content") is None

    @pytest.mark.asyncio
    async def test_get_with_body_reaches_the_server(self, http_server):
        """Elasticsearch-style GET-with-body arrives on the wire."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"hits")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/_search",
                    "body": '{"query": {"match_all": {}}}',
                }
            )
        )

        assert result["status_code"] == 200
        assert http_server.requests[0]["method"] == "GET"
        assert http_server.requests[0]["body"] == b'{"query": {"match_all": {}}}'


class TestFormMode:
    """form_fields -> URL-encoded body via httpx data=, generated Content-Type."""

    @pytest.mark.asyncio
    async def test_form_mode_builds_data_kwarg(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context(
                    {
                        "method": "POST",
                        "url": "http://example.com/login",
                        "body_mode": "form",
                        "form_fields": {"user": "alice", "scope": "read write"},
                    }
                )
            )

        call_kwargs = client.request.call_args.kwargs
        assert call_kwargs["data"] == {"user": "alice", "scope": "read write"}
        assert call_kwargs.get("content") is None

    @pytest.mark.asyncio
    async def test_form_mode_sends_urlencoded_pairs_on_the_wire(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/login",
                    "body_mode": "form",
                    "form_fields": {"user": "alice", "scope": "read write"},
                }
            )
        )

        assert result["status_code"] == 200
        request = http_server.requests[0]
        assert request["headers"]["content-type"] == "application/x-www-form-urlencoded"
        pairs = urllib.parse.parse_qs(request["body"].decode())
        assert pairs == {"user": ["alice"], "scope": ["read write"]}


class TestMultipartMode:
    """parts -> multipart/form-data with generated boundary; file parts stream."""

    @staticmethod
    def _parts(file_path: str) -> list[dict[str, str]]:
        return [
            {"kind": "text", "name": "field", "value": "hello"},
            {"kind": "file", "name": "upload", "source": file_path},
        ]

    @pytest.mark.asyncio
    async def test_multipart_mode_builds_streaming_files_kwarg(self, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "data.bin"
        source.write_bytes(b"\x00\x01payload")
        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context(
                    {
                        "method": "POST",
                        "url": "http://example.com/upload",
                        "body_mode": "multipart",
                        "parts": self._parts(str(source)),
                    }
                )
            )

        call_kwargs = client.request.call_args.kwargs
        files = call_kwargs["files"]
        assert files, "multipart file parts must ride the httpx files= kwarg"
        # The file part streams from disk: a file-like object, never in-memory bytes.
        file_payloads = [entry[1] for entry in files]
        assert any(
            hasattr(payload[1] if isinstance(payload, tuple) else payload, "read")
            for payload in file_payloads
        )

    @pytest.mark.asyncio
    async def test_multipart_wire_body_carries_text_and_file_parts(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "data.bin"
        source.write_bytes(b"\x00\x01binary-payload")
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "multipart",
                    "parts": self._parts(str(source)),
                }
            )
        )

        assert result["status_code"] == 200
        request = http_server.requests[0]
        content_type = request["headers"]["content-type"]
        assert content_type.startswith("multipart/form-data")
        assert "boundary=" in content_type
        body = request["body"]
        assert b'name="field"' in body
        assert b"hello" in body
        assert b'name="upload"' in body
        # The filename defaults to the source basename.
        assert b'filename="data.bin"' in body
        assert b"\x00\x01binary-payload" in body
        # Part content type is auto-derived from the file extension.
        assert b"application/octet-stream" in body

    @pytest.mark.asyncio
    async def test_multipart_file_part_resolves_artifact_scheme(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        (tmp_path / "seed.txt").write_text("artifact-part-bytes")
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "multipart",
                    "parts": [{"kind": "file", "name": "seed", "source": "artifact://seed.txt"}],
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert result["status_code"] == 200
        body = http_server.requests[0]["body"]
        assert b'filename="seed.txt"' in body
        assert b"artifact-part-bytes" in body


class TestFileMode:
    """file_source -> the file IS the body, streamed, Content-Type from extension."""

    @pytest.mark.asyncio
    async def test_file_mode_streams_content_not_bytes(self, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "payload.bin"
        source.write_bytes(b"x" * 4096)
        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context(
                    {
                        "method": "PUT",
                        "url": "http://example.com/upload",
                        "body_mode": "file",
                        "file_source": str(source),
                    }
                )
            )

        content = client.request.call_args.kwargs["content"]
        assert content is not None
        assert not isinstance(content, str | bytes), "file bodies must stream, not buffer"

    @pytest.mark.asyncio
    async def test_file_mode_sends_file_bytes_with_auto_content_type(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "doc.json"
        source.write_text('{"k": "v"}')
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"stored")

        result = await plugin.execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/docs/doc.json",
                    "body_mode": "file",
                    "file_source": str(source),
                }
            )
        )

        assert result["status_code"] == 200
        request = http_server.requests[0]
        assert request["body"] == b'{"k": "v"}'
        assert request["headers"]["content-type"] == "application/json"

    @pytest.mark.asyncio
    async def test_file_mode_manual_content_type_forwards_with_auto_headers_off(
        self, http_server, tmp_path
    ):
        """User override of the file Content-Type = checkbox off + a manual row."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "doc.json"
        source.write_text('{"k": "v"}')
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"stored")

        await plugin.execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/docs/doc.json",
                    "body_mode": "file",
                    "body_auto_headers": False,
                    "file_source": str(source),
                    "headers": {"Content-Type": "application/x-custom"},
                }
            )
        )

        assert http_server.requests[0]["headers"]["content-type"] == "application/x-custom"

    @pytest.mark.asyncio
    async def test_file_mode_resolves_testdata_scheme(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        (tmp_path / "fixture.csv").write_text("a,b\n1,2\n")
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/import",
                    "body_mode": "file",
                    "file_source": "testdata://fixture.csv",
                },
                testdata_dirs=[str(tmp_path)],
            )
        )

        assert result["status_code"] == 200
        assert http_server.requests[0]["body"] == b"a,b\n1,2\n"


class TestGeneratedContentType:
    """body_auto_headers owns the generated Content-Type; multipart is forced."""

    @pytest.mark.asyncio
    async def test_checkbox_off_file_mode_sends_no_content_type(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "doc.json"
        source.write_text('{"k": "v"}')
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"stored")

        await plugin.execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/docs/doc.json",
                    "body_mode": "file",
                    "body_auto_headers": False,
                    "file_source": str(source),
                }
            )
        )

        request = http_server.requests[0]
        assert "content-type" not in request["headers"]
        assert request["body"] == b'{"k": "v"}'

    @pytest.mark.asyncio
    async def test_checkbox_off_form_mode_still_delivers_urlencoded_body(self, http_server):
        """WAVE sets nothing; the transport default applies - do not fight it."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/login",
                    "body_mode": "form",
                    "body_auto_headers": False,
                    "form_fields": {"user": "alice", "scope": "read write"},
                }
            )
        )

        request = http_server.requests[0]
        pairs = urllib.parse.parse_qs(request["body"].decode())
        assert pairs == {"user": ["alice"], "scope": ["read write"]}
        assert request["headers"]["content-type"] == "application/x-www-form-urlencoded"

    @pytest.mark.asyncio
    async def test_checkbox_off_form_mode_forwards_a_manual_content_type_row(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/login",
                    "body_mode": "form",
                    "body_auto_headers": False,
                    "form_fields": {"a": "1"},
                    "headers": {"Content-Type": "text/x-custom"},
                }
            )
        )

        request = http_server.requests[0]
        assert request["headers"]["content-type"] == "text/x-custom"
        assert urllib.parse.parse_qs(request["body"].decode()) == {"a": ["1"]}

    @pytest.mark.asyncio
    async def test_explicit_file_content_type_is_sent(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "doc.json"
        source.write_text("k: v\n")
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"stored")

        await plugin.execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/docs",
                    "body_mode": "file",
                    "file_source": str(source),
                    "file_content_type": "application/yaml",
                }
            )
        )

        assert http_server.requests[0]["headers"]["content-type"] == "application/yaml"

    @pytest.mark.asyncio
    async def test_auto_file_content_type_falls_back_to_octet_stream(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "payload.unknownext"
        source.write_bytes(b"\x00\x01")
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"stored")

        await plugin.execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "file",
                    "file_source": str(source),
                    "file_content_type": "auto",
                }
            )
        )

        assert http_server.requests[0]["headers"]["content-type"] == "application/octet-stream"

    @pytest.mark.asyncio
    async def test_multipart_generates_boundary_even_with_stored_false(self, http_server):
        """The checkbox is FORCED true for multipart - the transport owns the boundary."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "multipart",
                    "body_auto_headers": False,
                    "parts": [{"kind": "text", "name": "a", "value": "1"}],
                }
            )
        )

        content_type = http_server.requests[0]["headers"]["content-type"]
        assert content_type.startswith("multipart/form-data")
        assert "boundary=" in content_type

    @pytest.mark.asyncio
    async def test_generated_content_type_overwrites_an_expression_map_row(self, http_server):
        """Runtime map rows lose to the generated header - silently, no error."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/login",
                    "body_mode": "form",
                    "form_fields": {"a": "1"},
                    "headers": {"content-type": "application/json"},
                },
                parameter_sources={"headers": "the headers expression"},
            )
        )

        assert result["status_code"] == 200
        request = http_server.requests[0]
        ct_rows = [v for n, v in request["raw_headers"] if n.lower() == "content-type"]
        assert ct_rows == ["application/x-www-form-urlencoded"]

    @pytest.mark.asyncio
    async def test_file_mode_generated_type_overwrites_a_map_row(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "doc.json"
        source.write_text('{"k": "v"}')
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"stored")

        await plugin.execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/docs/doc.json",
                    "body_mode": "file",
                    "file_source": str(source),
                    "headers": {"Content-Type": "application/x-custom"},
                }
            )
        )

        request = http_server.requests[0]
        ct_rows = [v for n, v in request["raw_headers"] if n.lower() == "content-type"]
        assert ct_rows == ["application/json"]

    @pytest.mark.asyncio
    async def test_multipart_map_row_is_replaced_by_the_generated_boundary(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "multipart",
                    "parts": [{"kind": "text", "name": "a", "value": "1"}],
                    "headers": {"Content-Type": "application/json"},
                }
            )
        )

        assert result["status_code"] == 200
        request = http_server.requests[0]
        ct_rows = [v for n, v in request["raw_headers"] if n.lower() == "content-type"]
        assert len(ct_rows) == 1
        assert ct_rows[0].startswith("multipart/form-data")
        assert "boundary=" in ct_rows[0]

    @pytest.mark.asyncio
    async def test_text_mode_generates_nothing(self, http_server):
        """Text mode never generates - a bare string body ships without Content-Type."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/raw",
                    "body": "raw-payload",
                }
            )
        )

        assert "content-type" not in http_server.requests[0]["headers"]


class TestAutoContentTypeTable:
    """REQ-3.4.3.10: "auto" reads WAVE's own file-type table, never the host's."""

    @pytest.mark.asyncio
    async def test_auto_file_body_type_comes_from_the_table(
        self, http_server, tmp_path, host_file_types
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        for file_name in _AUTO_TYPES:
            (tmp_path / file_name).write_text("k: v\n")
            await HTTPClientPlugin().execute(
                _context(
                    {
                        "method": "PUT",
                        "url": f"{http_server.base_url}/upload/{file_name}",
                        "body_mode": "file",
                        "file_source": str(tmp_path / file_name),
                    }
                )
            )

        sent = {
            request["path"].removeprefix("/upload/"): request["headers"]["content-type"]
            for request in http_server.requests
        }
        assert sent == _AUTO_TYPES
        assert host_file_types.mock_calls == []

    @pytest.mark.asyncio
    async def test_auto_multipart_file_part_type_comes_from_the_table(
        self, http_server, tmp_path, host_file_types
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        parts: list[dict[str, str]] = [{"kind": "text", "name": "field", "value": "hello"}]
        for index, file_name in enumerate(_AUTO_TYPES):
            (tmp_path / file_name).write_text("k: v\n")
            parts.append(
                {"kind": "file", "name": f"upload{index}", "source": str(tmp_path / file_name)}
            )

        await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "multipart",
                    "parts": parts,
                }
            )
        )

        assert _file_part_types(http_server.requests[0]) == _AUTO_TYPES
        assert host_file_types.mock_calls == []

    @pytest.mark.asyncio
    async def test_an_explicit_content_type_overrides_the_table(
        self, http_server, tmp_path, host_file_types
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "client.ts"
        source.write_text("export {};\n")

        await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "file",
                    "file_source": str(source),
                    "file_content_type": "text/plain",
                }
            )
        )

        assert http_server.requests[0]["headers"]["content-type"] == "text/plain"
        assert host_file_types.mock_calls == []


class TestRuntimeBodyValueCoercion:
    """Whole-value {{ expression }} form fields and multipart text parts resolve
    to any Python value; HTTP requires strings, so the plugin coerces the
    resolved VALUE at send time (non-str -> str, None -> ""). A file part's
    literal `source` path is never coerced."""

    @pytest.mark.asyncio
    async def test_form_field_non_string_value_is_sent_as_a_string(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context(
                    {
                        "method": "POST",
                        "url": "http://example.com/login",
                        "body_mode": "form",
                        "form_fields": {"count": 1, "empty": None, "name": "alice"},
                    }
                )
            )

        data = client.request.call_args.kwargs["data"]
        assert data == {"count": "1", "empty": "", "name": "alice"}

    @pytest.mark.asyncio
    async def test_multipart_text_part_non_string_value_is_coerced(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context(
                    {
                        "method": "POST",
                        "url": "http://example.com/upload",
                        "body_mode": "multipart",
                        "parts": [
                            {"kind": "text", "name": "count", "value": 1},
                            {"kind": "text", "name": "empty", "value": None},
                            {"kind": "text", "name": "label", "value": "verbatim"},
                        ],
                    }
                )
            )

        files = dict(client.request.call_args.kwargs["files"])
        assert files["count"] == (None, "1")
        assert files["empty"] == (None, "")
        assert files["label"] == (None, "verbatim")

    @pytest.mark.asyncio
    async def test_multipart_file_part_source_is_not_coerced(self, http_server, tmp_path):
        """The file-part `source` is a literal path; coercion never touches it."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        source = tmp_path / "data.bin"
        source.write_bytes(b"\x00\x01payload")
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "multipart",
                    "parts": [{"kind": "file", "name": "upload", "source": str(source)}],
                }
            )
        )

        assert result["status_code"] == 200
        body = http_server.requests[0]["body"]
        assert b'filename="data.bin"' in body
        assert b"\x00\x01payload" in body


class TestFileSourceErrors:
    """Missing sources fail the node with the exact message."""

    @pytest.mark.asyncio
    async def test_missing_absolute_path_fails_with_exact_message(self, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        missing = str(tmp_path / "missing.bin")
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(FileNotFoundError, match=f"^File not found: {missing}$"):
                await plugin.execute(
                    _context(
                        {
                            "method": "PUT",
                            "url": "http://example.com/upload",
                            "body_mode": "file",
                            "file_source": missing,
                        }
                    )
                )

    @pytest.mark.asyncio
    async def test_missing_artifact_source_fails_with_source_as_typed(self, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                FileNotFoundError, match=r"^File not found: artifact://missing\.bin$"
            ):
                await plugin.execute(
                    _context(
                        {
                            "method": "PUT",
                            "url": "http://example.com/upload",
                            "body_mode": "file",
                            "file_source": "artifact://missing.bin",
                        },
                        artifacts_dir=str(tmp_path),
                    )
                )

    @pytest.mark.asyncio
    async def test_artifact_source_without_an_artifacts_dir_reads_as_not_found(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                FileNotFoundError, match=r"^File not found: artifact://report\.bin$"
            ):
                await plugin.execute(
                    _context(
                        {
                            "method": "PUT",
                            "url": "http://example.com/upload",
                            "body_mode": "file",
                            "file_source": "artifact://report.bin",
                        }
                    )
                )

    @pytest.mark.asyncio
    async def test_missing_multipart_file_part_fails_with_exact_message(self, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        missing = str(tmp_path / "gone.dat")
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(FileNotFoundError, match=f"^File not found: {missing}$"):
                await plugin.execute(
                    _context(
                        {
                            "method": "POST",
                            "url": "http://example.com/upload",
                            "body_mode": "multipart",
                            "parts": [{"kind": "file", "name": "up", "source": missing}],
                        }
                    )
                )


class TestFileSourceParentSegments:
    """A file source follows `..` out of the directory its scheme names, like every reference."""

    @pytest.mark.asyncio
    async def test_an_artifact_source_beside_the_artifacts_folder_is_uploaded(
        self, http_server, tmp_path
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        (tmp_path / "beside.bin").write_bytes(b"beside-bytes")
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        http_server.enqueue(body=b"ok")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "file",
                    "file_source": "artifact://../beside.bin",
                },
                artifacts_dir=str(artifacts),
            )
        )

        assert result["status_code"] == 200
        assert http_server.requests[0]["body"] == b"beside-bytes"

    @pytest.mark.asyncio
    async def test_a_multipart_file_part_beside_the_artifacts_folder_is_uploaded(
        self, http_server, tmp_path
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        (tmp_path / "beside.bin").write_bytes(b"part-beside-bytes")
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        http_server.enqueue(body=b"ok")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "multipart",
                    "parts": [
                        {"kind": "file", "name": "upload", "source": "artifact://../beside.bin"}
                    ],
                },
                artifacts_dir=str(artifacts),
            )
        )

        assert result["status_code"] == 200
        assert b"part-beside-bytes" in http_server.requests[0]["body"]

    @pytest.mark.asyncio
    async def test_a_parent_segment_to_nothing_reads_as_not_found(self, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                FileNotFoundError, match=r"^File not found: artifact://\.\./gone\.bin$"
            ):
                await HTTPClientPlugin().execute(
                    _context(
                        {
                            "method": "PUT",
                            "url": "http://example.com/upload",
                            "body_mode": "file",
                            "file_source": "artifact://../gone.bin",
                        },
                        artifacts_dir=str(artifacts),
                    )
                )

        assert client.request.call_count == 0

    @pytest.mark.asyncio
    async def test_interior_parent_segment_still_resolves(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        artifacts = tmp_path / "artifacts"
        (artifacts / "sub").mkdir(parents=True)
        (artifacts / "payload.bin").write_bytes(b"inside")
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "file",
                    "file_source": "artifact://sub/../payload.bin",
                },
                artifacts_dir=str(artifacts),
            )
        )

        assert result["status_code"] == 200
        assert http_server.requests[0]["body"] == b"inside"

    @pytest.mark.asyncio
    async def test_a_relative_file_source_is_read_from_the_server_users_home(
        self, http_server, tmp_path, monkeypatch, server_home
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        (server_home / "payload.bin").write_bytes(b"from-home")
        (tmp_path / "payload.bin").write_bytes(b"decoy")
        monkeypatch.chdir(tmp_path)
        http_server.enqueue(body=b"ok")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "PUT",
                    "url": f"{http_server.base_url}/upload",
                    "body_mode": "file",
                    "file_source": "payload.bin",
                }
            )
        )

        assert result["status_code"] == 200
        assert http_server.requests[0]["body"] == b"from-home"
