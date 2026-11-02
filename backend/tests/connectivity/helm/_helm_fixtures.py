"""Shared fixtures for every Helm test (core, six verbs, six plugins).

A fake helm executable the runner really launches, a recorder that stands in for
run_helm when a verb is under test, the release documents helm's `-o json` prints,
and one canned stderr line per Reason the classifier answers with. helm itself is
never executed for real.
"""

import base64
import json
import os
import stat
import sys
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import patch

from tests.plugins.k8s._k8s_fixtures import NAMESPACE, block_params, session_value
from wavecore.connectivity.helm._cli import HelmResult

RELEASE = "web"
CHART = "wave-demo"
CHART_VERSION = "0.1.0"
CHART_RELEASE = f"{CHART}-{CHART_VERSION}"
APP_VERSION = "1.0"
LAST_DEPLOYED = "2026-09-04T10:00:00.000000000Z"

RELEASE_COLUMNS = ["Name", "Namespace", "Revision", "Updated", "Status", "Chart", "App Version"]
RELEASE_COLUMN_TYPES = ["string", "string", "integer", "string", "string", "string", "string"]
TEST_COLUMNS = ["Name", "Kind", "Phase", "Started", "Completed"]
TEST_COLUMN_TYPES = ["string", "string", "string", "string", "string"]

HELM_ENV_KEYS = (
    "HELM_CONFIG_HOME",
    "HELM_CACHE_HOME",
    "HELM_DATA_HOME",
    "HELM_REGISTRY_CONFIG",
    "HELM_REPOSITORY_CACHE",
    "HELM_REPOSITORY_CONFIG",
    "KUBECACHEDIR",
)
# Everything helm is started with before WAVE adds the proxy route of the call.
CLEAN_ENV_KEYS = ("PATH", "HOME", "TMPDIR", *HELM_ENV_KEYS)
# The one entry each login file holds, so helm never looks for a stored login.
LOGIN_PLACEHOLDER: dict[str, Any] = {"auths": {"wave.invalid": {}}}
DOCKER_LOGIN_FILE = os.path.join(".docker", "config.json")

# One canned helm stderr per classifier row, in helm's own wording.
STDERR_NOT_FOUND = "Error: uninstall: Release not loaded: web: release: not found"
STDERR_STILL_IN_USE = "Error: INSTALL FAILED: cannot re-use a name that is still in use"
STDERR_ALREADY_EXISTS = (
    "Error: INSTALL FAILED: rendered manifests contain a resource that already exists. "
    'Unable to continue with install: Service "web" in namespace "apps" exists'
)
STDERR_FORBIDDEN = (
    'Error: INSTALL FAILED: services is forbidden: User "wave-reader" cannot create '
    'resource "services" in API group "" in the namespace "apps"'
)
STDERR_UNAUTHORIZED = "Error: failed to fetch https://charts.local/index.yaml : 401 Unauthorized"
STDERR_TIMED_OUT = "Error: UPGRADE FAILED: timed out waiting for the condition"
STDERR_DEADLINE_EXCEEDED = "Error: INSTALL FAILED: context deadline exceeded"
STDERR_BUILD_OBJECTS = (
    "Error: UPGRADE FAILED: unable to build kubernetes objects from release manifest: "
    "error unmarshaling JSON: while decoding JSON: json: cannot unmarshal string"
)
STDERR_SCHEMA_VALIDATION = (
    "Error: INSTALL FAILED: values don't meet the specifications of the schema(s) "
    "in the following chart(s):\nwave-demo:\n- (root): validation of replicaCount"
)
STDERR_EXECUTION_ERROR = (
    "Error: INSTALL FAILED: template: wave-demo/templates/service.yaml:3:12: "
    'executing "wave-demo/templates/service.yaml" at <.Values.missing>: '
    "execution error at (wave-demo/templates/service.yaml:3:12): nil pointer"
)
STDERR_UNKNOWN_FLAG = "Error: unknown flag: --ignore-not-found"
STDERR_CLUSTER_UNREACHABLE = (
    'Error: INSTALL FAILED: Kubernetes cluster unreachable: Get "https://k8s.local/version": '
    "dial tcp 10.0.0.1:6443: connect: connection refused"
)
STDERR_NO_SUCH_HOST = (
    'Error: Get "https://charts.local/index.yaml": dial tcp: lookup charts.local: no such host'
)
STDERR_REPO_UNREACHABLE = (
    'Error: looks like "https://charts.local" is not a valid chart repository or cannot be '
    'reached: Get "https://charts.local/index.yaml": tls: failed to verify certificate: '
    "x509: certificate signed by unknown authority"
)
STDERR_HOOK_FAILED = "Error: INSTALL FAILED: pod web-wave-demo-test failed"
STDERR_TEST_FAILED = "Error: pod web-wave-demo-test failed"
STDERR_UNCLASSIFIED = "Error: the classifier has no row for this line"

# helm 4.2.4 against an OCI registry that asks for a login, as captured.
_OCI_MANIFEST = 'GET "https://127.0.0.1:9482/v2/charts/wave-demo/manifests/0.1.0"'
STDERR_OCI_NO_LOGIN_INSTALL = (
    'Error: INSTALLATION FAILED: failed to perform "FetchReference" on source: '
    f"{_OCI_MANIFEST}: basic credential not found\n"
)
STDERR_OCI_NO_LOGIN_UPGRADE = (
    'Error: failed to perform "FetchReference" on source: '
    f"{_OCI_MANIFEST}: basic credential not found\n"
)
STDERR_OCI_WRONG_PASSWORD = (
    'Error: INSTALLATION FAILED: failed to perform "FetchReference" on source: '
    f"{_OCI_MANIFEST}: response status code 401: unauthorized: authentication required: "
    "[map[Action:pull Class: Name:charts/wave-demo Type:repository]]\n"
)
STDERR_OCI_MISSING_CHART = (
    'Error: INSTALLATION FAILED: failed to perform "FetchReference" on source: '
    "127.0.0.1:9482/charts/wave-missing:0.1.0: not found\n"
)

# helm 4 prints these two lines on stdout ahead of the document of an oci:// chart.
OCI_PULL_LINES = (
    "Pulled: 127.0.0.1:9482/charts/wave-demo:0.1.0\n"
    "Digest: sha256:290d4db11864d47ee73dc7a49c301922bb9fabc94e67b355105c8b7e0f663d75\n"
)
OCI_RELEASE_DOCUMENT: dict[str, Any] = {
    "name": "oci-054917",
    "info": {
        "first_deployed": "2026-10-06T05:53:24.435811403Z",
        "last_deployed": "2026-10-06T05:53:24.435811403Z",
        "description": "Install complete",
        "status": "deployed",
    },
    "chart": {
        "metadata": {
            "name": "wave-demo",
            "version": "0.1.0",
            "description": (
                "WAVE E2E fixture chart (test-only) - Deployment, Service and a passing test hook."
            ),
            "apiVersion": "v2",
            "appVersion": "1.0.0",
            "type": "application",
        },
        "lock": None,
    },
    "manifest": "---\n# Source: wave-demo/templates/service.yaml\napiVersion: v1\nkind: Service\n",
    "hooks": [],
    "version": 1,
    "namespace": "wave-proof",
    "apply_method": "ssa",
}
OCI_INSTALL_STDOUT = OCI_PULL_LINES + json.dumps(OCI_RELEASE_DOCUMENT, separators=(",", ":")) + "\n"

# WARNING lines helm prints ahead of the error it exits on.
STDERR_WITH_WARNING = (
    "WARNING: Kubernetes configuration file is group-readable\n"
    "WARNING: This chart is deprecated\n" + STDERR_NOT_FOUND
)

POD_LOGS_BLOCK = (
    "POD LOGS: web-wave-demo-test\n" "kwok-log-line-1\n" "kwok-log-line-2\n" "kwok-log-line-3\n"
)
TEST_STDOUT = (
    "NAME: web\n"
    "LAST DEPLOYED: Fri Sep  4 10:00:00 2026\n"
    "NAMESPACE: apps\n"
    "STATUS: deployed\n"
    "TEST SUITE:     web-wave-demo-test\n"
    "Phase:          Succeeded\n"
    "\n" + POD_LOGS_BLOCK
)


def test_hook(
    name: str = "web-wave-demo-test",
    kind: str = "Pod",
    phase: str = "Succeeded",
    events: tuple[str, ...] = ("test",),
    started: str = "2026-09-04T10:05:00Z",
    completed: str = "2026-09-04T10:05:09Z",
) -> dict[str, Any]:
    """One hook record as helm carries it inside the release document."""
    return {
        "name": name,
        "kind": kind,
        "path": f"templates/tests/{name}.yaml",
        "events": list(events),
        "last_run": {"started_at": started, "completed_at": completed, "phase": phase},
    }


# A builder, not a test: keeps pytest from collecting it where it is imported.
test_hook.__test__ = False


def release_document(
    name: str = RELEASE,
    namespace: str = NAMESPACE,
    revision: int = 1,
    status: str = "deployed",
    chart_name: str = CHART,
    chart_version: str = CHART_VERSION,
    app_version: str = APP_VERSION,
    last_deployed: str = LAST_DEPLOYED,
    hooks: list[dict[str, Any]] | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The release document helm prints under `-o json`."""
    return {
        "name": name,
        "namespace": namespace,
        "version": revision,
        "info": {
            "first_deployed": LAST_DEPLOYED,
            "last_deployed": last_deployed,
            "deleted": "",
            "description": "Install complete",
            "status": status,
        },
        "chart": {
            "metadata": {
                "name": chart_name,
                "version": chart_version,
                "appVersion": app_version,
            }
        },
        "config": {} if config is None else config,
        "manifest": "apiVersion: v1\nkind: Service\n",
        "hooks": [] if hooks is None else hooks,
    }


def status_document(**overrides: Any) -> dict[str, Any]:
    """The release document a `helm status` read prints: helm sends no chart on a read."""
    document = release_document(**overrides)
    document.pop("chart")
    return document


def history_entry(
    revision: int = 1,
    chart: str = CHART_RELEASE,
    app_version: str = APP_VERSION,
    status: str = "deployed",
) -> dict[str, Any]:
    """One revision as `helm history -o json` prints it."""
    return {
        "revision": revision,
        "updated": LAST_DEPLOYED,
        "status": status,
        "chart": chart,
        "app_version": app_version,
        "description": "Install complete",
    }


def release_row(
    name: str = RELEASE,
    namespace: str = NAMESPACE,
    revision: int = 1,
    updated: str = LAST_DEPLOYED,
    status: str = "deployed",
    chart: str = CHART_RELEASE,
    app_version: str = APP_VERSION,
) -> list[Any]:
    """The single Table row release_table renders for a release document."""
    return [name, namespace, revision, updated, status, chart, app_version]


def table(columns: list[str], types: list[str], rows: list[list[Any]]) -> dict[str, Any]:
    """The table envelope summary_table produces."""
    return {
        "__wave_type": "table",
        "columns": [
            {"name": name, "type": col_type} for name, col_type in zip(columns, types, strict=True)
        ],
        "rows": [list(cells) for cells in rows],
    }


def release_table_envelope(rows: list[list[Any]] | None = None) -> dict[str, Any]:
    """The release table envelope; no argument means the empty form."""
    return table(RELEASE_COLUMNS, RELEASE_COLUMN_TYPES, rows or [])


def test_table_envelope(rows: list[list[Any]] | None = None) -> dict[str, Any]:
    """The test-hook table envelope; no argument means the empty form."""
    return table(TEST_COLUMNS, TEST_COLUMN_TYPES, rows or [])


test_table_envelope.__test__ = False


def helm_params(**overrides: Any) -> dict[str, Any]:
    """The session and release every Helm block needs, plus the test's own parameters."""
    params = block_params(release=RELEASE)
    params.update(overrides)
    return params


WAVE_ADDITIONAL = "-----BEGIN CERTIFICATE-----\nwave-additional\n-----END CERTIFICATE-----\n"
WAVE_ANCHORS = (
    WAVE_ADDITIONAL + "-----BEGIN CERTIFICATE-----\nwave-builtin\n-----END CERTIFICATE-----\n"
)


@dataclass
class WaveTrust:
    """WAVE's active trust set as the test sets it, plus every anchors lookup made."""

    spec: Any
    pem: str
    calls: list[Any] = field(default_factory=list)


def session_with_ca() -> str:
    """A session whose cluster carries its own CA, so its kubeconfig never reads WAVE's trust."""
    document = json.loads(session_value())
    document["clusters"][0]["cluster"]["certificate-authority-data"] = "Y2x1c3Rlci1jYQ=="
    return json.dumps(document)


def kubeconfig_with_wave_anchors() -> dict[str, Any]:
    """The default session as helm reads it: no CA of its own, so WAVE's anchors as its CA."""
    document: dict[str, Any] = json.loads(session_value())
    document["clusters"][0]["cluster"]["certificate-authority-data"] = base64.b64encode(
        WAVE_ANCHORS.encode("utf-8")
    ).decode("ascii")
    return document


def helm_ok(stdout: str = "", stderr: str = "") -> HelmResult:
    """A helm run that exited zero."""
    return HelmResult(stdout=stdout, stderr=stderr, exit_code=0)


def helm_failed(stderr: str, exit_code: int = 1, stdout: str = "") -> HelmResult:
    """A helm run that refused."""
    return HelmResult(stdout=stdout, stderr=stderr, exit_code=exit_code)


def helm_timed_out(stdout: str = "", stderr: str = "") -> HelmResult:
    """A helm run the process deadline killed."""
    return HelmResult(stdout=stdout, stderr=stderr, exit_code=124, timed_out=True)


def release_json(**overrides: Any) -> str:
    """A release document as helm prints it under -o json."""
    return json.dumps(release_document(**overrides))


def status_json(**overrides: Any) -> str:
    """A `helm status` read as helm prints it under -o json, chartless as helm sends it."""
    return json.dumps(status_document(**overrides))


def history_json(*entries: dict[str, Any]) -> str:
    """A release history as helm prints it under -o json; no argument means one revision."""
    return json.dumps(list(entries) if entries else [history_entry()])


@dataclass
class HelmCall:
    """One run_helm call recorded by the fake runner."""

    argv: list[str]
    kubeconfig: str
    helm_path: str
    deadline_s: int
    files: dict[str, str] = field(default_factory=dict)
    chart_source: tuple[str, str, int] | None = None

    @property
    def workspace(self) -> str:
        """The per-call temp directory the verb wrote its files into."""
        return os.path.dirname(self.kubeconfig)


def _snapshot(directory: str) -> dict[str, str]:
    """Every file the verb had written into its workspace at the moment of the call.

    Taken while the call is in flight: the workspace is gone by the time the test
    reads the recorder.
    """
    contents: dict[str, str] = {}
    for name in sorted(os.listdir(directory)):
        path = os.path.join(directory, name)
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as handle:
                contents[name] = handle.read()
    return contents


class FakeRunHelm:
    """Replays scripted HelmResults and records every run_helm call.

    Sync on purpose: the verbs are synchronous and reach helm through this seam.
    """

    def __init__(self, results: list[Any] | None = None) -> None:
        self.results: list[Any] = list(results or [])
        self.calls: list[HelmCall] = []

    def __call__(
        self,
        argv: list[str],
        *,
        kubeconfig: str,
        helm_path: str,
        deadline_s: int,
        log: Any,
        chart_source: tuple[str, str, int] | None = None,
    ) -> Any:
        """Record the call and hand back the next scripted result, or raise it."""
        self.calls.append(
            HelmCall(
                list(argv),
                kubeconfig,
                helm_path,
                deadline_s,
                _snapshot(os.path.dirname(kubeconfig)),
                chart_source,
            )
        )
        if not self.results:
            raise AssertionError(
                f"FakeRunHelm has no scripted result for call {len(self.calls)}: "
                "queue one HelmResult or exception per expected helm run"
            )
        item = self.results.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    @property
    def last(self) -> HelmCall:
        """The most recent recorded call."""
        return self.calls[-1]

    @property
    def argv(self) -> list[str]:
        """The argv of the first recorded call, workspace paths normalized."""
        return normalized(self.calls[0])


def normalized(call: HelmCall) -> list[str]:
    """The recorded argv with every workspace path rewritten to @<filename>."""
    prefix = call.workspace + os.sep
    return [f"@{item[len(prefix):]}" if item.startswith(prefix) else item for item in call.argv]


def patch_run_helm(verb: str, fake: FakeRunHelm) -> Any:
    """Patch one verb module's run_helm so it calls the recorder."""
    return patch(f"wavecore.connectivity.helm.verbs.{verb}.run_helm", fake)


def patch_floor_probe(verb: str, message: str | None) -> Any:
    """Patch one verb module's floor_message so the version probe answers as scripted."""
    return patch(
        f"wavecore.connectivity.helm.verbs.{verb}.floor_message",
        lambda helm_path, kubeconfig, log: message,
    )


def workspace_file(call: HelmCall, name: str) -> str:
    """The text a verb had written into its workspace under one filename."""
    return call.files[name]


@dataclass
class FakeHelmScript:
    """A real executable on disk that behaves like a scripted helm."""

    path: str
    report: str
    calls: list[dict[str, Any]] = field(default_factory=list)

    def report_json(self) -> dict[str, Any]:
        """What the fake recorded about the one run: argv, env, cwd, kubeconfig, workspace files."""
        with open(self.report, encoding="utf-8") as handle:
            return json.load(handle)


_FAKE_HELM_SOURCE = """
import json
import os
import sys
import time

STDOUT = {stdout!r}
STDERR = {stderr!r}
EXIT_CODE = {exit_code!r}
SLEEP = {sleep!r}
REPORT = {report!r}

argv = sys.argv[1:]
kubeconfig = ""
mode = ""
files = {{}}
if "--kubeconfig" in argv:
    path = argv[argv.index("--kubeconfig") + 1]
    with open(path, encoding="utf-8") as handle:
        kubeconfig = handle.read()
    mode = oct(os.stat(path).st_mode & 0o777)
    for folder, _folders, names in os.walk(os.path.dirname(path)):
        for name in names:
            full = os.path.join(folder, name)
            with open(full, encoding="utf-8", errors="replace") as handle:
                files[full] = handle.read()
with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(
        {{
            "argv": argv,
            "env": dict(os.environ),
            "cwd": os.getcwd(),
            "kubeconfig": kubeconfig,
            "mode": mode,
            "files": files,
        }},
        handle,
    )
if SLEEP:
    time.sleep(SLEEP)
sys.stdout.write(STDOUT)
sys.stderr.write(STDERR)
sys.exit(EXIT_CODE)
"""


def fake_helm(
    tmp_path: Any,
    *,
    stdout: str = "",
    stderr: str = "",
    exit_code: int = 0,
    sleep: float = 0.0,
    name: str = "helm",
) -> FakeHelmScript:
    """Write an executable that answers like helm and records how it was called."""
    home = tmp_path / "fake-helm"
    home.mkdir(exist_ok=True)
    report = home / f"{name}-report.json"
    script = home / f"{name}.py"
    script.write_text(
        _FAKE_HELM_SOURCE.format(
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
            sleep=sleep,
            report=str(report),
        ),
        encoding="utf-8",
    )
    launcher = home / name
    launcher.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding="utf-8")
    launcher.chmod(launcher.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return FakeHelmScript(path=str(launcher), report=str(report))
