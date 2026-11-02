"""The Helm Test block (REQ-3.5.3.2).

Test runs the chart's test hooks and reports one Result row per hook. The Logs
output only exists while the Logs toggle is on, and a failed test under Record and
continue still fills Result and Logs - they are what the test is for.
"""

from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    POD_LOGS_BLOCK,
    RELEASE,
    STDERR_TEST_FAILED,
    TEST_STDOUT,
    helm_failed,
    helm_ok,
    helm_params,
    release_json,
    test_hook,
)
from tests.plugins.helm._helm_plugin_cases import (
    RECORD_GATE,
    assert_advanced_rows,
    assert_family_metadata,
    assert_no_wait_row,
    assert_on_error_row,
    assert_output_core,
    assert_output_format_row,
    assert_result_output,
    assert_session_row,
    assert_timeout_row,
    execute_verb,
    outputs_by_name,
    params_by_name,
)
from tests.plugins.k8s._k8s_fixtures import exact
from wavecore.core.table import Table
from wavecore.plugins.helm_test import HelmTestPlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "release",
    "logs",
    "output_format",
    "namespace",
    "helm_path",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["result", "logs", "success", "error", "reason"]

LOGS_GATE = {"field": "logs", "values": ["true"]}


def _valid(**overrides: Any) -> dict[str, Any]:
    return helm_params(**overrides)


def _plugin() -> HelmTestPlugin:
    return HelmTestPlugin()


def _tested(phase: str = "Succeeded") -> list[Any]:
    return [helm_ok(TEST_STDOUT), helm_ok(release_json(hooks=[test_hook(phase=phase)]))]


class TestMetadata:
    """Identity, rows and outputs, exactly as the sheet draws them."""

    def test_the_block_declares_the_family_identity(self) -> None:
        assert_family_metadata(_plugin(), "helm-test", "Helm Test")

    def test_the_rows_are_the_pinned_order(self) -> None:
        names = [param["name"] for param in _plugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_the_outputs_are_the_pinned_order(self) -> None:
        names = [output["name"] for output in _plugin().metadata["output_schema"]]

        assert names == EXPECTED_OUTPUT_ORDER

    def test_the_session_row(self) -> None:
        assert_session_row(_plugin())

    def test_the_timeout_is_helms_operation_timeout(self) -> None:
        assert_timeout_row(_plugin(), 300, helm_operation=True)

    def test_the_logs_row_starts_off(self) -> None:
        logs = params_by_name(_plugin())["logs"]

        assert logs["type"] == "boolean"
        assert logs["default"] is False

    def test_the_output_format_row_starts_on_table(self) -> None:
        assert_output_format_row(_plugin())

    def test_the_advanced_rows(self) -> None:
        assert_advanced_rows(_plugin())

    def test_the_failure_handling_row(self) -> None:
        assert_on_error_row(_plugin())

    def test_the_result_follows_the_output_format(self) -> None:
        assert_result_output(_plugin())

    def test_the_logs_output_is_gated_on_the_logs_row(self) -> None:
        logs = outputs_by_name(_plugin())["logs"]

        assert logs["type"] == "string"
        assert logs["show_when"] == LOGS_GATE

    def test_the_output_core_is_gated(self) -> None:
        assert_output_core(_plugin())

    def test_the_error_outputs_keep_the_record_gate(self) -> None:
        outputs = outputs_by_name(_plugin())

        assert outputs["error"]["show_when"] == RECORD_GATE


class TestDeliberateAbsences:
    """helm test --filter is ruled out by design, and there is no Status scalar."""

    def test_no_wait_row_under_any_name(self) -> None:
        assert_no_wait_row(_plugin())

    def test_no_filter_row(self) -> None:
        names = [param["name"] for param in _plugin().metadata["parameters"]]

        assert [name for name in names if "filter" in name] == []

    def test_no_status_output(self) -> None:
        assert "status" not in outputs_by_name(_plugin())


class TestValidation:
    """validate() - the family checks."""

    async def test_the_default_sheet_passes(self) -> None:
        await _plugin().validate(_valid())

    async def test_a_missing_release_is_refused(self) -> None:
        params = _valid()
        params.pop("release")

        with pytest.raises(ValueError, match=exact("Parameter 'release' is required")):
            await _plugin().validate(params)

    async def test_a_non_positive_timeout_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await _plugin().validate(_valid(timeout=0))

    async def test_an_unknown_output_format_is_refused(self) -> None:
        with pytest.raises(ValueError, match="output_format"):
            await _plugin().validate(_valid(output_format="csv"))


class TestExecute:
    """execute() runs the test verb and its read-back off the loop."""

    async def test_the_verb_receives_the_pinned_argv(self) -> None:
        _outputs, fake = await execute_verb(_plugin(), "test", _valid(), _tested())

        assert fake.argv[:2] == ["test", RELEASE]

    async def test_the_logs_flag_reaches_helm(self) -> None:
        _outputs, fake = await execute_verb(_plugin(), "test", _valid(logs=True), _tested())

        assert "--logs" in fake.argv

    async def test_the_result_is_the_hooks_table(self) -> None:
        outputs, _fake = await execute_verb(_plugin(), "test", _valid(), _tested())

        assert isinstance(outputs["result"], Table)
        assert outputs["result"].col_names() == [
            "Name",
            "Kind",
            "Phase",
            "Started",
            "Completed",
        ]

    async def test_the_logs_output_is_empty_while_logs_is_off(self) -> None:
        outputs, _fake = await execute_verb(_plugin(), "test", _valid(), _tested())

        assert outputs["logs"] == ""

    async def test_the_logs_output_carries_the_pod_sections(self) -> None:
        outputs, _fake = await execute_verb(_plugin(), "test", _valid(logs=True), _tested())

        assert outputs["logs"] == POD_LOGS_BLOCK

    async def test_a_failed_hook_stops_the_block(self) -> None:
        results = [
            helm_failed(STDERR_TEST_FAILED, stdout=TEST_STDOUT),
            helm_ok(release_json(hooks=[test_hook(phase="Failed")])),
        ]

        with pytest.raises(ValueError, match=exact("pod web-wave-demo-test failed")):
            await execute_verb(_plugin(), "test", _valid(), results)

    async def test_a_recorded_failure_still_hands_back_the_data(self) -> None:
        results = [
            helm_failed(STDERR_TEST_FAILED, stdout=TEST_STDOUT),
            helm_ok(release_json(hooks=[test_hook(phase="Failed")])),
        ]

        outputs, _fake = await execute_verb(
            _plugin(), "test", _valid(on_error="record", logs=True), results
        )

        assert outputs["success"] is False
        assert outputs["logs"] == POD_LOGS_BLOCK
        assert isinstance(outputs["result"], Table)
