"""A nested construct reports its own verdict; a pending halt only outranks success.

Every nested-control dispatcher answers its walker with one word. A Halt that fires
while nothing inside the construct failed answers "halt", so an enclosing Try/Catch
skips its catch chain instead of handling a failure nobody caused. A construct that
did fail answers "error" whether or not a halt is pending, so a loop that timed out
never paints green inside a run that ends failed.

REQ-3.5.1.4, REQ-3.2.2.6.
"""

import asyncio
from typing import Any

import pytest

from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import execution as _wb_execution
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench import wait_until as _wb_wait_until
from wavecore.api.services.workbench.nested import dispatch_nested_signals
from wavecore.plugins.base import PluginBase

CONDITION_ALWAYS_FALSE: list[dict[str, Any]] = [
    {"id": "c-false", "type": "expression", "expression": "False"}
]


class HaltAndLingerPlugin(PluginBase):
    """Raises the halt flag the engine's Halt branch raises, then outlives its loop."""

    def __init__(self, session: dict[str, Any]) -> None:
        self._session = session

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "halt-and-linger",
            "name": "Halt And Linger",
            "version": "1.0.0",
            "category": "system",
            "description": "Sets the session halt flag, then stays in flight.",
            "parameters": [],
            "return_type": None,
            "output_schema": [],
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        self._session["status"] = "passed"
        self._session["halt_scope"] = "test"
        self._session["halt_message"] = None
        self._session["_halt"] = True
        await asyncio.sleep(2)
        return {}

    async def validate(self, params: dict[str, Any]) -> None:
        return None


def _make_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "Nested Halt Precedence",
        "scope_failed": False,
    }


def _make_node(
    node_id: str,
    label: str = "Block",
    element_type: str = "delay",
    node_type: str = "control",
    config_values: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    description: str | None = None,
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
            "version": "1.0.0",
            "config": config,
            "disabled": False,
            "description": description or label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _make_log_node(node_id: str, description: str, message: str = "'ok'") -> dict[str, Any]:
    node = _make_node(
        node_id,
        label="Log",
        element_type="log",
        node_type="plugin",
        config_values={"message": message, "level": "INFO"},
        description=description,
    )
    node["data"]["expressionFields"] = ["message"]
    return node


def _make_halt_node(node_id: str, status: str = "passed") -> dict[str, Any]:
    node = _make_node(
        node_id,
        label="Halt",
        element_type="halt",
        node_type="control",
        config_values={"status": status, "message": "'halting'"},
        description="Halt",
    )
    node["data"]["expressionFields"] = ["message"]
    return node


def _make_try_catch_node(node_id: str = "tc-1") -> dict[str, Any]:
    return _make_node(
        node_id,
        label="Try/Catch",
        element_type="try-catch-finally",
        node_type="control",
        config_values={"enable_catch": True, "enable_finally": False},
        output_bindings={"error": "tc_error", "caught": "tc_caught"},
        description="Try/Catch",
    )


def _make_for_node(
    node_id: str = "for-1", count: int = 1, timeout: float | None = None
) -> dict[str, Any]:
    values: dict[str, Any] = {"mode": "count", "count": count}
    if timeout is not None:
        values["timeout"] = timeout
    return _make_node(
        node_id,
        label="For Loop",
        element_type="for",
        node_type="control",
        config_values=values,
        output_bindings={"index": "i"},
        description="For Loop",
    )


def _make_linger_node(node_id: str = "linger-1") -> dict[str, Any]:
    return _make_node(
        node_id,
        label="Halt And Linger",
        element_type="halt-and-linger",
        node_type="plugin",
        config_values={},
        description="Halt And Linger",
    )


def _make_wait_node(node_id: str = "wait-1") -> dict[str, Any]:
    return _make_node(
        node_id,
        label="Wait Until",
        element_type="wait-until",
        node_type="control",
        config_values={
            "conditions": CONDITION_ALWAYS_FALSE,
            "timeout": 400,
            "check_interval": 10,
            "mode": "retry",
        },
        output_bindings={"passed": "ok", "elapsed": "waited"},
        description="Wait Until",
    )


def _signals(**overrides: Any) -> dict[str, Any]:
    """Build the engine signal map a nested dispatch reads."""
    base: dict[str, Any] = {
        "halt": None,
        "halt_status": None,
        "loop_break": None,
        "loop_continue": None,
        "branch": None,
        "try_catch": None,
        "for_loop": None,
        "for_each": None,
        "while_loop": None,
        "wait_until": None,
    }
    base.update(overrides)
    return base


async def _dispatch(session: dict[str, Any], signals: dict[str, Any], node_id: str) -> str | None:
    return await dispatch_nested_signals(
        signals=signals,
        node_id=node_id,
        nf={"output_bindings": {}},
        adj={},
        node_map={},
        variables={},
        session=session,
        session_id="nested-halt-precedence",
        executed=set(),
        environment_id=None,
    )


class TestNestedLoopHaltPrecedence:
    """What a nested For/ForEach/While hands back when a halt is already pending."""

    @pytest.mark.asyncio
    async def test_a_nested_loop_that_failed_still_reports_error_with_a_halt_pending(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session: dict[str, Any] = {"status": "running", "block_states": {}}

        async def _failed_with_halt(**kwargs: Any) -> str:
            kwargs["session"]["_halt"] = True
            return "failed"

        monkeypatch.setattr(_wb_execution, "_dispatch_loop", _failed_with_halt)

        result = await _dispatch(session, _signals(for_loop=True), "inner-for")

        assert result == "error"

    @pytest.mark.asyncio
    async def test_a_halt_pending_after_a_nested_loop_that_passed_reports_halt(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session: dict[str, Any] = {"status": "running", "block_states": {}}

        async def _passed_with_halt(**kwargs: Any) -> str:
            kwargs["session"]["_halt"] = True
            return "passed"

        monkeypatch.setattr(_wb_execution, "_dispatch_loop", _passed_with_halt)

        result = await _dispatch(session, _signals(for_each=True), "inner-for-each")

        assert result == "halt"

    @pytest.mark.asyncio
    async def test_a_nested_loop_failure_with_no_halt_still_reports_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session: dict[str, Any] = {"status": "running", "block_states": {}}

        async def _failed(**_kwargs: Any) -> str:
            return "failed"

        monkeypatch.setattr(_wb_execution, "_dispatch_loop", _failed)

        result = await _dispatch(session, _signals(while_loop=True), "inner-while")

        assert result == "error"


class TestNestedWaitUntilHaltPrecedence:
    """What a nested Wait Until hands back when a halt is already pending."""

    @pytest.mark.asyncio
    async def test_a_wait_lane_failure_still_reports_error_with_a_halt_pending(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session: dict[str, Any] = {"status": "running", "block_states": {}}

        async def _errored_with_halt(*args: Any) -> str:
            session["_halt"] = True
            return "error"

        monkeypatch.setattr(_wb_wait_until, "_execute_wait_until_body", _errored_with_halt)

        result = await _dispatch(session, _signals(wait_until=True), "inner-wait")

        assert result == "error"
        assert "_wait_status" not in session

    @pytest.mark.asyncio
    async def test_a_wait_that_gave_up_keeps_its_own_verdict_when_a_halt_is_pending(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session: dict[str, Any] = {"status": "running", "block_states": {}}

        async def _warned_with_halt(*args: Any) -> str:
            session["_halt"] = True
            return "warning"

        monkeypatch.setattr(_wb_wait_until, "_execute_wait_until_body", _warned_with_halt)

        result = await _dispatch(session, _signals(wait_until=True), "inner-wait")

        assert result == "halt"
        assert session["_wait_status"] == "warning"

    @pytest.mark.asyncio
    async def test_a_halted_wait_still_hands_the_stopped_paint_to_the_walker(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session: dict[str, Any] = {"status": "running", "block_states": {}}

        async def _stopped_with_halt(*args: Any) -> str:
            session["_halt"] = True
            return "stopped"

        monkeypatch.setattr(_wb_wait_until, "_execute_wait_until_body", _stopped_with_halt)

        result = await _dispatch(session, _signals(wait_until=True), "inner-wait")

        assert result == "halt"
        assert session["_wait_status"] == "stopped"

    @pytest.mark.asyncio
    async def test_a_wait_lane_failure_with_no_halt_still_reports_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session: dict[str, Any] = {"status": "running", "block_states": {}}

        async def _errored(*_args: Any) -> str:
            return "error"

        monkeypatch.setattr(_wb_wait_until, "_execute_wait_until_body", _errored)

        result = await _dispatch(session, _signals(wait_until=True), "inner-wait")

        assert result == "error"
        assert "_wait_status" not in session


class TestHaltInsideANestedConstructReachesTheWalker:
    """End-to-end shapes: a Halt inside a nested construct is a stop, not a catch."""

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

    @pytest.mark.asyncio
    async def test_a_halt_in_a_nested_loop_body_never_routes_to_the_catch_chain(self) -> None:
        session_id = "nhp-loop-halt"
        self._session(session_id)

        nodes = [
            _make_try_catch_node(),
            _make_for_node(),
            _make_halt_node("halt-1"),
            _make_log_node("catch-log", "Catch Log", "'CAUGHT'"),
            _make_log_node("then-log", "Then Log", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "for-1", "sourceHandle": "try"},
            {"source": "for-1", "target": "halt-1", "sourceHandle": "body"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "then-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"i": None, "tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["for-1"] == "passed", session["block_states"]
        assert session["block_states"]["catch-log"] == "skipped", session["block_states"]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_a_halt_in_a_nested_wait_retry_lane_paints_the_wait_stopped(self) -> None:
        session_id = "nhp-wait-halt"
        self._session(session_id)

        nodes = [
            _make_try_catch_node(),
            _make_wait_node(),
            _make_halt_node("halt-1"),
            _make_log_node("catch-log", "Catch Log", "'CAUGHT'"),
            _make_log_node("then-log", "Then Log", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "wait-1", "sourceHandle": "try"},
            {"source": "wait-1", "target": "halt-1", "sourceHandle": "retry"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "then-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {"ok": None, "waited": None, "tc_error": None, "tc_caught": False},
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["wait-1"] == "stopped", session["block_states"]
        assert session["block_states"]["catch-log"] == "skipped", session["block_states"]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_a_genuine_failure_in_a_nested_loop_body_still_routes_to_the_catch_chain(
        self,
    ) -> None:
        session_id = "nhp-loop-fail"
        self._session(session_id)

        nodes = [
            _make_try_catch_node(),
            _make_for_node(),
            _make_log_node("body-log", "Body Log", "1/0"),
            _make_log_node("catch-log", "Catch Log", "'CAUGHT'"),
            _make_log_node("then-log", "Then Log", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "for-1", "sourceHandle": "try"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "then-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"i": None, "tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["for-1"] == "failed", session["block_states"]
        assert session["block_states"]["catch-log"] == "passed", session["block_states"]
        assert session["block_states"]["then-log"] == "passed", session["block_states"]

    @pytest.mark.asyncio
    async def test_a_loop_that_timed_out_paints_failed_while_the_run_is_stopping(self) -> None:
        from wavecore.core.plugin_registry import register_plugin

        session_id = "nhp-loop-timeout-halt"
        session = self._session(session_id)
        register_plugin(HaltAndLingerPlugin(session))

        nodes = [
            _make_try_catch_node(),
            _make_for_node(timeout=0.05),
            _make_linger_node(),
            _make_log_node("catch-log", "Catch Log", "'CAUGHT'"),
            _make_log_node("then-log", "Then Log", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "for-1", "sourceHandle": "try"},
            {"source": "for-1", "target": "linger-1", "sourceHandle": "body"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "then-log", "sourceHandle": "then"},
        ]

        await workbench_service._execute_workflow(
            session_id, nodes, edges, {"i": None, "tc_error": None, "tc_caught": False}
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["block_states"]["for-1"] == "failed", session["block_states"]
        assert session["block_states"]["catch-log"] == "skipped", session["block_states"]
        assert session["status"] == "failed"
