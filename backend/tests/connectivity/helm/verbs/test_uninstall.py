"""The Helm Uninstall verb (REQ-3.5.3.5).

uninstall.run removes a release with the same three controls K8s Delete carries
where helm has the flag - Keep History, Ignore Not Found and Cascade - and hands
back the shared output core alone. A release that is already gone is an error
unless Ignore Not Found is ticked, as in helm.
"""

import json
from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    RELEASE,
    STDERR_FORBIDDEN,
    STDERR_NOT_FOUND,
    WaveTrust,
    helm_failed,
    helm_ok,
    helm_params,
    helm_timed_out,
    kubeconfig_with_wave_anchors,
    session_with_ca,
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
from wavecore.connectivity.helm.verbs import uninstall

DEFAULT_ARGV = [
    "uninstall",
    RELEASE,
    "--cascade",
    "background",
    "--namespace",
    NAMESPACE,
    "--timeout",
    "300s",
]

FULL_PARAMS: dict[str, Any] = {
    "keep_history": True,
    "ignore_not_found": True,
    "cascade": "foreground",
    "timeout": 600,
    **FULL_NAMESPACE,
    **FULL_ADVANCED,
}

FULL_ARGV = [
    "uninstall",
    RELEASE,
    "--keep-history",
    "--ignore-not-found",
    "--cascade",
    "foreground",
    "--namespace",
    "team",
    *FULL_IMPERSONATION,
    "--timeout",
    "600s",
]

UNINSTALLED = 'release "web" uninstalled\n'


def _params(**overrides: Any) -> dict[str, Any]:
    return helm_params(**overrides)


class TestUninstallArgv:
    """The exact command line, for the default sheet and for every row set."""

    def test_the_default_sheet_emits_the_pinned_argv(self) -> None:
        fake = run_verb(uninstall, _params(), [helm_ok(UNINSTALLED)])

        assert fake.argv == DEFAULT_ARGV

    def test_every_row_set_emits_the_pinned_argv(self) -> None:
        fake = run_verb(uninstall, _params(**FULL_PARAMS), [helm_ok(UNINSTALLED)])

        assert fake.argv == FULL_ARGV

    def test_the_cascade_is_always_named(self) -> None:
        """Same name and default as K8s Delete; helm's own default is background."""
        fake = run_verb(uninstall, _params(), [helm_ok(UNINSTALLED)])

        assert fake.argv[fake.argv.index("--cascade") + 1] == "background"

    def test_orphan_reaches_helm(self) -> None:
        fake = run_verb(uninstall, _params(cascade="orphan"), [helm_ok(UNINSTALLED)])

        assert fake.argv[fake.argv.index("--cascade") + 1] == "orphan"

    def test_keep_history_off_emits_no_flag(self) -> None:
        fake = run_verb(uninstall, _params(keep_history=False), [helm_ok(UNINSTALLED)])

        assert "--keep-history" not in fake.argv

    def test_ignore_not_found_off_emits_no_flag(self) -> None:
        fake = run_verb(uninstall, _params(ignore_not_found=False), [helm_ok(UNINSTALLED)])

        assert "--ignore-not-found" not in fake.argv

    def test_no_wait_flag_is_ever_emitted(self) -> None:
        fake = run_verb(uninstall, _params(**FULL_PARAMS), [helm_ok(UNINSTALLED)])

        assert not [item for item in fake.calls[0].argv if item.startswith("--wait")]

    def test_no_output_flag_is_emitted(self) -> None:
        fake = run_verb(uninstall, _params(), [helm_ok(UNINSTALLED)])

        assert "--output" not in fake.argv
        assert "-o" not in fake.argv

    def test_a_blank_namespace_falls_back_to_the_session_namespace(self) -> None:
        fake = run_verb(uninstall, _params(namespace=""), [helm_ok(UNINSTALLED)])

        assert fake.argv[fake.argv.index("--namespace") + 1] == NAMESPACE

    def test_there_is_no_read_back(self) -> None:
        fake = run_verb(uninstall, _params(), [helm_ok(UNINSTALLED)])

        assert len(fake.calls) == 1

    def test_the_kubeconfig_carries_the_session(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(uninstall, _params(), [helm_ok(UNINSTALLED)])

        assert json.loads(workspace_file(fake.last, "kubeconfig.json")) == (
            kubeconfig_with_wave_anchors()
        )

    def test_a_session_with_its_own_ca_is_carried_verbatim(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(uninstall, _params(session=session_with_ca()), [helm_ok(UNINSTALLED)])

        assert json.loads(workspace_file(fake.last, "kubeconfig.json")) == json.loads(
            session_with_ca()
        )

    def test_the_block_timeout_is_the_process_budget(self) -> None:
        fake = run_verb(uninstall, _params(timeout=90), [helm_ok(UNINSTALLED)])

        assert fake.last.deadline_s == 90


class TestUninstallSuccess:
    """Uninstall reports the shared core outputs only."""

    def test_the_outputs_are_the_core_alone(self) -> None:
        outputs = outputs_of(uninstall, _params(), [helm_ok(UNINSTALLED)])

        assert set(outputs) == {"success", "error", "reason"}

    def test_the_output_core_reports_success(self) -> None:
        outputs = outputs_of(uninstall, _params(), [helm_ok(UNINSTALLED)])

        assert (outputs["success"], outputs["error"], outputs["reason"]) == (True, "", "")

    def test_the_console_names_the_release(self) -> None:
        log = RecordingLog()

        run_verb(uninstall, _params(), [helm_ok(UNINSTALLED)], log=log)

        assert log.entries == [("INFO", f"Uninstalled release '{RELEASE}'")]

    def test_a_release_already_gone_passes_when_it_may_be_ignored(self) -> None:
        """helm exits zero under --ignore-not-found, so nothing else is needed."""
        outputs = outputs_of(uninstall, _params(ignore_not_found=True), [helm_ok("")])

        assert outputs["success"] is True

    def test_the_envelope_declares_no_secrets(self) -> None:
        envelope = envelope_of(uninstall, _params(), [helm_ok(UNINSTALLED)])

        assert envelope["secrets"] == []


class TestUninstallFailure:
    """A release that is not there is an error unless it may be ignored."""

    def test_a_missing_release_stops_the_block(self) -> None:
        message = "uninstall: Release not loaded: web: release: not found"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(uninstall, _params(), [helm_failed(STDERR_NOT_FOUND)])

    def test_a_recorded_missing_release_reads_as_not_found(self) -> None:
        outputs = outputs_of(uninstall, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert_failure_outputs(
            outputs, "uninstall: Release not loaded: web: release: not found", "NotFound"
        )

    def test_a_recorded_refusal_carries_no_result(self) -> None:
        outputs = outputs_of(uninstall, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert set(outputs) == {"success", "error", "reason", "__block_warning"}

    def test_a_denied_uninstall_reads_as_forbidden(self) -> None:
        outputs = outputs_of(uninstall, _params(on_error="record"), [helm_failed(STDERR_FORBIDDEN)])

        assert outputs["reason"] == "Forbidden"

    def test_a_recorded_refusal_writes_a_warning_line(self) -> None:
        log = RecordingLog()

        outputs_of(uninstall, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)], log=log)

        assert log.entries[-1][1].startswith("Helm Uninstall failed (NotFound): ")

    def test_the_process_deadline_is_the_timeout_itself(self) -> None:
        message = "helm uninstall did not finish within 300 s"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(uninstall, _params(), [helm_timed_out()])

    def test_a_recorded_deadline_reports_timeout(self) -> None:
        outputs = outputs_of(uninstall, _params(on_error="record"), [helm_timed_out()])

        assert_failure_outputs(outputs, "helm uninstall did not finish within 300 s", "Timeout")

    def test_a_one_second_timeout_is_the_whole_deadline(self) -> None:
        fake = run_verb(uninstall, _params(timeout=1, on_error="record"), [helm_timed_out()])

        assert fake.last.deadline_s == 1

    def test_the_block_has_no_cleanup_room_to_buy(self) -> None:
        fake = run_verb(
            uninstall,
            _params(timeout=1, cleanup_timeout=45, on_error="record"),
            [helm_timed_out()],
        )

        assert fake.last.deadline_s == 1
