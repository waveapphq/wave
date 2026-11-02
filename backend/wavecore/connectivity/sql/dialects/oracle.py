"""Oracle through python-oracledb in thin mode (REQ-3.4.1.6, REQ-3.4.1.19, REQ-5.1.4)."""

import re
from contextlib import suppress
from typing import TYPE_CHECKING, Any

from wavecore.connectivity.sql._errors import VALIDATION, SqlFailure
from wavecore.connectivity.sql.dialects._common import PROGRAM_NAME, tls_context
from wavecore.connectivity.sql.dialects._common import execute as execute

if TYPE_CHECKING:
    from wavecore.connectivity.sql.dialects import Handle

NAME = "Oracle"
DEFAULT_PORT = 1521
SQLGLOT = "oracle"
TLS_DEFAULT = False

_NUMBER_TYPES = frozenset({"NUMBER", "INTEGER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE"})
# A connect descriptor or an Easy Connect string holds one of these; a TNS alias holds none.
_DSN_MARKS = ("(", "/", ":")
# The driver reads such an address through a provider, which may be a file on this machine.
_CONFIG_PROVIDER = re.compile(r"config-[a-z0-9-]+://", re.IGNORECASE | re.ASCII)
# The driver takes such an address for a directory lookup, which WAVE never makes.
_DIRECTORY = re.compile(r"ldaps?://", re.IGNORECASE)
# The driver's answer for a dsn it would look up in a tnsnames.ora, with no folder to read.
_TAKEN_FOR_ALIAS = "DPY-4027"
_USE_INSTEAD = "use Host, Port and Service name, or paste the full connect descriptor"
_SESSION_TIME_ZONE = "ALTER SESSION SET TIME_ZONE = DBTIMEZONE"


def placeholder(index: int) -> str:
    return f":{index}"


def _option_text(options: dict[str, Any], name: str) -> str:
    """A Driver option's text without the spaces around it; empty when there is none."""
    value = options.get(name)
    return "" if value is None else str(value).strip()


def dsn_option(options: dict[str, Any]) -> str:
    """The dsn Driver option without the spaces around it; empty when there is none."""
    return _option_text(options, "dsn")


def _refused(option: str, value: str, why: str) -> SqlFailure:
    """The failure of a Driver option the dialect refuses before anything is dialed."""
    return SqlFailure(f"Oracle Driver option {option} '{value}' {why}", VALIDATION)


def _alias(dsn: str) -> SqlFailure:
    return _refused("dsn", dsn, f"is a TNS alias, which WAVE does not look up: {_USE_INSTEAD}")


def _plain_under_tls(option: str, value: str, hint: str) -> SqlFailure:
    return _refused(option, value, f"does not use TLS but TLS is on: {hint}, or turn TLS off")


def _tls_under_plain(option: str, value: str) -> SqlFailure:
    why = "uses TLS but TLS is off: turn TLS on, so the block's certificate rows apply"
    return _refused(option, value, why)


def _refuse_config_provider(dsn: str) -> None:
    """A dsn that names a configuration provider is read from outside the block (REQ-3.4.1.19)."""
    if _CONFIG_PROVIDER.match(dsn):
        why = f"names a configuration provider, which WAVE does not use: {_USE_INSTEAD}"
        raise _refused("dsn", dsn, why)


def _refuse_directory(dsn: str) -> None:
    """A dsn that is a directory address names a lookup, not a database (REQ-3.4.1.19)."""
    if _DIRECTORY.match(dsn):
        why = f"is a directory address, which WAVE does not look up: {_USE_INSTEAD}"
        raise _refused("dsn", dsn, why)


def _refuse_alias(dsn: str) -> None:
    """A dsn that is only a name needs a tnsnames.ora, which WAVE never reads."""
    if not any(mark in dsn for mark in _DSN_MARKS):
        raise _alias(dsn)


def _driver_code(exc: BaseException) -> Any:
    """The thin driver's own code for an error, such as DPY-4027."""
    return getattr(exc.args[0] if exc.args else None, "full_code", None)


def _parsed(driver: Any, dsn: str) -> Any:
    """The dsn as the driver itself reads it, with nothing dialed; an alias to it is refused."""
    params = driver.ConnectParams()
    try:
        params.parse_connect_string(dsn)
    except Exception as exc:
        if _driver_code(exc) == _TAKEN_FOR_ALIAS:
            raise _alias(dsn) from None
        raise
    return params


def _each(value: Any) -> list[Any]:
    """One value per address; the driver answers a single address as a bare value."""
    return [value] if value is None or isinstance(value, str) else list(value)


def _require_tls_agreement(dsn: str, protocols: list[Any], tls: bool) -> None:
    """Every address of a dsn uses TLS exactly when the TLS row is on, so the rows decide trust."""
    secure = [protocol == "tcps" for protocol in protocols]
    if tls and not all(secure):
        hint = "use PROTOCOL=TCPS in it" if dsn.startswith("(") else "start it with tcps://"
        raise _plain_under_tls("dsn", dsn, hint)
    if not tls and any(secure):
        raise _tls_under_plain("dsn", dsn)


def _settle_protocol(options: dict[str, Any], tls: bool) -> None:
    """The protocol option trimmed, a blank one dropped; it must agree with the TLS row too."""
    protocol = _option_text(options, "protocol")
    options.pop("protocol", None)
    if not protocol:
        return
    secure = protocol.lower() == "tcps"
    if tls and not secure:
        raise _plain_under_tls("protocol", protocol, "remove it")
    if not tls and secure:
        raise _tls_under_plain("protocol", protocol)
    options["protocol"] = protocol


def _use_database_time_zone(connection: Any) -> None:
    """The session reads times in the database's own zone, not the connecting machine's."""
    try:
        with connection.cursor() as cursor:
            cursor.execute(_SESSION_TIME_ZONE)
    except BaseException:
        with suppress(Exception):
            connection.close()
        raise


def connect(rows: dict[str, Any], connect_timeout: int) -> Any:
    import oracledb

    # The driver fills this from TNS_ADMIN or ORACLE_HOME when it is imported.
    defaults: Any = oracledb.defaults
    defaults.config_dir = None
    options = dict(rows["driver_options"])
    dsn = dsn_option(options)
    options.pop("dsn", None)
    tls = bool(rows["tls"])
    server_name = rows["server_name"]
    if dsn:
        _refuse_config_provider(dsn)
        _refuse_directory(dsn)
        _refuse_alias(dsn)
        parsed = _parsed(oracledb, dsn)
        _require_tls_agreement(dsn, _each(parsed.protocol), tls)
        # A block that names only a dsn has no Host for the certificate check.
        server_name = server_name or next((host for host in _each(parsed.host) if host), "")
        target: dict[str, Any] = {"dsn": dsn}
    else:
        target = {
            "host": rows["host"],
            "port": rows["port"],
            "service_name": rows["database"],
            "protocol": "tcps" if tls else "tcp",
        }
    _settle_protocol(options, tls)
    arguments = {
        "user": rows["username"],
        "password": rows["password"],
        **target,
        "ssl_context": tls_context(rows, server_name),
        "tcp_connect_timeout": connect_timeout,
        "program": PROGRAM_NAME,
    }
    connection = oracledb.connect(**{**arguments, **options})
    _use_database_time_zone(connection)
    return connection


def autocommit(connection: Any, on: bool) -> None:
    connection.autocommit = on


def server_version(connection: Any) -> str:
    return str(connection.version)


def cancel(handle: "Handle") -> None:
    if handle.connection is not None:
        handle.connection.cancel()


def implicit_results(cursor: Any) -> list[Any]:
    """The cursors a call handed back with DBMS_SQL.RETURN_RESULT (SQL-6)."""
    try:
        return list(cursor.getimplicitresults())
    except Exception as exc:
        # The thin driver's answer when the call handed back none.
        if _driver_code(exc) == "DPY-1004":
            return []
        raise


def out_variable(cursor: Any, type_text: str) -> Any:
    """A bind variable of the driver type the declared type reads back as (SQL-9)."""
    import oracledb

    declared = type_text.strip().upper()
    kind = oracledb.DB_TYPE_VARCHAR
    if declared in _NUMBER_TYPES:
        kind = oracledb.DB_TYPE_NUMBER
    elif declared == "DATE":
        kind = oracledb.DB_TYPE_DATE
    elif "LOCAL TIME ZONE" in declared:
        kind = oracledb.DB_TYPE_TIMESTAMP_LTZ
    elif "TIME ZONE" in declared:
        kind = oracledb.DB_TYPE_TIMESTAMP_TZ
    elif declared.startswith("TIMESTAMP"):
        kind = oracledb.DB_TYPE_TIMESTAMP
    return cursor.var(kind)
