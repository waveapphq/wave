"""A block that writes a variable emits ``variable_changed`` for it (REQ-3.1.3.12).

A variable declared without a value holds the null start, so a block writing
``None`` to it, or ``False`` / ``0`` / ``""`` a second time, lands on the value
already stored. The push must still carry it: the panel learns runtime values from
this stream alone.
"""

import asyncio
import contextlib
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    for_each_node,
    function_node,
    local_definition,
    log_messages,
    log_node,
    setter_node,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench.node_helpers import _extract_node_fields


@contextlib.contextmanager
def _push_recorder() -> Iterator[AsyncMock]:
    """Install a recording push service for the duration of the block."""
    from wavecore.api import app as app_module

    service = AsyncMock()
    had_service = hasattr(app_module.app.state, "variable_push_service")
    previous = getattr(app_module.app.state, "variable_push_service", None)
    app_module.app.state.variable_push_service = service
    try:
        yield service
    finally:
        if had_service:
            app_module.app.state.variable_push_service = previous
        else:
            del app_module.app.state.variable_push_service


def _emitted(service: AsyncMock) -> list[dict[str, Any]]:
    """Every ``variable_changed`` event the engine handed to the push service."""
    return [call.args[0] for call in service.push_variable_change.call_args_list]


def _paths(service: AsyncMock) -> list[str]:
    return [str(event["path"]) for event in _emitted(service)]


def _make_node(node_id: str, output_bindings: dict[str, str]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Netcat",
            "elementType": "netcat",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {},
                "outputBindings": output_bindings,
                "profileBindings": [],
            },
            "disabled": False,
            "description": "Netcat",
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _session() -> dict[str, Any]:
    return {"block_states": {}, "status": "running", "skipped_node_ids": []}


class TestPushOnWriteHelper:
    """``_push_variable_changes`` emits for a named write, changed or not."""

    async def test_a_written_variable_emits_although_its_value_is_unchanged(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        with _push_recorder() as service:
            await _wb_common._push_variable_changes(
                "push-1",
                {"nc_success": False},
                {"nc_success": False},
                written={"nc_success"},
            )

        events = _emitted(service)
        assert len(events) == 1
        assert events[0]["path"] == "nc_success"
        assert events[0]["value"] is False
        assert events[0]["var_type"] == "boolean"

    async def test_an_unwritten_variable_stays_silent_when_unchanged(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        with _push_recorder() as service:
            await _wb_common._push_variable_changes(
                "push-2",
                {"nc_success": False, "bystander": False},
                {"nc_success": False, "bystander": False},
                written={"nc_success"},
            )

        assert _paths(service) == ["nc_success"]

    async def test_a_written_empty_string_emits(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        with _push_recorder() as service:
            await _wb_common._push_variable_changes(
                "push-3",
                {"nc_error": ""},
                {"nc_error": ""},
                written={"nc_error"},
            )

        events = _emitted(service)
        assert len(events) == 1
        assert events[0]["value"] == ""

    async def test_a_written_zero_emits(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        with _push_recorder() as service:
            await _wb_common._push_variable_changes(
                "push-4",
                {"nc_count": 0},
                {"nc_count": 0},
                written={"nc_count"},
            )

        events = _emitted(service)
        assert len(events) == 1
        assert events[0]["value"] == 0

    async def test_without_written_names_only_a_change_emits(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        with _push_recorder() as service:
            await _wb_common._push_variable_changes(
                "push-5",
                {"nc_success": False},
                {"nc_success": False},
            )

        assert _emitted(service) == []


class TestWorkflowNodeBinding:
    """The main walker names the outputs the block bound (execution.py)."""

    async def _run(self, bindings: dict[str, str], result: dict[str, Any]) -> AsyncMock:
        from wavecore.api.services.workbench import execution as _exec_mod

        async def fake_execute(nf: Any, variables: Any, sid: str, nid: str) -> Any:
            return dict(result)

        nf = _extract_node_fields(_make_node("nc-1", bindings))
        with _push_recorder() as service, patch.object(_exec_mod, "_execute_node", fake_execute):
            await _exec_mod._run_and_route_node(
                nf=nf,
                variables={"nc_success": False},
                session_id="wf-1",
                session=_session(),
                node_id="nc-1",
                block_name="Netcat",
                output_bindings=bindings,
                adj={"nc-1": []},
                node_map={"nc-1": _make_node("nc-1", bindings)},
                executed=set(),
                exec_queue=[],
                environment_id="",
            )
        return service

    async def test_a_recorded_failure_emits_its_unchanged_success(self) -> None:
        service = await self._run({"success": "nc_success"}, {"success": False})

        events = _emitted(service)
        assert len(events) == 1
        assert events[0]["path"] == "nc_success"
        assert events[0]["value"] is False

    async def test_a_binding_the_block_did_not_answer_stays_silent(self) -> None:
        service = await self._run({"success": "nc_success"}, {"other": 1})

        assert _paths(service) == []


class TestTryCatchPathBinding:
    """A Try/Catch path node names its bound outputs (try_catch.py)."""

    async def _run(self, adj: dict[str, list[tuple[str, str | None]]] | None) -> AsyncMock:
        from wavecore.api.services.workbench import try_catch as _wb_try_catch

        bindings = {"success": "nc_success"}

        async def fake_execute(nf: Any, variables: Any, sid: str, nid: str) -> Any:
            return {"success": False}

        with (
            _push_recorder() as service,
            patch.object(_wb_try_catch, "_execute_node", fake_execute),
        ):
            await _wb_try_catch._execute_single_path_node(
                path_node_id="nc-1",
                node_map={"nc-1": _make_node("nc-1", bindings)},
                variables={"nc_success": False},
                session=_session(),
                session_id="tc-1",
                executed=set(),
                environment_id=None,
                adj=adj,
            )
        return service

    async def test_a_nested_path_node_emits_its_unchanged_success(self) -> None:
        service = await self._run({"nc-1": []})

        assert _paths(service) == ["nc_success"]

    async def test_a_plain_path_node_emits_its_unchanged_success(self) -> None:
        service = await self._run(None)

        assert _paths(service) == ["nc_success"]


class TestLoopBodyBinding:
    """A loop body node names its bound outputs (for_loop.py)."""

    async def _run(self, nested: bool) -> AsyncMock:
        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        bindings = {"success": "nc_success"}

        async def fake_execute(nf: Any, variables: Any, sid: str, nid: str) -> Any:
            return {"success": False}

        with (
            _push_recorder() as service,
            patch.object(_wb_for_loop, "_execute_node", fake_execute),
        ):
            await _wb_for_loop._execute_body_node(
                path_node_id="nc-1",
                node_map={"nc-1": _make_node("nc-1", bindings)},
                variables={"nc_success": False},
                session=_session(),
                session_id="loop-1",
                environment_id=None,
                adj={"nc-1": []} if nested else None,
                executed=set() if nested else None,
            )
        return service

    async def test_a_nested_body_node_emits_its_unchanged_success(self) -> None:
        service = await self._run(nested=True)

        assert _paths(service) == ["nc_success"]

    async def test_a_plain_body_node_emits_its_unchanged_success(self) -> None:
        service = await self._run(nested=False)

        assert _paths(service) == ["nc_success"]


class TestWaitUntilBinding:
    """Wait Until names the outputs it bound (wait_until.py)."""

    async def test_a_gave_up_wait_emits_its_unchanged_passed(self) -> None:
        from wavecore.api.services.workbench.wait_until import _bind_wait_outputs

        variables: dict[str, Any] = {"wait_passed": False, "wait_elapsed": 0}

        with _push_recorder() as service:
            await _bind_wait_outputs(
                False,
                0,
                {"passed": "wait_passed", "elapsed": "wait_elapsed"},
                variables,
                "wait-1",
                "Wait Until",
                "wu-1",
            )

        assert sorted(_paths(service)) == ["wait_elapsed", "wait_passed"]


def _make_setter(node_id: str, rows: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Set Variables",
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {"values": {"variables": rows}, "outputBindings": {}, "profileBindings": []},
            "disabled": False,
            "description": "Set Variables",
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


class TestVariableSetterRows:
    """A Variable Setter names the rows it writes, so a write that changes nothing still emits."""

    _SETTER = _make_setter("set-1", {"count": 0})

    @staticmethod
    async def _wrote_nothing_new(nf: Any, variables: Any, sid: str, nid: str) -> Any:
        return None

    async def test_on_the_main_walk(self) -> None:
        from wavecore.api.services.workbench import execution as _exec_mod

        with (
            _push_recorder() as service,
            patch.object(_exec_mod, "_execute_node", self._wrote_nothing_new),
        ):
            await _exec_mod._run_and_route_node(
                nf=_extract_node_fields(self._SETTER),
                variables={"count": 0, "bystander": 0},
                session_id="set-wf",
                session=_session(),
                node_id="set-1",
                block_name="Set Variables",
                output_bindings={},
                adj={"set-1": []},
                node_map={"set-1": self._SETTER},
                executed=set(),
                exec_queue=[],
                environment_id="",
            )

        assert _paths(service) == ["count"]

    @pytest.mark.parametrize("nested", [True, False])
    async def test_on_a_try_catch_path(self, nested: bool) -> None:
        from wavecore.api.services.workbench import try_catch as _wb_try_catch

        with (
            _push_recorder() as service,
            patch.object(_wb_try_catch, "_execute_node", self._wrote_nothing_new),
        ):
            await _wb_try_catch._execute_single_path_node(
                path_node_id="set-1",
                node_map={"set-1": self._SETTER},
                variables={"count": 0, "bystander": 0},
                session=_session(),
                session_id="set-tc",
                executed=set(),
                environment_id=None,
                adj={"set-1": []} if nested else None,
            )

        assert _paths(service) == ["count"]

    @pytest.mark.parametrize("nested", [True, False])
    async def test_in_a_loop_body(self, nested: bool) -> None:
        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        with (
            _push_recorder() as service,
            patch.object(_wb_for_loop, "_execute_node", self._wrote_nothing_new),
        ):
            await _wb_for_loop._execute_body_node(
                path_node_id="set-1",
                node_map={"set-1": self._SETTER},
                variables={"count": 0, "bystander": 0},
                session=_session(),
                session_id="set-loop",
                environment_id=None,
                adj={"set-1": []} if nested else None,
                executed=set() if nested else None,
            )

        assert _paths(service) == ["count"]

    def test_a_block_that_is_no_setter_names_no_row(self) -> None:
        from wavecore.core.variables.usage import block_writes

        assert block_writes(_make_node("nc-1", {})) == set()

    def test_a_setter_with_no_row_table_names_no_row(self) -> None:
        from wavecore.core.variables.usage import block_writes

        assert block_writes(_make_setter("set-2", [])) == set()


TEST_ID = "push-scope-test"
ENVIRONMENT = {"id": "env-1", "name": "Env"}
TEST_VARIABLES = {
    "label": {"type": "string", "value": "test-start"},
    "banner": {"type": "string", "value": "label + '!'", "isExpression": True},
}
Graph = tuple[list[dict[str, Any]], list[dict[str, Any]]]


def _set(node_id: str, values: dict[str, str]) -> dict[str, Any]:
    return setter_node(node_id, node_id, values, expressions=True)


def _definition(
    name: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
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


def _instance(
    node_id: str, definition: dict[str, Any], expressions: dict[str, str] | None = None
) -> dict[str, Any]:
    node = function_node(node_id, definition)
    node["data"]["config"]["values"] = dict(expressions or {})
    node["data"]["expressionFields"] = list(expressions or {})
    return node


def _pusher() -> dict[str, Any]:
    """set-local -> set-out -> read; a local shares its name with a Test variable."""
    nodes = [
        _set("set-local", {"label": "'fn-wrote'"}),
        _set("set-out", {"result": "'done'"}),
        log_node("read", "read", "'fn-log:' + tag"),
    ]
    edges = [
        edge("start-node", "set-local"),
        edge("set-local", "set-out"),
        edge("set-out", "read"),
    ]
    return _definition(
        "Pusher",
        nodes,
        edges,
        inputs=[{"name": "a", "type": "string", "default": "a-default"}],
        outputs=[{"name": "result", "type": "string", "default": "none"}],
        variables=[
            {"name": "label", "type": "string", "value": "fn-start"},
            {"name": "tag", "type": "string", "value": "a + '-tag'", "isExpression": True},
        ],
    )


def _deep_holder() -> dict[str, Any]:
    """A Function whose body is one Function Block 'inner'; inner writes its local 'deep'."""
    inner = _definition(
        "Inner",
        [_set("set-deep", {"deep": "'deep-wrote'"})],
        [edge("start-node", "set-deep")],
        variables=[{"name": "deep", "type": "string", "value": "deep-start"}],
    )
    return _definition("Outer", [_instance("inner", inner)], [edge("start-node", "inner")])


def _test_graph(fn: dict[str, Any]) -> Graph:
    """set-test -> fn -> after (reads the computed Test variable)."""
    nodes = [
        _set("set-test", {"label": "'test-wrote'"}),
        _instance("fn", fn, {"a": "label"}),
        log_node("after", "after", "'after:' + banner"),
    ]
    edges = [edge("start-node", "set-test"), edge("set-test", "fn"), edge("fn", "after")]
    return nodes, edges


@contextlib.contextmanager
def _stored(graph: Graph) -> Iterator[None]:
    nodes, edges = graph
    record = {
        "id": TEST_ID,
        "name": "Push Scope",
        "variables": TEST_VARIABLES,
        "workflow": {"nodes": nodes, "edges": edges},
    }
    tests = workbench_service.test_service
    with (
        patch.object(tests, "get_test", return_value=record),
        patch.object(tests, "get_test_variables_raw", return_value=TEST_VARIABLES),
        patch.object(tests, "validate_test", return_value=None),
        patch.object(
            workbench_service.environment_service, "get_environment", return_value=ENVIRONMENT
        ),
    ):
        yield


async def _finished(started: dict[str, Any]) -> str:
    session_id = str(started["session_id"])
    await asyncio.wait_for(_wb_common._active_tasks[session_id], timeout=10)
    # A computed value pushes through a task the run scheduled.
    await asyncio.sleep(0.01)
    status = _wb_common._workbench_sessions[session_id]["status"]
    assert status == "passed", log_messages(session_id)
    return session_id


async def _run(**kwargs: Any) -> str:
    started = workbench_service.start_workbench_run(
        test_id=TEST_ID, environment_id=ENVIRONMENT["id"], **kwargs
    )
    return await _finished(started)


async def _run_alone(definition: dict[str, Any]) -> str:
    started = workbench_service.start_standalone_function_run(
        function_def=definition,
        function_name=str(definition["name"]),
        function_id="fn-library-1",
        environment_id=ENVIRONMENT["id"],
    )
    return await _finished(started)


def _pushes_of(service: AsyncMock, name: str) -> list[tuple[Any, str, list[str]]]:
    """Each push of ``name``: its value, scope and Function path."""
    return [
        (event["value"], event["scope"], list(event["function_path"]))
        for event in _emitted(service)
        if event["path"] == name
    ]


def _scopes_of(service: AsyncMock, name: str) -> set[tuple[str, tuple[str, ...]]]:
    return {(scope, tuple(path)) for _value, scope, path in _pushes_of(service, name)}


async def _edit(session_id: str, name: str, value: Any, path: tuple[str, ...] = ()) -> None:
    """A literal Current edit of ``name``, then time for its push to go out."""
    workbench_service.set_variable_override(
        session_id,
        name,
        value=value,
        value_given=True,
        declared_type="string",
        function_path=path,
    )
    await asyncio.sleep(0.01)


@pytest.mark.usefixtures("engine_registries")
class TestABlockWriteNamesItsScope:
    """Each value a run pushes names the scope it was written in (REQ-3.1.3.12)."""

    async def test_a_function_local_named_like_a_test_variable_pushes_under_its_own_scope(
        self,
    ) -> None:
        with _stored(_test_graph(_pusher())), _push_recorder() as service:
            await _run()

        assert _pushes_of(service, "label") == [
            ("test-wrote", "test", []),
            ("fn-wrote", "function", ["fn"]),
        ]

    async def test_a_function_input_and_output_push_under_the_function_scope(self) -> None:
        with _stored(_test_graph(_pusher())), _push_recorder() as service:
            await _run()

        assert _scopes_of(service, "a") == {("function", ("fn",))}
        assert _scopes_of(service, "result") == {("function", ("fn",))}
        assert ("done", "function", ["fn"]) in _pushes_of(service, "result")

    async def test_a_computed_function_local_pushes_its_result_under_the_function_scope(
        self,
    ) -> None:
        with _stored(_test_graph(_pusher())), _push_recorder() as service:
            await _run()

        assert _scopes_of(service, "tag") == {("function", ("fn",))}
        assert {value for value, _scope, _path in _pushes_of(service, "tag")} == {"test-wrote-tag"}

    async def test_a_computed_test_variable_pushes_its_result_under_the_test_scope(self) -> None:
        with _stored(_test_graph(_pusher())), _push_recorder() as service:
            await _run()

        assert _scopes_of(service, "banner") == {("test", ())}
        assert {value for value, _scope, _path in _pushes_of(service, "banner")} == {"test-wrote!"}

    async def test_a_nested_instance_pushes_its_whole_path(self) -> None:
        with _stored(_test_graph(_deep_holder())), _push_recorder() as service:
            await _run()

        assert _pushes_of(service, "deep") == [("deep-wrote", "function", ["fn", "inner"])]

    async def test_a_loop_inside_a_function_body_pushes_its_index_under_the_function_scope(
        self,
    ) -> None:
        body = _definition(
            "Loops",
            [for_each_node("fe", ["x", "y"]), log_node("fe-log", "fe-log", "'item'")],
            [edge("start-node", "fe"), edge("fe", "fe-log", "body")],
            variables=[
                {"name": "fe_item", "type": "map", "value": {}},
                {"name": "fe_idx", "type": "integer", "value": 0},
            ],
        )
        with _stored(_test_graph(body)), _push_recorder() as service:
            await _run()

        assert _pushes_of(service, "fe_idx")
        assert _scopes_of(service, "fe_idx") == {("function", ("fn",))}
        assert _scopes_of(service, "fe_item") == {("function", ("fn",))}

    async def test_a_block_run_inside_a_function_body_pushes_under_that_function(self) -> None:
        with _stored(_test_graph(_pusher())):
            await _run()
            with _push_recorder() as service:
                await _run(
                    target=workbench_service.RunTarget(single_node_id="set-local"),
                    scope=workbench_service.ScopedRunOptions(function_path=("fn",)),
                )

        assert _pushes_of(service, "label")
        assert _scopes_of(service, "label") == {("function", ("fn",))}
        assert _scopes_of(service, "a") == {("function", ("fn",))}

    async def test_a_computed_local_a_block_run_reads_pushes_under_that_function(self) -> None:
        with _stored(_test_graph(_pusher())), _push_recorder() as service:
            await _run(
                target=workbench_service.RunTarget(single_node_id="read"),
                scope=workbench_service.ScopedRunOptions(function_path=("fn",)),
            )

        assert _scopes_of(service, "tag") == {("function", ("fn",))}
        assert {value for value, _scope, _path in _pushes_of(service, "tag")} == {"a-default-tag"}


@pytest.mark.usefixtures("engine_registries")
class TestACurrentEditNamesItsScope:
    """A literal Current edit pushes the scope it landed in (REQ-3.2.1.6, REQ-3.1.3.12)."""

    async def test_an_edit_of_a_function_local_pushes_the_function_path(self) -> None:
        with _stored(_test_graph(_pusher())):
            session_id = await _run()
            with _push_recorder() as service:
                await _edit(session_id, "label", "edited", ("fn",))

        assert _pushes_of(service, "label") == [("edited", "function", ["fn"])]

    async def test_an_edit_of_the_same_named_test_variable_pushes_the_test_scope(self) -> None:
        with _stored(_test_graph(_pusher())):
            session_id = await _run()
            with _push_recorder() as service:
                await _edit(session_id, "label", "edited")

        assert _pushes_of(service, "label") == [("edited", "test", [])]

    async def test_an_edit_of_a_nested_instance_local_pushes_its_whole_path(self) -> None:
        with _stored(_test_graph(_deep_holder())):
            session_id = await _run()
            with _push_recorder() as service:
                await _edit(session_id, "deep", "edited", ("fn", "inner"))

        assert _pushes_of(service, "deep") == [("edited", "function", ["fn", "inner"])]


@pytest.mark.usefixtures("engine_registries")
class TestAFunctionRunAloneNamesItsOwnScope:
    """Run alone from the library View, the Function is the root canvas: its own values push
    an empty path under the Function scope (REQ-3.1.3.12)."""

    async def test_its_own_values_push_an_empty_path_under_the_function_scope(self) -> None:
        with _push_recorder() as service:
            await _run_alone(_pusher())

        assert _pushes_of(service, "label") == [("fn-wrote", "function", [])]
        assert _scopes_of(service, "a") == {("function", ())}
        assert _scopes_of(service, "result") == {("function", ())}
        assert _scopes_of(service, "tag") == {("function", ())}

    async def test_a_function_block_inside_it_pushes_the_path_from_the_function_inward(
        self,
    ) -> None:
        with _push_recorder() as service:
            await _run_alone(_deep_holder())

        assert _pushes_of(service, "deep") == [("deep-wrote", "function", ["inner"])]

    async def test_a_current_edit_of_its_own_value_pushes_an_empty_path(self) -> None:
        session_id = await _run_alone(_pusher())
        with _push_recorder() as service:
            await _edit(session_id, "label", "edited")

        assert _pushes_of(service, "label") == [("edited", "function", [])]

    async def test_the_event_builder_takes_the_scope_from_the_full_path(self) -> None:
        session_id = await _run_alone(_pusher())
        standalone = workbench_service._STANDALONE_FUNCTION_NODE_ID

        own = _wb_common.variable_changed_event(session_id, "label", "x", (standalone,))
        nested = _wb_common.variable_changed_event(session_id, "deep", "y", (standalone, "inner"))

        assert (own["scope"], list(own["function_path"])) == ("function", [])
        assert (nested["scope"], list(nested["function_path"])) == ("function", ["inner"])


@pytest.fixture(autouse=True)
def _isolate_sessions() -> Iterator[None]:
    from wavecore.api.services.workbench import _common as _wb_common

    _wb_common._clear_sessions_sync()
    yield
    _wb_common._clear_sessions_sync()
