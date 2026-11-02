"""The Helm Status block (REQ-3.5.3.4).

Status reads a release, current or by revision, into Result and into the scalar a
Wait Until polls. Its Timeout is WAVE's bound on the read, not helm's operation
timeout: helm status has no timeout of its own.
"""

from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    RELEASE,
    STDERR_NOT_FOUND,
    helm_failed,
    helm_ok,
    helm_params,
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
from wavecore.core.table import Table
from wavecore.plugins.helm_status import HelmStatusPlugin

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
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["result", "status", "success", "error", "reason"]


def _valid(**overrides: Any) -> dict[str, Any]:
    return helm_params(**overrides)


def _plugin() -> HelmStatusPlugin:
    return HelmStatusPlugin()


def _read(revision: int = 1) -> list[Any]:
    """The chartless release helm reads back, then the history the Chart cells come from."""
    return [helm_ok(status_json(revision=revision)), helm_ok(history_json())]


class TestMetadata:
    """Identity, rows and outputs, exactly as the sheet draws them."""

    def test_the_block_declares_the_family_identity(self) -> None:
        assert_family_metadata(_plugin(), "helm-status", "Helm Status")

    def test_the_rows_are_the_pinned_order(self) -> None:
        names = [param["name"] for param in _plugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_the_outputs_are_the_pinned_order(self) -> None:
        names = [output["name"] for output in _plugin().metadata["output_schema"]]

        assert names == EXPECTED_OUTPUT_ORDER

    def test_the_session_row(self) -> None:
        assert_session_row(_plugin())

    def test_the_timeout_is_waves_own_read_bound(self) -> None:
        assert_timeout_row(_plugin(), 30, helm_operation=False)

    def test_the_revision_row_is_an_optional_number(self) -> None:
        revision = params_by_name(_plugin())["revision"]

        assert revision["type"] == "integer"
        assert revision["required"] is False
        assert "default" not in revision

    def test_the_output_format_row_starts_on_table(self) -> None:
        assert_output_format_row(_plugin())

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
    """A read carries no write controls."""

    def test_no_wait_row_under_any_name(self) -> None:
        assert_no_wait_row(_plugin())

    def test_no_atomic_or_cleanup_rows(self) -> None:
        params = params_by_name(_plugin())

        for name in ("atomic", "cleanup_on_fail", "create_namespace"):
            assert name not in params

    def test_no_chart_source_rows(self) -> None:
        params = params_by_name(_plugin())

        for name in ("chart", "version", "repo", "values", "set"):
            assert name not in params


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

    @pytest.mark.parametrize("revision", [0, -2])
    async def test_a_non_positive_revision_is_refused(self, revision: int) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'revision' must be positive")):
            await _plugin().validate(_valid(revision=revision))

    async def test_a_non_positive_timeout_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'timeout' must be positive")):
            await _plugin().validate(_valid(timeout=0))


class TestExecute:
    """execute() runs the status verb off the loop."""

    async def test_the_verb_receives_the_pinned_argv(self) -> None:
        _outputs, fake = await execute_verb(_plugin(), "status", _valid(), _read())

        assert fake.argv == ["status", RELEASE, "--namespace", "apps", "-o", "json"]

    async def test_a_named_revision_reaches_helm(self) -> None:
        _outputs, fake = await execute_verb(
            _plugin(), "status", _valid(revision=2), _read(revision=2)
        )

        assert fake.argv[2:4] == ["--revision", "2"]

    async def test_the_read_budget_is_the_timeout_row(self) -> None:
        _outputs, fake = await execute_verb(_plugin(), "status", _valid(), _read())

        assert fake.calls[0].deadline_s == 30

    async def test_the_table_result_becomes_a_wave_table(self) -> None:
        outputs, _fake = await execute_verb(_plugin(), "status", _valid(), _read())

        assert isinstance(outputs["result"], Table)

    async def test_the_status_scalar_reaches_the_block(self) -> None:
        outputs, _fake = await execute_verb(_plugin(), "status", _valid(), _read())

        assert outputs["status"] == "deployed"

    async def test_a_missing_release_under_record_is_the_existence_check(self) -> None:
        outputs, _fake = await execute_verb(
            _plugin(), "status", _valid(on_error="record"), [helm_failed(STDERR_NOT_FOUND)]
        )

        assert outputs["success"] is False
        assert outputs["reason"] == "NotFound"
        assert outputs["status"] == ""

    async def test_a_missing_release_stops_the_block_by_default(self) -> None:
        message = "uninstall: Release not loaded: web: release: not found"

        with pytest.raises(ValueError, match=exact(message)):
            await execute_verb(_plugin(), "status", _valid(), [helm_failed(STDERR_NOT_FOUND)])
