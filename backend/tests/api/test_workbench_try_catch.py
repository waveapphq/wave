"""Tests for try/catch/finally execution in workbench_service._execute_workflow.

Tests the try-catch execution engine: path tracing, path node execution,
error interception, catch/finally path routing, and output variable binding.

Coverage targets:
- _trace_path_chain: Dead-end chain tracing from path handles
- _execute_path_nodes: Sequential path node execution with error handling
- _execute_try_catch_paths: Full try/catch/finally orchestration
- _execute_workflow integration: End-to-end workflow with try-catch node
"""

import asyncio
import logging
from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import plugins as _wb_plugins
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench import try_catch as _wb_try_catch


def _make_session(session_id: str) -> dict[str, Any]:
    """Create a minimal workbench session for testing."""
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "Try/Catch Test",
        "scope_failed": False,
    }


def _make_node(
    node_id: str,
    label: str = "Block",
    element_type: str = "delay",
    node_type: str = "control",
    version: str = "1.0.0",
    config_values: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    name: str | None = None,
    disabled: bool = False,
) -> dict[str, Any]:
    """Create a workflow node for testing."""
    config: dict[str, Any] = {"values": config_values or {"duration": 10}}
    if output_bindings:
        config["outputBindings"] = output_bindings
    config.setdefault("profileBindings", [])
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": name or label,
            "elementType": element_type,
            "nodeType": node_type,
            "version": version,
            "config": config,
            "disabled": disabled,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _make_log_node(
    node_id: str,
    name: str,
    message: str = "'ok'",
) -> dict[str, Any]:
    """Create a Log plugin node for testing."""
    node = _make_node(
        node_id,
        label="Log",
        element_type="log",
        node_type="plugin",
        version="1.0.0",
        config_values={"message": message, "level": "INFO"},
        name=name,
    )
    # Log plugin requires "message" in expressionFields to evaluate expressions
    node["data"]["expressionFields"] = ["message"]
    return node


def _make_try_catch_node(
    node_id: str = "tc-1",
    enable_catch: bool = True,
    enable_finally: bool = False,
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Create a Try/Catch control node."""
    return _make_node(
        node_id,
        label="Try/Catch",
        element_type="try-catch-finally",
        node_type="control",
        version="1.0.0",
        config_values={
            "enable_catch": enable_catch,
            "enable_finally": enable_finally,
        },
        output_bindings=output_bindings or {"error": "tc_error", "caught": "tc_caught"},
    )


def _log_messages(session_id: str) -> list[str]:
    """Collect the message text of every log entry emitted for a session."""
    from wavecore.api.services import log_streaming_service

    return [
        entry.get("message", "")
        for entry in log_streaming_service.get_logs(session_id)
        if isinstance(entry, dict)
    ]


def _make_halt_node(node_id: str, message: str) -> dict[str, Any]:
    """Create a Halt control node."""
    node = _make_node(
        node_id,
        label="Halt",
        element_type="halt",
        node_type="control",
        version="1.0.0",
        config_values={"status": "failed", "message": message},
    )
    node["data"]["expressionFields"] = ["message"]
    return node


_WATCH_MESSAGE = "'saw caught=' + str(tc_caught) + ' err=' + str(tc_error)"


def _fail_scope_assert(mode: str) -> dict[str, Any]:
    """A failing Assert in ``mode`` with Fail Current Scope on."""
    return _make_node(
        "inner-assert",
        label="Assert",
        element_type="assert",
        node_type="control",
        version="1.0.0",
        config_values={
            "assertions": [{"type": "expression", "expression": "False"}],
            "mode": mode,
            "fail_current_scope": True,
        },
        name="Assert in try-body",
    )


class TestTryCatchWorkflowExecution:
    """End-to-end try-catch workflow execution tests."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Register controls/plugins and clear sessions before/after each test."""
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_try_ok_catch_on_finally_off(self) -> None:
        """Try succeeds, catch on, finally off - try + then."""
        session_id = "tc-f1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "'try-ok'"),
            _make_log_node("catch-log", "Catch Log", "'catch-ran'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-log"] == "passed"
        assert session["block_states"]["catch-log"] == "skipped"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_try_ok_catch_off_finally_off(self) -> None:
        """Try succeeds, catch off, finally off - try + then."""
        session_id = "tc-f2"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=False, enable_finally=False),
            _make_log_node("try-log", "Try Log", "'try-ok'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_try_ok_catch_on_finally_on(self) -> None:
        """Try succeeds, catch on, finally on - try + finally + then."""
        session_id = "tc-f3"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_log_node("try-log", "Try Log", "'try-ok'"),
            _make_log_node("catch-log", "Catch Log", "'catch-ran'"),
            _make_log_node("fin-log", "Finally Log", "'cleanup'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-log"] == "passed"
        assert session["block_states"]["catch-log"] == "skipped"
        assert session["block_states"]["fin-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_try_fails_catch_handles(self) -> None:
        """Try fails, catch on, finally off - catch + then."""
        session_id = "tc-f5"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # Use a Log node with expression that throws (1/0)
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "1/0"),  # ZeroDivisionError
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-log"] == "failed"
        assert session["block_states"]["catch-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"
        # Verify output bindings
        assert variables["tc_caught"] is True
        assert variables["tc_error"] is not None
        assert variables["tc_error"]["type"] == "InvalidExpressionError"

    @pytest.mark.asyncio
    async def test_try_fails_then_repeat_resolves_takes_then_path(self) -> None:
        """Commit semantics: a Repeat Step that passes during the error pause is the try node's
        result, so Continue takes 'then' and the catch path never runs (REQ-3.2.1.4)."""
        session_id = "tc-repeat-resolve"
        session = _make_session(session_id)
        session["pause_event"] = asyncio.Event()
        session["paused_node_id"] = None
        session["debug_options"] = {"pause_on_errors": True}
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "'ok' if 1 / flag else ''"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False, "flag": 0}
        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, variables)
        )
        for _ in range(300):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "try-log":
                break
        assert session.get("paused_node_id") == "try-log"
        variables["flag"] = 1
        workbench_service.repeat_step(session_id=session_id)
        for _ in range(300):
            await asyncio.sleep(0.01)
            if session["block_states"].get("try-log") == "passed":
                break
        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=5.0)

        assert session["status"] == "passed"
        assert session["block_states"]["try-log"] == "passed"
        assert session["block_states"]["catch-log"] == "skipped"
        assert session["block_states"]["after-log"] == "passed"
        assert variables["tc_caught"] is False

    @pytest.mark.asyncio
    async def test_try_fails_catch_disabled(self) -> None:
        """Try fails, catch off, finally off - error suppressed."""
        session_id = "tc-f6"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=False, enable_finally=False),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-log"] == "failed"
        assert session["block_states"]["after-log"] == "passed"
        assert variables["tc_caught"] is True

    @pytest.mark.asyncio
    async def test_try_fails_catch_on_finally_on(self) -> None:
        """Try fails, catch on, finally on - catch + finally + then."""
        session_id = "tc-f7"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("fin-log", "Finally Log", "'cleanup'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-log"] == "failed"
        assert session["block_states"]["catch-log"] == "passed"
        assert session["block_states"]["fin-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_try_fails_catch_off_finally_on(self) -> None:
        """Try fails, catch off, finally on - finally + then."""
        session_id = "tc-f8"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=False, enable_finally=True),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("fin-log", "Finally Log", "'cleanup'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-log"] == "failed"
        assert session["block_states"]["fin-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_catch_also_fails_session_fails(self) -> None:
        """Catch path also fails - session fails, finally still runs."""
        session_id = "tc-catch-fail"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("catch-log", "Catch Log", "1/0"),  # catch also throws
            _make_log_node("fin-log", "Finally Log", "'cleanup'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["try-log"] == "failed"
        assert session["block_states"]["catch-log"] == "failed"
        # Finally still runs even after catch failure
        assert session["block_states"]["fin-log"] == "passed"
        # After-log skipped because catch error propagated
        assert session["block_states"]["after-log"] == "skipped"

    @pytest.mark.asyncio
    async def test_finally_fails_converts_success_to_failure(self) -> None:
        """Try OK, finally fails - success converted to failure (REQ-3.2.2.11)."""
        session_id = "tc-fin-fail"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_log_node("try-log", "Try Log", "'ok'"),
            _make_log_node("catch-log", "Catch Log", "'nope'"),
            _make_log_node("fin-log", "Finally Log", "1/0"),  # finally throws
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["try-log"] == "passed"
        assert session["block_states"]["catch-log"] == "skipped"
        assert session["block_states"]["fin-log"] == "failed"
        assert session["block_states"]["after-log"] == "skipped"

    @pytest.mark.asyncio
    async def test_error_variable_schema(self) -> None:
        """Verify error object has all required fields per design."""
        session_id = "tc-error-schema"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        error = variables["tc_error"]
        assert error is not None
        # All required fields
        assert "type" in error
        assert "message" in error
        assert "node" in error
        assert "node_id" in error
        assert "element_type" in error
        assert "timestamp" in error
        assert "is_retryable" in error
        assert "category" in error
        assert "stack_trace" in error
        # Verify correct values
        assert error["type"] == "InvalidExpressionError"
        assert error["node"] == "Try Log"
        assert error["node_id"] == "try-log"
        assert error["element_type"] == "log"
        assert isinstance(error["is_retryable"], bool)
        assert error["category"] in ("transient", "permanent", "critical")

    @pytest.mark.asyncio
    async def test_a_caught_policy_refusal_is_a_permanent_connection_error(self) -> None:
        """REQ-4.3.1: a forward the SSH host's policy refuses is not marked retryable."""
        session_id = "tc-policy-refusal"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        refusal = (
            "SSH tunnel to db:5432 failed: bastion refused to forward (administratively prohibited)"
        )

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "'ok'"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
        ]
        original_execute = _wb_plugins._execute_plugin

        async def refuse_in_try(*args: Any, **kwargs: Any) -> Any:
            if kwargs["block_id"] == "try-log":
                raise ConnectionError(refusal)
            return await original_execute(*args, **kwargs)

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin", side_effect=refuse_in_try
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        error = variables["tc_error"]
        assert (error["type"], error["message"]) == ("ConnectionError", refusal)
        assert (error["is_retryable"], error["category"]) == (False, "permanent")

    @pytest.mark.asyncio
    async def test_try_chain_with_multiple_nodes(self) -> None:
        """Try path has multiple nodes in a chain - all execute sequentially."""
        session_id = "tc-chain"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-1", "Try Step 1", "'step-1'"),
            _make_log_node("try-2", "Try Step 2", "'step-2'"),
            _make_log_node("try-3", "Try Step 3", "'step-3'"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-1", "sourceHandle": "try"},
            {"source": "try-1", "target": "try-2"},
            {"source": "try-2", "target": "try-3"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        for nid in ("try-1", "try-2", "try-3"):
            assert session["block_states"][nid] == "passed"
        assert session["block_states"]["catch-log"] == "skipped"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_try_chain_middle_node_fails(self) -> None:
        """Middle node in try chain fails - remaining nodes skipped."""
        session_id = "tc-chain-fail"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-1", "Try Step 1", "'ok'"),
            _make_log_node("try-2", "Try Step 2", "1/0"),  # fails
            _make_log_node("try-3", "Try Step 3", "'never'"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-1", "sourceHandle": "try"},
            {"source": "try-1", "target": "try-2"},
            {"source": "try-2", "target": "try-3"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-1"] == "passed"
        assert session["block_states"]["try-2"] == "failed"
        assert session["block_states"]["try-3"] == "skipped"
        assert session["block_states"]["catch-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"
        assert variables["tc_error"]["node"] == "Try Step 2"

    @pytest.mark.asyncio
    async def test_disabled_node_in_path_is_skipped(self) -> None:
        """Disabled node in try path gets skipped status."""
        session_id = "tc-disabled"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        disabled_node = _make_log_node("try-2", "Disabled Log", "'skip-me'")
        disabled_node["data"]["disabled"] = True

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-1", "Try Step 1", "'ok'"),
            disabled_node,
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-1", "sourceHandle": "try"},
            {"source": "try-1", "target": "try-2"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["try-1"] == "passed"
        assert session["block_states"]["try-2"] == "skipped"

    @pytest.mark.asyncio
    async def test_catch_enabled_empty_chain(self) -> None:
        """Catch enabled but no catch-handle edge - error suppressed."""
        session_id = "tc-empty-catch"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            # No catch edge - catch enabled but nothing connected
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        # Error caught and suppressed (empty catch path)
        assert session["status"] == "passed"
        assert variables["tc_caught"] is True
        assert variables["tc_error"] is not None

    @pytest.mark.asyncio
    async def test_node_before_and_after_try_catch(self) -> None:
        """Nodes before and after try-catch execute in correct order."""
        session_id = "tc-before-after"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_log_node("before-log", "Before Log", "'before'"),
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "'try-ok'"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "before-log"},
            {"source": "before-log", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["before-log"] == "passed"
        assert session["block_states"]["try-log"] == "passed"
        assert session["block_states"]["catch-log"] == "skipped"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_profile_bindings_in_path_nodes(self) -> None:
        """Path nodes with profile bindings execute correctly."""
        session_id = "tc-profiles"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # Node with empty profile bindings (common case)
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "'ok'"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_control_node_in_try_path(self) -> None:
        """A control node (e.g., Delay) in the try path executes correctly."""
        session_id = "tc-control-path"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_node(
                "try-delay", "Delay", "delay", "control", "1.0.0", config_values={"duration": 1}
            ),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-delay", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-delay"] == "passed"

    @pytest.mark.asyncio
    async def test_path_node_with_output_bindings(self) -> None:
        """Path node with output bindings populates variables."""
        session_id = "tc-output-bindings"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # Log plugin returns output bindings (message_length, etc.)
        log_node = _make_log_node("try-log", "Try Log", "'hello'")
        log_node["data"]["config"]["outputBindings"] = {"message_length": "msg_len"}

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            log_node,
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_session_stopped_during_path_execution(self) -> None:
        """Session stopped mid-path breaks out of path node loop."""
        session_id = "tc-stopped"
        session = _make_session(session_id)
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-1", "Try Step 1", "'ok'"),
            _make_log_node("try-2", "Try Step 2", "'ok'"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-1", "sourceHandle": "try"},
            {"source": "try-1", "target": "try-2"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        # Stop the session after first path node executes
        original_execute = _wb_plugins._execute_plugin

        async def stop_after_first(*args: Any, **kwargs: Any) -> Any:
            result = await original_execute(*args, **kwargs)
            session["status"] = _wb_common.WorkbenchStatus.STOPPED.value
            return result

        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            side_effect=stop_after_first,
        ):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["try-1"] == "passed"
        # try-2 should not have executed due to session stop
        assert session["block_states"].get("try-2") is None

    @pytest.mark.asyncio
    async def test_path_with_profile_bindings(self) -> None:
        """Path nodes with non-empty profile bindings trigger injection."""
        session_id = "tc-profile-inject"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        log_node = _make_log_node("try-log", "Try Log", "'ok'")
        # Add profile bindings to trigger _inject_profile_variables
        log_node["data"]["config"]["profileBindings"] = [
            {"parameter": "message", "profile_variable": "env.greeting"}
        ]

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            log_node,
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        # Profile injection may fail (no environment_id) but node still executes
        assert session["block_states"]["try-log"] in ("passed", "failed")

    @pytest.mark.asyncio
    async def test_path_chain_with_non_workflow_node(self) -> None:
        """Non-workflowNode type in chain causes chain tracing to stop."""
        session_id = "tc-non-wf"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # Create a node with non-workflowNode type in the path chain
        non_wf_node = _make_log_node("try-log", "Try Log", "'ok'")
        non_wf_node["type"] = "startNode"  # Not "workflowNode"

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            non_wf_node,
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        # Chain tracing stops at non-workflowNode, so try-log is excluded from chain
        # Session should still pass (empty try chain = no error)
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_path_node_missing_from_node_map_skipped(self) -> None:
        """Node in chain but missing from node_map is skipped by _execute_path_nodes."""
        session_id = "tc-missing-node"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "'ok'"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        # Mock _trace_path_chain to return a chain with a ghost node
        original_trace = _wb_try_catch._trace_path_chain

        def patched_trace(start_node_id: str, adj: Any, node_map: Any, executed: Any) -> list[str]:
            chain = original_trace(start_node_id, adj, node_map, executed)
            if start_node_id == "try-log":
                chain.append("ghost-node")  # Not in node_map
            return chain

        with patch(
            "wavecore.api.services.workbench.try_catch._trace_path_chain",
            side_effect=patched_trace,
        ):
            await workbench_service._execute_workflow(
                session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
            )

        session = _wb_common._workbench_sessions[session_id]
        # Ghost node doesn't crash - skipped gracefully
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_path_node_with_result_output_bindings(self) -> None:
        """Path node that returns result with matching output bindings populates variables."""
        session_id = "tc-result-bindings"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # Use a Delay control node which returns a result dict with actual_duration_ms
        delay_node = _make_node(
            "try-delay",
            "Delay",
            "delay",
            "control",
            "1.0.0",
            config_values={"duration": 1},
            output_bindings={"actual_duration_ms": "delay_time"},
            name="Try Delay",
        )

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            delay_node,
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-delay", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False, "delay_time": None}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Delay plugin returns elapsed_ms in its result dict
        # The output binding should have populated delay_time variable
        assert variables.get("delay_time") is not None

    @pytest.mark.asyncio
    async def test_try_catch_without_then_handle(self) -> None:
        """Try-catch with no 'then' egress edge completes without error."""
        session_id = "tc-no-then"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "'ok'"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
        ]
        # No "then" handle edge - only try and catch
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["try-log"] == "passed"
        assert session["block_states"]["catch-log"] == "skipped"


class TestApplyPathOutputBindings:
    """Unit tests for _apply_path_output_bindings."""

    def test_applies_matching_bindings(self) -> None:
        variables: dict[str, Any] = {}
        _wb_try_catch._apply_path_output_bindings(
            {"out1": "val1", "out2": "val2"},
            {"out1": "var_a", "out2": "var_b"},
            variables,
        )
        assert variables == {"var_a": "val1", "var_b": "val2"}

    def test_skips_missing_result_keys(self) -> None:
        variables: dict[str, Any] = {}
        _wb_try_catch._apply_path_output_bindings(
            {"out1": "val1"},
            {"out1": "var_a", "out2": "var_b"},
            variables,
        )
        assert variables == {"var_a": "val1"}

    def test_no_op_for_empty_result(self) -> None:
        variables: dict[str, Any] = {}
        _wb_try_catch._apply_path_output_bindings(None, {"out1": "var"}, variables)
        assert variables == {}

    def test_no_op_for_empty_bindings(self) -> None:
        variables: dict[str, Any] = {}
        _wb_try_catch._apply_path_output_bindings({"out1": "v"}, {}, variables)
        assert variables == {}


class TestRecordNodeFailure:
    """A path node failure is logged to the backend with the run's secrets masked."""

    @pytest.mark.asyncio
    async def test_the_failure_log_line_masks_a_secret_value(
        self, wavecore_log: list[logging.LogRecord]
    ) -> None:
        from wavecore.api.services import log_streaming_service
        from wavecore.core.secrets.registry import SecretRegistry

        session_id = "record-node-failure"
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        log_streaming_service.register_secret_registry(session_id, registry)
        try:
            await _wb_try_catch._record_node_failure(
                _make_session(session_id),
                session_id,
                "n1",
                "N1",
                RuntimeError("token s3cr3t-t0ken-99 refused"),
            )
        finally:
            log_streaming_service._clear_session_logs(session_id)

        assert [
            record.getMessage()
            for record in wavecore_log
            if record.name == "wavecore.api.services.workbench._common"
        ] == ["Try-catch path node n1 failed: token ******** refused"]


class TestTracePathChainHelpers:
    """Unit tests for _has_control_handles and _find_next_chain_node."""

    def test_has_control_handles_with_body(self) -> None:
        children: list[tuple[str, str | None]] = [("n1", "body"), ("n2", "then")]
        assert _wb_try_catch._has_control_handles(children) is True

    def test_has_control_handles_no_controls(self) -> None:
        children: list[tuple[str, str | None]] = [("n1", None), ("n2", None)]
        assert _wb_try_catch._has_control_handles(children) is False

    def test_find_next_control_node_follows_then(self) -> None:
        children: list[tuple[str, str | None]] = [("n1", "body"), ("n2", "then")]
        result = _wb_try_catch._find_next_chain_node(children, True, set(), set())
        assert result == "n2"

    def test_find_next_control_node_skips_executed(self) -> None:
        children: list[tuple[str, str | None]] = [("n1", "body"), ("n2", "then")]
        result = _wb_try_catch._find_next_chain_node(children, True, {"n2"}, set())
        assert result is None

    def test_find_next_control_node_skips_visited(self) -> None:
        children: list[tuple[str, str | None]] = [("n1", "body"), ("n2", "then")]
        result = _wb_try_catch._find_next_chain_node(children, True, set(), {"n2"})
        assert result is None

    def test_find_next_regular_node(self) -> None:
        children: list[tuple[str, str | None]] = [("n1", None), ("n2", None)]
        result = _wb_try_catch._find_next_chain_node(children, False, set(), set())
        assert result == "n1"

    def test_find_next_no_match_returns_none(self) -> None:
        """Control node with no 'then' handle returns None."""
        children: list[tuple[str, str | None]] = [("n1", "body")]
        result = _wb_try_catch._find_next_chain_node(children, True, set(), set())
        assert result is None


class TestNestedDispatchInTryCatch:
    """Tests for nested control dispatch paths in try-catch execution."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_path_node_nested_dispatch_error(self) -> None:
        """Nested dispatch error in path node marks node failed."""
        from wavecore.api.services.workbench import nested as _nested

        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
        }
        node = _make_log_node("n1", "N1", "'x'")

        with patch.object(_nested, "dispatch_nested_signals", return_value="error"):
            err = await _wb_try_catch._execute_single_path_node(
                "n1",
                {"n1": node},
                {},
                session,
                "s1",
                set(),
                None,
                adj={"n1": []},
            )

        assert isinstance(err, RuntimeError)
        assert session["block_states"]["n1"] == "failed"

    @pytest.mark.asyncio
    async def test_path_node_no_adj_uses_simple_path(self) -> None:
        """Without adj, uses simple strip-and-apply path."""
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
        }
        node = _make_log_node("n1", "N1", "'x'")

        err = await _wb_try_catch._execute_single_path_node(
            "n1",
            {"n1": node},
            {},
            session,
            "s1",
            set(),
            None,
        )

        assert err is None
        assert session["block_states"]["n1"] == "passed"

    @pytest.mark.asyncio
    async def test_path_nodes_session_signal_breaks_chain(self) -> None:
        """Session signal during path execution breaks the chain."""
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
            "_halt": True,
        }
        node1 = _make_log_node("n1", "N1", "'x'")
        node2 = _make_log_node("n2", "N2", "'y'")

        err = await _wb_try_catch._execute_path_nodes(
            ["n1", "n2"],
            {"n1": node1, "n2": node2},
            {},
            session,
            "s1",
            set(),
            None,
        )

        assert err is None
        # n1 should not have executed due to halt signal
        assert session["block_states"] == {"n1": "skipped", "n2": "skipped"}

    @pytest.mark.asyncio
    async def test_path_nodes_skips_already_executed(self) -> None:
        """Already-executed nodes are skipped in path execution."""
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
        }
        node1 = _make_log_node("n1", "N1", "'x'")
        node2 = _make_log_node("n2", "N2", "'y'")
        executed = {"n1"}

        err = await _wb_try_catch._execute_path_nodes(
            ["n1", "n2"],
            {"n1": node1, "n2": node2},
            {},
            session,
            "s1",
            executed,
            None,
        )

        assert err is None
        # n1 was skipped, n2 executed
        assert session["block_states"].get("n2") == "passed"

    @pytest.mark.asyncio
    async def test_halt_in_try_path_propagates_without_catching(self) -> None:
        """Halt inside try path skips catch/finally and propagates."""
        session_id = "halt-try"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # Use halt node in try path
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_node(
                "halt-1",
                label="Halt",
                element_type="halt",
                node_type="control",
                version="1.0.0",
                config_values={"status": "failed", "message": "'stop'"},
            ),
            _make_log_node("catch-log", "Catch", "'caught'"),
            _make_log_node("fin-log", "Finally", "'fin'"),
        ]
        nodes[1]["data"]["expressionFields"] = ["message"]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "halt-1", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        # Halt propagates: catch and finally should be skipped
        assert session["block_states"]["catch-log"] == "skipped"
        assert session["block_states"]["fin-log"] == "skipped"

    @pytest.mark.asyncio
    async def test_halt_in_catch_path_skips_finally(self) -> None:
        """Halt inside catch path skips finally and propagates."""
        session_id = "halt-catch"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # Failing try path triggers catch, halt in catch skips finally
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_node(
                "fail-1",
                label="Fail",
                element_type="log",
                node_type="plugin",
                version="1.0.0",
                config_values={"message": "raise ValueError('boom')", "level": "INFO"},
            ),
            _make_node(
                "halt-catch",
                label="Halt",
                element_type="halt",
                node_type="control",
                version="1.0.0",
                config_values={"status": "failed", "message": "'halt-in-catch'"},
            ),
            _make_log_node("fin-log", "Finally", "'fin'"),
        ]
        nodes[1]["data"]["expressionFields"] = ["message"]
        nodes[2]["data"]["expressionFields"] = ["message"]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "fail-1", "sourceHandle": "try"},
            {"source": "tc-1", "target": "halt-catch", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["fin-log"] == "skipped"

    @pytest.mark.asyncio
    async def test_halt_in_finally_path_propagates(self) -> None:
        """Halt inside finally path propagates immediately."""
        session_id = "halt-fin"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=False, enable_finally=True),
            _make_log_node("try-log", "Try", "'ok'"),
            _make_node(
                "halt-fin",
                label="Halt",
                element_type="halt",
                node_type="control",
                version="1.0.0",
                config_values={"status": "failed", "message": "'halt-in-finally'"},
            ),
            _make_log_node("then-log", "Then", "'after'"),
        ]
        nodes[2]["data"]["expressionFields"] = ["message"]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "halt-fin", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "then-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        # Halt in finally should propagate
        assert session["status"] == "failed"

    @pytest.mark.asyncio
    async def test_nested_for_each_inside_try_path(self) -> None:
        """ForEach nested inside try path dispatches correctly."""
        session_id = "nested-fe-try"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        fe_node = _make_node(
            "fe-1",
            label="ForEach",
            element_type="for-each",
            node_type="control",
            version="1.0.0",
            config_values={"collection": ["a", "b"]},
            output_bindings={"item": "fe_item", "index": "fe_idx"},
        )
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            fe_node,
            _make_log_node("body-log", "Body", "'iter'"),
            _make_log_node("then-fe", "ThenFE", "'fe-done'"),
            _make_log_node("then-tc", "ThenTC", "'tc-done'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "fe-1", "sourceHandle": "try"},
            {"source": "fe-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "fe-1", "target": "then-fe", "sourceHandle": "then"},
            {"source": "tc-1", "target": "then-tc", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {"tc_error": None, "tc_caught": False, "fe_item": None, "fe_idx": None},
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "passed"
        assert session["block_states"]["then-fe"] == "passed"
        assert session["block_states"]["then-tc"] == "passed"

    @pytest.mark.asyncio
    async def test_nested_try_catch_inside_try_path(self) -> None:
        """Try-catch nested inside another try-catch's try path."""
        session_id = "nested-tc-try"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        inner_tc = _make_try_catch_node(
            "inner-tc",
            enable_catch=True,
            enable_finally=False,
            output_bindings={"error": "inner_err", "caught": "inner_caught"},
        )
        nodes = [
            _make_try_catch_node("outer-tc", enable_catch=True, enable_finally=False),
            inner_tc,
            _make_log_node("inner-try", "InnerTry", "'inner-ok'"),
            _make_log_node("then-outer", "ThenOuter", "'outer-done'"),
        ]
        edges = [
            {"source": "start-node", "target": "outer-tc"},
            {"source": "outer-tc", "target": "inner-tc", "sourceHandle": "try"},
            {"source": "inner-tc", "target": "inner-try", "sourceHandle": "try"},
            {"source": "outer-tc", "target": "then-outer", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {"tc_error": None, "tc_caught": False, "inner_err": None, "inner_caught": False},
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["inner-try"] == "passed"
        assert session["block_states"]["then-outer"] == "passed"

    @pytest.mark.asyncio
    async def test_nested_try_catch_failure_in_loop_body(self) -> None:
        """Try-catch inside for-each body where catch path fails propagates error."""
        session_id = "nested-tc-fail"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        fe_node = _make_node(
            "fe-1",
            label="ForEach",
            element_type="for-each",
            node_type="control",
            version="1.0.0",
            config_values={"collection": ["a"]},
            output_bindings={"item": "fe_item", "index": "fe_idx"},
        )
        inner_tc = _make_try_catch_node(
            "inner-tc",
            enable_catch=True,
            enable_finally=False,
            output_bindings={"error": "inner_err", "caught": "inner_caught"},
        )
        # Fail node throws, catch node also throws -> catch fails -> error
        fail_node = _make_node(
            "try-fail",
            label="TryFail",
            element_type="log",
            node_type="plugin",
            version="1.0.0",
            config_values={"message": "raise ValueError('try-boom')", "level": "INFO"},
        )
        fail_node["data"]["expressionFields"] = ["message"]
        catch_fail = _make_node(
            "catch-fail",
            label="CatchFail",
            element_type="log",
            node_type="plugin",
            version="1.0.0",
            config_values={"message": "raise ValueError('catch-boom')", "level": "INFO"},
        )
        catch_fail["data"]["expressionFields"] = ["message"]

        nodes = [fe_node, inner_tc, fail_node, catch_fail]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "inner-tc", "sourceHandle": "body"},
            {"source": "inner-tc", "target": "try-fail", "sourceHandle": "try"},
            {"source": "inner-tc", "target": "catch-fail", "sourceHandle": "catch"},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {"fe_item": None, "fe_idx": None, "inner_err": None, "inner_caught": False},
        )

        session = _wb_common._workbench_sessions[session_id]
        # Try fails, catch fails -> nested TC returns error -> loop aborts
        assert session["status"] == "failed"

    @pytest.mark.asyncio
    async def test_nested_try_catch_halt_in_loop_body(self) -> None:
        """Halt inside nested try-catch in loop body propagates halt signal."""
        session_id = "nested-tc-halt"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        fe_node = _make_node(
            "fe-1",
            label="ForEach",
            element_type="for-each",
            node_type="control",
            version="1.0.0",
            config_values={"collection": ["a"]},
            output_bindings={"item": "fe_item", "index": "fe_idx"},
        )
        inner_tc = _make_try_catch_node(
            "inner-tc",
            enable_catch=True,
            enable_finally=False,
            output_bindings={"error": "inner_err", "caught": "inner_caught"},
        )
        halt_node = _make_node(
            "halt-1",
            label="Halt",
            element_type="halt",
            node_type="control",
            version="1.0.0",
            config_values={"status": "failed", "message": "'halt-in-nested-tc'"},
        )
        halt_node["data"]["expressionFields"] = ["message"]

        nodes = [fe_node, inner_tc, halt_node]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "inner-tc", "sourceHandle": "body"},
            {"source": "inner-tc", "target": "halt-1", "sourceHandle": "try"},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {"fe_item": None, "fe_idx": None, "inner_err": None, "inner_caught": False},
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"


class TestTryCatchWithAFailCurrentScopeAssert:
    """A single-mode Assert failure is caught like any block failure; a split mark never is."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_a_single_mode_assert_failure_is_caught(self) -> None:
        """Try-body Assert(single, fail_current_scope=True, False) fails as a block: the
        catch branch runs, the flow leaves by then, nothing is marked and the test passes.
        """
        session_id = "tc-catches-single-assert"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        tc_node = _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False)
        # Wire outputBindings to an empty dict so the test save pipeline does
        # not require declared variables for `error` (map) / `caught` (bool).
        tc_node["data"]["config"]["outputBindings"] = {}

        nodes = [
            tc_node,
            _fail_scope_assert("single"),
            _make_log_node("catch-log", "Catch Log", "'catch-ran'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "inner-assert", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"].get("inner-assert") == "failed", session["block_states"]
        assert session["block_states"].get("catch-log") == "passed", session["block_states"]
        assert session["block_states"].get("after-log") == "passed", session["block_states"]
        assert session.get("scope_failed") is False, session.get("scope_failed")
        assert session["status"] == "passed", session.get("status")

    @pytest.mark.asyncio
    async def test_a_split_assert_mark_runs_no_catch_and_is_never_cleared(self) -> None:
        """Try-body Assert(split, fail_current_scope=True, False) marks the Test and goes on
        down its fail branch: the catch branch never runs and the test ends failed.
        """
        session_id = "tc-keeps-split-mark"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        tc_node = _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False)
        tc_node["data"]["config"]["outputBindings"] = {}

        nodes = [
            tc_node,
            _fail_scope_assert("split"),
            _make_log_node("fail-log", "Fail Branch", "'fail-branch'"),
            _make_log_node("catch-log", "Catch Log", "'catch-ran'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "inner-assert", "sourceHandle": "try"},
            {"source": "inner-assert", "target": "fail-log", "sourceHandle": "fail"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"].get("fail-log") == "passed", session["block_states"]
        assert session["block_states"].get("catch-log") in (None, "skipped")
        assert session["block_states"].get("after-log") == "passed", session["block_states"]
        assert session.get("scope_failed") is True, session.get("scope_failed")
        assert session["status"] == "failed", session.get("status")

    @pytest.mark.asyncio
    async def test_halt_in_catch_path_after_scope_fail_skips_finally_and_then(
        self,
    ) -> None:
        """Catch chain holds a Halt after a failing single-mode Assert in the try body:
        finally is skipped and the then-egress is queued (not executed because halt
        propagates upward)."""
        session_id = "tc-scope-fail-halt-catch"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        tc_node = _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True)
        tc_node["data"]["config"]["outputBindings"] = {}

        assert_in_try = _fail_scope_assert("single")

        halt_in_catch = _make_node(
            "halt-catch",
            label="Halt",
            element_type="halt",
            node_type="control",
            version="1.0.0",
            config_values={"status": "failed", "message": "'halt-after-scope-fail'"},
        )
        halt_in_catch["data"]["expressionFields"] = ["message"]

        nodes = [
            tc_node,
            assert_in_try,
            halt_in_catch,
            _make_log_node("fin-log", "Finally", "'fin'"),
            _make_log_node("then-log", "Then", "'then'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "inner-assert", "sourceHandle": "try"},
            {"source": "tc-1", "target": "halt-catch", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "then-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        # Finally chain was skipped (halt-in-catch fired before finally ran).
        assert session["block_states"].get("fin-log") == "skipped", session["block_states"]


class TestTryCatchBindsOutputsBeforeHandlers:
    """REQ-3.2.2.6: the handler receives the structured error object and THEN
    executes, so catch-path and finally-path blocks read the control's ``error``
    and ``caught`` outputs while they run."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_catch_path_reads_error_and_caught_while_running(self) -> None:
        """A catch-path block sees the populated error object and caught=True."""
        session_id = "tc-catch-sees-error"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("catch-log", "Catch Log", _WATCH_MESSAGE),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        seen = [m for m in _log_messages(session_id) if m.startswith("saw ")]
        assert len(seen) == 1, seen
        assert "caught=True" in seen[0], seen[0]
        assert "InvalidExpressionError" in seen[0], seen[0]
        # The post-construct state stays correct.
        assert variables["tc_caught"] is True
        assert variables["tc_error"]["type"] == "InvalidExpressionError"

    @pytest.mark.asyncio
    async def test_finally_path_reads_error_and_caught_while_running(self) -> None:
        """A finally-path block sees the populated error object and caught=True."""
        session_id = "tc-finally-sees-error"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("fin-log", "Finally Log", _WATCH_MESSAGE),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        seen = [m for m in _log_messages(session_id) if m.startswith("saw ")]
        assert len(seen) == 1, seen
        assert "caught=True" in seen[0], seen[0]
        assert "InvalidExpressionError" in seen[0], seen[0]

    @pytest.mark.asyncio
    async def test_no_error_path_reads_cleared_outputs_while_running(self) -> None:
        """With no try-path error the finally block reads caught=False/error=None."""
        session_id = "tc-clean-sees-outputs"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_log_node("try-log", "Try Log", "'try-ok'"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_log_node("fin-log", "Finally Log", _WATCH_MESSAGE),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
        ]

        variables: dict[str, Any] = {"tc_error": {"type": "stale"}, "tc_caught": True}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        seen = [m for m in _log_messages(session_id) if m.startswith("saw ")]
        assert seen == ["saw caught=False err=None"], seen
        assert variables["tc_caught"] is False
        assert variables["tc_error"] is None

    @pytest.mark.asyncio
    async def test_catch_disabled_still_populates_outputs(self) -> None:
        """A clean try with catch disabled still writes both outputs."""
        session_id = "tc-clean-catch-off"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=False, enable_finally=False),
            _make_log_node("try-log", "Try Log", "'try-ok'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": {"type": "stale"}, "tc_caught": True}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["tc_caught"] is False
        assert variables["tc_error"] is None

    @pytest.mark.asyncio
    async def test_scope_fail_catch_path_reads_caught_while_running(self) -> None:
        """A caught single-mode Assert failure gives the catch path caught=True and its error."""
        session_id = "tc-scope-fail-sees-caught"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        assert_in_try = _fail_scope_assert("single")

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=False),
            assert_in_try,
            _make_log_node("catch-log", "Catch Log", _WATCH_MESSAGE),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "inner-assert", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        seen = [m for m in _log_messages(session_id) if m.startswith("saw ")]
        assert len(seen) == 1, seen
        assert seen[0].startswith("saw caught=True err={'type': 'AssertionError'"), seen

    @pytest.mark.asyncio
    async def test_halt_in_try_path_binds_outputs_as_uncaught(self) -> None:
        """A Halt inside the try path leaves both outputs written and uncaught."""
        session_id = "tc-halt-try-binds"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_halt_node("halt-1", "'stop'"),
            _make_log_node("catch-log", "Catch", "'caught'"),
            _make_log_node("fin-log", "Finally", "'fin'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "halt-1", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
        ]

        variables: dict[str, Any] = {"tc_error": {"type": "stale"}, "tc_caught": True}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["tc_caught"] is False
        assert variables["tc_error"] is None

    @pytest.mark.asyncio
    async def test_halt_in_try_path_with_failure_binds_the_real_error(self) -> None:
        """A try-path failure that lands together with a halt is still reported."""
        from wavecore.api.services.workbench import nested as _nested

        session_id = "tc-halt-try-error"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_log_node("try-log", "Try Log", "'ok'"),
            _make_log_node("catch-log", "Catch", "'caught'"),
            _make_log_node("fin-log", "Finally", "'fin'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
        ]

        # The loop and wait-until dispatchers report failure before they look at the halt.
        async def _halt_then_report_failure(*args: Any, **kwargs: Any) -> str:
            _wb_common._workbench_sessions[session_id]["_halt"] = True
            return "error"

        variables: dict[str, Any] = {"tc_error": {"type": "stale"}, "tc_caught": False}
        with patch.object(_nested, "dispatch_nested_signals", _halt_then_report_failure):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["tc_caught"] is True
        assert variables["tc_error"]["type"] == "RuntimeError"
        assert variables["tc_error"]["node_id"] == "try-log"

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["catch-log"] == "skipped"
        assert session["block_states"]["fin-log"] == "skipped"

    @pytest.mark.asyncio
    async def test_halt_in_catch_path_keeps_bound_outputs(self) -> None:
        """A Halt inside the catch path leaves the caught error bound."""
        session_id = "tc-halt-catch-binds"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_halt_node("halt-catch", "'halt-in-catch'"),
            _make_log_node("fin-log", "Finally", "'fin'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "halt-catch", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["tc_caught"] is True
        assert variables["tc_error"]["type"] == "InvalidExpressionError"

    @pytest.mark.asyncio
    async def test_halt_in_finally_path_keeps_bound_outputs(self) -> None:
        """A Halt inside the finally path leaves the caught error bound."""
        session_id = "tc-halt-finally-binds"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("catch-log", "Catch", "'caught'"),
            _make_halt_node("halt-fin", "'halt-in-finally'"),
            _make_log_node("then-log", "Then", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "halt-fin", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "then-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["tc_caught"] is True
        assert variables["tc_error"]["type"] == "InvalidExpressionError"

    @pytest.mark.asyncio
    async def test_binds_caught_output_when_error_is_unbound(self) -> None:
        """Only `caught` is bound: it is written and no error variable appears."""
        session_id = "tc-bind-caught-only"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node(
                "tc-1", enable_catch=True, output_bindings={"caught": "tc_caught"}
            ),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
        ]

        variables: dict[str, Any] = {"tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["tc_caught"] is True
        assert "tc_error" not in variables

    @pytest.mark.asyncio
    async def test_binds_error_output_when_caught_is_unbound(self) -> None:
        """Only `error` is bound: it is written and no caught variable appears."""
        session_id = "tc-bind-error-only"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, output_bindings={"error": "tc_error"}),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
        ]

        variables: dict[str, Any] = {"tc_error": None}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["tc_error"]["type"] == "InvalidExpressionError"
        assert "tc_caught" not in variables


# Bindings publish in execution order, so the innermost Try/Catch is the one that survives.
class TestNestedTryCatchOutputBindingPrecedence:
    """REQ-3.2.2.6: a Try/Catch publishes its ``error`` and ``caught`` outputs before
    its handlers run, so an inner Try/Catch hosted on a catch or finally path binds
    last. When both constructs share output variable names, a block after the
    construct reads the inner one's values."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_inner_on_catch_path_wins_with_shared_names(self) -> None:
        """Inner Try/Catch on the outer catch path: its outputs are what remain."""
        session_id = "tc-nested-catch-shared"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        shared = {"error": "tc_error", "caught": "tc_caught"}
        nodes = [
            _make_try_catch_node("outer-tc", enable_catch=True, output_bindings=shared),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_try_catch_node("inner-tc", enable_catch=True, output_bindings=shared),
            _make_log_node("inner-try", "Inner Try", "'inner-ok'"),
            _make_log_node("after-log", "After Log", _WATCH_MESSAGE),
        ]
        edges = [
            {"source": "start-node", "target": "outer-tc"},
            {"source": "outer-tc", "target": "try-log", "sourceHandle": "try"},
            {"source": "outer-tc", "target": "inner-tc", "sourceHandle": "catch"},
            {"source": "inner-tc", "target": "inner-try", "sourceHandle": "try"},
            {"source": "outer-tc", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["inner-try"] == "passed"
        # The inner try was clean, so the outer's caught error no longer shows.
        seen = [m for m in _log_messages(session_id) if m.startswith("saw ")]
        assert seen == ["saw caught=False err=None"], seen
        assert variables["tc_caught"] is False
        assert variables["tc_error"] is None

    @pytest.mark.asyncio
    async def test_inner_on_finally_path_wins_with_shared_names(self) -> None:
        """Inner Try/Catch on the outer finally path: its outputs are what remain."""
        session_id = "tc-nested-finally-shared"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        shared = {"error": "tc_error", "caught": "tc_caught"}
        nodes = [
            _make_try_catch_node(
                "outer-tc", enable_catch=True, enable_finally=True, output_bindings=shared
            ),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_log_node("catch-log", "Catch Log", "'caught'"),
            _make_try_catch_node("inner-tc", enable_catch=True, output_bindings=shared),
            _make_log_node("inner-try", "Inner Try", "'inner-ok'"),
            _make_log_node("after-log", "After Log", _WATCH_MESSAGE),
        ]
        edges = [
            {"source": "start-node", "target": "outer-tc"},
            {"source": "outer-tc", "target": "try-log", "sourceHandle": "try"},
            {"source": "outer-tc", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "outer-tc", "target": "inner-tc", "sourceHandle": "finally"},
            {"source": "inner-tc", "target": "inner-try", "sourceHandle": "try"},
            {"source": "outer-tc", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"tc_error": None, "tc_caught": False}
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["catch-log"] == "passed"
        assert session["block_states"]["inner-try"] == "passed"
        seen = [m for m in _log_messages(session_id) if m.startswith("saw ")]
        assert seen == ["saw caught=False err=None"], seen
        assert variables["tc_caught"] is False
        assert variables["tc_error"] is None

    @pytest.mark.asyncio
    async def test_distinct_names_keep_both_outcomes_intact(self) -> None:
        """With separate output names each construct keeps its own outcome."""
        session_id = "tc-nested-catch-distinct"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_try_catch_node(
                "outer-tc",
                enable_catch=True,
                output_bindings={"error": "tc_error", "caught": "tc_caught"},
            ),
            _make_log_node("try-log", "Try Log", "1/0"),
            _make_try_catch_node(
                "inner-tc",
                enable_catch=True,
                output_bindings={"error": "inner_err", "caught": "inner_caught"},
            ),
            _make_log_node("inner-try", "Inner Try", "'inner-ok'"),
            _make_log_node("after-log", "After Log", _WATCH_MESSAGE),
        ]
        edges = [
            {"source": "start-node", "target": "outer-tc"},
            {"source": "outer-tc", "target": "try-log", "sourceHandle": "try"},
            {"source": "outer-tc", "target": "inner-tc", "sourceHandle": "catch"},
            {"source": "inner-tc", "target": "inner-try", "sourceHandle": "try"},
            {"source": "outer-tc", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {
            "tc_error": None,
            "tc_caught": False,
            "inner_err": None,
            "inner_caught": False,
        }
        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["inner-try"] == "passed"
        seen = [m for m in _log_messages(session_id) if m.startswith("saw ")]
        assert len(seen) == 1, seen
        assert "caught=True" in seen[0], seen[0]
        assert "InvalidExpressionError" in seen[0], seen[0]
        assert variables["tc_caught"] is True
        assert variables["tc_error"]["type"] == "InvalidExpressionError"
        assert variables["inner_caught"] is False
        assert variables["inner_err"] is None
