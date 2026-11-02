"""The material the six Helm verbs share (REQ-3.5.3.1 - REQ-3.5.3.5, REQ-3.4.1.5).

One block's access to helm: the workspace its kubeconfig lives in, the runner
and floor probe its own verb module owns, and the envelope a refused run hands
back. The argv fragments every verb assembles its command line from live here
too, with the release-writing flow Install and Upgrade both follow. Stdlib only,
so the module copies onto a remote host beside the Kubernetes core.
"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import partial
from typing import Any, Protocol

from wavecore.connectivity.helm._cli import (
    CLEANUP_TIMEOUT,
    DEFAULT_TIMEOUT,
    STATUS_TIMEOUT,
    HelmResult,
    RouteAddress,
    Workspace,
    chart_name,
    classify_reason,
    deadline_message,
    helm_message,
    helm_workspace,
    history_chart,
    kubeconfig_text,
    parse_history,
    parse_release,
    release_status,
    release_table,
    route_address,
    shape_result,
)
from wavecore.connectivity.k8s.rest import wave_anchors
from wavecore.connectivity.k8s.verbs._context import K8sContext, require_context
from wavecore.connectivity.k8s.verbs._outputs import block_failure, block_success
from wavecore.connectivity.k8s.verbs._resources import client_options, present, resolve_namespace

Log = Callable[[str, str], None]
Probe = Callable[[str, str, Log], str | None]
ArgvBuilder = Callable[[dict[str, Any], Workspace, K8sContext], list[str]]

_STATUS = "status"
_HISTORY = "history"
_FLOOR_MARKER = "unknown flag"
_READ_OUTPUT = ["-o", "json"]
_JSON_OUTPUT = ["--output", "json"]
_REPOSITORY_SCHEMES = ("oci://", "http://", "https://")


class Runner(Protocol):
    """The shape of the runner a verb module hands to the shared flow."""

    def __call__(
        self,
        argv: list[str],
        *,
        kubeconfig: str,
        helm_path: str,
        deadline_s: int,
        log: Log,
        chart_source: RouteAddress | None = None,
    ) -> HelmResult: ...


def output_format(params: dict[str, Any]) -> str:
    """The shape the Output Format row asks the Result for."""
    return str(params.get("output_format", "table"))


def timeout_of(params: dict[str, Any]) -> int:
    """The operation timeout a write runs under, the block's own or the family default."""
    return int(params.get("timeout", DEFAULT_TIMEOUT))


def read_timeout_of(params: dict[str, Any]) -> int:
    """The deadline a read runs under, the block's own or the family default."""
    return int(params.get("timeout", STATUS_TIMEOUT))


def cleanup_timeout_of(params: dict[str, Any]) -> int:
    """The room helm gets to undo a failed write; zero when nothing will be undone."""
    if not (params.get("atomic") or params.get("cleanup_on_fail")):
        return 0
    return int(params.get("cleanup_timeout", CLEANUP_TIMEOUT))


def deadline_of(params: dict[str, Any]) -> int:
    """The wall-clock bound on a write: its Timeout plus the cleanup room it asked for."""
    return timeout_of(params) + cleanup_timeout_of(params)


def target(
    params: dict[str, Any], context: K8sContext, *, create_namespace: bool = False
) -> list[str]:
    """The namespace a call targets, and the user and groups helm runs it as."""
    namespace = resolve_namespace(params, context, named=True) or context.namespace
    argv = ["--namespace", namespace]
    if create_namespace:
        argv.append("--create-namespace")
    return argv + _impersonation(params)


def _impersonation(params: dict[str, Any]) -> list[str]:
    """The user and groups helm runs the request as; groups alone impersonate nobody."""
    options = client_options(params)
    user = options["impersonate_user"]
    if not user:
        return []
    argv = ["--kube-as-user", str(user)]
    for group in options["impersonate_groups"] or []:
        argv += ["--kube-as-group", str(group)]
    return argv


def timeout_argv(timeout_s: int) -> list[str]:
    """helm's own operation timeout, in the seconds form helm parses."""
    return ["--timeout", f"{timeout_s}s"]


def chart_argv(params: dict[str, Any], work: Workspace) -> list[str]:
    """The chart a release comes from and the values it renders with."""
    argv: list[str] = []
    if present(params, "version"):
        argv += ["--version", params["version"].strip()]
    if present(params, "repo"):
        argv += ["--repo", params["repo"].strip()]
    if present(params, "values"):
        argv += ["--values", work.write("values.yaml", params["values"])]
    for key, value in (params.get("set") or {}).items():
        # helm reads key=null as removing the key from the chart defaults.
        argv += ["--set", f"{key}={'null' if value is None else value}"]
    return argv


def repo_argv(params: dict[str, Any], work: Workspace) -> list[str]:
    """The chart repository's credentials and the trust the download runs under."""
    argv: list[str] = []
    if present(params, "repo_username"):
        argv += ["--username", params["repo_username"].strip()]
    if present(params, "repo_password"):
        argv += ["--password", params["repo_password"]]
    verify = params.get("repo_verify_ssl", True)
    if present(params, "repo_ca_cert"):
        argv += ["--ca-file", work.write("ca.pem", params["repo_ca_cert"])]
    elif verify and _from_repository(params):
        argv += ["--ca-file", work.write("wave-trust.pem", wave_anchors())]
    if not verify:
        argv.append("--insecure-skip-tls-verify")
    return argv


def _from_repository(params: dict[str, Any]) -> bool:
    """Whether the chart is downloaded: a Repository URL, or a chart reference into one."""
    chart = str(params.get("chart", "")).strip()
    return present(params, "repo") or chart.startswith(_REPOSITORY_SCHEMES)


def chart_source_of(params: dict[str, Any]) -> RouteAddress | None:
    """Where helm downloads the chart from; None for a local path or an address helm will refuse."""
    address = str(params["repo"] if present(params, "repo") else params["chart"]).strip()
    if not address.startswith(_REPOSITORY_SCHEMES):
        return None
    try:
        return route_address(address)
    except ValueError:
        return None


def status_argv(
    release: str, params: dict[str, Any], context: K8sContext, revision: int | None = None
) -> list[str]:
    """The `helm status` read: the one Status makes, and the read-back after a write."""
    argv = [_STATUS, release]
    if revision is not None:
        argv += ["--revision", str(int(revision))]
    return argv + target(params, context) + _READ_OUTPUT


def history_argv(release: str, params: dict[str, Any], context: K8sContext) -> list[str]:
    """The `helm history` read that fills the cells a release read leaves out."""
    return [_HISTORY, release] + target(params, context) + _READ_OUTPUT


def no_document(verb: str) -> str:
    """The message for a helm run that printed something other than a release."""
    return f"helm {verb} printed no release document"


def release_empty(params: dict[str, Any]) -> dict[str, Any]:
    """The Result and Status a failure hands back: the empty document and no status."""
    return _release_outputs(None, output_format(params))


def release_success(
    release: dict[str, Any], params: dict[str, Any], chart: str = "", app_version: str = ""
) -> dict[str, Any]:
    """The envelope of a verb that hands back one release document."""
    return succeeded(_release_outputs(release, output_format(params), chart, app_version))


def _release_outputs(
    release: dict[str, Any] | None, shape: str, chart: str = "", app_version: str = ""
) -> dict[str, Any]:
    """The family's output core: the release document and the scalar a Wait Until polls."""
    table = partial(release_table, chart=chart, app_version=app_version)
    return {"result": shape_result(release, shape, table), "status": release_status(release)}


def succeeded(outputs: dict[str, Any]) -> dict[str, Any]:
    """The result envelope of a block that did what it was asked."""
    return {"__wave_type": "result", "outputs": block_success(outputs), "secrets": []}


class Helm:
    """One block's access to helm: its kubeconfig, and the runner its verb module hands in."""

    def __init__(
        self,
        params: dict[str, Any],
        work: Workspace,
        log: Log,
        runner: Runner,
        probe: Probe,
    ) -> None:
        self.work = work
        self.helm_path = str(params.get("helm_path") or "")
        self.kubeconfig = work.write("kubeconfig.json", kubeconfig_text(str(params["session"])))
        self._params = params
        self._log = log
        self._runner = runner
        self._probe = probe

    def call(
        self, argv: list[str], deadline_s: int, chart_source: RouteAddress | None = None
    ) -> HelmResult:
        """Launch helm with this block's kubeconfig, under one deadline."""
        return self._runner(
            argv,
            kubeconfig=self.kubeconfig,
            helm_path=self.helm_path,
            deadline_s=deadline_s,
            log=self._log,
            chart_source=chart_source,
        )

    def failed(
        self, outputs: dict[str, Any], message: str, reason: str, action: str
    ) -> dict[str, Any]:
        """The result envelope of a recorded failure; raises under on_error=fail."""
        core = block_failure(self._params, outputs, message, reason, self._log, action=action)
        return {"__wave_type": "result", "outputs": core, "secrets": []}

    def refused(
        self, result: HelmResult, verb: str, deadline_s: int, outputs: dict[str, Any], action: str
    ) -> dict[str, Any]:
        """The result envelope of a refused helm run, in helm's own words."""
        message, reason = self.refusal(result, verb, deadline_s)
        return self.failed(outputs, message, reason, action)

    def refusal(self, result: HelmResult, verb: str, deadline_s: int) -> tuple[str, str]:
        """helm's refusal as the block's message and one of the Reasons a workflow branches on."""
        if result.timed_out:
            return deadline_message(verb, deadline_s), "Timeout"
        floor = self._floor() if _FLOOR_MARKER in result.stderr else None
        return floor or helm_message(result, verb), classify_reason(result.stderr, timed_out=False)

    def _floor(self) -> str | None:
        """The message for a helm too old to carry the flags WAVE emits, None when it is not."""
        return self._probe(self.helm_path, self.kubeconfig, self._log)


@contextmanager
def helm_for(params: dict[str, Any], log: Log, *, runner: Runner, probe: Probe) -> Iterator[Helm]:
    """Hold one block's workspace and kubeconfig for the length of the call."""
    with helm_workspace() as work:
        yield Helm(params, work, log, runner, probe)


def read_chart(
    helm: Helm,
    params: dict[str, Any],
    context: K8sContext,
    release: dict[str, Any] | None,
    deadline_s: int,
) -> tuple[str, str]:
    """The chart and app version of the revision that was read, from helm's release history."""
    if release is None or output_format(params) != "table" or chart_name(release):
        return "", ""
    argv = history_argv(str(params["release"]).strip(), params, context)
    history = helm.call(argv, deadline_s)
    if history.exit_code != 0:
        return "", ""
    return history_chart(parse_history(history.stdout), int(release.get("version", 0)))


def write_release(
    params: dict[str, Any],
    log: Log,
    *,
    verb: str,
    action: str,
    argv: ArgvBuilder,
    landed: str,
    runner: Runner,
    probe: Probe,
) -> dict[str, Any]:
    """Install or upgrade a release and hand back the document helm printed."""
    # Imported on use: the plugins package loads every plugin, and the Helm ones import this module.
    from wavecore.plugins._file_ops import refuse_wave_scheme

    refuse_wave_scheme(str(params["chart"]).strip())
    context = require_context(params)
    timeout_s = timeout_of(params)
    deadline_s = deadline_of(params)
    empty = release_empty(params)
    with helm_for(params, log, runner=runner, probe=probe) as helm:
        tail = timeout_argv(timeout_s) + _JSON_OUTPUT
        source = chart_source_of(params)
        result = helm.call(argv(params, helm.work, context) + tail, deadline_s, source)
        if result.exit_code != 0 or result.timed_out:
            return helm.refused(result, verb, deadline_s, empty, action)

    release = parse_release(result.stdout)
    if release is None:
        return helm.failed(empty, no_document(verb), "Invalid", action)

    name = str(params["release"]).strip()
    log("INFO", landed.format(name=name, revision=int(release.get("version", 0))))
    return release_success(release, params)
