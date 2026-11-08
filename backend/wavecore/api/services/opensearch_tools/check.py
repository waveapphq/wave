"""The OpenSearch editor's while-typing check for DQL, Query DSL and aggregation JSON (OS-12).

Findings are advisory: 1-based line and column and a length, all counted in characters.
"""

from collections.abc import Collection, Iterable, Iterator
from typing import Any

from wavecore.api.exceptions import UnprocessableEntityException, ValidationException
from wavecore.api.services import catalog_jobs
from wavecore.api.services.opensearch_tools import api_spec
from wavecore.api.services.opensearch_tools.api_spec import ApiSpec, Param
from wavecore.connectivity.opensearch import dql
from wavecore.connectivity.opensearch._aggregate import _COMPANIONS
from wavecore.connectivity.opensearch._fields import FieldInfo, FieldList
from wavecore.connectivity.opensearch._json_text import JsonNode, JsonTextError, parse
from wavecore.connectivity.opensearch._query import _QUERY_OPTIONS
from wavecore.core.expressions.template import _TEMPLATE_PATTERN
from wavecore.core.expressions.template_escape import mask_markers

MAX_QUERY_BYTES = 1024 * 1024
_MASK_RULES = {"dql": "dql", "query_dsl": "json", "aggregation": "json"}
_TYPE_NOUNS = {"query_dsl": "a query type", "aggregation": "an aggregation type"}
_KIND_WORDS = {
    "string": "text",
    "number": "a number",
    "boolean": "true or false",
    "object": "an object",
    "array": "a list",
}
# The parameters of compound queries that hold whole queries, one or a list of them.
_QUERY_PARAMS = {
    "bool": frozenset({"filter", "must", "must_not", "should"}),
    "boosting": frozenset({"negative", "positive"}),
    "constant_score": frozenset({"filter"}),
    "dis_max": frozenset({"queries"}),
    "function_score": frozenset({"query"}),
    "has_child": frozenset({"query"}),
    "has_parent": frozenset({"query"}),
    "nested": frozenset({"query"}),
    "script_score": frozenset({"query"}),
}
# Queries that name their field as a key beside their own parameters.
_FIELD_NAMED_QUERIES = frozenset(
    {"geo_bounding_box", "geo_distance", "geo_polygon", "geo_shape", "xy_shape"}
)

# A finding before it is placed: start and end offsets in characters, and its message.
Span = tuple[int, int, str]


def refuse_unreadable(language: str, text: str, limit: int) -> None:
    """Refuse an unknown language and a text over the size cap."""
    if language not in _MASK_RULES:
        raise ValidationException(
            f"Unknown query language '{language}': use dql, query_dsl or aggregation"
        )
    if len(text.encode("utf-8")) > limit:
        raise UnprocessableEntityException("Query exceeds 1 MB")


def field_list(fields_job_id: str | None) -> list[dict[str, Any]] | None:
    """The fields a done Get fields job pulled; None without one."""
    data = catalog_jobs.result(fields_job_id) if fields_job_id else None
    return None if data is None else data["fields"]


def check(
    language: str, text: str, template: bool, fields_job_id: str | None, index: str
) -> list[dict[str, Any]]:
    """The text's findings sorted by line then column; template markers are masked in place."""
    refuse_unreadable(language, text, MAX_QUERY_BYTES)
    fields = field_list(fields_job_id)
    known = None if fields is None else FieldList([], {f["name"]: _info(f) for f in fields})
    source = mask_markers(text, _MASK_RULES[language], _TEMPLATE_PATTERN) if template else text
    where = f" in {index}" if index else ""
    try:
        spans = (
            _dql(source, known, where)
            if language == "dql"
            else _json(language, source, known, where)
        )
    except (dql.DqlSyntaxError, JsonTextError) as error:
        return [{"line": error.line, "col": error.col, "length": 1, "message": error.message}]
    masks = [marker.span() for marker in _TEMPLATE_PATTERN.finditer(text)] if template else []
    issues = [_placed(text, span) for span in spans if not _masked(span, masks)]
    return sorted(issues, key=lambda issue: (issue["line"], issue["col"]))


def _info(field: dict[str, Any]) -> FieldInfo:
    return FieldInfo(types=field["types"], aggregatable=field["aggregatable"])


def _dql(source: str, known: FieldList | None, where: str) -> list[Span]:
    tree = dql.parse(source)
    return [] if known is None else _unknown(dql.field_spans(tree), known, where)


def _unknown(named: Iterable[tuple[str, int, int]], known: FieldList, where: str) -> list[Span]:
    return [
        (start, end, f"Unknown field {name}{where}")
        for name, start, end in named
        if not known.known(name)
    ]


def _json(language: str, source: str, known: FieldList | None, where: str) -> list[Span]:
    # A blank Query DSL is no filter, as a run reads it.
    root = parse(source if language == "aggregation" or source.strip() else "{}")
    spec = api_spec.load_extract()
    spans = _vocabulary(spec, language, root)
    if known is not None:
        keyed = spec.field_keyed_queries if language == "query_dsl" else frozenset()
        spans += _unknown(_json_fields(keyed, root), known, where)
    return spans


def _vocabulary(spec: ApiSpec, language: str, root: JsonNode) -> list[Span]:
    """Types and their parameters, at the root and inside compound queries: names, kinds, enums."""
    types = set(spec.keys_at(language, []))
    spans: list[Span] = []
    # Sub-aggregations and meta may sit beside the one aggregation, as a run allows.
    beside = _COMPANIONS if language == "aggregation" else ()
    for name, node in [member for member in _members(root) if member[0] not in beside]:
        if name not in types:
            start, end = root.keys[name]
            spans.append((start, end, f'"{name}" is not {_TYPE_NOUNS[language]}'))
        elif language == "query_dsl" and name in spec.field_keyed_queries:
            for field, options in _members(node):
                spans += _params(spec, language, [name, field], options)
        else:
            spans += _params(spec, language, [name], node)
            if language == "query_dsl":
                spans += _held_queries(spec, name, node)
    return spans


def _held_queries(spec: ApiSpec, name: str, node: JsonNode) -> list[Span]:
    """Each query a compound query holds, a parameter holding one query or a list of them."""
    held = _QUERY_PARAMS.get(name, frozenset())
    return [
        span
        for key, value in _members(node)
        if key in held
        for query in ([value] if value.kind == "object" else _children(value))
        for span in _vocabulary(spec, "query_dsl", query)
    ]


def _members(node: JsonNode) -> list[tuple[str, JsonNode]]:
    """An object's members; any other value has none."""
    return list(node.value.items()) if node.kind == "object" else []


def _children(node: JsonNode) -> list[JsonNode]:
    """The values an object or an array holds."""
    return [value for _key, value in _members(node)] if node.kind != "array" else node.value


def _params(spec: ApiSpec, language: str, path: list[str], node: JsonNode) -> list[Span]:
    spans: list[Span] = []
    field_named = language == "query_dsl" and path[0] in _FIELD_NAMED_QUERIES
    for key, value in _members(node):
        param = spec.param(language, path, key)
        if param is not None:
            spans += _value_problem(key, param, value)
        elif not field_named:
            start, end = node.keys[key]
            spans.append((start, end, f'"{key}" is not a parameter of {path[0]}'))
    return spans


def _value_problem(key: str, param: Param, value: JsonNode) -> list[Span]:
    """A value of the wrong kind, or text outside the parameter's enum values."""
    if param.kind in ("any", value.kind) or value.kind == "null":
        wrong = param.enum and value.kind == "string" and value.value not in param.enum
        message = f"{key} takes one of: {', '.join(param.enum)}" if wrong else ""
    else:
        message = f"{key} takes {_KIND_WORDS[param.kind]}, not {_KIND_WORDS[value.kind]}"
    return [(value.start, value.end, message)] if message else []


def _json_fields(keyed: Collection[str], node: JsonNode) -> Iterator[tuple[str, int, int]]:
    """Field names as a run reads them: under field-keyed queries, in `field` and `fields`."""
    for key, value in _members(node):
        if key in keyed:
            yield from _key_names(value)
        if key == "field" and value.kind == "string":
            yield _name(value)
        if key == "fields" and value.kind == "array":
            yield from (_name(entry) for entry in value.value if entry.kind == "string")
    for child in _children(node):
        yield from _json_fields(keyed, child)


def _key_names(node: JsonNode) -> Iterator[tuple[str, int, int]]:
    """The keys under a field-keyed query, but for the query's own options."""
    for name, (start, _end) in node.keys.items():
        if name not in _QUERY_OPTIONS:
            yield name, start + 1, start + 1 + len(name)


def _name(node: JsonNode) -> tuple[str, int, int]:
    """A field named in a JSON string, over the name inside the quotes and without `^boost`."""
    name = str(node.value).partition("^")[0]
    return name, node.start + 1, node.start + 1 + len(name)


def _masked(span: Span, masks: list[tuple[int, int]]) -> bool:
    start, end, _message = span
    return any(first < end and start < last for first, last in masks)


def _placed(text: str, span: Span) -> dict[str, Any]:
    start, end, message = span
    line_start = text.rfind("\n", 0, start) + 1
    return {
        "line": text.count("\n", 0, start) + 1,
        "col": start - line_start + 1,
        "length": max(end - start, 1),
        "message": message,
    }
