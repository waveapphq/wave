"""The Helm Test verb (REQ-3.5.3.2, REQ-3.4.1.5).

Runs a chart's test hooks and reports one row per hook, read back from the
release record rather than parsed out of helm's text, plus every test pod's log
under helm's own headers when Logs is ticked. A failed run still fills Result and
Logs under Record and continue: they are what the block exists to produce.
"""

from collections.abc import Callable
from typing import Any

from wavecore.connectivity.helm._cli import (
    floor_message,
    parse_release,
    run_helm,
    shape_result,
    test_table,
)
from wavecore.connectivity.helm.verbs._common import (
    helm_for,
    no_document,
    output_format,
    status_argv,
    succeeded,
    target,
    timeout_argv,
    timeout_of,
)
from wavecore.connectivity.k8s.verbs._context import K8sContext, require_context

_VERB = "test"
_READ_BACK = "status"
_ACTION = "Helm Test"
_LOGS_HEADER = "POD LOGS:"


def _argv(params: dict[str, Any], context: K8sContext, release: str, timeout_s: int) -> list[str]:
    """The helm test command line; the hook records are read back afterwards."""
    argv = [_VERB, release]
    if params.get("logs"):
        argv.append("--logs")
    return argv + target(params, context) + timeout_argv(timeout_s)


def _pod_logs(stdout: str) -> str:
    """Every test pod's log, from helm's first pod header to the end of the run."""
    lines = stdout.splitlines(keepends=True)
    headers = [index for index, line in enumerate(lines) if line.startswith(_LOGS_HEADER)]
    return "".join(lines[headers[0] :]) if headers else ""


def _outputs(params: dict[str, Any], release: dict[str, Any] | None, stdout: str) -> dict[str, Any]:
    """Result and Logs; a read-back that carried no release leaves both empty."""
    result = shape_result(release, output_format(params), test_table)
    if release is None:
        return {"result": result, "logs": ""}
    return {"result": result, "logs": _pod_logs(stdout) if params.get("logs") else ""}


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Run the chart's test hooks, then read the release back for the hook records."""
    context = require_context(params)
    release_name = str(params["release"]).strip()
    timeout_s = timeout_of(params)
    with helm_for(params, log, runner=run_helm, probe=floor_message) as helm:
        ran = helm.call(_argv(params, context, release_name, timeout_s), timeout_s)
        # The record is read back after a failed run too: a failure is what the block reports on.
        read_back = helm.call(status_argv(release_name, params, context), timeout_s)
        release = parse_release(read_back.stdout) if read_back.exit_code == 0 else None
        outputs = _outputs(params, release, ran.stdout)
        if ran.exit_code != 0:
            return helm.refused(ran, _VERB, timeout_s, outputs, _ACTION)
        if release is None:
            message, reason = (
                helm.refusal(read_back, _READ_BACK, timeout_s)
                if read_back.exit_code != 0
                else (no_document(_READ_BACK), "Invalid")
            )
            return helm.failed(outputs, message, reason, _ACTION)

    hooks = len(test_table(release)["rows"])
    log("INFO", f"Ran {hooks} test hook(s) for release '{release_name}'")
    return succeeded(outputs)
