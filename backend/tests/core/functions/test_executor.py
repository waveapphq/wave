"""Unit tests for the Function executor (REQ-3.2.1.1, REQ-3.1.2.10, REQ-3.1.3.21).

``execute_function`` runs a Function flow from filled inputs:

1. The Function Block resolves its fields through the shared run path first (fill,
   expressions, null and type checks, enum step); the executor receives the filled values.
2. A fresh runtime scope holds the declared inputs by value under their bare names,
   the declared output defaults and a fresh local-variable space.
3. The Function flow runs on the engine of a live run session.
4. The declared outputs are collected into a result document.

Behavior under test:
- Filled inputs, value semantics and isolation of the Function flow
- The input rule: null, Required and the run-alone default (REQ-3.1.3.21, REQ-3.1.2.10)
- The Function Block's own fields resolved over the root flow, with the shared wording
- Output collection, error propagation, halts and concurrent runs
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.functions.executor import ScopedStart

from .conftest import (
    local_function,
    make_echo_function,
    make_function_block,
    make_function_def,
    make_log_node,
    register_engine_session,
)


def _session(session_id: str) -> dict[str, Any]:
    from wavecore.api.services.workbench import _common as _wb_common

    session: dict[str, Any] = _wb_common._workbench_sessions[session_id]
    return session


def _block_states(session_id: str) -> dict[str, Any]:
    states: dict[str, Any] = _session(session_id).get("block_states", {})
    return states


def _log_messages(session_id: str) -> list[str]:
    from wavecore.api.services import log_streaming_service

    return [
        str(entry.get("message", ""))
        for entry in log_streaming_service.get_logs(session_id)
        if isinstance(entry, dict)
    ]


def _inputs_of(*declared: Any) -> dict[str, Any]:
    """A Function definition holding only the given input declarations."""
    return {"inputs": list(declared), "outputs": [], "variables": []}


async def _run(
    function_def: dict[str, Any],
    session_id: str,
    inputs: dict[str, Any] | None = None,
    **kwargs: Any,
) -> Any:
    """Run ``function_def`` on the engine of ``session_id`` from filled ``inputs``."""
    from wavecore.core.functions.executor import execute_function

    return await execute_function(
        function_def=function_def, inputs=inputs or {}, session_id=session_id, **kwargs
    )


async def _run_block(
    session_id: str,
    definition: dict[str, Any],
    *,
    values: dict[str, Any] | None = None,
    expressions: dict[str, str] | None = None,
    variables: Any = None,
) -> dict[str, Any]:
    """Run ``definition`` as a Local Function Block of the root flow; returns its outputs."""
    from wavecore.api.services.workbench.functions import handle_function_node
    from wavecore.api.services.workbench.node_helpers import _extract_node_fields

    block = make_function_block(
        "fn-block", local_function(definition), values=values, expressions=expressions
    )
    outputs: dict[str, Any] = await handle_function_node(
        _extract_node_fields(block), {} if variables is None else variables, session_id, "fn-block"
    )
    return outputs


def _anchored(text: str) -> str:
    return rf"^{re.escape(text)}$"


# ---------------------------------------------------------------------------
# Module surface
# ---------------------------------------------------------------------------


class TestModuleSurface:
    """The executor package exposes the public entry points."""

    def test_execute_function_is_importable(self) -> None:
        from wavecore.core.functions.executor import execute_function

        assert callable(execute_function)

    def test_execute_scoped_function_is_importable(self) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        assert callable(execute_scoped_function)


# ---------------------------------------------------------------------------
# Filled inputs
# ---------------------------------------------------------------------------


class TestFilledInputs:
    """The Function flow reads each filled input under its bare name."""

    @pytest.mark.asyncio
    async def test_a_given_input_reaches_the_function_flow(self, session_id: str) -> None:
        function_def = make_echo_function("x", {"type": "string", "required": True})

        result = await _run(function_def, session_id, {"x": "hello"})

        assert result.status == "passed", result.error
        assert result.outputs.get("result") == "hello"

    @pytest.mark.asyncio
    async def test_a_given_input_holds_its_declared_type(self, session_id: str) -> None:
        function_def = make_echo_function(
            "count", {"type": "integer", "required": True}, "str(count + 1)"
        )

        result = await _run(function_def, session_id, {"count": "3"})

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "4"}


# ---------------------------------------------------------------------------
# Value-copy semantics
# ---------------------------------------------------------------------------


class TestValueCopySemantics:
    """Inputs are copied by value when the run starts."""

    @pytest.mark.asyncio
    async def test_a_later_change_to_the_given_value_does_not_reach_the_flow(
        self, session_id: str
    ) -> None:
        function_def = make_echo_function("x", {"type": "string", "required": True})
        outer = {"value": "initial"}

        result = await _run(function_def, session_id, {"x": outer["value"]})
        outer["value"] = "mutated"

        assert result.outputs.get("result") == "initial"

    @pytest.mark.asyncio
    async def test_function_flow_writes_do_not_reach_the_given_inputs(
        self, session_id: str
    ) -> None:
        function_def = make_function_def(
            name="writes_locally",
            inputs=[{"name": "x", "type": "string", "required": True}],
            outputs=[{"name": "result", "type": "string"}],
            nodes=[make_log_node("writer", message="'inner'", output_bindings={"line": "result"})],
            edges=[{"source": "start-node", "target": "writer"}],
        )
        given: dict[str, Any] = {"x": "in"}

        await _run(function_def, session_id, given)

        assert given == {"x": "in"}


# ---------------------------------------------------------------------------
# Output collection
# ---------------------------------------------------------------------------


class TestOutputCollection:
    """Declared outputs surface in the result document."""

    @pytest.mark.asyncio
    async def test_declared_outputs_present_in_result(self, session_id: str) -> None:
        function_def = make_function_def(
            name="two_outputs",
            outputs=[{"name": "a", "type": "string"}, {"name": "b", "type": "string"}],
            nodes=[
                make_log_node("n1", message="'one'", output_bindings={"line": "a"}),
                make_log_node("n2", message="'two'", output_bindings={"line": "b"}),
            ],
            edges=[
                {"source": "start-node", "target": "n1"},
                {"source": "n1", "target": "n2"},
            ],
        )

        result = await _run(function_def, session_id)

        assert result.outputs == {"a": "one", "b": "two"}

    @pytest.mark.asyncio
    async def test_undefined_output_holds_default(self, session_id: str) -> None:
        function_def = make_function_def(
            name="default_out",
            outputs=[{"name": "untouched", "type": "string", "default": "fallback"}],
            nodes=[make_log_node("n1", message="'side'")],
            edges=[{"source": "start-node", "target": "n1"}],
        )

        result = await _run(function_def, session_id)

        assert result.outputs.get("untouched") == "fallback"


# ---------------------------------------------------------------------------
# Error propagation
# ---------------------------------------------------------------------------


class TestErrorPropagation:
    """An uncaught error in the Function flow fails the run."""

    @pytest.mark.asyncio
    async def test_body_error_results_in_failed_status(self, session_id: str) -> None:
        function_def = make_function_def(
            name="failing_body",
            nodes=[make_log_node("bad", message="undefined_local")],
            edges=[{"source": "start-node", "target": "bad"}],
        )

        result = await _run(function_def, session_id)

        assert result.status == "failed"
        assert result.error == "Variable 'undefined_local' is not defined"

    @pytest.mark.asyncio
    async def test_body_error_does_not_apply_partial_outputs(self, session_id: str) -> None:
        function_def = make_function_def(
            name="partial_then_fail",
            outputs=[{"name": "good", "type": "string"}, {"name": "bad", "type": "string"}],
            nodes=[
                make_log_node("first", message="'good-value'", output_bindings={"line": "good"}),
                make_log_node("fail", message="undefined_local"),
            ],
            edges=[
                {"source": "start-node", "target": "first"},
                {"source": "first", "target": "fail"},
            ],
        )

        result = await _run(function_def, session_id)

        assert result.status == "failed"
        assert result.outputs == {}


# ---------------------------------------------------------------------------
# Concurrent runs
# ---------------------------------------------------------------------------


class TestConcurrentRuns:
    """Concurrent runs of one Function have independent runtime scopes."""

    @pytest.mark.asyncio
    async def test_three_concurrent_runs_do_not_share_state(self, session_id: str) -> None:
        import asyncio

        function_def = make_echo_function("x", {"type": "string", "required": True})
        sessions = [f"{session_id}-{n}" for n in range(3)]
        for sid in sessions:
            register_engine_session(sid)

        results = await asyncio.gather(
            *(
                _run(function_def, sid, {"x": value})
                for sid, value in zip(sessions, ("alpha", "beta", "gamma"), strict=True)
            )
        )

        assert sorted(r.outputs.get("result") for r in results) == ["alpha", "beta", "gamma"]


# ---------------------------------------------------------------------------
# The input namespace
# ---------------------------------------------------------------------------


class TestInputNamespaceHelpers:
    """``_build_input_namespace`` seeds the declared inputs from the filled values."""

    def test_default_used_when_nothing_is_given(self) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(
            _inputs_of({"name": "x", "default": 7}), {}, run_alone=False, held={}
        )

        assert namespace == {"x": 7}

    def test_a_given_value_wins_over_the_default(self) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(
            _inputs_of({"name": "x", "default": 7}), {"x": 42}, run_alone=False, held={}
        )

        assert namespace == {"x": 42}

    def test_an_undeclared_name_is_not_seeded(self) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(_inputs_of(), {"extra": "yes"}, run_alone=False, held={})

        assert namespace == {}

    def test_non_mapping_declared_is_skipped(self) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(
            _inputs_of(None, {"name": "y", "default": "ok"}), {}, run_alone=False, held={}
        )

        assert namespace == {"y": "ok"}

    def test_non_string_name_declared_is_skipped(self) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(
            _inputs_of({"name": 123, "default": "ignored"}, {"name": "y", "default": "ok"}),
            {},
            run_alone=False,
            held={},
        )

        assert namespace == {"y": "ok"}

    def test_initial_outputs_skips_non_mapping_declarations(self) -> None:
        from wavecore.core.functions.executor import _initial_outputs

        outputs = _initial_outputs(
            [None, {"name": "ok", "default": 1}, {"name": 42, "default": "x"}]
        )
        assert outputs == {"ok": 1}


class TestDeclaredTypesSeedTheBody:
    """Locals, input defaults and output defaults realize as their declared types,
    element types included (REQ-3.1.3.19)."""

    def test_an_input_default_map_realizes_its_element_types(self) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(
            _inputs_of(
                {
                    "name": "cfg",
                    "type": "map",
                    "default": {"n": "16", "zip": "02134"},
                    "elementTypes": {"n": "integer", "zip": "string"},
                },
                {"name": "count", "type": "integer", "default": "3"},
            ),
            {},
            run_alone=False,
            held={},
        )

        assert namespace == {"cfg": {"n": 16, "zip": "02134"}, "count": 3}

    def test_an_output_default_realizes_its_type(self) -> None:
        from wavecore.core.functions.executor import _initial_outputs

        assert _initial_outputs([{"name": "total", "type": "float", "default": "1.0"}]) == {
            "total": Decimal("1.0")
        }

    @pytest.mark.asyncio
    async def test_a_local_variable_realizes_its_element_types(self, session_id: str) -> None:
        from wavecore.core.functions.executor import new_runtime_scope

        scope = new_runtime_scope()
        function_def = make_function_def(
            name="typed_local",
            variables=[
                {
                    "name": "fm",
                    "type": "array",
                    "value": ["16", "1.5"],
                    "elementTypes": ["integer", "float"],
                }
            ],
            nodes=[make_log_node("noop", message="'noop'")],
            edges=[{"source": "start-node", "target": "noop"}],
        )

        result = await _run(function_def, session_id, scope=scope)

        assert result.status == "passed", result.error
        assert scope["fm"] == [16, Decimal("1.5")]


class TestLogOutputsGather:
    """``_gather_log_outputs`` returns ``{}`` for non-log plugins and when
    the log plugin's ``message`` parameter is missing."""

    def test_non_log_plugin_returns_empty(self) -> None:
        from wavecore.core.functions.executor import _gather_log_outputs

        assert _gather_log_outputs("shell-script", {"command": "ls"}) == {}

    def test_log_plugin_with_missing_message_returns_empty(self) -> None:
        from wavecore.core.functions.executor import _gather_log_outputs

        assert _gather_log_outputs("log", {"level": "INFO"}) == {}

    def test_log_plugin_with_message_returns_line(self) -> None:
        from wavecore.core.functions.executor import _gather_log_outputs

        assert _gather_log_outputs("log", {"message": "hello"}) == {"line": "hello"}


# ---------------------------------------------------------------------------
# The Function flow on the engine
# ---------------------------------------------------------------------------


class TestFunctionFlowOnTheEngine:
    """Every Block of a Function flow runs through the engine of the live run session."""

    @pytest.mark.asyncio
    async def test_an_unknown_plugin_in_the_function_flow_fails_it(self, session_id: str) -> None:
        function_def = make_function_def(
            name="bad_plugin",
            nodes=[
                {
                    "id": "ghost",
                    "type": "workflowNode",
                    "data": {
                        "label": "Ghost",
                        "elementType": "no_such_plugin",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "config": {"values": {}, "outputBindings": {}},
                    },
                }
            ],
            edges=[{"source": "start-node", "target": "ghost"}],
        )

        result = await _run(function_def, session_id)

        assert result.status == "failed"
        assert result.error == "Plugin no_such_plugin version 1.0.0 not found"

    @pytest.mark.asyncio
    async def test_a_marker_is_walked_through_and_its_successor_runs(self, session_id: str) -> None:
        function_def = make_function_def(
            name="with_marker",
            outputs=[{"name": "result", "type": "string"}],
            nodes=[
                {"id": "marker", "type": "noteNode", "data": {}},
                make_log_node("echo", message="'after-marker'", output_bindings={"line": "result"}),
            ],
            edges=[
                {"source": "start-node", "target": "marker"},
                {"source": "marker", "target": "echo"},
            ],
        )

        result = await _run(function_def, session_id)

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "after-marker"}
        assert "echo" in _block_states(session_id)

    @pytest.mark.asyncio
    async def test_a_duplicate_start_link_runs_its_block_once(self, session_id: str) -> None:
        function_def = make_function_def(
            name="duplicated_initial",
            nodes=[make_log_node("a", message="'ran-once'")],
            edges=[
                {"source": "start-node", "target": "a"},
                {"source": "start-node", "target": "a"},
            ],
        )

        result = await _run(function_def, session_id)

        assert result.status == "passed", result.error
        assert _log_messages(session_id).count("ran-once") == 1

    @pytest.mark.asyncio
    async def test_an_output_with_no_default_is_seeded_then_written(self, session_id: str) -> None:
        function_def = make_function_def(
            name="engine_output_seed",
            outputs=[{"name": "exit_msg", "type": "string"}],
            nodes=[
                make_log_node(
                    "emit", message="'written-output'", output_bindings={"line": "exit_msg"}
                )
            ],
            edges=[{"source": "start-node", "target": "emit"}],
        )

        result = await _run(function_def, session_id)

        assert result.outputs.get("exit_msg") == "written-output"

    @pytest.mark.asyncio
    async def test_a_declared_local_variable_is_written_and_read(self, session_id: str) -> None:
        function_def = make_function_def(
            name="fn_local_var",
            variables=[{"name": "run_time", "type": "float", "value": 0}],
            nodes=[
                {
                    "id": "set-rt",
                    "type": "workflowNode",
                    "data": {
                        "label": "Variable Setter",
                        "elementType": "variable-setter",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "variableExpressionKeys": ["run_time"],
                        "variableTypes": {"run_time": "float"},
                        "config": {
                            "values": {"variables": {"run_time": "3.14"}},
                            "outputBindings": {},
                            "profileBindings": [],
                        },
                    },
                },
                make_log_node("emit-rt", message="f'{run_time}'"),
            ],
            edges=[
                {"source": "start-node", "target": "set-rt"},
                {"source": "set-rt", "target": "emit-rt"},
            ],
        )

        result = await _run(function_def, session_id)

        assert result.status == "passed", result.error
        assert "3.14" in _log_messages(session_id)

    @pytest.mark.asyncio
    async def test_a_break_at_the_top_of_the_function_flow_stops_it(self, session_id: str) -> None:
        function_def = make_function_def(
            name="breaks_at_top",
            nodes=[
                {
                    "id": "break-1",
                    "type": "workflowNode",
                    "data": {
                        "label": "break-1",
                        "elementType": "break",
                        "nodeType": "control",
                        "version": "1.0.0",
                        "config": {
                            "values": {"target_loop": "nonexistent-loop"},
                            "outputBindings": {},
                            "profileBindings": [],
                        },
                    },
                },
                make_log_node("log-after", message="'never'"),
            ],
            edges=[
                {"source": "start-node", "target": "break-1"},
                {"source": "break-1", "target": "log-after"},
            ],
        )

        await _run(function_def, session_id)

        assert _block_states(session_id).get("log-after") == "skipped"
        assert "_loop_signal" not in _session(session_id)

    @pytest.mark.asyncio
    async def test_a_declared_output_the_scope_holds_is_collected(self, session_id: str) -> None:
        from wavecore.core.functions.executor import new_runtime_scope

        scope = new_runtime_scope()
        scope["result"] = "from-prepopulated"
        function_def = make_function_def(
            name="engine_collect",
            outputs=[{"name": "result", "type": "string"}],
            nodes=[make_log_node("log-1", message="'x'")],
            edges=[{"source": "start-node", "target": "log-1"}],
        )

        result = await _run(function_def, session_id, scope=scope)

        assert result.outputs.get("result") == "from-prepopulated"

    @pytest.mark.asyncio
    async def test_a_stopped_session_ends_the_function_flow(self, session_id: str) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        _session(session_id)["status"] = _wb_common.WorkbenchStatus.STOPPED.value
        function_def = make_function_def(
            name="engine_stopped",
            outputs=[{"name": "result", "type": "string"}],
            nodes=[
                make_log_node("first", message="'first'", output_bindings={"line": "result"}),
                make_log_node("second", message="'second'", output_bindings={"line": "result"}),
            ],
            edges=[
                {"source": "start-node", "target": "first"},
                {"source": "first", "target": "second"},
            ],
        )

        await _run(function_def, session_id)

        assert "second" not in _block_states(session_id)

    @pytest.mark.asyncio
    async def test_declared_inputs_and_defaulted_outputs_reach_the_result(
        self, session_id: str
    ) -> None:
        function_def = make_function_def(
            name="ins_outs",
            inputs=[{"name": "a", "type": "string", "required": True}],
            outputs=[{"name": "r", "type": "string", "default": "def"}],
            nodes=[make_log_node("n", message="'a=' + a")],
            edges=[{"source": "start-node", "target": "n"}],
        )

        result = await _run(function_def, session_id, {"a": "hello"})

        assert result.outputs.get("r") == "def"
        assert "a=hello" in _log_messages(session_id)

    @pytest.mark.asyncio
    async def test_step_over_from_a_block_clears_and_arms_the_next_pause(
        self, session_id: str
    ) -> None:
        _session(session_id)["step_over_from_node"] = "n1"
        function_def = make_function_def(
            name="step_over",
            nodes=[make_log_node("n1", message="'x'")],
            edges=[{"source": "start-node", "target": "n1"}],
        )

        await _run(function_def, session_id)

        assert _session(session_id).get("step_over_from_node") is None
        assert _session(session_id).get("pause_at_next_node") is True

    @pytest.mark.asyncio
    async def test_variable_seeding_skips_non_mapping_and_invalid_name_entries(
        self, session_id: str
    ) -> None:
        from wavecore.core.functions.executor import new_runtime_scope

        scope = new_runtime_scope()
        function_def = make_function_def(
            name="odd_locals",
            variables=[
                "not-a-mapping",
                {"name": ""},
                {"value": 1},
                {"name": "good", "value": 7},
            ],
            nodes=[make_log_node("n", message="'x'")],
            edges=[{"source": "start-node", "target": "n"}],
        )

        result = await _run(function_def, session_id, scope=scope)

        assert result.status == "passed", result.error
        assert dict(scope) == {"good": 7}


def _sql_block(node_id: str, values: dict[str, Any], **data: Any) -> dict[str, Any]:
    """A SQL Block on SQLite, so nothing a network database requires is left unset."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "sql-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {
                    "operation": "run_sql",
                    "database_type": "sqlite",
                    "file": "data.db",
                    "sql": "SELECT 1",
                    **values,
                },
                "outputBindings": {},
            },
            **data,
        },
    }


def _capture_sql_runs(monkeypatch: pytest.MonkeyPatch, plugin: Any) -> dict[str, Any]:
    """The parameters the SQL Block receives; the Block itself does nothing."""
    from wavecore.core import plugin_registry

    monkeypatch.setitem(
        plugin_registry._registry._plugins, "sql-client", {plugin.metadata["version"]: plugin}
    )
    received: dict[str, Any] = {}

    async def _validate(params: dict[str, Any]) -> None:
        received.update(params)

    async def _nothing(*_args: Any) -> None:
        return None

    async def _execute(_context: Any) -> dict[str, Any]:
        return {}

    monkeypatch.setattr(plugin, "validate", _validate)
    monkeypatch.setattr(plugin, "initialize", _nothing)
    monkeypatch.setattr(plugin, "cleanup", _nothing)
    monkeypatch.setattr(plugin, "execute", _execute)
    return received


class TestTypedSettingsInAFunctionFlow:
    """A Block's typed setting in a Function flow reaches the plugin in platform numbers
    (REQ-3.1.3.19)."""

    @pytest.mark.asyncio
    async def test_an_exact_decimal_entry_reaches_the_plugin_as_a_float(
        self, monkeypatch: pytest.MonkeyPatch, session_id: str
    ) -> None:
        from wavecore.plugins.sql_client import SQLClientPlugin

        received = _capture_sql_runs(monkeypatch, SQLClientPlugin())
        node = _sql_block(
            "sql",
            {"driver_options": {"timeout": "wait + 10", "ratio": "0.5"}},
            expressionFields=["driver_options.timeout"],
            elementTypes={"driver_options": {"ratio": "float"}},
        )
        function_def = make_function_def(
            name="typed",
            variables=[{"name": "wait", "type": "float", "value": "6.5"}],
            nodes=[node],
            edges=[{"source": "start-node", "target": "sql"}],
        )

        result = await _run(function_def, session_id)

        assert result.status == "passed", result.error
        assert received["driver_options"] == {"timeout": 16.5, "ratio": 0.5}
        assert type(received["driver_options"]["timeout"]) is float
        assert type(received["driver_options"]["ratio"]) is float


class TestTemplateEscapesInAFunctionFlow:
    """A Block in a Function flow is resolved with the escape specs its metadata declares
    (OS-5)."""

    @pytest.mark.asyncio
    async def test_a_block_passes_its_escape_specs(
        self, monkeypatch: pytest.MonkeyPatch, session_id: str
    ) -> None:
        from wavecore.core.execution import plugin_executor
        from wavecore.plugins.sql_client import SQLClientPlugin

        spec = {"by": "database_type", "rules": {"postgresql": "json"}, "default": "dql"}
        plugin = SQLClientPlugin()
        metadata = plugin.metadata
        metadata["parameters"] = [
            {**row, "template_escape": spec} if row["name"] == "sql" else row
            for row in metadata["parameters"]
        ]
        monkeypatch.setattr(SQLClientPlugin, "metadata", property(lambda _self: metadata))
        _capture_sql_runs(monkeypatch, plugin)
        real = plugin_executor.resolve_parameters
        calls: list[dict[str, Any]] = []

        def _spy(*args: Any, **kwargs: Any) -> Any:
            calls.append(kwargs)
            return real(*args, **kwargs)

        monkeypatch.setattr(plugin_executor, "resolve_parameters", _spy)
        function_def = make_function_def(
            name="escaped",
            nodes=[_sql_block("sql", {})],
            edges=[{"source": "start-node", "target": "sql"}],
        )

        result = await _run(function_def, session_id)

        assert result.status == "passed", result.error
        assert [call["template_escapes"] for call in calls] == [{"sql": spec}]


class TestScopedFunctionDefensiveBranches:
    """``execute_scoped_function`` skips malformed input declarations with given values and
    without them."""

    @pytest.mark.asyncio
    async def test_given_values_skip_malformed_declarations(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = make_function_def(
            name="scoped_ok",
            inputs=[
                None,
                {"name": 123, "default": "ignored"},
                {"name": "y", "default": "ok"},
            ],
            outputs=[{"name": "result", "type": "string"}],
            nodes=[make_log_node("echo", message="y", output_bindings={"line": "result"})],
            edges=[{"source": "start-node", "target": "echo"}],
        )

        result = await execute_scoped_function(
            function_def=function_def,
            start=ScopedStart(input_values={"y": "from-cache"}),
            session_id=session_id,
        )

        assert result.outputs.get("result") == "from-cache"
        assert result.advisory is None

    @pytest.mark.asyncio
    async def test_no_given_values_skip_malformed_declarations(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = make_function_def(
            name="scoped_no_state",
            inputs=[
                None,
                {"name": 999, "default": "ignored"},
                {"name": "z", "default": "fallback"},
            ],
            outputs=[{"name": "result", "type": "string"}],
            nodes=[make_log_node("echo", message="z", output_bindings={"line": "result"})],
            edges=[{"source": "start-node", "target": "echo"}],
        )

        result = await execute_scoped_function(function_def=function_def, session_id=session_id)

        assert result.outputs.get("result") == "fallback"
        assert result.advisory is not None

    @pytest.mark.asyncio
    async def test_an_input_no_value_names_falls_back_to_its_default(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = make_function_def(
            name="scoped_default_fallback",
            inputs=[
                {"name": "z", "type": "string", "default": "from-default"},
                {"name": "other", "type": "string"},
            ],
            outputs=[{"name": "result", "type": "string"}],
            nodes=[make_log_node("echo", message="z", output_bindings={"line": "result"})],
            edges=[{"source": "start-node", "target": "echo"}],
        )

        result = await execute_scoped_function(
            function_def=function_def,
            start=ScopedStart(input_values={"other": "given"}),
            session_id=session_id,
        )

        assert result.outputs.get("result") == "from-default"
        assert result.advisory is None


# ---------------------------------------------------------------------------
# Halt(scope="function") capture + absorption (REQ-3.5.1.14)
# ---------------------------------------------------------------------------


def _halt_node(
    node_id: str,
    *,
    scope: str,
    status: str,
    message: str | None = None,
) -> dict[str, Any]:
    """Build a Halt control Block for a Function flow."""
    values: dict[str, Any] = {"scope": scope, "status": status}
    if message is not None:
        values["message"] = message
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "halt",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {"values": values, "profileBindings": [], "outputBindings": {}},
            "displayName": node_id,
        },
    }


class TestFunctionScopeHaltCapture:
    """``execute_function`` surfaces an inner ``Halt(scope='function')`` on the
    result's halt fields; absorbing it is the Function Block's part."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "halt_status,expected_block_status",
        [
            ("passed", "passed"),
            ("skipped", "passed"),
            ("failed", "failed"),
        ],
    )
    async def test_inner_function_scope_halt_surfaces_on_result(
        self, session_id: str, halt_status: str, expected_block_status: str
    ) -> None:
        function_def = make_function_def(
            name="halts_itself",
            nodes=[_halt_node("inner-halt", scope="function", status=halt_status)],
            edges=[{"source": "start-node", "target": "inner-halt"}],
        )

        result = await _run(function_def, session_id)

        assert result.halt_scope == "function"
        assert result.halt_status == halt_status
        assert result.status == expected_block_status


class TestNestedFunctionScopeHaltAbsorption:
    """A ``function``-scope Halt is absorbed at the innermost Function boundary, so an
    inner Function's halt never halts the outer Function (REQ-3.5.1.14)."""

    @staticmethod
    def _outer(inner_status: str) -> dict[str, Any]:
        inner_def = make_function_def(
            name="inner",
            nodes=[_halt_node("inner-halt", scope="function", status=inner_status)],
            edges=[{"source": "start-node", "target": "inner-halt"}],
        )
        return make_function_def(
            name="outer",
            nodes=[
                make_function_block("inner-fn", local_function(inner_def)),
                make_log_node("after-inner", message="'after'"),
            ],
            edges=[
                {"source": "start-node", "target": "inner-fn"},
                {"source": "inner-fn", "target": "after-inner"},
            ],
        )

    @pytest.mark.asyncio
    async def test_inner_passed_function_halt_does_not_halt_outer(self, session_id: str) -> None:
        result = await _run(self._outer("passed"), session_id)

        assert result.halt_scope is None
        assert result.status == "passed"
        assert _block_states(session_id).get("after-inner") == "passed"

    @pytest.mark.asyncio
    async def test_inner_failed_function_halt_raises_not_drains_outer(
        self, session_id: str
    ) -> None:
        result = await _run(self._outer("failed"), session_id)

        assert result.halt_scope is None
        assert result.status == "failed"
        assert _block_states(session_id).get("after-inner") != "passed"


# ---------------------------------------------------------------------------
# The input rule (REQ-3.1.3.21, REQ-3.1.2.1)
# ---------------------------------------------------------------------------

REFUSES_NULL = [
    pytest.param({"type": "integer", "required": True}, id="required"),
    pytest.param(
        {"type": "integer", "required": True, "default": None}, id="required-null-default"
    ),
    pytest.param({"type": "integer", "default": 5}, id="defaulted"),
]

TAKES_NULL = [
    pytest.param({"type": "integer"}, id="no-default"),
    pytest.param({"type": "integer", "default": None}, id="null-default"),
    *(
        pytest.param(declaration, id=f"{value_type}-{case}")
        for value_type in ("string", "float", "boolean", "array", "map", "table")
        for case, declaration in (
            ("no-default", {"type": value_type}),
            ("null-default", {"type": value_type, "default": None}),
        )
    ),
]


def _enum_input(value_type: str, allowed: list[Any]) -> dict[str, Any]:
    """An enum input as stored: typed by its own type, its default one of the allowed values."""
    return {
        "type": value_type,
        "required": True,
        "enumValues": allowed,
        "default": allowed[0],
    }


ENUM_OUTSIDE_THE_LIST = [
    pytest.param(
        "string",
        ["low", "high"],
        "'mid'",
        "Parameter 'level' must be one of: low, high; Actual value was 'mid'.",
        id="string",
    ),
    pytest.param(
        "integer",
        [1, 2],
        "3",
        "Parameter 'level' must be one of: 1, 2; Actual value was '3'.",
        id="integer",
    ),
    pytest.param(
        "float",
        [0.5, 1.5],
        "2.5",
        "Parameter 'level' must be one of: 0.5, 1.5; Actual value was '2.5'.",
        id="float",
    ),
]


class TestInputNamespaceNullRule:
    """``_build_input_namespace`` holds null for an input nothing gave and no default
    fills, and refuses null for a required or defaulted input."""

    def test_an_unbound_optional_input_with_no_default_holds_null(self) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(
            _inputs_of({"name": "note", "type": "string"}), {}, run_alone=False, held={}
        )

        assert namespace == {"note": None}

    @pytest.mark.parametrize("declaration", TAKES_NULL)
    def test_a_null_given_to_an_optional_input_with_no_default_stays_null(
        self, declaration: dict[str, Any]
    ) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(
            _inputs_of({"name": "count", **declaration}),
            {"count": None},
            run_alone=False,
            held={},
        )

        assert namespace == {"count": None}

    @pytest.mark.parametrize("declaration", REFUSES_NULL)
    def test_a_null_given_to_a_required_or_defaulted_input_is_refused(
        self, declaration: dict[str, Any]
    ) -> None:
        from wavecore.core.expressions.errors import NullValueError
        from wavecore.core.functions.executor import _build_input_namespace

        with pytest.raises(NullValueError, match=r"^'count' is null$"):
            _build_input_namespace(
                _inputs_of({"name": "count", **declaration}),
                {"count": None},
                run_alone=False,
                held={},
            )


class TestRequiredInputDefaultOnARunAlone:
    """A Required input nothing gave takes its default only on a run alone; a Function Block
    never does, and a null default counts as none (REQ-3.1.2.10)."""

    @staticmethod
    def _namespace(
        declared: dict[str, Any], given: dict[str, Any], *, run_alone: bool
    ) -> dict[str, Any]:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace: dict[str, Any] = _build_input_namespace(
            _inputs_of(declared), given, run_alone=run_alone, held={}
        )
        return namespace

    def test_a_run_alone_takes_the_default_of_a_required_input(self) -> None:
        declared = {"name": "must", "type": "integer", "required": True, "default": "4"}

        assert self._namespace(declared, {}, run_alone=True) == {"must": 4}

    @pytest.mark.parametrize(
        "declaration",
        [
            pytest.param({"type": "integer", "required": True}, id="no-default"),
            pytest.param({"type": "integer", "required": True, "default": None}, id="null-default"),
        ],
    )
    def test_a_run_alone_refuses_a_required_input_with_no_default(
        self, declaration: dict[str, Any]
    ) -> None:
        from wavecore.core.expressions.errors import NullValueError

        with pytest.raises(NullValueError, match=r"^'must' is null$"):
            self._namespace({"name": "must", **declaration}, {}, run_alone=True)

    @pytest.mark.parametrize(
        ("declaration", "expected"),
        [
            pytest.param({"type": "integer", "default": 0}, 0, id="integer-zero"),
            pytest.param({"type": "boolean", "default": False}, False, id="boolean-false"),
            pytest.param({"type": "string", "default": ""}, "", id="string-empty"),
        ],
    )
    def test_a_falsy_default_of_a_required_input_still_counts_on_a_run_alone(
        self, declaration: dict[str, Any], expected: Any
    ) -> None:
        declared = {"name": "must", "required": True, **declaration}
        value = self._namespace(declared, {}, run_alone=True)["must"]

        assert value == expected
        assert type(value) is type(expected)

    def test_a_function_block_never_takes_the_default_of_a_required_input(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        declared = {"name": "must", "type": "integer", "required": True, "default": 4}

        with pytest.raises(NullValueError, match=r"^'must' is null$"):
            self._namespace(declared, {}, run_alone=False)

    def test_a_held_required_input_is_not_refused(self) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(
            _inputs_of({"name": "must", "type": "integer", "required": True}),
            {},
            run_alone=False,
            held={"must": 9},
        )

        assert "must" in namespace

    @pytest.mark.parametrize("run_alone", [True, False], ids=["run-alone", "function-block"])
    def test_an_optional_input_given_nothing_takes_its_default(self, run_alone: bool) -> None:
        declared = {"name": "size", "type": "integer", "default": "3"}

        assert self._namespace(declared, {}, run_alone=run_alone) == {"size": 3}

    @pytest.mark.parametrize("run_alone", [True, False], ids=["run-alone", "function-block"])
    def test_a_given_value_wins_over_the_default_of_a_required_input(self, run_alone: bool) -> None:
        declared = {"name": "must", "type": "integer", "required": True, "default": 4}

        assert self._namespace(declared, {"must": 9}, run_alone=run_alone) == {"must": 9}

    def test_a_run_alone_takes_an_enum_default_as_the_input_type(self) -> None:
        declared = {"name": "level", **_enum_input("integer", [1, 2]), "default": "2"}
        value = self._namespace(declared, {}, run_alone=True)["level"]

        assert value == 2
        assert type(value) is int


ENUM_PICKED_AS_ITS_TYPE = [
    pytest.param("string", ["low", "high"], "high", "high", str, id="string"),
    pytest.param("integer", [1, 2], "2", 2, int, id="integer"),
    pytest.param("float", [0.5, 1.5], "1.5", Decimal("1.5"), Decimal, id="float"),
]


class TestEnumInputByItsType:
    """An enum input is realized by its own ``type``: the picked value holds that type
    (REQ-3.1.2.11)."""

    @pytest.mark.parametrize(
        ("value_type", "allowed", "picked", "expected", "held_type"), ENUM_PICKED_AS_ITS_TYPE
    )
    def test_the_picked_value_holds_the_input_type(
        self,
        value_type: str,
        allowed: list[Any],
        picked: str,
        expected: Any,
        held_type: type,
    ) -> None:
        from wavecore.core.functions.executor import _build_input_namespace

        namespace = _build_input_namespace(
            _inputs_of({"name": "level", **_enum_input(value_type, allowed)}),
            {"level": picked},
            run_alone=False,
            held={},
        )

        assert namespace["level"] == expected
        assert isinstance(namespace["level"], held_type)

    @pytest.mark.asyncio
    async def test_an_integer_enum_reaches_the_body_as_an_integer(self, session_id: str) -> None:
        function_def = make_echo_function("level", _enum_input("integer", [1, 2]), "str(level + 1)")

        result = await _run(function_def, session_id, {"level": 2})

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "3"}


# ---------------------------------------------------------------------------
# The Function Block resolves its fields over the root flow (REQ-3.1.2.1)
# ---------------------------------------------------------------------------


class TestAFunctionBlockResolvesItsFields:
    """A Function Block's field holds a literal or an expression over the root flow's
    variables; the Function flow reads the value it resolves to."""

    @pytest.mark.asyncio
    async def test_a_literal_value_reaches_the_function_flow(self, session_id: str) -> None:
        outputs = await _run_block(
            session_id,
            make_echo_function("x", {"type": "string", "required": True}),
            values={"x": "hello"},
        )

        assert outputs == {"result": "hello"}

    @pytest.mark.asyncio
    async def test_an_input_expression_reads_the_root_flow_variables(self, session_id: str) -> None:
        outputs = await _run_block(
            session_id,
            make_echo_function("x", {"type": "string", "required": True}),
            expressions={"x": "outer_value"},
            variables={"outer_value": "from-outside"},
        )

        assert outputs == {"result": "from-outside"}

    @pytest.mark.asyncio
    async def test_a_float_input_keeps_every_digit(self, session_id: str) -> None:
        from wavecore.core.variables.decimal_value import to_wave_decimal

        outputs = await _run_block(
            session_id,
            make_echo_function("ratio", {"type": "float", "required": True}),
            expressions={"ratio": "rate"},
            variables={"rate": to_wave_decimal("0.12345678901234567890")},
        )

        assert outputs == {"result": "0.12345678901234567890"}


class TestAFunctionBlockInputExpressionThatFails:
    """An input expression that fails stops the Function Block with the plain expression
    error; the Function flow never starts (REQ-3.1.3.21, REQ-3.1.2.1)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("expression", "error"),
        [
            ("nope", "Variable 'nope' is not defined"),
            ("1 / 0", "Expression evaluation failed for '1 / 0': division by zero"),
        ],
    )
    async def test_the_plain_expression_error_names_it(
        self, session_id: str, expression: str, error: str
    ) -> None:
        with pytest.raises(RuntimeError, match=_anchored(error)):
            await _run_block(
                session_id,
                make_echo_function("count", {"type": "integer", "required": True}),
                expressions={"count": expression},
            )

        assert "echo" not in _block_states(session_id)

    @pytest.mark.asyncio
    async def test_a_value_of_the_wrong_type_is_refused_naming_the_input(
        self, session_id: str
    ) -> None:
        with pytest.raises(RuntimeError, match=r"^Parameter 'count' expects integer, got str$"):
            await _run_block(
                session_id,
                make_echo_function("count", {"type": "integer", "required": True}),
                expressions={"count": "'abc'"},
            )

        assert "echo" not in _block_states(session_id)


REQUIRED_WITH_A_DEFAULT = [
    pytest.param({"type": "string", "required": True, "default": "d"}, id="string"),
    pytest.param({"type": "boolean", "required": True, "default": False}, id="boolean"),
    pytest.param(_enum_input("string", ["low", "high"]), id="enum"),
]


class TestAFunctionBlockNeverFillsARequiredInputFromItsDefault:
    """A Function Block that gives nothing to a Required input fails naming it, even when
    the input has a default (REQ-3.2.1.1, REQ-3.1.2.10, VMGR-113)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("declaration", REQUIRED_WITH_A_DEFAULT)
    @pytest.mark.parametrize(
        "expressions", [pytest.param({}, id="unset"), pytest.param({"must": ""}, id="blank")]
    )
    async def test_the_function_block_fails_naming_the_input(
        self, session_id: str, declaration: dict[str, Any], expressions: dict[str, str]
    ) -> None:
        with pytest.raises(RuntimeError, match=r"^'must' is null$"):
            await _run_block(
                session_id, make_echo_function("must", declaration), expressions=expressions
            )

        assert "echo" not in _block_states(session_id)


class TestTheInputRuleOnAFunctionBlock:
    """Each field is resolved over the root flow before the first Block runs: nothing set
    takes the default, else null; null fails a required or defaulted input; a value outside
    an enum fails with the shared enum message (REQ-3.1.3.21, REQ-3.1.2.11)."""

    @pytest.mark.asyncio
    async def test_an_unset_optional_input_with_no_default_reads_as_null(
        self, session_id: str
    ) -> None:
        outputs = await _run_block(
            session_id, make_echo_function("note", {"type": "string"}), variables={"o": "v"}
        )

        assert outputs == {"result": "null"}

    @pytest.mark.asyncio
    async def test_an_unset_optional_input_takes_the_default(self, session_id: str) -> None:
        outputs = await _run_block(
            session_id, make_echo_function("count", {"type": "integer", "default": 5})
        )

        assert outputs == {"result": "5"}

    @pytest.mark.asyncio
    async def test_a_blank_expression_takes_the_default(self, session_id: str) -> None:
        outputs = await _run_block(
            session_id,
            make_echo_function("count", {"type": "integer", "default": 5}),
            expressions={"count": ""},
        )

        assert outputs == {"result": "5"}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("declaration", TAKES_NULL)
    async def test_a_blank_expression_with_no_default_reads_as_null(
        self, session_id: str, declaration: dict[str, Any]
    ) -> None:
        outputs = await _run_block(
            session_id, make_echo_function("count", declaration), expressions={"count": ""}
        )

        assert outputs == {"result": "null"}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("declaration", REFUSES_NULL)
    @pytest.mark.parametrize(
        ("expression", "variables"),
        [
            pytest.param("None", {}, id="expression"),
            pytest.param("missing_count", {"missing_count": None}, id="root-flow-variable"),
        ],
    )
    async def test_null_to_a_required_or_defaulted_input_fails_the_function_block(
        self,
        session_id: str,
        declaration: dict[str, Any],
        expression: str,
        variables: dict[str, Any],
    ) -> None:
        with pytest.raises(RuntimeError, match=r"^'count' is null$"):
            await _run_block(
                session_id,
                make_echo_function("count", declaration),
                expressions={"count": expression},
                variables=variables,
            )

        assert "echo" not in _block_states(session_id)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("declaration", TAKES_NULL)
    async def test_null_to_an_optional_input_with_no_default_reads_as_null(
        self, session_id: str, declaration: dict[str, Any]
    ) -> None:
        outputs = await _run_block(
            session_id, make_echo_function("count", declaration), expressions={"count": "None"}
        )

        assert outputs == {"result": "null"}

    @pytest.mark.asyncio
    async def test_outputs_hold_the_written_value_else_the_default(self, session_id: str) -> None:
        function_def = make_function_def(
            name="null_input_outputs",
            inputs=[{"name": "note", "type": "string"}],
            outputs=[
                {"name": "written", "type": "string"},
                {"name": "kept", "type": "string", "default": "d"},
            ],
            nodes=[
                make_log_node(
                    "write",
                    message="'note is null' if note is None else note",
                    output_bindings={"line": "written"},
                )
            ],
            edges=[{"source": "start-node", "target": "write"}],
        )

        outputs = await _run_block(session_id, function_def, expressions={"note": "None"})

        assert outputs == {"written": "note is null", "kept": "d"}

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("value_type", "allowed", "expression", "error"), ENUM_OUTSIDE_THE_LIST
    )
    async def test_a_value_outside_the_enum_fails_the_function_block(
        self,
        session_id: str,
        value_type: str,
        allowed: list[Any],
        expression: str,
        error: str,
    ) -> None:
        with pytest.raises(RuntimeError, match=_anchored(error)):
            await _run_block(
                session_id,
                make_echo_function("level", _enum_input(value_type, allowed)),
                expressions={"level": expression},
            )

        assert "echo" not in _block_states(session_id)

    @pytest.mark.asyncio
    async def test_a_variable_outside_the_enum_fails_when_the_run_starts(
        self, session_id: str
    ) -> None:
        with pytest.raises(
            RuntimeError,
            match=r"^Parameter 'level' must be one of: low, high; Actual value was 'mid'\.$",
        ):
            await _run_block(
                session_id,
                make_echo_function("level", _enum_input("string", ["low", "high"])),
                expressions={"level": "picked"},
                variables={"picked": "mid"},
            )

        assert "echo" not in _block_states(session_id)

    @pytest.mark.asyncio
    async def test_a_value_inside_the_enum_passes(self, session_id: str) -> None:
        outputs = await _run_block(
            session_id,
            make_echo_function("level", _enum_input("string", ["low", "high"])),
            expressions={"level": "'high'"},
        )

        assert outputs == {"result": "high"}

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("expression", "variables"),
        [
            pytest.param("0.1", {}, id="literal"),
            pytest.param("rate", {"rate": "0.1"}, id="float-variable"),
        ],
    )
    async def test_an_enum_value_is_compared_as_its_value_type(
        self, session_id: str, expression: str, variables: dict[str, Any]
    ) -> None:
        # A WAVE float is an exact decimal; the allowed floats are compared the same way.
        from wavecore.core.variables.decimal_value import to_wave_decimal

        outputs = await _run_block(
            session_id,
            make_echo_function("level", _enum_input("float", [0.1, 0.2])),
            expressions={"level": expression},
            variables={name: to_wave_decimal(value) for name, value in variables.items()},
        )

        assert outputs == {"result": "0.1"}

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("value_type", "allowed"),
        [
            pytest.param("string", ["low", "high"], id="string"),
            pytest.param("integer", [1, 2], id="integer"),
            pytest.param("float", [0.5, 1.5], id="float"),
        ],
    )
    async def test_null_given_to_an_enum_input_is_refused(
        self, session_id: str, value_type: str, allowed: list[Any]
    ) -> None:
        with pytest.raises(RuntimeError, match=r"^'level' is null$"):
            await _run_block(
                session_id,
                make_echo_function("level", _enum_input(value_type, allowed)),
                expressions={"level": "None"},
            )

        assert "echo" not in _block_states(session_id)


class TestFunctionBlockFieldsAreReadOnly:
    """A Function Block's expression is a read: it may not change the root flow's data."""

    @pytest.mark.asyncio
    async def test_an_expression_that_changes_a_list_is_refused(self, session_id: str) -> None:
        rows = [1]

        with pytest.raises(RuntimeError) as refused:
            await _run_block(
                session_id,
                make_echo_function("n", {"type": "integer"}),
                expressions={"n": "rows.append(3)"},
                variables={"rows": rows},
            )

        assert str(refused.value) == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Expression: rows.append(3)"
        )
        assert rows == [1]

    @pytest.mark.asyncio
    async def test_an_expression_that_only_reads_still_resolves(self, session_id: str) -> None:
        outputs = await _run_block(
            session_id,
            make_echo_function("n", {"type": "integer"}),
            expressions={"n": "len(rows)"},
            variables={"rows": [1, 2]},
        )

        assert outputs == {"result": "2"}

    @pytest.mark.asyncio
    async def test_a_literal_value_is_not_checked(self, session_id: str) -> None:
        outputs = await _run_block(
            session_id,
            make_echo_function("text", {"type": "string"}),
            values={"text": "rows.append(3)"},
            variables={"rows": [1]},
        )

        assert outputs == {"result": "rows.append(3)"}


class TestFunctionBlockFieldsOverALazyRootFlowScope:
    """A Function Block's expression reads the root flow's own store, so a computed
    variable nothing has read yet is evaluated for it."""

    @staticmethod
    async def _echo(session_id: str, variables: Any) -> Any:
        outputs = await _run_block(
            session_id,
            make_echo_function("x", {"type": "string", "default": "x-default"}),
            expressions={"x": "url"},
            variables=variables,
        )
        return outputs.get("result")

    @pytest.mark.asyncio
    async def test_an_expression_nothing_read_yet_is_evaluated_for_the_input(
        self, session_id: str
    ) -> None:
        from wavecore.api.services.workbench.lazy_variables import LazyVariables

        root = LazyVariables({"host": "b"}, expr_map={"url": ("'http://' + host", "string")})

        assert await self._echo(session_id, root) == "http://b"
        assert dict(root) == {"host": "b", "url": "http://b"}

    @pytest.mark.asyncio
    async def test_a_template_nothing_read_yet_is_rendered_for_the_input(
        self, session_id: str
    ) -> None:
        from wavecore.api.services.workbench.lazy_variables import LazyVariables

        root = LazyVariables({"host": "b"}, tmpl_map={"url": "http://{{ host }}"})

        assert await self._echo(session_id, root) == "http://b"

    @pytest.mark.asyncio
    async def test_a_scope_that_holds_only_unread_computed_variables_is_still_read(
        self, session_id: str
    ) -> None:
        from wavecore.api.services.workbench.lazy_variables import LazyVariables

        root = LazyVariables({}, expr_map={"url": ("'http://b'", "string")})

        assert await self._echo(session_id, root) == "http://b"

    @pytest.mark.asyncio
    async def test_a_plain_scope_is_read_as_before_and_left_as_it_was(
        self, session_id: str
    ) -> None:
        root = {"url": "http://plain"}

        assert await self._echo(session_id, root) == "http://plain"
        assert root == {"url": "http://plain"}


# ---------------------------------------------------------------------------
# A run alone (REQ-3.1.2.10)
# ---------------------------------------------------------------------------


class TestInputRuleOnARunAlone:
    """A run alone starts each optional input on its default or else null; a Required input
    with no value stops the run and names it; a given null is still refused."""

    @pytest.mark.asyncio
    async def test_a_required_input_with_no_value_stops_the_run(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = make_function_def(
            name="no_values",
            inputs=[
                {"name": "count", "type": "integer", "required": True},
                {"name": "limit", "type": "integer", "required": True, "default": None},
                {"name": "size", "type": "integer", "default": 3},
            ],
            outputs=[{"name": "result", "type": "string"}],
            nodes=[
                make_log_node(
                    "echo",
                    message="str([count is None, limit is None, size])",
                    output_bindings={"line": "result"},
                )
            ],
            edges=[{"source": "start-node", "target": "echo"}],
        )

        result = await execute_scoped_function(function_def=function_def, session_id=session_id)

        assert result.status == "failed"
        assert re.match(r"^'count' is null$", result.error or "")
        assert result.outputs == {}
        assert result.advisory is not None

    @pytest.mark.asyncio
    async def test_each_optional_input_starts_on_its_default_else_null(
        self, session_id: str
    ) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = make_function_def(
            name="no_values_optional",
            inputs=[
                {"name": "note", "type": "string"},
                {"name": "limit", "type": "integer", "default": None},
                {"name": "size", "type": "integer", "default": 3},
            ],
            outputs=[{"name": "result", "type": "string"}],
            nodes=[
                make_log_node(
                    "echo",
                    message="str([note is None, limit is None, size])",
                    output_bindings={"line": "result"},
                )
            ],
            edges=[{"source": "start-node", "target": "echo"}],
        )

        result = await execute_scoped_function(function_def=function_def, session_id=session_id)

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "[True, True, 3]"}
        assert result.advisory is not None

    @pytest.mark.asyncio
    async def test_a_given_null_to_a_required_input_is_refused(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=make_echo_function("count", {"type": "integer", "required": True}),
            start=ScopedStart(input_values={"count": None}),
            session_id=session_id,
        )

        assert result.status == "failed"
        assert result.error == "'count' is null"
        assert result.advisory is None


class TestStoppedBeforeTheBody:
    """A result says whether the run stopped before the Function flow's first Block."""

    @pytest.mark.asyncio
    async def test_a_refused_input_stops_the_run_before_the_body(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=make_echo_function("count", {"type": "integer", "required": True}),
            session_id=session_id,
        )

        assert result.error == "'count' is null"
        assert result.stopped_before_body is True
        assert "echo" not in _block_states(session_id)

    @pytest.mark.asyncio
    async def test_a_literal_null_to_a_required_input_stops_the_run(self, session_id: str) -> None:
        result = await _run(
            make_echo_function("count", {"type": "integer", "required": True}),
            session_id,
            {"count": None},
        )

        assert result.status == "failed"
        assert result.error == "'count' is null"
        assert result.stopped_before_body is True
        assert "echo" not in _block_states(session_id)

    @pytest.mark.asyncio
    async def test_a_body_that_fails_ran(self, session_id: str) -> None:
        function_def = make_function_def(
            name="fails_in_body",
            nodes=[make_log_node("bad", message="undefined_local")],
            edges=[{"source": "start-node", "target": "bad"}],
        )

        result = await _run(function_def, session_id)

        assert result.status == "failed"
        assert result.stopped_before_body is False

    @pytest.mark.asyncio
    async def test_a_passed_run_ran_its_body(self, session_id: str) -> None:
        result = await _run(
            make_echo_function("count", {"type": "integer"}), session_id, {"count": 1}
        )

        assert result.status == "passed", result.error
        assert result.stopped_before_body is False


NOT_A_VALID_INTEGER = re.compile(r"^Script variable 'COUNT' is not a valid integer$")


def _register_shell_script() -> None:
    """Add Shell Script beside the Log plugin the autouse fixture registers."""
    from wavecore.core.plugin_registry import register_plugin
    from wavecore.plugins.shell_script import ShellScriptPlugin

    register_plugin(ShellScriptPlugin())


def _shell_script_node(
    node_id: str,
    *,
    values: dict[str, Any],
    output_bindings: dict[str, str],
    expression_fields: list[str] | None = None,
) -> dict[str, Any]:
    """Build a Shell Script Block in the on-disk shape."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "shell-script",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": values,
                "profileBindings": [],
                "outputBindings": output_bindings,
            },
            "displayName": node_id,
            "expressionFields": expression_fields or [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


class TestScriptVariableBindings:
    """A script variable is read as the type the Function declares for the
    variable it binds to (SHRUN-6, REQ-3.4.1.1)."""

    @pytest.mark.asyncio
    async def test_a_script_variable_arrives_as_the_declared_integer(self, session_id: str) -> None:
        _register_shell_script()
        function_def = make_function_def(
            name="reads_a_count",
            outputs=[{"name": "c", "type": "integer"}],
            nodes=[
                _shell_script_node(
                    "export",
                    values={"script": "COUNT=7", "script_variables": ["COUNT"]},
                    output_bindings={"COUNT": "c"},
                )
            ],
            edges=[{"source": "start-node", "target": "export"}],
        )

        result = await _run(function_def, session_id)

        assert result.status == "passed", result.error
        assert result.outputs["c"] == 7
        assert isinstance(result.outputs["c"], int)

    @pytest.mark.asyncio
    async def test_a_script_variable_that_is_not_an_integer_fails_the_function(
        self, session_id: str
    ) -> None:
        _register_shell_script()
        function_def = make_function_def(
            name="reads_a_bad_count",
            outputs=[{"name": "c", "type": "integer"}],
            nodes=[
                _shell_script_node(
                    "export",
                    values={"script": "COUNT=abc", "script_variables": ["COUNT"]},
                    output_bindings={"COUNT": "c"},
                )
            ],
            edges=[{"source": "start-node", "target": "export"}],
        )

        result = await _run(function_def, session_id)

        assert result.status == "failed"
        assert NOT_A_VALID_INTEGER.match(result.error or "")


class TestPerEntryExpressions:
    """An argument row and an input variable each carry their own expression
    into a Function flow (REQ-3.4.2.2, REQ-3.4.1.1)."""

    @pytest.mark.asyncio
    async def test_an_argument_row_and_an_input_variable_are_evaluated(
        self, session_id: str
    ) -> None:
        _register_shell_script()
        function_def = make_function_def(
            name="resolves_each_entry",
            outputs=[{"name": "out", "type": "string"}],
            variables=[{"name": "n", "value": 5}],
            nodes=[
                _shell_script_node(
                    "echo",
                    values={
                        "script": 'echo "$1 $X"',
                        "arguments": [{"value": "n"}],
                        "input_vars": {"X": "n"},
                    },
                    output_bindings={"stdout": "out"},
                    expression_fields=["arguments.0.value", "input_vars.X"],
                )
            ],
            edges=[{"source": "start-node", "target": "echo"}],
        )

        result = await _run(function_def, session_id)

        assert result.status == "passed", result.error
        assert result.outputs["out"] == "5 5\n"


# ---------------------------------------------------------------------------
# Null declared defaults (REQ-3.1.3.20, REQ-3.1.3.24)
# ---------------------------------------------------------------------------

EVERY_TYPE = ["string", "integer", "float", "boolean", "array", "map", "table"]


async def _run_on_the_engine(
    function_def: dict[str, Any], session_id: str, inputs: dict[str, Any] | None = None
) -> Any:
    """Run the Function as a Function Block does: a live session and a fresh instance scope."""
    from wavecore.api.services.workbench.functions import new_instance_scope

    return await _run(function_def, session_id, inputs, scope=new_instance_scope())


class TestNullDeclaredDefaults:
    """An output declared null that no Block writes returns null, and a local declared
    null reads null, whatever the type."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("value_type", EVERY_TYPE)
    async def test_an_unwritten_output_declared_null_returns_null(
        self, session_id: str, value_type: str
    ) -> None:
        function_def = make_function_def(
            name="null_output",
            outputs=[{"name": "out", "type": value_type, "default": None}],
            nodes=[make_log_node("noop", message="'noop'")],
            edges=[{"source": "start-node", "target": "noop"}],
        )

        result = await _run_on_the_engine(function_def, session_id)

        assert result.status == "passed", result.error
        assert result.outputs == {"out": None}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("value_type", EVERY_TYPE)
    async def test_a_local_declared_null_reads_null(self, session_id: str, value_type: str) -> None:
        function_def = make_function_def(
            name="null_local",
            variables=[{"name": "v", "type": value_type, "value": None}],
            outputs=[{"name": "result", "type": "string"}],
            nodes=[
                make_log_node(
                    "echo",
                    message="'null' if v is None else 'held'",
                    output_bindings={"line": "result"},
                )
            ],
            edges=[{"source": "start-node", "target": "echo"}],
        )

        result = await _run_on_the_engine(function_def, session_id)

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "null"}


# ---------------------------------------------------------------------------
# Output kind (REQ-3.1.2.8)
# ---------------------------------------------------------------------------

TOTAL_EXPRESSION = {
    "name": "total",
    "type": "integer",
    "default": "count * 2",
    "isExpression": True,
}
LABEL_TEMPLATE = {
    "name": "label",
    "type": "string",
    "default": "id-{{ count }}",
    "isTemplate": True,
}


def _kind_function(
    outputs: list[dict[str, Any]], nodes: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    body = nodes or [make_log_node("noop", message="'noop'")]
    return make_function_def(
        name="kinds",
        inputs=[{"name": "count", "type": "integer"}, {"name": "note", "type": "string"}],
        outputs=outputs,
        nodes=body,
        edges=[{"source": "start-node", "target": body[0]["id"]}],
    )


class TestOutputKind:
    """An Expression or Template output is evaluated once, at its first read or when the
    Function returns; a write replaces it; a failure there fails the run and names it."""

    @pytest.mark.asyncio
    async def test_an_expression_output_is_realized_at_return_when_unwritten(
        self, session_id: str
    ) -> None:
        result = await _run_on_the_engine(
            _kind_function([TOTAL_EXPRESSION]), session_id, {"count": 3}
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"total": 6}

    @pytest.mark.asyncio
    async def test_a_write_replaces_an_expression_output(self, session_id: str) -> None:
        function_def = _kind_function(
            [{"name": "label", "type": "string", "default": "'computed'", "isExpression": True}],
            nodes=[make_log_node("writer", message="'written'", output_bindings={"line": "label"})],
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "passed", result.error
        assert result.outputs == {"label": "written"}

    @pytest.mark.asyncio
    async def test_a_template_output_is_rendered_at_return(self, session_id: str) -> None:
        result = await _run_on_the_engine(
            _kind_function([LABEL_TEMPLATE]), session_id, {"count": 3}
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"label": "id-3"}

    @pytest.mark.asyncio
    async def test_a_table_expression_output_returns_a_table_of_its_rows(
        self, session_id: str
    ) -> None:
        from wavecore.core.table import Table

        function_def = _kind_function(
            [
                {
                    "name": "rows",
                    "type": "table",
                    "default": "[{'k': count}, {'k': count * 2}]",
                    "isExpression": True,
                }
            ]
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "passed", result.error
        rows = result.outputs["rows"]
        assert isinstance(rows, Table)
        assert rows.col_names() == ["k"]
        assert [row["k"] for row in rows] == [3, 6]

    @pytest.mark.asyncio
    async def test_a_float_expression_output_returns_an_exact_float(self, session_id: str) -> None:
        function_def = _kind_function(
            [{"name": "ratio", "type": "float", "default": "count * 1.5", "isExpression": True}]
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "passed", result.error
        assert isinstance(result.outputs["ratio"], Decimal)
        assert result.outputs["ratio"] == Decimal("4.5")

    @pytest.mark.asyncio
    async def test_a_whole_number_float_expression_output_returns_an_exact_float(
        self, session_id: str
    ) -> None:
        function_def = _kind_function(
            [{"name": "total", "type": "float", "default": "count + 2", "isExpression": True}]
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "passed", result.error
        assert isinstance(result.outputs["total"], Decimal)
        assert result.outputs["total"] == Decimal(5)

    @pytest.mark.asyncio
    async def test_a_table_expression_output_that_is_not_rows_fails_the_run(
        self, session_id: str
    ) -> None:
        function_def = _kind_function(
            [{"name": "rows", "type": "table", "default": "[count, 2]", "isExpression": True}]
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "failed"
        assert re.match(
            r"^Output 'rows': Parameter 'rows' expects table, got list$", result.error or ""
        )

    @pytest.mark.asyncio
    async def test_a_template_output_with_a_null_piece_fails_the_run(self, session_id: str) -> None:
        function_def = _kind_function(
            [{"name": "label", "type": "string", "default": "id-{{ note }}", "isTemplate": True}]
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "failed"
        assert re.match(r"^'\{\{ note \}\}' in 'label' is null$", result.error or "")

    @pytest.mark.asyncio
    async def test_an_expression_output_that_fails_at_return_fails_the_run(
        self, session_id: str
    ) -> None:
        function_def = _kind_function(
            [{"name": "total", "type": "integer", "default": "1 / 0", "isExpression": True}]
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "failed"
        assert re.match(
            r"^Output 'total': Expression evaluation failed for '1 / 0': division by zero$",
            result.error or "",
        )

    @pytest.mark.parametrize(
        "output",
        [
            pytest.param(TOTAL_EXPRESSION, id="expression"),
            pytest.param(LABEL_TEMPLATE, id="template"),
        ],
    )
    def test_initial_outputs_keeps_a_computed_output_pending(self, output: dict[str, Any]) -> None:
        from wavecore.core.functions.executor import _initial_outputs

        assert _initial_outputs([output]) == {}

    @pytest.mark.asyncio
    async def test_the_starting_values_announce_no_value_for_a_computed_output(
        self, monkeypatch: pytest.MonkeyPatch, session_id: str
    ) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        pushes: list[dict[str, Any]] = []

        async def _capture(
            session_id: str,
            old_vars: dict[str, Any],
            new_vars: dict[str, Any],
            written: Any = None,
        ) -> None:
            pushes.append(dict(new_vars))

        monkeypatch.setattr(_wb_common, "_push_variable_changes", _capture)

        result = await _run_on_the_engine(
            _kind_function([TOTAL_EXPRESSION]), session_id, {"count": 3}
        )

        assert result.status == "passed", result.error
        assert pushes[0].get("count") == 3
        assert "total" not in pushes[0]

    @pytest.mark.asyncio
    async def test_the_function_block_and_a_run_scope_agree(self, session_id: str) -> None:
        from wavecore.api.services.workbench.functions import new_instance_scope
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = _kind_function([TOTAL_EXPRESSION, LABEL_TEMPLATE])
        from_the_block = await _run_block(session_id, function_def, expressions={"count": "3"})
        scope_session = register_engine_session(f"{session_id}-scope")["session_id"]
        scoped = await execute_scoped_function(
            function_def=function_def,
            start=ScopedStart(scope=new_instance_scope(), input_values={"count": 3}),
            session_id=scope_session,
        )

        assert from_the_block == {"total": 6, "label": "id-3"}
        assert scoped.status == "passed", scoped.error
        assert scoped.outputs == {"total": 6, "label": "id-3"}

    @pytest.mark.asyncio
    async def test_a_library_function_block_agrees_with_a_local_one(self, session_id: str) -> None:
        from wavecore.api.services.functions import _storage as function_storage
        from wavecore.api.services.workbench.functions import handle_function_node
        from wavecore.api.services.workbench.node_helpers import _extract_node_fields

        function_storage.save_new_version(
            "kinds-library",
            "1.0.0",
            _kind_function([TOTAL_EXPRESSION, LABEL_TEMPLATE]),
            {"changelog": "initial", "published_at": "2026-01-01T00:00:00Z"},
            name="kinds",
        )
        block = make_function_block(
            "fn-kinds-library",
            {
                "functionLifecycle": "shared",
                "functionId": "kinds-library",
                "functionVersion": "1.0.0",
            },
            values={"count": 3},
        )

        outputs = await handle_function_node(
            _extract_node_fields(block), {}, session_id, "fn-kinds-library"
        )

        assert outputs == {"total": 6, "label": "id-3"}


# ---------------------------------------------------------------------------
# Function-local Expression and Template variables (REQ-3.1.2.1, REQ-3.1.3.15)
# ---------------------------------------------------------------------------

LOCAL_EXPRESSION_PER_TYPE = [
    pytest.param("integer", "count * 2", "str(doubled)", "6", id="integer"),
    pytest.param("float", "count * 1.5", "str(doubled)", "4.5", id="float"),
    pytest.param("string", "'n' + str(count)", "doubled", "n3", id="string"),
    pytest.param("boolean", "count > 2", "str(doubled)", "True", id="boolean"),
    pytest.param("array", "[count, count * 2]", "str(doubled)", "[3, 6]", id="array"),
    pytest.param("map", "{'k': count * 2}", "str(doubled)", "{'k': 6}", id="map"),
    pytest.param("table", "[{'k': count}, {'k': count * 2}]", "str(len(doubled))", "2", id="table"),
]


def _locals_function(variables: list[dict[str, Any]], message: str) -> dict[str, Any]:
    return make_function_def(
        name="locals",
        inputs=[{"name": "count", "type": "integer"}, {"name": "note", "type": "string"}],
        variables=variables,
        outputs=[{"name": "result", "type": "string"}],
        nodes=[make_log_node("echo", message=message, output_bindings={"line": "result"})],
        edges=[{"source": "start-node", "target": "echo"}],
    )


def _expression_local(name: str, value_type: str, source: str) -> dict[str, Any]:
    return {"name": name, "type": value_type, "value": source, "isExpression": True}


class TestFunctionLocalComputedVariables:
    """A Function-local Expression or Template variable holds the value its source gives
    when a Block reads it, never the source text."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("value_type", "source", "message", "expected"), LOCAL_EXPRESSION_PER_TYPE
    )
    async def test_a_local_expression_variable_holds_its_value(
        self, session_id: str, value_type: str, source: str, message: str, expected: str
    ) -> None:
        function_def = _locals_function([_expression_local("doubled", value_type, source)], message)

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "passed", result.error
        assert result.outputs == {"result": expected}

    @pytest.mark.asyncio
    async def test_a_local_table_expression_variable_holds_a_table(self, session_id: str) -> None:
        function_def = _locals_function(
            [_expression_local("doubled", "table", "[{'k': count}, {'k': count * 2}]")],
            "str(doubled.col_names())",
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "['k']"}

    @pytest.mark.asyncio
    async def test_a_local_template_variable_holds_its_rendered_text(self, session_id: str) -> None:
        function_def = _locals_function(
            [{"name": "label", "type": "string", "value": "id-{{ count }}", "isTemplate": True}],
            "label",
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "id-3"}

    @pytest.mark.asyncio
    async def test_a_local_expression_reads_an_input_and_another_local(
        self, session_id: str
    ) -> None:
        function_def = _locals_function(
            [
                {"name": "base", "type": "integer", "value": 10},
                _expression_local("total", "integer", "count + base"),
            ],
            "str(total)",
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 5})

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "15"}

    @pytest.mark.asyncio
    async def test_a_cycle_is_named(self, session_id: str) -> None:
        function_def = _locals_function(
            [
                _expression_local("a", "integer", "b + 1"),
                _expression_local("b", "integer", "a + 1"),
            ],
            "str(a)",
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "failed"
        assert re.match(
            r"^Circular reference detected for variable 'a': a -> b -> a$",
            result.error or "",
        )

    @pytest.mark.asyncio
    async def test_a_type_mismatch_is_named(self, session_id: str) -> None:
        function_def = _locals_function([_expression_local("n", "integer", "'abc'")], "str(n)")

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "failed"
        assert re.match(
            r"^Expression evaluation failed for 'str\(n\)': "
            r"Parameter 'n' expects integer, got str$",
            result.error or "",
        )

    @pytest.mark.asyncio
    async def test_a_null_template_piece_is_named(self, session_id: str) -> None:
        function_def = _locals_function(
            [{"name": "label", "type": "string", "value": "id-{{ note }}", "isTemplate": True}],
            "label",
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "failed"
        assert re.match(r"^'\{\{ note \}\}' in 'label' is null$", result.error or "")

    @pytest.mark.asyncio
    async def test_a_local_expression_evaluates_in_a_run_alone(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = _locals_function(
            [
                {"name": "base", "type": "integer", "value": 4},
                _expression_local("doubled", "integer", "base * 2"),
            ],
            "str(doubled)",
        )

        result = await execute_scoped_function(function_def=function_def, session_id=session_id)

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "8"}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", ["isExpression", "isTemplate"])
    async def test_a_local_of_a_computed_kind_with_no_value_reads_null(
        self, session_id: str, kind: str
    ) -> None:
        function_def = _locals_function([{"name": "x", "type": "string", kind: True}], "str(x)")

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "None"}

    @pytest.mark.asyncio
    async def test_a_local_marked_both_expression_and_template_fails_the_run(
        self, session_id: str
    ) -> None:
        function_def = _locals_function(
            [
                {
                    "name": "x",
                    "type": "string",
                    "value": "'a'",
                    "isExpression": True,
                    "isTemplate": True,
                }
            ],
            "str(x)",
        )

        result = await _run_on_the_engine(function_def, session_id, {"count": 3})

        assert result.status == "failed"
        assert re.match(
            r"^is_expression and is_template are mutually exclusive$", result.error or ""
        ), result.error
