"""Load table: quoting, column matching, the statements and the values (REQ-3.4.1.6 SQL-7)."""

from decimal import Decimal
from typing import Any

from wavecore.connectivity.sql.dialects import dialect as dialect_module

_QUOTES = {"mysql": ("`", "`"), "mssql": ("[", "]")}
_NAME_QUOTES = {'"': '"', "`": "`", "[": "]"}
_PERCENT_TYPES = frozenset({"mysql", "mssql"})
_BOOLEAN_AS_NUMBER = frozenset({"oracle", "mssql"})

_PRIMARY_KEY = {
    "postgresql": (
        "SELECT a.attname FROM pg_index AS i "
        "JOIN pg_attribute AS a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
        "WHERE i.indrelid = %s::regclass AND i.indisprimary "
        "ORDER BY array_position(i.indkey, a.attnum)"
    ),
    "mysql": (
        "SELECT column_name FROM information_schema.key_column_usage "
        "WHERE constraint_name = 'PRIMARY' AND table_name = %s "
        "AND table_schema = COALESCE(%s, DATABASE()) ORDER BY ordinal_position"
    ),
    "oracle": (
        "SELECT cc.column_name FROM all_constraints c "
        "JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name "
        "WHERE c.constraint_type = 'P' AND c.table_name = :name "
        "AND c.owner = COALESCE(:owner, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')) "
        "ORDER BY cc.position"
    ),
    "mssql": (
        "SELECT c.name FROM sys.indexes AS i "
        "JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id "
        "JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id "
        "WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(%s) ORDER BY ic.key_ordinal"
    ),
    "sqlite": "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk",
}


def quote_identifier(dialect: str, name: str) -> str:
    """The name as a quoted identifier, its own closing quote doubled."""
    opening, closing = _QUOTES.get(dialect, ('"', '"'))
    return f"{opening}{name.replace(closing, closing * 2)}{closing}"


def qualified_name(dialect: str, name: str) -> tuple[str | None, str]:
    """(schema or None, object) as the database stores them; Oracle folds unquoted names up."""
    parts = [_stored_part(dialect, part.strip()) for part in name.split(".")]
    return (parts[-2] if len(parts) > 1 else None), parts[-1]


def _stored_part(dialect: str, part: str) -> str:
    closing = _NAME_QUOTES.get(part[:1], "")
    if closing and len(part) > 1 and part.endswith(closing):
        return part[1:-1]
    return part.upper() if dialect == "oracle" else part


def match_columns(wave_columns: list[str], target_columns: list[str], table: str) -> list[str]:
    """The target's spelling of each WAVE column: exact first, else one case-insensitive match."""
    matched: list[str] = []
    for column in wave_columns:
        candidates = [t for t in target_columns if t.lower() == column.lower()]
        exact = [t for t in candidates if t == column]
        spelling = exact or candidates
        if len(spelling) != 1:
            raise ValueError(f"Column '{column}' is not in {table}")
        matched.append(spelling[0])
    return matched


def _column_list(dialect: str, columns: list[str]) -> list[str]:
    quoted = [quote_identifier(dialect, column) for column in columns]
    return [q.replace("%", "%%") for q in quoted] if dialect in _PERCENT_TYPES else quoted


def _placeholders(dialect: str, count: int) -> list[str]:
    return [dialect_module(dialect).placeholder(index) for index in range(1, count + 1)]


def insert_statement(dialect: str, table: str, columns: list[str]) -> str:
    names = ", ".join(_column_list(dialect, columns))
    values = ", ".join(_placeholders(dialect, len(columns)))
    return f"INSERT INTO {table} ({names}) VALUES ({values})"


def upsert_statement(dialect: str, table: str, columns: list[str], key_columns: list[str]) -> str:
    """Insert, or replace the row whose key columns match (Add or replace)."""
    quoted = dict(zip(columns, _column_list(dialect, columns), strict=True))
    keys = [quoted[column] for column in key_columns]
    others = [quoted[column] for column in columns if column not in key_columns]
    if dialect in ("oracle", "mssql"):
        return _merge_statement(dialect, table, list(quoted.values()), keys, others)
    insert = insert_statement(dialect, table, columns)
    if dialect == "mysql":
        updated = others or keys
        assignments = ", ".join(f"{name} = VALUES({name})" for name in updated)
        return f"{insert} ON DUPLICATE KEY UPDATE {assignments}"
    excluded = "EXCLUDED" if dialect == "postgresql" else "excluded"
    action = "DO NOTHING"
    if others:
        action = "DO UPDATE SET " + ", ".join(f"{name} = {excluded}.{name}" for name in others)
    return f"{insert} ON CONFLICT ({', '.join(keys)}) {action}"


def _merge_statement(
    dialect: str, table: str, names: list[str], keys: list[str], others: list[str]
) -> str:
    marks = _placeholders(dialect, len(names))
    selected = ", ".join(f"{mark} AS {name}" for mark, name in zip(marks, names, strict=True))
    source = (
        f"(SELECT {selected} FROM dual) s" if dialect == "oracle" else f"(SELECT {selected}) AS s"
    )
    target = "d" if dialect == "oracle" else "AS d"
    on = " AND ".join(f"d.{key} = s.{key}" for key in keys)
    matched = ""
    if others:
        updates = ", ".join(f"d.{name} = s.{name}" for name in others)
        matched = f" WHEN MATCHED THEN UPDATE SET {updates}"
    inserted = ", ".join(f"s.{name}" for name in names)
    end = "" if dialect == "oracle" else ";"
    return (
        f"MERGE INTO {table} {target} USING {source} ON ({on}){matched} "
        f"WHEN NOT MATCHED THEN INSERT ({', '.join(names)}) VALUES ({inserted}){end}"
    )


def delete_statement(table: str) -> str:
    return f"DELETE FROM {table}"


def read_target_columns(connection: Any, table: str) -> list[str]:
    """The target's columns in table order, from an empty SELECT's description."""
    cursor = connection.cursor()
    cursor.execute(f"SELECT * FROM {table} WHERE 1 = 0")
    return [column[0] for column in cursor.description]


def _primary_key_binds(dialect: str, table: str) -> Any:
    schema, name = qualified_name(dialect, table)
    binds: dict[str, Any] = {
        "postgresql": (table,),
        "mysql": (name, schema),
        "oracle": {"name": name, "owner": schema},
        "mssql": (table,),
        "sqlite": (name,),
    }
    return binds[dialect]


def read_primary_key(connection: Any, dialect: str, table: str) -> list[str]:
    """The table's primary key columns in key order; [] when it has none."""
    cursor = connection.cursor()
    cursor.execute(_PRIMARY_KEY[dialect], _primary_key_binds(dialect, table))
    return [row[0] for row in cursor.fetchall()]


def _cell(dialect: str, kind: str, cell: Any) -> Any:
    if cell is None:
        return None
    if kind == "float":
        return Decimal(str(cell))
    if kind == "integer":
        return int(cell)
    if kind == "boolean":
        return int(bool(cell)) if dialect in _BOOLEAN_AS_NUMBER else bool(cell)
    return cell


def load_values(dialect: str, table: dict[str, Any], columns: list[str]) -> list[tuple[Any, ...]]:
    """One tuple per Table row in `columns` order, each cell realized by its column type."""
    names = [column["name"] for column in table["columns"]]
    kinds = [column["type"] for column in table["columns"]]
    picked = [names.index(column) for column in columns]
    return [
        tuple(_cell(dialect, kinds[index], row[index]) for index in picked) for row in table["rows"]
    ]
