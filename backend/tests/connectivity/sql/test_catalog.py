"""Get Tables: the landing-schema catalog query and its grouping (REQ-5.1.4, SQL-12).

The catalog read lists the tables and views with their columns for the schema the
connection lands in, read through the database's own notion of that schema.
"""

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from tests.connectivity.sql.fakes import FakeConnection, Result, sqlite_file
from wavecore.connectivity.sql._catalog import catalog_query, read_catalog
from wavecore.connectivity.sql.dialects import sqlite

ALL_TYPES = ("postgresql", "mysql", "oracle", "mssql", "sqlite")
CATALOG_COLUMNS = ["table_schema", "table_name", "table_type", "column_name", "data_type"]
SQLITE_SCHEMA = (
    "CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, qty INTEGER NOT NULL, note TEXT)",
    "CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(40), balance NUMERIC(10,2))",
    "CREATE INDEX orders_qty ON orders (qty)",
    "CREATE VIEW big_orders AS SELECT id, qty FROM orders WHERE qty > 10",
    "CREATE TRIGGER orders_note AFTER INSERT ON orders "
    "BEGIN UPDATE orders SET note = 'new' WHERE id = new.id; END",
    "INSERT INTO orders (qty) VALUES (12)",
)


def squeezed(text: str) -> str:
    """SQL text without whitespace, lowercased, for naming checks that ignore layout and case."""
    return re.sub(r"\s+", "", text).lower()


def fake(rows: list[tuple[Any, ...]]) -> FakeConnection:
    return FakeConnection([Result(columns=CATALOG_COLUMNS, rows=rows)])


def table(schema: str, name: str, kind: str, *columns: tuple[str, str]) -> dict[str, Any]:
    return {
        "schema": schema,
        "name": name,
        "kind": kind,
        "columns": [{"name": column, "type": column_type} for column, column_type in columns],
    }


def sqlite_connection(path: Path) -> Any:
    """The SQLite dialect's read-write connection on the file at `path`."""
    rows = {"file": str(path), "file_read_only": False, "driver_options": {}}
    return sqlite.connect(rows, 1)


@pytest.fixture
def sqlite_catalog_db(tmp_path: Path) -> Iterator[Any]:
    connection = sqlite_connection(sqlite_file(tmp_path / "t.db", *SQLITE_SCHEMA))
    yield connection
    connection.close()


class TestCatalogQuery:
    """Each type reads the schema the connection lands in through the database's own function."""

    @pytest.mark.parametrize(
        ("dialect", "landing"),
        [
            ("postgresql", "current_schema()"),
            ("mysql", "DATABASE()"),
            ("oracle", "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')"),
            ("mssql", "SCHEMA_NAME()"),
        ],
    )
    def test_landing_schema_function(self, dialect: str, landing: str) -> None:
        assert squeezed(landing) in squeezed(catalog_query(dialect))

    def test_sqlite_joins_the_master_table_with_its_columns(self) -> None:
        query = squeezed(catalog_query("sqlite"))
        assert "sqlite_master" in query
        assert "pragma_table_info" in query

    def test_sqlite_rows_are_schema_table_kind_column_type(self, sqlite_catalog_db: Any) -> None:
        cursor = sqlite_catalog_db.cursor()
        cursor.execute(catalog_query("sqlite"))
        found = cursor.fetchall()
        assert {len(row) for row in found} == {5}
        assert {row[0] for row in found} == {"main"}
        assert [(row[1], row[3], row[4]) for row in found] == [
            ("big_orders", "id", "INTEGER"),
            ("big_orders", "qty", "INTEGER"),
            ("customers", "id", "INTEGER"),
            ("customers", "name", "VARCHAR(40)"),
            ("customers", "balance", "NUMERIC(10,2)"),
            ("orders", "id", "INTEGER"),
            ("orders", "qty", "INTEGER"),
            ("orders", "note", "TEXT"),
        ]
        views = {row[1] for row in found if "view" in row[2].lower()}
        assert views == {"big_orders"}


class TestReadCatalog:
    """Rows group into tables and views, sorted by schema and name, columns in row order."""

    @pytest.mark.parametrize("dialect", ALL_TYPES)
    def test_groups_rows_into_tables_and_views(self, dialect: str) -> None:
        connection = fake(
            [
                ("public", "orders", "BASE TABLE", "id", "integer"),
                ("public", "orders", "BASE TABLE", "qty", "integer"),
                ("public", "orders", "BASE TABLE", "created_at", "timestamp without time zone"),
                ("public", "active_orders", "VIEW", "id", "integer"),
                ("public", "customers", "BASE TABLE", "name", "character varying(40)"),
                ("public", "customers", "BASE TABLE", "id", "integer"),
            ]
        )
        assert read_catalog(connection, dialect) == [
            table("public", "active_orders", "view", ("id", "integer")),
            table(
                "public", "customers", "table", ("name", "character varying(40)"), ("id", "integer")
            ),
            table(
                "public",
                "orders",
                "table",
                ("id", "integer"),
                ("qty", "integer"),
                ("created_at", "timestamp without time zone"),
            ),
        ]
        assert connection.statements() == [catalog_query(dialect)]

    def test_sorted_by_schema_then_name(self) -> None:
        connection = fake(
            [
                ("zeta", "accounts", "TABLE", "id", "NUMBER"),
                ("alpha", "zones", "TABLE", "id", "NUMBER"),
                ("alpha", "areas", "TABLE", "id", "NUMBER"),
            ]
        )
        found = read_catalog(connection, "oracle")
        assert [(entry["schema"], entry["name"]) for entry in found] == [
            ("alpha", "areas"),
            ("alpha", "zones"),
            ("zeta", "accounts"),
        ]

    @pytest.mark.parametrize(
        ("kind", "normalized"),
        [
            ("BASE TABLE", "table"),
            ("TABLE", "table"),
            ("table", "table"),
            ("VIEW", "view"),
            ("view", "view"),
            ("SYSTEM VIEW", "view"),
        ],
    )
    def test_kind_normalized(self, kind: str, normalized: str) -> None:
        connection = fake([("app", "t", kind, "id", "int")])
        assert read_catalog(connection, "mysql") == [table("app", "t", normalized, ("id", "int"))]

    @pytest.mark.parametrize("dialect", ALL_TYPES)
    def test_empty_schema(self, dialect: str) -> None:
        assert read_catalog(fake([]), dialect) == []


class TestReadCatalogOnSqlite:
    """Real SQLite: tables and views of `main` with declared types, no internal tables."""

    def test_tables_and_views_with_declared_types(self, sqlite_catalog_db: Any) -> None:
        assert read_catalog(sqlite_catalog_db, "sqlite") == [
            table("main", "big_orders", "view", ("id", "INTEGER"), ("qty", "INTEGER")),
            table(
                "main",
                "customers",
                "table",
                ("id", "INTEGER"),
                ("name", "VARCHAR(40)"),
                ("balance", "NUMERIC(10,2)"),
            ),
            table(
                "main", "orders", "table", ("id", "INTEGER"), ("qty", "INTEGER"), ("note", "TEXT")
            ),
        ]

    def test_empty_database(self, tmp_path: Path) -> None:
        connection = sqlite_connection(tmp_path / "empty.db")
        try:
            assert read_catalog(connection, "sqlite") == []
        finally:
            connection.close()
