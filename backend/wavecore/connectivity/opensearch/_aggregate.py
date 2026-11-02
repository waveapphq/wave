"""Stats: entry checks, column names and the aggregation body (REQ-3.3.3.2, OS-7)."""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from ._errors import VALIDATION, OpenSearchFailure, kind_of
from ._json_text import JsonTextError, loads
from ._time import Window

STATS = (
    "count",
    "sum",
    "average",
    "min",
    "max",
    "percentile",
    "unique_count",
    "increase",
    "custom",
)
_METRICS = {
    "sum": "sum",
    "average": "avg",
    "min": "min",
    "max": "max",
    "unique_count": "cardinality",
}
_COMPANIONS = {"aggs", "aggregations", "meta"}
# The Group by time choices in size order, in milliseconds.
_INTERVALS = {
    "10s": 10_000,
    "30s": 30_000,
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
}
_MAX_SLOTS = 10_000


@dataclass(frozen=True)
class Stat:
    """One checked Stats entry; `number` is its 1-based position and names it `s<number>`."""

    number: int
    kind: str
    field: str = ""
    percent: Decimal | None = None
    aggregation: dict[str, Any] | None = None
    name: str = ""


def check_stats(entries: list[Any], time_field: str, group_field: str) -> list[Stat]:
    """Each entry must make one column of its own that the grouping does not use."""
    if not entries:
        raise _refused("Stats needs at least one entry")
    stats = [_checked(number, entry) for number, entry in enumerate(entries, start=1)]
    first: dict[str, int] = {}
    for stat in stats:
        column = column_name(stat)
        if column in first:
            raise _refused(
                f"Stats {first[column]} and {stat.number} both make the column '{column}'; "
                "each stat needs its own column"
            )
        first[column] = stat.number
    for column, number in first.items():
        if column in (time_field, group_field):
            raise _refused(
                f"Stat {number} makes the column '{column}', which the grouping already uses"
            )
    return stats


def column_name(stat: Stat) -> str:
    if stat.kind == "custom":
        return stat.name or f"custom {stat.number}"
    if stat.kind == "count":
        return "count"
    words = stat.kind.replace("_", " ")
    if stat.kind == "percentile":
        words = f"percentile {format(stat.percent, 'f')}"
    return f"{words} of {stat.field}"


def aggregation_body(
    stats: list[Stat],
    time_field: str,
    group_by_time: str,
    group_field: str,
    top_values: int,
    window: Window,
) -> dict[str, Any]:
    """The request's `aggs` object: terms outside the time slots, the stats innermost."""
    by_time = group_by_time != "none"
    aggs = _stat_aggregations(stats, time_field, window, in_time_slots=by_time)
    if by_time:
        slots = _histogram(time_field, group_by_time, window)
        slots["date_histogram"]["format"] = "strict_date_optional_time"
        aggs = {"time": {**slots, "aggs": aggs}}
    if group_field:
        terms = {"field": group_field, "size": top_values, "order": {"_count": "desc"}}
        aggs = {"group": {"terms": terms, "aggs": aggs}}
    return aggs


def _stat_aggregations(
    stats: list[Stat], time_field: str, window: Window, in_time_slots: bool
) -> dict[str, Any]:
    aggs: dict[str, Any] = {}
    for stat in stats:
        name = f"s{stat.number}"
        if stat.kind == "increase":
            ends = {
                f"{name}_max": {"max": {"field": stat.field}},
                f"{name}_min": {"min": {"field": stat.field}},
            }
            if in_time_slots:
                aggs.update(ends)
            else:
                slots = _histogram(time_field, _slot_interval(window), window)
                aggs[f"{name}_slots"] = {**slots, "aggs": ends}
        elif stat.kind == "custom":
            aggs[name] = stat.aggregation
        elif stat.kind == "percentile":
            spec = {"field": stat.field, "percents": [stat.percent], "keyed": False}
            aggs[name] = {"percentiles": spec}
        elif stat.kind != "count":
            aggs[name] = {_METRICS[stat.kind]: {"field": stat.field}}
    return aggs


def _histogram(time_field: str, interval: str, window: Window) -> dict[str, Any]:
    spec = {
        "field": time_field,
        "fixed_interval": interval,
        "min_doc_count": 0,
        "extended_bounds": {"min": window.from_ms, "max": window.to_ms},
        "time_zone": "UTC",
    }
    return {"date_histogram": spec}


def _slot_interval(window: Window) -> str:
    """The smallest interval giving at most 10,000 slots over the window; else the largest."""
    fitting = (
        interval
        for interval, ms in _INTERVALS.items()
        if window.to_ms // ms - window.from_ms // ms + 1 <= _MAX_SLOTS
    )
    return next(fitting, "1h")


def _checked(number: int, entry: Any) -> Stat:
    if not isinstance(entry, dict):
        raise _refused(
            f'Stat {number} must be a map with a stat, such as {{"stat": "count"}}; '
            f"it is {kind_of(entry)}"
        )
    stat = entry.get("stat")
    if stat not in STATS:
        raise _refused(
            f"Stat {number}: '{stat}' is not a stat. Use count, sum, average, min, max, "
            "percentile, unique_count, increase or custom"
        )
    if stat == "count":
        return Stat(number, stat)
    if stat == "custom":
        return _custom(number, entry)
    field = _text(entry.get("field"))
    if not field:
        raise _refused(f"Stat {number} ({stat.replace('_', ' ').capitalize()}) needs a Field")
    percent = _percent(number, entry.get("percent")) if stat == "percentile" else None
    return Stat(number, stat, field, percent)


def _percent(number: int, value: Any) -> Decimal:
    try:
        percent = Decimal(_text(value))
        if 0 <= percent <= 100:
            return percent.normalize()
    except InvalidOperation:
        pass
    raise _refused(f"Stat {number} (Percentile) needs a Percent from 0 to 100")


def _custom(number: int, entry: dict[str, Any]) -> Stat:
    label = f"Stat {number} (Custom (JSON))"
    text = _text(entry.get("json"))
    if not text:
        raise _refused(f"{label} needs its aggregation JSON")
    try:
        aggregation = loads(text)
    except JsonTextError as error:
        raise _refused(
            f"{label} is not valid JSON at line {error.line}, column {error.col}: {error.message}"
        ) from error
    if not isinstance(aggregation, dict) or len(aggregation.keys() - _COMPANIONS) != 1:
        raise _refused(
            f'{label} must be one aggregation, such as {{"avg": {{"field": "latency_ms"}}}}'
        )
    return Stat(number, "custom", aggregation=aggregation, name=_text(entry.get("name")))


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _refused(message: str) -> OpenSearchFailure:
    return OpenSearchFailure(message, VALIDATION)
