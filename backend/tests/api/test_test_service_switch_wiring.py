"""Design-time wiring rules for Switch/Case: the branching cap and per-handle uniqueness.

Two rules of `_validate_test_data`, both reported as `MULTIPLE_EDGES` on
`workflow.edges`:

- **Branching cap.** A scoped control that declares `allows_dynamic_branches`
  derives its cap from `config.values.branches` plus one for the `then` egress,
  falling back to its static `structure_hints` branch list when no branch list
  is configured. Over the cap:
  `Block '<label>' has <count> outgoing edges (max <max>)`,
  fix `Remove all outgoing edges from block`. `then` is an ordinary member of the
  cap exactly as it is for Try/Catch - it is never exempt.
- **One outgoing edge per named source handle.** Generic across every control:
  `Block '<label>' has <count> outgoing edges on handle '<handle>' (max 1 per handle)`,
  fix `Remove duplicate outgoing edges`. Only edges carrying a truthy
  `sourceHandle` are subject to it, and self-loops are excluded - mirroring the
  incoming-per-handle rule. Auto-fixable: the safe-autofix pass drops the later
  duplicates and keeps the first authored edge.

Covers the guaranteed `then`, stable branch ids and the branch record shape.
REQ-3.5.1.20.
"""

from typing import Any

import pytest

from wavecore.api.services.tests import service as test_service

FIX_ALL_OUTGOING = "Remove all outgoing edges from block"
FIX_DUPLICATE_HANDLE = "Remove duplicate outgoing edges"


def _cap_message(label: str, count: int, maximum: int) -> str:
    return f"Block '{label}' has {count} outgoing edges (max {maximum})"


def _handle_message(label: str, count: int, handle: str) -> str:
    return f"Block '{label}' has {count} outgoing edges on handle '{handle}' (max 1 per handle)"


def _node(
    node_id: str,
    element_type: str,
    node_type: str,
    label: str,
    values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 100, "y": 200},
        "data": {
            "elementType": element_type,
            "nodeType": node_type,
            "version": "1.0.0",
            "label": label,
            "config": {"values": values or {}},
        },
    }


def _log(node_id: str) -> dict[str, Any]:
    return _node(node_id, "log", "plugin", node_id, {"message": "hi"})


def _case(index: int) -> dict[str, Any]:
    return {
        "id": f"branch_{index}",
        "type": "case",
        "label": "",
        "conditions": [{"id": f"cond-{index}", "type": "expression", "expression": "true"}],
        "break": True,
    }


def _switch_values(case_count: int, *, default: bool = False) -> dict[str, Any]:
    branches: list[dict[str, Any]] = [_case(index) for index in range(case_count)]
    if default:
        branches.append({"id": f"branch_{case_count}", "type": "default", "label": ""})
    return {"branches": branches}


def _switch(values: dict[str, Any] | None) -> dict[str, Any]:
    return _node("sw-1", "switch-case", "control", "Switch", values)


def _edge(edge_id: str, source: str, target: str, handle: str | None = None) -> dict[str, Any]:
    edge: dict[str, Any] = {"id": edge_id, "source": source, "target": target}
    if handle is not None:
        edge["sourceHandle"] = handle
    return edge


def _fan_out(
    source: str, handles: list[str | None]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """One leaf log node plus one outgoing edge per handle, fed from start-node."""
    nodes = [_log(f"leaf-{index}") for index in range(len(handles))]
    edges: list[dict[str, Any]] = [_edge("e-start", "start-node", source)]
    edges.extend(
        _edge(f"e-{index}", source, f"leaf-{index}", handle) for index, handle in enumerate(handles)
    )
    return nodes, edges


def _test_data(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "name": "Switch Wiring Test",
        "workflow": {"nodes": nodes, "edges": edges},
        "variables": {},
    }


def _validate(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return test_service._validate_test_data(_test_data(nodes, edges), context="save")


def _autofix(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    """Run the safe-autofix pass in place and return the repaired test dict."""
    test = _test_data(nodes, edges)
    test_service._apply_safe_autofixes(test)
    return test


def _edge_handles(test: dict[str, Any]) -> list[tuple[str, str | None]]:
    return [(edge["id"], edge.get("sourceHandle")) for edge in test["workflow"]["edges"]]


def _duplicate_handle_graph() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Two edges on `branch_0`, one each on `branch_1` and `then` - inside the cap of 4."""
    nodes = [_switch(_switch_values(2, default=True))]
    nodes.extend(_log(f"leaf-{index}") for index in range(4))
    edges = [
        _edge("e-start", "start-node", "sw-1"),
        _edge("e-dup-first", "sw-1", "leaf-0", "branch_0"),
        _edge("e-dup-second", "sw-1", "leaf-1", "branch_0"),
        _edge("e-branch-1", "sw-1", "leaf-2", "branch_1"),
        _edge("e-then", "sw-1", "leaf-3", "then"),
    ]
    return nodes, edges


def _multi_edge_messages(result: dict[str, Any]) -> list[str]:
    return [e["message"] for e in result["errors"] if e["code"] == "MULTIPLE_EDGES"]


def _handle_findings(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        e
        for e in result["errors"]
        if e["code"] == "MULTIPLE_EDGES" and "outgoing edges on handle" in e["message"]
    ]


def _reset() -> None:
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    test_service._clear_storage()
    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())


class TestSwitchBranchingCap:
    """The cap follows the configured branch list, plus one for `then`."""

    def setup_method(self) -> None:
        _reset()

    def test_two_cases_and_a_default_allow_four_outgoing_edges(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_1", "branch_2", "then"])
        result = _validate([_switch(_switch_values(2, default=True)), *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_a_configured_switch_is_never_hard_capped_at_three(self) -> None:
        """The cap leaves room for the `then` edge."""
        # Guard: the cap must read the configured branch list, not the static hint.
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_1", "branch_2", "then"])
        result = _validate([_switch(_switch_values(2, default=True)), *nodes], edges)

        messages = _multi_edge_messages(result)
        assert _cap_message("Switch", 4, 3) not in messages
        assert not any("max 3" in message for message in messages)

    def test_the_cap_grows_with_the_configured_branch_count(self) -> None:
        """Cap == configured branches + 1; the message names the derived maximum."""
        # Guard: the cap is derived from `branches`, never from a removed `cases` key.
        three, five = _switch_values(2, default=True), _switch_values(4, default=True)
        over_three = _fan_out("sw-1", ["branch_0", "branch_1", "branch_2", "then", "spare"])
        over_five = _fan_out(
            "sw-1",
            ["branch_0", "branch_1", "branch_2", "branch_3", "branch_4", "then", "spare"],
        )

        assert _cap_message("Switch", 5, 4) in _multi_edge_messages(
            _validate([_switch(three), *over_three[0]], over_three[1])
        )
        assert _cap_message("Switch", 7, 6) in _multi_edge_messages(
            _validate([_switch(five), *over_five[0]], over_five[1])
        )

    def test_a_fifth_outgoing_edge_exceeds_the_dynamic_cap(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_1", "branch_2", "then", "branch_3"])
        result = _validate([_switch(_switch_values(2, default=True)), *nodes], edges)

        messages = _multi_edge_messages(result)
        assert _cap_message("Switch", 5, 4) in messages
        assert any("max 4" in message for message in messages)

    def test_four_cases_and_a_default_allow_six_outgoing_edges(self) -> None:
        handles: list[str | None] = [
            "branch_0",
            "branch_1",
            "branch_2",
            "branch_3",
            "branch_4",
            "then",
        ]
        nodes, edges = _fan_out("sw-1", handles)
        result = _validate([_switch(_switch_values(4, default=True)), *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_one_case_allows_the_case_edge_and_the_then_edge(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "then"])
        result = _validate([_switch(_switch_values(1)), *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_the_then_edge_is_an_ordinary_member_of_the_cap(self) -> None:
        """`then` is counted like Try/Catch counts its own egress - never exempt."""
        nodes, edges = _fan_out("sw-1", ["branch_0", "then", "branch_1"])
        result = _validate([_switch(_switch_values(1)), *nodes], edges)

        assert _cap_message("Switch", 3, 2) in _multi_edge_messages(result)

    def test_the_cap_finding_carries_the_outgoing_fix_action(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "then", "branch_1"])
        result = _validate([_switch(_switch_values(1)), *nodes], edges)

        flagged = [e for e in result["errors"] if e["message"] == _cap_message("Switch", 3, 2)]
        assert len(flagged) == 1
        assert flagged[0]["path"] == "workflow.edges"
        assert flagged[0]["node_id"] == "sw-1"
        assert flagged[0]["node_label"] == "Switch"
        assert flagged[0]["severity"] == "error"
        assert flagged[0]["fix_action"] == FIX_ALL_OUTGOING

    def test_a_switch_without_configured_branches_falls_back_to_the_static_cap(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_1", "then", "branch_2"])
        result = _validate([_switch({}), *nodes], edges)

        assert _cap_message("Switch", 4, 3) in _multi_edge_messages(result)

    def test_the_static_fallback_allows_three_outgoing_edges(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_1", "then"])
        result = _validate([_switch({}), *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_an_empty_branch_list_falls_back_to_the_static_cap(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_1", "then", "branch_2"])
        result = _validate([_switch({"branches": []}), *nodes], edges)

        assert _cap_message("Switch", 4, 3) in _multi_edge_messages(result)

    def test_a_non_list_branches_value_falls_back_to_the_static_cap(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_1", "then", "branch_2"])
        result = _validate([_switch({"branches": "branch_0"}), *nodes], edges)

        assert _cap_message("Switch", 4, 3) in _multi_edge_messages(result)


class TestNeighboringControlsUnaffected:
    """The scoped-dynamic clause is gated on `allows_dynamic_branches`."""

    def setup_method(self) -> None:
        _reset()

    def _try_catch(self, values: dict[str, Any]) -> dict[str, Any]:
        return _node("tc-1", "try-catch-finally", "control", "Try/Catch", values)

    def _for(self, values: dict[str, Any]) -> dict[str, Any]:
        return _node("for-1", "for", "control", "For", values)

    def test_try_catch_still_allows_its_four_static_handles(self) -> None:
        nodes, edges = _fan_out("tc-1", ["try", "catch", "finally", "then"])
        values = {"enable_catch": True, "enable_finally": True}
        result = _validate([self._try_catch(values), *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_try_catch_still_caps_at_four(self) -> None:
        nodes, edges = _fan_out("tc-1", ["try", "catch", "finally", "then", "spare"])
        values = {"enable_catch": True, "enable_finally": True}
        result = _validate([self._try_catch(values), *nodes], edges)

        assert _cap_message("Try/Catch", 5, 4) in _multi_edge_messages(result)

    def test_try_catch_ignores_a_branches_value_in_its_config(self) -> None:
        nodes, edges = _fan_out("tc-1", ["try", "catch", "finally", "then", "spare"])
        values = {
            "enable_catch": True,
            "enable_finally": True,
            "branches": [{"id": f"branch_{index}"} for index in range(6)],
        }
        result = _validate([self._try_catch(values), *nodes], edges)

        assert _cap_message("Try/Catch", 5, 4) in _multi_edge_messages(result)

    def test_for_still_allows_body_and_then(self) -> None:
        nodes, edges = _fan_out("for-1", ["body", "then"])
        result = _validate([self._for({"mode": "count", "count": 3}), *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_for_still_caps_at_two(self) -> None:
        nodes, edges = _fan_out("for-1", ["body", "then", "spare"])
        result = _validate([self._for({"mode": "count", "count": 3}), *nodes], edges)

        assert _cap_message("For", 3, 2) in _multi_edge_messages(result)

    def test_for_ignores_a_branches_value_in_its_config(self) -> None:
        nodes, edges = _fan_out("for-1", ["body", "then", "spare"])
        values = {
            "mode": "count",
            "count": 3,
            "branches": [{"id": f"branch_{index}"} for index in range(5)],
        }
        result = _validate([self._for(values), *nodes], edges)

        assert _cap_message("For", 3, 2) in _multi_edge_messages(result)


class TestOneEdgePerSourceHandle:
    """A named source handle carries at most one outgoing edge."""

    def setup_method(self) -> None:
        _reset()

    def test_two_edges_on_the_same_switch_handle_are_reported(self) -> None:
        # Guard: duplicate outgoing edges on one handle are reported.
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_0"])
        result = _validate([_switch(_switch_values(2, default=True)), *nodes], edges)

        assert _multi_edge_messages(result) == [_handle_message("Switch", 2, "branch_0")]

    def test_the_duplicate_handle_finding_carries_the_full_envelope(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_0"])
        result = _validate([_switch(_switch_values(2, default=True)), *nodes], edges)

        flagged = _handle_findings(result)
        assert len(flagged) == 1
        assert flagged[0]["message"] == _handle_message("Switch", 2, "branch_0")
        assert flagged[0]["code"] == "MULTIPLE_EDGES"
        assert flagged[0]["path"] == "workflow.edges"
        assert flagged[0]["node_id"] == "sw-1"
        assert flagged[0]["node_label"] == "Switch"
        assert flagged[0]["severity"] == "error"
        assert flagged[0]["fix_action"] == FIX_DUPLICATE_HANDLE

    def test_three_edges_on_one_handle_report_the_full_count(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_0", "branch_0"])
        result = _validate([_switch(_switch_values(2, default=True)), *nodes], edges)

        assert _multi_edge_messages(result) == [_handle_message("Switch", 3, "branch_0")]

    def test_distinct_handles_produce_no_duplicate_handle_finding(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0", "branch_1", "branch_2", "then"])
        result = _validate([_switch(_switch_values(2, default=True)), *nodes], edges)

        assert _handle_findings(result) == []

    def test_the_rule_is_generic_across_controls(self) -> None:
        """Not Switch-specific: a duplicated Try/Catch `try` handle reports too."""
        nodes, edges = _fan_out("tc-1", ["try", "try"])
        values = {"enable_catch": True, "enable_finally": False}
        try_catch = _node("tc-1", "try-catch-finally", "control", "Try/Catch", values)
        result = _validate([try_catch, *nodes], edges)

        assert _handle_message("Try/Catch", 2, "try") in _multi_edge_messages(result)

    def test_a_self_loop_is_excluded_from_the_per_handle_count(self) -> None:
        nodes, edges = _fan_out("sw-1", ["branch_0"])
        edges.append(_edge("e-loop", "sw-1", "sw-1", "branch_0"))
        result = _validate([_switch(_switch_values(2, default=True)), *nodes], edges)

        assert _handle_findings(result) == []

    def test_edges_without_a_source_handle_are_not_subject_to_the_rule(self) -> None:
        nodes, edges = _fan_out("sw-1", [None, None])
        result = _validate([_switch(_switch_values(2, default=True)), *nodes], edges)

        assert _multi_edge_messages(result) == []

    @pytest.mark.parametrize("handle", [None, ""])
    def test_a_falsy_source_handle_is_not_subject_to_the_rule(self, handle: str | None) -> None:
        """An explicitly falsy handle is as unnamed as an absent one."""
        nodes = [_switch(_switch_values(2, default=True)), _log("leaf-0"), _log("leaf-1")]
        edges: list[dict[str, Any]] = [
            _edge("e-start", "start-node", "sw-1"),
            {"id": "e-0", "source": "sw-1", "target": "leaf-0", "sourceHandle": handle},
            {"id": "e-1", "source": "sw-1", "target": "leaf-1", "sourceHandle": handle},
        ]
        result = _validate(nodes, edges)

        assert _multi_edge_messages(result) == []


class TestDuplicateHandleAutofix:
    """The duplicate-handle finding is auto-fixable, so the Fix button does something."""

    def setup_method(self) -> None:
        _reset()

    def test_two_edges_on_one_handle_are_reduced_to_one(self) -> None:
        fixed = _autofix(*_duplicate_handle_graph())

        handles = [edge.get("sourceHandle") for edge in fixed["workflow"]["edges"]]
        assert handles.count("branch_0") == 1

    def test_the_first_authored_edge_on_the_handle_survives(self) -> None:
        """First wins, matching the runtime handle-target map."""
        # Guard: the runtime keeps only the first target, so the fix must too.
        fixed = _autofix(*_duplicate_handle_graph())

        edge_ids = {edge["id"] for edge in fixed["workflow"]["edges"]}
        assert "e-dup-first" in edge_ids
        assert "e-dup-second" not in edge_ids

    def test_edges_on_other_handles_are_untouched(self) -> None:
        fixed = _autofix(*_duplicate_handle_graph())

        assert _edge_handles(fixed) == [
            ("e-start", None),
            ("e-dup-first", "branch_0"),
            ("e-branch-1", "branch_1"),
            ("e-then", "then"),
        ]

    def test_the_residual_validation_is_clean_after_the_fix(self) -> None:
        fixed = _autofix(*_duplicate_handle_graph())

        residual = test_service._validate_test_data(fixed, context="save")
        assert residual["errors"] == []
