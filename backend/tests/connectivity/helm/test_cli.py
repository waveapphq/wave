"""The Helm runner and its shaping helpers (REQ-3.5.3.1 - REQ-3.5.3.6).

_cli is the sync core the six Helm verbs ride: it turns a K8s session into a
kubeconfig for the length of one call, starts helm inside that call's own
directory with an environment built from nothing, hands helm the proxy route
WAVE decided for the cluster and the chart source, launches the executable
under a process deadline, turns helm's own text into one of the seven Reasons a
workflow branches on, and shapes the release document into the Result the block
hands back. helm is never executed for real - a scripted stand-in on disk
answers in its place.
"""

import base64
import importlib
import json
import locale
import os
import re
import subprocess
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.connectivity.helm._helm_fixtures import (
    APP_VERSION,
    CHART,
    CHART_RELEASE,
    CLEAN_ENV_KEYS,
    DOCKER_LOGIN_FILE,
    HELM_ENV_KEYS,
    LAST_DEPLOYED,
    LOGIN_PLACEHOLDER,
    OCI_INSTALL_STDOUT,
    OCI_PULL_LINES,
    OCI_RELEASE_DOCUMENT,
    RELEASE,
    STDERR_ALREADY_EXISTS,
    STDERR_BUILD_OBJECTS,
    STDERR_CLUSTER_UNREACHABLE,
    STDERR_DEADLINE_EXCEEDED,
    STDERR_EXECUTION_ERROR,
    STDERR_FORBIDDEN,
    STDERR_HOOK_FAILED,
    STDERR_NO_SUCH_HOST,
    STDERR_NOT_FOUND,
    STDERR_OCI_MISSING_CHART,
    STDERR_OCI_NO_LOGIN_INSTALL,
    STDERR_OCI_NO_LOGIN_UPGRADE,
    STDERR_OCI_WRONG_PASSWORD,
    STDERR_REPO_UNREACHABLE,
    STDERR_SCHEMA_VALIDATION,
    STDERR_STILL_IN_USE,
    STDERR_TIMED_OUT,
    STDERR_UNAUTHORIZED,
    STDERR_UNCLASSIFIED,
    STDERR_UNKNOWN_FLAG,
    STDERR_WITH_WARNING,
    WAVE_ANCHORS,
    WaveTrust,
    fake_helm,
    history_entry,
    history_json,
    kubeconfig_with_wave_anchors,
    release_document,
    release_row,
    release_table_envelope,
    status_document,
    test_hook,
    test_table_envelope,
)
from tests.plugins.k8s._k8s_fixtures import NAMESPACE, SERVER, RecordingLog, exact, session_value
from wavecore.connectivity.helm import _cli
from wavecore.connectivity.run_log import RUN_LOG, RunLog

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
_CA_PEM = "-----BEGIN CERTIFICATE-----\nlab-ca\n-----END CERTIFICATE-----\n"
_UNUSABLE_HOST_VALUE = (
    "This WAVE host's proxy address socks5://proxy.example:1080 is not an http:// address: "
    "choose Custom or turn the proxy off"
)

Decision = Callable[[str, str, int], bool]
Endpoint = tuple[str, int, str | None, str | None]
ChartSource = tuple[str, str, int]

_SECURE: Endpoint = ("secure-proxy.example", 3128, None, None)
_PLAIN: Endpoint = ("plain-proxy.example", 8080, None, None)
_SECURE_URL = "http://secure-proxy.example:3128"
_PLAIN_URL = "http://plain-proxy.example:8080"
_USING_SECURE = "Using the proxy secure-proxy.example:3128"
_CLUSTER_HOST = "k8s.example"
_CHART_HOST = "charts.example"
_CHART_SOURCE: ChartSource = ("https", _CHART_HOST, 443)
_DIRECT_CLUSTER_EXCEPTION = "k8s.example:6443"
_UNDER_CLUSTER_HOST = "charts.k8s.example"
_UNDER_CLUSTER: ChartSource = ("https", _UNDER_CLUSTER_HOST, 6443)
_ON_CLUSTER_HOST: ChartSource = ("http", _CLUSTER_HOST, 6443)
_UNDER_CLUSTER_LINE = (
    "Helm does not use the proxy for {host}: "
    "it is under the cluster's address, which connects directly"
)
_SPECIAL_LOGIN = ("us:er@x", "p@ss:w/rd%1")
_SPECIAL_LOGIN_ENCODED = "us%3Aer%40x:p%40ss%3Aw%2Frd%251"
_SPACED_LOGIN = ("usér name", "pä ss#?&=+")
_SPACED_LOGIN_ENCODED = "us%C3%A9r%20name:p%C3%A4%20ss%23%3F%26%3D%2B"
_HOST_VALUES = {
    "HELM_KUBEAPISERVER": "https://other-cluster.example:6443",
    "HELM_KUBETOKEN": "host-token",
    "HELM_DRIVER": "configmap",
    "HELM_MAX_HISTORY": "3",
    "HELM_NAMESPACE": "host-namespace",
    "HELM_CONFIG_HOME": "/srv/wave/.config/helm",
    "HELM_REGISTRY_CONFIG": "/srv/wave/.config/helm/registry/config.json",
    "KUBECONFIG": "/srv/wave/.kube/config",
    "KUBECACHEDIR": "/srv/wave/.kube/cache",
    "DOCKER_CONFIG": "/srv/wave/.docker",
    "XDG_CONFIG_HOME": "/srv/wave/.config",
    "ALL_PROXY": "socks5://upper-all.example:1080",
    "all_proxy": "socks5://lower-all.example:1080",
    "WAVE_PROBE_VALUE": "from-the-host",
}
_HOST_PROXY_VALUES = {
    "HTTPS_PROXY": "http://upper-secure.example:3128",
    "https_proxy": "http://lower-secure.example:3128",
    "HTTP_PROXY": "http://upper-plain.example:8080",
    "http_proxy": "http://lower-plain.example:8080",
    "NO_PROXY": "upper-direct.example",
    "no_proxy": "lower-direct.example",
}


def _session(**cluster: Any) -> str:
    """A kubeconfig-shaped session whose cluster carries extra keys."""
    document = json.loads(session_value())
    document["clusters"][0]["cluster"].update(cluster)
    return json.dumps(document)


def _kubeconfig(tmp_path: Any, text: str = "{}") -> str:
    """A kubeconfig file inside its own workspace-shaped directory."""
    home = tmp_path / "work"
    home.mkdir(exist_ok=True)
    path = home / "kubeconfig.json"
    path.write_text(text, encoding="utf-8")
    return str(path)


def _cluster(text: str) -> dict[str, Any]:
    cluster: dict[str, Any] = json.loads(text)["clusters"][0]["cluster"]
    return cluster


def _session_at(server: str = SERVER) -> str:
    """A session that carries its own CA, so its kubeconfig never reads WAVE's trust set."""
    return _session(server=server, **{"certificate-authority-data": "Y2E="})


def _always(_scheme: str, _host: str, _port: int) -> bool:
    return True


def _never(_scheme: str, _host: str, _port: int) -> bool:
    return False


def _only(*hosts: str) -> Decision:
    """A decision that sends the named hosts through the proxy and every other one direct."""

    def decide(_scheme: str, host: str, _port: int) -> bool:
        return host in hosts

    return decide


def _http_targets(scheme: str, _host: str, _port: int) -> bool:
    """A decision that sends http targets through the proxy and https targets direct."""
    return scheme == "http"


def _refusing(text: str, *schemes: str) -> Decision:
    """A decision that fails for the named protocols, as a proxy value WAVE cannot use does."""

    def decide(scheme: str, _host: str, _port: int) -> bool:
        if scheme in schemes:
            raise importlib.import_module("wavecore.connectivity.proxy").ProxyError(text)
        return False

    return decide


def _use(
    through: Decision = _always,
    https: Endpoint | None = _SECURE,
    http: Endpoint | None = _PLAIN,
) -> None:
    """Put a hand-built proxy in force the way the WAVE host does: through the resolver."""
    proxy = importlib.import_module("wavecore.connectivity.proxy")
    spec = proxy.ProxySpec(
        https and proxy.ProxyEndpoint(*https), http and proxy.ProxyEndpoint(*http), through
    )
    proxy.set_resolver(lambda: spec)


@dataclass
class Started:
    """One helm start: what the runner handed the process and what the process found."""

    env: dict[str, str]
    workspace: str
    cwd: str
    files: dict[str, str]

    @property
    def decided(self) -> dict[str, str]:
        """Everything in the environment beyond the clean list: the route of the call."""
        return {name: value for name, value in self.env.items() if name not in CLEAN_ENV_KEYS}

    @property
    def cluster(self) -> dict[str, Any]:
        """The cluster entry of the kubeconfig helm read."""
        return _cluster(self.files[os.path.join(self.workspace, "kubeconfig.json")])

    def login(self, path: str) -> Any:
        """One login file as helm found it when it started; None when there was none."""
        text = self.files.get(path)
        return None if text is None else json.loads(text)


def _started(
    tmp_path: Any, session: str = "", log: Any = None, runs: int = 1, **route: Any
) -> Started:
    """Start the scripted helm the way a verb does: the session's kubeconfig, then the runner."""
    from wavecore.plugins import _process_group

    helm = fake_helm(tmp_path)
    handed: list[dict[str, Any]] = []
    launch = _process_group.launch

    def recording(argv: list[str], **settings: Any) -> Any:
        handed.append(settings)
        return launch(argv, **settings)

    with _cli.helm_workspace() as work, patch.object(_process_group, "launch", recording):
        kubeconfig = work.write("kubeconfig.json", _cli.kubeconfig_text(session or _session_at()))
        for _ in range(runs):
            _cli.run_helm(
                ["install", RELEASE, CHART],
                kubeconfig=kubeconfig,
                helm_path=helm.path,
                deadline_s=30,
                log=RecordingLog() if log is None else log,
                **route,
            )
        report = helm.report_json()
    return Started(dict(handed[0]["env"]), work.path, report["cwd"], report["files"])


def _route_lines(log: RecordingLog) -> list[tuple[str, str]]:
    """What one block run wrote beside helm's own start line, each line with its level."""
    return [(level, message) for level, message in log.entries if not message.startswith("helm ")]


def _debug(*messages: str) -> list[tuple[str, str]]:
    """The named lines as a block run's log holds them when each was written at DEBUG."""
    return [("DEBUG", message) for message in messages]


@pytest.fixture
def block_log() -> Iterator[RecordingLog]:
    """One block run: the log its verb writes to is also the run's once-per-run sink."""
    log = RecordingLog()
    token = RUN_LOG.set(RunLog(log))
    yield log
    RUN_LOG.reset(token)


@pytest.fixture
def host_values(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """A WAVE host whose own environment names a cluster, helm folders, logins and a proxy."""
    values = {**_HOST_VALUES, **_HOST_PROXY_VALUES}
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    return values


@pytest.fixture(params=[None, "prod-host"], ids=["on the WAVE host", "on a remote host"])
def execution_host(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> str | None:
    """Where helm runs: the WAVE host, or a remote host the bundle worker named."""
    host: str | None = request.param
    monkeypatch.setattr(_cli, "REMOTE_HOST", host)
    return host


class TestKubeconfigText:
    """The session becomes helm's kubeconfig verbatim, with one projection."""

    def test_an_unreadable_session_is_refused_with_the_family_message(self) -> None:
        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _cli.kubeconfig_text("not a kubeconfig")

    def test_a_session_that_is_not_a_config_is_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            _cli.kubeconfig_text(json.dumps({"kind": "Pod"}))

    def test_the_document_is_carried_over_key_for_key(self) -> None:
        session = _session(**{"certificate-authority-data": "Y2E="})

        text = _cli.kubeconfig_text(session)

        assert json.loads(text) == json.loads(session)

    def test_a_nonstandard_cluster_key_survives(self) -> None:
        """extensions is a standard kubeconfig field: WAVE's TLS pins ride it."""
        text = _cli.kubeconfig_text(
            _session(extensions=[{"name": "wave", "extension": {"tls_min_version": "1.3"}}])
        )

        cluster = json.loads(text)["clusters"][0]["cluster"]
        assert cluster["extensions"] == [{"name": "wave", "extension": {"tls_min_version": "1.3"}}]

    def test_the_certificate_authority_is_kept_while_verification_is_on(self) -> None:
        text = _cli.kubeconfig_text(_session(**{"certificate-authority-data": "Y2E="}))

        assert json.loads(text)["clusters"][0]["cluster"]["certificate-authority-data"] == "Y2E="

    def test_the_certificate_authority_is_dropped_when_verification_is_off(self) -> None:
        """client-go refuses the pair that K8s Connect accepts."""
        text = _cli.kubeconfig_text(
            _session(**{"certificate-authority-data": "Y2E=", "insecure-skip-tls-verify": True})
        )

        cluster = json.loads(text)["clusters"][0]["cluster"]
        assert "certificate-authority-data" not in cluster
        assert cluster["insecure-skip-tls-verify"] is True

    def test_the_server_and_the_rest_of_the_cluster_survive_the_projection(self) -> None:
        text = _cli.kubeconfig_text(
            _session(
                **{
                    "certificate-authority-data": "Y2E=",
                    "insecure-skip-tls-verify": True,
                    "tls-server-name": "kwok-internal",
                }
            )
        )

        cluster = json.loads(text)["clusters"][0]["cluster"]
        assert cluster["server"] == SERVER
        assert cluster["tls-server-name"] == "kwok-internal"

    def test_a_session_without_a_certificate_authority_is_left_alone(self) -> None:
        text = _cli.kubeconfig_text(_session(**{"insecure-skip-tls-verify": True}))

        assert "certificate-authority-data" not in json.loads(text)["clusters"][0]["cluster"]


class TestKubeconfigWaveTrust:
    """REQ-4.5.16: a session without a CA reaches helm carrying WAVE's trust set."""

    def test_a_blank_ca_carries_waves_anchors_as_certificate_authority_data(
        self, wave_trust: WaveTrust
    ) -> None:
        text = _cli.kubeconfig_text(session_value())

        expected = base64.b64encode(WAVE_ANCHORS.encode("utf-8")).decode("ascii")
        assert _cluster(text)["certificate-authority-data"] == expected

    def test_a_blank_ca_reads_the_anchors_of_the_active_spec(self, wave_trust: WaveTrust) -> None:
        _cli.kubeconfig_text(session_value())

        assert wave_trust.calls == [wave_trust.spec]

    def test_a_blank_ca_adds_only_the_certificate_authority(self, wave_trust: WaveTrust) -> None:
        text = _cli.kubeconfig_text(session_value())

        assert json.loads(text) == kubeconfig_with_wave_anchors()

    def test_verification_left_on_explicitly_still_carries_waves_anchors(
        self, wave_trust: WaveTrust
    ) -> None:
        text = _cli.kubeconfig_text(_session(**{"insecure-skip-tls-verify": False}))

        cluster = _cluster(text)
        assert base64.b64decode(cluster["certificate-authority-data"]).decode() == WAVE_ANCHORS
        assert cluster["insecure-skip-tls-verify"] is False

    def test_a_session_ca_is_kept_as_the_only_certificate(self, wave_trust: WaveTrust) -> None:
        text = _cli.kubeconfig_text(_session(**{"certificate-authority-data": "Y2E="}))

        assert _cluster(text)["certificate-authority-data"] == "Y2E="

    def test_a_session_ca_never_reads_waves_anchors(self, wave_trust: WaveTrust) -> None:
        _cli.kubeconfig_text(_session(**{"certificate-authority-data": "Y2E="}))

        assert wave_trust.calls == []

    def test_verification_off_writes_no_certificate_authority(self, wave_trust: WaveTrust) -> None:
        text = _cli.kubeconfig_text(_session(**{"insecure-skip-tls-verify": True}))

        assert "certificate-authority-data" not in _cluster(text)

    def test_verification_off_never_reads_waves_anchors(self, wave_trust: WaveTrust) -> None:
        _cli.kubeconfig_text(_session(**{"insecure-skip-tls-verify": True}))

        assert wave_trust.calls == []

    def test_a_plain_http_cluster_never_reads_waves_anchors(self, wave_trust: WaveTrust) -> None:
        text = _cli.kubeconfig_text(_session(server="http://k8s.example:8080"))

        assert "certificate-authority-data" not in _cluster(text)
        assert wave_trust.calls == []


class TestKubeconfigProxy:
    """REQ-3.5.3.6: the cluster's route rides the kubeconfig as the cluster's own proxy address."""

    def test_a_cluster_through_the_proxy_carries_the_proxy_address(self) -> None:
        _use(_always)

        assert _cluster(_cli.kubeconfig_text(_session_at())).get("proxy-url") == _SECURE_URL

    def test_the_proxy_address_is_the_only_key_added(self) -> None:
        _use(_always)
        expected = json.loads(_session_at())
        expected["clusters"][0]["cluster"]["proxy-url"] = _SECURE_URL

        assert json.loads(_cli.kubeconfig_text(_session_at())) == expected

    def test_a_cluster_that_connects_directly_carries_no_proxy_address(self) -> None:
        _use(_never)

        assert json.loads(_cli.kubeconfig_text(_session_at())) == json.loads(_session_at())

    @pytest.mark.parametrize(
        ("server", "address"),
        [
            ("https://k8s.example:6443", ("https", "k8s.example", 6443)),
            ("https://k8s.example", ("https", "k8s.example", 443)),
            ("http://k8s.example:8080", ("http", "k8s.example", 8080)),
            ("https://10.0.0.7:6443", ("https", "10.0.0.7", 6443)),
            ("https://[2001:db8::10]:6443", ("https", "2001:db8::10", 6443)),
        ],
    )
    def test_the_decision_is_asked_about_the_cluster_address(
        self, server: str, address: tuple[str, str, int]
    ) -> None:
        asked: list[tuple[str, str, int]] = []

        def decide(scheme: str, host: str, port: int) -> bool:
            asked.append((scheme, host, port))
            return True

        _use(decide)

        _cli.kubeconfig_text(_session_at(server))

        assert set(asked) == {address}

    def test_an_https_cluster_uses_the_proxy_for_https_targets(self) -> None:
        _use(_always)

        text = _cli.kubeconfig_text(_session_at("https://k8s.example:6443"))

        assert _cluster(text).get("proxy-url") == _SECURE_URL

    def test_an_http_cluster_uses_the_proxy_for_http_targets(self) -> None:
        _use(_always)

        text = _cli.kubeconfig_text(_session_at("http://k8s.example:8080"))

        assert _cluster(text).get("proxy-url") == _PLAIN_URL

    @pytest.mark.parametrize(
        ("server", "https", "http"),
        [
            ("https://k8s.example:6443", None, _PLAIN),
            ("http://k8s.example:8080", _SECURE, None),
        ],
        ids=["https cluster", "http cluster"],
    )
    def test_a_cluster_whose_protocol_has_no_proxy_connects_directly(
        self, server: str, https: Endpoint | None, http: Endpoint | None
    ) -> None:
        _use(_always, https, http)

        assert "proxy-url" not in _cluster(_cli.kubeconfig_text(_session_at(server)))

    @pytest.mark.parametrize(
        ("login", "encoded"),
        [
            (("wave", "s3cret"), "wave:s3cret"),
            (_SPECIAL_LOGIN, _SPECIAL_LOGIN_ENCODED),
            (_SPACED_LOGIN, _SPACED_LOGIN_ENCODED),
        ],
        ids=["plain", "reserved characters", "space, accent and plus"],
    )
    def test_the_proxy_login_is_percent_encoded(self, login: tuple[str, str], encoded: str) -> None:
        _use(_always, ("secure-proxy.example", 3128, *login))

        cluster = _cluster(_cli.kubeconfig_text(_session_at()))

        assert cluster.get("proxy-url") == f"http://{encoded}@secure-proxy.example:3128"

    def test_an_ipv6_proxy_address_is_written_in_brackets(self) -> None:
        _use(_always, ("2001:db8::5", 3128, *_SPECIAL_LOGIN))

        cluster = _cluster(_cli.kubeconfig_text(_session_at()))

        assert cluster.get("proxy-url") == f"http://{_SPECIAL_LOGIN_ENCODED}@[2001:db8::5]:3128"

    @pytest.mark.parametrize(
        "server", ["https://127.0.0.1:6443", "https://localhost:6443", "https://[::1]:6443"]
    )
    def test_a_cluster_on_a_local_address_is_routed_like_any_other(self, server: str) -> None:
        _use(_always)

        assert _cluster(_cli.kubeconfig_text(_session_at(server))).get("proxy-url") == _SECURE_URL

    def test_a_proxy_value_wave_cannot_use_stops_the_run_with_its_own_text(self) -> None:
        _use(_refusing(_UNUSABLE_HOST_VALUE, "https"))

        with pytest.raises(Exception, match=exact(_UNUSABLE_HOST_VALUE)):
            _cli.kubeconfig_text(_session_at())

    def test_on_a_remote_host_wave_decides_nothing(self) -> None:
        proxy = importlib.import_module("wavecore.connectivity.proxy")
        asked: list[str] = []

        def resolver() -> Any:
            asked.append("asked")
            return proxy.ProxySpec(proxy.ProxyEndpoint(*_SECURE), None, _always)

        proxy.set_resolver(resolver)

        with patch.object(_cli, "REMOTE_HOST", "prod-host"):
            text = _cli.kubeconfig_text(_session_at())

        assert json.loads(text) == json.loads(_session_at())
        assert asked == []


class TestHelmExecutable:
    """REQ-3.4.3.12, HELM-1: which executable a Helm Path names."""

    def test_a_relative_path_starts_at_the_home_folder(
        self, server_home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HOME", str(server_home))

        assert _cli._helm_executable("bin/helm") == os.path.join(str(server_home), "bin/helm")

    def test_a_bare_name_is_left_for_the_path_lookup(
        self, server_home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HOME", str(server_home))

        assert _cli._helm_executable("helm3") == "helm3"

    def test_an_absolute_path_is_unchanged(
        self, server_home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HOME", str(server_home))

        assert _cli._helm_executable("/srv/tools/helm/bin/helm") == "/srv/tools/helm/bin/helm"

    def test_an_empty_path_runs_helm(self) -> None:
        assert _cli._helm_executable("") == "helm"

    def test_a_home_shorthand_starts_at_the_home_folder(
        self, server_home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HOME", str(server_home))

        assert _cli._helm_executable("~/bin/helm") == os.path.join(str(server_home), "bin/helm")

    def test_run_helm_launches_a_relative_path_from_the_home_folder(
        self, tmp_path: Any, server_home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        helm = fake_helm(server_home, stdout="from-home")
        monkeypatch.setenv("HOME", str(server_home))
        relative = os.path.relpath(helm.path, server_home)

        result = _cli.run_helm(
            ["status", RELEASE],
            kubeconfig=_kubeconfig(tmp_path),
            helm_path=relative,
            deadline_s=30,
            log=RecordingLog(),
        )

        assert result.stdout == "from-home"


class TestHelmWorkspace:
    """One temp directory per call holds everything helm reads, and outlives nothing."""

    def test_the_directory_exists_inside_the_block(self) -> None:
        with _cli.helm_workspace() as work:
            assert os.path.isdir(work.path)

    def test_the_directory_is_removed_afterwards(self) -> None:
        with _cli.helm_workspace() as work:
            path = work.path

        assert not os.path.exists(path)

    def test_the_directory_is_removed_when_the_body_raises(self) -> None:
        path = ""
        with pytest.raises(RuntimeError, match=exact("boom")):
            with _cli.helm_workspace() as work:
                path = work.path
                raise RuntimeError("boom")

        assert not os.path.exists(path)

    def test_write_returns_an_absolute_path_inside_the_workspace(self) -> None:
        with _cli.helm_workspace() as work:
            path = work.write("values.yaml", "replicaCount: 2\n")

            assert os.path.isabs(path)
            assert os.path.dirname(path) == work.path

    def test_write_stores_the_text_verbatim(self) -> None:
        with _cli.helm_workspace() as work:
            path = work.write("values.yaml", "replicaCount: 2\n")

            with open(path, encoding="utf-8") as handle:
                assert handle.read() == "replicaCount: 2\n"

    def test_written_files_are_owner_only(self) -> None:
        with _cli.helm_workspace() as work:
            path = work.write("kubeconfig.json", "{}")

            assert oct(os.stat(path).st_mode & 0o777) == "0o600"

    def test_written_files_go_with_the_directory(self) -> None:
        with _cli.helm_workspace() as work:
            path = work.write("ca.pem", _CA_PEM)

        assert not os.path.exists(path)


class TestRunHelmProcess:
    """The runner launches the real executable and reports its three streams."""

    def test_the_kubeconfig_pair_is_appended_to_the_argv(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path)
        kubeconfig = _kubeconfig(tmp_path)

        _cli.run_helm(
            ["status", RELEASE],
            kubeconfig=kubeconfig,
            helm_path=helm.path,
            deadline_s=30,
            log=RecordingLog(),
        )

        assert helm.report_json()["argv"] == ["status", RELEASE, "--kubeconfig", kubeconfig]

    def test_the_kubeconfig_reaches_helm_with_its_content(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path)
        kubeconfig = _kubeconfig(tmp_path, session_value())

        _cli.run_helm(
            ["status", RELEASE],
            kubeconfig=kubeconfig,
            helm_path=helm.path,
            deadline_s=30,
            log=RecordingLog(),
        )

        assert helm.report_json()["kubeconfig"] == session_value()

    def test_the_kubeconfig_is_owner_only_on_disk(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path)
        with _cli.helm_workspace() as work:
            kubeconfig = work.write("kubeconfig.json", session_value())

            _cli.run_helm(
                ["status", RELEASE],
                kubeconfig=kubeconfig,
                helm_path=helm.path,
                deadline_s=30,
                log=RecordingLog(),
            )

        assert helm.report_json()["mode"] == "0o600"

    def test_the_three_streams_come_back(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path, stdout="{}", stderr=STDERR_NOT_FOUND, exit_code=1)

        result = _cli.run_helm(
            ["status", RELEASE],
            kubeconfig=_kubeconfig(tmp_path),
            helm_path=helm.path,
            deadline_s=30,
            log=RecordingLog(),
        )

        assert (result.stdout, result.stderr, result.exit_code) == ("{}", STDERR_NOT_FOUND, 1)

    def test_a_clean_run_is_not_marked_timed_out(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path, stdout="{}")

        result = _cli.run_helm(
            ["status", RELEASE],
            kubeconfig=_kubeconfig(tmp_path),
            helm_path=helm.path,
            deadline_s=30,
            log=RecordingLog(),
        )

        assert result.timed_out is False

    def test_an_empty_helm_path_runs_the_executable_named_helm_on_the_path(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        helm = fake_helm(tmp_path, stdout="on-path")
        monkeypatch.setenv("PATH", os.path.dirname(helm.path) + os.pathsep + os.environ["PATH"])

        result = _cli.run_helm(
            ["status", RELEASE],
            kubeconfig=_kubeconfig(tmp_path),
            helm_path="",
            deadline_s=30,
            log=RecordingLog(),
        )

        assert result.stdout == "on-path"

    def test_a_helm_path_is_executed_as_given(self, tmp_path: Any) -> None:
        """HELM-1: an absolute Helm Path is executed as given."""
        helm = fake_helm(tmp_path, stdout="by-path", name="helm-4")

        result = _cli.run_helm(
            ["status", RELEASE],
            kubeconfig=_kubeconfig(tmp_path),
            helm_path=f"  {helm.path}  ",
            deadline_s=30,
            log=RecordingLog(),
        )

        assert result.stdout == "by-path"

    def test_the_run_is_logged_at_debug_before_it_starts(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path)
        kubeconfig = _kubeconfig(tmp_path)
        log = RecordingLog()

        _cli.run_helm(
            ["status", RELEASE],
            kubeconfig=kubeconfig,
            helm_path=helm.path,
            deadline_s=30,
            log=log,
        )

        assert log.entries == [("DEBUG", f"helm status {RELEASE} --kubeconfig {kubeconfig}")]

    def test_the_debug_line_hides_the_repository_password(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path)
        log = RecordingLog()

        _cli.run_helm(
            ["install", RELEASE, "--password", "chart-secret"],
            kubeconfig=_kubeconfig(tmp_path),
            helm_path=helm.path,
            deadline_s=30,
            log=log,
        )

        assert "chart-secret" not in log.messages[0]
        assert "--password ***" in log.messages[0]


_GREETING = "Grüße 測試\n"


def _helm_printing(tmp_path: Any, stdout: bytes, stderr: bytes) -> str:
    """A scripted helm that prints these exact bytes; the shared stand-in prints text only."""
    home = tmp_path / "raw-helm"
    home.mkdir()
    (home / "stdout").write_bytes(stdout)
    (home / "stderr").write_bytes(stderr)
    launcher = home / "helm"
    launcher.write_text(
        f'#!/bin/sh\ncat "{home}/stdout"\ncat "{home}/stderr" >&2\n', encoding="utf-8"
    )
    launcher.chmod(0o700)
    return str(launcher)


def _read_back(tmp_path: Any, stdout: bytes, stderr: bytes) -> tuple[str, str, int]:
    """What the runner reports for a helm that printed these bytes on its two streams."""
    result = _cli.run_helm(
        ["status", RELEASE],
        kubeconfig=_kubeconfig(tmp_path),
        helm_path=_helm_printing(tmp_path, stdout, stderr),
        deadline_s=30,
        log=RecordingLog(),
    )
    return result.stdout, result.stderr, result.exit_code


@pytest.fixture
def host_locale_is_not_utf8() -> Iterator[None]:
    """This process under the C locale, where text read with no named encoding is ASCII."""
    before = locale.setlocale(locale.LC_CTYPE)
    locale.setlocale(locale.LC_CTYPE, "C")
    yield
    locale.setlocale(locale.LC_CTYPE, before)


class TestHelmOutputIsReadAsUTF8:
    """REQ-4.6.9: helm's output is UTF-8 on every host, and a stray byte never fails the run."""

    def test_the_launch_names_utf8_with_replacement(self, tmp_path: Any) -> None:
        from wavecore.plugins import _process_group

        with patch.object(_process_group, "launch", wraps=_process_group.launch) as launch:
            _read_back(tmp_path, b"{}", b"")

        settings = launch.call_args.kwargs
        assert (settings.get("encoding"), settings.get("errors")) == ("utf-8", "replace")

    def test_text_outside_ascii_comes_back_whole(
        self, tmp_path: Any, host_locale_is_not_utf8: None
    ) -> None:
        printed = _GREETING.encode()

        assert _read_back(tmp_path, printed, printed) == (_GREETING, _GREETING, 0)

    def test_a_byte_that_is_not_utf8_comes_back_as_the_replacement_character(
        self, tmp_path: Any
    ) -> None:
        streams = _read_back(tmp_path, b"cafe\xe9\n", "Grüße ".encode() + b"\xff\n")

        assert streams == ("cafe\ufffd\n", "Grüße \ufffd\n", 0)


class TestRunHelmEnvironment:
    """Nothing of the run persists, and nothing of the user's helm leaks in."""

    @staticmethod
    def _env(tmp_path: Any) -> dict[str, str]:
        helm = fake_helm(tmp_path)
        with _cli.helm_workspace() as work:
            kubeconfig = work.write("kubeconfig.json", "{}")
            _cli.run_helm(
                ["status", RELEASE],
                kubeconfig=kubeconfig,
                helm_path=helm.path,
                deadline_s=30,
                log=RecordingLog(),
            )
            report = helm.report_json()
        report["home"] = os.path.dirname(kubeconfig)
        return report

    def test_every_helm_home_points_into_the_call_directory(self, tmp_path: Any) -> None:
        report = self._env(tmp_path)

        for key in HELM_ENV_KEYS:
            assert report["env"][key].startswith(report["home"] + os.sep), key

    def test_the_helm_homes_carry_the_pinned_names(self, tmp_path: Any) -> None:
        report = self._env(tmp_path)
        home = report["home"]
        named = (
            "HELM_CACHE_HOME",
            "HELM_DATA_HOME",
            "HELM_REPOSITORY_CACHE",
            "HELM_REPOSITORY_CONFIG",
        )

        assert [report["env"][key] for key in named] == [
            os.path.join(home, "cache"),
            os.path.join(home, "data"),
            os.path.join(home, "repository"),
            os.path.join(home, "repositories.yaml"),
        ]

    def test_an_ambient_kubeconfig_never_reaches_helm(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("KUBECONFIG", "/home/wave/.kube/config")

        assert "KUBECONFIG" not in self._env(tmp_path)["env"]


class TestCleanEnvironment:
    """REQ-3.5.3.6: helm starts with the environment WAVE builds, never with the WAVE host's."""

    def test_helm_gets_exactly_the_clean_list(
        self, tmp_path: Any, host_values: dict[str, str]
    ) -> None:
        started = _started(tmp_path)

        assert sorted(started.env) == sorted(CLEAN_ENV_KEYS)

    def test_no_value_of_the_wave_host_reaches_helm(
        self, tmp_path: Any, host_values: dict[str, str]
    ) -> None:
        started = _started(tmp_path)

        leaked = {
            name: value for name, value in host_values.items() if started.env.get(name) == value
        }
        assert leaked == {}

    def test_the_path_is_the_wave_hosts_own(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = os.pathsep.join(["/srv/wave/bin", os.environ["PATH"]])
        monkeypatch.setenv("PATH", path)

        assert _started(tmp_path).env.get("PATH") == path

    def test_a_wave_host_without_a_path_hands_helm_the_systems_default_one(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("PATH")

        assert _started(tmp_path).env.get("PATH") == os.defpath

    def test_home_and_the_temp_folder_are_the_call_directory(self, tmp_path: Any) -> None:
        started = _started(tmp_path)

        assert started.env.get("HOME") == started.workspace
        assert started.env.get("TMPDIR") == started.workspace

    def test_helm_folders_the_wave_host_names_are_replaced_by_the_call_directory(
        self, tmp_path: Any, host_values: dict[str, str]
    ) -> None:
        started = _started(tmp_path)

        inside = started.workspace + os.sep
        outside = [
            name for name in HELM_ENV_KEYS if not started.env.get(name, "").startswith(inside)
        ]
        assert outside == []

    def test_helm_runs_inside_the_call_directory(self, tmp_path: Any) -> None:
        started = _started(tmp_path)

        assert os.path.realpath(started.cwd) == os.path.realpath(started.workspace)

    def test_a_proxy_in_force_adds_only_the_variables_wave_decides(
        self, tmp_path: Any, host_values: dict[str, str]
    ) -> None:
        _use(_always)

        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        assert sorted(started.env) == sorted([*CLEAN_ENV_KEYS, "HTTPS_PROXY", "HTTP_PROXY"])
        assert started.decided == {"HTTPS_PROXY": _SECURE_URL, "HTTP_PROXY": _PLAIN_URL}


class TestStoredLogins:
    """REQ-3.5.3.6: helm finds a login file of WAVE's own in both places it looks for one."""

    def test_the_registry_login_file_holds_one_placeholder_entry(
        self, tmp_path: Any, execution_host: str | None
    ) -> None:
        started = _started(tmp_path)

        assert started.login(started.env.get("HELM_REGISTRY_CONFIG", "")) == LOGIN_PLACEHOLDER

    def test_the_docker_login_file_holds_one_placeholder_entry(
        self, tmp_path: Any, execution_host: str | None
    ) -> None:
        started = _started(tmp_path)

        assert started.env.get("HOME") == started.workspace
        assert started.login(os.path.join(started.workspace, DOCKER_LOGIN_FILE)) == (
            LOGIN_PLACEHOLDER
        )

    def test_a_docker_folder_the_wave_host_names_is_never_handed_on(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch, execution_host: str | None
    ) -> None:
        monkeypatch.setenv("DOCKER_CONFIG", "/srv/wave/.docker")

        assert "DOCKER_CONFIG" not in _started(tmp_path).env


class TestProxyRoute:
    """REQ-3.5.3.6: WAVE decides the route of the cluster and the chart source and tells helm."""

    def test_cluster_and_chart_source_through_the_proxy(self, tmp_path: Any) -> None:
        _use(_always)

        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        assert started.decided == {"HTTPS_PROXY": _SECURE_URL, "HTTP_PROXY": _PLAIN_URL}
        assert started.cluster.get("proxy-url") == _SECURE_URL

    def test_only_the_cluster_through_the_proxy(self, tmp_path: Any) -> None:
        _use(_only(_CLUSTER_HOST))

        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        assert started.decided == {}
        assert started.cluster.get("proxy-url") == _SECURE_URL

    def test_only_the_chart_source_through_the_proxy(self, tmp_path: Any) -> None:
        _use(_only(_CHART_HOST))

        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        assert started.decided == {
            "HTTPS_PROXY": _SECURE_URL,
            "HTTP_PROXY": _PLAIN_URL,
            "NO_PROXY": "k8s.example:6443",
        }
        assert "proxy-url" not in started.cluster

    def test_neither_through_the_proxy(self, tmp_path: Any) -> None:
        _use(_never)

        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        assert started.decided == {}
        assert "proxy-url" not in started.cluster

    def test_without_a_proxy_in_force_helm_is_told_nothing(self, tmp_path: Any) -> None:
        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        assert started.decided == {}
        assert "proxy-url" not in started.cluster

    def test_a_run_that_names_no_chart_source_gets_no_proxy_variables(self, tmp_path: Any) -> None:
        _use(_always)

        started = _started(tmp_path)

        assert started.decided == {}
        assert started.cluster.get("proxy-url") == _SECURE_URL

    def test_an_http_chart_source_uses_the_proxy_for_http_targets(self, tmp_path: Any) -> None:
        _use(_only(_CHART_HOST), None, _PLAIN)

        started = _started(tmp_path, chart_source=("http", _CHART_HOST, 80))

        assert started.decided == {"HTTP_PROXY": _PLAIN_URL, "NO_PROXY": "k8s.example:6443"}

    def test_only_an_endpoint_that_exists_becomes_a_variable(self, tmp_path: Any) -> None:
        _use(_only(_CHART_HOST), _SECURE, None)

        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        assert started.decided == {"HTTPS_PROXY": _SECURE_URL, "NO_PROXY": "k8s.example:6443"}

    @pytest.mark.parametrize(
        ("chart_source", "https", "http"),
        [
            (("https", _CHART_HOST, 443), None, _PLAIN),
            (("http", _CHART_HOST, 80), _SECURE, None),
        ],
        ids=["https chart source", "http chart source"],
    )
    def test_a_chart_source_whose_protocol_has_no_proxy_connects_directly(
        self,
        tmp_path: Any,
        chart_source: ChartSource,
        https: Endpoint | None,
        http: Endpoint | None,
    ) -> None:
        _use(_only(_CHART_HOST), https, http)

        started = _started(tmp_path, chart_source=chart_source)

        assert started.decided == {}

    def test_each_proxy_login_is_percent_encoded(self, tmp_path: Any) -> None:
        _use(
            _always,
            ("secure-proxy.example", 3128, *_SPECIAL_LOGIN),
            ("plain-proxy.example", 8080, *_SPACED_LOGIN),
        )

        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        secure = f"http://{_SPECIAL_LOGIN_ENCODED}@secure-proxy.example:3128"
        assert started.decided == {
            "HTTPS_PROXY": secure,
            "HTTP_PROXY": f"http://{_SPACED_LOGIN_ENCODED}@plain-proxy.example:8080",
        }
        assert started.cluster.get("proxy-url") == secure

    def test_an_ipv6_proxy_address_is_written_in_brackets(self, tmp_path: Any) -> None:
        _use(_only(_CHART_HOST), ("2001:db8::5", 3128, None, None), None)

        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        assert started.decided.get("HTTPS_PROXY") == "http://[2001:db8::5]:3128"

    @pytest.mark.parametrize(
        ("server", "entry"),
        [
            ("https://k8s.example:6443", "k8s.example:6443"),
            ("https://k8s.example", "k8s.example:443"),
            ("https://10.0.0.7:6443", "10.0.0.7:6443"),
            ("https://[2001:db8::10]:6443", "[2001:db8::10]:6443"),
            ("https://[2001:db8::10]", "[2001:db8::10]:443"),
            ("https://127.0.0.1:6443", "127.0.0.1:6443"),
            ("https://localhost:6443", "localhost:6443"),
            ("https://[::1]:6443", "[::1]:6443"),
        ],
    )
    def test_a_direct_cluster_is_the_one_exception_with_its_port_always_written(
        self, tmp_path: Any, server: str, entry: str
    ) -> None:
        _use(_only(_CHART_HOST))

        started = _started(tmp_path, _session_at(server), chart_source=_CHART_SOURCE)

        assert started.decided == {
            "HTTPS_PROXY": _SECURE_URL,
            "HTTP_PROXY": _PLAIN_URL,
            "NO_PROXY": entry,
        }

    @pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "127.8.9.10", "::1"])
    def test_a_chart_source_on_a_local_address_never_gets_proxy_variables(
        self, tmp_path: Any, host: str
    ) -> None:
        _use(_always)

        started = _started(tmp_path, chart_source=("https", host, 8443))

        assert started.decided == {}
        assert started.cluster.get("proxy-url") == _SECURE_URL

    @pytest.mark.parametrize(
        ("server", "through", "chart_source"),
        [
            (SERVER, _only(_UNDER_CLUSTER_HOST), _UNDER_CLUSTER),
            (SERVER, _only("Charts.K8S.Example"), ("https", "Charts.K8S.Example", 6443)),
            (SERVER, _http_targets, _ON_CLUSTER_HOST),
            ("https://10.0.0.7:6443", _http_targets, ("http", "10.0.0.7", 6443)),
            ("https://[2001:db8::10]:6443", _http_targets, ("http", "2001:db8::10", 6443)),
        ],
        ids=[
            "a name under the cluster's",
            "a name under the cluster's in capitals",
            "the cluster's own name",
            "the cluster's own ipv4 address",
            "the cluster's own ipv6 address",
        ],
    )
    def test_a_chart_source_under_a_direct_clusters_address_gets_no_proxy_variables(
        self, tmp_path: Any, server: str, through: Decision, chart_source: ChartSource
    ) -> None:
        _use(through)

        started = _started(tmp_path, _session_at(server), chart_source=chart_source)

        assert started.decided == {}
        assert "proxy-url" not in started.cluster

    def test_a_chart_source_under_a_proxied_clusters_address_keeps_the_proxy(
        self, tmp_path: Any
    ) -> None:
        _use(_always)

        started = _started(tmp_path, chart_source=_UNDER_CLUSTER)

        assert started.decided == {"HTTPS_PROXY": _SECURE_URL, "HTTP_PROXY": _PLAIN_URL}
        assert started.cluster.get("proxy-url") == _SECURE_URL

    @pytest.mark.parametrize(
        "chart_source",
        [
            ("https", _UNDER_CLUSTER_HOST, 443),
            ("https", _CLUSTER_HOST, 443),
            ("https", "xk8s.example", 6443),
            ("https", "k8s.example.org", 6443),
        ],
        ids=[
            "under the cluster's name on another port",
            "the cluster's name on another port",
            "a longer first label",
            "a longer name",
        ],
    )
    def test_a_chart_source_helm_can_tell_from_a_direct_cluster_keeps_the_proxy(
        self, tmp_path: Any, chart_source: ChartSource
    ) -> None:
        _use(lambda _scheme, host, port: (host, port) == chart_source[1:])

        started = _started(tmp_path, chart_source=chart_source)

        assert started.decided == {
            "HTTPS_PROXY": _SECURE_URL,
            "HTTP_PROXY": _PLAIN_URL,
            "NO_PROXY": _DIRECT_CLUSTER_EXCEPTION,
        }
        assert "proxy-url" not in started.cluster

    def test_a_proxy_value_wave_cannot_use_fails_the_run_with_its_own_text(
        self, tmp_path: Any
    ) -> None:
        helm = fake_helm(tmp_path)
        kubeconfig = _kubeconfig(tmp_path, _session_at())
        _use(_refusing(_UNUSABLE_HOST_VALUE, "http"))

        with pytest.raises(Exception, match=exact(_UNUSABLE_HOST_VALUE)):
            _cli.run_helm(
                ["install", RELEASE, CHART],
                kubeconfig=kubeconfig,
                helm_path=helm.path,
                deadline_s=30,
                log=RecordingLog(),
                chart_source=("http", _CHART_HOST, 80),
            )

        assert not os.path.exists(helm.report)


class TestProxyLogLines:
    """REQ-3.5.3.6: the run log says once per block run, at DEBUG, which proxy helm was handed."""

    @pytest.mark.parametrize(
        "through",
        [_always, _only(_CLUSTER_HOST), _only(_CHART_HOST)],
        ids=["cluster and chart source", "cluster only", "chart source only"],
    )
    def test_a_route_through_the_proxy_names_it(
        self, tmp_path: Any, block_log: RecordingLog, through: Decision
    ) -> None:
        _use(through, _SECURE, _SECURE)

        _started(tmp_path, log=block_log, chart_source=_CHART_SOURCE)

        assert _route_lines(block_log) == _debug(_USING_SECURE)

    def test_several_helm_starts_in_one_block_run_name_it_once(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        _use(_always, _SECURE, _SECURE)

        _started(tmp_path, log=block_log, runs=2, chart_source=_CHART_SOURCE)

        assert _route_lines(block_log) == _debug(_USING_SECURE)

    def test_the_line_shows_the_address_and_port_and_never_the_login(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        login: Endpoint = ("secure-proxy.example", 3128, "wave", "s3cret")
        _use(_always, login, login)

        _started(tmp_path, log=block_log, chart_source=_CHART_SOURCE)

        assert _route_lines(block_log) == _debug(_USING_SECURE)
        assert not [message for message in block_log.messages if "s3cret" in message]

    def test_an_ipv6_proxy_address_is_written_in_brackets(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        endpoint: Endpoint = ("2001:db8::5", 3128, None, None)
        _use(_always, endpoint, endpoint)

        _started(tmp_path, log=block_log, chart_source=_CHART_SOURCE)

        assert _route_lines(block_log) == _debug("Using the proxy [2001:db8::5]:3128")

    def test_direct_connections_write_no_line(self, tmp_path: Any, block_log: RecordingLog) -> None:
        _use(_never)

        _started(tmp_path, log=block_log, chart_source=_CHART_SOURCE)

        assert _route_lines(block_log) == []

    def test_without_a_proxy_in_force_no_line_is_written(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        _started(tmp_path, log=block_log, chart_source=_CHART_SOURCE)

        assert _route_lines(block_log) == []

    @pytest.mark.parametrize(
        ("host", "written"),
        [
            ("localhost", "localhost"),
            ("127.0.0.1", "127.0.0.1"),
            ("127.8.9.10", "127.8.9.10"),
            ("::1", "[::1]"),
        ],
    )
    def test_a_local_chart_source_the_decision_sent_to_the_proxy_is_reported(
        self, tmp_path: Any, block_log: RecordingLog, host: str, written: str
    ) -> None:
        _use(_only(host))

        _started(tmp_path, log=block_log, chart_source=("https", host, 8443))

        assert _route_lines(block_log) == _debug(
            f"Helm does not use the proxy for {written}: it is a local address"
        )

    def test_a_local_chart_source_beside_a_proxied_cluster_writes_both_lines(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        _use(_always, _SECURE, _SECURE)

        _started(tmp_path, log=block_log, chart_source=("https", "localhost", 8443))

        assert sorted(_route_lines(block_log)) == sorted(
            _debug(
                _USING_SECURE, "Helm does not use the proxy for localhost: it is a local address"
            )
        )

    def test_several_helm_starts_in_one_block_run_report_it_once(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        _use(_only("localhost"))

        _started(tmp_path, log=block_log, runs=2, chart_source=("https", "localhost", 8443))

        assert _route_lines(block_log) == _debug(
            "Helm does not use the proxy for localhost: it is a local address"
        )

    def test_a_local_chart_source_the_decision_sent_direct_is_not_reported(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        _use(_only(_CLUSTER_HOST), _SECURE, _SECURE)

        _started(tmp_path, log=block_log, chart_source=("https", "localhost", 8443))

        assert _route_lines(block_log) == _debug(_USING_SECURE)

    def test_a_local_chart_source_without_a_proxy_in_force_is_not_reported(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        _started(tmp_path, log=block_log, chart_source=("https", "localhost", 8443))

        assert _route_lines(block_log) == []

    @pytest.mark.parametrize(
        ("server", "through", "chart_source", "written"),
        [
            (SERVER, _only(_UNDER_CLUSTER_HOST), _UNDER_CLUSTER, _UNDER_CLUSTER_HOST),
            (SERVER, _http_targets, _ON_CLUSTER_HOST, _CLUSTER_HOST),
            ("https://10.0.0.7:6443", _http_targets, ("http", "10.0.0.7", 6443), "10.0.0.7"),
            (
                "https://[2001:db8::10]:6443",
                _http_targets,
                ("http", "2001:db8::10", 6443),
                "[2001:db8::10]",
            ),
        ],
        ids=[
            "a name under the cluster's",
            "the cluster's own name",
            "the cluster's own ipv4 address",
            "the cluster's own ipv6 address",
        ],
    )
    def test_a_chart_source_under_a_direct_clusters_address_is_reported(
        self,
        tmp_path: Any,
        block_log: RecordingLog,
        server: str,
        through: Decision,
        chart_source: ChartSource,
        written: str,
    ) -> None:
        _use(through)

        _started(tmp_path, _session_at(server), log=block_log, chart_source=chart_source)

        assert _route_lines(block_log) == _debug(_UNDER_CLUSTER_LINE.format(host=written))

    def test_several_helm_starts_in_one_block_run_report_the_clusters_address_once(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        _use(_only(_UNDER_CLUSTER_HOST))

        _started(tmp_path, log=block_log, runs=2, chart_source=_UNDER_CLUSTER)

        assert _route_lines(block_log) == _debug(
            _UNDER_CLUSTER_LINE.format(host=_UNDER_CLUSTER_HOST)
        )

    @pytest.mark.parametrize(
        ("through", "chart_source"),
        [
            (_always, _UNDER_CLUSTER),
            (_only(_UNDER_CLUSTER_HOST), ("https", _UNDER_CLUSTER_HOST, 443)),
            (_only("xk8s.example"), ("https", "xk8s.example", 6443)),
        ],
        ids=[
            "the cluster goes through the proxy",
            "another port than the cluster's",
            "a name that only looks like the cluster's",
        ],
    )
    def test_a_chart_source_helm_sends_through_the_proxy_is_not_reported(
        self, tmp_path: Any, block_log: RecordingLog, through: Decision, chart_source: ChartSource
    ) -> None:
        _use(through, _SECURE, _SECURE)

        _started(tmp_path, log=block_log, chart_source=chart_source)

        assert _route_lines(block_log) == _debug(_USING_SECURE)

    def test_a_chart_source_under_the_clusters_address_the_decision_sent_direct_is_not_reported(
        self, tmp_path: Any, block_log: RecordingLog
    ) -> None:
        _use(_never)

        _started(tmp_path, log=block_log, chart_source=_UNDER_CLUSTER)

        assert _route_lines(block_log) == []


class TestRemoteHostProxy:
    """REQ-3.5.3.6: on a remote host helm keeps that host's own proxy variables as they are."""

    @pytest.fixture(autouse=True)
    def on_a_remote_host(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(_cli, "REMOTE_HOST", "prod-host")

    def test_the_hosts_proxy_variables_are_kept_in_both_spellings(
        self, tmp_path: Any, host_values: dict[str, str]
    ) -> None:
        started = _started(tmp_path)

        assert started.decided == _HOST_PROXY_VALUES

    def test_nothing_else_of_the_host_reaches_helm(
        self, tmp_path: Any, host_values: dict[str, str]
    ) -> None:
        started = _started(tmp_path)

        assert sorted(started.env) == sorted([*CLEAN_ENV_KEYS, *_HOST_PROXY_VALUES])

    def test_a_variable_the_host_does_not_set_is_not_added(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for name in _HOST_PROXY_VALUES:
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv("https_proxy", "http://lower-secure.example:3128")

        started = _started(tmp_path)

        assert started.decided == {"https_proxy": "http://lower-secure.example:3128"}

    def test_wave_decides_no_route(self, tmp_path: Any, host_values: dict[str, str]) -> None:
        proxy = importlib.import_module("wavecore.connectivity.proxy")
        asked: list[str] = []

        def resolver() -> Any:
            asked.append("asked")
            return proxy.ProxySpec(proxy.ProxyEndpoint(*_SECURE), None, _always)

        proxy.set_resolver(resolver)

        started = _started(tmp_path, chart_source=_CHART_SOURCE)

        assert started.decided == _HOST_PROXY_VALUES
        assert "proxy-url" not in started.cluster
        assert asked == []

    @pytest.mark.parametrize("chart_host", [_CHART_HOST, "localhost"])
    def test_no_proxy_line_is_written(
        self, tmp_path: Any, block_log: RecordingLog, host_values: dict[str, str], chart_host: str
    ) -> None:
        _use(_always, _SECURE, _SECURE)

        _started(tmp_path, log=block_log, chart_source=("https", chart_host, 8443))

        assert _route_lines(block_log) == []

    def test_a_chart_source_under_the_clusters_address_is_left_to_the_host(
        self, tmp_path: Any, block_log: RecordingLog, host_values: dict[str, str]
    ) -> None:
        _use(_only(_UNDER_CLUSTER_HOST))

        started = _started(tmp_path, log=block_log, chart_source=_UNDER_CLUSTER)

        assert started.decided == _HOST_PROXY_VALUES
        assert _route_lines(block_log) == []

    def test_home_and_the_temp_folder_are_the_call_directory(self, tmp_path: Any) -> None:
        started = _started(tmp_path)

        assert started.env.get("HOME") == started.workspace
        assert started.env.get("TMPDIR") == started.workspace


class TestRunHelmDeadline:
    """The process gets exactly the deadline the caller set, then it is killed."""

    @staticmethod
    def _timed_out(
        tmp_path: Any, deadline_s: int, expired: subprocess.TimeoutExpired | None = None
    ) -> tuple[Any, Any]:
        expired = expired or subprocess.TimeoutExpired(cmd=["helm"], timeout=float(deadline_s))
        process = MagicMock()
        process.__enter__.return_value = process
        process.communicate.side_effect = expired
        with (
            patch("wavecore.plugins._process_group.launch", return_value=process),
            patch("wavecore.plugins._process_group.kill_group"),
        ):
            result = _cli.run_helm(
                ["install", RELEASE],
                kubeconfig=_kubeconfig(tmp_path),
                helm_path="/usr/local/bin/helm",
                deadline_s=deadline_s,
                log=RecordingLog(),
            )
        return result, process.communicate

    def test_no_margin_is_added_to_the_caller_s_deadline(self) -> None:
        assert not hasattr(_cli, "DEADLINE_MARGIN")

    def test_the_process_gets_exactly_the_deadline(self, tmp_path: Any) -> None:
        _result, run = self._timed_out(tmp_path, 300)

        assert run.call_args.kwargs["timeout"] == 300

    def test_a_one_second_deadline_kills_at_one_second(self, tmp_path: Any) -> None:
        _result, run = self._timed_out(tmp_path, 1)

        assert run.call_args.kwargs["timeout"] == 1

    def test_an_expired_run_is_marked_timed_out(self, tmp_path: Any) -> None:
        result, _run = self._timed_out(tmp_path, 300)

        assert result.timed_out is True

    def test_an_expired_run_reports_the_conventional_timeout_code(self, tmp_path: Any) -> None:
        result, _run = self._timed_out(tmp_path, 300)

        assert result.exit_code == 124

    def test_an_expired_run_carries_the_partial_streams(self, tmp_path: Any) -> None:
        expired = subprocess.TimeoutExpired(
            cmd=["helm"], timeout=300.0, output="partial out", stderr="partial err"
        )
        result, _communicate = self._timed_out(tmp_path, 300, expired)

        assert (result.stdout, result.stderr) == ("partial out", "partial err")

    def test_binary_partial_streams_are_decoded(self, tmp_path: Any) -> None:
        expired = subprocess.TimeoutExpired(
            cmd=["helm"], timeout=300.0, output=b"partial out", stderr=b"\xff"
        )
        result, _communicate = self._timed_out(tmp_path, 300, expired)

        assert (result.stdout, result.stderr) == ("partial out", "�")

    def test_an_expired_run_with_no_partial_output_reports_empty_streams(
        self, tmp_path: Any
    ) -> None:
        result, _run = self._timed_out(tmp_path, 300)

        assert (result.stdout, result.stderr) == ("", "")


class TestMissingExecutable:
    """A host without helm says what was tried, where, and what to do."""

    @staticmethod
    def _run(tmp_path: Any, helm_path: str) -> None:
        _cli.run_helm(
            ["status", RELEASE],
            kubeconfig=_kubeconfig(tmp_path),
            helm_path=helm_path,
            deadline_s=30,
            log=RecordingLog(),
        )

    def test_a_missing_helm_path_names_the_path_it_tried(self, tmp_path: Any) -> None:
        # The path is built under tmp_path so no machine can happen to have a helm there.
        absent = tmp_path / "opt" / "helm" / "bin" / "helm"
        message = f"helm not found: {absent}. Set Helm Path or install helm"

        with pytest.raises(ValueError, match=exact(message)):
            self._run(tmp_path, str(absent))

    def test_an_empty_helm_path_names_the_path_lookup(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PATH", str(tmp_path / "empty-bin"))
        message = "helm not found: helm on PATH. Set Helm Path or install helm"

        with pytest.raises(ValueError, match=exact(message)):
            self._run(tmp_path, "")

    def test_a_helm_path_that_is_not_executable_reports_the_same_row(self, tmp_path: Any) -> None:
        plain = tmp_path / "not-executable"
        plain.write_text("#!/bin/sh\n", encoding="utf-8")
        message = f"helm not found: {plain}. Set Helm Path or install helm"

        with pytest.raises(ValueError, match=exact(message)):
            self._run(tmp_path, str(plain))

    def test_a_helm_path_under_a_file_reports_the_same_row(self, tmp_path: Any) -> None:
        plain = tmp_path / "file"
        plain.write_text("x", encoding="utf-8")
        target = plain / "helm"
        message = f"helm not found: {target}. Set Helm Path or install helm"

        with pytest.raises(ValueError, match=exact(message)):
            self._run(tmp_path, str(target))

    def test_the_remote_wording_names_the_execution_host(self, tmp_path: Any) -> None:
        absent = tmp_path / "usr" / "local" / "bin" / "helm"
        message = f"helm not found: {absent} on prod-host. Set Helm Path or install helm"

        with patch.object(_cli, "REMOTE_HOST", "prod-host"):
            with pytest.raises(ValueError, match=exact(message)):
                self._run(tmp_path, str(absent))

    def test_the_remote_wording_with_an_empty_helm_path(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PATH", str(tmp_path / "empty-bin"))
        message = "helm not found: helm on PATH on prod-host. Set Helm Path or install helm"

        with patch.object(_cli, "REMOTE_HOST", "prod-host"):
            with pytest.raises(ValueError, match=exact(message)):
                self._run(tmp_path, "")

    def test_wave_itself_runs_without_a_remote_host(self) -> None:
        assert _cli.REMOTE_HOST is None

    def test_the_message_helper_answers_on_its_own(self) -> None:
        assert _cli.missing_helm_message("  /opt/helm  ") == (
            "helm not found: /opt/helm. Set Helm Path or install helm"
        )


class TestRedacted:
    """Nothing that carries a chart-repository password reaches the console."""

    def test_the_password_value_is_replaced(self) -> None:
        assert _cli.redacted(["install", "--password", "chart-secret"]) == [
            "install",
            "--password",
            "***",
        ]

    def test_every_other_element_is_untouched(self) -> None:
        argv = ["install", "web", "--username", "wave", "--set", "a=1"]

        assert _cli.redacted(argv) == argv

    def test_a_trailing_password_flag_is_left_alone(self) -> None:
        assert _cli.redacted(["install", "--password"]) == ["install", "--password"]

    def test_the_original_argv_is_not_modified(self) -> None:
        argv = ["install", "--password", "chart-secret"]

        _cli.redacted(argv)

        assert argv == ["install", "--password", "chart-secret"]


class TestClassifyReason:
    """Helm's own wording becomes one of seven values a workflow branches on."""

    @pytest.mark.parametrize(
        ("stderr", "reason"),
        [
            (STDERR_NOT_FOUND, "NotFound"),
            (STDERR_STILL_IN_USE, "AlreadyExists"),
            (STDERR_ALREADY_EXISTS, "AlreadyExists"),
            (STDERR_FORBIDDEN, "Forbidden"),
            (STDERR_UNAUTHORIZED, "Forbidden"),
            (STDERR_TIMED_OUT, "Timeout"),
            (STDERR_DEADLINE_EXCEEDED, "Timeout"),
            (STDERR_BUILD_OBJECTS, "Invalid"),
            (STDERR_SCHEMA_VALIDATION, "Invalid"),
            (STDERR_EXECUTION_ERROR, "Invalid"),
            (STDERR_UNKNOWN_FLAG, "Invalid"),
            (STDERR_CLUSTER_UNREACHABLE, "Unreachable"),
            (STDERR_NO_SUCH_HOST, "Unreachable"),
            (STDERR_REPO_UNREACHABLE, "Unreachable"),
            (STDERR_HOOK_FAILED, "Failed"),
        ],
    )
    def test_helms_own_wording_maps_to_its_reason(self, stderr: str, reason: str) -> None:
        assert _cli.classify_reason(stderr, timed_out=False) == reason

    def test_a_line_no_row_matches_is_a_plain_failure(self) -> None:
        assert _cli.classify_reason(STDERR_UNCLASSIFIED, timed_out=False) == "Failed"

    def test_an_empty_stderr_is_a_plain_failure(self) -> None:
        assert _cli.classify_reason("", timed_out=False) == "Failed"

    def test_the_match_ignores_case(self) -> None:
        assert _cli.classify_reason("Error: RELEASE: NOT FOUND", timed_out=False) == "NotFound"

    def test_the_process_deadline_forces_timeout(self) -> None:
        """A killed process reports Timeout whatever it managed to print first."""
        assert _cli.classify_reason(STDERR_NOT_FOUND, timed_out=True) == "Timeout"

    def test_a_repository_that_cannot_be_reached_is_unreachable_not_failed(self) -> None:
        """helm prefixes write errors with INSTALL/UPGRADE FAILED, so the generic
        token is read last."""
        assert _cli.classify_reason(STDERR_REPO_UNREACHABLE, timed_out=False) == "Unreachable"

    def test_a_rejected_manifest_under_an_upgrade_is_invalid_not_failed(self) -> None:
        assert _cli.classify_reason(STDERR_BUILD_OBJECTS, timed_out=False) == "Invalid"

    @pytest.mark.parametrize(
        "stderr",
        [STDERR_OCI_NO_LOGIN_INSTALL, STDERR_OCI_NO_LOGIN_UPGRADE],
        ids=["install", "upgrade"],
    )
    def test_an_oci_registry_that_got_no_login_is_forbidden_not_not_found(
        self, stderr: str
    ) -> None:
        assert _cli.classify_reason(stderr, timed_out=False) == "Forbidden"

    def test_an_oci_registry_that_refused_the_login_is_forbidden(self) -> None:
        assert _cli.classify_reason(STDERR_OCI_WRONG_PASSWORD, timed_out=False) == "Forbidden"

    def test_a_chart_the_oci_registry_does_not_hold_is_not_found(self) -> None:
        assert _cli.classify_reason(STDERR_OCI_MISSING_CHART, timed_out=False) == "NotFound"


class TestFloorMessage:
    """WAVE reads helm's version only after helm rejected a flag as unknown."""

    @staticmethod
    def _probe(tmp_path: Any, printed: str, exit_code: int = 0) -> tuple[Any, Any]:
        helm = fake_helm(tmp_path, stdout=printed, exit_code=exit_code)
        message = _cli.floor_message(helm.path, _kubeconfig(tmp_path), RecordingLog())
        return message, helm

    def test_the_probe_asks_helm_for_its_version_once(self, tmp_path: Any) -> None:
        _message, helm = self._probe(tmp_path, "v3.9.4")

        assert helm.report_json()["argv"][:3] == ["version", "--template", "{{.Version}}"]

    def test_a_helm_below_the_floor_is_named_with_its_path(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path, stdout="v3.9.4\n")

        message = _cli.floor_message(helm.path, _kubeconfig(tmp_path), RecordingLog())

        assert message == f"Helm v3.9.4 found at {helm.path}, WAVE needs 3.13 or newer"

    def test_the_floor_release_passes(self, tmp_path: Any) -> None:
        message, _helm = self._probe(tmp_path, "v3.13.0")

        assert message is None

    def test_a_newer_three_passes(self, tmp_path: Any) -> None:
        message, _helm = self._probe(tmp_path, "v3.21.4")

        assert message is None

    def test_helm_four_passes(self, tmp_path: Any) -> None:
        message, _helm = self._probe(tmp_path, "v4.2.4")

        assert message is None

    def test_a_two_is_below_the_floor(self, tmp_path: Any) -> None:
        message, _helm = self._probe(tmp_path, "v2.17.0")

        assert message is not None

    def test_a_version_without_the_v_prefix_still_reads(self, tmp_path: Any) -> None:
        message, _helm = self._probe(tmp_path, "3.9.4")

        assert message is not None

    def test_an_unreadable_version_lets_helms_own_error_through(self, tmp_path: Any) -> None:
        message, _helm = self._probe(tmp_path, "not a version")

        assert message is None

    def test_a_failed_probe_lets_helms_own_error_through(self, tmp_path: Any) -> None:
        message, _helm = self._probe(tmp_path, "", exit_code=1)

        assert message is None

    def test_a_probe_that_times_out_lets_helms_own_error_through(self, tmp_path: Any) -> None:
        process = MagicMock()
        process.__enter__.return_value = process
        process.communicate.side_effect = subprocess.TimeoutExpired(cmd=["helm"], timeout=60.0)
        with (
            patch("wavecore.plugins._process_group.launch", return_value=process),
            patch("wavecore.plugins._process_group.kill_group"),
        ):
            message = _cli.floor_message(
                "/usr/local/bin/helm", _kubeconfig(tmp_path), RecordingLog()
            )

        assert message is None

    def test_the_path_is_the_helm_path_that_was_set(self, tmp_path: Any) -> None:
        helm = fake_helm(tmp_path, stdout="v3.9.4")

        message = _cli.floor_message(f" {helm.path} ", _kubeconfig(tmp_path), RecordingLog())

        assert message == f"Helm v3.9.4 found at {helm.path}, WAVE needs 3.13 or newer"

    def test_a_relative_helm_path_is_named_from_the_home_folder(
        self, tmp_path: Any, server_home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        helm = fake_helm(server_home, stdout="v3.9.4")
        monkeypatch.setenv("HOME", str(server_home))
        relative = os.path.relpath(helm.path, server_home)

        message = _cli.floor_message(relative, _kubeconfig(tmp_path), RecordingLog())

        assert message == f"Helm v3.9.4 found at {helm.path}, WAVE needs 3.13 or newer"

    def test_an_empty_helm_path_reports_the_resolved_executable(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        helm = fake_helm(tmp_path, stdout="v3.9.4")
        monkeypatch.setenv("PATH", os.path.dirname(helm.path))

        message = _cli.floor_message("", _kubeconfig(tmp_path), RecordingLog())

        assert message == f"Helm v3.9.4 found at {helm.path}, WAVE needs 3.13 or newer"

    def test_the_floor_is_three_thirteen(self) -> None:
        assert _cli.FLOOR == (3, 13)


class TestHelmMessage:
    """A refusal carries helm's own words, not WAVE's."""

    @staticmethod
    def _result(stderr: str, exit_code: int = 1, stdout: str = "") -> Any:
        return _cli.HelmResult(stdout=stdout, stderr=stderr, exit_code=exit_code)

    def test_the_error_prefix_is_dropped(self) -> None:
        assert _cli.helm_message(self._result(STDERR_NOT_FOUND), "uninstall") == (
            "uninstall: Release not loaded: web: release: not found"
        )

    def test_leading_warnings_are_dropped(self) -> None:
        assert _cli.helm_message(self._result(STDERR_WITH_WARNING), "uninstall") == (
            "uninstall: Release not loaded: web: release: not found"
        )

    def test_a_multi_line_detail_is_kept_whole(self) -> None:
        message = _cli.helm_message(self._result(STDERR_SCHEMA_VALIDATION), "install")

        assert message.startswith("INSTALL FAILED: values don't meet")
        assert "- (root): validation of replicaCount" in message

    def test_stderr_without_the_marker_is_carried_as_it_stands(self) -> None:
        assert _cli.helm_message(self._result("  release lost\n"), "status") == "release lost"

    def test_an_empty_stderr_falls_back_to_the_exit_code(self) -> None:
        assert _cli.helm_message(self._result("", exit_code=7), "install") == (
            "helm install exited with code 7"
        )

    def test_the_deadline_message_names_the_verb_and_the_deadline(self) -> None:
        assert _cli.deadline_message("install", 330) == ("helm install did not finish within 330 s")

    def test_the_deadline_message_is_anchored(self) -> None:
        assert re.fullmatch(
            r"helm status did not finish within 60 s", _cli.deadline_message("status", 60)
        )


class TestParseRelease:
    """helm's -o json output is a document or it is nothing."""

    def test_a_release_document_parses(self) -> None:
        assert _cli.parse_release(json.dumps(release_document())) == release_document()

    def test_surrounding_whitespace_is_tolerated(self) -> None:
        assert _cli.parse_release("\n" + json.dumps(release_document()) + "\n") is not None

    def test_text_that_is_not_json_is_nothing(self) -> None:
        assert _cli.parse_release("NAME: web\nSTATUS: deployed\n") is None

    def test_an_empty_stdout_is_nothing(self) -> None:
        assert _cli.parse_release("") is None

    def test_a_json_array_is_nothing(self) -> None:
        assert _cli.parse_release("[]") is None

    def test_the_lines_helm_prints_for_an_oci_pull_are_skipped(self) -> None:
        assert OCI_INSTALL_STDOUT.startswith(OCI_PULL_LINES + "{")

        assert _cli.parse_release(OCI_INSTALL_STDOUT) == OCI_RELEASE_DOCUMENT

    def test_the_oci_pull_lines_without_a_document_are_nothing(self) -> None:
        assert _cli.parse_release(OCI_PULL_LINES) is None


class TestParseHistory:
    """helm's release history is a list of revisions or it is nothing."""

    def test_a_history_parses_into_its_revisions(self) -> None:
        text = history_json(history_entry(revision=1), history_entry(revision=2))

        assert _cli.parse_history(text) == [history_entry(revision=1), history_entry(revision=2)]

    def test_surrounding_whitespace_is_tolerated(self) -> None:
        assert _cli.parse_history("\n" + history_json() + "\n") == [history_entry()]

    def test_text_that_is_not_json_is_empty(self) -> None:
        assert _cli.parse_history("REVISION\tUPDATED\tSTATUS\n1\tFri\tdeployed\n") == []

    def test_an_empty_stdout_is_empty(self) -> None:
        assert _cli.parse_history("") == []

    def test_a_json_object_is_empty(self) -> None:
        assert _cli.parse_history(json.dumps(release_document())) == []

    def test_a_revision_that_is_not_an_object_is_dropped(self) -> None:
        text = json.dumps([1, history_entry()])

        assert _cli.parse_history(text) == [history_entry()]


class TestHistoryChart:
    """One revision's chart and app version, read out of the history helm printed."""

    def test_the_matching_revision_gives_its_chart_and_app_version(self) -> None:
        entries = [history_entry()]

        assert _cli.history_chart(entries, 1) == (CHART_RELEASE, APP_VERSION)

    def test_an_older_revision_reports_its_own_chart(self) -> None:
        entries = [
            history_entry(revision=1, chart="wave-demo-0.1.0", app_version="1.0"),
            history_entry(revision=2, chart="wave-demo-0.2.0", app_version="2.0"),
        ]

        assert _cli.history_chart(entries, 1) == ("wave-demo-0.1.0", "1.0")

    def test_the_newest_revision_reports_its_own_chart(self) -> None:
        entries = [
            history_entry(revision=1, chart="wave-demo-0.1.0", app_version="1.0"),
            history_entry(revision=2, chart="wave-demo-0.2.0", app_version="2.0"),
        ]

        assert _cli.history_chart(entries, 2) == ("wave-demo-0.2.0", "2.0")

    def test_a_revision_no_entry_carries_is_empty(self) -> None:
        assert _cli.history_chart([history_entry(revision=1)], 7) == ("", "")

    def test_an_empty_history_is_empty(self) -> None:
        assert _cli.history_chart([], 1) == ("", "")

    def test_a_revision_without_a_chart_reads_empty(self) -> None:
        assert _cli.history_chart([{"revision": 1}], 1) == ("", "")

    def test_a_chart_without_an_app_version_keeps_the_chart(self) -> None:
        entries = [{"revision": 1, "chart": CHART_RELEASE}]

        assert _cli.history_chart(entries, 1) == (CHART_RELEASE, "")


class TestChartName:
    """Whether the document helm printed carries a chart of its own."""

    def test_a_write_document_carries_its_chart(self) -> None:
        assert _cli.chart_name(release_document()) == CHART

    def test_a_read_document_carries_none(self) -> None:
        assert _cli.chart_name(status_document()) == ""

    def test_a_chart_without_metadata_carries_none(self) -> None:
        assert _cli.chart_name({"chart": {}}) == ""


class TestReleaseTable:
    """The Table form is helm's own list columns, one row."""

    def test_the_columns_are_helms_list_columns(self) -> None:
        envelope = _cli.release_table(release_document())

        assert [column["name"] for column in envelope["columns"]] == [
            "Name",
            "Namespace",
            "Revision",
            "Updated",
            "Status",
            "Chart",
            "App Version",
        ]

    def test_the_revision_column_is_a_number(self) -> None:
        envelope = _cli.release_table(release_document())

        assert envelope["columns"][2] == {"name": "Revision", "type": "integer"}

    def test_the_row_reads_the_release(self) -> None:
        assert _cli.release_table(release_document())["rows"] == [release_row()]

    def test_the_chart_column_joins_the_name_and_the_version(self) -> None:
        envelope = _cli.release_table(release_document(chart_version="0.2.0"))

        assert envelope["rows"][0][5] == "wave-demo-0.2.0"

    def test_a_missing_chart_reads_empty(self) -> None:
        document = release_document()
        document["chart"] = {}

        assert _cli.release_table(document)["rows"][0][5] == ""

    def test_a_missing_app_version_reads_empty(self) -> None:
        document = release_document()
        document["chart"]["metadata"].pop("appVersion")

        assert _cli.release_table(document)["rows"][0][6] == ""

    def test_a_document_without_info_reads_empty(self) -> None:
        document = release_document()
        document.pop("info")

        assert _cli.release_table(document)["rows"][0][3:5] == ["", ""]

    def test_a_document_without_a_revision_reads_zero(self) -> None:
        document = release_document()
        document.pop("version")

        assert _cli.release_table(document)["rows"][0][2] == 0

    def test_no_release_is_the_empty_table_with_its_columns(self) -> None:
        assert _cli.release_table(None) == release_table_envelope()

    def test_a_chartless_document_takes_the_pair_it_is_handed(self) -> None:
        row = _cli.release_table(status_document(), "wave-demo-0.2.0", "2.0")["rows"][0]

        assert row[5:] == ["wave-demo-0.2.0", "2.0"]

    def test_a_chartless_document_handed_nothing_reads_empty(self) -> None:
        row = _cli.release_table(status_document())["rows"][0]

        assert row[5:] == ["", ""]

    def test_the_documents_own_chart_wins_over_the_pair(self) -> None:
        row = _cli.release_table(release_document(), "other-9.9.9", "9.9")["rows"][0]

        assert row[5:] == [CHART_RELEASE, APP_VERSION]

    def test_the_rest_of_a_chartless_row_still_reads_the_release(self) -> None:
        row = _cli.release_table(status_document())["rows"][0]

        assert row[:5] == release_row()[:5]

    def test_no_release_ignores_the_pair(self) -> None:
        assert _cli.release_table(None, "wave-demo-0.2.0", "2.0") == release_table_envelope()


class TestTestTable:
    """The Test form is one row per test hook, read from the release record."""

    def test_the_columns_are_the_hook_columns(self) -> None:
        envelope = _cli.test_table(release_document(hooks=[test_hook()]))

        assert [column["name"] for column in envelope["columns"]] == [
            "Name",
            "Kind",
            "Phase",
            "Started",
            "Completed",
        ]

    def test_a_hook_becomes_its_row(self) -> None:
        envelope = _cli.test_table(release_document(hooks=[test_hook()]))

        assert envelope["rows"] == [
            [
                "web-wave-demo-test",
                "Pod",
                "Succeeded",
                "2026-09-04T10:05:00Z",
                "2026-09-04T10:05:09Z",
            ]
        ]

    def test_hooks_keep_the_order_the_document_gives(self) -> None:
        hooks = [test_hook(name="first"), test_hook(name="second")]

        envelope = _cli.test_table(release_document(hooks=hooks))

        assert [row[0] for row in envelope["rows"]] == ["first", "second"]

    def test_a_failed_hook_reports_its_phase(self) -> None:
        envelope = _cli.test_table(release_document(hooks=[test_hook(phase="Failed")]))

        assert envelope["rows"][0][2] == "Failed"

    def test_a_lifecycle_hook_is_not_a_test_hook(self) -> None:
        hooks = [test_hook(name="pre-install", events=("pre-install",)), test_hook()]

        envelope = _cli.test_table(release_document(hooks=hooks))

        assert [row[0] for row in envelope["rows"]] == ["web-wave-demo-test"]

    def test_the_deprecated_test_success_event_still_counts(self) -> None:
        hooks = [test_hook(events=("test-success",))]

        assert len(_cli.test_table(release_document(hooks=hooks))["rows"]) == 1

    def test_a_hook_that_never_ran_reads_empty(self) -> None:
        hook = test_hook()
        hook.pop("last_run")

        envelope = _cli.test_table(release_document(hooks=[hook]))

        assert envelope["rows"][0][2:] == ["", "", ""]

    def test_a_chart_without_tests_is_the_empty_table(self) -> None:
        assert _cli.test_table(release_document()) == test_table_envelope()

    def test_a_document_without_a_hooks_key_is_the_empty_table(self) -> None:
        document = release_document()
        document.pop("hooks")

        assert _cli.test_table(document) == test_table_envelope()

    def test_no_release_is_the_empty_table_with_its_columns(self) -> None:
        assert _cli.test_table(None) == test_table_envelope()


class TestShapeResult:
    """Output Format decides the shape; the document is the same either way."""

    def test_table_is_the_release_row(self) -> None:
        shaped = _cli.shape_result(release_document(), "table")

        assert shaped == release_table_envelope([release_row()])

    def test_map_is_the_document(self) -> None:
        assert _cli.shape_result(release_document(), "map") == release_document()

    def test_json_is_the_document_as_text(self) -> None:
        shaped = _cli.shape_result(release_document(), "json")

        assert json.loads(shaped) == release_document()

    def test_yaml_is_the_document_in_a_yaml_envelope(self) -> None:
        assert _cli.shape_result(release_document(), "yaml") == {
            "__wave_type": "yaml",
            "value": release_document(),
        }

    def test_the_table_builder_can_be_the_hooks_table(self) -> None:
        document = release_document(hooks=[test_hook()])

        shaped = _cli.shape_result(document, "table", _cli.test_table)

        assert [column["name"] for column in shaped["columns"]] == [
            "Name",
            "Kind",
            "Phase",
            "Started",
            "Completed",
        ]

    def test_the_map_form_of_a_test_is_still_the_release_document(self) -> None:
        document = release_document(hooks=[test_hook()])

        assert _cli.shape_result(document, "map", _cli.test_table) == document

    def test_no_release_in_table_form_keeps_the_columns(self) -> None:
        assert _cli.shape_result(None, "table") == release_table_envelope()

    def test_no_release_in_test_table_form_keeps_the_hook_columns(self) -> None:
        assert _cli.shape_result(None, "table", _cli.test_table) == test_table_envelope()

    def test_no_release_in_map_form_is_an_empty_map(self) -> None:
        assert _cli.shape_result(None, "map") == {}

    @pytest.mark.parametrize("output_format", ["json", "yaml"])
    def test_no_release_in_text_form_is_empty_text(self, output_format: str) -> None:
        assert _cli.shape_result(None, output_format) == ""


class TestReleaseStatus:
    """The scalar Wait Until polls."""

    def test_the_status_is_the_releases_own(self) -> None:
        assert _cli.release_status(release_document()) == "deployed"

    def test_a_pending_release_reports_its_state(self) -> None:
        assert _cli.release_status(release_document(status="pending-upgrade")) == (
            "pending-upgrade"
        )

    def test_a_document_without_info_reads_empty(self) -> None:
        document = release_document()
        document.pop("info")

        assert _cli.release_status(document) == ""

    def test_no_release_reads_empty(self) -> None:
        assert _cli.release_status(None) == ""


class TestPinnedConstants:
    """The numbers the sheets and the deadline are built on."""

    def test_the_operation_timeout_default(self) -> None:
        assert _cli.DEFAULT_TIMEOUT == 300

    def test_the_status_timeout_default(self) -> None:
        assert _cli.STATUS_TIMEOUT == 30

    def test_the_release_columns_are_pinned(self) -> None:
        assert _cli.RELEASE_COLUMNS == [
            ("Name", "string"),
            ("Namespace", "string"),
            ("Revision", "integer"),
            ("Updated", "string"),
            ("Status", "string"),
            ("Chart", "string"),
            ("App Version", "string"),
        ]

    def test_the_test_columns_are_pinned(self) -> None:
        assert _cli.TEST_COLUMNS == [
            ("Name", "string"),
            ("Kind", "string"),
            ("Phase", "string"),
            ("Started", "string"),
            ("Completed", "string"),
        ]

    def test_the_last_deployed_column_reads_the_release_field(self) -> None:
        envelope = _cli.release_table(release_document(last_deployed=LAST_DEPLOYED))

        assert envelope["rows"][0][3] == LAST_DEPLOYED

    def test_the_namespace_column_reads_the_release_namespace(self) -> None:
        envelope = _cli.release_table(release_document(namespace=NAMESPACE))

        assert envelope["rows"][0][1] == NAMESPACE
