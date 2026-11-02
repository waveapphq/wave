"""Stop gives every in-flight Block a terminal state (REQ-3.2.2.4).

A user Stop cancels the run task, and cancellation is a BaseException the
block error handlers never see. Every Block the run was standing on - the
top-level one, the ones inside a Parallel lane, the ones inside a loop body,
and the one the debugger is parked on - has to be settled as ``stopped``
before the terminal callback captures the snapshot that history, the export
and the run report all read back.
"""

import asyncio
import contextlib
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    delay_node,
    edge,
    engine_registries,
    for_each_node,
    function_node,
    local_definition,
    log_node,
    parallel_node,
    start_graph,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

pytestmark = pytest.mark.usefixtures("engine_registries")


class _StopRun:
    """What a stopped run left behind, live and as persisted."""

    def __init__(self, session: dict[str, Any], snapshot: dict[str, Any], status: str) -> None:
        self.live: dict[str, str] = dict(session["block_states"])
        self.verdict: str = str(session["status"])
        self.snapshot: dict[str, str] = dict(snapshot.get("block_states") or {})
        self.snapshot_status = status


async def _wait_until_running(session: dict[str, Any], node_ids: list[str]) -> None:
    """Poll until every listed node reads running, or the budget runs out."""
    for _ in range(500):
        await asyncio.sleep(0.01)
        states = session["block_states"]
        if all(states.get(nid) == "running" for nid in node_ids):
            return
    raise AssertionError(f"nodes never reached running: {dict(session['block_states'])}")


async def _stop_after(
    session_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    variables: dict[str, Any],
    running: list[str],
    *,
    breakpoint_node: str | None = None,
) -> _StopRun:
    """Run a graph, Stop it once ``running`` is in flight, capture both records."""
    breakpoints = {breakpoint_node} if breakpoint_node else None
    session, task = start_graph(session_id, nodes, edges, variables, breakpoints=breakpoints)
    _wb_common._active_tasks[session_id] = task
    seen: dict[str, Any] = {}

    def capture(sid: str, status: str, halt_scope: Any = None) -> None:
        if sid == session_id and "snapshot" not in seen:
            seen["snapshot"] = _wb_common.get_session_snapshot(sid) or {}
            seen["status"] = status

    _wb_common.register_terminal_callback(capture)
    try:
        if breakpoint_node is not None:
            for _ in range(500):
                await asyncio.sleep(0.01)
                if session.get("paused_node_id") == breakpoint_node:
                    break
        else:
            await _wait_until_running(session, running)
        workbench_service.stop_workbench_run(session_id=session_id)
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)
    finally:
        _wb_common.unregister_terminal_callback(capture)
        _wb_common._active_tasks.pop(session_id, None)
    return _StopRun(session, seen.get("snapshot", {}), str(seen.get("status")))


def _mark_sources(session_id: str) -> list[Any]:
    """The Source of every stopped mark the session's log holds."""
    from wavecore.api.services import log_streaming_service

    return [
        entry.get("source")
        for entry in log_streaming_service.get_logs(session_id)
        if isinstance(entry, dict) and entry.get("message") == "Stopped by user"
    ]


def _section_graph() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Two slow lanes and one lane that finishes before the Stop lands."""
    nodes = [
        parallel_node("par-1", [branch("branch_1"), branch("branch_2"), branch("branch_3")]),
        delay_node("br-a", 5000, "Lane A"),
        delay_node("br-b", 5000, "Lane B"),
        log_node("br-c", "Lane C", "'C-DONE'"),
        log_node("after", "After", "'AFTER'"),
    ]
    edges = [
        edge("start-node", "par-1"),
        edge("par-1", "br-a", "branch_1"),
        edge("par-1", "br-b", "branch_2"),
        edge("par-1", "br-c", "branch_3"),
        edge("par-1", "after", "then"),
    ]
    return nodes, edges


def _loop_graph() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """A loop whose body block is still in flight when the Stop lands."""
    nodes = [
        for_each_node("fe-1", ["a", "b", "c"]),
        delay_node("body-1", 5000, "Body"),
        log_node("after-loop", "After Loop", "'AFTER'"),
    ]
    edges = [
        edge("start-node", "fe-1"),
        edge("fe-1", "body-1", "body"),
        edge("fe-1", "after-loop", "then"),
    ]
    return nodes, edges


class TestStopSettlesEveryInFlightBlock:
    """No Block anywhere keeps a running state once the run is stopped."""

    async def test_no_block_reads_running_after_a_stop(self) -> None:
        nodes, edges = _section_graph()
        run = await _stop_after("stop-settle-1", nodes, edges, {}, ["par-1", "br-a", "br-b"])
        assert "running" not in run.live.values(), run.live

    async def test_an_in_flight_branch_block_reads_stopped(self) -> None:
        nodes, edges = _section_graph()
        run = await _stop_after("stop-settle-2", nodes, edges, {}, ["par-1", "br-a", "br-b"])
        assert run.live["br-a"] == "stopped", run.live
        assert run.live["br-b"] == "stopped", run.live
        assert run.live["par-1"] == "stopped", run.live

    async def test_a_block_that_already_finished_keeps_its_own_result(self) -> None:
        nodes, edges = _section_graph()
        run = await _stop_after("stop-settle-3", nodes, edges, {}, ["par-1", "br-a", "br-b"])
        assert run.live["br-c"] == "passed", run.live

    async def test_a_block_inside_a_loop_body_reads_stopped(self) -> None:
        nodes, edges = _loop_graph()
        run = await _stop_after(
            "stop-settle-4", nodes, edges, {"fe_item": None, "fe_idx": None}, ["fe-1", "body-1"]
        )
        assert run.live["body-1"] == "stopped", run.live
        assert run.live["fe-1"] == "stopped", run.live

    async def test_the_parked_block_reads_stopped_when_stopping_from_paused(self) -> None:
        nodes = [
            log_node("node-a", "A", "'a'"),
            log_node("node-b", "B", "'b'"),
        ]
        edges = [
            edge("start-node", "node-a"),
            edge("node-a", "node-b"),
        ]
        run = await _stop_after("stop-settle-5", nodes, edges, {}, [], breakpoint_node="node-b")
        assert run.live["node-a"] == "passed", run.live
        assert run.live["node-b"] == "stopped", run.live
        assert run.snapshot["node-b"] == "stopped", run.snapshot


class TestTheStoredRecordMatchesTheLiveOne:
    """The snapshot the terminal callback captures carries the settled states.

    ``_terminate_session`` notifies right after ``task.cancel()``, so a repair
    that lives only in the cancellation handler lands after the snapshot was
    already persisted.
    """

    async def test_the_persisted_snapshot_carries_the_settled_branch_states(self) -> None:
        nodes, edges = _section_graph()
        run = await _stop_after("stop-store-1", nodes, edges, {}, ["par-1", "br-a", "br-b"])
        assert run.snapshot["br-a"] == "stopped", run.snapshot
        assert run.snapshot["br-b"] == "stopped", run.snapshot
        assert run.snapshot["par-1"] == "stopped", run.snapshot

    async def test_the_persisted_snapshot_equals_the_live_one(self) -> None:
        nodes, edges = _section_graph()
        run = await _stop_after("stop-store-2", nodes, edges, {}, ["par-1", "br-a", "br-b"])
        assert run.snapshot == run.live, (run.snapshot, run.live)

    async def test_the_persisted_snapshot_carries_the_loop_body_state(self) -> None:
        nodes, edges = _loop_graph()
        run = await _stop_after(
            "stop-store-3", nodes, edges, {"fe_item": None, "fe_idx": None}, ["fe-1", "body-1"]
        )
        assert run.snapshot["body-1"] == "stopped", run.snapshot
        assert run.snapshot == run.live, (run.snapshot, run.live)


class TestTheStoppedVerdictIsUnchanged:
    """Settling the Blocks does not move the run's own verdict."""

    async def test_the_run_and_the_terminal_notification_both_read_stopped(self) -> None:
        nodes, edges = _section_graph()
        run = await _stop_after("stop-verdict-1", nodes, edges, {}, ["par-1", "br-a", "br-b"])
        assert run.verdict == "stopped", run.verdict
        assert run.snapshot_status == "stopped", run.snapshot_status


class TestTheRunLogNamesEachSettledBlock:
    """Every settled Block gets its own line, attributed to that Block."""

    async def test_each_in_flight_block_is_named_in_the_run_log(self) -> None:
        from wavecore.api.services import log_streaming_service

        nodes, edges = _section_graph()
        await _stop_after("stop-log-1", nodes, edges, {}, ["par-1", "br-a", "br-b"])
        settled = {
            entry.get("blockId")
            for entry in log_streaming_service.get_logs("stop-log-1")
            if isinstance(entry, dict) and entry.get("message") == "Stopped by user"
        }
        assert {"par-1", "br-a", "br-b"} <= settled, settled
        assert "br-c" not in settled, settled


class TestTheStoppedMarkCarriesTheBlocksSource:
    """The line that marks a Block stopped is the Block's own line (EXEC-25)."""

    async def test_each_mark_names_its_block_by_type_and_name(self) -> None:
        from wavecore.api.services import log_streaming_service

        nodes, edges = _section_graph()
        await _stop_after("stop-source-1", nodes, edges, {}, ["par-1", "br-a", "br-b"])
        marks = {
            entry.get("blockId"): entry.get("source")
            for entry in log_streaming_service.get_logs("stop-source-1")
            if isinstance(entry, dict) and entry.get("message") == "Stopped by user"
        }
        assert marks == {
            "par-1": "Parallel",
            "br-a": "Delay : Lane A",
            "br-b": "Delay : Lane B",
        }, marks

    async def test_a_named_block_shows_its_type_then_its_name(self) -> None:
        from wavecore.api.services import log_streaming_service

        nodes, edges = _section_graph()
        nodes[1]["data"]["label"] = "Wait for the queue"
        nodes[1]["data"]["description"] = "Gives the queue time to drain before the checks"
        await _stop_after("stop-source-2", nodes, edges, {}, ["par-1", "br-a", "br-b"])
        marks = {
            entry.get("blockId"): entry.get("source")
            for entry in log_streaming_service.get_logs("stop-source-2")
            if isinstance(entry, dict) and entry.get("message") == "Stopped by user"
        }
        assert marks["br-a"] == "Delay : Wait for the queue", marks

    async def test_a_loop_and_its_body_block_each_carry_their_own_source(self) -> None:
        from wavecore.api.services import log_streaming_service

        nodes, edges = _loop_graph()
        await _stop_after(
            "stop-source-3", nodes, edges, {"fe_item": None, "fe_idx": None}, ["fe-1", "body-1"]
        )
        marks = {
            entry.get("blockId"): entry.get("source")
            for entry in log_streaming_service.get_logs("stop-source-3")
            if isinstance(entry, dict) and entry.get("message") == "Stopped by user"
        }
        assert marks == {"fe-1": "For Each : ForEach", "body-1": "Delay : Body"}, marks

    async def test_a_block_inside_a_function_body_carries_its_own_source(self) -> None:
        from wavecore.api.services import log_streaming_service

        inner = delay_node("inner-1", 5000, "Wait for the login")
        definition = local_definition("Login flow", [inner], [edge("start-node", "inner-1")])
        nodes = [function_node("fn-1", definition)]
        await _stop_after(
            "stop-source-4", nodes, [edge("start-node", "fn-1")], {}, ["fn-1", "inner-1"]
        )
        marks = {
            entry.get("blockId"): entry.get("source")
            for entry in log_streaming_service.get_logs("stop-source-4")
            if isinstance(entry, dict) and entry.get("message") == "Stopped by user"
        }
        assert marks == {"fn-1": "Function : fn-1", "inner-1": "Delay : Wait for the login"}, marks

    async def test_a_block_two_functions_deep_carries_its_own_source(self) -> None:
        from wavecore.api.services import log_streaming_service

        inner = delay_node("deep-1", 5000, "Deep")
        inner_function = function_node(
            "fn-inner", local_definition("Inner flow", [inner], [edge("start-node", "deep-1")])
        )
        outer = local_definition("Outer flow", [inner_function], [edge("start-node", "fn-inner")])
        nodes = [function_node("fn-outer", outer)]
        await _stop_after(
            "stop-source-5",
            nodes,
            [edge("start-node", "fn-outer")],
            {},
            ["fn-outer", "fn-inner", "deep-1"],
        )
        marks = {
            entry.get("blockId"): entry.get("source")
            for entry in log_streaming_service.get_logs("stop-source-5")
            if isinstance(entry, dict) and entry.get("message") == "Stopped by user"
        }
        assert marks == {
            "fn-outer": "Function : fn-outer",
            "fn-inner": "Function : fn-inner",
            "deep-1": "Delay : Deep",
        }, marks


class TestABackendShutdownSettlesTheSameBlocks:
    """A wholesale task cancel is not a user Stop but leaves nothing running."""

    async def test_a_canceled_run_settles_its_in_flight_blocks(self) -> None:
        from wavecore.api.services import log_streaming_service

        session_id = "stop-shutdown-1"
        nodes, edges = _section_graph()
        session, task = start_graph(session_id, nodes, edges, {})
        await _wait_until_running(session, ["par-1", "br-a", "br-b"])
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)

        assert "running" not in session["block_states"].values(), session["block_states"]
        assert session["block_states"]["br-a"] == "stopped", session["block_states"]
        messages = {
            entry.get("message")
            for entry in log_streaming_service.get_logs(session_id)
            if isinstance(entry, dict)
        }
        assert "Stopped by backend shutdown" in messages, messages
        assert "Stopped by user" not in messages, messages


class TestTheSettleHelperOnItsOwn:
    """Direct contract of the shared settle helper."""

    def test_a_missing_session_settles_nothing(self) -> None:
        assert _wb_common._settle_interrupted_blocks(None, "no-such-session", "Stopped") == []

    def test_stopping_a_session_that_never_ran_settles_nothing(self) -> None:
        _wb_common._workbench_sessions.pop("stop-unknown", None)
        result = _wb_common._terminate_session("stop-unknown")
        assert result == {"session_id": "stop-unknown", "status": "stopped"}

    def test_a_second_settle_is_a_no_op(self) -> None:
        session_id = "settle-twice"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "block_states": {"n1": "running", "n2": "passed"},
            "current_block": {"block_id": "n1", "block_name": "N1"},
            "_node_map": {"n1": {"data": {"label": "N1"}}},
        }
        first = _wb_common._settle_interrupted_blocks(
            _wb_common._workbench_sessions[session_id], session_id, "Stopped by user"
        )
        second = _wb_common._settle_interrupted_blocks(
            _wb_common._workbench_sessions[session_id], session_id, "Stopped by user"
        )
        assert first == [("n1", "N1")], first
        assert second == [], second
        states = _wb_common._workbench_sessions[session_id]["block_states"]
        assert states == {"n1": "stopped", "n2": "passed"}, states

    def test_a_current_block_with_no_recorded_state_is_settled(self) -> None:
        session_id = "settle-current"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "block_states": {},
            "current_block": {"block_id": "n1", "block_name": "N1"},
        }
        assert _wb_common._settle_interrupted_blocks(
            _wb_common._workbench_sessions[session_id], session_id, "Stopped by user"
        ) == [("n1", "n1")]

    def test_the_mark_of_a_function_block_names_the_function(self) -> None:
        session_id = "settle-function"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "block_states": {"fn-1": "running"},
            "current_block": {"block_id": "fn-1", "block_name": "Login flow"},
            "_node_map": {"fn-1": function_node("fn-1", local_definition("Login flow", [], []))},
        }
        _wb_common._settle_interrupted_blocks(
            _wb_common._workbench_sessions[session_id], session_id, "Stopped by user"
        )
        assert _mark_sources(session_id) == ["Function : fn-1"]

    def test_the_mark_of_a_block_with_a_name_and_no_type_shows_the_name(self) -> None:
        session_id = "settle-typeless"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "block_states": {"n1": "running"},
            "current_block": {"block_id": "n1", "block_name": "N1"},
            "_node_map": {"n1": {"data": {"label": "N1"}}},
        }
        _wb_common._settle_interrupted_blocks(
            _wb_common._workbench_sessions[session_id], session_id, "Stopped by user"
        )
        assert _mark_sources(session_id) == ["N1"]

    def test_the_mark_of_a_block_outside_the_node_map_keeps_its_id(self) -> None:
        session_id = "settle-unmapped"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "block_states": {"body-7": "running"},
            "current_block": {"block_id": "body-7", "block_name": "Inner"},
            "_node_map": {},
        }
        _wb_common._settle_interrupted_blocks(
            _wb_common._workbench_sessions[session_id], session_id, "Stopped by user"
        )
        assert _mark_sources(session_id) == ["body-7"]

    def test_a_canvas_block_wins_over_a_function_body_block_with_its_id(self) -> None:
        session_id = "settle-shared-id"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "block_states": {"n1": "running"},
            "current_block": {"block_id": "n1", "block_name": "Canvas wait"},
            "_node_map": {"n1": delay_node("n1", 10)},
            "_body_nodes": {"n1": log_node("n1", "Body line", "'x'")},
        }
        _wb_common._settle_interrupted_blocks(
            _wb_common._workbench_sessions[session_id], session_id, "Stopped by user"
        )
        assert _mark_sources(session_id) == ["Delay"]

    def test_a_session_that_never_started_a_block_settles_nothing(self) -> None:
        session_id = "settle-idle"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "block_states": {},
            "current_block": None,
        }
        assert (
            _wb_common._settle_interrupted_blocks(
                _wb_common._workbench_sessions[session_id], session_id, "Stopped by user"
            )
            == []
        )
