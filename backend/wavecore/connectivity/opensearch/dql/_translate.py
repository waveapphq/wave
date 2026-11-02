# SPDX-License-Identifier: Apache-2.0
# Ported from OpenSearch Dashboards 3.8.0, Copyright OpenSearch Contributors and Elasticsearch B.V.
# Licensed under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
# Upstream: src/plugins/data/common/opensearch_query/kuery/functions/ (is, and, or, not, range,
# nested, utils/get_fields) and node_types/wildcard.ts
"""DQL node tree to Query DSL by Dashboards' rules, date fields in the UTC time zone (OS-5)."""

import re
from typing import Any

from .._fields import FieldInfo, FieldList, wildcard_pattern
from ._nodes import (
    And,
    Is,
    Literal,
    Nested,
    Node,
    Not,
    Or,
    Range,
    Wildcard,
    full_name,
    is_free_text,
)

_DATE_TYPES = frozenset({"date", "date_nanos"})
_UTC = {"time_zone": "UTC"}
# Dashboards' escapeQueryString class, its `+-=` range spelled out: it escapes the digits too.
_QUERY_STRING_SPECIAL = re.compile(r'[+,\-./\d:;<=>&|!(){}[\]^"~*?\\]', re.ASCII)


def to_query(node: Node, fields: FieldList) -> dict[str, Any]:
    """The Query DSL for the tree, field names looked up in the field list."""
    return _translate(node, fields, "")


def _translate(node: Node, fields: FieldList, nested: str) -> dict[str, Any]:
    if isinstance(node, And):
        return {"bool": {"filter": [_translate(child, fields, nested) for child in node.children]}}
    if isinstance(node, Or):
        return _should([_translate(child, fields, nested) for child in node.children])
    if isinstance(node, Not):
        return {"bool": {"must_not": _translate(node.child, fields, nested)}}
    if isinstance(node, Nested):
        path = full_name(nested, node.path.text())
        query = _translate(node.child, fields, path)
        return {"nested": {"path": path, "query": query, "score_mode": "none"}}
    if isinstance(node, Range):
        return _range(node, fields, nested)
    return _is(node, fields, nested)


def _is(node: Is, fields: FieldList, nested: str) -> dict[str, Any]:
    value = _query_value(node.value)
    if is_free_text(node.field):
        if isinstance(node.value, Wildcard):
            return {"query_string": {"query": _query_string(node.value)}}
        kind = "phrase" if node.phrase else "best_fields"
        return {"multi_match": {"type": kind, "query": value, "lenient": True}}
    parts = _field_parts(node.field, nested)
    exists = isinstance(node.value, Wildcard) and value == "*"
    if exists and parts == ("", ""):
        return {"match_all": {}}
    matching = _matching(parts, fields)
    return _should([_field_query(node, value, exists, name, info) for name, info in matching])


def _field_query(
    node: Is, value: Any, exists: bool, name: str, info: FieldInfo | None
) -> dict[str, Any]:
    """The query for one matching field."""
    if exists:
        return {"exists": {"field": name}}
    if isinstance(node.value, Wildcard):
        return {"query_string": {"fields": [name], "query": _query_string(node.value)}}
    if _is_date(info):
        return {"range": {name: {"gte": value, "lte": value, **_UTC}}}
    return {"match_phrase" if node.phrase else "match": {name: value}}


def _range(node: Range, fields: FieldList, nested: str) -> dict[str, Any]:
    bound = {node.bound.name: _query_value(node.bound.value)}
    matching = _matching(_field_parts(node.field, nested), fields)
    return _should(
        [
            {"range": {name: {**bound, **(_UTC if _is_date(info) else {})}}}
            for name, info in matching
        ]
    )


def _should(queries: list[dict[str, Any]]) -> dict[str, Any]:
    return {"bool": {"should": queries, "minimum_should_match": 1}}


def _query_value(leaf: Literal | Wildcard) -> Any:
    return leaf.text() if isinstance(leaf, Wildcard) else leaf.value


def _field_parts(field: Literal | Wildcard, nested: str) -> tuple[str, ...]:
    """The field name as the texts between its wildcards, under the nested path."""
    parts = field.parts if isinstance(field, Wildcard) else (field.text(),)
    return (full_name(nested, parts[0]), *parts[1:])


def _matching(parts: tuple[str, ...], fields: FieldList) -> list[tuple[str, FieldInfo | None]]:
    """The listed fields the name matches, in list order; none sends the name as written."""
    pattern = wildcard_pattern(parts)
    found: list[tuple[str, FieldInfo | None]] = [
        (name, info) for name, info in fields.fields.items() if pattern.fullmatch(name)
    ]
    return found or [("*".join(parts), None)]


def _is_date(info: FieldInfo | None) -> bool:
    return info is not None and all(kind in _DATE_TYPES for kind in info.types)


def _query_string(value: Wildcard) -> str:
    return "*".join(_escape_query_string(part) for part in value.parts)


def _escape_query_string(text: str) -> str:
    return _QUERY_STRING_SPECIAL.sub(r"\\\g<0>", text)
