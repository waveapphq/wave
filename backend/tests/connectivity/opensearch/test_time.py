"""From and To: parsing, date math, rounding, the window and its warnings (REQ-3.3.2.3, OS-8)."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from wavecore.connectivity.opensearch._errors import OpenSearchFailure
from wavecore.connectivity.opensearch._time import Window, iso, parse_time, window, window_warnings

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
NOW = datetime(2026, 9, 25, 10, 42, 5, 123000, tzinfo=UTC)
NOT_A_TIME_TAIL = (
    ". Use a timestamp such as 2026-09-25T10:42:05Z, epoch milliseconds, "
    "or relative time such as now-15m"
)


def _ms(stamp: str) -> int:
    moment = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)
    return (moment - EPOCH) // timedelta(milliseconds=1)


def _at(stamp: str) -> datetime:
    return datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)


def _from(value: Any, now: datetime = NOW) -> int:
    return window(parse_time("From", value), parse_time("To", "now"), now).from_ms


def _to(value: Any, now: datetime = NOW) -> int:
    return window(parse_time("From", "now-15m"), parse_time("To", value), now).to_ms


def _refused(label: str, value: Any) -> OpenSearchFailure:
    with pytest.raises(OpenSearchFailure) as caught:
        parse_time(label, value)
    return caught.value


class TestTimestamps:
    """ISO timestamps; a zone-less value is UTC; a timestamp is never rounded."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("2026-09-25T10:42:05Z", "2026-09-25T10:42:05.000Z"),
            ("2026-09-25T10:42:05.123+02:00", "2026-09-25T08:42:05.123Z"),
            ("2026-09-25T10:42:05.5-05:00", "2026-09-25T15:42:05.500Z"),
            ("2026-09-25 10:42:05", "2026-09-25T10:42:05.000Z"),
            ("2026-09-25T10:42:05", "2026-09-25T10:42:05.000Z"),
            ("2026-09-25", "2026-09-25T00:00:00.000Z"),
        ],
        ids=["utc-z", "offset-plus", "offset-minus", "space-zoneless", "t-zoneless", "date-only"],
    )
    def test_iso_forms(self, value: str, expected: str) -> None:
        assert _from(value) == _ms(expected)

    @pytest.mark.parametrize(
        ("fraction", "millis"),
        [("1", "100"), ("12", "120"), ("123", "123"), ("1234", "123"), ("123456", "123")],
    )
    def test_fractions_of_one_to_six_digits(self, fraction: str, millis: str) -> None:
        assert _from(f"2026-09-25T10:42:05.{fraction}Z") == _ms(f"2026-09-25T10:42:05.{millis}Z")

    def test_a_timestamp_in_to_is_not_rounded_up(self) -> None:
        assert _to("2026-09-25") == _ms("2026-09-25T00:00:00.000Z")


class TestEpochMilliseconds:
    """An integer or all-digit text is epoch milliseconds."""

    @pytest.mark.parametrize("value", [1790332925000, "1790332925000"], ids=["int", "digits"])
    def test_epoch_milliseconds(self, value: Any) -> None:
        assert _from(value) == 1790332925000

    @pytest.mark.parametrize("value", [0, 5, 179033292, 100000000000])
    def test_lengths_other_than_10_or_11_digits(self, value: int) -> None:
        assert _from(value) == value


class TestEpochSecondsRefusal:
    """10 or 11 digits read as epoch seconds."""

    @pytest.mark.parametrize(
        ("label", "value", "shown"),
        [
            ("From", 1790332925, "1790332925"),
            ("To", 1790332925, "1790332925"),
            ("From", 17903329250, "17903329250"),
            ("From", "1790332925", "1790332925"),
            ("To", 1000000000, "1000000000"),
        ],
        ids=["from-10", "to-10", "from-11", "from-digits", "to-smallest-10"],
    )
    def test_epoch_seconds_are_refused(self, label: str, value: Any, shown: str) -> None:
        failure = _refused(label, value)

        assert failure.message == (
            f"{label} {shown} reads as epoch seconds; the row takes epoch milliseconds: "
            "for seconds, multiply by 1000"
        )
        assert failure.reason == "Validation"


class TestNotATime:
    """Anything that is not a timestamp, epoch milliseconds or now date math."""

    @pytest.mark.parametrize("label", ["From", "To"])
    def test_names_the_row_and_the_value(self, label: str) -> None:
        failure = _refused(label, "yesterday")

        assert failure.message == f"{label} is not a time: 'yesterday'{NOT_A_TIME_TAIL}"
        assert failure.reason == "Validation"

    def test_a_value_longer_than_50_characters_is_cut(self) -> None:
        failure = _refused("From", "q" * 60)

        assert failure.message == f"From is not a time: '{'q' * 50}...'{NOT_A_TIME_TAIL}"

    def test_a_value_of_exactly_50_characters_is_whole(self) -> None:
        failure = _refused("From", "q" * 50)

        assert failure.message == f"From is not a time: '{'q' * 50}'{NOT_A_TIME_TAIL}"

    @pytest.mark.parametrize(
        "value",
        [
            "now-15x",
            "now-m",
            "now/",
            "now15m",
            "now/1d",
            "now-15m/",
            "now*2",
            "nowish",
            "2026-13-01",
            "2026-09-25T25:00:00Z",
            "-5",
        ],
    )
    def test_malformed_text(self, value: str) -> None:
        failure = _refused("From", value)

        assert failure.message == f"From is not a time: '{value}'{NOT_A_TIME_TAIL}"
        assert failure.reason == "Validation"

    @pytest.mark.parametrize(
        ("value", "shown"),
        [(1.5, "1.5"), (True, "True"), ([1, 2], "[1, 2]"), (-5, "-5")],
        ids=["float", "boolean", "list", "negative-int"],
    )
    def test_values_that_are_neither_text_nor_a_non_negative_integer(
        self, value: Any, shown: str
    ) -> None:
        failure = _refused("To", value)

        assert failure.message == f"To is not a time: '{shown}'{NOT_A_TIME_TAIL}"
        assert failure.reason == "Validation"


class TestDateMath:
    """`now` then any sequence of +N<u>, -N<u>, /<u>; `H` is `h`."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("now", "2026-09-25T10:42:05.123Z"),
            ("now-15m", "2026-09-25T10:27:05.123Z"),
            ("now+2d", "2026-09-27T10:42:05.123Z"),
            ("now-90s", "2026-09-25T10:40:35.123Z"),
            ("now-2h", "2026-09-25T08:42:05.123Z"),
            ("now-2H", "2026-09-25T08:42:05.123Z"),
            ("now-2w", "2026-09-11T10:42:05.123Z"),
            ("now+1M", "2026-10-25T10:42:05.123Z"),
            ("now-13M", "2025-08-25T10:42:05.123Z"),
            ("now-1y", "2025-09-25T10:42:05.123Z"),
            ("now-1d+2h", "2026-09-24T12:42:05.123Z"),
        ],
    )
    def test_arithmetic(self, value: str, expected: str) -> None:
        assert _from(value) == _ms(expected)

    @pytest.mark.parametrize(
        ("now", "value", "expected"),
        [
            ("2026-03-31T12:00:00.000Z", "now-1M", "2026-02-28T12:00:00.000Z"),
            ("2026-01-31T00:00:00.000Z", "now+1M", "2026-02-28T00:00:00.000Z"),
            ("2028-01-31T00:00:00.000Z", "now+1M", "2028-02-29T00:00:00.000Z"),
            ("2028-02-29T00:00:00.000Z", "now+1y", "2029-02-28T00:00:00.000Z"),
        ],
        ids=[
            "back-into-february",
            "forward-into-february",
            "leap-february",
            "leap-day-plus-a-year",
        ],
    )
    def test_months_and_years_clamp_the_day_to_the_months_end(
        self, now: str, value: str, expected: str
    ) -> None:
        assert _from(value, _at(now)) == _ms(expected)

    def test_both_ends_read_the_same_now(self) -> None:
        resolved = window(parse_time("From", "now"), parse_time("To", "now"), NOW)

        assert resolved == Window(
            from_ms=_ms("2026-09-25T10:42:05.123Z"), to_ms=_ms("2026-09-25T10:42:05.123Z")
        )


class TestRounding:
    """`/u` rounds From down to the unit's start and To up to its last millisecond."""

    @pytest.mark.parametrize(
        ("value", "down", "up"),
        [
            ("now/d", "2026-09-25T00:00:00.000Z", "2026-09-25T23:59:59.999Z"),
            ("now-1d/d", "2026-09-24T00:00:00.000Z", "2026-09-24T23:59:59.999Z"),
            ("now-15m/m", "2026-09-25T10:27:00.000Z", "2026-09-25T10:27:59.999Z"),
            ("now/h", "2026-09-25T10:00:00.000Z", "2026-09-25T10:59:59.999Z"),
            ("now/H", "2026-09-25T10:00:00.000Z", "2026-09-25T10:59:59.999Z"),
            ("now/m", "2026-09-25T10:42:00.000Z", "2026-09-25T10:42:59.999Z"),
            ("now/s", "2026-09-25T10:42:05.000Z", "2026-09-25T10:42:05.999Z"),
            ("now/w", "2026-09-21T00:00:00.000Z", "2026-09-27T23:59:59.999Z"),
            ("now/M", "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z"),
            ("now/y", "2026-01-01T00:00:00.000Z", "2026-12-31T23:59:59.999Z"),
            ("now-1d+2h/h", "2026-09-24T12:00:00.000Z", "2026-09-24T12:59:59.999Z"),
        ],
    )
    def test_from_rounds_down_and_to_rounds_up(self, value: str, down: str, up: str) -> None:
        assert _from(value) == _ms(down)
        assert _to(value) == _ms(up)

    def test_to_now_d_on_2026_09_25_is_the_last_millisecond_of_the_day(self) -> None:
        assert iso(_to("now/d")) == "2026-09-25T23:59:59.999Z"

    def test_weeks_start_on_monday_when_now_is_a_sunday(self) -> None:
        sunday = _at("2026-09-27T23:00:00.000Z")

        assert _from("now/w", sunday) == _ms("2026-09-21T00:00:00.000Z")
        assert _to("now/w", sunday) == _ms("2026-09-27T23:59:59.999Z")

    def test_weeks_start_on_monday_when_now_is_a_monday(self) -> None:
        monday = _at("2026-09-28T00:30:00.000Z")

        assert _from("now/w", monday) == _ms("2026-09-28T00:00:00.000Z")
        assert _to("now/w", monday) == _ms("2026-10-04T23:59:59.999Z")

    def test_a_leap_february_rounds_up_to_the_29th(self) -> None:
        assert _to("now/M", _at("2028-02-10T08:00:00.000Z")) == _ms("2028-02-29T23:59:59.999Z")


class TestIso:
    """`YYYY-MM-DDTHH:MM:SS.mmmZ` for the run line and the warnings."""

    @pytest.mark.parametrize(
        ("ms", "text"),
        [
            (1790332925123, "2026-09-25T10:42:05.123Z"),
            (1790332925000, "2026-09-25T10:42:05.000Z"),
            (0, "1970-01-01T00:00:00.000Z"),
            (5, "1970-01-01T00:00:00.005Z"),
        ],
    )
    def test_iso(self, ms: int, text: str) -> None:
        assert iso(ms) == text


class TestWindowWarnings:
    """WARN lines; the run goes on and the block is not amber."""

    def test_from_later_than_to(self) -> None:
        span = Window(
            from_ms=_ms("2026-09-25T10:00:00.000Z"), to_ms=_ms("2026-09-25T09:00:00.000Z")
        )

        assert window_warnings(span, NOW) == [
            "From 2026-09-25T10:00:00.000Z is later than To 2026-09-25T09:00:00.000Z: "
            "the search can find nothing"
        ]

    def test_from_later_than_now(self) -> None:
        span = Window(
            from_ms=_ms("2026-09-26T00:00:00.000Z"), to_ms=_ms("2026-09-27T00:00:00.000Z")
        )

        assert window_warnings(span, NOW) == [
            "From 2026-09-26T00:00:00.000Z is later than now (2026-09-25T10:42:05.123Z): "
            "the search can find nothing"
        ]

    def test_both_lines_in_table_order(self) -> None:
        span = Window(
            from_ms=_ms("2026-09-26T00:00:00.000Z"), to_ms=_ms("2026-09-25T09:00:00.000Z")
        )

        assert window_warnings(span, NOW) == [
            "From 2026-09-26T00:00:00.000Z is later than To 2026-09-25T09:00:00.000Z: "
            "the search can find nothing",
            "From 2026-09-26T00:00:00.000Z is later than now (2026-09-25T10:42:05.123Z): "
            "the search can find nothing",
        ]

    @pytest.mark.parametrize(
        ("start", "end"),
        [
            ("2026-09-25T10:27:05.123Z", "2026-09-25T10:42:05.123Z"),
            ("2026-09-25T10:00:00.000Z", "2026-09-25T10:00:00.000Z"),
            ("2026-09-25T10:42:05.123Z", "2026-09-26T00:00:00.000Z"),
            ("2026-09-25T00:00:00.000Z", "2026-09-30T00:00:00.000Z"),
        ],
        ids=["last-15-minutes", "from-equals-to", "from-equals-now", "to-after-now"],
    )
    def test_no_warning(self, start: str, end: str) -> None:
        assert window_warnings(Window(from_ms=_ms(start), to_ms=_ms(end)), NOW) == []
