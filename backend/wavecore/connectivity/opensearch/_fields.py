"""The field list a run checks named fields against (REQ-3.3.2.6, REQ-5.1.2)."""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from ._url import encoded, index_path

if TYPE_CHECKING:
    from ._rest import Client

METADATA_FIELDS = frozenset(
    {
        "_id",
        "_index",
        "_routing",
        "_source",
        "_seq_no",
        "_version",
        "_ignored",
        "_field_names",
        "_nested_path",
        "_doc_count",
        "_feature",
        "_data_stream_timestamp",
    }
)


@dataclass(frozen=True)
class FieldInfo:
    """One field's mapped types, sorted, and whether every type can aggregate."""

    types: list[str]
    aggregatable: bool


@dataclass(frozen=True)
class FieldList:
    """The indices a pattern matched and their fields by full name."""

    indices: list[str]
    fields: dict[str, FieldInfo]

    def known(self, name: str) -> bool:
        """True for a listed field, a metadata field, or a `*` pattern matching a listed field."""
        if name in METADATA_FIELDS:
            return True
        pattern = wildcard_pattern(name.split("*"))
        return any(pattern.fullmatch(field) for field in self.fields)


def wildcard_pattern(parts: Sequence[str]) -> re.Pattern[str]:
    """The texts between `*` wildcards as one expression that must match a whole name."""
    return re.compile(".*".join(re.escape(part) for part in parts), re.DOTALL)


_FIELD_CAPS_QUERY = {"fields": "*", "ignore_unavailable": "true", "allow_no_indices": "true"}
_DATE_STAMP = re.compile(r"[-_.]?\d{4}(?:[-_.]?\d{2}){1,2}$", re.ASCII)


def read_field_list(client: "Client", pattern: str) -> FieldList:
    """`GET <index>/_field_caps`: every field but the metadata ones, types sorted."""
    path = index_path(client.url.prefix, pattern, "_field_caps")
    answer = client.json(client.request("GET", path, query=dict(_FIELD_CAPS_QUERY)))
    fields = {
        name: FieldInfo(
            types=sorted(caps),
            aggregatable=all(entry.get("aggregatable") is True for entry in caps.values()),
        )
        for name, caps in answer["fields"].items()
        if name not in METADATA_FIELDS
    }
    return FieldList(indices=list(answer["indices"]), fields=fields)


def read_indexes(client: "Client", pattern: str) -> list[dict[str, Any]]:
    """`GET _resolve/index/<pattern>`: indexes, aliases and data streams, dailies folded."""
    path = f"{client.url.prefix}/_resolve/index/{encoded(pattern or '*')}"
    answer = client.json(client.request("GET", path))
    return fold_indexes(
        [entry["name"] for entry in answer["indices"]],
        [entry["name"] for entry in answer["aliases"]],
        [entry["name"] for entry in answer["data_streams"]],
    )


def fold_indexes(
    names: list[str], aliases: list[str], data_streams: list[str]
) -> list[dict[str, Any]]:
    """Two or more indexes ending in a date stamp fold into one `<prefix>*` entry."""
    groups: dict[str, list[str]] = {}
    for name in names:
        groups.setdefault(_folded_name(name), []).append(name)
    entries = [
        (
            {"name": folded, "kind": "folded", "count": len(members)}
            if len(members) > 1
            else _entry(members[0], "index")
        )
        for folded, members in groups.items()
    ]
    entries += [_entry(name, "alias") for name in aliases]
    entries += [_entry(name, "data_stream") for name in data_streams]
    return sorted(entries, key=lambda entry: str(entry["name"]))


def _folded_name(name: str) -> str:
    """The name before its date stamp, the separator the stamp starts with, then `*`."""
    stamp = _DATE_STAMP.search(name)
    if stamp is None:
        return name
    mark = stamp.group()[0]
    return f"{name[: stamp.start()]}{mark if mark in '-_.' else ''}*"


def _entry(name: str, kind: str) -> dict[str, Any]:
    return {"name": name, "kind": kind, "count": 1}
