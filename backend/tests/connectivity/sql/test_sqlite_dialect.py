"""The SQLite dialect on WAVE's bundled SQLite build (REQ-3.4.1.19, REQ-3.4.1.6)."""

import importlib
import re
import sys
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import apsw
import pytest

from tests.connectivity.sql.fakes import sqlite_file
from tests.core.remote_exec._vendorability import import_sites
from wavecore.connectivity.sql._errors import UNREACHABLE, VALIDATION, SqlFailure, map_error
from wavecore.connectivity.sql.dialects import Handle, sqlite

_BOUND_S = 1.0
_WRAPPER = "wavecore.connectivity.sql._sqlite_cursor"
_RUNAWAY = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c"
_UNKNOWN_OPTIONS = [
    ("isolation_level", "DEFERRED"),
    ("check_same_thread", False),
    ("uri", True),
    ("detect_types", 1),
]


def _rows(file: Path, *, read_only: bool = False, **driver_options: Any) -> dict[str, Any]:
    """Connection rows as the core hands them to connect() for a SQLite block."""
    return {
        "host": "",
        "port": None,
        "database": "",
        "username": "",
        "password": None,
        "file": str(file),
        "file_read_only": read_only,
        "tls": False,
        "verify_ssl": True,
        "ca_cert": None,
        "client_cert": None,
        "client_key": None,
        "driver_options": driver_options,
        "server_name": "",
    }


def _connect_context(file: Path) -> dict[str, Any]:
    """The context the core hands the error mapping when a SQLite connect fails."""
    return {
        "phase": "connect",
        "host": "",
        "port": None,
        "username": "",
        "dsn": None,
        "file": str(file),
    }


def _open(rows: dict[str, Any], connect_timeout: int = 1) -> Any:
    """Connect through the dialect; a connection that is not the wrapper's is closed and refused."""
    connection = sqlite.connect(rows, connect_timeout)
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


def _stored(file: Path, statement: str) -> list[tuple[Any, ...]]:
    """What a second connection reads from the file."""
    connection = _open(_rows(file))
    try:
        return _query(connection, statement)
    finally:
        connection.close()


@pytest.fixture
def connect() -> Iterator[Callable[..., Any]]:
    """Open the dialect's connection for the given rows; closed at teardown."""
    opened: list[Any] = []

    def open_rows(rows: dict[str, Any], connect_timeout: int = 1) -> Any:
        opened.append(_open(rows, connect_timeout))
        return opened[-1]

    yield open_rows
    for connection in opened:
        connection.close()


@pytest.fixture
def bundled(monkeypatch: pytest.MonkeyPatch) -> list[apsw.Connection]:
    """Every connection the bundled build opens, in the order it opened them."""
    opened: list[apsw.Connection] = []

    class Recorded(apsw.Connection):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            opened.append(self)

    monkeypatch.setattr(apsw, "Connection", Recorded)
    return opened


class TestOpenModes:
    """Read-write creates the file; read-only is a flag on the plain path and never creates."""

    def test_connect_opens_the_file_once_with_the_bundled_build(
        self, tmp_path: Path, connect: Callable[..., Any], bundled: list[apsw.Connection]
    ) -> None:
        path = tmp_path / "orders.db"

        connect(_rows(path), 7)

        assert [Path(raw.filename) for raw in bundled] == [path.resolve()]

    def test_a_missing_file_is_created_read_write(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        path = tmp_path / "new.db"

        connection = connect(_rows(path))
        _run(connection, "CREATE TABLE t (x INTEGER)", "INSERT INTO t VALUES (1)")

        assert path.exists()
        assert _stored(path, "SELECT x FROM t") == [(1,)]

    def test_a_read_only_file_opens_on_its_plain_path(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        folder = tmp_path / "test data #1 50%"
        folder.mkdir()
        path = sqlite_file(
            folder / "orders.db", "CREATE TABLE t (x INTEGER)", "INSERT INTO t VALUES (1)"
        )

        connection = connect(_rows(path, read_only=True))

        assert _query(connection, "SELECT x FROM t") == [(1,)]
        assert [entry.name for entry in folder.iterdir()] == ["orders.db"]

    def test_a_read_only_file_reads_and_refuses_writes(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        path = sqlite_file(
            tmp_path / "orders.db", "CREATE TABLE t (x INTEGER)", "INSERT INTO t VALUES (1)"
        )

        connection = connect(_rows(path, read_only=True))
        rows = _query(connection, "SELECT x FROM t")
        with pytest.raises(apsw.ReadOnlyError, match=r"^attempt to write a readonly database$"):
            _run(connection, "INSERT INTO t VALUES (2)")

        assert rows == [(1,)]

    def test_a_missing_read_only_file_cannot_be_opened(self, tmp_path: Path) -> None:
        path = tmp_path / "missing.db"

        with pytest.raises(apsw.CantOpenError, match=r"^unable to open database file$"):
            sqlite.connect(_rows(path, read_only=True), 1)

        assert not path.exists()

    def test_a_file_in_a_missing_folder_cannot_be_opened(self, tmp_path: Path) -> None:
        folder = tmp_path / "missing"

        with pytest.raises(apsw.CantOpenError, match=r"^unable to open database file$"):
            sqlite.connect(_rows(folder / "orders.db"), 1)

        assert not folder.exists()

    @pytest.mark.parametrize(
        ("name", "read_only"),
        [
            pytest.param("missing.db", True, id="read-only-missing-file"),
            pytest.param("missing/orders.db", False, id="read-write-missing-folder"),
        ],
    )
    def test_a_file_that_cannot_be_opened_reads_as_unreachable(
        self, tmp_path: Path, name: str, read_only: bool
    ) -> None:
        path = tmp_path / name

        with pytest.raises(apsw.Error) as raised:
            sqlite.connect(_rows(path, read_only=read_only), 1)

        assert map_error("sqlite", raised.value, _connect_context(path)) == (
            f"Could not open the SQLite file {path}: unable to open database file",
            UNREACHABLE,
        )


class TestAutocommit:
    """Each statement commits on its own until autocommit is turned off."""

    def test_a_new_connection_commits_each_statement_on_its_own(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        path = tmp_path / "orders.db"

        connection = connect(_rows(path))
        _run(connection, "CREATE TABLE t (x INTEGER)", "INSERT INTO t VALUES (1)")

        assert _stored(path, "SELECT x FROM t") == [(1,)]

    def test_autocommit_off_holds_statements_until_commit_and_on_releases_them(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        path = sqlite_file(tmp_path / "orders.db", "CREATE TABLE t (x INTEGER)")
        connection = connect(_rows(path))

        sqlite.autocommit(connection, False)
        _run(connection, "INSERT INTO t VALUES (1)")
        held = _stored(path, "SELECT x FROM t")
        connection.commit()
        sqlite.autocommit(connection, True)
        _run(connection, "INSERT INTO t VALUES (2)")
        released = _stored(path, "SELECT x FROM t ORDER BY x")

        assert (held, released) == ([], [(1,), (2,)])


class TestBusyTimeout:
    """The wait on a locked file is the timeout option in seconds, else the connect timeout."""

    @pytest.mark.parametrize(
        ("seconds", "milliseconds"),
        [
            pytest.param(7, 7000, id="whole"),
            pytest.param(2.5, 2500, id="decimal"),
            pytest.param(0, 0, id="zero"),
            pytest.param(1.2346, 1235, id="rounded"),
        ],
    )
    def test_the_timeout_option_is_the_wait_on_a_locked_file(
        self, tmp_path: Path, connect: Callable[..., Any], seconds: float, milliseconds: int
    ) -> None:
        connection = connect(_rows(tmp_path / "t.db", timeout=seconds), 3)

        assert _query(connection, "PRAGMA busy_timeout") == [(milliseconds,)]

    def test_the_connect_timeout_is_the_wait_without_the_option(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        connection = connect(_rows(tmp_path / "t.db"), 7)

        assert _query(connection, "PRAGMA busy_timeout") == [(7000,)]

    def test_the_timeout_option_reaches_a_read_only_file_too(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        path = sqlite_file(tmp_path / "orders.db", "CREATE TABLE t (x INTEGER)")

        connection = connect(_rows(path, read_only=True, timeout=3), 7)

        assert _query(connection, "PRAGMA busy_timeout") == [(3000,)]


class TestStatementCache:
    """cached_statements sizes the bundled build's statement cache."""

    @pytest.mark.parametrize("size", [16, 0])
    def test_cached_statements_sizes_the_statement_cache(
        self,
        tmp_path: Path,
        connect: Callable[..., Any],
        bundled: list[apsw.Connection],
        size: int,
    ) -> None:
        connection = connect(_rows(tmp_path / "t.db", cached_statements=size))

        assert [raw.cache_stats()["size"] for raw in bundled] == [size]
        assert _query(connection, "SELECT 41 + 1") == [(42,)]

    def test_both_options_apply_together(
        self, tmp_path: Path, connect: Callable[..., Any], bundled: list[apsw.Connection]
    ) -> None:
        connection = connect(_rows(tmp_path / "t.db", timeout=2, cached_statements=16), 7)

        assert _query(connection, "PRAGMA busy_timeout") == [(2000,)]
        assert [raw.cache_stats()["size"] for raw in bundled] == [16]


class TestRefusedOptions:
    """Any other option name, and a bad value of the two, is refused before the file is opened."""

    @pytest.mark.parametrize(
        ("name", "value"), _UNKNOWN_OPTIONS, ids=[name for name, _value in _UNKNOWN_OPTIONS]
    )
    def test_an_unknown_option_is_refused_and_no_file_is_created(
        self, tmp_path: Path, name: str, value: Any
    ) -> None:
        path = tmp_path / "orders.db"

        with pytest.raises(
            SqlFailure,
            match=rf"^SQLite Driver option '{name}' is not supported: "
            r"SQLite takes timeout and cached_statements$",
        ) as raised:
            sqlite.connect(_rows(path, **{name: value}), 1).close()

        assert raised.value.reason == VALIDATION
        assert not path.exists()

    def test_an_unknown_option_is_refused_beside_the_two_known_ones(self, tmp_path: Path) -> None:
        path = tmp_path / "orders.db"

        with pytest.raises(
            SqlFailure,
            match=r"^SQLite Driver option 'uri' is not supported: "
            r"SQLite takes timeout and cached_statements$",
        ) as raised:
            sqlite.connect(_rows(path, timeout=2, cached_statements=16, uri=True), 1).close()

        assert raised.value.reason == VALIDATION
        assert not path.exists()

    @pytest.mark.parametrize(
        ("options", "shown"),
        [
            pytest.param({"uri": True, "detect_types": 1}, "uri", id="one-order"),
            pytest.param({"detect_types": 1, "uri": True}, "detect_types", id="other-order"),
            pytest.param(
                {"timeout": 2, "uri": True, "detect_types": 1}, "uri", id="after-a-known-option"
            ),
        ],
    )
    def test_the_first_unknown_option_as_written_is_the_one_named(
        self, tmp_path: Path, options: dict[str, Any], shown: str
    ) -> None:
        path = tmp_path / "orders.db"

        with pytest.raises(
            SqlFailure,
            match=rf"^SQLite Driver option '{shown}' is not supported: "
            r"SQLite takes timeout and cached_statements$",
        ) as raised:
            sqlite.connect(_rows(path, **options), 1).close()

        assert raised.value.reason == VALIDATION
        assert not path.exists()

    @pytest.mark.parametrize(
        ("value", "shown"),
        [
            pytest.param("soon", "soon", id="text"),
            pytest.param(-1, "-1", id="negative"),
            pytest.param("7", "7", id="number-as-text"),
            pytest.param(float("nan"), "nan", id="not-a-number"),
            pytest.param(float("inf"), "inf", id="infinite"),
            pytest.param(True, "True", id="boolean"),
        ],
    )
    def test_a_timeout_that_is_not_a_number_of_seconds_is_refused(
        self, tmp_path: Path, value: Any, shown: str
    ) -> None:
        path = tmp_path / "orders.db"

        with pytest.raises(
            SqlFailure,
            match=r"^SQLite Driver option timeout must be a number of seconds, "
            rf"got '{re.escape(shown)}'$",
        ) as raised:
            sqlite.connect(_rows(path, timeout=value), 1).close()

        assert raised.value.reason == VALIDATION
        assert not path.exists()

    @pytest.mark.parametrize(
        ("value", "shown"),
        [
            pytest.param(1.5, "1.5", id="decimal"),
            pytest.param("many", "many", id="text"),
            pytest.param(16.0, "16.0", id="whole-decimal"),
            pytest.param("7", "7", id="number-as-text"),
            pytest.param(True, "True", id="boolean"),
            pytest.param(-1, "-1", id="negative"),
        ],
    )
    def test_a_cached_statements_that_is_not_a_whole_number_is_refused(
        self, tmp_path: Path, value: Any, shown: str
    ) -> None:
        path = tmp_path / "orders.db"

        with pytest.raises(
            SqlFailure,
            match=r"^SQLite Driver option cached_statements must be a whole number, "
            rf"got '{re.escape(shown)}'$",
        ) as raised:
            sqlite.connect(_rows(path, cached_statements=value), 1).close()

        assert raised.value.reason == VALIDATION
        assert not path.exists()


class TestServerVersion:
    """The version reported is the bundled library's, the one that runs the statements."""

    def test_server_version_is_the_bundled_library_version(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        connection = connect(_rows(tmp_path / "t.db"))

        assert sqlite.server_version(connection) == apsw.sqlitelibversion()

    def test_server_version_is_the_version_the_statements_run_on(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        connection = connect(_rows(tmp_path / "t.db"))

        version = sqlite.server_version(connection)

        assert _query(connection, "SELECT sqlite_version()") == [(version,)]


class TestCancel:
    """The cancel is interrupt(), sent from another thread while the statement runs."""

    def test_cancel_interrupts_a_running_query(
        self, tmp_path: Path, connect: Callable[..., Any], bundled: list[apsw.Connection]
    ) -> None:
        rows = _rows(tmp_path / "t.db")
        connection = connect(rows)
        started = threading.Event()
        gave_up: list[bool] = []
        failures: list[BaseException] = []
        give_up_at = time.monotonic() + 2 * _BOUND_S

        def progress() -> bool:
            started.set()
            if time.monotonic() > give_up_at:
                gave_up.append(True)
                return True
            return False

        def run() -> None:
            try:
                _query(connection, _RUNAWAY)
            except apsw.Error as error:
                failures.append(error)

        [raw] = bundled
        raw.set_progress_handler(progress, 1000)
        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        try:
            assert started.wait(_BOUND_S)

            sqlite.cancel(Handle("sqlite", rows, 1, connection))
            worker.join(_BOUND_S)
        finally:
            worker.join(2 * _BOUND_S)

        assert [(type(error), str(error)) for error in failures] == [
            (apsw.InterruptError, "interrupted")
        ]
        assert gave_up == []
        assert _query(connection, "SELECT 41 + 1") == [(42,)]

    def test_a_connection_opened_in_one_thread_runs_statements_in_another(
        self, tmp_path: Path, connect: Callable[..., Any]
    ) -> None:
        connection = connect(_rows(tmp_path / "t.db"))
        seen: list[list[tuple[Any, ...]]] = []

        worker = threading.Thread(
            target=lambda: seen.append(_query(connection, "SELECT 41 + 1")), daemon=True
        )
        worker.start()
        worker.join(_BOUND_S)

        assert seen == [[(42,)]]


class TestNoStandardLibraryModule:
    """The dialect and its wrapper never load the sqlite3 module of the machine's Python."""

    @pytest.mark.parametrize("module", [sqlite.__name__, _WRAPPER])
    def test_the_module_does_not_import_sqlite3(self, module: str) -> None:
        path = Path(str(importlib.import_module(module).__file__))

        assert "sqlite3" not in {site.root for site in import_sites(module, path)}

    def test_the_dialect_runs_with_sqlite3_unloadable(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, connect: Callable[..., Any]
    ) -> None:
        monkeypatch.setitem(sys.modules, "sqlite3", None)
        rows = _rows(tmp_path / "orders.db")

        connection = connect(rows)
        sqlite.autocommit(connection, False)
        _run(connection, "CREATE TABLE t (x INTEGER)", "INSERT INTO t VALUES (1)")
        connection.commit()
        sqlite.cancel(Handle("sqlite", rows, 1, connection))

        assert _query(connection, "SELECT x FROM t") == [(1,)]
        assert sqlite.server_version(connection) == apsw.sqlitelibversion()
