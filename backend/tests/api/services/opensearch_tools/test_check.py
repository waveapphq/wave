"""The editor's while-typing check for DQL, Query DSL and aggregation JSON (REQ-3.3.2.5, OS-12).

Findings are advisory warnings: 1-based line and column, a length of at least 1, all counted in
characters, sorted by line then column. Unknown fields are found only against the field
list of a done Get fields job; the vocabulary comes from the pinned API specification extract.
"""

import re
from typing import Any

import pytest

from tests.api.services.opensearch_tools.test_api_spec import EXTRACT, WAVE_DESCRIPTIONS
from wavecore.api.exceptions import UnprocessableEntityException, ValidationException
from wavecore.api.services import catalog_jobs
from wavecore.api.services.opensearch_tools import api_spec, check
from wavecore.connectivity.opensearch import _json_text, dql

MB = 1024 * 1024
INDEX = "filebeat-*"
DONE_JOB = "job-done"
FIELDS = [
    {"name": "@timestamp", "types": ["date"], "aggregatable": True},
    {"name": "host.name", "types": ["keyword", "text"], "aggregatable": False},
    {"name": "latency_ms", "types": ["long"], "aggregatable": True},
    {"name": "log.level", "types": ["keyword"], "aggregatable": True},
    {"name": "log.logger", "types": ["keyword"], "aggregatable": True},
    {"name": "message", "types": ["text"], "aggregatable": False},
    {"name": "service.name", "types": ["keyword"], "aggregatable": True},
    {"name": "service.version", "types": ["keyword"], "aggregatable": True},
]
FIELD_DATA = {"indexes": [{"name": INDEX, "kind": "folded", "count": 412}], "fields": FIELDS}
FIELD_NAMED_QUERIES = ["geo_bounding_box", "geo_distance", "geo_polygon", "geo_shape", "xy_shape"]
BOOST_PARAM = {"description": "Relevance score multiplier.", "kind": "number"}
# The small extract plus geo queries, a geo aggregation, and bool clauses of any kind as packaged.
WIDE_EXTRACT: dict[str, Any] = {
    **EXTRACT,
    "aggregations": {
        **EXTRACT["aggregations"],
        "geo_distance": {
            "params": {
                "field": {"description": "The geo point field.", "kind": "string"},
                "origin": {"description": "The point distances are measured from.", "kind": "any"},
                "ranges": {"description": "The distance buckets.", "kind": "array"},
            }
        },
    },
    "queries": {
        **EXTRACT["queries"],
        **{name: {"params": {"boost": BOOST_PARAM}} for name in FIELD_NAMED_QUERIES},
        "bool": {
            "params": {
                clause: {**entry, "kind": "any"}
                for clause, entry in EXTRACT["queries"]["bool"]["params"].items()
            }
        },
        "geo_distance": {
            "params": {
                "boost": BOOST_PARAM,
                "distance": {"description": "The radius around the point.", "kind": "string"},
                "distance_type": {
                    "description": "How the distance is computed.",
                    "enum": ["arc", "plane"],
                    "kind": "string",
                },
            }
        },
    },
}
END_OF_FIELD = 'Expected "(", "{", value, whitespace but end of input found.'
END_OF_LIST = 'Expected ")", AND, OR, whitespace but end of input found.'


def exact(text: str) -> str:
    return rf"^{re.escape(text)}$"


def issues(
    language: str,
    text: str,
    *,
    template: bool = False,
    job: str | None = DONE_JOB,
    index: str = INDEX,
) -> list[dict[str, Any]]:
    return check.check(language, text, template, job, index)


def span(text: str, token: str, occurrence: int = 1) -> dict[str, int]:
    """The 1-based line and column of the token's n-th appearance in the text, and its length."""
    offset = -1
    for _ in range(occurrence):
        offset = text.index(token, offset + 1)
    line_start = text.rfind("\n", 0, offset) + 1
    return {
        "line": text.count("\n", 0, offset) + 1,
        "col": offset - line_start + 1,
        "length": len(token),
    }


def finding(text: str, token: str, message: str, occurrence: int = 1) -> dict[str, Any]:
    return {**span(text, token, occurrence), "message": message}


def unknown(text: str, name: str, index: str = INDEX) -> dict[str, Any]:
    """The unknown-field finding over the field name itself."""
    where = f" in {index}" if index else ""
    return finding(text, name, f"Unknown field {name}{where}")


def json_syntax(text: str) -> dict[str, Any]:
    """The JSON reader's own finding for the text, as the check relays it."""
    with pytest.raises(_json_text.JsonTextError) as raised:
        _json_text.parse(text)
    error = raised.value
    return {"line": error.line, "col": error.col, "length": 1, "message": error.message}


def dql_syntax(text: str) -> dict[str, Any]:
    """The DQL parser's own finding for the text, as the check relays it."""
    with pytest.raises(dql.DqlSyntaxError) as raised:
        dql.parse(text)
    error = raised.value
    return {"line": error.line, "col": error.col, "length": 1, "message": error.message}


@pytest.fixture(autouse=True)
def fixture_spec(monkeypatch: pytest.MonkeyPatch) -> None:
    spec = api_spec.ApiSpec(EXTRACT, WAVE_DESCRIPTIONS)
    monkeypatch.setattr(api_spec, "load_extract", lambda: spec)
    monkeypatch.setattr(check, "load_extract", lambda: spec, raising=False)


@pytest.fixture
def field_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """The done job DONE_JOB holds FIELDS; any other id answers no field list."""

    def result(job_id: str) -> dict[str, Any] | None:
        return FIELD_DATA if job_id == DONE_JOB else None

    monkeypatch.setattr(catalog_jobs, "result", result)
    monkeypatch.setattr(check, "result", result, raising=False)


@pytest.fixture
def wide_spec(monkeypatch: pytest.MonkeyPatch) -> None:
    """The check reads WIDE_EXTRACT in place of the small extract."""
    spec = api_spec.ApiSpec(WIDE_EXTRACT, WAVE_DESCRIPTIONS)
    monkeypatch.setattr(api_spec, "load_extract", lambda: spec)


@pytest.mark.usefixtures("field_list")
class TestDqlSyntax:
    """A DQL line that does not parse gets Dashboards' own text at the failure offset."""

    def test_a_missing_value_is_found_at_the_end_of_input(self) -> None:
        assert issues("dql", "log.level:") == [
            {"line": 1, "col": 11, "length": 1, "message": END_OF_FIELD}
        ]

    def test_an_unclosed_list_is_found_at_the_end_of_input(self) -> None:
        assert issues("dql", "log.level: (ERROR") == [
            {"line": 1, "col": 18, "length": 1, "message": END_OF_LIST}
        ]

    def test_a_failure_on_a_later_line_is_placed_on_that_line(self) -> None:
        assert issues("dql", "service.name: checkout and\nlog.level:") == [
            {"line": 2, "col": 11, "length": 1, "message": END_OF_FIELD}
        ]

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "ERROR",
            '"Batch complete"',
            'log.level: ERROR and not message: "Load test finished"',
            "log.level: (ERROR or WARN)",
            "latency_ms >= 500",
            '@timestamp < "2026-09-25T10:00:00Z"',
            "service.*: checkout",
            "_id: abc",
        ],
    )
    def test_a_valid_line_of_known_fields_has_no_findings(self, text: str) -> None:
        assert issues("dql", text) == []


@pytest.mark.usefixtures("field_list")
class TestDqlUnknownFields:
    """A field the loaded field list does not know is underlined over its name."""

    def test_an_unknown_field_names_the_index_pattern(self) -> None:
        text = "log.invalid: ERROR"

        assert issues("dql", text) == [
            {
                "line": 1,
                "col": 1,
                "length": 11,
                "message": "Unknown field log.invalid in filebeat-*",
            }
        ]

    def test_a_blank_index_pattern_leaves_the_index_out(self) -> None:
        assert issues("dql", "log.invalid: ERROR", index="") == [
            {"line": 1, "col": 1, "length": 11, "message": "Unknown field log.invalid"}
        ]

    @pytest.mark.parametrize(
        ("text", "name"),
        [
            ("service.name: checkout and log.invalid: ERROR", "log.invalid"),
            ("service.name: checkout\nand log.invalid: ERROR", "log.invalid"),
            ("latncy_ms >= 500", "latncy_ms"),
            ("trace.id: *", "trace.id"),
            ("invalid.*: checkout", "invalid.*"),
            ("not (hots.name: web-1)", "hots.name"),
        ],
    )
    def test_each_unknown_field_is_underlined_where_it_stands(self, text: str, name: str) -> None:
        assert issues("dql", text) == [unknown(text, name)]

    def test_two_unknown_fields_come_in_text_order(self) -> None:
        text = "log.invalid: ERROR or\nhots.name: web-1"

        assert issues("dql", text) == [unknown(text, "log.invalid"), unknown(text, "hots.name")]

    def test_columns_count_characters_not_utf16_units(self) -> None:
        text = 'message: "\U0001f680 launch" and log.invalid: ERROR'

        assert issues("dql", text) == [
            {
                "line": 1,
                "col": 25,
                "length": 11,
                "message": "Unknown field log.invalid in filebeat-*",
            }
        ]


@pytest.mark.usefixtures("field_list")
class TestJsonSyntax:
    """Query DSL and aggregation text that does not parse gets the JSON reader's message."""

    def test_a_missing_comma_is_found_at_the_next_member(self) -> None:
        text = '{\n  "match_all": {}\n  "exists": {"field": "message"}\n}'

        assert issues("query_dsl", text) == [
            {"line": 3, "col": 3, "length": 1, "message": "Expected , or }"}
        ]

    def test_a_key_without_a_colon_is_found_at_the_value(self) -> None:
        text = '{"avg": {"field" "latency_ms"}}'

        assert issues("aggregation", text) == [
            {**span(text, '"latency_ms"'), "length": 1, "message": "Expected :"}
        ]

    @pytest.mark.parametrize("language", ["query_dsl", "aggregation"])
    def test_a_duplicate_key_is_relayed_from_the_json_reader(self, language: str) -> None:
        text = '{"terms": {"field": "log.level", "field": "host.name"}}'
        expected = json_syntax(text)

        assert expected["message"] == 'Duplicate key "field"'
        assert issues(language, text) == [expected]

    def test_comments_are_allowed_as_opensearch_allows_them(self) -> None:
        text = '// errors only\n{"match_all": {}} /* every document */'

        assert issues("query_dsl", text) == []


@pytest.mark.usefixtures("field_list")
class TestQueryDslVocabulary:
    """Query types, their parameters, value kinds and enums come from the extract."""

    def test_an_unknown_query_type_is_underlined_over_its_key(self) -> None:
        text = '{"matchall": {}}'

        assert issues("query_dsl", text) == [
            {"line": 1, "col": 2, "length": 10, "message": '"matchall" is not a query type'}
        ]

    @pytest.mark.parametrize(
        ("text", "key", "message"),
        [
            (
                '{"match": {"message": {"query": "x", "operatr": "and"}}}',
                '"operatr"',
                '"operatr" is not a parameter of match',
            ),
            (
                '{"exists": {"invalid_param": "message"}}',
                '"invalid_param"',
                '"invalid_param" is not a parameter of exists',
            ),
            (
                '{"range": {"latency_ms": {"gtee": 500}}}',
                '"gtee"',
                '"gtee" is not a parameter of range',
            ),
        ],
    )
    def test_an_unknown_parameter_is_underlined_over_its_key(
        self, text: str, key: str, message: str
    ) -> None:
        assert issues("query_dsl", text) == [finding(text, key, message)]

    @pytest.mark.parametrize(
        ("text", "value", "message"),
        [
            ('{"range": {"latency_ms": {"gte": "abc"}}}', '"abc"', "gte takes a number, not text"),
            ('{"match_all": {"boost": true}}', "true", "boost takes a number, not true or false"),
            ('{"exists": {"field": 5}}', "5", "field takes text, not a number"),
            (
                '{"term": {"log.level": {"value": "ERROR", "case_insensitive": "yes"}}}',
                '"yes"',
                "case_insensitive takes true or false, not text",
            ),
            (
                '{"multi_match": {"query": "x", "fields": "message"}}',
                '"message"',
                "fields takes a list, not text",
            ),
            ('{"match_all": {"_name": ["a"]}}', '["a"]', "_name takes text, not a list"),
            ('{"match_all": {"_name": {"a": 1}}}', '{"a": 1}', "_name takes text, not an object"),
        ],
    )
    def test_a_value_of_the_wrong_kind_is_underlined_over_the_value(
        self, text: str, value: str, message: str
    ) -> None:
        assert issues("query_dsl", text) == [finding(text, value, message)]

    @pytest.mark.parametrize(
        ("text", "value", "message"),
        [
            (
                '{"match": {"message": {"query": "x", "operator": "xor"}}}',
                '"xor"',
                "operator takes one of: and, or",
            ),
            (
                '{"multi_match": {"query": "x", "fields": ["message"], "type": "cross"}}',
                '"cross"',
                "type takes one of: best_fields, most_fields, phrase",
            ),
        ],
    )
    def test_a_value_outside_its_enum_is_underlined_over_the_value(
        self, text: str, value: str, message: str
    ) -> None:
        assert issues("query_dsl", text) == [finding(text, value, message)]

    @pytest.mark.parametrize(
        "text",
        [
            '{"match": {"message": "Load test finished"}}',
            '{"match": {"message": {"query": "x", "operator": "and"}}}',
            '{"match": {"message": {"query": 5}}}',
            '{"term": {"log.level": "ERROR"}}',
            '{"term": {"log.level": {"value": true, "case_insensitive": false}}}',
            '{"range": {"latency_ms": {"gte": 500, "lt": 900}}}',
            '{"exists": {"field": "host.name"}}',
            '{"bool": {"filter": [{"term": {"log.level": "ERROR"}}]}}',
            '{"multi_match": {"query": "x", "fields": ["message^2", "log.level"]}}',
        ],
    )
    def test_a_query_the_extract_allows_has_no_findings(self, text: str) -> None:
        assert issues("query_dsl", text) == []


@pytest.mark.usefixtures("field_list")
class TestQueryDslUnknownFields:
    """Fields named by a Query DSL query are checked against the field list."""

    @pytest.mark.parametrize(
        "text",
        [
            '{"term": {"log.invalid": "ERROR"}}',
            '{"match": {"log.invalid": {"query": "ERROR"}}}',
            '{"exists": {"field": "log.invalid"}}',
            '{"multi_match": {"query": "x", "fields": ["message^2", "log.invalid^3"]}}',
            '{"bool": {"filter": [{"term": {"log.invalid": "ERROR"}}]}}',
        ],
    )
    def test_an_unknown_field_is_underlined_over_its_name(self, text: str) -> None:
        assert issues("query_dsl", text) == [unknown(text, "log.invalid")]

    def test_a_blank_index_pattern_leaves_the_index_out(self) -> None:
        text = '{"term": {"log.invalid": "ERROR"}}'

        assert issues("query_dsl", text, index="") == [unknown(text, "log.invalid", index="")]


@pytest.mark.usefixtures("field_list", "wide_spec")
class TestBoolClauses:
    """Each query inside a bool clause is checked as a query at the root is."""

    @pytest.mark.parametrize("clause", ["filter", "must", "must_not", "should"])
    def test_an_unknown_query_type_in_a_clause_list_is_underlined(self, clause: str) -> None:
        queries = '[{"term": {"log.level": "ERROR"}}, {"matchall": {}}]'
        text = f'{{"bool": {{"{clause}": {queries}}}}}'

        assert issues("query_dsl", text) == [
            finding(text, '"matchall"', '"matchall" is not a query type')
        ]

    def test_a_clause_holding_one_query_is_checked_too(self) -> None:
        text = '{"bool": {"must": {"matchall": {}}}}'

        assert issues("query_dsl", text) == [
            finding(text, '"matchall"', '"matchall" is not a query type')
        ]

    @pytest.mark.parametrize(
        ("text", "token", "message"),
        [
            (
                '{"bool": {"should": [{"match": {"message": {"query": "x", "operatr": "and"}}}]}}',
                '"operatr"',
                '"operatr" is not a parameter of match',
            ),
            (
                '{"bool": {"must_not": [{"exists": {"field": 5}}]}}',
                "5",
                "field takes text, not a number",
            ),
            (
                '{"bool": {"filter": {"match": {"message": {"query": "x", "operator": "xor"}}}}}',
                '"xor"',
                "operator takes one of: and, or",
            ),
            (
                '{"bool": {"filter": [{"range": {"latency_ms": {"gtee": 500}}}]}}',
                '"gtee"',
                '"gtee" is not a parameter of range',
            ),
        ],
    )
    def test_the_parameters_of_a_query_in_a_clause_are_checked(
        self, text: str, token: str, message: str
    ) -> None:
        assert issues("query_dsl", text) == [finding(text, token, message)]

    def test_a_bool_inside_a_clause_is_checked_in_turn(self) -> None:
        text = '{"bool": {"should": [{"bool": {"must_not": [{"matchall": {}}]}}]}}'

        assert issues("query_dsl", text) == [
            finding(text, '"matchall"', '"matchall" is not a query type')
        ]

    def test_findings_in_several_clauses_come_in_text_order(self) -> None:
        text = (
            '{"bool": {"must": [{"matchall": {}}],\n'
            '  "filter": [{"term": {"log.invalid": {"value": "x", "boots": 2}}}]}}'
        )

        assert issues("query_dsl", text) == [
            finding(text, '"matchall"', '"matchall" is not a query type'),
            unknown(text, "log.invalid"),
            finding(text, '"boots"', '"boots" is not a parameter of term'),
        ]

    @pytest.mark.parametrize(
        "text",
        [
            '{"bool": {"must": {"term": {"log.level": "ERROR"}}}}',
            '{"bool": {"should": [{"term": {"log.level": "ERROR"}}, '
            '{"term": {"log.level": "WARN"}}], "minimum_should_match": 1}}',
            '{"bool": {"filter": [{"bool": {"must_not": [{"exists": {"field": "message"}}]}}]}}',
            '{"bool": {"filter": [{"geo_distance": {"distance": "12km", '
            '"pin.location": {"lat": 40, "lon": -70}}}]}}',
        ],
    )
    def test_clauses_of_known_queries_have_no_findings(self, text: str) -> None:
        assert issues("query_dsl", text) == []


@pytest.mark.usefixtures("field_list", "wide_spec")
class TestGeoQueries:
    """A geo query names its field as a key beside its parameters; that key is no parameter."""

    @pytest.mark.parametrize("name", FIELD_NAMED_QUERIES)
    def test_the_field_key_is_not_flagged(self, name: str) -> None:
        text = f'{{"{name}": {{"pin.location": {{"lat": 40, "lon": -70}}, "boost": 2}}}}'

        assert issues("query_dsl", text) == []

    @pytest.mark.parametrize("name", FIELD_NAMED_QUERIES)
    def test_the_parameters_beside_the_field_are_still_checked(self, name: str) -> None:
        text = f'{{"{name}": {{"pin.location": {{"lat": 40, "lon": -70}}, "boost": "high"}}}}'

        assert issues("query_dsl", text) == [
            finding(text, '"high"', "boost takes a number, not text")
        ]

    def test_an_enum_parameter_beside_the_field_is_checked(self) -> None:
        text = (
            '{"geo_distance": {"distance": "12km", "distance_type": "flat", "pin": "drm3btev3e86"}}'
        )

        assert issues("query_dsl", text) == [
            finding(text, '"flat"', "distance_type takes one of: arc, plane")
        ]

    def test_a_geo_aggregation_still_flags_an_unknown_parameter(self) -> None:
        text = '{"geo_distance": {"field": "host.name", "origin": "52, 4", "radius": 5}}'

        assert issues("aggregation", text) == [
            finding(text, '"radius"', '"radius" is not a parameter of geo_distance')
        ]


@pytest.mark.usefixtures("field_list")
class TestAggregation:
    """An aggregation is checked from its container: types, parameters, kinds and fields."""

    def test_an_unknown_aggregation_type_is_underlined_over_its_key(self) -> None:
        text = '{"median": {"field": "latency_ms"}}'

        assert issues("aggregation", text) == [
            finding(text, '"median"', '"median" is not an aggregation type')
        ]

    def test_an_unknown_parameter_is_underlined_over_its_key(self) -> None:
        text = '{"avg": {"invalid_param": "latency_ms"}}'

        assert issues("aggregation", text) == [
            finding(text, '"invalid_param"', '"invalid_param" is not a parameter of avg')
        ]

    @pytest.mark.parametrize(
        ("text", "value", "message"),
        [
            (
                '{"percentiles": {"field": "latency_ms", "percents": 95}}',
                "95",
                "percents takes a list, not a number",
            ),
            (
                '{"terms": {"field": "host.name", "order": []}}',
                "[]",
                "order takes an object, not a list",
            ),
        ],
    )
    def test_a_value_of_the_wrong_kind_is_underlined_over_the_value(
        self, text: str, value: str, message: str
    ) -> None:
        assert issues("aggregation", text) == [finding(text, value, message)]

    def test_an_unknown_field_is_underlined_over_its_name(self) -> None:
        text = '{"avg": {"field": "latncy_ms"}}'

        assert issues("aggregation", text) == [unknown(text, "latncy_ms")]

    @pytest.mark.parametrize(
        "text",
        [
            '{"avg": {"field": "latency_ms"}}',
            '{"percentiles": {"field": "latency_ms", "percents": [95, 99]}}',
            '{"terms": {"field": "host.name", "size": 5}}',
        ],
    )
    def test_an_aggregation_the_extract_allows_has_no_findings(self, text: str) -> None:
        assert issues("aggregation", text) == []

    def test_query_types_are_not_aggregation_types(self) -> None:
        text = '{"match_all": {}}'

        assert issues("aggregation", text) == [
            finding(text, '"match_all"', '"match_all" is not an aggregation type')
        ]


@pytest.mark.usefixtures("field_list")
class TestTemplateMasking:
    """With template on, each {{ }} marker is masked in place before the check."""

    @pytest.mark.parametrize(
        "text", ["log.level: {{ lvl }}", 'message: "{{ phrase }}"', "log.level: {{ a }} or WARN"]
    )
    def test_markers_in_dql_raise_no_findings(self, text: str) -> None:
        assert issues("dql", text, template=True) == []

    def test_a_dql_marker_keeps_the_positions_after_it(self) -> None:
        text = "log.level: {{ lvl }} and log.invalid: WARN"

        assert issues("dql", text, template=True) == [unknown(text, "log.invalid")]

    def test_without_template_a_dql_marker_is_checked_as_written(self) -> None:
        text = "log.level: {{ lvl }}"

        assert issues("dql", text) == [dql_syntax(text)]

    @pytest.mark.parametrize(
        "text",
        [
            '{"range": {"latency_ms": {"gte": {{ limit }}}}}',
            '{"exists": {"field": {{ name }}}}',
            '{"match": {"message": {"query": "x", "operator": {{ op }}}}}',
            '{"term": {"log.level": "{{ lvl }}"}}',
            '{"term": {"log.level": {{ lvl }}}}',
        ],
    )
    def test_markers_in_query_dsl_raise_no_findings(self, text: str) -> None:
        assert issues("query_dsl", text, template=True) == []

    def test_a_json_marker_keeps_the_positions_after_it(self) -> None:
        text = '{"range": {"latency_ms": {"gte": {{ limit }}, "gtee": 1}}}'

        assert issues("query_dsl", text, template=True) == [
            finding(text, '"gtee"', '"gtee" is not a parameter of range')
        ]

    def test_without_template_a_json_marker_is_checked_as_written(self) -> None:
        text = '{"range": {"latency_ms": {"gte": {{ limit }}}}}'

        assert issues("query_dsl", text) == [
            {**span(text, "{ limit"), "length": 1, "message": "Expected a string key"}
        ]


class TestFieldListSkipped:
    """Without a done job's field list the unknown-field findings are skipped, nothing else."""

    @pytest.fixture(autouse=True)
    def jobs(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            catalog_jobs,
            "_JOBS",
            {
                "job-connecting": catalog_jobs.Job("job-connecting", None),
                "job-reading": catalog_jobs.Job("job-reading", None, status="reading"),
                "job-failed": catalog_jobs.Job(
                    "job-failed", None, status="failed", error="Could not connect"
                ),
                "job-canceled": catalog_jobs.Job("job-canceled", None, status="canceled"),
                DONE_JOB: catalog_jobs.Job(DONE_JOB, None, status="done", data=FIELD_DATA),
            },
        )

    def test_a_done_job_supplies_the_field_list(self) -> None:
        text = "log.invalid: ERROR"

        assert issues("dql", text) == [unknown(text, "log.invalid")]

    @pytest.mark.parametrize(
        "job", [None, "job-unknown", "job-connecting", "job-reading", "job-failed", "job-canceled"]
    )
    @pytest.mark.parametrize(
        ("language", "text"),
        [
            ("dql", "log.invalid: ERROR"),
            ("query_dsl", '{"term": {"log.invalid": "ERROR"}}'),
            ("aggregation", '{"avg": {"field": "log.invalid"}}'),
        ],
    )
    def test_no_field_list_skips_the_unknown_field_findings(
        self, job: str | None, language: str, text: str
    ) -> None:
        assert issues(language, text, job=job) == []

    @pytest.mark.parametrize("job", [None, "job-unknown", "job-failed"])
    def test_no_field_list_keeps_the_other_findings(self, job: str | None) -> None:
        text = '{"matchall": {}}'

        assert issues("query_dsl", text, job=job) == [
            finding(text, '"matchall"', '"matchall" is not a query type')
        ]


@pytest.mark.usefixtures("field_list")
class TestOrderAndPositions:
    """Findings are sorted by line then column, in characters."""

    def test_findings_are_sorted_by_line_then_column(self) -> None:
        text = (
            '{"match": {"log.invalid": {"query": "x", "operator": "xor",\n' '  "operatr": "and"}}}'
        )

        assert issues("query_dsl", text) == [
            unknown(text, "log.invalid"),
            finding(text, '"xor"', "operator takes one of: and, or"),
            finding(text, '"operatr"', '"operatr" is not a parameter of match'),
        ]

    def test_json_columns_count_characters_not_utf16_units(self) -> None:
        text = '{"match": {"message": {"query": "\U0001f680", "operatr": "and"}}}'

        assert issues("query_dsl", text) == [
            {
                "line": 1,
                "col": 38,
                "length": 9,
                "message": '"operatr" is not a parameter of match',
            }
        ]


class TestRefusals:
    """An unknown language and a text over 1 MB are refused before any check."""

    def test_an_unknown_language_is_refused(self) -> None:
        with pytest.raises(
            ValidationException,
            match=exact("Unknown query language 'lucene': use dql, query_dsl or aggregation"),
        ):
            issues("lucene", "log.level: ERROR")

    def test_the_size_cap_is_one_megabyte(self) -> None:
        assert check.MAX_QUERY_BYTES == MB

    def test_a_text_one_byte_over_the_cap_is_refused(self) -> None:
        with pytest.raises(UnprocessableEntityException, match=exact("Query exceeds 1 MB")):
            issues("dql", "x" * (MB + 1))

    def test_the_cap_counts_utf8_bytes_not_characters(self) -> None:
        with pytest.raises(UnprocessableEntityException, match=exact("Query exceeds 1 MB")):
            issues("query_dsl", "é" * (MB // 2) + "x")

    @pytest.mark.usefixtures("field_list")
    def test_a_text_of_exactly_the_cap_is_checked(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(check, "MAX_QUERY_BYTES", 16)
        text = "log.level: ERROR"

        assert issues("dql", text) == []
        with pytest.raises(UnprocessableEntityException, match=exact("Query exceeds 1 MB")):
            issues("dql", f"{text} ")
