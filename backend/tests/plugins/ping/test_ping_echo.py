"""Ping's answered path: what it sends, how it paces it, and the two tables (REQ-3.4.1.9)."""

import math
import re
import struct
from typing import Any

import pytest

from tests.plugins.ping.conftest import (
    ROUTER,
    TARGET,
    TTL_EXCEEDED,
    Answer,
    FakeClock,
    FakeSocket,
    LogRecorder,
    columns,
    icmp_error,
    opener_for,
    outputs,
    ping_params,
    reply,
    resolve_to,
    row_map,
    rows,
    silence,
)
from wavecore.plugins._ping_core import _checksum, run

HOST = "target.internal"
START_LINE = f"PING {HOST} ({TARGET}) 56(84) bytes of data."
STATS_HEADER = f"--- {HOST} ping statistics ---"
REPLY_COLUMNS = [
    ("seq", "integer"),
    ("source", "string"),
    ("bytes", "integer"),
    ("ttl", "integer"),
    ("time_ms", "float"),
    ("status", "string"),
]
SUMMARY_COLUMNS = [
    ("sent", "integer"),
    ("received", "integer"),
    ("loss_percent", "float"),
    ("rtt_min_ms", "float"),
    ("rtt_avg_ms", "float"),
    ("rtt_max_ms", "float"),
    ("rtt_mdev_ms", "float"),
]
FOUR_TIMES = [10.0, 20.0, 30.0, 40.0]
TRANSMITTED = r"{sent} packets transmitted, {received} received, {loss}% packet loss, time \d+ms"
# Two 16-bit words at their maximum and a third, so the checksum folds a carry twice.
CARRYING = b"\xff\xff\xff\xff\x00\x01"
ICMP_ERROR_LINE = f"From {ROUTER} icmp_seq=1 {TTL_EXCEEDED}"
FIRST_REPLY = {
    "seq": 1,
    "source": TARGET,
    "bytes": 64,
    "ttl": 57,
    "time_ms": 10.0,
    "status": "answered",
}


def timeline(answers: dict[int, Answer], count: int = 4) -> list[Answer]:
    """One Interval slice per request: its answer when it has one, then the silence that ends it."""
    every_request_replied = len(answers) == count and all(
        received is not None and not received.error for _, received in answers.values()
    )
    script: list[Answer] = []
    for seq in range(1, count + 1):
        if seq in answers:
            script.append(answers[seq])
        if seq < count or not every_request_replied:
            script.append(silence())
    return script


def four_replies(**options: Any) -> dict[int, Answer]:
    """Every one of four requests answered on the same terms."""
    return {seq: reply(seq, **options) for seq in range(1, 5)}


def answered_in(times_ms: list[float]) -> dict[int, Answer]:
    """Four requests, each answered after its own round-trip time."""
    return {seq: reply(seq, after=ms / 1000) for seq, ms in enumerate(times_ms, start=1)}


async def ping(
    monkeypatch: pytest.MonkeyPatch,
    clock: FakeClock,
    log: LogRecorder,
    answers: dict[int, Answer],
    **overrides: Any,
) -> tuple[FakeSocket, dict[str, Any]]:
    """One run over a fresh fake socket: the socket it drove and the outputs it produced."""
    count = int(overrides.get("count", 4))
    resolve_to(monkeypatch, TARGET)
    sock = FakeSocket(timeline(answers, count), clock=clock)
    envelope = await run(ping_params(**overrides), log, opener=opener_for(sock), clock=clock)
    return sock, outputs(envelope)


def icmp_header(packet: bytes) -> tuple[int, int, int, int]:
    """The type, code, checksum and sequence number of one sent ICMP message."""
    icmp_type, code, checksum, _identifier, seq = struct.unpack("!BBHHH", packet[:8])
    return icmp_type, code, checksum, seq


def assert_three_places(table: dict[str, Any]) -> None:
    """Every float cell reads its own value rounded to three decimal places."""
    floats = [name for name, kind in columns(table) if kind == "float"]
    for index in range(len(rows(table))):
        cells = row_map(table, index)
        for name in floats:
            assert cells[name] == round(cells[name], 3)


def transmitted_line(log: LogRecorder, sent: int, received: int, loss: str) -> str:
    """The packets-transmitted line, checked for its shape; the elapsed reading rides free."""
    line = log.at("INFO")[-2] if received else log.at("INFO")[-1]
    assert re.fullmatch(TRANSMITTED.format(sent=sent, received=received, loss=loss), line)
    return line


class TestChecksum:
    """The Internet checksum of a request, with every carry folded back in (PING-1)."""

    @pytest.mark.parametrize(
        ("message", "expected"),
        [
            pytest.param(b"\x08\x00\x00\x00\x00\x01", 0xF7FE, id="no-carry"),
            pytest.param(b"\xff\xff\xff\xff", 0x0000, id="one-carry"),
            pytest.param(CARRYING, 0xFFFE, id="two-carries"),
        ],
    )
    def test_the_value_of_a_message(self, message: bytes, expected: int) -> None:
        assert _checksum(message) == expected

    def test_a_message_carrying_its_own_checksum_checks_out(self) -> None:
        """A message with its checksum in place sums to zero, which is what the receiver tests."""
        completed = CARRYING[:2] + _checksum(CARRYING).to_bytes(2, "big") + CARRYING[4:]

        assert _checksum(completed) == 0

    def test_an_odd_length_message_is_padded_to_a_whole_word(self) -> None:
        assert _checksum(b"\xff\xff\xff") == _checksum(b"\xff\xff\xff\x00")


class TestRequests:
    """Count echo requests go out, one per sequence number (PING-1)."""

    async def test_one_echo_request_per_sequence_number(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        sock, _ = await ping(monkeypatch, clock, log, four_replies())
        assert len(sock.sent) == 4
        for expected_seq, (_when, packet) in enumerate(sock.sent, start=1):
            icmp_type, code, checksum, seq = icmp_header(packet)
            assert (icmp_type, code, seq) == (8, 0, expected_seq)
            assert checksum != 0

    @pytest.mark.parametrize("packet_size", [0, 56, 1000])
    async def test_the_payload_is_the_packet_size(
        self,
        monkeypatch: pytest.MonkeyPatch,
        clock: FakeClock,
        log: LogRecorder,
        packet_size: int,
    ) -> None:
        answers = four_replies(payload=packet_size)
        sock, _ = await ping(monkeypatch, clock, log, answers, packet_size=packet_size)
        assert [len(packet) - 8 for _when, packet in sock.sent] == [packet_size] * 4

    async def test_the_socket_is_connected_to_the_resolved_address_and_closed(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        sock, _ = await ping(monkeypatch, clock, log, four_replies())
        assert sock.connected == TARGET
        assert sock.closed is True


class TestPacing:
    """Requests are paced by Interval, and each slice is read to its end (PING-2)."""

    async def test_requests_go_out_one_interval_apart(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        sock, _ = await ping(monkeypatch, clock, log, four_replies())
        assert [when for when, _packet in sock.sent] == pytest.approx([0.0, 0.1, 0.2, 0.3])

    async def test_the_wait_between_sends_is_the_rest_of_the_interval_slice(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        """The reply takes 10ms of each 100ms slice; the last send waits the reply grace out."""
        sock, _ = await ping(monkeypatch, clock, log, four_replies())
        assert sock.waits == pytest.approx([0.1, 0.09, 0.1, 0.09, 0.1, 0.09, 1.0])

    async def test_a_reply_that_fills_the_slice_ends_the_read_at_the_boundary(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        """The slice is used up when the reply lands, so the socket is not asked again."""
        resolve_to(monkeypatch, TARGET)
        sock = FakeSocket([reply(1, after=0.1), reply(2, after=0.01)], clock=clock)
        params = ping_params(count=2, interval=0.1)

        out = outputs(await run(params, log, opener=opener_for(sock), clock=clock))

        assert sock.waits == pytest.approx([0.1, 1.0])
        assert row_map(out["summary"])["received"] == 2


class TestRepliesTable:
    """Replies carries one row per request, in sequence order (PING-10)."""

    async def test_the_columns_are_the_declared_six(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, four_replies())
        assert columns(out["replies"]) == REPLY_COLUMNS

    async def test_one_row_per_request_in_sequence_order(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, {2: reply(2), 4: reply(4)})
        table = out["replies"]
        assert [row[0] for row in rows(table)] == [1, 2, 3, 4]
        assert [row[-1] for row in rows(table)] == [
            "timed out",
            "answered",
            "timed out",
            "answered",
        ]

    async def test_an_answered_row_carries_the_reply_it_got(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, answered_in(FOUR_TIMES))
        assert row_map(out["replies"], 1) == {
            "seq": 2,
            "source": TARGET,
            "bytes": 64,
            "ttl": 57,
            "time_ms": 20.0,
            "status": "answered",
        }

    async def test_the_byte_count_is_the_icmp_message_length(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        answers = four_replies(payload=1000)
        _, out = await ping(monkeypatch, clock, log, answers, packet_size=1000)
        assert [row_map(out["replies"], index)["bytes"] for index in range(4)] == [1008] * 4

    async def test_an_unanswered_row_reads_empty(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, {1: reply(1)})
        assert row_map(out["replies"], 3) == {
            "seq": 4,
            "source": "",
            "bytes": 0,
            "ttl": 0,
            "time_ms": 0.0,
            "status": "timed out",
        }

    async def test_a_reply_without_a_ttl_reads_zero(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        """PING-10: the platform hides the hop limit on some hosts; the column stays a number."""
        _, out = await ping(monkeypatch, clock, log, four_replies(ttl=0))
        assert [row_map(out["replies"], index)["ttl"] for index in range(4)] == [0] * 4

    async def test_every_float_is_rounded_to_three_places(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, answered_in([1.0 / 3, 20.0, 30.0, 40.0]))
        assert_three_places(out["replies"])
        assert_three_places(out["summary"])


class TestStrayPackets:
    """A packet that answers no outstanding request changes nothing (PING-10)."""

    @pytest.mark.parametrize(
        "stray",
        [
            pytest.param(reply(1, source=ROUTER, ttl=9), id="the-same-sequence-twice"),
            pytest.param(reply(99, source=ROUTER, ttl=9), id="a-sequence-never-sent"),
        ],
    )
    async def test_it_is_left_out_of_the_replies_and_the_summary(
        self,
        monkeypatch: pytest.MonkeyPatch,
        clock: FakeClock,
        log: LogRecorder,
        stray: Answer,
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        script = [reply(1), stray, silence(), reply(2)]
        sock = FakeSocket(script, clock=clock)
        params = ping_params(count=2, interval=1)

        out = outputs(await run(params, log, opener=opener_for(sock), clock=clock))

        assert [row[0] for row in rows(out["replies"])] == [1, 2]
        assert row_map(out["replies"], 0) == FIRST_REPLY
        summary = row_map(out["summary"])
        assert (summary["sent"], summary["received"]) == (2, 2)


class TestSummaryTable:
    """Summary carries exactly one row of the run's statistics (PING-11)."""

    async def test_the_columns_are_the_declared_seven_over_one_row(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, four_replies())
        assert columns(out["summary"]) == SUMMARY_COLUMNS
        assert len(rows(out["summary"])) == 1

    async def test_four_replies_give_the_exact_statistics(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, answered_in(FOUR_TIMES))
        mean = sum(FOUR_TIMES) / len(FOUR_TIMES)
        deviation = math.sqrt(sum(t * t for t in FOUR_TIMES) / len(FOUR_TIMES) - mean * mean)
        assert row_map(out["summary"]) == {
            "sent": 4,
            "received": 4,
            "loss_percent": 0.0,
            "rtt_min_ms": 10.0,
            "rtt_avg_ms": 25.0,
            "rtt_max_ms": 40.0,
            "rtt_mdev_ms": round(deviation, 3),
        }

    async def test_the_deviation_is_stored_rounded_to_three_places(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, answered_in(FOUR_TIMES))
        mean = sum(FOUR_TIMES) / len(FOUR_TIMES)
        deviation = math.sqrt(sum(t * t for t in FOUR_TIMES) / len(FOUR_TIMES) - mean * mean)
        assert row_map(out["summary"])["rtt_mdev_ms"] == 11.18
        assert row_map(out["summary"])["rtt_mdev_ms"] != deviation

    async def test_one_reply_has_no_deviation(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, {1: reply(1)}, count=1)
        assert row_map(out["summary"]) == {
            "sent": 1,
            "received": 1,
            "loss_percent": 0.0,
            "rtt_min_ms": 10.0,
            "rtt_avg_ms": 10.0,
            "rtt_max_ms": 10.0,
            "rtt_mdev_ms": 0.0,
        }

    async def test_one_answer_of_four_is_seventy_five_percent_loss(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, {2: reply(2)})
        figures = row_map(out["summary"])
        assert (figures["sent"], figures["received"], figures["loss_percent"]) == (4, 1, 75.0)
        assert figures["rtt_mdev_ms"] == 0.0

    async def test_nothing_answered_leaves_the_round_trip_figures_at_zero(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, {}, on_error="record")
        assert row_map(out["summary"]) == {
            "sent": 4,
            "received": 0,
            "loss_percent": 100.0,
            "rtt_min_ms": 0.0,
            "rtt_avg_ms": 0.0,
            "rtt_max_ms": 0.0,
            "rtt_mdev_ms": 0.0,
        }


class TestBlockResult:
    """A run whose pass rule held reports success and no failure (PING-12)."""

    async def test_a_passing_run_reports_success(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        _, out = await ping(monkeypatch, clock, log, four_replies())
        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert "__block_warning" not in out


class TestConsole:
    """The lines the block writes to the console (PING-16)."""

    @pytest.mark.parametrize("stream_output", [False, True])
    async def test_the_start_line_is_written_once(
        self,
        monkeypatch: pytest.MonkeyPatch,
        clock: FakeClock,
        log: LogRecorder,
        stream_output: bool,
    ) -> None:
        await ping(monkeypatch, clock, log, four_replies(), stream_output=stream_output)
        assert log.at("INFO").count(START_LINE) == 1
        assert log.at("INFO")[0] == START_LINE

    async def test_the_start_line_carries_the_wire_size(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        """The wire size is the payload plus the 28 bytes of IPv4 and ICMP headers."""
        answers = four_replies(payload=1000)
        await ping(monkeypatch, clock, log, answers, packet_size=1000)
        assert log.at("INFO")[0] == f"PING {HOST} ({TARGET}) 1000(1028) bytes of data."

    async def test_no_per_reply_line_without_stream_output(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        await ping(monkeypatch, clock, log, {2: reply(2)})
        assert [line for line in log.at("INFO") if " bytes from " in line] == []
        assert [line for line in log.at("WARN") if line.startswith("No reply to ")] == []

    async def test_stream_output_writes_one_line_per_reply(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        await ping(monkeypatch, clock, log, answered_in(FOUR_TIMES), stream_output=True)
        assert [line for line in log.at("INFO") if " bytes from " in line] == [
            f"64 bytes from {TARGET}: icmp_seq=1 ttl=57 time=10.0 ms",
            f"64 bytes from {TARGET}: icmp_seq=2 ttl=57 time=20.0 ms",
            f"64 bytes from {TARGET}: icmp_seq=3 ttl=57 time=30.0 ms",
            f"64 bytes from {TARGET}: icmp_seq=4 ttl=57 time=40.0 ms",
        ]

    async def test_stream_output_leaves_the_ttl_out_when_it_is_unknown(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        await ping(monkeypatch, clock, log, {1: reply(1, ttl=0)}, count=1, stream_output=True)
        assert log.at("INFO")[1] == f"64 bytes from {TARGET}: icmp_seq=1 time=10.0 ms"

    @pytest.mark.parametrize(
        ("stream_output", "expected"),
        [pytest.param(False, [], id="off"), pytest.param(True, [ICMP_ERROR_LINE], id="on")],
    )
    async def test_stream_output_warns_once_per_icmp_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
        clock: FakeClock,
        log: LogRecorder,
        stream_output: bool,
        expected: list[str],
    ) -> None:
        answers = {1: icmp_error(1)}
        overrides = {"count": 1, "on_error": "record", "stream_output": stream_output}
        await ping(monkeypatch, clock, log, answers, **overrides)

        assert [line for line in log.at("WARN") if line.startswith("From ")] == expected

    async def test_stream_output_warns_once_per_unanswered_request(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        answers = {2: reply(2)}
        await ping(monkeypatch, clock, log, answers, stream_output=True)
        assert [line for line in log.at("WARN") if line.startswith("No reply to ")] == [
            f"No reply to icmp_seq=1 from {HOST}",
            f"No reply to icmp_seq=3 from {HOST}",
            f"No reply to icmp_seq=4 from {HOST}",
        ]

    @pytest.mark.parametrize("stream_output", [False, True])
    async def test_the_summary_lines_are_always_written(
        self,
        monkeypatch: pytest.MonkeyPatch,
        clock: FakeClock,
        log: LogRecorder,
        stream_output: bool,
    ) -> None:
        await ping(monkeypatch, clock, log, answered_in(FOUR_TIMES), stream_output=stream_output)
        assert log.at("INFO")[-3] == STATS_HEADER
        transmitted_line(log, sent=4, received=4, loss=r"0\.0")
        assert log.at("INFO")[-1] == "rtt min/avg/max/mdev = 10.0/25.0/40.0/11.18 ms"

    async def test_the_round_trip_line_is_left_out_when_nothing_answered(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        await ping(monkeypatch, clock, log, {}, on_error="record")
        assert log.at("INFO")[-2] == STATS_HEADER
        transmitted_line(log, sent=4, received=0, loss=r"100\.0")
        assert [line for line in log.at("INFO") if line.startswith("rtt ")] == []
