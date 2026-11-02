"""The Helm Test verb (REQ-3.5.3.2).

test.run runs the chart's test hooks and reports one row per hook, read back from
the release record rather than parsed out of helm's text. With Logs ticked it also
hands back every test pod's log under helm's own per-pod headers. The one
deliberate difference from the family: a failed test under Record and continue
still fills Result and Logs, because they are what the test is for.
"""

import json
from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    POD_LOGS_BLOCK,
    RELEASE,
    STDERR_NOT_FOUND,
    STDERR_TEST_FAILED,
    TEST_STDOUT,
    WaveTrust,
    helm_failed,
    helm_ok,
    helm_params,
    helm_timed_out,
    kubeconfig_with_wave_anchors,
    normalized,
    release_document,
    release_json,
    session_with_ca,
    test_hook,
    test_table_envelope,
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
from wavecore.connectivity.helm.verbs import test as test_verb

DEFAULT_ARGV = ["test", RELEASE, "--namespace", NAMESPACE, "--timeout", "300s"]
READ_BACK_ARGV = ["status", RELEASE, "--namespace", NAMESPACE, "-o", "json"]

FULL_PARAMS: dict[str, Any] = {
    "logs": True,
    "timeout": 600,
    **FULL_NAMESPACE,
    **FULL_ADVANCED,
}

FULL_ARGV = [
    "test",
    RELEASE,
    "--logs",
    "--namespace",
    "team",
    *FULL_IMPERSONATION,
    "--timeout",
    "600s",
]

PASSED_ROW = [
    "web-wave-demo-test",
    "Pod",
    "Succeeded",
    "2026-09-04T10:05:00Z",
    "2026-09-04T10:05:09Z",
]
FAILED_ROW = [
    "web-wave-demo-test",
    "Pod",
    "Failed",
    "2026-09-04T10:05:00Z",
    "2026-09-04T10:05:09Z",
]


def _params(**overrides: Any) -> dict[str, Any]:
    return helm_params(**overrides)


def _tested(phase: str = "Succeeded") -> list[Any]:
    """The test run's own answer, then the read-back that carries the hooks."""
    return [
        helm_ok(TEST_STDOUT),
        helm_ok(release_json(hooks=[test_hook(phase=phase)])),
    ]


def _failed_test() -> list[Any]:
    return [
        helm_failed(STDERR_TEST_FAILED, stdout=TEST_STDOUT),
        helm_ok(release_json(hooks=[test_hook(phase="Failed")])),
    ]


class TestTestArgv:
    """The exact command line, for the default sheet and for every row set."""

    def test_the_default_sheet_emits_the_pinned_argv(self) -> None:
        fake = run_verb(test_verb, _params(), _tested())

        assert fake.argv == DEFAULT_ARGV

    def test_every_row_set_emits_the_pinned_argv(self) -> None:
        fake = run_verb(test_verb, _params(**FULL_PARAMS), _tested())

        assert fake.argv == FULL_ARGV

    def test_logs_off_emits_no_logs_flag(self) -> None:
        fake = run_verb(test_verb, _params(logs=False), _tested())

        assert "--logs" not in fake.argv

    def test_no_filter_flag_is_ever_emitted(self) -> None:
        """helm test --filter is ruled out by design, not deferred."""
        fake = run_verb(test_verb, _params(**FULL_PARAMS), _tested())

        assert "--filter" not in fake.argv

    def test_no_wait_flag_is_ever_emitted(self) -> None:
        fake = run_verb(test_verb, _params(**FULL_PARAMS), _tested())

        assert not [item for item in fake.calls[0].argv if item.startswith("--wait")]

    def test_no_output_flag_is_emitted_on_the_test_call(self) -> None:
        fake = run_verb(test_verb, _params(), _tested())

        assert "--output" not in fake.argv
        assert "-o" not in fake.argv

    def test_a_blank_namespace_falls_back_to_the_session_namespace(self) -> None:
        fake = run_verb(test_verb, _params(namespace="  "), _tested())

        assert fake.argv[fake.argv.index("--namespace") + 1] == NAMESPACE

    def test_the_kubeconfig_carries_the_session(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(test_verb, _params(), _tested())

        assert json.loads(workspace_file(fake.calls[0], "kubeconfig.json")) == (
            kubeconfig_with_wave_anchors()
        )

    def test_a_session_with_its_own_ca_is_carried_verbatim(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(test_verb, _params(session=session_with_ca()), _tested())

        assert json.loads(workspace_file(fake.calls[0], "kubeconfig.json")) == json.loads(
            session_with_ca()
        )

    def test_the_block_timeout_is_the_process_budget(self) -> None:
        fake = run_verb(test_verb, _params(timeout=600), _tested())

        assert fake.calls[0].deadline_s == 600


class TestTestReadBack:
    """The hooks are read from the release record, never parsed out of helm's text."""

    def test_the_read_back_is_a_status_call(self) -> None:
        fake = run_verb(test_verb, _params(), _tested())

        assert normalized(fake.calls[1]) == READ_BACK_ARGV

    def test_the_read_back_carries_the_same_namespace_and_impersonation(self) -> None:
        fake = run_verb(test_verb, _params(**FULL_PARAMS), _tested())

        assert normalized(fake.calls[1]) == [
            "status",
            RELEASE,
            "--namespace",
            "team",
            *FULL_IMPERSONATION,
            "-o",
            "json",
        ]

    def test_the_read_back_gets_the_blocks_own_timeout(self) -> None:
        fake = run_verb(test_verb, _params(timeout=600), _tested())

        assert fake.calls[1].deadline_s == 600

    def test_neither_call_outlives_a_one_second_block(self) -> None:
        fake = run_verb(test_verb, _params(timeout=1), _tested())

        assert [call.deadline_s for call in fake.calls] == [1, 1]

    def test_helm_is_called_twice(self) -> None:
        fake = run_verb(test_verb, _params(), _tested())

        assert len(fake.calls) == 2


class TestTestSuccess:
    """One Result row per test hook, plus the logs when they were asked for."""

    def test_the_table_form_is_one_row_per_hook(self) -> None:
        outputs = outputs_of(test_verb, _params(), _tested())

        assert outputs["result"] == test_table_envelope([PASSED_ROW])

    def test_the_map_form_is_the_release_document(self) -> None:
        outputs = outputs_of(test_verb, _params(output_format="map"), _tested())

        assert outputs["result"] == release_document(hooks=[test_hook()])

    def test_the_json_form_is_the_document_as_text(self) -> None:
        outputs = outputs_of(test_verb, _params(output_format="json"), _tested())

        assert json.loads(outputs["result"]) == release_document(hooks=[test_hook()])

    def test_a_chart_with_no_tests_is_an_empty_table_and_a_pass(self) -> None:
        results = [helm_ok("NAME: web\nSTATUS: deployed\n"), helm_ok(release_json())]

        outputs = outputs_of(test_verb, _params(), results)

        assert outputs["result"] == test_table_envelope()
        assert outputs["success"] is True

    def test_the_logs_output_is_empty_while_logs_is_off(self) -> None:
        outputs = outputs_of(test_verb, _params(logs=False), _tested())

        assert outputs["logs"] == ""

    def test_the_logs_output_carries_helms_own_pod_sections(self) -> None:
        outputs = outputs_of(test_verb, _params(logs=True), _tested())

        assert outputs["logs"] == POD_LOGS_BLOCK

    def test_the_status_text_above_the_logs_is_not_carried(self) -> None:
        outputs = outputs_of(test_verb, _params(logs=True), _tested())

        assert "TEST SUITE:" not in outputs["logs"]

    def test_a_run_without_pod_sections_reports_no_logs(self) -> None:
        results = [helm_ok("NAME: web\nSTATUS: deployed\n"), helm_ok(release_json())]

        outputs = outputs_of(test_verb, _params(logs=True), results)

        assert outputs["logs"] == ""

    def test_there_is_no_status_output(self) -> None:
        outputs = outputs_of(test_verb, _params(), _tested())

        assert set(outputs) == {"result", "logs", "success", "error", "reason"}

    def test_the_console_counts_the_hooks_it_ran(self) -> None:
        log = RecordingLog()

        run_verb(test_verb, _params(), _tested(), log=log)

        assert log.entries == [("INFO", f"Ran 1 test hook(s) for release '{RELEASE}'")]

    def test_the_envelope_declares_no_secrets(self) -> None:
        envelope = envelope_of(test_verb, _params(), _tested())

        assert envelope["secrets"] == []


class TestTestFailure:
    """A failed test still hands back the data the test exists to produce."""

    def test_a_failed_hook_stops_the_block(self) -> None:
        with pytest.raises(ValueError, match=exact("pod web-wave-demo-test failed")):
            run_verb(test_verb, _params(), _failed_test())

    def test_a_failed_hook_is_still_read_back(self) -> None:
        fake = run_verb(test_verb, _params(on_error="record"), _failed_test())

        assert len(fake.calls) == 2

    def test_a_recorded_failure_reports_the_reason(self) -> None:
        outputs = outputs_of(test_verb, _params(on_error="record"), _failed_test())

        assert_failure_outputs(outputs, "pod web-wave-demo-test failed", "Failed")

    def test_a_recorded_failure_still_fills_the_result(self) -> None:
        outputs = outputs_of(test_verb, _params(on_error="record"), _failed_test())

        assert outputs["result"] == test_table_envelope([FAILED_ROW])

    def test_a_recorded_failure_still_fills_the_logs(self) -> None:
        outputs = outputs_of(test_verb, _params(on_error="record", logs=True), _failed_test())

        assert outputs["logs"] == POD_LOGS_BLOCK

    def test_a_recorded_failure_writes_a_warning_line(self) -> None:
        log = RecordingLog()

        outputs_of(test_verb, _params(on_error="record"), _failed_test(), log=log)

        assert log.entries[-1] == (
            "WARN",
            "Helm Test failed (Failed): pod web-wave-demo-test failed",
        )

    def test_a_missing_release_reads_as_not_found(self) -> None:
        results = [helm_failed(STDERR_NOT_FOUND), helm_failed(STDERR_NOT_FOUND)]

        outputs = outputs_of(test_verb, _params(on_error="record"), results)

        assert outputs["reason"] == "NotFound"

    def test_a_failed_read_back_falls_back_to_the_empty_forms(self) -> None:
        results = [
            helm_failed(STDERR_TEST_FAILED, stdout=TEST_STDOUT),
            helm_failed(STDERR_NOT_FOUND),
        ]

        outputs = outputs_of(test_verb, _params(on_error="record", logs=True), results)

        assert outputs["result"] == test_table_envelope()
        assert outputs["logs"] == ""

    def test_a_failed_read_back_still_reports_the_test_failure(self) -> None:
        results = [
            helm_failed(STDERR_TEST_FAILED, stdout=TEST_STDOUT),
            helm_failed(STDERR_NOT_FOUND),
        ]

        outputs = outputs_of(test_verb, _params(on_error="record"), results)

        assert outputs["error"] == "pod web-wave-demo-test failed"

    def test_a_read_back_failure_after_a_passing_test_is_the_blocks_failure(self) -> None:
        results = [helm_ok(TEST_STDOUT), helm_failed(STDERR_NOT_FOUND)]

        with pytest.raises(ValueError, match="^uninstall: Release not loaded"):
            run_verb(test_verb, _params(), results)

    def test_the_process_deadline_names_itself(self) -> None:
        message = "helm test did not finish within 300 s"
        results = [helm_timed_out(), helm_ok(release_json())]

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(test_verb, _params(), results)

    def test_a_recorded_deadline_reports_timeout(self) -> None:
        results = [
            helm_timed_out(stdout=TEST_STDOUT),
            helm_ok(release_json(hooks=[test_hook()])),
        ]

        outputs = outputs_of(test_verb, _params(on_error="record"), results)

        assert_failure_outputs(outputs, "helm test did not finish within 300 s", "Timeout")
