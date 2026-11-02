"""A block failing in a loop body fails the run, whatever is wired after the loop (REQ-3.2.2.9).

"Body node failure aborts the loop immediately. Remaining nodes, remaining iterations,
and then-path are skipped. Session fails." The same holds for a loop nested in another sub-flow
and for a Wait Until retry body. A surrounding Try/Catch still catches the failure.
"""

import uuid
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    for_each_node,
    log_messages,
    log_node,
    run_graph,
)
from tests.api.services.workbench.slot_harness import (
    LOOP_OUTPUTS,
    Edges,
    Graph,
    Nodes,
    for_node,
    if_else_node,
    in_slot,
    retry_wait_node,
    while_node,
)

pytestmark = pytest.mark.usefixtures("engine_registries")

LOOPS = ["for", "for-each", "while", "wait-until"]


def _failing_loop(kind: str) -> tuple[Nodes, Edges]:
    """A container ``loop`` whose body is one failing block and nothing else."""
    containers = {
        "for": lambda: for_node("loop", 2),
        "for-each": lambda: for_each_node("loop", [1, 2]),
        "while": lambda: while_node("loop", "True"),
        "wait-until": lambda: retry_wait_node("loop", "False", timeout=3000),
    }
    handle = "retry" if kind == "wait-until" else "body"
    nodes = [containers[kind](), log_node("fail", "Fail", "1/0")]
    return nodes, [edge("loop", "fail", handle)]


def _placed(kind: str, placement: str, then: bool) -> Graph:
    nodes, edges = _failing_loop(kind)
    if then:
        nodes.append(log_node("loop-then", "Loop Then", "'LOOP-THEN'"))
        edges.append(edge("loop", "loop-then", "then"))
    if placement == "main-flow":
        return Graph(nodes, [edge("start-node", "loop"), *edges], dict(LOOP_OUTPUTS))
    if placement == "if-branch":
        branching = [if_else_node("br"), log_node("other", "Other", "'OTHER'")]
        routes = [
            edge("start-node", "br"),
            edge("br", "loop", "branch_0"),
            edge("br", "other", "branch_1"),
        ]
        return Graph([*branching, *nodes], [*routes, *edges], dict(LOOP_OUTPUTS))
    exit_id = "loop-then" if then else "loop"
    return in_slot(placement, nodes, edges, "loop", exit_id, then=False)


async def _run(kind: str, placement: str, then: bool) -> tuple[dict[str, Any], list[str]]:
    graph = _placed(kind, placement, then)
    session_id = f"loop-verdict-{kind}-{placement}-{then}-{uuid.uuid4().hex[:8]}"
    session = await run_graph(session_id, graph.nodes, graph.edges, graph.variables)
    return session, log_messages(session_id)


@pytest.mark.parametrize("then", [False, True], ids=["no-then", "then"])
@pytest.mark.parametrize("placement", ["main-flow", "if-branch", "for-body", "for-each-body"])
@pytest.mark.parametrize("kind", LOOPS)
class TestABodyFailure:
    async def test_the_run_ends_failed(self, kind: str, placement: str, then: bool) -> None:
        session, messages = await _run(kind, placement, then)

        assert session["status"] == "failed", messages
        assert not any("completed successfully" in m for m in messages), messages

    async def test_the_loop_paints_failed_and_its_then_never_runs(
        self, kind: str, placement: str, then: bool
    ) -> None:
        session, messages = await _run(kind, placement, then)

        assert session["block_states"].get("loop") == "failed", session["block_states"]
        assert not any("LOOP-THEN" in m for m in messages), messages


@pytest.mark.parametrize("kind", LOOPS)
class TestABodyFailureInsideAFunction:
    async def test_the_run_ends_failed(self, kind: str) -> None:
        session, messages = await _run(kind, "function-body", False)

        assert session["status"] == "failed", messages


@pytest.mark.parametrize("kind", LOOPS)
class TestABodyFailureInsideATryPath:
    async def test_the_try_catch_catches_it_and_the_run_passes(self, kind: str) -> None:
        session, messages = await _run(kind, "try-path", False)

        assert session["status"] == "passed", messages
        assert any("Try-path error caught" in m for m in messages), messages
