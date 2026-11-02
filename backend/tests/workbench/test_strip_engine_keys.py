"""``__scope_failed`` is an engine key and must be stripped.

The scope-fail signal is the only assert signal missing from the engine-key
strip set, so on the non-adjacency body path (a loop body or try path walked
without nested dispatch) it survives into the result dict that feeds output
bindings.

The Switch container signals (``__switch`` / ``__switch_branches``) join the
same strip set for the same reason.
"""

from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.services.workbench.try_catch import _strip_engine_keys


def _make_node(node_id: str, output_bindings: dict[str, str]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "Assert",
            "elementType": "assert",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {
                    "assertions": [{"type": "expression", "expression": "False"}],
                    "mode": "single",
                    "fail_current_scope": True,
                },
                "outputBindings": output_bindings,
                "profileBindings": [],
            },
            "disabled": False,
            "description": "Assert",
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


class TestStripSet:
    def test_scope_failed_is_stripped(self) -> None:
        result: dict[str, Any] = {"__scope_failed": True, "passed": False}

        _strip_engine_keys(result)

        assert "__scope_failed" not in result

    def test_user_output_is_preserved(self) -> None:
        result: dict[str, Any] = {"__scope_failed": True, "passed": False, "detail": "boom"}

        _strip_engine_keys(result)

        assert result == {"passed": False, "detail": "boom"}

    def test_switch_signals_are_stripped(self) -> None:
        """The Switch trigger and its branch descriptors never reach a binding."""
        result: dict[str, Any] = {
            "__switch": True,
            "__switch_branches": [
                {"id": "branch_0", "type": "case", "label": "", "conditions": [], "break": True},
                {"id": "branch_1", "type": "default", "label": ""},
            ],
            "output": "kept",
        }

        _strip_engine_keys(result)

        assert result == {"output": "kept"}

    def test_previously_stripped_keys_are_still_stripped(self) -> None:
        result: dict[str, Any] = {
            "__scope_failed": True,
            "__branch": "fail",
            "__halt": True,
            "__try_catch": True,
            "__for_each": True,
            "__switch": True,
            "__switch_branches": [],
            "output": "kept",
        }

        _strip_engine_keys(result)

        assert result == {"output": "kept"}

    def test_the_block_warning_signal_is_stripped_and_the_core_survives(self) -> None:
        """A K8s recorded failure binds its outputs, never the amber signal."""
        result: dict[str, Any] = {
            "success": False,
            "error": "K8s Pod 'web-1' not found in namespace 'apps'",
            "reason": "NotFound",
            "__block_warning": True,
        }

        _strip_engine_keys(result)

        assert result == {
            "success": False,
            "error": "K8s Pod 'web-1' not found in namespace 'apps'",
            "reason": "NotFound",
        }

    def test_a_result_without_the_key_is_untouched(self) -> None:
        result: dict[str, Any] = {"passed": True}

        _strip_engine_keys(result)

        assert result == {"passed": True}

    def test_a_non_dict_result_is_ignored(self) -> None:
        assert _strip_engine_keys(None) is None
        assert _strip_engine_keys("not a dict") is None


class TestNonAdjacencyBodyPath:
    """The loop body walker without adjacency binds outputs from the stripped dict."""

    @pytest.fixture(autouse=True)
    def _engine_registries(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls

        _registry.clear()
        register_all_core_controls(_registry)
        yield
        _registry.clear()

    async def test_scope_failed_never_reaches_a_bound_variable(self) -> None:
        from wavecore.api.services.workbench import for_loop as _wb_for_loop
        from wavecore.api.services.workbench.for_loop import _execute_body_node

        node = _make_node("assert-1", {"__scope_failed": "leaked", "passed": "assert_passed"})
        variables: dict[str, Any] = {}
        session: dict[str, Any] = {"block_states": {}, "status": "running"}

        async def fake_execute(nf: Any, variables: Any, sid: str, nid: str) -> Any:
            return {"passed": False, "__scope_failed": True}

        with patch.object(_wb_for_loop, "_execute_node", fake_execute):
            await _execute_body_node(
                path_node_id="assert-1",
                node_map={"assert-1": node},
                variables=variables,
                session=session,
                session_id="strip-1",
                environment_id=None,
            )

        assert "leaked" not in variables
        assert variables["assert_passed"] is False

    async def test_raw_result_still_carries_the_signal_for_the_engine(self) -> None:
        """Stripping is for bindings only; the walker still sees the raw signal."""
        from wavecore.api.services.workbench import for_loop as _wb_for_loop
        from wavecore.api.services.workbench.for_loop import _execute_body_node

        node = _make_node("assert-1", {})
        session: dict[str, Any] = {"block_states": {}, "status": "running"}

        async def fake_execute(nf: Any, variables: Any, sid: str, nid: str) -> Any:
            return {"passed": False, "__scope_failed": True}

        with patch.object(_wb_for_loop, "_execute_node", fake_execute):
            raw_result, error = await _execute_body_node(
                path_node_id="assert-1",
                node_map={"assert-1": node},
                variables={},
                session=session,
                session_id="strip-2",
                environment_id=None,
            )

        assert error is None
        assert raw_result is not None
        assert raw_result["__scope_failed"] is True

    async def test_the_try_path_walker_strips_it_too(self) -> None:
        from wavecore.api.services.workbench import try_catch as _wb_try_catch
        from wavecore.api.services.workbench.try_catch import _execute_single_path_node

        node = _make_node("assert-1", {"__scope_failed": "leaked", "passed": "assert_passed"})
        variables: dict[str, Any] = {}
        session: dict[str, Any] = {"block_states": {}, "status": "running", "skipped_node_ids": []}

        async def fake_execute(nf: Any, variables: Any, sid: str, nid: str) -> Any:
            return {"passed": False, "__scope_failed": True}

        with patch.object(_wb_try_catch, "_execute_node", fake_execute):
            await _execute_single_path_node(
                path_node_id="assert-1",
                node_map={"assert-1": node},
                variables=variables,
                session=session,
                session_id="strip-3",
                executed=set(),
                environment_id=None,
            )

        assert "leaked" not in variables
        assert variables["assert_passed"] is False
