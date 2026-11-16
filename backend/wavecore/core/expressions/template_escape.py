"""`{{ }}` values escaped for where they land in a DQL or JSON template (REQ-3.3.2.6, OS-5)."""

import json
import re
from collections.abc import Callable, Collection, Iterator
from decimal import Decimal
from typing import Any

from wavecore.core.expressions.errors import (
    InvalidExpressionError,
    NullValueError,
    null_failure_message,
)
from wavecore.core.table import Table

_CONTROLS = {"\t": "\\t", "\r": "\\r", "\n": "\\n"}
_DQL_QUOTED = str.maketrans({"\\": "\\\\", '"': '\\"', **_CONTROLS})
_JSON_STRING = str.maketrans(json.encoder.ESCAPE_DCT)
_DQL_BARE = str.maketrans({**{char: f"\\{char}" for char in '\\():<>"*{}'}, **_CONTROLS})
_OR_AND = re.compile(r"(?<!\S)(?:or|and)(?!\S)", re.IGNORECASE)
_NOT = re.compile(r"not(?= )", re.IGNORECASE)
_NOT_REFUSAL = (
    '{marker} puts a lowercase "not" before a space outside quotes. DQL reads that as the NOT '
    'operator, even inside a word such as "cannot stop", and there is no way to escape it. '
    "Put quotes around {marker}."
)


def _json_text(value: Any) -> str:
    """Compact JSON, a Decimal written as its exact digits and a Table as its rows."""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, Table):
        return _json_text(value.to_list())
    if isinstance(value, list):
        return "[" + ",".join(_json_text(item) for item in value) + "]"
    if isinstance(value, dict):
        entries = (f"{_json_text(str(key))}:{_json_text(item)}" for key, item in value.items())
        return "{" + ",".join(entries) + "}"
    return json.dumps(value, ensure_ascii=False, default=str)


def text_form(value: Any) -> str:
    """The text a value fills in: text as is, anything else in its compact JSON form."""
    return value if isinstance(value, str) else _json_text(value)


def _landings(template: str, pattern: re.Pattern[str]) -> Iterator[tuple[re.Match[str], bool]]:
    """Each marker, and whether it lands inside quotes, judged on the template's own text."""
    inside = False
    position = 0
    for match in pattern.finditer(template):
        escaped = False
        for char in template[position : match.start()]:
            if char == '"' and not escaped:
                inside = not inside
            escaped = char == "\\" and not escaped
        position = match.end()
        yield match, inside


def _dql_bare(text: str, following: str, match: re.Match[str]) -> list[str]:
    """Outside quotes: each character with specials and operator words escaped, `not` refused."""
    marked = {found.start() for found in _OR_AND.finditer(text)}
    for found in _NOT.finditer(text + following):
        if text[found.start()] == "n":
            raise InvalidExpressionError(
                _NOT_REFUSAL.format(marker=match.group(0)), expression=match.group(1).strip()
            )
        marked.add(found.start())
    return [
        ("\\" if index in marked else "") + char.translate(_DQL_BARE)
        for index, char in enumerate(text)
    ]


def _escaped(
    rule: str, value: Any, inside: bool, template: str, match: re.Match[str]
) -> tuple[str, list[str], str]:
    """The value's text form, each character escaped for this landing, and the escaped text."""
    text = text_form(value)
    if rule == "json" and not inside and not isinstance(value, str):
        return text, list(text), text
    if rule == "json":
        chars = [char.translate(_JSON_STRING) for char in text]
        escaped = "".join(chars)
        return text, chars, escaped if inside else f'"{escaped}"'
    if inside:
        chars = [char.translate(_DQL_QUOTED) for char in text]
        return text, chars, "".join(chars)
    chars = _dql_bare(text, template[match.end() : match.end() + 1], match)
    return text, chars, "".join(chars) or '""'


def _part_pairs(text: str, chars: list[str], parts: Collection[str]) -> Iterator[tuple[str, str]]:
    """Each part inside the text but not the whole of it, with each escaped text it takes."""
    for part in parts:
        if part == text:
            continue
        forms: dict[str, None] = {}
        start = text.find(part)
        while start != -1:
            forms["".join(chars[start : start + len(part)])] = None
            start = text.find(part, start + 1)
        yield from ((part, form) for form in forms)


def render_escaped(
    template: str,
    rule: str,
    evaluate: Callable[[str], Any],
    pattern: re.Pattern[str],
    *,
    setting: str,
    parts: Collection[str] = (),
) -> tuple[str, list[tuple[str, str]]]:
    """The template filled with escaped values, and a (raw text, escaped text) pair per marker.

    Each of ``parts`` found inside a larger value adds a (part, escaped text) pair for
    each escaped text it takes there. A null piece is JSON ``null`` where it stands alone
    as a JSON value; anywhere else it fails and names the piece and the setting
    (REQ-3.1.3.22).
    """
    pieces: list[str] = []
    pairs: list[tuple[str, str]] = []
    position = 0
    for match, inside in _landings(template, pattern):
        pieces.append(template[position : match.start()])
        position = match.end()
        expression = match.group(1).strip()
        if not expression:
            pieces.append(match.group(0))
            continue
        value = evaluate(expression)
        if value is None and (rule != "json" or inside):
            raise NullValueError(null_failure_message(setting, expression=expression), expression)
        text, chars, escaped = _escaped(rule, value, inside, template, match)
        pairs.append((text, escaped))
        pairs.extend(_part_pairs(text, chars, parts))
        pieces.append(escaped)
    pieces.append(template[position:])
    return "".join(pieces), pairs


def mask_markers(template: str, rule: str, pattern: re.Pattern[str]) -> str:
    """Each marker as a same-length placeholder that parses where it lands."""
    pieces: list[str] = []
    position = 0
    for match, inside in _landings(template, pattern):
        pieces.append(template[position : match.start()])
        position = match.end()
        size = len(match.group(0))
        standing_alone = rule == "json" and not inside
        pieces.append("0".ljust(size) if standing_alone else "x" * size)
    pieces.append(template[position:])
    return "".join(pieces)
