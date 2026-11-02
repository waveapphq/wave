"""Unit tests for ``_compute_subtree_boundary``.

The boundary helper is a pure function that returns the set of node ids
constituting the structural sub-tree rooted at a given node. It is
consumed at request-validation time (to enforce blocked-node-type
rejection) and at execution time (to prune outgoing edges that leave
the sub-tree).

Boundary semantics:

    - Atomic node (plugin, Delay, Note, Halt, assert-single without
      body): returns ``{node_id}`` only.
    - Composite single-egress (For/While/ForEach/TryCatchFinally/
      Parallel/SwitchCase): returns ``{node_id}`` plus every descendant
      reachable via NON-``then`` outgoing handles, traversing every edge
      from every descendant. The ``then`` handle on the root node is the
      after-egress and is excluded.
    - Branching (IfElse/Assert-split): returns ``{node_id}`` plus the
      union of every branch's descendants (no chosen-branch filtering at
      static-analysis time).

Algorithmic rule under test:

    - From the root, only follow outgoing edges whose ``sourceHandle``
      is non-None and not equal to ``"then"``. This excludes both
      after-egress and plain sequential next-node edges from atomic
      nodes (whose handles are typically ``None``).
    - From any descendant, follow every outgoing edge.
"""

from typing import Any

import pytest

# Adjacency type used throughout: node_id -> list[(target_id, sourceHandle)]
_Adj = dict[str, list[tuple[str, str | None]]]


def _node(node_id: str, *, element_type: str, node_type: str = "control") -> dict[str, Any]:
    """Build a minimal node record used as the value side of node_map."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": element_type,
            "nodeType": node_type,
            "version": "1.0.0",
            "config": {"values": {}},
        },
    }


def _plugin(node_id: str) -> dict[str, Any]:
    return _node(node_id, element_type="log", node_type="plugin")


class TestComputeSubtreeBoundaryAtomic:
    """Atomic nodes return only ``{node_id}``."""

    def test_plugin_with_no_outgoing_edges_returns_only_self(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {}
        node_map = {"a": _plugin("a")}

        assert _compute_subtree_boundary("a", adj, node_map) == {"a"}

    def test_plugin_with_sequential_outgoing_edge_returns_only_self(self) -> None:
        """Plain sequential edges (handle=None) do NOT extend the sub-tree."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {"a": [("b", None)]}
        node_map = {"a": _plugin("a"), "b": _plugin("b")}

        assert _compute_subtree_boundary("a", adj, node_map) == {"a"}

    def test_atomic_node_with_only_then_outgoing_returns_only_self(self) -> None:
        """Single-egress atomic-like control (assert-single, delay) has only a 'then' handle."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {"as-1": [("after", "then")]}
        node_map = {
            "as-1": _node("as-1", element_type="assert"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("as-1", adj, node_map) == {"as-1"}

    def test_delay_control_returns_only_self(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {"d-1": [("after", None)]}
        node_map = {
            "d-1": _node("d-1", element_type="delay"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("d-1", adj, node_map) == {"d-1"}

    def test_function_instance_is_atomic_on_caller_canvas(self) -> None:
        """A Function instance is single-egress on the caller canvas: its body
        is embedded in ``localDefinition`` (not connected via body handles), so
        the only outgoing edge is the sequential next (handle=None). The
        boundary is therefore ``{node_id}`` and the skip/step machinery routes
        past the Function via its lone sibling-after egress (REQ-3.2.1.3)."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {"fn-1": [("after", None)]}
        node_map = {
            "fn-1": _node("fn-1", element_type="function", node_type="function"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("fn-1", adj, node_map) == {"fn-1"}


class TestComputeSubtreeBoundarySingleEgress:
    """Composite single-egress controls (For/While/ForEach/TryCatch/Parallel/SwitchCase)."""

    def test_for_loop_with_single_body_node(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "for-1": [("body-a", "body"), ("after", "then")],
        }
        node_map = {
            "for-1": _node("for-1", element_type="for"),
            "body-a": _plugin("body-a"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("for-1", adj, node_map) == {"for-1", "body-a"}

    def test_for_loop_with_three_body_nodes_in_sequence(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "for-1": [("body-a", "body"), ("after", "then")],
            "body-a": [("body-b", None)],
            "body-b": [("body-c", None)],
        }
        node_map = {
            "for-1": _node("for-1", element_type="for"),
            "body-a": _plugin("body-a"),
            "body-b": _plugin("body-b"),
            "body-c": _plugin("body-c"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("for-1", adj, node_map) == {
            "for-1",
            "body-a",
            "body-b",
            "body-c",
        }

    def test_for_loop_after_egress_node_is_excluded(self) -> None:
        """Sub-tree boundary stops AT the after-egress edge, not past it."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "for-1": [("body-a", "body"), ("after-1", "then")],
            "after-1": [("after-2", None)],
        }
        node_map = {
            "for-1": _node("for-1", element_type="for"),
            "body-a": _plugin("body-a"),
            "after-1": _plugin("after-1"),
            "after-2": _plugin("after-2"),
        }

        result = _compute_subtree_boundary("for-1", adj, node_map)
        assert "after-1" not in result
        assert "after-2" not in result

    def test_while_loop_with_body(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "while-1": [("body-a", "body"), ("after", "then")],
        }
        node_map = {
            "while-1": _node("while-1", element_type="while"),
            "body-a": _plugin("body-a"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("while-1", adj, node_map) == {"while-1", "body-a"}

    def test_for_each_loop_with_body(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "fe-1": [("body-a", "body"), ("after", "then")],
        }
        node_map = {
            "fe-1": _node("fe-1", element_type="for-each"),
            "body-a": _plugin("body-a"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("fe-1", adj, node_map) == {"fe-1", "body-a"}

    def test_try_catch_finally_includes_all_three_bodies(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "tc-1": [
                ("try-a", "try"),
                ("catch-a", "catch"),
                ("fin-a", "finally"),
                ("after", "then"),
            ],
        }
        node_map = {
            "tc-1": _node("tc-1", element_type="try-catch-finally"),
            "try-a": _plugin("try-a"),
            "catch-a": _plugin("catch-a"),
            "fin-a": _plugin("fin-a"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("tc-1", adj, node_map) == {
            "tc-1",
            "try-a",
            "catch-a",
            "fin-a",
        }

    def test_try_catch_with_multi_node_try_body(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "tc-1": [
                ("try-a", "try"),
                ("catch-a", "catch"),
                ("after", "then"),
            ],
            "try-a": [("try-b", None)],
        }
        node_map = {
            "tc-1": _node("tc-1", element_type="try-catch-finally"),
            "try-a": _plugin("try-a"),
            "try-b": _plugin("try-b"),
            "catch-a": _plugin("catch-a"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("tc-1", adj, node_map) == {
            "tc-1",
            "try-a",
            "try-b",
            "catch-a",
        }

    def test_parallel_with_three_branches(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "par-1": [
                ("br-a", "branch_0"),
                ("br-b", "branch_1"),
                ("br-c", "branch_2"),
                ("after", "then"),
            ],
        }
        node_map = {
            "par-1": _node("par-1", element_type="parallel"),
            "br-a": _plugin("br-a"),
            "br-b": _plugin("br-b"),
            "br-c": _plugin("br-c"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("par-1", adj, node_map) == {
            "par-1",
            "br-a",
            "br-b",
            "br-c",
        }

    def test_parallel_with_multi_node_branches(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "par-1": [
                ("br-a-1", "branch_0"),
                ("br-b-1", "branch_1"),
                ("after", "then"),
            ],
            "br-a-1": [("br-a-2", None)],
        }
        node_map = {
            "par-1": _node("par-1", element_type="parallel"),
            "br-a-1": _plugin("br-a-1"),
            "br-a-2": _plugin("br-a-2"),
            "br-b-1": _plugin("br-b-1"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("par-1", adj, node_map) == {
            "par-1",
            "br-a-1",
            "br-a-2",
            "br-b-1",
        }

    def test_switch_case_with_two_cases_and_a_default(self) -> None:
        """Case and default lanes carry stable branch ids; ``then`` is the egress."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        switch_node = _node("sw-1", element_type="switch-case")
        switch_node["data"]["config"]["values"]["branches"] = [
            {"id": "branch_0", "type": "case", "label": "", "conditions": [], "break": True},
            {"id": "branch_1", "type": "case", "label": "", "conditions": [], "break": False},
            {"id": "branch_2", "type": "default", "label": ""},
        ]
        adj: _Adj = {
            "sw-1": [
                ("case-a", "branch_0"),
                ("case-b", "branch_1"),
                ("default-a", "branch_2"),
                ("after", "then"),
            ],
        }
        node_map = {
            "sw-1": switch_node,
            "case-a": _plugin("case-a"),
            "case-b": _plugin("case-b"),
            "default-a": _plugin("default-a"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("sw-1", adj, node_map) == {
            "sw-1",
            "case-a",
            "case-b",
            "default-a",
        }

    def test_switch_case_then_egress_node_is_excluded(self) -> None:
        """The always-present ``then`` egress stays outside the Switch sub-tree."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "sw-1": [
                ("case-a", "branch_0"),
                ("after-1", "then"),
            ],
            "case-a": [("case-b", None)],
            "after-1": [("after-2", None)],
        }
        node_map = {
            "sw-1": _node("sw-1", element_type="switch-case"),
            "case-a": _plugin("case-a"),
            "case-b": _plugin("case-b"),
            "after-1": _plugin("after-1"),
            "after-2": _plugin("after-2"),
        }

        result = _compute_subtree_boundary("sw-1", adj, node_map)
        assert result == {"sw-1", "case-a", "case-b"}
        assert "after-1" not in result
        assert "after-2" not in result


class TestComputeSubtreeBoundaryBranching:
    """Branching controls (IfElse, Assert-split)."""

    def test_if_else_with_then_and_else_branches(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "if-1": [
                ("then-a", "branch_0"),
                ("else-a", "branch_1"),
                ("after", "then"),
            ],
        }
        node_map = {
            "if-1": _node("if-1", element_type="if-else"),
            "then-a": _plugin("then-a"),
            "else-a": _plugin("else-a"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("if-1", adj, node_map) == {
            "if-1",
            "then-a",
            "else-a",
        }

    def test_if_else_with_multi_node_then_branch(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "if-1": [
                ("then-a", "branch_0"),
                ("else-a", "branch_1"),
                ("after", "then"),
            ],
            "then-a": [("then-b", None)],
        }
        node_map = {
            "if-1": _node("if-1", element_type="if-else"),
            "then-a": _plugin("then-a"),
            "then-b": _plugin("then-b"),
            "else-a": _plugin("else-a"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("if-1", adj, node_map) == {
            "if-1",
            "then-a",
            "then-b",
            "else-a",
        }

    def test_assert_split_with_pass_fail_branches(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "as-1": [
                ("pass-a", "pass"),
                ("fail-a", "fail"),
                ("after", "then"),
            ],
        }
        node_map = {
            "as-1": _node("as-1", element_type="assert"),
            "pass-a": _plugin("pass-a"),
            "fail-a": _plugin("fail-a"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("as-1", adj, node_map) == {
            "as-1",
            "pass-a",
            "fail-a",
        }


class TestComputeSubtreeBoundaryNested:
    """Nested composites: a control inside another control's body."""

    def test_for_loop_containing_if_else(self) -> None:
        """A nested If-Else inside a For-loop body. The inner control's
        own ``then`` handle stays inside the outer body sub-tree because
        only the OUTER root excludes its ``then`` egress."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "for-1": [
                ("if-1", "body"),
                ("after-loop", "then"),
            ],
            "if-1": [
                ("then-log", "branch_0"),
                ("else-log", "branch_1"),
                ("after-if", "then"),
            ],
        }
        node_map = {
            "for-1": _node("for-1", element_type="for"),
            "if-1": _node("if-1", element_type="if-else"),
            "then-log": _plugin("then-log"),
            "else-log": _plugin("else-log"),
            "after-if": _plugin("after-if"),
            "after-loop": _plugin("after-loop"),
        }

        result = _compute_subtree_boundary("for-1", adj, node_map)
        assert result == {"for-1", "if-1", "then-log", "else-log", "after-if"}
        assert "after-loop" not in result

    def test_try_catch_containing_for_loop_in_try_body(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "tc-1": [
                ("for-1", "try"),
                ("catch-log", "catch"),
                ("after", "then"),
            ],
            "for-1": [
                ("body-log", "body"),
                ("after-for", "then"),
            ],
        }
        node_map = {
            "tc-1": _node("tc-1", element_type="try-catch-finally"),
            "for-1": _node("for-1", element_type="for"),
            "body-log": _plugin("body-log"),
            "after-for": _plugin("after-for"),
            "catch-log": _plugin("catch-log"),
            "after": _plugin("after"),
        }

        result = _compute_subtree_boundary("tc-1", adj, node_map)
        assert result == {"tc-1", "for-1", "body-log", "after-for", "catch-log"}
        assert "after" not in result


class TestComputeSubtreeBoundaryEdgeCases:
    """Edge cases: empty bodies, missing nodes, unusual topologies."""

    def test_root_not_in_node_map_still_returns_self(self) -> None:
        """The function should not crash when ``node_id`` is not in node_map.
        Returns ``{node_id}`` because no body edges can be resolved."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {}
        node_map: dict[str, dict[str, Any]] = {}

        assert _compute_subtree_boundary("orphan", adj, node_map) == {"orphan"}

    def test_root_not_in_adjacency_returns_self_only(self) -> None:
        """Adjacency dict missing the root key is treated as no outgoing edges."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {"other": [("x", "body")]}
        node_map = {"a": _plugin("a"), "other": _node("other", element_type="for")}

        assert _compute_subtree_boundary("a", adj, node_map) == {"a"}

    def test_idempotent_on_repeated_calls(self) -> None:
        """Repeated invocations on the same input return the same set without mutation."""
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "for-1": [("body-a", "body"), ("after", "then")],
        }
        node_map = {
            "for-1": _node("for-1", element_type="for"),
            "body-a": _plugin("body-a"),
            "after": _plugin("after"),
        }

        first = _compute_subtree_boundary("for-1", adj, node_map)
        second = _compute_subtree_boundary("for-1", adj, node_map)
        assert first == second
        assert first is not second  # distinct set instances

    def test_diamond_convergence_visits_shared_descendant_once(self) -> None:
        """Two body branches that converge on a shared descendant produce a
        deduplicated boundary set. The shared descendant is enqueued from each
        branch, but the dequeue-time visited guard skips the duplicate visit.
        """
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "par-1": [
                ("br-a", "branch_0"),
                ("br-b", "branch_1"),
                ("after", "then"),
            ],
            "br-a": [("shared", None)],
            "br-b": [("shared", None)],
        }
        node_map = {
            "par-1": _node("par-1", element_type="parallel"),
            "br-a": _plugin("br-a"),
            "br-b": _plugin("br-b"),
            "shared": _plugin("shared"),
            "after": _plugin("after"),
        }

        assert _compute_subtree_boundary("par-1", adj, node_map) == {
            "par-1",
            "br-a",
            "br-b",
            "shared",
        }

    def test_does_not_mutate_inputs(self) -> None:
        from wavecore.api.services.workbench._common import _compute_subtree_boundary

        adj: _Adj = {
            "for-1": [("body-a", "body"), ("after", "then")],
        }
        node_map = {
            "for-1": _node("for-1", element_type="for"),
            "body-a": _plugin("body-a"),
            "after": _plugin("after"),
        }
        adj_snapshot = {k: list(v) for k, v in adj.items()}
        node_map_snapshot = {k: dict(v) for k, v in node_map.items()}

        _compute_subtree_boundary("for-1", adj, node_map)

        assert adj == adj_snapshot
        assert node_map.keys() == node_map_snapshot.keys()


@pytest.mark.parametrize(
    "element_type",
    ["log", "delay", "note", "halt", "break", "continue", "variable-setter"],
)
def test_compute_subtree_boundary_atomic_for_simple_element_types(element_type: str) -> None:
    """Atomic / single-step element types with no body produce ``{node_id}``."""
    from wavecore.api.services.workbench._common import _compute_subtree_boundary

    adj: _Adj = {"n": [("next", None)]}
    node_map = {
        "n": _node("n", element_type=element_type, node_type="control"),
        "next": _plugin("next"),
    }

    assert _compute_subtree_boundary("n", adj, node_map) == {"n"}
