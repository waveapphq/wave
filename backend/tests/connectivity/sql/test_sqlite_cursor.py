"""The connection and cursor the SQLite dialect hands the SQL core (REQ-3.4.1.19, REQ-3.4.1.6)."""

import gc
import re
import sys
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import apsw
import pytest

from wavecore.connectivity.sql._errors import SqlFailure
from wavecore.connectivity.sql.dialects import sqlite

_WRAPPER = "wavecore.connectivity.sql._sqlite_cursor"
_ORDERS = "CREATE TABLE orders (id INTEGER PRIMARY KEY, name TEXT)"
_THREE_ORDERS = "INSERT INTO orders VALUES (1, 'a'), (2, 'b'), (3, 'c')"
_INSERT = "INSERT INTO orders VALUES (?, ?)"
_IDS = "SELECT id FROM orders ORDER BY id"
_NO_ROWS = "SELECT * FROM orders WHERE 1 = 0"
# Long enough to outlast the interrupt, short enough to end by itself if none lands.
_LONG = (
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 50000000) "
    "SELECT count(*) FROM c"
)
_GIVE_UP_S = 30.0


def _rows(file: Path, **driver_options: Any) -> dict[str, Any]:
    """Connection rows as the core hands them to connect() for a SQLite block."""
    return {
        "host": "",
        "port": None,
        "database": "",
        "username": "",
        "password": None,
        "file": str(file),
        "file_read_only": False,
        "tls": False,
        "verify_ssl": True,
        "ca_cert": None,
        "client_cert": None,
        "client_key": None,
        "driver_options": driver_options,
        "server_name": "",
    }


def _open(file: Path, **driver_options: Any) -> Any:
    """Connect through the dialect; a connection that is not the wrapper's is closed and refused."""
    connection = sqlite.connect(_rows(file, **driver_options), 1)
    module = type(connection).__module__
    if module != _WRAPPER:
        connection.close()
    assert module == _WRAPPER
    return connection


def _run(connection: Any, *statements: str) -> None:
    cursor = connection.cursor()
    for statement in statements:
        cursor.execute(statement)


def _query(connection: Any, statement: str) -> list[tuple[Any, ...]]:
    cursor = connection.cursor()
    cursor.execute(statement)
    return list(cursor.fetchall())


def _capped(connection: Any, statement: str, max_rows: int) -> list[tuple[Any, ...]]:
    """The first rows of a result whose cursor is dropped with rows unread, as Max rows does."""
    cursor = connection.cursor()
    cursor.execute(statement)
    return list(cursor.fetchmany(max_rows))


def _stored(file: Path, statement: str) -> list[tuple[Any, ...]]:
    """What a second connection reads from the file."""
    connection = _open(file)
    try:
        return _query(connection, statement)
    finally:
        connection.close()


def _names(cursor: Any) -> list[str]:
    return [column[0] for column in cursor.description]


@pytest.fixture
def file(tmp_path: Path) -> Path:
    return tmp_path / "orders.db"


@pytest.fixture
def connect(file: Path) -> Iterator[Callable[..., Any]]:
    """Open the dialect's connection on the test's file; closed at teardown."""
    opened: list[Any] = []

    def open_file(**driver_options: Any) -> Any:
        opened.append(_open(file, **driver_options))
        return opened[-1]

    yield open_file
    for connection in opened:
        connection.close()


@pytest.fixture
def seeded(connect: Callable[..., Any]) -> Callable[[], Any]:
    """Open a connection on a file holding the orders table and its three rows."""

    def open_seeded() -> Any:
        connection = connect()
        _run(connection, _ORDERS, _THREE_ORDERS)
        return connection

    return open_seeded


@pytest.fixture
def reference_counts_only() -> Iterator[None]:
    """Only reference counts free objects while the test runs."""
    enabled = gc.isenabled()
    gc.disable()
    yield
    if enabled:
        gc.enable()


class TestWrapperModule:
    """connect() hands out the wrapper's connection, which hands out the wrapper's cursor."""

    def test_the_connection_and_its_cursor_come_from_the_wrapper_module(
        self, connect: Callable[..., Any]
    ) -> None:
        connection = connect()

        assert (type(connection).__module__, type(connection.cursor()).__module__) == (
            _WRAPPER,
            _WRAPPER,
        )


class TestDescription:
    """Column names are captured as the statement starts and stand until the next execute."""

    def test_a_select_names_its_columns_in_seven_item_tuples(
        self, seeded: Callable[[], Any]
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute("SELECT id, name FROM orders")

        assert _names(cursor) == ["id", "name"]
        assert [len(column) for column in cursor.description] == [7, 7]

    def test_a_select_without_rows_names_its_columns_too(self, seeded: Callable[[], Any]) -> None:
        cursor = seeded().cursor()

        cursor.execute(_NO_ROWS)

        assert _names(cursor) == ["id", "name"]
        assert [len(column) for column in cursor.description] == [7, 7]
        assert cursor.fetchall() == []

    def test_the_columns_stay_readable_after_the_rows_are_read(
        self, seeded: Callable[[], Any]
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute("SELECT id, name FROM orders")
        cursor.fetchall()

        assert _names(cursor) == ["id", "name"]

    @pytest.mark.parametrize(
        "statement",
        [
            pytest.param("CREATE TABLE notes (body TEXT)", id="ddl"),
            pytest.param("UPDATE orders SET name = 'z'", id="update"),
            pytest.param("INSERT INTO orders VALUES (4, 'd')", id="insert"),
            pytest.param("DELETE FROM orders WHERE id = 1", id="delete"),
        ],
    )
    def test_a_statement_without_columns_has_no_description(
        self, seeded: Callable[[], Any], statement: str
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute(statement)

        assert cursor.description is None

    def test_description_is_reset_on_every_execute(self, seeded: Callable[[], Any]) -> None:
        cursor = seeded().cursor()
        seen: list[list[str] | None] = []

        for statement in (
            "SELECT id, name FROM orders",
            "UPDATE orders SET name = 'z'",
            "SELECT name AS label FROM orders WHERE 1 = 0",
        ):
            cursor.execute(statement)
            seen.append(None if cursor.description is None else _names(cursor))

        assert seen == [["id", "name"], None, ["label"]]

    def test_a_returning_statement_names_its_columns_and_gives_its_rows(
        self, seeded: Callable[[], Any]
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute("INSERT INTO orders VALUES (4, 'd') RETURNING id, name")

        assert _names(cursor) == ["id", "name"]
        assert cursor.fetchall() == [(4, "d")]

    def test_the_columns_are_named_with_the_helper_module_unloadable(
        self, seeded: Callable[[], Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # apsw.ext loads dozens of standard-library modules a remote host has no use for.
        monkeypatch.setitem(sys.modules, "apsw.ext", None)
        monkeypatch.delattr(apsw, "ext", raising=False)
        cursor = seeded().cursor()

        cursor.execute(_NO_ROWS)

        assert _names(cursor) == ["id", "name"]


class TestRowcount:
    """rowcount is the rows the statement just run changed, and -1 when it changed none."""

    def test_begin_one_insert_and_rollback_count_0_1_0_rows_changed(
        self, connect: Callable[..., Any]
    ) -> None:
        connection = connect()
        _run(connection, _ORDERS)
        changed: list[int] = []

        for statement in ("BEGIN", "INSERT INTO orders VALUES (1, 'a')", "ROLLBACK"):
            cursor = connection.cursor()
            cursor.execute(statement)
            changed.append(max(cursor.rowcount, 0))

        assert changed == [0, 1, 0]

    def test_each_statement_reports_the_rows_it_changed(self, seeded: Callable[[], Any]) -> None:
        cursor = seeded().cursor()
        counts: list[int] = []

        for statement in (
            "INSERT INTO orders VALUES (4, 'd'), (5, 'e')",
            "UPDATE orders SET name = 'z' WHERE id > 2",
            "DELETE FROM orders WHERE id = 1",
            "DELETE FROM orders",
        ):
            cursor.execute(statement)
            counts.append(cursor.rowcount)

        assert counts == [2, 3, 1, 4]

    @pytest.mark.parametrize(
        "statement",
        [
            pytest.param("CREATE TABLE notes (body TEXT)", id="ddl"),
            pytest.param(_IDS, id="select"),
            pytest.param("UPDATE orders SET name = 'z' WHERE id = 999", id="update-of-no-row"),
            pytest.param("BEGIN", id="begin"),
        ],
    )
    def test_a_statement_that_changes_no_row_reports_minus_one_after_one_that_did(
        self, seeded: Callable[[], Any], statement: str
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute(statement)

        assert cursor.rowcount == -1

    def test_rows_a_trigger_writes_are_not_counted(self, connect: Callable[..., Any]) -> None:
        connection = connect()
        _run(
            connection,
            _ORDERS,
            "CREATE TABLE audit (order_id INTEGER)",
            "CREATE TRIGGER orders_audit AFTER INSERT ON orders BEGIN "
            "INSERT INTO audit VALUES (NEW.id), (NEW.id); END",
        )
        cursor = connection.cursor()

        cursor.execute("INSERT INTO orders VALUES (1, 'a')")

        assert cursor.rowcount == 1
        assert _query(connection, "SELECT count(*) FROM audit") == [(2,)]

    def test_an_insert_behind_a_with_clause_reports_its_real_count(
        self, connect: Callable[..., Any]
    ) -> None:
        connection = connect()
        _run(connection, _ORDERS)
        cursor = connection.cursor()

        cursor.execute(
            "WITH fresh(id, name) AS (VALUES (1, 'a'), (2, 'b')) "
            "INSERT INTO orders SELECT id, name FROM fresh"
        )

        assert cursor.rowcount == 2

    @pytest.mark.parametrize(
        "statement",
        [
            pytest.param("CREATE VIRTUAL TABLE docs USING fts5(body)", id="fts5"),
            pytest.param("CREATE VIRTUAL TABLE boxes USING rtree(id, minx, maxx)", id="rtree"),
            pytest.param("CREATE VIRTUAL TABLE shapes USING geopoly(label)", id="geopoly"),
            pytest.param(
                "-- search\n/* index */ CREATE VIRTUAL TABLE docs USING fts5(body)",
                id="behind-comments",
            ),
        ],
    )
    def test_creating_a_virtual_table_reports_no_count_after_a_statement_that_changed_rows(
        self, seeded: Callable[[], Any], statement: str
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute(statement)

        assert cursor.rowcount == -1

    def test_rows_written_to_a_virtual_table_are_counted(self, connect: Callable[..., Any]) -> None:
        connection = connect()
        _run(connection, "CREATE VIRTUAL TABLE docs USING fts5(body)")
        cursor = connection.cursor()

        cursor.execute("INSERT INTO docs (body) VALUES ('first'), ('second')")

        assert cursor.rowcount == 2

    @pytest.mark.parametrize(
        ("statement", "count"),
        [
            pytest.param("insert into orders values (4, 'd'), (5, 'e')", 2, id="lower-case"),
            pytest.param("\n\t  INSERT INTO orders VALUES (4, 'd')", 1, id="behind-spaces"),
            pytest.param("-- new\nINSERT INTO orders VALUES (4, 'd')", 1, id="line-comment"),
            pytest.param("/* new */ UPDATE orders SET name = 'z'", 3, id="block-comment"),
            pytest.param("/* a */ -- b\n /* c */ DELETE FROM orders", 3, id="several-comments"),
            pytest.param("REPLACE INTO orders VALUES (1, 'z'), (9, 'n')", 2, id="replace"),
            pytest.param(
                "WITH old(id) AS (SELECT 1) UPDATE orders SET name = 'z' WHERE id IN old",
                1,
                id="with-update",
            ),
            pytest.param(
                "with old(id) as (select 1) delete from orders where id not in old",
                2,
                id="with-delete",
            ),
        ],
    )
    def test_a_statement_that_changes_rows_reports_its_count_however_it_is_written(
        self, seeded: Callable[[], Any], statement: str, count: int
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute(statement)

        assert cursor.rowcount == count

    def test_the_last_statement_of_one_execute_decides_the_count(
        self, seeded: Callable[[], Any]
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute(
            "INSERT INTO orders VALUES (4, 'd'); CREATE VIRTUAL TABLE docs USING fts5(body)"
        )

        assert cursor.rowcount == -1


class TestFetch:
    """fetchmany(n) gives up to n rows and fetchall() the rest; there is no nextset."""

    def test_fetchmany_gives_up_to_n_rows_and_fetchall_the_rest(
        self, seeded: Callable[[], Any]
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute(_IDS)
        first = list(cursor.fetchmany(2))
        rest = cursor.fetchall()

        assert (first, rest) == ([(1,), (2,)], [(3,)])

    def test_fetchmany_past_the_end_gives_what_is_left_and_then_nothing(
        self, seeded: Callable[[], Any]
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute(_IDS)
        left = list(cursor.fetchmany(10))
        nothing = (list(cursor.fetchmany(10)), cursor.fetchall())

        assert left == [(1,), (2,), (3,)]
        assert nothing == ([], [])

    @pytest.mark.parametrize(
        "statement",
        [
            pytest.param("CREATE TABLE notes (body TEXT)", id="ddl"),
            pytest.param("UPDATE orders SET name = 'z'", id="update"),
        ],
    )
    def test_fetchall_after_a_statement_without_rows_is_an_empty_list(
        self, seeded: Callable[[], Any], statement: str
    ) -> None:
        cursor = seeded().cursor()

        cursor.execute(statement)

        assert cursor.fetchall() == []

    def test_a_cursor_has_no_nextset(self, seeded: Callable[[], Any]) -> None:
        cursor = seeded().cursor()

        cursor.execute(_IDS)

        assert not hasattr(cursor, "nextset")

    def test_a_capped_read_frees_the_table_once_its_cursor_is_dropped(
        self, seeded: Callable[[], Any], reference_counts_only: None
    ) -> None:
        connection = seeded()

        capped = _capped(connection, _IDS, 2)
        _run(connection, "DROP TABLE orders")

        assert capped == [(1,), (2,)]
        assert _query(connection, "SELECT name FROM sqlite_schema") == []


class TestExecutemany:
    """One statement over a batch of rows, as Load table sends them."""

    def test_executemany_sends_every_row_of_the_batch(self, connect: Callable[..., Any]) -> None:
        connection = connect()
        _run(connection, _ORDERS)
        cursor = connection.cursor()

        cursor.executemany(_INSERT, [(1, "a"), (2, "b"), (3, "c")])
        cursor.executemany(_INSERT, [(4, "d")])

        assert _query(connection, "SELECT id, name FROM orders ORDER BY id") == [
            (1, "a"),
            (2, "b"),
            (3, "c"),
            (4, "d"),
        ]

    def test_a_refused_row_raises_the_constraint_error_with_the_database_text(
        self, seeded: Callable[[], Any]
    ) -> None:
        cursor = seeded().cursor()

        with pytest.raises(apsw.ConstraintError, match=r"^UNIQUE constraint failed: orders\.id$"):
            cursor.executemany(_INSERT, [(3, "again")])


class TestTransactions:
    """Autocommit off: one transaction opens before the first statement and ends on commit."""

    def test_a_statement_commits_on_its_own_with_autocommit_on(
        self, seeded: Callable[[], Any], file: Path
    ) -> None:
        connection = seeded()
        sqlite.autocommit(connection, True)

        _run(connection, "INSERT INTO orders VALUES (4, 'd')")

        assert _stored(file, _IDS) == [(1,), (2,), (3,), (4,)]

    def test_autocommit_off_opens_a_transaction_before_the_first_statement(
        self, seeded: Callable[[], Any], file: Path
    ) -> None:
        connection = seeded()
        sqlite.autocommit(connection, False)

        _run(connection, "INSERT INTO orders VALUES (4, 'd')")
        held = _stored(file, _IDS)
        connection.commit()

        assert (held, _stored(file, _IDS)) == ([(1,), (2,), (3,)], [(1,), (2,), (3,), (4,)])

    def test_a_read_a_delete_and_a_batch_commit_together(
        self, seeded: Callable[[], Any], file: Path
    ) -> None:
        connection = seeded()
        sqlite.autocommit(connection, False)
        cursor = connection.cursor()

        cursor.execute(_NO_ROWS)
        cursor.execute("DELETE FROM orders")
        cursor.executemany(_INSERT, [(7, "g"), (8, "h")])
        held = _stored(file, _IDS)
        connection.commit()

        assert (held, _stored(file, _IDS)) == ([(1,), (2,), (3,)], [(7,), (8,)])

    @pytest.mark.parametrize("on", [True, False], ids=["autocommit-on", "autocommit-off"])
    def test_commit_and_rollback_are_harmless_with_no_transaction_open(
        self, seeded: Callable[[], Any], file: Path, on: bool
    ) -> None:
        connection = seeded()
        sqlite.autocommit(connection, on)

        connection.commit()
        connection.rollback()
        connection.rollback()

        assert _stored(file, _IDS) == [(1,), (2,), (3,)]

    def test_a_load_that_only_read_commits_without_error(
        self, seeded: Callable[[], Any], file: Path
    ) -> None:
        connection = seeded()
        sqlite.autocommit(connection, False)

        _run(connection, _NO_ROWS)
        connection.commit()

        assert _stored(file, _IDS) == [(1,), (2,), (3,)]

    def test_the_statement_after_a_commit_opens_a_new_transaction(
        self, seeded: Callable[[], Any], file: Path
    ) -> None:
        connection = seeded()
        sqlite.autocommit(connection, False)

        _run(connection, "INSERT INTO orders VALUES (4, 'd')")
        connection.commit()
        _run(connection, "INSERT INTO orders VALUES (5, 'e')")
        held = _stored(file, _IDS)
        connection.rollback()

        assert held == _stored(file, _IDS) == [(1,), (2,), (3,), (4,)]

    def test_the_statement_after_a_rollback_opens_a_new_transaction(
        self, seeded: Callable[[], Any], file: Path
    ) -> None:
        connection = seeded()
        sqlite.autocommit(connection, False)

        _run(connection, "INSERT INTO orders VALUES (4, 'd')")
        connection.rollback()
        _run(connection, "INSERT INTO orders VALUES (5, 'e')")
        held = _stored(file, _IDS)
        connection.commit()

        assert (held, _stored(file, _IDS)) == ([(1,), (2,), (3,)], [(1,), (2,), (3,), (5,)])

    def test_a_failed_batch_rolls_back_with_the_batch_before_it(
        self, seeded: Callable[[], Any], file: Path
    ) -> None:
        connection = seeded()
        sqlite.autocommit(connection, False)
        cursor = connection.cursor()

        cursor.executemany(_INSERT, [(4, "d"), (5, "e")])
        with pytest.raises(apsw.ConstraintError, match=r"^UNIQUE constraint failed: orders\.id$"):
            cursor.executemany(_INSERT, [(6, "f"), (1, "again")])
        connection.rollback()
        connection.rollback()

        assert _stored(file, _IDS) == [(1,), (2,), (3,)]

    def test_a_write_after_a_read_waits_for_another_writer_to_finish(
        self, seeded: Callable[[], Any], connect: Callable[..., Any], file: Path
    ) -> None:
        other = seeded()
        sqlite.autocommit(other, False)
        _run(other, "INSERT INTO orders VALUES (9, 'i')")
        loader = connect(timeout=5)
        sqlite.autocommit(loader, False)
        release = threading.Timer(0.03, other.commit)

        release.start()
        try:
            _run(loader, _NO_ROWS)
            loader.cursor().executemany(_INSERT, [(4, "d")])
            loader.commit()
        finally:
            loader.rollback()
            release.join()

        assert _stored(file, _IDS) == [(1,), (2,), (3,), (4,), (9,)]

    def test_close_rolls_back_an_open_transaction(self, file: Path) -> None:
        connection = _open(file)
        _run(connection, _ORDERS)
        sqlite.autocommit(connection, False)
        _run(connection, "INSERT INTO orders VALUES (1, 'a')")

        connection.close()

        assert _stored(file, _IDS) == []


class TestInterrupt:
    """interrupt() ends the statement another thread is running; the connection stays usable."""

    def test_interrupt_with_nothing_running_leaves_the_next_statement_alone(
        self, connect: Callable[..., Any]
    ) -> None:
        connection = connect()

        connection.interrupt()

        assert _query(connection, "SELECT 41 + 1") == [(42,)]

    def test_interrupt_from_another_thread_ends_the_running_statement(
        self, connect: Callable[..., Any]
    ) -> None:
        connection = connect()
        failures: list[BaseException] = []

        def run() -> None:
            try:
                _query(connection, _LONG)
            except apsw.Error as error:
                failures.append(error)

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        deadline = time.monotonic() + _GIVE_UP_S
        # An interrupt sent before the statement starts is dropped, so it is sent until it lands.
        while worker.is_alive() and time.monotonic() < deadline:
            connection.interrupt()
            worker.join(0.005)

        assert [(type(error), str(error)) for error in failures] == [
            (apsw.InterruptError, "interrupted")
        ]
        assert _query(connection, "SELECT 41 + 1") == [(42,)]


class TestBinds:
    """None, bool, int, float, str and bytes bind as they are, by position or by name."""

    @pytest.mark.parametrize(
        ("value", "stored", "kind"),
        [
            pytest.param(None, None, "null", id="none"),
            pytest.param(True, 1, "integer", id="true"),
            pytest.param(False, 0, "integer", id="false"),
            pytest.param(7, 7, "integer", id="int"),
            pytest.param(1.5, 1.5, "real", id="float"),
            pytest.param("Grüße 測試", "Grüße 測試", "text", id="str"),
            pytest.param(b"\x00\xff", b"\x00\xff", "blob", id="bytes"),
        ],
    )
    def test_each_accepted_bind_type_round_trips(
        self, connect: Callable[..., Any], value: Any, stored: Any, kind: str
    ) -> None:
        connection = connect()
        _run(connection, "CREATE TABLE b (v)")
        cursor = connection.cursor()

        cursor.execute("INSERT INTO b VALUES (?)", (value,))
        cursor.execute("SELECT v, typeof(v) FROM b")
        [(read, read_kind)] = cursor.fetchall()

        assert (type(read), read, read_kind) == (type(stored), stored, kind)

    def test_the_largest_whole_number_binds_and_one_more_overflows(
        self, connect: Callable[..., Any]
    ) -> None:
        cursor = connect().cursor()

        cursor.execute("SELECT ?", (2**63 - 1,))
        largest = cursor.fetchall()
        with pytest.raises(OverflowError, match=r"^int too big to convert$"):
            cursor.execute("SELECT ?", (2**63,))

        assert largest == [(2**63 - 1,)]

    @pytest.mark.parametrize(
        ("statement", "binds"),
        [
            pytest.param("SELECT 3 + 4", None, id="none"),
            pytest.param("SELECT ? + ?", (3, 4), id="tuple"),
            pytest.param("SELECT ? + ?", [3, 4], id="list"),
            pytest.param("SELECT :a + :b", {"a": 3, "b": 4}, id="by-name"),
        ],
    )
    def test_the_dialect_statement_call_fits_the_cursor(
        self, connect: Callable[..., Any], statement: str, binds: Any
    ) -> None:
        cursor = connect().cursor()

        sqlite.execute(cursor, statement, binds)

        assert cursor.fetchall() == [(7,)]

    def test_execute_takes_none_for_no_binds(self, connect: Callable[..., Any]) -> None:
        cursor = connect().cursor()

        cursor.execute("SELECT 3 + 4", None)

        assert cursor.fetchall() == [(7,)]


class TestMarkerWithNoValue:
    """A marker the binds hold no value for fails with a sentence, not with its bare name."""

    @pytest.mark.parametrize(
        ("statement", "binds", "name"),
        [
            pytest.param("SELECT @x AS x, :y AS y", {"y": 1}, "x", id="at-sign"),
            pytest.param("SELECT $x AS x, :y AS y", {"y": 1}, "x", id="dollar"),
            pytest.param("SELECT :y AS y, :z AS z", {"y": 1}, "z", id="colon"),
            pytest.param("SELECT :a$b AS x, :y AS y", {"a": 2, "y": 1}, "a$b", id="dollar-in-name"),
        ],
    )
    def test_a_named_marker_fails_naming_the_form_to_write(
        self, connect: Callable[..., Any], statement: str, binds: dict[str, Any], name: str
    ) -> None:
        cursor = connect().cursor()
        text = f"Placeholder {name} has no value: write :{name} and add {name} to Parameters"
        message = f"^{re.escape(text)}$"

        with pytest.raises(SqlFailure, match=message) as refused:
            cursor.execute(statement, binds)

        assert refused.value.reason == "Validation"

    @pytest.mark.parametrize(
        "statement",
        ["SELECT ?1 AS x, :y AS y", "SELECT :1 AS x, :y AS y"],
        ids=["question-mark", "colon"],
    )
    def test_a_numbered_marker_fails_naming_its_number(
        self, connect: Callable[..., Any], statement: str
    ) -> None:
        cursor = connect().cursor()
        message = r"^Numbered placeholder 1 has no value: write :name and add name to Parameters$"

        with pytest.raises(SqlFailure, match=message) as refused:
            cursor.execute(statement, {"y": 1})

        assert refused.value.reason == "Validation"

    def test_a_marker_without_a_name_fails_saying_so(self, connect: Callable[..., Any]) -> None:
        cursor = connect().cursor()
        message = r"^A \? placeholder has no value: write :name and add name to Parameters$"

        with pytest.raises(SqlFailure, match=message) as refused:
            cursor.execute("SELECT ? AS x, :y AS y", {"y": 1})

        assert refused.value.reason == "Validation"

    def test_the_connection_runs_the_next_statement_after_the_failure(
        self, connect: Callable[..., Any]
    ) -> None:
        connection = connect()
        cursor = connection.cursor()

        with pytest.raises(SqlFailure):
            cursor.execute("SELECT @x AS x, :y AS y", {"y": 1})

        assert _query(connection, "SELECT 41 + 1") == [(42,)]

    def test_a_statement_with_markers_and_no_binds_keeps_the_text_of_the_build(
        self, connect: Callable[..., Any]
    ) -> None:
        cursor = connect().cursor()

        with pytest.raises(apsw.BindingsError):
            cursor.execute("SELECT @x AS x")

    def test_a_value_the_build_cannot_bind_keeps_the_text_of_the_build(
        self, connect: Callable[..., Any]
    ) -> None:
        cursor = connect().cursor()

        with pytest.raises(TypeError):
            cursor.execute("SELECT :y AS y", {"y": [1, 2]})
