"""Unit tests for skip-block extended routing (REQ-3.2.2.2).

Skip-at-pause behavior by paused element_type:

    - Diverging parents (``if-else``, ``assert-split``) cannot be skipped at
      runtime. ``skip_current_block`` raises ConflictException with the exact
      message ``^Cannot skip branching block '<element_type>': step into a
      branch and skip a leaf instead$``.
    - Single-post-control-egress parents (``for``, ``for-each``, ``while``,
      ``try-catch-finally``, ``parallel``, ``assert-single``, ``switch``) are
      skipped in place: the paused node is marked skipped, every non-'then'
      descendant is cascaded to ``block_states[...] = 'skipped'``, and the
      engine re-pauses BEFORE the 'then' successor runs.
    - Leaf nodes keep the plain skip behavior.

Exact error messages are asserted with anchored regex.
"""

import asyncio
import re
import uuid
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

_CANNOT_SKIP_BRANCHING_TPL = (
    r"^Cannot skip branching block '{}': step into a branch and skip a leaf instead$"
)


def _make_session(session_id: str, *, breakpoints: set[str] | None = None) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Skip multi-egress Test",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "scope_failed": False,
        "breakpoints": set(breakpoints or set()),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
    }


def _log_node(node_id: str, label: str, message: str = "'ok'") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _if_else_node(node_id: str, label: str = "If/Else") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "if-else",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {
                    "branches": [
                        {
                            "type": "if",
                            "id": "branch_0",
                            "label": "if",
                            "conditions": [
                                {"type": "literal", "left": True, "op": "==", "right": True}
                            ],
                        },
                        {"type": "else", "id": "branch_1", "label": "else", "conditions": []},
                    ]
                },
                "profileBindings": [],
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _switch_node(node_id: str, label: str = "Switch") -> dict[str, Any]:
    """Two condition-guarded cases plus a default; the 'then' egress is wired by the caller."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "switch-case",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {
                    "branches": [
                        {
                            "id": "branch_0",
                            "type": "case",
                            "label": "",
                            "conditions": [{"type": "expression", "expression": "True"}],
                            "break": True,
                        },
                        {
                            "id": "branch_1",
                            "type": "case",
                            "label": "",
                            "conditions": [{"type": "expression", "expression": "True"}],
                            "break": True,
                        },
                        {"id": "branch_2", "type": "default", "label": ""},
                    ]
                },
                "profileBindings": [],
            },
            "disabled": False,
            "description": label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _assert_node(node_id: str, label: str, mode: str = "single") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "assert",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {
                    "mode": mode,
                    "assertions": [{"type": "literal", "left": True, "op": "==", "right": True}],
                },
                "profileBindings": [],
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _for_node(node_id: str, label: str, count: int) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "for",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {"mode": "count", "count": count},
                "profileBindings": [],
                "outputBindings": {"index": "i"},
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _try_catch_node(
    node_id: str, label: str = "Try/Catch", enable_catch: bool = True, enable_finally: bool = True
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "try-catch-finally",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {"enable_catch": enable_catch, "enable_finally": enable_finally},
                "profileBindings": [],
                "outputBindings": {},
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _parallel_node(node_id: str, label: str = "Parallel") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "parallel",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {},
                "profileBindings": [],
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


class TestSkipBlockEndpointDivergingMessage:
    """The skip-block endpoint surfaces the new anchored 409 message verbatim."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture
    def session_id(self) -> str:
        return str(uuid.uuid4())

    def test_409_on_if_else_branching_message(self, client: TestClient, session_id: str) -> None:
        """Skip on if-else returns 409 with exact branching-rejection message."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.skip_current_block"
        ) as mock_skip:
            mock_skip.side_effect = ConflictException(
                "Cannot skip branching block 'if-else': step into a branch and skip a leaf instead"
            )

            response = client.post(f"/workbench/{session_id}/skip-block")

            assert response.status_code == 409
            body = response.json()
            assert re.match(_CANNOT_SKIP_BRANCHING_TPL.format("if-else"), body["error"]["message"])

    def test_409_on_assert_split_branching_message(
        self, client: TestClient, session_id: str
    ) -> None:
        """Skip on assert-split returns 409 with exact branching-rejection message."""
        with patch(
            "wavecore.api.routes.workbench.workbench_service.skip_current_block"
        ) as mock_skip:
            mock_skip.side_effect = ConflictException(
                "Cannot skip branching block 'assert-split': step into a branch and skip a leaf"
                " instead"
            )

            response = client.post(f"/workbench/{session_id}/skip-block")

            assert response.status_code == 409
            body = response.json()
            assert re.match(
                _CANNOT_SKIP_BRANCHING_TPL.format("assert-split"), body["error"]["message"]
            )


class TestSkipBlockServiceDivergingRejection:
    """Service rejects diverging parents with exact anchored message."""

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
    async def test_skip_on_if_else_raises_conflict_with_exact_message(self) -> None:
        """Skipping a paused If-Else raises ConflictException with exact anchored text."""
        session_id = "skip-if-else"
        session = _make_session(session_id, breakpoints={"if-1"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _if_else_node("if-1"),
            _log_node("then-log", "Then", "'then'"),
            _log_node("else-log", "Else", "'else'"),
            _log_node("after-log", "After", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "if-1"},
            {"source": "if-1", "target": "then-log", "sourceHandle": "branch_0"},
            {"source": "if-1", "target": "else-log", "sourceHandle": "branch_1"},
            {"source": "if-1", "target": "after-log", "sourceHandle": "then"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "if-1":
                break

        with pytest.raises(ConflictException) as exc_info:
            workbench_service.skip_current_block(session_id=session_id)

        assert re.match(
            _CANNOT_SKIP_BRANCHING_TPL.format("if-else"), str(exc_info.value)
        ), f"Expected anchored branching message for 'if-else', got: {exc_info.value}"

        # Unblock so the task can finish cleanly.
        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_skip_on_assert_split_raises_conflict_with_exact_message(self) -> None:
        """Skipping a paused Assert-Split raises ConflictException with exact text."""
        session_id = "skip-assert-split"
        session = _make_session(session_id, breakpoints={"as-1"})
        session["status"] = "paused"
        session["paused_node_id"] = "as-1"
        session["block_states"] = {"as-1": "running"}
        _wb_common._workbench_sessions[session_id] = session

        session["_debug_node_records"] = {
            "as-1": {
                "id": "as-1",
                "type": "workflowNode",
                "data": {
                    "elementType": "assert",
                    "nodeType": "control",
                    "config": {"values": {"mode": "split"}},
                },
            }
        }

        with pytest.raises(ConflictException) as exc_info:
            workbench_service.skip_current_block(session_id=session_id)

        assert re.match(
            _CANNOT_SKIP_BRANCHING_TPL.format("assert-split"), str(exc_info.value)
        ), f"Expected anchored branching message for 'assert-split', got: {exc_info.value}"


class TestSkipBlockSwitchContainer:
    """Switch is a container, not a diverging parent: Skip-while-paused works."""

    @pytest.fixture(autouse=True)
    def clear_sessions(self) -> Any:
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @staticmethod
    def _seed_paused_switch(session_id: str) -> dict[str, Any]:
        """Session paused on a Switch wired to two cases, a default and 'then'."""
        session = _make_session(session_id)
        session["status"] = "paused"
        session["paused_node_id"] = "sw-1"
        session["block_states"] = {"sw-1": "running"}
        session["_debug_node_records"] = {"sw-1": _switch_node("sw-1")}
        session["_adj"] = {
            "sw-1": [
                ("case-a", "branch_0"),
                ("case-b", "branch_1"),
                ("default-log", "branch_2"),
                ("after-log", "then"),
            ],
            "case-a": [],
            "case-b": [],
            "default-log": [],
            "after-log": [],
        }
        _wb_common._workbench_sessions[session_id] = session
        return session

    def test_skip_on_a_paused_switch_does_not_raise_conflict(self) -> None:
        """Skipping a paused Switch returns the skipped payload instead of a 409."""
        # Guard: Switch is a container, so Skip-while-paused must never be refused.
        session_id = "skip-switch"
        session = self._seed_paused_switch(session_id)

        try:
            result = workbench_service.skip_current_block(session_id=session_id)
        except ConflictException as exc:  # pragma: no cover - failure path
            pytest.fail(f"skip raised a conflict for a Switch node: {exc}")

        assert result == {
            "session_id": session_id,
            "status": "paused",
            "skipped_node_id": "sw-1",
        }
        assert session["block_states"]["sw-1"] == "skipped"
        assert session["pause_at_next_node"] is True

    def test_skip_on_a_paused_switch_cascades_cases_and_default(self) -> None:
        """Every case and the default are muted; the 'then' successor is spared."""
        session_id = "skip-switch-cascade"
        session = self._seed_paused_switch(session_id)

        workbench_service.skip_current_block(session_id=session_id)

        skipped = set(session["skipped_node_ids"])
        assert {"case-a", "case-b", "default-log"} <= skipped
        assert "after-log" not in skipped
        for nid in ("case-a", "case-b", "default-log"):
            assert session["block_states"][nid] == "skipped"

    def test_endpoint_returns_200_for_a_paused_switch(self) -> None:
        """POST /skip-block on a paused Switch surfaces the skipped payload, not a 409."""
        from wavecore.api.app import app

        session_id = str(uuid.uuid4())
        self._seed_paused_switch(session_id)

        response = TestClient(app).post(f"/workbench/{session_id}/skip-block")

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"] == {
            "session_id": session_id,
            "status": "paused",
            "skipped_node_id": "sw-1",
        }


class TestSkipBlockSingleEgressCascade:
    """Single-egress parents: cascade skip and pause on 'then' successor."""

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
    async def test_skip_for_loop_marks_body_skipped_and_pauses_on_then(self) -> None:
        """For-loop skip cascades to body, re-pauses on 'then' successor."""
        session_id = "skip-for"
        session = _make_session(session_id, breakpoints={"for-1"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _for_node("for-1", "Loop", count=3),
            _log_node("body-log", "Body", "'iter'"),
            _log_node("after-log", "After", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "for-1"},
            {"source": "for-1", "target": "body-log", "sourceHandle": "body"},
            {"source": "for-1", "target": "after-log", "sourceHandle": "then"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {"i": None})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "for-1":
                break
        assert session["paused_node_id"] == "for-1"

        workbench_service.skip_current_block(session_id=session_id)

        for _ in range(400):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "after-log":
                break

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "after-log"
        assert session["block_states"]["for-1"] == "skipped"
        assert (
            session["block_states"].get("body-log") == "skipped"
        ), "for-loop body must be cascaded to skipped"
        assert session["block_states"].get("after-log") != "passed"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
        assert session["status"] == "passed"
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_skip_try_catch_marks_try_catch_finally_skipped_and_pauses_on_then(self) -> None:
        """Try-catch skip cascades to try/catch/finally, re-pauses on 'then'."""
        session_id = "skip-tc"
        session = _make_session(session_id, breakpoints={"tc-1"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _try_catch_node("tc-1", enable_catch=True, enable_finally=True),
            _log_node("try-log", "Try", "'try'"),
            _log_node("catch-log", "Catch", "'catch'"),
            _log_node("fin-log", "Finally", "'finally'"),
            _log_node("after-log", "After", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "try-log", "sourceHandle": "try"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
            {"source": "tc-1", "target": "after-log", "sourceHandle": "then"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "tc-1":
                break
        assert session["paused_node_id"] == "tc-1"

        workbench_service.skip_current_block(session_id=session_id)

        for _ in range(400):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "after-log":
                break

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "after-log"
        assert session["block_states"]["tc-1"] == "skipped"
        assert session["block_states"].get("try-log") == "skipped"
        assert session["block_states"].get("catch-log") == "skipped"
        assert session["block_states"].get("fin-log") == "skipped"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
        assert session["block_states"]["after-log"] == "passed"

    @pytest.mark.asyncio
    async def test_skip_parallel_marks_branches_skipped_and_pauses_on_then(self) -> None:
        """Parallel skip cascades to all branches, re-pauses on 'then'."""
        session_id = "skip-parallel"
        session = _make_session(session_id, breakpoints={"par-1"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _parallel_node("par-1"),
            _log_node("br-a", "Branch A", "'a'"),
            _log_node("br-b", "Branch B", "'b'"),
            _log_node("after-log", "After", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "par-1"},
            {"source": "par-1", "target": "br-a", "sourceHandle": "branch_0"},
            {"source": "par-1", "target": "br-b", "sourceHandle": "branch_1"},
            {"source": "par-1", "target": "after-log", "sourceHandle": "then"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "par-1":
                break
        assert session["paused_node_id"] == "par-1"

        workbench_service.skip_current_block(session_id=session_id)

        for _ in range(400):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "after-log":
                break

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "after-log"
        assert session["block_states"]["par-1"] == "skipped"
        assert session["block_states"].get("br-a") == "skipped"
        assert session["block_states"].get("br-b") == "skipped"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_skip_assert_single_pauses_on_then(self) -> None:
        """Assert-single (non-branching assert) skip pauses on the 'then' successor."""
        session_id = "skip-assert-single"
        session = _make_session(session_id, breakpoints={"as-1"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _assert_node("as-1", "Assert", mode="single"),
            _log_node("after-log", "After", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "as-1"},
            {"source": "as-1", "target": "after-log", "sourceHandle": "then"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "as-1":
                break
        assert session["paused_node_id"] == "as-1"

        workbench_service.skip_current_block(session_id=session_id)

        for _ in range(400):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "after-log":
                break

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "after-log"
        assert session["block_states"]["as-1"] == "skipped"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_skip_switch_marks_cases_and_default_skipped_and_pauses_on_then(self) -> None:
        """Switch skip mutes every case body and the default, re-pauses on 'then'."""
        session_id = "skip-switch-engine"
        session = _make_session(session_id, breakpoints={"sw-1"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _switch_node("sw-1"),
            _log_node("case-a", "Case A", "'a'"),
            _log_node("case-b", "Case B", "'b'"),
            _log_node("default-log", "Default", "'default'"),
            _log_node("after-log", "After", "'done'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "default-log", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "sw-1":
                break
        assert session["paused_node_id"] == "sw-1"

        workbench_service.skip_current_block(session_id=session_id)

        for _ in range(400):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "after-log":
                break

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "after-log"
        assert session["block_states"]["sw-1"] == "skipped"
        assert (
            session["block_states"].get("case-a") == "skipped"
        ), "every case body must be cascaded to skipped"
        assert session["block_states"].get("case-b") == "skipped"
        assert session["block_states"].get("default-log") == "skipped"
        assert session["block_states"].get("after-log") != "passed"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
        assert session["block_states"]["after-log"] == "passed"


class TestSkipBlockLeafRegression:
    """Leaf skip (no control children) keeps the plain skip behavior."""

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
    async def test_skip_leaf_keeps_existing_behavior(self) -> None:
        """Leaf plugin skip still marks the node skipped and re-pauses on next sibling."""
        session_id = "skip-leaf"
        session = _make_session(session_id, breakpoints={"node-b", "node-c"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "A", "'a'"),
            _log_node("node-b", "B", "'b'"),
            _log_node("node-c", "C", "'c'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
            {"source": "node-b", "target": "node-c"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "node-b":
                break
        assert session["paused_node_id"] == "node-b"

        result = workbench_service.skip_current_block(session_id=session_id)
        assert result["status"] == "paused"
        assert result["skipped_node_id"] == "node-b"

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "node-c":
                break

        assert session["paused_node_id"] == "node-c"
        assert session["block_states"]["node-b"] == "skipped"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)


class TestCascadeSkipUnitDirect:
    """Direct unit coverage for ``_cascade_skip_under_parent`` walk branches."""

    def setup_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def teardown_method(self) -> None:
        _wb_common._clear_sessions_sync()

    def test_cascade_walks_grandchildren_and_dedupes_visited(self) -> None:
        """Cascade transitively skips body grandchildren and dedupes shared descendants."""
        session: dict[str, Any] = {
            "session_id": "cascade-deep",
            "status": "paused",
            "block_states": {},
            "skipped_node_ids": [],
            "pause_event": asyncio.Event(),
            "paused_node_id": "for-1",
            "_node_map": {
                "for-1": {
                    "id": "for-1",
                    "type": "workflowNode",
                    "data": {"elementType": "for", "nodeType": "control"},
                },
            },
            "_adj": {
                "for-1": [("body-1", "body"), ("after-1", "then")],
                # body-1 fans out to two body children which both reach a shared grandchild.
                "body-1": [("body-2", None), ("body-3", None)],
                "body-2": [("body-grandchild", None)],
                "body-3": [("body-grandchild", None)],
                "body-grandchild": [],
                "after-1": [],
            },
        }
        _wb_common._workbench_sessions["cascade-deep"] = session

        workbench_service.skip_current_block(session_id="cascade-deep")

        skipped = set(session["skipped_node_ids"])
        assert {"for-1", "body-1", "body-2", "body-3", "body-grandchild"} <= skipped
        # The 'then' egress MUST NOT be cascaded.
        assert "after-1" not in skipped
        for nid in ("body-1", "body-2", "body-3", "body-grandchild"):
            assert session["block_states"][nid] == "skipped"
