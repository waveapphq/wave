"""Splits a SQL script the way each database's own tool does (REQ-3.4.1.6 SQL-3)."""

import re
from collections.abc import Iterator
from typing import NamedTuple


class Statement(NamedTuple):
    text: str
    line: int
    column: int
    block: bool


SPACE = "space"
COMMENT = "comment"
QUOTED = "quoted"
WORD = "word"
OTHER = "other"
CODE = frozenset({QUOTED, WORD, OTHER})

_SPACE = re.compile(r"[^\S\n]+|\n")
_WORD = re.compile(r"\w+")
_SINGLE = re.compile(r"'(?:[^']+|'')*(?:'|\Z)")
_SINGLE_ESCAPED = re.compile(r"'(?:[^'\\]+|\\.?|'')*(?:'|\Z)", re.DOTALL)
_DOUBLE = re.compile(r'"(?:[^"]+|"")*(?:"|\Z)')
_DOUBLE_ESCAPED = re.compile(r'"(?:[^"\\]+|\\.?|"")*(?:"|\Z)', re.DOTALL)
_BACKTICK = re.compile(r"`(?:[^`]+|``)*(?:`|\Z)")
_BRACKET = re.compile(r"\[[^\]]*(?:\]|\Z)")
_BRACKET_DOUBLED = re.compile(r"\[(?:[^\]]+|\]\])*(?:\]|\Z)")
_DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_]\w*)?\$", re.ASCII)
_COMMENT_MARK = re.compile(r"/\*|\*/")
_Q_CLOSE = {"[": "]", "{": "}", "(": ")", "<": ">"}
_REGIONS = {
    ("*", "'"): _SINGLE,
    ("*", '"'): _DOUBLE,
    ("mysql", "'"): _SINGLE_ESCAPED,
    ("mysql", '"'): _DOUBLE_ESCAPED,
    ("mysql", "`"): _BACKTICK,
    ("sqlite", "`"): _BACKTICK,
    ("sqlite", "["): _BRACKET,
    ("mssql", "["): _BRACKET_DOUBLED,
}
_Q_PREFIXES = (("oracle", "q"), ("oracle", "nq"))

_LINE_RULES = {
    "mssql": re.compile(r"[^\S\n]*GO[^\S\n]*(?:\n|\Z)", re.IGNORECASE),
    "oracle": re.compile(r"[^\S\n]*/[^\S\n]*(?:\n|\Z)"),
    "mysql": re.compile(r"[^\S\n]*DELIMITER[^\S\n]+(\S+)[^\S\n]*(?:\n|\Z)", re.IGNORECASE),
}
_PLSQL_HEAD = re.compile(
    r"(?:DECLARE|BEGIN)\b|CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:EDITIONABLE|NONEDITIONABLE)\s+)?"
    r"(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE)\b",
    re.IGNORECASE,
)
_TRIGGER_HEAD = re.compile(r"CREATE\s+(?:(?:TEMP|TEMPORARY)\s+)?TRIGGER\b", re.IGNORECASE)
_LEADING_NOISE = re.compile(r"(?:\s+|--[^\n]*|/\*.*?\*/)*", re.DOTALL)
_SESSION_STATE = re.compile(r"(?:USE|SET|ALTER\s+SESSION)\b", re.IGNORECASE)

_PLAIN = "plain"
_BLOCK = "block"
_TRIGGER = "trigger"
# sqlite3_complete's trigger states: in the body, after a `;`, after `; END`.
_IN_BODY, _AFTER_SEMI, _AFTER_END = range(3)


def _region_end(pattern: re.Pattern[str], text: str, start: int) -> int:
    match = pattern.match(text, start)
    return match.end() if match else len(text)


def _found_end(text: str, found: int, width: int) -> int:
    return len(text) if found < 0 else found + width


def _nested_comment_end(text: str, start: int) -> int:
    depth = 0
    for mark in _COMMENT_MARK.finditer(text, start):
        depth += 1 if mark.group() == "/*" else -1
        if depth == 0:
            return mark.end()
    return len(text)


def _prefixed_quote_end(dialect: str, text: str, word: re.Match[str]) -> int | None:
    """The end of the `E'...'` (PostgreSQL) or `q'X...X'` (Oracle) a word opens, else None."""
    prefix = (dialect, word.group().lower()) if text.startswith("'", word.end()) else None
    if prefix == ("postgresql", "e"):
        return _region_end(_SINGLE_ESCAPED, text, word.end())
    if prefix in _Q_PREFIXES:
        opening = text[word.end() + 1 : word.end() + 2]
        closing = _Q_CLOSE.get(opening, opening) + "'"
        return _found_end(text, text.find(closing, word.end() + 2), len(closing))
    return None


def _token(dialect: str, text: str, start: int) -> tuple[str, int]:
    """The kind and end of the token that starts at `start`."""
    pair = text[start : start + 2]
    char = text[start]
    if pair == "--" or (char == "#" and dialect == "mysql"):
        return COMMENT, _found_end(text, text.find("\n", start), 0)
    if pair == "/*":
        if dialect == "postgresql":
            return COMMENT, _nested_comment_end(text, start)
        return COMMENT, _found_end(text, text.find("*/", start + 2), 2)
    region = _REGIONS.get((dialect, char)) or _REGIONS.get(("*", char))
    if region is not None:
        return QUOTED, _region_end(region, text, start)
    tag = _DOLLAR_TAG.match(text, start) if dialect == "postgresql" else None
    if tag is not None:
        return QUOTED, _found_end(text, text.find(tag.group(), tag.end()), len(tag.group()))
    space = _SPACE.match(text, start)
    if space is not None:
        return SPACE, space.end()
    word = _WORD.match(text, start)
    if word is None:
        return OTHER, start + 1
    quoted_end = _prefixed_quote_end(dialect, text, word)
    return (WORD, word.end()) if quoted_end is None else (QUOTED, quoted_end)


def lex(dialect: str, text: str) -> Iterator[tuple[str, int, int]]:
    """Each token of one statement as (kind, start, end)."""
    position = 0
    while position < len(text):
        kind, end = _token(dialect, text, position)
        yield kind, position, end
        position = end


def _mode(dialect: str, text: str, start: int) -> str:
    """Whether the statement starting at `start` is an Oracle block or a SQLite trigger."""
    if dialect == "oracle" and _PLSQL_HEAD.match(text, start):
        return _BLOCK
    if dialect == "sqlite" and _TRIGGER_HEAD.match(text, start):
        return _TRIGGER
    return _PLAIN


class _Splitter:
    """One pass over a script, closing a piece at each separator the dialect knows."""

    def __init__(self, dialect: str, text: str) -> None:
        self.dialect = dialect
        self.text = text
        self.statements: list[Statement] = []
        self.delimiter = ";"
        self._lines = 1
        self._counted = 0
        self._line_start = 0
        self._open(0)

    def _open(self, start: int) -> None:
        self.start = start
        self.mode = ""
        self.trigger = _IN_BODY

    def _close(self, end: int) -> None:
        raw = self.text[self.start : end]
        if self.mode:
            first = self.start + len(raw) - len(raw.lstrip())
            self._lines += self.text.count("\n", self._counted, first)
            newline = self.text.rfind("\n", self._counted, first)
            self._line_start = max(self._line_start, newline + 1)
            self._counted = first
            column = first - self._line_start + 1
            self.statements.append(Statement(raw.strip(), self._lines, column, self.mode == _BLOCK))

    def _ends_here(self, kind: str, start: int, end: int) -> bool:
        """Whether this code token is the separator that closes the current statement."""
        semicolon = kind == OTHER and self.text[start] == ";" and self.delimiter == ";"
        if self.mode != _TRIGGER:
            return semicolon and self.dialect != "mssql" and self.mode != _BLOCK
        if semicolon:
            done = self.trigger == _AFTER_END
            self.trigger = _AFTER_SEMI
            return done
        closing = kind == WORD and self.text[start:end].upper() == "END"
        self.trigger = _AFTER_END if closing and self.trigger == _AFTER_SEMI else _IN_BODY
        return False

    def _separator_line(self, position: int) -> re.Match[str] | None:
        rule = _LINE_RULES.get(self.dialect)
        at_line_start = position == 0 or self.text[position - 1] == "\n"
        return rule.match(self.text, position) if rule and at_line_start else None

    def split(self) -> list[Statement]:
        text = self.text
        position = 0
        while position < len(text):
            line = self._separator_line(position)
            if line is not None:
                self._close(position)
                self.delimiter = line.group(1) if line.groups() else self.delimiter
                position = line.end()
                self._open(position)
                continue
            if self.delimiter != ";" and text.startswith(self.delimiter, position):
                self._close(position)
                position += len(self.delimiter)
                self._open(position)
                continue
            kind, end = _token(self.dialect, text, position)
            if kind in CODE and self._ends_here(kind, position, end):
                self._close(position)
                self._open(end)
            elif kind in CODE:
                self.mode = self.mode or _mode(self.dialect, text, position)
            position = end
        self._close(len(text))
        return self.statements


def split_script(dialect: str, text: str) -> list[Statement]:
    """The statements of a script in order; comment-only pieces are dropped."""
    return _Splitter(dialect, text).split()


def session_state_word(statement: str) -> str | None:
    """USE, SET or ALTER SESSION as written when the statement starts with one, else None."""
    lead = _LEADING_NOISE.match(statement)
    keyword = _SESSION_STATE.match(statement, lead.end() if lead else 0)
    return keyword.group() if keyword else None
