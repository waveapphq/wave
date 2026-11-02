"""The Helm Rollback verb (REQ-3.5.3.5, REQ-3.4.1.5).

Rolls a release back to an earlier revision, or to the one before the current
when Revision is empty, exactly as helm does. helm prints only text for a
rollback, so the release is read back with `helm status -o json` once the
rollback has landed and that document becomes the block's Result and Status.
Carries the family output core and the fail-or-record Failure Handling control.
"""

from collections.abc import Callable
from typing import Any

from wavecore.connectivity.helm._cli import floor_message, parse_release, run_helm
from wavecore.connectivity.helm.verbs._common import (
    deadline_of,
    helm_for,
    no_document,
    read_chart,
    release_empty,
    release_success,
    status_argv,
    target,
    timeout_argv,
    timeout_of,
)
from wavecore.connectivity.k8s.verbs._context import K8sContext, require_context

_VERB = "rollback"
_READ_BACK = "status"
_ACTION = "Helm Rollback"


def _argv(params: dict[str, Any], context: K8sContext, release: str, timeout_s: int) -> list[str]:
    """The rollback command line, in the sheet's own row order."""
    argv = [_VERB, release]
    revision = params.get("revision")
    if revision is not None:
        argv.append(str(int(revision)))
    argv += target(params, context)
    if params.get("cleanup_on_fail"):
        argv.append("--cleanup-on-fail")
    return argv + timeout_argv(timeout_s)


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Roll the release back, then read the landed release with helm status."""
    context = require_context(params)
    release = str(params["release"]).strip()
    timeout_s = timeout_of(params)
    deadline_s = deadline_of(params)
    empty = release_empty(params)
    with helm_for(params, log, runner=run_helm, probe=floor_message) as helm:
        result = helm.call(_argv(params, context, release, timeout_s), deadline_s)
        if result.exit_code != 0:
            return helm.refused(result, _VERB, deadline_s, empty, _ACTION)
        read_back = helm.call(status_argv(release, params, context), timeout_s)
        if read_back.exit_code != 0:
            return helm.refused(read_back, _READ_BACK, timeout_s, empty, _ACTION)
        rolled = parse_release(read_back.stdout)
        chart, app_version = read_chart(helm, params, context, rolled, timeout_s)

    if rolled is None:
        return helm.failed(empty, no_document(_READ_BACK), "Invalid", _ACTION)
    log("INFO", f"Rolled release '{release}' back to revision {rolled.get('version', 0)}")
    return release_success(rolled, params, chart, app_version)
