"""Get Tables: a database's tables, views and columns, pulled from the WAVE server (SQL-12)."""

import logging
from collections.abc import Callable, Collection, Iterable, Mapping
from typing import Any

from wavecore.api.exceptions import UnprocessableEntityException, ValidationException
from wavecore.api.services.catalog_jobs import (
    NOT_HELD,
    Job,
    connection_key,
    mark_reading,
    row_resolver,
    start_job,
    starting_variables,
)
from wavecore.api.services.storage_paths import get_test_testdata_path
from wavecore.connectivity.sql._catalog import read_catalog
from wavecore.connectivity.sql._errors import VALIDATION, SqlFailure, map_error
from wavecore.connectivity.sql.dialects import Handle, dialect, oracle
from wavecore.core.secrets.masking import mask_text
from wavecore.core.secrets.sealing import unseal_all
from wavecore.core.variables.element_types import realize_typed_settings
from wavecore.plugins._file_paths import plain_path, scheme_relative_path
from wavecore.plugins.sql_client import SQLClientPlugin

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT = 30
_TESTDATA = "testdata://"
_SECRET_ROWS = ("password", "client_key")
_LABELS = {
    "database_type": "Database type",
    "host": "Host",
    "port": "Port",
    "database": "Database",
    "username": "Username",
    "password": "Password",
    "file": "File",
    "tls": "TLS",
    "verify_ssl": "Verify Server Certificate",
    "ca_cert": "CA Certificate",
    "client_cert": "Client Certificate",
    "client_key": "Client Key",
    "driver_options": "Driver options",
}
_NETWORK_ROWS = ("host", "port", "database", "username", "password")
_TEXT_ROWS = (
    "host",
    "database",
    "username",
    "password",
    "file",
    "ca_cert",
    "client_cert",
    "client_key",
)
_TRUST_ROWS = ("verify_ssl", "ca_cert", "client_cert", "client_key")


def start(
    connection: dict[str, Any],
    refresh: bool = False,
    test_id: str | None = None,
    *,
    expression_fields: Collection[str] = (),
    template_fields: Collection[str] = (),
    profile_bindings: Iterable[dict[str, Any]] = (),
    environment_id: str | None = None,
    element_types: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Answer the cached tables, join the running pull, or start one that replaces the last."""
    variables = starting_variables(test_id, environment_id, profile_bindings)
    resolve = row_resolver(
        SQLClientPlugin().metadata,
        _LABELS,
        set(expression_fields),
        set(template_fields),
        variables,
    )
    typed = realize_typed_settings(unseal_all(connection), element_types, set(expression_fields))
    rows = _resolved_rows({row: typed.get(row, NOT_HELD) for row in _LABELS}, resolve)
    by_test = str(rows["file"]).startswith(_TESTDATA)
    key = connection_key({**rows, "test_id": test_id} if by_test else rows)
    handle = Handle(rows["database_type"], rows, CONNECT_TIMEOUT)
    return start_job(key, lambda job: _pull(job, test_id), _cancel_read, handle, refresh)


def _cancel_read(job: Job) -> None:
    """Cancel the read on the database; a driver that refuses leaves the job canceled."""
    handle: Handle = job.live
    try:
        dialect(handle.database_type).cancel(handle)
    except Exception as error:
        secrets = [str(handle.rows[row]) for row in _SECRET_ROWS if handle.rows.get(row)]
        text = mask_text(f"{type(error).__name__}: {error}", secrets)
        logger.warning("Get Tables could not cancel job %s on the database: %s", job.id, text)


def _resolved_rows(rows: dict[str, Any], resolve: Callable[[str, Any], Any]) -> dict[str, Any]:
    """The rows in effect resolved, blanks defaulted and required rows checked."""
    database_type = resolve("database_type", rows["database_type"])
    try:
        module = dialect(database_type)
    except ValueError as error:
        raise ValidationException(str(error)) from None
    rows["database_type"] = database_type
    if database_type != "sqlite":
        tls = resolve("tls", rows["tls"])
        rows["tls"] = module.TLS_DEFAULT if tls in (None, "") else tls
    for row in _rows_in_effect(database_type, rows["tls"]):
        rows[row] = resolve(row, rows[row])
    _blank_rows_as_nothing(rows)
    if database_type == "oracle":
        rows["driver_options"] = _dsn_as_dialed(rows["driver_options"])
    if rows["port"] in (None, ""):
        rows["port"] = module.DEFAULT_PORT
    for row in _required_rows(database_type, _oracle_dsn(rows)):
        if not rows[row]:
            raise UnprocessableEntityException(f"{_LABELS[row]} is required")
    return {**rows, "server_name": rows["host"], "file_read_only": True}


def _blank_rows_as_nothing(rows: dict[str, Any]) -> None:
    """A text row holding nothing reads as empty text; any other row out of effect, as None."""
    for row, value in rows.items():
        if value is None or value is NOT_HELD:
            rows[row] = "" if row in _TEXT_ROWS else None


def _rows_in_effect(database_type: str, tls: Any) -> tuple[str, ...]:
    """SQLite reads its File; a network type its server rows, and the trust rows under TLS."""
    if database_type == "sqlite":
        return ("file", "driver_options")
    return (*_NETWORK_ROWS, *(_TRUST_ROWS if tls else ()), "driver_options")


def _dsn_as_dialed(options: dict[str, Any]) -> dict[str, Any]:
    """Oracle's Driver options with the dsn as the dialect reads it: trimmed, a blank one gone."""
    dsn = oracle.dsn_option(options)
    others = {name: value for name, value in options.items() if name != "dsn"}
    return {**others, "dsn": dsn} if dsn else others


def _required_rows(database_type: str, dsn: Any) -> tuple[str, ...]:
    """An Oracle dsn stands in for Host and Database."""
    if database_type == "sqlite":
        return ("file",)
    return () if dsn else ("host", "database")


def _oracle_dsn(rows: dict[str, Any]) -> Any:
    """The dsn driver option, which only Oracle reads."""
    return rows["driver_options"].get("dsn") if rows["database_type"] == "oracle" else None


def _pull(job: Job, test_id: str | None) -> dict[str, Any]:
    """Connect, read the catalog and disconnect."""
    handle: Handle = job.live
    rows = handle.rows
    module = dialect(handle.database_type)
    context = {**rows, "phase": "connect", "dsn": _oracle_dsn(rows)}
    connection = None
    try:
        if handle.database_type == "sqlite":
            rows["file"] = _sqlite_path(rows["file"], test_id)
        connection = module.connect(rows, CONNECT_TIMEOUT)
        handle.connection = connection
        if not mark_reading(job):
            return {}
        context["phase"] = "statement"
        return {"tables": read_catalog(connection, handle.database_type)}
    except Exception as error:
        raise SqlFailure(*map_error(handle.database_type, error, context)) from error
    finally:
        if connection is not None:
            connection.close()


def _sqlite_path(file: str, test_id: str | None) -> str:
    """A testdata:// File from the test's Test Data folder; any other path as the block reads it."""
    if not file.startswith(_TESTDATA):
        return str(plain_path(file))
    if not test_id:
        raise SqlFailure(
            f"testdata:// paths need the test: Get Tables could not resolve {file}", VALIDATION
        )
    return str(get_test_testdata_path(test_id).resolve() / scheme_relative_path(file))
