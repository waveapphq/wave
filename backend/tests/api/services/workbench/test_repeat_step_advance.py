"""Advancing from a paused Block that already has a result (REQ-3.2.1.3, REQ-3.2.1.4, REQ-3.2.2.2).

A paused Block has a result when Repeat Step ran it or when it failed and caused an error pause.
Continue and Step Over proceed from that result without running the Block again; Step Into on a
container or a Function instance enters it and runs its body step by step; a Repeat Step never
opens a second pause; Skip Block marks the Block skipped and the flow goes on the normal path.
Every walker honors the rules, driven through the real engine.
"""

import asyncio
import contextlib
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    edge,
    engine_registries,
    function_node,
    local_definition,
    log_messages,
    log_node,
    make_node,
    make_session,
    parallel_node,
    try_catch_node,
    wait_until_paused,
)
from tests.api.services.workbench.slot_harness import (
    LOOP_OUTPUTS,
    TRUE,
    Graph,
    case,
    for_node,
    if_else_node,
    retry_wait_node,
    setter_node,
    switch_node,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.plugin_registry import register_plugin
from wavecore.core.ssh.session_registry import SSHSessionRegistry

HOST_SESSION = "advance-host-sess"
_TICKS = 300

WALKERS = [
    "main-flow",
    "try-path",
    "parallel-lane",
    "for-body",
    "wait-until-body",
    "switch-case",
    "function-body",
    "remote-body",
]
CONTAINERS = ["for", "try-catch", "if-else", "function"]
_SEEN = [{"name": "seen", "value": 0}]


class _ProbePlugin:
    """A Block that counts its runs, returns the count and raises while ``fail`` is set."""

    def __init__(self) -> None:
        self.runs = 0
        self.fail = False

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "probe",
            "name": "Probe",
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
        self.runs += 1
        if self.fail:
            raise RuntimeError("probe failed")
        return {"value": self.runs}

    async def cleanup(self) -> None:
        pass


@pytest.fixture
def probe(request: pytest.FixtureRequest) -> _ProbePlugin:
    request.getfixturevalue("engine_registries")
    plugin = _ProbePlugin()
    register_plugin(plugin)
    return plugin


def _probe_node(node_id: str, name: str) -> dict[str, Any]:
    return make_node(
        node_id,
        label="Probe",
        element_type="probe",
        node_type="plugin",
        config_values={},
        output_bindings={"value": "seen"},
        name=name,
    )


def _saw_node(node_id: str = "b") -> dict[str, Any]:
    return log_node(node_id, "B", "'B-SAW ' + str(seen)")


def _definition(nodes: list[dict[str, Any]], edges: list[dict[str, Any]], entry: str) -> Any:
    definition = local_definition("Body", nodes, [edge("start-node", entry), *edges])
    definition["variables"] = list(_SEEN)
    return definition


@dataclass
class SubFlow:
    """Nodes entered at ``entry`` and left at ``exit_id``."""

    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    entry: str
    exit_id: str


def _leaf_flow() -> SubFlow:
    return SubFlow([_probe_node("a", "A"), _saw_node()], [edge("a", "b")], "a", "b")


def _container_flow(kind: str) -> SubFlow:
    """Container ``c``: body ``inner`` (the probe) -> ``inner2``, then ``b`` (not after If/Else)."""
    inner = _probe_node("inner", "Inner")
    inner2 = log_node("inner2", "Inner Two", "'INNER-TWO'")
    body = [edge("inner", "inner2")]
    if kind == "function":
        container = function_node("c", _definition([inner, inner2], body, "inner"))
        return SubFlow([container, _saw_node()], [edge("c", "b")], "c", "b")
    if kind == "if-else":
        edges = [edge("c", "inner", "branch_0"), *body]
        return SubFlow([if_else_node("c"), inner, inner2], edges, "c", "inner2")
    container, handle = (
        (for_node("c", 1), "body") if kind == "for" else (try_catch_node("c"), "try")
    )
    edges = [edge("c", "inner", handle), *body, edge("c", "b", "then")]
    return SubFlow([container, inner, inner2, _saw_node()], edges, "c", "b")


def _remote_container() -> dict[str, Any]:
    return make_node(
        "outer",
        label="Remote Execution",
        element_type="remote-execution",
        node_type="plugin",
        config_values={"session_id": HOST_SESSION},
        output_bindings={"remote_session_id": "rsid"},
    )


def _slot_container(walker: str, sub: SubFlow) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The container holding ``sub`` in the walker's slot, with the edges into it."""
    if walker == "function-body":
        return [function_node("outer", _definition(sub.nodes, sub.edges, sub.entry))], []
    tick = setter_node("tick", "Tick", {"rounds": "rounds + 1"}, expressions=True)
    # The second lane is empty, so a Step Over pause never lands on a sibling Block.
    lanes = [branch("lane", "Lane"), branch("empty", "Empty")]
    shapes: dict[str, tuple[list[dict[str, Any]], str]] = {
        "parallel-lane": ([parallel_node("outer", lanes)], "lane"),
        "for-body": ([for_node("outer", 1)], "body"),
        "wait-until-body": ([retry_wait_node("outer", "rounds >= 1"), tick], "retry"),
        "switch-case": ([switch_node("outer", [case("case_hit", TRUE)])], "case_hit"),
        "remote-body": ([_remote_container()], "body"),
    }
    nodes, handle = shapes[walker]
    edges = [edge("outer", sub.entry, handle), *sub.edges]
    if walker == "wait-until-body":
        edges.append(edge(sub.exit_id, "tick"))
    return [*nodes, *sub.nodes], edges


def _placed(walker: str, sub: SubFlow) -> Graph:
    """``sub`` in the walker; the flow then logs AFTER and a Try/Catch around it logs CAUGHT.

    On the main flow there is no Try/Catch: a failure ends the run.
    """
    after = log_node("after", "After", "'AFTER'")
    caught = log_node("caught", "Caught", "'CAUGHT'")
    variables = {**LOOP_OUTPUTS, "seen": 0, "rsid": None}
    if walker == "main-flow":
        edges = [edge("start-node", sub.entry), *sub.edges, edge(sub.exit_id, "after")]
        return Graph([*sub.nodes, after], edges, variables)
    if walker == "try-path":
        nodes = [try_catch_node("guard"), *sub.nodes, caught, after]
        edges = [edge("guard", sub.entry, "try"), *sub.edges]
    else:
        container_nodes, container_edges = _slot_container(walker, sub)
        nodes = [try_catch_node("guard"), *container_nodes, caught, after]
        edges = [edge("guard", "outer", "try"), *container_edges]
    edges += [
        edge("start-node", "guard"),
        edge("guard", "caught", "catch"),
        edge("guard", "after", "then"),
    ]
    return Graph(nodes, edges, variables)


@dataclass
class _Debugging:
    session_id: str
    session: dict[str, Any]
    task: "asyncio.Task[None]"
    probe: _ProbePlugin
    walker: str
    marks: dict[str, int] = field(default_factory=dict)

    def count(self, predicate: Callable[[str], bool]) -> int:
        return sum(predicate(message) for message in log_messages(self.session_id))

    def lines(self, text: str) -> int:
        return self.count(lambda message: message == text)

    def saw(self) -> int:
        return self.count(lambda message: message.startswith("B-SAW "))

    def pauses(self) -> int:
        return self.count(lambda message: message.startswith("⏸ Paused"))

    def repeats(self) -> int:
        return self.count(lambda message: message.startswith("⟳ Repeated"))

    async def repeat(self) -> None:
        done = self.repeats() + 1
        workbench_service.repeat_step(session_id=self.session_id)
        await _until(lambda: self.repeats() >= done)

    async def paused_on(self, node_id: str) -> None:
        await wait_until_paused(self.session, node_id, ticks=_TICKS)
        assert self.session.get("paused_node_id") == node_id, log_messages(self.session_id)

    async def finished(self) -> None:
        await asyncio.wait_for(self.task, timeout=5)

    def expect_failure_path(self) -> None:
        """The failure was routed: the Try/Catch ran its catch path (main flow: the run failed)."""
        messages = log_messages(self.session_id)
        if self.walker == "main-flow":
            assert self.session["status"] == "failed", messages
            assert (self.lines("AFTER"), self.saw()) == (0, 0), messages
            return
        assert (self.lines("CAUGHT"), self.lines("AFTER"), self.saw()) == (1, 1, 0), messages

    def expect_normal_path(self, saw: int = 1) -> None:
        messages = log_messages(self.session_id)
        assert (self.lines("CAUGHT"), self.lines("AFTER"), self.saw()) == (0, 1, saw), messages
        if self.walker == "main-flow":
            assert self.session["status"] == "passed", messages


async def _until(check: Callable[[], bool]) -> None:
    for _ in range(_TICKS):
        if check():
            return
        await asyncio.sleep(0.01)


@contextlib.asynccontextmanager
async def _debugging(
    walker: str,
    probe: _ProbePlugin,
    sub: SubFlow,
    *,
    breakpoints: set[str] | None = None,
    pause_on_errors: bool = False,
    **entry: str,
) -> AsyncIterator[_Debugging]:
    """Start ``sub`` in the walker under the debugger; stop whatever is left at the end."""
    graph = _placed(walker, sub)
    session_id = f"advance-{walker}-{uuid.uuid4().hex[:8]}"
    registry = SSHSessionRegistry()
    registry.register(
        HOST_SESSION, MagicMock(), None, "advance-host", None, None, connect_timeout=30
    )
    session = make_session(session_id, breakpoints=breakpoints)
    session["ssh_session_registry"] = registry
    if pause_on_errors:
        session["debug_options"] = {"pause_on_errors": True}
    _wb_common._workbench_sessions[session_id] = session
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=MagicMock())),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
    ):
        task = asyncio.create_task(
            workbench_service._execute_workflow(
                session_id, graph.nodes, graph.edges, graph.variables, **entry
            )
        )
        try:
            yield _Debugging(session_id, session, task, probe, walker)
        finally:
            if not task.done():
                session["status"] = "stopped"
                session["pause_event"].set()
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await asyncio.wait_for(task, timeout=2)


@pytest.mark.parametrize("walker", WALKERS)
class TestContinueAndStepOverAfterRepeatStep:
    """A Block Repeat Step ran is not run again by Continue or Step Over (REQ-3.2.1.4)."""

    async def test_step_over_pauses_on_the_next_block_without_running_it_again(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        async with _debugging(walker, probe, _leaf_flow(), breakpoints={"a"}) as run:
            await run.paused_on("a")
            await run.repeat()
            await run.repeat()
            workbench_service.step_over(session_id=run.session_id)
            await run.paused_on("b")

            assert probe.runs == 2, log_messages(run.session_id)
            assert run.session["block_states"].get("a") == "passed"

    async def test_continue_takes_the_normal_path_without_running_it_again(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        async with _debugging(walker, probe, _leaf_flow(), breakpoints={"a"}) as run:
            await run.paused_on("a")
            await run.repeat()
            await run.repeat()
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            assert probe.runs == 2, log_messages(run.session_id)
            assert run.lines("B-SAW 2") == 1
            run.expect_normal_path()

    async def test_a_failed_repeat_then_continue_follows_the_failure_path(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        probe.fail = True
        async with _debugging(
            walker, probe, _leaf_flow(), breakpoints={"a"}, pause_on_errors=True
        ) as run:
            await run.paused_on("a")
            await run.repeat()
            assert run.session["block_states"].get("a") == "failed"
            assert (run.session.get("paused_node_id"), run.pauses()) == ("a", 1)
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            assert (probe.runs, run.pauses()) == (1, 1), log_messages(run.session_id)
            run.expect_failure_path()

    async def test_step_into_a_leaf_pauses_on_the_next_block_without_running_it_again(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        async with _debugging(walker, probe, _leaf_flow(), breakpoints={"a"}) as run:
            await run.paused_on("a")
            await run.repeat()
            workbench_service.step_into(session_id=run.session_id)
            await run.paused_on("b")

            assert (probe.runs, run.saw()) == (1, 0), log_messages(run.session_id)


@pytest.mark.parametrize("walker", WALKERS)
class TestAdvancingFromAnErrorPause:
    """An error pause proceeds from the Block's latest result and never pauses twice."""

    async def test_continue_follows_the_failure_path_without_pausing_again(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        probe.fail = True
        async with _debugging(walker, probe, _leaf_flow(), pause_on_errors=True) as run:
            await run.paused_on("a")
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            assert (probe.runs, run.pauses()) == (1, 1), log_messages(run.session_id)
            assert run.session["block_states"].get("a") == "failed"
            run.expect_failure_path()

    async def test_step_over_follows_the_failure_path_and_pauses_on_the_next_block_it_runs(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        probe.fail = True
        async with _debugging(walker, probe, _leaf_flow(), pause_on_errors=True) as run:
            await run.paused_on("a")
            workbench_service.step_over(session_id=run.session_id)
            if walker == "main-flow":
                await run.finished()
                assert run.session["status"] == "failed", log_messages(run.session_id)
            else:
                await run.paused_on("caught")
                assert run.lines("CAUGHT") == 0
            assert (probe.runs, run.saw()) == (1, 0), log_messages(run.session_id)

    async def test_continue_after_a_passing_repeat_takes_the_normal_path(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        probe.fail = True
        async with _debugging(walker, probe, _leaf_flow(), pause_on_errors=True) as run:
            await run.paused_on("a")
            probe.fail = False
            await run.repeat()
            assert run.session["block_states"].get("a") == "passed"
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            assert (probe.runs, run.pauses()) == (2, 1), log_messages(run.session_id)
            assert run.session["block_states"].get("a") == "passed"
            run.expect_normal_path()

    async def test_a_failing_repeat_stays_in_the_one_pause(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        probe.fail = True
        async with _debugging(walker, probe, _leaf_flow(), pause_on_errors=True) as run:
            await run.paused_on("a")
            await run.repeat()
            await asyncio.sleep(0.05)

            assert run.session.get("paused_node_id") == "a", log_messages(run.session_id)
            assert (run.session["status"], run.pauses()) == ("paused", 1)
            assert run.session["block_states"].get("a") == "failed"
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            assert (probe.runs, run.pauses()) == (2, 1), log_messages(run.session_id)
            run.expect_failure_path()


@pytest.mark.parametrize("walker", WALKERS)
class TestSkipBlockOnABlockWithAResult:
    """Skip Block marks the Block skipped, keeps what it changed, takes the normal path."""

    async def test_after_a_repeat_it_is_skipped_and_the_repeats_writes_stay(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        async with _debugging(walker, probe, _leaf_flow(), breakpoints={"a"}) as run:
            await run.paused_on("a")
            await run.repeat()
            workbench_service.skip_current_block(session_id=run.session_id)
            await run.paused_on("b")
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            assert probe.runs == 1, log_messages(run.session_id)
            assert run.session["block_states"].get("a") == "skipped"
            assert run.lines("B-SAW 1") == 1
            run.expect_normal_path()

    async def test_on_an_error_pause_it_is_skipped_and_no_catch_runs(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        probe.fail = True
        async with _debugging(walker, probe, _leaf_flow(), pause_on_errors=True) as run:
            await run.paused_on("a")
            workbench_service.skip_current_block(session_id=run.session_id)
            await run.paused_on("b")
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            assert probe.runs == 1, log_messages(run.session_id)
            assert run.session["block_states"].get("a") == "skipped"
            run.expect_normal_path()


@pytest.mark.parametrize("container", CONTAINERS)
@pytest.mark.parametrize("walker", WALKERS)
class TestStepIntoAContainerAfterRepeatStep:
    """Step Into on a container or Function instance enters it even after Repeat Step ran it."""

    async def test_it_enters_and_runs_the_body_step_by_step(
        self, walker: str, container: str, probe: _ProbePlugin
    ) -> None:
        # A main-flow If/Else only routes: its branch Blocks run on the main flow, not in a repeat.
        ran = 0 if (walker, container) == ("main-flow", "if-else") else 1
        flow = _container_flow(container)
        async with _debugging(walker, probe, flow, breakpoints={"c"}) as run:
            await run.paused_on("c")
            await run.repeat()
            assert (probe.runs, run.lines("INNER-TWO")) == (ran, ran), log_messages(run.session_id)
            workbench_service.step_into(session_id=run.session_id)
            await run.paused_on("inner")

            assert probe.runs == ran, log_messages(run.session_id)
            workbench_service.step_over(session_id=run.session_id)
            await run.paused_on("inner2")
            assert (probe.runs, run.lines("INNER-TWO")) == (ran + 1, ran)
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            messages = log_messages(run.session_id)
            assert (probe.runs, run.lines("INNER-TWO")) == (ran + 1, ran + 1), messages
            run.expect_normal_path(saw=0 if container == "if-else" else 1)


class TestARepeatOfAContainer:
    """A Repeat Step runs the paused container through without pausing inside it."""

    @pytest.mark.parametrize("walker", ["main-flow", "try-path", "for-body"])
    async def test_it_does_not_pause_on_a_breakpoint_inside_it(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        async with _debugging(
            walker, probe, _container_flow("for"), breakpoints={"c", "inner"}
        ) as run:
            await run.paused_on("c")
            await run.repeat()

            assert (probe.runs, run.pauses()) == (1, 1), log_messages(run.session_id)
            assert run.session.get("paused_node_id") == "c"
            workbench_service.step_over(session_id=run.session_id)
            await run.paused_on("b")
            assert probe.runs == 1


class TestAdHocDebugRuns:
    """Debug from Here and Debug Current follow the same rules."""

    async def test_debug_from_here_continues_from_the_repeats_result(
        self, probe: _ProbePlugin
    ) -> None:
        async with _debugging(
            "main-flow", probe, _leaf_flow(), breakpoints={"a"}, start_node_id="a"
        ) as run:
            await run.paused_on("a")
            await run.repeat()
            await run.repeat()
            workbench_service.step_over(session_id=run.session_id)
            await run.paused_on("b")
            assert probe.runs == 2
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            assert probe.runs == 2, log_messages(run.session_id)
            run.expect_normal_path()

    async def test_debug_current_continues_from_the_repeats_result(
        self, probe: _ProbePlugin
    ) -> None:
        async with _debugging(
            "for-body", probe, _leaf_flow(), breakpoints={"a"}, single_node_id="outer"
        ) as run:
            await run.paused_on("a")
            await run.repeat()
            await run.repeat()
            workbench_service.continue_session(session_id=run.session_id)
            await run.finished()

            assert (probe.runs, run.lines("B-SAW 2")) == (2, 1), log_messages(run.session_id)
            assert run.session["status"] == "passed"


@pytest.mark.parametrize("walker", ["main-flow", "try-path", "for-body"])
class TestStopWhilePaused:
    """A Stop from a pause ends the run: the Block is not run again."""

    async def test_a_stop_at_a_breakpoint_never_runs_the_block(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        async with _debugging(walker, probe, _leaf_flow(), breakpoints={"a"}) as run:
            await run.paused_on("a")
            run.session["status"] = "stopped"
            run.session["pause_event"].set()
            await run.finished()

            assert (probe.runs, run.saw(), run.lines("AFTER")) == (0, 0, 0)

    async def test_a_stop_at_an_error_pause_does_not_run_the_block_again(
        self, walker: str, probe: _ProbePlugin
    ) -> None:
        probe.fail = True
        async with _debugging(walker, probe, _leaf_flow(), pause_on_errors=True) as run:
            await run.paused_on("a")
            run.session["status"] = "stopped"
            run.session["pause_event"].set()
            await run.finished()

            assert (probe.runs, run.saw()) == (1, 0)
