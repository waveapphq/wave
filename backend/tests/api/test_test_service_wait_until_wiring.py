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

And the save rule for its wires: the save puts each wire on the lane the
mode draws. In Watch mode the retry wires go and the next wire stays on the
single unnamed egress; in Retry mode an unnamed next wire moves to `then`.
The save reports only the wires it removes. The same rule holds in every
Function body a Test holds, in a library Function's own flow and in every
body that flow holds.

REQ-3.5.4.3, REQ-5.2.4.3, REQ-3.1.2.4.
"""

import copy
from typing import Any

import pytest

from wavecore.api.services.tests import service as test_service

FIX_ALL_OUTGOING = "Remove all outgoing edges from block"
FIX_RETRY_LANE = "Remove the retry lane edges (Watch mode has no retry lane)"
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
        "variables": {"ready": {"type": "boolean", "value": False}},
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

    @pytest.mark.parametrize("next_handle", ["then", None])
    def test_a_watch_finding_over_its_retry_wire_names_only_that_wire(
        self, next_handle: str | None
    ) -> None:
        # The save removes only the retry wire, so the fix text says so.
        nodes, edges = _fan_out("wait-1", ["retry", next_handle])
        result = _validate([_wait(_wait_values(mode="watch")), *nodes], edges)

        flagged = [e for e in result["errors"] if e["message"] == _cap_message("Wait Until", 2, 1)]
        assert [e["fix_action"] for e in flagged] == [FIX_RETRY_LANE]

    def test_a_watch_finding_over_its_single_egress_names_every_wire(self) -> None:
        # Two wires on the one egress stay over the cap without the retry wire.
        nodes, edges = _fan_out("wait-1", ["retry", "then", None])
        result = _validate([_wait(_wait_values(mode="watch")), *nodes], edges)

        flagged = [e for e in result["errors"] if e["message"] == _cap_message("Wait Until", 3, 1)]
        assert [e["fix_action"] for e in flagged] == [FIX_ALL_OUTGOING]

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


def _save(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return test_service.create_test(_test_data(nodes, edges))


def _wires(edges: list[dict[str, Any]]) -> list[tuple[str, str, str | None]]:
    """Each wire as (id, target, source handle)."""
    return [(e["id"], e["target"], e.get("sourceHandle")) for e in edges]


def _stored_wires(test_id: str) -> list[tuple[str, str, str | None]]:
    stored = test_service.get_test(test_id)
    assert stored is not None
    return _wires(stored["workflow"]["edges"])


def _repaired(result: dict[str, Any]) -> list[tuple[str, str]]:
    return [(r["kind"], r["id"]) for r in result["repairs"]]


START_WIRE = ("e-start", "wait-1", None)


class TestWaitUntilSaveKeepsTheNextWire:
    """The save puts each wire of a Wait Until on a lane its mode draws."""

    def setup_method(self) -> None:
        _reset()

    @pytest.mark.parametrize("next_handle", ["then", None])
    def test_a_watch_create_removes_only_the_retry_wire(self, next_handle: str | None) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", next_handle])
        result = _save([_wait(_wait_values(mode="watch")), *nodes], edges)

        assert _repaired(result) == [("edge", "e-0")]
        assert result["repairs"][0]["message"] == "Connection wait-1 -> leaf-0 was removed"
        assert _stored_wires(result["id"]) == [START_WIRE, ("e-1", "leaf-1", None)]
        stored = test_service.get_test(result["id"])
        assert stored is not None
        assert test_service._validate_test_data(stored, context="run")["errors"] == []

    def test_a_watch_update_removes_only_the_retry_wire(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        created = _save([_wait(), *nodes], edges)
        assert created["repairs"] == []

        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        workflow = {"nodes": [_wait(_wait_values(mode="watch")), *nodes], "edges": edges}
        result = test_service.update_test(created["id"], {"workflow": workflow})

        assert result is not None
        assert _repaired(result) == [("edge", "e-0")]
        assert _stored_wires(created["id"]) == [START_WIRE, ("e-1", "leaf-1", None)]

    def test_a_watch_save_moves_a_then_wire_to_the_single_egress(self) -> None:
        nodes, edges = _fan_out("wait-1", ["then"])
        result = _save([_wait(_wait_values(mode="watch")), *nodes], edges)

        assert result["repairs"] == []
        assert _stored_wires(result["id"]) == [START_WIRE, ("e-0", "leaf-0", None)]

    def test_a_watch_save_removes_a_lone_retry_wire(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry"])
        result = _save([_wait(_wait_values(mode="watch")), *nodes], edges)

        assert _repaired(result) == [("edge", "e-0")]
        assert _stored_wires(result["id"]) == [START_WIRE]

    def test_a_watch_save_keeps_a_lone_default_egress(self) -> None:
        nodes, edges = _fan_out("wait-1", [None])
        result = _save([_wait(_wait_values(mode="watch")), *nodes], edges)

        assert result["repairs"] == []
        assert _stored_wires(result["id"]) == [START_WIRE, ("e-0", "leaf-0", None)]

    def test_a_retry_save_keeps_both_lanes(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        result = _save([_wait(), *nodes], edges)

        assert result["repairs"] == []
        assert _stored_wires(result["id"]) == [
            START_WIRE,
            ("e-0", "leaf-0", "retry"),
            ("e-1", "leaf-1", "then"),
        ]

    @pytest.mark.parametrize("stored_mode", ["retry", None])
    def test_a_retry_save_puts_an_unnamed_next_wire_on_then(self, stored_mode: str | None) -> None:
        values = _wait_values()
        if stored_mode is None:
            del values["mode"]
        nodes, edges = _fan_out("wait-1", ["retry", None])
        result = _save([_wait(values), *nodes], edges)

        assert result["repairs"] == []
        assert _stored_wires(result["id"]) == [
            START_WIRE,
            ("e-0", "leaf-0", "retry"),
            ("e-1", "leaf-1", "then"),
        ]

    def test_a_retry_save_with_a_then_wire_leaves_an_unnamed_wire_as_it_is(self) -> None:
        # The run leaves by `then`, so only a Retry wait without one gets its unnamed wire named.
        nodes, edges = _fan_out("wait-1", ["then", None])
        result = _save([_wait(), *nodes], edges)

        assert result["repairs"] == []
        assert _stored_wires(result["id"]) == [
            START_WIRE,
            ("e-0", "leaf-0", "then"),
            ("e-1", "leaf-1", None),
        ]

    def test_the_lane_rule_leaves_other_blocks_alone(self) -> None:
        # A While carries a `mode` too; its unnamed wire is not a Wait Until egress.
        nodes, edges = _fan_out("while-1", ["body", None])
        while_node = _node(
            "while-1", "while", "control", "While", {"mode": "while-do", "conditions": CONDITIONS}
        )
        result = _save([while_node, *nodes], edges)

        assert result["repairs"] == []
        stored = test_service.get_test(result["id"])
        assert stored is not None
        assert _wires(stored["workflow"]["edges"]) == [
            ("e-start", "while-1", None),
            ("e-0", "leaf-0", "body"),
            ("e-1", "leaf-1", None),
        ]

    def test_fix_test_removes_only_the_retry_wire(self) -> None:
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        created = _save([_wait(), *nodes], edges)
        nodes, edges = _fan_out("wait-1", ["retry", "then"])
        workflow = {"nodes": [_wait(_wait_values(mode="watch")), *nodes], "edges": edges}
        test_service._update_raw_test(created["id"], {"workflow": workflow})

        fixed = test_service.fix_test(created["id"])

        assert fixed is not None
        assert _wires(fixed["test"]["workflow"]["edges"]) == [START_WIRE, ("e-1", "leaf-1", None)]
        assert _stored_wires(created["id"]) == [START_WIRE, ("e-1", "leaf-1", None)]


BODY_RETRY_WIRE = "e-watch-retry"


def _body_wires(next_handle: str | None) -> dict[str, Any]:
    """A Function body: a Watch wait with a retry wire and a next wire, then a Retry wait whose
    next wire names no lane. The retry wire lands on the Log the Retry wait reaches too."""
    nodes = [
        _node("watch", "wait-until", "control", "Watch", _wait_values(mode="watch")),
        _log("after-watch"),
        _node("retry-wait", "wait-until", "control", "Retry", _wait_values()),
        _log("after-retry"),
    ]
    retry_wire = {**_edge(BODY_RETRY_WIRE, "watch", "after-retry", "retry")}
    retry_wire["targetHandle"] = "ingress_1"
    edges = [
        _edge("e-body-start", "start-node", "watch"),
        retry_wire,
        _edge("e-watch-next", "watch", "after-watch", next_handle),
        _edge("e-after-watch", "after-watch", "retry-wait"),
        _edge("e-retry-next", "retry-wait", "after-retry"),
    ]
    return {"nodes": nodes, "edges": edges}


BODY_LANES = [
    ("e-body-start", "watch", None),
    ("e-watch-next", "after-watch", None),
    ("e-after-watch", "retry-wait", None),
    ("e-retry-next", "after-retry", "then"),
]


def _function_definition(workflow: dict[str, Any], name: str = "Helper") -> dict[str, Any]:
    return {
        "name": name,
        "inputs": [],
        "outputs": [],
        "variables": [{"name": "ready", "type": "boolean", "value": False}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": workflow,
    }


def _local_block(node_id: str, workflow: dict[str, Any], label: str = "Helper") -> dict[str, Any]:
    block = _node(node_id, "function", "function", label)
    block["data"]["functionLifecycle"] = "local"
    block["data"]["localDefinition"] = _function_definition(workflow, label)
    return block


def _holding(*blocks: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The Function Blocks chained from start-node."""
    ids = ["start-node", *(block["id"] for block in blocks)]
    return list(blocks), [
        _edge(f"e-{source}", source, target) for source, target in zip(ids, ids[1:], strict=False)
    ]


def _segment(node_id: str, label: str) -> dict[str, str]:
    return {"node_id": node_id, "label": label, "element_type": "function"}


def _body_repair(*path: dict[str, str]) -> dict[str, Any]:
    return {
        "kind": "edge",
        "id": BODY_RETRY_WIRE,
        "code": "",
        "message": "Connection watch -> after-retry was removed",
        "function_path": list(path),
    }


def _stored_body(test_id: str, *path: str) -> list[tuple[str, str, str | None]]:
    stored = test_service.get_test(test_id)
    assert stored is not None
    workflow = stored["workflow"]
    for node_id in path:
        block = next(node for node in workflow["nodes"] if node["id"] == node_id)
        workflow = block["data"]["localDefinition"]["workflow"]
    return _wires(workflow["edges"])


class TestWaitUntilLanesInAFunctionBodyOfATest:
    """The Test save puts the Wait Until wires of every Function body it holds on their lanes."""

    def setup_method(self) -> None:
        _reset()

    @pytest.mark.parametrize("next_handle", ["then", None])
    def test_a_local_body_create_stores_the_lanes_and_reports_only_the_retry_wire(
        self, next_handle: str | None
    ) -> None:
        result = _save(*_holding(_local_block("fn-1", _body_wires(next_handle))))

        assert result["repairs"] == [_body_repair(_segment("fn-1", "Helper"))]
        assert _stored_body(result["id"], "fn-1") == BODY_LANES
        stored = test_service.get_test(result["id"])
        assert stored is not None
        assert test_service._validate_test_data(stored, context="run")["errors"] == []

    def test_a_local_body_update_stores_the_lanes(self) -> None:
        created = _save(*_holding(_local_block("fn-1", {"nodes": [], "edges": []})))
        nodes, edges = _holding(_local_block("fn-1", _body_wires("then")))

        result = test_service.update_test(created["id"], {"workflow": _workflow(nodes, edges)})

        assert result is not None
        assert result["repairs"] == [_body_repair(_segment("fn-1", "Helper"))]
        assert _stored_body(created["id"], "fn-1") == BODY_LANES

    def test_a_batch_create_lists_the_removed_retry_wire_under_each_created_test(self) -> None:
        held = _test_data(*_holding(_local_block("fn-1", _body_wires("then"))))
        tests = [{**held, "name": "Batch body"}, {"name": "Batch body"}, {"name": "Batch clean"}]

        result = test_service.batch_create_tests(tests)

        assert [failure["index"] for failure in result["failed"]] == [1]
        body_id, clean_id = result["created"]
        assert result["repairs"] == {
            body_id: [_body_repair(_segment("fn-1", "Helper"))],
            clean_id: [],
        }
        assert _stored_body(body_id, "fn-1") == BODY_LANES

    def test_a_batch_update_lists_the_removed_retry_wire_under_each_updated_test(self) -> None:
        created = _save(*_holding(_local_block("fn-1", {"nodes": [], "edges": []})))
        workflow = _workflow(*_holding(_local_block("fn-1", _body_wires("then"))))

        result = test_service.batch_update_tests(
            [
                {"id": created["id"], "update": {"workflow": workflow}},
                {"id": "no-such-test", "update": {"name": "Gone"}},
            ]
        )

        assert result["updated"] == [created["id"]]
        assert [failure["index"] for failure in result["failed"]] == [1]
        assert result["repairs"] == {created["id"]: [_body_repair(_segment("fn-1", "Helper"))]}
        assert _stored_body(created["id"], "fn-1") == BODY_LANES

    def test_a_body_nested_in_a_local_body_stores_the_lanes(self) -> None:
        inner = _local_block("fn-inner", _body_wires("then"), label="Inner")
        outer = _local_block(
            "fn-outer",
            {"nodes": [inner], "edges": [_edge("e-outer", "start-node", "fn-inner")]},
            label="Outer",
        )

        result = _save(*_holding(outer))

        assert result["repairs"] == [
            _body_repair(_segment("fn-outer", "Outer"), _segment("fn-inner", "Inner"))
        ]
        assert _stored_body(result["id"], "fn-outer", "fn-inner") == BODY_LANES

    def test_a_shared_function_draft_body_stores_the_lanes(self) -> None:
        from wavecore.api.services.functions import service as function_service

        function_service._clear_in_memory_cache()
        library, _etag = function_service.create_function(
            _function_definition({"nodes": [], "edges": []}, name="drafted")
        )
        block = _node("fn-1", "function", "function", "Helper")
        block["data"].update(
            functionLifecycle="shared",
            functionId=library["id"],
            functionVersion="1.0.0",
            editMode=True,
            upstreamLink={"functionId": library["id"], "sourceVersion": "1.0.0"},
            draft=_function_definition(_body_wires("then"), "drafted"),
        )

        result = _save(*_holding(block))

        assert result["repairs"] == [_body_repair(_segment("fn-1", "Helper"))]
        stored = test_service.get_test(result["id"])
        assert stored is not None
        draft = stored["workflow"]["nodes"][0]["data"]["draft"]
        assert _wires(draft["workflow"]["edges"]) == BODY_LANES

    def test_the_create_dry_run_leaves_the_sent_body_as_it_is(self) -> None:
        data = _test_data(*_holding(_local_block("fn-1", _body_wires("then"))))
        sent = copy.deepcopy(data)

        assert test_service.validate_test_data_for_create(data) == []
        assert data == sent

    def test_fix_test_puts_a_local_body_on_its_lanes(self) -> None:
        created = _save(*_holding(_local_block("fn-1", {"nodes": [], "edges": []})))
        nodes, edges = _holding(_local_block("fn-1", _body_wires("then")))
        edges.append(_edge("e-dangling", "fn-1", "gone"))
        test_service._update_raw_test(created["id"], {"workflow": _workflow(nodes, edges)})

        fixed = test_service.fix_test(created["id"])

        assert fixed is not None
        assert _stored_body(created["id"], "fn-1") == BODY_LANES


def _workflow(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return {"nodes": nodes, "edges": edges}


class TestWaitUntilLanesInALibraryFunction:
    """A library Function save puts its Wait Until wires on their lanes as the Test save does."""

    def setup_method(self) -> None:
        from wavecore.api.services.functions import service as function_service

        _reset()
        function_service._clear_in_memory_cache()

    @pytest.mark.parametrize("next_handle", ["then", None])
    def test_post_functions_stores_the_lanes(self, next_handle: str | None) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        client = TestClient(app)
        payload = _function_definition(_body_wires(next_handle), name="wait_lanes")

        created = client.post("/functions", json=payload)

        assert created.status_code == 201, created.text
        stored = client.get(f"/functions/{created.json()['data']['id']}").json()["data"]
        assert _wires(stored["workflow"]["edges"]) == BODY_LANES

    def test_a_body_nested_in_a_library_function_stores_the_lanes(self) -> None:
        from wavecore.api.services.functions import service as function_service

        inner = _local_block("fn-inner", _body_wires("then"), label="Inner")
        workflow = {"nodes": [inner], "edges": [_edge("e-outer", "start-node", "fn-inner")]}

        definition, _etag = function_service.create_function(
            _function_definition(workflow, name="outer_lanes")
        )

        body = definition["workflow"]["nodes"][0]["data"]["localDefinition"]["workflow"]
        assert _wires(body["edges"]) == BODY_LANES

    def test_a_new_library_version_stores_the_lanes(self) -> None:
        from wavecore.api.services.functions import service as function_service

        source, _etag = function_service.create_function(
            _function_definition({"nodes": [], "edges": []}, name="versioned_lanes")
        )

        function_service.add_function_version(
            source["id"],
            source_version="1.0.0",
            target_version="1.0.1",
            draft_definition=_function_definition(_body_wires("then"), name="versioned_lanes"),
            changelog="Wait for the service",
            description="",
            tags=[],
            details="",
        )

        stored, _etag = function_service.read_version(source["id"], "1.0.1")
        assert _wires(stored["workflow"]["edges"]) == BODY_LANES


def _flow_repair() -> dict[str, Any]:
    """The repair of the retry wire removed from the saved flow itself: no function path."""
    repair = _body_repair()
    del repair["function_path"]
    return repair


def _flow_at(where: str) -> dict[str, Any]:
    """A library Function flow holding the lanes body: the flow itself, or one Local body."""
    if where == "flow":
        return _body_wires("then")
    return _workflow(*_holding(_local_block("fn-1", _body_wires("then"))))


FLOW_REPAIRS = {
    "flow": [_flow_repair()],
    "body": [_body_repair(_segment("fn-1", "Helper"))],
}


class TestALibrarySaveReportsTheRemovedRetryWire:
    """A library Function save lists the retry wires the lane rule removed, in the repairs a Test
    save answers with: no function path in the flow itself, the Function Blocks holding the
    body otherwise (REQ-5.2.4.3, REQ-3.5.4.3)."""

    def setup_method(self) -> None:
        from wavecore.api.services.functions import service as function_service

        _reset()
        function_service._clear_in_memory_cache()

    @staticmethod
    def _client() -> Any:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize("where", ["flow", "body"])
    def test_post_functions_lists_the_removed_retry_wire(self, where: str) -> None:
        resp = self._client().post(
            "/functions", json=_function_definition(_flow_at(where), name=f"rep_{where}")
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["repairs"] == FLOW_REPAIRS[where]

    def test_post_functions_lists_a_retry_wire_two_levels_down_with_both_holders(self) -> None:
        inner = _local_block("fn-inner", _body_wires("then"), label="Inner")
        outer = _local_block(
            "fn-outer",
            {"nodes": [inner], "edges": [_edge("e-outer", "start-node", "fn-inner")]},
            label="Outer",
        )

        resp = self._client().post(
            "/functions",
            json=_function_definition(_workflow(*_holding(outer)), name="rep_deep"),
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["repairs"] == [
            _body_repair(_segment("fn-outer", "Outer"), _segment("fn-inner", "Inner"))
        ]

    def test_a_batch_create_lists_the_removed_retry_wire_under_each_created_function(self) -> None:
        items = [
            _function_definition(_flow_at("flow"), name="rep_batch_flow"),
            _function_definition(_flow_at("body"), name="rep_batch_body"),
            _function_definition({"nodes": [], "edges": []}, name=""),
            _function_definition({"nodes": [], "edges": []}, name="rep_batch_none"),
        ]

        resp = self._client().post("/functions/batch", json={"items": items})

        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert [failure["index"] for failure in data["failed"]] == [2]
        flow_id, body_id, clean_id = (definition["id"] for definition in data["created"])
        assert data["repairs"] == {
            flow_id: FLOW_REPAIRS["flow"],
            body_id: FLOW_REPAIRS["body"],
            clean_id: [],
        }
        stored = self._client().get(f"/functions/{flow_id}").json()["data"]
        assert _wires(stored["workflow"]["edges"]) == BODY_LANES

    def test_post_functions_of_a_flow_on_its_lanes_lists_no_repair(self) -> None:
        clean = _body_wires("then")
        clean["edges"] = [e for e in clean["edges"] if e["id"] != BODY_RETRY_WIRE]

        resp = self._client().post("/functions", json=_function_definition(clean, name="rep_none"))

        assert resp.status_code == 201, resp.text
        assert resp.json()["repairs"] == []

    @pytest.mark.parametrize("where", ["flow", "body"])
    def test_a_new_library_version_lists_the_removed_retry_wire(self, where: str) -> None:
        client = self._client()
        name = f"rep_ver_{where}"
        created = client.post(
            "/functions", json=_function_definition({"nodes": [], "edges": []}, name=name)
        )
        assert created.status_code == 201, created.text
        function_id = created.json()["data"]["id"]

        resp = client.post(
            f"/functions/{function_id}/versions",
            json={
                "source_version": "1.0.0",
                "target_version": "1.0.1",
                "draft_definition": _function_definition(_flow_at(where), name=name),
                "changelog": "Wait for the service",
                "description": "",
                "tags": [],
                "details": "",
            },
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["repairs"] == FLOW_REPAIRS[where]
        assert resp.json()["data"] == {"function_id": function_id, "version": "1.0.1"}

    def test_a_local_publish_lists_the_retry_wire_removed_from_the_published_flow(self) -> None:
        created = _save(*_holding(_local_block("fn-1", {"nodes": [], "edges": []})))
        nodes, edges = _holding(_local_block("fn-1", _body_wires("then")))
        test_service._update_raw_test(created["id"], {"workflow": _workflow(nodes, edges)})

        resp = self._client().post(
            f"/tests/{created['id']}/functions/publish",
            json={"node_id": "fn-1", "name": "rep_publish", "changelog": "Initial"},
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["repairs"] == [_flow_repair()]
        stored = self._client().get(f"/functions/{resp.json()['data']['function_id']}")
        assert _wires(stored.json()["data"]["workflow"]["edges"]) == BODY_LANES


WATCH_LABEL = "Watch ready"
STRANDED_LABEL = "Retry log"
STRANDED_MESSAGE = (
    f"Block '{STRANDED_LABEL}' is not reachable from the Function's entry: its only wire came "
    f"from the retry lane of Watch-mode Wait Until '{WATCH_LABEL}', which was removed"
)
UNREACHED_MESSAGE = "Block is not reachable from the Function's entry"


def _stranding_body(
    *extra_nodes: dict[str, Any], extra_edges: tuple[dict[str, Any], ...] = ()
) -> dict[str, Any]:
    """A Function body: a Watch wait whose retry wire is the only way into a Log, and whose next
    wire leads to another Log."""
    nodes = [
        _node("watch", "wait-until", "control", WATCH_LABEL, _wait_values(mode="watch")),
        _log("after-watch"),
        _node("stranded", "log", "plugin", STRANDED_LABEL, {"message": "hi"}),
        *extra_nodes,
    ]
    edges = [
        _edge("e-body-start", "start-node", "watch"),
        _edge(BODY_RETRY_WIRE, "watch", "stranded", "retry"),
        _edge("e-watch-next", "watch", "after-watch"),
        *extra_edges,
    ]
    return {"nodes": nodes, "edges": edges}


def _unreached(errors: list[dict[str, Any]]) -> list[tuple[str | None, str]]:
    return [(e.get("node_id"), e["message"]) for e in errors if e["code"] == "NODE_UNREACHABLE"]


def _refused_save(save: Any) -> list[dict[str, Any]]:
    with pytest.raises(test_service.SaveValidationError) as refused:
        save()
    return refused.value.errors


class TestWaitUntilRetryWireThatStrandsABlockInAFunctionBody:
    """When the save removes a Watch wait's retry wire and that leaves a Block unreached, the
    refusal names the removed wire (REQ-3.5.4.3, REQ-3.1.2.4)."""

    def setup_method(self) -> None:
        from wavecore.api.services.functions import service as function_service

        _reset()
        function_service._clear_in_memory_cache()

    def test_post_functions_names_the_removed_retry_wire(self) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app
        from wavecore.api.services.functions import _storage

        resp = TestClient(app).post(
            "/functions", json=_function_definition(_stranding_body(), name="stranded")
        )

        assert resp.status_code == 422, resp.text
        assert _unreached(resp.json()["error"]["details"]) == [("stranded", STRANDED_MESSAGE)]
        assert [row["name"] for row in _storage.list_function_summaries()] == []

    def test_a_new_library_version_names_the_removed_retry_wire(self) -> None:
        from wavecore.api.services.functions import service as function_service

        source, _etag = function_service.create_function(
            _function_definition({"nodes": [], "edges": []}, name="versioned_stranded")
        )

        draft_definition = _function_definition(_stranding_body(), "versioned_stranded")
        with pytest.raises(function_service.SaveValidationError) as refused:
            function_service.add_function_version(
                source["id"],
                source_version="1.0.0",
                target_version="1.0.1",
                draft_definition=draft_definition,
                changelog="Wait for the service",
                description="",
                tags=[],
                details="",
            )

        assert _unreached(refused.value.errors) == [("stranded", STRANDED_MESSAGE)]
        versions = function_service._storage.list_versions(source["id"])["versions"]
        assert [entry["version"] for entry in versions] == ["1.0.0"]

    def test_post_functions_names_the_removed_retry_wire_in_a_local_body_it_holds(self) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app
        from wavecore.api.services.functions import _storage

        workflow = _workflow(*_holding(_local_block("fn-1", _stranding_body())))
        resp = TestClient(app).post(
            "/functions", json=_function_definition(workflow, name="nested_stranded")
        )

        assert resp.status_code == 422, resp.text
        details = resp.json()["error"]["details"]
        assert _unreached(details) == [("stranded", STRANDED_MESSAGE)]
        unreached = [e for e in details if e["code"] == "NODE_UNREACHABLE"]
        assert unreached[0]["function_path"] == [_segment("fn-1", "Helper")]
        assert unreached[0]["severity"] == "error"
        assert [row["name"] for row in _storage.list_function_summaries()] == []

    def test_a_new_library_version_names_the_removed_retry_wire_in_a_local_body_it_holds(
        self,
    ) -> None:
        from wavecore.api.services.functions import service as function_service

        source, _etag = function_service.create_function(
            _function_definition({"nodes": [], "edges": []}, name="versioned_nested")
        )
        workflow = _workflow(*_holding(_local_block("fn-1", _stranding_body())))

        draft_definition = _function_definition(workflow, "versioned_nested")
        with pytest.raises(function_service.SaveValidationError) as refused:
            function_service.add_function_version(
                source["id"],
                source_version="1.0.0",
                target_version="1.0.1",
                draft_definition=draft_definition,
                changelog="Wait for the service",
                description="",
                tags=[],
                details="",
            )

        assert _unreached(refused.value.errors) == [("stranded", STRANDED_MESSAGE)]
        versions = function_service._storage.list_versions(source["id"])["versions"]
        assert [entry["version"] for entry in versions] == ["1.0.0"]

    def test_a_body_two_levels_down_in_a_library_function_names_the_removed_retry_wire(
        self,
    ) -> None:
        from wavecore.api.services.functions import service as function_service

        inner = _local_block("fn-inner", _stranding_body(), label="Inner")
        outer = _local_block(
            "fn-outer",
            {"nodes": [inner], "edges": [_edge("e-outer", "start-node", "fn-inner")]},
            label="Outer",
        )

        payload = _function_definition(_workflow(*_holding(outer)), name="deep_stranded")
        with pytest.raises(function_service.SaveValidationError) as refused:
            function_service.create_function(payload)

        unreached = [e for e in refused.value.errors if e["code"] == "NODE_UNREACHABLE"]
        assert [(e["node_id"], e["message"]) for e in unreached] == [("stranded", STRANDED_MESSAGE)]
        assert unreached[0]["function_path"] == [
            _segment("fn-outer", "Outer"),
            _segment("fn-inner", "Inner"),
        ]

    def test_a_block_with_no_wire_in_a_local_body_of_a_library_function_keeps_the_plain_finding(
        self,
    ) -> None:
        from wavecore.api.services.functions import service as function_service

        body = _stranding_body(_log("orphan"))

        payload = _function_definition(
            _workflow(*_holding(_local_block("fn-1", body))), name="orphan_nested"
        )
        with pytest.raises(function_service.SaveValidationError) as refused:
            function_service.create_function(payload)

        assert _unreached(refused.value.errors) == [
            ("stranded", STRANDED_MESSAGE),
            ("orphan", UNREACHED_MESSAGE),
        ]

    def test_a_local_body_create_names_the_removed_retry_wire(self) -> None:
        errors = _refused_save(lambda: _save(*_holding(_local_block("fn-1", _stranding_body()))))

        unreached = [e for e in errors if e["code"] == "NODE_UNREACHABLE"]
        assert [(e["node_id"], e["message"]) for e in unreached] == [("stranded", STRANDED_MESSAGE)]
        assert unreached[0]["function_path"] == [_segment("fn-1", "Helper")]
        assert test_service._list_all_tests() == []

    def test_a_local_body_update_names_the_removed_retry_wire(self) -> None:
        created = _save(*_holding(_local_block("fn-1", {"nodes": [], "edges": []})))
        nodes, edges = _holding(_local_block("fn-1", _stranding_body()))

        errors = _refused_save(
            lambda: test_service.update_test(created["id"], {"workflow": _workflow(nodes, edges)})
        )

        assert _unreached(errors) == [("stranded", STRANDED_MESSAGE)]
        assert _stored_body(created["id"], "fn-1") == []

    def test_a_body_nested_in_a_local_body_names_the_removed_retry_wire(self) -> None:
        inner = _local_block("fn-inner", _stranding_body(), label="Inner")
        outer = _local_block(
            "fn-outer",
            {"nodes": [inner], "edges": [_edge("e-outer", "start-node", "fn-inner")]},
            label="Outer",
        )

        errors = _refused_save(lambda: _save(*_holding(outer)))

        unreached = [e for e in errors if e["code"] == "NODE_UNREACHABLE"]
        assert [(e["node_id"], e["message"]) for e in unreached] == [("stranded", STRANDED_MESSAGE)]
        assert unreached[0]["function_path"] == [
            _segment("fn-outer", "Outer"),
            _segment("fn-inner", "Inner"),
        ]

    def test_a_shared_function_draft_body_names_the_removed_retry_wire(self) -> None:
        from wavecore.api.services.functions import service as function_service

        library, _etag = function_service.create_function(
            _function_definition({"nodes": [], "edges": []}, name="drafted_stranded")
        )
        block = _node("fn-1", "function", "function", "Helper")
        block["data"].update(
            functionLifecycle="shared",
            functionId=library["id"],
            functionVersion="1.0.0",
            editMode=True,
            upstreamLink={"functionId": library["id"], "sourceVersion": "1.0.0"},
            draft=_function_definition(_stranding_body(), "drafted_stranded"),
        )

        errors = _refused_save(lambda: _save(*_holding(block)))

        assert _unreached(errors) == [("stranded", STRANDED_MESSAGE)]

    def test_the_create_dry_run_names_the_removed_retry_wire(self) -> None:
        data = _test_data(*_holding(_local_block("fn-1", _stranding_body())))

        errors = test_service.validate_test_data_for_create(data)

        assert _unreached(errors) == [("stranded", STRANDED_MESSAGE)]

    def test_a_block_behind_the_stranded_block_keeps_the_plain_finding(self) -> None:
        body = _stranding_body(
            _log("behind"), extra_edges=(_edge("e-behind", "stranded", "behind"),)
        )

        errors = _refused_save(lambda: _save(*_holding(_local_block("fn-1", body))))

        assert _unreached(errors) == [
            ("stranded", STRANDED_MESSAGE),
            ("behind", UNREACHED_MESSAGE),
        ]

    def test_a_block_with_another_wire_in_keeps_the_plain_finding(self) -> None:
        body = _stranding_body(
            _log("orphan"), extra_edges=(_edge("e-orphan", "orphan", "stranded"),)
        )

        errors = _refused_save(lambda: _save(*_holding(_local_block("fn-1", body))))

        assert _unreached(errors) == [
            ("stranded", UNREACHED_MESSAGE),
            ("orphan", UNREACHED_MESSAGE),
        ]

    def test_a_block_with_no_wire_beside_a_removed_retry_wire_keeps_the_plain_finding(
        self,
    ) -> None:
        body = _stranding_body(_log("orphan"))

        errors = _refused_save(lambda: _save(*_holding(_local_block("fn-1", body))))

        assert _unreached(errors) == [
            ("stranded", STRANDED_MESSAGE),
            ("orphan", UNREACHED_MESSAGE),
        ]
