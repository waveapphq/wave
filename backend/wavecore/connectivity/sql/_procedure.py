"""Call procedure: the call statement per database and the out signature (REQ-3.4.1.6 SQL-6)."""

from typing import Any, NamedTuple

from wavecore.connectivity.sql._load import qualified_name, quote_identifier


class Call(NamedTuple):
    setup: list[tuple[str, Any]]
    call: tuple[str, Any]
    fetch: tuple[str, Any] | None


_SIGNATURE = {
    "oracle": (
        "SELECT argument_name, data_type FROM all_arguments "
        "WHERE object_name = :name AND data_level = 0 AND argument_name IS NOT NULL "
        "AND ((package_name IS NULL "
        "AND owner = COALESCE(:qualifier, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'))) "
        "OR (package_name = :qualifier "
        "AND owner = COALESCE(:owner, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')))) "
        "ORDER BY overload, position"
    ),
    "mssql": (
        "SELECT p.name, CASE "
        "WHEN t.name IN ('varchar', 'char', 'varbinary', 'binary') THEN t.name + '(' + "
        "CASE WHEN p.max_length = -1 THEN 'max' ELSE CAST(p.max_length AS varchar(10)) END + ')' "
        "WHEN t.name IN ('nvarchar', 'nchar') THEN t.name + '(' + "
        "CASE WHEN p.max_length = -1 THEN 'max' ELSE CAST(p.max_length / 2 AS varchar(10)) END "
        "+ ')' "
        "WHEN t.name IN ('decimal', 'numeric') THEN t.name + '(' + "
        "CAST(p.precision AS varchar(10)) + ',' + CAST(p.scale AS varchar(10)) + ')' "
        "WHEN t.name IN ('datetime2', 'time', 'datetimeoffset') THEN t.name + '(' + "
        "CAST(p.scale AS varchar(10)) + ')' "
        "ELSE t.name END "
        "FROM sys.parameters AS p JOIN sys.types AS t ON t.user_type_id = p.user_type_id "
        "WHERE p.object_id = OBJECT_ID(%s) AND p.parameter_id > 0 ORDER BY p.parameter_id"
    ),
}


def _signature_binds(dialect: str, name: str) -> Any:
    if dialect == "mssql":
        return (name,)
    parts = [part.strip() for part in name.split(".")]
    owner = qualified_name(dialect, parts[0])[1] if len(parts) > 2 else None
    qualifier, procedure = qualified_name(dialect, ".".join(parts[-2:]))
    return {"name": procedure, "qualifier": qualifier, "owner": owner}


def read_signature(connection: Any, dialect: str, name: str) -> dict[str, str]:
    """{argument name: declared type} on Oracle and SQL Server; {} where no type is needed."""
    if dialect not in _SIGNATURE:
        return {}
    cursor = connection.cursor()
    cursor.execute(_SIGNATURE[dialect], _signature_binds(dialect, name))
    return {row[0]: row[1] for row in cursor.fetchall()}


def _named_call(dialect: str, name: str, arguments: list[tuple[str, Any]], outs: list[str]) -> Call:
    """PostgreSQL and Oracle: named notation; an out-only slot is NULL or a None bind."""
    given = {argument for argument, _value in arguments}
    slots = [*arguments, *[(out, None) for out in outs if out not in given]]
    parts: list[str] = []
    binds: list[Any] = []
    for argument, value in slots:
        if dialect == "postgresql" and argument not in given:
            parts.append(f"{argument} => NULL")
            continue
        binds.append(value)
        mark = f"${len(binds)}" if dialect == "postgresql" else f":{len(binds)}"
        parts.append(f"{argument} => {mark}")
    listed = ", ".join(parts)
    if dialect == "postgresql":
        return Call([], (f"CALL {name}({listed})", tuple(binds) or None), None)
    return Call([], (f"BEGIN {name}({listed}); END;", binds or None), None)


def function_select(name: str, arguments: list[tuple[str, Any]]) -> tuple[str, Any]:
    """PostgreSQL: a function called with its Arguments only; its OUT parameters are columns."""
    listed = ", ".join(
        f"{argument} => ${number}" for number, (argument, _value) in enumerate(arguments, 1)
    )
    binds = tuple(value for _argument, value in arguments)
    return f"SELECT * FROM {name}({listed})", binds or None


def _mysql_call(name: str, arguments: list[tuple[str, Any]], outs: list[str]) -> Call:
    """Positional; out values ride in session variables read back by one SELECT."""
    given = {argument for argument, _value in arguments}
    setup: list[tuple[str, Any]] = []
    parts: list[str] = []
    binds: list[Any] = []
    for argument, value in arguments:
        if argument in outs:
            setup.append((f"SET @wave_{argument} = %s", (value,)))
            parts.append(f"@wave_{argument}")
        else:
            binds.append(value)
            parts.append("%s")
    parts += [f"@wave_{out}" for out in outs if out not in given]
    read = ", ".join(f"@wave_{out} AS {quote_identifier('mysql', out)}" for out in outs)
    fetch = (f"SELECT {read}", None) if outs else None
    return Call(setup, (f"CALL {name}({', '.join(parts)})", tuple(binds) or None), fetch)


def _mssql_call(
    name: str, arguments: list[tuple[str, Any]], outs: list[str], signature: dict[str, str]
) -> Call:
    """EXEC with OUTPUT variables declared from the signature, read back by one SELECT."""
    types = {key.lstrip("@").lower(): value for key, value in signature.items()}
    values = {argument.lstrip("@"): value for argument, value in arguments}
    bare_outs = [out.lstrip("@") for out in outs]
    declares: list[str] = []
    declared: list[Any] = []
    for out in bare_outs:
        variable = f"@wave_{out} {types[out.lower()]}"
        if out in values:
            declared.append(values[out])
            variable += " = %s"
        declares.append(variable)
    parts: list[str] = []
    binds: list[Any] = []
    for argument, value in arguments:
        bare = argument.lstrip("@")
        if bare in bare_outs:
            parts.append(f"@{bare} = @wave_{bare} OUTPUT")
        else:
            binds.append(value)
            parts.append(f"@{bare} = %s")
    parts += [f"@{out} = @wave_{out} OUTPUT" for out in bare_outs if out not in values]
    statement = f"EXEC {name} {', '.join(parts)};" if parts else f"EXEC {name};"
    if bare_outs:
        read = ", ".join(f"@wave_{out} AS {quote_identifier('mssql', out)}" for out in bare_outs)
        statement = f"DECLARE {', '.join(declares)}; {statement} SELECT {read};"
    return Call([], (statement, tuple(declared + binds) or None), None)


def build_call(
    dialect: str,
    name: str,
    arguments: list[tuple[str, Any]],
    out_arguments: list[str],
    signature: dict[str, str],
) -> Call:
    """The statements that call `name` with Arguments in the author's order and read Out values."""
    if dialect == "mysql":
        return _mysql_call(name, arguments, out_arguments)
    if dialect == "mssql":
        return _mssql_call(name, arguments, out_arguments, signature)
    return _named_call(dialect, name, arguments, out_arguments)
