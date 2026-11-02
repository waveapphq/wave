"""Tests for while-loop execution in workbench_service._execute_workflow.

Tests the while-loop execution engine: condition evaluation (pre/post check),
body chain iteration, max_iterations failure, timeout failure, break/continue
hooks, and error handling.

Coverage targets:
- _execute_while_loop_body: Full while-loop orchestration
- Signal extraction: __while_loop, __condition, __mode, __max_iterations
- Condition evaluation: assertion evaluator integration
- _execute_workflow integration: End-to-end workflow with while-loop node

REQ-3.5.1.17: While loop with condition
REQ-3.5.1.2: Break hook points
REQ-3.5.1.3: Continue hook points
"""

from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench.signals import _extract_engine_signals


def _make_session(session_id: str) -> dict[str, Any]:
    """Create a minimal workbench session for testing."""
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "While Loop Test",
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


def _make_while_node(
    node_id: str = "while-1",
    mode: str = "while-do",
    conditions: list[dict[str, Any]] | None = None,
    max_iterations: int | None = None,
    timeout: float | None = None,
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Create a While Loop control node."""
    values: dict[str, Any] = {
        "mode": mode,
        "conditions": conditions if conditions is not None else [],
    }
    if max_iterations is not None:
        values["max_iterations"] = max_iterations
    if timeout is not None:
        values["timeout"] = timeout
    return _make_node(
        node_id,
        label="While Loop",
        element_type="while",
        node_type="control",
        version="1.0.0",
        config_values=values,
        output_bindings=output_bindings or {"index": "idx"},
        display_name="While Loop",
    )


# -- Condition helpers -------------------------------------------------------

CONDITION_ALWAYS_TRUE: list[dict[str, Any]] = [{"type": "expression", "expression": "True"}]

CONDITION_ALWAYS_FALSE: list[dict[str, Any]] = [{"type": "expression", "expression": "False"}]


def _condition_counter_lt(n: int) -> list[dict[str, Any]]:
    """Literal assertion: counter < n."""
    return [
        {
            "type": "literal",
            "variable": "counter",
            "value_type": "integer",
            "operator": "less_than",
            "reference_value": n,
        }
    ]


# -- Test classes ------------------------------------------------------------


class TestWhileLoopWorkflowExecution:
    """End-to-end while-loop workflow execution tests."""

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
    async def test_while_do_condition_false_zero_iterations(self) -> None:
        """While-Do with always-false condition: 0 iterations, then-path executed."""
        session_id = "wl-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node("while-1", mode="while-do", conditions=CONDITION_ALWAYS_FALSE),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_while_do_empty_conditions_zero_iterations(self) -> None:
        """While-Do with empty conditions list: evaluates to False, 0 iterations."""
        session_id = "wl-empty"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node("while-1", mode="while-do", conditions=[]),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_while_do_condition_changes_body_runs_n_times(self) -> None:
        """While-Do with counter < 3: body runs 3 times, then-path executed."""
        session_id = "wl-2"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"idx": None, "counter": 0}

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=_condition_counter_lt(3),
            ),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-log":
                variables["counter"] = variables.get("counter", 0) + 1
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert variables["counter"] == 3
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_do_while_always_false_runs_once(self) -> None:
        """Do-While with always-false condition: body runs exactly 1 time."""
        session_id = "wl-3"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node("while-1", mode="do-while", conditions=CONDITION_ALWAYS_FALSE),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Body MUST have executed (do-while always runs at least once)
        assert session["block_states"]["body-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_do_while_condition_changes(self) -> None:
        """Do-While with counter < 3: body runs 3 times (same as while-do for this condition)."""
        session_id = "wl-4"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"idx": None, "counter": 0}

        nodes = [
            _make_while_node(
                "while-1",
                mode="do-while",
                conditions=_condition_counter_lt(3),
            ),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-log":
                variables["counter"] = variables.get("counter", 0) + 1
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert variables["counter"] == 3
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_max_iterations_session_fails(self) -> None:
        """Always-true condition + max_iterations=3: session FAILS after 3 iterations."""
        session_id = "wl-5"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=3,
            ),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        # Then-path should NOT execute on max_iterations failure
        assert session["block_states"].get("after-log") in ("skipped", None)

    @pytest.mark.asyncio
    async def test_do_while_max_iterations_session_fails(self) -> None:
        """Do-While with always-true + max_iterations=3: session FAILS."""
        session_id = "wl-6"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="do-while",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=3,
            ),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"

    @pytest.mark.asyncio
    async def test_timeout_session_fails(self) -> None:
        """Always-true condition + timeout: session FAILS on timeout."""
        session_id = "wl-7"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                timeout=0.001,
            ),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"].get("after-log") in ("skipped", None)

    @pytest.mark.asyncio
    async def test_body_error_aborts_loop(self) -> None:
        """Body node error: loop aborts, then NOT executed, session FAILS."""
        session_id = "wl-8"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=5,
            ),
            _make_log_node("body-log", "Bad Log", "1/0"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["body-log"] == "failed"
        assert session["block_states"].get("after-log") in ("skipped", None)

    @pytest.mark.asyncio
    async def test_body_chain_second_node_fails(self) -> None:
        """Body chain: LogA -> BadLog. LogA passes, BadLog fails."""
        session_id = "wl-9"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=2,
            ),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "1/0"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["body-a"] == "passed"
        assert session["block_states"]["body-b"] == "failed"

    @pytest.mark.asyncio
    async def test_no_body_connection_then_executes(self) -> None:
        """No body connection. Then target executes directly."""
        session_id = "wl-10"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_FALSE,
            ),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_do_while_no_body_runs_once(self) -> None:
        """Do-While with no body connection: runs 1 iteration (empty body), then exits."""
        session_id = "wl-no-body-dw"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="do-while",
                conditions=CONDITION_ALWAYS_FALSE,
            ),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_variable_injection_index(self) -> None:
        """Output binding 'index' -> 'idx'. After 3 iterations, idx == 3."""
        session_id = "wl-11"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"idx": None, "counter": 0}

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=_condition_counter_lt(3),
            ),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-log":
                variables["counter"] = variables.get("counter", 0) + 1
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        # index should equal the total iterations completed
        assert variables["idx"] == 3

    @pytest.mark.asyncio
    async def test_break_signal_exits_loop(self) -> None:
        """Body node returning __break exits loop, then IS executed."""
        session_id = "wl-12"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=100,
            ),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
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
            await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_continue_signal_skips_rest_of_body(self) -> None:
        """Body node returning __continue skips rest of body, next iteration starts."""
        session_id = "wl-13"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=3,
            ),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
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
            await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        # Session fails because max_iterations is hit (continue doesn't exit loop)
        assert session["status"] == "failed"
        # body-b should have been skipped on every iteration due to continue
        assert session["block_states"]["body-b"] == "skipped"

    @pytest.mark.asyncio
    async def test_disabled_body_node_skipped(self) -> None:
        """Disabled body node is skipped, loop continues."""
        session_id = "wl-14"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        body_node = _make_log_node("body-log", "Body Log", "'ok'")
        body_node["data"]["disabled"] = True

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=2,
            ),
            body_node,
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        # max_iterations still reached because condition is always true
        assert session["status"] == "failed"
        assert session["block_states"]["body-log"] == "skipped"

    @pytest.mark.asyncio
    async def test_stopped_session_breaks_while_loop(self) -> None:
        """Session set to 'stopped' mid-iteration - loop exits."""
        session_id = "wl-15"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=100,
            ),
            _make_log_node("body-log", "Body Log", "'iteration'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
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
            await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_while_do_body_re_executed_each_iteration(self) -> None:
        """While(max_iterations=3) with 2 body nodes. Both pass on each iteration."""
        session_id = "wl-16"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=3,
            ),
            _make_log_node("body-a", "Body A", "'a'"),
            _make_log_node("body-b", "Body B", "'b'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        # max_iterations hit: session fails
        assert session["status"] == "failed"
        # Body nodes passed on last iteration
        assert session["block_states"]["body-a"] == "passed"
        assert session["block_states"]["body-b"] == "passed"

    @staticmethod
    async def _run_not_null_loop_on_a_null_value(session_id: str, mode: str) -> dict[str, Any]:
        """Run a While on ``token is_not_null`` with ``token`` null; return body runs and idx."""
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        variables: dict[str, Any] = {"idx": None, "token": None}
        not_null = [
            {
                "type": "literal",
                "variable": "token",
                "value_type": "string",
                "operator": "is_not_null",
                "reference_value": None,
                "reference_is_expression": False,
            }
        ]
        nodes = [
            _make_while_node("while-1", mode=mode, conditions=not_null, max_iterations=5),
            _make_log_node("body-log", "Body Log", "'iteration'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node
        body_runs = {"count": 0}

        async def counting_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            if node_id == "body-log":
                body_runs["count"] += 1
            return await original_execute(nf, variables, sid, node_id)

        with patch.object(_wb_for_loop, "_execute_node", side_effect=counting_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        return {
            "session": _wb_common._workbench_sessions[session_id],
            "body_runs": body_runs["count"],
            "idx": variables["idx"],
        }

    @pytest.mark.asyncio
    async def test_while_do_is_not_null_on_a_null_value_runs_zero_passes(self) -> None:
        """REQ-3.5.1.17 / REQ-3.1.3.25: a null value holds nothing, so is_not_null is false."""
        outcome = await self._run_not_null_loop_on_a_null_value("wl-null-while-do", "while-do")

        assert outcome["session"]["status"] == "passed"
        assert outcome["body_runs"] == 0
        assert outcome["idx"] == 0
        assert outcome["session"]["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_do_while_is_not_null_on_a_null_value_runs_once(self) -> None:
        outcome = await self._run_not_null_loop_on_a_null_value("wl-null-do-while", "do-while")

        assert outcome["session"]["status"] == "passed"
        assert outcome["body_runs"] == 1
        assert outcome["idx"] == 1
        assert outcome["session"]["block_states"]["after-log"] == "passed"


class TestWhileLoopSignalExtraction:
    """Test signal extraction for while-loop signals."""

    def test_extract_while_loop_signals(self) -> None:
        """_extract_engine_signals extracts __while_loop and related params."""
        result: dict[str, Any] = {
            "__while_loop": True,
            "__condition": [{"type": "expression", "expression": "True"}],
            "__mode": "while-do",
            "__max_iterations": 100,
            "__timeout": 30.0,
            "index": 0,
        }
        signals = _extract_engine_signals(result)
        assert signals["while_loop"] is True
        assert signals["condition"] == [{"type": "expression", "expression": "True"}]
        assert signals["while_mode"] == "while-do"
        assert signals["max_iterations"] == 100
        assert signals["timeout"] == 30.0
        # Engine keys removed from result, user output remains
        assert "__while_loop" not in result
        assert "__condition" not in result
        assert "__mode" not in result
        assert "__max_iterations" not in result
        assert "index" in result

    def test_extract_do_while_mode(self) -> None:
        """__mode=do-while extracts correctly."""
        result: dict[str, Any] = {
            "__while_loop": True,
            "__condition": [],
            "__mode": "do-while",
        }
        signals = _extract_engine_signals(result)
        assert signals["while_loop"] is True
        assert signals["while_mode"] == "do-while"

    def test_extract_no_while_signals_returns_none(self) -> None:
        """Without while keys, signals default to None."""
        result: dict[str, Any] = {"some_output": "val"}
        signals = _extract_engine_signals(result)
        assert signals.get("while_loop") is None
        assert signals.get("condition") is None
        assert signals.get("while_mode") is None
        assert signals.get("max_iterations") is None

    def test_extract_while_no_max_iterations(self) -> None:
        """While without max_iterations: signal is None."""
        result: dict[str, Any] = {
            "__while_loop": True,
            "__condition": [],
            "__mode": "while-do",
        }
        signals = _extract_engine_signals(result)
        assert signals.get("max_iterations") is None

    def test_extract_while_preserves_user_output(self) -> None:
        """User output (index) is preserved after signal extraction."""
        result: dict[str, Any] = {
            "__while_loop": True,
            "__condition": [],
            "__mode": "while-do",
            "__max_iterations": None,
            "__timeout": None,
            "index": 0,
        }
        _extract_engine_signals(result)
        assert result == {"index": 0}


class TestWhileLoopTargetAwareBreakContinue:
    """Test target-aware break/continue signal propagation in while-loop.

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
        """Break with target matching this while-loop's node_id - exits, then-path executes."""
        session_id = "wl-target-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=100,
            ),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
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
                        result["__break_target"] = "while-1"
                    else:
                        result = {"__break": True, "__break_target": "while-1"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_break_targeting_parent_loop_skips_then(self) -> None:
        """Break with target NOT matching this while-loop - exits, SKIPS then-path, propagates."""
        session_id = "wl-target-2"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=100,
            ),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__break"] = True
                    result["__break_target"] = "outer-for-999"
                else:
                    result = {"__break": True, "__break_target": "outer-for-999"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        # Then-path SKIPPED because break targets a parent loop
        assert session["block_states"].get("after-log") in ("skipped", None)
        # Session carries propagation signal for parent
        assert session.get("_loop_signal") == "break"
        assert session.get("_loop_signal_target") == "outer-for-999"

    @pytest.mark.asyncio
    async def test_continue_targeting_this_loop_advances(self) -> None:
        """Continue with target matching this while-loop - skips body, continues iteration."""
        session_id = "wl-target-3"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=3,
            ),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__continue"] = True
                    result["__continue_target"] = "while-1"
                else:
                    result = {"__continue": True, "__continue_target": "while-1"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        # Session fails because max_iterations is hit (continue doesn't exit loop)
        assert session["status"] == "failed"
        # body-b should have been skipped on every iteration due to continue
        assert session["block_states"]["body-b"] == "skipped"

    @pytest.mark.asyncio
    async def test_continue_targeting_parent_loop_propagates(self) -> None:
        """Continue with target NOT matching this while-loop - exits, propagates to parent."""
        session_id = "wl-target-4"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=100,
            ),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                if result and isinstance(result, dict):
                    result["__continue"] = True
                    result["__continue_target"] = "outer-fe-888"
                else:
                    result = {"__continue": True, "__continue_target": "outer-fe-888"}
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        # Then-path SKIPPED because continue targets a parent loop
        assert session["block_states"].get("after-log") in ("skipped", None)
        # Session carries propagation signal for parent
        assert session.get("_loop_signal") == "continue"
        assert session.get("_loop_signal_target") == "outer-fe-888"

    @pytest.mark.asyncio
    async def test_stopped_during_body_exits_while_loop(self) -> None:
        """Session set to 'stopped' during body execution exits the while loop.

        Two body nodes are needed: body-a sets status to 'stopped', then
        body-b's iteration hits the status check and returns 'stopped',
        which propagates as outcome='stopped' in _run_while_iteration_loop.
        """
        session_id = "wl-stopped-1"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_while_node(
                "while-1",
                mode="while-do",
                conditions=CONDITION_ALWAYS_TRUE,
                max_iterations=100,
            ),
            _make_log_node("body-a", "Body A", "'ok'"),
            _make_log_node("body-b", "Body B", "'ok'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "while-1"},
            {"source": "while-1", "target": "body-a", "sourceHandle": "body"},
            {"source": "body-a", "target": "body-b"},
            {"source": "while-1", "target": "after-log", "sourceHandle": "then"},
        ]

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def mock_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "body-a":
                _wb_common._workbench_sessions[sid]["status"] = "stopped"
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=mock_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, {"idx": None})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "stopped"


class TestWhileConditionIsReadOnly:
    """A While condition is a read: it may not change what it tests."""

    def test_a_condition_that_changes_a_list_is_refused(self) -> None:
        import pytest

        from wavecore.api.services.workbench.while_loop import _evaluate_while_condition
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows = [1]
        conditions = [{"type": "expression", "expression": "rows.append(5) or True"}]

        with pytest.raises(BlockedExpressionError) as exc_info:
            _evaluate_while_condition(conditions, {"rows": rows})

        assert "add a Variable Setter Block" in str(exc_info.value)
        assert rows == [1]

    def test_a_condition_that_only_reads_still_passes(self) -> None:
        from wavecore.api.services.workbench.while_loop import _evaluate_while_condition

        conditions = [{"type": "expression", "expression": "len(rows) == 2"}]
        assert _evaluate_while_condition(conditions, {"rows": [1, 2]}) is True
