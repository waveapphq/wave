"""Get Tables: the tables and views of the schema a connection lands in (REQ-5.1.4 SQL-12)."""

from typing import Any

# Each query answers (schema, table, kind, column, column type) by table, then column position.
_QUERIES = {
    "postgresql": (
        "SELECT n.nspname, c.relname, "
        "CASE WHEN c.relkind IN ('v', 'm') THEN 'VIEW' ELSE 'TABLE' END, "
        "a.attname, format_type(a.atttypid, a.atttypmod) "
        "FROM pg_class AS c "
        "JOIN pg_namespace AS n ON n.oid = c.relnamespace "
        "JOIN pg_attribute AS a ON a.attrelid = c.oid "
        "WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p', 'v', 'm', 'f') "
        "AND a.attnum > 0 AND NOT a.attisdropped "
        "ORDER BY c.relname, a.attnum"
    ),
    "mysql": (
        "SELECT c.table_schema, c.table_name, t.table_type, c.column_name, c.column_type "
        "FROM information_schema.columns AS c "
        "JOIN information_schema.tables AS t "
        "ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
        "WHERE c.table_schema = DATABASE() "
        "ORDER BY c.table_name, c.ordinal_position"
    ),
    "oracle": (
        "SELECT c.owner, c.table_name, o.object_type, c.column_name, c.data_type "
        "FROM all_tab_columns c "
        "JOIN all_objects o ON o.owner = c.owner AND o.object_name = c.table_name "
        "AND o.object_type IN ('TABLE', 'VIEW') "
        "WHERE c.owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') "
        "ORDER BY c.table_name, c.column_id"
    ),
    "mssql": (
        "SELECT s.name, o.name, o.type_desc, c.name, TYPE_NAME(c.user_type_id) "
        "FROM sys.objects AS o "
        "JOIN sys.schemas AS s ON s.schema_id = o.schema_id "
        "JOIN sys.columns AS c ON c.object_id = o.object_id "
        "WHERE o.type IN ('U', 'V') AND s.name = SCHEMA_NAME() "
        "ORDER BY o.name, c.column_id"
    ),
    "sqlite": (
        "SELECT 'main', m.name, m.type, p.name, p.type "
        "FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p "
        "WHERE m.type IN ('table', 'view') AND substr(m.name, 1, 7) != 'sqlite_' "
        "ORDER BY m.name, p.cid"
    ),
}


def catalog_query(dialect: str) -> str:
    return _QUERIES[dialect]


def read_catalog(connection: Any, dialect: str) -> list[dict[str, Any]]:
    """The catalog rows grouped into tables and views, sorted by schema and name."""
    cursor = connection.cursor()
    cursor.execute(catalog_query(dialect))
    tables: dict[tuple[str, str], dict[str, Any]] = {}
    for schema, name, kind, column, column_type in cursor.fetchall():
        entry = tables.setdefault(
            (schema, name),
            {
                "schema": schema,
                "name": name,
                "kind": "view" if "view" in str(kind).lower() else "table",
                "columns": [],
            },
        )
        entry["columns"].append({"name": column, "type": column_type})
    return [tables[key] for key in sorted(tables)]
