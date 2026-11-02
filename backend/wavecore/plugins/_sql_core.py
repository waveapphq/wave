"""The SQL block's core, run on WAVE and on a remote host alike (REQ-3.4.1.6, REQ-5.1.4)."""

import csv
import importlib
import os
import re
import time
from collections.abc import Callable
from contextlib import suppress
from decimal import Decimal
from typing import Any, NamedTuple

from wavecore.connectivity.k8s.verbs._outputs import (
    block_failure,
    block_success,
    summary_table,
    typed_table,
)
from wavecore.connectivity.sql._errors import (
    TIMEOUT,
    UNSUPPORTED,
    VALIDATION,
    SqlFailure,
    load_failure,
    map_error,
    timeout_message,
)
from wavecore.connectivity.sql._load import (
    delete_statement,
    insert_statement,
    load_values,
    match_columns,
    read_primary_key,
    read_target_columns,
    upsert_statement,
)
from wavecore.connectivity.sql._params import bind_params
from wavecore.connectivity.sql._procedure import build_call, function_select, read_signature
from wavecore.connectivity.sql._split import CODE, OTHER, lex, session_state_word, split_script
from wavecore.connectivity.sql.dialects import Handle, dialect, oracle
from wavecore.plugins._held_run import Live, Stopped, held

# The bundle worker names the remote host before it dispatches a SQL block.
REMOTE_HOST: str | None = None

Log = Callable[[str, str], None]

_ACTIONS = {"run_sql": "Run SQL", "call_procedure": "Call procedure", "load_table": "Load table"}
_SCHEMES = ("testdata://", "artifact://")
_EXCEL_SUFFIXES = (".xlsx", ".xlsm")
# Oracle and SQL Server declare their out arguments' types in a catalog read before the call.
_SIGNED = ("oracle", "mssql")
_STATEMENT = {"phase": "statement"}
_SHOWN_LINE = 80
_LEADING_COMMENTS = re.compile(r"(?:\s+|--[^\n]*|/\*.*?\*/)*", re.DOTALL)


class _ResultSet(NamedTuple):
    columns: list[str]
    rows: list[Any]
    capped: bool


_NO_ROWS = _ResultSet([], [], False)


class _Bound(NamedTuple):
    number: int
    text: str
    statement: str
    binds: Any


class _Transaction(NamedTuple):
    delete: str | None
    batches: list[list[tuple[Any, ...]]]
    first_row: int
    first_batch: int


def _number(params: dict[str, Any], name: str, default: Any) -> Any:
    value = params.get(name)
    return default if value is None or value == "" else int(value)


def _flag(params: dict[str, Any], name: str, default: bool) -> bool:
    value = params.get(name)
    return default if value is None else bool(value)


def _text(params: dict[str, Any], name: str) -> str:
    value = params.get(name)
    return "" if value is None else str(value).strip()


def database_type_of(params: dict[str, Any]) -> str:
    """The block's database type; a blank row is PostgreSQL (SQL-8)."""
    return str(params.get("database_type") or "postgresql")


def _decoded(database_type: str, value: Any) -> Any:
    """A decimal envelope as its Decimal; SQLite binds a Decimal as its own number, a float."""
    if isinstance(value, dict) and value.get("__wave_type") == "decimal":
        value = Decimal(value["value"])
    return float(value) if database_type == "sqlite" and isinstance(value, Decimal) else value


class _Block:
    """The block's settings in effect, a blank row taking its default (SQL-8)."""

    def __init__(self, params: dict[str, Any]) -> None:
        self.params = params
        self.operation = str(params.get("operation") or "run_sql")
        self.database_type = database_type_of(params)
        self.module = dialect(self.database_type)
        self.timeout = _number(params, "timeout", 300)
        self.connect_timeout = _number(params, "connect_timeout", 30)
        self.max_rows = _number(params, "max_rows", 10000)
        self.batch_size = _number(params, "batch_size", 1000)
        self.stop_on_error = _flag(params, "stop_on_error", True)
        self.commit_each_batch = _flag(params, "commit_each_batch", False)
        self.mode = str(params.get("mode") or "add")
        self.procedure = _text(params, "procedure")
        self.target_table = _text(params, "target_table")
        network = self.database_type != "sqlite"
        # A null Driver option is left out, so the driver keeps its own default.
        options = {
            name: value
            for name, value in (params.get("driver_options") or {}).items()
            if value is not None
        }
        self.dsn = oracle.dsn_option(options) if self.database_type == "oracle" else ""
        host = _text(params, "host")
        port = params.get("port")
        self.rows: dict[str, Any] = {
            "host": host,
            "port": self.module.DEFAULT_PORT if port is None or port == "" else int(port),
            "database": _text(params, "database"),
            "username": _text(params, "username"),
            "password": params.get("password"),
            "file": _text(params, "file"),
            "file_read_only": params.get("file_read_only") is True,
            "tls": network and _flag(params, "tls", self.module.TLS_DEFAULT),
            "verify_ssl": _flag(params, "verify_ssl", True),
            "ca_cert": _text(params, "ca_cert") or None,
            "client_cert": _text(params, "client_cert") or None,
            "client_key": _text(params, "client_key") or None,
            "driver_options": options,
            "server_name": _text(params, "server_name") or host,
        }
        # The File as the block wrote it, when WAVE opens it under another path.
        self.file_shown = _text(params, "file_shown") or self.rows["file"]

    def where(self) -> str:
        """Where the block connects, as the Connected line names it."""
        if self.database_type == "sqlite":
            return str(self.rows["file"])
        return self.dsn or f"{self.rows['host']}:{self.rows['port']}"

    def connect_context(self) -> dict[str, Any]:
        rows = self.rows
        return {
            "phase": "connect",
            "host": rows["host"],
            "port": rows["port"],
            "username": rows["username"],
            "dsn": self.dsn or None,
            "file": self.file_shown,
        }


def require_file(path: str, message: str) -> None:
    """Refuse, with `message` and reason Validation, a file that is not there."""
    if not os.path.isfile(path):
        raise SqlFailure(message, VALIDATION)


def read_sql_file(path: str, shown: str) -> str:
    """A .sql file's text; one that is not there is named as the block wrote it."""
    require_file(path, f"SQL file not found: {shown}")
    with open(path, encoding="utf-8-sig") as handle:
        return handle.read()


def read_csv_table(path: str, shown: str) -> dict[str, Any]:
    """A CSV file as a table envelope: first row names, every column text, an empty cell NULL."""
    require_file(path, f"Table file not found: {shown}")
    with open(path, encoding="utf-8-sig", newline="") as handle:
        lines = list(csv.reader(handle))
    names = lines[0] if lines else []
    width = len(names)
    return {
        "__wave_type": "table",
        "columns": [{"name": name, "type": "string"} for name in names],
        "rows": [[cell or None for cell in (line + [""] * width)[:width]] for line in lines[1:]],
    }


def _empties(operation: str) -> dict[str, Any]:
    """What a recorded failure leaves in each output of the operation."""
    if operation == "run_sql":
        return {"rows": summary_table([], []), "row_count": 0, "rows_changed": 0}
    if operation == "call_procedure":
        return {"rows": summary_table([], []), "row_count": 0, "out_values": summary_table([], [])}
    return {"rows_changed": 0}


def _cannot_load(what: str, why: object) -> SqlFailure:
    """The refusal of a machine that cannot load what the block needs, in the loader's own words."""
    machine = "The WAVE host" if REMOTE_HOST is None else f"The remote host '{REMOTE_HOST}'"
    return SqlFailure(f"{machine} cannot load {what}: {why}", UNSUPPORTED)


def _require_bundled_sqlite() -> None:
    """Refuse a machine whose bundled SQLite does not import or cannot say its version."""
    try:
        importlib.import_module("apsw").sqlite_lib_version()
    except (ImportError, AttributeError) as exc:
        raise _cannot_load("WAVE's bundled SQLite", exc) from None


def _refuse_scheme(path: str) -> None:
    """A testdata:// or artifact:// reference that reached the core names a file only WAVE has."""
    if path.startswith(_SCHEMES):
        scheme = path.partition("://")[0]
        raise SqlFailure(f"{scheme}:// paths are not available on the remote host", VALIDATION)


def _refuse_before_connecting(block: _Block) -> None:
    """Unsupported, bundled SQLite, a WAVE-side SQLite file, then what only WAVE read (SQL-5)."""
    unsupported = block.params.get("unsupported")
    if unsupported:
        raise SqlFailure(str(unsupported), UNSUPPORTED)
    if block.database_type == "sqlite":
        _require_bundled_sqlite()
        _refuse_scheme(str(block.rows["file"]))
    if block.database_type == "sqlite" and block.operation == "call_procedure":
        raise SqlFailure("Operation 'Call procedure' is not available on SQLite", VALIDATION)
    file_error = block.params.get("wave_file_error")
    if file_error:
        raise SqlFailure(str(file_error), VALIDATION)


def _bound_script(block: _Block) -> list[_Bound]:
    """Every statement bound before anything connects, so an undefined name sends nothing."""
    params = block.params
    source = str(params.get("sql") or "")
    if (params.get("script_type") or "source") == "file":
        sql_file = _text(params, "sql_file")
        source = read_sql_file(sql_file, sql_file)
    kind = block.database_type
    parameters = {
        name: _decoded(kind, value) for name, value in (params.get("parameters") or {}).items()
    }
    bound: list[_Bound] = []
    for number, piece in enumerate(split_script(kind, source), 1):
        try:
            statement, binds = bind_params(kind, piece.text, parameters)
        except ValueError as exc:
            raise SqlFailure(str(exc), VALIDATION) from exc
        bound.append(_Bound(number, piece.text, statement, binds))
    return bound


def _load_source(block: _Block) -> dict[str, Any]:
    """The Table as an envelope; a path is read here as CSV, where the block runs (SQL-7)."""
    table = block.params.get("table")
    if isinstance(table, dict):
        return table
    path = str(table).strip()
    _refuse_scheme(path)
    if path.lower().endswith(_EXCEL_SUFFIXES):
        raise SqlFailure(
            f"{path} is an Excel file, which only WAVE can read: "
            "use a testdata:// or artifact:// file",
            VALIDATION,
        )
    return read_csv_table(path, path)


def _call_arguments(block: _Block) -> tuple[list[tuple[str, Any]], list[str]]:
    """Arguments in the author's order, and the out argument names in theirs (SQL-6)."""
    arguments = [
        (str(name), _decoded(block.database_type, value))
        for name, value in (block.params.get("arguments") or {}).items()
    ]
    return arguments, [str(out) for out in (block.params.get("out_arguments") or [])]


def _fetch(cursor: Any, max_rows: int) -> _ResultSet:
    names = [str(column[0]) for column in cursor.description]
    fetched = list(cursor.fetchall() if max_rows == 0 else cursor.fetchmany(max_rows + 1))
    return _ResultSet(names, fetched[: max_rows or None], len(fetched) > max_rows > 0)


def _drain(cursor: Any, max_rows: int) -> tuple[list[_ResultSet], int]:
    """Every result set of one execute, and the rows changed by the results without one."""
    sets: list[_ResultSet] = []
    changed = 0
    while True:
        if cursor.description is None:
            changed += max(cursor.rowcount, 0)
        else:
            sets.append(_fetch(cursor, max_rows))
        more = getattr(cursor, "nextset", None)
        if more is None or not more():
            return sets, changed


def _last(sets: list[_ResultSet]) -> _ResultSet:
    return sets[-1] if sets else _NO_ROWS


def _capped_line(max_rows: int) -> str:
    return f"Stopped after {max_rows} rows (Max rows)"


def _first_line(text: str) -> str:
    """The statement's first line after its leading comments, cut to 80 characters (SQL-5)."""
    line = _LEADING_COMMENTS.sub("", text, count=1).partition("\n")[0].strip()
    return line if len(line) <= _SHOWN_LINE else line[:_SHOWN_LINE] + "..."


def _last_statement(database_type: str, text: str) -> str:
    """The statement a piece ends on; a SQL Server batch holds several, split on `;` here."""
    if database_type != "mssql":
        return text
    begin = pending = 0
    for kind, start, end in lex(database_type, text):
        if kind == OTHER and text[start] == ";":
            pending = end
        elif kind in CODE:
            begin = pending
    return text[begin:]


class _Run:
    """One connected run: the block, its connection, the cancel it holds and its log."""

    def __init__(
        self, block: _Block, connection: Any, live: Live, log: Log, empties: dict[str, Any]
    ) -> None:
        self.block = block
        self.connection = connection
        self.live = live
        self.log = log
        self.empties = empties

    def execute(self, statement: str, binds: Any) -> tuple[list[_ResultSet], int]:
        cursor = self.connection.cursor()
        self.block.module.execute(cursor, statement, binds)
        return _drain(cursor, self.block.max_rows)


def _statement_line(bound: _Bound, sets: list[_ResultSet], changed: int, started: float) -> str:
    elapsed = int((time.monotonic() - started) * 1000)
    if sets:
        return f"Statement {bound.number}: {len(sets[-1].rows)} rows, {elapsed} ms"
    return f"Statement {bound.number}: {changed} rows changed, {elapsed} ms"


def _run_script(run: _Run, statements: list[_Bound]) -> dict[str, Any]:
    """Statements in order, each committing on its own (SQL-3, SQL-4)."""
    block = run.block
    kept = _NO_ROWS
    changed = failed = 0
    last_ran = False
    for bound in statements:
        run.live.check()
        started = time.monotonic()
        try:
            sets, count = run.execute(bound.statement, bound.binds)
        except Exception as exc:
            run.live.timed_out()
            message, reason = map_error(block.database_type, exc, _STATEMENT)
            level = "ERROR" if block.stop_on_error else "WARN"
            run.log(
                level, f"Statement {bound.number} ({_first_line(bound.text)}) failed: {message}"
            )
            if block.stop_on_error:
                raise SqlFailure(message, reason) from exc
            failed += 1
            last_ran = False
            continue
        last_ran = True
        changed += count
        run.log("INFO", _statement_line(bound, sets, count, started))
        if any(result.capped for result in sets):
            run.log("WARN", _capped_line(block.max_rows))
        kept = _last([kept, *sets])
    if failed and failed == len(statements):
        return {**block_success(run.empties), "__block_warning": True}
    if last_ran:
        _warn_session_state(run, statements[-1])
    return block_success(
        {
            "rows": typed_table(kept.columns, kept.rows),
            "row_count": len(kept.rows),
            "rows_changed": changed,
        }
    )


def _warn_session_state(run: _Run, last: _Bound) -> None:
    """A script that ends on USE, SET or ALTER SESSION: its effect ends with the block (SQL-3)."""
    keyword = session_state_word(_last_statement(run.block.database_type, last.text))
    if keyword:
        run.log(
            "WARN",
            f"Statement {last.number} ({keyword}) ends the script; its effect ends with the block",
        )


def _bare(name: str) -> str:
    """An argument name as the signature matches it: no `@`, any case."""
    return name.lstrip("@").lower()


def _out_variables(
    run: _Run, cursor: Any, arguments: list[tuple[str, Any]], outs: list[str], declared: Any
) -> dict[str, Any]:
    """Oracle's bind variables for the out arguments, of the types the signature declares."""
    given = dict(arguments)
    variables: dict[str, Any] = {}
    for out in outs:
        variable = run.block.module.out_variable(cursor, declared[_bare(out)])
        if out in given:
            variable.setvalue(0, given[out])
        variables[out] = variable
    return variables


def _with_variables(
    binds: Any, arguments: list[tuple[str, Any]], outs: list[str], variables: dict[str, Any]
) -> Any:
    """Oracle's call binds with each out slot holding its variable."""
    if not variables:
        return binds
    given = [name for name, _value in arguments]
    slots = [*given, *[out for out in outs if out not in given]]
    return [variables.get(name, value) for name, value in zip(slots, binds, strict=True)]


# A CALL naming a function: 42809 when it matches, 42883 when its OUT or TABLE columns do not.
_NOT_CALLABLE = ("42809", "42883")


def _pg_code(database_type: str, exc: BaseException) -> Any:
    """The SQLSTATE of a PostgreSQL server error, else None."""
    first = exc.args[0] if exc.args else None
    return first.get("C") if database_type == "postgresql" and isinstance(first, dict) else None


def _called(
    run: _Run, cursor: Any, call: tuple[str, Any], function: tuple[str, Any]
) -> tuple[list[_ResultSet], bool]:
    """The call's result sets, and whether they came from a function selected instead (SQL-6)."""
    module = run.block.module
    kind = run.block.database_type
    try:
        module.execute(cursor, *call)
    except Exception as exc:
        code = _pg_code(kind, exc)
        if code not in _NOT_CALLABLE:
            raise
        try:
            module.execute(cursor, *function)
        except Exception as selected:
            # No function by that name either: the CALL's own error says what is missing.
            if code == "42883" and _pg_code(kind, selected) in _NOT_CALLABLE:
                raise exc from None
            raise
        return _drain(cursor, run.block.max_rows)[0], True
    sets = _drain(cursor, run.block.max_rows)[0]
    if kind == "oracle":
        sets += [_fetch(result, run.block.max_rows) for result in module.implicit_results(cursor)]
    return sets, False


def _check_out_columns(result: _ResultSet, outs: list[str], routine: str) -> None:
    """Each out argument names a column the selected function returned."""
    returned = {_bare(column) for column in result.columns}
    for out in outs:
        if _bare(out) not in returned:
            raise SqlFailure(f"Out argument '{out}' is not a parameter of {routine}", VALIDATION)


def _named(result: _ResultSet, outs: list[str]) -> list[Any]:
    """Each out argument's value from the first row, by column name without regard to case."""
    row = result.rows[0] if result.rows else ()
    by_name = dict(zip([_bare(column) for column in result.columns], row, strict=False))
    return [by_name.get(_bare(out)) for out in outs]


def _out_table(outs: list[str], values: list[Any]) -> dict[str, Any]:
    if not outs:
        return summary_table([], [])
    return typed_table(outs, [values])


def _call_procedure(run: _Run, arguments: list[tuple[str, Any]], outs: list[str]) -> dict[str, Any]:
    """The procedure called the database's own way; Out values one typed row (SQL-6)."""
    block = run.block
    kind = block.database_type
    started = time.monotonic()
    signature = read_signature(run.connection, kind, block.procedure)
    declared = {_bare(name): text for name, text in signature.items()}
    for out in outs if kind in _SIGNED else []:
        if _bare(out) not in declared:
            message = f"Out argument '{out}' is not a parameter of {block.procedure}"
            raise SqlFailure(message, VALIDATION)
    call = build_call(kind, block.procedure, arguments, outs, signature)
    for statement, binds in call.setup:
        run.execute(statement, binds)
    cursor = run.connection.cursor()
    variables = _out_variables(run, cursor, arguments, outs, declared) if kind == "oracle" else {}
    statement, binds = call.call
    sets, selected = _called(
        run,
        cursor,
        (statement, _with_variables(binds, arguments, outs, variables)),
        function_select(block.procedure, arguments),
    )
    row_sets, source = sets, _NO_ROWS
    # A PostgreSQL function's OUT parameters are its result columns, read like a procedure's.
    if kind == "postgresql" and (not selected or outs):
        row_sets, source = [], _last(sets)
    if selected:
        _check_out_columns(source, outs, block.procedure)
    if kind == "mssql" and outs:
        row_sets, source = sets[:-1], _last(sets)
    if call.fetch is not None:
        source = _last(run.execute(*call.fetch)[0])
    values = [variable.getvalue() for variable in variables.values()] or _named(source, outs)
    kept = _last(row_sets)
    elapsed = int((time.monotonic() - started) * 1000)
    run.log(
        "INFO",
        f"Called {block.procedure}: {len(kept.rows)} rows, {len(outs)} out values, {elapsed} ms",
    )
    if kept.capped:
        run.log("WARN", _capped_line(block.max_rows))
    return block_success(
        {
            "rows": typed_table(kept.columns, kept.rows),
            "row_count": len(kept.rows),
            "out_values": _out_table(outs, values),
        }
    )


def _matched(names: list[str], target_columns: list[str], table: str) -> list[str]:
    try:
        return match_columns(names, target_columns, table)
    except ValueError as exc:
        raise SqlFailure(str(exc), VALIDATION) from exc


def _key_columns(run: _Run, target_columns: list[str], matched: list[str]) -> list[str]:
    """Key columns as given, else the primary key; each must be among the Table's (SQL-7)."""
    block = run.block
    table = block.target_table
    given = [name.strip() for name in _text(block.params, "key_columns").split(",") if name.strip()]
    keys = (
        _matched(given, target_columns, table)
        if given
        else read_primary_key(run.connection, block.database_type, table)
    )
    if not keys:
        raise SqlFailure(f"Key columns are required: {table} has no primary key", VALIDATION)
    for label, key in zip(given or keys, keys, strict=True):
        if key not in matched:
            raise SqlFailure(f"Key column '{label}' is not among the Table's columns", VALIDATION)
    return keys


def _refused_row(
    run: _Run, statement: str, delete: str | None, rows: list[Any], first: int, cause: Exception
) -> SqlFailure:
    """Send the failed rows again one at a time to name the refused one, then roll back (SQL-7)."""
    kind = run.block.database_type
    cursor = run.connection.cursor()
    try:
        if delete is not None:
            cursor.execute(delete)
        for number, row in enumerate(rows, first):
            try:
                cursor.executemany(statement, [row])
            except Exception as exc:
                message, reason = map_error(kind, exc, _STATEMENT)
                return SqlFailure(f"Row {number}: {message}", reason)
    finally:
        run.connection.rollback()
    return SqlFailure(*map_error(kind, cause, _STATEMENT))


def _batch_line(number: int, total: int, batch: list[tuple[Any, ...]]) -> str:
    return f"batch {number}/{total}: {len(batch)} rows"


def _send(run: _Run, statement: str, total: int, transaction: _Transaction, each: bool) -> None:
    """One transaction; a batch that commits alone is logged once its commit stands (SQL-7)."""
    cursor = run.connection.cursor()
    if transaction.delete is not None:
        cursor.execute(transaction.delete)
    for number, batch in enumerate(transaction.batches, transaction.first_batch):
        run.live.check()
        cursor.executemany(statement, batch)
        if not each:
            run.log("INFO", _batch_line(number, total, batch))
    run.connection.commit()
    if each:
        [batch] = transaction.batches
        run.log("INFO", _batch_line(transaction.first_batch, total, batch))


def _transactions(
    batches: list[list[tuple[Any, ...]]], delete: str | None, size: int, each: bool
) -> list[_Transaction]:
    """One transaction for the whole load, or one per batch with the delete in the first."""
    if not each:
        return [_Transaction(delete, batches, 1, 1)]
    return [
        _Transaction(delete if index == 0 else None, [batch], index * size + 1, index + 1)
        for index, batch in enumerate(batches)
    ]


def _load_rows(
    run: _Run, statement: str, transactions: list[_Transaction], total: int, each: bool
) -> tuple[int, bool]:
    """Rows committed, and whether every batch failed with Stop on error off."""
    committed = failed = 0
    for transaction in transactions:
        try:
            _send(run, statement, total, transaction, each)
        except Stopped:
            raise
        except Exception as exc:
            run.connection.rollback()
            if not each:
                run.log("INFO", f"Transaction rolled back: 0 rows into {run.block.target_table}")
            run.live.timed_out()
            rows = [row for batch in transaction.batches for row in batch]
            failure = _refused_row(
                run, statement, transaction.delete, rows, transaction.first_row, exc
            )
            if not each or run.block.stop_on_error:
                raise failure from exc
            run.log("WARN", f"batch {transaction.first_batch}/{total} failed: {failure.message}")
            failed += 1
            continue
        committed += sum(len(batch) for batch in transaction.batches)
        run.empties["rows_changed"] = committed
    return committed, failed > 0 and failed == len(transactions)


def _load_table(run: _Run, table: dict[str, Any]) -> dict[str, Any]:
    """The Table into the target: columns matched first, then batches (SQL-7)."""
    block = run.block
    kind = block.database_type
    target = block.target_table
    started = time.monotonic()
    target_columns = read_target_columns(run.connection, target)
    names = [str(column["name"]) for column in table["columns"]]
    matched = _matched(names, target_columns, target)
    replacing = block.mode == "add_or_replace"
    keys = _key_columns(run, target_columns, matched) if replacing else []
    statement = (
        upsert_statement(kind, target, matched, keys)
        if replacing
        else insert_statement(kind, target, matched)
    )
    run.log("DEBUG", statement)
    values = [
        tuple(_decoded(kind, cell) for cell in row) for row in load_values(kind, table, names)
    ]
    size = block.batch_size
    batches = [values[start : start + size] for start in range(0, len(values), size)]
    delete = delete_statement(target) if block.mode == "overwrite" else None
    each = block.commit_each_batch and bool(batches)
    transactions = _transactions(batches, delete, size, each)
    committed, amber = _load_rows(run, statement, transactions, len(batches), each)
    run.log("INFO", f"{committed} rows into {target}, {time.monotonic() - started:.1f} s")
    outputs = block_success({"rows_changed": committed})
    return {**outputs, "__block_warning": True} if amber else outputs


def _operate(run: _Run, work: Any) -> dict[str, Any]:
    block = run.block
    if block.operation == "run_sql":
        return _run_script(run, work)
    if block.operation == "call_procedure":
        return _call_procedure(run, *work)
    return _load_table(run, work)


def _prepared_work(block: _Block) -> Any:
    """What the operation sends, settled before anything connects."""
    if block.operation == "run_sql":
        return _bound_script(block)
    if block.operation == "call_procedure":
        return _call_arguments(block)
    return _load_source(block)


def _live(block: _Block) -> Live:
    """The run's connection as Stop and the deadline reach it (REQ-3.2.2.4, SQL-5)."""

    def cancel(connection: Any) -> None:
        handle = Handle(block.database_type, block.rows, block.connect_timeout)
        handle.connection = connection
        block.module.cancel(handle)

    return Live(block.timeout, cancel, lambda: SqlFailure(timeout_message(block.timeout), TIMEOUT))


def _connected(block: _Block, work: Any, empties: dict[str, Any], log: Log) -> dict[str, Any]:
    """Connect under the deadline with the cancel held, run the operation, close (SQL-13)."""
    connection = None
    try:
        with held(_live(block)) as live:
            try:
                connection = block.module.connect(block.rows, block.connect_timeout)
            except Exception as exc:
                live.timed_out()
                # A dialect imports its driver as it connects; one that does not load dials nothing.
                unloaded = load_failure(block.database_type, exc)
                if unloaded is not None:
                    raise _cannot_load(f"the {block.module.NAME} driver", unloaded) from exc
                raise SqlFailure(
                    *map_error(block.database_type, exc, block.connect_context())
                ) from exc
            # A connection that arrives after the end is closed unused, with no cancel sent.
            with live.lock:
                live.check()
                live.attach(connection)
            run = _Run(block, connection, live, log, empties)
            try:
                version = block.module.server_version(connection)
                log("INFO", f"Connected to {block.module.NAME} {version} at {block.where()}")
                block.module.autocommit(connection, block.operation != "load_table")
                outputs = _operate(run, work)
            except Stopped:
                raise
            except Exception as exc:
                live.timed_out()
                raise SqlFailure(*map_error(block.database_type, exc, _STATEMENT)) from exc
            live.timed_out()
            return outputs
    finally:
        if connection is not None:
            with suppress(Exception):
                connection.close()


def run(params: dict[str, Any], log: Log) -> dict[str, Any]:
    """Run the block and answer the result envelope; a failure follows On error (SQL-5)."""
    block = _Block(params)
    empties = _empties(block.operation)
    try:
        _refuse_before_connecting(block)
        outputs = _connected(block, _prepared_work(block), empties, log)
    except SqlFailure as failure:
        outputs = block_failure(
            params,
            empties,
            failure.message,
            failure.reason,
            log,
            action=_ACTIONS[block.operation],
        )
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}
