"""SQL Plugin: runs SQL, calls procedures and loads tables on five databases (REQ-3.4.1.6)."""

import os
from decimal import Decimal
from functools import partial
from typing import Any

from wavecore.connectivity.sql._errors import VALIDATION, SqlFailure
from wavecore.connectivity.sql.dialects import dialect
from wavecore.core.execution.plugin_executor import check_entry_nulls
from wavecore.core.number_rule import is_integer_value
from wavecore.core.table import Table
from wavecore.core.table_values import as_table
from wavecore.plugins import _sql_core
from wavecore.plugins._file_paths import (
    has_plugin_scheme,
    resolve_plugin_path,
    scheme_relative_path,
)
from wavecore.plugins._ports import check_port
from wavecore.plugins._shared_params import (
    blank,
    check_at_least,
    check_boolean,
    check_integer,
    chosen,
    gate,
    on_error_parameter,
    output_core,
    select_parameter,
    timeout_parameter,
)
from wavecore.plugins._ssh_session import resolve_tunnel
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase
from wavecore.plugins.excel_parser import ExcelParserPlugin

_NETWORK_TYPES = ["postgresql", "mysql", "oracle", "mssql"]
# Each select's wire values in order, then its default.
_CHOICES: dict[str, tuple[list[str], str]] = {
    "operation": (["run_sql", "call_procedure", "load_table"], "run_sql"),
    "database_type": ([*_NETWORK_TYPES, "sqlite"], "postgresql"),
    "script_type": (["source", "file"], "source"),
    "mode": (["add", "add_or_replace", "overwrite"], "add"),
    "on_error": (["fail", "record"], "fail"),
}
_EXCEL_SUFFIXES = (".xlsx", ".xlsm")
_REASONS = (
    "Why the block failed: Unreachable, AuthFailed, DatabaseError, Timeout, Validation or "
    "Unsupported; empty otherwise"
)

_select = partial(select_parameter, _CHOICES)
_choice = partial(chosen, _CHOICES)


_NET = gate("database_type", *_NETWORK_TYPES)
_SQLITE = gate("database_type", "sqlite")
_RUN = gate("operation", "run_sql")
_CALL = gate("operation", "call_procedure")
_LOAD = gate("operation", "load_table")
_RUN_OR_CALL = gate("operation", "run_sql", "call_procedure")
_TLS = gate("tls", "true")


def _has_dsn(params: dict[str, Any], database_type: str) -> bool:
    """An Oracle block whose Driver options name a dsn, which stands in for Host and Database."""
    options = params.get("driver_options") or {}
    return database_type == "oracle" and not blank(options.get("dsn"))


def tls_on(params: dict[str, Any], database_type: str) -> bool:
    """TLS as set, or the database type's own default; SQLite has no network, so none."""
    tls = params.get("tls")
    on = dialect(database_type).TLS_DEFAULT if tls is None else tls is True
    return database_type != "sqlite" and on


def _check_connection(params: dict[str, Any], database_type: str) -> None:
    network = database_type != "sqlite"
    dsn = _has_dsn(params, database_type)
    needed = "host" if network else "file"
    if blank(params.get(needed)) and not dsn:
        raise ValueError("Set a Host or a File")
    for name in ("database", "username") if network else ():
        if blank(params.get(name)) and not (dsn and name == "database"):
            raise ValueError(f"Missing required parameter: {name}")


def _operation_rows(operation: str, script_type: str) -> tuple[str, ...]:
    if operation == "run_sql":
        return ("sql",) if script_type == "source" else ("sql_file",)
    if operation == "call_procedure":
        return ("procedure",)
    return ("table", "target_table")


def _check_types(params: dict[str, Any], operation: str, database_type: str) -> None:
    network = database_type != "sqlite"
    loading = operation == "load_table"
    integers = [
        *(["port"] if network else []),
        "timeout",
        "connect_timeout",
        "batch_size" if loading else "max_rows",
    ]
    for name in integers:
        check_integer(params, name)
    stopping = operation == "run_sql" or (loading and params.get("commit_each_batch") is True)
    switches = [
        *(["stop_on_error"] if stopping else []),
        *(["tls"] if network else []),
        *(["verify_ssl"] if tls_on(params, database_type) else []),
        *(["commit_each_batch"] if loading else []),
    ]
    for name in switches:
        check_boolean(params, name)


def _check_bounds(params: dict[str, Any], operation: str, database_type: str) -> None:
    port = params.get("port")
    if database_type != "sqlite" and is_integer_value(port):
        check_port("port", port, 1)
    check_at_least(params, "timeout", 1, "Timeout must be at least 1")
    check_at_least(params, "connect_timeout", 1, "Connect timeout must be at least 1")
    if operation == "load_table":
        check_at_least(params, "batch_size", 1, "Batch size must be at least 1")
    else:
        check_at_least(params, "max_rows", 0, "Max rows must be 0 or more")


def _folders(context: dict[str, Any]) -> tuple[str | None, list[str] | None]:
    return context.get("artifacts_dir"), context.get("testdata_dirs")


def _resolved(reference: str, folders: tuple[str | None, list[str] | None], message: str) -> str:
    """The path a reference names on WAVE; a Test Data file that is not there fails with it."""
    try:
        path = resolve_plugin_path(reference, *folders, read_only_ok=True)
    except FileNotFoundError as exc:
        raise SqlFailure(message, VALIDATION) from exc
    return str(path)


def _read_script(core: dict[str, Any], folders: tuple[str | None, list[str] | None]) -> None:
    reference = str(core.pop("sql_file")).strip()
    path = _resolved(reference, folders, f"SQL file not found: {reference}")
    core["sql"] = _sql_core.read_sql_file(path, reference)
    core["script_type"] = "source"


def _read_table(reference: str, folders: tuple[str | None, list[str] | None]) -> dict[str, Any]:
    """A CSV or Excel file read on WAVE as a table envelope (SQL-7)."""
    message = f"Table file not found: {reference}"
    path = _resolved(reference, folders, message)
    if not path.lower().endswith(_EXCEL_SUFFIXES):
        return _sql_core.read_csv_table(path, reference)
    _sql_core.require_file(path, message)
    context: dict[str, Any] = {
        "artifacts_dir": folders[0],
        "testdata_dirs": folders[1],
        "variables": {},
    }
    table: Table = ExcelParserPlugin().read_workbook({"workbook": path}, context)["table"]
    return _table_envelope(table)


def _table_envelope(table: Table) -> dict[str, Any]:
    return {"__wave_type": "table", **table.to_dict()}


def _read_here(reference: str, plain_paths: bool) -> bool:
    return plain_paths or has_plugin_scheme(reference)


def read_wave_files(
    params: dict[str, Any],
    artifacts_dir: str | None,
    testdata_dirs: list[str] | None,
    *,
    plain_paths: bool,
) -> dict[str, Any]:
    """The block with its SQL File and Table read on WAVE; plain paths only when asked."""
    core = dict(params)
    # The Out arguments list stores {value: name} rows; the core takes the names.
    core["out_arguments"] = [row.get("value") for row in params.get("out_arguments") or []]
    folders = (artifacts_dir, testdata_dirs)
    operation = core.get("operation") or "run_sql"
    sql_file = str(core.get("sql_file") or "").strip()
    table = core.get("table")
    realized = as_table(table)
    try:
        if operation == "run_sql" and core.get("script_type") == "file":
            if _read_here(sql_file, plain_paths):
                _read_script(core, folders)
        elif operation == "load_table" and realized is not None:
            core["table"] = _table_envelope(realized)
        elif operation == "load_table" and isinstance(table, str):
            if _read_here(table.strip(), plain_paths):
                core["table"] = _read_table(table.strip(), folders)
    except SqlFailure as failure:
        # A file that is not there follows On error, as any other failure does.
        core["wave_file_error"] = failure.message
    return core


def _decimals_as_text(values: Any) -> Any:
    """A map whose Decimal values cross as exact text in a typed envelope."""
    return {
        name: (
            {"__wave_type": "decimal", "value": str(value)} if isinstance(value, Decimal) else value
        )
        for name, value in (values or {}).items()
    }


def remote_request(
    params: dict[str, Any], artifacts_dir: str | None, testdata_dirs: list[str] | None
) -> dict[str, Any]:
    """The params a remote host runs: WAVE-side files read here, decimals as exact text."""
    request = read_wave_files(params, artifacts_dir, testdata_dirs, plain_paths=False)
    request["parameters"] = _decimals_as_text(request.get("parameters"))
    request["arguments"] = _decimals_as_text(request.get("arguments"))
    return request


def _sqlite_file(file: str, folders: tuple[str | None, list[str] | None]) -> dict[str, Any]:
    """The SQLite File as the core opens it; a Test Data file opens read-only (SQL-8)."""
    read_only = file.startswith("testdata://")
    try:
        path = str(resolve_plugin_path(file, *folders, read_only_ok=True))
    except FileNotFoundError:
        # Opened where it would be, so the open fails and names the File as the block wrote it.
        folder = next(iter(folders[1] or ()), "")
        return {
            "file": os.path.join(folder, scheme_relative_path(file)),
            "file_read_only": True,
            "file_shown": file,
        }
    return {"file": path, "file_read_only": read_only}


def needs_wheels(params: dict[str, Any]) -> bool:
    """Whether a carried driver needs its builds here: SQL Server does only over TLS (SQL-15)."""
    return params.get("database_type") != "mssql" or tls_on(params, "mssql")


def prepare(params: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Settle on WAVE what only WAVE can: files, the SQLite path and the tunnel's TLS name."""
    folders = _folders(context)
    core = read_wave_files(params, *folders, plain_paths=True)
    database_type = _sql_core.database_type_of(params)
    if database_type == "sqlite":
        core.update(_sqlite_file(str(params.get("file") or "").strip(), folders))
    port = params.get("port") or dialect(database_type).DEFAULT_PORT
    host = str(params.get("host") or "")
    route = resolve_tunnel(host, port, context.get("ssh_session_registry"))
    if route is not None:
        core["server_name"] = route.far_host
    return core, []


class SQLClientPlugin(PluginBase):
    """Runs SQL, calls stored procedures and loads tables, over TLS when asked (SQL-1)."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        success, error, reason = output_core(
            gated=True,
            success_description=(
                "True when the operation completed; a script run with Stop on error off passes "
                "whatever its statements did."
            ),
            reason_description=_REASONS,
        )
        return {
            "id": "sql-client",
            "name": "SQL",
            "version": "1.0.0",
            "category": "database",
            "remotable": True,
            "description": (
                "Runs a SQL script, calls a stored procedure or loads a table on PostgreSQL, "
                "MySQL, Oracle, SQL Server or SQLite, over TLS when asked."
            ),
            "tags": ["sql", "database", "postgresql", "mysql", "oracle", "sqlserver", "sqlite"],
            "secret_mask_fields": ["password", "client_key"],
            "parameters": [
                _select(
                    "operation",
                    "Run SQL runs a script, Call procedure calls a stored procedure and Load "
                    "table writes a table into a database table.",
                ),
                _select("database_type", "The database the block talks to."),
                {
                    "name": "host",
                    "type": "string",
                    "required_when": _NET,
                    "show_when": _NET,
                    "trim": True,
                    "description": (
                        "The database host. 127.0.0.1 or localhost on the Local Port of one of "
                        "this run's open SSH tunnels reaches the tunnel's far end."
                    ),
                },
                {
                    "name": "port",
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 65535,
                    "show_when": _NET,
                    "description": (
                        "The database port; blank means the type's own: 5432, 3306, 1521 or 1433."
                    ),
                },
                {
                    "name": "database",
                    "type": "string",
                    "required_when": _NET,
                    "show_when": _NET,
                    "trim": True,
                    "description": "The database to use; on Oracle, the service name.",
                },
                {
                    "name": "username",
                    "type": "string",
                    "required_when": _NET,
                    "show_when": _NET,
                    "trim": True,
                    "description": "The user the block logs in as.",
                },
                {
                    "name": "password",
                    "type": "string",
                    "secret": True,
                    "show_when": _NET,
                    "description": "The user's password.",
                },
                {
                    "name": "file",
                    "type": "string",
                    "required_when": _SQLITE,
                    "show_when": _SQLITE,
                    "trim": True,
                    "description": (
                        "The SQLite database file: testdata://, artifact:// or a path. A "
                        "testdata:// file opens read-only; a path that does not exist yet is "
                        "created."
                    ),
                },
                _select(
                    "script_type",
                    "Source runs the SQL below; File runs a .sql file.",
                    show_when=_RUN,
                ),
                {
                    "name": "sql",
                    "type": "string",
                    "required_when_all": [_RUN, gate("script_type", "source")],
                    "description": (
                        "The script, split into statements the way the database's own tool "
                        "splits it. :name placeholders take their values from Parameters. With "
                        "the expression toggle, an expression gives the script text."
                    ),
                },
                {
                    "name": "sql_file",
                    "type": "string",
                    "required_when_all": [_RUN, gate("script_type", "file")],
                    "trim": True,
                    "description": (
                        "The .sql file: testdata:// or artifact://, read on WAVE, or a path read "
                        "where the block runs."
                    ),
                },
                {
                    "name": "parameters",
                    "type": "map",
                    "default": {},
                    "show_when": _RUN,
                    "description": (
                        "The value of each :name placeholder; empty text binds as empty text; "
                        "null binds NULL."
                    ),
                },
                {
                    "name": "stop_on_error",
                    "type": "boolean",
                    "default": True,
                    "description": (
                        "On, the first failing statement or batch ends the block; off, the rest "
                        "still run and each failure is logged."
                    ),
                },
                {
                    "name": "procedure",
                    "type": "string",
                    "required_when": _CALL,
                    "show_when": _CALL,
                    "trim": True,
                    "description": "The procedure to call, with its schema or package if needed.",
                },
                {
                    "name": "arguments",
                    "type": "map",
                    "default": {},
                    "show_when": _CALL,
                    "description": "The arguments by name, in call order; null binds NULL.",
                },
                {
                    "name": "out_arguments",
                    "type": "array",
                    "default": [],
                    "show_when": _CALL,
                    "description": (
                        "The out and in-out arguments whose values come back in Out values; "
                        "a null entry fails the run."
                    ),
                },
                {
                    "name": "table",
                    "type": "table",
                    "required_when": _LOAD,
                    "show_when": _LOAD,
                    "description": (
                        "The rows to load: a table variable, or a CSV or Excel file from "
                        "testdata://, artifact:// or a path."
                    ),
                },
                {
                    "name": "target_table",
                    "type": "string",
                    "required_when": _LOAD,
                    "show_when": _LOAD,
                    "trim": True,
                    "description": "The database table the rows go into; it must exist.",
                },
                _select(
                    "mode",
                    "Add inserts the rows, Add or replace replaces rows whose key matches, and "
                    "Overwrite empties the table first.",
                    show_when=_LOAD,
                ),
                {
                    "name": "key_columns",
                    "type": "string",
                    "description": (
                        "The columns Add or replace matches on, separated by commas; blank "
                        "means the table's primary key."
                    ),
                },
                {
                    "name": "commit_each_batch",
                    "type": "boolean",
                    "default": False,
                    "show_when": _LOAD,
                    "description": (
                        "On, each batch commits on its own; off, the whole load is one "
                        "transaction."
                    ),
                },
                timeout_parameter(
                    300,
                    "Seconds the whole block may take; past it the running statement is "
                    "canceled on the database.",
                ),
                {
                    "name": "tls",
                    "type": "boolean",
                    "show_when": _NET,
                    "description": (
                        "Encrypts the connection; blank means off, and on for SQL Server."
                    ),
                },
                {
                    "name": "verify_ssl",
                    "type": "boolean",
                    "default": True,
                    "show_when": _TLS,
                    "description": (
                        "Verify the server certificate: against CA Certificate when it is set, "
                        "otherwise against the certificates WAVE trusts "
                        "(Settings > Network > Certificates)"
                    ),
                },
                {
                    "name": "ca_cert",
                    "type": "string",
                    "show_when": _TLS,
                    "description": (
                        "CA certificate (file path, variable reference, or PEM string); when set, "
                        "it is the only certificate this block trusts"
                    ),
                },
                {
                    "name": "client_cert",
                    "type": "string",
                    "show_when": _TLS,
                    "description": "A client certificate as PEM text or a path.",
                },
                {
                    "name": "client_key",
                    "type": "string",
                    "secret": True,
                    "show_when": _TLS,
                    "description": "The client certificate's key as PEM text or a path.",
                },
                {
                    "name": "connect_timeout",
                    "type": "integer",
                    "default": 30,
                    "minimum": 1,
                    "description": "Seconds to wait for the connection to open.",
                },
                {
                    "name": "max_rows",
                    "type": "integer",
                    "default": 10000,
                    "minimum": 0,
                    "show_when": _RUN_OR_CALL,
                    "description": "The most rows Rows keeps; 0 keeps every row.",
                },
                {
                    "name": "driver_options",
                    "type": "map",
                    "default": {},
                    "typed_values": True,
                    "description": (
                        "Options passed to the driver under its own names; on Oracle, dsn "
                        "replaces Host, Port and Database. A null value is skipped, so the "
                        "driver keeps its own default."
                    ),
                },
                {
                    "name": "batch_size",
                    "type": "integer",
                    "default": 1000,
                    "minimum": 1,
                    "show_when": _LOAD,
                    "description": "The rows sent to the database at a time.",
                },
                on_error_parameter(
                    "Fail the block on a run-time failure, or record it in Error and Reason "
                    "and continue."
                ),
            ],
            "return_type": "map",
            "output_schema": [
                success,
                {
                    "name": "rows",
                    "type": "table",
                    "show_when": _RUN_OR_CALL,
                    "description": (
                        "The rows of the last statement that returned rows, or the rows the "
                        "procedure returned."
                    ),
                },
                {
                    "name": "row_count",
                    "type": "integer",
                    "show_when": _RUN_OR_CALL,
                    "description": "The number of rows in Rows.",
                },
                {
                    "name": "rows_changed",
                    "type": "integer",
                    "show_when": gate("operation", "run_sql", "load_table"),
                    "description": ("The rows the script changed, or the rows the load committed."),
                },
                {
                    "name": "out_values",
                    "type": "table",
                    "show_when": _CALL,
                    "description": "One row with a column per out argument, typed.",
                },
                error,
                reason,
            ],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Refuse a misconfigured block, checking only the rows in effect (SQL-8)."""
        operation = _choice(params, "operation")
        database_type = _choice(params, "database_type")
        script_type = _choice(params, "script_type") if operation == "run_sql" else "source"
        if operation == "load_table":
            _choice(params, "mode")
        _choice(params, "on_error")
        if database_type == "sqlite" and operation == "call_procedure":
            raise ValueError("Operation 'Call procedure' is not available on SQLite")
        _check_connection(params, database_type)
        for name in _operation_rows(operation, script_type):
            if blank(params.get(name)):
                raise ValueError(f"Missing required parameter: {name}")
        if operation == "call_procedure":
            check_entry_nulls("out_arguments", params.get("out_arguments"))
        _check_types(params, operation, database_type)
        _check_bounds(params, operation, database_type)

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run the block's core off the event loop; Stop and Timeout cancel on the database."""
        return await run_verb(_sql_core.run, context["parameters"], context, prepare=prepare)
