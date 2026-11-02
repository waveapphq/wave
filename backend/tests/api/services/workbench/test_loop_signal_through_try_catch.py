"""A Break or Continue leaves a Try/Catch like `break` leaves `try ... finally` (REQ-3.5.1.2/3).

The path it is issued in stops, the catch path does not run, every finally path it crosses runs
once innermost first (REQ-3.2.2.10), then the target loop acts; a failing finally path wins.
"""

import asyncio
import contextlib
import uuid
from dataclasses import dataclass
from typing import Any, cast
from unittest.mock import patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    delay_node,
    edge,
    engine_registries,
    for_each_node,
    halt_node,
    log_messages,
    log_node,
    loop_signal_node,
    make_node,
    parallel_node,
    run_graph,
    setter_node,
    start_graph,
    try_catch_node,
)
from tests.api.services.workbench.slot_harness import (
    FALSE,
    LOOP_OUTPUTS,
    TRUE,
    Edges,
    Graph,
    Nodes,
    case,
    for_node,
    if_else_node,
    in_slot,
    switch_node,
    while_node,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench import try_catch as _try_catch
from wavecore.api.services.workbench.nested import dispatch_nested_signals
from wavecore.api.services.workbench.signals import _extract_engine_signals
from wavecore.core.plugin_registry import register_plugin

pytestmark = pytest.mark.usefixtures("engine_registries")

LOOP_KINDS = ["for", "for-each", "while"]
SIGNALS = ["break", "continue"]
TARGETS = ["nearest", "outer"]
TARGET_ID = {"nearest": "lp", "outer": "olp"}


@dataclass
class Flow:
    """Nodes and edges entered at ``entry`` and left from ``exit_id`` through ``exit_handle``."""

    nodes: Nodes
    edges: Edges
    entry: str
    exit_id: str
    exit_handle: str | None = "then"


def _mark(node_id: str) -> dict[str, Any]:
    """A Log writing its id in upper case."""
    return log_node(node_id, node_id, f"'{node_id.upper()}'")


def _loop(kind: str, node_id: str, counter: str) -> dict[str, Any]:
    if kind == "for":
        return for_node(node_id, 2, index_var=f"{node_id}_i")
    if kind == "for-each":
        return for_each_node(node_id, [1, 2])
    return while_node(node_id, f"{counter} < 2", index_var=f"{node_id}_i")


def _in_loop(kind: str, loop_id: str, prefix: str, inner: Flow, counts: dict[str, str]) -> Flow:
    """loop[<prefix>head (+ While counter), inner, <prefix>tail] then <loop_id>-then."""
    head, tail = f"{prefix}head", f"{prefix}tail"
    nodes = [_loop(kind, loop_id, next(iter(counts))), _mark(head), *inner.nodes, _mark(tail)]
    edges = [
        edge(loop_id, head, "body"),
        *inner.edges,
        edge(inner.exit_id, tail, inner.exit_handle),
    ]
    first = inner.entry
    if kind == "while":
        tick = f"{prefix}tick"
        nodes.append(setter_node(tick, tick, counts, expressions=True))
        edges.append(edge(tick, first))
        first = tick
    edges.append(edge(head, first))
    then = f"{loop_id}-then"
    nodes.append(_mark(then))
    edges.append(edge(loop_id, then, "then"))
    return Flow(nodes, edges, loop_id, then, None)


def _looped(kind: str, target: str, sub: Flow) -> Flow:
    """The sub-flow in loop ``lp``; for the outer target ``lp`` sits in loop ``olp``."""
    nearest = _in_loop(kind, "lp", "", sub, {"lc": "lc + 1"})
    if target == "nearest":
        return nearest
    return _in_loop(kind, "olp", "outer-", nearest, {"oc": "oc + 1", "lc": "0"})


def _signal(signal: str, target: str) -> dict[str, Any]:
    return loop_signal_node("sig", signal, TARGET_ID[target])


def _try_shape(signal: str, target: str) -> Flow:
    nodes = [
        try_catch_node("tc", enable_finally=True),
        _signal(signal, target),
        _mark("past-sig"),
        _mark("catch"),
        _mark("fin"),
    ]
    edges = [
        edge("tc", "sig", "try"),
        edge("sig", "past-sig"),
        edge("tc", "catch", "catch"),
        edge("tc", "fin", "finally"),
    ]
    return Flow(nodes, edges, "tc", "tc")


def _catch_shape(signal: str, target: str) -> Flow:
    nodes = [
        try_catch_node("tc", enable_finally=True),
        log_node("boom", "boom", "1/0"),
        _signal(signal, target),
        _mark("past-sig"),
        _mark("fin"),
    ]
    edges = [
        edge("tc", "boom", "try"),
        edge("tc", "sig", "catch"),
        edge("sig", "past-sig"),
        edge("tc", "fin", "finally"),
    ]
    return Flow(nodes, edges, "tc", "tc")


def _finally_shape(signal: str, target: str) -> Flow:
    nodes = [
        try_catch_node("tc", enable_finally=True),
        _mark("tried"),
        _mark("catch"),
        _mark("fin"),
        _signal(signal, target),
        _mark("past-sig"),
    ]
    edges = [
        edge("tc", "tried", "try"),
        edge("tc", "catch", "catch"),
        edge("tc", "fin", "finally"),
        edge("fin", "sig"),
        edge("sig", "past-sig"),
    ]
    return Flow(nodes, edges, "tc", "tc")


def _if_else_shape(signal: str, target: str) -> Flow:
    nodes = [
        try_catch_node("tc", enable_finally=True),
        _mark("pre"),
        if_else_node("br"),
        _signal(signal, target),
        _mark("past-sig"),
        _mark("else"),
        _mark("catch"),
        _mark("fin"),
    ]
    edges = [
        edge("tc", "pre", "try"),
        edge("pre", "br"),
        edge("br", "sig", "branch_0"),
        edge("br", "else", "branch_1"),
        edge("sig", "past-sig"),
        edge("tc", "catch", "catch"),
        edge("tc", "fin", "finally"),
    ]
    return Flow(nodes, edges, "tc", "tc")


def _switch_shape(signal: str, target: str) -> Flow:
    branches = [case("case_hit", TRUE), case("case_miss", FALSE)]
    nodes = [
        try_catch_node("tc", enable_finally=True),
        switch_node("br", branches),
        _signal(signal, target),
        _mark("past-sig"),
        _mark("else"),
        _mark("catch"),
        _mark("fin"),
    ]
    edges = [
        edge("tc", "br", "try"),
        edge("br", "sig", "case_hit"),
        edge("br", "else", "case_miss"),
        edge("sig", "past-sig"),
        edge("tc", "catch", "catch"),
        edge("tc", "fin", "finally"),
    ]
    return Flow(nodes, edges, "tc", "tc")


def _two_try_shape(signal: str, target: str) -> Flow:
    nodes = [
        try_catch_node("tc", enable_finally=True),
        try_catch_node("tc-in", enable_finally=True),
        _signal(signal, target),
        _mark("past-sig"),
        _mark("fin-in"),
        _mark("past-inner"),
        _mark("catch"),
        _mark("fin"),
    ]
    edges = [
        edge("tc", "tc-in", "try"),
        edge("tc-in", "sig", "try"),
        edge("sig", "past-sig"),
        edge("tc-in", "fin-in", "finally"),
        edge("tc-in", "past-inner", "then"),
        edge("tc", "catch", "catch"),
        edge("tc", "fin", "finally"),
    ]
    return Flow(nodes, edges, "tc", "tc")


SHAPES = {
    "try": _try_shape,
    "catch": _catch_shape,
    "finally": _finally_shape,
    "if-else-in-try": _if_else_shape,
    "switch-case-in-try": _switch_shape,
    "two-try-paths": _two_try_shape,
}

CASES = [
    (shape, kind, signal, target)
    for shape in SHAPES
    for kind in (LOOP_KINDS if shape in ("try", "if-else-in-try") else ["for"])
    for signal in SIGNALS
    for target in TARGETS
]


def _placed(flow: Flow, placement: str) -> Graph:
    variables = {**LOOP_OUTPUTS, "lc": 0, "oc": 0}
    if placement == "test":
        return Graph(flow.nodes, [edge("start-node", flow.entry), *flow.edges], variables)
    graph = in_slot(placement, flow.nodes, flow.edges, flow.entry, flow.exit_id)
    graph.variables.update(variables)
    return graph


@dataclass
class Run:
    session: dict[str, Any]
    messages: list[str]

    def count(self, node_id: str) -> int:
        return self.messages.count(node_id.upper())


async def _run(graph: Graph) -> Run:
    session_id = f"signal-through-try-{uuid.uuid4().hex[:10]}"
    session = await run_graph(session_id, graph.nodes, graph.edges, graph.variables)
    return Run(session, log_messages(session_id))


async def _run_shape(
    shape: str, kind: str, signal: str, target: str, placement: str = "test"
) -> Run:
    return await _run(_placed(_looped(kind, target, SHAPES[shape](signal, target)), placement))


def _passes(signal: str) -> int:
    return 1 if signal == "break" else 2


@pytest.mark.parametrize(("shape", "kind", "signal", "target"), CASES)
class TestASignalInsideATryCatchInALoopBody:
    async def test_nothing_after_the_signal_runs_and_the_catch_path_stays_idle(
        self, shape: str, kind: str, signal: str, target: str
    ) -> None:
        run = await _run_shape(shape, kind, signal, target)

        assert (run.count("past-sig"), run.count("catch"), run.count("else")) == (0, 0, 0)
        assert (run.count("tail"), run.count("past-inner")) == (0, 0), run.messages

    async def test_every_finally_path_it_crosses_runs_once_per_iteration(
        self, shape: str, kind: str, signal: str, target: str
    ) -> None:
        run = await _run_shape(shape, kind, signal, target)

        assert run.count("head") == _passes(signal), run.messages
        assert run.count("fin") == _passes(signal), run.messages

    async def test_the_target_loop_acts_and_runs_its_then_successor(
        self, shape: str, kind: str, signal: str, target: str
    ) -> None:
        run = await _run_shape(shape, kind, signal, target)

        loops = (run.count("lp-then"), run.count("outer-head"), run.count("olp-then"))
        expected = (1, 0, 0) if target == "nearest" else (0, _passes(signal), 1)
        assert loops == expected, run.messages
        assert run.count("outer-tail") == 0, run.messages
        assert run.session["status"] == "passed", run.messages


@pytest.mark.parametrize("signal", SIGNALS)
@pytest.mark.parametrize("target", TARGETS)
class TestTwoTryCatchPathsTheSignalCrosses:
    async def test_the_inner_finally_path_runs_before_the_outer_one(
        self, signal: str, target: str
    ) -> None:
        run = await _run_shape("two-try-paths", "for", signal, target)

        finals = [m for m in run.messages if m in ("FIN-IN", "FIN")]
        assert finals == ["FIN-IN", "FIN"] * _passes(signal), run.messages


@pytest.mark.parametrize("signal", SIGNALS)
@pytest.mark.parametrize("target", TARGETS)
@pytest.mark.parametrize("placement", ["for-body", "for-each-body", "try-path", "function-body"])
class TestTheLoopAndItsTryCatchInsideAnotherWalker:
    async def test_the_signal_leaves_through_the_finally_path_to_its_loop(
        self, placement: str, target: str, signal: str
    ) -> None:
        run = await _run_shape("if-else-in-try", "for", signal, target, placement)

        assert (run.count("pre"), run.count("fin")) == (_passes(signal),) * 2, run.messages
        assert (run.count("past-sig"), run.count("catch"), run.count("tail")) == (0, 0, 0)
        then = "lp-then" if target == "nearest" else "olp-then"
        assert (run.count(then), run.count("after")) == (1, 1), run.messages
        assert run.session["status"] == "passed", run.messages


def _failing_finally(signal: str, target: str) -> Flow:
    nodes = [
        try_catch_node("tc", enable_finally=True),
        _signal(signal, target),
        log_node("boom", "boom", "1/0"),
        _mark("past-boom"),
    ]
    edges = [edge("tc", "sig", "try"), edge("tc", "boom", "finally"), edge("boom", "past-boom")]
    return Flow(nodes, edges, "tc", "tc")


@pytest.mark.parametrize("signal", SIGNALS)
@pytest.mark.parametrize("target", TARGETS)
class TestAFinallyPathThatFailsWhileCarryingTheSignal:
    async def test_the_failure_wins_and_the_run_fails(self, signal: str, target: str) -> None:
        run = await _run(_placed(_looped("for", target, _failing_finally(signal, target)), "test"))

        assert run.session["status"] == "failed", run.messages
        assert run.session["block_states"]["tc"] == "failed", run.messages

    async def test_no_loop_runs_another_iteration_or_its_then_successor(
        self, signal: str, target: str
    ) -> None:
        run = await _run(_placed(_looped("for", target, _failing_finally(signal, target)), "test"))

        assert (run.count("head"), run.count("past-boom"), run.count("tail")) == (1, 0, 0)
        assert (run.count("lp-then"), run.count("olp-then")) == (0, 0), run.messages


def _finally_overrides(finally_step: dict[str, Any]) -> Flow:
    nodes = [
        try_catch_node("tc", enable_finally=True),
        loop_signal_node("sig", "break", "lp"),
        _mark("fin"),
        finally_step,
        _mark("past-fin"),
    ]
    edges = [
        edge("tc", "sig", "try"),
        edge("tc", "fin", "finally"),
        edge("fin", finally_step["id"]),
        edge(finally_step["id"], "past-fin"),
    ]
    return Flow(nodes, edges, "tc", "tc")


class TestAFinallyPathThatIssuesItsOwnOutcome:
    async def test_its_own_continue_replaces_the_break_it_carries(self) -> None:
        flow = _finally_overrides(loop_signal_node("own", "continue", "lp"))
        run = await _run(_placed(_looped("for", "nearest", flow), "test"))

        assert (run.count("head"), run.count("fin"), run.count("past-fin")) == (2, 2, 0)
        assert run.count("lp-then") == 1, run.messages

    async def test_a_halt_ends_the_run_and_no_loop_acts_on_the_signal(self) -> None:
        flow = _finally_overrides(halt_node("own", scope="test", status="failed"))
        run = await _run(_placed(_looped("for", "nearest", flow), "test"))

        assert run.session["status"] == "failed", run.messages
        assert (run.count("head"), run.count("past-fin"), run.count("lp-then")) == (1, 0, 0)


class _SlowUnwindPlugin:
    """A block that keeps working for a moment after its lane is canceled."""

    def __init__(self) -> None:
        self.unwinding = asyncio.Event()

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "slow-unwind",
            "name": "Slow Unwind",
            "version": "1.0.0",
            "category": "system",
            "description": "probe",
            "parameters": [],
            "return_type": "map",
            "output_schema": [],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        pass

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            self.unwinding.set()
            await asyncio.sleep(0.5)
            raise
        return {}

    async def cleanup(self) -> None:
        pass


FINALLY_STOPS = ["in-flight", "paused", "parallel-lane-unwinding"]


def _slow_finally(signal: str, target: str, stop: str) -> Flow:
    nodes = [
        try_catch_node("tc", enable_finally=True),
        _signal(signal, target),
        _mark("fin"),
        _mark("past-slow"),
    ]
    edges = [
        edge("tc", "sig", "try"),
        edge("tc", "fin", "finally"),
        edge("slow", "past-slow"),
    ]
    if stop == "parallel-lane-unwinding":
        nodes += [
            parallel_node("slow", [branch("lane_a"), branch("lane_b")], join="first"),
            delay_node("quick", 100, "Quick"),
            make_node(
                "unwind", label="Slow Unwind", element_type="slow-unwind", node_type="plugin"
            ),
        ]
        edges += [
            edge("fin", "slow"),
            edge("slow", "quick", "lane_a"),
            edge("slow", "unwind", "lane_b"),
        ]
    else:
        nodes.append(delay_node("slow", 5000, "Slow"))
        edges.append(edge("fin", "slow"))
    return Flow(nodes, edges, "tc", "tc")


async def _until_the_stop_can_land(session: dict[str, Any], stop: str, plugin: Any) -> None:
    for _ in range(500):
        await asyncio.sleep(0.01)
        if stop == "paused" and session.get("paused_node_id") == "slow":
            return
        if stop == "in-flight" and session["block_states"].get("slow") == "running":
            return
        if stop == "parallel-lane-unwinding" and plugin.unwinding.is_set():
            return
    raise AssertionError(f"the finally path never reached slow: {session['block_states']}")


async def _stop_in_finally(signal: str, target: str, stop: str) -> Run:
    """Stop the run while its finally path holds the signal."""
    plugin = _SlowUnwindPlugin()
    register_plugin(cast(Any, plugin))
    graph = _placed(_looped("for", target, _slow_finally(signal, target, stop)), "test")
    session_id = f"signal-through-try-stop-{uuid.uuid4().hex[:10]}"
    breakpoints = {"slow"} if stop == "paused" else None
    session, task = start_graph(
        session_id, graph.nodes, graph.edges, graph.variables, breakpoints=breakpoints
    )
    _wb_common._active_tasks[session_id] = task
    try:
        await _until_the_stop_can_land(session, stop, plugin)
        workbench_service.stop_workbench_run(session_id=session_id)
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)
    finally:
        _wb_common._active_tasks.pop(session_id, None)
    return Run(session, log_messages(session_id))


@pytest.mark.parametrize("stop", FINALLY_STOPS)
@pytest.mark.parametrize("signal", SIGNALS)
@pytest.mark.parametrize("target", TARGETS)
class TestAStopWhileTheFinallyPathHoldsTheSignal:
    async def test_no_loop_logs_or_acts_on_the_signal(
        self, target: str, signal: str, stop: str
    ) -> None:
        run = await _stop_in_finally(signal, target, stop)

        assert "Break - loop exited" not in run.messages, run.messages
        assert not [m for m in run.messages if m.startswith("[FOR] Iteration 2/")], run.messages
        heads = (run.count("head"), run.count("outer-head"))
        assert heads == ((1, 0) if target == "nearest" else (1, 1)), run.messages
        assert (run.count("past-slow"), run.count("tail"), run.count("outer-tail")) == (0, 0, 0)
        assert (run.count("lp-then"), run.count("olp-then")) == (0, 0), run.messages

    async def test_the_run_ends_stopped_with_the_signal_dropped(
        self, target: str, signal: str, stop: str
    ) -> None:
        run = await _stop_in_finally(signal, target, stop)

        assert run.session["status"] == "stopped", run.messages
        held = (run.session.get("_loop_signal"), run.session.get("_loop_signal_target"))
        assert held == (None, None), run.messages


async def _stopped_in_the_path(*args: Any, **kwargs: Any) -> None:
    args[3]["status"] = "stopped"


@pytest.mark.parametrize("signal", SIGNALS)
@pytest.mark.parametrize("target", ["lp", "olp"])
class TestAFinallyPathTheStopEnds:
    async def test_it_puts_no_signal_back(self, signal: str, target: str) -> None:
        session: dict[str, Any] = {
            "status": "running",
            "block_states": {},
            "_loop_signal": signal,
            "_loop_signal_target": target,
        }
        with patch.object(_try_catch, "_execute_path_nodes", _stopped_in_the_path):
            error = await _try_catch._run_finally_chain(
                ["fin"], {}, {}, session, "signal-through-try-stopped", set(), None, {}
            )

        assert error is None
        held = (session.get("_loop_signal"), session.get("_loop_signal_target"))
        assert held == (None, None)


async def _left_a_continue(**kwargs: Any) -> None:
    kwargs["session"]["_loop_signal"] = "continue"
    kwargs["session"]["_loop_signal_target"] = "outer-loop"


class TestTheNestedDispatchOfATryCatchTheSignalLeaves:
    async def _dispatch(self) -> tuple[str | None, dict[str, Any]]:
        session: dict[str, Any] = {"status": "running", "block_states": {}}
        with patch.object(_try_catch, "_execute_try_catch_paths", _left_a_continue):
            result = await dispatch_nested_signals(
                signals=_extract_engine_signals({"__try_catch": True}),
                node_id="inner",
                nf={"output_bindings": {}},
                adj={},
                node_map={},
                variables={},
                session=session,
                session_id="signal-through-try-dispatch",
                executed=set(),
                environment_id=None,
            )
        return result, session

    async def test_it_hands_back_the_kind(self) -> None:
        result, _ = await self._dispatch()

        assert result == "continue"

    async def test_it_leaves_the_signal_for_the_target_loop(self) -> None:
        _, session = await self._dispatch()

        assert (session.get("_loop_signal"), session.get("_loop_signal_target")) == (
            "continue",
            "outer-loop",
        )
