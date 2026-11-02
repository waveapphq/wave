"""Ad-hoc runs on a Function at any depth start from the session state (REQ-3.2.1.5, REQ-3.2.1.1).

Run Scope on a Function nested in another Function's body, Run Current and Run from Here on a
block inside an opened Function body, and every ad-hoc run keeping what the last run left: the
Test's variables and, for a Function body, the instance's inputs, local variables and outputs.
Reset is the way to start clean. Driven through the workbench service and the real engine.
"""

import asyncio
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager, suppress
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    function_node,
    local_definition,
    log_messages,
    log_node,
    setter_node,
    wait_until_paused,
)
from tests.api.services.workbench.test_adhoc_in_remote_body import _Hosts
from tests.api.services.workbench.test_remote_exec_body_contents import (
    HOST,
    HOST_SESSION,
    http_node,
    rex_node,
)
from tests.api.services.workbench.test_variable_push_on_write import _paths, _push_recorder
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.plugins.http_client import HTTPClientPlugin

Nodes = list[dict[str, Any]]
Edges = list[dict[str, Any]]
TEST_ID = "adhoc-fn-body-test"
ENVIRONMENT = {"id": "env-1", "name": "Env"}
ADVISORY = (
    "Clean scope state - the Function ran with declared default values for its inputs "
    "(no prior Test run to inherit from)."
)
MARKERS = ("outer-first:", "outer-log:", "inner-log:", "inner-read:", "after:", "fn-log:")


@pytest.fixture(autouse=True)
def _registries(engine_registries: Any) -> Iterator[None]:  # noqa: F811
    from wavecore.core.plugin_registry import register_plugin

    register_plugin(HTTPClientPlugin())
    workbench_service._user_active_session.clear()
    yield
    workbench_service._user_active_session.clear()


def _setter(node_id: str, values: dict[str, str]) -> dict[str, Any]:
    return setter_node(node_id, node_id, values, expressions=True)


def _definition(
    name: str,
    nodes: Nodes,
    edges: Edges,
    *,
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    variables: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    definition = local_definition(name, nodes, edges)
    definition["inputs"] = inputs or []
    definition["outputs"] = outputs or []
    definition["variables"] = variables or []
    return definition


def _instance(node_id: str, definition: dict[str, Any], bindings: dict[str, str]) -> dict[str, Any]:
    node = function_node(node_id, definition)
    node["data"]["config"]["values"] = dict(bindings)
    node["data"]["expressionFields"] = list(bindings)
    return node


def _inner_definition() -> dict[str, Any]:
    """inner-set -> inner-log -> inner-bump -> inner-out -> inner-read."""
    nodes = [
        _setter("inner-set", {"i_local": "b + '-inner'"}),
        log_node("inner-log", "inner-log", "'inner-log:' + i_local + ':' + b"),
        _setter("inner-bump", {"i_local": "i_local + '+'"}),
        _setter("inner-out", {"i_out": "'produced'"}),
        log_node("inner-read", "inner-read", "'inner-read:' + i_local + ':' + i_out"),
    ]
    edges = [
        edge("start-node", "inner-set"),
        edge("inner-set", "inner-log"),
        edge("inner-log", "inner-bump"),
        edge("inner-bump", "inner-out"),
        edge("inner-out", "inner-read"),
    ]
    return _definition(
        "Inner",
        nodes,
        edges,
        inputs=[{"name": "b", "type": "string", "default": "b-default"}],
        outputs=[{"name": "i_out", "type": "string", "default": "out-default"}],
        variables=[{"name": "i_local", "type": "string", "value": "i-init"}],
    )


def _nested_graph() -> tuple[Nodes, Edges]:
    """set-seed -> outer (outer-first -> outer-set -> inner -> outer-log) -> after."""
    outer_nodes = [
        log_node("outer-first", "outer-first", "'outer-first:' + a"),
        _setter("outer-set", {"o_local": "'outer-run'"}),
        _instance("inner", _inner_definition(), {"b": "a + '-b'"}),
        log_node("outer-log", "outer-log", "'outer-log:' + o_local"),
    ]
    outer_edges = [
        edge("start-node", "outer-first"),
        edge("outer-first", "outer-set"),
        edge("outer-set", "inner"),
        edge("inner", "outer-log"),
    ]
    outer = _definition(
        "Outer",
        outer_nodes,
        outer_edges,
        inputs=[{"name": "a", "type": "string", "default": "a-default"}],
        variables=[{"name": "o_local", "type": "string", "value": "o-init"}],
    )
    nodes = [
        _setter("set-seed", {"seed": "'from-run'"}),
        _instance("outer", outer, {"a": "seed"}),
        log_node("after", "after", "'after:' + seed"),
    ]
    edges = [
        edge("start-node", "set-seed"),
        edge("set-seed", "outer"),
        edge("outer", "after"),
    ]
    return nodes, edges


def _no_input_graph() -> tuple[Nodes, Edges]:
    """set-seed -> plain (fn-log) -> after, where the Function declares no inputs."""
    plain = _definition(
        "Plain",
        [log_node("fn-log", "fn-log", "'fn-log:' + p_local")],
        [edge("start-node", "fn-log")],
        variables=[{"name": "p_local", "type": "string", "value": "p-init"}],
    )
    nodes = [
        _setter("set-seed", {"seed": "'from-run'"}),
        _instance("plain", plain, {}),
        log_node("after", "after", "'after:' + seed"),
    ]
    edges = [edge("start-node", "set-seed"), edge("set-seed", "plain"), edge("plain", "after")]
    return nodes, edges


def _record(nodes: Nodes, edges: Edges) -> dict[str, Any]:
    return {
        "id": TEST_ID,
        "name": "Adhoc Function Body",
        "variables": {"seed": {"type": "string", "value": "declared-seed"}},
        "workflow": {"nodes": nodes, "edges": edges},
    }


@contextmanager
def _stored(graph: tuple[Nodes, Edges]) -> Iterator[None]:
    record = _record(*graph)
    with (
        patch.object(workbench_service.test_service, "get_test", return_value=record),
        patch.object(
            workbench_service.test_service,
            "get_test_variables_raw",
            return_value=record["variables"],
        ),
        patch.object(workbench_service.test_service, "validate_test", return_value=None),
        patch.object(
            workbench_service.environment_service, "get_environment", return_value=ENVIRONMENT
        ),
    ):
        yield


class _Run:
    """One finished run: its session, response and the marker lines it logged."""

    def __init__(self, started: dict[str, Any]) -> None:
        self.started = started
        self.session_id = started["session_id"]
        self.session = _wb_common._workbench_sessions[self.session_id]

    @property
    def markers(self) -> list[str]:
        return [m for m in log_messages(self.session_id) if m.startswith(MARKERS)]

    @property
    def warning_types(self) -> list[str]:
        return [w.get("type", "") for w in self.started.get("warnings") or []]

    @property
    def advisory_messages(self) -> list[str]:
        return [
            w.get("message", "")
            for w in self.started.get("warnings") or []
            if w.get("type") == "SCOPED_RUN_ADVISORY"
        ]


async def _start(**kwargs: Any) -> _Run:
    started = workbench_service.start_workbench_run(
        test_id=TEST_ID, environment_id=ENVIRONMENT["id"], **kwargs
    )
    await asyncio.wait_for(_wb_common._active_tasks[started["session_id"]], timeout=10)
    return _Run(started)


async def _full_run() -> _Run:
    run = await _start()
    assert run.session["status"] == "passed", log_messages(run.session_id)
    return run


async def _run_scope(function_id: str, path: tuple[str, ...] = ()) -> _Run:
    return await _start(
        scope=workbench_service.ScopedRunOptions(
            mode="function", function_node_id=function_id, function_path=path
        )
    )


async def _run_current(node_id: str, path: tuple[str, ...] = ()) -> _Run:
    return await _start(
        target=workbench_service.RunTarget(single_node_id=node_id),
        scope=workbench_service.ScopedRunOptions(function_path=path),
    )


async def _run_from_here(node_id: str, path: tuple[str, ...] = ()) -> _Run:
    return await _start(
        target=workbench_service.RunTarget(start_node_id=node_id),
        scope=workbench_service.ScopedRunOptions(function_path=path),
    )


class TestRunScopeOnANestedFunction:
    """Run Scope on a Function inside another Function's body runs that Function."""

    async def test_it_runs_with_the_inputs_and_locals_its_instance_last_had(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            run = await _run_scope("inner", ("outer",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == [
            "inner-log:from-run-b-inner:from-run-b",
            "inner-read:from-run-b-inner+:produced",
        ]
        assert run.session["scoped_result"]["outputs"] == {"i_out": "produced"}
        assert run.session["block_states"]["inner"] == "passed"
        assert "SCOPED_RUN_ADVISORY" not in run.warning_types

    async def test_with_no_run_in_the_session_it_uses_defaults_and_the_advisory(self) -> None:
        with _stored(_nested_graph()):
            run = await _run_scope("inner", ("outer",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == [
            "inner-log:b-default-inner:b-default",
            "inner-read:b-default-inner+:produced",
        ]
        assert run.advisory_messages == [ADVISORY]

    async def test_it_runs_on_the_session_id_the_page_subscribed_to(self) -> None:
        with _stored(_nested_graph()):
            run = await _start(
                session_id="page-session-1",
                scope=workbench_service.ScopedRunOptions(
                    mode="function", function_node_id="inner", function_path=("outer",)
                ),
            )

        assert run.session_id == "page-session-1"
        assert run.session["status"] == "passed", log_messages(run.session_id)

    async def test_an_unknown_function_on_the_path_is_refused(self) -> None:
        with _stored(_nested_graph()), pytest.raises(LookupError) as refused:
            await _run_scope("inner", ("missing",))

        assert str(refused.value) == f"Function block 'missing' not found in Test '{TEST_ID}'"

    async def test_a_top_level_run_scope_takes_the_inputs_its_instance_last_had(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            run = await _run_scope("outer")

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers[0] == "outer-first:from-run"
        assert run.markers[-1] == "outer-log:outer-run"


class TestRunCurrentInsideAFunctionBody:
    """Run Current on a block in an opened Function body runs that block in the instance."""

    async def test_it_runs_only_that_block_with_the_last_run_inputs_and_locals(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            run = await _run_current("inner-log", ("outer", "inner"))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["inner-log:from-run-b-inner+:from-run-b"]

    async def test_outputs_from_the_last_run_are_visible(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            run = await _run_current("inner-read", ("outer", "inner"))

        assert run.markers == ["inner-read:from-run-b-inner+:produced"]

    async def test_a_block_in_the_top_level_function_body_runs_in_its_instance(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            run = await _run_current("outer-log", ("outer",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["outer-log:outer-run"]

    async def test_an_unknown_block_in_the_body_is_refused(self) -> None:
        with _stored(_nested_graph()), pytest.raises(LookupError) as refused:
            await _run_current("after", ("outer",))

        assert str(refused.value) == "block not found in workflow"


class TestRunFromHereInsideAFunctionBody:
    """Run from Here on a block in an opened Function body runs through the rest of that body."""

    async def test_it_runs_the_rest_of_the_body_and_nothing_before_or_after_it(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            run = await _run_from_here("inner", ("outer",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == [
            "inner-log:from-run-b-inner:from-run-b",
            "inner-read:from-run-b-inner+:produced",
            "outer-log:outer-run",
        ]

    async def test_it_starts_mid_body_at_depth_two(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            run = await _run_from_here("inner-bump", ("outer", "inner"))

        assert run.markers == ["inner-read:from-run-b-inner++:produced"]


class TestAnInstanceTheLastRunDidNotReach:
    """With no scope of its own, an instance reads its bindings over its caller's last state."""

    async def test_a_top_level_instance_reads_its_bindings_over_the_test_variables(self) -> None:
        with _stored(_nested_graph()):
            await _run_current("set-seed")
            run = await _run_scope("outer")

        assert run.markers[0] == "outer-first:from-run"
        assert "SCOPED_RUN_ADVISORY" not in run.warning_types

    async def test_a_nested_instance_reads_its_bindings_over_its_callers_scope(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            workbench_service.clear_session_for_user()
            await _run_current("outer-log", ("outer",))
            run = await _run_scope("inner", ("outer",))

        assert run.markers[0] == "inner-log:a-default-b-inner:a-default-b"
        assert "SCOPED_RUN_ADVISORY" not in run.warning_types

    async def test_a_nested_instance_whose_caller_never_ran_starts_from_defaults(self) -> None:
        with _stored(_nested_graph()):
            await _run_current("set-seed")
            run = await _run_scope("inner", ("outer",))

        assert run.markers[0] == "inner-log:b-default-inner:b-default"
        assert run.advisory_messages == [ADVISORY]


class TestTheCleanScopeAdvisory:
    """The advisory shows only when the run has no earlier state to start from, whatever
    inputs the Function declares (REQ-3.2.1.1)."""

    async def test_a_function_with_no_inputs_whose_outer_flow_ran_gets_no_advisory(self) -> None:
        with _stored(_no_input_graph()):
            await _run_current("set-seed")
            run = await _run_scope("plain")

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:p-init"]
        assert "SCOPED_RUN_ADVISORY" not in run.warning_types
        assert run.session["scoped_result"]["advisory"] is None

    async def test_a_function_with_no_inputs_and_no_earlier_run_gets_the_advisory(self) -> None:
        with _stored(_no_input_graph()):
            run = await _run_scope("plain")

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.advisory_messages == [ADVISORY]
        assert run.session["scoped_result"]["advisory"] == ADVISORY

    async def test_a_function_with_inputs_and_no_earlier_run_reports_the_advisory_once(
        self,
    ) -> None:
        with _stored(_nested_graph()):
            run = await _run_scope("outer")

        assert run.advisory_messages == [ADVISORY]
        assert run.session["scoped_result"]["advisory"] == ADVISORY


class TestAFailureInsideTheBody:
    """A block that fails inside the body fails the ad-hoc run with its reason."""

    async def test_run_current_on_a_failing_block_fails_the_run(self) -> None:
        body = [log_node("boom", "boom", "1/0")]
        definition = _definition("Fails", body, [edge("start-node", "boom")])
        graph = ([_instance("fn", definition, {})], [edge("start-node", "fn")])
        with _stored(graph):
            run = await _run_current("boom", ("fn",))

        assert run.session["status"] == "failed"
        assert run.session["error"] == "Expression evaluation failed for '1/0': division by zero"
        assert "fn" not in run.session["block_states"]

    async def test_a_function_on_the_path_that_cannot_load_is_refused(self) -> None:
        missing = function_node("gone", local_definition("Gone", [], []))
        missing["data"] = {**missing["data"], "functionLifecycle": "shared", "functionId": ""}
        graph = ([missing], [edge("start-node", "gone")])
        with _stored(graph), pytest.raises(LookupError) as refused:
            await _run_current("anything", ("gone",))

        assert str(refused.value) == "Shared Function block missing functionId"


def _required_input_graph() -> tuple[Nodes, Edges]:
    """fn (Required input who, bound to 'caller' at the call) -> who-log."""
    body = [log_node("who-log", "who-log", "'who:' + who")]
    definition = _definition(
        "Needs Who",
        body,
        [edge("start-node", "who-log")],
        inputs=[{"name": "who", "type": "string", "required": True}],
    )
    return [_instance("fn", definition, {"who": "'caller'"})], [edge("start-node", "fn")]


def _refusal_lines(run: _Run) -> list[dict[str, Any]]:
    from wavecore.api.services import log_streaming_service

    return [
        entry
        for entry in log_streaming_service.get_logs(run.session_id)
        if isinstance(entry, dict) and str(entry.get("message", "")).startswith("Block 'fn' failed")
    ]


def _debug() -> workbench_service.DebugRunOptions:
    return workbench_service.DebugRunOptions(breakpoints=[], options={})


AD_HOC_RUNS = {
    "run current": {"target": workbench_service.RunTarget(single_node_id="who-log")},
    "run from here": {"target": workbench_service.RunTarget(start_node_id="who-log")},
    "debug current": {
        "target": workbench_service.RunTarget(single_node_id="who-log"),
        "debug": _debug(),
    },
    "debug from here": {
        "target": workbench_service.RunTarget(start_node_id="who-log"),
        "debug": _debug(),
    },
}


class TestARequiredInputWithNoValueStopsABlockRun:
    """A block run inside a body whose Required input has no value names it on the console,
    as Run Scope does (FNCFG-8)."""

    @pytest.mark.parametrize("kind", list(AD_HOC_RUNS))
    async def test_the_run_fails_and_the_console_names_the_input(self, kind: str) -> None:
        with _stored(_required_input_graph()):
            run = await _start(
                scope=workbench_service.ScopedRunOptions(function_path=("fn",)),
                **AD_HOC_RUNS[kind],
            )

        assert run.session["status"] == "failed"
        assert run.session["error"] == "'who' is null"
        lines = _refusal_lines(run)
        assert [line["message"] for line in lines] == ["Block 'fn' failed: 'who' is null"]
        assert lines[0]["level"] == "ERROR"
        assert lines[0]["source"] == "SYSTEM"
        assert lines[0]["blockId"] == "fn"
        assert not any(m.startswith("who:") for m in log_messages(run.session_id))

    async def test_run_scope_names_it_on_the_same_line(self) -> None:
        with _stored(_required_input_graph()):
            run = await _run_scope("fn")

        assert [line["message"] for line in _refusal_lines(run)] == [
            "Block 'fn' failed: 'who' is null"
        ]

    async def test_a_block_failing_in_the_body_adds_no_function_line(self) -> None:
        body = [log_node("boom", "boom", "1/0")]
        definition = _definition("Fails", body, [edge("start-node", "boom")])
        graph = ([_instance("fn", definition, {})], [edge("start-node", "fn")])
        with _stored(graph):
            run = await _run_current("boom", ("fn",))

        assert run.session["status"] == "failed"
        assert _refusal_lines(run) == []


class TestEachAdhocRunStartsWhereTheLastOneEnded:
    """What an ad-hoc run in a body leaves is the state the next ad-hoc run starts from."""

    async def test_locals_carry_from_one_adhoc_run_to_the_next(self) -> None:
        path = ("outer", "inner")
        with _stored(_nested_graph()):
            await _full_run()
            await _run_current("inner-bump", path)
            first = await _run_current("inner-read", path)
            await _run_current("inner-bump", path)
            second = await _run_current("inner-read", path)

        assert first.markers == ["inner-read:from-run-b-inner++:produced"]
        assert second.markers == ["inner-read:from-run-b-inner+++:produced"]

    async def test_a_run_scope_leaves_its_scope_for_a_run_current(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            await _run_scope("inner", ("outer",))
            run = await _run_current("inner-read", ("outer", "inner"))

        assert run.markers == ["inner-read:from-run-b-inner+:produced"]


class TestResetStartsClean:
    """After Reset an ad-hoc run in a body starts from declared defaults with the advisory."""

    async def test_after_reset_inputs_and_locals_are_their_declared_defaults(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            workbench_service.clear_session_for_user()
            run = await _run_current("inner-read", ("outer", "inner"))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["inner-read:i-init:out-default"]
        assert run.advisory_messages == [ADVISORY]

    async def test_with_no_run_in_the_session_it_starts_from_defaults(self) -> None:
        with _stored(_nested_graph()):
            run = await _run_current("inner-log", ("outer", "inner"))

        assert run.markers == ["inner-log:i-init:b-default"]
        assert run.advisory_messages == [ADVISORY]


class TestTestLevelAdhocRunsKeepTheState:
    """A Test-level Run Current or Run from Here reads what the last run left, after any other."""

    async def test_run_current_reads_the_last_full_run(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            run = await _run_current("after")

        assert run.markers == ["after:from-run"]

    async def test_run_current_after_a_run_scope_still_reads_the_run_values(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            await _run_scope("outer")
            run = await _run_current("after")

        assert run.markers == ["after:from-run"]

    async def test_run_from_here_after_a_run_current_in_a_body_still_reads_them(self) -> None:
        with _stored(_nested_graph()):
            await _full_run()
            await _run_current("inner-log", ("outer", "inner"))
            run = await _run_from_here("after")

        assert run.markers == ["after:from-run"]


_LOCALS = {"plain": "first", "kept": "k-first", "same": "s-first"}


def _locals_graph(declared: dict[str, str]) -> tuple[Nodes, Edges]:
    """fn (write -> read) -> after: a block writes 'kept' and 'same', nothing writes 'plain'."""
    body = [
        _setter("write", {"kept": "'written'", "same": "'s-first'"}),
        log_node("read", "read", "'fn-log:' + plain + ':' + kept + ':' + same"),
    ]
    definition = _definition(
        "Locals",
        body,
        [edge("start-node", "write"), edge("write", "read")],
        variables=[
            {"name": name, "type": "string", "value": value} for name, value in declared.items()
        ],
    )
    nodes = [_instance("fn", definition, {}), log_node("after", "after", "'after:done'")]
    return nodes, [edge("start-node", "fn"), edge("fn", "after")]


async def _read_with(declared: dict[str, str]) -> _Run:
    """Run Current on the reading block, with the Function's local variables declared as given."""
    with _stored(_locals_graph(declared)):
        return await _run_current("read", ("fn",))


class TestAFunctionLocalVariableTheSessionGaveNoValue:
    """It follows its definition, so an edit made after the last run is used (REQ-3.2.1.5)."""

    async def test_an_edited_value_reaches_the_next_block_run(self) -> None:
        with _stored(_locals_graph(_LOCALS)):
            await _full_run()

        run = await _read_with({**_LOCALS, "plain": "second"})

        assert run.markers == ["fn-log:second:written:s-first"]

    async def test_every_later_edit_reaches_the_next_block_run(self) -> None:
        with _stored(_locals_graph(_LOCALS)):
            await _full_run()
        await _read_with({**_LOCALS, "plain": "second"})

        run = await _read_with({**_LOCALS, "plain": "third"})

        assert run.markers == ["fn-log:third:written:s-first"]

    async def test_an_edited_value_reaches_the_next_run_scope(self) -> None:
        with _stored(_locals_graph(_LOCALS)):
            await _full_run()
        with _stored(_locals_graph({**_LOCALS, "plain": "second"})):
            run = await _run_scope("fn")

        assert run.markers == ["fn-log:second:written:s-first"]

    async def test_a_removed_variable_is_gone_from_the_next_block_run(self) -> None:
        with _stored(_locals_graph(_LOCALS)):
            await _full_run()

        run = await _read_with({"kept": "k-first", "same": "s-first"})

        assert run.session["status"] == "failed"
        assert run.session["error"] == "Variable 'plain' is not defined"

    async def test_an_edit_reaches_the_block_run_after_one_that_started_clean(self) -> None:
        first = await _read_with(_LOCALS)

        second = await _read_with({**_LOCALS, "plain": "second"})

        assert first.markers == ["fn-log:first:k-first:s-first"]
        assert second.markers == ["fn-log:second:k-first:s-first"]

    async def test_an_edit_reaches_an_instance_the_last_run_did_not_reach(self) -> None:
        with _stored(_locals_graph(_LOCALS)):
            await _run_current("after")
        await _read_with(_LOCALS)

        run = await _read_with({**_LOCALS, "plain": "second"})

        assert run.markers == ["fn-log:second:k-first:s-first"]


class TestAFunctionLocalVariableABlockWrote:
    """It keeps the block's value through later ad-hoc runs, whatever its definition says."""

    async def test_the_value_outlives_an_edited_definition(self) -> None:
        with _stored(_locals_graph(_LOCALS)):
            await _full_run()

        run = await _read_with({**_LOCALS, "kept": "k-second"})

        assert run.markers == ["fn-log:first:written:s-first"]

    async def test_it_stays_through_every_later_block_run(self) -> None:
        with _stored(_locals_graph(_LOCALS)):
            await _full_run()
        await _read_with(_LOCALS)

        run = await _read_with({**_LOCALS, "kept": "k-second"})

        assert run.markers == ["fn-log:first:written:s-first"]

    async def test_a_block_that_wrote_the_value_it_already_had_gave_it_a_value(self) -> None:
        with _stored(_locals_graph(_LOCALS)):
            await _full_run()

        run = await _read_with({**_LOCALS, "same": "s-second"})

        assert run.markers == ["fn-log:first:written:s-first"]


class TestTheLocalVariablesAFunctionBodyRunAnnounces:
    """The panel is told only the values the session gave, so the row of a local variable
    no block wrote keeps showing its definition (REQ-3.2.1.5, REQ-3.1.3.12)."""

    @staticmethod
    def _announced(pushes: AsyncMock) -> list[str]:
        return [path for path in _paths(pushes) if path in _LOCALS]

    async def test_a_run_that_started_clean_announces_no_local_variable(self) -> None:
        with _push_recorder() as pushes:
            await _read_with(_LOCALS)

        assert self._announced(pushes) == []

    async def test_a_later_run_announces_the_ones_a_block_wrote(self) -> None:
        with _stored(_locals_graph(_LOCALS)):
            await _full_run()

        with _push_recorder() as pushes:
            await _read_with(_LOCALS)

        assert self._announced(pushes) == ["kept", "same"]


_HOST_B = {"host": {"type": "string", "value": "b"}}
_URL_EXPRESSION = {"url": {"type": "string", "value": "'http://' + host", "isExpression": True}}
_URL_TEMPLATE = {"url": {"type": "string", "value": "http://{{ host }}", "isTemplate": True}}


_EACH_COMPUTED_KIND = pytest.mark.parametrize(
    "url", [_URL_EXPRESSION, _URL_TEMPLATE], ids=["expression", "template"]
)


def _bound_input_graph() -> tuple[Nodes, Edges]:
    """first (reads url) -> fn (its input 'a' is bound to url; read logs it) -> after."""
    definition = _definition(
        "ReadsInput",
        [log_node("read", "read", "'fn-log:' + a")],
        [edge("start-node", "read")],
        inputs=[{"name": "a", "type": "string", "default": "a-default"}],
    )
    nodes = [
        log_node("first", "first", "'outer-first:' + url"),
        _instance("fn", definition, {"a": "url"}),
        log_node("after", "after", "'after:done'"),
    ]
    return nodes, [edge("start-node", "fn"), edge("fn", "after"), edge("after", "first")]


@contextmanager
def _declared(variables: dict[str, Any]) -> Iterator[None]:
    """The bound-input Test stored with ``variables`` as its declarations."""
    with (
        _stored(_bound_input_graph()),
        patch.object(
            workbench_service.test_service, "get_test_variables_raw", return_value=variables
        ),
    ):
        yield


class TestAFunctionInputBoundToAComputedVariable:
    """The input receives the variable's value, evaluated when the binding reads it."""

    @_EACH_COMPUTED_KIND
    async def test_a_full_run_evaluates_a_variable_no_block_read_yet(
        self, url: dict[str, Any]
    ) -> None:
        with _declared({**_HOST_B, **url}):
            run = await _full_run()

        assert run.markers == ["fn-log:http://b", "after:done", "outer-first:http://b"]

    async def test_a_full_run_evaluates_the_variable_it_reads_in_turn(self) -> None:
        host = {"host": {"type": "string", "value": "'b' + 'c'", "isExpression": True}}
        with _declared({**host, **_URL_EXPRESSION}):
            run = await _full_run()

        assert run.markers[0] == "fn-log:http://bc"

    @_EACH_COMPUTED_KIND
    async def test_a_block_run_in_the_body_evaluates_a_variable_no_block_read_yet(
        self, url: dict[str, Any]
    ) -> None:
        with _declared({**_HOST_B, **url}):
            await _run_current("after")
            run = await _run_current("read", ("fn",))

        assert run.markers == ["fn-log:http://b"]
        assert dict(run.session["variables"])["url"] == "http://b"

    async def test_a_block_run_in_the_body_evaluates_a_result_that_is_due_again(self) -> None:
        with _declared({**_HOST_B, **_URL_EXPRESSION}):
            first = await _run_current("first")
        with _declared({"host": {"type": "string", "value": "c"}, **_URL_EXPRESSION}):
            run = await _run_current("read", ("fn",))

        assert first.markers == ["outer-first:http://b"]
        assert run.markers == ["fn-log:http://c"]


def _function_in_remote_body() -> tuple[Nodes, Edges]:
    """rex (remote host) body: fn (fn-in on the remote host -> fn-log on WAVE)."""
    body = [http_node("fn-in", "/fn-in"), log_node("fn-log", "fn-log", "'fn-log:ran'")]
    definition = _definition(
        "BodyFunction", body, [edge("start-node", "fn-in"), edge("fn-in", "fn-log")]
    )
    nodes = [rex_node("rex", HOST_SESSION, "rsid"), _instance("fn", definition, {})]
    edges = [edge("start-node", "rex"), edge("rex", "fn", "body")]
    return nodes, edges


def _open_sessions(hosts: _Hosts) -> None:
    """A finished run of the Test that left its SSH sessions open."""
    earlier = "earlier-remote-run"
    _wb_common._workbench_sessions[earlier] = {
        "session_id": earlier,
        "test_id": TEST_ID,
        "user_id": _wb_common.DEFAULT_USER_ID,
        "status": "passed",
        "started_at": "2026-09-15T10:00:00+00:00",
        "variables": {},
        "block_states": {},
        "ssh_session_registry": hosts.registry(),
    }
    workbench_service._user_active_session[_wb_common.DEFAULT_USER_ID] = earlier


class TestInsideARemoteExecutionBody:
    """A block in a Function whose instance sits in a Remote Execution body uses its remote host."""

    async def test_run_current_on_a_remotable_block_uses_the_body_worker(self) -> None:
        hosts = _Hosts()
        _open_sessions(hosts)
        with _stored(_function_in_remote_body()), hosts.patched():
            run = await _run_current("fn-in", ("fn",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert hosts.events == [f"open:{HOST}", f"run:{HOST}:/fn-in", f"close:{HOST}"]
        hosts.local_http.assert_not_awaited()

    async def test_run_scope_of_a_function_nested_in_a_function_in_the_body_uses_it(self) -> None:
        inner = _definition("Inner", [http_node("deep", "/deep")], [edge("start-node", "deep")])
        outer = _definition("Outer", [_instance("inner", inner, {})], [edge("start-node", "inner")])
        nodes = [rex_node("rex", HOST_SESSION, "rsid"), _instance("outer", outer, {})]
        graph = (nodes, [edge("start-node", "rex"), edge("rex", "outer", "body")])
        hosts = _Hosts()
        _open_sessions(hosts)
        with _stored(graph), hosts.patched():
            run = await _run_scope("inner", ("outer",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert hosts.events == [f"open:{HOST}", f"run:{HOST}:/deep", f"close:{HOST}"]

    async def test_a_body_in_the_function_reads_its_session_from_the_instance_scope(self) -> None:
        body = [rex_node("inner-rex", "sid", "rsid", expression=True), http_node("deep", "/deep")]
        definition = _definition(
            "HoldsBody",
            body,
            [edge("start-node", "inner-rex"), edge("inner-rex", "deep", "body")],
            inputs=[{"name": "sid", "type": "string", "default": "unset-session"}],
        )
        graph = ([_instance("fn", definition, {"sid": "'unused'"})], [edge("start-node", "fn")])
        hosts = _Hosts()
        _open_sessions(hosts)
        earlier = _wb_common._workbench_sessions["earlier-remote-run"]
        earlier["function_scopes"] = {("fn",): {"sid": HOST_SESSION}}
        with _stored(graph), hosts.patched():
            run = await _run_current("deep", ("fn",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert hosts.events == [f"open:{HOST}", f"run:{HOST}:/deep", f"close:{HOST}"]

    async def test_run_current_on_a_wave_block_needs_no_session(self) -> None:
        hosts = _Hosts(live=())
        with _stored(_function_in_remote_body()), hosts.patched():
            run = await _run_current("fn-log", ("fn",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:ran"]
        assert hosts.events == []

    async def test_a_block_in_a_function_in_the_body_reads_the_host_from_a_test_variable(
        self,
    ) -> None:
        definition = _definition(
            "InBody", [http_node("fn-in", "/fn-in")], [edge("start-node", "fn-in")]
        )
        nodes = [rex_node("rex", "sid", "rsid", expression=True), _instance("fn", definition, {})]
        graph = (nodes, [edge("start-node", "rex"), edge("rex", "fn", "body")])
        declared = {"sid": {"type": "string", "value": HOST_SESSION}}
        hosts = _Hosts()
        _open_sessions(hosts)
        with (
            _stored(graph),
            patch.object(
                workbench_service.test_service, "get_test_variables_raw", return_value=declared
            ),
            hosts.patched(),
        ):
            run = await _run_current("fn-in", ("fn",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert hosts.events == [f"open:{HOST}", f"run:{HOST}:/fn-in", f"close:{HOST}"]


_SHADOWED = {"shared": {"type": "string", "value": "test-value"}}


def _shadow_graph() -> tuple[Nodes, Edges]:
    """fn (mark -> read; its local 'shared' shadows the Test variable 'shared') -> after."""
    body = [
        _setter("mark", {"marker": "'set'"}),
        log_node("read", "read", "'fn-log:' + shared + ':' + marker"),
    ]
    definition = _definition(
        "Shadows",
        body,
        [edge("start-node", "mark"), edge("mark", "read")],
        variables=[
            {"name": "shared", "type": "string", "value": "fn-init"},
            {"name": "marker", "type": "string", "value": "unset"},
        ],
    )
    nodes = [_instance("fn", definition, {}), log_node("after", "after", "'after:' + shared")]
    return nodes, [edge("start-node", "fn"), edge("fn", "after")]


def _input_output_graph() -> tuple[Nodes, Edges]:
    """fn (mark -> read; read logs its input 'given' and its output 'made')."""
    body = [
        _setter("mark", {"marker": "'set'"}),
        log_node("read", "read", "'fn-log:' + given + ':' + made"),
    ]
    definition = _definition(
        "Params",
        body,
        [edge("start-node", "mark"), edge("mark", "read")],
        inputs=[{"name": "given", "type": "string", "default": "given-default"}],
        outputs=[{"name": "made", "type": "string", "default": "made-default"}],
        variables=[{"name": "marker", "type": "string", "value": "unset"}],
    )
    return [_instance("fn", definition, {"given": "'from-call'"})], [edge("start-node", "fn")]


@contextmanager
def _shadowed(graph: tuple[Nodes, Edges] | None = None) -> Iterator[None]:
    """The shadow Test (or ``graph``) stored with its own Test variable 'shared'."""
    graph = graph or _shadow_graph()
    record = {**_record(*graph), "variables": _SHADOWED}
    tests = workbench_service.test_service
    with (
        _stored(graph),
        patch.object(tests, "get_test", return_value=record),
        patch.object(tests, "get_test_variables_raw", return_value=_SHADOWED),
    ):
        yield


class _Paused:
    """A Debug run of the shadow Test parked before the Function's 'read' block."""

    def __init__(self, started: dict[str, Any]) -> None:
        self.started = started
        self.session_id = str(started["session_id"])

    async def resume(self) -> _Run:
        workbench_service.continue_session(self.session_id)
        await asyncio.wait_for(_wb_common._active_tasks[self.session_id], timeout=10)
        return _Run(self.started)


@asynccontextmanager
async def _paused_in_function() -> AsyncIterator[_Paused]:
    """Debug the shadow Test to its stop before 'read'; stop whatever is left at the end."""
    started = workbench_service.start_workbench_run(
        test_id=TEST_ID,
        environment_id=ENVIRONMENT["id"],
        debug=workbench_service.DebugRunOptions(breakpoints=["read"], options={}),
    )
    session = _wb_common._workbench_sessions[started["session_id"]]
    task = _wb_common._active_tasks[started["session_id"]]
    try:
        await wait_until_paused(session, "read")
        assert session["status"] == "paused", log_messages(started["session_id"])
        yield _Paused(started)
    finally:
        if not task.done():
            session["status"] = "stopped"
            session["pause_event"].set()
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await asyncio.wait_for(task, timeout=2)


def _edit_current(
    session_id: str,
    name: str,
    *,
    path: tuple[str, ...] = (),
    value: str | None = None,
    expression: str | None = None,
) -> dict[str, Any]:
    """A Current edit of a string value: a literal, or an expression when one is given."""
    if expression is not None:
        return workbench_service.set_variable_override(
            session_id, name, expression=expression, declared_type="string", function_path=path
        )
    return workbench_service.set_variable_override(
        session_id, name, value=value, value_given=True, declared_type="string", function_path=path
    )


class TestACurrentEditWhilePausedInsideAFunctionBody:
    """A Current edit of a Function's own value while paused in its body lands in that
    Function's scope, so the next block of the body reads it (REQ-3.2.1.6, REQ-3.2.1.2)."""

    async def test_the_next_block_of_the_function_reads_the_edit(self) -> None:
        with _shadowed():
            async with _paused_in_function() as paused:
                reply = _edit_current(paused.session_id, "shared", value="edited", path=("fn",))
                run = await paused.resume()

        assert reply == {"name": "shared", "value": "edited", "pending": False}
        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:edited:set", "after:test-value"]

    async def test_the_edit_is_held_by_the_function_and_the_test_variable_keeps_its_value(
        self,
    ) -> None:
        with _shadowed():
            async with _paused_in_function() as paused:
                _edit_current(paused.session_id, "shared", value="edited", path=("fn",))
                run = await paused.resume()

        assert run.session["function_scopes"][("fn",)]["shared"] == "edited"
        assert dict(run.session["variables"])["shared"] == "test-value"

    async def test_an_expression_edit_is_evaluated_in_the_function_scope(self) -> None:
        with _shadowed():
            async with _paused_in_function() as paused:
                reply = _edit_current(
                    paused.session_id, "shared", expression="marker + '-expr'", path=("fn",)
                )
                run = await paused.resume()

        assert reply == {"name": "shared", "value": None, "pending": True}
        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:set-expr:set", "after:test-value"]

    async def test_an_edit_of_the_test_variable_leaves_the_function_local_alone(self) -> None:
        with _shadowed():
            async with _paused_in_function() as paused:
                _edit_current(paused.session_id, "shared", value="test-edited")
                run = await paused.resume()

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:fn-init:set", "after:test-edited"]

    async def test_the_next_block_reads_an_edit_of_the_function_input_and_output(self) -> None:
        with _shadowed(_input_output_graph()):
            async with _paused_in_function() as paused:
                _edit_current(paused.session_id, "given", value="edited-in", path=("fn",))
                _edit_current(paused.session_id, "made", value="edited-out", path=("fn",))
                run = await paused.resume()

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:edited-in:edited-out"]
        assert "given" not in dict(run.session["variables"])
        assert "made" not in dict(run.session["variables"])


class TestTheAdhocRunsAfterACurrentEditOfAFunctionValue:
    """The edit stays in the instance's scope for the ad-hoc runs that follow, and the Test
    variable of the same name keeps its own value (REQ-3.2.1.5, REQ-3.2.1.6)."""

    async def test_the_block_run_that_resumes_the_instance_reads_a_paused_edit(self) -> None:
        with _shadowed():
            async with _paused_in_function() as paused:
                _edit_current(paused.session_id, "shared", value="edited", path=("fn",))
                await paused.resume()
            run = await _run_current("read", ("fn",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:edited:set"]

    async def test_a_block_run_at_the_test_level_still_reads_the_test_value(self) -> None:
        with _shadowed():
            async with _paused_in_function() as paused:
                _edit_current(paused.session_id, "shared", value="edited", path=("fn",))
                await paused.resume()
            run = await _run_current("after")

        assert run.markers == ["after:test-value"]

    async def test_an_edit_after_the_run_reaches_the_next_block_run_in_the_function(self) -> None:
        with _shadowed():
            full = await _full_run()
            _edit_current(full.session_id, "shared", value="edited", path=("fn",))
            run = await _run_current("read", ("fn",))

        assert full.markers == ["fn-log:fn-init:set", "after:test-value"]
        assert run.markers == ["fn-log:edited:set"]

    async def test_a_run_scope_of_the_function_starts_from_the_edit(self) -> None:
        with _shadowed():
            full = await _full_run()
            _edit_current(full.session_id, "shared", value="edited", path=("fn",))
            run = await _run_scope("fn")

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:edited:set"]

    async def test_an_edit_after_a_test_level_block_run_still_lands_in_the_function(
        self,
    ) -> None:
        with _shadowed():
            await _full_run()
            between = await _run_current("after")
            _edit_current(between.session_id, "shared", value="edited", path=("fn",))
            run = await _run_current("read", ("fn",))
            after = await _run_current("after")

        assert run.markers == ["fn-log:edited:set"]
        assert after.markers == ["after:test-value"]

    async def test_an_expression_edit_after_the_run_stays_the_source_for_the_next_block_run(
        self,
    ) -> None:
        with _shadowed():
            full = await _full_run()
            _edit_current(full.session_id, "shared", expression="marker + '-expr'", path=("fn",))
            run = await _run_current("read", ("fn",))

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:set-expr:set"]

    async def test_a_full_run_starts_the_function_from_its_definition_again(self) -> None:
        with _shadowed():
            full = await _full_run()
            _edit_current(full.session_id, "shared", value="edited", path=("fn",))
            again = await _full_run()

        assert again.markers == ["fn-log:fn-init:set", "after:test-value"]


class TestEachFunctionInstanceKeepsItsDeclaredTypes:
    """The session keeps, per instance path, the type of every input, output and local the
    Function declares, so a Current edit is checked against that Function (REQ-3.2.1.6)."""

    async def test_a_full_run_keeps_the_types_of_every_instance_it_entered(self) -> None:
        with _stored(_nested_graph()):
            run = await _full_run()

        assert run.session["function_scope_types"] == {
            ("outer",): {"a": "string", "o_local": "string"},
            ("outer", "inner"): {"b": "string", "i_out": "string", "i_local": "string"},
        }

    async def test_an_enum_input_is_kept_with_its_own_type(self) -> None:
        definition = _definition(
            "Typed",
            [log_node("typed-log", "typed-log", "'fn-log:typed'")],
            [edge("start-node", "typed-log")],
            inputs=[
                {
                    "name": "level",
                    "type": "integer",
                    "required": True,
                    "enumValues": [1, 2],
                    "default": 1,
                }
            ],
            outputs=[{"name": "total", "type": "float", "default": "0.5"}],
            variables=[{"name": "n", "type": "integer", "value": 0}],
        )
        graph = ([_instance("fn", definition, {"level": "2"})], [edge("start-node", "fn")])
        with _stored(graph):
            run = await _full_run()

        assert run.session["function_scope_types"][("fn",)] == {
            "level": "integer",
            "total": "float",
            "n": "integer",
        }

    async def test_a_run_scope_keeps_the_types_of_the_instance_it_runs(self) -> None:
        with _stored(_nested_graph()):
            run = await _run_scope("inner", ("outer",))

        assert run.session["function_scope_types"][("outer", "inner")] == {
            "b": "string",
            "i_out": "string",
            "i_local": "string",
        }

    async def test_a_block_run_outside_the_function_keeps_the_types_the_last_run_kept(
        self,
    ) -> None:
        with _shadowed():
            await _full_run()
            between = await _run_current("after")

        assert between.session["function_scope_types"] == {
            ("fn",): {"shared": "string", "marker": "string"}
        }

    def test_recording_keeps_the_scope_and_its_types_on_the_session(self) -> None:
        from wavecore.api.services.workbench import functions as _functions

        session: dict[str, Any] = {"session_id": "record-1"}
        _wb_common._workbench_sessions["record-1"] = session
        scope: dict[str, Any] = {"n": 1}

        kept = _functions.record_instance_scope("record-1", ("fn-1",), scope, {"n": "integer"})

        assert kept is scope
        assert session["function_scopes"] == {("fn-1",): scope}
        assert session["function_scope_types"] == {("fn-1",): {"n": "integer"}}
        assert session["started_scopes"] == {("fn-1",)}

    @pytest.mark.parametrize("session_id", [None, "no-such-session"])
    def test_with_no_session_the_scope_is_returned_and_nothing_is_kept(
        self, session_id: str | None
    ) -> None:
        from wavecore.api.services.workbench import functions as _functions

        scope: dict[str, Any] = {"n": 1}

        kept = _functions.record_instance_scope(session_id, ("fn-1",), scope, {"n": "integer"})

        assert kept is scope
        assert "no-such-session" not in _wb_common._workbench_sessions


def _before_function_graph() -> tuple[Nodes, Edges]:
    """before -> fn (the shadow Function) -> after: a stop on 'before' is outside fn."""
    nodes, _ = _shadow_graph()
    return (
        [log_node("before", "before", "'before'"), *nodes],
        [edge("start-node", "before"), edge("before", "fn"), edge("fn", "after")],
    )


@asynccontextmanager
async def _paused_before_function(**kwargs: Any) -> AsyncIterator[_Paused]:
    """Debug the before-function Test to its stop on 'before', so fn has not started."""
    started = workbench_service.start_workbench_run(
        test_id=TEST_ID,
        environment_id=ENVIRONMENT["id"],
        debug=workbench_service.DebugRunOptions(breakpoints=["before"], options={}),
        **kwargs,
    )
    session = _wb_common._workbench_sessions[started["session_id"]]
    task = _wb_common._active_tasks[started["session_id"]]
    try:
        await wait_until_paused(session, "before")
        assert session["status"] == "paused", log_messages(started["session_id"])
        yield _Paused(started)
    finally:
        if not task.done():
            session["status"] = "stopped"
            session["pause_event"].set()
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await asyncio.wait_for(task, timeout=2)


class TestACurrentEditBeforeTheFunctionStarts:
    """Paused before a Function Block, a Current edit of that Function's own value is held and
    taken when the Function starts in this run (REQ-3.2.1.6)."""

    async def test_the_function_reads_the_edit_when_it_starts(self) -> None:
        with _shadowed(_before_function_graph()):
            async with _paused_before_function() as paused:
                reply = _edit_current(paused.session_id, "shared", value="edited", path=("fn",))
                run = await paused.resume()

        assert reply == {"name": "shared", "value": "edited", "pending": False}
        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:edited:set", "after:test-value"]

    async def test_an_expression_edit_is_evaluated_in_the_function_when_it_starts(self) -> None:
        with _shadowed(_before_function_graph()):
            async with _paused_before_function() as paused:
                reply = _edit_current(
                    paused.session_id, "shared", expression="marker + '-expr'", path=("fn",)
                )
                run = await paused.resume()

        assert reply == {"name": "shared", "value": None, "pending": True}
        assert run.markers == ["fn-log:set-expr:set", "after:test-value"]

    async def test_a_scope_an_earlier_run_left_takes_the_edit_and_the_new_start_reads_it(
        self,
    ) -> None:
        with _shadowed(_before_function_graph()):
            await _full_run()
            async with _paused_before_function(
                target=workbench_service.RunTarget(start_node_id="before")
            ) as paused:
                _edit_current(paused.session_id, "shared", value="edited", path=("fn",))
                session = _wb_common._workbench_sessions[paused.session_id]
                assert session["function_scopes"][("fn",)]["shared"] == "edited"
                run = await paused.resume()

        assert run.session["status"] == "passed", log_messages(run.session_id)
        assert run.markers == ["fn-log:edited:set", "after:test-value"]
