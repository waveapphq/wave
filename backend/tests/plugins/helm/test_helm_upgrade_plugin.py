"""The Helm Upgrade block (REQ-3.5.3.3).

Upgrade is Install plus helm's values rules: Install if missing, and the Reuse /
Reset pair that is never both set. The sheet keeps them exclusive by unticking
one when the other is ticked; the block refuses the shape anyway, because an
imported or MCP-authored document can carry both.
"""

from pathlib import Path
from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    CHART,
    RELEASE,
    helm_ok,
    helm_params,
    release_json,
)
from tests.plugins.helm._helm_plugin_cases import (
    CHART_FORMS,
    REPO_CA_CERT_DESCRIPTION,
    assert_advanced_rows,
    assert_chart_row,
    assert_family_metadata,
    assert_no_wait_row,
    assert_on_error_row,
    assert_output_core,
    assert_output_format_row,
    assert_result_output,
    assert_session_row,
    assert_timeout_row,
    captured_prepare,
    execute_verb,
    outputs_by_name,
    params_by_name,
    seed_chart,
)
from tests.plugins.k8s._k8s_fixtures import exact
from wavecore.plugins import helm_upgrade
from wavecore.plugins.helm_upgrade import HelmUpgradePlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "release",
    "chart",
    "version",
    "repo",
    "values",
    "set",
    "install",
    "reuse_values",
    "reset_values",
    "output_format",
    "repo_username",
    "repo_password",
    "repo_ca_cert",
    "repo_verify_ssl",
    "namespace",
    "create_namespace",
    "helm_path",
    "impersonate_user",
    "impersonate_groups",
    "atomic",
    "cleanup_on_fail",
    "cleanup_timeout",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["result", "status", "success", "error", "reason"]

BOTH_SET_MESSAGE = "Parameter 'reuse_values' and 'reset_values' cannot both be set"


def _valid(**overrides: Any) -> dict[str, Any]:
    return helm_params(**{"chart": CHART, **overrides})


def _plugin() -> HelmUpgradePlugin:
    return HelmUpgradePlugin()


def _chart_prepare() -> Any:
    """Resolved on call so a missing hook fails its own tests, not this module's collection."""
    from wavecore.plugins._helm_common import prepare

    return prepare


class TestMetadata:
    """Identity, rows and outputs, exactly as the sheet draws them."""

    def test_the_block_declares_the_family_identity(self) -> None:
        assert_family_metadata(_plugin(), "helm-upgrade", "Helm Upgrade")

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

    def test_the_output_format_row_starts_on_table(self) -> None:
        assert_output_format_row(_plugin())

    def test_the_chart_row_is_the_host_path_single_argument(self) -> None:
        assert_chart_row(_plugin())

    def test_the_values_rules_rows_start_off(self) -> None:
        params = params_by_name(_plugin())

        for name in ("install", "reuse_values", "reset_values"):
            assert params[name]["type"] == "boolean"
            assert params[name]["default"] is False

    def test_cleanup_on_fail_joins_atomic(self) -> None:
        params = params_by_name(_plugin())

        assert params["atomic"]["default"] is False
        assert params["cleanup_on_fail"]["default"] is False

    def test_the_repository_password_is_a_declared_secret(self) -> None:
        assert params_by_name(_plugin())["repo_password"]["secret"] is True

    def test_the_repository_ca_help_states_the_trust_rule(self) -> None:
        """REQ-4.5.16."""
        assert params_by_name(_plugin())["repo_ca_cert"]["description"] == (
            REPO_CA_CERT_DESCRIPTION
        )

    def test_the_advanced_rows(self) -> None:
        assert_advanced_rows(_plugin())

    def test_the_failure_handling_row(self) -> None:
        assert_on_error_row(_plugin())

    def test_the_result_follows_the_output_format(self) -> None:
        assert_result_output(_plugin())

    def test_the_output_core_is_gated(self) -> None:
        assert_output_core(_plugin())

    def test_no_wait_row_under_any_name(self) -> None:
        assert_no_wait_row(_plugin())

    def test_no_revision_output(self) -> None:
        assert "revision" not in outputs_by_name(_plugin())


class TestValidation:
    """validate() - the family checks plus the Reuse / Reset exclusion."""

    async def test_the_default_sheet_passes(self) -> None:
        await _plugin().validate(_valid())

    async def test_a_missing_release_is_refused(self) -> None:
        params = _valid()
        params.pop("release")

        with pytest.raises(ValueError, match=exact("Parameter 'release' is required")):
            await _plugin().validate(params)

    async def test_a_missing_chart_is_refused(self) -> None:
        params = _valid()
        params.pop("chart")

        with pytest.raises(ValueError, match=exact("Parameter 'chart' is required")):
            await _plugin().validate(params)

    async def test_a_non_positive_timeout_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await _plugin().validate(_valid(timeout=0))

    @pytest.mark.parametrize("cleanup_timeout", [0, -1])
    async def test_a_non_positive_cleanup_timeout_is_refused(self, cleanup_timeout: int) -> None:
        message = "Parameter 'cleanup_timeout' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_valid(cleanup_timeout=cleanup_timeout))

    async def test_reuse_values_on_its_own_passes(self) -> None:
        await _plugin().validate(_valid(reuse_values=True))

    async def test_reset_values_on_its_own_passes(self) -> None:
        await _plugin().validate(_valid(reset_values=True))

    async def test_both_off_passes(self) -> None:
        await _plugin().validate(_valid(reuse_values=False, reset_values=False))

    async def test_both_set_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(BOTH_SET_MESSAGE)):
            await _plugin().validate(_valid(reuse_values=True, reset_values=True))


class TestExecute:
    """execute() runs the upgrade verb off the loop."""

    async def test_the_verb_receives_the_pinned_argv(self) -> None:
        _outputs, fake = await execute_verb(
            _plugin(), "upgrade", _valid(), [helm_ok(release_json(revision=2))]
        )

        assert fake.argv[:3] == ["upgrade", RELEASE, CHART]

    async def test_install_if_missing_reaches_helm(self) -> None:
        _outputs, fake = await execute_verb(
            _plugin(), "upgrade", _valid(install=True), [helm_ok(release_json(revision=2))]
        )

        assert "--install" in fake.argv

    async def test_the_status_scalar_reaches_the_block(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(), "upgrade", _valid(), [helm_ok(release_json(revision=2))]
        )

        assert outputs["status"] == "deployed"


class TestChartResolution:
    """Upgrade resolves the chart through the same hook Install does."""

    @pytest.mark.parametrize("form", CHART_FORMS)
    async def test_the_argument_helm_runs_with(self, form: str, tmp_path: Path) -> None:
        reference, expected, context = seed_chart(tmp_path, form)

        _outputs, fake = await execute_verb(
            _plugin(),
            "upgrade",
            _valid(chart=reference),
            [helm_ok(release_json(revision=2))],
            **context,
        )

        assert fake.argv[2] == expected

    async def test_the_release_still_leads_the_resolved_chart(self, tmp_path: Path) -> None:
        reference, expected, context = seed_chart(tmp_path, "artifact-folder")

        _outputs, fake = await execute_verb(
            _plugin(),
            "upgrade",
            _valid(chart=reference),
            [helm_ok(release_json(revision=2))],
            **context,
        )

        assert fake.argv[:3] == ["upgrade", RELEASE, expected]

    async def test_the_chart_hook_reaches_the_verb_bridge(self) -> None:
        assert await captured_prepare(helm_upgrade, _plugin(), _valid()) is _chart_prepare()
