"""The Helm Install block (REQ-3.5.3.1).

Install declares the chart-source rows, the chart-repository Auth & TLS group and
Atomic, and hands the work to the install verb. Its Result follows Output Format,
which starts on Table; Error and Reason are gated on Record and continue.
"""

from pathlib import Path
from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    CHART,
    RELEASE,
    STDERR_STILL_IN_USE,
    helm_failed,
    helm_ok,
    helm_params,
    release_json,
)
from tests.plugins.helm._helm_plugin_cases import (
    BARE_CHART,
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
from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    exact,
    execute_context,
)
from wavecore.core.table import Table
from wavecore.plugins import helm_install
from wavecore.plugins.helm_install import HelmInstallPlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "release",
    "chart",
    "version",
    "repo",
    "values",
    "set",
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
    "cleanup_timeout",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["result", "status", "success", "error", "reason"]


def _valid(**overrides: Any) -> dict[str, Any]:
    return helm_params(**{"chart": CHART, **overrides})


def _plugin() -> HelmInstallPlugin:
    return HelmInstallPlugin()


def _chart_prepare() -> Any:
    """Resolved on call so a missing hook fails its own tests, not this module's collection."""
    from wavecore.plugins._helm_common import prepare

    return prepare


class TestMetadata:
    """Identity, rows and outputs, exactly as the sheet draws them."""

    def test_the_block_declares_the_family_identity(self) -> None:
        assert_family_metadata(_plugin(), "helm-install", "Helm Install")

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

    def test_the_release_and_chart_rows_are_required(self) -> None:
        params = params_by_name(_plugin())

        assert params["release"]["required"] is True
        assert params["chart"]["required"] is True

    def test_only_the_session_release_and_chart_are_required(self) -> None:
        params = params_by_name(_plugin())
        required = [name for name in EXPECTED_PARAM_ORDER if params[name].get("required")]

        assert required == ["session", "release", "chart"]

    def test_the_chart_row_is_the_host_path_single_argument(self) -> None:
        assert_chart_row(_plugin())

    def test_the_chart_source_rows_are_optional_text(self) -> None:
        params = params_by_name(_plugin())

        for name in ("version", "repo", "values"):
            assert params[name]["type"] == "string"
            assert params[name]["required"] is False

    def test_the_set_row_is_a_map(self) -> None:
        assert params_by_name(_plugin())["set"]["type"] == "map"

    def test_the_output_format_row_starts_on_table(self) -> None:
        assert_output_format_row(_plugin())

    def test_the_repository_password_is_a_declared_secret(self) -> None:
        assert params_by_name(_plugin())["repo_password"]["secret"] is True

    def test_no_other_row_is_a_declared_secret(self) -> None:
        params = params_by_name(_plugin())
        secrets = [name for name in EXPECTED_PARAM_ORDER if params[name].get("secret")]

        assert secrets == ["session", "repo_password"]

    def test_certificate_verification_starts_on(self) -> None:
        assert params_by_name(_plugin())["repo_verify_ssl"]["default"] is True

    def test_the_repository_ca_help_states_the_trust_rule(self) -> None:
        """REQ-4.5.16."""
        assert params_by_name(_plugin())["repo_ca_cert"]["description"] == (
            REPO_CA_CERT_DESCRIPTION
        )

    def test_every_other_toggle_starts_off(self) -> None:
        params = params_by_name(_plugin())

        for name in ("create_namespace", "atomic"):
            assert params[name]["type"] == "boolean"
            assert params[name]["default"] is False

    def test_the_advanced_rows(self) -> None:
        assert_advanced_rows(_plugin())

    def test_the_failure_handling_row(self) -> None:
        assert_on_error_row(_plugin())

    def test_the_result_follows_the_output_format(self) -> None:
        assert_result_output(_plugin())

    def test_the_status_output_is_a_string(self) -> None:
        assert outputs_by_name(_plugin())["status"]["type"] == "string"

    def test_the_output_core_is_gated(self) -> None:
        assert_output_core(_plugin())


class TestDeliberateAbsences:
    """What the sheet does not carry, on purpose."""

    def test_no_wait_row_under_any_name(self) -> None:
        assert_no_wait_row(_plugin())

    def test_no_revision_output(self) -> None:
        assert "revision" not in outputs_by_name(_plugin())

    def test_no_dry_run_or_force_row(self) -> None:
        names = [param["name"] for param in _plugin().metadata["parameters"]]

        assert [name for name in names if "dry_run" in name or "force" in name] == []

    def test_the_only_number_rows_are_the_two_timeouts(self) -> None:
        params = params_by_name(_plugin())
        integers = [name for name in EXPECTED_PARAM_ORDER if params[name]["type"] == "integer"]

        assert integers == ["timeout", "cleanup_timeout"]


class TestValidation:
    """validate() - the session, the enums, the required rows and the numbers."""

    async def test_the_default_sheet_passes(self) -> None:
        await _plugin().validate(_valid())

    async def test_a_missing_session_is_refused(self) -> None:
        params = _valid()
        params.pop("session")

        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await _plugin().validate(params)

    async def test_a_session_that_resolved_to_nothing_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await _plugin().validate(_valid(session=""))

    async def test_groups_without_a_user_are_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await _plugin().validate(_valid(impersonate_groups="qa"))

    async def test_a_missing_release_is_refused(self) -> None:
        params = _valid()
        params.pop("release")

        with pytest.raises(ValueError, match=exact("Parameter 'release' is required")):
            await _plugin().validate(params)

    async def test_a_blank_release_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'release' is required")):
            await _plugin().validate(_valid(release="   "))

    async def test_a_missing_chart_is_refused(self) -> None:
        params = _valid()
        params.pop("chart")

        with pytest.raises(ValueError, match=exact("Parameter 'chart' is required")):
            await _plugin().validate(params)

    async def test_a_blank_chart_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'chart' is required")):
            await _plugin().validate(_valid(chart=""))

    @pytest.mark.parametrize("timeout", [0, -1])
    async def test_a_non_positive_timeout_is_refused(self, timeout: int) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await _plugin().validate(_valid(timeout=timeout))

    @pytest.mark.parametrize("cleanup_timeout", [0, -1])
    async def test_a_non_positive_cleanup_timeout_is_refused(self, cleanup_timeout: int) -> None:
        message = "Parameter 'cleanup_timeout' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_valid(cleanup_timeout=cleanup_timeout))

    async def test_an_unknown_output_format_is_refused(self) -> None:
        with pytest.raises(ValueError, match="output_format"):
            await _plugin().validate(_valid(output_format="csv"))

    async def test_an_unknown_failure_handling_value_is_refused(self) -> None:
        with pytest.raises(ValueError, match="on_error"):
            await _plugin().validate(_valid(on_error="ignore"))


class TestExecute:
    """execute() runs the install verb off the loop and materializes its envelope."""

    async def test_the_verb_receives_the_pinned_argv(self) -> None:
        _outputs, fake = await execute_verb(
            _plugin(), "install", _valid(), [helm_ok(release_json())]
        )

        assert fake.argv[:3] == ["install", RELEASE, CHART]

    async def test_the_table_result_becomes_a_wave_table(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(), "install", _valid(), [helm_ok(release_json())]
        )

        assert isinstance(outputs["result"], Table)

    async def test_the_table_carries_helms_own_list_columns(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(), "install", _valid(), [helm_ok(release_json())]
        )

        assert outputs["result"].col_names() == [
            "Name",
            "Namespace",
            "Revision",
            "Updated",
            "Status",
            "Chart",
            "App Version",
        ]

    async def test_the_revision_column_is_typed_integer(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(), "install", _valid(), [helm_ok(release_json())]
        )

        assert outputs["result"].col_types()[2] == "integer"

    async def test_the_yaml_format_materializes_as_text(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(), "install", _valid(output_format="yaml"), [helm_ok(release_json())]
        )

        assert isinstance(outputs["result"], str)
        assert "status: deployed" in outputs["result"]

    async def test_the_status_scalar_reaches_the_block(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(), "install", _valid(), [helm_ok(release_json())]
        )

        assert outputs["status"] == "deployed"

    async def test_a_refusal_stops_the_block(self) -> None:
        message = "INSTALL FAILED: cannot re-use a name that is still in use"

        with pytest.raises(ValueError, match=exact(message)):
            await execute_verb(_plugin(), "install", _valid(), [helm_failed(STDERR_STILL_IN_USE)])

    async def test_a_recorded_refusal_reaches_the_block_as_data(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(),
            "install",
            _valid(on_error="record"),
            [helm_failed(STDERR_STILL_IN_USE)],
        )

        assert outputs["success"] is False
        assert outputs["reason"] == "AlreadyExists"


class TestChartResolution:
    """A WAVE-side chart resolves to an absolute path; every other form is helm's own."""

    @pytest.mark.parametrize("form", CHART_FORMS)
    async def test_the_argument_helm_runs_with(self, form: str, tmp_path: Path) -> None:
        reference, expected, context = seed_chart(tmp_path, form)

        _outputs, fake = await execute_verb(
            _plugin(),
            "install",
            _valid(chart=reference),
            [helm_ok(release_json())],
            **context,
        )

        assert fake.argv[2] == expected

    async def test_the_release_still_leads_the_resolved_chart(self, tmp_path: Path) -> None:
        reference, expected, context = seed_chart(tmp_path, "artifact-archive")

        _outputs, fake = await execute_verb(
            _plugin(),
            "install",
            _valid(chart=reference),
            [helm_ok(release_json())],
            **context,
        )

        assert fake.argv[:3] == ["install", RELEASE, expected]

    async def test_the_chart_hook_reaches_the_verb_bridge(self) -> None:
        assert await captured_prepare(helm_install, _plugin(), _valid()) is _chart_prepare()

    def test_the_chart_hook_masks_nothing(self) -> None:
        params = _valid(chart=BARE_CHART)

        prepared, values = _chart_prepare()(params, execute_context(params))

        assert values == []
        assert prepared["chart"] == BARE_CHART

    def test_an_empty_chart_is_left_for_validation_to_name(self) -> None:
        params = _valid(chart="")

        prepared, _values = _chart_prepare()(params, execute_context(params))

        assert prepared["chart"] == ""

    def test_a_repository_name_that_exists_under_the_home_folder_is_the_local_chart(
        self, server_home: Path
    ) -> None:
        (server_home / BARE_CHART).mkdir(parents=True)
        params = _valid(chart=BARE_CHART)

        prepared, _values = _chart_prepare()(params, execute_context(params))

        assert prepared["chart"] == str(server_home / BARE_CHART)

    def test_the_hook_leaves_every_other_row_alone(self, tmp_path: Path) -> None:
        reference, expected, context = seed_chart(tmp_path, "artifact-archive")
        params = _valid(chart=reference, version="0.1.0", repo="https://charts.example.com")

        prepared, _values = _chart_prepare()(params, execute_context(params, **context))

        assert prepared["chart"] == expected
        assert prepared["version"] == "0.1.0"
        assert prepared["repo"] == "https://charts.example.com"

    def test_a_chart_that_names_no_file_is_refused(self, tmp_path: Path) -> None:
        params = _valid(chart="testdata://absent.tgz")
        context = execute_context(params, testdata_dirs=[str(tmp_path)])

        with pytest.raises(FileNotFoundError):
            _chart_prepare()(params, context)
