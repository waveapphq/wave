"""Documents to the Search Results table (REQ-3.3.3.1, OS-8).

One column per Fields entry, time first by default; nested objects become dotted columns,
arrays JSON text, a missing field an empty cell; empty Fields gives the whole document as one
column; an empty result keeps its columns; cells are typed by their values.
"""

import json
from decimal import Decimal
from typing import Any

from wavecore.connectivity.opensearch._results import results_table

FIELDS = ["@timestamp", "log.level", "message"]


def hits(*documents: str) -> list[dict[str, Any]]:
    """Hits as the REST core reads them: JSON text with floats as Decimal."""
    return [json.loads(document, parse_float=Decimal) for document in documents]


def source(document: dict[str, Any], doc_id: str = "a1", index: str = "logs-1") -> str:
    return json.dumps({"_index": index, "_id": doc_id, "_source": document})


def table(columns: list[tuple[str, str]], rows: list[list[Any]]) -> dict[str, Any]:
    return {
        "__wave_type": "table",
        "columns": [{"name": name, "type": kind} for name, kind in columns],
        "rows": rows,
    }


def column_names(result: dict[str, Any]) -> list[str]:
    return [column["name"] for column in result["columns"]]


class TestWorkedExamples:
    """The worked examples of the Search Results rules."""

    def test_a_nested_and_a_dotted_key_read_the_same_column(self) -> None:
        result = results_table(
            FIELDS,
            hits(
                '{"_id":"a1","_source":{"@timestamp":"2026-09-25T10:40:01.120Z",'
                '"log":{"level":"ERROR"},"message":"Payment failed"}}',
                '{"_id":"a2","_source":{"@timestamp":"2026-09-25T10:39:58.004Z",'
                '"log.level":"INFO","message":"Batch complete"}}',
            ),
        )

        assert result == table(
            [("@timestamp", "string"), ("log.level", "string"), ("message", "string")],
            [
                ["2026-09-25T10:40:01.120Z", "ERROR", "Payment failed"],
                ["2026-09-25T10:39:58.004Z", "INFO", "Batch complete"],
            ],
        )

    def test_an_object_becomes_dotted_columns_in_name_order(self) -> None:
        result = results_table(
            ["@timestamp", "user"],
            hits(
                '{"_source":{"@timestamp":"2026-09-25T10:40:01.120Z",'
                '"user":{"roles":["a","b"],"name":"ann","id":7}}}',
                '{"_source":{"@timestamp":"2026-09-25T10:40:02.000Z","user":{"id":8}}}',
            ),
        )

        assert result == table(
            [
                ("@timestamp", "string"),
                ("user.id", "integer"),
                ("user.name", "string"),
                ("user.roles", "string"),
            ],
            [
                ["2026-09-25T10:40:01.120Z", 7, "ann", '["a","b"]'],
                ["2026-09-25T10:40:02.000Z", 8, None, None],
            ],
        )

    def test_empty_fields_give_the_whole_document(self) -> None:
        result = results_table([], hits('{"_source":{"a":1,"b":{"c":2.50}}}'))

        assert result == table([("_source", "string")], [['{"a":1,"b":{"c":2.50}}']])

    def test_no_hits_keep_the_columns(self) -> None:
        assert results_table(FIELDS, []) == table(
            [("@timestamp", "string"), ("log.level", "string"), ("message", "string")], []
        )


class TestLookup:
    """The full name first, then a walk taking the longest key at each level."""

    def test_id_and_index_read_the_hit_metadata(self) -> None:
        result = results_table(
            ["_id", "_index", "message"],
            hits(source({"_id": "inner", "message": "m"}, doc_id="a7", index="logs-2")),
        )

        assert result["rows"] == [["a7", "logs-2", "m"]]

    def test_the_full_name_as_a_key_comes_first(self) -> None:
        result = results_table(
            ["log.level"], hits(source({"log": {"level": "ERROR"}, "log.level": "INFO"}))
        )

        assert result["rows"] == [["INFO"]]

    def test_the_walk_takes_the_longest_key(self) -> None:
        result = results_table(
            ["a.b.c"], hits(source({"a": {"b": {"c": "short"}}, "a.b": {"c": "long"}}))
        )

        assert result["rows"] == [["long"]]

    def test_a_dotted_key_inside_an_object(self) -> None:
        result = results_table(["a.b.c"], hits(source({"a": {"b.c": "inner"}})))

        assert result["rows"] == [["inner"]]

    def test_a_walk_through_a_scalar_finds_nothing(self) -> None:
        result = results_table(["log.level"], hits(source({"log": "plain"})))

        assert result == table([("log.level", "string")], [[None]])

    def test_a_missing_field_is_an_empty_cell(self) -> None:
        result = results_table(
            ["message", "trace.id"],
            hits(source({"message": "m1", "trace": {"id": "t"}}), source({"message": "m2"})),
        )

        assert result["rows"] == [["m1", "t"], ["m2", None]]

    def test_a_field_no_hit_has_keeps_its_column(self) -> None:
        result = results_table(["message", "absent"], hits(source({"message": "m"})))

        assert result == table([("message", "string"), ("absent", "string")], [["m", None]])


class TestObjects:
    """An object expands into dotted leaf columns in name order, level by level, across hits."""

    def test_deeper_objects_expand_to_their_leaves_in_name_order(self) -> None:
        result = results_table(
            ["user"], hits(source({"user": {"id": 1, "geo": {"zip": "0150", "city": "Oslo"}}}))
        )

        assert column_names(result) == ["user.geo.city", "user.geo.zip", "user.id"]
        assert result["rows"] == [["Oslo", "0150", 1]]

    def test_leaves_in_name_order_across_hits(self) -> None:
        result = results_table(
            ["user"],
            hits(source({"user": {"name": "a"}}), source({"user": {"name": "b", "id": 2}})),
        )

        assert column_names(result) == ["user.id", "user.name"]
        assert result["rows"] == [[None, "a"], [2, "b"]]

    def test_name_order_goes_level_by_level(self) -> None:
        result = results_table(["o"], hits(source({"o": {"a-b": 2, "a": {"x": 1}}})))

        assert column_names(result) == ["o.a.x", "o.a-b"]
        assert result["rows"] == [[1, 2]]

    def test_the_fields_order_is_kept_around_an_object(self) -> None:
        result = results_table(
            ["zone", "user", "action"],
            hits(source({"action": "go", "user": {"name": "ann", "id": 7}, "zone": "z"})),
        )

        assert column_names(result) == ["zone", "user.id", "user.name", "action"]

    def test_a_scalar_at_the_same_name_fills_the_entry_column(self) -> None:
        result = results_table(["user"], hits(source({"user": "ann"}), source({"user": {"id": 8}})))

        assert result == table(
            [("user", "string"), ("user.id", "integer")], [["ann", None], [None, 8]]
        )

    def test_a_hit_without_the_object_leaves_its_leaves_empty(self) -> None:
        result = results_table(["user"], hits(source({"user": {"id": 1}}), source({"other": True})))

        assert result == table([("user.id", "integer")], [[1], [None]])

    def test_an_array_of_objects_is_not_expanded(self) -> None:
        result = results_table(["items"], hits(source({"items": [{"a": 1}, {"a": 2}]})))

        assert result == table([("items", "string")], [['[{"a":1},{"a":2}]']])


class TestWildcards:
    """A wildcard entry expands to the matching leaf columns in the documents, in name order."""

    def test_a_wildcard_matches_leaves_at_any_depth(self) -> None:
        result = results_table(
            ["@timestamp", "user.*"],
            hits(
                source(
                    {
                        "@timestamp": "2026-09-25T10:40:01.120Z",
                        "user": {"id": 7, "geo": {"city": "Oslo"}},
                        "host": {"name": "h1"},
                    }
                )
            ),
        )

        assert column_names(result) == ["@timestamp", "user.geo.city", "user.id"]
        assert result["rows"] == [["2026-09-25T10:40:01.120Z", "Oslo", 7]]

    def test_dotted_keys_match_too_in_name_order(self) -> None:
        result = results_table(
            ["user.*"],
            hits(source({"user.name": "ann"}), source({"user": {"name": "bob", "id": 8}})),
        )

        assert column_names(result) == ["user.id", "user.name"]
        assert result["rows"] == [[None, "ann"], [8, "bob"]]

    def test_no_hits_keep_the_wildcard_as_written(self) -> None:
        assert results_table(["_id", "user.*"], []) == table(
            [("_id", "string"), ("user.*", "string")], []
        )


class TestArrays:
    """An array is compact JSON text in one cell, exact decimals and non-ASCII kept."""

    def test_an_array_cell(self) -> None:
        result = results_table(["tags"], hits('{"_source":{"tags":[1.50,"été",null]}}'))

        assert result == table([("tags", "string")], [['[1.50,"été",null]']])

    def test_an_empty_array(self) -> None:
        result = results_table(["tags"], hits(source({"tags": []})))

        assert result["rows"] == [["[]"]]


class TestEmptyFields:
    """Empty Fields: one `_source` column holding each document as compact JSON text."""

    def test_every_document_in_order(self) -> None:
        result = results_table(
            [],
            hits(
                source({"message": "café", "n": 1}),
                source({"message": "b", "nested": {"x": [1, 2]}}),
            ),
        )

        assert result == table(
            [("_source", "string")],
            [['{"message":"café","n":1}'], ['{"message":"b","nested":{"x":[1,2]}}']],
        )

    def test_no_hits_keep_the_source_column(self) -> None:
        assert results_table([], []) == table([("_source", "string")], [])


class TestDuplicates:
    """A column name already taken is dropped; the first one wins."""

    def test_a_repeated_entry(self) -> None:
        result = results_table(["message", "message"], hits(source({"message": "m"})))

        assert result == table([("message", "string")], [["m"]])

    def test_an_entry_an_expansion_already_made(self) -> None:
        result = results_table(
            ["user", "user.id"], hits(source({"user": {"id": 7, "name": "ann"}}))
        )

        assert result == table([("user.id", "integer"), ("user.name", "string")], [[7, "ann"]])

    def test_a_wildcard_meets_a_named_entry(self) -> None:
        result = results_table(
            ["user.name", "user.*"], hits(source({"user": {"id": 7, "name": "ann"}}))
        )

        assert result == table([("user.name", "string"), ("user.id", "integer")], [["ann", 7]])

    def test_duplicates_with_no_hits(self) -> None:
        assert results_table(["message", "message"], []) == table([("message", "string")], [])


class TestTypes:
    """Columns are typed by their values through the shared typed table."""

    def test_booleans(self) -> None:
        result = results_table(
            ["ok"], hits(source({"ok": True}), source({"ok": False}), source({}))
        )

        assert result == table([("ok", "boolean")], [[True], [False], [None]])

    def test_a_decimal_makes_a_float_column_with_exact_text(self) -> None:
        result = results_table(
            ["bytes"], hits('{"_source":{"bytes":3}}', '{"_source":{"bytes":2.50}}')
        )

        assert result == table([("bytes", "float")], [[3], ["2.50"]])

    def test_integers(self) -> None:
        result = results_table(["status"], hits(source({"status": 200}), source({"status": 503})))

        assert result == table([("status", "integer")], [[200], [503]])

    def test_numbers_and_text_make_a_string_column(self) -> None:
        result = results_table(["code"], hits(source({"code": 7}), source({"code": "x"})))

        assert result == table([("code", "string")], [["7"], ["x"]])

    def test_a_column_with_no_values_is_text(self) -> None:
        result = results_table(["absent"], hits(source({}), source({})))

        assert result == table([("absent", "string")], [[None], [None]])
