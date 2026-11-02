"""Run-log WARN for an unused input or an unwritten output (REQ-3.1.2.7, FNCFG-5).

Every run of a Function Block writes one WARN line to the run console log for each
declared input no block in it uses and each declared output no block writes,
right after its entry line and before its fields resolve. The line carries the
``FUNCTION`` source and the id of the Function Block, for a Local or a library
Function in the root flow and on a drilled-in Run Scope alike.
"""

from __future__ import annotations

import asyncio
from collections.abc import Generator
from typing import Any

import pytest

UNUSED_INPUT_LINE = "Function 'fmt' declares input 'greeting' but no block uses it"
UNWRITTEN_OUTPUT_LINE = "Function 'fmt' declares output 'summary' but no block writes it"
BODY_LINE = "body-ran"


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
    from wavecore.api.services.workbench import _common as _wb_common
    from wavecore.api.services.workbench import service as workbench_service
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    _wb_common._clear_sessions_sync()
    workbench_service._user_active_session.clear()
    yield
    _wb_common._clear_sessions_sync()
    workbench_service._user_active_session.clear()


@pytest.fixture
def session_id(request: pytest.FixtureRequest) -> Generator[str, None, None]:
    """A live run session of its own, its run log cleared afterwards."""
    from wavecore.api.services import log_streaming_service
    from wavecore.api.services.workbench import _common as _wb_common

    sid = f"param-warn-{request.node.name}"
    _wb_common._workbench_sessions[sid] = _make_run_session(sid)
    yield sid
    log_streaming_service._clear_session_logs(sid)


def _make_run_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Parameter Warn Test",
        "block_states": {},
        "variables": {},
        "scope_failed": False,
        "breakpoints": set(),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
        "websocket_topic": f"workbench:{session_id}",
        "log_topic": f"log:{session_id}",
    }


def _log_node(
    node_id: str,
    message: str,
    *,
    output_bindings: dict[str, str] | None = None,
    disabled: bool = False,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "disabled": disabled,
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
                "outputBindings": output_bindings or {},
            },
            "displayName": node_id,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _fmt_def(
    *,
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    nodes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The Function 'fmt': by default one body block that logs a literal and writes nothing."""
    body = nodes if nodes is not None else [_log_node("inner-log", f"'{BODY_LINE}'")]
    return {
        "name": "fmt",
        "description": "",
        "tags": [],
        "inputs": inputs if inputs is not None else [],
        "outputs": outputs if outputs is not None else [],
        "variables": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": body,
            "edges": [{"source": "start-node", "target": body[0]["id"]}] if body else [],
        },
    }


def _local_instance(
    function_def: dict[str, Any], expressions: dict[str, str] | None = None
) -> dict[str, Any]:
    """A Local Function Block whose fields hold ``expressions``."""
    return {
        "id": "fn-1",
        "type": "workflowNode",
        "data": {
            "label": "fmt",
            "displayName": "fmt",
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": function_def,
            "config": {
                "values": dict(expressions or {}),
                "outputBindings": {},
                "profileBindings": [],
            },
            "expressionFields": list(expressions or {}),
        },
    }


def _library_instance(function_def: dict[str, Any]) -> dict[str, Any]:
    """A library Function saved through the Function service, called at version 1.0.0."""
    from wavecore.api.services.functions import service as functions_service

    payload = {
        **{key: value for key, value in function_def.items() if key != "variables"},
        "changelog": "",
        "details": "",
        "version": "1.0.0",
    }
    definition, _etag = functions_service.create_function(payload)
    return {
        "id": "fn-1",
        "type": "workflowNode",
        "data": {
            "label": "fmt",
            "displayName": "fmt",
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "shared",
            "functionId": definition["id"],
            "functionVersion": "1.0.0",
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


async def _run_block(session_id: str, instance: dict[str, Any]) -> dict[str, Any]:
    """The run of a Function Block in the root flow, as the engine starts it."""
    from wavecore.api.services.workbench.functions import handle_function_node
    from wavecore.api.services.workbench.node_helpers import _extract_node_fields

    outputs: dict[str, Any] = await handle_function_node(
        _extract_node_fields(instance), {}, session_id, instance["id"]
    )
    return outputs


async def _run_scope(session_id: str, instance: dict[str, Any]) -> None:
    """A drilled-in Run Scope of the Function block on the Test canvas."""
    from wavecore.api.services.workbench import service as workbench_service
    from wavecore.api.services.workbench.functions import FunctionCanvas, new_instance_scope
    from wavecore.core.functions.executor import ScopedStart

    run = workbench_service._FunctionRun(
        [FunctionCanvas([instance], [])], instance, (instance["id"],), instance["id"]
    )
    await workbench_service._run_scoped_function(
        session_id, run, ScopedStart(scope=new_instance_scope())
    )


def _log(session_id: str) -> list[dict[str, Any]]:
    from wavecore.api.services import log_streaming_service

    return [e for e in log_streaming_service.get_logs(session_id) if isinstance(e, dict)]


def _lines(session_id: str, text: str) -> list[dict[str, Any]]:
    return [entry for entry in _log(session_id) if entry.get("message") == text]


def _assert_one_function_warn(session_id: str, text: str) -> dict[str, Any]:
    found = _lines(session_id, text)
    assert len(found) == 1, [entry.get("message") for entry in _log(session_id)]
    entry = found[0]
    assert entry["level"] == "WARN"
    assert entry["source"] == "FUNCTION"
    assert entry["blockId"] == "fn-1"
    return entry


def _index_of(session_id: str, text: str) -> int:
    messages = [entry.get("message") for entry in _log(session_id)]
    return messages.index(text)


# ---------------------------------------------------------------------------
# Unwritten output: the canvas call
# ---------------------------------------------------------------------------


class TestPublishedPathWarning:
    @pytest.mark.asyncio
    async def test_unproduced_output_emits_warning(self, session_id: str) -> None:
        function_def = _fmt_def(outputs=[{"name": "summary", "type": "string"}])

        await _run_block(session_id, _local_instance(function_def))

        _assert_one_function_warn(session_id, UNWRITTEN_OUTPUT_LINE)

    @pytest.mark.asyncio
    async def test_written_output_emits_no_warning(self, session_id: str) -> None:
        function_def = _fmt_def(
            outputs=[{"name": "summary", "type": "string"}],
            nodes=[_log_node("writer", "'written'", output_bindings={"line": "summary"})],
        )

        outputs = await _run_block(session_id, _local_instance(function_def))

        assert outputs.get("summary") == "written"
        assert _lines(session_id, UNWRITTEN_OUTPUT_LINE) == []

    @pytest.mark.asyncio
    async def test_defaulted_but_unwritten_output_still_warns(self, session_id: str) -> None:
        function_def = _fmt_def(
            outputs=[{"name": "summary", "type": "string", "default": "fallback"}]
        )

        outputs = await _run_block(session_id, _local_instance(function_def))

        assert outputs.get("summary") == "fallback"
        _assert_one_function_warn(session_id, UNWRITTEN_OUTPUT_LINE)

    @pytest.mark.asyncio
    async def test_a_library_function_call_warns_too(self, session_id: str) -> None:
        function_def = _fmt_def(
            inputs=[{"name": "greeting", "type": "string"}],
            outputs=[{"name": "summary", "type": "string"}],
        )

        await _run_block(session_id, _library_instance(function_def))

        _assert_one_function_warn(session_id, UNUSED_INPUT_LINE)
        _assert_one_function_warn(session_id, UNWRITTEN_OUTPUT_LINE)


# ---------------------------------------------------------------------------
# Unwritten output: the drilled-in Run Scope
# ---------------------------------------------------------------------------


class TestScopedPathWarning:
    @pytest.mark.asyncio
    async def test_scoped_unproduced_output_emits_warning(self, session_id: str) -> None:
        function_def = _fmt_def(outputs=[{"name": "summary", "type": "string"}])

        await _run_scope(session_id, _local_instance(function_def))

        _assert_one_function_warn(session_id, UNWRITTEN_OUTPUT_LINE)

    @pytest.mark.asyncio
    async def test_scoped_written_output_emits_no_warning(self, session_id: str) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        function_def = _fmt_def(
            outputs=[{"name": "summary", "type": "string"}],
            nodes=[_log_node("writer", "'written'", output_bindings={"line": "summary"})],
        )

        await _run_scope(session_id, _local_instance(function_def))

        session = _wb_common._workbench_sessions[session_id]
        assert session["scoped_result"]["outputs"] == {"summary": "written"}
        assert _lines(session_id, UNWRITTEN_OUTPUT_LINE) == []


# ---------------------------------------------------------------------------
# Unused input
# ---------------------------------------------------------------------------


class TestUnusedInputWarning:
    @pytest.mark.asyncio
    async def test_an_unused_input_warns_on_the_canvas_call(self, session_id: str) -> None:
        function_def = _fmt_def(inputs=[{"name": "greeting", "type": "string"}])

        await _run_block(session_id, _local_instance(function_def, {"greeting": "'hi'"}))

        _assert_one_function_warn(session_id, UNUSED_INPUT_LINE)

    @pytest.mark.asyncio
    async def test_an_unused_input_warns_on_a_run_scope(self, session_id: str) -> None:
        function_def = _fmt_def(inputs=[{"name": "greeting", "type": "string"}])

        await _run_scope(session_id, _local_instance(function_def))

        _assert_one_function_warn(session_id, UNUSED_INPUT_LINE)

    @pytest.mark.asyncio
    async def test_a_used_input_gives_no_line(self, session_id: str) -> None:
        function_def = _fmt_def(
            inputs=[{"name": "greeting", "type": "string"}],
            nodes=[_log_node("reader", "greeting")],
        )

        await _run_block(session_id, _local_instance(function_def, {"greeting": "'hi'"}))

        assert _lines(session_id, "hi") != []
        assert _lines(session_id, UNUSED_INPUT_LINE) == []

    @pytest.mark.asyncio
    async def test_an_input_read_only_by_a_muted_block_warns(self, session_id: str) -> None:
        function_def = _fmt_def(
            inputs=[{"name": "greeting", "type": "string"}],
            nodes=[
                _log_node("inner-log", f"'{BODY_LINE}'"),
                _log_node("muted-reader", "greeting", disabled=True),
            ],
        )

        await _run_block(session_id, _local_instance(function_def, {"greeting": "'hi'"}))

        _assert_one_function_warn(session_id, UNUSED_INPUT_LINE)

    @pytest.mark.asyncio
    async def test_inputs_then_outputs_in_declaration_order(self, session_id: str) -> None:
        function_def = _fmt_def(
            inputs=[
                {"name": "greeting", "type": "string"},
                {"name": "salutation", "type": "string"},
            ],
            outputs=[
                {"name": "summary", "type": "string"},
                {"name": "detail", "type": "string"},
            ],
        )

        await _run_block(session_id, _local_instance(function_def))

        warns = [
            entry["message"]
            for entry in _log(session_id)
            if entry.get("level") == "WARN" and entry.get("source") == "FUNCTION"
        ]
        assert warns == [
            UNUSED_INPUT_LINE,
            "Function 'fmt' declares input 'salutation' but no block uses it",
            UNWRITTEN_OUTPUT_LINE,
            "Function 'fmt' declares output 'detail' but no block writes it",
        ]


# ---------------------------------------------------------------------------
# When the lines are printed
# ---------------------------------------------------------------------------


class TestWarningTiming:
    @pytest.mark.asyncio
    async def test_printed_once_at_call_start_before_the_body_runs(self, session_id: str) -> None:
        function_def = _fmt_def(
            inputs=[{"name": "greeting", "type": "string"}],
            outputs=[{"name": "summary", "type": "string"}],
        )

        await _run_block(session_id, _local_instance(function_def))

        _assert_one_function_warn(session_id, UNUSED_INPUT_LINE)
        _assert_one_function_warn(session_id, UNWRITTEN_OUTPUT_LINE)
        body_index = _index_of(session_id, BODY_LINE)
        assert _index_of(session_id, UNUSED_INPUT_LINE) < body_index
        assert _index_of(session_id, UNWRITTEN_OUTPUT_LINE) < body_index

    @pytest.mark.asyncio
    async def test_still_printed_when_a_binding_is_refused(self, session_id: str) -> None:
        function_def = _fmt_def(
            inputs=[{"name": "greeting", "type": "string", "required": True}],
            outputs=[{"name": "summary", "type": "string"}],
        )

        with pytest.raises(RuntimeError, match=r"^'greeting' is null$"):
            await _run_block(session_id, _local_instance(function_def, {"greeting": "None"}))

        _assert_one_function_warn(session_id, UNUSED_INPUT_LINE)
        _assert_one_function_warn(session_id, UNWRITTEN_OUTPUT_LINE)
        assert _lines(session_id, BODY_LINE) == []

    @pytest.mark.asyncio
    async def test_a_refused_input_keeps_the_log_order(self, session_id: str) -> None:
        function_def = _fmt_def(
            inputs=[
                {"name": "req", "type": "string", "required": True},
                {"name": "u", "type": "string"},
            ],
            outputs=[{"name": "o", "type": "string"}],
            nodes=[_log_node("r-log", "'body ' + str(req)")],
        )

        with pytest.raises(RuntimeError, match=r"^'req' is null$"):
            await _run_block(session_id, _local_instance(function_def, {"req": "None"}))

        assert [entry.get("message") for entry in _log(session_id)] == [
            "Entering Function 'fmt'",
            "Function 'fmt' declares input 'u' but no block uses it",
            "Function 'fmt' declares output 'o' but no block writes it",
            "Function 'fmt' completed with status failed: 'req' is null",
        ]

    @pytest.mark.asyncio
    async def test_still_printed_when_the_body_fails(self, session_id: str) -> None:
        function_def = _fmt_def(
            outputs=[{"name": "summary", "type": "string"}],
            nodes=[_log_node("bad", "undefined_name")],
        )

        with pytest.raises(RuntimeError, match=r"^Variable 'undefined_name' is not defined$"):
            await _run_block(session_id, _local_instance(function_def))

        _assert_one_function_warn(session_id, UNWRITTEN_OUTPUT_LINE)

    @pytest.mark.asyncio
    async def test_three_calls_in_a_for_give_three_lines(self, session_id: str) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench import service as workbench_service

        function_def = _fmt_def(
            inputs=[{"name": "greeting", "type": "string"}],
            outputs=[{"name": "summary", "type": "string"}],
        )
        for_node = {
            "id": "for-1",
            "type": "workflowNode",
            "data": {
                "label": "For Loop",
                "elementType": "for",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {
                    "values": {"mode": "count", "count": 3},
                    "outputBindings": {"index": "i"},
                    "profileBindings": [],
                },
                "displayName": "For Loop",
                "expressionFields": [],
                "templateFields": [],
                "variableExpressionKeys": [],
            },
        }
        nodes = [for_node, _local_instance(function_def)]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "fn-1", "sourceHandle": "body"},
        ]

        await asyncio.wait_for(
            workbench_service._execute_workflow(session_id, nodes, edges, {"i": None}),
            timeout=10.0,
        )

        assert _wb_common._workbench_sessions[session_id]["status"] == "passed"
        for text in (UNUSED_INPUT_LINE, UNWRITTEN_OUTPUT_LINE):
            found = _lines(session_id, text)
            assert len(found) == 3, [entry.get("message") for entry in _log(session_id)]
            assert {(e["level"], e["source"], e["blockId"]) for e in found} == {
                ("WARN", "FUNCTION", "fn-1")
            }


class TestResultLineNamesTheCause:
    """A failed call's result line carries its cause, so a failure report names it."""

    @pytest.mark.asyncio
    async def test_a_refused_required_input_is_named_on_the_result_line(
        self, session_id: str
    ) -> None:
        function_def = _fmt_def(inputs=[{"name": "greeting", "type": "string", "required": True}])

        with pytest.raises(RuntimeError, match=r"^'greeting' is null$"):
            await _run_block(session_id, _local_instance(function_def, {"greeting": "None"}))

        found = _lines(
            session_id, "Function 'fmt' completed with status failed: 'greeting' is null"
        )
        assert [(e["level"], e["source"], e["blockId"]) for e in found] == [
            ("ERROR", "FUNCTION", "fn-1")
        ]

    @pytest.mark.asyncio
    async def test_a_passed_call_keeps_the_plain_result_line(self, session_id: str) -> None:
        await _run_block(session_id, _local_instance(_fmt_def()))

        assert len(_lines(session_id, "Function 'fmt' completed with status passed")) == 1


pytestmark = pytest.mark.usefixtures("temp_storage_path")
