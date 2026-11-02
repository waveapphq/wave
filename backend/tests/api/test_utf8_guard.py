"""A request holding text UTF-8 cannot write is refused before any handler runs (REQ-4.6.9).

The guard looks for a lone surrogate in a request body, in a value or in a key,
and answers 422 with the path to the first one. A body without one is passed on
without a second parse, and a body that is not valid JSON is handed on. A form
upload is handed on after its first piece; a body that only carries a form's
label is read and checked like any other. A form upload that names a charset
other than UTF-8 is refused unread.
"""

import json
import logging
import re
from collections.abc import Callable
from typing import Any
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient

from wavecore.api.exceptions import UnencodableTextException
from wavecore.api.middleware import add_error_handling_middleware, utf8_guard
from wavecore.api.middleware.utf8_guard import Utf8Guard

_JSON = {"Content-Type": "application/json"}
_UUID = re.compile(r"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
_MIDDLEWARE_LOGGER = "wavecore.api.middleware"
_RESPONSE_LINE = re.compile(r"^\[([0-9a-f]{8})\] POST /tests → 422 \(\d+\.\d{2}ms\)$")
_COMMAND_PATH = "workflow.nodes[0].data.config.values.command"


def _refused(where: str) -> str:
    return (
        f"The request has a character at {where} that cannot be encoded as UTF-8, "
        "so it was refused: remove or replace it"
    )


class TestRefusal:
    """Which bodies are refused, and where the message points."""

    @pytest.mark.parametrize(
        ("body", "where"),
        [
            pytest.param(rb'{"command": "ls cafe\udce9.txt"}', "command", id="lone-low"),
            pytest.param(rb'{"command": "ls \ud83d.txt"}', "command", id="lone-high"),
            pytest.param(rb'{"command": "\uDCE9 \uD83D"}', "command", id="upper-case-escape"),
            pytest.param(rb'{"a": "\ud83d\ud83d\ude00"}', "a", id="lone-high-before-a-pair"),
            pytest.param(
                rb'{"nodes": [{}, {}, {}, {"data": {"config": {"command": "a\udce9"}}}]}',
                "nodes[3].data.config.command",
                id="nested-value",
            ),
            pytest.param(rb'{"rows": [["a", "b\ud800"]]}', "rows[0][1]", id="nested-list"),
            pytest.param(rb'["a", "b\ud800"]', "[1]", id="root-list"),
            pytest.param(rb'[{"name": "b\ud800"}]', "[0].name", id="object-in-a-root-list"),
            pytest.param(rb'{"ab\udce9c\udce9": 1}', "ab?c?", id="root-key"),
            pytest.param(
                rb'{"nodes": [{"data": {"ab\udce9c": 1}}]}', "nodes[0].data.ab?c", id="nested-key"
            ),
            pytest.param(rb'"cafe\udce9"', "the body", id="root-text"),
        ],
    )
    def test_a_lone_surrogate_is_refused_with_its_path(self, body: bytes, where: str) -> None:
        assert utf8_guard.refusal(body) == _refused(where)

    @pytest.mark.parametrize(
        ("body", "where"),
        [
            pytest.param(rb'{"a": {"b": "x\ud800"}, "c": "y\ud800"}', "a.b", id="deeper-first"),
            pytest.param(
                rb'{"a": ["ok", {"k\ud800": 1}], "b": "\ud800"}', "a[1].k?", id="key-in-a-list"
            ),
            pytest.param(rb'{"k\ud800": "v\ud800"}', "k?", id="key-before-its-value"),
            pytest.param(rb'{"a": "v\ud800", "k\ud800": 1}', "a", id="value-before-a-later-key"),
        ],
    )
    def test_the_path_names_the_first_one_in_document_order(self, body: bytes, where: str) -> None:
        assert utf8_guard.refusal(body) == _refused(where)

    @pytest.mark.parametrize(
        "body",
        [
            pytest.param(rb'{"command": "ls"}', id="clean"),
            pytest.param(rb'{"emoji": "\ud83d\ude00"}', id="escaped-pair"),
            pytest.param('{"emoji": "😀", "name": "Grüße 測試"}'.encode(), id="raw-utf-8"),
            pytest.param(rb'{"text": "\\ud800"}', id="escaped-backslash"),
            pytest.param(rb"not json \ud800", id="not-json"),
            pytest.param(b"\xef\xbb\xbf" + rb'{"command": "ls"}', id="byte-order-mark"),
            pytest.param(b"", id="empty"),
        ],
    )
    def test_a_body_without_a_lone_surrogate_passes(self, body: bytes) -> None:
        assert utf8_guard.refusal(body) is None

    def test_an_escaped_backslash_keeps_the_six_plain_characters(self) -> None:
        body = rb'{"text": "\\ud800"}'

        assert json.loads(body) == {"text": "\\ud800"}
        assert utf8_guard.refusal(body) is None

    def test_raw_surrogate_bytes_are_refused_like_the_escape(self) -> None:
        body = b'{"command": "ls cafe\xed\xb3\xa9.txt"}'

        assert json.loads(body) == {"command": "ls cafe\udce9.txt"}
        assert utf8_guard.refusal(body) == _refused("command")

    def test_a_body_in_another_encoding_is_refused_like_the_escape(self) -> None:
        body = '{"command": "ls cafe\\udce9.txt"}'.encode("utf-16")

        assert json.loads(body) == {"command": "ls cafe\udce9.txt"}
        assert utf8_guard.refusal(body) == _refused("command")

    def test_a_clean_body_in_another_encoding_passes(self) -> None:
        assert utf8_guard.refusal('{"command": "ls"}'.encode("utf-16")) is None

    def test_a_deeply_nested_body_is_walked_to_its_end(self) -> None:
        depth = 3000
        body = b"[" * depth + rb'"\ud800"' + b"]" * depth

        assert utf8_guard.refusal(body) == _refused("[0]" * depth)


class TestCost:
    """Only a body that may hold a lone surrogate is parsed (REQ-4.6.9)."""

    @pytest.fixture
    def loads(self, monkeypatch: pytest.MonkeyPatch) -> Mock:
        spy = Mock(wraps=json.loads)
        monkeypatch.setattr(utf8_guard.json, "loads", spy)
        return spy

    def test_a_body_without_the_escape_is_not_parsed(self, loads: Mock) -> None:
        assert utf8_guard.refusal(rb'{"name": "Gr\u00fc\u00dfe", "dir": "C:\\users\\d8"}') is None
        assert loads.call_count == 0

    def test_a_body_with_the_escape_is_parsed_once(self, loads: Mock) -> None:
        assert utf8_guard.refusal(rb'{"emoji": "\ud83d\ude00"}') is None
        assert loads.call_count == 1


def _other_charset(charset: str) -> str:
    return (
        f"The upload names the charset {charset}, and WAVE reads UTF-8 only, "
        "so it was refused: send it as UTF-8"
    )


def _echo_app(seen: list[bytes]) -> FastAPI:
    app = FastAPI()
    app.add_middleware(Utf8Guard)
    add_error_handling_middleware(app)

    @app.post("/echo")
    async def echo(request: Request) -> Response:
        body = await request.body()
        seen.append(body)
        return Response(content=body, media_type="application/octet-stream")

    return app


class TestGuardInFrontOfAHandler:
    """The guard as middleware: what reaches the handler and what is answered."""

    @pytest.fixture
    def seen(self) -> list[bytes]:
        return []

    @pytest.fixture
    def client(self, seen: list[bytes]) -> TestClient:
        return TestClient(_echo_app(seen))

    @pytest.mark.parametrize(
        "body",
        [
            pytest.param(rb'{"command": "ls"}', id="clean"),
            pytest.param(rb'{"emoji": "\ud83d\ude00"}', id="escaped-pair"),
            pytest.param(rb'{"text": "\\ud800"}', id="escaped-backslash"),
            pytest.param(b"", id="empty"),
        ],
    )
    def test_a_passing_body_reaches_the_handler_unchanged(
        self, client: TestClient, seen: list[bytes], body: bytes
    ) -> None:
        response = client.post("/echo", content=body, headers=_JSON)

        assert response.status_code == 200
        assert response.content == body
        assert seen == [body]

    @pytest.mark.parametrize(
        "content_type",
        [
            "application/json",
            "application/json; charset=utf-8",
            "Application/Vnd.Api+JSON",
            "text/plain",
            "application/x-www-form-urlencoded",
            "application/yaml",
            None,
        ],
    )
    def test_a_lone_surrogate_is_answered_with_422_in_the_standard_error_body(
        self, client: TestClient, seen: list[bytes], content_type: str | None
    ) -> None:
        headers = {"Content-Type": content_type} if content_type else {}

        response = client.post("/echo", content=rb'{"command": "ls cafe\udce9"}', headers=headers)

        body = response.json()
        assert response.status_code == 422
        assert body["success"] is False
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == _refused("command")
        assert _UUID.match(body["meta"]["request_id"])
        assert response.headers["x-request-id"] == body["meta"]["request_id"]
        assert seen == []

    @pytest.mark.parametrize(
        "content_type",
        [
            "multipart/form-data; boundary=x",
            "Multipart/Mixed; boundary=x",
            "application/octet-stream",
            "Application/Octet-Stream; x=y",
        ],
    )
    @pytest.mark.parametrize(
        "body",
        [
            pytest.param(rb'{"command": "ls cafe\udce9"}', id="plain"),
            pytest.param(b'\r\n {"command": "ls cafe\\udce9"}', id="after-white-space"),
            pytest.param(
                b'\xef\xbb\xbf{"command": "ls cafe\\udce9"}', id="after-a-byte-order-mark"
            ),
        ],
    )
    def test_a_json_body_under_an_upload_label_is_refused_like_any_other(
        self, client: TestClient, seen: list[bytes], content_type: str, body: bytes
    ) -> None:
        response = client.post("/echo", content=body, headers={"Content-Type": content_type})

        assert response.status_code == 422
        assert response.json()["error"]["message"] == _refused("command")
        assert seen == []

    @pytest.mark.parametrize(
        "content_type", ["multipart/form-data; boundary=x", "Multipart/Mixed; boundary=x"]
    )
    @pytest.mark.parametrize("lead", [b"", b"\r\n"])
    def test_a_form_upload_passes_whatever_it_holds(
        self, client: TestClient, seen: list[bytes], content_type: str, lead: bytes
    ) -> None:
        body = lead + (
            b"--x\r\n"
            b'Content-Disposition: form-data; name="file"; filename="a.json"\r\n\r\n'
            rb'{"command": "ls cafe\udce9"}'
            b"\r\n--x--\r\n"
        )

        response = client.post("/echo", content=body, headers={"Content-Type": content_type})

        assert response.status_code == 200
        assert seen == [body]


def _post_scope(content_type: bytes) -> dict[str, Any]:
    return {"type": "http", "method": "POST", "headers": [(b"content-type", content_type)]}


class TestGuardOnTheWire:
    """What the guard reads from the connection, and what it hands on."""

    @pytest.fixture
    def reached(self) -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
        return []

    @pytest.fixture
    def guard(self, reached: list[tuple[dict[str, Any], list[dict[str, Any]]]]) -> Utf8Guard:
        async def handler(scope: Any, receive: Any, _send: Any) -> None:
            events = [await receive()]
            while events[-1].get("more_body"):
                events.append(await receive())
            reached.append((scope, events))

        return Utf8Guard(handler)

    @staticmethod
    def _receive(events: list[dict[str, Any]]) -> Callable[[], Any]:
        async def receive() -> dict[str, Any]:
            return events.pop(0)

        return receive

    @staticmethod
    async def _send(_event: Any) -> None:
        raise AssertionError("the guard itself never answers")

    async def test_a_form_upload_is_handed_on_after_its_first_piece(
        self, guard: Utf8Guard, reached: list[tuple[dict[str, Any], list[dict[str, Any]]]]
    ) -> None:
        pieces = [
            {"type": "http.request", "body": b"", "more_body": True},
            {"type": "http.request", "body": b"\r\n--x\r\n", "more_body": True},
            {"type": "http.request", "body": rb'{"command": "cafe\udce9"}', "more_body": True},
            {"type": "http.request", "body": b"\r\n--x--\r\n", "more_body": False},
        ]
        left = list(pieces)
        read_before_the_handler: list[int] = []

        async def receive() -> dict[str, Any]:
            return left.pop(0)

        async def handler(scope: Any, handed: Any, _send: Any) -> None:
            read_before_the_handler.append(len(pieces) - len(left))
            events = [await handed()]
            while events[-1].get("more_body"):
                events.append(await handed())
            reached.append((scope, events))

        scope = _post_scope(b"multipart/form-data; boundary=x")
        await Utf8Guard(handler)(scope, receive, self._send)

        assert read_before_the_handler == [2]
        assert reached == [(scope, pieces)]

    async def test_a_form_upload_with_no_body_is_handed_on(
        self, guard: Utf8Guard, reached: list[tuple[dict[str, Any], list[dict[str, Any]]]]
    ) -> None:
        pieces = [{"type": "http.request", "body": b"", "more_body": False}]
        scope = _post_scope(b"multipart/form-data; boundary=x")

        await guard(scope, self._receive(list(pieces)), self._send)

        assert reached == [(scope, pieces)]

    @pytest.mark.parametrize(
        ("content_type", "charset"),
        [
            (b"multipart/form-data; boundary=x; charset=unicode_escape", "unicode_escape"),
            (b'multipart/form-data; charset="ISO-8859-1"; boundary=x', "ISO-8859-1"),
            (b"Multipart/Mixed; boundary=x; CHARSET=no-such-charset", "no-such-charset"),
        ],
    )
    async def test_an_upload_that_names_another_charset_is_refused_unread(
        self, content_type: bytes, charset: str
    ) -> None:
        async def receive() -> dict[str, Any]:
            raise AssertionError("a refused upload is never read")

        async def handler(_scope: Any, _receive: Any, _send: Any) -> None:
            raise AssertionError("a refused upload never reaches the handler")

        with pytest.raises(
            UnencodableTextException, match=f"^{re.escape(_other_charset(charset))}$"
        ):
            await Utf8Guard(handler)(_post_scope(content_type), receive, self._send)

    @pytest.mark.parametrize(
        "content_type",
        [
            b"multipart/form-data; boundary=x; charset=utf-8",
            b'multipart/form-data; boundary=x; charset="UTF8"',
            b"application/octet-stream; charset=latin-1",
        ],
    )
    async def test_a_form_in_utf8_and_a_body_that_is_no_form_are_handed_on(
        self,
        guard: Utf8Guard,
        reached: list[tuple[dict[str, Any], list[dict[str, Any]]]],
        content_type: bytes,
    ) -> None:
        pieces = [{"type": "http.request", "body": b"--x\r\n\r\n--x--\r\n", "more_body": False}]
        scope = _post_scope(content_type)

        await guard(scope, self._receive(list(pieces)), self._send)

        assert reached == [(scope, pieces)]

    async def test_a_request_without_a_content_type_is_read_and_checked(
        self, guard: Utf8Guard, reached: list[tuple[dict[str, Any], list[dict[str, Any]]]]
    ) -> None:
        body = [{"type": "http.request", "body": rb'{"command": "cafe\udce9"}', "more_body": False}]
        scope = {"type": "http", "method": "POST", "headers": []}

        with pytest.raises(UnencodableTextException, match=f"^{re.escape(_refused('command'))}$"):
            await guard(scope, self._receive(body), self._send)

        assert reached == []

    async def test_a_connection_that_is_not_http_passes_through(self) -> None:
        passed: list[Any] = []

        async def receive() -> dict[str, Any]:
            raise AssertionError("a websocket is never read by the guard")

        async def handler(scope: Any, handed: Any, _send: Any) -> None:
            passed.append((scope, handed))

        scope = {"type": "websocket", "headers": [(b"content-type", b"application/json")]}
        await Utf8Guard(handler)(scope, receive, self._send)

        assert passed == [(scope, receive)]

    async def test_a_body_sent_in_pieces_is_handed_on_piece_by_piece(
        self, guard: Utf8Guard, reached: list[tuple[dict[str, Any], list[dict[str, Any]]]]
    ) -> None:
        pieces = [
            {"type": "http.request", "body": b'{"command": ', "more_body": True},
            {"type": "http.request", "body": b'"ls"}', "more_body": False},
        ]
        scope = _post_scope(b"application/json")

        await guard(scope, self._receive(list(pieces)), self._send)

        assert reached == [(scope, pieces)]

    async def test_an_escape_split_across_two_pieces_is_still_found(
        self, guard: Utf8Guard, reached: list[tuple[dict[str, Any], list[dict[str, Any]]]]
    ) -> None:
        pieces = [
            {"type": "http.request", "body": rb'{"command": "ls cafe\ud', "more_body": True},
            {"type": "http.request", "body": rb'ce9"}', "more_body": False},
        ]

        with pytest.raises(UnencodableTextException, match=f"^{re.escape(_refused('command'))}$"):
            await guard(_post_scope(b"application/json"), self._receive(pieces), self._send)

        assert reached == []

    async def test_what_follows_the_body_is_read_from_the_connection(self) -> None:
        events = [
            {"type": "http.request", "body": b'{"command": "ls"}', "more_body": False},
            {"type": "http.disconnect"},
        ]
        handed: list[dict[str, Any]] = []

        async def handler(_scope: Any, receive: Any, _send: Any) -> None:
            handed.extend([await receive(), await receive()])

        guard = Utf8Guard(handler)
        await guard(_post_scope(b"application/json"), self._receive(list(events)), self._send)

        assert handed == events

    @pytest.mark.parametrize(
        "content_type", [b"application/json", b"multipart/form-data; boundary=x"]
    )
    async def test_a_client_that_went_away_is_handed_on(
        self,
        guard: Utf8Guard,
        reached: list[tuple[dict[str, Any], list[dict[str, Any]]]],
        content_type: bytes,
    ) -> None:
        gone = [{"type": "http.disconnect"}]
        scope = _post_scope(content_type)

        await guard(scope, self._receive(list(gone)), self._send)

        assert reached == [(scope, gone)]


def _test_document(command: str) -> bytes:
    """A Test with one SSH Session Exec block, as the bytes a client sends."""
    document = {
        "name": "Unencodable command",
        "workflow": {
            "nodes": [
                {
                    "id": "node-1",
                    "type": "workflowNode",
                    "position": {"x": 100, "y": 100},
                    "data": {
                        "elementType": "ssh-session-exec",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "label": "List the folder",
                        "config": {"values": {"session_id": "ssh-1", "command": command}},
                    },
                }
            ],
            "edges": [],
        },
    }
    return json.dumps(document).encode()


class TestThroughTheApp:
    """POST /tests with a lone surrogate in a block's Command (REQ-4.6.9)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app, raise_server_exceptions=False)

    def test_the_request_is_refused_and_no_test_is_stored(self, client: TestClient) -> None:
        body = _test_document("ls cafe\udce9.txt")
        assert rb"cafe\udce9.txt" in body

        response = client.post("/tests", content=body, headers=_JSON)

        answer = response.json()
        assert response.status_code == 422
        assert answer["success"] is False
        assert answer["error"]["code"] == "VALIDATION_ERROR"
        assert answer["error"]["message"] == _refused(_COMMAND_PATH)
        assert _UUID.match(answer["meta"]["request_id"])
        listed = client.get("/tests")
        assert listed.status_code == 200
        assert [test["name"] for test in listed.json()["data"]] == []

    def test_the_refused_request_gets_its_log_line(
        self, client: TestClient, request: pytest.FixtureRequest
    ) -> None:
        # Asked for after the app import, which resets the root log handlers.
        caplog: pytest.LogCaptureFixture = request.getfixturevalue("caplog")

        with caplog.at_level(logging.DEBUG, logger=_MIDDLEWARE_LOGGER):
            response = client.post(
                "/tests", content=_test_document("ls cafe\udce9.txt"), headers=_JSON
            )

        request_id = response.json()["meta"]["request_id"]
        lines = [
            (record.levelno, match.group(1))
            for record in caplog.records
            if (match := _RESPONSE_LINE.match(record.getMessage()))
        ]
        assert lines == [(logging.WARNING, request_id[:8])]

    @pytest.mark.parametrize(
        "content_type",
        [
            "text/plain",
            "application/x-www-form-urlencoded",
            "application/octet-stream",
            "multipart/form-data; boundary=x",
            None,
        ],
    )
    def test_the_content_type_of_the_request_does_not_matter(
        self, client: TestClient, content_type: str | None
    ) -> None:
        headers = {"Content-Type": content_type} if content_type else {}

        response = client.post(
            "/tests", content=_test_document("ls cafe\udce9.txt"), headers=headers
        )

        assert response.status_code == 422
        assert response.json()["error"]["message"] == _refused(_COMMAND_PATH)
        assert client.get("/tests").json()["data"] == []

    def test_an_upload_under_another_charset_is_refused(self, client: TestClient) -> None:
        body = (
            b"--edge\r\n"
            b'Content-Disposition: form-data; name="file"; filename="cafe\\udce9.yaml"\r\n'
            b"Content-Type: application/x-yaml\r\n\r\n"
            b"name: Imported\r\n"
            b"--edge--\r\n"
        )
        headers = {"Content-Type": "multipart/form-data; boundary=edge; charset=unicode_escape"}

        response = client.post("/blocks/import", content=body, headers=headers)

        answer = response.json()
        assert response.status_code == 422
        assert answer["error"]["code"] == "VALIDATION_ERROR"
        assert answer["error"]["message"] == _other_charset("unicode_escape")
        assert _UUID.match(answer["meta"]["request_id"])

    def test_the_same_upload_in_utf8_reaches_its_route(self, client: TestClient) -> None:
        body = (
            b"--edge\r\n"
            b'Content-Disposition: form-data; name="file"; filename="plain.yaml"\r\n'
            b"Content-Type: application/x-yaml\r\n\r\n"
            b": not yaml : [\r\n"
            b"--edge--\r\n"
        )
        headers = {"Content-Type": "multipart/form-data; boundary=edge; charset=utf-8"}

        response = client.post("/blocks/import", content=body, headers=headers)

        assert response.status_code == 400
        assert "plain.yaml" in response.json()["error"]["message"]

    def test_the_same_test_with_a_clean_command_is_stored(self, client: TestClient) -> None:
        response = client.post("/tests", content=_test_document("ls café.txt"), headers=_JSON)

        assert response.status_code == 201
        assert [test["name"] for test in client.get("/tests").json()["data"]] == [
            "Unencodable command"
        ]
