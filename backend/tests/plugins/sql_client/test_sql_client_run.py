"""Run SQL end to end on real SQLite and on fake network databases (REQ-3.4.1.6, REQ-5.1.4).

Rows as a typed table and Row count as a number are what a state check reads (REQ-3.3.3.3).
"""

import importlib.abc
import logging
import os
import re
import sys
import types
import uuid
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import apsw
import pytest

from tests.connectivity.sql.fakes import FakeConnection, Result, sqlite_file
from tests.plugins.sql_client.conftest import (
    PASSWORD,
    LogRecorder,
    columns,
    exact,
    outputs,
    rows,
    sql_context,
    sql_params,
    sqlite_params,
)
from wavecore.core.execution.plugin_executor import derive_parameter_metadata, resolve_parameters
from wavecore.core.expressions.errors import ExpressionTypeError
from wavecore.core.table import Table
from wavecore.plugins import _sql_core
from wavecore.plugins.sql_client import SQLClientPlugin

ORDERS = (
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER, note TEXT)",
    "INSERT INTO orders VALUES (1, 5, 'a'), (2, 7, 'b'), (3, 9, NULL)",
)
NO_TABLE = "no such table: nope"
UNDEFINED = "Parameter 'missing' is used in the SQL but not defined"
PG_MISSING = '42P01: relation "nope" does not exist'
SESSION_TAIL = "ends the script; its effect ends with the block"
WAVE_CANNOT_LOAD = r"^The WAVE host cannot load WAVE's bundled SQLite: .+$"
HOST_CANNOT_LOAD = r"^The remote host 'edge-7' cannot load WAVE's bundled SQLite: .+$"
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
UNSUPPORTED = (
    "sshd cannot run Oracle: it has Python 3.15 on x86_64 / glibc; "
    "WAVE carries Python 3.10-3.14 on x86_64 / glibc"
)
NO_CARRIED_SQLITE = (
    "edge-7 cannot run SQLite: it has Python 3.15 on x86_64 / glibc; "
    "WAVE carries Python 3.10-3.14 on x86_64 / glibc"
)
RUN_OUTPUTS = {"rows", "row_count", "rows_changed", "success", "error", "reason"}
_MS = re.compile(r", \d+ ms$")


def timed(lines: list[str]) -> list[str]:
    """Lines with each measured millisecond count replaced by N."""
    return [_MS.sub(", N ms", line) for line in lines]


def timed_log(log: LogRecorder) -> list[tuple[str, str]]:
    """Every (level, line) with each measured millisecond count replaced by N."""
    return [(level, _MS.sub(", N ms", line)) for level, line in log]


def connected(path: Path) -> str:
    return f"Connected to SQLite {apsw.sqlitelibversion()} at {path}"


def orders_db(tmp_path: Path) -> Path:
    return sqlite_file(tmp_path / "t.db", *ORDERS)


def query(path: Path, statement: str) -> list[tuple[Any, ...]]:
    """What a fresh connection reads from the database file at `path`."""
    connection = apsw.Connection(str(path))
    try:
        return connection.execute(statement).fetchall()
    finally:
        connection.close()


def pg_error(code: str, text: str) -> Exception:
    """A pg8000 server error: its first argument is the server's field dictionary."""
    return Exception({"S": "ERROR", "C": code, "M": text})


def plain_binds(binds: Any) -> Any:
    """Binds as None, a dict of names, or a list in bind order."""
    if binds is None or isinstance(binds, dict):
        return binds
    return list(binds)


def calls(connection: FakeConnection) -> list[tuple[str, Any]]:
    """Each execute the connection saw as (statement, binds)."""
    return [(statement, plain_binds(binds)) for _, statement, binds in connection.executed]


def empty_run_outputs(out: dict[str, Any]) -> None:
    assert (columns(out["rows"]), rows(out["rows"])) == ([], [])
    assert (out["row_count"], out["rows_changed"]) == (0, 0)


def every_line(log: LogRecorder) -> list[str]:
    return [message for _level, message in log]


class TestStatementsOnSqlite:
    """Statements run in order on real SQLite and fill Rows, Row count and Rows changed."""

    SCRIPT = (
        "CREATE TABLE audit (n INTEGER);\n"
        "INSERT INTO audit VALUES (1), (2);\n"
        "SELECT id, qty FROM orders ORDER BY id;\n"
        "UPDATE orders SET qty = qty + 1 WHERE id < 3;\n"
        "SELECT n FROM audit ORDER BY n;\n"
        "DELETE FROM audit WHERE n = 1"
    )

    def test_the_last_result_set_is_rows_and_rows_changed_is_the_sum(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)

        out = outputs(_sql_core.run(sqlite_params(path, sql=self.SCRIPT), log))

        assert set(out) == RUN_OUTPUTS
        assert columns(out["rows"]) == [("n", "integer")]
        assert rows(out["rows"]) == [[1], [2]]
        assert (out["row_count"], out["rows_changed"]) == (2, 5)
        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert query(path, "SELECT id, qty FROM orders ORDER BY id") == [(1, 6), (2, 8), (3, 9)]
        assert query(path, "SELECT n FROM audit") == [(2,)]

    def test_each_statement_writes_its_line_in_order(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)

        _sql_core.run(sqlite_params(path, sql=self.SCRIPT), log)

        assert timed(log.at("INFO")) == [
            connected(path),
            "Statement 1: 0 rows changed, N ms",
            "Statement 2: 2 rows changed, N ms",
            "Statement 3: 3 rows, N ms",
            "Statement 4: 2 rows changed, N ms",
            "Statement 5: 2 rows, N ms",
            "Statement 6: 1 rows changed, N ms",
        ]
        assert (log.at("WARN"), log.at("ERROR")) == ([], [])

    def test_creating_a_virtual_table_adds_nothing_to_rows_changed(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        script = (
            "INSERT INTO orders VALUES (4, 1, 'd'), (5, 2, 'e'), (6, 3, 'f');\n"
            "CREATE VIRTUAL TABLE docs USING fts5(body);\n"
            "CREATE VIRTUAL TABLE boxes USING rtree(id, minx, maxx);\n"
            "CREATE VIRTUAL TABLE shapes USING geopoly(label);\n"
            "INSERT INTO docs (body) VALUES ('first'), ('second')"
        )

        out = outputs(_sql_core.run(sqlite_params(path, sql=script), log))

        assert (out["success"], out["rows_changed"]) == (True, 5)
        assert timed(log.at("INFO")) == [
            connected(path),
            "Statement 1: 3 rows changed, N ms",
            "Statement 2: 0 rows changed, N ms",
            "Statement 3: 0 rows changed, N ms",
            "Statement 4: 0 rows changed, N ms",
            "Statement 5: 2 rows changed, N ms",
        ]

    async def test_execute_hands_back_a_typed_table_and_numbers(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(path, sql="SELECT id, qty FROM orders ORDER BY id")

        out = await SQLClientPlugin().execute(sql_context(params, log))

        assert isinstance(out["rows"], Table)
        assert out["rows"].col_names() == ["id", "qty"]
        assert out["rows"].col_types() == ["integer", "integer"]
        assert [row.to_list() for row in out["rows"]] == [[1, 5], [2, 7], [3, 9]]
        assert (out["row_count"], out["rows_changed"]) == (3, 0)
        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert timed(log.at("INFO")) == [connected(path), "Statement 1: 3 rows, N ms"]

    def test_a_result_set_with_no_rows_still_names_its_columns(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        script = (
            "SELECT id FROM orders; SELECT id, qty FROM orders WHERE id = 99; "
            "INSERT INTO orders VALUES (4, 1, 'd')"
        )

        out = outputs(_sql_core.run(sqlite_params(path, sql=script), log))

        assert columns(out["rows"]) == [("id", "string"), ("qty", "string")]
        assert rows(out["rows"]) == []
        assert (out["row_count"], out["rows_changed"]) == (0, 1)
        assert timed(log.at("INFO"))[2] == "Statement 2: 0 rows, N ms"

    def test_a_script_without_a_result_set_leaves_rows_an_empty_table(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)

        out = outputs(
            _sql_core.run(sqlite_params(path, sql="DELETE FROM orders WHERE id > 1"), log)
        )

        assert (columns(out["rows"]), rows(out["rows"])) == ([], [])
        assert (out["row_count"], out["rows_changed"]) == (0, 2)

    def test_the_scripts_own_transaction_is_honored(self, tmp_path: Path, log: LogRecorder) -> None:
        path = orders_db(tmp_path)
        script = "BEGIN; INSERT INTO orders VALUES (4, 1, 'd'); ROLLBACK"

        out = outputs(_sql_core.run(sqlite_params(path, sql=script), log))

        assert out["success"] is True
        assert query(path, "SELECT count(*) FROM orders") == [(3,)]

    def test_a_file_that_does_not_exist_yet_is_created(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = tmp_path / "new.db"
        script = "CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1)"

        out = outputs(_sql_core.run(sqlite_params(path, sql=script), log))

        assert (out["success"], out["rows_changed"]) == (True, 1)
        assert query(path, "SELECT a FROM t") == [(1,)]

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_file_that_cannot_be_opened_is_unreachable(
        self, tmp_path: Path, log: LogRecorder, on_error: str
    ) -> None:
        path = tmp_path / "no-such-folder" / "t.db"
        message = f"Could not open the SQLite file {path}: unable to open database file"
        params = sqlite_params(path, on_error=on_error)

        if on_error == "fail":
            with pytest.raises(ValueError, match=exact(message)):
                _sql_core.run(params, log)
            return
        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Unreachable")
        empty_run_outputs(out)
        assert log.at("INFO") == []

    def test_the_connected_line_names_the_sqlite_the_script_runs_on(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)

        out = outputs(_sql_core.run(sqlite_params(path, sql="SELECT sqlite_version()"), log))

        assert rows(out["rows"]) == [[apsw.sqlitelibversion()]]
        assert log.at("INFO")[0] == connected(path)


class TestMaxRows:
    """Max rows caps what is kept on the fetch side and says so at WARN (SQL-4)."""

    @pytest.mark.parametrize(
        ("cap", "kept", "warned"),
        [
            pytest.param({"max_rows": 2}, [[1], [2]], True, id="over-the-cap"),
            pytest.param({"max_rows": 3}, [[1], [2], [3]], False, id="exactly-the-cap"),
            pytest.param({"max_rows": 0}, [[1], [2], [3]], False, id="no-cap"),
            pytest.param({}, [[1], [2], [3]], False, id="default"),
        ],
    )
    def test_the_rows_so_far_are_kept(
        self,
        tmp_path: Path,
        log: LogRecorder,
        cap: dict[str, Any],
        kept: list[list[int]],
        warned: bool,
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(path, sql="SELECT id FROM orders ORDER BY id", **cap)

        out = outputs(_sql_core.run(params, log))

        assert (rows(out["rows"]), out["row_count"]) == (kept, len(kept))
        assert out["success"] is True
        assert log.at("WARN") == (["Stopped after 2 rows (Max rows)"] if warned else [])
        assert timed(log.at("INFO"))[1] == f"Statement 1: {len(kept)} rows, N ms"

    def test_the_warning_follows_the_statement_that_held_more(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        script = "SELECT id FROM orders ORDER BY id; SELECT id FROM orders WHERE id = 1"

        out = outputs(_sql_core.run(sqlite_params(path, sql=script, max_rows=2), log))

        assert (rows(out["rows"]), out["row_count"]) == ([[1]], 1)
        assert [(level, line) for level, line in timed_log(log) if level != "DEBUG"] == [
            ("INFO", connected(path)),
            ("INFO", "Statement 1: 2 rows, N ms"),
            ("WARN", "Stopped after 2 rows (Max rows)"),
            ("INFO", "Statement 2: 1 rows, N ms"),
        ]


class TestParametersOnSqlite:
    """`:name` values are bound and typed; empty text binds as empty text and null binds NULL
    (SQL-2)."""

    def test_values_are_bound_with_their_types(self, tmp_path: Path, log: LogRecorder) -> None:
        path = orders_db(tmp_path)
        sql = (
            "SELECT typeof(:n) AS kind, :n + 1 AS next, :t AS text, "
            ":e IS NULL AS empty, :z IS NULL AS absent"
        )
        parameters = {"n": 41, "t": "it's", "e": "", "z": None}

        out = outputs(_sql_core.run(sqlite_params(path, sql=sql, parameters=parameters), log))

        assert rows(out["rows"]) == [["integer", 42, "it's", 0, 1]]

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(Decimal("12.50"), id="decimal"),
            pytest.param({"__wave_type": "decimal", "value": "12.50"}, id="decimal-envelope"),
        ],
    )
    def test_a_decimal_binds_as_a_number(
        self, tmp_path: Path, log: LogRecorder, value: Any
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(path, sql="SELECT :p * 2 AS doubled", parameters={"p": value})

        out = outputs(_sql_core.run(params, log))

        assert columns(out["rows"]) == [("doubled", "float")]
        assert rows(out["rows"]) == [[25.0]]

    def test_one_entry_serves_every_use_of_its_name(self, tmp_path: Path, log: LogRecorder) -> None:
        path = orders_db(tmp_path)
        sql = (
            "INSERT INTO orders (id, qty, note) VALUES (:id, :qty, :note);\n"
            "SELECT id, qty, note FROM orders WHERE id = :id"
        )
        parameters = {"id": 4, "qty": 0, "note": ""}

        out = outputs(_sql_core.run(sqlite_params(path, sql=sql, parameters=parameters), log))

        assert rows(out["rows"]) == [[4, 0, ""]]
        assert out["rows_changed"] == 1

    def test_a_name_inside_a_string_or_comment_is_not_a_placeholder(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)

        out = outputs(_sql_core.run(sqlite_params(path, sql="SELECT ':x' AS t -- :y"), log))

        assert rows(out["rows"]) == [[":x"]]

    def test_a_value_of_only_spaces_binds_as_written(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(
            path, sql="SELECT :s AS s, :s IS NULL AS blank", parameters={"s": "  "}
        )

        out = outputs(_sql_core.run(params, log))

        assert rows(out["rows"]) == [["  ", 0]]

    def test_empty_text_is_stored_as_text_and_null_as_null(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        sql = "INSERT INTO orders (id, qty, note) VALUES (4, 1, :empty), (5, 1, :nothing)"
        params = sqlite_params(path, sql=sql, parameters={"empty": "", "nothing": None})

        out = outputs(_sql_core.run(params, log))

        assert out["rows_changed"] == 2
        assert query(path, "SELECT id, note, typeof(note) FROM orders WHERE id > 3") == [
            (4, "", "text"),
            (5, None, "null"),
        ]


EXPRESSION_SQL = "SELECT id FROM orders WHERE qty >= :min_qty ORDER BY id"


def resolved(params: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    """The block's rows as the executor hands them over, with the SQL row in expression mode."""
    parameter_types, trim_fields, reference_fields, _wire = derive_parameter_metadata(
        SQLClientPlugin().metadata["parameters"]
    )
    return resolve_parameters(
        params,
        {"sql"},
        variables,
        parameter_types,
        trim_fields=trim_fields,
        reference_fields=reference_fields,
    )


class TestSqlFromAnExpression:
    """With the expression toggle an expression gives the script text; `:name` placeholders
    still bind from Parameters, and a result that is not text never runs (SQL-10, REQ-3.4.1.6)."""

    async def test_the_expression_text_runs_with_its_placeholders_bound(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(path, sql="order_query", parameters={"min_qty": 7})

        rows_in = resolved(params, {"order_query": EXPRESSION_SQL})
        out = await SQLClientPlugin().execute(sql_context(rows_in, log))

        assert rows_in["sql"] == EXPRESSION_SQL
        assert [row.to_list() for row in out["rows"]] == [[2], [3]]
        assert (out["row_count"], out["success"]) == (2, True)

    async def test_the_placeholders_reach_a_network_database_as_binds(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection([Result(columns=["id"], rows=[(2,), (3,)])])
        use_fake("postgresql", connection)
        params = sql_params(sql="order_query", parameters={"min_qty": 7})

        out = await SQLClientPlugin().execute(
            sql_context(resolved(params, {"order_query": EXPRESSION_SQL}), log)
        )

        assert calls(connection) == [("SELECT id FROM orders WHERE qty >= $1 ORDER BY id", [7])]
        assert out["row_count"] == 2

    def test_a_map_result_fails_the_block_before_it_runs(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection([]))
        params = sql_params(sql="order_query")

        with pytest.raises(
            ExpressionTypeError, match=exact("Parameter 'sql' expects string, got dict")
        ):
            resolved(params, {"order_query": {"text": EXPRESSION_SQL}})

        assert (fake.connects, list(log)) == ([], [])


class TestBlankIntegerRows:
    """A blank integer row takes its default: Connect timeout 30, Max rows 10000 (SQL-4, SQL-8)."""

    @pytest.mark.parametrize("blank", ["", None], ids=["empty", "none"])
    def test_a_blank_connect_timeout_connects_with_thirty_seconds(
        self, use_fake: Any, log: LogRecorder, blank: Any
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())

        _sql_core.run(sql_params(connect_timeout=blank), log)

        assert fake.connects[0][1] == 30

    @pytest.mark.parametrize("blank", ["", None], ids=["empty", "none"])
    def test_a_blank_max_rows_keeps_ten_thousand_rows(
        self, tmp_path: Path, log: LogRecorder, blank: Any
    ) -> None:
        path = orders_db(tmp_path)
        sql = (
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 10001) "
            "SELECT x FROM n"
        )

        out = outputs(_sql_core.run(sqlite_params(path, sql=sql, max_rows=blank), log))

        assert out["row_count"] == 10000
        assert log.at("WARN") == ["Stopped after 10000 rows (Max rows)"]


class TestTlsOnSqlite:
    """SQLite is a file with no network, so every TLS row is ignored there."""

    async def test_a_sqlite_block_runs_whatever_its_tls_rows_hold(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(
            path,
            sql="SELECT count(*) AS n FROM orders",
            tls=True,
            verify_ssl=True,
            ca_cert=str(tmp_path / "missing-ca.pem"),
            client_cert=str(tmp_path / "missing-client.pem"),
            client_key=str(tmp_path / "missing-client.key"),
        )

        out = await SQLClientPlugin().execute(sql_context(params, log))

        assert out["success"] is True
        assert [row.to_list() for row in out["rows"]] == [[3]]


class TestValidationBeforeConnect:
    """An undefined `:name` fails the block before anything connects or runs."""

    def test_nothing_runs_and_nothing_is_logged(self, tmp_path: Path, log: LogRecorder) -> None:
        path = orders_db(tmp_path)
        script = "INSERT INTO orders VALUES (4, 1, 'd'); SELECT :missing"

        with pytest.raises(ValueError, match=exact(UNDEFINED)):
            _sql_core.run(sqlite_params(path, sql=script), log)

        assert query(path, "SELECT count(*) FROM orders") == [(3,)]
        assert log.at("INFO") == []

    def test_under_record_the_reason_is_validation(self, tmp_path: Path, log: LogRecorder) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(path, sql="SELECT 1; SELECT :missing", on_error="record")

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, UNDEFINED, "Validation")
        assert out["__block_warning"] is True
        empty_run_outputs(out)
        assert log.at("WARN") == [f"Run SQL failed (Validation): {UNDEFINED}"]
        assert log.at("INFO") == []

    def test_a_network_database_is_never_dialed(self, use_fake: Any, log: LogRecorder) -> None:
        connection = FakeConnection()
        fake = use_fake("postgresql", connection)

        with pytest.raises(ValueError, match=exact(UNDEFINED)):
            _sql_core.run(sql_params(sql="SELECT 1; SELECT :missing"), log)

        assert (fake.connects, connection.executed) == ([], [])

    @pytest.mark.parametrize(
        ("sql", "parameters", "name"),
        [
            pytest.param("SELECT :a, :b", {"a": 1}, "b", id="second-of-two"),
            pytest.param("SELECT :a FROM t WHERE b = :b", {"b": 1}, "a", id="first-of-two"),
            pytest.param("SELECT :z;\nSELECT :a", {}, "z", id="statement-order"),
            pytest.param("SELECT 1;\nSELECT :y FROM t", {"x": 1}, "y", id="second-statement"),
            pytest.param("SELECT :A", {"a": 1}, "A", id="case-sensitive"),
            pytest.param("SELECT :id::int", {}, "id", id="placeholder-before-a-cast"),
        ],
    )
    def test_the_first_undefined_name_is_named(
        self, use_fake: Any, log: LogRecorder, sql: str, parameters: dict[str, Any], name: str
    ) -> None:
        connection = FakeConnection()
        fake = use_fake("postgresql", connection)
        message = f"Parameter '{name}' is used in the SQL but not defined"

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(sql_params(sql=sql, parameters=parameters), log)

        assert (fake.connects, connection.executed) == ([], [])

    def test_a_later_sql_server_batch_is_checked(self, use_fake: Any, log: LogRecorder) -> None:
        connection = FakeConnection()
        fake = use_fake("mssql", connection)
        message = "Parameter 'x' is used in the SQL but not defined"

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(sql_params(database_type="mssql", sql="SELECT 1\nGO\nSELECT :x"), log)

        assert (fake.connects, connection.executed) == ([], [])

    async def test_a_block_that_passes_validate_records_the_failure_under_record(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection()
        fake = use_fake("postgresql", connection)
        params = sql_params(sql="SELECT 1; SELECT :missing", on_error="record")
        plugin = SQLClientPlugin()

        await plugin.validate(params)
        out = await plugin.execute(sql_context(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, UNDEFINED, "Validation")
        assert log.at("WARN") == [f"Run SQL failed (Validation): {UNDEFINED}"]
        assert (fake.connects, connection.executed) == ([], [])

    async def test_a_block_that_passes_validate_fails_under_fail(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection()
        fake = use_fake("postgresql", connection)
        params = sql_params(sql="SELECT 1; SELECT :missing", on_error="fail")
        plugin = SQLClientPlugin()

        await plugin.validate(params)
        with pytest.raises(ValueError, match=exact(UNDEFINED)):
            await plugin.execute(sql_context(params, log))

        assert (fake.connects, connection.executed) == ([], [])


class TestSqliteMarkerWithNoValue:
    """A SQLite marker WAVE bound no value for fails its statement with a sentence."""

    @pytest.mark.parametrize(
        ("sql", "message"),
        [
            pytest.param(
                "SELECT @x AS x, :y AS y",
                "Placeholder x has no value: write :x and add x to Parameters",
                id="at-sign",
            ),
            pytest.param(
                "SELECT $x AS x, :y AS y",
                "Placeholder x has no value: write :x and add x to Parameters",
                id="dollar",
            ),
            pytest.param(
                "SELECT ?1 AS x, :y AS y",
                "Numbered placeholder 1 has no value: write :name and add name to Parameters",
                id="numbered",
            ),
            pytest.param(
                "SELECT ? AS x, :y AS y",
                "A ? placeholder has no value: write :name and add name to Parameters",
                id="unnamed",
            ),
        ],
    )
    def test_the_statement_fails_with_the_sentence_and_reason_validation(
        self, tmp_path: Path, log: LogRecorder, sql: str, message: str
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(path, sql=sql, parameters={"y": 1})

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        empty_run_outputs(out)
        assert log.at("ERROR") == [f"Statement 1 ({sql}) failed: {message}"] * 2
        assert log.at("WARN") == [f"Run SQL failed (Validation): {message}"]

    def test_with_stop_on_error_off_the_script_goes_on(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        script = "SELECT @x AS x, :y AS y;\nSELECT :y AS y"
        params = sqlite_params(path, sql=script, parameters={"y": 7}, stop_on_error=False)

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], rows(out["rows"])) == (True, [[7]])
        assert log.at("WARN") == [
            "Statement 1 (SELECT @x AS x, :y AS y) failed: "
            "Placeholder x has no value: write :x and add x to Parameters"
        ]

    def test_a_marker_whose_name_is_in_parameters_is_not_called_undefined(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        message = "Placeholder x has no value: write :x and add x to Parameters"
        params = sqlite_params(
            path, sql="SELECT @x AS x, :y AS y", parameters={"x": 5, "y": 1}, on_error="record"
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")


class TestStopOnError:
    """Stop on error ends the script at the first failure; off, every statement runs (SQL-3)."""

    SCRIPT = (
        "INSERT INTO orders VALUES (4, 1, 'd');\n"
        "SELECT * FROM nope;\n"
        "INSERT INTO orders VALUES (5, 1, 'e')"
    )
    FAILED_LINE = f"Statement 2 (SELECT * FROM nope) failed: {NO_TABLE}"

    def test_on_the_first_failure_fails_the_block_and_nothing_later_runs(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)

        with pytest.raises(ValueError, match=exact(NO_TABLE)):
            _sql_core.run(sqlite_params(path, sql=self.SCRIPT), log)

        assert query(path, "SELECT id FROM orders WHERE id > 3") == [(4,)]
        assert log.at("ERROR") == [self.FAILED_LINE]
        assert timed(log.at("INFO")) == [connected(path), "Statement 1: 1 rows changed, N ms"]
        assert log.at("WARN") == []

    def test_under_record_the_empties_carry_the_database_error(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(path, sql=self.SCRIPT, on_error="record")

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, NO_TABLE, "DatabaseError")
        assert out["__block_warning"] is True
        empty_run_outputs(out)
        assert log.at("ERROR") == [self.FAILED_LINE]
        assert log.at("WARN") == [f"Run SQL failed (DatabaseError): {NO_TABLE}"]
        assert query(path, "SELECT id FROM orders WHERE id > 3") == [(4,)]

    def test_off_every_statement_runs_and_the_block_passes(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        script = (
            "SELECT * FROM nope;\n"
            "INSERT INTO orders VALUES (4, 1, 'd');\n"
            "SELECT * FROM gone;\n"
            "SELECT count(*) AS n FROM orders"
        )

        out = outputs(_sql_core.run(sqlite_params(path, sql=script, stop_on_error=False), log))

        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert "__block_warning" not in out
        assert (rows(out["rows"]), out["row_count"], out["rows_changed"]) == ([[4]], 1, 1)
        assert log.at("WARN") == [
            f"Statement 1 (SELECT * FROM nope) failed: {NO_TABLE}",
            "Statement 3 (SELECT * FROM gone) failed: no such table: gone",
        ]
        assert timed(log.at("INFO")) == [
            connected(path),
            "Statement 2: 1 rows changed, N ms",
            "Statement 4: 1 rows, N ms",
        ]
        assert log.at("ERROR") == []

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_off_with_every_statement_failing_ends_amber(
        self, tmp_path: Path, log: LogRecorder, on_error: str
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(
            path,
            sql="SELECT * FROM nope; SELECT * FROM gone",
            stop_on_error=False,
            on_error=on_error,
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert out["__block_warning"] is True
        empty_run_outputs(out)
        assert len(log.at("WARN")) == 2

    @pytest.mark.parametrize(
        ("script", "shown", "number"),
        [
            pytest.param("SELECT *\n  FROM nope", "SELECT *", 1, id="multi-line"),
            pytest.param(
                "-- load step\n/* checked */\n  SELECT *\n  FROM nope",
                "SELECT *",
                1,
                id="leading-comments",
            ),
            pytest.param(
                "SELECT * FROM nope -- " + "x" * 58,
                "SELECT * FROM nope -- " + "x" * 58,
                1,
                id="eighty-characters",
            ),
            pytest.param(
                "SELECT * FROM nope -- " + "x" * 59,
                "SELECT * FROM nope -- " + "x" * 58 + "...",
                1,
                id="cut-at-eighty",
            ),
            pytest.param(
                "SELECT 1;;\n-- note\n;SELECT * FROM nope",
                "SELECT * FROM nope",
                2,
                id="comment-pieces-not-numbered",
            ),
        ],
    )
    def test_the_failing_statement_is_named_by_number_and_first_line(
        self, tmp_path: Path, log: LogRecorder, script: str, shown: str, number: int
    ) -> None:
        path = orders_db(tmp_path)

        _sql_core.run(sqlite_params(path, sql=script, stop_on_error=False), log)

        assert log.at("WARN") == [f"Statement {number} ({shown}) failed: {NO_TABLE}"]


NETWORK_TYPES = [
    pytest.param("postgresql", "PostgreSQL", 5432, id="postgresql"),
    pytest.param("mysql", "MySQL", 3306, id="mysql"),
    pytest.param("oracle", "Oracle", 1521, id="oracle"),
    pytest.param("mssql", "SQL Server", 1433, id="mssql"),
]


class TestConnectOnNetworkTypes:
    """The Connected line and the connect failures of the four network types (SQL-5, SQL-8)."""

    @pytest.mark.parametrize(
        "blank",
        [
            pytest.param({}, id="absent"),
            pytest.param({"port": None}, id="none"),
            pytest.param({"port": ""}, id="empty"),
        ],
    )
    @pytest.mark.parametrize(("database_type", "name", "port"), NETWORK_TYPES)
    def test_a_blank_port_is_the_type_default(
        self,
        use_fake: Any,
        log: LogRecorder,
        database_type: str,
        name: str,
        port: int,
        blank: dict[str, Any],
    ) -> None:
        fake = use_fake(database_type, FakeConnection(version="8.0.36"))

        _sql_core.run(sql_params(database_type=database_type, **blank), log)

        assert log.at("INFO")[0] == f"Connected to {name} 8.0.36 at db:{port}"
        dialed, connect_timeout = fake.connects[0]
        assert (dialed["host"], dialed["port"], connect_timeout) == ("db", port, 30)

    def test_a_given_port_and_connect_timeout_are_used(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())

        _sql_core.run(sql_params(port=6543, connect_timeout=5), log)

        assert log.at("INFO")[0] == "Connected to PostgreSQL 16.4 at db:6543"
        assert (fake.connects[0][0]["port"], fake.connects[0][1]) == (6543, 5)

    def test_an_oracle_dsn_is_named_instead_of_host_and_port(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        use_fake("oracle", FakeConnection(version="23.4.0.24.5"))
        params = sql_params(
            database_type="oracle",
            host="",
            database="",
            driver_options={"dsn": "db.internal:1521/APP"},
            sql="SELECT 1 FROM dual",
        )

        _sql_core.run(params, log)

        assert log.at("INFO")[0] == "Connected to Oracle 23.4.0.24.5 at db.internal:1521/APP"

    @pytest.mark.parametrize(
        ("error", "message", "reason"),
        [
            pytest.param(
                OSError("[Errno 111] Connection refused"),
                "Could not connect to PostgreSQL at db:5432: [Errno 111] Connection refused",
                "Unreachable",
                id="unreachable",
            ),
            pytest.param(
                pg_error("28P01", 'password authentication failed for user "wave"'),
                "Authentication failed for wave at db: "
                'password authentication failed for user "wave"',
                "AuthFailed",
                id="auth-failed",
            ),
        ],
    )
    def test_a_connect_failure_carries_its_reason(
        self,
        use_fake: Any,
        log: LogRecorder,
        error: Exception,
        message: str,
        reason: str,
    ) -> None:
        connection = FakeConnection()
        use_fake("postgresql", connection, connect_error=error)

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(sql_params(), log)
        out = outputs(_sql_core.run(sql_params(on_error="record"), log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, reason)
        empty_run_outputs(out)
        assert (log.at("INFO"), connection.executed) == ([], [])

    @pytest.mark.parametrize(
        ("error", "message"),
        [
            pytest.param(
                pg_error("42P01", 'relation "nope" does not exist'), PG_MISSING, id="server"
            ),
            pytest.param(
                OSError("server closed the connection unexpectedly"),
                "server closed the connection unexpectedly",
                id="driver",
            ),
        ],
    )
    def test_a_failing_statement_is_a_database_error(
        self, use_fake: Any, log: LogRecorder, error: Exception, message: str
    ) -> None:
        use_fake("postgresql", FakeConnection([Result(), Result(error=error)]))
        params = sql_params(sql="SELECT 1; SELECT * FROM nope", on_error="record")

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "DatabaseError")
        empty_run_outputs(out)


class TestSpacesOnlyOracleDsn:
    """An Oracle dsn of only spaces is no dsn: Host and Database are needed and name the place."""

    @pytest.mark.parametrize(
        ("row", "message"),
        [("host", "Set a Host or a File"), ("database", "Missing required parameter: database")],
    )
    async def test_host_and_database_are_still_required(self, row: str, message: str) -> None:
        params = sql_params(database_type="oracle", driver_options={"dsn": "   "}, **{row: ""})

        with pytest.raises(ValueError, match=exact(message)):
            await SQLClientPlugin().validate(params)

    def test_the_connected_line_names_host_and_port(self, use_fake: Any, log: LogRecorder) -> None:
        fake = use_fake("oracle", FakeConnection(version="23.4.0.24.5"))
        params = sql_params(
            database_type="oracle", driver_options={"dsn": "   "}, sql="SELECT 1 FROM dual"
        )

        _sql_core.run(params, log)

        assert log.at("INFO")[0] == "Connected to Oracle 23.4.0.24.5 at db:1521"
        assert (fake.connects[0][0]["host"], fake.connects[0][0]["port"]) == ("db", 1521)

    def test_a_connect_failure_names_host_and_port(self, use_fake: Any, log: LogRecorder) -> None:
        message = "Could not connect to Oracle at db:1521: [Errno 111] Connection refused"
        refused = OSError("[Errno 111] Connection refused")
        use_fake("oracle", FakeConnection(), connect_error=refused)
        params = sql_params(
            database_type="oracle", driver_options={"dsn": "   "}, on_error="record"
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Unreachable")


class TestWhatEachTypeSends:
    """The core sends each type's own statements, bind forms and connection rows (REQ-5.1.4)."""

    @pytest.mark.parametrize(
        ("database_type", "script", "sent"),
        [
            pytest.param(
                "postgresql", "SELECT 1; SELECT 2", ["SELECT 1", "SELECT 2"], id="postgresql"
            ),
            pytest.param(
                "mysql",
                "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END//\n"
                "DELIMITER ;\nCALL p();",
                ["CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END", "CALL p()"],
                id="mysql-delimiter",
            ),
            pytest.param(
                "oracle",
                "SELECT 1 FROM dual;\nBEGIN\n  NULL;\nEND;\n/\nSELECT 2 FROM dual",
                ["SELECT 1 FROM dual", "BEGIN\n  NULL;\nEND;", "SELECT 2 FROM dual"],
                id="oracle-block",
            ),
            pytest.param(
                "mssql",
                "SELECT 1; SELECT 2\nGO\nSELECT 3",
                ["SELECT 1; SELECT 2", "SELECT 3"],
                id="mssql-go",
            ),
            pytest.param(
                "sqlite",
                "CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES (1); "
                "UPDATE c SET x = 1; END; SELECT 1",
                [
                    "CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES (1); "
                    "UPDATE c SET x = 1; END",
                    "SELECT 1",
                ],
                id="sqlite-trigger",
            ),
        ],
    )
    def test_a_script_is_sent_in_the_pieces_its_own_tool_would_send(
        self, use_fake: Any, log: LogRecorder, database_type: str, script: str, sent: list[str]
    ) -> None:
        connection = FakeConnection()
        use_fake(database_type, connection)
        params = {**sql_params(database_type=database_type, sql=script), "file": "unused.db"}

        _sql_core.run(params, log)

        assert connection.statements() == sent
        assert timed(log.at("INFO"))[1:] == [
            f"Statement {number}: 0 rows changed, N ms" for number in range(1, len(sent) + 1)
        ]

    @pytest.mark.parametrize(
        ("database_type", "sql", "sent"),
        [
            pytest.param(
                "postgresql", "SELECT :a, :b, :a", ("SELECT $1, $2, $1", [1, "x"]), id="postgresql"
            ),
            pytest.param(
                "mysql", "SELECT :a, :b, :a", ("SELECT %s, %s, %s", [1, "x", 1]), id="mysql"
            ),
            pytest.param(
                "mssql", "SELECT :a, :b, :a", ("SELECT %s, %s, %s", [1, "x", 1]), id="mssql"
            ),
            pytest.param(
                "oracle",
                "SELECT :a, :b, :a FROM dual",
                ("SELECT :a, :b, :a FROM dual", {"a": 1, "b": "x"}),
                id="oracle",
            ),
            pytest.param(
                "sqlite",
                "SELECT :a, :b, :a",
                ("SELECT :a, :b, :a", {"a": 1, "b": "x"}),
                id="sqlite",
            ),
            pytest.param(
                "mysql", "SELECT '50%', :a", ("SELECT '50%%', %s", [1]), id="mysql-percent"
            ),
            pytest.param("mssql", "SELECT '50%'", ("SELECT '50%'", None), id="mssql-no-binds"),
        ],
    )
    def test_placeholders_reach_the_driver_in_its_own_form(
        self, use_fake: Any, log: LogRecorder, database_type: str, sql: str, sent: tuple[str, Any]
    ) -> None:
        connection = FakeConnection()
        use_fake(database_type, connection)
        parameters = {"a": 1, "b": "x", "unused": 3}
        params = {
            **sql_params(database_type=database_type, sql=sql, parameters=parameters),
            "file": "unused.db",
        }

        _sql_core.run(params, log)

        assert calls(connection) == [sent]

    @pytest.mark.parametrize("database_type", ["postgresql", "mysql", "oracle", "mssql", "sqlite"])
    def test_every_statement_runs_through_the_dialect(
        self, use_fake: Any, log: LogRecorder, database_type: str
    ) -> None:
        connection = FakeConnection()
        fake = use_fake(database_type, connection)
        script = "SELECT 1;\nGO\nSELECT :a" if database_type == "mssql" else "SELECT 1; SELECT :a"
        params = {
            **sql_params(database_type=database_type, sql=script, parameters={"a": 1}),
            "file": "unused.db",
        }

        _sql_core.run(params, log)

        sent = [(statement, binds) for _, statement, binds in connection.executed]
        assert len(sent) == 2
        assert fake.executes == sent

    @pytest.mark.parametrize(
        ("database_type", "given", "tls"),
        [
            pytest.param("postgresql", {}, False, id="postgresql-default"),
            pytest.param("mysql", {}, False, id="mysql-default"),
            pytest.param("oracle", {}, False, id="oracle-default"),
            pytest.param("mssql", {}, True, id="mssql-default"),
            pytest.param("mssql", {"tls": None}, True, id="mssql-none"),
            pytest.param("mssql", {"tls": False}, False, id="mssql-off"),
            pytest.param("postgresql", {"tls": True}, True, id="postgresql-on"),
        ],
    )
    def test_the_connection_rows_reach_the_dialect(
        self,
        use_fake: Any,
        log: LogRecorder,
        database_type: str,
        given: dict[str, Any],
        tls: bool,
    ) -> None:
        fake = use_fake(database_type, FakeConnection())
        params = sql_params(
            database_type=database_type, port=7000, driver_options={"sslmode": "x"}, **given
        )

        _sql_core.run(params, log)

        dialed = fake.connects[0][0]
        shown = ("host", "port", "database", "username", "password", "tls", "verify_ssl")
        assert {name: dialed[name] for name in shown} == {
            "host": "db",
            "port": 7000,
            "database": "wave",
            "username": "wave",
            "password": PASSWORD,
            "tls": tls,
            "verify_ssl": True,
        }
        assert (dialed["driver_options"], dialed["server_name"]) == ({"sslmode": "x"}, "db")


class TestBindsOnPostgres:
    """PostgreSQL gets numbered binds on an autocommit connection (SQL-2, SQL-3)."""

    def test_placeholders_reach_the_driver_as_numbered_binds(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = FakeConnection()
        use_fake("postgresql", connection)
        params = sql_params(
            sql="SELECT 1;\nSELECT * FROM t WHERE a = :a AND b = :b OR c = :a",
            parameters={"a": 1, "b": "x"},
        )

        _sql_core.run(params, log)

        assert calls(connection) == [
            ("SELECT 1", None),
            ("SELECT * FROM t WHERE a = $1 AND b = $2 OR c = $1", [1, "x"]),
        ]
        assert connection.autocommit_calls[-1] is True

    def test_a_decimal_envelope_binds_a_decimal(self, use_fake: Any, log: LogRecorder) -> None:
        connection = FakeConnection()
        use_fake("postgresql", connection)
        params = sql_params(
            sql="SELECT :p",
            parameters={"p": {"__wave_type": "decimal", "value": "12345678901234567890.50"}},
        )

        _sql_core.run(params, log)

        assert calls(connection) == [("SELECT $1", [Decimal("12345678901234567890.50")])]


class TestEmptyTextAndNullBinds:
    """Empty text binds as empty text and null binds NULL: in Parameters on every type and in
    Call procedure Arguments, a data field like Parameters (SQL-2, SQL-6, REQ-3.1.3.22)."""

    @pytest.mark.parametrize(
        ("database_type", "sql", "sent"),
        [
            pytest.param("postgresql", "SELECT :e, :z", ("SELECT $1, $2", ["", None]), id="pg"),
            pytest.param("mysql", "SELECT :e, :z", ("SELECT %s, %s", ["", None]), id="mysql"),
            pytest.param("mssql", "SELECT :e, :z", ("SELECT %s, %s", ["", None]), id="mssql"),
            pytest.param(
                "oracle",
                "SELECT :e, :z FROM dual",
                ("SELECT :e, :z FROM dual", {"e": "", "z": None}),
                id="oracle",
            ),
            pytest.param(
                "sqlite", "SELECT :e, :z", ("SELECT :e, :z", {"e": "", "z": None}), id="sqlite"
            ),
        ],
    )
    def test_a_parameter_reaches_the_driver_as_empty_text_or_null(
        self, use_fake: Any, log: LogRecorder, database_type: str, sql: str, sent: tuple[str, Any]
    ) -> None:
        connection = FakeConnection()
        use_fake(database_type, connection)
        params = {
            **sql_params(database_type=database_type, sql=sql, parameters={"e": "", "z": None}),
            "file": "unused.db",
        }

        _sql_core.run(params, log)

        assert calls(connection) == [sent]

    @pytest.mark.parametrize(
        ("database_type", "sent"),
        [
            pytest.param("postgresql", ("CALL app.p(e => $1, z => $2)", ["", None]), id="pg"),
            pytest.param("mysql", ("CALL app.p(%s, %s)", ["", None]), id="mysql"),
            pytest.param("mssql", ("EXEC app.p @e = %s, @z = %s;", ["", None]), id="mssql"),
            pytest.param(
                "oracle", ("BEGIN app.p(e => :1, z => :2); END;", ["", None]), id="oracle"
            ),
        ],
    )
    def test_a_procedure_argument_reaches_the_driver_as_empty_text_or_null(
        self, use_fake: Any, log: LogRecorder, database_type: str, sent: tuple[str, Any]
    ) -> None:
        connection = FakeConnection()
        use_fake(database_type, connection)
        params = sql_params(
            database_type=database_type,
            operation="call_procedure",
            procedure="app.p",
            arguments={"e": "", "z": None},
        )

        out = outputs(_sql_core.run(params, log))

        assert calls(connection)[-1] == sent
        assert out["success"] is True


class TestSessionState:
    """A script ending on USE, SET or ALTER SESSION is flagged; its effect ends with the block."""

    @pytest.mark.parametrize(
        ("database_type", "script", "line"),
        [
            pytest.param(
                "postgresql", "SELECT 1; SET search_path TO app", "Statement 2 (SET)", id="set"
            ),
            pytest.param(
                "postgresql",
                "SELECT 1;\n-- switch\n  set role admin;\n-- done",
                "Statement 2 (set)",
                id="as-written",
            ),
            pytest.param("mysql", "SELECT 1; USE app", "Statement 2 (USE)", id="use"),
            pytest.param(
                "oracle",
                "SELECT 1 FROM dual;\nALTER SESSION SET CURRENT_SCHEMA = app",
                "Statement 2 (ALTER SESSION)",
                id="alter-session",
            ),
            pytest.param(
                "mssql",
                "SELECT 1\nGO\nSELECT 2; USE app",
                "Statement 2 (USE)",
                id="last-go-batch",
            ),
            pytest.param("mssql", "SET NOCOUNT ON", "Statement 1 (SET)", id="tsql-set"),
        ],
    )
    def test_the_last_statement_is_flagged(
        self, use_fake: Any, log: LogRecorder, database_type: str, script: str, line: str
    ) -> None:
        use_fake(database_type, FakeConnection())

        out = outputs(_sql_core.run(sql_params(database_type=database_type, sql=script), log))

        assert out["success"] is True
        assert log.at("WARN") == [f"{line} {SESSION_TAIL}"]

    @pytest.mark.parametrize(
        ("database_type", "script"),
        [
            pytest.param("postgresql", "SET search_path TO app; SELECT 1", id="not-last"),
            pytest.param("postgresql", "SELECT 1; RESET ALL", id="reset"),
            pytest.param("mysql", "SELECT 1; UPDATE t SET a = 1", id="update-set"),
            pytest.param("mssql", "USE app; SELECT 2", id="not-last-in-batch"),
            pytest.param("mssql", "SELECT 1\nGO\nUSE app\nGO\nSELECT 2", id="not-last-batch"),
        ],
    )
    def test_anything_else_is_not(
        self, use_fake: Any, log: LogRecorder, database_type: str, script: str
    ) -> None:
        use_fake(database_type, FakeConnection())

        _sql_core.run(sql_params(database_type=database_type, sql=script), log)

        assert log.at("WARN") == []

    def test_a_last_statement_that_failed_is_not_flagged(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        refused = pg_error("42704", 'unrecognized configuration parameter "nope"')
        use_fake("postgresql", FakeConnection([Result(), Result(error=refused)]))
        params = sql_params(sql="SELECT 1; SET nope TO 1", stop_on_error=False)

        _sql_core.run(params, log)

        warnings = log.at("WARN")
        assert len(warnings) == 1
        assert warnings[0].startswith("Statement 2 (SET nope TO 1) failed: ")
        assert not warnings[0].endswith(SESSION_TAIL)


class TestResultSets:
    """Extra result sets are drained; the last one with columns is Rows (SQL-9)."""

    def test_the_last_result_set_wins_and_extra_rowcounts_add_up(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        answer = Result(
            columns=["a"],
            rows=[(1,)],
            more=[Result(rowcount=3), Result(columns=["b"], rows=[("x",), ("y",)])],
        )
        use_fake("postgresql", FakeConnection([answer]))

        out = outputs(_sql_core.run(sql_params(sql="CALL report()"), log))

        assert (columns(out["rows"]), rows(out["rows"])) == ([("b", "string")], [["x"], ["y"]])
        assert (out["row_count"], out["rows_changed"]) == (2, 3)

    def test_a_later_statement_without_columns_keeps_the_earlier_rows(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        script = [Result(columns=["a"], rows=[(1,), (2,)]), Result(rowcount=4), Result(rowcount=-1)]
        use_fake("postgresql", FakeConnection(script))

        out = outputs(_sql_core.run(sql_params(sql="SELECT 1; UPDATE t SET a = 1; COMMIT"), log))

        assert (rows(out["rows"]), out["row_count"], out["rows_changed"]) == ([[1], [2]], 2, 4)


CELL_COLUMNS = [
    "amount",
    "ratio",
    "qty",
    "active",
    "name",
    "at",
    "day",
    "clock",
    "blob",
    "doc",
    "tags",
    "nothing",
    "mixed",
    "ident",
]
IDENT = uuid.UUID("12345678-1234-5678-1234-567812345678")
CELL_ROWS = [
    (
        Decimal("12.50"),
        1.5,
        1,
        True,
        "a",
        datetime(2026, 9, 23, 10, 30),
        date(2026, 9, 23),
        time(10, 30),
        b"\x01\xab",
        {"a": 1},
        [1, "x"],
        None,
        1,
        IDENT,
    ),
    (
        Decimal("1E+2"),
        2,
        None,
        False,
        "b",
        None,
        None,
        None,
        bytearray(b"\xff"),
        {"when": date(2026, 1, 1)},
        [],
        None,
        "a",
        None,
    ),
]


class TestCells:
    """Column types come from the values; each cell renders by its type (SQL-9)."""

    def test_types_and_cells_follow_the_values(self, use_fake: Any, log: LogRecorder) -> None:
        use_fake("postgresql", FakeConnection([Result(columns=CELL_COLUMNS, rows=CELL_ROWS)]))

        out = outputs(_sql_core.run(sql_params(sql="SELECT * FROM cells"), log))

        assert columns(out["rows"]) == [
            ("amount", "float"),
            ("ratio", "float"),
            ("qty", "integer"),
            ("active", "boolean"),
            ("name", "string"),
            ("at", "string"),
            ("day", "string"),
            ("clock", "string"),
            ("blob", "string"),
            ("doc", "string"),
            ("tags", "string"),
            ("nothing", "string"),
            ("mixed", "string"),
            ("ident", "string"),
        ]
        assert rows(out["rows"]) == [
            [
                "12.50",
                1.5,
                1,
                True,
                "a",
                "2026-09-23T10:30:00",
                "2026-09-23",
                "10:30:00",
                "01ab",
                '{"a": 1}',
                '[1, "x"]',
                None,
                "1",
                str(IDENT),
            ],
            [
                "100",
                2,
                None,
                False,
                "b",
                None,
                None,
                None,
                "ff",
                '{"when": "2026-01-01"}',
                "[]",
                None,
                "a",
                None,
            ],
        ]

    def test_a_memoryview_renders_as_hex(self, use_fake: Any, log: LogRecorder) -> None:
        answer = Result(columns=["raw"], rows=[(memoryview(b"\x00\x10"),)])
        use_fake("postgresql", FakeConnection([answer]))

        out = outputs(_sql_core.run(sql_params(sql="SELECT raw FROM t"), log))

        assert (columns(out["rows"]), rows(out["rows"])) == ([("raw", "string")], [["0010"]])

    async def test_float_cells_materialize_as_exact_decimals(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        answer = Result(columns=["amount"], rows=[(Decimal("12.50"),), (Decimal("1E+2"),)])
        use_fake("postgresql", FakeConnection([answer]))

        out = await SQLClientPlugin().execute(sql_context(sql_params(sql="SELECT 1"), log))

        assert out["rows"].col_types() == ["float"]
        assert out["rows"].col("amount") == [Decimal("12.50"), Decimal("100")]


class TestWhatTheConsoleNeverShows:
    """Parameter values stay at DEBUG; the password and client key appear in no line."""

    PARAMETER_VALUE = "p4ram-value-77"
    KEY_MATERIAL = "-----BEGIN PRIVATE KEY-----\nS3CR3TKEYMATERIAL\n-----END PRIVATE KEY-----"

    @pytest.mark.parametrize("stop_on_error", [True, False])
    def test_parameter_values_stay_out_of_info_warn_and_error(
        self, use_fake: Any, log: LogRecorder, stop_on_error: bool
    ) -> None:
        refused = pg_error("22001", "value too long for type character varying(3)")
        use_fake("postgresql", FakeConnection([Result(), Result(error=refused)]))
        params = sql_params(
            sql="SELECT :token; INSERT INTO t VALUES (:token); SELECT 2",
            parameters={"token": self.PARAMETER_VALUE},
            on_error="record",
            stop_on_error=stop_on_error,
        )

        _sql_core.run(params, log)

        shown = [line for level, line in log if level != "DEBUG"]
        assert shown
        assert not [line for line in shown if self.PARAMETER_VALUE in line]

    @pytest.mark.parametrize(
        "fault",
        [
            pytest.param({}, id="success"),
            pytest.param(
                {"connect_error": OSError("[Errno 111] Connection refused")}, id="refused"
            ),
        ],
    )
    def test_the_password_and_client_key_appear_in_no_line(
        self, use_fake: Any, log: LogRecorder, fault: dict[str, Any]
    ) -> None:
        use_fake("postgresql", FakeConnection(), **fault)
        params = sql_params(tls=True, client_key=self.KEY_MATERIAL, on_error="record")

        _sql_core.run(params, log)

        lines = every_line(log)
        assert lines
        assert not [line for line in lines if PASSWORD in line or "S3CR3TKEYMATERIAL" in line]


class TestTheConnectionIsClosed:
    """The connection is closed however the run ends."""

    @pytest.mark.parametrize(
        ("script", "overrides", "raises"),
        [
            pytest.param([Result()], {}, False, id="success"),
            pytest.param([Result(error=OSError("reset"))], {}, True, id="fail"),
            pytest.param(
                [Result(error=OSError("reset"))], {"on_error": "record"}, False, id="record"
            ),
            pytest.param(
                [Result(error=OSError("reset"))], {"stop_on_error": False}, False, id="stop-off"
            ),
        ],
    )
    def test_after_every_outcome(
        self,
        use_fake: Any,
        log: LogRecorder,
        script: list[Result],
        overrides: dict[str, Any],
        raises: bool,
    ) -> None:
        connection = FakeConnection(script)
        use_fake("postgresql", connection)

        if raises:
            with pytest.raises(ValueError, match=exact("reset")):
                _sql_core.run(sql_params(**overrides), log)
        else:
            _sql_core.run(sql_params(**overrides), log)

        assert connection.closed is True


class TestSqliteFileReferences:
    """A Test Data SQLite file opens read-only; other files open as they are (REQ-3.4.1.6)."""

    async def test_a_test_data_file_is_read(self, tmp_path: Path, log: LogRecorder) -> None:
        folder = tmp_path / "testdata"
        folder.mkdir()
        sqlite_file(folder / "ref.db", *ORDERS)
        params = sqlite_params(
            Path("unused"), file="testdata://ref.db", sql="SELECT count(*) AS n FROM orders"
        )

        out = await SQLClientPlugin().execute(sql_context(params, log, testdata_dirs=[str(folder)]))

        assert [row.to_list() for row in out["rows"]] == [[3]]

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    async def test_a_test_data_file_refuses_writes(
        self, tmp_path: Path, log: LogRecorder, on_error: str
    ) -> None:
        folder = tmp_path / "testdata"
        folder.mkdir()
        path = sqlite_file(folder / "ref.db", *ORDERS)
        message = "attempt to write a readonly database"
        params = sqlite_params(
            path,
            file="testdata://ref.db",
            sql="INSERT INTO orders VALUES (9, 1, 'z')",
            on_error=on_error,
        )
        context = sql_context(params, log, testdata_dirs=[str(folder)])

        if on_error == "fail":
            with pytest.raises(ValueError, match=exact(message)):
                await SQLClientPlugin().execute(context)
        else:
            out = await SQLClientPlugin().execute(context)
            assert (out["success"], out["error"], out["reason"]) == (
                False,
                message,
                "DatabaseError",
            )

        assert query(path, "SELECT count(*) FROM orders") == [(3,)]

    @pytest.mark.parametrize("reference", ["testdata", "plain"])
    async def test_the_core_gets_the_resolved_file_and_its_read_only_flag(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder, reference: str
    ) -> None:
        folder = tmp_path / "testdata"
        folder.mkdir()
        path = sqlite_file(folder / "ref.db", *ORDERS)
        fake = use_fake("sqlite", FakeConnection())
        file = "testdata://ref.db" if reference == "testdata" else str(path)

        await SQLClientPlugin().execute(
            sql_context(sqlite_params(path, file=file), log, testdata_dirs=[str(folder)])
        )

        dialed = fake.connects[0][0]
        assert os.fspath(dialed["file"]) == str(path.resolve())
        assert dialed["file_read_only"] is (reference == "testdata")

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    @pytest.mark.parametrize("name", ["missing.db", "nested/missing.db"])
    async def test_a_test_data_file_that_is_not_there_is_unreachable(
        self,
        tmp_path: Path,
        log: LogRecorder,
        caplog: pytest.LogCaptureFixture,
        on_error: str,
        name: str,
    ) -> None:
        folder = tmp_path / "testdata"
        folder.mkdir()
        sqlite_file(folder / "other.db", *ORDERS)
        message = f"Could not open the SQLite file testdata://{name}: unable to open database file"
        params = sqlite_params(Path("unused"), file=f"  testdata://{name} ", on_error=on_error)
        context = sql_context(params, log, testdata_dirs=[str(folder)])

        with caplog.at_level(logging.DEBUG):
            if on_error == "fail":
                with pytest.raises(ValueError, match=exact(message)):
                    await SQLClientPlugin().execute(context)
                assert every_line(log) == []
            else:
                out = await SQLClientPlugin().execute(context)
                assert (out["success"], out["error"], out["reason"]) == (
                    False,
                    message,
                    "Unreachable",
                )
                assert [row.to_list() for row in out["rows"]] == []
                assert (out["row_count"], out["rows_changed"]) == (0, 0)
                assert log == [("WARN", f"Run SQL failed (Unreachable): {message}")]

        assert sorted(entry.name for entry in folder.iterdir()) == ["other.db"]
        logged = [record.getMessage() for record in caplog.records]
        assert not any("Searched paths" in line or str(tmp_path) in line for line in logged)

    async def test_a_test_data_file_that_is_not_there_is_opened_read_only_where_it_would_be(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        folder = tmp_path / "testdata"
        folder.mkdir()
        fake = use_fake("sqlite", FakeConnection())
        params = sqlite_params(Path("unused"), file="testdata://missing.db")

        await SQLClientPlugin().execute(sql_context(params, log, testdata_dirs=[str(folder)]))

        dialed = fake.connects[0][0]
        assert os.fspath(dialed["file"]) == str(folder / "missing.db")
        assert dialed["file_read_only"] is True

    async def test_the_open_failure_comes_after_the_checks_made_before_connecting(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        folder = tmp_path / "testdata"
        folder.mkdir()
        params = sqlite_params(Path("unused"), file="testdata://missing.db", sql="SELECT :missing")

        with pytest.raises(ValueError, match=exact(UNDEFINED)):
            await SQLClientPlugin().execute(sql_context(params, log, testdata_dirs=[str(folder)]))


class TestScriptFile:
    """Script Type File reads the `.sql` on WAVE, or where the block runs (REQ-3.4.1.6)."""

    SCRIPT = "SELECT 'café' AS s;\n"

    @pytest.mark.parametrize("reference", ["testdata", "artifact", "plain"])
    async def test_the_file_replaces_the_source_row(
        self, tmp_path: Path, log: LogRecorder, reference: str
    ) -> None:
        folders = {"testdata": tmp_path / "testdata", "artifact": tmp_path / "artifacts"}
        for folder in folders.values():
            folder.mkdir()
        target = folders.get(reference, tmp_path) / "q.sql"
        target.write_text(self.SCRIPT, encoding="utf-8")
        sql_file = str(target) if reference == "plain" else f"{reference}://q.sql"
        params = sqlite_params(
            orders_db(tmp_path), sql="SELECT 'ignored'", script_type="file", sql_file=sql_file
        )
        context = sql_context(
            params,
            log,
            testdata_dirs=[str(folders["testdata"])],
            artifacts_dir=str(folders["artifact"]),
        )

        out = await SQLClientPlugin().execute(context)

        assert [row.to_list() for row in out["rows"]] == [["café"]]

    async def test_a_missing_file_fails_before_connecting(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())
        missing = tmp_path / "missing.sql"
        params = sql_params(script_type="file", sql_file=str(missing))

        with pytest.raises(ValueError, match=exact(f"SQL file not found: {missing}")):
            await SQLClientPlugin().execute(sql_context(params, log))

        assert fake.connects == []

    async def test_a_missing_test_data_file_names_the_reference(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())
        folder = tmp_path / "testdata"
        folder.mkdir()
        params = sql_params(script_type="file", sql_file="testdata://missing.sql")

        with pytest.raises(ValueError, match=exact("SQL file not found: testdata://missing.sql")):
            await SQLClientPlugin().execute(sql_context(params, log, testdata_dirs=[str(folder)]))

        assert fake.connects == []

    async def test_a_missing_test_data_file_follows_on_error(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())
        folder = tmp_path / "testdata"
        folder.mkdir()
        message = "SQL file not found: testdata://missing.sql"
        params = sql_params(
            script_type="file", sql_file="testdata://missing.sql", on_error="record"
        )

        out = await SQLClientPlugin().execute(sql_context(params, log, testdata_dirs=[str(folder)]))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        assert fake.connects == []

    def test_the_core_reads_a_plain_path_where_it_runs(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        script = tmp_path / "q.sql"
        script.write_text(self.SCRIPT, encoding="utf-8")
        params = sqlite_params(orders_db(tmp_path), script_type="file", sql_file=str(script))

        out = outputs(_sql_core.run(params, log))

        assert rows(out["rows"]) == [["café"]]

    def test_a_file_missing_where_it_runs_is_a_validation_failure(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())
        missing = tmp_path / "missing.sql"
        message = f"SQL file not found: {missing}"
        params = sql_params(script_type="file", sql_file=str(missing))

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        assert fake.connects == []


@pytest.fixture(params=["does-not-import", "has-no-version"])
def unloadable_sqlite(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """The bundled SQLite build does not import, or imports with no SQLite version to read."""
    broken = None if request.param == "does-not-import" else types.ModuleType("apsw")
    monkeypatch.setitem(sys.modules, "apsw", broken)


class TestBundledSqliteCannotLoad:
    """A machine that cannot load the bundled SQLite fails a SQLite block at once (REQ-3.4.1.19)."""

    @pytest.mark.parametrize(
        ("remote_host", "pattern"),
        [
            pytest.param(None, WAVE_CANNOT_LOAD, id="wave"),
            pytest.param("edge-7", HOST_CANNOT_LOAD, id="remote-host"),
        ],
    )
    def test_the_block_fails_naming_the_machine(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        unloadable_sqlite: None,
        log: LogRecorder,
        remote_host: str | None,
        pattern: str,
    ) -> None:
        monkeypatch.setattr(_sql_core, "REMOTE_HOST", remote_host)
        path = tmp_path / "t.db"

        with pytest.raises(ValueError, match=pattern):
            _sql_core.run(sqlite_params(path), log)
        out = outputs(_sql_core.run(sqlite_params(path, on_error="record"), log))

        assert (out["success"], out["reason"]) == (False, "Unsupported")
        assert re.fullmatch(pattern, out["error"])
        empty_run_outputs(out)
        assert log.at("WARN") == [f"Run SQL failed (Unsupported): {out['error']}"]
        assert log.at("INFO") == []
        assert not path.exists()

    def test_nothing_is_opened(
        self, use_fake: Any, unloadable_sqlite: None, log: LogRecorder
    ) -> None:
        fake = use_fake("sqlite", FakeConnection())

        out = outputs(_sql_core.run(sqlite_params(Path("unused"), on_error="record"), log))

        assert (out["success"], out["reason"]) == (False, "Unsupported")
        assert re.fullmatch(WAVE_CANNOT_LOAD, out["error"])
        assert (fake.connects, log.at("INFO")) == ([], [])

    def test_a_network_type_does_not_need_it(
        self, use_fake: Any, unloadable_sqlite: None, log: LogRecorder
    ) -> None:
        use_fake("postgresql", FakeConnection([Result(columns=["n"], rows=[(1,)])]))

        out = outputs(_sql_core.run(sql_params(), log))

        assert (out["success"], rows(out["rows"])) == (True, [[1]])

    def test_wave_itself_runs_without_a_remote_host(self) -> None:
        assert _sql_core.REMOTE_HOST is None


LOADER_TEXT = "/lib64/libc.so.6: version `GLIBC_2.17' not found (required by base_impl.so)"


class _Unloadable(importlib.abc.MetaPathFinder):
    """Refuses to load one package, in the words a loader uses for a build made for another host."""

    def __init__(self, package: str) -> None:
        self._package = package

    def find_spec(self, name: str, path: Any, target: Any = None) -> None:
        if name.split(".")[0] == self._package:
            raise ImportError(LOADER_TEXT)


def unloadable(monkeypatch: pytest.MonkeyPatch, package: str) -> None:
    """Make every import of `package` fail from now on, as on a host that cannot load its build."""
    for name in [name for name in sys.modules if name.split(".")[0] == package]:
        monkeypatch.delitem(sys.modules, name)
    monkeypatch.setattr(sys, "meta_path", [_Unloadable(package), *sys.meta_path])


class TestDriverCannotLoad:
    """A machine that cannot load a database's driver fails the block as Unsupported, undialed."""

    @pytest.mark.parametrize(
        ("database_type", "package", "name", "tls"),
        [
            pytest.param("oracle", "oracledb", "Oracle", False, id="oracle"),
            pytest.param("mssql", "OpenSSL", "SQL Server", True, id="sql-server-tls-layer"),
            pytest.param("mssql", "pytds", "SQL Server", False, id="sql-server"),
            pytest.param("postgresql", "pg8000", "PostgreSQL", False, id="postgresql"),
            pytest.param("mysql", "pymysql", "MySQL", False, id="mysql"),
        ],
    )
    @pytest.mark.parametrize(
        ("remote_host", "machine"),
        [(None, "The WAVE host"), ("edge-7", "The remote host 'edge-7'")],
        ids=["wave", "remote-host"],
    )
    def test_the_block_fails_naming_the_machine_and_the_driver(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        database_type: str,
        package: str,
        name: str,
        tls: bool,
        remote_host: str | None,
        machine: str,
    ) -> None:
        monkeypatch.setattr(_sql_core, "REMOTE_HOST", remote_host)
        unloadable(monkeypatch, package)
        message = f"{machine} cannot load the {name} driver: {LOADER_TEXT}"
        params = sql_params(database_type=database_type, tls=tls, verify_ssl=False)

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Unsupported")
        empty_run_outputs(out)
        assert log.at("WARN") == [f"Run SQL failed (Unsupported): {message}"]
        assert log.at("INFO") == []

    @pytest.mark.parametrize(
        ("remote_host", "machine"),
        [(None, "The WAVE host"), ("edge-7", "The remote host 'edge-7'")],
        ids=["wave", "remote-host"],
    )
    def test_the_oracle_drivers_own_refusal_of_its_crypto_library_is_answered_alike(
        self,
        monkeypatch: pytest.MonkeyPatch,
        use_fake: Any,
        log: LogRecorder,
        remote_host: str | None,
        machine: str,
    ) -> None:
        monkeypatch.setattr(_sql_core, "REMOTE_HOST", remote_host)
        text = (
            "DPY-3016: python-oracledb thin mode cannot be used because the cryptography "
            "package cannot be imported\nNo module named '_cffi_backend'"
        )
        refusal = Exception(types.SimpleNamespace(full_code="DPY-3016", message=text))
        fake = use_fake("oracle", FakeConnection(), connect_error=refusal)
        message = f"{machine} cannot load the Oracle driver: {text}"
        params = sql_params(database_type="oracle", on_error="record")

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Unsupported")
        assert log.at("WARN") == [f"Run SQL failed (Unsupported): {message}"]
        assert len(fake.connects) == 1

    def test_a_failed_connect_of_a_driver_that_loads_stays_unreachable(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        refused = OSError("[Errno 111] Connection refused")
        use_fake("oracle", FakeConnection(), connect_error=refused)
        params = sql_params(database_type="oracle", on_error="record")

        out = outputs(_sql_core.run(params, log))

        assert (out["error"], out["reason"]) == (
            "Could not connect to Oracle at db:1521: [Errno 111] Connection refused",
            "Unreachable",
        )

    def test_the_bundled_sqlite_keeps_its_own_words(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        monkeypatch.setattr(_sql_core, "REMOTE_HOST", "edge-7")
        unloadable(monkeypatch, "apsw")
        message = f"The remote host 'edge-7' cannot load WAVE's bundled SQLite: {LOADER_TEXT}"

        out = outputs(_sql_core.run(sqlite_params(tmp_path / "t.db", on_error="record"), log))

        assert (out["error"], out["reason"]) == (message, "Unsupported")


class TestDriverOptionsADialectRefuses:
    """A Driver option its dialect refuses fails the block before it connects (REQ-3.4.1.19)."""

    @pytest.mark.parametrize(
        ("name", "value"),
        [
            pytest.param("isolation_level", "DEFERRED", id="isolation_level"),
            pytest.param("check_same_thread", False, id="check_same_thread"),
            pytest.param("uri", True, id="uri"),
            pytest.param("detect_types", 1, id="detect_types"),
        ],
    )
    def test_an_unknown_sqlite_option_is_refused_and_no_file_is_created(
        self, tmp_path: Path, log: LogRecorder, name: str, value: Any
    ) -> None:
        path = tmp_path / "new.db"
        message = (
            f"SQLite Driver option '{name}' is not supported: "
            "SQLite takes timeout and cached_statements"
        )
        params = sqlite_params(path, driver_options={name: value})

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        empty_run_outputs(out)
        assert log.at("WARN") == [f"Run SQL failed (Validation): {message}"]
        assert log.at("INFO") == []
        assert not path.exists()

    def test_an_oracle_tns_alias_is_refused_and_nothing_is_dialed(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        driver = MagicMock(name="oracledb")
        driver.connect.return_value = FakeConnection(version="23.4.0.24.5")
        monkeypatch.setitem(sys.modules, "oracledb", driver)
        params = sql_params(
            database_type="oracle",
            host="",
            database="",
            driver_options={"dsn": "PRODDB"},
            sql="SELECT 1 FROM dual",
        )

        with pytest.raises(ValueError, match=exact(ORACLE_ALIAS)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (False, ORACLE_ALIAS, "Validation")
        empty_run_outputs(out)
        assert log.at("WARN") == [f"Run SQL failed (Validation): {ORACLE_ALIAS}"]
        assert (log.at("INFO"), driver.connect.call_count) == ([], 0)

    def test_an_oracle_configuration_provider_dsn_is_refused_and_nothing_is_dialed(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        driver = MagicMock(name="oracledb")
        driver.connect.return_value = FakeConnection(version="23.4.0.24.5")
        monkeypatch.setitem(sys.modules, "oracledb", driver)
        params = sql_params(
            database_type="oracle",
            host="",
            database="",
            driver_options={"dsn": "config-file:///srv/ora/app.json"},
            sql="SELECT 1 FROM dual",
        )

        with pytest.raises(ValueError, match=exact(ORACLE_PROVIDER)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (
            False,
            ORACLE_PROVIDER,
            "Validation",
        )
        empty_run_outputs(out)
        assert log.at("WARN") == [f"Run SQL failed (Validation): {ORACLE_PROVIDER}"]
        assert (log.at("INFO"), driver.connect.call_count) == ([], 0)

    @pytest.mark.parametrize(("tls", "dsn", "message"), ORACLE_REFUSED_DSNS)
    def test_an_oracle_dsn_the_driver_reads_otherwise_is_refused_and_nothing_is_dialed(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, tls: bool, dsn: str, message: str
    ) -> None:
        import oracledb

        dialed = MagicMock(return_value=FakeConnection(version="23.4.0.24.5"))
        monkeypatch.setattr(oracledb, "connect", dialed)
        monkeypatch.setattr(oracledb.defaults, "config_dir", oracledb.defaults.config_dir)
        params = sql_params(
            database_type="oracle",
            host="",
            database="",
            tls=tls,
            verify_ssl=False,
            driver_options={"dsn": dsn},
            sql="SELECT 1 FROM dual",
        )

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        empty_run_outputs(out)
        assert log.at("WARN") == [f"Run SQL failed (Validation): {message}"]
        assert (log.at("INFO"), dialed.call_count) == ([], 0)

    @pytest.mark.parametrize(("tls", "protocol", "message"), ORACLE_REFUSED_PROTOCOLS)
    def test_an_oracle_protocol_option_against_the_tls_row_is_refused_and_nothing_is_dialed(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        tls: bool,
        protocol: str,
        message: str,
    ) -> None:
        driver = MagicMock(name="oracledb")
        driver.connect.return_value = FakeConnection(version="23.4.0.24.5")
        monkeypatch.setitem(sys.modules, "oracledb", driver)
        params = sql_params(
            database_type="oracle",
            tls=tls,
            verify_ssl=False,
            driver_options={"protocol": protocol},
            sql="SELECT 1 FROM dual",
        )

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        empty_run_outputs(out)
        assert log.at("WARN") == [f"Run SQL failed (Validation): {message}"]
        assert (log.at("INFO"), driver.connect.call_count) == ([], 0)


class TestChecksBeforeConnecting:
    """Unsupported, the bundled SQLite, a remote scheme file, then undefined names (SQL-5)."""

    def test_an_unsupported_host_wins_and_nothing_is_dialed(
        self, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("oracle", FakeConnection())
        params = sql_params(
            database_type="oracle",
            sql="SELECT :missing",
            unsupported=UNSUPPORTED,
            on_error="record",
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, UNSUPPORTED, "Unsupported")
        assert log.at("WARN") == [f"Run SQL failed (Unsupported): {UNSUPPORTED}"]
        assert fake.connects == []

    def test_an_unsupported_host_wins_over_the_load_check(
        self, use_fake: Any, unloadable_sqlite: None, log: LogRecorder
    ) -> None:
        fake = use_fake("sqlite", FakeConnection())
        params = sqlite_params(Path("unused"), unsupported=NO_CARRIED_SQLITE, on_error="record")

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (
            False,
            NO_CARRIED_SQLITE,
            "Unsupported",
        )
        assert log.at("WARN") == [f"Run SQL failed (Unsupported): {NO_CARRIED_SQLITE}"]
        assert fake.connects == []

    def test_the_load_check_comes_before_the_remote_scheme_refusal(
        self, monkeypatch: pytest.MonkeyPatch, unloadable_sqlite: None, log: LogRecorder
    ) -> None:
        monkeypatch.setattr(_sql_core, "REMOTE_HOST", "edge-7")
        params = sqlite_params(Path("unused"), file="testdata://ref.db")

        with pytest.raises(ValueError, match=HOST_CANNOT_LOAD):
            _sql_core.run(params, log)

    @pytest.mark.parametrize("scheme", ["testdata", "artifact"])
    def test_a_scheme_file_on_a_remote_host_is_refused_before_undefined_names(
        self, monkeypatch: pytest.MonkeyPatch, use_fake: Any, log: LogRecorder, scheme: str
    ) -> None:
        monkeypatch.setattr(_sql_core, "REMOTE_HOST", "sshd")
        fake = use_fake("sqlite", FakeConnection())
        message = f"{scheme}:// paths are not available on the remote host"
        params = sqlite_params(
            Path("unused"), file=f"{scheme}://ref.db", sql="SELECT :missing", on_error="record"
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        assert fake.connects == []

    def test_every_check_passes_on_a_plain_remote_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        monkeypatch.setattr(_sql_core, "REMOTE_HOST", "sshd")
        path = orders_db(tmp_path)

        out = outputs(_sql_core.run(sqlite_params(path, sql="SELECT count(*) FROM orders"), log))

        assert rows(out["rows"]) == [[3]]
        assert log.at("INFO")[0] == connected(path)


async def run_block(params: dict[str, Any], log: LogRecorder) -> dict[str, Any]:
    """One SQL Client in the engine's order: validate, then execute."""
    plugin = SQLClientPlugin()
    await plugin.validate(params)
    result: dict[str, Any] = await plugin.execute(sql_context(params, log))
    return result


class TestNullEntries:
    """A null Parameters value binds NULL; a null Driver options entry is not passed on, so
    the driver keeps its own default (REQ-3.1.3.20, REQ-3.1.3.21)."""

    async def test_a_null_parameter_binds_null_through_the_block(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(path, sql="SELECT :z IS NULL AS absent", parameters={"z": None})

        out = await run_block(params, log)

        assert [row.to_list() for row in out["rows"]] == [[1]]

    @pytest.mark.parametrize("database_type", ["postgresql", "mysql", "mssql"])
    async def test_a_null_driver_option_never_reaches_the_driver(
        self, use_fake: Any, log: LogRecorder, database_type: str
    ) -> None:
        fake = use_fake(database_type, FakeConnection())
        params = sql_params(
            database_type=database_type,
            driver_options={"application_name": "wave", "sslmode": None},
        )

        await run_block(params, log)

        assert fake.connects[0][0]["driver_options"] == {"application_name": "wave"}

    async def test_a_null_sqlite_driver_option_keeps_the_sqlite_default(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = sqlite_params(
            path, sql="SELECT count(*) AS n FROM orders", driver_options={"timeout": None}
        )

        out = await run_block(params, log)

        assert (out["success"], out["error"]) == (True, "")
        assert [row.to_list() for row in out["rows"]] == [[3]]
