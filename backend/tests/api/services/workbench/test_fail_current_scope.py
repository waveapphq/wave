"""Fail Current Scope on Assert and Wait Until, in every placement (REQ-3.3.1.5, REQ-3.5.4.3).

A split-mode Assert marks the innermost Test or Function body failed and the flow goes on down its
fail branch; no Try/Catch catches the mark. A single-mode Assert and a Wait Until that gives up
fail as a block: the flow stops there, a surrounding Try/Catch catches it, otherwise it ends the
Function (failed at its caller) or the Test. With the setting off nothing is marked or stopped.
"""

import re
import uuid
from dataclasses import dataclass
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    delay_node,
    edge,
    engine_registries,
    function_node,
    local_definition,
    log_messages,
    log_node,
    make_node,
    parallel_node,
    run_graph,
    try_catch_node,
    wait_node,
)
from tests.api.services.workbench.slot_harness import LOOP_OUTPUTS, Edges, Graph, Nodes, in_slot

pytestmark = pytest.mark.usefixtures("engine_registries")

WAIT_TIMEOUT_MS = 60
PLACEMENTS = ["test", "for-body", "parallel-lane", "try-path", "function-body", "function-in-try"]
STOPPING = ["assert-single", "wait-watch", "wait-retry"]
ERROR_BINDINGS = {"error": "err", "caught": "was_caught"}


@dataclass
class SubFlow:
    """A sub-flow entered at ``entry`` whose ``chk`` node carries the setting under test."""

    nodes: Nodes
    edges: Edges
    entry: str
    exit_id: str


def _assert(mode: str, fail_scope: bool) -> dict[str, Any]:
    return make_node(
        "chk",
        label="Assert",
        element_type="assert",
        config_values={
            "assertions": [{"type": "expression", "expression": "False"}],
            "mode": mode,
            "fail_current_scope": fail_scope,
        },
        name="Check",
    )


def _retry_wait(fail_scope: bool) -> dict[str, Any]:
    return make_node(
        "chk",
        label="Wait Until",
        element_type="wait-until",
        config_values={
            "conditions": [{"type": "expression", "expression": "False"}],
            "timeout": WAIT_TIMEOUT_MS,
            "check_interval": 10,
            "mode": "retry",
            "fail_current_scope": fail_scope,
        },
        name="Check",
    )


def _watch_wait(fail_scope: bool) -> dict[str, Any]:
    node = wait_node("chk", "False", name="Check", timeout=WAIT_TIMEOUT_MS)
    node["data"]["config"]["values"]["fail_current_scope"] = fail_scope
    return node


def _sub_flow(kind: str, fail_scope: bool = True) -> SubFlow:
    after_next = [log_node("next", "Next", "'NEXT'")]
    if kind == "assert-split":
        nodes = [
            _assert("split", fail_scope),
            log_node("cleanup", "Cleanup", "'CLEANUP'"),
            log_node("pass-log", "Pass Log", "'PASSED-BRANCH'"),
            *after_next,
        ]
        edges = [
            edge("chk", "cleanup", "fail"),
            edge("chk", "pass-log", "pass"),
            edge("cleanup", "next"),
        ]
        return SubFlow(nodes, edges, "chk", "next")
    if kind == "assert-single":
        return SubFlow(
            [_assert("single", fail_scope), *after_next], [edge("chk", "next")], "chk", "next"
        )
    if kind == "wait-watch":
        return SubFlow([_watch_wait(fail_scope), *after_next], [edge("chk", "next")], "chk", "next")
    probe = log_node("probe", "Probe", "'PROBE'")
    edges = [edge("chk", "probe", "retry"), edge("chk", "next", "then")]
    return SubFlow([_retry_wait(fail_scope), probe, *after_next], edges, "chk", "next")


def _catching_try(target: str) -> tuple[Nodes, Edges]:
    outer = try_catch_node("outer")
    outer["data"]["config"]["outputBindings"] = dict(ERROR_BINDINGS)
    nodes = [outer, log_node("catch", "Catch", "'CATCH'"), log_node("after", "After", "'AFTER'")]
    edges = [
        edge("start-node", "outer"),
        edge("outer", target, "try"),
        edge("outer", "catch", "catch"),
        edge("outer", "after", "then"),
    ]
    return nodes, edges


def _variables() -> dict[str, Any]:
    return {**LOOP_OUTPUTS, "err": None, "was_caught": None}


def _placed(sub: SubFlow, placement: str) -> Graph:
    after = log_node("after", "After", "'AFTER'")
    if placement == "test":
        edges = [edge("start-node", sub.entry), *sub.edges, edge(sub.exit_id, "after")]
        return Graph([*sub.nodes, after], edges, _variables())
    if placement in ("for-body", "function-body"):
        graph = in_slot(placement, sub.nodes, sub.edges, sub.entry, sub.exit_id)
        graph.variables.update(_variables())
        return graph
    if placement == "parallel-lane":
        outer = parallel_node("outer", [branch("b1", "Lane"), branch("b2", "Other")])
        nodes = [outer, *sub.nodes, log_node("other", "Other", "'OTHER'"), after]
        edges = [
            edge("start-node", "outer"),
            edge("outer", sub.entry, "b1"),
            edge("outer", "other", "b2"),
            edge("outer", "after", "then"),
            *sub.edges,
        ]
        return Graph(nodes, edges, _variables())
    if placement == "try-path":
        try_nodes, try_edges = _catching_try(sub.entry)
        return Graph([*try_nodes, *sub.nodes], [*try_edges, *sub.edges], _variables())
    definition = local_definition("Body", sub.nodes, [edge("start-node", sub.entry), *sub.edges])
    try_nodes, try_edges = _catching_try("fn")
    return Graph([*try_nodes, function_node("fn", definition)], try_edges, _variables())


async def _run(graph: Graph) -> tuple[dict[str, Any], list[str]]:
    session_id = f"fail-scope-{uuid.uuid4().hex[:10]}"
    session = await run_graph(session_id, graph.nodes, graph.edges, graph.variables)
    return session, log_messages(session_id)


def _logged(messages: list[str], text: str) -> bool:
    return any(text in message for message in messages)


@pytest.mark.parametrize("placement", PLACEMENTS)
class TestSplitAssertMarksTheScope:
    """The fail branch runs, nothing stops, the Test or Function ends failed."""

    async def test_the_fail_branch_runs_and_the_flow_goes_on(self, placement: str) -> None:
        _session, messages = await _run(_placed(_sub_flow("assert-split"), placement))

        assert _logged(messages, "CLEANUP"), messages
        assert _logged(messages, "NEXT"), messages
        assert not _logged(messages, "PASSED-BRANCH"), messages

    async def test_no_try_catch_runs_its_catch_path_for_it(self, placement: str) -> None:
        _session, messages = await _run(_placed(_sub_flow("assert-split"), placement))

        caught_by_function_boundary = placement == "function-in-try"
        assert _logged(messages, "CATCH") is caught_by_function_boundary, messages
        assert not _logged(messages, "Try-path scope-fail caught"), messages


class TestSplitAssertOutcomePerPlacement:
    @pytest.mark.parametrize("placement", ["test", "for-body", "parallel-lane", "try-path"])
    async def test_the_test_ends_failed_and_its_flow_still_reaches_the_end(
        self, placement: str
    ) -> None:
        session, messages = await _run(_placed(_sub_flow("assert-split"), placement))

        assert session["status"] == "failed", messages
        assert _logged(messages, "AFTER"), messages

    async def test_a_try_catch_leaves_the_mark_in_place(self) -> None:
        session, _messages = await _run(_placed(_sub_flow("assert-split"), "try-path"))

        assert session["scope_failed"] is True
        assert session["block_states"].get("catch") in (None, "skipped")

    async def test_a_function_body_mark_fails_the_function_and_stops_its_caller(self) -> None:
        session, messages = await _run(_placed(_sub_flow("assert-split"), "function-body"))

        assert session["block_states"]["outer"] == "failed"
        assert session["status"] == "failed", messages
        assert not _logged(messages, "AFTER"), messages

    async def test_a_try_catch_around_the_function_catches_the_failed_function(self) -> None:
        session, messages = await _run(_placed(_sub_flow("assert-split"), "function-in-try"))

        assert session["block_states"]["fn"] == "failed"
        assert session["variables"]["was_caught"] is True
        assert _logged(messages, "AFTER"), messages
        assert session["status"] == "passed", messages


@pytest.mark.parametrize("kind", STOPPING)
@pytest.mark.parametrize("placement", PLACEMENTS)
class TestABlockFailureStopsTheFlow:
    """The check paints failed and nothing after it in its flow runs."""

    async def test_the_check_paints_failed_and_the_next_block_never_runs(
        self, kind: str, placement: str
    ) -> None:
        session, messages = await _run(_placed(_sub_flow(kind), placement))

        assert session["block_states"]["chk"] == "failed", session["block_states"]
        assert not _logged(messages, "NEXT"), messages


@pytest.mark.parametrize("kind", STOPPING)
class TestABlockFailureOutcomePerPlacement:
    @pytest.mark.parametrize("placement", ["test", "for-body", "parallel-lane", "function-body"])
    async def test_uncaught_it_ends_the_test_failed_before_the_rest_of_the_flow(
        self, kind: str, placement: str
    ) -> None:
        session, messages = await _run(_placed(_sub_flow(kind), placement))

        assert session["status"] == "failed", messages
        assert not _logged(messages, "AFTER"), messages
        assert not _logged(messages, "completed successfully"), messages

    async def test_inside_a_function_the_function_fails_at_its_caller(self, kind: str) -> None:
        session, _messages = await _run(_placed(_sub_flow(kind), "function-body"))

        assert session["block_states"]["outer"] == "failed"

    @pytest.mark.parametrize("placement", ["try-path", "function-in-try"])
    async def test_a_surrounding_try_catch_catches_it_and_the_run_passes(
        self, kind: str, placement: str
    ) -> None:
        session, messages = await _run(_placed(_sub_flow(kind), placement))

        assert _logged(messages, "CATCH"), messages
        assert _logged(messages, "AFTER"), messages
        assert session["variables"]["was_caught"] is True
        assert session["status"] == "passed", messages
        assert session["scope_failed"] is False


class TestTheCaughtErrorNamesTheCheck:
    async def test_a_single_mode_assert_is_caught_as_an_assertion_error(self) -> None:
        session, _messages = await _run(_placed(_sub_flow("assert-single"), "try-path"))

        err = session["variables"]["err"]
        assert err["type"] == "AssertionError"
        assert re.match(r"^Assertion failed: 1 of 1 assertions failed$", err["message"])
        assert err["node_id"] == "chk"

    @pytest.mark.parametrize("kind", ["wait-watch", "wait-retry"])
    async def test_a_wait_until_is_caught_as_a_timeout(self, kind: str) -> None:
        session, _messages = await _run(_placed(_sub_flow(kind), "try-path"))

        err = session["variables"]["err"]
        assert err["type"] == "TimeoutError"
        assert re.match(r"^Gave up after \d+ ms: condition not met$", err["message"])
        assert err["node_id"] == "chk"

    async def test_the_run_log_carries_the_block_failure(self) -> None:
        _session, messages = await _run(_placed(_sub_flow("assert-single"), "test"))

        assert "Block 'Check' failed: Assertion failed: 1 of 1 assertions failed" in messages


class TestARetryLaneCutShortByTheDeadline:
    async def test_the_running_block_paints_stopped_then_the_wait_fails(self) -> None:
        wait = _retry_wait(True)
        nodes = [wait, delay_node("slow", 2000, "Slow"), log_node("next", "Next", "'NEXT'")]
        edges = [
            edge("start-node", "chk"),
            edge("chk", "slow", "retry"),
            edge("chk", "next", "then"),
        ]

        session, messages = await _run(Graph(nodes, edges, _variables()))

        assert session["block_states"]["slow"] == "stopped"
        assert session["block_states"]["chk"] == "failed"
        assert session["status"] == "failed", messages
        assert not _logged(messages, "NEXT"), messages


@pytest.mark.parametrize("kind", ["assert-single", "wait-watch", "wait-retry", "assert-split"])
@pytest.mark.parametrize("placement", ["test", "try-path", "function-body"])
class TestTheSettingOff:
    """A single-mode check only warns, a split Assert only routes; nothing is marked."""

    async def test_nothing_is_marked_and_the_run_passes(self, kind: str, placement: str) -> None:
        session, messages = await _run(_placed(_sub_flow(kind, fail_scope=False), placement))

        assert session["block_states"]["chk"] == "warning"
        assert _logged(messages, "NEXT"), messages
        assert not _logged(messages, "CATCH"), messages
        assert session["status"] == "passed", messages
        assert session["scope_failed"] is False


class TestATryCatchNeverClearsAMark:
    """A mark made before a Try/Catch survives a try path that fails and is caught."""

    async def test_the_run_still_ends_failed(self) -> None:
        split = _sub_flow("assert-split")
        try_nodes, try_edges = _catching_try("boom")
        nodes = [*split.nodes, *try_nodes, log_node("boom", "Boom", "1/0")]
        edges = [
            edge("start-node", "chk"),
            *split.edges,
            *[e for e in try_edges if e["source"] != "start-node"],
            edge("next", "outer"),
        ]

        session, messages = await _run(Graph(nodes, edges, _variables()))

        assert _logged(messages, "CATCH"), messages
        assert _logged(messages, "AFTER"), messages
        assert session["scope_failed"] is True
        assert session["status"] == "failed", messages


class TestAMarkLandsOnTheInnermostScope:
    """A mark lands on the Test or Function body that encloses the marking block."""

    async def test_a_sibling_lane_mark_is_not_taken_by_a_function_running_beside_it(self) -> None:
        body = [delay_node("wait-a-bit", 100, "Wait A Bit"), log_node("body-log", "Body", "'BODY'")]
        definition = local_definition(
            "Body", body, [edge("start-node", "wait-a-bit"), edge("wait-a-bit", "body-log")]
        )
        split = _sub_flow("assert-split")
        outer = parallel_node("outer", [branch("b1", "Function Lane"), branch("b2", "Check Lane")])
        nodes = [outer, function_node("fn", definition), *split.nodes, log_node("after", "After")]
        edges = [
            edge("start-node", "outer"),
            edge("outer", "fn", "b1"),
            edge("outer", "chk", "b2"),
            edge("outer", "after", "then"),
            *split.edges,
        ]

        session, messages = await _run(Graph(nodes, edges, _variables()))

        assert session["block_states"]["fn"] == "passed"
        assert session["scope_failed"] is True
        assert session["status"] == "failed", messages

    async def test_a_test_mark_made_before_a_caught_failing_function_survives(self) -> None:
        mark = _assert("split", True)
        mark["id"] = "mark"
        single = _sub_flow("assert-single")
        definition = local_definition(
            "Body", single.nodes, [edge("start-node", single.entry), *single.edges]
        )
        try_nodes, try_edges = _catching_try("fn")
        nodes = [mark, *try_nodes, function_node("fn", definition)]
        edges = [
            edge("start-node", "mark"),
            edge("mark", "outer", "fail"),
            *[e for e in try_edges if e["source"] != "start-node"],
        ]

        session, messages = await _run(Graph(nodes, edges, _variables()))

        assert session["block_states"]["fn"] == "failed"
        assert _logged(messages, "CATCH"), messages
        assert session["scope_failed"] is True
        assert session["status"] == "failed", messages
