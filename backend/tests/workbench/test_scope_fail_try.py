"""A Try/Catch never catches or clears a Fail Current Scope mark (REQ-3.2.2.6).

A split-mode Assert with Fail Current Scope inside a try path marks the Test failed and its flow
goes on; the catch path never runs for it, whatever is wired, and the mark survives the
Try/Catch. A single-mode one fails as a block, so the Try/Catch catches it like any failure.
"""

from typing import Any

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


def _make_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "Try Scope Fail Test",
        "scope_failed": False,
    }


def _make_node(
    node_id: str,
    label: str = "Block",
    element_type: str = "delay",
    node_type: str = "control",
    config_values: dict[str, Any] | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    config: dict[str, Any] = {"values": config_values or {"duration": 10}}
    config["outputBindings"] = {}
    config["profileBindings"] = []
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


def _make_try_catch_node(
    node_id: str = "tc-1",
    *,
    enable_catch: bool = True,
    enable_finally: bool = False,
) -> dict[str, Any]:
    return _make_node(
        node_id,
        label="Try/Catch",
        element_type="try-catch-finally",
        node_type="control",
        config_values={"enable_catch": enable_catch, "enable_finally": enable_finally},
        description="Try/Catch",
    )


def _make_scope_fail_assert(node_id: str = "inner-assert", mode: str = "split") -> dict[str, Any]:
    return _make_node(
        node_id,
        label="Assert",
        element_type="assert",
        node_type="control",
        config_values={
            "assertions": [{"type": "expression", "expression": "False"}],
            "mode": mode,
            "fail_current_scope": True,
        },
        description="Assert in try-body",
    )


@pytest.fixture(autouse=True)
def _engine_registries() -> Any:
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    clear_registry()
    _registry.clear()


async def _run(session_id: str, nodes: list[Any], edges: list[Any]) -> dict[str, Any]:
    _wb_common._workbench_sessions[session_id] = _make_session(session_id)
    await workbench_service._execute_workflow(session_id, nodes, edges, {})
    return _wb_common._workbench_sessions[session_id]


class TestACatchWiredTryLeavesTheMark:
    """A wired catch path is not a handler for a mark."""

    async def _run_graph(self, session_id: str) -> dict[str, Any]:
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True),
            _make_scope_fail_assert(),
            _make_log_node("catch-log", "Catch Log", "'catch-ran'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "inner-assert", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]
        return await _run(session_id, nodes, edges)

    async def test_the_catch_branch_never_runs(self) -> None:
        session = await self._run_graph("tc-scope-catch-1")

        assert session["block_states"].get("catch-log") in ("skipped", None)

    async def test_the_flag_survives(self) -> None:
        session = await self._run_graph("tc-scope-catch-2")

        assert session["scope_failed"] is True

    async def test_the_run_ends_failed_after_the_then_egress(self) -> None:
        session = await self._run_graph("tc-scope-catch-3")

        assert session["block_states"]["after-log"] == "passed"
        assert session["status"] == "failed"


class TestBareTryDoesNotAbsorb:
    """No catch wired: the try body's mark belongs to the enclosing scope."""

    async def _run_graph(self, session_id: str) -> dict[str, Any]:
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True),
            _make_scope_fail_assert(),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "inner-assert", "sourceHandle": "try"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]
        return await _run(session_id, nodes, edges)

    async def test_the_flag_survives(self) -> None:
        session = await self._run_graph("tc-scope-bare-1")

        assert session["scope_failed"] is True

    async def test_the_run_ends_failed(self) -> None:
        session = await self._run_graph("tc-scope-bare-2")

        assert session["status"] == "failed"

    async def test_the_then_egress_still_runs(self) -> None:
        session = await self._run_graph("tc-scope-bare-3")

        assert session["block_states"]["after-log"] == "passed"


class TestFinallyOnlyTryDoesNotAbsorb:
    """A finally path is not a handler; it cannot consume a mark."""

    async def _run_graph(self, session_id: str) -> dict[str, Any]:
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _make_scope_fail_assert(),
            _make_log_node("fin-log", "Finally Log", "'finally-ran'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "inner-assert", "sourceHandle": "try"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]
        return await _run(session_id, nodes, edges)

    async def test_the_flag_survives(self) -> None:
        session = await self._run_graph("tc-scope-fin-1")

        assert session["scope_failed"] is True

    async def test_the_finally_path_still_runs(self) -> None:
        session = await self._run_graph("tc-scope-fin-2")

        assert session["block_states"]["fin-log"] == "passed"

    async def test_the_run_ends_failed(self) -> None:
        session = await self._run_graph("tc-scope-fin-3")

        assert session["status"] == "failed"


class TestDisabledCatchDoesNotAbsorb:
    """A catch branch switched off is the same as no catch at all."""

    async def _run_graph(self, session_id: str) -> dict[str, Any]:
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=False),
            _make_scope_fail_assert(),
            _make_log_node("catch-log", "Catch Log", "'catch-ran'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "inner-assert", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]
        return await _run(session_id, nodes, edges)

    async def test_the_flag_survives(self) -> None:
        session = await self._run_graph("tc-scope-off-1")

        assert session["scope_failed"] is True

    async def test_the_catch_branch_never_runs(self) -> None:
        session = await self._run_graph("tc-scope-off-2")

        assert session["block_states"].get("catch-log") in ("skipped", None)

    async def test_the_run_ends_failed(self) -> None:
        session = await self._run_graph("tc-scope-off-3")

        assert session["status"] == "failed"


class TestASingleModeAssertIsCaughtAsABlockFailure:
    """A single-mode Assert with Fail Current Scope fails its block; the Try/Catch catches it."""

    async def test_the_catch_branch_runs_and_the_run_passes(self) -> None:
        nodes = [
            _make_try_catch_node("tc-1", enable_catch=True),
            _make_scope_fail_assert(mode="single"),
            _make_log_node("try-after", "Try After", "'try-after'"),
            _make_log_node("catch-log", "Catch Log", "'catch-ran'"),
            _make_log_node("after-log", "After Log", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "inner-assert", "sourceHandle": "try"},
            {"source": "inner-assert", "target": "try-after"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run("tc-scope-single-1", nodes, edges)

        assert session["block_states"]["inner-assert"] == "failed"
        assert session["block_states"].get("try-after") in ("skipped", None)
        assert session["block_states"]["catch-log"] == "passed"
        assert session["block_states"]["after-log"] == "passed"
        assert session["scope_failed"] is False
        assert session["status"] == "passed"


class TestPreExistingScopeFailIsNeverCleared:
    """A flag raised before the try is not the try's to reset."""

    async def test_flag_raised_before_the_try_survives_a_catch_wired_try(self) -> None:
        nodes = [
            _make_scope_fail_assert("outer-assert"),
            _make_try_catch_node("tc-1", enable_catch=True),
            _make_log_node("try-log", "Try Log", "'try'"),
            _make_log_node("catch-log", "Catch Log", "'catch-ran'"),
        ]
        edges = [
            {"source": "start-node", "target": "outer-assert"},
            {"source": "outer-assert", "target": "tc-1", "sourceHandle": "fail"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
        ]

        session = await _run("tc-scope-pre-1", nodes, edges)

        assert session["block_states"]["try-log"] == "passed"
        assert session["scope_failed"] is True
        assert session["status"] == "failed"
        assert session["block_states"].get("catch-log") in ("skipped", None)
