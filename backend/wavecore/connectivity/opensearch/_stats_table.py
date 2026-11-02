"""The aggregation answer to the Aggregate Results table (REQ-3.3.3.2, OS-8, OS-9)."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from wavecore.connectivity.k8s.verbs._outputs import typed_table

from ._aggregate import Stat, column_name
from ._json_text import dumps


@dataclass(frozen=True)
class Slot:
    """One time slot of a counter: its lowest and highest value and how many documents."""

    min: Any
    max: Any
    doc_count: int


def stats_table(
    stats: list[Stat],
    answer: dict[str, Any],
    time_field: str,
    group_by_time: str,
    group_field: str,
    top_values: int,
) -> tuple[dict[str, Any], list[str]]:
    """Rows by time slot then field value (terms order); the Top values WARN lines."""
    aggregations = answer.get("aggregations", {})
    by_time = group_by_time != "none"
    warnings = []
    if group_field:
        group = aggregations["group"]
        series = [([_value_cell(bucket)], bucket) for bucket in group["buckets"]]
        others = group.get("sum_other_doc_count", 0)
        if others > 0:
            warnings.append(_top_values_line(top_values, group_field, others))
    else:
        series = [([], {**aggregations, "doc_count": answer["hits"]["total"]["value"]})]
    keyed: list[tuple[str, list[Any]]] = []
    for lead, bucket in series:
        if by_time:
            keyed.extend(_slot_rows(stats, lead, bucket["time"]["buckets"]))
        else:
            keyed.append(("", [*lead, *_cells(stats, bucket, _slot_sums(stats, bucket))]))
    keyed.sort(key=lambda pair: pair[0])
    columns = stats_columns(stats, time_field, group_by_time, group_field)
    return typed_table(columns, [row for _key, row in keyed]), warnings


def stats_columns(
    stats: list[Stat], time_field: str, group_by_time: str, group_field: str
) -> list[str]:
    """The time column, the value column, then one column per stat."""
    columns = [time_field] if group_by_time != "none" else []
    columns += [group_field] if group_field else []
    return columns + [column_name(stat) for stat in stats]


def _top_values_line(top_values: int, group_field: str, others: int) -> str:
    kept = f"{top_values} value" if top_values == 1 else f"{top_values} values"
    if others == 1:
        left = "1 matching document has another value and is left out"
    else:
        left = f"{others} matching documents have other values and are left out"
    return f"Top values kept {kept} of {group_field}; {left}"


def increases(slots: list[Slot]) -> list[Decimal]:
    """Per slot: 0 when empty, else the rise from the previous non-empty max, or from its min."""
    rises: list[Decimal] = []
    previous = None
    for slot in slots:
        if slot.max is None:
            rises.append(Decimal(0))
            continue
        rise = slot.max - (slot.min if previous is None else previous)
        rises.append(rise if rise >= 0 else slot.max - slot.min)
        previous = slot.max
    return rises


def _slot_rows(
    stats: list[Stat], lead: list[Any], buckets: list[dict[str, Any]]
) -> list[tuple[str, list[Any]]]:
    """One series over its time slots; Increase is worked out along the series."""
    rises = {
        stat.number: increases([_slot(bucket, stat.number) for bucket in buckets])
        for stat in stats
        if stat.kind == "increase"
    }
    rows = []
    for index, bucket in enumerate(buckets):
        stamp = bucket["key_as_string"]
        increase = {number: values[index] for number, values in rises.items()}
        rows.append((stamp, [stamp, *lead, *_cells(stats, bucket, increase)]))
    return rows


def _slot_sums(stats: list[Stat], bucket: dict[str, Any]) -> dict[int, Any]:
    """Ungrouped by time, Increase is the sum over the stat's internal slots."""
    return {
        stat.number: sum(
            increases(
                [_slot(slot, stat.number) for slot in bucket[f"s{stat.number}_slots"]["buckets"]]
            )
        )
        for stat in stats
        if stat.kind == "increase"
    }


def _slot(bucket: dict[str, Any], number: int) -> Slot:
    return Slot(
        min=bucket[f"s{number}_min"]["value"],
        max=bucket[f"s{number}_max"]["value"],
        doc_count=bucket["doc_count"],
    )


def _cells(stats: list[Stat], bucket: dict[str, Any], increase: dict[int, Any]) -> list[Any]:
    return [_cell(stat, bucket, increase) for stat in stats]


def _cell(stat: Stat, bucket: dict[str, Any], increase: dict[int, Any]) -> Any:
    if stat.kind == "count":
        return bucket["doc_count"]
    if stat.kind == "increase":
        return increase[stat.number]
    result = bucket[f"s{stat.number}"]
    if stat.kind == "custom" and "value" not in result:
        return dumps({key: value for key, value in result.items() if key != "meta"})
    value = result["values"][0]["value"] if stat.kind == "percentile" else result["value"]
    # A quiet slot shows 0; a slot with documents keeps a missing value empty.
    return 0 if value is None and bucket["doc_count"] == 0 else value


def _value_cell(bucket: dict[str, Any]) -> Any:
    return bucket["key_as_string"] if "key_as_string" in bucket else bucket["key"]
