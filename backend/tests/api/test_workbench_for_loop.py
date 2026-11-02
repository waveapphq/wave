"""Tests for for-loop execution in workbench_service._execute_workflow.

Tests the for-loop execution engine: body chain tracing, iteration,
variable injection, break/continue hooks, timeout, and error handling.

Coverage targets:
- _execute_for_loop_body: Full for-loop orchestration
- Signal extraction: __for_loop, __loop_*, __break, __continue
- _strip_engine_keys: Removal of loop/break/continue keys
- _execute_workflow integration: End-to-end workflow with for-loop node

REQ-3.5.1.15: For loop with counter variable
REQ-3.5.1.2: Break hook points
REQ-3.5.1.3: Continue hook points
"""

from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench.for_loop import (
    _ChainWalk,
    _drain_session_signal,
    _resolve_dispatch_result,
)
from wavecore.api.services.workbench.signals import _extract_engine_signals
from wavecore.api.services.workbench.try_catch import _strip_engine_keys


def _make_session(session_id: str) -> dict[str, Any]:
    """Create a minimal workbench session for testing."""
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "For Loop Test",
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
    display_name: str | None = None,
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
            "label": label,
            "elementType": element_type,
            "nodeType": node_type,
            "version": version,
            "config": config,
            "disabled": disabled,
            "displayName": display_name or label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _make_log_node(
    node_id: str,
    display_name: str,
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
        display_name=display_name,
    )
    node["data"]["expressionFields"] = ["message"]
    return node


def _make_for_node(
    node_id: str = "for-1",
    mode: str = "count",
    count: int | None = None,
    start: int | float | None = None,
    end: int | float | None = None,
    step: int | float | None = None,
    timeout: float | None = None,
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Create a For Loop control node."""
    values: dict[str, Any] = {"mode": mode}
    if count is not None:
        values["count"] = count
    if start is not None:
        values["start"] = start
    if end is not None:
        values["end"] = end
    if step is not None:
        values["step"] = step
    if timeout is not None:
        values["timeout"] = timeout
    return _make_node(
        node_id,
        label="For Loop",
        element_type="for",
        node_type="control",
        version="1.0.0",
        config_values=values,
        output_bindings=output_bindings or {"index": "i"},
        display_name="For Loop",
    )


class TestForLoopWorkflowExecution:
    """End-to-end for-loop workflow execution tests."""

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
    async def test_for_count_3_body_log(self) -> None:
        """For(count=3) with body Log and then Log - 3 iterations, all pass."""
        session_id = "fl-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=3),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_count_0_empty(self) -> None:
        """For(count=0) - body skipped, then executed, session passes."""
        session_id = "fl-2"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=0),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("count", "expression_fields"),
        [
            pytest.param(None, [], id="left-null"),
            pytest.param("repeat", ["count"], id="expression-giving-null"),
        ],
    )
    async def test_for_null_count_runs_zero_times(
        self, count: str | None, expression_fields: list[str]
    ) -> None:
        """A null count runs zero times and the flow goes on (REQ-3.1.3.25)."""
        from wavecore.api.services import log_streaming_service

        session_id = f"fl-null-count-{len(expression_fields)}"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"repeat": None, "i": None}
        loop = _make_for_node("for-1", mode="count")
        loop["data"]["config"]["values"]["count"] = count
        loop["data"]["expressionFields"] = expression_fields

        nodes = [
            loop,
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        started = [
            entry["message"]
            for entry in log_streaming_service.get_logs(session_id)
            if entry["message"].startswith("[FOR] Starting loop")
        ]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "skipped"
        assert session["block_states"]["after-log"] == "passed"
        assert variables["i"] == 0
        assert started == ["[FOR] Starting loop (0 iterations)"]

    @pytest.mark.asyncio
    async def test_for_range_mode(self) -> None:
        """For(range 0-3) - same as count=3."""
        session_id = "fl-3"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="range", start=0, end=3, step=1),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_variable_injection(self) -> None:
        """Output binding 'index' -> 'i'. After loop, i == 2 (last of 0,1,2)."""
        session_id = "fl-4"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"i": None}

        nodes = [
            _make_for_node("for-1", mode="count", count=3),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["i"] == 2

    @pytest.mark.asyncio
    async def test_for_body_error_aborts(self) -> None:
        """Body node throws - loop aborts, then NOT executed, session FAILED."""
        session_id = "fl-7"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=3),
            _make_log_node("body-log", "Bad Log", "1/0"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["body-log"] == "failed"
        assert session["block_states"].get("after-log") in ("skipped", None)

    @pytest.mark.asyncio
    async def test_for_body_chain_second_fails(self) -> None:
        """Body chain: LogA -> BadLog. LogA passes, BadLog fails, rest skipped."""
        session_id = "fl-8"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=2),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "1/0"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["body-a"] == "passed"
        assert session["block_states"]["body-b"] == "failed"

    @pytest.mark.asyncio
    async def test_for_body_nodes_re_executed(self) -> None:
        """For(count=3) with 2 body nodes. Both pass on each iteration."""
        session_id = "fl-9"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=3),
            _make_log_node("body-a", "Body A", "'a'"),
            _make_log_node("body-b", "Body B", "'b'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Body nodes passed (final state after last iteration)
        assert session["block_states"]["body-a"] == "passed"
        assert session["block_states"]["body-b"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_timeout_interrupts_execution(self) -> None:
        """For(count=100, timeout=0.001) - timeout interrupts, then skipped, session FAILED."""
        session_id = "fl-10"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=100, timeout=0.001),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"].get("after-log") in ("skipped", None)

    @pytest.mark.asyncio
    async def test_for_no_body_then_executes(self) -> None:
        """No body connection. Then target executes directly."""
        session_id = "fl-11"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=3),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_custom_step(self) -> None:
        """For(range 0-10, step=2) - 5 iterations (0,2,4,6,8)."""
        session_id = "fl-12"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"i": None}

        nodes = [
            _make_for_node("for-1", mode="range", start=0, end=10, step=2),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Last iteration value: 8 (0,2,4,6,8)
        assert variables["i"] == 8

    @pytest.mark.asyncio
    async def test_for_stopped_session_breaks(self) -> None:
        """Session set to 'stopped' mid-iteration - loop exits."""
        session_id = "fl-13"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=100),
            _make_log_node("body-log", "Body Log", "'iteration'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node
        call_count = 0

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            nonlocal call_count
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-log":
                call_count += 1
                if call_count >= 2:
                    _wb_common._workbench_sessions[sid]["status"] = "stopped"
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_for_disabled_body_node(self) -> None:
        """Disabled body node is skipped, loop continues."""
        session_id = "fl-14"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        body_node = _make_log_node("body-log", "Body Log", "'ok'")
        body_node["data"]["disabled"] = True

        nodes = [
            _make_for_node("for-1", mode="count", count=2),
            body_node,
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["body-log"] == "skipped"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_break_signal(self) -> None:
        """Body node returning __break exits loop, then IS executed."""
        session_id = "fl-15"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=5),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        call_count = 0
        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, session_id: str, node_id: str) -> Any:
            nonlocal call_count
            result = await original_execute(nf, variables, session_id, node_id)
            if node_id == "body-a":
                call_count += 1
                if call_count >= 2:
                    if result and isinstance(result, dict):
                        result["__break"] = True
                    else:
                        result = {"__break": True}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_for_continue_signal(self) -> None:
        """Body node returning __continue skips rest of body, next iteration starts."""
        session_id = "fl-16"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=3),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, session_id: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, session_id, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__continue"] = True
                else:
                    result = {"__continue": True}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"
        # body-b should have been skipped on every iteration due to continue
        assert session["block_states"]["body-b"] == "skipped"


class TestForLoopHelpers:
    """Test helper functions in for_loop module directly."""

    def test_compute_iteration_count_step_zero(self) -> None:
        from wavecore.api.services.workbench.for_loop import _compute_iteration_count

        assert _compute_iteration_count(0, 10, 0) == 0

    def test_apply_body_output_bindings(self) -> None:
        from wavecore.api.services.workbench.for_loop import _apply_body_output_bindings

        variables: dict[str, Any] = {}
        _apply_body_output_bindings({"out": "val"}, {"out": "var_name"}, variables)
        assert variables["var_name"] == "val"

    def test_apply_body_output_bindings_none_result(self) -> None:
        from wavecore.api.services.workbench.for_loop import _apply_body_output_bindings

        variables: dict[str, Any] = {}
        _apply_body_output_bindings(None, {"out": "var_name"}, variables)
        assert variables == {}

    async def test_check_break_continue_none_result(self) -> None:
        from wavecore.api.services.workbench.for_loop import _check_break_continue

        result = await _check_break_continue(None, _ChainWalk(["a"], {}, {}, "s", set()), "a")
        assert result is None

    async def test_check_break_continue_no_signal_in_dict(self) -> None:
        from wavecore.api.services.workbench.for_loop import _check_break_continue

        walk = _ChainWalk(["a"], {}, {"block_states": {}}, "s", set())
        result = await _check_break_continue({"some_output": "val"}, walk, "a")
        assert result is None

    async def test_check_break_continue_sets_loop_signal_with_break_target(self) -> None:
        """Break with __break_target sets session signal for parent loop."""
        from wavecore.api.services.workbench.for_loop import _check_break_continue

        session: dict[str, Any] = {"block_states": {}}
        executed: set[str] = set()
        result = await _check_break_continue(
            {"__break": True, "__break_target": "target-loop-1"},
            _ChainWalk(["node-a", "node-b"], {}, session, "s", executed),
            "node-a",
        )
        assert result == "break"
        assert session["_loop_signal_target"] == "target-loop-1"
        assert session["_loop_signal"] == "break"
        assert "node-b" in executed

    async def test_check_break_continue_sets_loop_signal_with_continue_target(self) -> None:
        """Continue with __continue_target sets session signal for parent loop."""
        from wavecore.api.services.workbench.for_loop import _check_break_continue

        session: dict[str, Any] = {"block_states": {}}
        executed: set[str] = set()
        result = await _check_break_continue(
            {"__continue": True, "__continue_target": "target-loop-2"},
            _ChainWalk(["node-a", "node-b"], {}, session, "s", executed),
            "node-a",
        )
        assert result == "continue"
        assert session["_loop_signal_target"] == "target-loop-2"
        assert session["_loop_signal"] == "continue"
        assert "node-b" in executed

    @pytest.mark.asyncio
    async def test_for_body_chain_stopped_mid_iteration(self) -> None:
        """Session set to stopped DURING body chain execution."""
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

        session_id = "fl-18"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=3),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, session_id: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, session_id, node_id)
            if node_id == "body-a":
                _wb_common._workbench_sessions[session_id]["status"] = "stopped"
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_for_body_node_not_found(self) -> None:
        """Body chain references a node ID not in node_map - returns None."""
        from wavecore.api.services.workbench.for_loop import _execute_body_node

        raw_result, error = await _execute_body_node(
            "nonexistent", {}, {}, {"skipped_node_ids": []}, "s1", None
        )
        assert raw_result is None
        assert error is None

    @pytest.mark.asyncio
    async def test_for_body_with_profile_bindings(self) -> None:
        """Body node with profileBindings triggers injection."""
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

        session_id = "fl-17"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        body_node = _make_log_node("body-log", "Body Log", "'ok'")
        body_node["data"]["config"]["profileBindings"] = [
            {"profileField": "host", "variableName": "my_host"}
        ]

        nodes = [
            _make_for_node("for-1", mode="count", count=1),
            body_node,
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"i": None, "my_host": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"


class TestForLoopSignalExtraction:
    """Test signal extraction and key stripping for for-loop signals."""

    def test_extract_for_loop_signals(self) -> None:
        """_extract_engine_signals extracts __for_loop and loop params."""
        result: dict[str, Any] = {
            "__for_loop": True,
            "__loop_start": 0,
            "__loop_end": 5,
            "__loop_step": 1,
            "__loop_variable": "index",
            "index": 0,
        }
        signals = _extract_engine_signals(result)
        assert signals["for_loop"] is True
        assert signals["loop_start"] == 0
        assert signals["loop_end"] == 5
        assert signals["loop_step"] == 1
        assert signals["loop_variable"] == "index"
        # Engine keys removed from result, user output remains
        assert "__for_loop" not in result
        assert "__loop_start" not in result
        assert "index" in result

    def test_extract_break_signal(self) -> None:
        """_extract_engine_signals extracts __break."""
        result: dict[str, Any] = {"__break": True, "some_output": "val"}
        signals = _extract_engine_signals(result)
        assert signals["loop_break"] is True
        assert "__break" not in result

    def test_extract_continue_signal(self) -> None:
        """_extract_engine_signals extracts __continue."""
        result: dict[str, Any] = {"__continue": True}
        signals = _extract_engine_signals(result)
        assert signals["loop_continue"] is True
        assert "__continue" not in result

    def test_extract_break_target_signal(self) -> None:
        """_extract_engine_signals extracts __break_target."""
        result: dict[str, Any] = {
            "__break": True,
            "__break_target": "for-1",
            "some_output": "val",
        }
        signals = _extract_engine_signals(result)
        assert signals["loop_break"] is True
        assert signals["break_target"] == "for-1"
        assert "__break_target" not in result

    def test_extract_continue_target_signal(self) -> None:
        """_extract_engine_signals extracts __continue_target."""
        result: dict[str, Any] = {
            "__continue": True,
            "__continue_target": "while-1",
        }
        signals = _extract_engine_signals(result)
        assert signals["loop_continue"] is True
        assert signals["continue_target"] == "while-1"
        assert "__continue_target" not in result

    def test_extract_no_targets_returns_none(self) -> None:
        """Without target keys, break_target and continue_target default to None."""
        result: dict[str, Any] = {"some_output": "val"}
        signals = _extract_engine_signals(result)
        assert signals["break_target"] is None
        assert signals["continue_target"] is None

    def test_extract_no_loop_signals_returns_none(self) -> None:
        """Without loop keys, signals default to None."""
        result: dict[str, Any] = {"some_output": "val"}
        signals = _extract_engine_signals(result)
        assert signals["for_loop"] is None
        assert signals["loop_start"] is None
        assert signals["loop_break"] is None
        assert signals["loop_continue"] is None

    def test_strip_engine_keys_removes_loop_keys(self) -> None:
        """_strip_engine_keys removes all for-loop and break/continue keys."""
        result: dict[str, Any] = {
            "__for_loop": True,
            "__loop_start": 0,
            "__loop_end": 5,
            "__loop_step": 1,
            "__loop_variable": "index",
            "__break": True,
            "__continue": True,
            "__break_target": "for-1",
            "__continue_target": "while-1",
            "index": 0,
        }
        _strip_engine_keys(result)
        assert "__for_loop" not in result
        assert "__loop_start" not in result
        assert "__loop_end" not in result
        assert "__loop_step" not in result
        assert "__loop_variable" not in result
        assert "__break" not in result
        assert "__continue" not in result
        assert "__break_target" not in result
        assert "__continue_target" not in result
        assert result["index"] == 0


class TestForLoopTimeoutCleanup:
    """Timeout cleanup marks running body nodes as skipped."""

    @pytest.mark.asyncio
    async def test_timeout_marks_running_body_as_stopped(self) -> None:
        """When timeout fires via _dispatch_loop, running body nodes become 'stopped'."""
        import asyncio

        from wavecore.api.services.workbench import for_loop as _wb_for_loop
        from wavecore.api.services.workbench.execution import _dispatch_loop

        session_id = "tc-for-1"
        session: dict[str, Any] = {
            "block_states": {"for-1": "running"},
            "status": "running",
            "skipped_node_ids": [],
        }

        async def slow_execute(nf: Any, variables: Any, sid: str, nid: str) -> Any:
            session["block_states"][nid] = "running"
            await asyncio.sleep(10)
            return None

        body_node = _make_log_node("body-1", "Body", "'x'")
        node_map = {
            "for-1": _make_for_node("for-1", count=100),
            "body-1": body_node,
        }
        adj: dict[str, list[tuple[str, str | None]]] = {
            "for-1": [("body-1", "body")],
        }
        signals: dict[str, Any] = {
            "for_loop": True,
            "for_each": None,
            "loop_start": 0,
            "loop_end": 100,
            "loop_step": 1,
            "loop_variable": "index",
            "timeout": 0.5,
        }

        with patch.object(_wb_for_loop, "_execute_node", slow_execute):
            status = await _dispatch_loop(
                signals=signals,
                node_id="for-1",
                adj=adj,
                node_map=node_map,
                variables={},
                session=session,
                session_id=session_id,
                executed=set(),
                exec_queue=[],
                output_bindings={},
                environment_id="",
            )

        assert status == "failed"
        assert session["block_states"]["body-1"] == "stopped"


class TestResolveDispatchResult:
    """Unit tests for _resolve_dispatch_result helper."""

    @pytest.mark.asyncio
    async def test_break_returns_break_signal(self) -> None:
        session: dict[str, Any] = {"block_states": {}}
        raw, err = await _resolve_dispatch_result("break", "n1", session, "s1", "Block")
        assert raw == {"__break": True}
        assert err is None

    @pytest.mark.asyncio
    async def test_continue_returns_continue_signal(self) -> None:
        session: dict[str, Any] = {"block_states": {}}
        raw, err = await _resolve_dispatch_result("continue", "n1", session, "s1", "Block")
        assert raw == {"__continue": True}
        assert err is None

    @pytest.mark.asyncio
    async def test_halt_returns_none(self) -> None:
        session: dict[str, Any] = {"block_states": {}}
        raw, err = await _resolve_dispatch_result("halt", "n1", session, "s1", "Block")
        assert raw is None
        assert err is None

    @pytest.mark.asyncio
    async def test_ok_returns_none(self) -> None:
        session: dict[str, Any] = {"block_states": {}}
        raw, err = await _resolve_dispatch_result("ok", "n1", session, "s1", "Block")
        assert raw is None
        assert err is None

    @pytest.mark.asyncio
    async def test_none_returns_none(self) -> None:
        """None means simple node (no control dispatch) - treated as success."""
        session: dict[str, Any] = {"block_states": {}}
        raw, err = await _resolve_dispatch_result(None, "n1", session, "s1", "Block")
        assert raw is None
        assert err is None

    @pytest.mark.asyncio
    async def test_error_returns_runtime_error(self) -> None:
        session: dict[str, Any] = {"block_states": {}}
        raw, err = await _resolve_dispatch_result("error", "n1", session, "s1", "MyBlock")
        assert raw is None
        assert isinstance(err, RuntimeError)
        assert "MyBlock" in str(err)
        assert session["block_states"]["n1"] == "failed"


class TestExecuteBodyNodeNestedError:
    """Test _execute_body_node with nested control dispatch error."""

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
    async def test_nested_dispatch_error_returns_error(self) -> None:
        """When dispatch_nested_signals returns 'error', body node returns RuntimeError."""
        from wavecore.api.services.workbench import nested as _nested
        from wavecore.api.services.workbench.for_loop import _execute_body_node

        session_id = "nested-err-1"
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
        }

        node = _make_log_node("body-1", "Body", "'x'")

        with patch.object(_nested, "dispatch_nested_signals", return_value="error"):
            raw, err = await _execute_body_node(
                path_node_id="body-1",
                node_map={"body-1": node},
                variables={},
                session=session,
                session_id=session_id,
                environment_id=None,
                adj={"body-1": []},
                executed=set(),
            )

        assert raw is None
        assert isinstance(err, RuntimeError)
        assert session["block_states"]["body-1"] == "failed"


class TestBodyChainSessionSignals:
    """Test _execute_body_chain_iteration with session signals."""

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
    async def test_post_execution_signal_returns(self) -> None:
        """Session signal set after body node execution returns the signal."""
        from wavecore.api.services.workbench import for_loop as _fl
        from wavecore.api.services.workbench.for_loop import (
            _execute_body_chain_iteration,
        )
        from wavecore.api.services.workbench.for_loop import (
            _execute_body_node as _orig_body,
        )

        session_id = "post-sig-1"
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
        }

        async def body_sets_signal(*args: Any, **kwargs: Any) -> Any:
            result = await _orig_body(*args, **kwargs)
            session["_loop_signal"] = "break"
            return result

        node_map = {
            "n1": _make_log_node("n1", "N1", "'x'"),
            "n2": _make_log_node("n2", "N2", "'y'"),
        }

        with patch.object(_fl, "_execute_body_node", body_sets_signal):
            result = await _execute_body_chain_iteration(
                body_chain=["n1", "n2"],
                node_map=node_map,
                variables={},
                session=session,
                session_id=session_id,
                executed=set(),
                environment_id=None,
            )

        assert result == "break"
        # n2 should be skipped (skip_offset=1 means skip after n1)
        assert session["block_states"].get("n2") == "skipped"

    @pytest.mark.asyncio
    async def test_already_executed_node_skipped(self) -> None:
        """Node marked executed by signal drain is skipped in the body chain."""
        from wavecore.api.services.workbench import for_loop as _fl
        from wavecore.api.services.workbench.for_loop import (
            _execute_body_chain_iteration,
        )

        session_id = "exec-skip-1"
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
        }

        call_count = 0

        async def counting_body(*args: Any, **kwargs: Any) -> tuple[None, None]:
            nonlocal call_count
            call_count += 1
            return None, None

        executed: set[str] = set()
        node_map = {
            "n1": _make_log_node("n1", "N1", "'x'"),
            "n2": _make_log_node("n2", "N2", "'y'"),
        }

        # Patch _drain_session_signal to add n1 to executed on first call,
        # simulating a signal drain marking it as already processed
        orig_drain = _fl._drain_session_signal
        first_call = True

        async def drain_adds_n1(walk: Any, node: Any, offset: Any) -> Any:
            nonlocal first_call
            if first_call and node == "n1":
                first_call = False
                walk.executed.add("n1")
            return await orig_drain(walk, node, offset)

        with (
            patch.object(_fl, "_execute_body_node", counting_body),
            patch.object(_fl, "_drain_session_signal", drain_adds_n1),
        ):
            result = await _execute_body_chain_iteration(
                body_chain=["n1", "n2"],
                node_map=node_map,
                variables={},
                session=session,
                session_id=session_id,
                executed=executed,
                environment_id=None,
            )

        assert result == "ok"
        # Only n2 should have been executed (n1 was skipped)
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_pre_execution_signal_returns_immediately(self) -> None:
        """Signal from prior nested dispatch at pre-execution returns early."""
        from wavecore.api.services.workbench.for_loop import (
            _execute_body_chain_iteration,
        )

        session_id = "exec-pre-signal"
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
            "skipped_node_ids": [],
            "_loop_signal": "break",
        }

        executed: set[str] = set()
        node_map = {
            "n1": _make_log_node("n1", "N1", "'x'"),
            "n2": _make_log_node("n2", "N2", "'y'"),
        }

        result = await _execute_body_chain_iteration(
            body_chain=["n1", "n2"],
            node_map=node_map,
            variables={},
            session=session,
            session_id=session_id,
            executed=executed,
            environment_id=None,
        )

        assert result == "break"


class TestDrainSessionSignal:
    """Unit tests for _drain_session_signal helper."""

    async def test_no_signal_returns_none(self) -> None:
        session: dict[str, Any] = {"block_states": {}}
        result = await _drain_session_signal(
            _ChainWalk(["a", "b"], {}, session, "s", set()), "a", 0
        )
        assert result is None

    async def test_loop_signal_returns_signal_and_skips(self) -> None:
        session: dict[str, Any] = {
            "block_states": {},
            "_loop_signal": "break",
        }
        executed: set[str] = set()
        walk = _ChainWalk(["a", "b", "c"], {}, session, "s", executed)
        result = await _drain_session_signal(walk, "b", 0)
        assert result == "break"
        # b and c should be skipped (from index 1)
        assert "b" in executed
        assert "c" in executed

    async def test_loop_signal_with_offset_1(self) -> None:
        session: dict[str, Any] = {
            "block_states": {},
            "_loop_signal": "continue",
        }
        executed: set[str] = set()
        walk = _ChainWalk(["a", "b", "c"], {}, session, "s", executed)
        result = await _drain_session_signal(walk, "a", 1)
        assert result == "continue"
        # Skip from index 1 (after a)
        assert "a" not in executed
        assert "b" in executed
        assert "c" in executed

    async def test_halt_signal_returns_stopped(self) -> None:
        session: dict[str, Any] = {
            "block_states": {},
            "_halt": True,
        }
        result = await _drain_session_signal(
            _ChainWalk(["a", "b"], {}, session, "s", set()), "a", 0
        )
        assert result == "stopped"

    async def test_already_executed_node_skipped_in_chain(self) -> None:
        """Verify the chain skip via _drain_session_signal."""
        session: dict[str, Any] = {
            "block_states": {},
            "_loop_signal": "break",
        }
        executed: set[str] = set()
        chain = ["n1", "n2", "n3"]
        result = await _drain_session_signal(_ChainWalk(chain, {}, session, "s", executed), "n1", 0)
        assert result == "break"
        assert session["block_states"]["n1"] == "skipped"
        assert session["block_states"]["n2"] == "skipped"
        assert session["block_states"]["n3"] == "skipped"

    async def test_drain_session_signal_returns_target(self) -> None:
        """_drain_session_signal returns target alongside signal type."""
        session: dict[str, Any] = {
            "block_states": {},
            "_loop_signal": "break",
            "_loop_signal_target": "outer-for-1",
        }
        executed: set[str] = set()
        result = await _drain_session_signal(
            _ChainWalk(["a", "b"], {}, session, "s", executed), "a", 0
        )
        assert result == "break"
        # Target should be consumed from session
        assert "_loop_signal_target" not in session


class TestForLoopTargetAwareBreakContinue:
    """Test target-aware break/continue signal propagation in for-loop.

    REQ-3.5.1.2: Break with target_loop for multi-level break
    REQ-3.5.1.3: Continue with target_loop for multi-level continue
    """

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
    async def test_break_targeting_this_loop_queues_then(self) -> None:
        """Break with target matching this loop's node_id - exits, then-path executes."""
        session_id = "fl-target-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=5),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node
        call_count = 0

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            nonlocal call_count
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                call_count += 1
                if call_count >= 2:
                    if result and isinstance(result, dict):
                        result["__break"] = True
                        result["__break_target"] = "for-1"
                    else:
                        result = {"__break": True, "__break_target": "for-1"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Then-path should execute because break targets THIS loop
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_break_targeting_parent_loop_skips_then(self) -> None:
        """Break with target NOT matching this loop - exits, SKIPS then-path, propagates."""
        session_id = "fl-target-2"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=5),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__break"] = True
                    result["__break_target"] = "parent-loop-999"
                else:
                    result = {"__break": True, "__break_target": "parent-loop-999"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        # Then-path should be SKIPPED because break targets a PARENT loop
        assert session["block_states"].get("after-log") in ("skipped", None)
        # Session should carry propagation signal for parent
        assert session.get("_loop_signal") == "break"
        assert session.get("_loop_signal_target") == "parent-loop-999"

    @pytest.mark.asyncio
    async def test_continue_targeting_this_loop_advances_iteration(self) -> None:
        """Continue with target matching this loop - skips body, continues iteration."""
        session_id = "fl-target-3"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=3),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__continue"] = True
                    result["__continue_target"] = "for-1"
                else:
                    result = {"__continue": True, "__continue_target": "for-1"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Then-path executes because continue targets THIS loop
        assert session["block_states"]["after-log"] == "passed"
        # body-b skipped because continue fires before it
        assert session["block_states"]["body-b"] == "skipped"

    @pytest.mark.asyncio
    async def test_continue_targeting_parent_loop_propagates(self) -> None:
        """Continue with target NOT matching this loop - exits, propagates to parent."""
        session_id = "fl-target-4"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_for_node("for-1", mode="count", count=5),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__continue"] = True
                    result["__continue_target"] = "parent-loop-888"
                else:
                    result = {"__continue": True, "__continue_target": "parent-loop-888"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})

        session = _wb_common._workbench_sessions[session_id]
        # Then-path should be SKIPPED because continue targets a PARENT loop
        assert session["block_states"].get("after-log") in ("skipped", None)
        # Session should carry propagation signal for parent
        assert session.get("_loop_signal") == "continue"
        assert session.get("_loop_signal_target") == "parent-loop-888"


class TestNestedLoopDispatchSignals:
    """Test dispatch_nested_signals for nested loop error and signal propagation.

    Covers nested.py lines 109-114: nested loop failure returns 'error'
    and nested loop with _loop_signal_target propagates signal to parent.
    """

    @pytest.mark.asyncio
    async def test_nested_loop_dispatch_failure_returns_error(self) -> None:
        """When _dispatch_loop returns 'failed', dispatch_nested_signals returns 'error'."""
        from wavecore.api.services.workbench import execution as _exec_mod
        from wavecore.api.services.workbench.nested import dispatch_nested_signals

        signals: dict[str, Any] = {
            "branch": None,
            "test_failed": None,
            "try_catch": None,
            "halt": None,
            "loop_break": None,
            "loop_continue": None,
            "for_loop": True,
            "for_each": None,
            "while_loop": None,
            "loop_start": 0,
            "loop_end": 3,
            "loop_step": 1,
            "loop_variable": "i",
            "timeout": None,
            "enable_catch": True,
            "enable_finally": False,
            "halt_status": None,
        }
        nf: dict[str, Any] = {"output_bindings": {"index": "i"}}
        session: dict[str, Any] = {"block_states": {}, "status": "running"}

        with patch.object(_exec_mod, "_dispatch_loop", return_value="failed"):
            result = await dispatch_nested_signals(
                signals=signals,
                node_id="inner-for-1",
                nf=nf,
                adj={},
                node_map={},
                variables={},
                session=session,
                session_id="nested-loop-err",
                executed=set(),
                environment_id=None,
            )

        assert result == "error"

    @pytest.mark.asyncio
    async def test_nested_loop_propagates_signal_to_parent(self) -> None:
        """When nested loop leaves _loop_signal_target in session, signal propagates."""
        from wavecore.api.services.workbench import execution as _exec_mod
        from wavecore.api.services.workbench.nested import dispatch_nested_signals

        signals: dict[str, Any] = {
            "branch": None,
            "test_failed": None,
            "try_catch": None,
            "halt": None,
            "loop_break": None,
            "loop_continue": None,
            "for_loop": True,
            "for_each": None,
            "while_loop": None,
            "loop_start": 0,
            "loop_end": 3,
            "loop_step": 1,
            "loop_variable": "i",
            "timeout": None,
            "enable_catch": True,
            "enable_finally": False,
            "halt_status": None,
        }
        nf: dict[str, Any] = {"output_bindings": {"index": "i"}}
        session: dict[str, Any] = {
            "block_states": {},
            "status": "running",
        }

        async def mock_dispatch_loop(**kwargs: Any) -> str:
            # Simulate inner loop leaving a signal targeting a parent
            kwargs["session"]["_loop_signal_target"] = "outer-for-99"
            kwargs["session"]["_loop_signal"] = "break"
            return "passed"

        with patch.object(_exec_mod, "_dispatch_loop", side_effect=mock_dispatch_loop):
            result = await dispatch_nested_signals(
                signals=signals,
                node_id="inner-for-1",
                nf=nf,
                adj={},
                node_map={},
                variables={},
                session=session,
                session_id="nested-loop-prop",
                executed=set(),
                environment_id=None,
            )

        # dispatch_nested_signals should return the signal type
        assert result == "break"
        # The kind stays in the session until the target loop consumes it
        assert session["_loop_signal"] == "break"

    @pytest.mark.asyncio
    async def test_nested_branch_dispatch_executes_matching_branch(self) -> None:
        """Branch signal dispatches the matching branch and skips others."""
        from wavecore.api.services.workbench.nested import dispatch_nested_signals
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())

        session_id = "branch-dispatch-1"
        session: dict[str, Any] = {
            "status": "running",
            "block_states": {},
            "skipped_node_ids": [],
        }
        _wb_common._workbench_sessions[session_id] = session

        if_node = _make_node(
            "if-1", label="If/Else", element_type="if-else", node_type="control", version="1.0.0"
        )
        true_log = _make_log_node("true-log", "True Branch", "'true-ran'")
        false_log = _make_log_node("false-log", "False Branch", "'false-ran'")

        node_map = {"if-1": if_node, "true-log": true_log, "false-log": false_log}
        adj: dict[str, list[tuple[str, str | None]]] = {
            "if-1": [("true-log", "branch_true"), ("false-log", "branch_false")],
        }
        signals: dict[str, Any] = {
            "halt": None,
            "loop_break": None,
            "loop_continue": None,
            "branch": "branch_true",
            "try_catch": None,
            "for_loop": None,
            "for_each": None,
            "break_target": None,
            "continue_target": None,
        }
        nf = {"output_bindings": {}}
        executed: set[str] = set()

        result = await dispatch_nested_signals(
            signals,
            "if-1",
            nf,
            adj,
            node_map,
            {},
            session,
            session_id,
            executed,
            None,
        )

        assert result == "ok"
        assert "true-log" in executed
        assert session["block_states"].get("false-log") == "skipped"

    @pytest.mark.asyncio
    async def test_nested_branch_dispatch_no_matching_branch(self) -> None:
        """Branch signal with no matching handle returns ok."""
        from wavecore.api.services.workbench.nested import dispatch_nested_signals

        signals: dict[str, Any] = {
            "halt": None,
            "loop_break": None,
            "loop_continue": None,
            "branch": "nonexistent_branch",
            "try_catch": None,
            "for_loop": None,
            "for_each": None,
            "break_target": None,
            "continue_target": None,
        }
        session: dict[str, Any] = {"status": "running", "block_states": {}}
        adj: dict[str, list[tuple[str, str | None]]] = {"n1": []}
        result = await dispatch_nested_signals(
            signals,
            "n1",
            {"output_bindings": {}},
            adj,
            {},
            {},
            session,
            "s1",
            set(),
            None,
        )
        assert result == "ok"

    @pytest.mark.asyncio
    async def test_nested_branch_empty_chain_returns_ok(self) -> None:
        """Branch target exists but trace produces empty chain - returns ok."""
        from wavecore.api.services.workbench.nested import dispatch_nested_signals

        signals: dict[str, Any] = {
            "halt": None,
            "loop_break": None,
            "loop_continue": None,
            "branch": "branch_true",
            "try_catch": None,
            "for_loop": None,
            "for_each": None,
            "break_target": None,
            "continue_target": None,
        }
        session: dict[str, Any] = {"status": "running", "block_states": {}}
        # branch_true points to a non-workflowNode (won't trace)
        adj: dict[str, list[tuple[str, str | None]]] = {
            "n1": [("ghost", "branch_true")],
        }
        result = await dispatch_nested_signals(
            signals,
            "n1",
            {"output_bindings": {}},
            adj,
            {},
            {},
            session,
            "s1",
            set(),
            None,
        )
        assert result == "ok"

    @pytest.mark.asyncio
    async def test_nested_branch_body_returns_break(self) -> None:
        """Branch body returns break signal - propagated."""
        from wavecore.api.services.workbench import for_loop as _fl
        from wavecore.api.services.workbench.nested import dispatch_nested_signals

        session: dict[str, Any] = {"status": "running", "block_states": {}}
        node = _make_node("log-1", element_type="log", node_type="plugin")
        adj: dict[str, list[tuple[str, str | None]]] = {
            "if-1": [("log-1", "branch_if")],
        }
        signals: dict[str, Any] = {
            "halt": None,
            "loop_break": None,
            "loop_continue": None,
            "branch": "branch_if",
            "try_catch": None,
            "for_loop": None,
            "for_each": None,
            "break_target": None,
            "continue_target": None,
        }

        async def mock_body_chain(*args: Any, **kwargs: Any) -> str:
            return "break"

        with patch.object(_fl, "_execute_body_chain_iteration", mock_body_chain):
            result = await dispatch_nested_signals(
                signals,
                "if-1",
                {"output_bindings": {}},
                adj,
                {"if-1": _make_node("if-1"), "log-1": node},
                {},
                session,
                "s1",
                set(),
                None,
            )
        assert result == "break"

    @pytest.mark.asyncio
    async def test_nested_branch_body_halt_propagates(self) -> None:
        """Halt set during branch body execution - propagated."""
        from wavecore.api.services.workbench import for_loop as _fl
        from wavecore.api.services.workbench.nested import dispatch_nested_signals

        session: dict[str, Any] = {"status": "running", "block_states": {}}
        node = _make_node("log-1", element_type="log", node_type="plugin")
        adj: dict[str, list[tuple[str, str | None]]] = {
            "if-1": [("log-1", "branch_if")],
        }
        signals: dict[str, Any] = {
            "halt": None,
            "loop_break": None,
            "loop_continue": None,
            "branch": "branch_if",
            "try_catch": None,
            "for_loop": None,
            "for_each": None,
            "break_target": None,
            "continue_target": None,
        }

        async def mock_body_halt(*args: Any, **kwargs: Any) -> str:
            session["_halt"] = True
            return "ok"

        with patch.object(_fl, "_execute_body_chain_iteration", mock_body_halt):
            result = await dispatch_nested_signals(
                signals,
                "if-1",
                {"output_bindings": {}},
                adj,
                {"if-1": _make_node("if-1"), "log-1": node},
                {},
                session,
                "s1",
                set(),
                None,
            )
        assert result == "halt"
