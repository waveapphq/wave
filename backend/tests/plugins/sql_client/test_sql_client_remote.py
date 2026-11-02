"""The SQL block on a remote host (REQ-3.4.1.6, REQ-5.1.4, SQL-15).

The SQL core rides the Remote Execution bundle and dispatches as `sql-client`. PostgreSQL's and
MySQL's drivers travel as source; WAVE's SQLite build, Oracle's driver, and the TLS layer SQL
Server's driver needs, travel as the wheels that fit the probed host, pushed once per worker by
the request WAVE builds. That request also reads WAVE-side files on WAVE and carries decimals
exactly. A host outside the carried set fails the block with reason Unsupported, which follows
On error like every other failure (SQL-5).
"""

import asyncio
import inspect
import json
import re
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import apsw
import pytest

from tests.core.remote_exec.test_bundle import _REGISTRY_PROBE, _run_bundle_lines
from tests.core.remote_exec.test_runner import local_probe
from tests.core.remote_exec.test_wheel_carry import (
    any_platform,
    wheel_cache,
    wheel_entry,
    x86_glibc_cache,
)
from tests.plugins.netcat.conftest import tunnel_registry
from tests.plugins.python.test_python_remote import (
    HOST_FAILED,
    HOST_SESSION,
    _bundle_worker,
    _console,
    _node,
    _passed,
    _session,
)
from tests.plugins.sql_client.conftest import (
    BLOCK_DEFAULTS,
    exact,
    outputs,
    sql_params,
    sqlite_file,
    sqlite_params,
)
from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench.remote_exec import execute_remote_container
from wavecore.core.remote_exec import runner
from wavecore.core.remote_exec.bundle import build_bundle
from wavecore.core.remote_exec.materialize import materialize
from wavecore.core.table import Table
from wavecore.plugins.sql_client import needs_wheels

REMOTE = "sshd"
BUNDLE_REF = "remote-worker"
FITTING: dict[str, Any] = {"python": (3, 12), "machine": "x86_64", "libc": "glibc"}
BEYOND: dict[str, Any] = {"python": (3, 15), "machine": "x86_64", "libc": "glibc"}
UNSUPPORTED_ORACLE = (
    r"^sshd cannot run Oracle: it has Python 3\.15 on x86_64 / glibc; WAVE carries .+$"
)
UNSUPPORTED_SQL_SERVER = (
    r"^sshd cannot run SQL Server: it has Python 3\.15 on x86_64 / glibc; WAVE carries .+$"
)
UNSUPPORTED_TEXT = (
    "sshd cannot run Oracle: it has Python 3.15 on x86_64 / glibc; "
    "WAVE carries Python 3.10-3.14 on x86_64 / glibc"
)
UNSUPPORTED_SQLITE_TEXT = (
    "sshd cannot run SQLite: it has Python 3.15 on x86_64 / glibc; "
    "WAVE carries Python 3.10-3.14 on x86_64 / glibc"
)
ORACLE_WHEELS = [
    *[wheel_entry(name)["file"] for name in ("oracledb", "cryptography", "cffi")],
    any_platform("typing_extensions")["file"],
]
SQL_SERVER_WHEELS = [
    *[wheel_entry(name)["file"] for name in ("pyopenssl", "cryptography", "cffi")],
    any_platform("typing_extensions")["file"],
]
SQLITE_WHEELS = [wheel_entry("apsw")["file"]]
EMPTY_TABLE = {"__wave_type": "table", "columns": [], "rows": []}
CORE_IMPORT = "from wavecore.plugins import _sql_core as sql_core"
CORE_ENTRY = '"sql-client": lambda params, variables, logs: sql_core.run(params, _logger(logs)),'
CORE_HOST = "sql_core.REMOTE_HOST = socket.gethostname()"
ORDERS = (
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER)",
    "INSERT INTO orders VALUES (1, 5)",
    "INSERT INTO orders VALUES (2, 7)",
)


def _refusal(scheme: str) -> str:
    return f"{scheme} paths are not available on the remote host"


@pytest.fixture(autouse=True)
def _registered_plugins() -> Iterator[None]:
    """Register the SQL block the container looks up, and leave no session behind."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.sql_client import SQLClientPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(SQLClientPlugin())
    yield
    clear_registry()
    wb_common._workbench_sessions.clear()
    log_streaming_service._session_logs.clear()
    log_streaming_service._session_registries.clear()


@pytest.fixture
def wheels(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A wheel cache holding every compiled package for Python 3.10 to 3.14 on x86_64 / glibc."""
    return wheel_cache(monkeypatch, tmp_path / "cache", x86_glibc_cache())


def _worker(found: dict[str, Any] = FITTING) -> MagicMock:
    """An open worker on the remote host: its probe, the wheels it holds, its input."""
    worker = MagicMock()
    worker.host = REMOTE
    worker.probe = found
    worker.wheels = set()
    worker.process.stdin.write = MagicMock()
    worker.process.stdin.drain = AsyncMock()
    return worker


def _pushed(worker: MagicMock) -> list[list[str]]:
    """The wheel names of every wheel line written to the worker, one list per line."""
    text = "".join(str(call.args[0]) for call in worker.process.stdin.write.call_args_list)
    return [
        [wheel["name"] for wheel in json.loads(line)["wheels"]]
        for line in text.splitlines()
        if line.strip()
    ]


def _folders(tmp_path: Path) -> dict[str, Any]:
    """A session whose Test Data and Artifacts folders sit under tmp_path."""
    testdata, artifacts = tmp_path / "testdata", tmp_path / "artifacts"
    testdata.mkdir()
    artifacts.mkdir()
    session = _session(testdata)
    session["artifacts_dir"] = str(artifacts)
    return session


def _scheme_folder(session: dict[str, Any], scheme: str) -> Path:
    if scheme == "testdata://":
        return Path(session["testdata_dirs"][0])
    return Path(session["artifacts_dir"])


async def _request(
    params: dict[str, Any], worker: MagicMock | None = None, session: dict[str, Any] | None = None
) -> dict[str, Any]:
    session = session if session is not None else _session()
    request: dict[str, Any] = await _remote_exec._sql_request(
        worker if worker is not None else _worker(), params, session["session_id"]
    )
    return request


def _network(database_type: str, **overrides: Any) -> dict[str, Any]:
    return sql_params(database_type=database_type, **overrides)


def _worker_lines() -> list[str]:
    return [line.strip() for line in build_bundle(BUNDLE_REF).decode("utf-8").splitlines()]


def _sql_request_line(params: dict[str, Any]) -> dict[str, Any]:
    return {"plugin_id": "sql-client", "params": {**BLOCK_DEFAULTS, **params}, "variables": {}}


def _on_a_bare_sqlite_host(requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The built bundle on a bare interpreter that got WAVE's SQLite build for it first."""
    # Starts a child Python.
    build = runner.select_wheels(local_probe(), "sqlite", REMOTE)
    return _run_bundle_lines(requests, isolated=True, frames=[runner.wheel_frame(build)])


async def _sqlite_host_worker(
    handle: Any,
    plugin_id: str,
    params: dict[str, Any],
    variables: dict[str, Any],
    trust: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One request answered by a remote host's worker that holds WAVE's SQLite build."""
    request: dict[str, Any] = {
        "id": "r1",
        "plugin_id": plugin_id,
        "params": params,
        "variables": variables,
    }
    if trust is not None:
        request["trust"] = trust
    [response] = await asyncio.to_thread(_on_a_bare_sqlite_host, [request])
    return response


def _stored(database: Path, sql: str) -> list[tuple[Any, ...]]:
    """What a query reads from the file through the bundled build, opened and closed here."""
    connection = apsw.Connection(str(database))
    try:
        return list(connection.execute(sql))
    finally:
        connection.close()


class TestTheBundleCarriesTheSqlBlock:
    """The block dispatches on the remote worker the way the other remotable blocks do."""

    def test_the_worker_registry_lists_sql_client(self) -> None:
        [response] = _run_bundle_lines(
            [{"plugin_id": "registry-probe", "params": {}, "variables": {}}],
            source_patch=_REGISTRY_PROBE,
        )

        assert response["status"] == "passed", response["error"]
        assert "sql-client" in response["return_value"]

    def test_the_worker_imports_the_core_on_a_line_of_its_own(self) -> None:
        assert CORE_IMPORT in _worker_lines()

    def test_the_dispatch_entry_runs_the_core_with_the_bundle_logger(self) -> None:
        assert CORE_ENTRY in _worker_lines()

    def test_the_worker_names_its_own_host_to_the_core(self) -> None:
        assert CORE_HOST in _worker_lines()


class TestASqliteRunRoundTripsThroughTheBundle:
    """WAVE's SQLite build pushed first, the bundle under a bare interpreter, the answer typed."""

    def test_the_rows_come_back_as_a_table(self, tmp_path: Path) -> None:
        database = sqlite_file(tmp_path / "t.db", *ORDERS)
        request = _sql_request_line(
            sqlite_params(database, sql="SELECT id, qty FROM orders ORDER BY id")
        )

        [response] = _on_a_bare_sqlite_host([request])

        assert response["status"] == "passed", response["error"]
        result = materialize(response["return_value"])
        assert isinstance(result["rows"], Table)
        assert result["rows"].col_names() == ["id", "qty"]
        assert result["rows"].col_types() == ["integer", "integer"]
        assert result["rows"].to_list() == [{"id": 1, "qty": 5}, {"id": 2, "qty": 7}]
        assert result["row_count"] == 2
        assert result["rows_changed"] == 0
        assert result["success"] is True

    def test_the_connected_line_names_the_bundled_sqlite_and_the_file(self, tmp_path: Path) -> None:
        database = sqlite_file(tmp_path / "t.db", *ORDERS)

        [response] = _on_a_bare_sqlite_host([_sql_request_line(sqlite_params(database))])

        connected = f"Connected to SQLite {apsw.sqlitelibversion()} at {database}"
        assert {"level": "INFO", "message": connected} in response["logs"]

    def test_a_write_lands_in_the_hosts_file(self, tmp_path: Path) -> None:
        database = sqlite_file(tmp_path / "t.db", *ORDERS)
        sql = "UPDATE orders SET qty = qty + 1"

        [response] = _on_a_bare_sqlite_host([_sql_request_line(sqlite_params(database, sql=sql))])

        assert response["status"] == "passed", response["error"]
        assert outputs(response["return_value"])["rows_changed"] == 2
        assert _stored(database, "SELECT qty FROM orders ORDER BY id") == [(6,), (8,)]


class TestTheRemoteHostRefusesAWaveSideSqliteFile:
    """Test Data and Artifacts live on WAVE; a remote host cannot open them (SQL-5 Validation)."""

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    def test_the_refusal_follows_on_error_and_opens_nothing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, scheme: str
    ) -> None:
        monkeypatch.chdir(tmp_path)
        params = sqlite_params(Path("t.db"), file=f"{scheme}t.db")

        failed, recorded = _on_a_bare_sqlite_host(
            [
                _sql_request_line(params),
                _sql_request_line({**params, "on_error": "record"}),
            ]
        )

        assert failed["status"] == "failed"
        assert failed["error"] == _refusal(scheme)
        assert recorded["status"] == "passed", recorded["error"]
        assert outputs(recorded["return_value"])["reason"] == "Validation"
        warning = f"Run SQL failed (Validation): {_refusal(scheme)}"
        assert {"level": "WARN", "message": warning} in recorded["logs"]
        assert not [e for e in recorded["logs"] if e["message"].startswith("Connected to")]
        assert list(tmp_path.iterdir()) == []


class TestAnUnsupportedHostFollowsOnError:
    """The message WAVE hands over fails the block before anything connects (SQL-15, SQL-5)."""

    def test_fail_raises_the_message_and_record_returns_the_empties(self) -> None:
        params = _network("oracle", unsupported=UNSUPPORTED_TEXT)

        failed, recorded = _run_bundle_lines(
            [
                _sql_request_line(params),
                _sql_request_line({**params, "on_error": "record"}),
            ],
            isolated=True,
        )

        assert failed["status"] == "failed"
        assert failed["error"] == UNSUPPORTED_TEXT
        assert recorded["status"] == "passed", recorded["error"]
        assert outputs(recorded["return_value"]) == {
            "rows": EMPTY_TABLE,
            "row_count": 0,
            "rows_changed": 0,
            "success": False,
            "error": UNSUPPORTED_TEXT,
            "reason": "Unsupported",
            "__block_warning": True,
        }
        warning = f"Run SQL failed (Unsupported): {UNSUPPORTED_TEXT}"
        assert {"level": "WARN", "message": warning} in recorded["logs"]
        assert not [e for e in recorded["logs"] if e["message"].startswith("Connected to")]


class TestTheRequestCarriesTheWheelsItsDriverNeeds:
    """_sql_request pushes the fitting wheels before the request, once per worker."""

    @pytest.mark.parametrize(
        "params",
        [
            pytest.param(_network("postgresql"), id="postgresql"),
            pytest.param(_network("mysql"), id="mysql"),
            pytest.param(sql_params(), id="type-left-at-its-default"),
        ],
    )
    async def test_a_driver_that_travels_as_source_pushes_nothing(
        self, wheels: Path, params: dict[str, Any]
    ) -> None:
        worker = _worker(BEYOND)

        request = await _request(params, worker)

        assert _pushed(worker) == []
        assert "unsupported" not in request

    async def test_sqlite_pushes_the_bundled_build(self, wheels: Path) -> None:
        worker = _worker()

        request = await _request(sqlite_params(Path("/srv/data/t.db")), worker)

        assert _pushed(worker) == [SQLITE_WHEELS]
        assert "unsupported" not in request

    async def test_oracle_pushes_its_fitting_wheels(self, wheels: Path) -> None:
        worker = _worker()

        request = await _request(_network("oracle"), worker)

        assert _pushed(worker) == [ORACLE_WHEELS]
        assert "unsupported" not in request

    async def test_a_worker_gets_the_wheels_once(self, wheels: Path) -> None:
        worker = _worker()
        session = _session()

        await _request(_network("oracle"), worker, session)
        await _request(_network("oracle", sql="SELECT 2 FROM dual"), worker, session)

        assert _pushed(worker) == [ORACLE_WHEELS]

    async def test_another_worker_gets_its_own_copy(self, wheels: Path) -> None:
        first, second = _worker(), _worker()

        await _request(_network("oracle"), first)
        await _request(_network("oracle"), second)

        assert _pushed(second) == [ORACLE_WHEELS]

    async def test_sql_server_with_tls_off_pushes_nothing(self, wheels: Path) -> None:
        worker = _worker(BEYOND)

        request = await _request(_network("mssql", tls=False), worker)

        assert _pushed(worker) == []
        assert "unsupported" not in request

    @pytest.mark.parametrize(
        "tls", [pytest.param({"tls": True}, id="on"), pytest.param({}, id="default-on")]
    )
    async def test_sql_server_with_tls_on_pushes_its_wheels(
        self, wheels: Path, tls: dict[str, Any]
    ) -> None:
        worker = _worker()

        await _request(_network("mssql", **tls), worker)

        assert _pushed(worker) == [SQL_SERVER_WHEELS]

    @pytest.mark.parametrize(
        ("params", "pattern"),
        [
            pytest.param(_network("oracle"), UNSUPPORTED_ORACLE, id="oracle"),
            pytest.param(_network("mssql", tls=True), UNSUPPORTED_SQL_SERVER, id="sql-server"),
            pytest.param(
                sqlite_params(Path("/srv/data/t.db")), exact(UNSUPPORTED_SQLITE_TEXT), id="sqlite"
            ),
        ],
    )
    async def test_a_host_outside_the_carried_set_hands_the_core_the_message(
        self, wheels: Path, params: dict[str, Any], pattern: str
    ) -> None:
        worker = _worker(BEYOND)

        request = await _request(params, worker)

        assert _pushed(worker) == []
        assert re.fullmatch(pattern, request["unsupported"]), request["unsupported"]

    async def test_a_type_added_to_the_carried_packages_table_gets_its_builds(
        self, wheels: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setitem(runner.COMPILED_PACKAGES, "mysql", ("apsw",))
        worker = _worker()

        await _request(_network("mysql"), worker)

        assert _pushed(worker) == [SQLITE_WHEELS]

    @pytest.mark.parametrize(
        ("tls", "needed"),
        [pytest.param(False, False, id="tls-off"), pytest.param(True, True, id="tls-on")],
    )
    def test_sql_server_needs_its_builds_only_over_tls(self, tls: bool, needed: bool) -> None:
        assert needs_wheels(_network("mssql", tls=tls)) is needed


class TestTheRequestCarriesDecimalsExactly:
    """A Decimal cannot cross as JSON; it crosses as its exact text in a typed envelope."""

    async def test_a_decimal_parameter_crosses_as_its_text(self) -> None:
        values = {"qty": Decimal("5.50"), "name": "ann", "count": 3, "none": None}

        request = await _request(_network("postgresql", parameters=values))

        assert request["parameters"] == {
            "qty": {"__wave_type": "decimal", "value": "5.50"},
            "name": "ann",
            "count": 3,
            "none": None,
        }

    async def test_a_decimal_argument_crosses_as_its_text(self) -> None:
        params = _network(
            "postgresql",
            operation="call_procedure",
            procedure="app.p",
            arguments={"a": Decimal("-0.001"), "b": "text"},
        )

        request = await _request(params)

        assert request["arguments"] == {
            "a": {"__wave_type": "decimal", "value": "-0.001"},
            "b": "text",
        }

    async def test_the_request_frames_as_json(self) -> None:
        params = _network("postgresql", parameters={"qty": Decimal("5.50")})

        request = await _request(params)

        assert json.loads(json.dumps(request)) == request
        assert Decimal(request["parameters"]["qty"]["value"]) == Decimal("5.50")


class TestTheRequestReadsWaveSideFilesOnWave:
    """A Test Data or Artifacts file is read here and sent along, as the local run reads it."""

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    async def test_a_scheme_sql_file_is_sent_as_source(self, tmp_path: Path, scheme: str) -> None:
        session = _folders(tmp_path)
        script = "SELECT 1;\nSELECT 2;\n"
        (_scheme_folder(session, scheme) / "q.sql").write_text(script, encoding="utf-8")
        params = _network("postgresql", script_type="file", sql_file=f"{scheme}q.sql")
        del params["sql"]

        request = await _request(params, session=session)

        assert request["sql"] == script
        assert request["script_type"] == "source"
        assert "sql_file" not in request

    async def test_a_plain_sql_file_path_is_left_for_the_remote_host(self, tmp_path: Path) -> None:
        params = _network("postgresql", script_type="file", sql_file="/srv/q.sql")
        del params["sql"]

        request = await _request(params, session=_folders(tmp_path))

        assert request["script_type"] == "file"
        assert request["sql_file"] == "/srv/q.sql"

    async def test_a_scheme_sql_file_behind_source_mode_is_not_read(self, tmp_path: Path) -> None:
        params = _network("postgresql", script_type="source", sql_file="testdata://gone.sql")

        request = await _request(params, session=_folders(tmp_path))

        assert request["sql"] == "SELECT 1"
        assert request["script_type"] == "source"

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    async def test_a_scheme_table_file_is_sent_as_a_table(
        self, tmp_path: Path, scheme: str
    ) -> None:
        session = _folders(tmp_path)
        csv_file = _scheme_folder(session, scheme) / "orders.csv"
        csv_file.write_text("id,qty\n1,5\n2,\n", encoding="utf-8-sig")
        params = _network(
            "postgresql", operation="load_table", table=f"{scheme}orders.csv", target_table="orders"
        )

        request = await _request(params, session=session)

        assert request["table"] == {
            "__wave_type": "table",
            "columns": [{"name": "id", "type": "string"}, {"name": "qty", "type": "string"}],
            "rows": [["1", "5"], ["2", None]],
        }

    async def test_a_table_variable_is_sent_as_its_envelope(self) -> None:
        table = Table(columns=[("id", "integer"), ("price", "float")])
        table.add_row([1, Decimal("2.50")])
        params = _network("postgresql", operation="load_table", table=table, target_table="t")

        request = await _request(params)

        assert request["table"] == {"__wave_type": "table", **table.to_dict()}

    async def test_a_plain_table_path_is_left_for_the_remote_host(self) -> None:
        params = _network(
            "postgresql", operation="load_table", table="/srv/orders.csv", target_table="orders"
        )

        request = await _request(params)

        assert request["table"] == "/srv/orders.csv"

    async def test_a_scheme_sqlite_file_is_left_for_the_core_to_refuse(
        self, tmp_path: Path
    ) -> None:
        session = _folders(tmp_path)
        sqlite_file(Path(session["testdata_dirs"][0]) / "t.db", *ORDERS)

        request = await _request(
            sqlite_params(Path("t.db"), file="testdata://t.db"), session=session
        )

        assert request["file"] == "testdata://t.db"

    async def test_no_tunnel_is_looked_up_for_a_remote_run(self) -> None:
        session = _session()
        session["ssh_session_registry"] = tunnel_registry({15432: "db.internal:5432"}, MagicMock())

        request = await _request(
            _network("postgresql", host="127.0.0.1", port=15432), session=session
        )

        assert "server_name" not in request
        assert (request["host"], request["port"]) == ("127.0.0.1", 15432)


def _body(values: dict[str, Any], bindings: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "rex-1": _node("rex-1", "remote-execution", {"session_id": HOST_SESSION}),
        "body-1": _node("body-1", "sql-client", {**BLOCK_DEFAULTS, **values}, bindings=bindings),
    }


async def _run_sql_body(
    node_map: dict[str, Any],
    session: dict[str, Any],
    handle: Any,
    worker: Any,
    push: AsyncMock | None = None,
) -> dict[str, Any]:
    """Run one SQL block inside a Remote Execution body; hand back the run variables."""
    run_variables: dict[str, Any] = {}
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=handle)),
        patch.object(_remote_exec, "run_on_worker", worker),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
        patch.object(_remote_exec, "push_wheels", push or AsyncMock()),
    ):
        await execute_remote_container(
            "rex-1",
            {"rex-1": [("body-1", "body")]},
            node_map,
            run_variables,
            session,
            session["session_id"],
            set(),
            [],
            None,
        )
    return run_variables


class TestTheBlockInsideARemoteExecutionBody:
    """The body runs the block on the worker, with the request built as above."""

    async def test_a_sqlite_block_binds_its_rows_as_a_table(self, tmp_path: Path) -> None:
        database = sqlite_file(tmp_path / "t.db", *ORDERS)
        values = sqlite_params(database, sql="SELECT id, qty FROM orders ORDER BY id")
        session = _session()

        variables = await _run_sql_body(
            _body(values, bindings={"rows": "orders"}), session, _worker(), _sqlite_host_worker
        )

        assert isinstance(variables["orders"], Table)
        assert variables["orders"].to_list() == [{"id": 1, "qty": 5}, {"id": 2, "qty": 7}]
        assert f"Connected to SQLite {apsw.sqlitelibversion()} at {database}" in _console()

    async def test_a_sqlite_block_on_a_host_outside_the_carried_set_is_refused_by_name(
        self, tmp_path: Path, wheels: Path
    ) -> None:
        database = tmp_path / "t.db"

        with pytest.raises(RuntimeError, match=exact(f"{HOST_FAILED}{UNSUPPORTED_SQLITE_TEXT}")):
            await _run_sql_body(
                _body(sqlite_params(database)), _session(), _worker(BEYOND), _bundle_worker
            )

        assert not database.exists()

    async def test_an_oracle_block_pushes_its_wheels_before_its_request(self, wheels: Path) -> None:
        values = sql_params(database_type="oracle", sql="SELECT 1 FROM dual")
        handle = _worker()
        order: list[str] = []
        push = AsyncMock(side_effect=lambda *args, **kwargs: order.append("push"))
        answer = _passed({"rows": EMPTY_TABLE, "row_count": 0, "rows_changed": 0})

        async def worker(*args: Any, **kwargs: Any) -> dict[str, Any]:
            order.append("request")
            return answer

        await _run_sql_body(_body(values), _session(), handle, worker, push)

        assert order == ["push", "request"]
        bound = inspect.signature(runner.push_wheels).bind(
            *push.await_args.args, **push.await_args.kwargs
        )
        assert list(bound.arguments.values()) == [handle, [wheels / name for name in ORACLE_WHEELS]]

    async def test_a_testdata_sql_file_reaches_the_worker_as_source(
        self, tmp_path: Path, wheels: Path
    ) -> None:
        session = _folders(tmp_path)
        (Path(session["testdata_dirs"][0]) / "q.sql").write_text("SELECT 1;\n", encoding="utf-8")
        values = sqlite_params(
            Path("/srv/data/t.db"), script_type="file", sql_file="testdata://q.sql"
        )
        del values["sql"]
        worker = AsyncMock(return_value=_passed({"rows": EMPTY_TABLE, "row_count": 0}))

        await _run_sql_body(_body(values), session, _worker(), worker)

        sent = worker.await_args.args[2]
        assert (sent["script_type"], sent["sql"]) == ("source", "SELECT 1;\n")
        assert "sql_file" not in sent


def _missing_file_block(kind: str, scheme: str, database: Path) -> tuple[dict[str, Any], str]:
    """A SQLite block naming a WAVE-side file that is not there, and the message it fails with."""
    if kind == "sql_file":
        values = sqlite_params(database, script_type="file", sql_file=f"{scheme}missing.sql")
        del values["sql"]
        return values, f"SQL file not found: {scheme}missing.sql"
    values = sqlite_params(
        database, operation="load_table", table=f"{scheme}missing.csv", target_table="orders"
    )
    return values, f"Table file not found: {scheme}missing.csv"


class TestAMissingWaveSideFileFollowsOnError:
    """A Test Data or Artifacts file that is not there fails like any other failure (SQL-5)."""

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    @pytest.mark.parametrize("kind", ["sql_file", "table"])
    async def test_record_hands_back_the_failure_with_reason_validation(
        self, tmp_path: Path, kind: str, scheme: str
    ) -> None:
        database = tmp_path / "t.db"
        values, message = _missing_file_block(kind, scheme, database)

        variables = await _run_sql_body(
            _body(
                {**values, "on_error": "record"},
                bindings={"success": "ok", "error": "err", "reason": "why"},
            ),
            _folders(tmp_path),
            _worker(),
            _sqlite_host_worker,
        )

        assert (variables["ok"], variables["err"], variables["why"]) == (
            False,
            message,
            "Validation",
        )
        assert not database.exists()

    @pytest.mark.parametrize("kind", ["sql_file", "table"])
    async def test_fail_ends_the_block_with_the_message(self, tmp_path: Path, kind: str) -> None:
        database = tmp_path / "t.db"
        values, message = _missing_file_block(kind, "testdata://", database)

        with pytest.raises(RuntimeError, match=exact(f"{HOST_FAILED}{message}")):
            await _run_sql_body(_body(values), _folders(tmp_path), _worker(), _sqlite_host_worker)

        assert not database.exists()
