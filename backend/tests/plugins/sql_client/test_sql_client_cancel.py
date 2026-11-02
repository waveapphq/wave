"""Stop and Timeout cancel the running statement on the database (REQ-3.4.1.6, REQ-5.1.4, SQL-5)."""

import asyncio
import threading
from collections.abc import Callable
from typing import Any

import pytest

from tests.connectivity.sql.fakes import HANG_BOUND_S, FakeConnection, FakeDriverError, Result
from tests.plugins.sql_client.conftest import (
    FakeTimer,
    LogRecorder,
    exact,
    outputs,
    sql_context,
    sql_params,
)
from wavecore.plugins import _held_run, _process_group, _sql_core
from wavecore.plugins.sql_client import SQLClientPlugin

WAIT_S = 1.0
EMPTY_TABLE = {"__wave_type": "table", "columns": [], "rows": []}
LOAD_TABLE = {"__wave_type": "table", "columns": [{"name": "id", "type": "integer"}], "rows": [[1]]}
CONNECTED = ("INFO", "Connected to PostgreSQL 16.4 at db:5432")
# Per operation: the params that pick it, its console action and its recorded-failure empties.
OPERATIONS: dict[str, tuple[dict[str, Any], str, dict[str, Any]]] = {
    "run_sql": (
        {"sql": "SELECT pg_sleep(600)"},
        "Run SQL",
        {"rows": EMPTY_TABLE, "row_count": 0, "rows_changed": 0},
    ),
    "call_procedure": (
        {"operation": "call_procedure", "procedure": "app.slow"},
        "Call procedure",
        {"rows": EMPTY_TABLE, "row_count": 0, "out_values": EMPTY_TABLE},
    ),
    "load_table": (
        {"operation": "load_table", "table": LOAD_TABLE, "target_table": "orders"},
        "Load table",
        {"rows_changed": 0},
    ),
}


# A statement the database refuses, and a connect nothing answers.
FAILURES = [
    ([Result(error=FakeDriverError(0, "boom"))], None),
    ([], OSError("[Errno 111] Connection refused")),
]
FAILURE_IDS = ["statement", "connect"]


def timed_out(seconds: int) -> str:
    return f"Statement timed out after {seconds} seconds"


def hanging(**answer: Any) -> list[Result]:
    """A first statement that hangs until canceled, then fails as a canceled driver call does."""
    return [Result(hang=True, **({"error": FakeDriverError(0, "canceled")} | answer))]


class ClosingConnection(FakeConnection):
    """A scripted connection whose close is an event a test can wait on."""

    def __init__(self, script: list[Result] | None = None) -> None:
        super().__init__(script)
        self.closed_event = threading.Event()

    def close(self) -> None:
        super().close()
        self.closed_event.set()


class CancelWatch:
    """Wraps the fake dialect's cancel: per call its thread and whether the statement hung."""

    def __init__(self, fake: Any, connection: ClosingConnection, **behavior: Any) -> None:
        self.fake, self.connection = fake, connection
        self.cancel = fake.cancel
        self.error: Exception | None = behavior.get("error")
        self.wait_for_close: bool = behavior.get("wait_for_close", False)
        self.calls: list[tuple[int, bool]] = []
        fake.cancel = self

    def __call__(self, handle: Any) -> None:
        hung = self.connection.hanging.is_set() and not self.connection.gate.is_set()
        self.calls.append((threading.get_ident(), hung))
        self.cancel(handle)
        if self.wait_for_close:
            # A slow cancel: the canceled statement unwinds before the stop returns.
            self.connection.closed_event.wait(WAIT_S)
        if self.error is not None:
            raise self.error


def block_connect(fake: Any) -> tuple[threading.Event, threading.Event]:
    """Hold the fake dialect's connect until `proceed` is set; `connecting` marks its start."""
    connecting, proceed = threading.Event(), threading.Event()
    connect = fake.connect

    def held(rows: dict[str, Any], connect_timeout: int) -> Any:
        connecting.set()
        proceed.wait(HANG_BOUND_S)
        return connect(rows, connect_timeout)

    fake.connect = held
    return connecting, proceed


def start_block(params: dict[str, Any], log: LogRecorder) -> asyncio.Task[Any]:
    return asyncio.create_task(SQLClientPlugin().execute(sql_context(params, log)))


def start_core(params: dict[str, Any], log: LogRecorder) -> asyncio.Task[Any]:
    return asyncio.create_task(asyncio.to_thread(_sql_core.run, params, log))


async def waited(event: threading.Event) -> bool:
    return await asyncio.to_thread(event.wait, WAIT_S)


async def drain(turns: int = 3) -> None:
    """Give the loop enough turns to write whatever the verb thread scheduled on it."""
    for _ in range(turns):
        await asyncio.sleep(0)


class TestStopCancelsOnTheDatabase:
    """SQL-13, REQ-3.2.2.4: a stopped block cancels its running statement on the database."""

    async def test_stop_cancels_the_hanging_statement_once_on_the_loop_thread(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        connection = ClosingConnection(hanging())
        fake = use_fake("postgresql", connection)
        watch = CancelWatch(fake, connection)
        task = start_block(sql_params(sql="SELECT pg_sleep(600)"), log)
        assert await waited(connection.hanging)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert watch.calls == [(threading.get_ident(), True)]
        assert await waited(connection.closed_event)
        assert len(fake.cancels) == 1

    async def test_the_cancel_names_the_live_connection_of_the_run(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        connection = ClosingConnection(hanging())
        fake = use_fake("postgresql", connection)
        task = start_block(sql_params(sql="SELECT pg_sleep(600)", connect_timeout=12), log)
        assert await waited(connection.hanging)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        [handle] = fake.cancels
        assert handle.connection is connection
        assert handle.database_type == "postgresql"
        assert handle.connect_timeout == 12
        assert handle.rows == fake.connects[0][0]
        assert await waited(connection.closed_event)

    async def test_the_connection_is_closed_once_the_canceled_statement_unwinds(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        connection = ClosingConnection(hanging())
        use_fake("postgresql", connection)
        task = start_block(sql_params(sql="SELECT pg_sleep(600)"), log)
        assert await waited(connection.hanging)
        assert connection.closed is False

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert await waited(connection.closed_event)
        assert connection.closed is True

    @pytest.mark.parametrize("stop_on_error", [True, False], ids=["stop on error", "run on"])
    async def test_no_line_is_written_after_the_stop(
        self,
        stop_on_error: bool,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        """The canceled statement fails and the script goes on unwinding, all unheard."""
        connection = ClosingConnection([*hanging(), Result(columns=["n"], rows=[(1,)])])
        fake = use_fake("postgresql", connection)
        CancelWatch(fake, connection, wait_for_close=True)
        params = sql_params(sql="SELECT pg_sleep(600); SELECT 1", stop_on_error=stop_on_error)
        task = start_block(params, log)
        assert await waited(connection.hanging)
        before = list(log)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert await waited(connection.closed_event)
        await drain()

        assert CONNECTED in before
        assert log == before

    async def test_stop_while_connecting_calls_no_cancel_and_closes_the_late_connection(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        connection = ClosingConnection()
        fake = use_fake("postgresql", connection)
        connecting, proceed = block_connect(fake)
        task = start_block(sql_params(), log)
        assert await waited(connecting)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        proceed.set()

        assert await waited(connection.closed_event)
        assert fake.cancels == []

    @pytest.mark.parametrize("operation", list(OPERATIONS))
    async def test_a_connection_that_arrives_after_the_stop_is_closed_and_runs_nothing(
        self,
        operation: str,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        overrides, _action, _empties = OPERATIONS[operation]
        connection = ClosingConnection()
        fake = use_fake("postgresql", connection)
        connecting, proceed = block_connect(fake)
        task = start_block(sql_params(**overrides), log)
        assert await waited(connecting)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        proceed.set()

        assert await waited(connection.closed_event)
        assert connection.executed == []
        assert fake.cancels == []

    async def test_a_raising_cancel_still_ends_the_block_as_stopped(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        connection = ClosingConnection(hanging())
        fake = use_fake("postgresql", connection)
        watch = CancelWatch(fake, connection, error=OSError("[Errno 104] Connection reset"))
        task = start_block(sql_params(sql="SELECT pg_sleep(600)"), log)
        assert await waited(connection.hanging)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert watch.calls == [(threading.get_ident(), True)]
        assert await waited(connection.closed_event)


class TestTheRunningGroupsHoldTheCancel:
    """The core holds its cancel on the run's groups while it runs, and only then."""

    async def test_a_stop_of_the_running_groups_cancels_the_hanging_statement(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        connection = ClosingConnection(hanging())
        fake = use_fake("postgresql", connection)
        held = _process_group.HeldGroups()
        token = _process_group.RUNNING.set(held)
        try:
            task = start_core(sql_params(sql="SELECT pg_sleep(600)", on_error="record"), log)
        finally:
            _process_group.RUNNING.reset(token)
        assert await waited(connection.hanging)

        held.stop()
        await asyncio.wait_for(task, WAIT_S)

        assert [handle.connection for handle in fake.cancels] == [connection]
        assert connection.closed is True

    def test_after_the_block_ends_a_stop_cancels_nothing(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())
        held = _process_group.HeldGroups()
        token = _process_group.RUNNING.set(held)
        try:
            _sql_core.run(sql_params(), log)
        finally:
            _process_group.RUNNING.reset(token)

        held.stop()

        assert fake.cancels == []

    def test_a_block_run_outside_any_run_groups_still_finishes(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())

        result = outputs(_sql_core.run(sql_params(), log))

        assert result["success"] is True
        assert fake.cancels == []


class StoppingConnection(ClosingConnection):
    """Stops the run's groups while its send number `stop_at` runs, as a Stop mid-statement does."""

    def __init__(
        self, held: _process_group.HeldGroups, stop_at: int, script: list[Result] | None = None
    ) -> None:
        super().__init__(script)
        self.held, self.stop_at = held, stop_at

    def next_result(self) -> Result:
        if len(self.executed) == self.stop_at:
            self.held.stop()
        return super().next_result()


def run_under(held: _process_group.HeldGroups, params: dict[str, Any], log: LogRecorder) -> Any:
    """The core run in this thread with `held` as the run's groups."""
    token = _process_group.RUNNING.set(held)
    try:
        return _sql_core.run(params, log)
    finally:
        _process_group.RUNNING.reset(token)


TWO_ROWS = {**LOAD_TABLE, "rows": [[1], [2]]}


class TestAStopLeavesAtOnce:
    """SQL-13: a stopped run leaves past every broad handler and is never recorded as a failure."""

    @pytest.mark.parametrize("operation", list(OPERATIONS))
    def test_a_stop_before_the_connection_arrives_leaves_as_stopped(
        self,
        operation: str,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        overrides, _action, _empties = OPERATIONS[operation]
        held = _process_group.HeldGroups()
        connection = ClosingConnection()
        use_fake("postgresql", connection)
        held.stop()

        with pytest.raises(_held_run.Stopped):
            run_under(held, sql_params(on_error="record", **overrides), log)

        assert connection.executed == []
        assert connection.closed is True
        assert log == []

    def test_a_stop_during_a_statement_sends_no_later_one_and_records_nothing(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        held = _process_group.HeldGroups()
        connection = StoppingConnection(held, stop_at=1)
        use_fake("postgresql", connection)
        params = sql_params(sql="SELECT 1; SELECT 2", stop_on_error=False, on_error="record")

        with pytest.raises(_held_run.Stopped):
            run_under(held, params, log)

        assert connection.statements() == ["SELECT 1"]
        assert (log.at("WARN"), log.at("ERROR")) == ([], [])
        assert connection.closed is True

    def test_a_stop_between_committed_batches_neither_replays_nor_skips_the_next_batch(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        held = _process_group.HeldGroups()
        connection = StoppingConnection(held, stop_at=2, script=[Result(columns=["id"])])
        use_fake("postgresql", connection)
        params = sql_params(
            operation="load_table",
            table=TWO_ROWS,
            target_table="orders",
            batch_size=1,
            commit_each_batch=True,
            stop_on_error=False,
            on_error="record",
        )

        with pytest.raises(_held_run.Stopped):
            run_under(held, params, log)

        sent = [binds for kind, _statement, binds in connection.executed if kind == "executemany"]
        assert sent == [[(1,)]]
        assert (connection.commits, connection.rollbacks) == (1, 0)
        assert (log.at("WARN"), log.at("ERROR")) == ([], [])
        assert connection.closed is True


class TestTheDeadline:
    """SQL-8: Timeout bounds the whole block with one timer, armed from before the connect."""

    @pytest.mark.parametrize(
        ("overrides", "seconds"), [({}, 300), ({"timeout": 7}, 7)], ids=["default", "set"]
    )
    def test_the_timer_is_armed_with_the_timeout_seconds(
        self,
        overrides: dict[str, Any],
        seconds: int,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        use_fake("postgresql", FakeConnection())

        _sql_core.run(sql_params(**overrides), log)

        assert [timer.seconds for timer in deadline.made] == [seconds]

    @pytest.mark.parametrize("blank", ["", None], ids=["empty", "none"])
    def test_a_blank_timeout_arms_the_default(
        self,
        blank: Any,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        use_fake("postgresql", FakeConnection())

        _sql_core.run(sql_params(timeout=blank), log)

        assert [timer.seconds for timer in deadline.made] == [300]

    def test_the_timer_runs_as_a_daemon_from_before_the_connect_until_the_end(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())
        at_connect: list[tuple[bool, bool, bool]] = []
        connect = fake.connect

        def watched(rows: dict[str, Any], connect_timeout: int) -> Any:
            at_connect.extend((t.daemon, t.started, t.canceled) for t in deadline.made)
            return connect(rows, connect_timeout)

        fake.connect = watched

        _sql_core.run(sql_params(timeout=7), log)

        assert at_connect == [(True, True, False)]
        [timer] = deadline.made
        assert (timer.daemon, timer.started, timer.canceled) == (True, True, True)

    @pytest.mark.parametrize(("script", "fault"), FAILURES, ids=FAILURE_IDS)
    def test_the_timer_is_canceled_when_a_recorded_failure_ends_the_block(
        self,
        script: list[Result],
        fault: Exception | None,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        use_fake("postgresql", FakeConnection(script), connect_error=fault)

        result = outputs(_sql_core.run(sql_params(on_error="record"), log))

        assert result["success"] is False
        assert [(timer.started, timer.canceled) for timer in deadline.made] == [(True, True)]

    @pytest.mark.parametrize(("script", "fault"), FAILURES, ids=FAILURE_IDS)
    def test_the_timer_is_canceled_when_a_failure_fails_the_block(
        self,
        script: list[Result],
        fault: Exception | None,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        use_fake("postgresql", FakeConnection(script), connect_error=fault)

        with pytest.raises(ValueError):
            _sql_core.run(sql_params(), log)

        assert [(timer.started, timer.canceled) for timer in deadline.made] == [(True, True)]

    @pytest.mark.parametrize(
        "overrides",
        [{"sql": "SELECT :missing"}, {"unsupported": "sshd cannot run PostgreSQL"}],
        ids=["undefined placeholder", "unsupported host"],
    )
    def test_a_block_refused_before_connecting_arms_no_timer(
        self,
        overrides: dict[str, Any],
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        fake = use_fake("postgresql", FakeConnection())

        result = outputs(_sql_core.run(sql_params(on_error="record", **overrides), log))

        assert result["success"] is False
        assert deadline.made == []
        assert fake.connects == []


class TestTheDeadlineFires:
    """SQL-5: past Timeout the running statement is canceled on the database; reason Timeout."""

    @pytest.mark.parametrize("operation", list(OPERATIONS))
    @pytest.mark.parametrize("stop_on_error", [True, False], ids=["stop on error", "run on"])
    async def test_a_fire_during_a_hang_cancels_and_records_timeout(
        self,
        operation: str,
        stop_on_error: bool,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        overrides, action, empties = OPERATIONS[operation]
        connection = ClosingConnection(hanging())
        fake = use_fake("postgresql", connection)
        watch = CancelWatch(fake, connection)
        params = sql_params(timeout=7, on_error="record", stop_on_error=stop_on_error, **overrides)
        task = start_core(params, log)
        assert await waited(connection.hanging)

        deadline.made[0].fire()
        result = outputs(await asyncio.wait_for(task, WAIT_S))

        assert watch.calls == [(threading.get_ident(), True)]
        assert result == {
            **empties,
            "success": False,
            "error": timed_out(7),
            "reason": "Timeout",
            "__block_warning": True,
        }
        assert f"{action} failed (Timeout): {timed_out(7)}" in log.at("WARN")
        assert connection.closed is True

    @pytest.mark.parametrize(
        ("overrides", "seconds"), [({}, 300), ({"timeout": 7}, 7)], ids=["default", "set"]
    )
    async def test_a_fire_during_a_hang_fails_the_block_with_the_timeout_message(
        self,
        overrides: dict[str, Any],
        seconds: int,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        connection = ClosingConnection(hanging())
        fake = use_fake("postgresql", connection)
        task = start_core(sql_params(sql="SELECT pg_sleep(600)", **overrides), log)
        assert await waited(connection.hanging)

        deadline.made[0].fire()
        with pytest.raises(ValueError, match=exact(timed_out(seconds))):
            await asyncio.wait_for(task, WAIT_S)

        assert len(fake.cancels) == 1
        assert connection.closed is True

    async def test_a_fire_before_the_connect_returns_ends_in_timeout_without_a_cancel(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        connection = ClosingConnection()
        fake = use_fake("postgresql", connection)
        connecting, proceed = block_connect(fake)
        task = start_core(sql_params(timeout=7, on_error="record"), log)
        assert await waited(connecting)

        deadline.made[0].fire()
        proceed.set()
        result = outputs(await asyncio.wait_for(task, WAIT_S))

        assert fake.cancels == []
        assert (result["success"], result["error"], result["reason"]) == (
            False,
            timed_out(7),
            "Timeout",
        )
        assert connection.closed is True

    @pytest.mark.parametrize("operation", list(OPERATIONS))
    async def test_a_connection_that_arrives_after_the_fire_is_closed_and_runs_nothing(
        self,
        operation: str,
        use_fake: Callable[..., Any],
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        overrides, action, empties = OPERATIONS[operation]
        connection = ClosingConnection()
        fake = use_fake("postgresql", connection)
        connecting, proceed = block_connect(fake)
        task = start_core(sql_params(timeout=7, on_error="record", **overrides), log)
        assert await waited(connecting)

        deadline.made[0].fire()
        proceed.set()
        result = outputs(await asyncio.wait_for(task, WAIT_S))

        assert result == {
            **empties,
            "success": False,
            "error": timed_out(7),
            "reason": "Timeout",
            "__block_warning": True,
        }
        assert f"{action} failed (Timeout): {timed_out(7)}" in log.at("WARN")
        assert connection.executed == []
        assert connection.closed is True
        assert fake.cancels == []

    async def test_a_statement_the_driver_finished_after_the_fire_is_still_a_timeout(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        connection = ClosingConnection(hanging(error=None, columns=["n"], rows=[(1,)]))
        fake = use_fake("postgresql", connection)
        task = start_core(sql_params(timeout=7, on_error="record"), log)
        assert await waited(connection.hanging)

        deadline.made[0].fire()
        result = outputs(await asyncio.wait_for(task, WAIT_S))

        assert len(fake.cancels) == 1
        assert (result["success"], result["error"], result["reason"]) == (
            False,
            timed_out(7),
            "Timeout",
        )
        assert result["rows"] == EMPTY_TABLE

    async def test_a_raising_cancel_never_replaces_the_timeout(
        self, use_fake: Callable[..., Any], deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        connection = ClosingConnection(hanging())
        fake = use_fake("postgresql", connection)
        watch = CancelWatch(fake, connection, error=OSError("[Errno 104] Connection reset"))
        task = start_core(sql_params(timeout=7, on_error="record"), log)
        assert await waited(connection.hanging)

        deadline.made[0].fire()
        result = outputs(await asyncio.wait_for(task, WAIT_S))

        assert len(watch.calls) == 1
        assert (result["success"], result["error"], result["reason"]) == (
            False,
            timed_out(7),
            "Timeout",
        )
        assert connection.closed is True
