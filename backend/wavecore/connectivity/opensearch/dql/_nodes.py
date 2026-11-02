# SPDX-License-Identifier: Apache-2.0
# Ported from OpenSearch Dashboards 3.8.0, Copyright OpenSearch Contributors and Elasticsearch B.V.
# Licensed under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
# Upstream: src/plugins/data/common/opensearch_query/kuery/node_types/
"""DQL node types: functions (is, and, or, not, range, nested), literals, wildcards, named args."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass

LiteralValue = str | int | float | bool | None


@dataclass(frozen=True)
class Literal:
    """A literal and its span in the text; `None` where a field goes means free text."""

    value: LiteralValue
    start: int
    end: int

    def text(self) -> str:
        return self.value if isinstance(self.value, str) else json.dumps(self.value)


@dataclass(frozen=True)
class Wildcard:
    """A literal with `*` wildcards, held as the texts between them."""

    parts: tuple[str, ...]
    start: int
    end: int

    def text(self) -> str:
        return "*".join(self.parts)


@dataclass(frozen=True)
class Cursor(Literal):
    """The literal the cursor stands in, read in cursor mode only."""

    prefix: str
    quoted: bool


@dataclass(frozen=True)
class NamedArg:
    name: str
    value: Literal | Wildcard


@dataclass(frozen=True)
class Is:
    field: Literal | Wildcard
    value: Literal | Wildcard
    phrase: bool


@dataclass(frozen=True)
class Range:
    field: Literal | Wildcard
    bound: NamedArg


@dataclass(frozen=True)
class And:
    children: tuple[Node, ...]


@dataclass(frozen=True)
class Or:
    children: tuple[Node, ...]


@dataclass(frozen=True)
class Not:
    child: Node


@dataclass(frozen=True)
class Nested:
    path: Literal | Wildcard
    child: Node


Node = Is | Range | And | Or | Not | Nested


def is_free_text(field: Literal | Wildcard) -> bool:
    return isinstance(field, Literal) and field.value is None


def full_name(path: str, name: str) -> str:
    """A field name under the enclosing nested paths."""
    return f"{path}.{name}" if path else name


def leaves(node: Node, path: str = "") -> Iterator[tuple[str, Literal | Wildcard, str]]:
    """Each literal in text order with its slot (`field`, `free` or `value`) and nested path."""
    if isinstance(node, And | Or):
        for child in node.children:
            yield from leaves(child, path)
    elif isinstance(node, Not):
        yield from leaves(node.child, path)
    elif isinstance(node, Nested):
        yield "field", node.path, path
        yield from leaves(node.child, full_name(path, node.path.text()))
    elif isinstance(node, Range):
        yield "field", node.field, path
        yield "value", node.bound.value, path
    elif is_free_text(node.field):
        yield "free", node.value, path
    else:
        yield "field", node.field, path
        yield "value", node.value, path


def field_spans(node: Node) -> list[tuple[str, int, int]]:
    """Each field the query names, with nested paths joined, and its span in the text."""
    spans = [
        (full_name(path, leaf.text()), leaf.start, leaf.end)
        for slot, leaf, path in leaves(node)
        if slot == "field"
    ]
    return list(dict.fromkeys(spans))


def field_names(node: Node) -> list[str]:
    """The fields the query names, once each, in order of first mention."""
    return list(dict.fromkeys(name for name, _start, _end in field_spans(node)))
