"""Suggestions at the cursor for DQL, Query DSL and aggregation JSON (REQ-3.3.2.5, OS-12, OS-13).

The answer names the character range the choice replaces (`from` / `to`, in characters) and
the items: fields from a done Get fields job, the DQL operators, and the keys and enum values of
the pinned API specification extract with their value kind and description.
"""

import re
from typing import Any

import pytest

from tests.api.services.opensearch_tools.test_api_spec import (
    AGG_FIELD,
    BOOST,
    EXTRACT,
    MATCH,
    PERCENTILES,
    WAVE_DESCRIPTIONS,
)
from wavecore.api.exceptions import UnprocessableEntityException, ValidationException
from wavecore.api.services import catalog_jobs
from wavecore.api.services.opensearch_tools import api_spec, check, suggest

MB = 1024 * 1024
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
FIELD_DATA = {"indexes": [{"name": "filebeat-*", "kind": "folded", "count": 412}], "fields": FIELDS}
OPERATORS = [
    {"label": word, "kind": "operator", "detail": "", "info": ""} for word in ("and", "or")
]


def exact(text: str) -> str:
    return rf"^{re.escape(text)}$"


def answer(
    language: str,
    text: str,
    cursor: int | None = None,
    *,
    template: bool = False,
    job: str | None = DONE_JOB,
) -> dict[str, Any]:
    """Suggestions for the text with the cursor at `cursor`, or at the end when it is None."""
    at = len(text) if cursor is None else cursor
    return suggest.suggest(language, text, at, template, job)


def inside(text: str, marker: str = '""') -> int:
    """The cursor between the quotes of the first `marker` in the text."""
    return text.index(marker) + 1


def field_items(*names: str) -> list[dict[str, Any]]:
    types = {field["name"]: field["types"] for field in FIELDS}
    return [
        {"label": name, "kind": "field", "detail": ", ".join(types[name]), "info": ""}
        for name in names
    ]


def all_field_items() -> list[dict[str, Any]]:
    return field_items(*(field["name"] for field in FIELDS))


def key_item(label: str, detail: str = "", info: str = "") -> dict[str, Any]:
    return {"label": label, "kind": "key", "detail": detail, "info": info}


def type_item(name: str) -> dict[str, Any]:
    """A query type as the root offers it: the spec's description, else WAVE's own."""
    own = WAVE_DESCRIPTIONS["queries"].get(name, "")
    return key_item(name, info=EXTRACT["queries"][name].get("description") or own)


def value_item(label: str) -> dict[str, Any]:
    return {"label": label, "kind": "value", "detail": "", "info": ""}


@pytest.fixture(autouse=True)
def fixture_spec(monkeypatch: pytest.MonkeyPatch) -> None:
    spec = api_spec.ApiSpec(EXTRACT, WAVE_DESCRIPTIONS)
    monkeypatch.setattr(api_spec, "load_extract", lambda: spec)
    monkeypatch.setattr(suggest, "load_extract", lambda: spec, raising=False)


@pytest.fixture(autouse=True)
def field_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """The done job DONE_JOB holds FIELDS; any other id answers no field list."""

    def result(job_id: str) -> dict[str, Any] | None:
        return FIELD_DATA if job_id == DONE_JOB else None

    monkeypatch.setattr(catalog_jobs, "result", result)
    monkeypatch.setattr(suggest, "result", result, raising=False)


class TestDqlFieldPositions:
    """Where a DQL field name goes, the loaded fields starting with the typed prefix."""

    def test_the_start_offers_the_fields_with_the_typed_prefix(self) -> None:
        assert answer("dql", "lo") == {
            "from": 0,
            "to": 2,
            "items": field_items("log.level", "log.logger"),
        }

    def test_an_empty_text_offers_every_field_in_list_order(self) -> None:
        assert answer("dql", "") == {"from": 0, "to": 0, "items": all_field_items()}

    @pytest.mark.parametrize(
        ("text", "prefix", "names"),
        [
            ("log.level: ERROR and (me", "me", ["message"]),
            ("log.level: ERROR and serv", "serv", ["service.name", "service.version"]),
            ("log.level: ERROR or lat", "lat", ["latency_ms"]),
            ("not ho", "ho", ["host.name"]),
            ("service.", "service.", ["service.name", "service.version"]),
            ("log.level: ERROR and\n@", "@", ["@timestamp"]),
        ],
    )
    def test_after_an_opening_or_an_operator_the_fields_are_offered(
        self, text: str, prefix: str, names: list[str]
    ) -> None:
        assert answer("dql", text) == {
            "from": len(text) - len(prefix),
            "to": len(text),
            "items": field_items(*names),
        }

    def test_a_field_of_several_types_joins_them_in_the_detail(self) -> None:
        assert answer("dql", "host")["items"] == [
            {"label": "host.name", "kind": "field", "detail": "keyword, text", "info": ""}
        ]

    @pytest.mark.parametrize("job", [None, "job-unknown"])
    def test_without_a_field_list_no_field_is_offered(self, job: str | None) -> None:
        assert answer("dql", "lo", job=job)["items"] == []


class TestDqlOperatorPositions:
    """After a complete expression and a space: and, or; never not, which needs and / or first."""

    @pytest.mark.parametrize(
        "text",
        [
            "log.level: ERROR ",
            'message: "Load test finished" ',
            "(log.level: ERROR or log.level: WARN) ",
        ],
    )
    def test_the_operators_are_offered(self, text: str) -> None:
        assert answer("dql", text) == {"from": len(text), "to": len(text), "items": OPERATORS}

    def test_the_operators_need_no_field_list(self) -> None:
        text = "log.level: ERROR "

        assert answer("dql", text, job=None)["items"] == OPERATORS


class TestDqlNoSuggestions:
    """A value position, inside quotes and inside {{ }}: nothing (the browser adds variables)."""

    @pytest.mark.parametrize(
        "text", ["log.level: ", "log.level: ERR", "latency_ms >= ", 'message: "Load te']
    )
    def test_a_value_position_offers_nothing(self, text: str) -> None:
        assert answer("dql", text)["items"] == []

    @pytest.mark.parametrize("text", ["log.level: {{ lv", "{{ se", "log.level: ERROR and {{ "])
    def test_inside_a_marker_nothing_is_offered(self, text: str) -> None:
        assert answer("dql", text, template=True)["items"] == []


class TestQueryDslKeys:
    """Where a Query DSL key goes, the keys the extract allows at that JSON path."""

    def test_the_root_offers_the_query_types_and_no_search_keys(self) -> None:
        text = '{""}'

        assert answer("query_dsl", text, inside(text)) == {
            "from": 2,
            "to": 2,
            "items": [type_item(name) for name in sorted(EXTRACT["queries"])],
        }

    def test_a_query_type_comes_with_its_description(self) -> None:
        text = '{"mat"}'

        assert answer("query_dsl", text, 5)["items"] == [
            key_item("match", info=MATCH),
            key_item("match_all", info="Matches every document."),
        ]

    def test_bool_comes_with_the_wave_description(self) -> None:
        text = '{"bo"}'

        assert answer("query_dsl", text, 4)["items"] == [
            key_item(
                "bool", info="Combines queries with must, should, must_not and filter clauses."
            )
        ]

    @pytest.mark.parametrize("text", ['{"match_all": {}, ""}', '{"match_all": []}, {""}', '}{""}'])
    def test_a_closed_container_hands_the_keys_back_to_the_one_around_it(self, text: str) -> None:
        cursor = text.rindex('""') + 1

        assert answer("query_dsl", text, cursor) == {
            "from": cursor,
            "to": cursor,
            "items": [type_item(name) for name in sorted(EXTRACT["queries"])],
        }

    def test_a_partial_key_is_replaced_between_its_quotes(self) -> None:
        text = '{"match_al"}'

        answered = answer("query_dsl", text, 4)

        assert (answered["from"], answered["to"]) == (2, 10)
        assert type_item("match_all") in answered["items"]

    def test_under_a_query_type_its_parameters_come_with_kind_and_description(self) -> None:
        text = '{"match_all": {""}}'

        assert answer("query_dsl", text, inside(text)) == {
            "from": inside(text),
            "to": inside(text),
            "items": [
                key_item("_name", "string", "Query name for query tagging."),
                key_item("boost", "number", BOOST),
            ],
        }

    def test_a_parameters_version_is_added_to_its_description(self) -> None:
        text = '{"term": {"log.level": {""}}}'

        assert answer("query_dsl", text, inside(text))["items"] == [
            key_item(
                "case_insensitive",
                "boolean",
                "Allows ASCII case insensitive matching of the value. Added in 2.19.",
            ),
            key_item("value", "any", "Term you wish to find in the provided field."),
        ]

    def test_under_a_field_keyed_query_the_fields_are_offered(self) -> None:
        text = '{"match": {""}}'

        assert answer("query_dsl", text, inside(text)) == {
            "from": inside(text),
            "to": inside(text),
            "items": all_field_items(),
        }

    def test_under_the_field_of_a_field_keyed_query_its_parameters_are_offered(self) -> None:
        text = '{"match": {"message": {""}}}'

        assert [item["label"] for item in answer("query_dsl", text, inside(text))["items"]] == [
            "analyzer",
            "fuzziness",
            "operator",
            "query",
        ]

    def test_the_value_of_field_offers_the_fields(self) -> None:
        text = '{"exists": {"field": ""}}'

        assert answer("query_dsl", text, inside(text)) == {
            "from": inside(text),
            "to": inside(text),
            "items": all_field_items(),
        }

    def test_a_partial_field_value_is_replaced_between_its_quotes(self) -> None:
        text = '{"exists": {"field": "lo"}}'
        start = text.index('"lo"') + 1

        answered = answer("query_dsl", text, start + 2)

        assert (answered["from"], answered["to"]) == (start, start + 2)
        assert field_items("log.level")[0] in answered["items"]

    def test_the_value_of_an_enum_key_offers_its_values(self) -> None:
        text = '{"match": {"message": {"operator": ""}}}'

        assert answer("query_dsl", text, inside(text)) == {
            "from": inside(text),
            "to": inside(text),
            "items": [value_item("and"), value_item("or")],
        }

    def test_without_a_field_list_no_field_is_offered(self) -> None:
        text = '{"match": {""}}'

        assert answer("query_dsl", text, inside(text), job=None)["items"] == []

    def test_inside_a_marker_nothing_is_offered(self) -> None:
        text = '{"term": {"log.level": {{ lv }}}}'

        assert answer("query_dsl", text, text.index("lv") + 2, template=True)["items"] == []


class TestAggregationKeys:
    """Rooted at an aggregation container: types, their parameters, fields at "field"."""

    def test_the_root_offers_the_aggregation_types(self) -> None:
        text = '{""}'

        assert answer("aggregation", text, inside(text))["items"] == [
            key_item("avg", info="Averages the values of a numeric field."),
            key_item("percentiles", info=PERCENTILES),
            key_item("terms"),
        ]

    def test_under_a_type_its_parameters_come_with_kind_and_description(self) -> None:
        text = '{"avg": {""}}'

        assert answer("aggregation", text, inside(text))["items"] == [
            key_item("field", "string", AGG_FIELD),
            key_item("format", "string", "The format to use for the result."),
            key_item(
                "missing",
                "any",
                "The value to apply to documents that have no value. Added in 2.19.",
            ),
        ]

    def test_the_value_of_field_offers_the_fields(self) -> None:
        text = '{"avg": {"field": ""}}'

        assert answer("aggregation", text, inside(text)) == {
            "from": inside(text),
            "to": inside(text),
            "items": all_field_items(),
        }


class TestRefusals:
    """An unknown language, a cursor outside the text and a text over 1 MB are refused."""

    def test_an_unknown_language_is_refused(self) -> None:
        with pytest.raises(
            ValidationException,
            match=exact("Unknown query language 'lucene': use dql, query_dsl or aggregation"),
        ):
            answer("lucene", "log.level: ERROR")

    @pytest.mark.parametrize(("text", "cursor"), [("lo", 3), ("lo", -1), ("", 1)])
    def test_a_cursor_outside_the_text_is_refused(self, text: str, cursor: int) -> None:
        with pytest.raises(
            ValidationException, match=exact(f"Cursor {cursor} is outside the text")
        ):
            answer("dql", text, cursor)

    def test_the_cursor_counts_characters_not_utf16_units(self) -> None:
        text = 'message: "\U0001f680" and lo'

        assert answer("dql", text, len(text)) == {
            "from": len(text) - 2,
            "to": len(text),
            "items": field_items("log.level", "log.logger"),
        }
        with pytest.raises(
            ValidationException, match=exact(f"Cursor {len(text) + 1} is outside the text")
        ):
            answer("dql", text, len(text) + 1)

    def test_the_size_cap_is_one_megabyte(self) -> None:
        assert suggest.MAX_QUERY_BYTES == MB

    def test_a_text_one_byte_over_the_cap_is_refused(self) -> None:
        with pytest.raises(UnprocessableEntityException, match=exact("Query exceeds 1 MB")):
            answer("dql", "x" * (MB + 1), 0)

    def test_the_cap_counts_utf8_bytes_not_characters(self) -> None:
        with pytest.raises(UnprocessableEntityException, match=exact("Query exceeds 1 MB")):
            answer("query_dsl", "é" * (MB // 2) + "x", 0)

    def test_a_text_of_exactly_the_cap_is_answered(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for module in (check, suggest):
            monkeypatch.setattr(module, "MAX_QUERY_BYTES", 16)
        text = "log.level: ERROR"

        assert answer("dql", text)["items"] == []
        with pytest.raises(UnprocessableEntityException, match=exact("Query exceeds 1 MB")):
            answer("dql", f"{text} ")


class TestDqlTemplateMarkers:
    """With template on, each complete {{ }} marker is masked in place before the cursor is read."""

    WIREFRAME = (
        'log.invalid:ERROR or (log.level:INFO and message:"Load test finished")\n'
        "and service.name:{{ svc }} and host.name:check\n"
        "and service."
    )

    @pytest.mark.parametrize(
        "text",
        [
            "service.name: {{ svc }} and service.",
            'service.name: "{{ svc }}" and service.',
            "service.name: {{ svc }}\nand service.",
            WIREFRAME,
        ],
    )
    def test_the_fields_are_offered_after_a_marker(self, text: str) -> None:
        assert answer("dql", text, template=True) == {
            "from": len(text) - len("service."),
            "to": len(text),
            "items": field_items("service.name", "service.version"),
        }

    def test_the_operators_are_offered_after_a_marker_and_a_space(self) -> None:
        text = "service.name: {{ svc }} "

        assert answer("dql", text, template=True) == {
            "from": len(text),
            "to": len(text),
            "items": OPERATORS,
        }

    @pytest.mark.parametrize("text", ["service.name: {{ se }}", "{{ se }}: checkout"])
    def test_inside_a_closed_marker_nothing_is_offered(self, text: str) -> None:
        cursor = text.index("se }}") + 2

        assert answer("dql", text, cursor, template=True) == {
            "from": cursor,
            "to": cursor,
            "items": [],
        }

    def test_without_template_a_marker_is_read_as_written(self) -> None:
        text = "service.name: {{ svc }} and service."

        assert answer("dql", text)["items"] == []
