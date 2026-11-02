"""SQL dialect adapter tests (REQ-5.1.4, REQ-3.4.1.6, REQ-4.5.16, SQL-5, SQL-8, SQL-13).

One module per database type binds the block to its driver: the registry and its constants,
the driver's connect with the block's rows (TLS, Driver options, Oracle's dsn), autocommit,
the server version the Connected line prints, and the out-of-band cancel each database has.
Network drivers are fake modules installed in sys.modules; SQLite has test_sqlite_dialect.py.
"""

import importlib
import importlib.abc
import importlib.util
import os
import re
import socket
import ssl
import struct
import sys
import threading
import types
from collections.abc import Callable, Iterator
from dataclasses import fields
from importlib.machinery import ModuleSpec
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, call

import OpenSSL.crypto
import OpenSSL.SSL
import pytest

import wavecore.connectivity
from tests.plugins.http import tls_material
from wavecore.connectivity.sql import _mysql_rsa, dialects
from wavecore.connectivity.sql._errors import SqlFailure, map_error
from wavecore.connectivity.sql.dialects import (
    DIALECTS,
    Handle,
    _common,
    dialect,
    mssql,
    mysql,
    oracle,
    postgres,
    sqlite,
)

_BOUND_S = 1.0
_PASSWORD = "s3cr3t-pass"
_PACKAGE = "wavecore.connectivity.sql"
_DRIVER_MODULES = (
    "pg8000",
    "pg8000.dbapi",
    "pymysql",
    "pymysql._auth",
    "pytds",
    "oracledb",
    "OpenSSL",
    "apsw",
)
_PINNED_MODULES = (
    _PACKAGE,
    f"{_PACKAGE}.dialects",
    f"{_PACKAGE}.dialects.postgres",
    f"{_PACKAGE}.dialects.mysql",
    f"{_PACKAGE}.dialects.oracle",
    f"{_PACKAGE}.dialects.mssql",
    f"{_PACKAGE}.dialects.sqlite",
    f"{_PACKAGE}.dialects._common",
    f"{_PACKAGE}._split",
    f"{_PACKAGE}._params",
    f"{_PACKAGE}._load",
    f"{_PACKAGE}._procedure",
    f"{_PACKAGE}._catalog",
    f"{_PACKAGE}._errors",
    f"{_PACKAGE}._mysql_rsa",
    f"{_PACKAGE}._sqlite_cursor",
)
_MODULES = {
    "postgresql": postgres,
    "mysql": mysql,
    "oracle": oracle,
    "mssql": mssql,
    "sqlite": sqlite,
}
# Declared out argument types as Oracle's argument catalog spells them, by the kind read back.
_ORACLE_NUMBER_TYPES = ("NUMBER", "INTEGER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE")
_ORACLE_STRING_TYPES = ("VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR", "CLOB", "NCLOB")
_ORACLE_DATETIME_TYPES = (
    "DATE",
    "TIMESTAMP",
    "TIMESTAMP(3)",
    "TIMESTAMP WITH TIME ZONE",
    "TIMESTAMP(6) WITH TIME ZONE",
    "TIMESTAMP WITH LOCAL TIME ZONE",
)
_ORACLE_OTHER_TYPES = ("RAW", "BLOB", "INTERVAL DAY TO SECOND", "XMLTYPE", "PL/SQL BOOLEAN")
# The oracledb types whose values read back as that kind.
_ORACLE_DRIVER_TYPES = {
    "number": (
        "DB_TYPE_NUMBER",
        "DB_TYPE_BINARY_FLOAT",
        "DB_TYPE_BINARY_DOUBLE",
        "DB_TYPE_BINARY_INTEGER",
    ),
    "string": (
        "DB_TYPE_VARCHAR",
        "DB_TYPE_NVARCHAR",
        "DB_TYPE_CHAR",
        "DB_TYPE_NCHAR",
        "DB_TYPE_LONG",
        "DB_TYPE_LONG_NVARCHAR",
    ),
    "datetime": (
        "DB_TYPE_DATE",
        "DB_TYPE_TIMESTAMP",
        "DB_TYPE_TIMESTAMP_TZ",
        "DB_TYPE_TIMESTAMP_LTZ",
    ),
}
_ORACLE_DESCRIPTOR = (
    "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db1)(PORT=1521))"
    "(CONNECT_DATA=(SERVICE_NAME=FREEPDB1)))"
)
_ORACLE_TIME_ZONE = "ALTER SESSION SET TIME_ZONE = DBTIMEZONE"
_ORACLE_ALIAS_REFUSED = (
    r"^Oracle Driver option dsn 'PRODDB' is a TNS alias, which WAVE does not look up: "
    r"use Host, Port and Service name, or paste the full connect descriptor$"
)


def _oracle_provider_refused(dsn: str) -> str:
    """The anchored refusal of a dsn that names a configuration provider."""
    message = (
        f"Oracle Driver option dsn '{dsn}' names a configuration provider, which WAVE does not "
        "use: use Host, Port and Service name, or paste the full connect descriptor"
    )
    return f"^{re.escape(message)}$"


def _oracle_alias_refused(dsn: str) -> str:
    """The anchored refusal of a dsn that is a TNS alias, or that the driver takes for one."""
    message = (
        f"Oracle Driver option dsn '{dsn}' is a TNS alias, which WAVE does not look up: "
        "use Host, Port and Service name, or paste the full connect descriptor"
    )
    return f"^{re.escape(message)}$"


def _oracle_directory_refused(dsn: str) -> str:
    """The anchored refusal of a dsn that is a directory address."""
    message = (
        f"Oracle Driver option dsn '{dsn}' is a directory address, which WAVE does not look up: "
        "use Host, Port and Service name, or paste the full connect descriptor"
    )
    return f"^{re.escape(message)}$"


_ORACLE_ADDRESS_HINT = "start it with tcps://"
_ORACLE_DESCRIPTOR_HINT = "use PROTOCOL=TCPS in it"


def _oracle_plain_under_tls(dsn: str, hint: str) -> str:
    """The anchored refusal of a dsn without TLS while the TLS row is on, with its hint."""
    message = (
        f"Oracle Driver option dsn '{dsn}' does not use TLS but TLS is on: "
        f"{hint}, or turn TLS off"
    )
    return f"^{re.escape(message)}$"


def _oracle_protocol_plain_under_tls(value: str) -> str:
    """The anchored refusal of a protocol option without TLS while the TLS row is on."""
    message = (
        f"Oracle Driver option protocol '{value}' does not use TLS but TLS is on: "
        "remove it, or turn TLS off"
    )
    return f"^{re.escape(message)}$"


def _oracle_protocol_tls_under_plain(value: str) -> str:
    """The anchored refusal of a protocol option with TLS while the TLS row is off."""
    message = (
        f"Oracle Driver option protocol '{value}' uses TLS but TLS is off: "
        "turn TLS on, so the block's certificate rows apply"
    )
    return f"^{re.escape(message)}$"


def _oracle_tls_under_plain(dsn: str) -> str:
    """The anchored refusal of a dsn with TLS while the TLS row is off."""
    message = (
        f"Oracle Driver option dsn '{dsn}' uses TLS but TLS is off: "
        "turn TLS on, so the block's certificate rows apply"
    )
    return f"^{re.escape(message)}$"


def _oracle_address_list(*protocols: str) -> str:
    """A connect descriptor with one address per protocol, on db1, db2 and so on."""
    addresses = "".join(
        f"(ADDRESS=(PROTOCOL={protocol})(HOST=db{number})(PORT=1521))"
        for number, protocol in enumerate(protocols, 1)
    )
    return f"(DESCRIPTION=(ADDRESS_LIST={addresses})(CONNECT_DATA=(SERVICE_NAME=FREEPDB1)))"


_ORACLE_PLAIN_ADDRESSES = [
    pytest.param("db1:1521/FREEPDB1", id="easy-connect"),
    pytest.param("tcp://db1:1521/FREEPDB1", id="tcp-prefix"),
]
_ORACLE_PLAIN_DESCRIPTORS = [
    pytest.param(_ORACLE_DESCRIPTOR, id="descriptor"),
    pytest.param(
        "(DESCRIPTION=(ADDRESS=(HOST=db1)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=FREEPDB1)))",
        id="descriptor-without-protocol",
    ),
    pytest.param(_oracle_address_list("TCP", "TCP"), id="two-addresses"),
]
_ORACLE_PLAIN_DSNS = [*_ORACLE_PLAIN_ADDRESSES, *_ORACLE_PLAIN_DESCRIPTORS]
_ORACLE_TLS_DSNS = [
    pytest.param("tcps://db1:2484/FREEPDB1", id="easy-connect"),
    pytest.param("TCPS://db1:2484/FREEPDB1", id="capitals"),
    pytest.param(
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=db1)(PORT=2484))"
        "(CONNECT_DATA=(SERVICE_NAME=FREEPDB1)))",
        id="descriptor",
    ),
    pytest.param(
        "( DESCRIPTION = ( ADDRESS = ( PROTOCOL = tcps ) ( HOST = db1 ) ( PORT = 2484 ) ) "
        "( CONNECT_DATA = ( SERVICE_NAME = FREEPDB1 ) ) )",
        id="descriptor-with-spaces",
    ),
    pytest.param(_oracle_address_list("TCPS", "TCPS"), id="two-addresses"),
]
_ORACLE_MIXED_DSN = pytest.param(_oracle_address_list("TCP", "TCPS"), id="mixed-addresses")
_ORACLE_PASTED_ENTRY = f"FREEPDB1 =\n  {_ORACLE_DESCRIPTOR}"


def _rows(**overrides: Any) -> dict[str, Any]:
    """Connection rows as the core hands them to connect(): every key, effective values."""
    base = {
        "host": "db",
        "port": 5432,
        "database": "wave",
        "username": "wave",
        "password": _PASSWORD,
        "file": "",
        "file_read_only": False,
        "tls": False,
        "verify_ssl": True,
        "ca_cert": "",
        "client_cert": "",
        "client_key": "",
        "driver_options": {},
        "server_name": "db",
    }
    return {**base, **overrides}


def _tls_rows(**overrides: Any) -> dict[str, Any]:
    """TLS on with verification off, dialing an address while the server name is db.internal."""
    return _rows(
        host="127.0.0.1", tls=True, verify_ssl=False, server_name="db.internal", **overrides
    )


def _server_name(context: ssl.SSLContext) -> str | None:
    """The name a context checks and sends, whatever name the driver dials."""
    return context.wrap_bio(
        ssl.MemoryBIO(), ssl.MemoryBIO(), server_hostname="127.0.0.1"
    ).server_hostname


def _connection() -> MagicMock:
    """A mock DB-API connection whose cursor is the same object with or without `with`."""
    connection = MagicMock()
    cursor = connection.cursor.return_value
    cursor.__enter__.return_value = cursor
    return connection


def _pg8000_cursor(*, autocommit: bool) -> MagicMock:
    """A pg8000 cursor whose connection is reachable as .connection and as ._c."""
    connection = MagicMock(autocommit=autocommit, _in_transaction=False)
    cursor = MagicMock()
    cursor.connection = cursor._c = connection
    return cursor


class _FakeModule(types.ModuleType):
    """A fake driver module: an attribute not set explicitly is a mock, the same one each time."""

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)
        value = MagicMock(name=f"{self.__name__}.{name}")
        setattr(self, name, value)
        return value


class _FakeSubmodules(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """Serves any not-yet-installed submodule of one fake driver as another fake module."""

    def __init__(self, root: str, monkeypatch: pytest.MonkeyPatch) -> None:
        self._root = root
        self._monkeypatch = monkeypatch

    def find_spec(self, name: str, path: Any, target: Any = None) -> ModuleSpec | None:
        if name.split(".")[0] != self._root:
            return None
        return importlib.util.spec_from_loader(name, self, is_package=True)

    def create_module(self, spec: ModuleSpec) -> types.ModuleType:
        module = _FakeModule(spec.name)
        # Registered through monkeypatch so the test's teardown removes it again.
        self._monkeypatch.setitem(sys.modules, spec.name, module)
        return module

    def exec_module(self, module: types.ModuleType) -> None:
        return None


class _Driver:
    """A driver's connect: records each call and answers a new mock connection."""

    def __init__(self, module: types.ModuleType, witness: Callable[[], Any] | None = None) -> None:
        self.module = module
        self.positional: list[tuple[Any, ...]] = []
        self.calls: list[dict[str, Any]] = []
        self.connections: list[MagicMock] = []
        self.witnessed: list[Any] = []
        self._witness = witness

    def connect(self, *args: Any, **kwargs: Any) -> MagicMock:
        self.positional.append(args)
        self.calls.append(kwargs)
        if self._witness is not None:
            self.witnessed.append(self._witness())
        connection = _connection()
        self.connections.append(connection)
        return connection


def _install(monkeypatch: pytest.MonkeyPatch, name: str, *submodules: str) -> _FakeModule:
    module = _FakeModule(name)
    module.__path__ = []
    monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setattr(sys, "meta_path", [_FakeSubmodules(name, monkeypatch), *sys.meta_path])
    for submodule in submodules:
        child = _FakeModule(f"{name}.{submodule}")
        setattr(module, submodule, child)
        monkeypatch.setitem(sys.modules, f"{name}.{submodule}", child)
    return module


def _pymysql_own_encrypt(password: bytes, salt: bytes, public_key: bytes) -> bytes:
    raise AssertionError("PyMySQL's cryptography-based RSA step ran")


@pytest.fixture
def pg8000_driver(monkeypatch: pytest.MonkeyPatch) -> _Driver:
    module = _install(monkeypatch, "pg8000", "dbapi")
    driver = _Driver(module)
    module.dbapi.connect = driver.connect
    return driver


@pytest.fixture
def pymysql_driver(monkeypatch: pytest.MonkeyPatch) -> _Driver:
    module = _install(monkeypatch, "pymysql", "_auth")
    module._auth.sha2_rsa_encrypt = _pymysql_own_encrypt
    driver = _Driver(module, witness=lambda: sys.modules["pymysql._auth"].sha2_rsa_encrypt)
    module.connect = driver.connect
    return driver


@pytest.fixture
def pytds_driver(monkeypatch: pytest.MonkeyPatch) -> _Driver:
    module = _install(monkeypatch, "pytds", "tls", "tds_base")
    _install(monkeypatch, "OpenSSL", "SSL", "crypto")
    driver = _Driver(module)
    module.connect = driver.connect
    return driver


@pytest.fixture
def oracledb_driver(monkeypatch: pytest.MonkeyPatch) -> _Driver:
    module = _install(monkeypatch, "oracledb")
    driver = _Driver(module)
    module.connect = driver.connect
    return driver


@pytest.fixture
def oracledb_parser(monkeypatch: pytest.MonkeyPatch) -> _Driver:
    """python-oracledb itself, so its own parser reads the dsn; only its connect is recorded."""
    import oracledb

    driver = _Driver(oracledb)
    monkeypatch.setattr(oracledb, "connect", driver.connect)
    monkeypatch.setattr(oracledb.defaults, "config_dir", oracledb.defaults.config_dir)
    return driver


class _Listener:
    """A loopback TCP listener that keeps every byte one client sends until it closes."""

    def __init__(self) -> None:
        self._socket = socket.create_server(("127.0.0.1", 0))
        self._socket.settimeout(_BOUND_S)
        self.port: int = self._socket.getsockname()[1]
        self.received = b""
        self.closed_by_peer = False
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self) -> None:
        try:
            client, _address = self._socket.accept()
        except OSError:
            return
        with client:
            client.settimeout(_BOUND_S)
            chunks: list[bytes] = []
            try:
                while chunk := client.recv(64):
                    chunks.append(chunk)
                self.closed_by_peer = True
            except OSError:
                pass
            self.received = b"".join(chunks)

    def join(self) -> None:
        self._thread.join(_BOUND_S)
        self._socket.close()


class TestRegistry:
    """The five database types and the one lookup the core and the catalog use."""

    def test_the_registry_holds_the_five_types(self) -> None:
        assert set(DIALECTS) == {"postgresql", "mysql", "oracle", "mssql", "sqlite"}

    @pytest.mark.parametrize("database_type", sorted(_MODULES))
    def test_each_type_maps_to_its_module(self, database_type: str) -> None:
        assert DIALECTS[database_type] is _MODULES[database_type]
        assert dialect(database_type) is _MODULES[database_type]

    def test_the_lookup_reads_the_registry_at_call_time(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        replacement = types.SimpleNamespace(NAME="PostgreSQL")
        monkeypatch.setitem(DIALECTS, "postgresql", replacement)

        assert dialect("postgresql") is replacement

    def test_an_unknown_type_is_refused(self) -> None:
        with pytest.raises(ValueError, match=r"^Unknown database type 'db2'$"):
            dialect("db2")

    def test_the_handle_holds_the_run_connection(self) -> None:
        rows = _rows()

        handle = Handle("postgresql", rows, 30)

        assert [field.name for field in fields(Handle)] == [
            "database_type",
            "rows",
            "connect_timeout",
            "connection",
        ]
        assert (handle.database_type, handle.rows, handle.connect_timeout) == (
            "postgresql",
            rows,
            30,
        )
        assert handle.connection is None


class TestConstants:
    """Each type's name, default port, sqlglot dialect, TLS default and placeholder form."""

    @pytest.mark.parametrize(
        ("database_type", "name", "port", "sqlglot", "tls_default"),
        [
            ("postgresql", "PostgreSQL", 5432, "postgres", False),
            ("mysql", "MySQL", 3306, "mysql", False),
            ("oracle", "Oracle", 1521, "oracle", False),
            ("mssql", "SQL Server", 1433, "tsql", True),
            ("sqlite", "SQLite", None, "sqlite", False),
        ],
    )
    def test_the_module_constants(
        self, database_type: str, name: str, port: int | None, sqlglot: str, tls_default: bool
    ) -> None:
        module = _MODULES[database_type]

        assert (module.NAME, module.DEFAULT_PORT, module.SQLGLOT, module.TLS_DEFAULT) == (
            name,
            port,
            sqlglot,
            tls_default,
        )

    @pytest.mark.parametrize(
        ("database_type", "first", "twelfth"),
        [
            ("postgresql", "$1", "$12"),
            ("mysql", "%s", "%s"),
            ("oracle", ":1", ":12"),
            ("mssql", "%s", "%s"),
            ("sqlite", "?", "?"),
        ],
    )
    def test_the_placeholder_form(self, database_type: str, first: str, twelfth: str) -> None:
        module = _MODULES[database_type]

        assert (module.placeholder(1), module.placeholder(12)) == (first, twelfth)


class TestNoDriverAtImport:
    """A remote host carrying only some drivers still imports the whole package."""

    def test_a_fresh_import_succeeds_with_every_driver_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for name in _PINNED_MODULES:
            importlib.import_module(name)
        # Every module the fresh import replaces is restored afterward, the parent's attribute too.
        monkeypatch.setattr(wavecore.connectivity, "sql", sys.modules[_PACKAGE])
        loaded = [n for n in sys.modules if n == _PACKAGE or n.startswith(f"{_PACKAGE}.")]
        for name in _DRIVER_MODULES:
            monkeypatch.setitem(sys.modules, name, None)
        for name in loaded:
            monkeypatch.delitem(sys.modules, name)

        fresh = {name: importlib.import_module(name) for name in _PINNED_MODULES}

        assert set(fresh[f"{_PACKAGE}.dialects"].DIALECTS) == set(_MODULES)
        assert fresh[f"{_PACKAGE}.dialects"] is not dialects


class TestPostgres:
    """pg8000 over the rows; the cancel is PostgreSQL's CancelRequest on a new socket."""

    def test_connect_passes_the_rows(self, pg8000_driver: _Driver) -> None:
        connection = postgres.connect(_rows(), 30)

        assert pg8000_driver.positional == [()]
        assert pg8000_driver.calls == [
            {
                "user": "wave",
                "host": "db",
                "database": "wave",
                "port": 5432,
                "password": _PASSWORD,
                "ssl_context": False,
                "timeout": 30,
                "application_name": "WAVE",
            }
        ]
        assert connection is pg8000_driver.connections[0]

    @pytest.mark.parametrize(
        "tls_rows",
        [
            pytest.param({"tls": False}, id="off"),
            pytest.param({"tls": None}, id="none"),
            pytest.param({"tls": False, "ca_cert": "/nonexistent/ca.pem"}, id="off-with-a-ca"),
        ],
    )
    def test_tls_off_asks_the_server_for_no_tls(
        self, pg8000_driver: _Driver, tls_rows: dict[str, Any]
    ) -> None:
        postgres.connect(_rows(**tls_rows), 30)

        assert pg8000_driver.calls[0]["ssl_context"] is False

    def test_the_socket_timeout_is_cleared_after_the_handshake(
        self, pg8000_driver: _Driver
    ) -> None:
        connection = postgres.connect(_rows(), 30)

        connection._usock.settimeout.assert_called_once_with(None)

    def test_tls_on_passes_a_context_checking_the_server_name(self, pg8000_driver: _Driver) -> None:
        postgres.connect(_tls_rows(), 30)

        context = pg8000_driver.calls[0]["ssl_context"]
        assert isinstance(context, ssl.SSLContext)
        assert context.verify_mode == ssl.CERT_NONE
        assert _server_name(context) == "db.internal"

    def test_driver_options_are_added_last_and_override(self, pg8000_driver: _Driver) -> None:
        options = {"application_name": "wave-tests", "timeout": 5}

        postgres.connect(_rows(driver_options=options), 30)

        assert pg8000_driver.calls[0]["application_name"] == "wave-tests"
        assert pg8000_driver.calls[0]["timeout"] == 5

    @pytest.mark.parametrize("on", [True, False])
    def test_autocommit_sets_the_attribute(self, on: bool) -> None:
        connection = _connection()

        postgres.autocommit(connection, on)

        assert connection.autocommit is on

    def test_server_version_is_the_reported_parameter(self) -> None:
        connection = _connection()
        connection.parameter_statuses = {"server_version": "16.4 (Debian 16.4-1.pgdg120+1)"}

        assert postgres.server_version(connection) == "16.4 (Debian 16.4-1.pgdg120+1)"

    def test_a_bound_statement_runs_unnamed_and_its_rows_are_read_through_the_cursor(
        self,
    ) -> None:
        """pg8000 1.31.5 keeps a cursor's results on its _context and _row_iter."""
        cursor = _pg8000_cursor(autocommit=True)
        context = cursor.connection.execute_unnamed.return_value
        context.rows = [(1, 7)]

        postgres.execute(cursor, "SELECT 5 % 2, $1", (7,))

        cursor.connection.execute_unnamed.assert_called_once_with("SELECT 5 % 2, $1", vals=(7,))
        cursor.connection.execute_simple.assert_not_called()
        cursor.execute.assert_not_called()
        assert cursor._context is context
        assert list(cursor._row_iter) == [(1, 7)]

    def test_a_bound_statement_without_rows_still_installs_its_result(self) -> None:
        cursor = _pg8000_cursor(autocommit=True)
        context = cursor.connection.execute_unnamed.return_value
        context.rows = None

        postgres.execute(cursor, "UPDATE t SET a = $1", (7,))

        assert cursor._context is context

    def test_with_autocommit_off_a_bound_statement_opens_the_transaction_first(self) -> None:
        cursor = _pg8000_cursor(autocommit=False)

        postgres.execute(cursor, "INSERT INTO t VALUES ($1)", (7,))

        assert cursor.connection.method_calls[:2] == [
            call.execute_simple("begin transaction"),
            call.execute_unnamed("INSERT INTO t VALUES ($1)", vals=(7,)),
        ]

    def test_cancel_sends_the_cancel_request_on_a_new_socket_and_closes_it(self) -> None:
        listener = _Listener()
        connection = _connection()
        connection._backend_key_data = struct.pack("!ii", 4242, 99)
        handle = Handle("postgresql", _rows(host="127.0.0.1", port=listener.port), 1, connection)

        postgres.cancel(handle)
        listener.join()

        assert listener.received == struct.pack("!iiii", 16, 80877102, 4242, 99)
        assert listener.closed_by_peer is True


class TestMysql:
    """PyMySQL over the rows with WAVE's RSA step; the cancel is KILL QUERY on a second login."""

    def test_connect_passes_the_rows(self, pymysql_driver: _Driver) -> None:
        connection = mysql.connect(_rows(port=3306), 30)

        assert pymysql_driver.positional == [()]
        assert pymysql_driver.calls == [
            {
                "host": "db",
                "port": 3306,
                "user": "wave",
                "password": _PASSWORD,
                "database": "wave",
                "connect_timeout": 30,
                "ssl": None,
                "program_name": "WAVE",
            }
        ]
        assert connection is pymysql_driver.connections[0]

    def test_connect_installs_the_rsa_step_before_dialing(self, pymysql_driver: _Driver) -> None:
        mysql.connect(_rows(port=3306), 30)

        assert pymysql_driver.witnessed == [_mysql_rsa.encrypt_password]

    def test_tls_on_passes_a_context_checking_the_server_name(
        self, pymysql_driver: _Driver
    ) -> None:
        mysql.connect(_tls_rows(port=3306), 30)

        context = pymysql_driver.calls[0]["ssl"]
        assert isinstance(context, ssl.SSLContext)
        assert context.verify_mode == ssl.CERT_NONE
        assert _server_name(context) == "db.internal"

    def test_driver_options_are_added_last_and_override(self, pymysql_driver: _Driver) -> None:
        options = {"charset": "utf8mb4", "connect_timeout": 7}

        mysql.connect(_rows(port=3306, driver_options=options), 30)

        assert pymysql_driver.calls[0]["charset"] == "utf8mb4"
        assert pymysql_driver.calls[0]["connect_timeout"] == 7

    @pytest.mark.parametrize("on", [True, False])
    def test_autocommit_calls_the_method(self, on: bool) -> None:
        connection = _connection()

        mysql.autocommit(connection, on)

        connection.autocommit.assert_called_once_with(on)

    def test_server_version_is_the_server_info(self) -> None:
        connection = _connection()
        connection.get_server_info.return_value = "8.4.2"

        assert mysql.server_version(connection) == "8.4.2"

    def test_cancel_kills_the_running_query_from_a_second_connection(
        self, pymysql_driver: _Driver
    ) -> None:
        running = _connection()
        running.thread_id.return_value = 42
        handle = Handle("mysql", _rows(port=3306), 7, running)

        mysql.cancel(handle)

        assert pymysql_driver.calls == [
            {
                "host": "db",
                "port": 3306,
                "user": "wave",
                "password": _PASSWORD,
                "database": "wave",
                "connect_timeout": 7,
                "ssl": None,
                "program_name": "WAVE",
            }
        ]
        second = pymysql_driver.connections[0]
        second.cursor.return_value.execute.assert_called_once_with("KILL QUERY 42")
        second.close.assert_called_once_with()


class TestOracle:
    """python-oracledb in thin mode over the rows, or over a dsn from Driver options."""

    def test_connect_passes_the_rows(self, oracledb_driver: _Driver) -> None:
        connection = oracle.connect(_rows(port=1521), 30)

        assert oracledb_driver.positional == [()]
        assert oracledb_driver.calls == [
            {
                "user": "wave",
                "password": _PASSWORD,
                "host": "db",
                "port": 1521,
                "service_name": "wave",
                "protocol": "tcp",
                "ssl_context": None,
                "tcp_connect_timeout": 30,
                "program": "WAVE",
            }
        ]
        assert connection is oracledb_driver.connections[0]

    def test_tls_on_uses_tcps_and_a_context_checking_the_server_name(
        self, oracledb_driver: _Driver
    ) -> None:
        oracle.connect(_tls_rows(port=2484), 30)

        call_kwargs = oracledb_driver.calls[0]
        assert call_kwargs["protocol"] == "tcps"
        assert isinstance(call_kwargs["ssl_context"], ssl.SSLContext)
        assert call_kwargs["ssl_context"].verify_mode == ssl.CERT_NONE
        assert _server_name(call_kwargs["ssl_context"]) == "db.internal"

    def test_a_dsn_in_driver_options_replaces_host_port_and_service(
        self, oracledb_driver: _Driver
    ) -> None:
        options = {"dsn": "db.example:1521/ORCLPDB1", "expire_time": 2}

        oracle.connect(_rows(host="", port=1521, database="", driver_options=options), 30)

        assert oracledb_driver.calls == [
            {
                "user": "wave",
                "password": _PASSWORD,
                "dsn": "db.example:1521/ORCLPDB1",
                "ssl_context": None,
                "tcp_connect_timeout": 30,
                "program": "WAVE",
                "expire_time": 2,
            }
        ]

    def test_driver_options_are_added_last_and_override(self, oracledb_driver: _Driver) -> None:
        options = {"expire_time": 2, "tcp_connect_timeout": 3}

        oracle.connect(_rows(port=1521, driver_options=options), 30)

        assert oracledb_driver.calls[0]["expire_time"] == 2
        assert oracledb_driver.calls[0]["tcp_connect_timeout"] == 3

    def test_connect_stays_in_thin_mode(self, oracledb_driver: _Driver) -> None:
        oracle.connect(_rows(port=1521), 30)

        oracledb_driver.module.init_oracle_client.assert_not_called()

    @pytest.mark.parametrize("on", [True, False])
    def test_autocommit_sets_the_attribute(self, on: bool) -> None:
        connection = _connection()

        oracle.autocommit(connection, on)

        assert connection.autocommit is on

    def test_server_version_is_the_connection_version(self) -> None:
        connection = _connection()
        connection.version = "23.5.0.24.7"

        assert oracle.server_version(connection) == "23.5.0.24.7"

    def test_cancel_calls_the_driver_cancel(self) -> None:
        running = _connection()

        oracle.cancel(Handle("oracle", _rows(port=1521), 30, running))

        running.cancel.assert_called_once_with()

    def test_implicit_results_are_the_cursors_the_call_handed_back(self) -> None:
        cursor = MagicMock()
        cursor.getimplicitresults.return_value = ["first", "second"]

        assert oracle.implicit_results(cursor) == ["first", "second"]

    def test_a_call_without_implicit_results_has_none(self) -> None:
        """The thin driver answers DPY-1004 when the call handed back no cursor."""
        cursor = MagicMock()
        no_results = Exception(types.SimpleNamespace(full_code="DPY-1004"))
        cursor.getimplicitresults.side_effect = no_results

        assert oracle.implicit_results(cursor) == []

    @pytest.mark.parametrize(
        "failure",
        [
            Exception(types.SimpleNamespace(full_code="DPY-1001")),
            Exception("not connected"),
            Exception(),
        ],
        ids=["other-code", "text", "bare"],
    )
    def test_any_other_driver_error_is_raised(self, failure: Exception) -> None:
        cursor = MagicMock()
        cursor.getimplicitresults.side_effect = failure

        with pytest.raises(Exception) as caught:
            oracle.implicit_results(cursor)

        assert caught.value is failure

    @pytest.mark.parametrize(
        ("declared", "db_type"),
        [
            ("NUMBER", "DB_TYPE_NUMBER"),
            ("VARCHAR2", "DB_TYPE_VARCHAR"),
            ("DATE", "DB_TYPE_DATE"),
        ],
    )
    def test_an_out_variable_takes_the_driver_type_of_the_declared_type(
        self, oracledb_driver: _Driver, declared: str, db_type: str
    ) -> None:
        cursor = MagicMock()

        variable = oracle.out_variable(cursor, declared)

        cursor.var.assert_called_once_with(getattr(oracledb_driver.module, db_type))
        assert variable is cursor.var.return_value

    @pytest.mark.parametrize(
        ("declared", "kind"),
        [
            *[(declared, "number") for declared in _ORACLE_NUMBER_TYPES],
            *[(declared, "string") for declared in _ORACLE_STRING_TYPES],
            *[(declared, "datetime") for declared in _ORACLE_DATETIME_TYPES],
            *[(declared, "string") for declared in _ORACLE_OTHER_TYPES],
        ],
    )
    def test_each_declared_type_takes_a_driver_type_of_its_kind(
        self, oracledb_driver: _Driver, declared: str, kind: str
    ) -> None:
        """SQL-9: numbers, text and datetimes read back typed; any other type reads back as text."""
        cursor = MagicMock()

        variable = oracle.out_variable(cursor, declared)

        assert variable is cursor.var.return_value
        assert cursor.var.call_count == 1
        passed = cursor.var.call_args.args[0]
        allowed = _ORACLE_DRIVER_TYPES[kind]
        assert any(passed is getattr(oracledb_driver.module, name) for name in allowed), passed


class TestOracleHostIndependence:
    """Oracle takes no alias, folder or time zone from the WAVE host (REQ-3.4.1.19)."""

    @pytest.mark.parametrize("dsn", ["PRODDB", " PRODDB "], ids=["bare", "padded"])
    def test_a_tns_alias_is_refused_before_anything_is_dialed(
        self, oracledb_driver: _Driver, dsn: str
    ) -> None:
        rows = _rows(host="", port=1521, database="", driver_options={"dsn": dsn})

        with pytest.raises(SqlFailure, match=_ORACLE_ALIAS_REFUSED) as refused:
            oracle.connect(rows, 30)

        assert refused.value.reason == "Validation"
        assert oracledb_driver.calls == []

    @pytest.mark.parametrize(
        "dsn",
        [
            "config-file:///srv/ora/app.json",
            "CONFIG-FILE:///SRV/ORA/APP.JSON",
            "config-azure://store.example/?key=a",
        ],
        ids=["file", "capitals", "azure"],
    )
    def test_a_configuration_provider_dsn_is_refused_before_anything_is_dialed(
        self, oracledb_driver: _Driver, dsn: str
    ) -> None:
        rows = _rows(host="", port=1521, database="", driver_options={"dsn": dsn})

        with pytest.raises(SqlFailure, match=_oracle_provider_refused(dsn)) as refused:
            oracle.connect(rows, 30)

        assert refused.value.reason == "Validation"
        assert oracledb_driver.calls == []

    def test_a_padded_configuration_provider_dsn_is_named_without_its_spaces(
        self, oracledb_driver: _Driver
    ) -> None:
        options = {"dsn": "  config-file:///srv/ora/app.json "}
        rows = _rows(host="", port=1521, database="", driver_options=options)
        refused = _oracle_provider_refused("config-file:///srv/ora/app.json")

        with pytest.raises(SqlFailure, match=refused):
            oracle.connect(rows, 30)

        assert oracledb_driver.calls == []

    @pytest.mark.parametrize(
        "dsn",
        [
            "tcp://db1:1521/FREEPDB1",
            "tcp://db1:1521/FREEPDB1?wallet_location=config-file://srv",
        ],
        ids=["tcp", "provider-text-later"],
    )
    def test_an_address_that_names_no_configuration_provider_reaches_the_driver(
        self, oracledb_driver: _Driver, dsn: str
    ) -> None:
        oracle.connect(_rows(host="", port=1521, database="", driver_options={"dsn": dsn}), 30)

        assert oracledb_driver.calls[0]["dsn"] == dsn

    @pytest.mark.parametrize(
        "dsn",
        [
            "ldap://dir.example/cn=orcl,cn=OracleContext",
            "ldaps://dir.example:636/cn=orcl,cn=OracleContext",
            "LDAP://DIR.EXAMPLE/CN=ORCL",
        ],
        ids=["ldap", "ldaps", "capitals"],
    )
    def test_a_directory_address_dsn_is_refused_before_anything_is_dialed(
        self, oracledb_driver: _Driver, dsn: str
    ) -> None:
        rows = _rows(host="", port=1521, database="", driver_options={"dsn": dsn})

        with pytest.raises(SqlFailure, match=_oracle_directory_refused(dsn)) as refused:
            oracle.connect(rows, 30)

        assert refused.value.reason == "Validation"
        assert oracledb_driver.calls == []

    def test_a_padded_directory_address_dsn_is_named_without_its_spaces(
        self, oracledb_driver: _Driver
    ) -> None:
        options = {"dsn": "  ldap://dir.example/cn=orcl "}
        rows = _rows(host="", port=1521, database="", driver_options=options)
        refused = _oracle_directory_refused("ldap://dir.example/cn=orcl")

        with pytest.raises(SqlFailure, match=refused):
            oracle.connect(rows, 30)

        assert oracledb_driver.calls == []

    def test_an_address_that_only_holds_a_directory_address_reaches_the_driver(
        self, oracledb_driver: _Driver
    ) -> None:
        dsn = "tcp://db1:1521/FREEPDB1?wallet_location=ldap://dir.example"

        oracle.connect(_rows(host="", port=1521, database="", driver_options={"dsn": dsn}), 30)

        assert oracledb_driver.calls[0]["dsn"] == dsn

    @pytest.mark.parametrize("dsn", ["", "   "], ids=["empty", "spaces"])
    def test_a_blank_dsn_is_no_dsn(self, oracledb_driver: _Driver, dsn: str) -> None:
        oracle.connect(_rows(port=1521, driver_options={"dsn": dsn}), 30)

        dialed = oracledb_driver.calls[0]
        assert "dsn" not in dialed
        assert (dialed["host"], dialed["port"], dialed["service_name"]) == ("db", 1521, "wave")

    @pytest.mark.parametrize(
        "dsn",
        [_ORACLE_DESCRIPTOR, "db1:1521/FREEPDB1", "db1/FREEPDB1"],
        ids=["descriptor", "host-port-service", "host-service"],
    )
    def test_a_descriptor_or_an_easy_connect_string_reaches_the_driver(
        self, oracledb_driver: _Driver, dsn: str
    ) -> None:
        oracle.connect(_rows(host="", port=1521, database="", driver_options={"dsn": dsn}), 30)

        assert oracledb_driver.calls[0]["dsn"] == dsn
        assert "host" not in oracledb_driver.calls[0]

    @pytest.mark.parametrize(
        "dsn", [_ORACLE_DESCRIPTOR, "db1:1521/FREEPDB1"], ids=["descriptor", "host-port-service"]
    )
    def test_a_padded_dsn_reaches_the_driver_without_its_spaces(
        self, oracledb_driver: _Driver, dsn: str
    ) -> None:
        options = {"dsn": f"  {dsn} "}

        oracle.connect(_rows(host="", port=1521, database="", driver_options=options), 30)

        assert oracledb_driver.calls[0]["dsn"] == dsn

    def test_the_configuration_folder_is_none_at_connect(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        folder = tmp_path / "network" / "admin"
        folder.mkdir(parents=True)
        (folder / "tnsnames.ora").write_text(f"PRODDB = {_ORACLE_DESCRIPTOR}\n", encoding="utf-8")
        monkeypatch.setenv("TNS_ADMIN", str(folder))
        module = _install(monkeypatch, "oracledb")
        # python-oracledb reads TNS_ADMIN into its defaults when it is imported.
        module.defaults = types.SimpleNamespace(config_dir=os.environ["TNS_ADMIN"])
        driver = _Driver(module, witness=lambda: module.defaults.config_dir)
        module.connect = driver.connect

        oracle.connect(_rows(port=1521), 30)

        assert driver.witnessed == [None]

    def test_the_time_zone_statement_is_the_first_statement_after_connect(
        self, oracledb_driver: _Driver
    ) -> None:
        connection = oracle.connect(_rows(port=1521), 30)

        cursor = connection.cursor.return_value
        assert cursor.execute.call_args_list == [call(_ORACLE_TIME_ZONE)]

    def test_a_failed_time_zone_statement_closes_the_connection_and_fails_the_connect(
        self, oracledb_driver: _Driver
    ) -> None:
        refusal = types.SimpleNamespace(
            full_code="ORA-01031", message="ORA-01031: insufficient privileges"
        )
        failure = Exception(refusal)
        connection = _connection()
        connection.cursor.return_value.execute.side_effect = failure
        oracledb_driver.module.connect = MagicMock(return_value=connection)

        with pytest.raises(Exception) as caught:
            oracle.connect(_rows(port=1521), 30)

        assert caught.value is failure
        connection.close.assert_called_once_with()

    def test_a_close_that_fails_does_not_hide_the_time_zone_error(
        self, oracledb_driver: _Driver
    ) -> None:
        failure = Exception("ORA-01031: insufficient privileges")
        connection = _connection()
        connection.cursor.return_value.execute.side_effect = failure
        connection.close.side_effect = OSError("the socket is gone")
        oracledb_driver.module.connect = MagicMock(return_value=connection)

        with pytest.raises(Exception) as caught:
            oracle.connect(_rows(port=1521), 30)

        assert caught.value is failure
        connection.close.assert_called_once_with()

    def test_a_dsn_that_is_a_number_is_read_as_its_text(self, oracledb_driver: _Driver) -> None:
        rows = _rows(host="", port=1521, database="", driver_options={"dsn": 1521})
        refused = (
            r"^Oracle Driver option dsn '1521' is a TNS alias, which WAVE does not look up: "
            r"use Host, Port and Service name, or paste the full connect descriptor$"
        )

        with pytest.raises(SqlFailure, match=refused) as caught:
            oracle.connect(rows, 30)

        assert caught.value.reason == "Validation"
        assert oracledb_driver.calls == []


class TestOracleDsnAndTheTlsRow:
    """A dsn's protocol, as the driver itself reads it, must agree with the TLS row."""

    @staticmethod
    def _dsn_rows(dsn: str, **overrides: Any) -> dict[str, Any]:
        """Rows of a block that names only a dsn: no Host, so no server name of its own."""
        base = {"host": "", "port": 1521, "database": "", "server_name": ""}
        return _rows(**{**base, "driver_options": {"dsn": dsn}, **overrides})

    @pytest.mark.parametrize("dsn", _ORACLE_PLAIN_ADDRESSES)
    def test_an_address_without_tls_is_refused_while_tls_is_on_with_the_tcps_hint(
        self, oracledb_parser: _Driver, dsn: str
    ) -> None:
        rows = self._dsn_rows(dsn, tls=True, verify_ssl=False)
        message = _oracle_plain_under_tls(dsn, _ORACLE_ADDRESS_HINT)

        with pytest.raises(SqlFailure, match=message) as refused:
            oracle.connect(rows, 30)

        assert refused.value.reason == "Validation"
        assert oracledb_parser.calls == []

    @pytest.mark.parametrize("dsn", [*_ORACLE_PLAIN_DESCRIPTORS, _ORACLE_MIXED_DSN])
    def test_a_descriptor_without_tls_is_refused_while_tls_is_on_with_the_protocol_hint(
        self, oracledb_parser: _Driver, dsn: str
    ) -> None:
        rows = self._dsn_rows(dsn, tls=True, verify_ssl=False)
        message = _oracle_plain_under_tls(dsn, _ORACLE_DESCRIPTOR_HINT)

        with pytest.raises(SqlFailure, match=message) as refused:
            oracle.connect(rows, 30)

        assert refused.value.reason == "Validation"
        assert oracledb_parser.calls == []

    @pytest.mark.parametrize("dsn", [*_ORACLE_TLS_DSNS, _ORACLE_MIXED_DSN])
    def test_a_dsn_with_tls_is_refused_while_tls_is_off(
        self, oracledb_parser: _Driver, dsn: str
    ) -> None:
        with pytest.raises(SqlFailure, match=_oracle_tls_under_plain(dsn)) as refused:
            oracle.connect(self._dsn_rows(dsn), 30)

        assert refused.value.reason == "Validation"
        assert oracledb_parser.calls == []

    @pytest.mark.parametrize(
        ("dsn", "hint"),
        [
            pytest.param("db1:1521/FREEPDB1", _ORACLE_ADDRESS_HINT, id="address"),
            pytest.param(_ORACLE_DESCRIPTOR, _ORACLE_DESCRIPTOR_HINT, id="descriptor"),
        ],
    )
    def test_a_refused_dsn_is_named_and_hinted_without_its_spaces(
        self, oracledb_parser: _Driver, dsn: str, hint: str
    ) -> None:
        rows = self._dsn_rows(f"  {dsn} ", tls=True, verify_ssl=False)

        with pytest.raises(SqlFailure, match=_oracle_plain_under_tls(dsn, hint)):
            oracle.connect(rows, 30)

        assert oracledb_parser.calls == []

    @pytest.mark.parametrize("dsn", _ORACLE_PLAIN_DSNS)
    def test_a_dsn_without_tls_connects_with_no_context_while_tls_is_off(
        self, oracledb_parser: _Driver, dsn: str
    ) -> None:
        oracle.connect(self._dsn_rows(dsn), 30)

        assert oracledb_parser.calls[0]["dsn"] == dsn
        assert oracledb_parser.calls[0]["ssl_context"] is None

    @pytest.mark.parametrize("dsn", _ORACLE_TLS_DSNS)
    def test_a_dsn_with_tls_connects_with_the_context_of_the_rows_while_tls_is_on(
        self, oracledb_parser: _Driver, dsn: str
    ) -> None:
        rows = self._dsn_rows(dsn, tls=True, verify_ssl=False, server_name="db.internal")

        oracle.connect(rows, 30)

        dialed = oracledb_parser.calls[0]
        assert dialed["dsn"] == dsn
        assert isinstance(dialed["ssl_context"], ssl.SSLContext)
        assert dialed["ssl_context"].verify_mode == ssl.CERT_NONE
        assert _server_name(dialed["ssl_context"]) == "db.internal"

    def test_verification_stays_on_for_a_dsn_with_tls(self, oracledb_parser: _Driver) -> None:
        rows = self._dsn_rows("tcps://db1:2484/FREEPDB1", tls=True, server_name="db.internal")

        oracle.connect(rows, 30)

        context = oracledb_parser.calls[0]["ssl_context"]
        assert (context.verify_mode, context.check_hostname) == (ssl.CERT_REQUIRED, True)

    @pytest.mark.parametrize(
        ("dsn", "host"),
        [
            pytest.param("tcps://db1:2484/FREEPDB1", "db1", id="one-address"),
            pytest.param(_oracle_address_list("TCPS", "TCPS"), "db1", id="first-of-two"),
        ],
    )
    def test_the_context_checks_the_dsn_host_when_the_block_names_no_host(
        self, oracledb_parser: _Driver, dsn: str, host: str
    ) -> None:
        oracle.connect(self._dsn_rows(dsn, tls=True), 30)

        assert _server_name(oracledb_parser.calls[0]["ssl_context"]) == host


class TestOracleProtocolOptionAndTheTlsRow:
    """A protocol Driver option must agree with the TLS row, as a dsn must (REQ-3.4.1.19)."""

    @pytest.mark.parametrize(
        ("typed", "named"),
        [("tcp", "tcp"), ("TCP", "TCP"), ("  tcp ", "tcp"), ("ipc", "ipc")],
        ids=["tcp", "capitals", "padded", "another-protocol"],
    )
    def test_a_protocol_without_tls_is_refused_while_tls_is_on(
        self, oracledb_driver: _Driver, typed: str, named: str
    ) -> None:
        rows = _tls_rows(port=2484, driver_options={"protocol": typed})

        with pytest.raises(SqlFailure, match=_oracle_protocol_plain_under_tls(named)) as refused:
            oracle.connect(rows, 30)

        assert refused.value.reason == "Validation"
        assert oracledb_driver.calls == []

    @pytest.mark.parametrize(
        ("typed", "named"),
        [("tcps", "tcps"), ("TCPS", "TCPS"), (" tcps  ", "tcps")],
        ids=["tcps", "capitals", "padded"],
    )
    def test_a_protocol_with_tls_is_refused_while_tls_is_off(
        self, oracledb_driver: _Driver, typed: str, named: str
    ) -> None:
        rows = _rows(port=1521, driver_options={"protocol": typed})

        with pytest.raises(SqlFailure, match=_oracle_protocol_tls_under_plain(named)) as refused:
            oracle.connect(rows, 30)

        assert refused.value.reason == "Validation"
        assert oracledb_driver.calls == []

    @pytest.mark.parametrize(
        ("typed", "handed"),
        [("tcps", "tcps"), ("TCPS", "TCPS"), (" Tcps ", "Tcps")],
        ids=["tcps", "capitals", "padded"],
    )
    def test_a_protocol_with_tls_reaches_the_driver_trimmed_while_tls_is_on(
        self, oracledb_driver: _Driver, typed: str, handed: str
    ) -> None:
        oracle.connect(_tls_rows(port=2484, driver_options={"protocol": typed}), 30)

        dialed = oracledb_driver.calls[0]
        assert dialed["protocol"] == handed
        assert isinstance(dialed["ssl_context"], ssl.SSLContext)

    @pytest.mark.parametrize(
        ("typed", "handed"),
        [("tcp", "tcp"), ("TCP", "TCP"), ("  tcp ", "tcp")],
        ids=["tcp", "capitals", "padded"],
    )
    def test_a_protocol_without_tls_reaches_the_driver_trimmed_while_tls_is_off(
        self, oracledb_driver: _Driver, typed: str, handed: str
    ) -> None:
        oracle.connect(_rows(port=1521, driver_options={"protocol": typed}), 30)

        dialed = oracledb_driver.calls[0]
        assert (dialed["protocol"], dialed["ssl_context"]) == (handed, None)

    @pytest.mark.parametrize("blank", [None, "", "   "], ids=["none", "empty", "spaces"])
    @pytest.mark.parametrize(("tls", "own"), [(True, "tcps"), (False, "tcp")], ids=["on", "off"])
    def test_a_blank_protocol_is_no_option(
        self, oracledb_driver: _Driver, blank: Any, tls: bool, own: str
    ) -> None:
        rows = _rows(port=1521, tls=tls, verify_ssl=False, driver_options={"protocol": blank})

        oracle.connect(rows, 30)

        assert oracledb_driver.calls[0]["protocol"] == own

    @pytest.mark.parametrize(
        ("tls", "dsn", "protocol", "message"),
        [
            pytest.param(
                True,
                "db1:1521/FREEPDB1",
                "tcp",
                _oracle_plain_under_tls("db1:1521/FREEPDB1", _ORACLE_ADDRESS_HINT),
                id="both-plain-under-tls",
            ),
            pytest.param(
                True,
                "tcps://db1:2484/FREEPDB1",
                "tcp",
                _oracle_protocol_plain_under_tls("tcp"),
                id="only-the-protocol-plain-under-tls",
            ),
            pytest.param(
                False,
                "tcps://db1:2484/FREEPDB1",
                "tcps",
                _oracle_tls_under_plain("tcps://db1:2484/FREEPDB1"),
                id="both-tls-without-the-row",
            ),
            pytest.param(
                False,
                "db1:1521/FREEPDB1",
                "tcps",
                _oracle_protocol_tls_under_plain("tcps"),
                id="only-the-protocol-tls-without-the-row",
            ),
        ],
    )
    def test_a_dsn_and_a_protocol_are_both_checked_the_dsn_first(
        self, oracledb_parser: _Driver, tls: bool, dsn: str, protocol: str, message: str
    ) -> None:
        options = {"protocol": protocol, "dsn": dsn}
        rows = _rows(host="", port=1521, database="", tls=tls, driver_options=options)

        with pytest.raises(SqlFailure, match=message) as refused:
            oracle.connect(rows, 30)

        assert refused.value.reason == "Validation"
        assert oracledb_parser.calls == []

    @pytest.mark.parametrize(
        ("tls", "dsn", "protocol"),
        [(True, "tcps://db1:2484/FREEPDB1", "tcps"), (False, "db1:1521/FREEPDB1", "tcp")],
        ids=["tls-on", "tls-off"],
    )
    def test_a_dsn_and_a_protocol_that_both_agree_reach_the_driver(
        self, oracledb_parser: _Driver, tls: bool, dsn: str, protocol: str
    ) -> None:
        options = {"dsn": dsn, "protocol": protocol}
        rows = _rows(host="", port=1521, database="", tls=tls, driver_options=options)

        oracle.connect(rows, 30)

        dialed = oracledb_parser.calls[0]
        assert (dialed["dsn"], dialed["protocol"]) == (dsn, protocol)


class TestOracleDsnTheDriverTakesForAnAlias:
    """A dsn the driver would look up as an alias gets the alias answer (REQ-3.4.1.19)."""

    @pytest.mark.parametrize(
        "dsn",
        [
            "db1:1521",
            "tcp://db1",
            "tcps://db1:2484",
            "db1:1521:FREE",
            "@db1:1521/FREEPDB1",
            _ORACLE_PASTED_ENTRY,
        ],
        ids=["host-port", "protocol-host", "tls-host-port", "host-port-sid", "at-sign", "pasted"],
    )
    @pytest.mark.parametrize("tls", [False, True], ids=["tls-off", "tls-on"])
    def test_it_is_refused_as_an_alias_before_anything_is_dialed(
        self, oracledb_parser: _Driver, dsn: str, tls: bool
    ) -> None:
        options = {"dsn": dsn}
        rows = _rows(host="", port=1521, database="", tls=tls, driver_options=options)

        with pytest.raises(SqlFailure, match=_oracle_alias_refused(dsn)) as refused:
            oracle.connect(rows, 30)

        assert refused.value.reason == "Validation"
        assert oracledb_parser.calls == []

    def test_a_folder_named_in_the_driver_options_does_not_resolve_it(
        self, oracledb_parser: _Driver, tmp_path: Path
    ) -> None:
        (tmp_path / "tnsnames.ora").write_text(f"DB1 = {_ORACLE_DESCRIPTOR}\n", encoding="utf-8")
        options = {"dsn": "tcp://db1", "config_dir": str(tmp_path)}
        rows = _rows(host="", port=1521, database="", driver_options=options)

        with pytest.raises(SqlFailure, match=_oracle_alias_refused("tcp://db1")):
            oracle.connect(rows, 30)

        assert oracledb_parser.calls == []

    def test_a_dsn_the_driver_cannot_parse_fails_with_the_drivers_own_error(
        self, oracledb_parser: _Driver
    ) -> None:
        options = {"dsn": "wave/pw@db1:1521/FREEPDB1"}
        rows = _rows(host="", port=1521, database="", driver_options=options)

        with pytest.raises(oracledb_parser.module.DatabaseError) as caught:
            oracle.connect(rows, 30)

        assert caught.value.args[0].full_code == "DPY-4018"
        assert oracledb_parser.calls == []


class TestMssql:
    """python-tds over the rows; the cancel sends an attention packet and reads nothing."""

    _PINNED = ("server", "port", "database", "user", "password", "login_timeout")
    _DIALED = {
        "server": "db",
        "port": 1433,
        "database": "wave",
        "user": "wave",
        "password": _PASSWORD,
        "login_timeout": 30,
    }

    def _dialed(self, driver: _Driver) -> dict[str, Any]:
        assert driver.positional == [()]
        return {name: driver.calls[0][name] for name in self._PINNED}

    def test_connect_passes_the_rows(self, pytds_driver: _Driver) -> None:
        connection = mssql.connect(_rows(port=1433), 30)

        assert self._dialed(pytds_driver) == self._DIALED
        assert connection is pytds_driver.connections[0]

    def test_driver_options_are_added_last_and_override(self, pytds_driver: _Driver) -> None:
        options = {"appname": "wave-tests", "login_timeout": 9}

        mssql.connect(_rows(port=1433, driver_options=options), 30)

        assert pytds_driver.calls[0]["appname"] == "wave-tests"
        assert pytds_driver.calls[0]["login_timeout"] == 9

    def test_tls_on_without_verification_dials_the_same_target(self, pytds_driver: _Driver) -> None:
        mssql.connect(_rows(port=1433, tls=True, verify_ssl=False), 30)

        assert self._dialed(pytds_driver) == self._DIALED

    def test_tls_on_with_trust_rows_and_a_client_pair_dials_the_same_target(
        self, pytds_driver: _Driver
    ) -> None:
        authority = tls_material.make_credential("WAVE Test CA", key_kind="ec256", is_ca=True)
        client = tls_material.make_credential("wave-client", issuer=authority, key_kind="ec256")
        rows = _rows(
            port=1433,
            tls=True,
            server_name="db.internal",
            ca_cert=authority.cert_pem,
            client_cert=client.cert_pem,
            client_key=client.key_pem,
        )

        mssql.connect(rows, 30)

        assert self._dialed(pytds_driver) == self._DIALED

    @pytest.mark.parametrize("on", [True, False])
    def test_autocommit_sets_the_attribute(self, on: bool) -> None:
        connection = _connection()

        mssql.autocommit(connection, on)

        assert connection.autocommit is on

    @pytest.mark.parametrize(
        ("product_version", "version"),
        [(0x10000FA0, "16.0.4000"), (0x0F0007D0, "15.0.2000"), (0x0E0A0C1C, "14.10.3100")],
    )
    def test_server_version_unpacks_the_product_version(
        self, product_version: int, version: str
    ) -> None:
        connection = _connection()
        connection.product_version = product_version

        assert mssql.server_version(connection) == version

    def test_cancel_sends_the_attention_packet_only(self) -> None:
        running = _connection()

        mssql.cancel(Handle("mssql", _rows(port=1433), 30, running))

        assert running.method_calls == [call._tds_socket.main_session.put_cancel()]


class TestExecute:
    """Each dialect runs one statement: alone without binds, beside its binds otherwise."""

    @pytest.mark.parametrize("database_type", sorted(_MODULES))
    def test_a_statement_without_binds_runs_alone(self, database_type: str) -> None:
        cursor = MagicMock()

        _MODULES[database_type].execute(cursor, "SELECT 5 % 2", None)

        cursor.execute.assert_called_once_with("SELECT 5 % 2")

    @pytest.mark.parametrize(
        ("database_type", "statement", "binds"),
        [
            ("mysql", "SELECT %s", (7,)),
            ("oracle", "SELECT :a FROM dual", {"a": 7}),
            ("mssql", "SELECT %s", (7,)),
            ("sqlite", "SELECT :a", {"a": 7}),
        ],
    )
    def test_binds_ride_beside_the_statement(
        self, database_type: str, statement: str, binds: Any
    ) -> None:
        cursor = MagicMock()

        _MODULES[database_type].execute(cursor, statement, binds)

        cursor.execute.assert_called_once_with(statement, binds)


class TestTlsContext:
    """One TLS row decision for every dialect: no context off, a named one on (SQL-8)."""

    @pytest.mark.parametrize(
        "rows",
        [
            pytest.param({}, id="absent"),
            pytest.param({"tls": False}, id="off"),
            pytest.param({"tls": None}, id="none"),
            pytest.param({"tls": False, "ca_cert": "/nonexistent/ca.pem"}, id="off-with-a-ca"),
        ],
    )
    def test_tls_off_has_no_context_and_reads_nothing(self, rows: dict[str, Any]) -> None:
        assert _common.tls_context(rows, "db.internal") is None

    def test_tls_on_is_a_client_context_under_the_server_name(self) -> None:
        context = _common.tls_context(_tls_rows(), "db.internal")

        assert isinstance(context, ssl.SSLContext)
        assert context.protocol == ssl.PROTOCOL_TLS_CLIENT
        assert context.verify_mode == ssl.CERT_NONE
        assert context.check_hostname is False
        assert _server_name(context) == "db.internal"

    def test_tls_on_with_verification_checks_the_certificate_and_the_name(self) -> None:
        context = _common.tls_context(_rows(tls=True), "far.internal")

        assert isinstance(context, ssl.SSLContext)
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.check_hostname is True
        assert _server_name(context) == "far.internal"

    def test_tls_on_reads_the_trust_rows(self) -> None:
        with pytest.raises(
            FileNotFoundError,
            match=r"^\[Errno 2\] No such file or directory: '/nonexistent/ca\.pem'$",
        ):
            _common.tls_context(_rows(tls=True, ca_cert="/nonexistent/ca.pem"), "db.internal")


class TestTrustRule:
    """The Python ssl dialects take build_context's context, so WAVE's trust rule (REQ-4.5.16)."""

    _AUTHORITY = tls_material.make_credential("WAVE Test CA", key_kind="ec256", is_ca=True)
    _DIALECTS = [
        pytest.param("postgresql", "pg8000_driver", "ssl_context", 5432, id="postgresql"),
        pytest.param("mysql", "pymysql_driver", "ssl", 3306, id="mysql"),
        pytest.param("oracle", "oracledb_driver", "ssl_context", 2484, id="oracle"),
    ]

    @pytest.mark.parametrize(("database_type", "driver", "argument", "port"), _DIALECTS)
    def test_the_context_comes_from_the_shared_builder(
        self,
        request: pytest.FixtureRequest,
        monkeypatch: pytest.MonkeyPatch,
        database_type: str,
        driver: str,
        argument: str,
        port: int,
    ) -> None:
        built = MagicMock(name="context")
        names: list[str] = []

        def build(rows: dict[str, Any], server_name: str) -> MagicMock:
            names.append(server_name)
            return built

        monkeypatch.setattr(_common, "build_context", build)
        recorder: _Driver = request.getfixturevalue(driver)

        _MODULES[database_type].connect(_tls_rows(port=port), 30)

        assert recorder.calls[0][argument] is built
        assert names == ["db.internal"]

    @pytest.mark.parametrize(("database_type", "driver", "argument", "port"), _DIALECTS)
    def test_verification_on_accepts_a_partial_chain(
        self,
        request: pytest.FixtureRequest,
        database_type: str,
        driver: str,
        argument: str,
        port: int,
    ) -> None:
        recorder: _Driver = request.getfixturevalue(driver)
        rows = _rows(
            host="127.0.0.1",
            port=port,
            tls=True,
            server_name="db.internal",
            ca_cert=self._AUTHORITY.cert_pem,
        )

        _MODULES[database_type].connect(rows, 30)

        context = recorder.calls[0][argument]
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.verify_flags & ssl.VERIFY_X509_PARTIAL_CHAIN


class TestProgramName:
    """Each network database is told the program is WAVE; a Driver option wins (REQ-3.4.1.19)."""

    _DIALECTS = [
        pytest.param("postgresql", "pg8000_driver", "application_name", id="postgresql"),
        pytest.param("mysql", "pymysql_driver", "program_name", id="mysql"),
        pytest.param("oracle", "oracledb_driver", "program", id="oracle"),
        pytest.param("mssql", "pytds_driver", "appname", id="mssql"),
    ]

    @pytest.mark.parametrize(("database_type", "driver", "argument"), _DIALECTS)
    def test_the_program_name_is_wave(
        self, request: pytest.FixtureRequest, database_type: str, driver: str, argument: str
    ) -> None:
        recorder: _Driver = request.getfixturevalue(driver)

        _MODULES[database_type].connect(_rows(), 30)

        assert recorder.calls[0].get(argument) == "WAVE"

    @pytest.mark.parametrize(("database_type", "driver", "argument"), _DIALECTS)
    def test_a_driver_option_of_the_same_name_wins(
        self, request: pytest.FixtureRequest, database_type: str, driver: str, argument: str
    ) -> None:
        recorder: _Driver = request.getfixturevalue(driver)

        _MODULES[database_type].connect(_rows(driver_options={argument: "nightly-load"}), 30)

        assert recorder.calls[0][argument] == "nightly-load"


class TestCancelWithoutConnection:
    """A cancel before connect() returned does nothing at all."""

    @pytest.mark.parametrize("database_type", sorted(_MODULES))
    def test_the_cancel_is_a_no_op(
        self,
        monkeypatch: pytest.MonkeyPatch,
        pymysql_driver: _Driver,
        database_type: str,
    ) -> None:
        def refuse(*_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("a cancel without a connection dialed")

        monkeypatch.setattr(socket, "create_connection", refuse)
        monkeypatch.setattr(socket.socket, "connect", refuse)
        handle = Handle(database_type, _rows(), 1)

        result = _MODULES[database_type].cancel(handle)

        assert result is None
        assert pymysql_driver.calls == []


def _x509(credential: tls_material.Credential) -> OpenSSL.crypto.X509:
    return OpenSSL.crypto.X509.from_cryptography(credential.cert)


def _handshake(
    client_context: OpenSSL.SSL.Context,
    server: tls_material.Credential,
    *,
    highest: int | None = None,
    chain: tuple[tls_material.Credential, ...] = (),
) -> OpenSSL.SSL.Connection:
    """A TLS handshake in memory with a server presenting `server`, then the `chain` it sends."""
    server_context = OpenSSL.SSL.Context(OpenSSL.SSL.TLS_SERVER_METHOD)
    server_context.use_certificate(server.cert)
    server_context.use_privatekey(server.key)
    for issuer in chain:
        server_context.add_extra_chain_cert(issuer.cert)
    if highest is not None:
        server_context.set_max_proto_version(highest)
        # Security level 0, so OpenSSL itself still offers TLS 1.1.
        server_context.set_cipher_list(b"DEFAULT:@SECLEVEL=0")
    client = OpenSSL.SSL.Connection(client_context, None)
    client.set_connect_state()
    far = OpenSSL.SSL.Connection(server_context, None)
    far.set_accept_state()
    for _ in range(4):
        for side, other in ((client, far), (far, client)):
            try:
                side.do_handshake()
            except OpenSSL.SSL.WantReadError:
                pass
            try:
                other.bio_write(side.bio_read(65536))
            except OpenSSL.SSL.WantReadError:
                pass
    return client


@pytest.fixture
def trust_spec() -> Iterator[Callable[..., Any]]:
    """Set the Additional Certificates a blank CA trusts beside WAVE's built-in list."""
    from wavecore.connectivity import trust_store

    trust_store.set_resolver(None)
    tokens: list[Any] = []

    def use(*additional: str) -> Any:
        spec = trust_store.TrustSpec(
            source="builtin",
            additional_pem="".join(additional),
            additional_count=len(additional),
            builtin_label="June 2026",
        )
        tokens.append(trust_store.ACTIVE_SPEC.set(spec))
        return spec

    yield use
    for token in reversed(tokens):
        trust_store.ACTIVE_SPEC.reset(token)


@pytest.fixture
def pytds_over_openssl(monkeypatch: pytest.MonkeyPatch) -> _Driver:
    """python-tds faked, pyOpenSSL real: the context connect() hands over can shake hands."""
    module = _install(monkeypatch, "pytds", "tls", "tds_base")
    driver = _Driver(module)
    module.connect = driver.connect
    return driver


class TestMssqlServerName:
    """WAVE checks the leaf against the server name it chose; python-tds checks no name itself."""

    _AUTHORITY = tls_material.make_credential("WAVE Test CA", key_kind="ec256", is_ca=True)

    def _leaf(
        self,
        common_name: str = "wave-e2e-database",
        *,
        dns: list[str] | None = None,
        ips: list[str] | None = None,
    ) -> tls_material.Credential:
        return tls_material.make_credential(
            common_name, issuer=self._AUTHORITY, key_kind="ec256", san_dns=dns, san_ips=ips
        )

    def _context(self, driver: _Driver, server_name: str) -> OpenSSL.SSL.Context:
        rows = _rows(
            host="127.0.0.1",
            port=1433,
            tls=True,
            server_name=server_name,
            ca_cert=self._AUTHORITY.cert_pem,
        )
        mssql.connect(rows, 30)
        context: OpenSSL.SSL.Context = driver.calls[0]["cafile"].context
        return context

    def test_verification_on_hands_the_check_to_the_callback(self, pytds_driver: _Driver) -> None:
        mssql.connect(_rows(port=1433, tls=True, server_name="db.internal"), 30)

        ssl_module = sys.modules["OpenSSL.SSL"]
        (mode, callback), _ = ssl_module.Context.return_value.set_verify.call_args
        assert pytds_driver.calls[0]["validate_host"] is False
        assert mode is ssl_module.VERIFY_PEER
        assert (callback.func, callback.args) == (mssql.verify_peer, ("db.internal",))

    def test_verification_off_sets_no_callback(self, pytds_driver: _Driver) -> None:
        mssql.connect(_rows(port=1433, tls=True, verify_ssl=False), 30)

        ssl_module = sys.modules["OpenSSL.SSL"]
        ssl_module.Context.return_value.set_verify.assert_called_once_with(ssl_module.VERIFY_NONE)
        assert pytds_driver.calls[0]["validate_host"] is False

    @pytest.mark.parametrize("verify_ssl", [True, False], ids=["verify on", "verify off"])
    def test_the_context_sets_a_tls_1_2_floor(
        self, pytds_driver: _Driver, verify_ssl: bool
    ) -> None:
        mssql.connect(_rows(port=1433, tls=True, verify_ssl=verify_ssl), 30)

        ssl_module = sys.modules["OpenSSL.SSL"]
        ssl_module.Context.assert_called_once_with(ssl_module.TLS_CLIENT_METHOD)
        ssl_module.Context.return_value.set_min_proto_version.assert_called_once_with(
            ssl_module.TLS1_2_VERSION
        )

    @pytest.mark.parametrize(
        ("server_name", "dns", "ips"),
        [
            ("db.internal", ["mssql", "db.internal"], None),
            ("DB.Internal", ["db.internal"], None),
            ("mssql", ["mssql"], ["127.0.0.1"]),
            ("127.0.0.1", ["mssql"], ["10.0.2.2", "127.0.0.1"]),
            ("0:0::1", None, ["::1"]),
            ("db.corp.example", ["*.corp.example"], None),
        ],
    )
    def test_a_leaf_that_names_the_server_passes(
        self, server_name: str, dns: list[str] | None, ips: list[str] | None
    ) -> None:
        leaf = _x509(self._leaf(dns=dns, ips=ips))

        assert mssql.verify_peer(server_name, None, leaf, 0, 0, 1) is True

    @pytest.mark.parametrize(
        ("server_name", "dns", "ips"),
        [
            ("other.internal", ["db.internal"], ["127.0.0.1"]),
            ("127.0.0.2", ["mssql"], ["127.0.0.1"]),
            ("a.db.corp.example", ["*.corp.example"], None),
            ("corp.example", ["*.corp.example"], None),
            ("db.example", ["*.example"], None),
            ("wave-e2e-database", ["mssql"], None),
        ],
    )
    def test_a_leaf_that_does_not_name_the_server_fails(
        self, server_name: str, dns: list[str] | None, ips: list[str] | None
    ) -> None:
        leaf = _x509(self._leaf(dns=dns, ips=ips))

        assert mssql.verify_peer(server_name, None, leaf, 0, 0, 1) is False

    @pytest.mark.parametrize("ips", [None, ["127.0.0.1"]])
    def test_without_dns_entries_the_common_name_is_checked(self, ips: list[str] | None) -> None:
        leaf = _x509(self._leaf("db.internal", ips=ips))

        assert mssql.verify_peer("db.internal", None, leaf, 0, 0, 1) is True
        assert mssql.verify_peer("other.internal", None, leaf, 0, 0, 1) is False

    def test_an_address_is_never_checked_against_the_common_name(self) -> None:
        leaf = _x509(self._leaf("127.0.0.1"))

        assert mssql.verify_peer("127.0.0.1", None, leaf, 0, 0, 1) is False

    def test_a_failed_chain_fails_even_when_the_leaf_names_the_server(self) -> None:
        leaf = _x509(self._leaf(dns=["db.internal"]))

        assert mssql.verify_peer("db.internal", None, leaf, 20, 0, 0) is False

    @pytest.mark.parametrize("ok", [1, 0])
    def test_an_issuer_keeps_the_chain_verdict(self, ok: int) -> None:
        issuer = _x509(self._AUTHORITY)

        assert mssql.verify_peer("db.internal", None, issuer, 0, 1, ok) is bool(ok)

    def test_the_named_server_completes_the_handshake(self, pytds_over_openssl: _Driver) -> None:
        context = self._context(pytds_over_openssl, "db.internal")

        client = _handshake(context, self._leaf(dns=["db.internal"], ips=["127.0.0.1"]))

        assert client.get_state_string() == b"SSL negotiation finished successfully"

    def test_another_name_fails_the_connect_as_unreachable(
        self, pytds_over_openssl: _Driver
    ) -> None:
        context = self._context(pytds_over_openssl, "db.internal")

        with pytest.raises(OpenSSL.SSL.Error) as raised:
            _handshake(context, self._leaf(dns=["other.internal"], ips=["127.0.0.1"]))

        message, reason = map_error(
            "mssql", raised.value, {"phase": "connect", "host": "127.0.0.1", "port": 1433}
        )
        assert reason == "Unreachable"
        assert message.startswith("Could not connect to SQL Server at 127.0.0.1:1433: ")
        assert "certificate verify failed" in message


class TestMssqlTrust:
    """SQL Server's pyOpenSSL context follows WAVE's trust rule too (REQ-4.5.16, REQ-5.1.4)."""

    _ROOT = tls_material.make_credential("WAVE Chain Root", key_kind="ec256", is_ca=True)
    _INTERMEDIATE = tls_material.make_credential(
        "WAVE Chain Intermediate", issuer=_ROOT, key_kind="ec256", is_ca=True
    )
    _LEAF = tls_material.make_credential(
        "db.internal",
        issuer=_INTERMEDIATE,
        key_kind="ec256",
        san_dns=["db.internal"],
        san_ips=["127.0.0.1"],
    )
    _FINISHED = b"SSL negotiation finished successfully"

    def _context(self, driver: _Driver, ca_cert: str = "") -> OpenSSL.SSL.Context:
        rows = _rows(
            host="127.0.0.1", port=1433, tls=True, server_name="db.internal", ca_cert=ca_cert
        )
        mssql.connect(rows, 30)
        context: OpenSSL.SSL.Context = driver.calls[0]["cafile"].context
        return context

    def test_an_intermediate_ca_trusts_a_server_that_sends_only_its_leaf(
        self, pytds_over_openssl: _Driver
    ) -> None:
        context = self._context(pytds_over_openssl, self._INTERMEDIATE.cert_pem)

        client = _handshake(context, self._LEAF)

        assert client.get_state_string() == self._FINISHED

    def test_a_root_ca_refuses_a_server_that_sends_only_its_leaf(
        self, pytds_over_openssl: _Driver
    ) -> None:
        context = self._context(pytds_over_openssl, self._ROOT.cert_pem)

        with pytest.raises(OpenSSL.SSL.Error):
            _handshake(context, self._LEAF)

    def test_a_root_ca_trusts_a_server_that_also_sends_the_intermediate(
        self, pytds_over_openssl: _Driver
    ) -> None:
        context = self._context(pytds_over_openssl, self._ROOT.cert_pem)

        client = _handshake(context, self._LEAF, chain=(self._INTERMEDIATE,))

        assert client.get_state_string() == self._FINISHED

    def test_a_blank_ca_trusts_the_additional_certificates(
        self, pytds_over_openssl: _Driver, trust_spec: Callable[..., Any]
    ) -> None:
        trust_spec(self._ROOT.cert_pem)
        context = self._context(pytds_over_openssl)

        client = _handshake(context, self._LEAF, chain=(self._INTERMEDIATE,))

        assert client.get_state_string() == self._FINISHED

    def test_a_blank_ca_trusts_an_additional_intermediate_alone(
        self, pytds_over_openssl: _Driver, trust_spec: Callable[..., Any]
    ) -> None:
        trust_spec(self._INTERMEDIATE.cert_pem)
        context = self._context(pytds_over_openssl)

        client = _handshake(context, self._LEAF)

        assert client.get_state_string() == self._FINISHED

    def test_a_blank_ca_ignores_a_certificate_file_named_by_the_environment(
        self,
        pytds_over_openssl: _Driver,
        trust_spec: Callable[..., Any],
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        bundle = tmp_path / "lab-ca.pem"
        bundle.write_text(self._ROOT.cert_pem, encoding="utf-8")
        monkeypatch.setenv("SSL_CERT_FILE", str(bundle))
        trust_spec()
        context = self._context(pytds_over_openssl)

        with pytest.raises(OpenSSL.SSL.Error):
            _handshake(context, self._LEAF, chain=(self._INTERMEDIATE,))

    def test_the_default_verify_paths_are_never_loaded(
        self,
        pytds_over_openssl: _Driver,
        trust_spec: Callable[..., Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[str] = []
        monkeypatch.setattr(
            OpenSSL.SSL.Context,
            "set_default_verify_paths",
            lambda _context: calls.append("set_default_verify_paths"),
        )
        trust_spec()

        self._context(pytds_over_openssl)

        assert calls == []


class TestMssqlProtocolFloor:
    """SQL Server's pyOpenSSL context refuses anything older than TLS 1.2, as tls_context's do."""

    _AUTHORITY = tls_material.make_credential("WAVE Test CA", key_kind="ec256", is_ca=True)
    _LEAF = tls_material.make_credential(
        "db.internal", issuer=_AUTHORITY, key_kind="ec256", san_dns=["db.internal"]
    )

    def _context(self, driver: _Driver) -> OpenSSL.SSL.Context:
        rows = _rows(
            host="127.0.0.1",
            port=1433,
            tls=True,
            server_name="db.internal",
            ca_cert=self._AUTHORITY.cert_pem,
        )
        mssql.connect(rows, 30)
        context: OpenSSL.SSL.Context = driver.calls[0]["cafile"].context
        # The floor must hold where OpenSSL's own security level would still allow TLS 1.1.
        context.set_cipher_list(b"DEFAULT:@SECLEVEL=0")
        return context

    def test_a_server_that_speaks_at_most_tls_1_1_is_refused(
        self, pytds_over_openssl: _Driver
    ) -> None:
        context = self._context(pytds_over_openssl)

        with pytest.raises(OpenSSL.SSL.Error):
            _handshake(context, self._LEAF, highest=OpenSSL.SSL.TLS1_1_VERSION)

    def test_a_server_that_speaks_at_most_tls_1_2_still_connects(
        self, pytds_over_openssl: _Driver
    ) -> None:
        context = self._context(pytds_over_openssl)

        client = _handshake(context, self._LEAF, highest=OpenSSL.SSL.TLS1_2_VERSION)

        assert client.get_protocol_version_name() == "TLSv1.2"
        assert client.get_state_string() == b"SSL negotiation finished successfully"
