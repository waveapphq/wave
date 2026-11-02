"""Netcat Talk mode and its payload (REQ-3.4.1.9, NETCAT-5, NETCAT-15, NETCAT-16, NETCAT-19)."""

import asyncio
import base64
import errno
import re
import socket
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from functools import partial
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from tests.plugins.netcat.conftest import (
    ANSWER_PREFIX,
    BANNER,
    FAST,
    WAIT,
    Listener,
    LogRecorder,
    WriterProbe,
    free_port,
    netcat_context,
    netcat_params,
    resolve_to,
)
from wavecore.core.table import Table
from wavecore.plugins._netcat_core import run
from wavecore.plugins.netcat import NetcatPlugin

Listen = Callable[..., Awaitable[Listener]]
Block = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]
Lines = list[tuple[str, str]]

TALK_COLUMNS = [
    ("port", "integer"),
    ("protocol", "string"),
    ("state", "string"),
    ("reason", "string"),
    ("time_ms", "integer"),
    ("reply", "string"),
]
MARKER = b"marker"
DISTINCT = "PAYLOAD-7f3c"


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def outputs(envelope: dict[str, Any]) -> dict[str, Any]:
    assert envelope["__wave_type"] == "result" and envelope["secrets"] == []
    return envelope["outputs"]


def talk(port: int, **overrides: Any) -> dict[str, Any]:
    """A Single TCP Talk of 127.0.0.1 that `overrides` reshape."""
    return netcat_params(port, mode="talk", **overrides)


def rows(out: dict[str, Any]) -> list[dict[str, Any]]:
    """The core's Results rows keyed by column name."""
    names = [column["name"] for column in out["results"]["columns"]]
    return [dict(zip(names, row, strict=True)) for row in out["results"]["rows"]]


def row_count(results: Any) -> int:
    return results.row_count() if isinstance(results, Table) else len(results["rows"])


def is_ms(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def filled(template: Lines, **values: Any) -> Lines:
    return [(level, text.format(**values)) for level, text in template]


def core(log: LogRecorder, payload: bytes | None = None, **extra: Any) -> Block:
    """The core as a block: its outputs, with `payload` and any `extra` keyword passed on."""

    async def block(params: dict[str, Any]) -> dict[str, Any]:
        given = extra if payload is None else {"payload": payload, **extra}
        return outputs(await run(params, log, **given))

    return block


def plugin(log: LogRecorder, **optional: Any) -> Block:
    """NetcatPlugin.execute as a block, with the optional context keys given."""

    async def block(params: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = await NetcatPlugin().execute(
            netcat_context(params, log, **optional)
        )
        return result

    return block


async def talk_once(
    params: dict[str, Any], log: LogRecorder, payload: bytes | None = None, **extra: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    """The core's outputs and its only Results row."""
    out = await core(log, payload, **extra)(params)
    [row] = rows(out)
    return out, row


async def check_start_failure(
    block: Block, params: dict[str, Any], message: str, log: LogRecorder
) -> None:
    """Fail raises after the start line; Record returns StartFailed with nothing measured."""
    protocol = str(params["protocol"]).upper()
    start = ("INFO", f"Talking to 127.0.0.1 port {params['port']} over {protocol}")
    with pytest.raises(ValueError, match=exact(message)):
        await block(params)
    assert log == [start]
    log.clear()
    out = await block({**params, "on_error": "record"})
    assert (out["success"], out["error"], out["reason"]) == (False, message, "StartFailed")
    assert (out["reply"], row_count(out["results"]), out["__block_warning"]) == ("", 0, True)
    assert log == [start, ("WARN", f"Netcat failed (StartFailed): {message}")]


async def first_datagram_after(listener: Listener) -> bytes:
    """Send a marker; it arrives first only when nothing reached the listener before it."""
    with socket.socket(type=socket.SOCK_DGRAM) as sock:
        sock.sendto(MARKER, ("127.0.0.1", listener.port))
    return (await listener.settled(1))[0]


async def gone(host: str, port: int) -> tuple[Any, Any]:
    raise TimeoutError


async def assert_stopped(task: asyncio.Task[Any], bound: float) -> None:
    """Stop `task`: it must end with CancelledError within `bound` seconds (NETCAT-6)."""
    task.cancel()
    done, _ = await asyncio.wait({task}, timeout=bound)
    assert done == {task}
    with pytest.raises(asyncio.CancelledError):
        task.result()


class SignalingReader:
    """A stream reader that sets `reading` when a read starts."""

    def __init__(self, reader: Any, reading: asyncio.Event) -> None:
        self.reader, self.reading = reader, reading

    async def read(self, size: int) -> bytes:
        self.reading.set()
        data: bytes = await self.reader.read(size)
        return data


class StalledWriter(WriterProbe):
    """A stream writer whose drain() sets `sending` and then never returns."""

    def __init__(self, writer: Any, sending: asyncio.Event) -> None:
        super().__init__(writer)
        self.sending = sending

    async def drain(self) -> None:
        self.sending.set()
        await asyncio.Event().wait()


class TestTextPayload:
    """NETCAT-16: Text is sent as UTF-8 and the reply comes back in Reply and the row."""

    async def test_text_is_echoed_into_reply_and_the_row(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        echo = await listen("tcp-echo")
        out, row = await talk_once(talk(echo.port, text="hello", close_after_send=True), log)
        assert (out["reply"], row["reply"], row["state"], out["success"]) == (
            "hello",
            "hello",
            "open",
            True,
        )
        columns = out["results"]["columns"]
        assert [(column["name"], column["type"]) for column in columns] == TALK_COLUMNS

    async def test_text_is_sent_as_utf8(self, listen: Listen, log: LogRecorder) -> None:
        echo = await listen("tcp-echo")
        out, _ = await talk_once(talk(echo.port, text="héllo ☃", close_after_send=True), log)
        assert await echo.settled(1) == ["héllo ☃".encode()]
        assert out["reply"] == "héllo ☃"

    @pytest.mark.parametrize("text", [{"text": ""}, {}], ids=["empty", "absent"])
    async def test_empty_tcp_text_sends_nothing(
        self, text: dict[str, Any], listen: Listen, log: LogRecorder
    ) -> None:
        echo = await listen("tcp-echo")
        out, row = await talk_once(talk(echo.port, close_after_send=True, **text), log)
        assert await echo.settled(1) == [b""]
        assert (row["state"], out["reply"]) == ("open", "")

    @pytest.mark.parametrize("text", ["a\nb", ""], ids=["text", "empty"])
    async def test_udp_payload_is_one_datagram(
        self, text: str, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        silent = await listen("udp-silent")
        resolve_to(monkeypatch, "127.0.0.1")
        _, row = await talk_once(talk(silent.port, protocol="udp", text=text, timeout=FAST), log)
        assert await silent.settled(1) == [text.encode()]
        assert (row["state"], row["reason"]) == ("open or filtered", "No reply within 0.05 seconds")

    async def test_udp_reply_datagrams_are_joined_in_arrival_order(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = await listen("udp", lambda _: [b"one", b"two"])
        resolve_to(monkeypatch, "127.0.0.1")
        params = talk(server.port, protocol="udp", text="hi", timeout=FAST)
        out, row = await talk_once(params, log)
        assert (out["reply"], row["reply"], row["state"]) == ("onetwo", "onetwo", "open")

    async def test_invalid_utf8_reads_as_replacement_characters(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        """NETCAT-15."""
        echo = await listen("tcp-echo")
        params = talk(echo.port, send="file", file="payload.bin", close_after_send=True)
        out, row = await talk_once(params, log, payload=b"ok\xff\xfe")
        assert out["reply"] == row["reply"] == "ok\ufffd\ufffd"


class TestUdpPayloadSize:
    """NETCAT-16: one UDP datagram carries at most 65507 bytes, counted after CRLF."""

    @pytest.mark.parametrize(
        ("text", "crlf", "size"),
        [("x" * 65508, False, 65508), ("\n" * 600 + "a" * 64400, True, 65600)],
        ids=["over the limit", "over after crlf"],
    )
    async def test_oversized_payload_fails_before_sending(
        self, text: str, crlf: bool, size: int, listen: Listen, log: LogRecorder
    ) -> None:
        silent = await listen("udp-silent")
        params = talk(silent.port, protocol="udp", text=text, crlf=crlf, timeout=FAST)
        message = f"Payload is too large for one UDP datagram: {size} bytes (at most 65507)"
        await check_start_failure(core(log), params, message, log)
        assert await first_datagram_after(silent) == MARKER

    async def test_largest_payload_is_sent_as_one_datagram(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        silent = await listen("udp-silent")
        resolve_to(monkeypatch, "127.0.0.1")
        params = talk(silent.port, protocol="udp", text="x" * 65507, timeout=FAST)
        _, row = await talk_once(params, log)
        assert await silent.settled(1) == [b"x" * 65507]
        assert row["state"] == "open or filtered"


MISSING_FILES: dict[str, Callable[[Path], tuple[str, dict[str, Any]]]] = {
    "absolute path": lambda folder: (str(folder / "missing.bin"), {}),
    "testdata target": lambda folder: ("testdata://missing.bin", {"testdata_dirs": [str(folder)]}),
    "artifact target": lambda folder: ("artifact://missing.bin", {"artifacts_dir": str(folder)}),
    "folder path": lambda folder: (str(folder), {}),
    "testdata without folders": lambda _: ("testdata://x.bin", {}),
    "artifact without folder": lambda _: ("artifact://x.bin", {}),
}
UNREADABLE: dict[str, tuple[Callable[[], OSError], str]] = {
    "permission": (lambda: PermissionError(13, "Permission denied"), "Permission denied"),
    "text only": (lambda: OSError("disk on fire"), "disk on fire"),
}
DENIED_STATUS: dict[str, Callable[[Path], tuple[str, dict[str, Any]]]] = {
    "absolute path": lambda folder: (str(folder / "payload.bin"), {}),
    "testdata target": lambda folder: ("testdata://payload.bin", {"testdata_dirs": [str(folder)]}),
}


def deny_status(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    """Asking for the status of a file called `name` fails, as inside a folder without access."""
    real_stat = Path.stat

    def stat(self: Path, *args: Any, **kwargs: Any) -> Any:
        if self.name == name:
            raise PermissionError(errno.EACCES, "Permission denied", str(self))
        return real_stat(self, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", stat)


class TestPayloadFileOnWave:
    """NETCAT-10, NETCAT-19: execute reads a File payload on WAVE and names it as written."""

    async def test_absolute_plain_path_is_sent(
        self, listen: Listen, log: LogRecorder, tmp_path: Path
    ) -> None:
        echo, source = await listen("tcp-echo"), tmp_path / "payload.bin"
        source.write_bytes(b"payload from a file")
        params = talk(echo.port, send="file", file=str(source), close_after_send=True)
        result = await plugin(log)(params)
        assert await echo.settled(1) == [b"payload from a file"]
        assert result["reply"] == "payload from a file"
        assert result["results"].col("reply") == ["payload from a file"]

    async def test_padded_path_is_trimmed(
        self, listen: Listen, log: LogRecorder, tmp_path: Path
    ) -> None:
        echo, source = await listen("tcp-echo"), tmp_path / "payload.bin"
        source.write_bytes(b"payload from a file")
        params = talk(echo.port, send="file", file=f"  {source}  ", close_after_send=True)
        await plugin(log)(params)
        assert await echo.settled(1) == [b"payload from a file"]

    async def test_relative_plain_path_starts_at_the_server_home(
        self, listen: Listen, log: LogRecorder, server_home: Path
    ) -> None:
        echo = await listen("tcp-echo")
        (server_home / "payload.bin").write_bytes(b"from the server home")
        params = talk(echo.port, send="file", file="payload.bin", close_after_send=True)
        result = await plugin(log)(params)
        assert await echo.settled(1) == [b"from the server home"]
        assert result["reply"] == "from the server home"

    @pytest.mark.parametrize("case", MISSING_FILES.values(), ids=list(MISSING_FILES))
    async def test_missing_file_is_not_found_as_written(
        self,
        case: Callable[[Path], tuple[str, dict[str, Any]]],
        log: LogRecorder,
        tmp_path: Path,
    ) -> None:
        file, optional = case(tmp_path)
        params = talk(free_port(), send="file", file=file)
        message = f"Payload file not found: {file}"
        await check_start_failure(plugin(log, **optional), params, message, log)

    @pytest.mark.parametrize(("error", "text"), UNREADABLE.values(), ids=list(UNREADABLE))
    async def test_unreadable_file_carries_the_error_text(
        self, error: Callable[[], OSError], text: str, log: LogRecorder, tmp_path: Path
    ) -> None:
        source = tmp_path / "payload.bin"
        source.write_bytes(b"unread")
        params = talk(free_port(), send="file", file=str(source))
        with patch.object(Path, "read_bytes", side_effect=error()):
            message = f"Could not read the payload file: {text}"
            await check_start_failure(plugin(log), params, message, log)

    async def test_a_file_gone_before_it_is_read_is_not_found(
        self, log: LogRecorder, tmp_path: Path
    ) -> None:
        source = tmp_path / "payload.bin"
        source.write_bytes(b"unread")
        params = talk(free_port(), send="file", file=str(source))
        with patch.object(Path, "read_bytes", side_effect=FileNotFoundError(2, "No such file")):
            message = f"Payload file not found: {source}"
            await check_start_failure(plugin(log), params, message, log)

    @pytest.mark.parametrize("case", DENIED_STATUS.values(), ids=list(DENIED_STATUS))
    async def test_a_file_whose_status_cannot_be_read_carries_the_error_text(
        self,
        case: Callable[[Path], tuple[str, dict[str, Any]]],
        log: LogRecorder,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A permission failure while looking the file up follows On error (NETCAT-19)."""
        (tmp_path / "payload.bin").write_bytes(b"unread")
        file, optional = case(tmp_path)
        deny_status(monkeypatch, "payload.bin")
        params = talk(free_port(), send="file", file=file)
        message = "Could not read the payload file: Permission denied"
        await check_start_failure(plugin(log, **optional), params, message, log)


class TestPayloadOnRemoteHost:
    """NETCAT-10, NETCAT-19: without a payload the core reads, decodes or reports the File."""

    @pytest.mark.parametrize("file", ["payload.bin", "  payload.bin "], ids=["as-is", "padded"])
    async def test_relative_file_is_read_from_the_home_folder(
        self,
        file: str,
        listen: Listen,
        log: LogRecorder,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("HOME", str(tmp_path))
        (tmp_path / "payload.bin").write_bytes(b"read on the remote host")
        echo = await listen("tcp-echo")
        params = talk(echo.port, send="file", file=file, close_after_send=True)
        out = outputs(await run(params, log))
        assert await echo.settled(1) == [b"read on the remote host"]
        assert out["reply"] == "read on the remote host"

    async def test_shipped_payload_is_decoded_and_sent(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        echo = await listen("tcp-echo")
        shipped = base64.b64encode(b"\x00\xffhi").decode("ascii")
        params = talk(
            echo.port,
            send="file",
            file="testdata://payload.bin",
            payload_base64=shipped,
            close_after_send=True,
        )
        await run(params, log)
        assert await echo.settled(1) == [b"\x00\xffhi"]

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            (
                {
                    "file": "testdata://payload.bin",
                    "payload_error": "Could not read the payload file: Permission denied",
                },
                "Could not read the payload file: Permission denied",
            ),
            ({"file": "payload.bin"}, "Payload file not found: payload.bin"),
        ],
        ids=["shipped error", "missing relative file"],
    )
    async def test_payload_failure_is_start_failed(
        self,
        overrides: dict[str, Any],
        message: str,
        log: LogRecorder,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("HOME", str(tmp_path))
        params = talk(free_port(), send="file", **overrides)
        await check_start_failure(core(log), params, message, log)

    async def test_unreadable_file_carries_the_error_text(
        self, log: LogRecorder, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HOME", str(tmp_path))
        (tmp_path / "payload.bin").write_bytes(b"unread")
        params = talk(free_port(), send="file", file="payload.bin")
        message = "Could not read the payload file: Permission denied"
        with patch.object(Path, "read_bytes", side_effect=PermissionError(13, "Permission denied")):
            await check_start_failure(core(log), params, message, log)

    async def test_a_file_whose_status_cannot_be_read_carries_the_error_text(
        self, log: LogRecorder, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A permission failure while looking the file up follows On error (NETCAT-19)."""
        monkeypatch.setenv("HOME", str(tmp_path))
        (tmp_path / "payload.bin").write_bytes(b"unread")
        deny_status(monkeypatch, "payload.bin")
        params = talk(free_port(), send="file", file="payload.bin")
        message = "Could not read the payload file: Permission denied"
        await check_start_failure(core(log), params, message, log)


class TestSendNothing:
    """NETCAT-4, NETCAT-16: Send Nothing reads what the server sends on connect."""

    async def test_banner_is_read_until_silence(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        banner = await listen("tcp-banner")
        resolve_to(monkeypatch, "127.0.0.1")
        out, row = await talk_once(talk(banner.port, send="nothing", timeout=FAST), log)
        assert (out["reply"], row["state"]) == (BANNER.decode(), "open")

    async def test_close_after_sending_shuts_the_sending_side_on_connect(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        banner = await listen("tcp-banner")
        params = talk(banner.port, send="nothing", close_after_send=True)
        out, _ = await talk_once(params, log)
        assert out["reply"] == BANNER.decode()
        assert await banner.settled(1) == [b""]


class TestCrlf:
    """NETCAT-16: CRLF sends every LF or CRLF line ending as CR LF, whatever the source."""

    @pytest.mark.parametrize(
        ("overrides", "payload", "sent"),
        [
            ({"text": "a\nb\r\nc\rd"}, None, b"a\r\nb\r\nc\rd"),
            ({"send": "file", "file": "payload.bin"}, b"x\ny\n", b"x\r\ny\r\n"),
        ],
        ids=["text", "file"],
    )
    async def test_line_endings_become_crlf(
        self,
        overrides: dict[str, Any],
        payload: bytes | None,
        sent: bytes,
        listen: Listen,
        log: LogRecorder,
    ) -> None:
        echo = await listen("tcp-echo")
        params = talk(echo.port, crlf=True, close_after_send=True, **overrides)
        await talk_once(params, log, payload=payload)
        assert await echo.settled(1) == [sent]


class TestCloseAfterSending:
    """NETCAT-16: Close after sending ends the input so a waiting server answers; TCP only."""

    async def test_answering_server_answers_at_end_of_input(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        answer = await listen("tcp-answer")
        out, _ = await talk_once(talk(answer.port, text="hello", close_after_send=True), log)
        assert out["reply"] == (ANSWER_PREFIX + b"hello").decode()

    async def test_without_it_the_answering_server_stays_silent(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        answer = await listen("tcp-answer")
        resolve_to(monkeypatch, "127.0.0.1")
        out, row = await talk_once(talk(answer.port, text="hello", timeout=FAST), log)
        assert (out["reply"], row["state"]) == ("", "open")

    async def test_ignored_over_udp(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        echo = await listen("udp-echo")
        resolve_to(monkeypatch, "127.0.0.1")
        params = talk(echo.port, protocol="udp", text="hello", close_after_send=True, timeout=FAST)
        out, row = await talk_once(params, log)
        assert (out["reply"], row["state"]) == ("hello", "open")


class TestReplyEnd:
    """NETCAT-5, NETCAT-15: the reply ends on server close, on silence or at Max reply size."""

    async def test_server_close_ends_the_reply_at_once(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        echo = await listen("tcp-echo")
        out, row = await talk_once(talk(echo.port, text="hello", close_after_send=True), log)
        assert out["reply"] == "hello"
        assert is_ms(row["time_ms"]) and 0 <= row["time_ms"] < 500

    async def test_silence_ends_the_reply(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        silent = await listen("tcp-silent")
        resolve_to(monkeypatch, "127.0.0.1")
        out, row = await talk_once(talk(silent.port, text="hello", timeout=FAST), log)
        assert (out["reply"], row["state"]) == ("", "open")
        assert is_ms(row["time_ms"]) and row["time_ms"] >= 40

    async def test_time_spans_to_the_end_of_reading(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        echo = await listen("tcp-echo")
        resolve_to(monkeypatch, "127.0.0.1")
        out, row = await talk_once(talk(echo.port, text="hello", timeout=FAST), log)
        assert out["reply"] == "hello"
        assert is_ms(row["time_ms"]) and row["time_ms"] >= 40

    @pytest.mark.parametrize(
        ("kind", "overrides"),
        [
            ("tcp-echo", {"protocol": "tcp", "close_after_send": True}),
            ("udp-echo", {"protocol": "udp", "timeout": FAST}),
        ],
        ids=["tcp", "udp"],
    )
    async def test_max_reply_size_stops_the_read(
        self,
        kind: str,
        overrides: dict[str, Any],
        listen: Listen,
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        echo = await listen(kind)
        resolve_to(monkeypatch, "127.0.0.1")
        params = talk(echo.port, text="0123456789", max_reply_bytes=4, **overrides)
        out, row = await talk_once(params, log)
        protocol = overrides["protocol"]
        assert (out["reply"], row["reply"], row["state"], out["success"]) == (
            "0123",
            "0123",
            "open",
            True,
        )
        assert log == [
            ("INFO", f"Talking to 127.0.0.1 port {echo.port} over {protocol.upper()}"),
            ("INFO", f"Port {echo.port}/{protocol} open"),
            ("INFO", "Sent 10 bytes, received 4 bytes"),
            ("WARN", f"Reply from port {echo.port} stopped at 4 bytes"),
        ]

    async def test_a_range_warns_for_each_capped_reply(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        first, second = await listen("tcp-echo"), await listen("tcp-echo")
        port_range = f"{first.port}, {second.port}"
        params = talk(
            0,
            ports="range",
            port_range=port_range,
            text="0123456789",
            max_reply_bytes=4,
            close_after_send=True,
        )
        out = await core(log)(params)
        assert [row["reply"] for row in rows(out)] == ["0123", "0123"]
        assert log == [
            ("INFO", "Talking to 2 ports on 127.0.0.1 over TCP"),
            ("DEBUG", f"Port {first.port}/tcp open"),
            ("DEBUG", "Sent 10 bytes, received 4 bytes"),
            ("WARN", f"Reply from port {first.port} stopped at 4 bytes"),
            ("DEBUG", f"Port {second.port}/tcp open"),
            ("DEBUG", "Sent 10 bytes, received 4 bytes"),
            ("WARN", f"Reply from port {second.port} stopped at 4 bytes"),
            ("INFO", "2 open of 2"),
        ]


SINGLE_LOGS: dict[str, tuple[str, dict[str, Any], Lines]] = {
    "tcp open": (
        "tcp-echo",
        {"protocol": "tcp", "close_after_send": True},
        [
            ("INFO", "Talking to 127.0.0.1 port {p} over TCP"),
            ("INFO", "Port {p}/tcp open"),
            ("INFO", "Sent 5 bytes, received 5 bytes"),
        ],
    ),
    "udp open or filtered": (
        "udp-silent",
        {"protocol": "udp", "timeout": FAST},
        [
            ("INFO", "Talking to 127.0.0.1 port {p} over UDP"),
            ("INFO", "Port {p}/udp open or filtered: No reply within 0.05 seconds"),
            ("INFO", "Sent 5 bytes, received 0 bytes"),
        ],
    ),
}


class TestConsoleLines:
    """The Talk start, result, traffic and summary lines; payload and reply are never logged."""

    @pytest.mark.parametrize(
        ("kind", "overrides", "lines"), SINGLE_LOGS.values(), ids=list(SINGLE_LOGS)
    )
    async def test_single_talk_log_is_exact(
        self,
        kind: str,
        overrides: dict[str, Any],
        lines: Lines,
        listen: Listen,
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        server = await listen(kind)
        resolve_to(monkeypatch, "127.0.0.1")
        await talk_once(talk(server.port, text="hello", **overrides), log)
        assert log == filled(lines, p=server.port)

    @pytest.mark.parametrize("protocol", ["tcp", "udp"])
    async def test_closed_port_writes_no_traffic_line(
        self, protocol: str, log: LogRecorder
    ) -> None:
        closed = free_port()
        params = talk(closed, protocol=protocol, text="hello", on_error="record")
        out, row = await talk_once(params, log)
        assert (row["state"], row["reply"], out["reply"]) == ("closed", "", "")
        assert log == [
            ("INFO", f"Talking to 127.0.0.1 port {closed} over {protocol.upper()}"),
            ("INFO", f"Port {closed}/{protocol} closed: Connection refused"),
            (
                "WARN",
                f"Netcat failed (Closed): Port {closed} on 127.0.0.1 is closed: Connection refused",
            ),
        ]

    async def test_timed_out_port_writes_no_traffic_line(self, log: LogRecorder) -> None:
        params = talk(7, text="hello", timeout=10, on_error="record")
        out = outputs(await run(params, log, opener=gone))
        assert [(row["state"], row["reply"]) for row in rows(out)] == [("timed out", "")]
        assert log == [
            ("INFO", "Talking to 127.0.0.1 port 7 over TCP"),
            ("INFO", "Port 7/tcp timed out: No answer within 10 seconds"),
            ("WARN", "Netcat failed (Timeout): Port 7 on 127.0.0.1 timed out after 10 seconds"),
        ]

    async def test_range_writes_debug_result_and_traffic_lines(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        echo, closed = await listen("tcp-echo"), free_port()
        params = talk(
            0,
            ports="range",
            port_range=f"{echo.port}, {closed}",
            text="hello",
            close_after_send=True,
        )
        out = await core(log)(params)
        assert out["success"] is True
        assert log == [
            ("INFO", "Talking to 2 ports on 127.0.0.1 over TCP"),
            ("DEBUG", f"Port {echo.port}/tcp open"),
            ("DEBUG", "Sent 5 bytes, received 5 bytes"),
            ("DEBUG", f"Port {closed}/tcp closed: Connection refused"),
            ("INFO", "1 open, 1 closed of 2"),
        ]

    async def test_udp_range_start_line(
        self, listen: Listen, log: LogRecorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        first, second = await listen("udp-echo"), await listen("udp-echo")
        resolve_to(monkeypatch, "127.0.0.1")
        port_range = f"{first.port}, {second.port}"
        params = talk(
            0, ports="range", port_range=port_range, protocol="udp", text="hi", timeout=FAST
        )
        await core(log)(params)
        assert log == [
            ("INFO", "Talking to 2 ports on 127.0.0.1 over UDP"),
            ("DEBUG", f"Port {first.port}/udp open"),
            ("DEBUG", "Sent 2 bytes, received 2 bytes"),
            ("DEBUG", f"Port {second.port}/udp open"),
            ("DEBUG", "Sent 2 bytes, received 2 bytes"),
            ("INFO", "2 open of 2"),
        ]

    @pytest.mark.parametrize("ports", ["single", "range"])
    async def test_payload_and_reply_are_never_logged(
        self, ports: str, listen: Listen, log: LogRecorder
    ) -> None:
        echo = await listen("tcp-echo")
        params = talk(
            echo.port,
            ports=ports,
            port_range=str(echo.port),
            text=DISTINCT,
            close_after_send=True,
        )
        out = await core(log)(params)
        assert [row["reply"] for row in rows(out)] == [DISTINCT]
        assert log and not [line for line in log if DISTINCT in line[1]]


class TestRangeTalk:
    """NETCAT-4: each port gets its own connection, the same payload and its own reply."""

    @pytest.mark.parametrize("second_kind", ["tcp-echo", "tcp-answer"])
    async def test_each_port_gets_its_own_connection_and_reply(
        self, second_kind: str, listen: Listen, log: LogRecorder
    ) -> None:
        first, second = await listen("tcp-echo"), await listen(second_kind)
        port_range = f"{first.port}, {second.port}"
        params = talk(0, ports="range", port_range=port_range, text="hello", close_after_send=True)
        out = await core(log)(params)
        assert await first.settled(1) == [b"hello"]
        assert await second.settled(1) == [b"hello"]
        second_reply = "hello" if second_kind == "tcp-echo" else "got:hello"
        replies = [(row["port"], row["reply"]) for row in rows(out)]
        assert replies == [(first.port, "hello"), (second.port, second_reply)]
        assert "reply" not in out


MB = 1024 * 1024
BIG = 8 * MB  # more than every buffer of a narrow server connection holds together
NARROW = 4096
PAUSE = 0.1
TRAFFIC = re.compile(r"Sent ([0-9]+) bytes, received ([0-9]+) bytes")


def traffic(log: LogRecorder) -> tuple[int, int]:
    """The bytes sent and received, as the one traffic line reports them."""
    [counts] = [match.groups() for _, text in log if (match := TRAFFIC.fullmatch(text))]
    return int(counts[0]), int(counts[1])


async def echo_back(listener: Listener, pauses: int, reader: Any, writer: Any) -> None:
    """Echo each chunk once the client took the last; stop reading PAUSE s `pauses` times."""
    data, marks = bytearray(), [(index + 1) * MB // 4 for index in range(pauses)]
    with suppress(ConnectionError):
        while chunk := await reader.read(65536):
            data += chunk
            writer.write(chunk)
            await writer.drain()
            while marks and len(data) >= marks[0]:
                marks.pop(0)
                await asyncio.sleep(PAUSE)
    listener.received.append(bytes(data))
    writer.close()


async def narrow_client(address: str, port: int) -> tuple[Any, Any]:
    """A client too narrow to run ahead of the server, so every server pause is one stall."""
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, NARROW)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, NARROW)
    sock.setblocking(False)
    await asyncio.get_running_loop().sock_connect(sock, (address, port))
    return await asyncio.open_connection(sock=sock)


def narrow_socket() -> socket.socket:
    """A loopback listener whose connections get small socket buffers."""
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, NARROW)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, NARROW)
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    return sock


@pytest.fixture
async def narrow() -> AsyncIterator[Callable[..., Awaitable[Listener]]]:
    """Start a narrow server: "echo" (pausing `pauses` times) or "deaf", which never reads."""
    closers: list[Callable[[], object]] = []

    async def start(kind: str, pauses: int = 0) -> Listener:
        sock, listener = narrow_socket(), Listener()
        listener.port = sock.getsockname()[1]
        if kind == "deaf":
            closers.append(sock.close)
            return listener
        server = await asyncio.start_server(partial(echo_back, listener, pauses), sock=sock)
        closers.append(server.close)
        return listener

    yield start
    for close in closers:
        close()


class TestSendWhileReading:
    """NETCAT-1, NETCAT-16: TCP Talk reads while it sends, as nc does."""

    async def test_a_reply_larger_than_the_buffers_comes_back_whole(
        self, narrow: Callable[..., Awaitable[Listener]], log: LogRecorder
    ) -> None:
        echo, payload = await narrow("echo"), b"0123456789abcdef" * (BIG // 16)
        params = talk(echo.port, send="file", file="big.bin", close_after_send=True)
        out, row = await talk_once(params, log, payload=payload)
        assert (row["state"], out["success"], traffic(log)) == ("open", True, (BIG, BIG))
        assert out["reply"] == payload.decode()
        assert await echo.settled(1) == [payload]

    async def test_a_server_that_stops_taking_data_stops_the_send_after_timeout(
        self, narrow: Callable[..., Awaitable[Listener]], log: LogRecorder
    ) -> None:
        deaf = await narrow("deaf")
        params = talk(deaf.port, send="file", file="big.bin", timeout=0.1, close_after_send=True)
        out, row = await talk_once(params, log, payload=b"x" * BIG)
        sent, received = traffic(log)
        assert 0 < sent < BIG and received == 0
        assert (row["state"], out["success"], out["reply"]) == ("open", True, "")
        assert row["time_ms"] >= 180

    async def test_a_slow_server_gets_the_whole_payload_however_long_it_takes(
        self, narrow: Callable[..., Awaitable[Listener]], log: LogRecorder
    ) -> None:
        """Timeout bounds each wait for the server to take data, never the whole send."""
        echo, payload = await narrow("echo", pauses=4), b"y" * BIG
        params = talk(echo.port, send="file", file="big.bin", timeout=0.3, close_after_send=True)
        out, row = await talk_once(params, log, payload=payload, opener=narrow_client)
        assert traffic(log) == (BIG, BIG)
        assert len(out["reply"]) == BIG and row["time_ms"] >= 4 * PAUSE * 1000 * 0.9
        assert await echo.settled(1) == [payload]

    async def test_a_reply_reaching_max_reply_size_ends_the_send_at_once(
        self, narrow: Callable[..., Awaitable[Listener]], log: LogRecorder
    ) -> None:
        echo = await narrow("echo")
        params = talk(echo.port, send="file", file="big.bin", max_reply_bytes=1000)
        out, row = await talk_once(params, log, payload=b"z" * BIG)
        sent, received = traffic(log)
        assert (out["reply"], received) == ("z" * 1000, 1000)
        assert sent < BIG and row["time_ms"] < WAIT * 1000 / 2
        assert log[-1] == ("WARN", f"Reply from port {echo.port} stopped at 1000 bytes")
        assert len((await echo.settled(1))[0]) < BIG


class TestStop:
    """NETCAT-6: Stop ends the block at once while it sends or reads a reply."""

    async def test_stop_while_sending_ends_the_block_at_once(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        silent, sending = await listen("tcp-silent"), asyncio.Event()
        writers: list[StalledWriter] = []

        async def opener(address: str, port: int) -> tuple[Any, Any]:
            reader, writer = await asyncio.open_connection(address, port)
            writers.append(StalledWriter(writer, sending))
            return reader, writers[-1]

        task = asyncio.create_task(run(talk(silent.port, text="hello"), log, opener=opener))
        await asyncio.wait_for(sending.wait(), WAIT)
        await assert_stopped(task, WAIT / 5)
        assert [writer.closed.is_set() for writer in writers] == [True]
        assert await silent.settled(1) == [b"hello"]

    async def test_stop_while_reading_ends_the_block_at_once(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        silent, reading = await listen("tcp-silent"), asyncio.Event()
        writers: list[WriterProbe] = []

        async def opener(address: str, port: int) -> tuple[Any, Any]:
            reader, writer = await asyncio.open_connection(address, port)
            writers.append(WriterProbe(writer))
            return SignalingReader(reader, reading), writers[-1]

        task = asyncio.create_task(run(talk(silent.port, text="hello"), log, opener=opener))
        await asyncio.wait_for(reading.wait(), WAIT)
        await assert_stopped(task, WAIT / 5)
        assert [writer.closed.is_set() for writer in writers] == [True]
        assert await silent.settled(1) == [b"hello"]

    async def test_stop_while_waiting_for_a_udp_reply_ends_the_block_at_once(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        silent = await listen("udp-silent")
        params = talk(silent.port, protocol="udp", text="hello")
        task = asyncio.create_task(run(params, log))
        assert await silent.settled(1) == [b"hello"]
        await assert_stopped(task, WAIT / 4)
