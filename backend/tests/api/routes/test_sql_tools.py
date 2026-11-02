"""The sql-tools endpoints behind the SQL editor (REQ-3.4.1.6, REQ-5.1.4, SQL-10, SQL-12).

    POST   /sql-tools/check              -> {"issues": [{line, col, message}]}
    POST   /sql-tools/catalog            -> 202 {"job_id", "cached": False} | 200 cached tables
    GET    /sql-tools/catalog/{job_id}   -> {"status", ...}
    DELETE /sql-tools/catalog/{job_id}   -> {"status", ...}

Get Tables resolves the block's rows on the server: sealed values, the test's variables in the
chosen Environment and the block's profile bindings, before anything connects.
"""

import re
import threading
import time
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from tests.api.services._pull_threads import pull_threads_ended
from tests.connectivity.sql.fakes import FakeConnection, sqlite_file
from tests.plugins.sql_client.conftest import PASSWORD, fake_dialect
from wavecore.api.services import catalog_jobs, variable_service
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.sql_tools import catalog, check
from wavecore.api.services.storage_paths import get_test_testdata_path
from wavecore.api.services.tests import service as test_service
from wavecore.connectivity.sql import dialects
from wavecore.core.execution.plugin_executor import resolve_parameters
from wavecore.core.expressions.errors import ExpressionEvaluationError
from wavecore.core.secrets.sealing import seal_value

CHECK_PATH = "/sql-tools/check"
CATALOG_PATH = "/sql-tools/catalog"
MB = 1024 * 1024
BOUND = 1.0
DATABASE_TYPES = ["postgresql", "mysql", "oracle", "mssql", "sqlite"]
TABLES = [
    {
        "schema": "public",
        "name": "orders",
        "kind": "table",
        "columns": [{"name": "id", "type": "integer"}, {"name": "qty", "type": "integer"}],
    }
]
CLIENT_KEY = "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBg\n-----END PRIVATE KEY-----\n"
UNREACHABLE = "Could not connect to PostgreSQL at db:5432: [Errno 111] Connection refused"
# The file part is left open: the reference as written or the path it resolves to.
MISSING_TEST_DATA_FILE = (
    r"^Could not open the SQLite file .+missing\.db: unable to open database file$"
)

CHECK_FIXTURES = [
    (
        "postgresql",
        "SELECT 1;\nSELECT * FORM orders WHERE id = :id",
        [{"line": 2, "col": 20, "message": "Invalid expression / Unexpected token"}],
    ),
    (
        "mysql",
        "SELECT id FROM orders WHERE",
        [
            {
                "line": 1,
                "col": 27,
                "message": "Required keyword: 'this' missing for "
                "<class 'sqlglot.expressions.query.Where'>",
            }
        ],
    ),
    (
        "oracle",
        "BEGIN\n  NULL;\nEND;\n/\nSELECT * FROM dual WHERE x = :x AND",
        [
            {
                "line": 5,
                "col": 35,
                "message": "Required keyword: 'expression' missing for "
                "<class 'sqlglot.expressions.core.And'>",
            }
        ],
    ),
    (
        "mssql",
        "SELECT 1\nGO\nSELECT TOP 1 * FROM orders WHERE",
        [
            {
                "line": 3,
                "col": 32,
                "message": "Required keyword: 'this' missing for "
                "<class 'sqlglot.expressions.query.Where'>",
            }
        ],
    ),
    (
        "sqlite",
        "INSERT INTO orders (id, qty) VALUES (:id, :qty",
        [{"line": 1, "col": 43, "message": "Expecting )"}],
    ),
    (
        "postgresql",
        "SELECT 1;  SELECT * FORM t",
        [{"line": 1, "col": 26, "message": "Invalid expression / Unexpected token"}],
    ),
    (
        "postgresql",
        "SELECT 'unterminated",
        [{"line": 1, "col": 1, "message": "Error tokenizing 'SELECT 'unterminate'"}],
    ),
    (
        "postgresql",
        "SELECT * FORM a;\nSELECT * FORM b",
        [
            {"line": 1, "col": 15, "message": "Invalid expression / Unexpected token"},
            {"line": 2, "col": 15, "message": "Invalid expression / Unexpected token"},
        ],
    ),
    (
        "postgresql",
        "SELECT 1;\nSELECT 'open",
        [{"line": 2, "col": 1, "message": "Error tokenizing 'SELECT 'ope'"}],
    ),
    (
        "postgresql",
        "SELECT 1;\r\nSELECT *\r\nFROM orders WHERE",
        [
            {
                "line": 3,
                "col": 17,
                "message": "Required keyword: 'this' missing for "
                "<class 'sqlglot.expressions.query.Where'>",
            }
        ],
    ),
    (
        "postgresql",
        "SELECT '\u00e9\u20ac';  SELECT * FORM t",
        [{"line": 1, "col": 29, "message": "Invalid expression / Unexpected token"}],
    ),
]

SQLITE_DDL = (
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER NOT NULL, note TEXT)",
    "CREATE TABLE customers (id INTEGER, name VARCHAR(40))",
    "CREATE VIEW order_notes AS SELECT id, note FROM orders",
)
SQLITE_CATALOG = [
    {
        "schema": "main",
        "name": "customers",
        "kind": "table",
        "columns": [{"name": "id", "type": "INTEGER"}, {"name": "name", "type": "VARCHAR(40)"}],
    },
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

# (row, label, database type, rows that put it in effect, declared type)
LABELED_ROWS = [
    ("host", "Host", "postgresql", {}, "string"),
    ("port", "Port", "postgresql", {}, "integer"),
    ("database", "Database", "postgresql", {}, "string"),
    ("username", "Username", "postgresql", {}, "string"),
    ("password", "Password", "postgresql", {}, "string"),
    ("file", "File", "sqlite", {"host": "", "database": "", "username": ""}, "string"),
    ("verify_ssl", "Verify Server Certificate", "postgresql", {"tls": True}, "boolean"),
    ("ca_cert", "CA Certificate", "postgresql", {"tls": True}, "string"),
    ("client_cert", "Client Certificate", "postgresql", {"tls": True}, "string"),
    ("client_key", "Client Key", "postgresql", {"tls": True}, "string"),
    ("driver_options", "Driver options", "postgresql", {}, "map"),
]


def connection(**rows: Any) -> dict[str, Any]:
    """The 13 rows of a PostgreSQL block on db as wave, as they sit on the block."""
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
    """The rows of a SQLite block on `file`."""
    return connection(database_type="sqlite", host="", database="", username="", file=file)


def catalog_request(rows: dict[str, Any], **fields: Any) -> dict[str, Any]:
    """A Get Tables request for `rows`; `fields` set the flags, bindings, Environment and test."""
    base: dict[str, Any] = {
        "connection": rows,
        "expression_fields": [],
        "template_fields": [],
        "profile_bindings": [],
        "environment_id": None,
        "test_id": None,
    }
    return {**base, **fields}


def resolver_text(
    row: str, value: str, declared_type: str, variables: dict[str, Any] | None = None
) -> str:
    """What the parameter resolver itself says about one expression row."""
    with pytest.raises(ExpressionEvaluationError) as raised:
        resolve_parameters({row: value}, {row}, variables or {}, {row: declared_type})
    return str(raised.value)


def template_resolver_text(row: str, value: str) -> str:
    """What the parameter resolver itself says about one template row with no variables."""
    with pytest.raises(ExpressionEvaluationError) as raised:
        resolve_parameters({row: value}, set(), {}, {row: "string"}, template_fields={row})
    return str(raised.value)


def assert_error(response: Response, *, status_code: int, code: str, message: str) -> None:
    """Assert the WAVE error envelope with an anchored, escaped message match."""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code
    assert re.match(rf"^{re.escape(message)}$", body["error"]["message"]) is not None


def data_of(response: Response, status_code: int = 200) -> dict[str, Any]:
    """The data of a success envelope answered with `status_code`."""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert set(body) == {"success", "data"}
    assert body["success"] is True
    data: dict[str, Any] = body["data"]
    return data


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
        connect = self.fake.connect

        def gated_connect(rows: dict[str, Any], connect_timeout: int) -> Any:
            self.connect_entered.set()
            self.connect_gate.wait(BOUND)
            return connect(rows, connect_timeout)

        self.fake.connect = gated_connect

    def read_catalog(self, connection: Any, database_type: str) -> list[dict[str, Any]]:
        self.read_entered.set()
        self.read_gate.wait(BOUND)
        return TABLES

    def open(self) -> None:
        self.connect_gate.set()
        self.read_gate.set()

    def rows(self, index: int = 0) -> dict[str, Any]:
        """The rows the dialect's connect was given on its `index`-th call."""
        rows: dict[str, Any] = self.fake.connects[index][0]
        return rows


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


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


@pytest.fixture
def system_variables() -> Generator[Callable[[dict[str, Any]], Any], None, None]:
    """Set WAVE's global variables for one test, starting and ending with none."""
    variable_service._variable_storage.pop("system", None)
    variable_service._system_cache_loaded = False
    yield variable_service.set_system_variables
    variable_service._variable_storage.pop("system", None)
    variable_service._system_cache_loaded = False


def start(client: TestClient, request: dict[str, Any]) -> Response:
    return client.post(CATALOG_PATH, json=request)


def job_status(client: TestClient, job_id: str) -> dict[str, Any]:
    return data_of(client.get(f"{CATALOG_PATH}/{job_id}"))


def settled(client: TestClient, job_id: str) -> dict[str, Any]:
    """The job's status once it has left connecting and reading, polled within the bound."""
    deadline = time.monotonic() + BOUND
    answer = job_status(client, job_id)
    while answer["status"] in ("connecting", "reading") and time.monotonic() < deadline:
        answer = job_status(client, job_id)
    return answer


def pulled(client: TestClient, request: dict[str, Any]) -> str:
    """Start a new pull through the route and wait for it to settle; the job id."""
    job_id = str(data_of(start(client, request), 202)["job_id"])
    settled(client, job_id)
    return job_id


def saved_test(variables: dict[str, Any]) -> str:
    """A saved test declaring `variables`; its id."""
    return str(test_service.create_test({"name": "Catalog Carrier", "variables": variables})["id"])


class TestCheck:
    """POST /sql-tools/check: the dialect-aware syntax check (SQL-10)."""

    @pytest.mark.parametrize(("database_type", "script", "issues"), CHECK_FIXTURES)
    def test_each_finding_carries_its_script_line_column_and_message(
        self,
        client: TestClient,
        database_type: str,
        script: str,
        issues: list[dict[str, Any]],
    ) -> None:
        response = client.post(CHECK_PATH, json={"database_type": database_type, "script": script})

        assert data_of(response) == {"issues": issues}

    @pytest.mark.parametrize("database_type", DATABASE_TYPES)
    def test_a_clean_script_answers_the_empty_envelope(
        self, client: TestClient, database_type: str
    ) -> None:
        response = client.post(
            CHECK_PATH, json={"database_type": database_type, "script": "SELECT 1"}
        )

        assert response.status_code == 200, response.text
        assert response.json() == {"success": True, "data": {"issues": []}}

    def test_an_unknown_database_type_is_refused(self, client: TestClient) -> None:
        response = client.post(CHECK_PATH, json={"database_type": "db2", "script": "SELECT 1"})

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Unknown database type 'db2'",
        )

    def test_the_size_cap_is_one_megabyte(self) -> None:
        assert check.MAX_SCRIPT_BYTES == MB

    def test_a_script_one_byte_over_the_cap_is_refused(self, client: TestClient) -> None:
        script = "SELECT 1" + " " * (MB - 7)

        response = client.post(CHECK_PATH, json={"database_type": "postgresql", "script": script})

        assert_error(
            response,
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message="Script exceeds 1 MB",
        )

    def test_a_script_of_exactly_the_cap_is_checked(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(check, "MAX_SCRIPT_BYTES", 16)
        script = "SELECT 1" + " " * 8

        at_cap = client.post(CHECK_PATH, json={"database_type": "postgresql", "script": script})
        over = client.post(CHECK_PATH, json={"database_type": "postgresql", "script": f"{script} "})

        assert data_of(at_cap) == {"issues": []}
        assert_error(
            over, status_code=422, code="UNPROCESSABLE_ENTITY", message="Script exceeds 1 MB"
        )

    def test_the_cap_counts_utf8_bytes_not_characters(self, client: TestClient) -> None:
        script = "é" * (MB // 2) + "x"

        response = client.post(CHECK_PATH, json={"database_type": "postgresql", "script": script})

        assert_error(
            response,
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message="Script exceeds 1 MB",
        )


class TestCatalogStart:
    """POST /sql-tools/catalog: a new pull, a joined one, a cached one and a refresh."""

    def test_a_new_pull_answers_202_not_cached(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        pull()

        data = data_of(start(client, catalog_request(connection())), 202)

        assert data == {"job_id": data["job_id"], "cached": False}

    def test_a_done_pull_answers_200_with_the_cached_tables(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)
        job_id = pulled(client, catalog_request(connection()))

        data = data_of(start(client, catalog_request(connection())), 200)

        assert data == {"job_id": job_id, "cached": True, "tables": TABLES}
        assert len(stepped.fake.connects) == 1

    def test_a_running_pull_is_joined_under_the_same_job(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull()
        job_id = data_of(start(client, catalog_request(connection())), 202)["job_id"]
        assert stepped.connect_entered.wait(BOUND)

        joined = data_of(start(client, catalog_request(connection())), 202)

        assert joined == {"job_id": job_id, "cached": False}

    def test_refresh_on_a_done_pull_starts_a_new_job(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)
        job_id = pulled(client, catalog_request(connection()))

        data = data_of(start(client, catalog_request(connection(), refresh=True)), 202)

        assert data == {"job_id": data["job_id"], "cached": False}
        assert data["job_id"] != job_id
        assert settled(client, data["job_id"]) == {"status": "done", "tables": TABLES}
        assert len(stepped.fake.connects) == 2

    def test_a_real_sqlite_file_is_pulled_end_to_end(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        path = sqlite_file(tmp_path / "shop.db", *SQLITE_DDL)

        job_id = pulled(client, catalog_request(sqlite_connection(str(path))))

        assert job_status(client, job_id) == {"status": "done", "tables": SQLITE_CATALOG}

    def test_an_oracle_dsn_stands_in_for_host_and_database(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        pull("oracle", stepped=False)
        rows = connection(
            database_type="oracle", host="", database="", driver_options={"dsn": "db:1521/ORCL"}
        )

        job_id = pulled(client, catalog_request(rows))

        assert job_status(client, job_id) == {"status": "done", "tables": TABLES}

    def test_the_connection_carries_only_the_rows_the_block_holds(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        received: list[dict[str, Any]] = []

        def recorded_start(connection_rows: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
            received.append(connection_rows)
            return {"job_id": "job-1", "cached": False}

        monkeypatch.setattr(catalog, "start", recorded_start)
        held = {"database_type": "postgresql", "host": "db", "database": "wave"}

        data_of(start(client, catalog_request(held)), 202)

        assert received == [held]

    def test_the_router_is_registered(self) -> None:
        from wavecore.api.app import app

        paths = app.openapi()["paths"]

        assert CHECK_PATH in paths
        assert CATALOG_PATH in paths
        assert f"{CATALOG_PATH}/{{job_id}}" in paths


class TestCatalogRefusals:
    """The refusals answered before a pull starts."""

    def test_an_unknown_database_type_is_refused(self, client: TestClient) -> None:
        response = start(client, catalog_request(connection(database_type="db2")))

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Unknown database type 'db2'",
        )
        assert catalog_jobs._JOBS == {}

    @pytest.mark.parametrize(
        ("rows", "message"),
        [
            (connection(host=""), "Host is required"),
            (connection(database=""), "Database is required"),
            (connection(database_type="mysql", host=""), "Host is required"),
            (connection(database_type="oracle", database=""), "Database is required"),
            (connection(database_type="mssql", host=""), "Host is required"),
            (
                connection(database_type="oracle", host="", driver_options={"dsn": ""}),
                "Host is required",
            ),
            (connection(host="", driver_options={"dsn": "db:5432/wave"}), "Host is required"),
            (sqlite_connection(""), "File is required"),
        ],
    )
    def test_a_missing_row_is_refused(
        self, client: TestClient, rows: dict[str, Any], message: str
    ) -> None:
        response = start(client, catalog_request(rows))

        assert_error(response, status_code=422, code="UNPROCESSABLE_ENTITY", message=message)
        assert catalog_jobs._JOBS == {}

    @pytest.mark.parametrize(
        ("row", "label", "extra"),
        [("password", "Password", {}), ("client_key", "Client Key", {"tls": True})],
    )
    def test_a_credential_row_holding_null_is_refused_as_a_run_refuses_it(
        self, client: TestClient, row: str, label: str, extra: dict[str, Any]
    ) -> None:
        response = start(client, catalog_request(connection(**{row: None, **extra})))

        assert_error(
            response,
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message=f"Cannot resolve {label}: '{row}' is null",
        )
        assert catalog_jobs._JOBS == {}


class TestCatalogRequestEdges:
    """Blank rows, an Environment that does not exist, and a Test Data file that is not there."""

    def test_an_environment_that_does_not_exist_is_refused(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        pull(stepped=False)

        response = start(client, catalog_request(connection(), environment_id="env-missing"))

        assert_error(
            response,
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message="Environment with ID 'env-missing' not found",
        )
        assert catalog_jobs._JOBS == {}

    @pytest.mark.parametrize(
        ("rows", "message"),
        [
            (connection(host="   "), "Host is required"),
            (connection(database_type="mssql", host=" \t "), "Host is required"),
            (connection(database="  "), "Database is required"),
            (sqlite_connection("   "), "File is required"),
        ],
    )
    def test_a_row_of_only_spaces_is_blank(
        self, client: TestClient, rows: dict[str, Any], message: str
    ) -> None:
        response = start(client, catalog_request(rows))

        assert_error(response, status_code=422, code="UNPROCESSABLE_ENTITY", message=message)
        assert catalog_jobs._JOBS == {}

    def test_a_padded_host_is_trimmed_and_shares_the_pull(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)
        job_id = pulled(client, catalog_request(connection(host="  db  ")))

        data = data_of(start(client, catalog_request(connection())), 200)

        assert stepped.rows()["host"] == "db"
        assert data == {"job_id": job_id, "cached": True, "tables": TABLES}
        assert len(stepped.fake.connects) == 1

    def test_a_padded_oracle_dsn_is_trimmed_and_shares_the_pull(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull("oracle", stepped=False)
        padded = connection(
            database_type="oracle",
            host="",
            database="",
            driver_options={"dsn": "  db1:1521/FREEPDB1 "},
        )
        plain = {**padded, "driver_options": {"dsn": "db1:1521/FREEPDB1"}}
        job_id = pulled(client, catalog_request(padded))

        data = data_of(start(client, catalog_request(plain)), 200)

        assert stepped.rows()["driver_options"] == {"dsn": "db1:1521/FREEPDB1"}
        assert data == {"job_id": job_id, "cached": True, "tables": TABLES}
        assert len(stepped.fake.connects) == 1

    @pytest.mark.parametrize("dsn", ["", "   "], ids=["empty", "spaces"])
    def test_a_blank_oracle_dsn_shares_the_pull_of_no_dsn(
        self, client: TestClient, pull: Callable[..., SteppedPull], dsn: str
    ) -> None:
        stepped = pull("oracle", stepped=False)
        blank = connection(database_type="oracle", driver_options={"dsn": dsn})
        job_id = pulled(client, catalog_request(blank))

        data = data_of(start(client, catalog_request(connection(database_type="oracle"))), 200)

        assert stepped.rows()["driver_options"] == {}
        assert data == {"job_id": job_id, "cached": True, "tables": TABLES}
        assert len(stepped.fake.connects) == 1

    def test_a_missing_test_data_file_fails_the_pull_and_creates_no_file(
        self, client: TestClient
    ) -> None:
        test_id = saved_test({})
        folder = get_test_testdata_path(test_id)
        folder.mkdir(parents=True, exist_ok=True)
        request = catalog_request(sqlite_connection("testdata://missing.db"), test_id=test_id)

        answer = job_status(client, pulled(client, request))

        assert answer["status"] == "failed"
        assert re.match(MISSING_TEST_DATA_FILE, answer["error"]) is not None, answer["error"]
        assert not (folder / "missing.db").exists()


class TestCatalogJobRoutes:
    """GET and DELETE /sql-tools/catalog/{job_id}."""

    def test_get_reports_connecting_then_reading_then_done(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull()
        job_id = data_of(start(client, catalog_request(connection())), 202)["job_id"]

        assert stepped.connect_entered.wait(BOUND)
        assert job_status(client, job_id) == {"status": "connecting"}
        stepped.connect_gate.set()
        assert stepped.read_entered.wait(BOUND)
        assert job_status(client, job_id) == {"status": "reading"}
        stepped.read_gate.set()

        assert settled(client, job_id) == {"status": "done", "tables": TABLES}

    def test_get_reports_a_failed_pull_with_its_message(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        pull(stepped=False, connect_error=OSError("[Errno 111] Connection refused"))

        job_id = pulled(client, catalog_request(connection()))

        assert job_status(client, job_id) == {"status": "failed", "error": UNREACHABLE}

    def test_delete_cancels_a_running_pull(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull()
        job_id = data_of(start(client, catalog_request(connection())), 202)["job_id"]
        stepped.connect_gate.set()
        assert stepped.read_entered.wait(BOUND)

        assert data_of(client.delete(f"{CATALOG_PATH}/{job_id}")) == {"status": "canceled"}
        assert job_status(client, job_id) == {"status": "canceled"}

    def test_delete_of_a_done_pull_leaves_it_done(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        pull(stepped=False)
        job_id = pulled(client, catalog_request(connection()))

        assert data_of(client.delete(f"{CATALOG_PATH}/{job_id}"))["status"] == "done"
        assert job_status(client, job_id) == {"status": "done", "tables": TABLES}

    @pytest.mark.parametrize("method", ["get", "delete"])
    def test_an_unknown_job_is_not_found(self, client: TestClient, method: str) -> None:
        response = getattr(client, method)(f"{CATALOG_PATH}/x")

        assert_error(
            response, status_code=404, code="NOT_FOUND", message="Catalog job 'x' not found"
        )


class TestCatalogResolution:
    """Get Tables resolves the block's rows on the server before anything connects (SQL-12)."""

    def test_sealed_secrets_are_unsealed_before_connecting(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)
        rows = connection(password=seal_value(PASSWORD), client_key=seal_value(CLIENT_KEY))

        pulled(client, catalog_request(rows))

        assert stepped.rows()["password"] == PASSWORD
        assert stepped.rows()["client_key"] == CLIENT_KEY

    def test_credential_rows_the_block_does_not_hold_are_nothing_given(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull("mssql", stepped=False)
        rows = {"database_type": "mssql", "host": "db", "database": "wave", "username": "wave"}

        job_id = pulled(client, catalog_request(rows))

        assert job_status(client, job_id)["status"] == "done"
        assert [stepped.rows()["password"], stepped.rows()["client_key"]] == ["", ""]

    def test_expression_rows_resolve_against_the_tests_variables(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)
        test_id = saved_test(
            {
                "db_host": {"type": "string", "value": "vars-host"},
                "db_port": {"type": "integer", "value": 6543},
                "db_name": {"type": "string", "value": "'orders' + '_v2'", "isExpression": True},
                "db_password": {"type": "string", "value": "pw-from-var", "secret": True},
            }
        )
        rows = connection(
            host="db_host", port="db_port", database="db_name", password="db_password"
        )
        request = catalog_request(
            rows,
            expression_fields=["host", "port", "database", "password"],
            test_id=test_id,
        )

        pulled(client, request)

        resolved = stepped.rows()
        assert (resolved["host"], resolved["port"]) == ("vars-host", 6543)
        assert (resolved["database"], resolved["password"]) == ("orders_v2", "pw-from-var")

    def test_typed_driver_options_reach_the_driver_as_their_types(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        """Driver options rows arrive as their declared types; an expression row evaluates
        (REQ-3.1.3.19, SQL-8)."""
        stepped = pull(stepped=False)
        rows = connection(
            driver_options={
                "timeout": "16",
                "ratio": "2.5",
                "app": "2024",
                "name": "'wave-' + 'e2e'",
            }
        )
        request = catalog_request(
            rows,
            expression_fields=["driver_options.name"],
            element_types={
                "driver_options": {"timeout": "integer", "ratio": "float", "app": "string"}
            },
        )

        pulled(client, request)

        assert stepped.rows()["driver_options"] == {
            "timeout": 16,
            "ratio": 2.5,
            "app": "2024",
            "name": "wave-e2e",
        }

    def test_an_expression_driver_option_of_an_exact_decimal_reaches_the_driver_as_a_float(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        """An expression row's exact decimal is a platform number at the driver (REQ-3.1.3.19)."""
        stepped = pull(stepped=False)
        test_id = saved_test({"wait": {"type": "float", "value": "6.5"}})
        request = catalog_request(
            connection(driver_options={"timeout": "wait + 10", "app": "2024"}),
            expression_fields=["driver_options.timeout"],
            test_id=test_id,
        )

        pulled(client, request)

        options = stepped.rows()["driver_options"]
        assert options == {"timeout": 16.5, "app": "2024"}
        assert type(options["timeout"]) is float

    def test_a_bound_profiles_decimal_driver_option_reaches_the_driver_as_a_float(
        self, client: TestClient, pull: Callable[..., SteppedPull], seed_test_environment: str
    ) -> None:
        """A profile's typed Driver options arrive as the block's own rows do (REQ-3.1.3.19)."""
        stepped = pull(stepped=False)
        typed_options = {
            "type": "map",
            "secret": False,
            "value": {"timeout": "16.5", "cached": "16", "app": "2024"},
            "elementTypes": {"timeout": "float", "cached": "integer", "app": "string"},
        }
        profile = profile_service.create_profile(
            name="Typed Options DB",
            profile_type="database",
            config={"host": "profile-host"},
            environment_values={
                seed_test_environment: {"host": "profile-host", "driver_options": typed_options}
            },
        )
        binding = {
            "profileId": profile["id"],
            "alias": "dbp",
            "profileName": "Typed Options DB",
            "profileType": "database",
        }
        request = catalog_request(
            connection(host="dbp.host", driver_options="dbp.driver_options"),
            expression_fields=["host", "driver_options"],
            profile_bindings=[binding],
            environment_id=seed_test_environment,
        )

        pulled(client, request)

        options = stepped.rows()["driver_options"]
        assert options == {"timeout": 16.5, "cached": 16, "app": "2024"}
        assert type(options["timeout"]) is float

    def test_template_rows_render_against_the_tests_variables(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)
        test_id = saved_test({"db_name": {"type": "string", "value": "orders"}})
        request = catalog_request(
            connection(database="{{ db_name }}_archive"),
            template_fields=["database"],
            test_id=test_id,
        )

        pulled(client, request)

        assert stepped.rows()["database"] == "orders_archive"

    def test_expression_rows_resolve_against_wave_global_variables(
        self,
        client: TestClient,
        pull: Callable[..., SteppedPull],
        system_variables: Callable[[dict[str, Any]], Any],
    ) -> None:
        stepped = pull(stepped=False)
        system_variables({"shared_host": {"type": "string", "value": "global-host"}})
        request = catalog_request(connection(host="system.shared_host"), expression_fields=["host"])

        pulled(client, request)

        assert stepped.rows()["host"] == "global-host"

    @pytest.mark.parametrize(
        ("in_environment", "host", "password"),
        [(True, "env-host", "env-pass"), (False, "profile-host", "profile-pass")],
    )
    def test_profile_bindings_resolve_in_the_chosen_environment(
        self,
        client: TestClient,
        pull: Callable[..., SteppedPull],
        seed_test_environment: str,
        in_environment: bool,
        host: str,
        password: str,
    ) -> None:
        stepped = pull(stepped=False)
        profile = profile_service.create_profile(
            name="Orders DB",
            profile_type="database",
            config={"host": "profile-host", "username": "app", "password": "profile-pass"},
            environment_values={
                seed_test_environment: {
                    "host": "env-host",
                    "username": "app",
                    "password": "env-pass",
                }
            },
        )
        binding = {
            "profileId": profile["id"],
            "alias": "orders",
            "profileName": "Orders DB",
            "profileType": "database",
        }
        rows = connection(
            host="orders.host", username="orders.username", password="orders.password"
        )
        request = catalog_request(
            rows,
            expression_fields=["host", "username", "password"],
            profile_bindings=[binding],
            environment_id=seed_test_environment if in_environment else None,
        )

        pulled(client, request)

        resolved = stepped.rows()
        assert (resolved["host"], resolved["username"]) == (host, "app")
        assert resolved["password"] == password

    @pytest.mark.parametrize(("row", "label", "database_type", "extra", "declared"), LABELED_ROWS)
    def test_a_row_that_cannot_be_resolved_is_refused_by_its_label(
        self,
        client: TestClient,
        pull: Callable[..., SteppedPull],
        row: str,
        label: str,
        database_type: str,
        extra: dict[str, Any],
        declared: str,
    ) -> None:
        pull(database_type, stepped=False)
        rows = connection(database_type=database_type, **extra, **{row: "later_value"})
        expected = f"Cannot resolve {label}: {resolver_text(row, 'later_value', declared)}"

        response = start(client, catalog_request(rows, expression_fields=[row]))

        assert_error(response, status_code=422, code="UNPROCESSABLE_ENTITY", message=expected)
        assert catalog_jobs._JOBS == {}

    def test_a_template_row_that_cannot_be_rendered_is_refused_by_its_label(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        pull(stepped=False)
        template = "{{ later_value }}"
        request = catalog_request(connection(database=template), template_fields=["database"])
        expected = f"Cannot resolve Database: {template_resolver_text('database', template)}"

        response = start(client, request)

        assert_error(response, status_code=422, code="UNPROCESSABLE_ENTITY", message=expected)
        assert catalog_jobs._JOBS == {}

    def test_a_value_of_the_wrong_type_is_refused_by_its_label(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        pull(stepped=False)
        test_id = saved_test({"db_port": {"type": "string", "value": "fifty"}})
        request = catalog_request(
            connection(port="db_port"), expression_fields=["port"], test_id=test_id
        )
        text = resolver_text("port", "db_port", "integer", {"db_port": "fifty"})

        response = start(client, request)

        assert_error(
            response,
            status_code=422,
            code="UNPROCESSABLE_ENTITY",
            message=f"Cannot resolve Port: {text}",
        )

    @pytest.mark.parametrize(
        ("row", "database_type", "message"),
        [
            ("host", "postgresql", "Host is required"),
            ("database", "postgresql", "Database is required"),
            ("file", "sqlite", "File is required"),
        ],
    )
    def test_the_checks_run_on_the_resolved_values(
        self,
        client: TestClient,
        pull: Callable[..., SteppedPull],
        row: str,
        database_type: str,
        message: str,
    ) -> None:
        pull(database_type, stepped=False)
        test_id = saved_test({"blank": {"type": "string", "value": ""}})
        base = connection() if database_type == "postgresql" else sqlite_connection("")
        request = catalog_request({**base, row: "blank"}, expression_fields=[row], test_id=test_id)

        response = start(client, request)

        assert_error(response, status_code=422, code="UNPROCESSABLE_ENTITY", message=message)
        assert catalog_jobs._JOBS == {}

    def test_rows_that_resolve_to_the_same_database_share_one_pull(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)
        job_id = pulled(client, catalog_request(connection()))
        test_id = saved_test({"db_host": {"type": "string", "value": "db"}})
        request = catalog_request(
            connection(host="db_host"), expression_fields=["host"], test_id=test_id
        )

        data = data_of(start(client, request), 200)

        assert data == {"job_id": job_id, "cached": True, "tables": TABLES}
        assert len(stepped.fake.connects) == 1

    def test_two_sealings_of_one_password_share_one_pull(
        self, client: TestClient, pull: Callable[..., SteppedPull]
    ) -> None:
        stepped = pull(stepped=False)
        job_id = pulled(client, catalog_request(connection(password=seal_value(PASSWORD))))

        data = data_of(start(client, catalog_request(connection(password=seal_value(PASSWORD)))))

        assert data == {"job_id": job_id, "cached": True, "tables": TABLES}
        assert len(stepped.fake.connects) == 1

    def test_one_row_text_in_two_environments_is_two_pulls(
        self,
        client: TestClient,
        pull: Callable[..., SteppedPull],
        seed_test_environment: str,
    ) -> None:
        stepped = pull(stepped=False)
        profile = profile_service.create_profile(
            name="Orders DB",
            profile_type="database",
            config={"host": "profile-host"},
            environment_values={seed_test_environment: {"host": "env-host"}},
        )
        binding = {
            "profileId": profile["id"],
            "alias": "orders",
            "profileName": "Orders DB",
            "profileType": "database",
        }
        rows = connection(host="orders.host")
        in_environment = catalog_request(
            rows,
            expression_fields=["host"],
            profile_bindings=[binding],
            environment_id=seed_test_environment,
        )
        first = pulled(client, in_environment)

        data = data_of(start(client, {**in_environment, "environment_id": None}), 202)

        assert data == {"job_id": data["job_id"], "cached": False}
        assert data["job_id"] != first
        settled(client, data["job_id"])
        assert [connected["host"] for connected, _timeout in stepped.fake.connects] == [
            "env-host",
            "profile-host",
        ]
