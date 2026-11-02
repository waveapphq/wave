"""The Helm Install verb (REQ-3.5.3.1, REQ-3.4.1.5).

Installs a chart as a new release. The argv is helm's own: every flag is a real
helm flag in helm's order, the chart values and the repository certificate ride
files inside the call's workspace, and no readiness flag is ever emitted - a
Wait Until block composes readiness. The `-o json` release document becomes the
block's Result and Status; helm's refusal becomes its message and Reason.
"""

from collections.abc import Callable
from typing import Any

from wavecore.connectivity.helm._cli import Workspace, floor_message, run_helm
from wavecore.connectivity.helm.verbs._common import chart_argv, repo_argv, target, write_release
from wavecore.connectivity.k8s.verbs._context import K8sContext

_VERB = "install"
_ACTION = "Helm Install"


def _argv(params: dict[str, Any], work: Workspace, context: K8sContext) -> list[str]:
    """The `helm install` command line, without the timeout and output tail."""
    argv = [_VERB, str(params["release"]).strip(), str(params["chart"]).strip()]
    argv += chart_argv(params, work) + repo_argv(params, work)
    argv += target(params, context, create_namespace=bool(params.get("create_namespace")))
    if params.get("atomic"):
        argv.append("--atomic")
    return argv


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Install the chart as a new release and hand back the release document helm printed."""
    return write_release(
        params,
        log,
        verb=_VERB,
        action=_ACTION,
        argv=_argv,
        landed="Installed release '{name}' as revision {revision}",
        runner=run_helm,
        probe=floor_message,
    )
