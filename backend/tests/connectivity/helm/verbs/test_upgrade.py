"""The Helm Upgrade verb (REQ-3.5.3.3).

upgrade.run is Install's sibling with helm's own values rules on top: Install if
missing turns an upgrade of an absent release into an install and is the only
state in which Create Namespace applies, Reuse Values and Reset Values are never
both emitted, and Cleanup on Fail joins Atomic in Failure Handling.
"""

import json
import re
from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import (
    CHART,
    RELEASE,
    STDERR_BUILD_OBJECTS,
    STDERR_NOT_FOUND,
    STDERR_TIMED_OUT,
    WAVE_ANCHORS,
    FakeRunHelm,
    WaveTrust,
    fake_helm,
    helm_failed,
    helm_ok,
    helm_params,
    helm_timed_out,
    kubeconfig_with_wave_anchors,
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
from wavecore.connectivity.helm.verbs import upgrade

CA_PEM = "-----BEGIN CERTIFICATE-----\nlab-ca\n-----END CERTIFICATE-----\n"

DEFAULT_ARGV = [
    "upgrade",
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
    "set": {"a": "1"},
    "install": True,
    "reuse_values": True,
    "repo_username": "wave",
    "repo_password": "chart-secret",
    "repo_ca_cert": CA_PEM,
    "repo_verify_ssl": False,
    "create_namespace": True,
    "atomic": True,
    "cleanup_on_fail": True,
    "timeout": 600,
    **FULL_NAMESPACE,
    **FULL_ADVANCED,
}

FULL_ARGV = [
    "upgrade",
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
    "--install",
    "--reuse-values",
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
    "--cleanup-on-fail",
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


def _upgraded(**overrides: Any) -> list[Any]:
    return [helm_ok(release_json(revision=2, **overrides))]


class TestUpgradeArgv:
    """The exact command line, for the default sheet and for every row set."""

    def test_the_default_sheet_emits_the_pinned_argv(self) -> None:
        fake = run_verb(upgrade, _params(), _upgraded())

        assert fake.argv == DEFAULT_ARGV

    def test_every_row_set_emits_the_pinned_argv(self) -> None:
        fake = run_verb(upgrade, _params(**FULL_PARAMS), _upgraded())

        assert fake.argv == FULL_ARGV

    def test_no_wait_flag_is_ever_emitted(self) -> None:
        fake = run_verb(upgrade, _params(**FULL_PARAMS), _upgraded())

        assert not [item for item in fake.calls[0].argv if item.startswith("--wait")]

    def test_install_if_missing_off_emits_no_install_flag(self) -> None:
        fake = run_verb(upgrade, _params(install=False), _upgraded())

        assert "--install" not in fake.argv

    def test_reset_values_takes_reuse_values_place(self) -> None:
        fake = run_verb(upgrade, _params(reset_values=True), _upgraded())

        assert fake.argv[3] == "--reset-values"

    def test_a_null_set_value_is_passed_as_helm_null(self) -> None:
        """REQ-3.1.3.21: helm reads key=null as removing the key from the chart defaults."""
        fake = run_verb(upgrade, _params(set={"image.tag": None, "n": "2"}), _upgraded())

        assert fake.argv[3:7] == ["--set", "image.tag=null", "--set", "n=2"]

    def test_reuse_values_takes_the_same_place(self) -> None:
        fake = run_verb(upgrade, _params(reuse_values=True), _upgraded())

        assert fake.argv[3] == "--reuse-values"

    def test_neither_values_flag_is_emitted_by_default(self) -> None:
        fake = run_verb(upgrade, _params(), _upgraded())

        assert "--reuse-values" not in fake.argv
        assert "--reset-values" not in fake.argv

    def test_create_namespace_needs_install_if_missing(self) -> None:
        """helm refuses --create-namespace without --install, so the verb never sends it."""
        fake = run_verb(upgrade, _params(create_namespace=True, install=False), _upgraded())

        assert "--create-namespace" not in fake.argv

    def test_create_namespace_rides_along_with_install_if_missing(self) -> None:
        fake = run_verb(upgrade, _params(create_namespace=True, install=True), _upgraded())

        assert "--create-namespace" in fake.argv

    def test_cleanup_on_fail_off_emits_no_flag(self) -> None:
        fake = run_verb(upgrade, _params(cleanup_on_fail=False), _upgraded())

        assert "--cleanup-on-fail" not in fake.argv

    def test_atomic_and_cleanup_keep_their_order(self) -> None:
        fake = run_verb(upgrade, _params(atomic=True, cleanup_on_fail=True), _upgraded())

        assert fake.argv[fake.argv.index("--atomic") + 1] == "--cleanup-on-fail"

    def test_a_blank_namespace_falls_back_to_the_session_namespace(self) -> None:
        fake = run_verb(upgrade, _params(namespace=""), _upgraded())

        assert fake.argv[fake.argv.index("--namespace") + 1] == NAMESPACE


class TestUpgradeRunnerArguments:
    """What the verb hands the runner beside the argv."""

    def test_the_kubeconfig_carries_the_session(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(upgrade, _params(), _upgraded())

        assert json.loads(workspace_file(fake.last, "kubeconfig.json")) == (
            kubeconfig_with_wave_anchors()
        )

    def test_a_session_with_its_own_ca_is_carried_verbatim(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(upgrade, _params(session=session_with_ca()), _upgraded())

        assert json.loads(workspace_file(fake.last, "kubeconfig.json")) == json.loads(
            session_with_ca()
        )

    def test_the_values_file_holds_the_document_verbatim(self) -> None:
        fake = run_verb(upgrade, _params(values="replicaCount: 3\n"), _upgraded())

        assert workspace_file(fake.last, "values.yaml") == "replicaCount: 3\n"

    def test_the_helm_path_reaches_the_runner(self) -> None:
        fake = run_verb(upgrade, _params(helm_path="/opt/helm"), _upgraded())

        assert fake.last.helm_path == "/opt/helm"

    def test_the_block_timeout_is_the_process_budget(self) -> None:
        fake = run_verb(upgrade, _params(timeout=450), _upgraded())

        assert fake.last.deadline_s == 450

    def test_helm_is_called_once(self) -> None:
        fake = run_verb(upgrade, _params(), _upgraded())

        assert len(fake.calls) == 1


class TestUpgradeRepositoryTrust:
    """REQ-4.5.16: a blank Repository CA trusts WAVE's trust set for a chart from a repository."""

    def test_a_repository_chart_trusts_waves_anchors(self, wave_trust: WaveTrust) -> None:
        fake = run_verb(upgrade, _params(session=session_with_ca(), repo=_REPO), _upgraded())

        name = fake.argv[fake.argv.index("--ca-file") + 1]
        assert fake.argv == [
            "upgrade",
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
        run_verb(upgrade, _params(session=session_with_ca(), repo=_REPO), _upgraded())

        assert wave_trust.calls == [wave_trust.spec]

    @pytest.mark.parametrize("chart", _REPOSITORY_CHARTS)
    def test_a_chart_reference_into_a_repository_trusts_waves_anchors(
        self, wave_trust: WaveTrust, chart: str
    ) -> None:
        fake = run_verb(upgrade, helm_params(session=session_with_ca(), chart=chart), _upgraded())

        assert fake.argv[2:5] == [chart, "--ca-file", fake.argv[4]]
        assert _ca_file(fake) == WAVE_ANCHORS

    def test_a_blank_certificate_counts_as_no_certificate(self, wave_trust: WaveTrust) -> None:
        params = _params(session=session_with_ca(), repo=_REPO, repo_ca_cert="  \n")

        fake = run_verb(upgrade, params, _upgraded())

        assert _ca_file(fake) == WAVE_ANCHORS

    @pytest.mark.parametrize("chart", _LOCAL_CHARTS)
    def test_a_local_chart_gets_no_ca_file(self, wave_trust: WaveTrust, chart: str) -> None:
        fake = run_verb(upgrade, helm_params(session=session_with_ca(), chart=chart), _upgraded())

        assert "--ca-file" not in fake.argv
        assert wave_trust.calls == []

    def test_a_repository_ca_is_the_only_certificate_trusted(self, wave_trust: WaveTrust) -> None:
        params = _params(session=session_with_ca(), repo=_REPO, repo_ca_cert=CA_PEM)

        fake = run_verb(upgrade, params, _upgraded())

        assert fake.argv.count("--ca-file") == 1
        assert _ca_file(fake) == CA_PEM
        assert wave_trust.calls == []

    def test_verification_off_skips_verification_without_a_ca_file(
        self, wave_trust: WaveTrust
    ) -> None:
        params = _params(session=session_with_ca(), repo=_REPO, repo_verify_ssl=False)

        fake = run_verb(upgrade, params, _upgraded())

        assert "--insecure-skip-tls-verify" in fake.argv
        assert "--ca-file" not in fake.argv
        assert wave_trust.calls == []


class TestUpgradeSuccess:
    """The new revision's document becomes Result and Status."""

    def test_the_table_form_carries_the_new_revision(self) -> None:
        outputs = outputs_of(upgrade, _params(), _upgraded())

        assert outputs["result"] == release_table_envelope([release_row(revision=2)])

    def test_the_map_form_is_the_document(self) -> None:
        outputs = outputs_of(upgrade, _params(output_format="map"), _upgraded())

        assert outputs["result"] == release_document(revision=2)

    def test_the_json_form_is_the_document_as_text(self) -> None:
        outputs = outputs_of(upgrade, _params(output_format="json"), _upgraded())

        assert json.loads(outputs["result"]) == release_document(revision=2)

    def test_the_yaml_form_rides_the_yaml_envelope(self) -> None:
        outputs = outputs_of(upgrade, _params(output_format="yaml"), _upgraded())

        assert outputs["result"] == {"__wave_type": "yaml", "value": release_document(revision=2)}

    def test_the_status_scalar_is_the_releases_own(self) -> None:
        outputs = outputs_of(upgrade, _params(), _upgraded())

        assert outputs["status"] == "deployed"

    def test_the_outputs_are_the_install_set(self) -> None:
        outputs = outputs_of(upgrade, _params(), _upgraded())

        assert set(outputs) == {"result", "status", "success", "error", "reason"}

    def test_the_console_names_the_release_and_its_revision(self) -> None:
        log = RecordingLog()

        run_verb(upgrade, _params(), _upgraded(), log=log)

        assert log.entries == [("INFO", f"Upgraded release '{RELEASE}' to revision 2")]

    def test_the_envelope_declares_no_secrets(self) -> None:
        envelope = envelope_of(upgrade, _params(), _upgraded())

        assert envelope["secrets"] == []


class TestUpgradeFailure:
    """helm's refusal becomes the block's message and one of the seven Reasons."""

    def test_a_rejected_manifest_stops_the_block(self) -> None:
        with pytest.raises(ValueError, match="^UPGRADE FAILED: unable to build kubernetes"):
            run_verb(upgrade, _params(), [helm_failed(STDERR_BUILD_OBJECTS)])

    def test_a_rejected_manifest_reads_as_invalid(self) -> None:
        outputs = outputs_of(
            upgrade, _params(on_error="record"), [helm_failed(STDERR_BUILD_OBJECTS)]
        )

        assert outputs["reason"] == "Invalid"

    def test_an_atomic_rollback_that_timed_out_reads_as_timeout(self) -> None:
        outputs = outputs_of(upgrade, _params(on_error="record"), [helm_failed(STDERR_TIMED_OUT)])

        assert outputs["reason"] == "Timeout"

    def test_a_missing_release_reads_as_not_found(self) -> None:
        outputs = outputs_of(upgrade, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert outputs["reason"] == "NotFound"

    def test_a_recorded_refusal_empties_the_result_and_status(self) -> None:
        outputs = outputs_of(upgrade, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)])

        assert outputs["result"] == release_table_envelope()
        assert outputs["status"] == ""

    def test_a_recorded_refusal_writes_a_warning_line(self) -> None:
        log = RecordingLog()

        outputs_of(upgrade, _params(on_error="record"), [helm_failed(STDERR_NOT_FOUND)], log=log)

        assert log.entries[-1][0] == "WARN"
        assert log.entries[-1][1].startswith("Helm Upgrade failed (NotFound): ")

    def test_the_process_deadline_is_the_timeout_itself(self) -> None:
        message = "helm upgrade did not finish within 300 s"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(upgrade, _params(), [helm_timed_out()])

    def test_a_recorded_deadline_reports_timeout(self) -> None:
        outputs = outputs_of(upgrade, _params(on_error="record"), [helm_timed_out()])

        assert_failure_outputs(outputs, "helm upgrade did not finish within 300 s", "Timeout")

    def test_a_one_second_timeout_is_the_whole_deadline(self) -> None:
        fake = run_verb(upgrade, _params(timeout=1, on_error="record"), [helm_timed_out()])

        assert fake.last.deadline_s == 1

    def test_atomic_buys_the_cleanup_room_on_top(self) -> None:
        fake = run_verb(
            upgrade,
            _params(timeout=1, atomic=True, cleanup_timeout=45, on_error="record"),
            [helm_timed_out()],
        )

        assert fake.last.deadline_s == 46

    def test_cleanup_on_fail_buys_the_same_room_without_atomic(self) -> None:
        fake = run_verb(
            upgrade,
            _params(timeout=1, cleanup_on_fail=True, cleanup_timeout=45, on_error="record"),
            [helm_timed_out()],
        )

        assert fake.last.deadline_s == 46

    def test_both_flags_together_buy_the_room_once(self) -> None:
        fake = run_verb(
            upgrade,
            _params(
                timeout=1,
                atomic=True,
                cleanup_on_fail=True,
                cleanup_timeout=45,
                on_error="record",
            ),
            [helm_timed_out()],
        )

        assert fake.last.deadline_s == 46

    def test_a_run_that_printed_no_document_is_a_failure(self) -> None:
        message = "helm upgrade printed no release document"

        with pytest.raises(ValueError, match=exact(message)):
            run_verb(upgrade, _params(), [helm_ok('Release "web" has been upgraded.\n')])


class TestUpgradeOciCredentials:
    """REQ-3.5.3.6: a chart in an OCI registry is pulled with the block's own login."""

    def test_the_username_and_password_ride_the_argv(self) -> None:
        params = helm_params(
            session=session_with_ca(),
            chart=_OCI_CHART,
            version="0.1.0",
            repo_username="wave",
            repo_password="oci-secret",
            repo_ca_cert=CA_PEM,
            timeout=60,
        )

        fake = run_verb(upgrade, params, _upgraded())

        assert fake.argv == [
            "upgrade",
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
            "--timeout",
            "60s",
            "--output",
            "json",
        ]

    def test_the_debug_line_hides_the_password(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path, stdout=release_json(revision=2))
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

        upgrade.run(params, log)

        started = [
            message
            for level, message in log.entries
            if level == "DEBUG" and message.startswith("helm upgrade ")
        ]
        assert len(started) == 1
        assert re.fullmatch(
            r"helm upgrade web oci://registry\.example\.com:5000/charts/wave-demo "
            r"--version 0\.1\.0 --username wave --password \*\*\* "
            r"--insecure-skip-tls-verify --namespace apps --timeout 300s --output json "
            r"--kubeconfig \S+",
            started[0],
        )
        assert not [message for message in log.messages if "oci-secret" in message]


class TestUpgradeChartSource:
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

        fake = run_verb(upgrade, params, _upgraded())

        assert fake.last.chart_source == chart_source

    @pytest.mark.parametrize("chart", _LOCAL_CHARTS)
    def test_a_chart_that_is_a_local_path_names_no_source(self, chart: str) -> None:
        fake = run_verb(upgrade, helm_params(chart=chart), _upgraded())

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

        fake = run_verb(upgrade, params, _upgraded())

        assert fake.argv[2] == chart
        assert fake.last.chart_source is None


class TestWaveSideChartSchemesOnTheRemoteHost:
    """On the remote host no bridge resolves a chart scheme, so the verb refuses it before helm."""

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    def test_a_scheme_chart_is_refused_before_helm_runs(self, scheme: str) -> None:
        fake = FakeRunHelm(_upgraded())
        message = (
            f"{scheme} paths are not available on the remote host - "
            "use an absolute or relative path on the remote host"
        )

        with patch_run_helm("upgrade", fake), pytest.raises(ValueError, match=exact(message)):
            upgrade.run(helm_params(chart=f"{scheme}charts/web"), RecordingLog())

        assert fake.calls == []

    def test_a_relative_chart_folder_reaches_helm_as_written(self) -> None:
        fake = run_verb(upgrade, helm_params(chart="charts/../web"), _upgraded())

        assert fake.argv[2] == "charts/../web"
