"""The Helm Rollback verb (REQ-3.5.3.5).

helm prints only text for a rollback, so rollback.run reads the release back with
`helm status -o json` once the rollback has landed, and that document is the
block's Result and Status. An empty Revision rolls back to the revision before
the current one, exactly as helm does. helm sends no chart on a release read, so
the Table form takes the Chart and App Version cells from the release history.
"""

import json
from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    APP_VERSION,
    CHART_RELEASE,
    RELEASE,
    STDERR_NOT_FOUND,
    STDERR_UNCLASSIFIED,
    WaveTrust,
    helm_failed,
    helm_ok,
    helm_params,
    helm_timed_out,
    history_entry,
    history_json,
    kubeconfig_with_wave_anchors,
    normalized,
    release_json,
    release_row,
    release_table_envelope,
    session_with_ca,
    status_document,
    status_json,
    workspace_file,
)
from tests.connectivity.helm.verbs._verb_cases import (
    FULL_ADVANCED,
    FULL_IMPERSONATION,
    FULL_NAMESPACE,
    assert_failure_outputs,
    envelope_of,
    outputs_of,
    run_verb,
)
from tests.plugins.k8s._k8s_fixtures import NAMESPACE, RecordingLog, exact
from wavecore.connectivity.helm.verbs import rollback

DEFAULT_ARGV = ["rollback", RELEASE, "--namespace", NAMESPACE, "--timeout", "300s"]
READ_BACK_ARGV = ["status", RELEASE, "--namespace", NAMESPACE, "-o", "json"]
HISTORY_ARGV = ["history", RELEASE, "--namespace", NAMESPACE, "-o", "json"]

FULL_PARAMS: dict[str, Any] = {
    "revision": 4,
    "cleanup_on_fail": True,
    "timeout": 600,
    **FULL_NAMESPACE,
    **FULL_ADVANCED,
}

FULL_ARGV = [
    "rollback",
    RELEASE,
    "4",
    "--namespace",
    "team",
    *FULL_IMPERSONATION,
    "--cleanup-on-fail",
    "--timeout",
    "600s",
]

FULL_READ_BACK_ARGV = ["status", RELEASE, "--namespace", "team", *FULL_IMPERSONATION, "-o", "json"]
FULL_HISTORY_ARGV = ["history", RELEASE, "--namespace", "team", *FULL_IMPERSONATION, "-o", "json"]


def _params(**overrides: Any) -> dict[str, Any]:
    return helm_params(**overrides)


def _rolled_back(**overrides: Any) -> list[Any]:
    """helm's plain-text rollback answer, the read-back document, then the history."""
    return [
        helm_ok("Rollback was a success! Happy Helming!\n"),
        helm_ok(status_json(revision=3, **overrides)),
        helm_ok(history_json(history_entry(revision=3))),
    ]


class TestRollbackArgv:
    """The exact command line, for the default sheet and for every row set."""

    def test_the_default_sheet_emits_the_pinned_argv(self) -> None:
        fake = run_verb(rollback, _params(), _rolled_back())

        assert fake.argv == DEFAULT_ARGV

    def test_every_row_set_emits_the_pinned_argv(self) -> None:
        fake = run_verb(rollback, _params(**FULL_PARAMS), _rolled_back())

        assert fake.argv == FULL_ARGV

    def test_an_empty_revision_emits_no_positional(self) -> None:
        """Empty means the revision before the current one, as helm reads it."""
        fake = run_verb(rollback, _params(revision=None), _rolled_back())

        assert fake.argv[:2] == ["rollback", RELEASE]
        assert fake.argv[2] == "--namespace"

    def test_a_revision_rides_as_a_positional(self) -> None:
        fake = run_verb(rollback, _params(revision=2), _rolled_back())

        assert fake.argv[:3] == ["rollback", RELEASE, "2"]

    def test_no_wait_flag_is_ever_emitted(self) -> None:
        fake = run_verb(rollback, _params(**FULL_PARAMS), _rolled_back())

        assert not [item for item in fake.calls[0].argv if item.startswith("--wait")]

    def test_no_output_flag_is_emitted(self) -> None:
        """helm rollback prints text; the document comes from the read-back."""
        fake = run_verb(rollback, _params(), _rolled_back())

        assert "--output" not in fake.argv
        assert "-o" not in fake.argv

    def test_there_is_no_atomic_row(self) -> None:
        fake = run_verb(rollback, _params(atomic=True), _rolled_back())

        assert "--atomic" not in fake.argv

    def test_there_is_no_create_namespace_row(self) -> None:
        fake = run_verb(rollback, _params(create_namespace=True), _rolled_back())

        assert "--create-namespace" not in fake.argv

    def test_cleanup_on_fail_off_emits_no_flag(self) -> None:
        fake = run_verb(rollback, _params(cleanup_on_fail=False), _rolled_back())

        assert "--cleanup-on-fail" not in fake.argv


class TestRollbackReadBack:
    """The release is read back with helm status once the rollback has landed."""

    def test_the_read_back_is_a_status_call(self) -> None:
        fake = run_verb(rollback, _params(), _rolled_back())

        assert normalized(fake.calls[1]) == READ_BACK_ARGV

    def test_the_read_back_carries_the_same_namespace_and_impersonation(self) -> None:
        fake = run_verb(rollback, _params(**FULL_PARAMS), _rolled_back())

        assert normalized(fake.calls[1]) == FULL_READ_BACK_ARGV

    def test_the_read_back_never_asks_for_a_revision(self) -> None:
        fake = run_verb(rollback, _params(revision=2), _rolled_back())

        assert "--revision" not in normalized(fake.calls[1])

    def test_the_read_back_gets_the_blocks_own_timeout(self) -> None:
        fake = run_verb(rollback, _params(timeout=600), _rolled_back())

        assert fake.calls[1].deadline_s == 600

    def test_the_read_back_never_outlives_a_one_second_block(self) -> None:
        fake = run_verb(rollback, _params(timeout=1), _rolled_back())

        assert fake.calls[1].deadline_s == 1

    def test_the_cleanup_room_never_reaches_the_read_back(self) -> None:
        fake = run_verb(
            rollback, _params(timeout=1, cleanup_on_fail=True, cleanup_timeout=45), _rolled_back()
        )

        assert (fake.calls[0].deadline_s, fake.calls[1].deadline_s) == (46, 1)

    def test_the_read_back_runs_on_the_same_kubeconfig(self) -> None:
        fake = run_verb(rollback, _params(), _rolled_back())

        assert fake.calls[1].kubeconfig == fake.calls[0].kubeconfig

    def test_the_read_back_runs_the_same_executable(self) -> None:
        fake = run_verb(rollback, _params(helm_path="/opt/helm"), _rolled_back())

        assert fake.calls[1].helm_path == "/opt/helm"

    def test_the_rollback_and_its_read_back_are_two_calls(self) -> None:
        fake = run_verb(rollback, _params(output_format="map"), _rolled_back())

        assert len(fake.calls) == 2

    def test_the_kubeconfig_carries_the_session(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(rollback, _params(), _rolled_back())

        assert json.loads(workspace_file(fake.calls[0], "kubeconfig.json")) == (
            kubeconfig_with_wave_anchors()
        )

    def test_a_session_with_its_own_ca_is_carried_verbatim(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(rollback, _params(session=session_with_ca()), _rolled_back())

        assert json.loads(workspace_file(fake.calls[0], "kubeconfig.json")) == json.loads(
            session_with_ca()
        )


class TestRollbackSuccess:
    """The read-back document becomes Result and Status."""

    def test_the_table_form_carries_the_new_revision(self) -> None:
        outputs = outputs_of(rollback, _params(), _rolled_back())

        assert outputs["result"] == release_table_envelope([release_row(revision=3)])

    def test_the_map_form_is_the_document(self) -> None:
        outputs = outputs_of(rollback, _params(output_format="map"), _rolled_back())

        assert outputs["result"] == status_document(revision=3)

    def test_the_json_form_is_the_document_as_text(self) -> None:
        outputs = outputs_of(rollback, _params(output_format="json"), _rolled_back())

        assert json.loads(outputs["result"]) == status_document(revision=3)

    def test_the_yaml_form_rides_the_yaml_envelope(self) -> None:
        outputs = outputs_of(rollback, _params(output_format="yaml"), _rolled_back())

        assert outputs["result"] == {"__wave_type": "yaml", "value": status_document(revision=3)}

    def test_the_status_scalar_is_the_releases_own(self) -> None:
        outputs = outputs_of(rollback, _params(), _rolled_back())

        assert outputs["status"] == "deployed"

    def test_the_outputs_are_the_install_set(self) -> None:
        outputs = outputs_of(rollback, _params(), _rolled_back())

        assert set(outputs) == {"result", "status", "success", "error", "reason"}

    def test_the_console_names_the_release_and_the_revision_it_landed_on(self) -> None:
        log = RecordingLog()

        run_verb(rollback, _params(), _rolled_back(), log=log)

        assert log.entries == [("INFO", f"Rolled release '{RELEASE}' back to revision 3")]

    def test_the_envelope_declares_no_secrets(self) -> None:
        envelope = envelope_of(rollback, _params(), _rolled_back())

        assert envelope["secrets"] == []


class TestRollbackChartCells:
    """helm sends no chart on the read-back, so the Table row takes it from the history."""

    def test_the_table_row_fills_the_chart_and_the_app_version(self) -> None:
        outputs = outputs_of(rollback, _params(), _rolled_back())

        assert outputs["result"]["rows"][0][5:] == [CHART_RELEASE, APP_VERSION]

    def test_the_history_read_emits_the_pinned_argv(self) -> None:
        fake = run_verb(rollback, _params(), _rolled_back())

        assert normalized(fake.calls[2]) == HISTORY_ARGV

    def test_the_history_read_carries_the_same_namespace_and_impersonation(self) -> None:
        fake = run_verb(rollback, _params(**FULL_PARAMS), _rolled_back())

        assert normalized(fake.calls[2]) == FULL_HISTORY_ARGV

    def test_the_history_read_runs_under_the_blocks_own_timeout(self) -> None:
        fake = run_verb(rollback, _params(timeout=600), _rolled_back())

        assert fake.calls[2].deadline_s == 600

    def test_the_row_reports_the_revision_the_rollback_landed_on(self) -> None:
        results = [
            helm_ok("Rollback was a success!\n"),
            helm_ok(status_json(revision=3)),
            helm_ok(
                history_json(
                    history_entry(revision=3, chart="wave-demo-0.1.0", app_version="1.0"),
                    history_entry(revision=4, chart="wave-demo-0.2.0", app_version="2.0"),
                )
            ),
        ]

        outputs = outputs_of(rollback, _params(revision=3), results)

        assert outputs["result"]["rows"][0][5:] == ["wave-demo-0.1.0", "1.0"]

    def test_a_document_result_never_reads_the_history(self) -> None:
        fake = run_verb(rollback, _params(output_format="yaml"), _rolled_back())

        assert len(fake.calls) == 2

    def test_a_read_back_that_carries_its_own_chart_is_not_read_again(self) -> None:
        results = [helm_ok("Rollback was a success!\n"), helm_ok(release_json(revision=3))]

        fake = run_verb(rollback, _params(), results)

        assert len(fake.calls) == 2

    def test_a_refused_history_read_leaves_the_cells_empty(self) -> None:
        results = [
            helm_ok("Rollback was a success!\n"),
            helm_ok(status_json(revision=3)),
            helm_failed(STDERR_UNCLASSIFIED),
        ]

        outputs = outputs_of(rollback, _params(), results)

        assert outputs["result"]["rows"][0][5:] == ["", ""]
        assert outputs["success"] is True


class TestRollbackFailure:
    """A refused rollback never reaches the read-back."""

    def test_a_missing_release_stops_the_block(self) -> None:
        with pytest.raises(ValueError, match="^uninstall: Release not loaded"):
            run_verb(rollback, _params(), [helm_failed(STDERR_NOT_FOUND)])

    def test_a_refused_rollback_is_not_read_back(self) -> None:
        fake = run_verb(rollback, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert len(fake.calls) == 1

    def test_a_recorded_refusal_reports_the_reason(self) -> None:
        outputs = outputs_of(rollback, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert outputs["reason"] == "NotFound"

    def test_a_recorded_refusal_empties_the_result_and_status(self) -> None:
        outputs = outputs_of(rollback, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert outputs["result"] == release_table_envelope()
        assert outputs["status"] == ""

    def test_a_recorded_refusal_writes_a_warning_line(self) -> None:
        log = RecordingLog()

        outputs_of(rollback, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)], log=log)

        assert log.entries[-1][1].startswith("Helm Rollback failed (NotFound): ")

    def test_the_process_deadline_is_the_timeout_itself(self) -> None:
        message = "helm rollback did not finish within 300 s"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(rollback, _params(), [helm_timed_out()])

    def test_a_recorded_deadline_reports_timeout(self) -> None:
        outputs = outputs_of(rollback, _params(on_error="record"), [helm_timed_out()])

        assert_failure_outputs(outputs, "helm rollback did not finish within 300 s", "Timeout")

    def test_a_one_second_timeout_is_the_whole_deadline(self) -> None:
        fake = run_verb(rollback, _params(timeout=1, on_error="record"), [helm_timed_out()])

        assert fake.last.deadline_s == 1

    def test_cleanup_on_fail_buys_the_cleanup_room_on_top(self) -> None:
        fake = run_verb(
            rollback,
            _params(timeout=1, cleanup_on_fail=True, cleanup_timeout=45, on_error="record"),
            [helm_timed_out()],
        )

        assert fake.last.deadline_s == 46

    def test_a_failed_read_back_is_the_blocks_failure(self) -> None:
        results = [helm_ok("Rollback was a success!\n"), helm_failed(STDERR_UNCLASSIFIED)]

        with pytest.raises(ValueError, match=exact("the classifier has no row for this line")):
            run_verb(rollback, _params(), results)

    def test_a_recorded_read_back_failure_empties_the_outputs(self) -> None:
        results = [helm_ok("Rollback was a success!\n"), helm_failed(STDERR_NOT_FOUND)]

        outputs = outputs_of(rollback, _params(on_error="record"), results)

        assert outputs["result"] == release_table_envelope()
        assert outputs["reason"] == "NotFound"

    def test_a_read_back_that_printed_no_document_is_a_failure(self) -> None:
        results = [helm_ok("Rollback was a success!\n"), helm_ok("NAME: web\n")]
        message = "helm status printed no release document"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(rollback, _params(), results)
