"""Wait Until rounds, timeout outcome, and egress in the workbench engine.

The control declares the wait; the engine runs it. Round order (WAIT-8):
evaluate the condition FIRST and leave immediately if it already holds,
otherwise run the retry sub-flow, sleep the check interval, re-evaluate. The
deadline bounds the WHOLE wait including a sub-flow still in flight (WAIT-2),
the outcome is Assert-shaped rather than an engine failure (WAIT-4), and an
interrupted run leaves the wait at once.

REQ-3.5.4.3, REQ-3.5.4.4.
"""

import asyncio
import re
from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


def _make_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "Wait Until Test",
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


def _make_log_node(node_id: str, display_name: str, message: str = "'ok'") -> dict[str, Any]:
    node = _make_node(
        node_id,
        label="Log",
        element_type="log",
        node_type="plugin",
        config_values={"message": message, "level": "INFO"},
        display_name=display_name,
    )
    node["data"]["expressionFields"] = ["message"]
    return node


def _make_delay_node(node_id: str, duration_ms: int) -> dict[str, Any]:
    return _make_node(
        node_id,
        label="Delay",
        element_type="delay",
        node_type="control",
        config_values={"duration": duration_ms},
        display_name="Slow Body",
    )


def _make_wait_node(
    node_id: str = "wait-1",
    conditions: list[dict[str, Any]] | None = None,
    timeout: int = 2000,
    check_interval: int = 10,
    message: str | None = None,
    mode: str = "retry",
    fail_current_scope: bool | None = None,
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    values: dict[str, Any] = {
        "conditions": conditions if conditions is not None else [],
        "timeout": timeout,
        "check_interval": check_interval,
        "mode": mode,
    }
    if message is not None:
        values["message"] = message
    if fail_current_scope is not None:
        values["fail_current_scope"] = fail_current_scope
    return _make_node(
        node_id,
        label="Wait Until",
        element_type="wait-until",
        node_type="control",
        config_values=values,
        output_bindings=output_bindings or {"passed": "ok", "elapsed": "waited"},
        display_name="Wait Until",
    )


# -- Condition helpers -------------------------------------------------------

CONDITION_ALWAYS_TRUE: list[dict[str, Any]] = [
    {"id": "c-true", "type": "expression", "expression": "True"}
]

CONDITION_ALWAYS_FALSE: list[dict[str, Any]] = [
    {"id": "c-false", "type": "expression", "expression": "False"}
]

_TOKEN_NOT_NULL: list[dict[str, Any]] = [
    {
        "id": "c-token",
        "type": "literal",
        "variable": "token",
        "value_type": "string",
        "operator": "is_not_null",
        "reference_value": None,
        "reference_is_expression": False,
    }
]


def _counter_at_least(n: int) -> list[dict[str, Any]]:
    return [
        {
            "id": "c-counter",
            "type": "literal",
            "variable": "counter",
            "value_type": "integer",
            "operator": "greater_or_equal",
            "reference_value": n,
        }
    ]


def _retry_edges(wait_id: str, body_id: str | None, then_id: str | None) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = [{"source": "start-node", "target": wait_id}]
    if body_id:
        edges.append({"source": wait_id, "target": body_id, "sourceHandle": "retry"})
    if then_id:
        edges.append({"source": wait_id, "target": then_id, "sourceHandle": "then"})
    return edges


def _watch_edges(wait_id: str, then_id: str | None) -> list[dict[str, Any]]:
    """Watch mode renders the single default egress, so its edge is unnamed."""
    edges: list[dict[str, Any]] = [{"source": "start-node", "target": wait_id}]
    if then_id:
        edges.append({"source": wait_id, "target": then_id})
    return edges


def _entries_for(session_id: str, block_id: str) -> list[dict[str, Any]]:
    return [
        entry
        for entry in log_streaming_service.get_logs(session_id)
        if entry.get("blockId") == block_id
    ]


def _counting_execute(target_node_id: str, counter: dict[str, int]) -> Any:
    """Patch the body walker's node executor to count one node's executions."""
    from wavecore.api.services.workbench import for_loop as _wb_for_loop

    original = _wb_for_loop._execute_node

    async def _mock(nf: Any, variables: Any, session_id: str, node_id: str) -> Any:
        result = await original(nf, variables, session_id, node_id)
        if node_id == target_node_id:
            counter["runs"] = counter.get("runs", 0) + 1
            variables["counter"] = counter["runs"]
        return result

    return patch.object(_wb_for_loop, "_execute_node", side_effect=_mock)


class _WaitEngineBase:
    """Registries and session isolation shared by every wait-engine test."""

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
        log_streaming_service._session_logs.clear()
        yield
        _wb_common._clear_sessions_sync()
        log_streaming_service._session_logs.clear()

    @staticmethod
    def _session(session_id: str) -> dict[str, Any]:
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        return _wb_common._workbench_sessions[session_id]


class TestWaitUntilRounds(_WaitEngineBase):
    """Round order, the retry sub-flow, and the bound outputs."""

    @pytest.mark.asyncio
    async def test_a_condition_that_already_holds_costs_one_check_and_no_sub_flow(self) -> None:
        # WAIT-8: the condition is evaluated BEFORE the retry sub-flow, so a wait
        # whose condition already holds must not run the sub-flow at all.
        session_id = "wu-already-true"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_TRUE, timeout=5000, check_interval=1000),
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", "after-log")

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["wait-1"] == "passed"
        assert session["block_states"]["retry-log"] == "skipped"
        assert session["block_states"]["after-log"] == "passed"
        assert variables["ok"] is True
        assert variables["waited"] < 1000

    @pytest.mark.asyncio
    async def test_the_sub_flow_runs_until_the_condition_flips(self) -> None:
        session_id = "wu-flips"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None, "counter": 0}
        counter: dict[str, int] = {}

        nodes = [
            _make_wait_node(conditions=_counter_at_least(2), timeout=5000, check_interval=5),
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", "after-log")

        with _counting_execute("retry-log", counter):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert counter["runs"] == 2
        assert variables["ok"] is True
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_a_multi_node_retry_lane_runs_end_to_end_each_round(self) -> None:
        session_id = "wu-chain"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None, "counter": 0}
        counter: dict[str, int] = {}

        nodes = [
            _make_wait_node(conditions=_counter_at_least(2), timeout=5000, check_interval=5),
            _make_log_node("retry-a", "Retry A", "'a'"),
            _make_log_node("retry-b", "Retry B", "'b'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-a", "after-log")
        edges.append({"source": "retry-a", "target": "retry-b"})

        with _counting_execute("retry-a", counter):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["retry-b"] == "passed"

    @pytest.mark.asyncio
    async def test_each_round_is_written_to_the_run_log(self) -> None:
        # REQ-3.5.4.4: the per-round trace reaches the console through the
        # ordinary execution-log path - no per-round WebSocket traffic.
        session_id = "wu-round-log"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None, "counter": 0}
        counter: dict[str, int] = {}

        nodes = [
            _make_wait_node(conditions=_counter_at_least(2), timeout=5000, check_interval=5),
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", None)

        with _counting_execute("retry-log", counter):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        wait_lines = [entry["message"] for entry in _entries_for(session_id, "wait-1")]
        assert any("[WAIT]" in line for line in wait_lines)
        assert sum("[WAIT]" in line and "ound" in line for line in wait_lines) >= 2

    @pytest.mark.asyncio
    async def test_a_condition_that_never_holds_ends_at_the_deadline(self) -> None:
        session_id = "wu-timeout"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=120, check_interval=10),
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", "after-log")

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert variables["ok"] is False
        assert variables["waited"] >= 120
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_an_empty_retry_lane_is_legal_and_waits_like_watch(self) -> None:
        # While's empty body is legal too; erroring here would be an idiom
        # only this control has.
        session_id = "wu-empty-lane"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=100, check_interval=10),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", None, "after-log")

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert variables["ok"] is False
        assert session["block_states"]["after-log"] == "passed"
        assert not [
            entry
            for entry in log_streaming_service.get_logs(session_id)
            if entry["level"] == "ERROR"
        ]

    @pytest.mark.asyncio
    async def test_watch_mode_keeps_checking_and_leaves_by_its_default_egress(self) -> None:
        # Nothing can satisfy a Watch today, but the rounds and the egress
        # must already behave, so the Parallel batch only has to supply a writer.
        session_id = "wu-watch"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(
                conditions=CONDITION_ALWAYS_FALSE, timeout=100, check_interval=10, mode="watch"
            ),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _watch_edges("wait-1", "after-log")

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert variables["ok"] is False
        assert variables["waited"] >= 100
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_watch_mode_leaves_at_once_when_the_condition_already_holds(self) -> None:
        session_id = "wu-watch-true"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(
                conditions=CONDITION_ALWAYS_TRUE, timeout=5000, check_interval=1000, mode="watch"
            ),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _watch_edges("wait-1", "after-log")

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert variables["ok"] is True
        assert variables["waited"] < 1000
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_the_check_interval_is_measured_after_the_sub_flow(self) -> None:
        # WAIT-8: the interval is recovery time for the system being waited on. If
        # it were measured from the start of the round, a sub-flow slower than
        # the interval would collapse it to zero and hammer the target.
        session_id = "wu-interval"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None, "counter": 0}
        counter: dict[str, int] = {}

        nodes = [
            _make_wait_node(conditions=_counter_at_least(2), timeout=5000, check_interval=60),
            _make_delay_node("retry-delay", 60),
        ]
        edges = _retry_edges("wait-1", "retry-delay", None)

        with _counting_execute("retry-delay", counter):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        # Two rounds, each a ~60ms sub-flow followed by a ~60ms interval.
        assert variables["waited"] >= 200

    @pytest.mark.asyncio
    async def test_a_failing_retry_node_fails_the_wait_and_skips_the_egress(self) -> None:
        session_id = "wu-body-error"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=2000, check_interval=10),
            _make_log_node("retry-log", "Bad Log", "1/0"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", "after-log")

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert session["block_states"]["retry-log"] == "failed"
        assert session["block_states"].get("after-log") in ("skipped", None)

    @pytest.mark.asyncio
    async def test_a_not_null_check_on_a_null_value_waits_to_the_deadline(self) -> None:
        """REQ-3.5.4.3 / REQ-3.1.3.25: a null value holds nothing, so the wait keeps waiting."""
        session_id = "wu-null-waits"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None, "token": None}

        nodes = [
            _make_wait_node(conditions=_TOKEN_NOT_NULL, timeout=60, check_interval=10),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", None, "after-log")

        await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["wait-1"] == "warning"
        assert session["block_states"]["after-log"] == "passed"
        assert variables["ok"] is False
        assert variables["waited"] >= 60
        warns = [
            entry["message"]
            for entry in _entries_for(session_id, "wait-1")
            if entry["level"] == "WARN"
        ]
        assert len(warns) == 1, warns
        assert re.fullmatch(r"\[WAIT\] Gave up after \d+ ms: condition not met", warns[0])

    @pytest.mark.asyncio
    async def test_a_not_null_check_passes_once_the_value_is_set(self) -> None:
        session_id = "wu-null-then-set"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None, "token": None}
        retry_runs = {"count": 0}

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original_execute = _wb_for_loop._execute_node

        async def setting_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original_execute(nf, variables, sid, node_id)
            if node_id == "retry-log":
                retry_runs["count"] += 1
                variables["token"] = "ready"
            return result

        nodes = [
            _make_wait_node(conditions=_TOKEN_NOT_NULL, timeout=5000, check_interval=5),
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", "after-log")

        with patch.object(_wb_for_loop, "_execute_node", side_effect=setting_execute):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["wait-1"] == "passed"
        assert session["block_states"]["after-log"] == "passed"
        assert retry_runs["count"] == 1
        assert variables["ok"] is True


class TestWaitUntilDeadlineBoundsTheSubFlow(_WaitEngineBase):
    """A sub-flow still in flight does not extend the wait."""

    @pytest.mark.asyncio
    async def test_a_sub_flow_slower_than_the_deadline_does_not_extend_the_wait(self) -> None:
        session_id = "wu-slow-body"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=80, check_interval=10),
            _make_delay_node("retry-delay", 3000),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-delay", "after-log")

        await asyncio.wait_for(
            workbench_service._execute_workflow(session_id, nodes, edges, variables),
            timeout=10,
        )

        assert variables["ok"] is False
        assert variables["waited"] < 3000

    @pytest.mark.asyncio
    async def test_a_retry_node_still_running_at_the_deadline_is_marked_stopped(self) -> None:
        session_id = "wu-slow-body-stopped"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=80, check_interval=10),
            _make_delay_node("retry-delay", 3000),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-delay", "after-log")

        await asyncio.wait_for(
            workbench_service._execute_workflow(session_id, nodes, edges, variables),
            timeout=10,
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["retry-delay"] == "stopped"

    @pytest.mark.asyncio
    async def test_the_flow_continues_past_a_wait_whose_sub_flow_was_cut_short(self) -> None:
        session_id = "wu-slow-body-egress"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=80, check_interval=10),
            _make_delay_node("retry-delay", 3000),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-delay", "after-log")

        await asyncio.wait_for(
            workbench_service._execute_workflow(session_id, nodes, edges, variables),
            timeout=10,
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["after-log"] == "passed"
        assert session["status"] == "passed"


class TestWaitUntilTimeoutOutcome(_WaitEngineBase):
    """Giving up with Fail Current Scope fails the block and stops the flow; without it, warns."""

    def _timeout_graph(self, fail_scope: bool | None) -> tuple[list[Any], list[Any]]:
        nodes = [
            _make_wait_node(
                conditions=CONDITION_ALWAYS_FALSE,
                timeout=80,
                check_interval=10,
                message="pod never reached Running",
                fail_current_scope=fail_scope,
            ),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        return nodes, _retry_edges("wait-1", None, "after-log")

    @pytest.mark.asyncio
    async def test_fail_current_scope_fails_the_run_as_a_block_failure(self) -> None:
        session_id = "wu-fail-scope"
        self._session(session_id)
        nodes, edges = self._timeout_graph(True)

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["scope_failed"] is False
        assert session["status"] == "failed"
        assert session["error"].startswith("Gave up after ")

    @pytest.mark.asyncio
    async def test_fail_current_scope_paints_the_wait_node_failed(self) -> None:
        session_id = "wu-fail-scope-node"
        self._session(session_id)
        nodes, edges = self._timeout_graph(True)

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["wait-1"] == "failed"

    @pytest.mark.asyncio
    async def test_fail_current_scope_logs_the_timeout_message_at_error(self) -> None:
        session_id = "wu-fail-scope-log"
        self._session(session_id)
        nodes, edges = self._timeout_graph(True)

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        errors = [
            entry for entry in _entries_for(session_id, "wait-1") if entry["level"] == "ERROR"
        ]
        assert any("pod never reached Running" in entry["message"] for entry in errors)

    @pytest.mark.asyncio
    async def test_the_flow_stops_at_a_scope_failing_wait(self) -> None:
        session_id = "wu-fail-scope-stops"
        self._session(session_id)
        nodes, edges = self._timeout_graph(True)

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["after-log"] == "skipped", session["block_states"]

    @pytest.mark.asyncio
    async def test_without_fail_current_scope_the_scope_is_untouched(self) -> None:
        session_id = "wu-informational"
        self._session(session_id)
        nodes, edges = self._timeout_graph(False)

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["scope_failed"] is False
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_without_fail_current_scope_the_wait_node_paints_amber(self) -> None:
        session_id = "wu-informational-node"
        self._session(session_id)
        nodes, edges = self._timeout_graph(False)

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["wait-1"] == "warning"

    @pytest.mark.asyncio
    async def test_without_fail_current_scope_the_message_logs_at_warn(self) -> None:
        session_id = "wu-informational-log"
        self._session(session_id)
        nodes, edges = self._timeout_graph(False)

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        entries = _entries_for(session_id, "wait-1")
        warns = [entry for entry in entries if entry["level"] == "WARN"]
        assert any("pod never reached Running" in entry["message"] for entry in warns)
        assert not [entry for entry in entries if entry["level"] == "ERROR"]

    @pytest.mark.asyncio
    async def test_an_omitted_fail_current_scope_is_informational(self) -> None:
        session_id = "wu-informational-default"
        self._session(session_id)
        nodes, edges = self._timeout_graph(None)

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["wait-1"] == "warning"
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_a_timeout_without_a_message_still_reports_the_give_up(self) -> None:
        session_id = "wu-no-message"
        self._session(session_id)
        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=80, check_interval=10),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", None, "after-log")

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        warns = [entry for entry in _entries_for(session_id, "wait-1") if entry["level"] == "WARN"]
        assert warns, "a wait that gave up must say so even without an authored message"

    @pytest.mark.asyncio
    async def test_a_wait_that_passes_logs_at_info_and_never_warns(self) -> None:
        session_id = "wu-pass-log"
        self._session(session_id)
        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_TRUE, timeout=2000, check_interval=10),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", None, "after-log")

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        entries = _entries_for(session_id, "wait-1")
        assert any(entry["level"] == "INFO" for entry in entries)
        assert not [entry for entry in entries if entry["level"] in ("WARN", "ERROR")]


class TestWaitUntilInterruption(_WaitEngineBase):
    """A stopped session leaves the wait immediately."""

    @pytest.mark.asyncio
    async def test_a_session_stopped_mid_wait_breaks_out(self) -> None:
        session_id = "wu-stopped"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=20000, check_interval=10),
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", "after-log")

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original = _wb_for_loop._execute_node
        runs = {"n": 0}

        async def _mock(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original(nf, variables, sid, node_id)
            if node_id == "retry-log":
                runs["n"] += 1
                if runs["n"] >= 2:
                    _wb_common._workbench_sessions[sid]["status"] = "stopped"
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=_mock):
            await asyncio.wait_for(
                workbench_service._execute_workflow(session_id, nodes, edges, variables),
                timeout=10,
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_a_stop_during_the_interval_sleep_does_not_wait_it_out(self) -> None:
        session_id = "wu-stopped-sleep"
        self._session(session_id)
        variables: dict[str, Any] = {"ok": None, "waited": None}

        nodes = [
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=20000, check_interval=5000),
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", None)

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original = _wb_for_loop._execute_node

        async def _mock(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original(nf, variables, sid, node_id)
            if node_id == "retry-log":
                _wb_common._workbench_sessions[sid]["status"] = "stopped"
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=_mock):
            await asyncio.wait_for(
                workbench_service._execute_workflow(session_id, nodes, edges, variables),
                timeout=5,
            )

        assert _wb_common._workbench_sessions[session_id]["status"] == "stopped"


class TestWaitUntilInsideALoop(_WaitEngineBase):
    """Break / continue raised inside the retry lane reach the enclosing loop."""

    def _outer_loop_graph(self) -> tuple[list[Any], list[Any]]:
        nodes = [
            _make_node(
                "for-1",
                label="For Loop",
                element_type="for",
                node_type="control",
                config_values={"mode": "count", "count": 5},
                output_bindings={"index": "idx"},
                display_name="For Loop",
            ),
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=200, check_interval=10),
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
            _make_log_node("then-log", "Then Log", "'then'"),
            _make_log_node("after-loop", "After Loop", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "wait-1", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-loop", "sourceHandle": "then"},
            {"source": "wait-1", "target": "retry-log", "sourceHandle": "retry"},
            {"source": "wait-1", "target": "then-log", "sourceHandle": "then"},
        ]
        return nodes, edges

    @pytest.mark.asyncio
    async def test_a_break_targeting_the_outer_loop_propagates_out_of_the_wait(self) -> None:
        session_id = "wu-outer-break"
        self._session(session_id)
        nodes, edges = self._outer_loop_graph()

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original = _wb_for_loop._execute_node

        async def _mock(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original(nf, variables, sid, node_id)
            if node_id == "retry-log":
                if not isinstance(result, dict):
                    result = {}
                result["__break"] = True
                result["__break_target"] = "for-1"
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=_mock):
            await asyncio.wait_for(
                workbench_service._execute_workflow(
                    session_id, nodes, edges, {"ok": None, "waited": None, "idx": None}
                ),
                timeout=10,
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["after-loop"] == "passed"
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_a_continue_targeting_the_outer_loop_propagates_out_of_the_wait(self) -> None:
        session_id = "wu-outer-continue"
        self._session(session_id)
        nodes, edges = self._outer_loop_graph()

        from wavecore.api.services.workbench import for_loop as _wb_for_loop

        original = _wb_for_loop._execute_node

        async def _mock(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            result = await original(nf, variables, sid, node_id)
            if node_id == "retry-log":
                if not isinstance(result, dict):
                    result = {}
                result["__continue"] = True
                result["__continue_target"] = "for-1"
            return result

        with patch.object(_wb_for_loop, "_execute_node", side_effect=_mock):
            await asyncio.wait_for(
                workbench_service._execute_workflow(
                    session_id, nodes, edges, {"ok": None, "waited": None, "idx": None}
                ),
                timeout=10,
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["after-loop"] == "passed"
        assert session["status"] == "passed"


class TestWaitUntilDisabled(_WaitEngineBase):
    """WAIT-9: a disabled wait cascade-skips its retry lane and passes through."""

    @pytest.mark.asyncio
    async def test_a_disabled_wait_skips_its_retry_lane(self) -> None:
        session_id = "wu-disabled"
        self._session(session_id)

        wait_node = _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=2000)
        wait_node["data"]["disabled"] = True
        nodes = [
            wait_node,
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", "after-log")

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["retry-log"] == "skipped"

    @pytest.mark.asyncio
    async def test_a_disabled_wait_still_continues_through_then(self) -> None:
        session_id = "wu-disabled-then"
        self._session(session_id)

        wait_node = _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=2000)
        wait_node["data"]["disabled"] = True
        nodes = [
            wait_node,
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
            _make_log_node("after-log", "After Log", "'done'"),
        ]
        edges = _retry_edges("wait-1", "retry-log", "after-log")

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"ok": None, "waited": None}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["after-log"] == "passed"
        assert session["status"] == "passed"


class TestWaitUntilNestedInAContainer(_WaitEngineBase):
    """A wait's outcome is only known after its rounds, so a nested wait hands
    the resolved status to its enclosing walker instead of the execute() result.
    """

    def _loop_graph(
        self,
        conditions: list[dict[str, Any]],
        retry_message: str = "'retrying'",
        timeout: int = 150,
    ) -> tuple[list[Any], list[Any]]:
        nodes = [
            _make_node(
                "for-1",
                label="For Loop",
                element_type="for",
                node_type="control",
                config_values={"mode": "count", "count": 1},
                output_bindings={"index": "idx"},
                display_name="For Loop",
            ),
            _make_wait_node(conditions=conditions, timeout=timeout, check_interval=10),
            _make_log_node("retry-log", "Retry Log", retry_message),
            _make_log_node("then-log", "Then Log", "'then'"),
            _make_log_node("after-loop", "After Loop", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "wait-1", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-loop", "sourceHandle": "then"},
            {"source": "wait-1", "target": "retry-log", "sourceHandle": "retry"},
            {"source": "wait-1", "target": "then-log", "sourceHandle": "then"},
        ]
        return nodes, edges

    async def _run(self, session_id: str, nodes: list[Any], edges: list[Any]) -> dict[str, Any]:
        await asyncio.wait_for(
            workbench_service._execute_workflow(
                session_id, nodes, edges, {"ok": None, "waited": None, "idx": None}
            ),
            timeout=15,
        )
        return _wb_common._workbench_sessions[session_id]

    @pytest.mark.asyncio
    async def test_a_satisfied_wait_in_a_loop_body_paints_passed(self) -> None:
        session_id = "wu-nested-pass"
        self._session(session_id)
        nodes, edges = self._loop_graph(CONDITION_ALWAYS_TRUE)

        session = await self._run(session_id, nodes, edges)

        assert session["block_states"]["wait-1"] == "passed", session["block_states"]
        assert session["block_states"]["retry-log"] == "skipped", session["block_states"]
        assert session["block_states"]["then-log"] == "passed", session["block_states"]
        assert session["block_states"]["after-loop"] == "passed", session["block_states"]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_a_timed_out_wait_in_a_loop_body_paints_warning(self) -> None:
        session_id = "wu-nested-warn"
        self._session(session_id)
        nodes, edges = self._loop_graph(CONDITION_ALWAYS_FALSE)

        session = await self._run(session_id, nodes, edges)

        assert session["block_states"]["wait-1"] == "warning", session["block_states"]
        assert session["block_states"]["then-log"] == "passed", session["block_states"]
        assert session["block_states"]["after-loop"] == "passed", session["block_states"]
        assert session["scope_failed"] is False
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_a_failing_retry_lane_in_a_loop_body_fails_the_run(self) -> None:
        session_id = "wu-nested-error"
        self._session(session_id)
        nodes, edges = self._loop_graph(CONDITION_ALWAYS_FALSE, retry_message="1/0")

        session = await self._run(session_id, nodes, edges)

        assert session["block_states"]["retry-log"] == "failed", session["block_states"]
        assert session["block_states"].get("then-log") in ("skipped", None), session["block_states"]
        assert session["status"] == "failed"

    @pytest.mark.asyncio
    async def test_a_timed_out_wait_in_a_try_body_paints_warning_without_catching(self) -> None:
        session_id = "wu-nested-try"
        self._session(session_id)

        tc_node = _make_node(
            "tc-1",
            label="Try/Catch",
            element_type="try-catch-finally",
            node_type="control",
            config_values={"enable_catch": True, "enable_finally": False},
            display_name="Try/Catch",
        )
        tc_node["data"]["config"]["outputBindings"] = {}
        nodes = [
            tc_node,
            _make_wait_node(conditions=CONDITION_ALWAYS_FALSE, timeout=150, check_interval=10),
            _make_log_node("retry-log", "Retry Log", "'retrying'"),
            _make_log_node("then-log", "Then Log", "'then'"),
            _make_log_node("catch-log", "Catch", "'CAUGHT'"),
            _make_log_node("then-tc", "Then TC", "'AFTER-TC'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "wait-1", "sourceHandle": "try"},
            {"source": "wait-1", "target": "retry-log", "sourceHandle": "retry"},
            {"source": "wait-1", "target": "then-log", "sourceHandle": "then"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "then-tc", "sourceHandle": "then"},
        ]

        session = await self._run(session_id, nodes, edges)

        assert session["block_states"]["wait-1"] == "warning", session["block_states"]
        assert session["block_states"]["then-log"] == "passed", session["block_states"]
        assert session["block_states"]["catch-log"] == "skipped", session["block_states"]
        assert session["block_states"]["then-tc"] == "passed", session["block_states"]
        assert session["status"] == "passed"


class TestWaitConditionGuard:
    """The condition evaluator's own contract.

    Asserted on the helper directly: ``validate()`` refuses an empty condition
    list before ``execute()`` ever returns signals, so no workflow can carry
    one into the engine - but the guard still has to hold, because
    ``evaluate_assertions`` reads an empty list as vacuously true and an
    unconfigured wait passing instantly would be silent.
    """

    def test_an_empty_condition_set_never_passes(self) -> None:
        from wavecore.api.services.workbench.wait_until import _evaluate_wait_condition

        assert _evaluate_wait_condition([], {"anything": True}) is False

    def test_a_satisfied_condition_passes(self) -> None:
        from wavecore.api.services.workbench.wait_until import _evaluate_wait_condition

        assert _evaluate_wait_condition(CONDITION_ALWAYS_TRUE, {}) is True

    def test_an_unsatisfied_condition_does_not_pass(self) -> None:
        from wavecore.api.services.workbench.wait_until import _evaluate_wait_condition

        assert _evaluate_wait_condition(CONDITION_ALWAYS_FALSE, {}) is False

    @pytest.mark.parametrize(
        ("token", "expected"),
        [pytest.param(None, False, id="null"), pytest.param("ready", True, id="set")],
    )
    def test_a_not_null_check_passes_only_once_the_value_is_set(
        self, token: str | None, expected: bool
    ) -> None:
        from wavecore.api.services.workbench.wait_until import _evaluate_wait_condition

        assert _evaluate_wait_condition(_TOKEN_NOT_NULL, {"token": token}) is expected


class TestWaitConditionIsReadOnly:
    """A Wait Until condition is a read: it may not change what it watches."""

    def test_a_condition_that_changes_a_list_is_refused(self) -> None:
        import pytest

        from wavecore.api.services.workbench.wait_until import _evaluate_wait_condition
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows = [1]
        conditions = [{"type": "expression", "expression": "rows.append(5) or True"}]

        with pytest.raises(BlockedExpressionError) as exc_info:
            _evaluate_wait_condition(conditions, {"rows": rows})

        assert "add a Variable Setter Block" in str(exc_info.value)
        assert rows == [1]

    def test_a_condition_that_only_reads_still_passes(self) -> None:
        from wavecore.api.services.workbench.wait_until import _evaluate_wait_condition

        conditions = [{"type": "expression", "expression": "len(rows) == 2"}]
        assert _evaluate_wait_condition(conditions, {"rows": [1, 2]}) is True
