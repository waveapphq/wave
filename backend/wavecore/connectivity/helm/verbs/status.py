"""The Helm Status verb (REQ-3.5.3.4, REQ-3.4.1.5).

Reads one release, the live revision or an older one, into the Result a sheet
renders and into the scalar a Wait Until block polls. helm status has no
operation timeout of its own, so this block's Timeout bounds the read alone.
Carries the family output core and the fail-or-record Failure Handling control.
"""

from collections.abc import Callable
from typing import Any

from wavecore.connectivity.helm._cli import floor_message, parse_release, run_helm
from wavecore.connectivity.helm.verbs._common import (
    helm_for,
    no_document,
    read_chart,
    read_timeout_of,
    release_empty,
    release_success,
    status_argv,
)
from wavecore.connectivity.k8s.verbs._context import require_context

_VERB = "status"
_ACTION = "Helm Status"


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Read one release and hand back its document and the status scalar."""
    context = require_context(params)
    release_name = str(params["release"]).strip()
    timeout_s = read_timeout_of(params)
    empty = release_empty(params)
    with helm_for(params, log, runner=run_helm, probe=floor_message) as helm:
        argv = status_argv(release_name, params, context, params.get("revision"))
        result = helm.call(argv, timeout_s)
        if result.exit_code != 0:
            return helm.refused(result, _VERB, timeout_s, empty, _ACTION)
        release = parse_release(result.stdout)
        chart, app_version = read_chart(helm, params, context, release, timeout_s)

    if release is None:
        return helm.failed(empty, no_document(_VERB), "Invalid", _ACTION)
    log("INFO", f"Read release '{release_name}' at revision {release.get('version', 0)}")
    return release_success(release, params, chart, app_version)
