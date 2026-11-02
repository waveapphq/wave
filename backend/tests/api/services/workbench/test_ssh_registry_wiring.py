"""
SSH session registry run wiring tests (REQ-3.4.1.3).

The workbench run owns the SSH session lifecycle: every run creates one
SSHSessionRegistry on its session dict (mirroring the per-run
secret_registry), threads it into each plugin's execution context along
with the node's output bindings, and drains it (close_all, child before
parent) on every terminal path - passed, failed, and stopped.
"""

import asyncio
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench.functions import FunctionCanvas
from wavecore.api.services.workbench.node_helpers import _execute_node, _extract_node_fields
from wavecore.api.services.workbench.plugins import _execute_plugin_with_session
from wavecore.core.functions.executor import ScopedStart
from wavecore.core.ssh.session_registry import SSHSessionRegistry


class _ContextProbePlugin:
    """Minimal plugin capturing the execution context it receives."""

    def __init__(self, plugin_id: str = "ctx-probe") -> None:
        self._id = plugin_id
        self.context: dict[str, Any] | None = None

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": self._id,
            "name": "Context Probe",
            "version": "1.0.0",
            "category": "network",
            "description": "probe",
            "parameters": [],
            "return_type": "map",
            "output_schema": [],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        pass

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        self.context = context
        return {"ok": True}

    async def cleanup(self) -> None:
        pass


def _prime_session(registry: SSHSessionRegistry | None) -> str:
    session_id = str(uuid.uuid4())
    session: dict[str, Any] = {
        "session_id": session_id,
        "test_id": str(uuid.uuid4()),
        "status": "running",
        "user_id": wb_common.DEFAULT_USER_ID,
        "variables": {},
        "block_states": {},
    }
    if registry is not None:
        session["ssh_session_registry"] = registry
    wb_common._workbench_sessions[session_id] = session
    return session_id


async def _run_probe(
    plugin: _ContextProbePlugin,
    session_id: str,
    **kwargs: Any,
) -> Any:
    return await _execute_plugin_with_session(
        plugin,
        "ctx-probe",
        {},
        {},
        session_id,
        None,
        None,
        None,
        None,
        **kwargs,
    )


def _make_run_session(session_id: str, registry: SSHSessionRegistry) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "SSH Wiring Test",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "scope_failed": False,
        "breakpoints": set(),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
        "ssh_session_registry": registry,
    }


def _log_node(node_id: str, message: str = "'ok'") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Log",
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": {"message": message, "level": "INFO"}},
            "disabled": False,
            "displayName": "Log",
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


class TestRunCreatesRegistry:
    """Every run creates an SSHSessionRegistry on its session dict."""

    @pytest.fixture(autouse=True)
    def _clean_sessions(self) -> Any:
        wb_common._clear_sessions_sync()
        yield
        wb_common._clear_sessions_sync()

    @pytest.fixture
    def _mock_test(self) -> dict[str, Any]:
        node_id = str(uuid.uuid4())
        return {
            "id": str(uuid.uuid4()),
            "name": "SSH Registry Test",
            "workflow": {
                "nodes": [
                    {
                        "id": node_id,
                        "type": "workflowNode",
                        "data": {
                            "label": "Log",
                            "elementType": "log",
                            "nodeType": "plugin",
                            "version": "1.0.0",
                            "config": {"values": {"message": "hi", "level": "INFO"}},
                        },
                    }
                ],
                "edges": [],
            },
            "variables": {},
        }

    def test_start_workbench_run_creates_an_ssh_session_registry(
        self, _mock_test: dict[str, Any]
    ) -> None:
        with (
            patch(
                "wavecore.api.services.workbench.service.test_service.get_test",
                return_value=_mock_test,
            ),
            patch(
                "wavecore.api.services.workbench.service.test_service.get_test_variables_raw",
                return_value={},
            ),
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment",
                return_value={"id": "env-1", "name": "Dev"},
            ),
            patch("wavecore.api.services.workbench.service.asyncio.create_task"),
        ):
            run_info = workbench_service.start_workbench_run(
                test_id=_mock_test["id"],
                environment_id="env-1",
            )

        session = wb_common._workbench_sessions[run_info["session_id"]]
        assert isinstance(session["ssh_session_registry"], SSHSessionRegistry)

    def test_run_registry_has_the_variable_push_wired(self, _mock_test: dict[str, Any]) -> None:
        with (
            patch(
                "wavecore.api.services.workbench.service.test_service.get_test",
                return_value=_mock_test,
            ),
            patch(
                "wavecore.api.services.workbench.service.test_service.get_test_variables_raw",
                return_value={},
            ),
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment",
                return_value={"id": "env-1", "name": "Dev"},
            ),
            patch("wavecore.api.services.workbench.service.asyncio.create_task"),
        ):
            run_info = workbench_service.start_workbench_run(
                test_id=_mock_test["id"],
                environment_id="env-1",
            )

        registry = wb_common._workbench_sessions[run_info["session_id"]]["ssh_session_registry"]
        assert registry.push_variable is not None

    def test_scoped_function_session_creates_an_ssh_session_registry(self) -> None:
        node: dict[str, Any] = {"id": "fn-1", "data": {"nodeType": "function"}}
        with (
            patch(
                "wavecore.api.services.workbench.service._prepare_session_artifacts",
                return_value=None,
            ),
            patch("wavecore.api.services.workbench.service.asyncio.create_task"),
        ):
            run_info = workbench_service._stage_scoped_function_session(
                test_id=str(uuid.uuid4()),
                test_name="Scoped",
                environment_id="env-1",
                user_id=wb_common.DEFAULT_USER_ID,
                run=workbench_service._FunctionRun(
                    [FunctionCanvas([node], [])], node, ("fn-1",), "fn-1"
                ),
                start=ScopedStart(),
                warnings=[],
                session_id=None,
                debug=None,
            )

        session = wb_common._workbench_sessions[run_info["session_id"]]
        assert isinstance(session["ssh_session_registry"], SSHSessionRegistry)


class TestPluginContextThreading:
    """The run's registry and the node's output bindings reach the plugin context."""

    @pytest.fixture(autouse=True)
    def _clean_sessions(self) -> Any:
        wb_common._clear_sessions_sync()
        yield
        wb_common._clear_sessions_sync()

    async def test_registry_reaches_the_plugin_context(self) -> None:
        registry = SSHSessionRegistry()
        session_id = _prime_session(registry)
        plugin = _ContextProbePlugin()

        await _run_probe(plugin, session_id)

        assert plugin.context is not None
        assert plugin.context["ssh_session_registry"] is registry

    async def test_session_without_registry_threads_none(self) -> None:
        session_id = _prime_session(None)
        plugin = _ContextProbePlugin()

        await _run_probe(plugin, session_id)

        assert plugin.context is not None
        assert plugin.context.get("ssh_session_registry") is None

    async def test_unknown_session_threads_none(self) -> None:
        plugin = _ContextProbePlugin()

        await _run_probe(plugin, str(uuid.uuid4()))

        assert plugin.context is not None
        assert plugin.context.get("ssh_session_registry") is None

    async def test_output_bindings_reach_the_plugin_context(self) -> None:
        session_id = _prime_session(None)
        plugin = _ContextProbePlugin()

        await _run_probe(plugin, session_id, output_bindings={"connected": "conn_ok"})

        assert plugin.context is not None
        assert plugin.context["output_bindings"] == {"connected": "conn_ok"}

    async def test_omitted_output_bindings_default_to_empty(self) -> None:
        session_id = _prime_session(None)
        plugin = _ContextProbePlugin()

        await _run_probe(plugin, session_id)

        assert plugin.context is not None
        assert plugin.context["output_bindings"] == {}

    async def test_execute_node_threads_the_node_output_bindings(self) -> None:
        from wavecore.core.plugin_registry import clear_registry, register_plugin

        registry = SSHSessionRegistry()
        session_id = _prime_session(registry)
        plugin = _ContextProbePlugin()
        clear_registry()
        register_plugin(plugin)
        try:
            node = {
                "id": "probe-1",
                "type": "workflowNode",
                "data": {
                    "label": "Probe",
                    "elementType": "ctx-probe",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {},
                        "outputBindings": {"session_id": "sid_var", "connected": "conn_ok"},
                    },
                },
            }
            node_fields = _extract_node_fields(node)

            await _execute_node(node_fields, {}, session_id, "probe-1")
        finally:
            clear_registry()

        assert plugin.context is not None
        assert plugin.context["output_bindings"] == {
            "session_id": "sid_var",
            "connected": "conn_ok",
        }
        assert plugin.context["ssh_session_registry"] is registry


class TestTerminalCleanup:
    """close_all() fires on a full run's clean end (passed/failed) and on Test
    Close - but NOT on Immediate Stop, which preserves open sessions so a single
    remote block can be re-run (Run Current)."""

    @pytest.fixture(autouse=True)
    def _engine_setup(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        wb_common._clear_sessions_sync()
        yield
        clear_registry()
        wb_common._clear_sessions_sync()

    @staticmethod
    def _registry_with_conn() -> tuple[SSHSessionRegistry, MagicMock]:
        registry = SSHSessionRegistry()
        conn = MagicMock()
        registry.register(
            "ssh_session_left_open", conn, None, "node-1", None, None, connect_timeout=30
        )
        return registry, conn

    async def test_passed_run_closes_open_sessions(self) -> None:
        session_id = "ssh-wire-pass"
        registry, conn = self._registry_with_conn()
        wb_common._workbench_sessions[session_id] = _make_run_session(session_id, registry)

        await workbench_service._execute_workflow(
            session_id,
            [_log_node("log-1")],
            [{"source": "start-node", "target": "log-1"}],
            {},
        )

        assert wb_common._workbench_sessions[session_id]["status"] == "passed"
        conn.close.assert_called_once_with()
        assert registry.get("ssh_session_left_open") is None

    async def test_failed_run_closes_open_sessions(self) -> None:
        session_id = "ssh-wire-fail"
        registry, conn = self._registry_with_conn()
        wb_common._workbench_sessions[session_id] = _make_run_session(session_id, registry)

        await workbench_service._execute_workflow(
            session_id,
            [_log_node("log-1", message="1/0")],
            [{"source": "start-node", "target": "log-1"}],
            {},
        )

        assert wb_common._workbench_sessions[session_id]["status"] == "failed"
        conn.close.assert_called_once_with()
        assert registry.get("ssh_session_left_open") is None

    async def test_stopped_run_keeps_sessions_open_for_rerun(self) -> None:
        # Immediate Stop preserves open SSH sessions so a remote block can be
        # re-run against the live session; only a clean end / Test Close closes.
        session_id = "ssh-wire-stop"
        registry, conn = self._registry_with_conn()
        wb_common._workbench_sessions[session_id] = _make_run_session(session_id, registry)

        wb_common._terminate_session(session_id)

        conn.close.assert_not_called()
        assert registry.get("ssh_session_left_open") is not None

    async def test_adhoc_run_keeps_sessions_open(self) -> None:
        # An ad-hoc poke (Run Current) that completes cleanly still leaves the
        # session open for the next poke - only a full run's end closes it.
        session_id = "ssh-wire-adhoc"
        registry, conn = self._registry_with_conn()
        session = _make_run_session(session_id, registry)
        session["_is_adhoc"] = True
        wb_common._workbench_sessions[session_id] = session

        wb_common._notify_terminal(session_id, "passed")

        conn.close.assert_not_called()
        assert registry.get("ssh_session_left_open") is not None

    async def test_test_close_closes_open_sessions(self) -> None:
        # clear_session_for_user (Test Close / reset) is the escape hatch that
        # closes whatever Immediate Stop / ad-hoc runs left open.
        session_id = "ssh-wire-close"
        registry, conn = self._registry_with_conn()
        session = _make_run_session(session_id, registry)
        wb_common._workbench_sessions[session_id] = session
        wb_common._user_active_session[wb_common.DEFAULT_USER_ID] = session_id

        workbench_service.clear_session_for_user()

        conn.close.assert_called_once_with()

    async def test_terminal_cleanup_closes_child_before_parent(self) -> None:
        session_id = "ssh-wire-order"
        registry = SSHSessionRegistry()
        order: list[str] = []
        parent_conn = MagicMock()
        parent_conn.close.side_effect = lambda: order.append("parent")
        child_conn = MagicMock()
        child_conn.close.side_effect = lambda: order.append("child")
        registry.register("parent-1", parent_conn, None, "bastion", None, None, connect_timeout=30)
        registry.register(
            "child-1", child_conn, "parent-1", "node-1", None, None, connect_timeout=30
        )
        wb_common._workbench_sessions[session_id] = _make_run_session(session_id, registry)

        await workbench_service._execute_workflow(
            session_id,
            [_log_node("log-1")],
            [{"source": "start-node", "target": "log-1"}],
            {},
        )

        assert order == ["child", "parent"]

    async def test_session_without_registry_terminates_cleanly(self) -> None:
        session_id = "ssh-wire-none"
        session = _make_run_session(session_id, SSHSessionRegistry())
        del session["ssh_session_registry"]
        wb_common._workbench_sessions[session_id] = session

        await workbench_service._execute_workflow(
            session_id,
            [_log_node("log-1")],
            [{"source": "start-node", "target": "log-1"}],
            {},
        )

        assert wb_common._workbench_sessions[session_id]["status"] == "passed"
