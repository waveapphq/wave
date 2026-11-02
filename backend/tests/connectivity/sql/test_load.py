"""Load table: quoting, column matching, statements and values (REQ-3.4.1.6, REQ-5.1.4, SQL-7).

The target's columns and primary key are read from the database before any row is sent;
the insert, upsert and delete statements are built per database type; each row's cells
are realized by the Table's column types, with booleans as 1 / 0 on Oracle and SQL Server.
"""

from collections.abc import Callable, Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import apsw
import pytest

from tests.connectivity.sql.fakes import FakeConnection, Result, sqlite_file
from tests.plugins.sql_client.conftest import exact
from wavecore.connectivity.sql._load import (
    delete_statement,
    insert_statement,
    load_values,
    match_columns,
    qualified_name,
    quote_identifier,
    read_primary_key,
    read_target_columns,
    upsert_statement,
)
from wavecore.connectivity.sql.dialects import sqlite

NETWORK_TYPES = ("postgresql", "mysql", "oracle", "mssql")
ALL_TYPES = (*NETWORK_TYPES, "sqlite")
BOOLEAN_AS_BOOL = ("postgresql", "mysql", "sqlite")
BOOLEAN_AS_NUMBER = ("oracle", "mssql")


def envelope(columns: list[tuple[str, str]], rows: list[list[Any]]) -> dict[str, Any]:
    """A table envelope as the core hands it to load_values."""
    return {
        "__wave_type": "table",
        "columns": [{"name": name, "type": kind} for name, kind in columns],
        "rows": rows,
    }


def typed(values: list[tuple[Any, ...]]) -> list[list[tuple[type, str]]]:
    """Each cell as (exact type, text), so 1 and True or Decimal and float never compare equal."""
    return [[(type(cell), str(cell)) for cell in row] for row in values]


def fetched(connection: Any, statement: str) -> Any:
    """What fetchall gives for `statement` on a cursor of `connection`."""
    cursor = connection.cursor()
    cursor.execute(statement)
    return cursor.fetchall()


@pytest.fixture
def sqlite_db(tmp_path: Path) -> Iterator[Callable[..., Any]]:
    """Open a real SQLite database built from the given statements; closed at teardown."""
    opened: list[Any] = []

    def open_db(*statements: str) -> Any:
        path = sqlite_file(tmp_path / f"t{len(opened)}.db", *statements)
        rows = {"file": str(path), "file_read_only": False, "driver_options": {}}
        connection = sqlite.connect(rows, 1)
        opened.append(connection)
        return connection

    yield open_db
    for connection in opened:
        connection.close()


class TestQuoteIdentifier:
    """Double quotes on PostgreSQL, Oracle, SQLite; backticks on MySQL; brackets on SQL Server."""

    @pytest.mark.parametrize(
        ("dialect", "quoted"),
        [
            ("postgresql", '"id"'),
            ("oracle", '"id"'),
            ("sqlite", '"id"'),
            ("mysql", "`id`"),
            ("mssql", "[id]"),
        ],
    )
    def test_plain_name(self, dialect: str, quoted: str) -> None:
        assert quote_identifier(dialect, "id") == quoted

    @pytest.mark.parametrize(
        ("dialect", "quoted"),
        [
            ("postgresql", '"Unit Price"'),
            ("oracle", '"Unit Price"'),
            ("sqlite", '"Unit Price"'),
            ("mysql", "`Unit Price`"),
            ("mssql", "[Unit Price]"),
        ],
    )
    def test_case_and_spaces_kept(self, dialect: str, quoted: str) -> None:
        assert quote_identifier(dialect, "Unit Price") == quoted

    @pytest.mark.parametrize(
        ("dialect", "name", "quoted"),
        [
            ("postgresql", 'a"b', '"a""b"'),
            ("oracle", 'a"b', '"a""b"'),
            ("sqlite", 'a"b', '"a""b"'),
            ("mysql", "a`b", "`a``b`"),
            ("mssql", "a]b", "[a]]b]"),
        ],
    )
    def test_embedded_quote_doubled(self, dialect: str, name: str, quoted: str) -> None:
        assert quote_identifier(dialect, name) == quoted

    @pytest.mark.parametrize(
        ("dialect", "name", "quoted"),
        [
            ("postgresql", "a`b]c", '"a`b]c"'),
            ("oracle", "a`b]c", '"a`b]c"'),
            ("sqlite", "a`b]c", '"a`b]c"'),
            ("mysql", 'a"b]c', '`a"b]c`'),
            ("mssql", 'a"b`c[d', '[a"b`c[d]'),
        ],
    )
    def test_other_quote_characters_kept(self, dialect: str, name: str, quoted: str) -> None:
        assert quote_identifier(dialect, name) == quoted


class TestMatchColumns:
    """A WAVE column takes the target's spelling: exact first, else one case-insensitive match."""

    def test_exact_match(self) -> None:
        assert match_columns(["id", "qty"], ["id", "qty"], "orders") == ["id", "qty"]

    def test_wave_column_order_kept(self) -> None:
        assert match_columns(["qty", "id"], ["id", "qty"], "orders") == ["qty", "id"]

    def test_case_insensitive_match_takes_the_target_spelling(self) -> None:
        assert match_columns(["ID", "Qty"], ["id", "qty"], "orders") == ["id", "qty"]

    def test_target_column_without_a_match_is_left_out(self) -> None:
        assert match_columns(["id"], ["id", "qty", "note"], "orders") == ["id"]

    def test_exact_match_wins_over_case_insensitive_ones(self) -> None:
        assert match_columns(["id"], ["ID", "id"], "orders") == ["id"]
        assert match_columns(["Id"], ["ID", "id", "Id"], "orders") == ["Id"]

    def test_no_wave_columns(self) -> None:
        assert match_columns([], ["id"], "orders") == []

    def test_missing_column_refused_by_name(self) -> None:
        with pytest.raises(ValueError, match=exact("Column 'price' is not in orders")):
            match_columns(["id", "price"], ["id", "qty"], "orders")

    def test_first_missing_column_in_wave_order_is_named(self) -> None:
        with pytest.raises(ValueError, match=exact("Column 'price' is not in orders")):
            match_columns(["id", "price", "cost"], ["id"], "orders")

    def test_table_named_as_written(self) -> None:
        with pytest.raises(ValueError, match=exact("Column 'price' is not in app.orders")):
            match_columns(["price"], ["id"], "app.orders")

    def test_ambiguous_case_insensitive_match_refused(self) -> None:
        with pytest.raises(ValueError, match=exact("Column 'id' is not in orders")):
            match_columns(["id"], ["ID", "Id"], "orders")


class TestInsertStatement:
    """Inserts: target spellings quoted, the table as written, the driver's placeholders."""

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            ("postgresql", 'INSERT INTO orders ("id", "qty") VALUES ($1, $2)'),
            ("mysql", "INSERT INTO orders (`id`, `qty`) VALUES (%s, %s)"),
            ("sqlite", 'INSERT INTO orders ("id", "qty") VALUES (?, ?)'),
            ("oracle", 'INSERT INTO orders ("id", "qty") VALUES (:1, :2)'),
            ("mssql", "INSERT INTO orders ([id], [qty]) VALUES (%s, %s)"),
        ],
    )
    def test_two_columns(self, dialect: str, statement: str) -> None:
        assert insert_statement(dialect, "orders", ["id", "qty"]) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            (
                "postgresql",
                'INSERT INTO app.orders ("id", "Unit Price", "qty") VALUES ($1, $2, $3)',
            ),
            ("mysql", "INSERT INTO app.orders (`id`, `Unit Price`, `qty`) VALUES (%s, %s, %s)"),
            ("sqlite", 'INSERT INTO app.orders ("id", "Unit Price", "qty") VALUES (?, ?, ?)'),
            ("oracle", 'INSERT INTO app.orders ("id", "Unit Price", "qty") VALUES (:1, :2, :3)'),
            ("mssql", "INSERT INTO app.orders ([id], [Unit Price], [qty]) VALUES (%s, %s, %s)"),
        ],
    )
    def test_schema_table_and_spelled_columns(self, dialect: str, statement: str) -> None:
        assert insert_statement(dialect, "app.orders", ["id", "Unit Price", "qty"]) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            ("postgresql", 'INSERT INTO orders ("a""b") VALUES ($1)'),
            ("mysql", "INSERT INTO orders (`a``b`) VALUES (%s)"),
            ("mssql", "INSERT INTO orders ([a]]b]) VALUES (%s)"),
        ],
    )
    def test_column_names_quoted_with_quote_identifier(self, dialect: str, statement: str) -> None:
        name = {"postgresql": 'a"b', "mysql": "a`b", "mssql": "a]b"}[dialect]
        assert insert_statement(dialect, "orders", [name]) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            ("mysql", "INSERT INTO orders (`id`, `pct%%`) VALUES (%s, %s)"),
            ("mssql", "INSERT INTO orders ([id], [pct%%]) VALUES (%s, %s)"),
        ],
    )
    def test_a_percent_in_a_column_name_is_doubled_for_percent_placeholders(
        self, dialect: str, statement: str
    ) -> None:
        assert insert_statement(dialect, "orders", ["id", "pct%"]) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            ("sqlite", 'INSERT INTO orders ("id", "pct%") VALUES (?, ?)'),
            ("oracle", 'INSERT INTO orders ("id", "pct%") VALUES (:1, :2)'),
        ],
    )
    def test_a_percent_in_a_column_name_stays_single_for_other_placeholders(
        self, dialect: str, statement: str
    ) -> None:
        assert insert_statement(dialect, "orders", ["id", "pct%"]) == statement


class TestUpsertStatement:
    """Add or replace: ON CONFLICT, ON DUPLICATE KEY or MERGE, per database type (SQL-7)."""

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            (
                "postgresql",
                'INSERT INTO orders ("id", "qty") VALUES ($1, $2) '
                'ON CONFLICT ("id") DO UPDATE SET "qty" = EXCLUDED."qty"',
            ),
            (
                "mysql",
                "INSERT INTO orders (`id`, `qty`) VALUES (%s, %s) "
                "ON DUPLICATE KEY UPDATE `qty` = VALUES(`qty`)",
            ),
            (
                "sqlite",
                'INSERT INTO orders ("id", "qty") VALUES (?, ?) '
                'ON CONFLICT ("id") DO UPDATE SET "qty" = excluded."qty"',
            ),
            (
                "oracle",
                'MERGE INTO orders d USING (SELECT :1 AS "id", :2 AS "qty" FROM dual) s '
                'ON (d."id" = s."id") WHEN MATCHED THEN UPDATE SET d."qty" = s."qty" '
                'WHEN NOT MATCHED THEN INSERT ("id", "qty") VALUES (s."id", s."qty")',
            ),
            (
                "mssql",
                "MERGE INTO orders AS d USING (SELECT %s AS [id], %s AS [qty]) AS s "
                "ON (d.[id] = s.[id]) WHEN MATCHED THEN UPDATE SET d.[qty] = s.[qty] "
                "WHEN NOT MATCHED THEN INSERT ([id], [qty]) VALUES (s.[id], s.[qty]);",
            ),
        ],
    )
    def test_one_key(self, dialect: str, statement: str) -> None:
        assert upsert_statement(dialect, "orders", ["id", "qty"], ["id"]) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            (
                "postgresql",
                'INSERT INTO orders ("id", "region", "qty") VALUES ($1, $2, $3) '
                'ON CONFLICT ("id", "region") DO UPDATE SET "qty" = EXCLUDED."qty"',
            ),
            (
                "mysql",
                "INSERT INTO orders (`id`, `region`, `qty`) VALUES (%s, %s, %s) "
                "ON DUPLICATE KEY UPDATE `qty` = VALUES(`qty`)",
            ),
            (
                "sqlite",
                'INSERT INTO orders ("id", "region", "qty") VALUES (?, ?, ?) '
                'ON CONFLICT ("id", "region") DO UPDATE SET "qty" = excluded."qty"',
            ),
            (
                "oracle",
                'MERGE INTO orders d USING (SELECT :1 AS "id", :2 AS "region", :3 AS "qty" '
                'FROM dual) s ON (d."id" = s."id" AND d."region" = s."region") '
                'WHEN MATCHED THEN UPDATE SET d."qty" = s."qty" '
                'WHEN NOT MATCHED THEN INSERT ("id", "region", "qty") '
                'VALUES (s."id", s."region", s."qty")',
            ),
            (
                "mssql",
                "MERGE INTO orders AS d USING (SELECT %s AS [id], %s AS [region], %s AS [qty]) "
                "AS s ON (d.[id] = s.[id] AND d.[region] = s.[region]) "
                "WHEN MATCHED THEN UPDATE SET d.[qty] = s.[qty] "
                "WHEN NOT MATCHED THEN INSERT ([id], [region], [qty]) "
                "VALUES (s.[id], s.[region], s.[qty]);",
            ),
        ],
    )
    def test_two_keys(self, dialect: str, statement: str) -> None:
        columns = ["id", "region", "qty"]
        assert upsert_statement(dialect, "orders", columns, ["id", "region"]) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            (
                "postgresql",
                'INSERT INTO orders ("id", "qty", "price") VALUES ($1, $2, $3) '
                'ON CONFLICT ("id") DO UPDATE SET "qty" = EXCLUDED."qty", '
                '"price" = EXCLUDED."price"',
            ),
            (
                "mysql",
                "INSERT INTO orders (`id`, `qty`, `price`) VALUES (%s, %s, %s) "
                "ON DUPLICATE KEY UPDATE `qty` = VALUES(`qty`), `price` = VALUES(`price`)",
            ),
            (
                "sqlite",
                'INSERT INTO orders ("id", "qty", "price") VALUES (?, ?, ?) '
                'ON CONFLICT ("id") DO UPDATE SET "qty" = excluded."qty", '
                '"price" = excluded."price"',
            ),
            (
                "oracle",
                'MERGE INTO orders d USING (SELECT :1 AS "id", :2 AS "qty", :3 AS "price" '
                'FROM dual) s ON (d."id" = s."id") '
                'WHEN MATCHED THEN UPDATE SET d."qty" = s."qty", d."price" = s."price" '
                'WHEN NOT MATCHED THEN INSERT ("id", "qty", "price") '
                'VALUES (s."id", s."qty", s."price")',
            ),
            (
                "mssql",
                "MERGE INTO orders AS d USING (SELECT %s AS [id], %s AS [qty], %s AS [price]) "
                "AS s ON (d.[id] = s.[id]) "
                "WHEN MATCHED THEN UPDATE SET d.[qty] = s.[qty], d.[price] = s.[price] "
                "WHEN NOT MATCHED THEN INSERT ([id], [qty], [price]) "
                "VALUES (s.[id], s.[qty], s.[price]);",
            ),
        ],
    )
    def test_several_updated_columns(self, dialect: str, statement: str) -> None:
        columns = ["id", "qty", "price"]
        assert upsert_statement(dialect, "orders", columns, ["id"]) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            ("postgresql", 'INSERT INTO orders ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING'),
            (
                "mysql",
                "INSERT INTO orders (`id`) VALUES (%s) ON DUPLICATE KEY UPDATE `id` = VALUES(`id`)",
            ),
            ("sqlite", 'INSERT INTO orders ("id") VALUES (?) ON CONFLICT ("id") DO NOTHING'),
            (
                "oracle",
                'MERGE INTO orders d USING (SELECT :1 AS "id" FROM dual) s '
                'ON (d."id" = s."id") WHEN NOT MATCHED THEN INSERT ("id") VALUES (s."id")',
            ),
            (
                "mssql",
                "MERGE INTO orders AS d USING (SELECT %s AS [id]) AS s "
                "ON (d.[id] = s.[id]) WHEN NOT MATCHED THEN INSERT ([id]) VALUES (s.[id]);",
            ),
        ],
    )
    def test_every_column_a_key(self, dialect: str, statement: str) -> None:
        assert upsert_statement(dialect, "orders", ["id"], ["id"]) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            (
                "postgresql",
                'INSERT INTO orders ("id", "region") VALUES ($1, $2) '
                'ON CONFLICT ("id", "region") DO NOTHING',
            ),
            (
                "mysql",
                "INSERT INTO orders (`id`, `region`) VALUES (%s, %s) "
                "ON DUPLICATE KEY UPDATE `id` = VALUES(`id`), `region` = VALUES(`region`)",
            ),
            (
                "sqlite",
                'INSERT INTO orders ("id", "region") VALUES (?, ?) '
                'ON CONFLICT ("id", "region") DO NOTHING',
            ),
            (
                "oracle",
                'MERGE INTO orders d USING (SELECT :1 AS "id", :2 AS "region" FROM dual) s '
                'ON (d."id" = s."id" AND d."region" = s."region") '
                'WHEN NOT MATCHED THEN INSERT ("id", "region") VALUES (s."id", s."region")',
            ),
            (
                "mssql",
                "MERGE INTO orders AS d USING (SELECT %s AS [id], %s AS [region]) AS s "
                "ON (d.[id] = s.[id] AND d.[region] = s.[region]) "
                "WHEN NOT MATCHED THEN INSERT ([id], [region]) VALUES (s.[id], s.[region]);",
            ),
        ],
    )
    def test_every_column_a_key_with_two_keys(self, dialect: str, statement: str) -> None:
        columns = ["id", "region"]
        assert upsert_statement(dialect, "orders", columns, columns) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            (
                "postgresql",
                'INSERT INTO orders ("id", "qty") VALUES ($1, $2) '
                'ON CONFLICT ("qty") DO UPDATE SET "id" = EXCLUDED."id"',
            ),
            (
                "oracle",
                'MERGE INTO orders d USING (SELECT :1 AS "id", :2 AS "qty" FROM dual) s '
                'ON (d."qty" = s."qty") WHEN MATCHED THEN UPDATE SET d."id" = s."id" '
                'WHEN NOT MATCHED THEN INSERT ("id", "qty") VALUES (s."id", s."qty")',
            ),
        ],
    )
    def test_key_that_is_not_the_first_column(self, dialect: str, statement: str) -> None:
        assert upsert_statement(dialect, "orders", ["id", "qty"], ["qty"]) == statement

    @pytest.mark.parametrize(
        ("dialect", "statement"),
        [
            (
                "mysql",
                "INSERT INTO orders (`id`, `pct%%`) VALUES (%s, %s) "
                "ON DUPLICATE KEY UPDATE `pct%%` = VALUES(`pct%%`)",
            ),
            (
                "mssql",
                "MERGE INTO orders AS d USING (SELECT %s AS [id], %s AS [pct%%]) AS s "
                "ON (d.[id] = s.[id]) WHEN MATCHED THEN UPDATE SET d.[pct%%] = s.[pct%%] "
                "WHEN NOT MATCHED THEN INSERT ([id], [pct%%]) VALUES (s.[id], s.[pct%%]);",
            ),
        ],
    )
    def test_a_percent_in_a_column_name_is_doubled_for_percent_placeholders(
        self, dialect: str, statement: str
    ) -> None:
        assert upsert_statement(dialect, "orders", ["id", "pct%"], ["id"]) == statement


class TestDeleteStatement:
    """Overwrite empties the target with DELETE, never TRUNCATE or DROP."""

    def test_delete_from_the_table_as_written_on_every_database(self) -> None:
        assert delete_statement("orders") == "DELETE FROM orders"
        assert delete_statement("app.orders") == "DELETE FROM app.orders"


class TestReadTargetColumns:
    """The target's columns come from an empty SELECT's description, in table order."""

    def test_real_sqlite_columns_in_table_order(self, sqlite_db: Callable[..., Any]) -> None:
        connection = sqlite_db(
            "CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER, note TEXT)",
            "INSERT INTO orders VALUES (1, 5, 'first')",
        )
        assert read_target_columns(connection, "orders") == ["id", "qty", "note"]
        assert fetched(connection, "SELECT * FROM orders") == [(1, 5, "first")]

    def test_real_sqlite_table_text_as_written_and_column_spelling_kept(
        self, sqlite_db: Callable[..., Any]
    ) -> None:
        connection = sqlite_db('CREATE TABLE "Orders" ("Id" INTEGER, "Unit Price" REAL)')
        assert read_target_columns(connection, '"Orders"') == ["Id", "Unit Price"]

    def test_real_sqlite_missing_table_is_the_database_error(
        self, sqlite_db: Callable[..., Any]
    ) -> None:
        connection = sqlite_db("CREATE TABLE orders (id INTEGER)")
        with pytest.raises(apsw.SQLError, match=exact("no such table: nope")):
            read_target_columns(connection, "nope")

    def test_statement_and_names_through_a_fake(self) -> None:
        connection = FakeConnection([Result(columns=["id", "qty", "created_at"])])
        assert read_target_columns(connection, "orders") == ["id", "qty", "created_at"]
        assert connection.statements() == ["SELECT * FROM orders WHERE 1 = 0"]

    def test_schema_table_through_a_fake(self) -> None:
        connection = FakeConnection([Result(columns=["id"])])
        assert read_target_columns(connection, "app.orders") == ["id"]
        assert connection.statements() == ["SELECT * FROM app.orders WHERE 1 = 0"]


class TestQualifiedName:
    """(schema or None, object) as the database stores them: quotes gone, Oracle folds up."""

    @pytest.mark.parametrize(
        ("dialect", "name", "stored"),
        [
            ("postgresql", "app.orders", ("app", "orders")),
            ("postgresql", 'app."Orders"', ("app", "Orders")),
            ("postgresql", ' "a" . b ', ("a", "b")),
            ("oracle", "app.orders", ("APP", "ORDERS")),
            ("oracle", '"app"."Orders"', ("app", "Orders")),
            ("mysql", "`app`.`orders`", ("app", "orders")),
            ("mssql", "[dbo].[Orders]", ("dbo", "Orders")),
            ("sqlite", "orders", (None, "orders")),
        ],
    )
    def test_quotes_are_removed_and_oracle_folds_the_unquoted_parts(
        self, dialect: str, name: str, stored: tuple[str | None, str]
    ) -> None:
        assert qualified_name(dialect, name) == stored

    @pytest.mark.parametrize(
        ("dialect", "name", "stored"),
        [
            ("oracle", '"', (None, '"')),
            ("oracle", '"abc', (None, '"ABC')),
            ("mssql", '[abc"', (None, '[abc"')),
        ],
    )
    def test_a_quote_that_never_closes_is_part_of_the_name(
        self, dialect: str, name: str, stored: tuple[str | None, str]
    ) -> None:
        assert qualified_name(dialect, name) == stored


class TestReadPrimaryKey:
    """Empty Key columns means the table's primary key, read in key order."""

    def test_real_sqlite_single_key(self, sqlite_db: Callable[..., Any]) -> None:
        connection = sqlite_db("CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER)")
        assert read_primary_key(connection, "sqlite", "orders") == ["id"]

    def test_real_sqlite_composite_key_in_key_order(self, sqlite_db: Callable[..., Any]) -> None:
        connection = sqlite_db(
            "CREATE TABLE stock (qty INTEGER, region TEXT, id INTEGER, PRIMARY KEY (region, id))"
        )
        assert read_primary_key(connection, "sqlite", "stock") == ["region", "id"]

    def test_real_sqlite_no_key(self, sqlite_db: Callable[..., Any]) -> None:
        connection = sqlite_db("CREATE TABLE notes (body TEXT, author TEXT)")
        assert read_primary_key(connection, "sqlite", "notes") == []

    @pytest.mark.parametrize("dialect", NETWORK_TYPES)
    def test_first_column_of_each_row_through_a_fake(self, dialect: str) -> None:
        connection = FakeConnection([Result(columns=["column_name"], rows=[("id",), ("region",)])])
        assert read_primary_key(connection, dialect, "orders") == ["id", "region"]
        assert len(connection.executed) == 1

    @pytest.mark.parametrize("dialect", NETWORK_TYPES)
    def test_no_key_through_a_fake(self, dialect: str) -> None:
        connection = FakeConnection([Result(columns=["column_name"], rows=[])])
        assert read_primary_key(connection, dialect, "orders") == []


MIXED = envelope(
    [("id", "integer"), ("price", "float"), ("paid", "boolean"), ("note", "string")],
    [["42", "12.50", True, "007"], [7, "0.10", False, None], [None, None, None, "x"]],
)
MIXED_COLUMNS = ["id", "price", "paid", "note"]


class TestLoadValues:
    """Cells realized by the Table's column types; booleans are 1 / 0 on Oracle and SQL Server."""

    @pytest.mark.parametrize("dialect", BOOLEAN_AS_BOOL)
    def test_typed_cells_with_booleans_kept(self, dialect: str) -> None:
        expected = [
            (42, Decimal("12.50"), True, "007"),
            (7, Decimal("0.10"), False, None),
            (None, None, None, "x"),
        ]
        assert typed(load_values(dialect, MIXED, MIXED_COLUMNS)) == typed(expected)

    @pytest.mark.parametrize("dialect", BOOLEAN_AS_NUMBER)
    def test_typed_cells_with_booleans_as_numbers(self, dialect: str) -> None:
        expected = [
            (42, Decimal("12.50"), 1, "007"),
            (7, Decimal("0.10"), 0, None),
            (None, None, None, "x"),
        ]
        assert typed(load_values(dialect, MIXED, MIXED_COLUMNS)) == typed(expected)

    @pytest.mark.parametrize("dialect", ALL_TYPES)
    def test_one_tuple_per_row(self, dialect: str) -> None:
        values = load_values(dialect, MIXED, MIXED_COLUMNS)
        assert [type(row) for row in values] == [tuple, tuple, tuple]

    @pytest.mark.parametrize("dialect", ALL_TYPES)
    def test_float_cells_become_exact_decimals(self, dialect: str) -> None:
        table = envelope([("price", "float")], [["12.50"], [12.5], [3], [Decimal("1.50")]])
        expected = [(Decimal("12.50"),), (Decimal("12.5"),), (Decimal("3"),), (Decimal("1.50"),)]
        assert typed(load_values(dialect, table, ["price"])) == typed(expected)

    @pytest.mark.parametrize("dialect", ALL_TYPES)
    def test_integer_cells_from_text_or_numbers(self, dialect: str) -> None:
        table = envelope([("id", "integer")], [["42"], [42], ["12345678901234567890"]])
        expected = [(42,), (42,), (12345678901234567890,)]
        assert typed(load_values(dialect, table, ["id"])) == typed(expected)

    @pytest.mark.parametrize("dialect", ALL_TYPES)
    def test_string_cells_unchanged(self, dialect: str) -> None:
        table = envelope([("code", "string")], [["007"], ["12.50"], ["true"], [""]])
        expected = [("007",), ("12.50",), ("true",), ("",)]
        assert typed(load_values(dialect, table, ["code"])) == typed(expected)

    @pytest.mark.parametrize("dialect", ALL_TYPES)
    def test_none_stays_none_for_every_type(self, dialect: str) -> None:
        table = envelope(
            [("i", "integer"), ("f", "float"), ("b", "boolean"), ("s", "string")],
            [[None, None, None, None]],
        )
        assert load_values(dialect, table, ["i", "f", "b", "s"]) == [(None, None, None, None)]

    @pytest.mark.parametrize("dialect", ALL_TYPES)
    def test_column_order_follows_columns(self, dialect: str) -> None:
        table = envelope(
            [("id", "integer"), ("qty", "integer"), ("note", "string")],
            [[1, 5, "a"], [2, 7, "b"]],
        )
        assert load_values(dialect, table, ["note", "id"]) == [("a", 1), ("b", 2)]

    @pytest.mark.parametrize("dialect", ALL_TYPES)
    def test_no_rows(self, dialect: str) -> None:
        table = envelope([("id", "integer")], [])
        assert load_values(dialect, table, ["id"]) == []


class TestSqliteStatementsRun:
    """The built SQLite statements and values load a real table in each mode."""

    def test_add_then_add_or_replace_then_overwrite(self, sqlite_db: Callable[..., Any]) -> None:
        connection = sqlite_db(
            "CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER, paid BOOLEAN, note TEXT)"
        )
        columns = match_columns(
            ["id", "qty", "paid"], read_target_columns(connection, "orders"), "orders"
        )
        first = envelope(
            [("id", "integer"), ("qty", "integer"), ("paid", "boolean")],
            [["1", 5, True], [2, "7", False]],
        )
        connection.cursor().executemany(
            insert_statement("sqlite", "orders", columns), load_values("sqlite", first, columns)
        )
        assert fetched(connection, "SELECT * FROM orders ORDER BY id") == [
            (1, 5, 1, None),
            (2, 7, 0, None),
        ]

        second = envelope(
            [("id", "integer"), ("qty", "integer"), ("paid", "boolean")],
            [[1, 9, False], [3, 1, True]],
        )
        keys = read_primary_key(connection, "sqlite", "orders")
        connection.cursor().executemany(
            upsert_statement("sqlite", "orders", columns, keys),
            load_values("sqlite", second, columns),
        )
        assert fetched(connection, "SELECT * FROM orders ORDER BY id") == [
            (1, 9, 0, None),
            (2, 7, 0, None),
            (3, 1, 1, None),
        ]

        connection.cursor().execute(delete_statement("orders"))
        (row,) = fetched(connection, "SELECT COUNT(*) FROM orders")
        assert row == (0,)

    def test_every_column_a_key_keeps_the_existing_row(self, sqlite_db: Callable[..., Any]) -> None:
        connection = sqlite_db(
            "CREATE TABLE tags (name TEXT PRIMARY KEY)", "INSERT INTO tags VALUES ('red')"
        )
        table = envelope([("name", "string")], [["red"], ["blue"]])
        connection.cursor().executemany(
            upsert_statement("sqlite", "tags", ["name"], ["name"]),
            load_values("sqlite", table, ["name"]),
        )
        assert fetched(connection, "SELECT name FROM tags ORDER BY name") == [
            ("blue",),
            ("red",),
        ]
