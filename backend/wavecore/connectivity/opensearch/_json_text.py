"""The one JSON reader and writer of the OpenSearch core: comments, exact decimals (REQ-3.3.2.6)."""

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, cast

_GAP = re.compile(r"(?:[ \t\n\r]+|//[^\n]*|/\*.*?\*/)*", re.DOTALL)
_STRING = re.compile(r'"[^"\\]*(?:\\.[^"\\]*)*"', re.DOTALL)
_BAD_ESCAPE = re.compile(r'\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})', re.DOTALL)
_NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?", re.ASCII)
_LITERAL = re.compile(r"true|false|null")
_LITERALS = {"true": ("boolean", True), "false": ("boolean", False), "null": ("null", None)}


class JsonTextError(Exception):
    """Text that is not one JSON value, with the 1-based line and column of the fault."""

    def __init__(self, message: str, line: int, col: int) -> None:
        super().__init__(message)
        self.message = message
        self.line = line
        self.col = col


@dataclass(frozen=True)
class JsonNode:
    """One value with its character span; objects also carry the span of each key."""

    kind: str
    value: Any
    start: int
    end: int
    keys: dict[str, tuple[int, int]] = field(default_factory=dict)


def parse(text: str) -> JsonNode:
    """The value tree of `text`, for the editor check and the suggestions."""
    reader = _Reader(text)
    node = reader.value(0)
    end = reader.skip(node.end)
    if end < len(text):
        raise reader.fault("Extra text after the JSON value", end)
    return node


def loads(text: str) -> Any:
    """The value of `text`: floats as `Decimal`, comments allowed, duplicate keys refused."""
    return _plain(parse(text))


def dumps(value: Any) -> str:
    """Compact JSON with non-ASCII text kept and each `Decimal` written as its exact digits."""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, dict):
        members = ",".join(f"{_text(str(key))}:{dumps(child)}" for key, child in value.items())
        return f"{{{members}}}"
    if isinstance(value, list):
        return f"[{','.join(dumps(child) for child in value)}]"
    return _text(value)


def _text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _plain(node: JsonNode) -> Any:
    if node.kind == "object":
        return {key: _plain(child) for key, child in node.value.items()}
    if node.kind == "array":
        return [_plain(child) for child in node.value]
    return node.value


class _Reader:
    def __init__(self, text: str) -> None:
        self.text = text

    def fault(self, message: str, offset: int) -> JsonTextError:
        line = self.text.count("\n", 0, offset) + 1
        return JsonTextError(message, line, offset - self.text.rfind("\n", 0, offset))

    def skip(self, pos: int) -> int:
        """The offset after any whitespace and comments at `pos`."""
        # `_GAP` ends in `*`, so it always matches, if only the empty text.
        end = cast(re.Match[str], _GAP.match(self.text, pos)).end()
        if self.text.startswith("/*", end):
            raise self.fault("Unterminated comment", end)
        return end

    def at(self, pos: int, token: str) -> bool:
        return self.text.startswith(token, pos)

    def value(self, pos: int) -> JsonNode:
        pos = self.skip(pos)
        if self.at(pos, "{"):
            return self.object(pos)
        if self.at(pos, "["):
            return self.array(pos)
        if self.at(pos, '"'):
            return self.string(pos)
        number = _NUMBER.match(self.text, pos)
        if number is not None:
            digits = number.group()
            exact = Decimal(digits) if number.lastindex else int(digits)
            return JsonNode("number", exact, pos, number.end())
        literal = _LITERAL.match(self.text, pos)
        if literal is None:
            raise self.fault("Expected a value", pos)
        kind, plain = _LITERALS[literal.group()]
        return JsonNode(kind, plain, pos, literal.end())

    def string(self, pos: int) -> JsonNode:
        match = _STRING.match(self.text, pos)
        if match is None:
            raise self.fault("Unterminated string", pos)
        raw = match.group()
        bad = _BAD_ESCAPE.search(raw)
        if bad is not None:
            escape = raw[bad.start() : bad.start() + 2]
            raise self.fault(f"Invalid escape {escape}", pos + bad.start())
        return JsonNode("string", json.loads(raw, strict=False), pos, match.end())

    def object(self, start: int) -> JsonNode:
        members: dict[str, JsonNode] = {}
        keys: dict[str, tuple[int, int]] = {}
        pos = self.skip(start + 1)
        if self.at(pos, "}"):
            return JsonNode("object", members, start, pos + 1, keys)
        while True:
            if not self.at(pos, '"'):
                raise self.fault("Expected a string key", pos)
            key = self.string(pos)
            if key.value in members:
                raise self.fault(f'Duplicate key "{key.value}"', pos)
            pos = self.skip(key.end)
            if not self.at(pos, ":"):
                raise self.fault("Expected :", pos)
            member = self.value(pos + 1)
            members[key.value] = member
            keys[key.value] = (key.start, key.end)
            pos = self.skip(member.end)
            if self.at(pos, "}"):
                return JsonNode("object", members, start, pos + 1, keys)
            if not self.at(pos, ","):
                raise self.fault("Expected , or }", pos)
            pos = self.skip(pos + 1)

    def array(self, start: int) -> JsonNode:
        items: list[JsonNode] = []
        pos = self.skip(start + 1)
        if self.at(pos, "]"):
            return JsonNode("array", items, start, pos + 1)
        while True:
            item = self.value(pos)
            items.append(item)
            pos = self.skip(item.end)
            if self.at(pos, "]"):
                return JsonNode("array", items, start, pos + 1)
            if not self.at(pos, ","):
                raise self.fault("Expected , or ]", pos)
            pos = self.skip(pos + 1)
