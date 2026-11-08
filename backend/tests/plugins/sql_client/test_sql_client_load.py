"""Load table into real SQLite and into fake connections (REQ-3.4.1.6, REQ-5.1.4)."""

import re
from decimal import Decimal
from pathlib import Path
from typing import Any

import apsw
import openpyxl
import pytest

from tests.connectivity.sql.fakes import FakeConnection, Result, sqlite_file
from tests.plugins.sql_client.conftest import (
    LogRecorder,
    exact,
    outputs,
    sql_context,
    sql_params,
    sqlite_params,
)
from wavecore.core.table import Table
from wavecore.plugins import _sql_core
from wavecore.plugins.sql_client import SQLClientPlugin

ORDERS = (
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER, note TEXT DEFAULT 'none')",
    "INSERT INTO orders (id, qty) VALUES (100, 1)",
)
TARGET_READ = "SELECT * FROM orders WHERE 1 = 0"
SQLITE_INSERT = 'INSERT INTO orders ("id", "qty") VALUES (?, ?)'
DUPLICATE = "UNIQUE constraint failed: orders.id"
DEFERRED = "FOREIGN KEY constraint failed"
ID_QTY = [("id", "integer"), ("qty", "integer")]
_MEASURED = re.compile(r", \d+ ms$|, \d+\.\d s$")


def envelope(spec: list[tuple[str, str]], cells: list[list[Any]]) -> dict[str, Any]:
    """A table envelope as prepare hands it to the core."""
    return {
        "__wave_type": "table",
        "columns": [{"name": name, "type": kind} for name, kind in spec],
        "rows": cells,
    }


def id_rows(*ids: int) -> dict[str, Any]:
    """An id / qty envelope whose qty is ten times the id."""
    return envelope(ID_QTY, [[row_id, row_id * 10] for row_id in ids])


def orders_db(tmp_path: Path, *statements: str) -> Path:
    return sqlite_file(tmp_path / "t.db", *(statements or ORDERS))


def load_params(path: Path, table: Any, **overrides: Any) -> dict[str, Any]:
    """A Load table block into orders on the SQLite file at `path`."""
    base = {"operation": "load_table", "table": table, "target_table": "orders"}
    return sqlite_params(path, **{**base, **overrides})


def query(path: Path, statement: str = "SELECT id, qty, note FROM orders ORDER BY id") -> Any:
    """What a fresh connection reads from the database file at `path`."""
    connection = apsw.Connection(str(path))
    try:
        return connection.execute(statement).fetchall()
    finally:
        connection.close()


def timed(lines: list[str]) -> list[str]:
    """Lines with each measured duration replaced by N."""
    return [_MEASURED.sub(lambda found: re.sub(r"[\d.]+", "N", found[0]), line) for line in lines]


def duplicate(row: int) -> str:
    return f"Row {row}: {DUPLICATE}"


class TestModes:
    """Add, Add or replace and Overwrite on real SQLite (SQL-7)."""

    def test_add_inserts_the_rows(self, tmp_path: Path, log: LogRecorder) -> None:
        path = orders_db(tmp_path)

        out = outputs(_sql_core.run(load_params(path, id_rows(1, 2)), log))

        assert out == {"rows_changed": 2, "success": True, "error": "", "reason": ""}
        assert query(path) == [(1, 10, "none"), (2, 20, "none"), (100, 1, "none")]
        assert log.at("DEBUG").count(SQLITE_INSERT) == 1

    async def test_add_from_a_wave_table_binds_every_column_type(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(
            tmp_path,
            "CREATE TABLE items (id INTEGER PRIMARY KEY, price REAL, active INTEGER, name TEXT)",
        )
        table = Table(
            columns=[
                ("id", "integer"),
                ("price", "float"),
                ("active", "boolean"),
                ("name", "string"),
            ]
        )
        table.add_row([1, Decimal("12.50"), True, "bolt"])
        table.add_row([2, Decimal("3"), False, None])
        params = load_params(path, table, target_table="items")

        out = await SQLClientPlugin().execute(sql_context(params, log))

        assert (out["success"], out["rows_changed"]) == (True, 2)
        assert query(path, "SELECT id, price, active, name FROM items ORDER BY id") == [
            (1, 12.5, 1, "bolt"),
            (2, 3.0, 0, None),
        ]

    @pytest.mark.parametrize("keys", ["id", " id ", "id,"])
    def test_add_or_replace_matches_on_the_given_key_columns(
        self, tmp_path: Path, log: LogRecorder, keys: str
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(path, id_rows(1, 100), mode="add_or_replace", key_columns=keys)

        out = outputs(_sql_core.run(params, log))

        assert out["success"] is True
        assert query(path) == [(1, 10, "none"), (100, 1000, "none")]
        upsert = (
            'INSERT INTO orders ("id", "qty") VALUES (?, ?) '
            'ON CONFLICT ("id") DO UPDATE SET "qty" = excluded."qty"'
        )
        assert log.at("DEBUG").count(upsert) == 1

    @pytest.mark.parametrize(
        "keys",
        [pytest.param({}, id="absent"), pytest.param({"key_columns": ""}, id="blank")],
    )
    def test_add_or_replace_reads_the_primary_key(
        self, tmp_path: Path, log: LogRecorder, keys: dict[str, Any]
    ) -> None:
        path = orders_db(tmp_path)

        out = outputs(
            _sql_core.run(load_params(path, id_rows(1, 100), mode="add_or_replace", **keys), log)
        )

        assert out["success"] is True
        assert query(path) == [(1, 10, "none"), (100, 1000, "none")]

    @pytest.mark.parametrize("keys", ["", "region, sku", " sku ,region "])
    def test_add_or_replace_on_a_composite_key(
        self, tmp_path: Path, log: LogRecorder, keys: str
    ) -> None:
        path = orders_db(
            tmp_path,
            "CREATE TABLE stock (region TEXT, sku TEXT, qty INTEGER, PRIMARY KEY (region, sku))",
            "INSERT INTO stock VALUES ('eu', 'a', 1), ('us', 'a', 2)",
        )
        spec = [("region", "string"), ("sku", "string"), ("qty", "integer")]
        table = envelope(spec, [["eu", "a", 5], ["eu", "b", 6]])
        params = load_params(
            path, table, target_table="stock", mode="add_or_replace", key_columns=keys
        )

        out = outputs(_sql_core.run(params, log))

        assert out["success"] is True
        assert query(path, "SELECT region, sku, qty FROM stock ORDER BY region, sku") == [
            ("eu", "a", 5),
            ("eu", "b", 6),
            ("us", "a", 2),
        ]

    def test_overwrite_replaces_the_rows_and_keeps_the_table(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path, *ORDERS, "INSERT INTO orders VALUES (101, 2, 'kept?')")

        out = outputs(_sql_core.run(load_params(path, id_rows(1, 2), mode="overwrite"), log))

        assert (out["success"], out["rows_changed"]) == (True, 2)
        assert query(path) == [(1, 10, "none"), (2, 20, "none")]

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_duplicate_key_under_add_is_the_database_error_with_its_row(
        self, tmp_path: Path, log: LogRecorder, on_error: str
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(path, id_rows(1, 100, 3), on_error=on_error)

        if on_error == "fail":
            with pytest.raises(ValueError, match=exact(duplicate(2))):
                _sql_core.run(params, log)
        else:
            out = outputs(_sql_core.run(params, log))
            assert (out["success"], out["error"], out["reason"]) == (
                False,
                duplicate(2),
                "DatabaseError",
            )
            assert (out["rows_changed"], out["__block_warning"]) == (0, True)
            assert log.at("WARN") == [f"Load table failed (DatabaseError): {duplicate(2)}"]

        assert query(path) == [(100, 1, "none")]


class TestColumns:
    """Columns match by name; a WAVE column with no match fails before any row (SQL-7)."""

    def test_columns_match_by_name_in_any_order_and_case(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        table = envelope([("QTY", "integer"), ("Id", "integer")], [[40, 4]])

        out = outputs(_sql_core.run(load_params(path, table), log))

        assert out["success"] is True
        assert query(path) == [(4, 40, "none"), (100, 1, "none")]
        insert = 'INSERT INTO orders ("qty", "id") VALUES (?, ?)'
        assert log.at("DEBUG").count(insert) == 1

    @pytest.mark.parametrize(
        ("table", "overrides", "message"),
        [
            pytest.param(
                envelope([("id", "integer"), ("price", "float")], [[4, "1.5"]]),
                {},
                "Column 'price' is not in orders",
                id="wave-column",
            ),
            pytest.param(
                id_rows(4),
                {"mode": "add_or_replace", "key_columns": "zone"},
                "Column 'zone' is not in orders",
                id="key-column-not-in-target",
            ),
            pytest.param(
                id_rows(4),
                {"mode": "add_or_replace", "key_columns": "note"},
                "Key column 'note' is not among the Table's columns",
                id="key-column-not-in-table",
            ),
        ],
    )
    def test_a_column_that_does_not_match_fails_before_any_row(
        self,
        tmp_path: Path,
        log: LogRecorder,
        table: dict[str, Any],
        overrides: dict[str, Any],
        message: str,
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(path, table, **overrides)

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        assert out["rows_changed"] == 0
        assert query(path) == [(100, 1, "none")]
        assert not [line for line in log.at("INFO") if line.startswith("batch ")]

    @pytest.mark.parametrize("on_error", ["fail", "record"])
    def test_a_target_table_that_does_not_exist_is_the_database_error(
        self, tmp_path: Path, log: LogRecorder, on_error: str
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(path, id_rows(1), target_table="nope", on_error=on_error)

        if on_error == "fail":
            with pytest.raises(ValueError, match=exact("no such table: nope")):
                _sql_core.run(params, log)
        else:
            out = outputs(_sql_core.run(params, log))
            assert (out["success"], out["error"], out["reason"], out["rows_changed"]) == (
                False,
                "no such table: nope",
                "DatabaseError",
                0,
            )
        assert query(path, "SELECT name FROM sqlite_master WHERE name = 'nope'") == []

    def test_no_key_columns_and_no_primary_key_fails_before_any_row(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path, "CREATE TABLE orders (id INTEGER, qty INTEGER)")
        message = "Key columns are required: orders has no primary key"
        params = load_params(path, id_rows(1), mode="add_or_replace")

        with pytest.raises(ValueError, match=exact(message)):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["error"], out["reason"]) == (message, "Validation")
        assert query(path, "SELECT count(*) FROM orders") == [(0,)]


class TestBatches:
    """Batches of Batch size, the console lines, and the two commit models (SQL-7)."""

    def test_each_batch_writes_its_line_and_the_load_ends_with_a_total(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)

        out = outputs(_sql_core.run(load_params(path, id_rows(1, 2, 3, 4, 5), batch_size=2), log))

        assert (out["success"], out["rows_changed"]) == (True, 5)
        assert timed(log.at("INFO")) == [
            f"Connected to SQLite {apsw.sqlitelibversion()} at {path}",
            "batch 1/3: 2 rows",
            "batch 2/3: 2 rows",
            "batch 3/3: 1 rows",
            "5 rows into orders, N s",
        ]
        assert log.at("DEBUG").count(SQLITE_INSERT) == 1
        assert (log.at("WARN"), log.at("ERROR")) == ([], [])

    @pytest.mark.parametrize("stop_on_error", [True, False])
    def test_without_commit_each_batch_the_load_is_all_or_nothing(
        self, tmp_path: Path, log: LogRecorder, stop_on_error: bool
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(
            path, id_rows(1, 2, 3, 100, 5, 6), batch_size=2, stop_on_error=stop_on_error
        )

        with pytest.raises(ValueError, match=exact(duplicate(4))):
            _sql_core.run(params, log)
        out = outputs(_sql_core.run({**params, "on_error": "record"}, log))

        assert (out["error"], out["reason"], out["rows_changed"]) == (
            duplicate(4),
            "DatabaseError",
            0,
        )
        assert query(path) == [(100, 1, "none")]

    @pytest.mark.parametrize("mode", ["add", "overwrite"])
    def test_without_commit_each_batch_a_rollback_says_no_row_landed(
        self, tmp_path: Path, log: LogRecorder, mode: str
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(
            path, id_rows(1, 2, 3, 1, 5, 6), batch_size=2, mode=mode, on_error="record"
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["error"], out["rows_changed"]) == (duplicate(4), 0)
        assert [entry for entry in log if entry[0] != "DEBUG"] == [
            ("INFO", f"Connected to SQLite {apsw.sqlitelibversion()} at {path}"),
            ("INFO", "batch 1/3: 2 rows"),
            ("INFO", "Transaction rolled back: 0 rows into orders"),
            ("WARN", f"Load table failed (DatabaseError): {duplicate(4)}"),
        ]
        assert query(path) == [(100, 1, "none")]

    def test_without_commit_each_batch_a_failure_under_fail_says_no_row_landed(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)

        with pytest.raises(ValueError, match=exact(duplicate(2))):
            _sql_core.run(load_params(path, id_rows(1, 100)), log)

        assert log.at("INFO")[1:] == ["Transaction rolled back: 0 rows into orders"]

    def test_commit_each_batch_writes_no_rollback_line_for_the_batches_that_landed(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(
            path,
            id_rows(1, 2, 3, 100, 5, 6),
            batch_size=2,
            commit_each_batch=True,
            on_error="record",
        )

        out = outputs(_sql_core.run(params, log))

        assert out["rows_changed"] == 2
        assert log.at("INFO")[1:] == ["batch 1/3: 2 rows"]

    def test_a_failed_overwrite_keeps_the_rows_it_would_have_deleted(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(path, id_rows(1, 1), mode="overwrite")

        with pytest.raises(ValueError, match=exact(duplicate(2))):
            _sql_core.run(params, log)

        assert query(path) == [(100, 1, "none")]

    def test_commit_each_batch_with_stop_on_error_keeps_the_earlier_batches(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(
            path,
            id_rows(1, 2, 3, 100, 5, 6),
            batch_size=2,
            commit_each_batch=True,
            on_error="record",
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (
            False,
            duplicate(4),
            "DatabaseError",
        )
        assert (out["rows_changed"], out["__block_warning"]) == (2, True)
        assert query(path) == [(1, 10, "none"), (2, 20, "none"), (100, 1, "none")]

    def test_commit_each_batch_without_stop_on_error_skips_the_failed_batch(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(
            path,
            id_rows(1, 2, 3, 100, 5, 6),
            batch_size=2,
            commit_each_batch=True,
            stop_on_error=False,
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert "__block_warning" not in out
        assert out["rows_changed"] == 4
        assert log.at("WARN") == [f"batch 2/3 failed: {duplicate(4)}"]
        assert [row[0] for row in query(path)] == [1, 2, 5, 6, 100]

    def test_every_batch_failing_ends_amber(self, tmp_path: Path, log: LogRecorder) -> None:
        path = orders_db(tmp_path, *ORDERS, "INSERT INTO orders (id, qty) VALUES (101, 1)")
        params = load_params(
            path, id_rows(100, 101), batch_size=1, commit_each_batch=True, stop_on_error=False
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert (out["__block_warning"], out["rows_changed"]) == (True, 0)
        assert log.at("WARN") == [
            f"batch 1/2 failed: {duplicate(1)}",
            f"batch 2/2 failed: {duplicate(2)}",
        ]

    @pytest.mark.parametrize(
        ("mode", "left"),
        [("add", [(100, 1, "none")]), ("overwrite", [])],
    )
    def test_an_empty_table_loads_nothing_and_overwrite_still_deletes(
        self, tmp_path: Path, log: LogRecorder, mode: str, left: list[Any]
    ) -> None:
        path = orders_db(tmp_path)

        out = outputs(_sql_core.run(load_params(path, envelope(ID_QTY, []), mode=mode), log))

        assert (out["success"], out["rows_changed"]) == (True, 0)
        assert query(path) == left
        assert timed(log.at("INFO"))[-1] == "0 rows into orders, N s"


class TestTheRefusedRowIsFound:
    """A refused value names its row; WAVE replays the load one row at a time to find it (SQL-7)."""

    @pytest.mark.parametrize("stop_on_error", [True, False])
    def test_a_clash_with_an_earlier_batch_is_found_by_replaying_from_row_one(
        self, tmp_path: Path, log: LogRecorder, stop_on_error: bool
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(
            path,
            id_rows(1, 2, 3, 1, 5),
            batch_size=2,
            stop_on_error=stop_on_error,
            on_error="record",
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (
            False,
            duplicate(4),
            "DatabaseError",
        )
        assert out["rows_changed"] == 0
        assert query(path) == [(100, 1, "none")]

    def test_an_overwrite_replay_empties_the_table_before_its_rows(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(
            path, id_rows(100, 5, 100), mode="overwrite", batch_size=2, on_error="record"
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["error"], out["reason"], out["rows_changed"]) == (
            duplicate(3),
            "DatabaseError",
            0,
        )
        assert query(path) == [(100, 1, "none")]

    def test_with_commit_each_batch_only_the_failed_batch_is_replayed(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(
            path, id_rows(1, 2, 3, 1), batch_size=2, commit_each_batch=True, on_error="record"
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["error"], out["reason"], out["rows_changed"]) == (
            duplicate(4),
            "DatabaseError",
            2,
        )
        assert query(path) == [(1, 10, "none"), (2, 20, "none"), (100, 1, "none")]


class TestBlankAndEmpty:
    """A blank Batch size is 1000; an empty Table still connects, commits and reports (SQL-7)."""

    @pytest.mark.parametrize("blank", ["", None], ids=["empty", "none"])
    def test_a_blank_batch_size_sends_batches_of_one_thousand(
        self, tmp_path: Path, log: LogRecorder, blank: Any
    ) -> None:
        path = orders_db(tmp_path)
        params = load_params(path, id_rows(*range(1000, 2001)), batch_size=blank)

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["rows_changed"]) == (True, 1001)
        assert [line for line in log.at("INFO") if line.startswith("batch ")] == [
            "batch 1/2: 1000 rows",
            "batch 2/2: 1 rows",
        ]

    @pytest.mark.parametrize("mode", ["add", "overwrite"])
    def test_an_empty_table_logs_the_connect_and_the_total_only(
        self, tmp_path: Path, log: LogRecorder, mode: str
    ) -> None:
        path = orders_db(tmp_path)

        out = outputs(_sql_core.run(load_params(path, envelope(ID_QTY, []), mode=mode), log))

        assert (out["success"], out["rows_changed"]) == (True, 0)
        assert timed(log.at("INFO")) == [
            f"Connected to SQLite {apsw.sqlitelibversion()} at {path}",
            "0 rows into orders, N s",
        ]


class EventConnection(FakeConnection):
    """A FakeConnection that also records statements, commits and rollbacks in one sequence."""

    def __init__(self, script: list[Result] | None = None) -> None:
        super().__init__(script)
        self.events: list[str] = []

    def next_result(self) -> Result:
        self.events.append(self.executed[-1][1])
        return super().next_result()

    def commit(self) -> None:
        super().commit()
        self.events.append("COMMIT")

    def rollback(self) -> None:
        super().rollback()
        self.events.append("ROLLBACK")


def refused() -> Result:
    return Result(error=apsw.ConstraintError(DUPLICATE))


def batches(connection: FakeConnection) -> list[list[tuple[Any, ...]]]:
    """The rows of each executemany, in order."""
    return [binds for kind, _, binds in connection.executed if kind == "executemany"]


class RefusingConnection(EventConnection):
    """Refuses every send that carries `refused_row`, however the rows travel; traces each send."""

    def __init__(self, refused_row: tuple[Any, ...]) -> None:
        super().__init__([Result(columns=["id", "qty"])])
        self.refused_row = refused_row
        self.trace: list[Any] = []

    def next_result(self) -> Result:
        kind, statement, binds = self.executed[-1]
        if kind == "executemany":
            sent = [tuple(row) for row in binds]
        else:
            sent = [] if binds is None else [tuple(binds)]
        self.trace.append((statement, sent))
        answer = super().next_result()
        return refused() if self.refused_row in sent else answer

    def commit(self) -> None:
        super().commit()
        self.trace.append("COMMIT")

    def rollback(self) -> None:
        super().rollback()
        self.trace.append("ROLLBACK")

    def after_first_rollback(self) -> list[tuple[str, list[tuple[Any, ...]]]]:
        """Every send after the first rollback, in order."""
        rest = self.trace[self.trace.index("ROLLBACK") + 1 :]
        return [entry for entry in rest if isinstance(entry, tuple)]


class CommitRefusingConnection(EventConnection):
    """Refuses the COMMIT, as a deferred constraint does, while every row on its own passes."""

    def commit(self) -> None:
        super().commit()
        raise apsw.ConstraintError(DEFERRED)


class SecondCommitRefusingConnection(EventConnection):
    """Commits the first batch and refuses the second's COMMIT, as a deferred constraint does."""

    def commit(self) -> None:
        super().commit()
        if self.commits == 2:
            raise apsw.ConstraintError(DEFERRED)


def traced_into(connection: EventConnection, log: LogRecorder) -> Any:
    """A log that also writes each batch line into the connection's event sequence."""

    def write(level: str, message: str) -> None:
        log(level, message)
        if message.startswith("batch "):
            connection.events.append(f"{level} {message}")

    return write


class TestTransactionsOnAFake:
    """What the core asks of the connection in each commit model (SQL-7)."""

    def test_without_commit_each_batch_one_commit_follows_the_last_batch(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = EventConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)

        out = outputs(
            _sql_core.run(load_params(tmp_path / "f.db", id_rows(1, 2, 3), batch_size=2), log)
        )

        assert out["rows_changed"] == 3
        assert connection.autocommit_calls[-1] is False
        assert connection.events == [TARGET_READ, SQLITE_INSERT, SQLITE_INSERT, "COMMIT"]
        assert batches(connection) == [[(1, 10), (2, 20)], [(3, 30)]]
        assert connection.closed is True

    def test_without_commit_each_batch_a_failure_commits_nothing(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = RefusingConnection((4, 40))
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db", id_rows(1, 2, 3, 4), batch_size=2, on_error="record"
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["error"], out["rows_changed"]) == (duplicate(4), 0)
        assert (connection.commits, connection.rollbacks >= 1) == (0, True)

    def test_without_commit_each_batch_a_refusal_replays_every_row_from_row_one(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = RefusingConnection((4, 40))
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db", id_rows(1, 2, 3, 4, 5, 6), batch_size=2, on_error="record"
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["error"], out["reason"], out["rows_changed"]) == (
            duplicate(4),
            "DatabaseError",
            0,
        )
        first_pass = connection.trace[: connection.trace.index("ROLLBACK")]
        assert first_pass == [
            (TARGET_READ, []),
            (SQLITE_INSERT, [(1, 10), (2, 20)]),
            (SQLITE_INSERT, [(3, 30), (4, 40)]),
        ]
        assert connection.after_first_rollback() == [
            (SQLITE_INSERT, [(1, 10)]),
            (SQLITE_INSERT, [(2, 20)]),
            (SQLITE_INSERT, [(3, 30)]),
            (SQLITE_INSERT, [(4, 40)]),
        ]
        assert connection.trace[-1] == "ROLLBACK"
        assert "COMMIT" not in connection.trace

    def test_a_refused_commit_with_no_refused_row_is_the_databases_own_error(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = CommitRefusingConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)
        params = load_params(tmp_path / "f.db", id_rows(1, 2, 3), batch_size=2, on_error="record")

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"], out["rows_changed"]) == (
            False,
            DEFERRED,
            "DatabaseError",
            0,
        )
        assert connection.events == [
            TARGET_READ,
            SQLITE_INSERT,
            SQLITE_INSERT,
            "COMMIT",
            "ROLLBACK",
            SQLITE_INSERT,
            SQLITE_INSERT,
            SQLITE_INSERT,
            "ROLLBACK",
        ]
        assert batches(connection)[2:] == [[(1, 10)], [(2, 20)], [(3, 30)]]

    def test_a_refused_commit_says_no_row_landed(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = CommitRefusingConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)
        params = load_params(tmp_path / "f.db", id_rows(1, 2, 3), batch_size=2, on_error="record")

        outputs(_sql_core.run(params, log))

        assert log.at("INFO")[1:] == [
            "batch 1/2: 2 rows",
            "batch 2/2: 1 rows",
            "Transaction rolled back: 0 rows into orders",
        ]

    def test_an_overwrite_replay_sends_the_delete_again_first(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = RefusingConnection((3, 30))
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db", id_rows(1, 2, 3), mode="overwrite", batch_size=2, on_error="record"
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["error"], out["rows_changed"]) == (duplicate(3), 0)
        assert connection.after_first_rollback() == [
            ("DELETE FROM orders", []),
            (SQLITE_INSERT, [(1, 10)]),
            (SQLITE_INSERT, [(2, 20)]),
            (SQLITE_INSERT, [(3, 30)]),
        ]
        assert connection.trace[-1] == "ROLLBACK"
        assert "COMMIT" not in connection.trace

    def test_commit_each_batch_replays_only_the_failed_batch(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = RefusingConnection((4, 40))
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db",
            id_rows(1, 2, 3, 4, 5, 6),
            batch_size=2,
            commit_each_batch=True,
            on_error="record",
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["error"], out["rows_changed"]) == (duplicate(4), 2)
        assert connection.after_first_rollback() == [
            (SQLITE_INSERT, [(3, 30)]),
            (SQLITE_INSERT, [(4, 40)]),
        ]
        assert connection.trace.count("COMMIT") == 1

    def test_commit_each_batch_commits_after_every_batch(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = EventConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db", id_rows(1, 2, 3), batch_size=2, commit_each_batch=True
        )

        _sql_core.run(params, log)

        assert connection.events == [TARGET_READ, SQLITE_INSERT, "COMMIT", SQLITE_INSERT, "COMMIT"]

    @pytest.mark.parametrize(
        ("each", "events"),
        [
            (
                True,
                [
                    TARGET_READ,
                    SQLITE_INSERT,
                    "COMMIT",
                    "INFO batch 1/2: 2 rows",
                    SQLITE_INSERT,
                    "COMMIT",
                    "INFO batch 2/2: 1 rows",
                ],
            ),
            (
                False,
                [
                    TARGET_READ,
                    SQLITE_INSERT,
                    "INFO batch 1/2: 2 rows",
                    SQLITE_INSERT,
                    "INFO batch 2/2: 1 rows",
                    "COMMIT",
                ],
            ),
        ],
        ids=["each batch: its line follows its commit", "one transaction: lines as sent"],
    )
    def test_a_batch_line_is_written_when_its_rows_are_known_to_stand(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder, each: bool, events: list[str]
    ) -> None:
        connection = EventConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db", id_rows(1, 2, 3), batch_size=2, commit_each_batch=each
        )

        _sql_core.run(params, traced_into(connection, log))

        assert connection.events == events

    def test_commit_each_batch_writes_no_line_for_a_batch_whose_commit_is_refused(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = SecondCommitRefusingConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db",
            id_rows(1, 2, 3, 4, 5),
            batch_size=2,
            commit_each_batch=True,
            on_error="record",
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"], out["rows_changed"]) == (
            False,
            DEFERRED,
            "DatabaseError",
            2,
        )
        assert log.at("INFO")[1:] == ["batch 1/3: 2 rows"]
        assert log.at("WARN") == [f"Load table failed (DatabaseError): {DEFERRED}"]
        assert connection.commits == 2

    def test_commit_each_batch_skips_a_batch_whose_commit_is_refused_without_its_line(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = SecondCommitRefusingConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db",
            id_rows(1, 2, 3, 4, 5),
            batch_size=2,
            commit_each_batch=True,
            stop_on_error=False,
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["rows_changed"]) == (True, 3)
        assert timed(log.at("INFO")[1:]) == [
            "batch 1/3: 2 rows",
            "batch 3/3: 1 rows",
            "3 rows into orders, N s",
        ]
        assert log.at("WARN") == [f"batch 2/3 failed: {DEFERRED}"]

    def test_commit_each_batch_with_stop_on_error_sends_nothing_after_the_failure(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        script = [Result(columns=["id", "qty"]), Result(), refused(), Result(), refused()]
        connection = EventConnection(script)
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db",
            id_rows(1, 2, 3, 4, 5, 6),
            batch_size=2,
            commit_each_batch=True,
            on_error="record",
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["error"], out["rows_changed"]) == (duplicate(4), 2)
        assert connection.commits == 1
        assert batches(connection)[:2] == [[(1, 10), (2, 20)], [(3, 30), (4, 40)]]
        assert [(5, 50), (6, 60)] not in batches(connection)
        assert connection.rollbacks >= 1

    def test_commit_each_batch_without_stop_on_error_rolls_back_only_the_failed_batch(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        script = [Result(columns=["id", "qty"]), Result(), refused(), Result(), refused(), Result()]
        connection = EventConnection(script)
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db",
            id_rows(1, 2, 3, 4, 5, 6),
            batch_size=2,
            commit_each_batch=True,
            stop_on_error=False,
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["rows_changed"]) == (True, 4)
        assert connection.commits == 2
        assert batches(connection)[-1] == [(5, 50), (6, 60)]
        assert log.at("WARN") == [f"batch 2/3 failed: {duplicate(4)}"]

    def test_commit_each_batch_ends_amber_when_every_batch_failed(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        script = [Result(columns=["id", "qty"]), refused(), refused(), refused(), refused()]
        connection = EventConnection(script)
        use_fake("sqlite", connection)
        params = load_params(
            tmp_path / "f.db",
            id_rows(1, 2),
            batch_size=1,
            commit_each_batch=True,
            stop_on_error=False,
        )

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["__block_warning"], out["rows_changed"]) == (True, True, 0)
        assert connection.commits == 0
        assert log.at("WARN") == [
            f"batch 1/2 failed: {duplicate(1)}",
            f"batch 2/2 failed: {duplicate(2)}",
        ]

    def test_overwrite_deletes_first_in_the_same_transaction(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        connection = EventConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)
        params = load_params(tmp_path / "f.db", id_rows(1, 2, 3), mode="overwrite", batch_size=2)

        _sql_core.run(params, log)

        assert connection.events == [
            TARGET_READ,
            "DELETE FROM orders",
            SQLITE_INSERT,
            SQLITE_INSERT,
            "COMMIT",
        ]

    @pytest.mark.parametrize(
        ("mode", "sent"),
        [("add", [TARGET_READ]), ("overwrite", [TARGET_READ, "DELETE FROM orders"])],
    )
    def test_an_empty_table_sends_no_batch(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder, mode: str, sent: list[str]
    ) -> None:
        connection = EventConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)

        out = outputs(
            _sql_core.run(load_params(tmp_path / "f.db", envelope(ID_QTY, []), mode=mode), log)
        )

        assert (out["success"], out["rows_changed"]) == (True, 0)
        assert connection.statements() == sent
        assert connection.rollbacks == 0

    @pytest.mark.parametrize(
        ("mode", "sent"),
        [("add", [TARGET_READ]), ("overwrite", [TARGET_READ, "DELETE FROM orders"])],
    )
    def test_an_empty_table_still_commits(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder, mode: str, sent: list[str]
    ) -> None:
        connection = EventConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)

        _sql_core.run(load_params(tmp_path / "f.db", envelope(ID_QTY, []), mode=mode), log)

        assert connection.events == [*sent, "COMMIT"]
        assert batches(connection) == []


BOUND_TYPES = [
    ("id", "integer"),
    ("price", "float"),
    ("active", "boolean"),
    ("note", "string"),
]


class TestBoundValues:
    """Values bind with their types; booleans are 1 and 0 on Oracle and SQL Server (SQL-7)."""

    @pytest.mark.parametrize(
        ("database_type", "target", "flags"),
        [
            pytest.param(
                "postgresql", ["id", "price", "active", "note"], [True, False], id="postgresql"
            ),
            pytest.param("mysql", ["id", "price", "active", "note"], [True, False], id="mysql"),
            pytest.param("oracle", ["ID", "PRICE", "ACTIVE", "NOTE"], [1, 0], id="oracle"),
            pytest.param("mssql", ["id", "price", "active", "note"], [1, 0], id="mssql"),
        ],
    )
    def test_each_cell_binds_as_its_column_type(
        self,
        use_fake: Any,
        log: LogRecorder,
        database_type: str,
        target: list[str],
        flags: list[Any],
    ) -> None:
        connection = FakeConnection([Result(columns=target)])
        use_fake(database_type, connection)
        table = envelope(BOUND_TYPES, [[1, "12.50", True, "a"], [2, "3", False, None]])
        params = sql_params(
            database_type=database_type, operation="load_table", table=table, target_table="orders"
        )

        out = outputs(_sql_core.run(params, log))

        assert out["success"] is True
        (sent,) = batches(connection)
        assert sent == [(1, Decimal("12.50"), flags[0], "a"), (2, Decimal("3"), flags[1], None)]
        assert [type(row[2]) for row in sent] == [type(flag) for flag in flags]
        assert [type(row[1]) for row in sent] == [Decimal, Decimal]


def write_csv(path: Path) -> Path:
    path.write_text("\ufeffid,qty\n4,40\n5,\n", encoding="utf-8")
    return path


class TestFiles:
    """Table as a CSV or Excel file, read on WAVE or where the block runs (SQL-7)."""

    @pytest.mark.parametrize("reference", ["testdata", "artifact", "plain"])
    async def test_a_csv_file_loads_with_empty_cells_as_null(
        self, tmp_path: Path, log: LogRecorder, reference: str
    ) -> None:
        folders = {"testdata": tmp_path / "testdata", "artifact": tmp_path / "artifacts"}
        for folder in folders.values():
            folder.mkdir()
        csv_file = write_csv(folders.get(reference, tmp_path) / "orders.csv")
        table = str(csv_file) if reference == "plain" else f"{reference}://orders.csv"
        path = orders_db(tmp_path)
        context = sql_context(
            load_params(path, table),
            log,
            testdata_dirs=[str(folders["testdata"])],
            artifacts_dir=str(folders["artifact"]),
        )

        out = await SQLClientPlugin().execute(context)

        assert (out["success"], out["rows_changed"]) == (True, 2)
        assert query(path) == [(4, 40, "none"), (5, None, "none"), (100, 1, "none")]

    async def test_an_excel_file_from_test_data_loads_its_first_sheet(
        self, tmp_path: Path, log: LogRecorder
    ) -> None:
        folder = tmp_path / "testdata"
        folder.mkdir()
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.append(["id", "qty"])
        sheet.append([6, 60])
        sheet.append([7, 70])
        workbook.create_sheet("other").append(["price"])
        workbook.save(folder / "orders.xlsx")
        path = orders_db(tmp_path)
        params = load_params(path, "testdata://orders.xlsx")

        out = await SQLClientPlugin().execute(sql_context(params, log, testdata_dirs=[str(folder)]))

        assert (out["success"], out["rows_changed"]) == (True, 2)
        assert query(path) == [(6, 60, "none"), (7, 70, "none"), (100, 1, "none")]

    async def test_a_missing_file_fails_before_connecting(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())
        missing = tmp_path / "missing.csv"
        params = sql_params(operation="load_table", table=str(missing), target_table="orders")

        with pytest.raises(ValueError, match=exact(f"Table file not found: {missing}")):
            await SQLClientPlugin().execute(sql_context(params, log))

        assert fake.connects == []

    async def test_a_missing_test_data_file_names_the_reference(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())
        folder = tmp_path / "testdata"
        folder.mkdir()
        params = sql_params(
            operation="load_table", table="testdata://missing.csv", target_table="orders"
        )

        with pytest.raises(ValueError, match=exact("Table file not found: testdata://missing.csv")):
            await SQLClientPlugin().execute(sql_context(params, log, testdata_dirs=[str(folder)]))

        assert fake.connects == []

    async def test_a_missing_test_data_file_follows_on_error(
        self, tmp_path: Path, use_fake: Any, log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())
        folder = tmp_path / "testdata"
        folder.mkdir()
        message = "Table file not found: testdata://missing.csv"
        params = sql_params(
            operation="load_table",
            table="testdata://missing.csv",
            target_table="orders",
            on_error="record",
        )

        out = await SQLClientPlugin().execute(sql_context(params, log, testdata_dirs=[str(folder)]))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        assert fake.connects == []

    def test_the_core_on_a_remote_host_reads_a_plain_csv_path(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        monkeypatch.setattr(_sql_core, "REMOTE_HOST", "sshd")
        path = orders_db(tmp_path)
        csv_file = write_csv(tmp_path / "orders.csv")

        out = outputs(_sql_core.run(load_params(path, str(csv_file)), log))

        assert (out["success"], out["rows_changed"]) == (True, 2)
        assert query(path) == [(4, 40, "none"), (5, None, "none"), (100, 1, "none")]

    @pytest.mark.parametrize(
        ("table", "message"),
        [
            pytest.param(
                "/data/orders.xlsx",
                "/data/orders.xlsx is an Excel file, which only WAVE can read: "
                "use a testdata:// or artifact:// file",
                id="excel",
            ),
            pytest.param(
                "testdata://orders.csv",
                "testdata:// paths are not available on the remote host - "
                "use an absolute or relative path on the remote host",
                id="testdata",
            ),
            pytest.param(
                "artifact://orders.csv",
                "artifact:// paths are not available on the remote host - "
                "use an absolute or relative path on the remote host",
                id="artifact",
            ),
        ],
    )
    def test_the_core_on_a_remote_host_refuses_what_only_wave_can_read(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        use_fake: Any,
        log: LogRecorder,
        table: str,
        message: str,
    ) -> None:
        monkeypatch.setattr(_sql_core, "REMOTE_HOST", "sshd")
        connection = FakeConnection([Result(columns=["id", "qty"])])
        use_fake("sqlite", connection)
        params = load_params(tmp_path / "f.db", table, on_error="record")

        out = outputs(_sql_core.run(params, log))

        assert (out["success"], out["error"], out["reason"]) == (False, message, "Validation")
        assert batches(connection) == []
