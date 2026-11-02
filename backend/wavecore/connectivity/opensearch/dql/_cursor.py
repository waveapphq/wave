# SPDX-License-Identifier: Apache-2.0
# Ported from OpenSearch Dashboards 3.8.0, Copyright OpenSearch Contributors and Elasticsearch B.V.
# Licensed under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
# Upstream: src/plugins/data/common/opensearch_query/kuery/ast/kuery.peg (the Cursor rule)
"""What fits at a DQL cursor offset: a field, a value, an operator or nothing (OS-12)."""

from dataclasses import dataclass

from ._nodes import Cursor, Node, leaves
from ._parser import CURSOR_SYMBOL, SPACE_CHARS, Parser


@dataclass(frozen=True)
class CursorContext:
    """`kind` is field, value, operator or none; `start` / `end` span the partial token."""

    kind: str
    prefix: str
    start: int
    end: int


def cursor_context(text: str, offset: int) -> CursorContext:
    """Read the text up to the offset with the grammar's cursor rule; the text after is ignored."""
    before = text[:offset]
    after_space = before[-1:] in SPACE_CHARS
    if _inside_marker(before):
        return CursorContext("none", "", offset, offset)
    parser = Parser(before + CURSOR_SYMBOL, cursor=True)
    found = _cursor_leaf(parser.start())
    if found is None:
        kind = "operator" if parser.trailing and after_space else "none"
        return CursorContext(kind, "", offset, offset)
    slot, leaf = found
    if not leaf.quoted and leaf.start < offset and after_space:
        return CursorContext("operator", "", offset, offset)
    kind = "field" if slot == "free" and not leaf.quoted else "value"
    return CursorContext(kind, leaf.prefix, leaf.start, leaf.end)


def _inside_marker(before: str) -> bool:
    opening = before.rfind("{{")
    return opening >= 0 and "}}" not in before[opening:]


def _cursor_leaf(tree: Node) -> tuple[str, Cursor] | None:
    for slot, leaf, _path in leaves(tree):
        if isinstance(leaf, Cursor):
            return slot, leaf
    return None
