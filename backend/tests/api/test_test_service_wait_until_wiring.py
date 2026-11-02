"""Design-time wiring and parameter rules for Wait Until.

Two rules of ``_validate_test_data``:

- **Branching cap, by wait mode.** Retry mode renders a `retry` lane plus the
  `then` egress, so it allows two outgoing edges. Watch mode renders a single
  default egress, so it allows one - which is also what catches a Retry lane
  left wired after the author switches the node to Watch. Over the cap:
  ``Block '<label>' has <count> outgoing edges (max <max>)``.
- **One outgoing edge per named source handle.** Generic across every control;
  a duplicated `retry` handle reports
  ``Block '<label>' has <count> outgoing edges on handle 'retry' (max 1 per handle)``.

Plus the required-parameter surface: a Wait Until with no conditions or no
timeout is refused at save with the shared ``REQUIRED_PARAM_*`` codes.

REQ-3.5.4.3.
"""

from typing import Any

import pytest

from wavecore.api.services.tests import service as test_service

FIX_ALL_OUTGOING = "Remove all outgoing edges from block"
FIX_DUPLICATE_HANDLE = "Remove duplicate outgoing edges"

CONDITIONS: list[dict[str, Any]] = [{"id": "cond-1", "type": "expression", "expression": "ready"}]


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


def _wait_values(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "conditions": CONDITIONS,
        "timeout": 30000,
        "check_interval": 1000,
        "mode": "retry",
        "fail_current_scope": False,
    }
    values.update(overrides)
    return values


def _wait(values: dict[str, Any] | None = None) -> dict[str, Any]:
    return _node("wait-1", "wait-until", "control", "Wait Until", values or _wait_values())


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
        "name": "Wait Until Wiring Test",
        "workflow": {"nodes": nodes, "edges": edges},
        "variables": {},
    }


def _validate(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return test_service._validate_test_data(_test_data(nodes, edges), context="save")


def _multi_edge_messages(result: dict[str, Any]) -> list[str]:
    return [e["message"] for e in result["errors"] if e["code"] == "MULTIPLE_EDGES"]


def _codes(result: dict[str, Any]) -> list[str]:
    return [e["code"] for e in result["errors"]]


def _errors_with(result: dict[str, Any], code: str) -> list[dict[str, Any]]:
    return [e for e in result["errors"] if e["code"] == code]


def _reset() -> None:
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    test_service._clear_storage()
    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())


class TestWaitUntilBranchingCap:
    """The cap follows the wait mode, not a fixed lane count."""

    def setup_method(self) -> None:
        _reset()

    def test_retry_mode_allows_the_retry_lane_and_the_then_egress(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        result = _validate([_wait(), *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_a_third_outgoing_edge_exceeds_the_retry_cap(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", "then", "spare"])
        result = _validate([_wait(), *nodes], edges)

        assert _cap_message("Wait Until", 3, 2) in _multi_edge_messages(result)

    def test_the_retry_cap_finding_carries_the_full_envelope(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", "then", "spare"])
        result = _validate([_wait(), *nodes], edges)

        flagged = [e for e in result["errors"] if e["message"] == _cap_message("Wait Until", 3, 2)]
        assert len(flagged) == 1
        assert flagged[0]["path"] == "workflow.edges"
        assert flagged[0]["node_id"] == "wait-1"
        assert flagged[0]["node_label"] == "Wait Until"
        assert flagged[0]["severity"] == "error"
        assert flagged[0]["fix_action"] == FIX_ALL_OUTGOING

    def test_watch_mode_allows_its_single_default_egress(self) -> None:
        nodes, edges = _fan_out("wait-1", [None])
        result = _validate([_wait(_wait_values(mode="watch")), *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_watch_mode_refuses_a_second_outgoing_edge(self) -> None:
        # This is the Retry -> Watch switch with the retry lane left wired: the
        # node has one handle, so the stale lane is over the cap.
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        result = _validate([_wait(_wait_values(mode="watch")), *nodes], edges)

        assert _cap_message("Wait Until", 2, 1) in _multi_edge_messages(result)

    def test_a_wait_with_no_mode_configured_is_capped_as_retry(self) -> None:
        # An unconfigured drop waits with a retry lane.
        values = _wait_values()
        del values["mode"]
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        result = _validate([_wait(values), *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_the_then_edge_is_an_ordinary_member_of_the_retry_cap(self) -> None:
        nodes, edges = _fan_out("wait-1", ["then", "retry", "spare"])
        result = _validate([_wait(), *nodes], edges)

        assert _cap_message("Wait Until", 3, 2) in _multi_edge_messages(result)


class TestWaitUntilOneEdgePerSourceHandle:
    """The generic per-handle rule applies to the retry lane."""

    def setup_method(self) -> None:
        _reset()

    def test_two_edges_on_the_retry_handle_are_reported(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", "retry"])
        result = _validate([_wait(), *nodes], edges)

        assert _handle_message("Wait Until", 2, "retry") in _multi_edge_messages(result)

    def test_the_duplicate_retry_finding_carries_the_duplicate_fix(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", "retry"])
        result = _validate([_wait(), *nodes], edges)

        flagged = [
            e for e in result["errors"] if e["message"] == _handle_message("Wait Until", 2, "retry")
        ]
        assert len(flagged) == 1
        assert flagged[0]["fix_action"] == FIX_DUPLICATE_HANDLE

    def test_two_edges_on_the_then_handle_are_reported(self) -> None:
        nodes, edges = _fan_out("wait-1", ["then", "then"])
        result = _validate([_wait(), *nodes], edges)

        assert _handle_message("Wait Until", 2, "then") in _multi_edge_messages(result)

    def test_distinct_lanes_produce_no_duplicate_handle_finding(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        result = _validate([_wait(), *nodes], edges)

        assert _multi_edge_messages(result) == []


class TestWaitUntilRequiredParameters:
    """A wait that cannot run is refused at save."""

    def setup_method(self) -> None:
        _reset()

    def _validate_wait(self, values: dict[str, Any]) -> dict[str, Any]:
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        return _validate([_wait(values), *nodes], edges)

    def test_a_fully_configured_wait_is_clean(self) -> None:
        result = self._validate_wait(_wait_values())

        assert result["errors"] == []

    def test_a_wait_without_conditions_is_refused(self) -> None:
        values = _wait_values()
        del values["conditions"]
        result = self._validate_wait(values)

        flagged = _errors_with(result, "REQUIRED_PARAM_MISSING")
        assert any(e["message"] == "Required parameter 'conditions' is missing" for e in flagged)

    def test_a_wait_with_an_empty_condition_list_is_refused(self) -> None:
        result = self._validate_wait(_wait_values(conditions=[]))

        flagged = _errors_with(result, "REQUIRED_PARAM_EMPTY")
        assert any(e["message"] == "Required parameter 'conditions' is empty" for e in flagged)

    def test_a_wait_without_a_timeout_is_refused(self) -> None:
        values = _wait_values()
        del values["timeout"]
        result = self._validate_wait(values)

        flagged = _errors_with(result, "REQUIRED_PARAM_MISSING")
        assert any(e["message"] == "Required parameter 'timeout' is missing" for e in flagged)

    def test_an_omitted_check_interval_is_not_required(self) -> None:
        values = _wait_values()
        del values["check_interval"]
        result = self._validate_wait(values)

        assert "REQUIRED_PARAM_MISSING" not in _codes(result)

    def test_an_omitted_message_is_not_required(self) -> None:
        result = self._validate_wait(_wait_values())

        assert "REQUIRED_PARAM_MISSING" not in _codes(result)

    @pytest.mark.parametrize("mode", ["retry", "watch"])
    def test_both_modes_pass_the_parameter_check(self, mode: str) -> None:
        values = _wait_values(mode=mode)
        nodes, edges = _fan_out("wait-1", ["retry", "then"] if mode == "retry" else [None])
        result = _validate([_wait(values), *nodes], edges)

        assert "REQUIRED_PARAM_MISSING" not in _codes(result)
        assert "REQUIRED_PARAM_EMPTY" not in _codes(result)

    def test_a_disabled_wait_is_not_parameter_checked(self) -> None:
        values = _wait_values()
        del values["timeout"]
        wait = _wait(values)
        wait["data"]["disabled"] = True
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        result = _validate([wait, *nodes], edges)

        assert "REQUIRED_PARAM_MISSING" not in _codes(result)


class TestNeighboringControlsUnaffected:
    """The mode-dependent clause must not widen or narrow anything else."""

    def setup_method(self) -> None:
        _reset()

    def test_while_still_allows_body_and_then(self) -> None:
        nodes, edges = _fan_out("while-1", ["body", "then"])
        while_node = _node(
            "while-1",
            "while",
            "control",
            "While",
            {"mode": "while-do", "conditions": CONDITIONS},
        )
        result = _validate([while_node, *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_while_ignores_a_watch_mode_value(self) -> None:
        # Guard: the wait clause keys on elementType, never on a bare `mode`.
        nodes, edges = _fan_out("while-1", ["body", "then"])
        while_node = _node(
            "while-1", "while", "control", "While", {"mode": "watch", "conditions": CONDITIONS}
        )
        result = _validate([while_node, *nodes], edges)

        assert _multi_edge_messages(result) == []

    def test_delay_still_allows_only_one_outgoing_edge(self) -> None:
        nodes, edges = _fan_out("delay-1", [None, None])
        delay = _node("delay-1", "delay", "control", "Delay", {"duration": 500})
        result = _validate([delay, *nodes], edges)

        assert _cap_message("Delay", 2, 1) in _multi_edge_messages(result)
