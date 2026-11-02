"""The Helm Install verb (REQ-3.5.3.1).

install.run assembles `helm install`, hands it the session as a kubeconfig for the
length of the call, and turns the `-o json` release document into Result and
Status. The argv is pinned to the letter: helm parity means every flag is a real
helm flag in helm's own order, and no wait flag is ever emitted.
"""

import json
import os
import re
from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    CHART,
    RELEASE,
    STDERR_HOOK_FAILED,
    STDERR_NOT_FOUND,
    STDERR_STILL_IN_USE,
    STDERR_UNKNOWN_FLAG,
    WAVE_ANCHORS,
    FakeRunHelm,
    WaveTrust,
    fake_helm,
    helm_failed,
    helm_ok,
    helm_params,
    helm_timed_out,
    kubeconfig_with_wave_anchors,
    patch_floor_probe,
    patch_run_helm,
    release_document,
    release_json,
    release_row,
    release_table_envelope,
    session_with_ca,
    workspace_file,
)
from tests.connectivity.helm.verbs._verb_cases import (
    FULL_ADVANCED,
    FULL_NAMESPACE,
    assert_failure_outputs,
    envelope_of,
    outputs_of,
    run_verb,
)
from tests.plugins.k8s._k8s_fixtures import NAMESPACE, RecordingLog, exact
from wavecore.connectivity.helm.verbs import install

CA_PEM = "-----BEGIN CERTIFICATE-----\nlab-ca\n-----END CERTIFICATE-----\n"

DEFAULT_ARGV = [
    "install",
    RELEASE,
    CHART,
    "--namespace",
    NAMESPACE,
    "--timeout",
    "300s",
    "--output",
    "json",
]

FULL_PARAMS: dict[str, Any] = {
    "version": "0.2.0",
    "repo": "http://charts.local",
    "values": "replicaCount: 2\n",
    "set": {"a": "1", "b": "2"},
    "repo_username": "wave",
    "repo_password": "chart-secret",
    "repo_ca_cert": CA_PEM,
    "repo_verify_ssl": False,
    "create_namespace": True,
    "atomic": True,
    "timeout": 600,
    **FULL_NAMESPACE,
    **FULL_ADVANCED,
}

FULL_ARGV = [
    "install",
    RELEASE,
    CHART,
    "--version",
    "0.2.0",
    "--repo",
    "http://charts.local",
    "--values",
    "@values.yaml",
    "--set",
    "a=1",
    "--set",
    "b=2",
    "--username",
    "wave",
    "--password",
    "chart-secret",
    "--ca-file",
    "@ca.pem",
    "--insecure-skip-tls-verify",
    "--namespace",
    "team",
    "--create-namespace",
    "--kube-as-user",
    "wave-reader",
    "--kube-as-group",
    "qa",
    "--kube-as-group",
    "ops",
    "--atomic",
    "--timeout",
    "600s",
    "--output",
    "json",
]


def _params(**overrides: Any) -> dict[str, Any]:
    return helm_params(chart=CHART, **overrides)


_REPO = "https://charts.example.com"
_REPOSITORY_CHARTS = [
    "oci://registry.example.com/charts/wave-demo",
    "https://charts.example.com/wave-demo-0.1.0.tgz",
    "http://charts.local/wave-demo-0.1.0.tgz",
]
_LOCAL_CHARTS = [
    "/srv/charts/wave-demo",
    "./charts/wave-demo",
    "charts/wave-demo",
    "wave-demo-0.1.0.tgz",
    CHART,
]
_OCI_CHART = "oci://registry.example.com:5000/charts/wave-demo"


def _ca_file(fake: FakeRunHelm) -> str:
    """The text of the file --ca-file names, from the call's workspace snapshot."""
    name = fake.argv[fake.argv.index("--ca-file") + 1]
    assert name.startswith("@")
    return workspace_file(fake.last, name[1:])


def _installed(**overrides: Any) -> list[Any]:
    return [helm_ok(release_json(**overrides))]


class TestInstallArgv:
    """The exact command line, for the default sheet and for every row set."""

    def test_the_default_sheet_emits_the_pinned_argv(self) -> None:
        fake = run_verb(install, _params(), _installed())

        assert fake.argv == DEFAULT_ARGV

    def test_every_row_set_emits_the_pinned_argv(self) -> None:
        fake = run_verb(install, _params(**FULL_PARAMS), _installed())

        assert fake.argv == FULL_ARGV

    def test_no_wait_flag_is_ever_emitted(self) -> None:
        """HELM-2: readiness composes from Wait Until, never from a helm wait."""
        fake = run_verb(install, _params(**FULL_PARAMS), _installed())

        assert not [item for item in fake.calls[0].argv if item.startswith("--wait")]

    def test_the_helm_path_never_becomes_a_flag(self) -> None:
        fake = run_verb(install, _params(helm_path="/opt/helm"), _installed())

        assert "/opt/helm" not in fake.calls[0].argv

    def test_an_empty_version_emits_no_version_flag(self) -> None:
        fake = run_verb(install, _params(version="  "), _installed())

        assert "--version" not in fake.argv

    def test_an_empty_repository_url_emits_no_repo_flag(self) -> None:
        fake = run_verb(install, _params(repo=""), _installed())

        assert "--repo" not in fake.argv

    def test_blank_values_emit_no_values_flag(self) -> None:
        fake = run_verb(install, _params(values="  \n"), _installed())

        assert "--values" not in fake.argv

    def test_an_empty_set_map_emits_no_set_flag(self) -> None:
        fake = run_verb(install, _params(set={}), _installed())

        assert "--set" not in fake.argv

    def test_set_entries_keep_the_order_they_were_typed(self) -> None:
        fake = run_verb(install, _params(set={"z": "1", "a": "2"}), _installed())

        assert fake.argv[3:7] == ["--set", "z=1", "--set", "a=2"]

    def test_a_non_string_set_value_is_rendered_as_text(self) -> None:
        fake = run_verb(install, _params(set={"n": 3}), _installed())

        assert fake.argv[3:5] == ["--set", "n=3"]

    def test_a_null_set_value_is_passed_as_helm_null(self) -> None:
        """REQ-3.1.3.21: helm reads key=null as removing the key from the chart defaults."""
        fake = run_verb(install, _params(set={"image.tag": None, "n": "2"}), _installed())

        assert fake.argv[3:7] == ["--set", "image.tag=null", "--set", "n=2"]

    def test_an_empty_repository_user_emits_no_credentials(self) -> None:
        fake = run_verb(install, _params(repo_username="", repo_password=""), _installed())

        assert "--username" not in fake.argv
        assert "--password" not in fake.argv

    def test_an_empty_certificate_emits_no_ca_file(self) -> None:
        fake = run_verb(install, _params(repo_ca_cert="  \n"), _installed())

        assert "--ca-file" not in fake.argv

    def test_verification_left_on_emits_no_insecure_flag(self) -> None:
        fake = run_verb(install, _params(repo_verify_ssl=True), _installed())

        assert "--insecure-skip-tls-verify" not in fake.argv

    def test_create_namespace_off_emits_no_flag(self) -> None:
        fake = run_verb(install, _params(create_namespace=False), _installed())

        assert "--create-namespace" not in fake.argv

    def test_atomic_off_emits_no_flag(self) -> None:
        fake = run_verb(install, _params(atomic=False), _installed())

        assert "--atomic" not in fake.argv

    def test_a_blank_namespace_falls_back_to_the_session_namespace(self) -> None:
        fake = run_verb(install, _params(namespace="  "), _installed())

        assert fake.argv[fake.argv.index("--namespace") + 1] == NAMESPACE

    def test_groups_without_a_user_emit_no_impersonation(self) -> None:
        """The plugin refuses that pairing; the verb simply emits nothing."""
        fake = run_verb(install, _params(impersonate_groups="qa"), _installed())

        assert "--kube-as-group" not in fake.argv


class TestInstallRunnerArguments:
    """What the verb hands the runner beside the argv."""

    def test_the_kubeconfig_carries_the_session(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(install, _params(), _installed())

        assert json.loads(workspace_file(fake.last, "kubeconfig.json")) == (
            kubeconfig_with_wave_anchors()
        )

    def test_a_session_with_its_own_ca_is_carried_verbatim(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(install, _params(session=session_with_ca()), _installed())

        assert json.loads(workspace_file(fake.last, "kubeconfig.json")) == json.loads(
            session_with_ca()
        )

    def test_the_kubeconfig_lives_in_the_call_workspace(self) -> None:
        fake = run_verb(install, _params(), _installed())

        assert fake.last.kubeconfig == os.path.join(fake.last.workspace, "kubeconfig.json")

    def test_the_workspace_is_gone_after_the_call(self) -> None:
        fake = run_verb(install, _params(), _installed())

        assert not os.path.exists(fake.last.workspace)

    def test_the_values_file_holds_the_document_verbatim(self) -> None:
        fake = run_verb(install, _params(values="replicaCount: 2\n"), _installed())

        assert workspace_file(fake.last, "values.yaml") == "replicaCount: 2\n"

    def test_the_ca_file_holds_the_certificate_verbatim(self) -> None:
        fake = run_verb(install, _params(repo_ca_cert=CA_PEM), _installed())

        assert workspace_file(fake.last, "ca.pem") == CA_PEM

    def test_the_helm_path_reaches_the_runner(self) -> None:
        fake = run_verb(install, _params(helm_path="/opt/helm"), _installed())

        assert fake.last.helm_path == "/opt/helm"

    def test_an_unset_helm_path_reaches_the_runner_empty(self) -> None:
        fake = run_verb(install, _params(), _installed())

        assert fake.last.helm_path == ""

    def test_the_block_timeout_is_the_process_budget(self) -> None:
        fake = run_verb(install, _params(timeout=600), _installed())

        assert fake.last.deadline_s == 600

    def test_the_default_budget_is_three_hundred_seconds(self) -> None:
        fake = run_verb(install, _params(), _installed())

        assert fake.last.deadline_s == 300

    def test_helm_is_called_once(self) -> None:
        fake = run_verb(install, _params(), _installed())

        assert len(fake.calls) == 1


class TestInstallRepositoryTrust:
    """REQ-4.5.16: a blank Repository CA trusts WAVE's trust set for a chart from a repository."""

    def test_a_repository_chart_trusts_waves_anchors(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(install, _params(session=session_with_ca(), repo=_REPO), _installed())

        name = fake.argv[fake.argv.index("--ca-file") + 1]
        assert fake.argv == [
            "install",
            RELEASE,
            CHART,
            "--repo",
            _REPO,
            "--ca-file",
            name,
            "--namespace",
            NAMESPACE,
            "--timeout",
            "300s",
            "--output",
            "json",
        ]
        assert _ca_file(fake) == WAVE_ANCHORS

    def test_a_repository_chart_reads_the_anchors_of_the_active_spec(
        self, wave_trust: WaveTrust
    ) -> None:
        run_verb(install, _params(session=session_with_ca(), repo=_REPO), _installed())

        assert wave_trust.calls == [wave_trust.spec]

    @pytest.mark.parametrize("chart", _REPOSITORY_CHARTS)
    def test_a_chart_reference_into_a_repository_trusts_waves_anchors(
        self, wave_trust: WaveTrust, chart: str
    ) -> None:
        fake = run_verb(install, helm_params(session=session_with_ca(), chart=chart), _installed())

        assert fake.argv[2:5] == [chart, "--ca-file", fake.argv[4]]
        assert _ca_file(fake) == WAVE_ANCHORS

    def test_a_blank_certificate_counts_as_no_certificate(self, wave_trust: WaveTrust) -> None:
        params = _params(session=session_with_ca(), repo=_REPO, repo_ca_cert="  \n")

        fake = run_verb(install, params, _installed())

        assert _ca_file(fake) == WAVE_ANCHORS

    @pytest.mark.parametrize("chart", _LOCAL_CHARTS)
    def test_a_local_chart_gets_no_ca_file(self, wave_trust: WaveTrust, chart: str) -> None:
        fake = run_verb(install, helm_params(session=session_with_ca(), chart=chart), _installed())

        assert "--ca-file" not in fake.argv
        assert wave_trust.calls == []

    def test_a_repository_ca_is_the_only_certificate_trusted(self, wave_trust: WaveTrust) -> None:
        params = _params(session=session_with_ca(), repo=_REPO, repo_ca_cert=CA_PEM)

        fake = run_verb(install, params, _installed())

        assert fake.argv.count("--ca-file") == 1
        assert _ca_file(fake) == CA_PEM
        assert wave_trust.calls == []

    def test_verification_off_skips_verification_without_a_ca_file(
        self, wave_trust: WaveTrust
    ) -> None:
        params = _params(session=session_with_ca(), repo=_REPO, repo_verify_ssl=False)

        fake = run_verb(install, params, _installed())

        assert "--insecure-skip-tls-verify" in fake.argv
        assert "--ca-file" not in fake.argv
        assert wave_trust.calls == []


class TestInstallSuccess:
    """The release document becomes Result and Status."""

    def test_the_table_form_is_the_release_row(self) -> None:
        outputs = outputs_of(install, _params(), _installed())

        assert outputs["result"] == release_table_envelope([release_row()])

    def test_the_map_form_is_the_document(self) -> None:
        outputs = outputs_of(install, _params(output_format="map"), _installed())

        assert outputs["result"] == release_document()

    def test_the_json_form_is_the_document_as_text(self) -> None:
        outputs = outputs_of(install, _params(output_format="json"), _installed())

        assert json.loads(outputs["result"]) == release_document()

    def test_the_yaml_form_rides_the_yaml_envelope(self) -> None:
        outputs = outputs_of(install, _params(output_format="yaml"), _installed())

        assert outputs["result"] == {"__wave_type": "yaml", "value": release_document()}

    def test_the_status_scalar_is_the_releases_own(self) -> None:
        outputs = outputs_of(install, _params(), _installed())

        assert outputs["status"] == "deployed"

    def test_a_pending_release_reports_its_state(self) -> None:
        outputs = outputs_of(install, _params(), _installed(status="pending-install"))

        assert outputs["status"] == "pending-install"

    def test_the_output_core_reports_success(self) -> None:
        outputs = outputs_of(install, _params(), _installed())

        assert (outputs["success"], outputs["error"], outputs["reason"]) == (True, "", "")

    def test_there_is_no_revision_output(self) -> None:
        outputs = outputs_of(install, _params(), _installed())

        assert set(outputs) == {"result", "status", "success", "error", "reason"}

    def test_the_console_names_the_release_and_its_revision(self) -> None:
        log = RecordingLog()

        run_verb(install, _params(), _installed(), log=log)

        assert log.entries == [("INFO", f"Installed release '{RELEASE}' as revision 1")]

    def test_the_envelope_declares_no_secrets(self) -> None:
        envelope = envelope_of(install, _params(), _installed())

        assert envelope["__wave_type"] == "result"
        assert envelope["secrets"] == []


class TestInstallFailure:
    """helm's refusal becomes the block's message and one of the seven Reasons."""

    def test_a_name_still_in_use_stops_the_block(self) -> None:
        message = "INSTALL FAILED: cannot re-use a name that is still in use"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(install, _params(), [helm_failed(STDERR_STILL_IN_USE)])

    def test_a_recorded_refusal_reports_the_reason(self) -> None:
        outputs = outputs_of(
            install, _params(on_error="record"), [helm_failed(STDERR_STILL_IN_USE)]
        )

        assert_failure_outputs(
            outputs,
            "INSTALL FAILED: cannot re-use a name that is still in use",
            "AlreadyExists",
        )

    def test_a_recorded_refusal_empties_the_result(self) -> None:
        outputs = outputs_of(install, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert outputs["result"] == release_table_envelope()

    @pytest.mark.parametrize(
        ("output_format", "empty"),
        [("map", {}), ("json", ""), ("yaml", "")],
    )
    def test_a_recorded_refusal_empties_every_format(self, output_format: str, empty: Any) -> None:
        outputs = outputs_of(
            install,
            _params(on_error="record", output_format=output_format),
            [helm_failed(STDERR_NOT_FOUND)],
        )

        assert outputs["result"] == empty

    def test_a_recorded_refusal_empties_the_status(self) -> None:
        outputs = outputs_of(install, _params(on_error="record"), [helm_failed(STDERR_HOOK_FAILED)])

        assert outputs["status"] == ""

    def test_a_recorded_refusal_writes_a_warning_line(self) -> None:
        log = RecordingLog()

        outputs_of(install, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)], log=log)

        assert log.entries[-1] == (
            "WARN",
            "Helm Install failed (NotFound): uninstall: Release not loaded: web: "
            "release: not found",
        )

    def test_the_process_deadline_is_the_timeout_itself(self) -> None:
        message = "helm install did not finish within 300 s"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(install, _params(), [helm_timed_out()])

    def test_a_recorded_deadline_reports_timeout(self) -> None:
        outputs = outputs_of(install, _params(on_error="record"), [helm_timed_out()])

        assert_failure_outputs(outputs, "helm install did not finish within 300 s", "Timeout")

    def test_a_shorter_timeout_shortens_the_deadline_in_the_message(self) -> None:
        message = "helm install did not finish within 20 s"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(install, _params(timeout=20), [helm_timed_out()])

    def test_a_one_second_timeout_is_the_whole_deadline(self) -> None:
        fake = run_verb(install, _params(timeout=1, on_error="record"), [helm_timed_out()])

        assert fake.last.deadline_s == 1

    def test_atomic_buys_the_cleanup_room_on_top(self) -> None:
        fake = run_verb(install, _params(atomic=True, on_error="record"), [helm_timed_out()])

        assert fake.last.deadline_s == 600

    def test_the_cleanup_room_is_the_block_s_own_when_it_names_one(self) -> None:
        fake = run_verb(
            install,
            _params(timeout=1, atomic=True, cleanup_timeout=45, on_error="record"),
            [helm_timed_out()],
        )

        assert fake.last.deadline_s == 46

    def test_the_cleanup_room_names_itself_in_the_deadline_message(self) -> None:
        message = "helm install did not finish within 46 s"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(
                install,
                _params(timeout=1, atomic=True, cleanup_timeout=45),
                [helm_timed_out()],
            )

    def test_a_cleanup_timeout_without_atomic_buys_nothing(self) -> None:
        fake = run_verb(
            install, _params(timeout=1, cleanup_timeout=45, on_error="record"), [helm_timed_out()]
        )

        assert fake.last.deadline_s == 1

    def test_an_unknown_flag_reports_the_helm_floor(self) -> None:
        message = "Helm v3.9.4 found at /opt/helm, WAVE needs 3.13 or newer"

        with patch_floor_probe("install", message):
            with pytest.raises(ValueError, match=exact(message)):
                run_verb(install, _params(), [helm_failed(STDERR_UNKNOWN_FLAG)])

    def test_a_recorded_floor_violation_reads_as_invalid(self) -> None:
        message = "Helm v3.9.4 found at /opt/helm, WAVE needs 3.13 or newer"

        with patch_floor_probe("install", message):
            outputs = outputs_of(
                install, _params(on_error="record"), [helm_failed(STDERR_UNKNOWN_FLAG)]
            )

        assert_failure_outputs(outputs, message, "Invalid")

    def test_a_current_helm_lets_its_own_error_through(self) -> None:
        with patch_floor_probe("install", None):
            with pytest.raises(ValueError, match=exact("unknown flag: --ignore-not-found")):
                run_verb(install, _params(), [helm_failed(STDERR_UNKNOWN_FLAG)])

    def test_a_run_that_printed_no_document_is_a_failure(self) -> None:
        message = "helm install printed no release document"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(install, _params(), [helm_ok("NAME: web\n")])

    def test_a_recorded_missing_document_reads_as_invalid(self) -> None:
        outputs = outputs_of(install, _params(on_error="record"), [helm_ok("NAME: web\n")])

        assert_failure_outputs(outputs, "helm install printed no release document", "Invalid")

    def test_an_unreadable_session_stops_the_block_under_either_setting(self) -> None:
        message = (
            "Parameter 'session' is not a kubeconfig WAVE can read: "
            "use the 'session' output of a K8s Connect block"
        )
        params = _params(on_error="record")
        params["session"] = "nonsense"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(install, params, [helm_ok(release_json())])


class TestInstallOciCredentials:
    """REQ-3.5.3.6: a chart in an OCI registry is pulled with the block's own login."""

    def test_the_username_and_password_ride_the_argv(self) -> None:
        params = helm_params(
            session=session_with_ca(),
            chart=_OCI_CHART,
            version="0.1.0",
            repo_username="wave",
            repo_password="oci-secret",
            repo_ca_cert=CA_PEM,
            create_namespace=True,
            timeout=60,
        )

        fake = run_verb(install, params, _installed())

        assert fake.argv == [
            "install",
            RELEASE,
            _OCI_CHART,
            "--version",
            "0.1.0",
            "--username",
            "wave",
            "--password",
            "oci-secret",
            "--ca-file",
            "@ca.pem",
            "--namespace",
            NAMESPACE,
            "--create-namespace",
            "--timeout",
            "60s",
            "--output",
            "json",
        ]

    def test_the_debug_line_hides_the_password(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path, stdout=release_json())
        log = RecordingLog()
        params = helm_params(
            session=session_with_ca(),
            chart=_OCI_CHART,
            version="0.1.0",
            repo_username="wave",
            repo_password="oci-secret",
            repo_verify_ssl=False,
            helm_path=helm.path,
        )

        install.run(params, log)

        started = [
            message
            for level, message in log.entries
            if level == "DEBUG" and message.startswith("helm install ")
        ]
        assert len(started) == 1
        assert re.fullmatch(
            r"helm install web oci://registry\.example\.com:5000/charts/wave-demo "
            r"--version 0\.1\.0 --username wave --password \*\*\* "
            r"--insecure-skip-tls-verify --namespace apps --timeout 300s --output json "
            r"--kubeconfig \S+",
            started[0],
        )
        assert not [message for message in log.messages if "oci-secret" in message]


class TestInstallChartSource:
    """REQ-3.5.3.6: the verb tells the runner where helm downloads the chart from."""

    @pytest.mark.parametrize(
        ("chart", "repo", "chart_source"),
        [
            (CHART, "https://charts.example.com", ("https", "charts.example.com", 443)),
            (CHART, "http://charts.local", ("http", "charts.local", 80)),
            (
                CHART,
                "https://charts.example.com:8443/stable",
                ("https", "charts.example.com", 8443),
            ),
            (
                "https://charts.example.com/wave-demo-0.1.0.tgz",
                "",
                ("https", "charts.example.com", 443),
            ),
            (
                "http://charts.local:9463/wave-demo-0.1.0.tgz",
                "",
                ("http", "charts.local", 9463),
            ),
            (
                "https://[2001:db8::7]:8443/wave-demo-0.1.0.tgz",
                "",
                ("https", "2001:db8::7", 8443),
            ),
            (
                "oci://registry.example.com/charts/wave-demo",
                "",
                ("https", "registry.example.com", 443),
            ),
            (_OCI_CHART, "", ("https", "registry.example.com", 5000)),
        ],
        ids=[
            "repository URL",
            "http repository URL",
            "repository URL with a port",
            "chart URL",
            "http chart URL with a port",
            "chart URL on an IPv6 address",
            "oci reference",
            "oci reference with a port",
        ],
    )
    def test_a_downloaded_chart_names_its_source(
        self, chart: str, repo: str, chart_source: tuple[str, str, int]
    ) -> None:
        params = helm_params(session=session_with_ca(), chart=chart, repo=repo, repo_ca_cert=CA_PEM)

        fake = run_verb(install, params, _installed())

        assert fake.last.chart_source == chart_source

    @pytest.mark.parametrize("chart", _LOCAL_CHARTS)
    def test_a_chart_that_is_a_local_path_names_no_source(self, chart: str) -> None:
        fake = run_verb(install, helm_params(chart=chart), _installed())

        assert fake.last.chart_source is None

    @pytest.mark.parametrize(
        ("chart", "repo"),
        [
            ("https://charts.example.com:99999/wave-demo-0.1.0.tgz", ""),
            ("https://[2001:db8::7/wave-demo-0.1.0.tgz", ""),
            (CHART, "https://charts.example.com:port"),
            (CHART, "charts.example.com"),
        ],
        ids=[
            "chart URL with a port out of range",
            "chart URL with an open bracket",
            "repository URL with a port that is no number",
            "repository URL without a protocol",
        ],
    )
    def test_an_address_helm_will_refuse_reaches_helm_as_written_and_names_no_source(
        self, chart: str, repo: str
    ) -> None:
        params = helm_params(session=session_with_ca(), chart=chart, repo=repo, repo_ca_cert=CA_PEM)

        fake = run_verb(install, params, _installed())

        assert fake.argv[2] == chart
        assert fake.last.chart_source is None


class TestWaveSideChartSchemesOnTheRemoteHost:
    """On the remote host no bridge resolves a chart scheme, so the verb refuses it before helm."""

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    def test_a_scheme_chart_is_refused_before_helm_runs(self, scheme: str) -> None:
        fake = FakeRunHelm(_installed())
        message = (
            f"{scheme} paths are not available on the remote host - "
            "use an absolute or relative path on the remote host"
        )

        with patch_run_helm("install", fake), pytest.raises(ValueError, match=exact(message)):
            install.run(helm_params(chart=f"{scheme}charts/web"), RecordingLog())

        assert fake.calls == []

    def test_a_relative_chart_folder_reaches_helm_as_written(self) -> None:
        fake = run_verb(install, helm_params(chart="charts/../web"), _installed())

        assert fake.argv[2] == "charts/../web"
