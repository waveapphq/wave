"""The Helm Status verb (REQ-3.5.3.4).

status.run reads a release, current or by revision, into Result and into the
scalar Status output that Wait Until polls. Timeout on this block is WAVE's bound
on the read, not helm's operation timeout: helm status has no timeout flag, so
none is emitted. helm sends no chart on a release read, so the Table form takes
the Chart and App Version cells from the release history.
"""

import json
from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    APP_VERSION,
    CHART_RELEASE,
    RELEASE,
    STDERR_CLUSTER_UNREACHABLE,
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
from wavecore.connectivity.helm.verbs import status

DEFAULT_ARGV = ["status", RELEASE, "--namespace", NAMESPACE, "-o", "json"]
DEFAULT_HISTORY_ARGV = ["history", RELEASE, "--namespace", NAMESPACE, "-o", "json"]

FULL_PARAMS: dict[str, Any] = {
    "revision": 2,
    "timeout": 60,
    **FULL_NAMESPACE,
    **FULL_ADVANCED,
}

FULL_ARGV = [
    "status",
    RELEASE,
    "--revision",
    "2",
    "--namespace",
    "team",
    *FULL_IMPERSONATION,
    "-o",
    "json",
]

FULL_HISTORY_ARGV = [
    "history",
    RELEASE,
    "--namespace",
    "team",
    *FULL_IMPERSONATION,
    "-o",
    "json",
]


def _params(**overrides: Any) -> dict[str, Any]:
    return helm_params(**overrides)


def _read(revision: int = 1, **overrides: Any) -> list[Any]:
    """The release helm read back, then the history the Chart cells come from."""
    return [
        helm_ok(status_json(revision=revision, **overrides)),
        helm_ok(history_json(history_entry(revision=revision))),
    ]


class TestStatusArgv:
    """The exact command line, for the default sheet and for every row set."""

    def test_the_default_sheet_emits_the_pinned_argv(self) -> None:
        fake = run_verb(status, _params(), _read())

        assert fake.argv == DEFAULT_ARGV

    def test_every_row_set_emits_the_pinned_argv(self) -> None:
        fake = run_verb(status, _params(**FULL_PARAMS), _read())

        assert fake.argv == FULL_ARGV

    def test_an_empty_revision_reads_the_current_one(self) -> None:
        fake = run_verb(status, _params(revision=None), _read())

        assert "--revision" not in fake.argv

    def test_no_timeout_flag_is_emitted(self) -> None:
        """helm status has no timeout flag; Timeout here is WAVE's own bound."""
        fake = run_verb(status, _params(timeout=45), _read())

        assert "--timeout" not in fake.argv

    def test_no_wait_flag_is_ever_emitted(self) -> None:
        fake = run_verb(status, _params(**FULL_PARAMS), _read())

        assert not [item for item in fake.calls[0].argv if item.startswith("--wait")]

    def test_a_blank_namespace_falls_back_to_the_session_namespace(self) -> None:
        fake = run_verb(status, _params(namespace="  "), _read())

        assert fake.argv[fake.argv.index("--namespace") + 1] == NAMESPACE

    def test_the_release_itself_is_read_with_one_call(self) -> None:
        fake = run_verb(status, _params(output_format="map"), _read())

        assert len(fake.calls) == 1

    def test_the_kubeconfig_carries_the_session(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(status, _params(), _read())

        assert json.loads(workspace_file(fake.last, "kubeconfig.json")) == (
            kubeconfig_with_wave_anchors()
        )

    def test_a_session_with_its_own_ca_is_carried_verbatim(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(status, _params(session=session_with_ca()), _read())

        assert json.loads(workspace_file(fake.last, "kubeconfig.json")) == json.loads(
            session_with_ca()
        )

    def test_the_default_read_budget_is_thirty_seconds(self) -> None:
        fake = run_verb(status, _params(), _read())

        assert fake.calls[0].deadline_s == 30

    def test_the_read_budget_follows_the_timeout_row(self) -> None:
        fake = run_verb(status, _params(timeout=45), _read())

        assert fake.calls[0].deadline_s == 45

    def test_the_helm_path_reaches_the_runner(self) -> None:
        fake = run_verb(status, _params(helm_path="/opt/helm"), _read())

        assert fake.last.helm_path == "/opt/helm"


class TestStatusSuccess:
    """The release document becomes Result and the scalar Wait Until polls."""

    def test_the_table_form_is_the_release_row(self) -> None:
        outputs = outputs_of(status, _params(), _read())

        assert outputs["result"] == release_table_envelope([release_row()])

    def test_the_map_form_is_the_document(self) -> None:
        outputs = outputs_of(status, _params(output_format="map"), _read())

        assert outputs["result"] == status_document()

    def test_the_json_form_is_the_document_as_text(self) -> None:
        outputs = outputs_of(status, _params(output_format="json"), _read())

        assert json.loads(outputs["result"]) == status_document()

    def test_the_yaml_form_rides_the_yaml_envelope(self) -> None:
        outputs = outputs_of(status, _params(output_format="yaml"), _read())

        assert outputs["result"] == {"__wave_type": "yaml", "value": status_document()}

    @pytest.mark.parametrize(
        "state",
        [
            "deployed",
            "failed",
            "pending-install",
            "pending-upgrade",
            "pending-rollback",
            "superseded",
            "uninstalled",
        ],
    )
    def test_every_release_state_reaches_the_scalar(self, state: str) -> None:
        outputs = outputs_of(status, _params(), _read(status=state))

        assert outputs["status"] == state

    def test_a_superseded_revision_reads_its_own_document(self) -> None:
        outputs = outputs_of(status, _params(revision=2), _read(revision=2, status="superseded"))

        assert outputs["result"]["rows"][0][2] == 2

    def test_the_outputs_are_the_read_set(self) -> None:
        outputs = outputs_of(status, _params(), _read())

        assert set(outputs) == {"result", "status", "success", "error", "reason"}

    def test_the_console_names_the_release_and_the_revision_it_read(self) -> None:
        log = RecordingLog()

        run_verb(status, _params(), _read(revision=2), log=log)

        assert log.entries == [("INFO", f"Read release '{RELEASE}' at revision 2")]

    def test_the_envelope_declares_no_secrets(self) -> None:
        envelope = envelope_of(status, _params(), _read())

        assert envelope["secrets"] == []


class TestStatusChartCells:
    """helm sends no chart on a release read, so the Table row takes it from the history."""

    def test_the_table_row_fills_the_chart_and_the_app_version(self) -> None:
        outputs = outputs_of(status, _params(), _read())

        assert outputs["result"]["rows"][0][5:] == [CHART_RELEASE, APP_VERSION]

    def test_the_history_read_emits_the_pinned_argv(self) -> None:
        fake = run_verb(status, _params(), _read())

        assert normalized(fake.calls[1]) == DEFAULT_HISTORY_ARGV

    def test_the_history_read_carries_the_same_namespace_and_impersonation(self) -> None:
        fake = run_verb(status, _params(**FULL_PARAMS), _read(revision=2))

        assert normalized(fake.calls[1]) == FULL_HISTORY_ARGV

    def test_the_history_read_emits_no_revision_limit(self) -> None:
        """--max is not on every helm the blocks support; the whole history is read."""
        fake = run_verb(status, _params(), _read())

        assert "--max" not in normalized(fake.calls[1])

    def test_the_history_read_never_asks_for_a_revision(self) -> None:
        fake = run_verb(status, _params(revision=2), _read(revision=2))

        assert "--revision" not in normalized(fake.calls[1])

    def test_the_history_read_runs_under_the_blocks_own_timeout(self) -> None:
        fake = run_verb(status, _params(timeout=600), _read())

        assert fake.calls[1].deadline_s == 600

    def test_neither_read_outlives_a_one_second_block(self) -> None:
        fake = run_verb(status, _params(timeout=1), _read())

        assert [call.deadline_s for call in fake.calls] == [1, 1]

    def test_the_history_read_runs_on_the_same_kubeconfig(self) -> None:
        fake = run_verb(status, _params(), _read())

        assert fake.calls[1].kubeconfig == fake.calls[0].kubeconfig

    def test_a_named_revision_reports_the_chart_that_revision_came_from(self) -> None:
        results = [
            helm_ok(status_json(revision=2)),
            helm_ok(
                history_json(
                    history_entry(revision=1, chart="wave-demo-0.1.0", app_version="1.0"),
                    history_entry(revision=2, chart="wave-demo-0.2.0", app_version="2.0"),
                    history_entry(revision=3, chart="wave-demo-0.3.0", app_version="3.0"),
                )
            ),
        ]

        outputs = outputs_of(status, _params(revision=2), results)

        assert outputs["result"]["rows"][0][5:] == ["wave-demo-0.2.0", "2.0"]

    @pytest.mark.parametrize("shape", ["map", "json", "yaml"])
    def test_a_document_result_never_reads_the_history(self, shape: str) -> None:
        fake = run_verb(status, _params(output_format=shape), _read())

        assert len(fake.calls) == 1

    def test_a_document_that_carries_its_own_chart_is_not_read_twice(self) -> None:
        fake = run_verb(status, _params(), [helm_ok(release_json())])

        assert len(fake.calls) == 1

    def test_a_document_that_carries_its_own_chart_keeps_it(self) -> None:
        outputs = outputs_of(status, _params(), [helm_ok(release_json())])

        assert outputs["result"]["rows"][0][5:] == [CHART_RELEASE, APP_VERSION]

    def test_a_refused_history_read_leaves_the_cells_empty(self) -> None:
        results = [helm_ok(status_json()), helm_failed(STDERR_UNCLASSIFIED)]

        outputs = outputs_of(status, _params(), results)

        assert outputs["result"]["rows"][0][5:] == ["", ""]

    def test_a_refused_history_read_never_fails_the_block(self) -> None:
        results = [helm_ok(status_json()), helm_failed(STDERR_UNCLASSIFIED)]

        outputs = outputs_of(status, _params(), results)

        assert outputs["success"] is True
        assert outputs["status"] == "deployed"

    def test_a_history_that_is_not_json_leaves_the_cells_empty(self) -> None:
        results = [helm_ok(status_json()), helm_ok("REVISION\tUPDATED\n1\tFri\n")]

        outputs = outputs_of(status, _params(), results)

        assert outputs["result"]["rows"][0][5:] == ["", ""]

    def test_a_history_that_is_a_json_object_leaves_the_cells_empty(self) -> None:
        results = [helm_ok(status_json()), helm_ok(json.dumps({"revision": 1}))]

        outputs = outputs_of(status, _params(), results)

        assert outputs["result"]["rows"][0][5:] == ["", ""]

    def test_a_history_without_the_revision_that_was_read_leaves_the_cells_empty(self) -> None:
        results = [helm_ok(status_json(revision=4)), helm_ok(history_json(history_entry()))]

        outputs = outputs_of(status, _params(), results)

        assert outputs["result"]["rows"][0][5:] == ["", ""]


class TestStatusFailure:
    """A release that is not there is how a workflow checks it is gone."""

    def test_a_missing_release_stops_the_block(self) -> None:
        message = "uninstall: Release not loaded: web: release: not found"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(status, _params(), [helm_failed(STDERR_NOT_FOUND)])

    def test_a_recorded_missing_release_is_the_existence_check(self) -> None:
        outputs = outputs_of(status, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert_failure_outputs(
            outputs, "uninstall: Release not loaded: web: release: not found", "NotFound"
        )

    def test_a_recorded_refusal_empties_the_result_and_status(self) -> None:
        outputs = outputs_of(status, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert outputs["result"] == release_table_envelope()
        assert outputs["status"] == ""

    def test_an_unreachable_cluster_reads_as_unreachable(self) -> None:
        outputs = outputs_of(
            status, _params(on_error="record"), [helm_failed(STDERR_CLUSTER_UNREACHABLE)]
        )

        assert outputs["reason"] == "Unreachable"

    def test_a_recorded_refusal_writes_a_warning_line(self) -> None:
        log = RecordingLog()

        outputs_of(status, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)], log=log)

        assert log.entries[-1][1].startswith("Helm Status failed (NotFound): ")

    def test_the_process_deadline_is_the_read_budget_itself(self) -> None:
        message = "helm status did not finish within 30 s"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(status, _params(), [helm_timed_out()])

    def test_a_recorded_deadline_reports_timeout(self) -> None:
        outputs = outputs_of(status, _params(on_error="record"), [helm_timed_out()])

        assert_failure_outputs(outputs, "helm status did not finish within 30 s", "Timeout")

    def test_a_one_second_read_is_killed_at_one_second(self) -> None:
        message = "helm status did not finish within 1 s"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(status, _params(timeout=1), [helm_timed_out()])

    def test_a_read_that_printed_no_document_is_a_failure(self) -> None:
        message = "helm status printed no release document"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(status, _params(), [helm_ok("NAME: web\nSTATUS: deployed\n")])
