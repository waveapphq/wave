"""From and To: timestamps, epoch milliseconds, `now` date math and the window (REQ-3.3.2.3)."""

import calendar
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from ._errors import VALIDATION, OpenSearchFailure, cut

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_MILLISECOND = timedelta(milliseconds=1)
_UTC_OFFSET = "+00:00"
_DIGITS = re.compile(r"\d+", re.ASCII)
_ISO = re.compile(
    r"([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[T ]([0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,6}))?)?"
    r"(Z|[+-][0-9]{2}:[0-9]{2})?"
)
_MATH = re.compile(r"now((?:[+-]\d+[yMwdhHms]|/[yMwdhHms])*)", re.ASCII)
_STEP = re.compile(r"([-+/])(\d*)([yMwdhHms])", re.ASCII)
_MONTHS = {"y": 12, "M": 1}
_SPANS = {
    "w": timedelta(weeks=1),
    "d": timedelta(days=1),
    "h": timedelta(hours=1),
    "H": timedelta(hours=1),
    "m": timedelta(minutes=1),
    "s": timedelta(seconds=1),
}
# How many of year, month, day, hour, minute, second a unit keeps when rounding.
_KEPT = {"y": 1, "M": 2, "w": 3, "d": 3, "h": 4, "H": 4, "m": 5, "s": 6}
_FLOOR = (0, 1, 1, 0, 0, 0)


@dataclass(frozen=True)
class TimeSpec:
    """A fixed instant in epoch milliseconds, or the steps of `now` date math."""

    ms: int | None = None
    steps: tuple[tuple[str, int, str], ...] = ()


@dataclass(frozen=True)
class Window:
    from_ms: int
    to_ms: int


def parse_time(label: str, value: Any) -> TimeSpec:
    """Read a From or To value; `label` names the row in the refusal."""
    text = str(value)
    whole = isinstance(value, int) and not isinstance(value, bool) and value >= 0
    if whole or (isinstance(value, str) and _DIGITS.fullmatch(value)):
        if len(text) in (10, 11):
            raise OpenSearchFailure(
                f"{label} {text} reads as epoch seconds; the row takes epoch milliseconds: "
                "for seconds, multiply by 1000",
                VALIDATION,
            )
        return TimeSpec(ms=int(text))
    spec = (_date_math(text) or _timestamp(text)) if isinstance(value, str) else None
    if spec is None:
        raise OpenSearchFailure(
            f"{label} is not a time: '{cut(text, 50)}'. Use a timestamp such as "
            "2026-09-25T10:42:05Z, epoch milliseconds, or relative time such as now-15m",
            VALIDATION,
        )
    return spec


def window(from_spec: TimeSpec, to_spec: TimeSpec, now: datetime) -> Window:
    """Both ends against one `now`: rounding takes From down and To up."""
    return Window(_resolved(from_spec, now, up=False), _resolved(to_spec, now, up=True))


def window_warnings(span: Window, now: datetime) -> list[str]:
    start = iso(span.from_ms)
    lines = []
    if span.from_ms > span.to_ms:
        lines.append(
            f"From {start} is later than To {iso(span.to_ms)}: the search can find nothing"
        )
    now_ms = _millis(now)
    if span.from_ms > now_ms:
        lines.append(f"From {start} is later than now ({iso(now_ms)}): the search can find nothing")
    return lines


def iso(ms: int) -> str:
    """`YYYY-MM-DDTHH:MM:SS.mmmZ`."""
    moment = EPOCH + ms * _MILLISECOND
    return moment.isoformat(timespec="milliseconds").replace(_UTC_OFFSET, "Z")


def _date_math(text: str) -> TimeSpec | None:
    match = _MATH.fullmatch(text)
    if match is None:
        return None
    steps = _STEP.findall(match.group(1))
    return TimeSpec(steps=tuple((op, int(amount or 0), unit) for op, amount, unit in steps))


def _timestamp(text: str) -> TimeSpec | None:
    match = _ISO.fullmatch(text)
    if match is None:
        return None
    day, clock, fraction, zone = match.groups()
    stamp = f"{day}T{clock or '00:00:00'}.{(fraction or '').ljust(6, '0')}"
    try:
        moment = datetime.fromisoformat(stamp + (zone or _UTC_OFFSET).replace("Z", _UTC_OFFSET))
    except ValueError:
        return None
    return TimeSpec(ms=_millis(moment))


def _millis(moment: datetime) -> int:
    return (moment - EPOCH) // _MILLISECOND


def _resolved(spec: TimeSpec, now: datetime, up: bool) -> int:
    if spec.ms is not None:
        return spec.ms
    moment = now
    for op, amount, unit in spec.steps:
        if op == "/":
            moment = _rounded(moment, unit, up)
        else:
            moment = _shifted(moment, amount if op == "+" else -amount, unit)
    return _millis(moment)


def _shifted(moment: datetime, amount: int, unit: str) -> datetime:
    if unit not in _MONTHS:
        return moment + amount * _SPANS[unit]
    index = moment.year * 12 + moment.month - 1 + amount * _MONTHS[unit]
    year, month = divmod(index, 12)
    last_day = calendar.monthrange(year, month + 1)[1]
    return moment.replace(year=year, month=month + 1, day=min(moment.day, last_day))


def _rounded(moment: datetime, unit: str, up: bool) -> datetime:
    """The unit's first instant, or its last millisecond when rounding up; weeks start Monday."""
    fields = (moment.year, moment.month, moment.day, moment.hour, moment.minute, moment.second)
    kept = _KEPT[unit]
    year, month, day, hour, minute, second = fields[:kept] + _FLOOR[kept:]
    start = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
    start -= timedelta(days=start.weekday() if unit == "w" else 0)
    return _shifted(start, 1, unit) - _MILLISECOND if up else start
