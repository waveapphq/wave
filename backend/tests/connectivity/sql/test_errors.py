"""SQL error classification tests (REQ-3.4.1.6, REQ-5.1.4, SQL-5).

map_error turns whatever a driver raised into the block's message and reason: a failed
connect names where it dialed, a refused login names the user and the host, and a refused
statement carries the database's own code and text unchanged. A SqlFailure the core raised
itself passes through. Classification reads the exception's shape, so no driver is needed.
"""

import ssl
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import apsw
import pytest

from tests.connectivity.sql.fakes import FakeDriverError, sqlite_file
from wavecore.connectivity.sql._errors import (
    AUTH_FAILED,
    DATABASE_ERROR,
    TIMEOUT,
    UNREACHABLE,
    UNSUPPORTED,
    VALIDATION,
    SqlFailure,
    map_error,
    timeout_message,
)

_PORTS = {"postgresql": 5432, "mysql": 3306, "oracle": 1521, "mssql": 1433, "sqlite": None}
_REFUSED = "[Errno 111] Connection refused"
_DSN = "db.example:1521/ORCLPDB1"
_SQLITE_FILE = "/data/missing/orders.db"
_MISSING_CA = "/etc/wave/missing-ca.pem"
_NOT_A_CERTIFICATE = "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydA==\n-----END CERTIFICATE-----\n"
_NAMES = {"postgresql": "PostgreSQL", "mysql": "MySQL", "oracle": "Oracle", "mssql": "SQL Server"}


class _TdsError(Exception):
    """python-tds's error shape: the server's number and text ride as attributes."""

    def __init__(self, number: Any, text: str, message: str | None = None) -> None:
        super().__init__(text if message is None else message)
        self.number = number
        self.text = text


def _tds_gave_up(cause: BaseException) -> TimeoutError:
    """What python-tds raises when its login retries run out: no text, the last error as cause."""
    error = TimeoutError()
    error.__cause__ = cause
    return error


def _context(database_type: str, phase: str, **overrides: Any) -> dict[str, Any]:
    """map_error's context for a block on db (the type's default port) as wave."""
    base = {
        "phase": phase,
        "host": "db",
        "port": _PORTS[database_type],
        "username": "wave",
        "file": "",
        "dsn": None,
    }
    return {**base, **overrides}


def _postgres(code: str, message: str, severity: str = "ERROR") -> Exception:
    return Exception({"S": severity, "V": severity, "C": code, "M": message})


def _oracle(full_code: str, message: str) -> Exception:
    return Exception(SimpleNamespace(full_code=full_code, message=message))


def _sqlite_error(*statements: str) -> apsw.Error:
    """The error the bundled SQLite build raises while `statements` run on an empty database."""
    connection = apsw.Connection(":memory:")
    try:
        for statement in statements:
            connection.execute(statement)
    except apsw.Error as error:
        return error
    finally:
        connection.close()
    raise AssertionError(f"{statements[-1]} did not fail")


def _sqlite_overflow_error() -> OverflowError:
    """The error the bundled SQLite build raises for a whole number past 64 bits."""
    connection = apsw.Connection(":memory:")
    try:
        connection.execute("SELECT ?", (2**63,))
    except OverflowError as error:
        return error
    finally:
        connection.close()
    raise AssertionError("2**63 was bound")


def _sqlite_read_only_error(path: Path) -> apsw.Error:
    """The error the bundled SQLite build raises for a write on a file opened read-only."""
    connection = apsw.Connection(str(path), flags=apsw.SQLITE_OPEN_READONLY)
    try:
        connection.execute("INSERT INTO orders VALUES (1)")
    except apsw.Error as error:
        return error
    finally:
        connection.close()
    raise AssertionError(f"{path} took the write")


def _missing_file_error() -> OSError:
    """The error opening a CA or client file that is not there raises."""
    try:
        Path(_MISSING_CA).read_text(encoding="utf-8")
    except OSError as error:
        return error
    raise AssertionError(f"{_MISSING_CA} exists")


def _unusable_pem_error() -> ssl.SSLError:
    """The error loading CA text that holds no certificate raises."""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    try:
        context.load_verify_locations(cadata=_NOT_A_CERTIFICATE)
    except ssl.SSLError as error:
        return error
    raise AssertionError("the CA text loaded")


def _sqlite_open_error() -> apsw.Error:
    """The error the bundled SQLite build raises when a database file cannot be opened."""
    try:
        apsw.Connection(_SQLITE_FILE, flags=apsw.SQLITE_OPEN_READONLY)
    except apsw.Error as error:
        return error
    raise AssertionError(f"{_SQLITE_FILE} opened")


class TestReasons:
    """The six reason words the block reports (SQL-5)."""

    def test_reason_constants_are_the_reason_words(self) -> None:
        assert (UNREACHABLE, AUTH_FAILED, DATABASE_ERROR, TIMEOUT, VALIDATION, UNSUPPORTED) == (
            "Unreachable",
            "AuthFailed",
            "DatabaseError",
            "Timeout",
            "Validation",
            "Unsupported",
        )


class TestTimeoutMessage:
    """The deadline message names the Timeout in seconds."""

    def test_the_default_timeout(self) -> None:
        assert timeout_message(300) == "Statement timed out after 300 seconds"

    def test_another_timeout(self) -> None:
        assert timeout_message(5) == "Statement timed out after 5 seconds"

    def test_a_one_second_timeout_is_named_in_the_singular(self) -> None:
        assert timeout_message(1) == "Statement timed out after 1 second"


class TestConnectUnreachable:
    """A connect that fails outside the database names the type, host and port (SQL-5)."""

    @pytest.mark.parametrize(
        ("database_type", "error", "message"),
        [
            pytest.param(
                "postgresql",
                OSError(_REFUSED),
                f"Could not connect to PostgreSQL at db:5432: {_REFUSED}",
                id="postgresql-refused",
            ),
            pytest.param(
                "mysql",
                OSError(_REFUSED),
                f"Could not connect to MySQL at db:3306: {_REFUSED}",
                id="mysql-refused",
            ),
            pytest.param(
                "oracle",
                OSError(_REFUSED),
                f"Could not connect to Oracle at db:1521: {_REFUSED}",
                id="oracle-refused",
            ),
            pytest.param(
                "mssql",
                OSError(_REFUSED),
                f"Could not connect to SQL Server at db:1433: {_REFUSED}",
                id="mssql-refused",
            ),
            pytest.param(
                "postgresql",
                TimeoutError("timed out"),
                "Could not connect to PostgreSQL at db:5432: timed out",
                id="postgresql-timeout",
            ),
            pytest.param(
                "postgresql",
                ssl.SSLCertVerificationError(
                    1,
                    "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: "
                    "self-signed certificate (_ssl.c:1010)",
                ),
                "Could not connect to PostgreSQL at db:5432: [SSL: CERTIFICATE_VERIFY_FAILED] "
                "certificate verify failed: self-signed certificate (_ssl.c:1010)",
                id="postgresql-tls-handshake",
            ),
            pytest.param(
                "postgresql",
                Exception(
                    "Can't create a connection to host db and port 5432 "
                    "(timeout is 30 and source_address is None)."
                ),
                "Could not connect to PostgreSQL at db:5432: Can't create a connection to host "
                "db and port 5432 (timeout is 30 and source_address is None).",
                id="postgresql-driver-text",
            ),
            pytest.param(
                "mysql",
                FakeDriverError(
                    2003, "Can't connect to MySQL server on 'db' ([Errno 111] Connection refused)"
                ),
                "Could not connect to MySQL at db:3306: Can't connect to MySQL server on 'db' "
                "([Errno 111] Connection refused)",
                id="mysql-2003-client-error-text-only",
            ),
            pytest.param(
                "oracle",
                _oracle(
                    "DPY-6005",
                    "DPY-6005: cannot connect to database (CONNECTION_ID=a1b2).\n"
                    "[Errno 111] Connection refused",
                ),
                "Could not connect to Oracle at db:1521: DPY-6005: cannot connect to database "
                "(CONNECTION_ID=a1b2).\n[Errno 111] Connection refused",
                id="oracle-dpy-message",
            ),
            pytest.param(
                "mssql",
                _tds_gave_up(ConnectionRefusedError(111, "Connection refused")),
                f"Could not connect to SQL Server at db:1433: {_REFUSED}",
                id="mssql-refused-after-the-login-timeout",
            ),
        ],
    )
    def test_the_message_names_the_type_host_and_port(
        self, database_type: str, error: BaseException, message: str
    ) -> None:
        result = map_error(database_type, error, _context(database_type, "connect"))

        assert result == (message, UNREACHABLE)

    def test_an_oracle_dsn_is_named_instead_of_host_and_port(self) -> None:
        context = _context("oracle", "connect", host="", dsn=_DSN)

        result = map_error("oracle", OSError(_REFUSED), context)

        assert result == (f"Could not connect to Oracle at {_DSN}: {_REFUSED}", UNREACHABLE)

    def test_an_oracle_dsn_carries_the_driver_message(self) -> None:
        context = _context("oracle", "connect", host="", dsn=_DSN)
        error = _oracle("DPY-6005", "DPY-6005: cannot connect to database (CONNECTION_ID=a1b2).")

        result = map_error("oracle", error, context)

        assert result == (
            f"Could not connect to Oracle at {_DSN}: "
            "DPY-6005: cannot connect to database (CONNECTION_ID=a1b2).",
            UNREACHABLE,
        )

    def test_a_sqlite_file_that_cannot_be_opened_names_the_file(self) -> None:
        context = _context("sqlite", "connect", host="", file=_SQLITE_FILE)

        result = map_error("sqlite", _sqlite_open_error(), context)

        assert result == (
            f"Could not open the SQLite file {_SQLITE_FILE}: unable to open database file",
            UNREACHABLE,
        )


class TestTrustMaterialFailures:
    """A CA or client file WAVE cannot use fails the connect as Unreachable with the OS text."""

    @pytest.mark.parametrize("database_type", sorted(_NAMES))
    def test_a_missing_file(self, database_type: str) -> None:
        error = _missing_file_error()

        result = map_error(database_type, error, _context(database_type, "connect"))

        assert result == (
            f"Could not connect to {_NAMES[database_type]} at db:{_PORTS[database_type]}: "
            f"[Errno 2] No such file or directory: '{_MISSING_CA}'",
            UNREACHABLE,
        )

    @pytest.mark.parametrize("database_type", sorted(_NAMES))
    def test_ca_text_that_holds_no_certificate(self, database_type: str) -> None:
        error = _unusable_pem_error()

        result = map_error(database_type, error, _context(database_type, "connect"))

        assert result == (
            f"Could not connect to {_NAMES[database_type]} at db:{_PORTS[database_type]}: "
            f"{error}",
            UNREACHABLE,
        )


class TestLoginRefused:
    """A login refusal at connect names the user and the host with the database's text."""

    @pytest.mark.parametrize(
        ("database_type", "error", "text"),
        [
            pytest.param(
                "postgresql",
                _postgres("28P01", 'password authentication failed for user "wave"', "FATAL"),
                'password authentication failed for user "wave"',
                id="postgresql-28P01",
            ),
            pytest.param(
                "postgresql",
                _postgres(
                    "28000",
                    'no pg_hba.conf entry for host "10.0.0.5", user "wave", database "wave"',
                    "FATAL",
                ),
                'no pg_hba.conf entry for host "10.0.0.5", user "wave", database "wave"',
                id="postgresql-28000",
            ),
            pytest.param(
                "mysql",
                FakeDriverError(1044, "Access denied for user 'wave'@'%' to database 'wave'"),
                "Access denied for user 'wave'@'%' to database 'wave'",
                id="mysql-1044",
            ),
            pytest.param(
                "mysql",
                FakeDriverError(
                    1045, "Access denied for user 'wave'@'10.0.0.5' (using password: YES)"
                ),
                "Access denied for user 'wave'@'10.0.0.5' (using password: YES)",
                id="mysql-1045",
            ),
            pytest.param(
                "mysql",
                FakeDriverError(1698, "Access denied for user 'wave'@'localhost'"),
                "Access denied for user 'wave'@'localhost'",
                id="mysql-1698",
            ),
            pytest.param(
                "oracle",
                _oracle("ORA-01005", "ORA-01005: null password given; logon denied"),
                "ORA-01005: null password given; logon denied",
                id="oracle-ORA-01005",
            ),
            pytest.param(
                "oracle",
                _oracle(
                    "ORA-01017", "ORA-01017: invalid credential or not authorized; logon denied"
                ),
                "ORA-01017: invalid credential or not authorized; logon denied",
                id="oracle-ORA-01017",
            ),
            pytest.param(
                "oracle",
                _oracle("ORA-28000", "ORA-28000: The account is locked."),
                "ORA-28000: The account is locked.",
                id="oracle-ORA-28000",
            ),
            pytest.param(
                "oracle",
                _oracle("ORA-28001", "ORA-28001: the password has expired"),
                "ORA-28001: the password has expired",
                id="oracle-ORA-28001",
            ),
            pytest.param(
                "mssql",
                _TdsError(18452, "Login failed. The login is from an untrusted domain."),
                "Login failed. The login is from an untrusted domain.",
                id="mssql-18452",
            ),
            pytest.param(
                "mssql",
                _TdsError(18456, "Login failed for user 'wave'."),
                "Login failed for user 'wave'.",
                id="mssql-18456",
            ),
            pytest.param(
                "mssql",
                _TdsError(18486, "Login failed for user 'wave' because the account is locked."),
                "Login failed for user 'wave' because the account is locked.",
                id="mssql-18486",
            ),
            pytest.param(
                "mssql",
                _TdsError(18487, "Login failed for user 'wave'. The password has expired."),
                "Login failed for user 'wave'. The password has expired.",
                id="mssql-18487",
            ),
            pytest.param(
                "mssql",
                _TdsError(18488, "Login failed for user 'wave'. The password must be changed."),
                "Login failed for user 'wave'. The password must be changed.",
                id="mssql-18488",
            ),
        ],
    )
    def test_the_message_names_the_user_and_host(
        self, database_type: str, error: BaseException, text: str
    ) -> None:
        result = map_error(database_type, error, _context(database_type, "connect"))

        assert result == (f"Authentication failed for wave at db: {text}", AUTH_FAILED)


class TestConnectServerErrors:
    """A server error at connect that is not a login refusal is the database's own words."""

    @pytest.mark.parametrize(
        ("database_type", "error", "message"),
        [
            pytest.param(
                "postgresql",
                _postgres("3D000", 'database "nope" does not exist', "FATAL"),
                '3D000: database "nope" does not exist',
                id="postgresql-3D000",
            ),
            pytest.param(
                "mysql",
                FakeDriverError(1049, "Unknown database 'nope'"),
                "1049: Unknown database 'nope'",
                id="mysql-1049",
            ),
            pytest.param(
                "mssql",
                _tds_gave_up(
                    _TdsError(4060, 'Cannot open database "nope" requested by the login.')
                ),
                '4060: Cannot open database "nope" requested by the login.',
                id="mssql-4060-after-the-login-timeout",
            ),
            pytest.param(
                "oracle",
                _oracle("ORA-01034", "ORA-01034: ORACLE not available"),
                "ORA-01034: ORACLE not available",
                id="oracle-ORA-01034",
            ),
        ],
    )
    def test_the_database_code_and_text_are_the_message(
        self, database_type: str, error: BaseException, message: str
    ) -> None:
        result = map_error(database_type, error, _context(database_type, "connect"))

        assert result == (message, DATABASE_ERROR)


class TestStatementErrors:
    """A refused statement carries the database's own code and text unchanged (SQL-5)."""

    @pytest.mark.parametrize(
        ("database_type", "error", "message"),
        [
            pytest.param(
                "postgresql",
                _postgres("42P01", 'relation "nope" does not exist'),
                '42P01: relation "nope" does not exist',
                id="postgresql-42P01",
            ),
            pytest.param(
                "mysql",
                FakeDriverError(1146, "Table 'wave.nope' doesn't exist"),
                "1146: Table 'wave.nope' doesn't exist",
                id="mysql-1146",
            ),
            pytest.param(
                "mssql",
                _TdsError(208, "Invalid object name 'nope'."),
                "208: Invalid object name 'nope'.",
                id="mssql-208",
            ),
            pytest.param(
                "mssql",
                _TdsError(208, "", message="Invalid object name 'nope'."),
                "208: Invalid object name 'nope'.",
                id="mssql-208-text-from-the-exception",
            ),
            pytest.param(
                "oracle",
                _oracle("ORA-00942", "ORA-00942: table or view does not exist"),
                "ORA-00942: table or view does not exist",
                id="oracle-ORA-00942-unchanged",
            ),
            pytest.param(
                "postgresql",
                _postgres("28P01", 'password authentication failed for user "wave"'),
                '28P01: password authentication failed for user "wave"',
                id="postgresql-login-code-after-connect",
            ),
            pytest.param(
                "mysql",
                FakeDriverError(1045, "Access denied for user 'wave'@'%'"),
                "1045: Access denied for user 'wave'@'%'",
                id="mysql-login-code-after-connect",
            ),
        ],
    )
    def test_a_server_error_is_the_database_code_and_text(
        self, database_type: str, error: BaseException, message: str
    ) -> None:
        result = map_error(database_type, error, _context(database_type, "statement"))

        assert result == (message, DATABASE_ERROR)

    def test_a_sqlite_error_is_its_own_text(self) -> None:
        context = _context("sqlite", "statement", host="", file="/data/orders.db")

        result = map_error("sqlite", _sqlite_error("SELECT * FROM nope"), context)

        assert result == ("no such table: nope", DATABASE_ERROR)

    @pytest.mark.parametrize(
        ("statements", "text"),
        [
            pytest.param(
                (
                    "CREATE TABLE orders (id INTEGER PRIMARY KEY)",
                    "INSERT INTO orders VALUES (1)",
                    "INSERT INTO orders VALUES (1)",
                ),
                "UNIQUE constraint failed: orders.id",
                id="unique",
            ),
            pytest.param(
                (
                    "PRAGMA foreign_keys = ON",
                    "CREATE TABLE customers (id INTEGER PRIMARY KEY)",
                    "CREATE TABLE orders (customer_id INTEGER REFERENCES customers (id))",
                    "INSERT INTO orders VALUES (7)",
                ),
                "FOREIGN KEY constraint failed",
                id="foreign-key",
            ),
        ],
    )
    def test_a_sqlite_constraint_error_is_its_own_text(
        self, statements: tuple[str, ...], text: str
    ) -> None:
        context = _context("sqlite", "statement", host="", file="/data/orders.db")
        error = _sqlite_error(*statements)

        result = map_error("sqlite", error, context)

        assert type(error) is apsw.ConstraintError
        assert result == (text, DATABASE_ERROR)

    def test_a_write_on_a_read_only_sqlite_file_is_its_own_text(self, tmp_path: Path) -> None:
        path = sqlite_file(tmp_path / "orders.db", "CREATE TABLE orders (id INTEGER)")
        context = _context("sqlite", "statement", host="", file=str(path))
        error = _sqlite_read_only_error(path)

        result = map_error("sqlite", error, context)

        assert type(error) is apsw.ReadOnlyError
        assert result == ("attempt to write a readonly database", DATABASE_ERROR)

    @pytest.mark.parametrize(
        ("database_type", "error", "text"),
        [
            pytest.param(
                "postgresql",
                OSError("[Errno 104] Connection reset by peer"),
                "[Errno 104] Connection reset by peer",
                id="postgresql-os-error",
            ),
            pytest.param(
                "postgresql",
                Exception("network error"),
                "network error",
                id="postgresql-driver-error",
            ),
            pytest.param(
                "mysql",
                FakeDriverError(2013, "Lost connection to MySQL server during query"),
                "Lost connection to MySQL server during query",
                id="mysql-2013-client-error-text-only",
            ),
            pytest.param(
                "oracle",
                _oracle("DPY-4011", "DPY-4011: the database or network closed the connection"),
                "DPY-4011: the database or network closed the connection",
                id="oracle-dpy-message",
            ),
            pytest.param(
                "mssql",
                OSError("[Errno 32] Broken pipe"),
                "[Errno 32] Broken pipe",
                id="mssql-os-error",
            ),
            pytest.param(
                "mssql",
                _TdsError(0, "Previous statement didn't produce any results"),
                "Previous statement didn't produce any results",
                id="mssql-client-error-numbered-zero",
            ),
            pytest.param(
                "sqlite",
                _sqlite_overflow_error(),
                "int too big to convert",
                id="sqlite-overflow-error",
            ),
        ],
    )
    def test_any_other_failure_is_a_database_error_with_the_driver_text(
        self, database_type: str, error: BaseException, text: str
    ) -> None:
        result = map_error(database_type, error, _context(database_type, "statement"))

        assert result == (text, DATABASE_ERROR)


class TestMysqlClientRange:
    """PyMySQL's own client errors (2000-2999) are not the server's words."""

    @pytest.mark.parametrize("code", [2000, 2999])
    def test_a_client_code_carries_only_its_text(self, code: int) -> None:
        error = FakeDriverError(code, "client side failure")

        result = map_error("mysql", error, _context("mysql", "statement"))

        assert result == ("client side failure", DATABASE_ERROR)

    @pytest.mark.parametrize("code", [1999, 3000, 3024])
    def test_a_code_outside_the_client_range_is_a_server_error(self, code: int) -> None:
        error = FakeDriverError(code, "server side failure")

        result = map_error("mysql", error, _context("mysql", "statement"))

        assert result == (f"{code}: server side failure", DATABASE_ERROR)

    def test_a_client_code_at_connect_is_unreachable(self) -> None:
        error = FakeDriverError(2000, "Unknown MySQL error")

        result = map_error("mysql", error, _context("mysql", "connect"))

        assert result == ("Could not connect to MySQL at db:3306: Unknown MySQL error", UNREACHABLE)


class TestSqlFailurePassThrough:
    """A failure the core raised with its own reason is reported as raised."""

    def test_the_failure_keeps_its_message_and_reason(self) -> None:
        failure = SqlFailure("Key columns are required: orders has no primary key", VALIDATION)

        assert failure.message == "Key columns are required: orders has no primary key"
        assert failure.reason == VALIDATION
        assert isinstance(failure, Exception)

    @pytest.mark.parametrize("phase", ["connect", "statement"])
    @pytest.mark.parametrize(
        ("message", "reason"),
        [
            ("Column 'price' is not in orders", VALIDATION),
            ("Statement timed out after 300 seconds", TIMEOUT),
            (
                "The WAVE host cannot load WAVE's bundled SQLite: No module named 'apsw'",
                UNSUPPORTED,
            ),
        ],
    )
    @pytest.mark.parametrize("database_type", ["postgresql", "mysql", "oracle", "mssql", "sqlite"])
    def test_map_error_passes_it_through(
        self, database_type: str, phase: str, message: str, reason: str
    ) -> None:
        result = map_error(
            database_type, SqlFailure(message, reason), _context(database_type, phase)
        )

        assert result == (message, reason)


class TestDriversAbsent:
    """Classification reads the error's shape and needs no driver module loaded."""

    @pytest.mark.parametrize(
        ("database_type", "error", "message"),
        [
            pytest.param(
                "postgresql",
                _postgres("42P01", 'relation "nope" does not exist'),
                '42P01: relation "nope" does not exist',
                id="postgresql",
            ),
            pytest.param(
                "mysql",
                FakeDriverError(1146, "Table 'wave.nope' doesn't exist"),
                "1146: Table 'wave.nope' doesn't exist",
                id="mysql",
            ),
            pytest.param(
                "oracle",
                _oracle("ORA-00942", "ORA-00942: table or view does not exist"),
                "ORA-00942: table or view does not exist",
                id="oracle",
            ),
            pytest.param(
                "mssql",
                _TdsError(208, "Invalid object name 'nope'."),
                "208: Invalid object name 'nope'.",
                id="mssql",
            ),
        ],
    )
    def test_a_server_error_classifies_with_every_driver_missing(
        self,
        monkeypatch: pytest.MonkeyPatch,
        database_type: str,
        error: BaseException,
        message: str,
    ) -> None:
        for name in ("pg8000", "pg8000.dbapi", "pymysql", "pytds", "oracledb"):
            monkeypatch.setitem(sys.modules, name, None)

        result = map_error(database_type, error, _context(database_type, "statement"))

        assert result == (message, DATABASE_ERROR)


class TestLoadFailure:
    """A connect error that says the driver, or a build under it, could not be imported."""

    _NO_CRYPTO = (
        "DPY-3016: python-oracledb thin mode cannot be used because the cryptography package "
        "cannot be imported\nNo module named '_cffi_backend'"
    )

    @pytest.mark.parametrize("database_type", sorted(_PORTS))
    @pytest.mark.parametrize(
        "error",
        [
            ImportError("libc.so.6: version `GLIBC_2.17' not found"),
            ModuleNotFoundError("No module named 'oracledb'"),
        ],
        ids=["import-error", "module-not-found"],
    )
    def test_an_import_error_is_one_on_every_type_with_the_loaders_words(
        self, database_type: str, error: ImportError
    ) -> None:
        from wavecore.connectivity.sql._errors import load_failure

        assert load_failure(database_type, error) == str(error)

    def test_the_oracle_drivers_own_refusal_of_its_crypto_library_is_one(self) -> None:
        from wavecore.connectivity.sql._errors import load_failure

        refusal = Exception(SimpleNamespace(full_code="DPY-3016", message=self._NO_CRYPTO))

        assert load_failure("oracle", refusal) == self._NO_CRYPTO

    @pytest.mark.parametrize(
        ("database_type", "error"),
        [
            pytest.param("oracle", OSError(_REFUSED), id="refused-connect"),
            pytest.param(
                "oracle",
                Exception(SimpleNamespace(full_code="DPY-6005", message="DPY-6005: no answer")),
                id="another-driver-code",
            ),
            pytest.param(
                "oracle",
                Exception(SimpleNamespace(full_code="ORA-01017", message="ORA-01017: invalid")),
                id="server-error",
            ),
            pytest.param(
                "mysql",
                Exception(SimpleNamespace(full_code="DPY-3016", message="not this driver")),
                id="the-code-on-another-type",
            ),
            pytest.param("postgresql", TimeoutError(), id="timeout"),
            pytest.param("sqlite", KeyError("x"), id="key-error"),
        ],
    )
    def test_any_other_connect_error_is_none(self, database_type: str, error: Exception) -> None:
        from wavecore.connectivity.sql._errors import load_failure

        assert load_failure(database_type, error) is None
