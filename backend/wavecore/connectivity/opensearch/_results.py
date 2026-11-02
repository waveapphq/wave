"""Documents to the Search Results table (REQ-3.3.3.1, OS-8)."""

from typing import Any

from wavecore.connectivity.k8s.verbs._outputs import typed_table

from ._fields import wildcard_pattern
from ._json_text import dumps

_HIT_METADATA = ("_id", "_index")


def results_table(entries: list[str], hits: list[dict[str, Any]]) -> dict[str, Any]:
    """One column per Fields entry, objects as dotted leaf columns; empty Fields = `_source`."""
    if not entries:
        return typed_table(["_source"], [[dumps(_source(hit))] for hit in hits])
    columns: dict[str, list[Any]] = {}
    for entry in entries:
        for name, cells in _entry_columns(entry, hits):
            columns.setdefault(name, cells)
    rows = [list(row) for row in zip(*columns.values(), strict=True)]
    return typed_table(list(columns), rows)


def _source(hit: dict[str, Any]) -> dict[str, Any]:
    return hit.get("_source") or {}


def _entry_columns(entry: str, hits: list[dict[str, Any]]) -> list[tuple[str, list[Any]]]:
    """The entry's own column when a hit holds a non-object there, then its leaf columns by name."""
    if "*" in entry:
        pattern = wildcard_pattern(entry.split("*"))
        values: list[Any] = [None] * len(hits)
        leaves = [
            {
                name: cell
                for name, cell in _flat(_source(hit), "").items()
                if pattern.fullmatch(name)
            }
            for hit in hits
        ]
    else:
        values = [_read(hit, entry) for hit in hits]
        leaves = [_flat(value, f"{entry}.") if isinstance(value, dict) else {} for value in values]
    # Name order level by level: a filtered `_source` comes back in the cluster's own key order.
    names = sorted({name for leaf in leaves for name in leaf}, key=lambda name: name.split("."))
    scalar = any(value is not None and not isinstance(value, dict) for value in values)
    own = [(entry, [None if isinstance(value, dict) else _cell(value) for value in values])]
    return (own if scalar or not names else []) + [
        (name, [_cell(leaf.get(name)) for leaf in leaves]) for name in names
    ]


def _read(hit: dict[str, Any], entry: str) -> Any:
    """Hit metadata by name; else walk `_source`, taking the longest key at each level."""
    if entry in _HIT_METADATA:
        return hit.get(entry)
    node: Any = _source(hit)
    parts = entry.split(".")
    start = 0
    while start < len(parts):
        if not isinstance(node, dict):
            return None
        end = next(
            (end for end in range(len(parts), start, -1) if ".".join(parts[start:end]) in node),
            start,
        )
        if end == start:
            return None
        node, start = node[".".join(parts[start:end])], end
    return node


def _flat(value: dict[str, Any], prefix: str) -> dict[str, Any]:
    """Leaf values by dotted name, in document order; the first of two equal names wins."""
    leaves: dict[str, Any] = {}
    for key, child in value.items():
        name = f"{prefix}{key}"
        if isinstance(child, dict):
            for leaf, cell in _flat(child, f"{name}.").items():
                leaves.setdefault(leaf, cell)
        else:
            leaves.setdefault(name, child)
    return leaves


def _cell(value: Any) -> Any:
    return dumps(value) if isinstance(value, list) else value
