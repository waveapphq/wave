# SPDX-License-Identifier: Apache-2.0
# Ported from OpenSearch Dashboards 3.8.0, Copyright OpenSearch Contributors and Elasticsearch B.V.
# Licensed under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
# Upstream: src/plugins/data/common/opensearch_query/kuery/ast/kuery.peg, kuery_syntax_error.ts
"""The `kuery.peg` grammar by hand, with PEG.js expectation reporting at the furthest failure."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import TypeVar

from ._nodes import And, Cursor, Is, Literal, NamedArg, Nested, Node, Not, Or, Range, Wildcard

CURSOR_SYMBOL = "@kuery-cursor@"
WILDCARD_SYMBOL = "@kuery-wildcard@"

_SPACE = " \t\r\n"
SPACE_CHARS = frozenset(_SPACE)
_SPECIAL = '\\():<>"*{}'
# What JavaScript's String.prototype.trim removes.
_JS_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)
_ESCAPED_WHITESPACE = {"\\t": "\t", "\\r": "\r", "\\n": "\n"}
_KEYWORDS = ("or", "and", "not")
_WORDS: dict[str, bool | None] = {"null": None, "true": True, "false": False}
# Dashboards' number test in two parts: the forms that take a sign, then the ones that do not.
_SIGNED_NUMBER = re.compile(r"-?(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9])", re.ASCII)
_UNSIGNED_NUMBER = re.compile(r"0(?:\.0)?|\.\d+", re.ASCII)
_RANGE_OPERATORS = (("<=", "lte"), (">=", "gte"), ("<", "lt"), (">", "gt"))
_TRANSLATIONS = {"fieldName": "field name"}

T = TypeVar("T")
U = TypeVar("U")
Partial = Callable[[Literal | Wildcard], Node]


class DqlSyntaxError(Exception):
    """DQL text that does not parse: Dashboards' short message and where the parse failed."""

    def __init__(self, message: str, offset: int, line: int, col: int) -> None:
        super().__init__(message)
        self.message = message
        self.offset = offset
        self.line = line
        self.col = col


def parse(text: str) -> Node:
    """The DQL text as a node tree."""
    return Parser(text).parse()


class Parser:
    """One parse; cursor mode reads a text that ends at `CURSOR_SYMBOL`, closing what is open."""

    def __init__(self, text: str, cursor: bool = False) -> None:
        self.text = text
        self.cursor = cursor
        self.pos = 0
        self.max_fail = 0
        self.expected: list[str] = []
        self.silent = 0
        self.trailing = False

    def parse(self) -> Node:
        node = self.start()
        if self.pos < len(self.text):
            self._fail("end of input")
            raise self._error()
        return node

    def start(self) -> Node:
        self._spaces()
        query = self._or_query()
        self._optional_space()
        if query is None:
            everything = Wildcard(("", ""), 0, 0)
            return Is(everything, everything, False)
        return query

    def _or_query(self) -> Node | None:
        return self._chain(self._and_query, self._or, _joined_nodes(Or))

    def _and_query(self) -> Node | None:
        return self._chain(self._not_query, self._and_joiner, _joined_nodes(And))

    def _and_joiner(self) -> bool:
        """AND; in cursor mode also a space before NOT, which the editor offers as an operator."""
        return self._and() or (self.cursor and self._space_before_not())

    def _space_before_not(self) -> bool:
        start = self.pos
        self._spaces()
        before_not = self.pos
        if self.text[self.pos - 1 : self.pos] in SPACE_CHARS and self._not():
            self.pos = before_not
            return True
        self.pos = start
        return False

    def _not_query(self) -> Node | None:
        start = self.pos
        if self._not():
            query = self._sub_query()
            if query is not None:
                return Not(query)
            self.pos = start
        return self._sub_query()

    def _sub_query(self) -> Node | None:
        return self._group("(", self._or_query, ")") or self._nested_query()

    def _nested_query(self) -> Node | None:
        start = self.pos
        path = self._field()
        if path is not None:
            self._spaces()
            if self._token(":"):
                self._spaces()
                query = self._group("{", self._or_query, "}")
                if query is not None:
                    return Nested(path, query)
        self.pos = start
        return self._field_range() or self._field_value() or self._value_expression()

    def _field_range(self) -> Node | None:
        start = self.pos
        field = self._field()
        if field is not None:
            self._spaces()
            operator = next((name for token, name in _RANGE_OPERATORS if self._token(token)), None)
            if operator is not None:
                self._spaces()
                value = self._literal("literal")
                if value is not None:
                    return Range(field, NamedArg(operator, value))
        self.pos = start
        return None

    def _field_value(self) -> Node | None:
        start = self.pos
        field = self._field()
        if field is not None:
            self._spaces()
            if self._token(":"):
                self._spaces()
                partial = self._list_of_values()
                if partial is not None:
                    return partial(field)
        self.pos = start
        return None

    def _value_expression(self) -> Node | None:
        start = self.pos
        partial = self._value()
        return None if partial is None else partial(Literal(None, start, start))

    def _list_of_values(self) -> Partial | None:
        return self._group("(", self._or_list, ")") or self._value()

    def _or_list(self) -> Partial | None:
        return self._chain(self._and_list, self._or, _joined_partials(Or))

    def _and_list(self) -> Partial | None:
        return self._chain(self._not_list, self._and, _joined_partials(And))

    def _not_list(self) -> Partial | None:
        start = self.pos
        if self._not():
            partial = self._list_of_values()
            if partial is not None:
                return lambda field: Not(partial(field))
            self.pos = start
        return self._list_of_values()

    def _value(self) -> Partial | None:
        """A value as the named rule `value`: a failure expects the name, not its parts."""
        self.silent += 1
        phrase = self._quoted_string()
        value = phrase or self._unquoted_literal()
        self.silent -= 1
        if value is None:
            self._fail("value")
            return None
        return lambda field: Is(field, value, phrase is not None)

    def _field(self) -> Literal | Wildcard | None:
        return self._literal("fieldName")

    def _literal(self, name: str) -> Literal | Wildcard | None:
        """A literal as the named rule `name`: a failure expects the name, not its parts."""
        self.silent += 1
        literal = self._quoted_string() or self._unquoted_literal()
        self.silent -= 1
        if literal is None:
            self._fail(name)
        return literal

    def _quoted_string(self) -> Literal | None:
        start = self.pos
        if not self._token('"'):
            return None
        chars = self._characters(self._quoted_character)
        if self._cursor():
            prefix = "".join(chars)
            return Cursor(prefix, start, self.pos - len(CURSOR_SYMBOL), prefix, True)
        if self._token('"'):
            return Literal("".join(chars), start, self.pos)
        self.pos = start
        return None

    def _quoted_character(self) -> str | None:
        escaped = self._escaped_whitespace()
        if escaped is not None:
            return escaped
        char = self.text[self.pos : self.pos + 1]
        following = self.text[self.pos + 1 : self.pos + 2]
        if char == "\\" and following and following in '\\"':
            self.pos += 2
            return following
        if not char or char == '"' or self._at_cursor():
            return None
        self.pos += 1
        return char

    def _unquoted_literal(self) -> Literal | Wildcard | None:
        start = self.pos
        chars = self._characters(self._unquoted_character)
        if self._cursor():
            prefix = "".join(chars).replace(WILDCARD_SYMBOL, "*")
            return Cursor(prefix, start, self.pos - len(CURSOR_SYMBOL), prefix, False)
        if not chars:
            return None
        end = start + len(self.text[start : self.pos].rstrip(_JS_WHITESPACE))
        sequence = "".join(chars).strip(_JS_WHITESPACE)
        if sequence in _WORDS:
            return Literal(_WORDS[sequence], start, end)
        if WILDCARD_SYMBOL in chars:
            return Wildcard(tuple(sequence.split(WILDCARD_SYMBOL)), start, end)
        if _SIGNED_NUMBER.fullmatch(sequence) or _UNSIGNED_NUMBER.fullmatch(sequence):
            return Literal(float(sequence) if "." in sequence else int(sequence), start, end)
        return Literal(sequence, start, end)

    def _unquoted_character(self) -> str | None:
        escaped = self._escaped_whitespace()
        if escaped is not None:
            return escaped
        char = self.text[self.pos : self.pos + 1]
        if char == "\\":
            following = self.text[self.pos + 1 : self.pos + 2]
            if following and following in _SPECIAL:
                self.pos += 2
                return following
            for keyword in _KEYWORDS:
                typed = self.text[self.pos + 1 : self.pos + 1 + len(keyword)]
                if typed.lower() == keyword:
                    self.pos += 1 + len(keyword)
                    return typed
        if char == "*":
            self.pos += 1
            return WILDCARD_SYMBOL
        if not char or char in _SPECIAL or self._at_keyword() or self._at_cursor():
            return None
        self.pos += 1
        return char

    def _escaped_whitespace(self) -> str | None:
        escaped = _ESCAPED_WHITESPACE.get(self.text[self.pos : self.pos + 2])
        if escaped is not None:
            self.pos += 2
        return escaped

    def _at_keyword(self) -> bool:
        start = self.pos
        self.silent += 1
        found = self._or() or self._and() or self._not()
        self.silent -= 1
        self.pos = start
        return found

    def _or(self) -> bool:
        return self._keyword("or", "OR", spaced=True)

    def _and(self) -> bool:
        return self._keyword("and", "AND", spaced=True)

    def _not(self) -> bool:
        return self._keyword("not", "NOT", spaced=False)

    def _keyword(self, word: str, name: str, spaced: bool) -> bool:
        """`Space+ word Space+` in any case (`word Space+` for NOT), a named rule."""
        start = self.pos
        self.silent += 1
        matched = (not spaced or bool(self._spaces())) and self._word(word) and bool(self._spaces())
        self.silent -= 1
        if matched:
            return True
        self.pos = start
        self._fail(name)
        return False

    def _word(self, word: str) -> bool:
        if self.text[self.pos : self.pos + len(word)].lower() != word:
            return False
        self.pos += len(word)
        return True

    def _optional_space(self) -> None:
        self._spaces()
        if self._cursor():
            self.trailing = True

    def _spaces(self) -> str:
        start = self.pos
        while self.pos < len(self.text) and self.text[self.pos] in _SPACE:
            self.pos += 1
        self._fail("whitespace")
        return self.text[start : self.pos]

    def _cursor(self) -> bool:
        if not self._at_cursor():
            return False
        self.pos += len(CURSOR_SYMBOL)
        return True

    def _at_cursor(self) -> bool:
        return self.cursor and self.text.startswith(CURSOR_SYMBOL, self.pos)

    def _group(self, opener: str, inner: Callable[[], T], closer: str) -> T | None:
        """`opener Space* inner OptionalSpace closer`."""
        start = self.pos
        if self._token(opener):
            self._spaces()
            result = inner()
            if result is not None:
                self._optional_space()
                if self._closer(closer):
                    return result
            self.pos = start
        return None

    def _closer(self, token: str) -> bool:
        """The token, or in cursor mode the end of the text, where the cursor closes it."""
        return self._token(token) or (self.cursor and self.pos == len(self.text))

    def _token(self, token: str) -> bool:
        if self.text.startswith(token, self.pos):
            self.pos += len(token)
            return True
        self._fail(f'"{token}"')
        return False

    def _characters(self, rule: Callable[[], str | None]) -> list[str]:
        chars = []
        while (char := rule()) is not None:
            chars.append(char)
        return chars

    def _chain(
        self,
        item: Callable[[], U | None],
        joiner: Callable[[], bool],
        join: Callable[[U, U], U],
    ) -> U | None:
        """`item (joiner item)*` nested to the right: the right-recursive grammar rule as a loop."""
        first = item()
        if first is None:
            return None
        items = [first]
        while True:
            start = self.pos
            following = item() if joiner() else None
            if following is None:
                self.pos = start
                break
            items.append(following)
        result = items[-1]
        for left in reversed(items[:-1]):
            result = join(left, result)
        return result

    def _fail(self, description: str) -> None:
        if self.silent or self.pos < self.max_fail:
            return
        if self.pos > self.max_fail:
            self.max_fail = self.pos
            self.expected = []
        self.expected.append(description)

    def _error(self) -> DqlSyntaxError:
        listed = ", ".join(_TRANSLATIONS.get(item, item) for item in sorted(set(self.expected)))
        found = (
            f'"{self.text[self.max_fail]}"' if self.max_fail < len(self.text) else "end of input"
        )
        line, col = _line_col(self.text, self.max_fail)
        return DqlSyntaxError(f"Expected {listed} but {found} found.", self.max_fail, line, col)


def _joined_nodes(kind: type[And] | type[Or]) -> Callable[[Node, Node], Node]:
    return lambda left, right: kind((left, right))


def _joined_partials(kind: type[And] | type[Or]) -> Callable[[Partial, Partial], Partial]:
    return lambda left, right: lambda field: kind((left(field), right(field)))


def _line_col(text: str, offset: int) -> tuple[int, int]:
    line, col, after_cr = 1, 1, False
    for char in text[:offset]:
        if char == "\n":
            line += 0 if after_cr else 1
            col, after_cr = 1, False
        elif char in "\r\u2028\u2029":
            line, col, after_cr = line + 1, 1, True
        else:
            col, after_cr = col + 1, False
    return line, col
