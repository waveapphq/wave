"""Coverage for signals.py engine-signal extraction and disabled-pass-through.

The helpers are internal but represent the canonical matrix the engine uses
when a multi-egress control is disabled,
plus the signal contract each container control emits.
"""

from __future__ import annotations

from typing import Any

from wavecore.api.services.workbench.signals import (
    _DIVERGING_ELEMENT_TYPES,
    _THEN_EGRESS_ONLY,
    _cascade_skip_disabled_branches,
    _cascade_skip_under_parent,
    _disabled_pass_through_handles,
    _extract_engine_signals,
    _is_diverging_parent,
    _normalize_element_type,
)


class TestExtractSwitchSignals:
    """The Switch dispatcher trigger rides ``__switch`` / ``__switch_branches``."""

    def test_switch_flag_is_popped_into_the_signals_dict(self) -> None:
        """The control emits a bare trigger; the dispatcher owns evaluation."""
        result: dict[str, Any] = {"__switch": True}

        signals = _extract_engine_signals(result)

        assert signals["switch"] is True
        assert "__switch" not in result

    def test_switch_branches_are_popped_verbatim(self) -> None:
        """Branch descriptors travel in author order with every key preserved."""
        branches = [
            {"id": "branch_0", "type": "case", "label": "", "conditions": [], "break": True},
            {"id": "branch_1", "type": "case", "label": "Slow", "conditions": [], "break": False},
            {"id": "branch_2", "type": "default", "label": ""},
        ]
        result: dict[str, Any] = {"__switch": True, "__switch_branches": branches}

        signals = _extract_engine_signals(result)

        assert signals["switch_branches"] == branches
        assert "__switch_branches" not in result

    def test_both_switch_keys_are_removed_from_the_result(self) -> None:
        """Neither key may survive into the dict that feeds output bindings."""
        result: dict[str, Any] = {"__switch": True, "__switch_branches": [], "kept": 1}

        _extract_engine_signals(result)

        assert result == {"kept": 1}

    def test_a_result_without_the_switch_keys_yields_none(self) -> None:
        signals = _extract_engine_signals({"passed": True})

        assert signals["switch"] is None
        assert signals["switch_branches"] is None

    def test_a_non_dict_result_yields_the_switch_defaults(self) -> None:
        assert _extract_engine_signals(None)["switch"] is None
        assert _extract_engine_signals(None)["switch_branches"] is None
        assert _extract_engine_signals("not a dict")["switch"] is None
        assert _extract_engine_signals("not a dict")["switch_branches"] is None


class TestExtractWaitUntilSignals:
    """Wait Until's round parameters ride their own keys.

    The deadline MUST NOT ride ``__timeout``: that key routes a control through
    ``_dispatch_loop``'s ``asyncio.wait_for`` path, which fails the session on
    expiry - the exact opposite of the Assert-shaped outcome Wait Until gives.
    """

    def test_wait_flag_is_popped_into_the_signals_dict(self) -> None:
        result: dict[str, Any] = {"__wait_until": True}

        signals = _extract_engine_signals(result)

        assert signals["wait_until"] is True
        assert "__wait_until" not in result

    def test_the_condition_list_rides_the_shared_condition_key(self) -> None:
        conditions = [{"id": "c-1", "type": "expression", "expression": "ready"}]
        result: dict[str, Any] = {"__wait_until": True, "__condition": conditions}

        signals = _extract_engine_signals(result)

        assert signals["condition"] == conditions

    def test_the_wait_deadline_is_extracted(self) -> None:
        signals = _extract_engine_signals({"__wait_until": True, "__wait_timeout": 30000})

        assert signals["wait_timeout"] == 30000

    def test_the_wait_deadline_never_leaks_into_the_loop_timeout(self) -> None:
        # Guard: a regression here silently reroutes every Wait Until through
        # the loop-failure path and fails the session on a timeout.
        signals = _extract_engine_signals({"__wait_until": True, "__wait_timeout": 30000})

        assert signals["timeout"] is None

    def test_the_check_interval_is_extracted(self) -> None:
        signals = _extract_engine_signals({"__wait_until": True, "__check_interval": 250})

        assert signals["check_interval"] == 250

    def test_the_timeout_message_is_extracted(self) -> None:
        signals = _extract_engine_signals({"__wait_until": True, "__wait_message": "gave up"})

        assert signals["wait_message"] == "gave up"

    def test_the_fail_scope_choice_is_extracted(self) -> None:
        signals = _extract_engine_signals({"__wait_until": True, "__wait_fail_scope": True})

        assert signals["wait_fail_scope"] is True

    def test_the_wait_mode_rides_the_shared_mode_key(self) -> None:
        signals = _extract_engine_signals({"__wait_until": True, "__mode": "watch"})

        assert signals["while_mode"] == "watch"

    def test_every_wait_key_is_removed_from_the_result(self) -> None:
        result: dict[str, Any] = {
            "__wait_until": True,
            "__condition": [],
            "__wait_timeout": 1000,
            "__check_interval": 10,
            "__wait_message": "gave up",
            "__wait_fail_scope": False,
            "__mode": "retry",
            "kept": 1,
        }

        _extract_engine_signals(result)

        assert result == {"kept": 1}

    def test_a_result_without_the_wait_keys_yields_none(self) -> None:
        signals = _extract_engine_signals({"passed": True})

        assert signals["wait_until"] is None
        assert signals["wait_timeout"] is None
        assert signals["check_interval"] is None
        assert signals["wait_message"] is None
        assert signals["wait_fail_scope"] is None

    def test_a_non_dict_result_yields_the_wait_defaults(self) -> None:
        assert _extract_engine_signals(None)["wait_until"] is None
        assert _extract_engine_signals("not a dict")["wait_timeout"] is None


class TestWaitUntilIsAThenEgressContainer:
    """A disabled Wait Until cascade-skips its retry lane, `then` survives."""

    def test_wait_until_is_a_then_egress_container(self) -> None:
        assert "wait-until" in _THEN_EGRESS_ONLY

    def test_wait_until_is_not_a_diverging_element(self) -> None:
        assert "wait-until" not in _DIVERGING_ELEMENT_TYPES

    def test_a_disabled_wait_cascades_every_non_then_descendant(self) -> None:
        node = {"data": {"elementType": "wait-until", "nodeType": "control"}}

        assert _disabled_pass_through_handles(node) == frozenset()

    def test_a_disabled_wait_skips_its_retry_lane_and_spares_then(self) -> None:
        session: dict[str, Any] = {"skipped_node_ids": [], "block_states": {}}
        adj = {
            "wait-1": [("retry-a", "retry"), ("after", "then")],
            "retry-a": [("retry-b", None)],
            "retry-b": [],
            "after": [],
        }
        node = {"data": {"elementType": "wait-until", "nodeType": "control"}}

        _cascade_skip_disabled_branches(session, adj, node, "wait-1")

        assert session["block_states"]["retry-a"] == "skipped"
        assert session["block_states"]["retry-b"] == "skipped"
        assert "after" not in session["skipped_node_ids"]


class TestSwitchIsAContainerNotDiverging:
    """Switch leaves the diverging set and joins the then-egress set."""

    def test_switch_is_a_then_egress_container(self) -> None:
        assert "switch" in _THEN_EGRESS_ONLY

    def test_switch_is_not_a_diverging_element(self) -> None:
        # Guard: Switch back in the diverging set would refuse Skip-while-paused.
        assert "switch" not in _DIVERGING_ELEMENT_TYPES

    def test_is_diverging_parent_is_false_for_a_switch_case_node(self) -> None:
        """The canvas value ``switch-case`` normalizes to ``switch`` and is not diverging."""
        node = {"data": {"elementType": "switch-case", "nodeType": "control"}}

        assert _is_diverging_parent("control", _normalize_element_type(node)) is False

    def test_is_diverging_parent_is_still_true_for_if_else(self) -> None:
        node = {"data": {"elementType": "if-else", "nodeType": "control"}}

        assert _is_diverging_parent("control", _normalize_element_type(node)) is True

    def test_is_diverging_parent_is_still_true_for_assert_split(self) -> None:
        node = {
            "data": {
                "elementType": "assert",
                "nodeType": "control",
                "config": {"values": {"mode": "split"}},
            }
        }

        assert _is_diverging_parent("control", _normalize_element_type(node)) is True


class TestAssertModeReadsItsDeclaredDefault:
    """An Assert with no stored mode runs on the declared default, split (REQ-3.5.0.3)."""

    def test_an_assert_with_no_stored_mode_reads_as_split(self) -> None:
        node = {"data": {"elementType": "assert", "nodeType": "control", "config": {"values": {}}}}

        assert _normalize_element_type(node) == "assert-split"

    def test_an_assert_with_no_config_reads_as_split(self) -> None:
        node = {"data": {"elementType": "assert", "nodeType": "control"}}

        assert _normalize_element_type(node) == "assert-split"

    def test_an_assert_stored_single_reads_as_single(self) -> None:
        node = {
            "data": {
                "elementType": "assert",
                "nodeType": "control",
                "config": {"values": {"mode": "single"}},
            }
        }

        assert _normalize_element_type(node) == "assert-single"


class TestDisabledPassThroughHandles:
    """The matrix returns the handle to keep enabled when the parent is muted."""

    def test_assert_split_keeps_pass_handle(self) -> None:
        node = {
            "data": {
                "elementType": "assert-split",
                "nodeType": "control",
            }
        }
        result = _disabled_pass_through_handles(node)
        assert result == frozenset({"pass"})

    def test_try_catch_finally_returns_empty_set(self) -> None:
        node = {
            "data": {
                "elementType": "try-catch-finally",
                "nodeType": "control",
            }
        }
        assert _disabled_pass_through_handles(node) == frozenset()

    def test_for_loop_returns_empty_set(self) -> None:
        node = {
            "data": {
                "elementType": "for",
                "nodeType": "control",
            }
        }
        assert _disabled_pass_through_handles(node) == frozenset()

    def test_if_else_keeps_first_branch_id(self) -> None:
        node = {
            "data": {
                "elementType": "if-else",
                "nodeType": "control",
                "config": {
                    "values": {
                        "branches": [
                            {"id": "branch_a"},
                            {"id": "branch_b"},
                        ]
                    }
                },
            }
        }
        assert _disabled_pass_through_handles(node) == frozenset({"branch_a"})

    def test_if_else_with_no_branches_returns_empty(self) -> None:
        node = {
            "data": {
                "elementType": "if-else",
                "nodeType": "control",
                "config": {"values": {"branches": []}},
            }
        }
        assert _disabled_pass_through_handles(node) == frozenset()

    def test_if_else_with_branch_missing_id_returns_empty(self) -> None:
        node = {
            "data": {
                "elementType": "if-else",
                "nodeType": "control",
                "config": {"values": {"branches": [{"label": "x"}]}},
            }
        }
        assert _disabled_pass_through_handles(node) == frozenset()

    def test_switch_case_returns_empty_set(self) -> None:
        # A disabled Switch mutes every case and the default; 'then' continues.
        node = {
            "data": {
                "elementType": "switch-case",
                "nodeType": "control",
            }
        }
        assert _disabled_pass_through_handles(node) == frozenset()

    def test_single_egress_control_returns_none(self) -> None:
        # The "we don't need pass-through routing" sentinel: plain
        # child-enqueue is the pass-through for single-egress controls.
        node = {
            "data": {
                "elementType": "halt",
                "nodeType": "control",
            }
        }
        assert _disabled_pass_through_handles(node) is None

    def test_non_control_node_returns_none(self) -> None:
        node = {
            "data": {
                "elementType": "log",
                "nodeType": "plugin",
            }
        }
        assert _disabled_pass_through_handles(node) is None


class TestCascadeSkipDisabledBranches:
    """The cascade helper delegates only when ``adj`` and ``keep_handles`` are set."""

    def test_no_op_when_adj_is_none(self) -> None:
        session: dict[str, Any] = {}
        node = {
            "data": {
                "elementType": "assert-split",
                "nodeType": "control",
            }
        }
        _cascade_skip_disabled_branches(session, None, node, "node-1")
        assert session == {}

    def test_no_op_for_single_egress_control(self) -> None:
        # Single-egress nodes get ``None`` from the matrix - the cascade
        # helper short-circuits without mutating ``session``.
        session: dict[str, Any] = {}
        adj: dict[str, list[tuple[str, str | None]]] = {"node-1": [("child", None)]}
        node = {
            "data": {
                "elementType": "halt",
                "nodeType": "control",
            }
        }
        _cascade_skip_disabled_branches(session, adj, node, "node-1")
        assert "block_states" not in session

    def test_assert_split_cascades_only_fail_handle_descendants(self) -> None:
        # Assert(split) keeps ``pass``; ``fail`` descendant is cascaded.
        session: dict[str, Any] = {
            "skipped_node_ids": [],
            "block_states": {},
        }
        adj = {
            "assert-1": [
                ("pass-target", "pass"),
                ("fail-target", "fail"),
            ],
            "pass-target": [],
            "fail-target": [],
        }
        node = {
            "data": {
                "elementType": "assert-split",
                "nodeType": "control",
            }
        }
        _cascade_skip_disabled_branches(session, adj, node, "assert-1")
        # The 'pass' descendant must NOT be cascaded; 'fail' must.
        assert "pass-target" not in session["skipped_node_ids"]
        assert "fail-target" in session["skipped_node_ids"]

    def test_switch_case_cascades_every_case_and_the_default(self) -> None:
        """A disabled Switch mutes all cases and the default, sparing 'then'."""
        session: dict[str, Any] = {
            "skipped_node_ids": [],
            "block_states": {},
        }
        adj = {
            "sw-1": [
                ("case-a", "branch_0"),
                ("case-b", "branch_1"),
                ("default-a", "branch_2"),
                ("after", "then"),
            ],
            "case-a": [],
            "case-b": [],
            "default-a": [],
            "after": [],
        }
        node = {
            "data": {
                "elementType": "switch-case",
                "nodeType": "control",
            }
        }
        _cascade_skip_disabled_branches(session, adj, node, "sw-1")
        for muted in ("case-a", "case-b", "default-a"):
            assert muted in session["skipped_node_ids"]
            assert session["block_states"][muted] == "skipped"
        assert "after" not in session["skipped_node_ids"]


class TestCascadeSkipUnderParentKeepHandles:
    """The ``keep_handles`` argument excludes branches reached via those handles."""

    def test_handle_in_keep_handles_is_excluded(self) -> None:
        session: dict[str, Any] = {"skipped_node_ids": [], "block_states": {}}
        adj = {
            "parent": [
                ("kept-child", "pass"),
                ("skipped-child", "fail"),
            ],
            "kept-child": [],
            "skipped-child": [],
        }
        _cascade_skip_under_parent(
            session,
            adj,
            parent_node_id="parent",
            keep_handles=frozenset({"pass"}),
        )
        assert "kept-child" not in session["skipped_node_ids"]
        assert "skipped-child" in session["skipped_node_ids"]
