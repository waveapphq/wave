"""Suggestions at the OpenSearch editor's cursor: fields, DQL operators, keys and values (OS-12).

Positions count characters; `from` / `to` is the range the chosen item replaces.
"""

import re
from dataclasses import dataclass
from itertools import takewhile
from typing import Any

from wavecore.api.exceptions import ValidationException
from wavecore.api.services.opensearch_tools import api_spec
from wavecore.api.services.opensearch_tools.api_spec import Param
from wavecore.api.services.opensearch_tools.check import (
    MAX_QUERY_BYTES,
    field_list,
    refuse_unreadable,
)
from wavecore.connectivity.opensearch import dql
from wavecore.core.expressions.template import _TEMPLATE_PATTERN
from wavecore.core.expressions.template_escape import mask_markers

# Never `not` here: it is unary, so after a complete expression it needs `and` or `or` first.
_OPERATORS = ("and", "or")
# A JSON string up to its closing quote, or to the end of its line while it is still open.
_WORD = re.compile(r'"(?:[^"\\\n]|\\.)*(")?|[{}\[\]:,]')
# Comments become spaces so they neither open containers nor hide the cursor's string.
_COMMENT = re.compile(r'("(?:[^"\\\n]|\\.)*"?)|//[^\n]*|/\*(?:(?!\*/).)*(?:\*/)?', re.DOTALL)


@dataclass(frozen=True)
class _Spot:
    """The JSON string under the cursor: its path, whether it is a key or a value, its span."""

    path: list[str]
    slot: str
    key: str
    start: int
    end: int


def suggest(
    language: str, text: str, cursor: int, template: bool, fields_job_id: str | None
) -> dict[str, Any]:
    """The range a choice replaces and the choices that fit at the cursor."""
    refuse_unreadable(language, text, MAX_QUERY_BYTES)
    if not 0 <= cursor <= len(text):
        raise ValidationException(f"Cursor {cursor} is outside the text")
    fields = field_list(fields_job_id)
    # Each marker becomes a same-length placeholder, so the text reads as its filled form will.
    rule = "dql" if language == "dql" else "json"
    source = mask_markers(text, rule, _TEMPLATE_PATTERN) if template else text
    inside = template and _inside_marker(text[:cursor])
    if language == "dql":
        return _nothing(cursor) if inside else _dql(source, cursor, fields)
    spot = _spot_at(source, cursor)
    if inside or spot is None:
        return _nothing(cursor)
    prefix = source[spot.start : cursor]
    items = _json_items(language, spot, fields)
    return {
        "from": spot.start,
        "to": spot.end,
        "items": [item for item in items if item["label"].startswith(prefix)],
    }


def _nothing(cursor: int) -> dict[str, Any]:
    return {"from": cursor, "to": cursor, "items": []}


def _item(label: str, kind: str, detail: str = "", info: str = "") -> dict[str, Any]:
    return {"label": label, "kind": kind, "detail": detail, "info": info}


def _field_items(fields: list[dict[str, Any]] | None, prefix: str = "") -> list[dict[str, Any]]:
    """The loaded fields whose name starts with the prefix, in field-list order."""
    return [
        _item(field["name"], "field", ", ".join(field["types"]))
        for field in fields or []
        if field["name"].startswith(prefix)
    ]


def _dql(text: str, cursor: int, fields: list[dict[str, Any]] | None) -> dict[str, Any]:
    context = dql.cursor_context(text, cursor)
    if context.kind == "field":
        items = _field_items(fields, context.prefix)
    elif context.kind == "operator":
        items = [_item(word, "operator") for word in _OPERATORS]
    else:
        items = []
    return {"from": context.start, "to": context.end, "items": items}


def _inside_marker(before: str) -> bool:
    opening = before.rfind("{{")
    return opening >= 0 and "}}" not in before[opening:]


def _spot_at(source: str, cursor: int) -> _Spot | None:
    """The string under the cursor, read leniently from the text before it; None elsewhere."""
    text = _COMMENT.sub(lambda found: found.group(1) or " " * len(found.group()), source)
    # Each open container's opener and its own tokens; the top level comes first.
    frames: list[list[str]] = [[""]]
    for word in takewhile(lambda found: found.start() < cursor, _WORD.finditer(text)):
        token = word.group()
        closed = word.group(1) is not None
        end = word.end() - 1 if closed else word.end()
        if token[0] == '"' and cursor <= end:
            return _spot(frames, word.start() + 1, end if closed else cursor)
        frames = _read(frames, token)
    return None


def _read(frames: list[list[str]], token: str) -> list[list[str]]:
    """The frames after one token; a closing bracket never ends the top level."""
    if token in ("}", "]"):
        return frames[: max(len(frames) - 1, 1)]
    if token in ("{", "["):
        return [*frames, [token]]
    frames[-1].append(token)
    return frames


def _spot(frames: list[list[str]], start: int, end: int) -> _Spot:
    """Keys lead into each enclosing object; after a colon the string is that key's value."""
    inner = frames[-1]
    path = [frame[-2][1:-1] for frame in frames[1:-1] if frame[-1] == ":"]
    if inner[-1] == ":":
        return _Spot(path, "value", inner[-2][1:-1], start, end)
    key_slot = inner[0] == "{" and inner[-1] in ("{", ",")
    return _Spot(path, "key" if key_slot else "", "", start, end)


def _json_items(
    language: str, spot: _Spot, fields: list[dict[str, Any]] | None
) -> list[dict[str, Any]]:
    spec = api_spec.load_extract()
    if spot.slot == "key":
        under_type = language == "query_dsl" and len(spot.path) == 1
        if under_type and spot.path[0] in spec.field_keyed_queries:
            return _field_items(fields)
        return [
            _key_item(
                name, spec.param(language, spot.path, name), spec.type_description(language, name)
            )
            for name in spec.keys_at(language, spot.path)
        ]
    if spot.key == "field":
        return _field_items(fields)
    param = spec.param(language, spot.path, spot.key)
    return [_item(value, "value") for value in param.enum] if param is not None else []


def _key_item(name: str, param: Param | None, type_description: str) -> dict[str, Any]:
    """A type at the root with its description; a parameter with kind, description and version."""
    if param is None:
        return _item(name, "key", info=type_description)
    added = f" Added in {param.version_added}." if param.version_added else ""
    return _item(name, "key", param.kind, (param.description + added).strip())
