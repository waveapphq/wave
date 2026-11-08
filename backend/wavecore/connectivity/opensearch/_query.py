"""The author query in both languages and the final query with the time range (REQ-3.3.2.6)."""

from dataclasses import dataclass, field
from typing import Any

from . import dql
from ._errors import VALIDATION, OpenSearchFailure, kind_of
from ._fields import FieldList
from ._json_text import JsonTextError, loads
from ._time import Window

# Query types whose object is keyed by the field name (OS-9); equals the API spec extract's list.
FIELD_KEYED_QUERIES = frozenset(
    {
        "common",
        "fuzzy",
        "intervals",
        "knn",
        "match",
        "match_bool_prefix",
        "match_phrase",
        "match_phrase_prefix",
        "neural",
        "neural_sparse",
        "prefix",
        "range",
        "regexp",
        "span_term",
        "term",
        "terms",
        "terms_set",
        "wildcard",
    }
)
# The options a field-keyed query object may hold beside its field (the terms query's).
_QUERY_OPTIONS = frozenset({"_name", "boost", "value_type"})
# Queries that name their field as a key beside their parameters; equals the extract's params.
FIELD_NAMED_QUERIES = {
    "geo_bounding_box": frozenset(
        {"_name", "boost", "ignore_unmapped", "type", "validation_method"}
    ),
    "geo_distance": frozenset(
        {
            "_name",
            "boost",
            "distance",
            "distance_type",
            "ignore_unmapped",
            "unit",
            "validation_method",
        }
    ),
    "geo_polygon": frozenset({"_name", "boost", "ignore_unmapped", "validation_method"}),
    "geo_shape": frozenset({"_name", "boost", "ignore_unmapped"}),
    "xy_shape": frozenset({"_name", "boost", "ignore_unmapped"}),
}
# Top-level keys that mark a whole pasted search request rather than a query.
_REQUEST_KEYS = frozenset(
    {
        "query",
        "size",
        "from",
        "sort",
        "aggs",
        "aggregations",
        "_source",
        "fields",
        "docvalue_fields",
        "stored_fields",
        "track_total_hits",
        "track_scores",
        "timeout",
        "terminate_after",
        "post_filter",
        "highlight",
        "search_after",
        "pit",
        "min_score",
        "script_fields",
        "runtime_mappings",
        "collapse",
        "rescore",
        "explain",
        "version",
        "seq_no_primary_term",
        "indices_boost",
        "suggest",
        "profile",
        "stats",
        "ext",
    }
)
_NOT_AN_OBJECT = 'Query DSL must be a JSON object, such as {"term": {"log.level": "ERROR"}}'


@dataclass(frozen=True)
class AuthorQuery:
    """The Query row after its syntax check: a DQL tree or a Query DSL object, or no filter."""

    tree: Any = None
    dsl: dict[str, Any] | None = None
    notes: list[str] = field(default_factory=list)


def author_query(language: str, value: Any) -> AuthorQuery:
    """Check the Query row before connecting; a blank value is no filter."""
    if value is None or value == {} or (isinstance(value, str) and not value.strip()):
        return AuthorQuery()
    if language == "dql":
        return AuthorQuery(tree=_dql_tree(value))
    return _dsl_query(value)


def final_query(
    author: AuthorQuery, fields: FieldList, time_field: str, window: Window
) -> dict[str, Any]:
    """The time range as epoch milliseconds on the Time field, then the author query."""
    bounds = {"gte": window.from_ms, "lte": window.to_ms, "format": "epoch_millis"}
    filters: list[dict[str, Any]] = [{"range": {time_field: bounds}}]
    if author.tree is not None:
        filters.append(dql.to_query(author.tree, fields))
    if author.dsl:
        filters.append(author.dsl)
    return {"bool": {"filter": filters}}


def named_fields(author: AuthorQuery) -> list[str]:
    """The fields the query names, once each, in order of first mention."""
    names = [] if author.tree is None else dql.field_names(author.tree)
    _dsl_fields(author.dsl, names)
    return list(dict.fromkeys(names))


def _dql_tree(value: Any) -> Any:
    if not isinstance(value, str):
        raise OpenSearchFailure(
            f"Query is DQL, so the expression must give text; it gave {kind_of(value)}",
            VALIDATION,
        )
    try:
        return dql.parse(value)
    except dql.DqlSyntaxError as error:
        raise OpenSearchFailure(
            f"Query is not valid DQL at line {error.line}, column {error.col}: {error.message}",
            VALIDATION,
        ) from error


def _dsl_query(value: Any) -> AuthorQuery:
    if isinstance(value, str):
        try:
            value = loads(value)
        except JsonTextError as error:
            raise OpenSearchFailure(
                f"Query is not valid JSON at line {error.line}, column {error.col}: "
                f"{error.message}",
                VALIDATION,
            ) from error
    notes = []
    if isinstance(value, dict) and not _REQUEST_KEYS.isdisjoint(value):
        dropped = ", ".join(f'"{key}"' for key in value if key != "query")
        if dropped:
            notes.append(f'Query: kept only "query" from the pasted request; dropped {dropped}')
        value = value.get("query", {})
    if not isinstance(value, dict):
        raise OpenSearchFailure(_NOT_AN_OBJECT, VALIDATION)
    return AuthorQuery(dsl=value or None, notes=notes)


def _dsl_fields(node: Any, names: list[str]) -> None:
    """Field-keyed and field-named query keys, `field` values, `fields` entries without `^boost`."""
    if isinstance(node, list):
        for item in node:
            _dsl_fields(item, names)
    elif isinstance(node, dict):
        for key, value in node.items():
            names.extend(_key_fields(key, value))
            _dsl_fields(value, names)


def _key_fields(key: str, value: Any) -> list[str]:
    """The fields one key names directly: a field-keyed or field-named query, `field`, `fields`."""
    options = _QUERY_OPTIONS if key in FIELD_KEYED_QUERIES else FIELD_NAMED_QUERIES.get(key)
    if options is not None and isinstance(value, dict):
        return [name for name in value if name not in options]
    if key == "field" and isinstance(value, str):
        return [value]
    if key == "fields" and isinstance(value, list):
        return [entry.partition("^")[0] for entry in value if isinstance(entry, str)]
    return []
