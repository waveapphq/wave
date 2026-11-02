"""A plugin can ask for the amber ``warning`` block status (REQ-3.4.1.5).

``__block_warning`` is the engine signal a plugin returns to say "this block
did not get the result it wanted, and the author pre-authorized that". The
three status-decision points honor it, the run verdict never moves, and a
plugin that merely reports a failure in an output stays green.
"""

import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    FakeK8sClient,
    resource,
    session_value,
)
from wavecore.api.services import log_streaming_service
from wavecore.api.services.reports.builder import build_session_report
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench.execution import _execute_workflow
from wavecore.api.services.workbench.signals import (
    _determine_block_status,
    _extract_engine_signals,
    resolve_nested_final_status,
    resolve_post_execute_status,
)

_CLIENT_TARGET = "wavecore.connectivity.k8s.verbs.get.K8sClient"
_NOT_FOUND = "K8s Pod 'web-1' not found in namespace 'apps'"
_RECORDED_LINE = f"Read failed (NotFound): {_NOT_FOUND}"


def _session(scope_failed: bool = False) -> dict[str, Any]:
    return {"scope_failed": scope_failed}


class TestEngineSignalExtraction:
    """``__block_warning`` rides the dunder channel every walker already reads."""

    def test_the_key_is_popped_off_the_result(self) -> None:
        result: dict[str, Any] = {"success": False, "__block_warning": True}

        _extract_engine_signals(result)

        assert result == {"success": False}

    def test_the_signal_is_reported(self) -> None:
        signals = _extract_engine_signals({"__block_warning": True})

        assert signals["block_warning"] is True

    def test_a_result_without_the_key_reports_none(self) -> None:
        signals = _extract_engine_signals({"success": True})

        assert signals["block_warning"] is None

    def test_a_non_dict_result_reports_none(self) -> None:
        assert _extract_engine_signals("plain text")["block_warning"] is None


class TestResolvePostExecuteStatus:
    """The root and body walkers converge on this helper."""

    def test_a_plugin_carrying_the_signal_paints_warning(self) -> None:
        status = resolve_post_execute_status(
            {"block_warning": True}, _session(), "plugin", "k8s-get", {"success": False}
        )

        assert status == "warning"

    def test_the_same_plugin_without_the_signal_paints_passed(self) -> None:
        status = resolve_post_execute_status(
            {"block_warning": None}, _session(), "plugin", "k8s-get", {"success": False}
        )

        assert status == "passed"

    def test_scope_fail_still_wins_over_the_warning(self) -> None:
        session = _session()

        status = resolve_post_execute_status(
            {"scope_failed": True, "block_warning": True},
            session,
            "plugin",
            "k8s-get",
            {"success": False},
        )

        assert status == "failed"
        assert session["scope_failed"] is True

    def test_a_pending_wait_status_still_wins_over_the_warning(self) -> None:
        session: dict[str, Any] = {"scope_failed": False, "_wait_status": "failed"}

        status = resolve_post_execute_status(
            {"block_warning": True}, session, "plugin", "k8s-get", {"success": False}
        )

        assert status == "failed"

    def test_a_failing_assert_still_paints_warning(self) -> None:
        status = resolve_post_execute_status(
            {"block_warning": None}, _session(), "control", "assert", {"passed": False}
        )

        assert status == "warning"

    def test_a_passing_assert_still_paints_passed(self) -> None:
        status = resolve_post_execute_status(
            {"block_warning": None}, _session(), "control", "assert", {"passed": True}
        )

        assert status == "passed"


class TestDetermineBlockStatus:
    """The skip rewrite only fires on a passed block, so amber survives it."""

    def test_a_warning_block_is_not_rewritten_to_skipped(self) -> None:
        status = _determine_block_status(
            {"block_warning": True, "function_skipped": True},
            _session(),
            "plugin",
            "k8s-get",
            {"success": False},
        )

        assert status == "warning"

    def test_a_passed_block_is_still_rewritten_to_skipped(self) -> None:
        status = _determine_block_status(
            {"block_warning": None, "function_skipped": True},
            _session(),
            "plugin",
            "k8s-get",
            {"success": True},
        )

        assert status == "skipped"


class TestNestedFinalStatus:
    """Try/Catch, Parallel branches, Switch cases, loop bodies and Function bodies share this."""

    @staticmethod
    def _status(signals: dict[str, Any], session: dict[str, Any] | None = None) -> str:
        return resolve_nested_final_status(
            {"scope_failed": None, "block_warning": None, **signals},
            session if session is not None else _session(),
            "plugin",
            "k8s-get",
            {"success": True},
        )

    def test_the_signal_paints_warning_on_a_path_node(self) -> None:
        assert self._status({"block_warning": True}) == "warning"

    def test_no_signal_still_paints_passed(self) -> None:
        assert self._status({"block_warning": None}) == "passed"

    def test_a_scope_fail_still_wins(self) -> None:
        session = _session()

        assert self._status({"block_warning": True, "scope_failed": True}, session) == "failed"
        assert session["scope_failed"] is True


class TestFence:
    """A block that reports its failure in an output only still paints green."""

    @pytest.mark.parametrize(
        "result",
        [
            {"status_code": 500, "body": "boom"},
            {"exit_code": 1, "stderr": "boom"},
            {"success": False, "errors": ["row 3 is not a number"]},
            {"passed": False},
        ],
        ids=["http-500", "ssh-nonzero-exit", "parser-gave-up", "passed-false"],
    )
    def test_a_failure_shaped_result_without_the_signal_paints_passed(
        self, result: dict[str, Any]
    ) -> None:
        status = resolve_post_execute_status(
            _extract_engine_signals(result), _session(), "plugin", "http-client", result
        )

        assert status == "passed"


def _k8s_get_node(node_id: str, on_error: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": "K8s Get",
            "elementType": "k8s-get",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {
                    "session": session_value(),
                    "kind": "Pod",
                    "name": "web-1",
                    "on_error": on_error,
                },
                "profileBindings": [],
            },
            "disabled": False,
            "displayName": "Read the pod",
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


_NOT_FOUND_BODY = {
    "kind": "Status",
    "apiVersion": "v1",
    "status": "Failure",
    "message": 'pods "web-1" not found',
    "reason": "NotFound",
    "code": 404,
}


@pytest.fixture
def _k8s_engine() -> Any:
    """Register the K8s Get plugin the way app startup does."""
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.k8s_get import K8sGetPlugin

    clear_registry()
    register_plugin(K8sGetPlugin())
    yield
    clear_registry()


async def _run_recorded_failure(on_error: str = "record") -> tuple[str, dict[str, Any]]:
    session_id = str(uuid.uuid4())
    _wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "status": "running",
        "test_id": str(uuid.uuid4()),
        "test_name": "K8s Read Test",
        "user_id": _wb_common.DEFAULT_USER_ID,
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "variables": {},
        "secret_variable_names": [],
        "scope_failed": False,
    }
    nodes = [_k8s_get_node("read-1", on_error)]
    edges = [{"source": "start-node", "target": "read-1"}]
    fake = FakeK8sClient(
        responses=[(404, _NOT_FOUND_BODY)],
        resources={"Pod": resource("Pod", "pods")},
    )
    with patch(_CLIENT_TARGET, MagicMock(return_value=fake)):
        await _execute_workflow(session_id, nodes, edges, {})
    return session_id, _wb_common._workbench_sessions[session_id]


@pytest.mark.usefixtures("_k8s_engine")
class TestRecordedFailureThroughTheEngine:
    """The whole path: plugin -> signal -> block status -> session -> report."""

    async def test_the_block_paints_warning(self) -> None:
        _, session = await _run_recorded_failure()

        assert session["block_states"]["read-1"] == "warning"

    async def test_the_run_still_ends_passed(self) -> None:
        _, session = await _run_recorded_failure()

        assert session["scope_failed"] is False
        assert session["status"] == "passed"

    async def test_the_warn_line_is_logged_once(self) -> None:
        session_id, _ = await _run_recorded_failure()

        warns = [
            entry
            for entry in log_streaming_service.get_logs(session_id)
            if entry["level"] == "WARN"
        ]

        assert [entry["message"] for entry in warns] == [_RECORDED_LINE]

    async def test_the_report_carries_the_warning_status_for_the_block(self) -> None:
        session_id, session = await _run_recorded_failure()

        report = build_session_report(session, log_streaming_service.get_logs(session_id))

        assert [block["status"] for block in report["timeline"]["blocks"]] == ["warning"]

    async def test_the_report_lists_no_errors_and_keeps_the_warn_line(self) -> None:
        session_id, session = await _run_recorded_failure()
        logs = log_streaming_service.get_logs(session_id)

        report = build_session_report(session, logs)

        assert report["errors"] == []
        assert _RECORDED_LINE in [entry["message"] for entry in report["logs"]]

    async def test_fail_mode_paints_the_block_red_and_fails_the_run(self) -> None:
        session_id, session = await _run_recorded_failure(on_error="fail")

        assert session["block_states"]["read-1"] == "failed"
        assert session["status"] == "failed"
        assert not [
            entry
            for entry in log_streaming_service.get_logs(session_id)
            if entry["level"] == "WARN"
        ]
