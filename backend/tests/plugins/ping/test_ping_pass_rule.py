"""Ping's Pass when rule: which runs pass, and what each failure says (REQ-3.3.4.4)."""

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
    exact,
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
from wavecore.plugins._ping_core import run

HOST = "target.internal"
STATS_HEADER = f"--- {HOST} ping statistics ---"
NO_REPLY = f"No reply from {HOST}"
ERROR_STATUS = f"{TTL_EXCEEDED} from {ROUTER}"
ALL_FOUR_RULES = [
    pytest.param({"pass_when": "any"}, NO_REPLY, "NoReply", id="any"),
    pytest.param({"pass_when": "all"}, "0 of 4 requests answered", "NotAllReplied", id="all"),
    pytest.param(
        {"pass_when": "min_replies", "min_replies": 1},
        "0 of 4 requests answered, fewer than the 1 required",
        "TooFewReplies",
        id="min-replies",
    ),
    pytest.param(
        {"pass_when": "min_rate", "min_rate": 100},
        "0.0% of requests answered, below the 100% required",
        "RateTooLow",
        id="min-rate",
    ),
]


@pytest.fixture(params=["fail", "record"])
def on_error(request: pytest.FixtureRequest) -> str:
    return str(request.param)


def timeline(answers: dict[int, Answer], count: int) -> list[Answer]:
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


def replied(*seqs: int) -> dict[int, Answer]:
    """Those sequence numbers answered by an echo reply; the rest go unanswered."""
    return {seq: reply(seq) for seq in seqs}


async def ping(
    monkeypatch: pytest.MonkeyPatch,
    clock: FakeClock,
    log: LogRecorder,
    answers: dict[int, Answer],
    **overrides: Any,
) -> dict[str, Any]:
    """One run over a fresh fake socket; the result envelope it answered."""
    count = int(overrides.get("count", 4))
    resolve_to(monkeypatch, TARGET)
    sock = FakeSocket(timeline(answers, count), clock=clock)
    return await run(ping_params(**overrides), log, opener=opener_for(sock), clock=clock)


async def assert_passes(
    monkeypatch: pytest.MonkeyPatch,
    clock: FakeClock,
    log: LogRecorder,
    answers: dict[int, Answer],
    **overrides: Any,
) -> dict[str, Any]:
    """The rule held: the block succeeded and carries no failure."""
    out = outputs(await ping(monkeypatch, clock, log, answers, **overrides))
    assert (out["success"], out["error"], out["reason"]) == (True, "", "")
    return out


async def assert_fails(
    monkeypatch: pytest.MonkeyPatch,
    clock: FakeClock,
    log: LogRecorder,
    answers: dict[int, Answer],
    message: str,
    reason: str,
    **overrides: Any,
) -> dict[str, Any]:
    """Fail raises the message; record answers it with its reason, the amber flag and the line."""
    if overrides.get("on_error") != "record":
        with pytest.raises(ValueError, match=exact(message)):
            await ping(monkeypatch, clock, log, answers, **overrides)
        return {}
    out = outputs(await ping(monkeypatch, clock, log, answers, **overrides))
    assert (out["success"], out["error"], out["reason"]) == (False, message, reason)
    assert out["__block_warning"] is True
    assert log[-1] == ("WARN", f"Ping failed ({reason}): {message}")
    return out


class TestAnyReply:
    """Any reply, the default rule, passes on one answer (PING-12)."""

    @pytest.mark.parametrize(
        "rule",
        [pytest.param({}, id="absent"), pytest.param({"pass_when": "any"}, id="named")],
    )
    async def test_one_answer_of_four_passes(
        self,
        monkeypatch: pytest.MonkeyPatch,
        clock: FakeClock,
        log: LogRecorder,
        rule: dict[str, Any],
    ) -> None:
        out = await assert_passes(monkeypatch, clock, log, replied(3), **rule)
        assert row_map(out["summary"])["received"] == 1

    async def test_nothing_answered_fails_with_no_reply(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder, on_error: str
    ) -> None:
        await assert_fails(
            monkeypatch, clock, log, {}, NO_REPLY, "NoReply", pass_when="any", on_error=on_error
        )


class TestAllReplies:
    """All replies passes only when every request was answered (PING-12)."""

    async def test_every_request_answered_passes(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        out = await assert_passes(monkeypatch, clock, log, replied(1, 2, 3, 4), pass_when="all")
        assert row_map(out["summary"])["received"] == 4

    async def test_one_unanswered_request_fails_with_not_all_replied(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder, on_error: str
    ) -> None:
        await assert_fails(
            monkeypatch,
            clock,
            log,
            replied(1, 2, 3),
            "3 of 4 requests answered",
            "NotAllReplied",
            pass_when="all",
            on_error=on_error,
        )


class TestMinReplies:
    """At least N replies passes on the required count (PING-12)."""

    async def test_the_required_number_passes(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        await assert_passes(
            monkeypatch, clock, log, replied(1, 2, 3), pass_when="min_replies", min_replies=3
        )

    async def test_fewer_than_required_fails_with_too_few_replies(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder, on_error: str
    ) -> None:
        await assert_fails(
            monkeypatch,
            clock,
            log,
            replied(1, 2),
            "2 of 4 requests answered, fewer than the 3 required",
            "TooFewReplies",
            pass_when="min_replies",
            min_replies=3,
            on_error=on_error,
        )


class TestMinRate:
    """At least X% replies passes on the required rate (PING-12)."""

    async def test_the_required_rate_passes(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        """Three of four is 75.0%, which meets a 75% requirement."""
        out = await assert_passes(
            monkeypatch, clock, log, replied(1, 2, 3), pass_when="min_rate", min_rate=75
        )
        assert row_map(out["summary"])["loss_percent"] == 25.0

    async def test_a_lower_rate_fails_with_rate_too_low(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder, on_error: str
    ) -> None:
        await assert_fails(
            monkeypatch,
            clock,
            log,
            replied(1, 2),
            "50.0% of requests answered, below the 75% required",
            "RateTooLow",
            pass_when="min_rate",
            min_rate=75,
            on_error=on_error,
        )

    async def test_a_repeating_rate_is_rounded_to_three_places(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        """One of three answered is the rate Summary reports as 100 minus the loss."""
        out = await assert_fails(
            monkeypatch,
            clock,
            log,
            replied(2),
            "33.333% of requests answered, below the 75% required",
            "RateTooLow",
            count=3,
            pass_when="min_rate",
            min_rate=75,
            on_error="record",
        )
        assert round(100 - row_map(out["summary"])["loss_percent"], 3) == 33.333


class TestIcmpError:
    """A request an ICMP error came back for counts as unanswered (PING-9)."""

    @pytest.mark.parametrize(("rule", "message", "reason"), ALL_FOUR_RULES)
    async def test_an_icmp_error_never_counts_as_an_answer(
        self,
        monkeypatch: pytest.MonkeyPatch,
        clock: FakeClock,
        log: LogRecorder,
        rule: dict[str, Any],
        message: str,
        reason: str,
    ) -> None:
        answers = {seq: icmp_error(seq) for seq in range(1, 5)}
        await assert_fails(monkeypatch, clock, log, answers, message, reason, **rule)

    async def test_the_error_row_names_the_error_and_its_sender(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        answers = {seq: icmp_error(seq) for seq in range(1, 5)}
        out = await assert_fails(
            monkeypatch, clock, log, answers, NO_REPLY, "NoReply", on_error="record"
        )
        assert [row[-1] for row in rows(out["replies"])] == [ERROR_STATUS] * 4
        assert row_map(out["summary"])["received"] == 0


class TestMeasurementSurvivesFailure:
    """A failed rule still reports what the run measured (PING-12)."""

    async def test_the_tables_carry_the_run_that_failed(
        self, monkeypatch: pytest.MonkeyPatch, clock: FakeClock, log: LogRecorder
    ) -> None:
        out = await assert_fails(
            monkeypatch,
            clock,
            log,
            replied(2),
            "1 of 4 requests answered",
            "NotAllReplied",
            pass_when="all",
            on_error="record",
        )
        assert [row[-1] for row in rows(out["replies"])] == [
            "timed out",
            "answered",
            "timed out",
            "timed out",
        ]
        figures = row_map(out["summary"])
        assert (figures["sent"], figures["received"], figures["rtt_avg_ms"]) == (4, 1, 10.0)

    @pytest.mark.parametrize("disposition", ["fail", "record"])
    async def test_the_summary_lines_were_written_before_the_rule_ran(
        self,
        monkeypatch: pytest.MonkeyPatch,
        clock: FakeClock,
        log: LogRecorder,
        disposition: str,
    ) -> None:
        await assert_fails(monkeypatch, clock, log, {}, NO_REPLY, "NoReply", on_error=disposition)
        assert log.at("INFO")[-2] == STATS_HEADER
        assert log.at("INFO")[-1].startswith("4 packets transmitted, 0 received, 100.0% packet")
