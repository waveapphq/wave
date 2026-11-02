"""The Get Tables adapter on the shared catalog jobs: the SQL pull, its cancel, Test Data files.

REQ-3.4.1.6 / REQ-5.1.4, SQL-12: a pull connects from the WAVE server, reads the catalog and
disconnects. Joining, caching and the job states themselves are the shared job table's
(tests/api/services/test_catalog_jobs.py).
"""

import sys
import threading
import time
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.api.services._pull_threads import pull_threads_ended
from tests.connectivity.sql.fakes import FakeConnection, sqlite_file
from tests.plugins.sql_client.conftest import PASSWORD, fake_dialect
from wavecore.api.exceptions import UnprocessableEntityException
from wavecore.api.services import catalog_jobs
from wavecore.api.services.sql_tools import catalog
from wavecore.api.services.storage_paths import get_test_testdata_path
from wavecore.api.services.tests import service as test_service
from wavecore.connectivity.sql import dialects
from wavecore.core.secrets.masking import MASK_PLACEHOLDER

BOUND = 1.0
TABLES = [
    {
        "schema": "public",
        "name": "orders",
        "kind": "table",
        "columns": [{"name": "id", "type": "integer"}, {"name": "qty", "type": "integer"}],
    }
]
ORDERS_DDL = (
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER NOT NULL, note TEXT)",
    "CREATE VIEW order_notes AS SELECT id, note FROM orders",
)
ORDERS_CATALOG = [
    {
        "schema": "main",
        "name": "order_notes",
        "kind": "view",
        "columns": [{"name": "id", "type": "INTEGER"}, {"name": "note", "type": "TEXT"}],
    },
    {
        "schema": "main",
        "name": "orders",
        "kind": "table",
        "columns": [
            {"name": "id", "type": "INTEGER"},
            {"name": "qty", "type": "INTEGER"},
            {"name": "note", "type": "TEXT"},
        ],
    },
]
TESTDATA_FILE = "testdata://orders.db"
NO_TEST_MESSAGE = (
    "testdata:// paths need the test: Get Tables could not resolve testdata://orders.db"
)
REFUSED = "[Errno 111] Connection refused"
ORACLE_ALIAS = (
    "Oracle Driver option dsn 'PRODDB' is a TNS alias, which WAVE does not look up: "
    "use Host, Port and Service name, or paste the full connect descriptor"
)
ORACLE_PROVIDER = (
    "Oracle Driver option dsn 'config-file:///srv/ora/app.json' names a configuration provider, "
    "which WAVE does not use: use Host, Port and Service name, "
    "or paste the full connect descriptor"
)
ORACLE_DIRECTORY = (
    "Oracle Driver option dsn 'ldap://dir.example/cn=orcl' is a directory address, "
    "which WAVE does not look up: use Host, Port and Service name, "
    "or paste the full connect descriptor"
)
ORACLE_PLAIN_UNDER_TLS = (
    "Oracle Driver option dsn 'db1:1521/FREEPDB1' does not use TLS but TLS is on: "
    "start it with tcps://, or turn TLS off"
)
ORACLE_PLAIN_DESCRIPTOR = (
    "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db1)(PORT=1521))"
    "(CONNECT_DATA=(SERVICE_NAME=FREEPDB1)))"
)
ORACLE_DESCRIPTOR_UNDER_TLS = (
    f"Oracle Driver option dsn '{ORACLE_PLAIN_DESCRIPTOR}' does not use TLS but TLS is on: "
    "use PROTOCOL=TCPS in it, or turn TLS off"
)
ORACLE_TLS_UNDER_PLAIN = (
    "Oracle Driver option dsn 'tcps://db1:2484/FREEPDB1' uses TLS but TLS is off: "
    "turn TLS on, so the block's certificate rows apply"
)
ORACLE_ALIAS_TO_THE_DRIVER = (
    "Oracle Driver option dsn 'db1:1521' is a TNS alias, which WAVE does not look up: "
    "use Host, Port and Service name, or paste the full connect descriptor"
)
# (TLS row, dsn, the refusal) for each dsn the Oracle dialect refuses on the driver's own reading.
ORACLE_REFUSED_DSNS = [
    pytest.param(False, "ldap://dir.example/cn=orcl", ORACLE_DIRECTORY, id="directory-address"),
    pytest.param(True, "db1:1521/FREEPDB1", ORACLE_PLAIN_UNDER_TLS, id="plain-dsn-under-tls"),
    pytest.param(True, ORACLE_PLAIN_DESCRIPTOR, ORACLE_DESCRIPTOR_UNDER_TLS, id="descriptor"),
    pytest.param(False, "tcps://db1:2484/FREEPDB1", ORACLE_TLS_UNDER_PLAIN, id="tls-dsn-no-tls"),
    pytest.param(False, "db1:1521", ORACLE_ALIAS_TO_THE_DRIVER, id="alias-to-the-driver"),
]
# (TLS row, protocol Driver option, the refusal) for each protocol that disagrees with the row.
ORACLE_REFUSED_PROTOCOLS = [
    pytest.param(
        True,
        "tcp",
        "Oracle Driver option protocol 'tcp' does not use TLS but TLS is on: "
        "remove it, or turn TLS off",
        id="plain-under-tls",
    ),
    pytest.param(
        False,
        "tcps",
        "Oracle Driver option protocol 'tcps' uses TLS but TLS is off: "
        "turn TLS on, so the block's certificate rows apply",
        id="tls-without-the-row",
    ),
]
UNKNOWN_SQLITE_OPTION = (
    "SQLite Driver option 'isolation_level' is not supported: "
    "SQLite takes timeout and cached_statements"
)


def connection(**rows: Any) -> dict[str, Any]:
    """The 13 connection rows of a PostgreSQL block on db as wave, which `rows` reshape."""
    base: dict[str, Any] = {
        "database_type": "postgresql",
        "host": "db",
        "port": None,
        "database": "wave",
        "username": "wave",
        "password": PASSWORD,
        "file": "",
        "tls": None,
        "verify_ssl": True,
        "ca_cert": "",
        "client_cert": "",
        "client_key": "",
        "driver_options": {},
    }
    return {**base, **rows}


def sqlite_connection(file: str) -> dict[str, Any]:
    """The connection rows of a SQLite block on `file`."""
    return connection(database_type="sqlite", host="", database="", username="", file=file)


class ClosingConnection(FakeConnection):
    """A scripted connection that also signals when it is closed."""

    def __init__(self) -> None:
        super().__init__()
        self.closed_event = threading.Event()

    def close(self) -> None:
        super().close()
        self.closed_event.set()


class SteppedPull:
    """A fake dialect and catalog reader whose connect and read each wait on a test-owned gate."""

    def __init__(self, database_type: str, **faults: Any) -> None:
        self.connection = ClosingConnection()
        self.fake = fake_dialect(database_type, self.connection, **faults)
        self.connect_entered = threading.Event()
        self.connect_gate = threading.Event()
        self.read_entered = threading.Event()
        self.read_gate = threading.Event()
        self.read_error: BaseException | None = None
        self.reads: list[tuple[Any, str]] = []
        connect = self.fake.connect

        def gated_connect(rows: dict[str, Any], connect_timeout: int) -> Any:
            self.connect_entered.set()
            self.connect_gate.wait(BOUND)
            return connect(rows, connect_timeout)

        self.fake.connect = gated_connect

    def read_catalog(self, connection: Any, database_type: str) -> list[dict[str, Any]]:
        self.reads.append((connection, database_type))
        self.read_entered.set()
        self.read_gate.wait(BOUND)
        if self.read_error is not None:
            raise self.read_error
        return TABLES

    def open(self) -> None:
        self.connect_gate.set()
        self.read_gate.set()

    def rows(self, index: int = 0) -> dict[str, Any]:
        """The rows the dialect's connect was given on its `index`-th call."""
        rows: dict[str, Any] = self.fake.connects[index][0]
        return rows


@pytest.fixture(autouse=True)
def registry(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setattr(catalog_jobs, "_JOBS", {})
    monkeypatch.setattr(catalog_jobs, "_BY_KEY", {})
    with pull_threads_ended():
        yield


@pytest.fixture
def pull(monkeypatch: pytest.MonkeyPatch) -> Generator[Callable[..., SteppedPull], None, None]:
    """Install a stepped pull for one database type; `stepped=False` opens both gates at once."""
    made: list[SteppedPull] = []

    def install(
        database_type: str = "postgresql", *, stepped: bool = True, **faults: Any
    ) -> SteppedPull:
        stepped_pull = SteppedPull(database_type, **faults)
        if not stepped:
            stepped_pull.open()
        monkeypatch.setitem(dialects.DIALECTS, database_type, stepped_pull.fake)
        monkeypatch.setattr(catalog, "read_catalog", stepped_pull.read_catalog)
        made.append(stepped_pull)
        return stepped_pull

    yield install
    for stepped_pull in made:
        stepped_pull.open()


def settled(job_id: str) -> dict[str, Any]:
    """The job's status once it has left connecting and reading, polled within the bound."""
    deadline = time.monotonic() + BOUND
    answer = catalog_jobs.status(job_id)
    while answer["status"] in ("connecting", "reading") and time.monotonic() < deadline:
        answer = catalog_jobs.status(job_id)
    return answer


def pulled(connection_rows: dict[str, Any], **start: Any) -> str:
    """Start a pull and wait for it to settle; the job id."""
    job_id = str(catalog.start(connection_rows, **start)["job_id"])
    settled(job_id)
    return job_id


def saved_test(name: str) -> str:
    """A saved test document's id."""
    return str(test_service.create_test({"name": name})["id"])


def seed_test_data_database(test_id: str, name: str = "orders.db") -> Path:
    """A SQLite file with orders and a view in the test's Test Data folder."""
    folder = get_test_testdata_path(test_id)
    folder.mkdir(parents=True, exist_ok=True)
    return sqlite_file(folder / name, *ORDERS_DDL)


class TestJobStates:
    """A pull steps from connecting to reading to done with the tables."""

    def test_a_new_pull_answers_its_job_and_is_not_cached(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        pull()

        started = catalog.start(connection())

        assert started == {"job_id": started["job_id"], "cached": False}
        assert isinstance(started["job_id"], str) and started["job_id"]

    def test_the_pull_steps_through_connecting_and_reading_to_done(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull()
        job_id = catalog.start(connection())["job_id"]

        assert stepped.connect_entered.wait(BOUND)
        assert catalog_jobs.status(job_id) == {"status": "connecting"}
        stepped.connect_gate.set()
        assert stepped.read_entered.wait(BOUND)
        assert catalog_jobs.status(job_id) == {"status": "reading"}
        stepped.read_gate.set()

        assert settled(job_id) == {"status": "done", "tables": TABLES}

    def test_the_pull_connects_with_the_rows_and_the_catalog_connect_timeout(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)

        pulled(connection(port=6543))

        assert catalog.CONNECT_TIMEOUT == 30
        [(rows, connect_timeout)] = stepped.fake.connects
        assert connect_timeout == 30
        assert (rows["host"], rows["port"], rows["database"]) == ("db", 6543, "wave")
        assert (rows["username"], rows["password"]) == ("wave", PASSWORD)
        assert stepped.reads == [(stepped.connection, "postgresql")]

    def test_the_connection_is_closed_after_the_read(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)

        pulled(connection())

        assert stepped.connection.closed_event.wait(BOUND)

    @pytest.mark.parametrize(
        ("database_type", "port", "tls"),
        [
            ("postgresql", 5432, False),
            ("mysql", 3306, False),
            ("oracle", 1521, False),
            ("mssql", 1433, True),
        ],
    )
    def test_a_blank_port_and_tls_take_the_types_defaults(
        self, pull: Callable[..., SteppedPull], database_type: str, port: int, tls: bool
    ) -> None:
        stepped = pull(database_type, stepped=False)

        pulled(connection(database_type=database_type))

        assert (stepped.rows()["port"], stepped.rows()["tls"]) == (port, tls)

    @pytest.mark.parametrize(
        ("database_type", "port"),
        [("postgresql", 5432), ("mysql", 3306), ("oracle", 1521), ("mssql", 1433)],
    )
    def test_an_empty_port_takes_the_types_default(
        self, pull: Callable[..., SteppedPull], database_type: str, port: int
    ) -> None:
        stepped = pull(database_type, stepped=False)

        pulled(connection(database_type=database_type, port=""))

        assert stepped.rows()["port"] == port

    def test_a_set_tls_row_is_kept(self, pull: Callable[..., SteppedPull]) -> None:
        stepped = pull(stepped=False)

        pulled(connection(tls=True))

        assert stepped.rows()["tls"] is True


class TestRowsTheBlockDoesNotHold:
    """A pull carries only the rows the Block holds; the rest take their defaults."""

    @pytest.mark.parametrize(
        ("database_type", "port", "tls"),
        [
            ("postgresql", 5432, False),
            ("mysql", 3306, False),
            ("oracle", 1521, False),
            ("mssql", 1433, True),
        ],
    )
    def test_a_pull_of_only_the_rows_the_block_holds_still_pulls(
        self, pull: Callable[..., SteppedPull], database_type: str, port: int, tls: bool
    ) -> None:
        stepped = pull(database_type, stepped=False)
        held = {
            "database_type": database_type,
            "host": "db",
            "database": "wave",
            "username": "wave",
            "password": PASSWORD,
        }

        job_id = pulled(held)

        assert catalog_jobs.status(job_id) == {"status": "done", "tables": TABLES}
        rows = stepped.rows()
        assert (rows["host"], rows["database"], rows["username"]) == ("db", "wave", "wave")
        assert (rows["port"], rows["tls"], rows["driver_options"]) == (port, tls, {})

    def test_the_trust_rows_take_their_defaults_under_tls(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull("mssql", stepped=False)
        held = {"database_type": "mssql", "host": "db", "database": "wave", "username": "wave"}

        pulled(held)

        assert stepped.rows()["verify_ssl"] is True

    def test_a_sqlite_file_alone_is_read_end_to_end(self, tmp_path: Path) -> None:
        path = sqlite_file(tmp_path / "shop.db", *ORDERS_DDL)

        job_id = pulled({"database_type": "sqlite", "file": str(path)})

        assert catalog_jobs.status(job_id) == {"status": "done", "tables": ORDERS_CATALOG}


class TestJobFailure:
    """A failed pull carries map_error's message and closes what it opened."""

    def test_an_unreachable_host_fails_with_the_connect_message(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        pull(stepped=False, connect_error=OSError("[Errno 111] Connection refused"))

        job_id = pulled(connection())

        assert catalog_jobs.status(job_id) == {
            "status": "failed",
            "error": "Could not connect to PostgreSQL at db:5432: [Errno 111] Connection refused",
        }

    def test_a_refused_login_fails_with_the_authentication_message(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        refused = Exception(
            {"S": "FATAL", "C": "28P01", "M": 'password authentication failed for user "wave"'}
        )
        pull(stepped=False, connect_error=refused)

        job_id = pulled(connection())

        assert catalog_jobs.status(job_id) == {
            "status": "failed",
            "error": "Authentication failed for wave at db: password authentication failed "
            'for user "wave"',
        }

    def test_a_refused_catalog_read_fails_with_the_databases_text_and_closes(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)
        stepped.read_error = Exception(
            {"S": "ERROR", "C": "42501", "M": "permission denied for schema app"}
        )

        job_id = pulled(connection())

        assert catalog_jobs.status(job_id) == {
            "status": "failed",
            "error": "42501: permission denied for schema app",
        }
        assert stepped.connection.closed_event.wait(BOUND)


class TestOracleDsn:
    """Get Tables reads an Oracle dsn as the dialect does: trimmed, blank is none (REQ-3.4.1.19)."""

    @pytest.mark.parametrize("dsn", ["", "   "], ids=["empty", "spaces"])
    @pytest.mark.parametrize(
        ("row", "message"), [("host", "Host is required"), ("database", "Database is required")]
    )
    def test_a_blank_dsn_does_not_stand_in_for_host_and_database(
        self, pull: Callable[..., SteppedPull], dsn: str, row: str, message: str
    ) -> None:
        stepped = pull("oracle", stepped=False)
        rows = connection(database_type="oracle", driver_options={"dsn": dsn}, **{row: ""})

        with pytest.raises(UnprocessableEntityException, match=f"^{message}$"):
            catalog.start(rows)

        assert catalog_jobs._JOBS == {}
        assert stepped.fake.connects == []

    @pytest.mark.parametrize("dsn", ["", "   "], ids=["empty", "spaces"])
    def test_a_connect_failure_under_a_blank_dsn_names_host_and_port(
        self, pull: Callable[..., SteppedPull], dsn: str
    ) -> None:
        pull("oracle", stepped=False, connect_error=OSError(REFUSED))

        job_id = pulled(connection(database_type="oracle", driver_options={"dsn": dsn}))

        assert catalog_jobs.status(job_id) == {
            "status": "failed",
            "error": f"Could not connect to Oracle at db:1521: {REFUSED}",
        }

    def test_a_connect_failure_names_the_dsn_without_its_spaces(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        pull("oracle", stepped=False, connect_error=OSError(REFUSED))
        options = {"dsn": "  db1:1521/FREEPDB1 "}
        rows = connection(database_type="oracle", host="", database="", driver_options=options)

        job_id = pulled(rows)

        assert catalog_jobs.status(job_id) == {
            "status": "failed",
            "error": f"Could not connect to Oracle at db1:1521/FREEPDB1: {REFUSED}",
        }


class TestDialectRefusals:
    """What a dialect refuses reaches Get Tables whole, as it reaches the block (REQ-3.4.1.19)."""

    def test_an_oracle_tns_alias_fails_the_pull_and_nothing_is_dialed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        driver = MagicMock(name="oracledb")
        driver.connect.side_effect = OSError("the alias was dialed")
        monkeypatch.setitem(sys.modules, "oracledb", driver)
        options = {"dsn": "PRODDB"}
        rows = connection(database_type="oracle", host="", database="", driver_options=options)

        job_id = pulled(rows)

        assert catalog_jobs.status(job_id) == {"status": "failed", "error": ORACLE_ALIAS}
        assert driver.connect.call_count == 0

    def test_an_oracle_configuration_provider_dsn_fails_the_pull_and_nothing_is_dialed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        driver = MagicMock(name="oracledb")
        driver.connect.side_effect = OSError("the provider was read")
        monkeypatch.setitem(sys.modules, "oracledb", driver)
        options = {"dsn": "config-file:///srv/ora/app.json"}
        rows = connection(database_type="oracle", host="", database="", driver_options=options)

        job_id = pulled(rows)

        assert catalog_jobs.status(job_id) == {"status": "failed", "error": ORACLE_PROVIDER}
        assert driver.connect.call_count == 0

    @pytest.mark.parametrize(("tls", "dsn", "message"), ORACLE_REFUSED_DSNS)
    def test_an_oracle_dsn_the_driver_reads_otherwise_fails_the_pull_and_nothing_is_dialed(
        self, monkeypatch: pytest.MonkeyPatch, tls: bool, dsn: str, message: str
    ) -> None:
        import oracledb

        dialed = MagicMock(side_effect=OSError("the dsn was dialed"))
        monkeypatch.setattr(oracledb, "connect", dialed)
        monkeypatch.setattr(oracledb.defaults, "config_dir", oracledb.defaults.config_dir)
        rows = connection(
            database_type="oracle",
            host="",
            database="",
            tls=tls,
            verify_ssl=False,
            driver_options={"dsn": dsn},
        )

        job_id = pulled(rows)

        assert catalog_jobs.status(job_id) == {"status": "failed", "error": message}
        assert dialed.call_count == 0

    @pytest.mark.parametrize(("tls", "protocol", "message"), ORACLE_REFUSED_PROTOCOLS)
    def test_an_oracle_protocol_option_against_the_tls_row_fails_the_pull_and_nothing_is_dialed(
        self, monkeypatch: pytest.MonkeyPatch, tls: bool, protocol: str, message: str
    ) -> None:
        driver = MagicMock(name="oracledb")
        driver.connect.side_effect = OSError("the protocol was dialed")
        monkeypatch.setitem(sys.modules, "oracledb", driver)
        options = {"protocol": protocol}
        rows = connection(database_type="oracle", tls=tls, verify_ssl=False, driver_options=options)

        job_id = pulled(rows)

        assert catalog_jobs.status(job_id) == {"status": "failed", "error": message}
        assert driver.connect.call_count == 0

    def test_an_unknown_sqlite_option_fails_the_pull_and_creates_no_file(
        self, tmp_path: Path
    ) -> None:
        path = tmp_path / "missing.db"
        options = {"isolation_level": "DEFERRED"}
        rows = {**sqlite_connection(str(path)), "driver_options": options}

        job_id = pulled(rows)

        assert catalog_jobs.status(job_id) == {"status": "failed", "error": UNKNOWN_SQLITE_OPTION}
        assert not path.exists()


class TestCancel:
    """Cancel reaches the SQL pull: a late connection closes, a read cancels on the database."""

    def test_cancel_while_connecting_closes_the_late_connection(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull()
        job_id = catalog.start(connection())["job_id"]
        assert stepped.connect_entered.wait(BOUND)

        assert catalog_jobs.cancel(job_id) == {"status": "canceled"}
        assert catalog_jobs.status(job_id) == {"status": "canceled"}
        stepped.open()

        assert stepped.connection.closed_event.wait(BOUND)
        assert catalog_jobs.status(job_id) == {"status": "canceled"}

    def test_cancel_while_reading_cancels_on_the_database(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull()
        job_id = catalog.start(connection())["job_id"]
        stepped.connect_gate.set()
        assert stepped.read_entered.wait(BOUND)

        assert catalog_jobs.cancel(job_id) == {"status": "canceled"}

        [handle] = stepped.fake.cancels
        assert handle.database_type == "postgresql"
        assert handle.connection is stepped.connection

    def test_cancel_while_reading_discards_the_late_result(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull()
        job_id = catalog.start(connection())["job_id"]
        stepped.connect_gate.set()
        assert stepped.read_entered.wait(BOUND)
        catalog_jobs.cancel(job_id)

        stepped.read_gate.set()

        assert stepped.connection.closed_event.wait(BOUND)
        assert catalog_jobs.status(job_id) == {"status": "canceled"}

    def test_a_cancel_the_driver_refuses_still_ends_the_job_canceled(
        self, pull: Callable[..., SteppedPull], caplog: pytest.LogCaptureFixture
    ) -> None:
        stepped = pull()
        stepped.fake.cancel = refusing_cancel(OSError(f"cancel refused for {PASSWORD}"))
        job_id = catalog.start(connection())["job_id"]
        stepped.connect_gate.set()
        assert stepped.read_entered.wait(BOUND)

        with caplog.at_level("WARNING", logger=catalog.__name__):
            assert catalog_jobs.cancel(job_id) == {"status": "canceled"}
        stepped.read_gate.set()

        assert stepped.connection.closed_event.wait(BOUND)
        assert catalog_jobs.status(job_id) == {"status": "canceled"}
        assert [(record.levelname, record.getMessage()) for record in caplog.records] == [
            (
                "WARNING",
                f"Get Tables could not cancel job {job_id} on the database: "
                f"OSError: cancel refused for {MASK_PLACEHOLDER}",
            )
        ]


def refusing_cancel(error: BaseException) -> Callable[[Any], None]:
    """A dialect cancel that raises `error`, as a driver does when the cancel cannot reach it."""

    def cancel(handle: Any) -> None:
        raise error

    return cancel


class TestTestDataFile:
    """A SQLite testdata:// file resolves in the test's Test Data folder and opens read-only."""

    def test_a_test_data_file_opens_read_only_from_the_tests_folder(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull("sqlite", stepped=False)
        test_id = saved_test("Catalog Carrier")
        path = seed_test_data_database(test_id)

        pulled(sqlite_connection(TESTDATA_FILE), test_id=test_id)

        assert Path(stepped.rows()["file"]).resolve() == path.resolve()
        assert stepped.rows()["file_read_only"] is True

    def test_a_test_data_file_is_read_end_to_end(self) -> None:
        test_id = saved_test("Catalog Carrier")
        seed_test_data_database(test_id)

        job_id = pulled(sqlite_connection(TESTDATA_FILE), test_id=test_id)

        assert catalog_jobs.status(job_id) == {"status": "done", "tables": ORDERS_CATALOG}

    def test_a_test_data_file_without_the_test_fails_the_pull(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull("sqlite", stepped=False)

        job_id = pulled(sqlite_connection(TESTDATA_FILE))

        assert catalog_jobs.status(job_id) == {"status": "failed", "error": NO_TEST_MESSAGE}
        assert stepped.fake.connects == []

    def test_the_same_test_data_name_in_two_tests_is_two_pulls(
        self, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull("sqlite", stepped=False)
        first_test, second_test = saved_test("First Carrier"), saved_test("Second Carrier")
        first_path = seed_test_data_database(first_test)
        second_path = seed_test_data_database(second_test)
        first = pulled(sqlite_connection(TESTDATA_FILE), test_id=first_test)

        second = catalog.start(sqlite_connection(TESTDATA_FILE), test_id=second_test)

        assert second == {"job_id": second["job_id"], "cached": False}
        assert second["job_id"] != first
        settled(second["job_id"])
        assert [Path(rows["file"]).resolve() for rows, _timeout in stepped.fake.connects] == [
            first_path.resolve(),
            second_path.resolve(),
        ]

    def test_a_plain_path_is_one_pull_whatever_the_test(
        self, pull: Callable[..., SteppedPull], tmp_path: Path
    ) -> None:
        stepped = pull("sqlite", stepped=False)
        path = sqlite_file(tmp_path / "shared.db", *ORDERS_DDL)
        first = pulled(sqlite_connection(str(path)), test_id=saved_test("First Carrier"))

        again = catalog.start(sqlite_connection(str(path)), test_id=saved_test("Second Carrier"))

        assert again == {"job_id": first, "cached": True, "tables": TABLES}
        assert len(stepped.fake.connects) == 1


class TestSqliteFilesOpenReadOnly:
    """Get Tables opens every SQLite file read-only, never creates one, and needs no TLS."""

    def test_a_plain_path_opens_read_only(
        self, pull: Callable[..., SteppedPull], tmp_path: Path
    ) -> None:
        stepped = pull("sqlite", stepped=False)
        path = sqlite_file(tmp_path / "shop.db", *ORDERS_DDL)

        pulled(sqlite_connection(str(path)))

        assert stepped.rows()["file"] == str(path)
        assert stepped.rows()["file_read_only"] is True

    def test_a_missing_plain_path_fails_the_pull_and_creates_no_file(self, tmp_path: Path) -> None:
        path = tmp_path / "missing.db"

        job_id = pulled(sqlite_connection(str(path)))

        assert catalog_jobs.status(job_id) == {
            "status": "failed",
            "error": f"Could not open the SQLite file {path}: unable to open database file",
        }
        assert not path.exists()

    def test_a_real_plain_path_is_read_end_to_end(self, tmp_path: Path) -> None:
        path = sqlite_file(tmp_path / "shop.db", *ORDERS_DDL)

        job_id = pulled(sqlite_connection(str(path)))

        assert catalog_jobs.status(job_id) == {"status": "done", "tables": ORDERS_CATALOG}

    def test_the_tls_rows_are_ignored(self, tmp_path: Path) -> None:
        path = sqlite_file(tmp_path / "shop.db", *ORDERS_DDL)
        rows = {
            **sqlite_connection(str(path)),
            "tls": True,
            "verify_ssl": True,
            "ca_cert": str(tmp_path / "missing-ca.pem"),
            "client_cert": str(tmp_path / "missing-client.pem"),
            "client_key": str(tmp_path / "missing-client.key"),
        }

        job_id = pulled(rows)

        assert catalog_jobs.status(job_id) == {"status": "done", "tables": ORDERS_CATALOG}
