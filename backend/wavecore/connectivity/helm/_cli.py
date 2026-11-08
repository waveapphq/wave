"""The Helm CLI core the six Helm verbs ride (REQ-3.5.3.1 - REQ-3.5.3.6, REQ-3.4.1.5).

Turns a K8s session into a kubeconfig for the length of one call, starts helm
inside that call's own directory with an environment built from nothing, hands
helm the proxy route WAVE decided for the cluster and the chart source, launches
the executable in a process group of its own under a process deadline
(REQ-3.2.2.4), turns helm's own text into one of the Reasons a workflow branches
on, and shapes the release document into the Result a block hands back. Stdlib
only, so the package copies onto a remote host beside the Kubernetes core and
the launcher.
"""

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from itertools import dropwhile
from typing import Any
from urllib.parse import urlsplit

from wavecore.connectivity import proxy, run_log
from wavecore.connectivity.block_outputs import summary_table
from wavecore.connectivity.k8s.rest import wave_anchors
from wavecore.connectivity.k8s.verbs._context import require_context
from wavecore.connectivity.k8s.verbs._outputs import empty_read_result, render_read_result

DEFAULT_TIMEOUT = 300
STATUS_TIMEOUT = 30
CLEANUP_TIMEOUT = 300
FLOOR = (3, 13)
# The bundle worker assigns the execution host before it dispatches a Helm block.
REMOTE_HOST: str | None = None

RELEASE_COLUMNS: list[tuple[str, str]] = [
    ("Name", "string"),
    ("Namespace", "string"),
    ("Revision", "integer"),
    ("Updated", "string"),
    ("Status", "string"),
    ("Chart", "string"),
    ("App Version", "string"),
]
TEST_COLUMNS: list[tuple[str, str]] = [
    ("Name", "string"),
    ("Kind", "string"),
    ("Phase", "string"),
    ("Started", "string"),
    ("Completed", "string"),
]

# Scheme, host without brackets, and port: the form the route decision is asked in.
RouteAddress = tuple[str, str, int]

_ERROR_MARKER = "Error: "
_VERSION_PATTERN = re.compile(r"v?(\d+)\.(\d+)")
# helm 4 prints these lines on stdout ahead of the release document of an oci:// chart.
_PULL_LINE_MARKERS = ("Pulled: ", "Digest: ")
# One entry in each login file keeps helm from asking a credential helper for a stored login.
_LOGIN_PLACEHOLDER = json.dumps({"auths": {"wave.invalid": {}}})
_DOCKER_FOLDER = ".docker"
_REMOTE_PROXY_VARIABLES = (
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "NO_PROXY",
    "no_proxy",
)
_LOCAL_CHART_LINE = "Helm does not use the proxy for {host}: it is a local address"
_DIRECT_CLUSTER_CHART_LINE = (
    "Helm does not use the proxy for {host}: "
    "it is under the cluster's address, which connects directly"
)
_REASON_ROWS: list[tuple[tuple[str, ...], str]] = [
    # An OCI registry that got no login; read ahead of the plain "not found" it also holds.
    (("basic credential not found",), "Forbidden"),
    (("not found",), "NotFound"),
    (("still in use", "already exists"), "AlreadyExists"),
    (("forbidden", "unauthorized"), "Forbidden"),
    (("timed out", "deadline exceeded"), "Timeout"),
    (
        ("unable to build kubernetes objects", "validation", "execution error", "unknown flag"),
        "Invalid",
    ),
    (
        ("cluster unreachable", "connection refused", "no such host", "cannot be reached"),
        "Unreachable",
    ),
    (("failed",), "Failed"),
]


@dataclass(frozen=True)
class HelmResult:
    """The three streams one helm run left behind."""

    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool = False


class Workspace:
    """The private directory one helm run reads every file it needs from."""

    def __init__(self, path: str) -> None:
        self.path = path

    def write(self, name: str, text: str) -> str:
        """Store one file inside the workspace, readable by this user only."""
        path = os.path.join(self.path, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.chmod(path, 0o600)
        return path


@contextmanager
def helm_workspace() -> Iterator[Workspace]:
    """Hold a workspace for the length of one block and remove it afterwards."""
    path = tempfile.mkdtemp(prefix="wave-helm-")
    try:
        yield Workspace(path)
    finally:
        shutil.rmtree(path, ignore_errors=True)


def kubeconfig_text(session: str) -> str:
    """Render a K8s session as the kubeconfig helm reads; a blank CA carries WAVE's trust set."""
    context = require_context({"session": session})
    document = json.loads(session)
    cluster = document["clusters"][0]["cluster"]
    if not context.verify:
        # client-go refuses a certificate authority paired with skipped verification.
        cluster.pop("certificate-authority-data", None)
    elif not context.ca_cert and urlsplit(context.server).scheme == "https":
        anchors = wave_anchors().encode("utf-8")
        cluster["certificate-authority-data"] = base64.b64encode(anchors).decode("ascii")
    proxy_url = _cluster_proxy_url(context.server)
    if proxy_url is not None:
        cluster["proxy-url"] = proxy_url
    return json.dumps(document)


def route_address(address: str) -> RouteAddress:
    """An address as the route decision is asked about it; an oci:// registry is an https one."""
    parts = urlsplit(address)
    scheme, default_port = ("http", 80) if parts.scheme == "http" else ("https", 443)
    return scheme, parts.hostname or "", parts.port or default_port


def _cluster_proxy_url(server: str) -> str | None:
    """The proxy WAVE sends the cluster through; None when direct, and always on a remote host."""
    spec = None if REMOTE_HOST is not None else proxy.active_proxy()
    if spec is None:
        return None
    return proxy.helm_route(spec, route_address(server), None).cluster_proxy_url


def redacted(argv: list[str]) -> list[str]:
    """A copy of the argv in which a chart-repository password reads ***."""
    copy = list(argv)
    for index, item in enumerate(copy):
        if item == "--password" and index + 1 < len(copy):
            copy[index + 1] = "***"
    return copy


def run_helm(
    argv: list[str],
    *,
    kubeconfig: str,
    helm_path: str,
    deadline_s: int,
    log: Callable[[str, str], None],
    chart_source: RouteAddress | None = None,
) -> HelmResult:
    """Launch helm in a group of its own with the kubeconfig appended and report what it printed."""
    # Imported here: the plugins package loads every plugin, and the Helm ones import this module.
    from wavecore.plugins._process_group import RUNNING, HeldGroups, kill_group, launch

    # Outside the try: a proxy failure is an OSError, which the handler reads as a missing helm.
    env = _helm_env(kubeconfig, chart_source)
    process_argv = [_helm_executable(helm_path), *argv, "--kubeconfig", kubeconfig]
    log("DEBUG", "helm " + " ".join(redacted(process_argv[1:])))
    try:
        process = launch(
            process_argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            cwd=os.path.dirname(kubeconfig),
        )
    except OSError as exc:
        raise ValueError(missing_helm_message(helm_path)) from exc
    # A run outside a stop-aware caller is held by nobody.
    running = RUNNING.get(None) or HeldGroups()
    running.hold(process)
    try:
        with process:
            try:
                stdout, stderr = process.communicate(timeout=deadline_s)
            except subprocess.TimeoutExpired as expired:
                kill_group(process)
                return HelmResult(
                    _stream(expired.stdout), _stream(expired.stderr), 124, timed_out=True
                )
    finally:
        running.release(process)
    return HelmResult(stdout, stderr, process.returncode)


def _helm_env(kubeconfig: str, chart_source: RouteAddress | None) -> dict[str, str]:
    """The whole environment of one run, built from nothing, with helm's two login files written."""
    work = Workspace(os.path.dirname(kubeconfig))
    os.makedirs(os.path.join(work.path, _DOCKER_FOLDER), exist_ok=True)
    work.write(os.path.join(_DOCKER_FOLDER, "config.json"), _LOGIN_PLACEHOLDER)
    return {
        "PATH": os.environ.get("PATH", os.defpath),
        "HOME": work.path,
        "TMPDIR": work.path,
        "HELM_CONFIG_HOME": os.path.join(work.path, "config"),
        "HELM_CACHE_HOME": os.path.join(work.path, "cache"),
        "HELM_DATA_HOME": os.path.join(work.path, "data"),
        "HELM_REGISTRY_CONFIG": work.write("registry.json", _LOGIN_PLACEHOLDER),
        "HELM_REPOSITORY_CACHE": os.path.join(work.path, "repository"),
        "HELM_REPOSITORY_CONFIG": os.path.join(work.path, "repositories.yaml"),
        "KUBECACHEDIR": os.path.join(work.path, "kube-cache"),
        **_proxy_env(kubeconfig, chart_source),
    }


def _proxy_env(kubeconfig: str, chart_source: RouteAddress | None) -> dict[str, str]:
    """The proxy variables of one run: the route WAVE decided, or a remote host's own, as set."""
    if REMOTE_HOST is not None:
        return {name: os.environ[name] for name in _REMOTE_PROXY_VARIABLES if name in os.environ}
    spec = proxy.active_proxy()
    if spec is None:
        return {}
    with open(kubeconfig, encoding="utf-8") as handle:
        server = json.load(handle)["clusters"][0]["cluster"]["server"]
    route = proxy.helm_route(spec, route_address(server), chart_source)
    _log_route(route)
    return route.env


def _log_route(route: proxy.HelmProxy) -> None:
    """Say once per block run which proxy helm was handed and which chart host goes around it."""
    if route.used is not None:
        run_log.log_once("DEBUG", f"Using the proxy {route.used.display}")
    for host, line in (
        (route.local_chart_host, _LOCAL_CHART_LINE),
        (route.direct_cluster_chart_host, _DIRECT_CLUSTER_CHART_LINE),
    ):
        if host is not None:
            run_log.log_once("DEBUG", line.format(host=_bracketed(host)))


def _bracketed(host: str) -> str:
    """The host as an address writes it: an IPv6 host in brackets."""
    return f"[{host}]" if ":" in host else host


def _helm_executable(helm_path: str) -> str:
    """A bare name for the PATH lookup; a path with a folder starts at the home folder (HELM-1)."""
    # Imported here: the plugins package loads every plugin, and the Helm ones import this module.
    from wavecore.plugins._tls_material import from_home

    value = helm_path.strip()
    if "/" not in value:
        return value or "helm"
    return from_home(os.path.expanduser(value))


def _stream(value: Any) -> str:
    """One partial stream a killed process left behind, as text."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def missing_helm_message(helm_path: str) -> str:
    """The message for a host that has no helm at the path the block named."""
    tried = helm_path.strip() or "helm on PATH"
    where = f" on {REMOTE_HOST}" if REMOTE_HOST else ""
    return f"helm not found: {tried}{where}. Set Helm Path or install helm"


def deadline_message(verb: str, deadline_s: int) -> str:
    """The message for a helm run the process deadline killed."""
    return f"helm {verb} did not finish within {deadline_s} s"


def helm_message(result: HelmResult, verb: str) -> str:
    """helm's own words for a refusal, or the exit code when it said nothing."""
    marker = result.stderr.find(_ERROR_MARKER)
    if marker >= 0:
        return result.stderr[marker + len(_ERROR_MARKER) :].strip()
    if result.stderr.strip():
        return result.stderr.strip()
    return f"helm {verb} exited with code {result.exit_code}"


def classify_reason(stderr: str, *, timed_out: bool) -> str:
    """The Reason a workflow branches on, read from helm's own wording."""
    if timed_out:
        return "Timeout"
    lowered = stderr.lower()
    for tokens, reason in _REASON_ROWS:
        if any(token in lowered for token in tokens):
            return reason
    return "Failed"


def floor_message(helm_path: str, kubeconfig: str, log: Callable[[str, str], None]) -> str | None:
    """The message for a helm too old to carry the flags WAVE emits, None when it is not."""
    probe = run_helm(
        ["version", "--template", "{{.Version}}"],
        kubeconfig=kubeconfig,
        helm_path=helm_path,
        deadline_s=STATUS_TIMEOUT,
        log=log,
    )
    if probe.exit_code != 0:
        return None
    found = probe.stdout.strip()
    match = _VERSION_PATTERN.match(found)
    if match is None or (int(match.group(1)), int(match.group(2))) >= FLOOR:
        return None
    return f"Helm {found} found at {_helm_location(helm_path)}, WAVE needs 3.13 or newer"


def _helm_location(helm_path: str) -> str:
    """The executable a floor violation names, resolved as helm was launched."""
    executable = _helm_executable(helm_path)
    return shutil.which(executable) or executable


def parse_release(stdout: str) -> dict[str, Any] | None:
    """The release document helm printed, None when it printed something else."""
    lines = stdout.splitlines(keepends=True)
    printed = dropwhile(lambda line: line.startswith(_PULL_LINE_MARKERS), lines)
    try:
        document = json.loads("".join(printed))
    except ValueError:
        return None
    return document if isinstance(document, dict) else None


def parse_history(stdout: str) -> list[dict[str, Any]]:
    """The release history helm printed, empty when it printed something else."""
    try:
        document = json.loads(stdout)
    except ValueError:
        return []
    if not isinstance(document, list):
        return []
    return [entry for entry in document if isinstance(entry, dict)]


def history_chart(entries: list[dict[str, Any]], revision: int) -> tuple[str, str]:
    """The chart and app version one revision came from, empty when the history has no such row."""
    for entry in entries:
        if entry.get("revision") == revision:
            return str(entry.get("chart", "")), str(entry.get("app_version", ""))
    return "", ""


def chart_name(release: dict[str, Any]) -> str:
    """The chart the document names; a release read carries none, so it reads empty."""
    return str(_chart_metadata(release).get("name", ""))


def _chart_metadata(release: dict[str, Any]) -> dict[str, Any]:
    """The chart metadata inside one release document, empty when it carries none."""
    metadata: dict[str, Any] = (release.get("chart") or {}).get("metadata") or {}
    return metadata


def release_table(
    release: dict[str, Any] | None, chart: str = "", app_version: str = ""
) -> dict[str, Any]:
    """The one-row release table; the pair fills the cells a release read leaves out."""
    if release is None:
        return summary_table(RELEASE_COLUMNS, [])
    info = release.get("info") or {}
    metadata = _chart_metadata(release)
    name = str(metadata.get("name", ""))
    row: list[Any] = [
        str(release.get("name", "")),
        str(release.get("namespace", "")),
        int(release.get("version", 0)),
        str(info.get("last_deployed", "")),
        str(info.get("status", "")),
        f"{name}-{metadata.get('version', '')}" if name else chart,
        str(metadata.get("appVersion", "")) or app_version,
    ]
    return summary_table(RELEASE_COLUMNS, [row])


def test_table(release: dict[str, Any] | None) -> dict[str, Any]:
    """One row per test hook the release carries, in document order."""
    hooks = (release or {}).get("hooks") or []
    return summary_table(TEST_COLUMNS, [_hook_row(hook) for hook in hooks if _is_test_hook(hook)])


def _is_test_hook(hook: dict[str, Any]) -> bool:
    """True when any event the hook answers to is a test event."""
    return any(str(event).startswith("test") for event in hook.get("events", []))


def _hook_row(hook: dict[str, Any]) -> list[Any]:
    """One hook as its table row; a hook that never ran reads empty."""
    last_run = hook.get("last_run") or {}
    return [
        str(hook.get("name", "")),
        str(hook.get("kind", "")),
        str(last_run.get("phase", "")),
        str(last_run.get("started_at", "")),
        str(last_run.get("completed_at", "")),
    ]


def release_status(release: dict[str, Any] | None) -> str:
    """The release's own status, the scalar a Wait Until block polls."""
    info = (release or {}).get("info") or {}
    return str(info.get("status", ""))


def shape_result(
    release: dict[str, Any] | None,
    output_format: str,
    table_builder: Callable[[dict[str, Any] | None], dict[str, Any]] = release_table,
) -> Any:
    """The Result value in the shape Output Format asks for."""
    if output_format == "table":
        return table_builder(release)
    if release is None:
        return empty_read_result(output_format, listed=False)
    return render_read_result(output_format, release)
