"""The pinned OpenSearch API specification extract and its lookups (REQ-3.3.2.5, OS-12).

The Query DSL and aggregation vocabulary of the editor's check and suggestions comes from a trimmed
extract of opensearch-project/opensearch-api-specification, packaged inside wavecore and loaded
once through importlib.resources.
"""

import json
import re
from importlib import resources
from typing import Any

import pytest

from wavecore.api.services.opensearch_tools import api_spec
from wavecore.connectivity.opensearch._query import FIELD_KEYED_QUERIES, FIELD_NAMED_QUERIES

PACKAGE = "wavecore.api.services.opensearch_tools"
EXTRACT_FILE = "api-spec-extract.json"
WAVE_FILE = "wave-type-descriptions.json"
KINDS = {"string", "number", "boolean", "object", "array", "any"}
BOOST = "Floating point number used to decrease or increase the relevance scores of the query."
FIND = "Text, number, boolean value or date you wish to find in the provided field."
AGG_FIELD = "The field on which to run the aggregation."
MATCH = (
    "Returns documents that match a provided text, number, date or Boolean value. "
    "The provided text is analyzed before matching."
)
PERCENTILES = "Returns the percentiles of the values of a numeric field."

# The small extract the check and suggestion tests run on, in the packaged file's shape.
EXTRACT: dict[str, Any] = {
    "aggregations": {
        "avg": {
            "params": {
                "field": {"description": AGG_FIELD, "kind": "string"},
                "format": {"description": "The format to use for the result.", "kind": "string"},
                "missing": {
                    "description": "The value to apply to documents that have no value.",
                    "kind": "any",
                    "version_added": "2.19",
                },
            }
        },
        "percentiles": {
            "description": PERCENTILES,
            "params": {
                "field": {"description": AGG_FIELD, "kind": "string"},
                "keyed": {"description": "Return the values as a map.", "kind": "boolean"},
                "percents": {"description": "The percentiles to calculate.", "kind": "array"},
            },
        },
        "terms": {
            "params": {
                "field": {"description": AGG_FIELD, "kind": "string"},
                "order": {"description": "The order of the buckets.", "kind": "object"},
                "size": {"description": "The number of buckets returned.", "kind": "number"},
            }
        },
    },
    "field_keyed_queries": ["match", "range", "term"],
    "queries": {
        "bool": {
            "params": {
                "filter": {"description": "Queries that must match.", "kind": "array"},
                "minimum_should_match": {"description": "Should clauses to match.", "kind": "any"},
                "must": {"description": "Queries that must match and score.", "kind": "array"},
                "must_not": {"description": "Queries that must not match.", "kind": "array"},
                "should": {"description": "Queries that should match.", "kind": "array"},
            }
        },
        "exists": {
            "params": {
                "field": {"description": "Name of the field you wish to search.", "kind": "string"}
            }
        },
        "match": {
            "description": MATCH,
            "params": {
                "analyzer": {"description": "Analyzer used for the query value.", "kind": "string"},
                "fuzziness": {"description": "Maximum edit distance allowed.", "kind": "any"},
                "operator": {
                    "description": "Boolean logic used to interpret text in the query value.",
                    "enum": ["and", "or"],
                    "kind": "string",
                },
                "query": {"description": FIND, "kind": "any"},
            },
        },
        "match_all": {
            "params": {
                "_name": {"description": "Query name for query tagging.", "kind": "string"},
                "boost": {"description": BOOST, "kind": "number"},
            }
        },
        "multi_match": {
            "params": {
                "fields": {"description": "The fields to be queried.", "kind": "array"},
                "query": {"description": FIND, "kind": "string"},
                "type": {
                    "description": "How the query is executed.",
                    "enum": ["best_fields", "most_fields", "phrase"],
                    "kind": "string",
                },
            }
        },
        "range": {
            "params": {
                "format": {"description": "Date format used in the query.", "kind": "string"},
                "gte": {"description": "Greater than or equal to.", "kind": "number"},
                "lt": {"description": "Less than.", "kind": "number"},
                "relation": {
                    "description": "How the range matches range fields.",
                    "enum": ["intersects", "contains", "within"],
                    "kind": "string",
                },
            }
        },
        "term": {
            "params": {
                "case_insensitive": {
                    "description": "Allows ASCII case insensitive matching of the value.",
                    "kind": "boolean",
                    "version_added": "2.19",
                },
                "value": {
                    "description": "Term you wish to find in the provided field.",
                    "kind": "any",
                },
            }
        },
    },
    "source": {
        "commit": "0123456789abcdef0123456789abcdef01234567",
        "generated": "2026-09-26",
        "repository": "opensearch-project/opensearch-api-specification",
    },
}


# WAVE's own type descriptions, in the packaged file's shape; `match` shows the spec's text wins.
WAVE_DESCRIPTIONS: dict[str, dict[str, str]] = {
    "aggregations": {"avg": "Averages the values of a numeric field."},
    "queries": {
        "bool": "Combines queries with must, should, must_not and filter clauses.",
        "match": "Never shown: the specification describes match.",
        "match_all": "Matches every document.",
    },
}


def packaged_text(name: str = EXTRACT_FILE) -> str:
    return resources.files(PACKAGE).joinpath(name).read_text(encoding="utf-8")


def keys_in_order(node: Any) -> bool:
    """Whether every object in the JSON value lists its keys sorted."""
    if isinstance(node, dict):
        return list(node) == sorted(node) and all(keys_in_order(v) for v in node.values())
    if isinstance(node, list):
        return all(keys_in_order(item) for item in node)
    return True


@pytest.fixture
def spec() -> Any:
    return api_spec.ApiSpec(EXTRACT, WAVE_DESCRIPTIONS)


class TestKeysAt:
    """keys_at: the keys allowed at a JSON path, sorted."""

    def test_the_query_root_allows_the_query_types(self, spec: Any) -> None:
        assert spec.keys_at("query_dsl", []) == sorted(EXTRACT["queries"])

    def test_the_aggregation_root_allows_the_aggregation_types(self, spec: Any) -> None:
        assert spec.keys_at("aggregation", []) == ["avg", "percentiles", "terms"]

    def test_under_a_query_type_its_parameters_are_allowed(self, spec: Any) -> None:
        assert spec.keys_at("query_dsl", ["match_all"]) == ["_name", "boost"]

    def test_under_an_aggregation_type_its_parameters_are_allowed(self, spec: Any) -> None:
        assert spec.keys_at("aggregation", ["avg"]) == ["field", "format", "missing"]

    def test_a_field_keyed_query_takes_its_parameters_under_the_field(self, spec: Any) -> None:
        assert spec.keys_at("query_dsl", ["match", "message"]) == [
            "analyzer",
            "fuzziness",
            "operator",
            "query",
        ]

    def test_directly_under_a_field_keyed_query_no_spec_key_is_allowed(self, spec: Any) -> None:
        assert spec.keys_at("query_dsl", ["match"]) == []

    @pytest.mark.parametrize(
        ("language", "path"),
        [
            ("query_dsl", ["matchall"]),
            ("query_dsl", ["exists", "field"]),
            ("query_dsl", ["match", "message", "operator"]),
            ("aggregation", ["median"]),
            ("aggregation", ["avg", "field"]),
        ],
    )
    def test_a_path_that_holds_no_spec_object_allows_no_keys(
        self, spec: Any, language: str, path: list[str]
    ) -> None:
        assert spec.keys_at(language, path) == []


class TestParam:
    """param: a key's value kind, enum values, description and version."""

    def test_a_parameter_answers_its_kind_and_description(self, spec: Any) -> None:
        param = spec.param("query_dsl", ["match_all"], "boost")

        assert (param.kind, list(param.enum)) == ("number", [])
        assert (param.description, param.version_added) == (BOOST, "")

    def test_an_enum_parameter_answers_its_values_in_spec_order(self, spec: Any) -> None:
        param = spec.param("query_dsl", ["range", "latency_ms"], "relation")

        assert param.kind == "string"
        assert list(param.enum) == ["intersects", "contains", "within"]

    def test_a_parameter_answers_the_version_that_added_it(self, spec: Any) -> None:
        assert spec.param("query_dsl", ["term", "log.level"], "case_insensitive").version_added == (
            "2.19"
        )
        assert spec.param("aggregation", ["avg"], "missing").version_added == "2.19"

    def test_an_aggregation_parameter_answers_its_kind(self, spec: Any) -> None:
        assert spec.param("aggregation", ["percentiles"], "percents").kind == "array"

    @pytest.mark.parametrize(
        ("language", "path", "key"),
        [
            ("query_dsl", ["match", "message"], "operatr"),
            ("query_dsl", [], "match"),
            ("query_dsl", ["matchall"], "boost"),
            ("aggregation", ["avg"], "invalid_param"),
        ],
    )
    def test_a_key_the_spec_does_not_list_at_the_path_has_no_param(
        self, spec: Any, language: str, path: list[str], key: str
    ) -> None:
        assert spec.param(language, path, key) is None


class TestTypeDescription:
    """type_description: the specification's text, else WAVE's own, else nothing."""

    @pytest.mark.parametrize(
        ("language", "name", "description"),
        [
            ("query_dsl", "match", MATCH),
            ("aggregation", "percentiles", PERCENTILES),
            (
                "query_dsl",
                "bool",
                "Combines queries with must, should, must_not and filter clauses.",
            ),
            ("query_dsl", "match_all", "Matches every document."),
            ("aggregation", "avg", "Averages the values of a numeric field."),
            ("query_dsl", "range", ""),
            ("aggregation", "terms", ""),
            ("query_dsl", "matchall", ""),
        ],
    )
    def test_a_type_answers_its_description_or_nothing(
        self, spec: Any, language: str, name: str, description: str
    ) -> None:
        assert spec.type_description(language, name) == description


class TestFieldKeyedQueries:
    """The query types whose key under the type is a field name."""

    def test_the_field_keyed_queries_come_from_the_extract(self, spec: Any) -> None:
        assert set(spec.field_keyed_queries) == {"match", "range", "term"}

    def test_the_commit_comes_from_the_source(self, spec: Any) -> None:
        assert spec.commit == "0123456789abcdef0123456789abcdef01234567"


class TestPackagedExtract:
    """The installed package carries the pinned extract, loaded once."""

    def test_the_extract_is_a_file_of_the_installed_package(self) -> None:
        assert resources.files(PACKAGE).joinpath(EXTRACT_FILE).is_file()

    def test_the_extract_names_its_source_repository_and_commit(self) -> None:
        source = json.loads(packaged_text())["source"]

        assert source["repository"] == "opensearch-project/opensearch-api-specification"
        assert re.fullmatch(r"[0-9a-f]{40}", source["commit"]), source["commit"]
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", source["generated"]), source["generated"]

    def test_load_extract_answers_the_packaged_extract_once(self) -> None:
        loaded = api_spec.load_extract()

        assert isinstance(loaded, api_spec.ApiSpec)
        assert loaded is api_spec.load_extract()
        assert loaded.commit == json.loads(packaged_text())["source"]["commit"]

    def test_the_extract_keys_are_sorted(self) -> None:
        assert keys_in_order(json.loads(packaged_text()))

    def test_every_parameter_has_a_known_kind_and_text_fields(self) -> None:
        extract = json.loads(packaged_text())
        for family in ("queries", "aggregations"):
            for name, entry in extract[family].items():
                for key, param in entry["params"].items():
                    where = f"{family}.{name}.{key}"
                    assert param["kind"] in KINDS, where
                    assert all(isinstance(value, str) for value in param.get("enum", [])), where
                    assert isinstance(param.get("description", ""), str), where
                    assert isinstance(param.get("version_added", ""), str), where

    def test_every_type_description_is_one_line_of_text(self) -> None:
        extract = json.loads(packaged_text())
        for family in ("queries", "aggregations"):
            for name, entry in extract[family].items():
                description = entry.get("description", "")
                assert isinstance(description, str), f"{family}.{name}"
                assert description == " ".join(description.split()), f"{family}.{name}"

    def test_the_wave_descriptions_are_a_file_of_the_installed_package(self) -> None:
        assert resources.files(PACKAGE).joinpath(WAVE_FILE).is_file()

    def test_the_wave_descriptions_cover_exactly_the_types_the_spec_leaves_bare(self) -> None:
        extract = json.loads(packaged_text())
        own = json.loads(packaged_text(WAVE_FILE))

        assert list(own) == ["aggregations", "queries"]
        for family in ("queries", "aggregations"):
            bare = {name for name, entry in extract[family].items() if "description" not in entry}
            assert set(own[family]) == bare, family

    def test_every_wave_description_is_one_plain_sentence(self) -> None:
        own = json.loads(packaged_text(WAVE_FILE))

        assert keys_in_order(own)
        for family, descriptions in own.items():
            for name, text in descriptions.items():
                where = f"{family}.{name}"
                assert text == " ".join(text.split()) and text.endswith("."), where
                assert text[0].isupper() and ". " not in text, where
                assert not {"\u2014", "\u2013"} & set(text), where

    def test_every_type_has_a_description_after_the_merge(self) -> None:
        spec = api_spec.load_extract()

        for language in ("query_dsl", "aggregation"):
            bare = [
                name
                for name in spec.keys_at(language, [])
                if not spec.type_description(language, name)
            ]
            assert bare == [], language

    def test_the_wave_descriptions_fill_what_the_spec_leaves_bare(self) -> None:
        spec = api_spec.load_extract()

        assert spec.type_description("query_dsl", "match_all") == "Matches every document."
        assert spec.type_description("query_dsl", "bool") == (
            "Combines queries with must, should, must_not and filter clauses."
        )
        assert (
            spec.type_description("aggregation", "avg") == "Averages the values of a numeric field."
        )

    def test_the_match_family_carries_the_specifications_descriptions(self) -> None:
        spec = api_spec.load_extract()

        assert spec.type_description("query_dsl", "match") == MATCH
        assert spec.type_description("query_dsl", "match_phrase") == (
            "Analyzes the text and creates a phrase query out of the analyzed text."
        )

    def test_the_extract_holds_the_common_query_and_aggregation_types(self) -> None:
        extract = json.loads(packaged_text())

        assert {"bool", "exists", "match", "match_all", "range", "term", "terms"} <= set(
            extract["queries"]
        )
        assert {"avg", "max", "min", "percentiles", "sum", "terms"} <= set(extract["aggregations"])

    def test_the_run_cores_field_keyed_queries_equal_the_extracts(self) -> None:
        extract = json.loads(packaged_text())

        assert set(FIELD_KEYED_QUERIES) == set(extract["field_keyed_queries"])
        assert set(api_spec.load_extract().field_keyed_queries) == set(FIELD_KEYED_QUERIES)

    def test_the_run_cores_field_named_queries_take_the_extracts_parameters(self) -> None:
        queries = json.loads(packaged_text())["queries"]

        assert {"geo_bounding_box", "geo_distance", "geo_polygon", "geo_shape"} <= set(
            FIELD_NAMED_QUERIES
        )
        for name, params in FIELD_NAMED_QUERIES.items():
            assert params == set(queries[name]["params"]), name
