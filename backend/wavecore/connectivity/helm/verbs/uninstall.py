"""The Helm Uninstall verb (REQ-3.5.3.1 - REQ-3.5.3.5, REQ-3.4.1.5).

Removes a release with the three controls K8s Delete carries where helm has the
flag - Keep History, Ignore Not Found and Cascade - and hands back the shared
output core alone, since helm prints no document for an uninstall. It follows
helm on a release that is already gone: an error unless Ignore Not Found is
ticked. Carries the fail-or-record Failure Handling control.
"""

from collections.abc import Callable
from typing import Any

from wavecore.connectivity.helm._cli import floor_message, run_helm
from wavecore.connectivity.helm.verbs._common import (
    helm_for,
    succeeded,
    target,
    timeout_argv,
    timeout_of,
)
from wavecore.connectivity.k8s.verbs._context import K8sContext, require_context

_VERB = "uninstall"
_ACTION = "Helm Uninstall"


def _argv(params: dict[str, Any], context: K8sContext, release: str, timeout_s: int) -> list[str]:
    """The uninstall command line, in the sheet's own row order."""
    argv = [_VERB, release]
    if params.get("keep_history"):
        argv.append("--keep-history")
    if params.get("ignore_not_found"):
        argv.append("--ignore-not-found")
    argv += ["--cascade", str(params.get("cascade", "background"))]
    argv += target(params, context)
    return argv + timeout_argv(timeout_s)


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Remove the release, then report the output core alone."""
    context = require_context(params)
    release = str(params["release"]).strip()
    timeout_s = timeout_of(params)
    with helm_for(params, log, runner=run_helm, probe=floor_message) as helm:
        result = helm.call(_argv(params, context, release, timeout_s), timeout_s)
        if result.exit_code != 0:
            return helm.refused(result, _VERB, timeout_s, {}, _ACTION)

    log("INFO", f"Uninstalled release '{release}'")
    return succeeded({})
