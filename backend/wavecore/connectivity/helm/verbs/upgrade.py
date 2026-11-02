"""The Helm Upgrade verb (REQ-3.5.3.3, REQ-3.4.1.5).

Upgrades a release to a new chart or new values, with helm's own values rules on
top of Install's command line: Install if missing turns an upgrade of an absent
release into an install and is the only state in which Create Namespace applies,
Reuse Values and Reset Values take the same slot and are never both emitted, and
Cleanup on Fail joins Atomic. The new revision's document becomes Result and
Status; no readiness flag is ever emitted.
"""

from collections.abc import Callable
from typing import Any

from wavecore.connectivity.helm._cli import Workspace, floor_message, run_helm
from wavecore.connectivity.helm.verbs._common import chart_argv, repo_argv, target, write_release
from wavecore.connectivity.k8s.verbs._context import K8sContext

_VERB = "upgrade"
_ACTION = "Helm Upgrade"


def _values_argv(params: dict[str, Any]) -> list[str]:
    """How the new values meet the ones already in place, and whether a miss installs."""
    argv: list[str] = []
    if params.get("install"):
        argv.append("--install")
    if params.get("reuse_values"):
        argv.append("--reuse-values")
    elif params.get("reset_values"):
        argv.append("--reset-values")
    return argv


def _failure_argv(params: dict[str, Any]) -> list[str]:
    """What helm does to the release when the upgrade goes wrong."""
    argv: list[str] = []
    if params.get("atomic"):
        argv.append("--atomic")
    if params.get("cleanup_on_fail"):
        argv.append("--cleanup-on-fail")
    return argv


def _argv(params: dict[str, Any], work: Workspace, context: K8sContext) -> list[str]:
    """The `helm upgrade` command line, without the timeout and output tail."""
    argv = [_VERB, str(params["release"]).strip(), str(params["chart"]).strip()]
    argv += chart_argv(params, work) + _values_argv(params) + repo_argv(params, work)
    # helm refuses --create-namespace unless the upgrade may install the release.
    installs = bool(params.get("create_namespace") and params.get("install"))
    argv += target(params, context, create_namespace=installs)
    return argv + _failure_argv(params)


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Upgrade the release and hand back the document of the revision helm printed."""
    return write_release(
        params,
        log,
        verb=_VERB,
        action=_ACTION,
        argv=_argv,
        landed="Upgraded release '{name}' to revision {revision}",
        runner=run_helm,
        probe=floor_message,
    )
