"""Loop bodies honor the documented Fail Current Scope semantics (REQ-3.3.1.5).

A split-mode Assert with Fail Current Scope marks the Test failed and its flow goes on, in a loop
body as anywhere else. A single-mode one fails as a block: the loop fails and the spine after it
never runs. Without the setting a failed Assert paints amber. These tests pin the contract for
every loop kind, for a branch nested inside a loop body, and for the shared status helper the
walkers converge on.
"""

from typing import Any

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

ALWAYS_TRUE: list[dict[str, Any]] = [{"type": "expression", "expression": "True"}]
ALWAYS_FALSE: list[dict[str, Any]] = [{"type": "expression", "expression": "False"}]


def _make_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "Scope Fail Test",
        "scope_failed": False,
    }


def _make_node(
    node_id: str,
    label: str = "Block",
    element_type: str = "delay",
    node_type: str = "control",
    config_values: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    display_name: str | None = None,
) -> dict[str, Any]:
    config: dict[str, Any] = {"values": config_values or {"duration": 10}}
    if output_bindings:
        config["outputBindings"] = output_bindings
    config.setdefault("profileBindings", [])
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
            "displayName": display_name or label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _make_log_node(node_id: str, display_name: str, message: str = "'ok'") -> dict[str, Any]:
    node = _make_node(
        node_id,
        label="Log",
        element_type="log",
        node_type="plugin",
        config_values={"message": message, "level": "INFO"},
        display_name=display_name,
    )
    node["data"]["expressionFields"] = ["message"]
    return node


def _make_assert_node(
    node_id: str,
    expression: str = "False",
    *,
    fail_current_scope: bool = True,
    mode: str = "split",
) -> dict[str, Any]:
    values: dict[str, Any] = {
        "assertions": [{"type": "expression", "expression": expression}],
        "mode": mode,
    }
    if fail_current_scope:
        values["fail_current_scope"] = True
    return _make_node(
        node_id,
        label="Assert",
        element_type="assert",
        node_type="control",
        config_values=values,
        display_name="Assert Check",
    )


def _make_for_each_node(node_id: str, collection: list[Any]) -> dict[str, Any]:
    return _make_node(
        node_id,
        label="For Each",
        element_type="for-each",
        node_type="control",
        config_values={"collection": collection},
        output_bindings={"item": "current_item", "index": "i"},
        display_name="For Each",
    )


def _make_for_node(node_id: str, count: int) -> dict[str, Any]:
    return _make_node(
        node_id,
        label="For Loop",
        element_type="for",
        node_type="control",
        config_values={"mode": "count", "count": count},
        output_bindings={"index": "i"},
        display_name="For Loop",
    )


def _make_while_node(node_id: str, conditions: list[dict[str, Any]]) -> dict[str, Any]:
    return _make_node(
        node_id,
        label="While Loop",
        element_type="while",
        node_type="control",
        config_values={"mode": "do-while", "conditions": conditions},
        output_bindings={"index": "idx"},
        display_name="While Loop",
    )


def _make_if_node(node_id: str) -> dict[str, Any]:
    return _make_node(
        node_id,
        label="If/Else",
        element_type="if-else",
        node_type="control",
        config_values={
            "branches": [{"type": "if", "id": "then", "label": "then", "conditions": ALWAYS_TRUE}]
        },
        display_name="If/Else",
    )


@pytest.fixture(autouse=True)
def _engine_registries() -> Any:
    """Register core controls + the Log plugin like app startup does."""
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


async def _run(
    session_id: str, nodes: list[Any], edges: list[Any], variables: Any
) -> dict[str, Any]:
    _wb_common._workbench_sessions[session_id] = _make_session(session_id)
    await workbench_service._execute_workflow(session_id, nodes, edges, variables)
    return _wb_common._workbench_sessions[session_id]


class TestForEachBodyScopeFail:
    """A ``fail_current_scope`` Assert inside a for-each body."""

    @staticmethod
    def _graph(
        expression: str, *, fail_current_scope: bool = True, mode: str = "split"
    ) -> tuple[list[Any], list[Any]]:
        nodes = [
            _make_for_each_node("fe-1", ["a", "b", "c"]),
            _make_assert_node(
                "body-assert", expression, fail_current_scope=fail_current_scope, mode=mode
            ),
            _make_log_node("body-after", "Body After", "'after-assert'"),
            _make_log_node("spine-log", "Spine", "'spine'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "body-assert", "sourceHandle": "body"},
            {"source": "body-assert", "target": "body-after", "sourceHandle": "fail"},
            {"source": "fe-1", "target": "spine-log", "sourceHandle": "then"},
        ]
        return nodes, edges

    async def _run_graph(
        self,
        session_id: str,
        expression: str,
        *,
        fail_current_scope: bool = True,
        mode: str = "split",
    ) -> dict[str, Any]:
        nodes, edges = self._graph(expression, fail_current_scope=fail_current_scope, mode=mode)
        return await _run(session_id, nodes, edges, {"current_item": None, "i": None})

    async def test_a_single_mode_block_paints_failed(self) -> None:
        session = await self._run_graph("scope-fe-1", "False", mode="single")

        assert session["block_states"]["body-assert"] == "failed"

    async def test_session_scope_failed_flag_is_set(self) -> None:
        session = await self._run_graph("scope-fe-2", "False")

        assert session["scope_failed"] is True

    async def test_the_rest_of_the_body_still_runs(self) -> None:
        session = await self._run_graph("scope-fe-3", "False")

        assert session["block_states"]["body-after"] == "passed"

    async def test_the_spine_after_the_loop_still_runs(self) -> None:
        session = await self._run_graph("scope-fe-4", "False")

        assert session["block_states"]["spine-log"] == "passed"

    async def test_the_run_ends_failed(self) -> None:
        session = await self._run_graph("scope-fe-5", "False")

        assert session["status"] == "failed"

    async def test_a_plain_failed_assert_paints_warning(self) -> None:
        session = await self._run_graph("scope-fe-6", "False", fail_current_scope=False)

        assert session["block_states"]["body-assert"] == "warning"

    async def test_a_plain_failed_assert_leaves_the_run_passed(self) -> None:
        session = await self._run_graph("scope-fe-7", "False", fail_current_scope=False)

        assert session["scope_failed"] is False
        assert session["status"] == "passed"

    async def test_a_passing_assert_still_paints_passed(self) -> None:
        session = await self._run_graph("scope-fe-8", "True")

        assert session["block_states"]["body-assert"] == "passed"
        assert session["status"] == "passed"

    async def test_a_single_mode_failure_on_the_last_pass_paints_failed(self) -> None:
        session = await self._run_graph("scope-fe-9", "i != 2", mode="single")

        assert session["block_states"]["body-assert"] == "failed"
        assert session["status"] == "failed"

    async def test_failing_on_an_earlier_pass_keeps_the_sticky_flag(self) -> None:
        """The paint is per-iteration; the scope-fail flag is not."""
        session = await self._run_graph("scope-fe-10", "i != 0")

        assert session["block_states"]["body-assert"] == "passed"
        assert session["scope_failed"] is True
        assert session["status"] == "failed"

    async def test_a_single_mode_failure_stops_the_loop_and_the_spine(self) -> None:
        session = await self._run_graph("scope-fe-11", "i != 0", mode="single")

        assert session["block_states"]["body-assert"] == "failed"
        assert session["block_states"].get("spine-log") in (None, "skipped")
        assert session["scope_failed"] is False
        assert session["status"] == "failed"


def _single_body_graph(
    loop: dict[str, Any], mode: str, fail_current_scope: bool
) -> tuple[list[Any], list[Any]]:
    loop_id = loop["id"]
    nodes = [
        loop,
        _make_assert_node("body-assert", "False", fail_current_scope=fail_current_scope, mode=mode),
        _make_log_node("spine-log", "Spine", "'spine'"),
    ]
    edges = [
        {"source": "start-node", "target": loop_id},
        {"source": loop_id, "target": "body-assert", "sourceHandle": "body"},
        {"source": loop_id, "target": "spine-log", "sourceHandle": "then"},
    ]
    return nodes, edges


class TestForLoopBodyScopeFail:
    """The counted For loop shares the body walker, so it shares the contract."""

    async def _run_graph(
        self, session_id: str, *, fail_current_scope: bool = True, mode: str = "split"
    ) -> dict[str, Any]:
        nodes, edges = _single_body_graph(_make_for_node("for-1", 2), mode, fail_current_scope)
        return await _run(session_id, nodes, edges, {"i": None})

    async def test_scope_fail_marks_and_fails_the_run(self) -> None:
        session = await self._run_graph("scope-for-1")

        assert session["scope_failed"] is True
        assert session["status"] == "failed"

    async def test_the_spine_after_the_loop_still_runs(self) -> None:
        session = await self._run_graph("scope-for-2")

        assert session["block_states"]["spine-log"] == "passed"

    async def test_a_plain_failed_assert_paints_warning(self) -> None:
        session = await self._run_graph("scope-for-3", fail_current_scope=False)

        assert session["block_states"]["body-assert"] == "warning"
        assert session["status"] == "passed"

    async def test_a_single_mode_failure_fails_the_loop_before_the_spine(self) -> None:
        session = await self._run_graph("scope-for-4", mode="single")

        assert session["block_states"]["body-assert"] == "failed"
        assert session["block_states"].get("spine-log") in (None, "skipped")
        assert session["status"] == "failed"


class TestWhileLoopBodyScopeFail:
    """The While loop body walks the same path."""

    async def _run_graph(
        self, session_id: str, *, fail_current_scope: bool = True, mode: str = "split"
    ) -> dict[str, Any]:
        nodes, edges = _single_body_graph(
            _make_while_node("while-1", ALWAYS_FALSE), mode, fail_current_scope
        )
        return await _run(session_id, nodes, edges, {"idx": None})

    async def test_scope_fail_marks_and_fails_the_run(self) -> None:
        session = await self._run_graph("scope-while-1")

        assert session["scope_failed"] is True
        assert session["status"] == "failed"

    async def test_the_spine_after_the_loop_still_runs(self) -> None:
        session = await self._run_graph("scope-while-2")

        assert session["block_states"]["spine-log"] == "passed"

    async def test_a_plain_failed_assert_paints_warning(self) -> None:
        session = await self._run_graph("scope-while-3", fail_current_scope=False)

        assert session["block_states"]["body-assert"] == "warning"
        assert session["status"] == "passed"

    async def test_a_single_mode_failure_fails_the_loop_before_the_spine(self) -> None:
        session = await self._run_graph("scope-while-4", mode="single")

        assert session["block_states"]["body-assert"] == "failed"
        assert session["block_states"].get("spine-log") in (None, "skipped")
        assert session["status"] == "failed"


class TestNestedBranchInsideALoopBody:
    """A branch chain inside a loop body runs through the same body walker."""

    async def _run_graph(
        self, session_id: str, *, fail_current_scope: bool = True, mode: str = "split"
    ) -> dict[str, Any]:
        nodes = [
            _make_for_each_node("fe-1", ["a", "b"]),
            _make_if_node("if-1"),
            _make_assert_node(
                "then-assert", "False", fail_current_scope=fail_current_scope, mode=mode
            ),
            _make_log_node("spine-log", "Spine", "'spine'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "if-1", "sourceHandle": "body"},
            {"source": "if-1", "target": "then-assert", "sourceHandle": "then"},
            {"source": "fe-1", "target": "spine-log", "sourceHandle": "then"},
        ]
        return await _run(session_id, nodes, edges, {"current_item": None, "i": None})

    async def test_scope_fail_in_the_taken_branch_marks_the_run(self) -> None:
        session = await self._run_graph("scope-nested-1")

        assert session["scope_failed"] is True
        assert session["block_states"]["spine-log"] == "passed"
        assert session["status"] == "failed"

    async def test_a_single_mode_failure_in_the_taken_branch_fails_the_loop(self) -> None:
        session = await self._run_graph("scope-nested-3", mode="single")

        assert session["block_states"]["fe-1"] == "failed"
        assert session["block_states"].get("spine-log") in (None, "skipped")
        assert session["scope_failed"] is False
        assert session["status"] == "failed"

    async def test_a_plain_failed_assert_in_the_branch_paints_warning(self) -> None:
        session = await self._run_graph("scope-nested-2", fail_current_scope=False)

        assert session["block_states"]["then-assert"] == "warning"
        assert session["status"] == "passed"


class TestSharedPostExecuteStatusHelper:
    """The single implementation the three walkers converge on."""

    def test_scope_fail_returns_failed_and_flags_the_session(self) -> None:
        from wavecore.api.services.workbench.signals import resolve_post_execute_status

        session: dict[str, Any] = {"scope_failed": False}
        signals = {"scope_failed": True}

        status = resolve_post_execute_status(
            signals, session, "control", "assert", {"passed": False}
        )

        assert status == "failed"
        assert session["scope_failed"] is True

    def test_a_plain_failed_assert_returns_warning(self) -> None:
        from wavecore.api.services.workbench.signals import resolve_post_execute_status

        session: dict[str, Any] = {"scope_failed": False}
        signals = {"scope_failed": None}

        status = resolve_post_execute_status(
            signals, session, "control", "assert", {"passed": False}
        )

        assert status == "warning"
        assert session["scope_failed"] is False

    def test_a_passing_assert_returns_passed(self) -> None:
        from wavecore.api.services.workbench.signals import resolve_post_execute_status

        signals = {"scope_failed": None}

        status = resolve_post_execute_status(
            signals, {"scope_failed": False}, "control", "assert", {"passed": True}
        )

        assert status == "passed"

    def test_a_plugin_result_carrying_passed_false_is_not_a_warning(self) -> None:
        from wavecore.api.services.workbench.signals import resolve_post_execute_status

        signals = {"scope_failed": None}

        status = resolve_post_execute_status(
            signals, {"scope_failed": False}, "plugin", "log", {"passed": False}
        )

        assert status == "passed"

    def test_a_non_dict_result_returns_passed(self) -> None:
        from wavecore.api.services.workbench.signals import resolve_post_execute_status

        signals = {"scope_failed": None}

        status = resolve_post_execute_status(
            signals, {"scope_failed": False}, "control", "assert", None
        )

        assert status == "passed"

    def test_the_root_walker_delegates_to_the_helper(self) -> None:
        from wavecore.api.services.workbench.signals import _determine_block_status

        session: dict[str, Any] = {"scope_failed": False}
        signals = {"scope_failed": True, "function_skipped": None}

        assert (
            _determine_block_status(signals, session, "control", "assert", {"passed": False})
            == "failed"
        )
        assert session["scope_failed"] is True
