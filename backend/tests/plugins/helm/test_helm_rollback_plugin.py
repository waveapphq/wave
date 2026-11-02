"""The Helm Rollback block (REQ-3.5.3.5).

Rollback carries a Release Name, an optional Revision that means "the one before
the current" when it is empty, and Cleanup on Fail. It has no Auth & TLS group,
no Create Namespace and no Atomic, because helm rollback has none of them.
"""

from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    RELEASE,
    helm_ok,
    helm_params,
    history_entry,
    history_json,
    status_json,
)
from tests.plugins.helm._helm_plugin_cases import (
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
from wavecore.plugins.helm_rollback import HelmRollbackPlugin

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "release",
    "revision",
    "output_format",
    "namespace",
    "helm_path",
    "impersonate_user",
    "impersonate_groups",
    "cleanup_on_fail",
    "cleanup_timeout",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["result", "status", "success", "error", "reason"]


def _valid(**overrides: Any) -> dict[str, Any]:
    return helm_params(**overrides)


def _plugin() -> HelmRollbackPlugin:
    return HelmRollbackPlugin()


def _rolled_back() -> list[Any]:
    return [
        helm_ok("Rollback was a success!\n"),
        helm_ok(status_json(revision=3)),
        helm_ok(history_json(history_entry(revision=3))),
    ]


class TestMetadata:
    """Identity, rows and outputs, exactly as the sheet draws them."""

    def test_the_block_declares_the_family_identity(self) -> None:
        assert_family_metadata(_plugin(), "helm-rollback", "Helm Rollback")

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

    def test_the_revision_row_is_an_optional_number(self) -> None:
        revision = params_by_name(_plugin())["revision"]

        assert revision["type"] == "integer"
        assert revision["required"] is False
        assert "default" not in revision

    def test_the_output_format_row_starts_on_table(self) -> None:
        assert_output_format_row(_plugin())

    def test_cleanup_on_fail_starts_off(self) -> None:
        assert params_by_name(_plugin())["cleanup_on_fail"]["default"] is False

    def test_the_advanced_rows(self) -> None:
        assert_advanced_rows(_plugin())

    def test_the_failure_handling_row(self) -> None:
        assert_on_error_row(_plugin())

    def test_the_result_follows_the_output_format(self) -> None:
        assert_result_output(_plugin())

    def test_the_output_core_is_gated(self) -> None:
        assert_output_core(_plugin())


class TestDeliberateAbsences:
    """helm rollback has no chart, no repository and no atomic."""

    def test_no_wait_row_under_any_name(self) -> None:
        assert_no_wait_row(_plugin())

    def test_no_chart_source_rows(self) -> None:
        params = params_by_name(_plugin())

        for name in ("chart", "version", "repo", "values", "set"):
            assert name not in params

    def test_no_auth_and_tls_rows(self) -> None:
        params = params_by_name(_plugin())

        for name in ("repo_username", "repo_password", "repo_ca_cert", "repo_verify_ssl"):
            assert name not in params

    def test_no_create_namespace_row(self) -> None:
        assert "create_namespace" not in params_by_name(_plugin())

    def test_no_atomic_row(self) -> None:
        assert "atomic" not in params_by_name(_plugin())

    def test_no_revision_output(self) -> None:
        assert "revision" not in outputs_by_name(_plugin())


class TestValidation:
    """validate() - the family checks plus the optional revision."""

    async def test_the_default_sheet_passes(self) -> None:
        await _plugin().validate(_valid())

    async def test_a_missing_release_is_refused(self) -> None:
        params = _valid()
        params.pop("release")

        with pytest.raises(ValueError, match=exact("Parameter 'release' is required")):
            await _plugin().validate(params)

    async def test_an_empty_revision_passes(self) -> None:
        await _plugin().validate(_valid(revision=None))

    async def test_a_named_revision_passes(self) -> None:
        await _plugin().validate(_valid(revision=3))

    @pytest.mark.parametrize("revision", [0, -1])
    async def test_a_non_positive_revision_is_refused(self, revision: int) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'revision' must be positive")):
            await _plugin().validate(_valid(revision=revision))

    async def test_a_non_positive_timeout_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await _plugin().validate(_valid(timeout=-5))

    @pytest.mark.parametrize("cleanup_timeout", [0, -1])
    async def test_a_non_positive_cleanup_timeout_is_refused(self, cleanup_timeout: int) -> None:
        message = "Parameter 'cleanup_timeout' must be positive"

        with pytest.raises(ValueError, match=exact(message)):
            await _plugin().validate(_valid(cleanup_timeout=cleanup_timeout))


class TestExecute:
    """execute() runs the rollback verb and its read-back off the loop."""

    async def test_the_verb_receives_the_pinned_argv(self) -> None:
        _outputs, fake = await execute_verb(_plugin(), "rollback", _valid(), _rolled_back())

        assert fake.argv[:2] == ["rollback", RELEASE]

    async def test_a_named_revision_rides_as_a_positional(self) -> None:
        _outputs, fake = await execute_verb(
            _plugin(), "rollback", _valid(revision=2), _rolled_back()
        )

        assert fake.argv[:3] == ["rollback", RELEASE, "2"]

    async def test_the_release_is_read_back(self) -> None:
        outputs, fake = await execute_verb(_plugin(), "rollback", _valid(), _rolled_back())

        assert fake.calls[1].argv[:2] == ["status", RELEASE]
        assert outputs["status"] == "deployed"
