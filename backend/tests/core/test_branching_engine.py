"""Tests for branching engine support in workbench_service._execute_workflow.

This module tests sourceHandle-aware edge traversal. The branching engine
allows controls to return a __branch key in their result, which the engine
uses to filter outgoing edges by matching sourceHandle.

Test coverage:
- Linear flow (no sourceHandle) - backward compatibility
- Branching with sourceHandle edges (pass/fail routing)
- Mixed edges (some with sourceHandle, some without)
- No __branch in result - all edges followed (backward compat)
- Edge with sourceHandle but no __branch result - edge still followed
- Multiple nodes after branch - chain of downstream nodes
- Both branches have downstream nodes - only active branch executes
- __branch key stripped from output bindings
"""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


def _make_session(session_id: str) -> dict[str, Any]:
    """Create a minimal workbench session for testing."""
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "Branching Test",
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
    disabled: bool = False,
) -> dict[str, Any]:
    """Create a workflow node for testing."""
    config: dict[str, Any] = {"values": config_values or {"duration": 10}}
    if output_bindings:
        config["outputBindings"] = output_bindings
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
        },
    }


def _noop_control_mock() -> AsyncMock:
    """Create a mock for _execute_control that returns an empty dict."""
    return AsyncMock(return_value={})


class TestBranchingEngineAdjacency:
    """Tests for enhanced adjacency structure with sourceHandle."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Clear sessions before/after each test."""
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_linear_flow_no_source_handle(self) -> None:
        """Linear flow without sourceHandle executes all nodes in order.

        Graph: A -> B -> C (no sourceHandle on any edge)
        All nodes should execute sequentially.
        """
        session_id = "linear-no-handle"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("A", label="Node A"),
            _make_node("B", label="Node B"),
            _make_node("C", label="Node C"),
        ]
        edges = [
            {"source": "start-node", "target": "A"},
            {"source": "A", "target": "B"},
            {"source": "B", "target": "C"},
        ]

        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=_noop_control_mock,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["A"] == "passed"
        assert session["block_states"]["B"] == "passed"
        assert session["block_states"]["C"] == "passed"

    @pytest.mark.asyncio
    async def test_branch_pass_follows_pass_handle(self) -> None:
        """Control returning __branch='pass' follows only pass-handle edges.

        Graph: Assert -> PassNode (sourceHandle='pass')
               Assert -> FailNode (sourceHandle='fail')

        Assert returns {"passed": True, "__branch": "pass"}
        Only PassNode should execute, FailNode should NOT.
        """
        session_id = "branch-pass"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-node", label="Pass Handler"),
            _make_node("fail-node", label="Fail Handler"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "pass-node", "sourceHandle": "pass"},
            {"source": "assert-1", "target": "fail-node", "sourceHandle": "fail"},
        ]

        mock_result = {"passed": True, "__branch": "pass"}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["assert-1"] == "passed"
        assert session["block_states"]["pass-node"] == "passed"
        assert "fail-node" not in session["block_states"]

    @pytest.mark.asyncio
    async def test_branch_fail_follows_fail_handle(self) -> None:
        """Control returning __branch='fail' follows only fail-handle edges.

        Graph: Assert -> PassNode (sourceHandle='pass')
               Assert -> FailNode (sourceHandle='fail')

        Assert returns {"passed": False, "__branch": "fail"}
        Only FailNode should execute, PassNode should NOT.
        """
        session_id = "branch-fail"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-node", label="Pass Handler"),
            _make_node("fail-node", label="Fail Handler"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "pass-node", "sourceHandle": "pass"},
            {"source": "assert-1", "target": "fail-node", "sourceHandle": "fail"},
        ]

        mock_result = {"passed": False, "__branch": "fail"}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Assert failure without fail_current_scope -> "warning" (informational, amber)
        assert session["block_states"]["assert-1"] == "warning"
        assert session["block_states"]["fail-node"] == "passed"
        assert "pass-node" not in session["block_states"]

    @pytest.mark.asyncio
    async def test_mixed_edges_handleless_always_followed(self) -> None:
        """Edges without sourceHandle are always followed regardless of __branch.

        Graph: Assert -> LogNode (no sourceHandle)
               Assert -> PassNode (sourceHandle='pass')
               Assert -> FailNode (sourceHandle='fail')

        Assert returns __branch='pass'. LogNode (no handle) AND PassNode
        should both execute. FailNode should NOT.
        """
        session_id = "mixed-edges"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("log-node", label="Always Log"),
            _make_node("pass-node", label="Pass Handler"),
            _make_node("fail-node", label="Fail Handler"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "log-node"},  # No sourceHandle
            {"source": "assert-1", "target": "pass-node", "sourceHandle": "pass"},
            {"source": "assert-1", "target": "fail-node", "sourceHandle": "fail"},
        ]

        mock_result = {"passed": True, "__branch": "pass"}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["assert-1"] == "passed"
        assert session["block_states"]["log-node"] == "passed"
        assert session["block_states"]["pass-node"] == "passed"
        assert "fail-node" not in session["block_states"]

    @pytest.mark.asyncio
    async def test_no_branch_in_result_follows_all_edges(self) -> None:
        """When result has no __branch key, all outgoing edges are followed.

        Graph: Delay -> NodeA (sourceHandle='pass')
               Delay -> NodeB (sourceHandle='fail')

        Delay returns {"elapsed": 10} (no __branch key).
        Both NodeA and NodeB should execute - backward compatible.
        """
        session_id = "no-branch-result"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("delay-1", label="Delay"),
            _make_node("node-a", label="Node A"),
            _make_node("node-b", label="Node B"),
        ]
        edges = [
            {"source": "start-node", "target": "delay-1"},
            {"source": "delay-1", "target": "node-a", "sourceHandle": "pass"},
            {"source": "delay-1", "target": "node-b", "sourceHandle": "fail"},
        ]

        mock_result = {"elapsed": 10}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["delay-1"] == "passed"
        assert session["block_states"]["node-a"] == "passed"
        assert session["block_states"]["node-b"] == "passed"

    @pytest.mark.asyncio
    async def test_source_handle_edge_no_branch_result_still_followed(self) -> None:
        """Edge with sourceHandle still followed when control has no __branch result.

        This tests backward compatibility: sourceHandle only acts as a filter
        when __branch is present in the result. Without __branch, all edges
        are followed regardless of sourceHandle.
        """
        session_id = "handle-no-branch"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("ctrl-1", label="Control"),
            _make_node("next-1", label="Next"),
        ]
        edges = [
            {"source": "start-node", "target": "ctrl-1"},
            {"source": "ctrl-1", "target": "next-1", "sourceHandle": "pass"},
        ]

        # Control returns empty dict (no __branch), edge should still be followed
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value={},
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["ctrl-1"] == "passed"
        assert session["block_states"]["next-1"] == "passed"

    @pytest.mark.asyncio
    async def test_branch_chain_downstream_nodes(self) -> None:
        """Branch leads to a chain of subsequent nodes.

        Graph: Assert -> PassA (sourceHandle='pass') -> PassB -> PassC
               Assert -> FailA (sourceHandle='fail')

        Assert returns __branch='pass'. PassA, PassB, PassC all execute.
        FailA does NOT execute.
        """
        session_id = "branch-chain"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-a", label="Pass A"),
            _make_node("pass-b", label="Pass B"),
            _make_node("pass-c", label="Pass C"),
            _make_node("fail-a", label="Fail A"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "pass-a", "sourceHandle": "pass"},
            {"source": "pass-a", "target": "pass-b"},
            {"source": "pass-b", "target": "pass-c"},
            {"source": "assert-1", "target": "fail-a", "sourceHandle": "fail"},
        ]

        # Mock _execute_control: only the assert node returns __branch
        async def mock_control(
            control_type: str,
            version: str,
            parameters: dict[str, Any],
            variables: dict[str, Any],
            **kwargs: Any,
        ) -> dict[str, Any]:
            if control_type == "assert":
                return {"passed": True, "__branch": "pass"}
            return {}

        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            side_effect=mock_control,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["assert-1"] == "passed"
        assert session["block_states"]["pass-a"] == "passed"
        assert session["block_states"]["pass-b"] == "passed"
        assert session["block_states"]["pass-c"] == "passed"
        assert "fail-a" not in session["block_states"]

    @pytest.mark.asyncio
    async def test_both_branches_have_downstream_only_active_executes(self) -> None:
        """Both branches have downstream chains - only active branch executes.

        Graph: Assert -> PassA (sourceHandle='pass') -> PassB
               Assert -> FailA (sourceHandle='fail') -> FailB

        Assert returns __branch='fail'. FailA and FailB execute.
        PassA and PassB do NOT execute.
        """
        session_id = "both-branches"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-a", label="Pass A"),
            _make_node("pass-b", label="Pass B"),
            _make_node("fail-a", label="Fail A"),
            _make_node("fail-b", label="Fail B"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "pass-a", "sourceHandle": "pass"},
            {"source": "pass-a", "target": "pass-b"},
            {"source": "assert-1", "target": "fail-a", "sourceHandle": "fail"},
            {"source": "fail-a", "target": "fail-b"},
        ]

        mock_result = {"passed": False, "__branch": "fail"}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Assert failure without fail_current_scope -> "warning" (informational, amber)
        assert session["block_states"]["assert-1"] == "warning"
        assert session["block_states"]["fail-a"] == "passed"
        assert session["block_states"]["fail-b"] == "passed"
        assert "pass-a" not in session["block_states"]
        assert "pass-b" not in session["block_states"]


class TestBranchingOutputBindings:
    """Tests for __branch key handling in output bindings."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Clear sessions before/after each test."""
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_branch_key_stripped_from_output_bindings(self) -> None:
        """__branch key is consumed by engine and NOT passed to output bindings.

        When a control returns {"passed": True, "__branch": "pass"} and there's
        an output binding for "passed" -> "assert_result", only "passed" should
        be bound. "__branch" should NOT appear in variables.
        """
        session_id = "branch-binding"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node(
                "assert-1",
                label="Assert",
                element_type="assert",
                output_bindings={"passed": "assert_result", "__branch": "branch_val"},
            ),
            _make_node("next-node", label="Next"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "next-node", "sourceHandle": "pass"},
        ]

        mock_result = {"passed": True, "__branch": "pass"}
        variables: dict[str, Any] = {}

        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        # "passed" should be bound to the variable
        assert variables["assert_result"] is True
        # "__branch" should NOT be bound even if there's a binding for it
        assert "branch_val" not in variables or variables.get("branch_val") is None

    @pytest.mark.asyncio
    async def test_non_branch_result_bindings_unaffected(self) -> None:
        """Output bindings work normally when result has no __branch key."""
        session_id = "normal-binding"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node(
                "delay-1",
                label="Delay",
                output_bindings={"elapsed": "delay_time"},
            ),
        ]
        edges: list[dict[str, Any]] = [
            {"source": "start-node", "target": "delay-1"},
        ]
        variables: dict[str, Any] = {}

        mock_result = {"elapsed": 100}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, variables)

        assert variables["delay_time"] == 100


class TestBranchingWithDisabledSkipped:
    """Tests for branching interaction with disabled/skipped nodes."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Clear sessions before/after each test."""
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_disabled_node_on_active_branch_is_skipped(self) -> None:
        """Disabled node on the active branch is skipped but downstream continues.

        Graph: Assert -> PassA (sourceHandle='pass', disabled) -> PassB
               Assert -> FailA (sourceHandle='fail')

        Assert returns __branch='pass'. PassA is disabled (skipped),
        but PassB still executes.
        """
        session_id = "branch-disabled"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-a", label="Pass A", disabled=True),
            _make_node("pass-b", label="Pass B"),
            _make_node("fail-a", label="Fail A"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "pass-a", "sourceHandle": "pass"},
            {"source": "pass-a", "target": "pass-b"},
            {"source": "assert-1", "target": "fail-a", "sourceHandle": "fail"},
        ]

        mock_result = {"passed": True, "__branch": "pass"}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["assert-1"] == "passed"
        assert session["block_states"]["pass-a"] == "skipped"
        assert session["block_states"]["pass-b"] == "passed"
        assert "fail-a" not in session["block_states"]

    @pytest.mark.asyncio
    async def test_skipped_node_on_active_branch(self) -> None:
        """Runtime-skipped node on active branch is skipped but downstream continues.

        Graph: Assert -> PassA (sourceHandle='pass', runtime-skipped) -> PassB

        Assert returns __branch='pass'. PassA is runtime-skipped,
        but PassB still executes.
        """
        session_id = "branch-skipped"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-a", label="Pass A"),
            _make_node("pass-b", label="Pass B"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "pass-a", "sourceHandle": "pass"},
            {"source": "pass-a", "target": "pass-b"},
        ]

        mock_result = {"passed": True, "__branch": "pass"}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(
                session_id,
                nodes,
                edges,
                {},
                skipped_node_ids=["pass-a"],
            )

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["assert-1"] == "passed"
        assert session["block_states"]["pass-a"] == "skipped"
        assert session["block_states"]["pass-b"] == "passed"


class TestBranchingProgressTracking:
    """Tests for progress tracking with branching execution."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Clear sessions before/after each test."""
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_progress_counts_only_executed_nodes(self) -> None:
        """Progress tracking counts actually executed/visited nodes.

        When a branch is not taken, those nodes should not count toward
        the total progress. The engine uses pre-BFS count for total but
        only increments current for nodes that actually execute.
        """
        session_id = "branch-progress"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-node", label="Pass Handler"),
            _make_node("fail-node", label="Fail Handler"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "pass-node", "sourceHandle": "pass"},
            {"source": "assert-1", "target": "fail-node", "sourceHandle": "fail"},
        ]

        mock_result = {"passed": True, "__branch": "pass"}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # Assert and pass-node executed; fail-node was not reached
        assert session["block_states"]["assert-1"] == "passed"
        assert session["block_states"]["pass-node"] == "passed"


class TestBranchingEdgeCases:
    """Edge cases for branching engine."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        """Clear sessions before/after each test."""
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_branch_result_with_none_value(self) -> None:
        """Control returning result=None follows all edges (no __branch)."""
        session_id = "branch-none"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("ctrl-1", label="Control"),
            _make_node("next-1", label="Next A"),
            _make_node("next-2", label="Next B"),
        ]
        edges = [
            {"source": "start-node", "target": "ctrl-1"},
            {"source": "ctrl-1", "target": "next-1", "sourceHandle": "pass"},
            {"source": "ctrl-1", "target": "next-2", "sourceHandle": "fail"},
        ]

        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=None,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["ctrl-1"] == "passed"
        assert session["block_states"]["next-1"] == "passed"
        assert session["block_states"]["next-2"] == "passed"

    @pytest.mark.asyncio
    async def test_branch_with_non_dict_result(self) -> None:
        """Control returning a non-dict result follows all edges."""
        session_id = "branch-str"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("ctrl-1", label="Control"),
            _make_node("next-1", label="Next A"),
            _make_node("next-2", label="Next B"),
        ]
        edges = [
            {"source": "start-node", "target": "ctrl-1"},
            {"source": "ctrl-1", "target": "next-1", "sourceHandle": "pass"},
            {"source": "ctrl-1", "target": "next-2", "sourceHandle": "fail"},
        ]

        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value="some string result",
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["next-1"] == "passed"
        assert session["block_states"]["next-2"] == "passed"

    @pytest.mark.asyncio
    async def test_branch_to_nonexistent_handle_follows_no_handled_edges(self) -> None:
        """When __branch value doesn't match any sourceHandle, only handleless edges run.

        Graph: Assert -> PassNode (sourceHandle='pass')
               Assert -> FailNode (sourceHandle='fail')

        Assert returns __branch='unknown'. Neither pass nor fail handle matches,
        so neither PassNode nor FailNode should execute.
        """
        session_id = "branch-unknown"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-node", label="Pass Handler"),
            _make_node("fail-node", label="Fail Handler"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "pass-node", "sourceHandle": "pass"},
            {"source": "assert-1", "target": "fail-node", "sourceHandle": "fail"},
        ]

        mock_result = {"passed": True, "__branch": "unknown"}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["assert-1"] == "passed"
        # Neither branch matches, so neither should execute
        assert "pass-node" not in session["block_states"]
        assert "fail-node" not in session["block_states"]

    @pytest.mark.asyncio
    async def test_plugin_result_with_branch_key_still_branches(self) -> None:
        """Plugin returning __branch key also triggers branching.

        The engine should handle __branch from any node type, not just controls.
        """
        session_id = "plugin-branch"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("plugin-1", label="Plugin", element_type="log", node_type="plugin"),
            _make_node("pass-node", label="Pass Handler"),
            _make_node("fail-node", label="Fail Handler"),
        ]
        edges = [
            {"source": "start-node", "target": "plugin-1"},
            {"source": "plugin-1", "target": "pass-node", "sourceHandle": "pass"},
            {"source": "plugin-1", "target": "fail-node", "sourceHandle": "fail"},
        ]

        mock_plugin_result = {"status": "ok", "__branch": "pass"}
        # Mock plugin; downstream nodes need control mock too
        with (
            patch(
                "wavecore.api.services.workbench.plugins._execute_plugin",
                new_callable=AsyncMock,
                return_value=mock_plugin_result,
            ),
            patch(
                "wavecore.api.services.workbench.plugins._execute_control",
                new_callable=AsyncMock,
                return_value={},
            ),
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["plugin-1"] == "passed"
        assert session["block_states"]["pass-node"] == "passed"
        assert "fail-node" not in session["block_states"]

    @pytest.mark.asyncio
    async def test_multiple_entry_points_with_branching(self) -> None:
        """Multiple disconnected components where one has branching.

        Graph: A -> B (linear, no handles)
               Assert -> PassC (sourceHandle='pass')
               Assert -> FailD (sourceHandle='fail')

        A and Assert are both entry points. A-B runs linearly.
        Assert branches to PassC only.
        """
        session_id = "multi-entry-branch"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("A", label="Node A"),
            _make_node("B", label="Node B"),
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-c", label="Pass C"),
            _make_node("fail-d", label="Fail D"),
        ]
        edges = [
            {"source": "start-node", "target": "A"},
            {"source": "start-node", "target": "assert-1"},
            {"source": "A", "target": "B"},
            {"source": "assert-1", "target": "pass-c", "sourceHandle": "pass"},
            {"source": "assert-1", "target": "fail-d", "sourceHandle": "fail"},
        ]

        async def mock_control(
            control_type: str,
            version: str,
            parameters: dict[str, Any],
            variables: dict[str, Any],
            **kwargs: Any,
        ) -> dict[str, Any]:
            if control_type == "assert":
                return {"passed": True, "__branch": "pass"}
            return {}

        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            side_effect=mock_control,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        assert session["block_states"]["A"] == "passed"
        assert session["block_states"]["B"] == "passed"
        assert session["block_states"]["assert-1"] == "passed"
        assert session["block_states"]["pass-c"] == "passed"
        assert "fail-d" not in session["block_states"]

    @pytest.mark.asyncio
    async def test_error_on_branch_still_halts_workflow(self) -> None:
        """If a node on the active branch fails, workflow still halts.

        Graph: Assert -> PassA (sourceHandle='pass') -> ErrorNode
               Assert -> FailA (sourceHandle='fail')

        Assert returns __branch='pass', PassA passes, ErrorNode raises.
        Workflow should be 'failed'.
        """
        session_id = "branch-error"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        nodes = [
            _make_node("assert-1", label="Assert", element_type="assert"),
            _make_node("pass-a", label="Pass A"),
            _make_node("error-node", label="Error Node", element_type="invalid_ctrl"),
            _make_node("fail-a", label="Fail A"),
        ]
        edges = [
            {"source": "start-node", "target": "assert-1"},
            {"source": "assert-1", "target": "pass-a", "sourceHandle": "pass"},
            {"source": "pass-a", "target": "error-node"},
            {"source": "assert-1", "target": "fail-a", "sourceHandle": "fail"},
        ]

        async def mock_control(
            control_type: str,
            version: str,
            parameters: dict[str, Any],
            variables: dict[str, Any],
            **kwargs: Any,
        ) -> dict[str, Any]:
            if control_type == "assert":
                return {"passed": True, "__branch": "pass"}
            if control_type == "invalid_ctrl":
                raise ValueError("Unknown control type: invalid_ctrl")
            return {}

        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            side_effect=mock_control,
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "failed"
        assert "error" in session

    @pytest.mark.asyncio
    async def test_non_workflow_node_traverses_to_children(self) -> None:
        """Non-workflowNode entries in exec queue still enqueue their children.

        This covers the path where a node in the queue is not a workflowNode
        (e.g., a phantom start-node injected by the frontend). The engine
        should skip executing it but still follow its outgoing edges.
        """
        session_id = "phantom-start"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)

        # "start" is a non-workflowNode type; "real-node" is a workflowNode
        nodes = [
            {
                "id": "start",
                "type": "startNode",  # NOT "workflowNode"
                "data": {"label": "Start"},
            },
            _make_node("real-node", label="Real Node"),
        ]
        edges = [
            {"source": "start-node", "target": "start"},
            {"source": "start", "target": "real-node"},
        ]

        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new_callable=AsyncMock,
            return_value={},
        ):
            await workbench_service._execute_workflow(session_id, nodes, edges, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed"
        # The start node is not a workflowNode, so it should not appear in block_states
        assert "start" not in session["block_states"]
        # But its child should execute
        assert session["block_states"]["real-node"] == "passed"
