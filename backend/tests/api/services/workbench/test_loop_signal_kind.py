"""A Break or Continue keeps its kind until the loop it targets consumes it (REQ-3.5.1.3).

Continue: "The target loop advances to its next iteration"; each intermediate loop stores "the
signal and target in the session for the next enclosing loop to consume" (REQ-3.5.1.2); a loop
signal traverses outward through the Parallel sections that contain it (REQ-3.2.3.1).
"""

import uuid
from typing import Any
from unittest.mock import patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    edge,
    engine_registries,
    for_each_node,
    log_messages,
    log_node,
    loop_signal_node,
    parallel_node,
    run_graph,
    setter_node,
)
from tests.api.services.workbench.slot_harness import LOOP_OUTPUTS, for_node, while_node
from wavecore.api.services.workbench import execution as _execution
from wavecore.api.services.workbench import parallel as _parallel
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench import switch_case as _switch_case
from wavecore.api.services.workbench import wait_until as _wait_until
from wavecore.api.services.workbench.nested import dispatch_nested_signals
from wavecore.api.services.workbench.signals import _extract_engine_signals

pytestmark = pytest.mark.usefixtures("engine_registries")

MID_LOOPS = {
    "for": lambda: for_node("mid", 2, index_var="j"),
    "for-each": lambda: for_each_node("mid", [1, 2]),
    "while": lambda: while_node("mid", "True"),
}


def _bump(node_id: str, counter: str) -> dict[str, Any]:
    return setter_node(node_id, node_id, {counter: f"{counter} + 1"}, expressions=True)


async def _continue_through_a_lane(mid: str, signal: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """outer For x2 > mid loop > Parallel whose first lane holds a ``signal`` aimed at outer."""
    nodes = [
        for_node("outer", 2),
        _bump("outer-head", "oh"),
        MID_LOOPS[mid](),
        _bump("body-head", "bh"),
        parallel_node("par", [branch("branch_1", "signal"), branch("branch_2", "other")]),
        loop_signal_node("sig", signal, "outer"),
        log_node("lane-2", "Lane 2", "'LANE-2'"),
        _bump("mid-then", "mt"),
        _bump("outer-then", "oth"),
    ]
    edges = [
        edge("start-node", "outer"),
        edge("outer", "outer-head", "body"),
        edge("outer-head", "mid"),
        edge("mid", "body-head", "body"),
        edge("body-head", "par"),
        edge("par", "sig", "branch_1"),
        edge("par", "lane-2", "branch_2"),
        edge("mid", "mid-then", "then"),
        edge("outer", "outer-then", "then"),
    ]
    variables = {**LOOP_OUTPUTS, "oh": 0, "bh": 0, "mt": 0, "oth": 0}
    session = await run_graph(
        f"signal-kind-{mid}-{signal}-{uuid.uuid4().hex[:8]}", nodes, edges, variables
    )
    return session, variables


@pytest.mark.parametrize("mid", sorted(MID_LOOPS))
class TestAContinueInAParallelLaneAimedAtAnOuterLoop:
    async def test_the_outer_loop_runs_every_iteration(self, mid: str) -> None:
        session, variables = await _continue_through_a_lane(mid, "continue")

        assert variables["oh"] == 2, log_messages(session["session_id"])
        assert variables["bh"] == 2, log_messages(session["session_id"])
        assert variables["oth"] == 1, log_messages(session["session_id"])

    async def test_no_loop_reports_a_break(self, mid: str) -> None:
        session, _ = await _continue_through_a_lane(mid, "continue")

        messages = log_messages(session["session_id"])
        assert not any("Break - loop exited" in m for m in messages), messages
        assert session["status"] == "passed", messages

    async def test_the_intermediate_loop_never_reaches_its_then(self, mid: str) -> None:
        _, variables = await _continue_through_a_lane(mid, "continue")

        assert variables["mt"] == 0


@pytest.mark.parametrize("mid", sorted(MID_LOOPS))
class TestABreakInAParallelLaneAimedAtAnOuterLoop:
    async def test_the_outer_loop_ends_after_its_first_iteration(self, mid: str) -> None:
        session, variables = await _continue_through_a_lane(mid, "break")

        messages = log_messages(session["session_id"])
        assert (variables["oh"], variables["bh"], variables["mt"], variables["oth"]) == (
            1,
            1,
            0,
            1,
        ), messages


async def _left_a_continue(*args: Any, **kwargs: Any) -> Any:
    session = kwargs["session"] if "session" in kwargs else args[4]
    session["_loop_signal"] = "continue"
    session["_loop_signal_target"] = "outer-loop"
    return False if "branches" in kwargs else "passed"


CONTAINERS = {
    "for": (_execution, "_dispatch_loop", {"__for_loop": True}),
    "for-each": (_execution, "_dispatch_loop", {"__for_each": True}),
    "while": (_execution, "_dispatch_loop", {"__while_loop": True}),
    "wait-until": (_wait_until, "_execute_wait_until_body", {"__wait_until": True}),
    "remote-execution": (_remote_exec, "execute_remote_container", {"__remote_execution": True}),
    "switch-case": (_switch_case, "_execute_switch_paths", {"__switch": True}),
    "parallel": (_parallel, "execute_parallel_branches", {"__parallel": True}),
}


@pytest.mark.parametrize("container", sorted(CONTAINERS))
class TestTheNestedDispatchOfAContainerTheSignalCrosses:
    async def _dispatch(self, container: str) -> tuple[str | None, dict[str, Any]]:
        module, target, engine_keys = CONTAINERS[container]
        session: dict[str, Any] = {"status": "running", "block_states": {}}
        with patch.object(module, target, _left_a_continue):
            result = await dispatch_nested_signals(
                signals=_extract_engine_signals(dict(engine_keys)),
                node_id="inner",
                nf={"output_bindings": {}},
                adj={},
                node_map={},
                variables={},
                session=session,
                session_id="signal-kind-dispatch",
                executed=set(),
                environment_id=None,
            )
        return result, session

    async def test_it_hands_back_the_kind(self, container: str) -> None:
        result, _ = await self._dispatch(container)

        assert result == "continue"

    async def test_it_leaves_the_signal_for_the_target_loop(self, container: str) -> None:
        _, session = await self._dispatch(container)

        assert (session.get("_loop_signal"), session.get("_loop_signal_target")) == (
            "continue",
            "outer-loop",
        )
