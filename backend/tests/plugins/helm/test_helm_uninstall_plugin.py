"""The Helm Uninstall block (REQ-3.5.3.5).

Uninstall is the cleanup counterpart of Install: Keep History, Ignore Not Found
and Cascade carry the same names and defaults as K8s Delete, and the block reports
the shared output core alone - there is no release left to describe.
"""

from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    RELEASE,
    STDERR_NOT_FOUND,
    helm_failed,
    helm_ok,
    helm_params,
)
from tests.plugins.helm._helm_plugin_cases import (
    assert_advanced_rows,
    assert_family_metadata,
    assert_no_wait_row,
    assert_on_error_row,
    assert_output_core,
    assert_session_row,
    assert_timeout_row,
    execute_verb,
    outputs_by_name,
    params_by_name,
)
from tests.plugins.k8s._k8s_fixtures import exact
from wavecore.plugins.helm_uninstall import HelmUninstallPlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "release",
    "keep_history",
    "ignore_not_found",
    "cascade",
    "namespace",
    "helm_path",
    "impersonate_user",
    "impersonate_groups",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["success", "error", "reason"]

UNINSTALLED = 'release "web" uninstalled\n'


def _valid(**overrides: Any) -> dict[str, Any]:
    return helm_params(**overrides)


def _plugin() -> HelmUninstallPlugin:
    return HelmUninstallPlugin()


class TestMetadata:
    """Identity, rows and outputs, exactly as the sheet draws them."""

    def test_the_block_declares_the_family_identity(self) -> None:
        assert_family_metadata(_plugin(), "helm-uninstall", "Helm Uninstall")

    def test_the_rows_are_the_pinned_order(self) -> None:
        names = [param["name"] for param in _plugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_the_outputs_are_the_core_alone(self) -> None:
        names = [output["name"] for output in _plugin().metadata["output_schema"]]

        assert names == EXPECTED_OUTPUT_ORDER

    def test_the_session_row(self) -> None:
        assert_session_row(_plugin())

    def test_the_timeout_is_helms_operation_timeout(self) -> None:
        assert_timeout_row(_plugin(), 300, helm_operation=True)

    def test_the_two_toggles_start_off(self) -> None:
        params = params_by_name(_plugin())

        for name in ("keep_history", "ignore_not_found"):
            assert params[name]["type"] == "boolean"
            assert params[name]["default"] is False

    def test_the_cascade_row_matches_k8s_delete(self) -> None:
        cascade = params_by_name(_plugin())["cascade"]

        assert cascade["enum_values"] == ["background", "foreground", "orphan"]
        assert cascade["default"] == "background"

    def test_the_advanced_rows(self) -> None:
        assert_advanced_rows(_plugin())

    def test_the_failure_handling_row(self) -> None:
        assert_on_error_row(_plugin())

    def test_the_output_core_is_gated(self) -> None:
        assert_output_core(_plugin())


class TestDeliberateAbsences:
    """Nothing describes a release that no longer exists."""

    def test_no_wait_row_under_any_name(self) -> None:
        assert_no_wait_row(_plugin())

    def test_no_output_format_row(self) -> None:
        assert "output_format" not in params_by_name(_plugin())

    def test_no_result_or_status_output(self) -> None:
        outputs = outputs_by_name(_plugin())

        assert "result" not in outputs
        assert "status" not in outputs

    def test_no_output_declares_type_rules(self) -> None:
        for output in _plugin().metadata["output_schema"]:
            assert "type_when" not in output


class TestValidation:
    """validate() - the family checks and the cascade enum."""

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

    @pytest.mark.parametrize("cascade", ["background", "foreground", "orphan"])
    async def test_every_cascade_value_passes(self, cascade: str) -> None:
        await _plugin().validate(_valid(cascade=cascade))

    async def test_an_unknown_cascade_value_is_refused(self) -> None:
        with pytest.raises(ValueError, match="cascade"):
            await _plugin().validate(_valid(cascade="delete"))


class TestExecute:
    """execute() runs the uninstall verb off the loop."""

    async def test_the_verb_receives_the_pinned_argv(self) -> None:
        _outputs, fake = await execute_verb(
            _plugin(), "uninstall", _valid(), [helm_ok(UNINSTALLED)]
        )

        assert fake.argv[:2] == ["uninstall", RELEASE]

    async def test_the_cascade_reaches_helm(self) -> None:
        _outputs, fake = await execute_verb(
            _plugin(), "uninstall", _valid(cascade="foreground"), [helm_ok(UNINSTALLED)]
        )

        assert fake.argv[fake.argv.index("--cascade") + 1] == "foreground"

    async def test_a_successful_uninstall_reports_the_core_alone(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(), "uninstall", _valid(), [helm_ok(UNINSTALLED)]
        )

        assert outputs == {"success": True, "error": "", "reason": ""}

    async def test_a_missing_release_stops_the_block(self) -> None:
        message = "uninstall: Release not loaded: web: release: not found"

        with pytest.raises(ValueError, match=exact(message)):
            await execute_verb(_plugin(), "uninstall", _valid(), [helm_failed(STDERR_NOT_FOUND)])

    async def test_a_recorded_missing_release_reads_as_not_found(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(), "uninstall", _valid(on_error="record"), [helm_failed(STDERR_NOT_FOUND)]
        )

        assert outputs["success"] is False
        assert outputs["reason"] == "NotFound"
