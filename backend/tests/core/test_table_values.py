"""
Tests for the shared table-realization helper (REQ-3.4.3.3).

A table reaches a consumer in one of two runtime forms: a live ``Table``
produced by a plugin, or the stored form of a variable declared in the
Variable Manager (a list of row maps, or a ``{columns, rows}`` dict). Both
forms are permanent, so every consumer that accepts a table - the loop, the
Variable Setter, the CSV and Excel table parameters, the literal type check -
asks the same question here instead of hand-rolling an isinstance check.

``as_table`` never raises: a value that is not a table returns None so the
caller can produce its own parameter-specific message.
"""

from decimal import Decimal

import pytest

from wavecore.core.table import Table
from wavecore.core.table_values import as_table, is_table_value, realizes_as_table


def _people() -> Table:
    table = Table(columns=[("name", "string"), ("age", "integer")])
    table.add_row(["ada", 36])
    table.add_row(["grace", 45])
    return table


# =============================================================================
# Live Table instances
# =============================================================================


class TestLiveTable:
    """A plugin-produced Table is already realized and passes through."""

    def test_table_returns_the_same_instance(self):
        table = _people()

        assert as_table(table) is table

    def test_empty_table_returns_the_same_instance(self):
        table = Table(columns=[("name", "string")])

        assert as_table(table) is table

    def test_table_with_no_columns_returns_the_same_instance(self):
        table = Table()

        assert as_table(table) is table

    def test_table_is_a_table_value(self):
        assert is_table_value(_people()) is True

    def test_empty_table_is_a_table_value(self):
        assert is_table_value(Table()) is True


# =============================================================================
# Stored form: list of row maps
# =============================================================================


class TestStoredListForm:
    """A table variable stored as a list of row maps reconstructs."""

    def test_list_of_row_maps_reconstructs(self):
        result = as_table([{"name": "ada", "age": 36}, {"name": "grace", "age": 45}])

        assert isinstance(result, Table)
        assert result.col_names() == ["name", "age"]
        assert result.to_list() == [{"name": "ada", "age": 36}, {"name": "grace", "age": 45}]

    def test_reconstructed_list_equals_the_live_table(self):
        result = as_table(_people().to_list())

        assert result is not None
        assert result.col_names() == _people().col_names()
        assert result.col_types() == _people().col_types()
        assert result.to_list() == _people().to_list()

    def test_column_types_are_inferred_from_the_first_row(self):
        result = as_table([{"name": "ada", "age": 36, "member": True}])

        assert result is not None
        assert result.col_types() == ["string", "integer", "boolean"]

    def test_single_row_reconstructs(self):
        result = as_table([{"host": "10.0.0.1"}])

        assert result is not None
        assert result.row_count() == 1
        assert result.cell(0, "host") == "10.0.0.1"

    def test_empty_list_is_an_empty_table(self):
        result = as_table([])

        assert isinstance(result, Table)
        assert result.row_count() == 0
        assert result.col_names() == []

    def test_list_of_row_maps_is_a_table_value(self):
        assert is_table_value([{"a": 1}]) is True

    def test_empty_list_is_a_table_value(self):
        assert is_table_value([]) is True


# =============================================================================
# Stored form: {columns, rows} dict
# =============================================================================


class TestStoredDictForm:
    """A table variable stored as {columns, rows} reconstructs."""

    def test_columns_and_rows_reconstruct(self):
        result = as_table(
            {
                "columns": [{"name": "name", "type": "string"}, {"name": "age", "type": "integer"}],
                "rows": [["ada", 36], ["grace", 45]],
            }
        )

        assert isinstance(result, Table)
        assert result.col_names() == ["name", "age"]
        assert result.col_types() == ["string", "integer"]
        assert result.to_list() == [{"name": "ada", "age": 36}, {"name": "grace", "age": 45}]

    def test_round_trip_of_a_live_table_is_equal(self):
        result = as_table(_people().to_dict())

        assert result is not None
        assert result.col_names() == _people().col_names()
        assert result.col_types() == _people().col_types()
        assert result.to_list() == _people().to_list()

    def test_declared_types_are_preserved_not_inferred(self):
        """The dict form carries types; a float column stays float even at .0."""
        result = as_table({"columns": [{"name": "ratio", "type": "float"}], "rows": [["1.50"]]})

        assert result is not None
        assert result.col_types() == ["float"]
        assert result.cell(0, "ratio") == Decimal("1.50")

    def test_empty_columns_and_rows_is_an_empty_table(self):
        result = as_table({"columns": [], "rows": []})

        assert isinstance(result, Table)
        assert result.row_count() == 0
        assert result.col_names() == []

    def test_columns_without_rows_is_a_schema_only_table(self):
        result = as_table({"columns": [{"name": "a", "type": "string"}]})

        assert result is not None
        assert result.col_names() == ["a"]
        assert result.row_count() == 0

    def test_stored_dict_form_is_a_table_value(self):
        assert is_table_value({"columns": [], "rows": []}) is True


# =============================================================================
# Values that are not tables
# =============================================================================


class TestNonTableValues:
    """Anything that is not a table returns None rather than raising."""

    @pytest.mark.parametrize(
        "value",
        [
            "orders",
            "",
            42,
            0,
            3.14,
            Decimal("1.5"),
            True,
            False,
            None,
            (1, 2, 3),
            (),
            {"host", "port"},
        ],
    )
    def test_scalar_and_sequence_values_are_not_tables(self, value):
        assert as_table(value) is None
        assert is_table_value(value) is False

    def test_list_of_scalars_is_not_a_table(self):
        """A plain array is not a ragged table - it must not reconstruct."""
        assert as_table([1, 2, 3]) is None
        assert is_table_value([1, 2, 3]) is False

    def test_list_of_strings_is_not_a_table(self):
        assert as_table(["a", "b"]) is None

    def test_list_of_lists_is_not_a_table(self):
        assert as_table([["a", 1], ["b", 2]]) is None

    def test_mixed_list_of_maps_and_scalars_is_not_a_table(self):
        assert as_table([{"a": 1}, 2]) is None

    def test_map_without_a_columns_key_is_not_a_table(self):
        """A plain map must not silently become an empty table."""
        assert as_table({"host": "10.0.0.1", "port": 8080}) is None
        assert is_table_value({"host": "10.0.0.1"}) is False

    def test_empty_map_is_not_a_table(self):
        assert as_table({}) is None
        assert is_table_value({}) is False


# =============================================================================
# realizes_as_table: never raises
# =============================================================================


class TestRealizesAsTable:
    """A value either realizes as a table or does not; a malformed stored form is not one."""

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(_people(), id="live"),
            pytest.param([{"n": 1}], id="row-maps"),
            pytest.param(
                {"columns": [{"name": "n", "type": "integer"}], "rows": [["16"]]}, id="stored"
            ),
        ],
    )
    def test_a_table_value_realizes(self, value):
        assert realizes_as_table(value) is True

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param({"a": 1}, id="plain-map"),
            pytest.param([1, 2], id="scalars"),
            pytest.param("orders", id="string"),
            pytest.param({"columns": "n"}, id="columns-not-a-list"),
            pytest.param({"columns": [{"type": "integer"}]}, id="column-without-name"),
            pytest.param(
                {"columns": [{"name": "n", "type": "integer"}], "rows": [["a", "b"]]},
                id="ragged-row",
            ),
        ],
    )
    def test_a_value_that_is_not_a_table_does_not_realize(self, value):
        assert realizes_as_table(value) is False


# =============================================================================
# Non-mutation
# =============================================================================


class TestNoMutation:
    """Realization never writes back into the caller's stored value."""

    def test_stored_list_is_not_mutated(self):
        stored = [{"name": "ada", "age": 36}]

        as_table(stored)

        assert stored == [{"name": "ada", "age": 36}]

    def test_stored_dict_is_not_mutated(self):
        stored = {
            "columns": [{"name": "age", "type": "integer"}],
            "rows": [[36]],
        }

        as_table(stored)

        assert stored == {
            "columns": [{"name": "age", "type": "integer"}],
            "rows": [[36]],
        }

    def test_reconstructed_table_is_independent_of_the_stored_rows(self):
        stored = [{"name": "ada"}]
        result = as_table(stored)

        assert result is not None
        result.add_row(["grace"])

        assert stored == [{"name": "ada"}]
