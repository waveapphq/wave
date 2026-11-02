"""Repeat Step and Step Over act on the Block paused inside a sub-flow (REQ-3.2.1.4, REQ-3.2.2.3).

Repeat Step "re-runs the currently paused block in place"; Step Over "Runs the paused block to
completion and pauses before its sibling-after". Every sub-flow walker (loop and
Wait Until bodies, nested branches, a Remote Execution body, Try paths, a Function body) honors
both. Driven through the real engine with a breakpoint on the first Block of the slot.
"""

import asyncio
import contextlib
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    log_messages,
    log_node,
    make_node,
    start_graph,
    wait_until_paused,
)
from tests.api.services.workbench.slot_harness import (
    Graph,
    assert_split_node,
    if_else_node,
    in_slot,
)
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.ssh.session_registry import SSHSessionRegistry

pytestmark = pytest.mark.usefixtures("engine_registries")

HOST_SESSION = "debug-host-sess"
_POLL_TICKS = 100


def _pair() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return [log_node("a", "A", "'A-RAN'"), log_node("b", "B", "'B-RAN'")], [edge("a", "b")]


def _branch_in_try(branching: dict[str, Any], taken: str, untaken: str) -> Graph:
    pair, pair_edges = _pair()
    nodes = [branching, *pair, log_node("other", "Other", "'OTHER'")]
    edges = [edge("br", "a", taken), edge("br", "other", untaken), *pair_edges]
    return in_slot("try-path", nodes, edges, "br", "b")


def _remote_body() -> Graph:
    pair, pair_edges = _pair()
    rex = make_node(
        "outer",
        label="Remote Execution",
        element_type="remote-execution",
        node_type="plugin",
        config_values={"session_id": HOST_SESSION},
        output_bindings={"remote_session_id": "rsid"},
    )
    nodes = [rex, *pair, log_node("after", "After", "'AFTER'")]
    edges = [
        edge("start-node", "outer"),
        edge("outer", "a", "body"),
        *pair_edges,
        edge("outer", "after", "then"),
    ]
    return Graph(nodes, edges, {"rsid": None})


def _graph(slot: str) -> Graph:
    if slot == "if-branch":
        return _branch_in_try(if_else_node("br"), "branch_0", "branch_1")
    if slot == "assert-branch":
        return _branch_in_try(assert_split_node("br"), "pass", "fail")
    if slot == "remote-body":
        return _remote_body()
    pair, pair_edges = _pair()
    return in_slot(slot, pair, pair_edges, "a", "b")


SLOTS = [
    "for-body",
    "for-each-body",
    "while-body",
    "wait-until-body",
    "if-branch",
    "assert-branch",
    "remote-body",
    "try-path",
    "function-body",
]


@dataclass
class _Debugging:
    session_id: str
    session: dict[str, Any]
    task: "asyncio.Task[None]"

    def ran(self, marker: str) -> int:
        return sum(message == marker for message in log_messages(self.session_id))

    def repeats(self) -> int:
        return sum(m.startswith("⟳ Repeated 'A'") for m in log_messages(self.session_id))


@contextlib.asynccontextmanager
async def _debugging(slot: str) -> AsyncIterator[_Debugging]:
    """Start the slot's graph with a breakpoint on ``a``; stop whatever is left at the end."""
    graph = _graph(slot)
    session_id = f"sub-flow-debug-{slot}-{uuid.uuid4().hex[:8]}"
    registry = SSHSessionRegistry()
    registry.register(HOST_SESSION, MagicMock(), None, "debug-host", None, None, connect_timeout=30)
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=MagicMock())),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
    ):
        session, task = start_graph(
            session_id, graph.nodes, graph.edges, graph.variables, breakpoints={"a"}
        )
        session["ssh_session_registry"] = registry
        try:
            await wait_until_paused(session, "a")
            assert session.get("paused_node_id") == "a", log_messages(session_id)
            yield _Debugging(session_id, session, task)
        finally:
            if not task.done():
                session["status"] = "stopped"
                session["pause_event"].set()
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await asyncio.wait_for(task, timeout=2)


async def _poll_until(check: Any) -> None:
    for _ in range(_POLL_TICKS):
        if check():
            return
        await asyncio.sleep(0.01)


@pytest.mark.parametrize("slot", SLOTS)
class TestRepeatStepInASubFlow:
    async def test_it_runs_only_the_paused_block_and_stays_paused(self, slot: str) -> None:
        async with _debugging(slot) as run:
            workbench_service.repeat_step(session_id=run.session_id)
            await _poll_until(lambda: run.repeats() >= 1)

            assert run.ran("A-RAN") == 1, log_messages(run.session_id)
            assert run.session["paused_node_id"] == "a"
            assert run.session["block_states"].get("a") == "passed"
            assert run.ran("B-RAN") == 0

    async def test_a_second_repeat_runs_the_block_again(self, slot: str) -> None:
        async with _debugging(slot) as run:
            workbench_service.repeat_step(session_id=run.session_id)
            await _poll_until(lambda: run.repeats() >= 1)
            workbench_service.repeat_step(session_id=run.session_id)
            await _poll_until(lambda: run.repeats() >= 2)

            assert run.ran("A-RAN") == 2, log_messages(run.session_id)
            assert run.session["paused_node_id"] == "a"

    async def test_continue_then_finishes_the_run(self, slot: str) -> None:
        async with _debugging(slot) as run:
            workbench_service.repeat_step(session_id=run.session_id)
            await _poll_until(lambda: run.repeats() >= 1)
            workbench_service.continue_session(session_id=run.session_id)
            await asyncio.wait_for(run.task, timeout=5)

            assert run.session["status"] == "passed", log_messages(run.session_id)
            # Continue proceeds from the repeat's result without running A again (REQ-3.2.1.4).
            assert (run.ran("A-RAN"), run.ran("B-RAN")) == (1, 1)


@pytest.mark.parametrize("slot", SLOTS)
class TestStepOverInASubFlow:
    async def test_it_pauses_on_the_next_block_of_the_slot(self, slot: str) -> None:
        async with _debugging(slot) as run:
            workbench_service.step_over(session_id=run.session_id)
            await wait_until_paused(run.session, "b", ticks=_POLL_TICKS)

            assert run.session.get("paused_node_id") == "b", log_messages(run.session_id)
            assert (run.ran("A-RAN"), run.ran("B-RAN")) == (1, 0)

    async def test_continue_from_the_next_block_finishes_the_run(self, slot: str) -> None:
        async with _debugging(slot) as run:
            workbench_service.step_over(session_id=run.session_id)
            await wait_until_paused(run.session, "b", ticks=_POLL_TICKS)
            workbench_service.continue_session(session_id=run.session_id)
            await asyncio.wait_for(run.task, timeout=5)

            assert run.session["status"] == "passed", log_messages(run.session_id)
            assert (run.ran("A-RAN"), run.ran("B-RAN")) == (1, 1)


@contextlib.asynccontextmanager
async def _paused_on_an_error(slot: str) -> AsyncIterator[_Debugging]:
    """Start the slot's graph with ``a`` failing on ``flag == 0`` and pause on errors armed."""
    graph = _graph(slot)
    failing = next(node for node in graph.nodes if node["id"] == "a")
    failing["data"]["config"]["values"]["message"] = "'A-RAN' if 1 / flag else ''"
    session_id = f"sub-flow-error-{slot}-{uuid.uuid4().hex[:8]}"
    registry = SSHSessionRegistry()
    registry.register(HOST_SESSION, MagicMock(), None, "debug-host", None, None, connect_timeout=30)
    variables = {**graph.variables, "flag": 0}
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=MagicMock())),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
    ):
        session, task = start_graph(session_id, graph.nodes, graph.edges, variables)
        session["ssh_session_registry"] = registry
        session["debug_options"] = {"pause_on_errors": True}
        try:
            await wait_until_paused(session, "a")
            assert session.get("paused_node_id") == "a", log_messages(session_id)
            variables["flag"] = 1
            yield _Debugging(session_id, session, task)
        finally:
            if not task.done():
                session["status"] = "stopped"
                session["pause_event"].set()
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await asyncio.wait_for(task, timeout=2)


@pytest.mark.parametrize("slot", [slot for slot in SLOTS if slot != "function-body"])
class TestRepeatStepOnAFailedBlockInASubFlow:
    async def test_the_final_attempt_decides_the_blocks_outcome(self, slot: str) -> None:
        """On advance the engine uses the latest attempt's outcome."""
        async with _paused_on_an_error(slot) as run:
            workbench_service.repeat_step(session_id=run.session_id)
            await _poll_until(lambda: run.repeats() >= 1)
            workbench_service.continue_session(session_id=run.session_id)
            await asyncio.wait_for(run.task, timeout=5)

            assert run.session["status"] == "passed", log_messages(run.session_id)
            assert run.session["block_states"].get("a") == "passed"
            assert run.ran("B-RAN") == 1
