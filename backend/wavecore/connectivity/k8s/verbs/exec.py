"""The K8s Exec verb (REQ-5.1.1, REQ-3.4.1.5).

Runs one command line inside a pod container over the Kubernetes exec channel,
like kubectl exec, and hands back what the command wrote to standard output and
standard error together with its exit code. The command line is one string
split the way a shell splits it, so quotes group arguments, and standard input
is never opened. A non-zero exit code is data, not a failure. A cluster-reported
refusal carries the shared output core and honors Failure Handling; session,
transport, TLS and timeout failures always raise.
"""

from collections.abc import Callable
from typing import Any

from .. import ws
from ..rest import seconds
from ._manifest import split_command
from ._outputs import block_failure, block_success, empty_streams
from ._resources import client_options, pod_exec

TIMEOUT_DEFAULT = 60
_ACTION = "Exec"


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Run the command line over the exec channel and render the output core."""
    target = pod_exec(params, TIMEOUT_DEFAULT)
    argv = split_command(str(params["command"]))
    try:
        stdout, stderr, exit_code = ws.exec_in_pod(
            target.context,
            target.namespace,
            target.pod,
            target.container,
            argv,
            None,
            target.timeout,
            **client_options(params),
        )
    except ws.ExecTimeout as exc:
        raise ValueError(f"Command execution timed out after {seconds(target.timeout)}") from exc
    except ws.ExecTransportError as exc:
        raise ValueError(f"Could not run the command in {target.where()}: {exc}") from exc
    except ws.ExecRejected as exc:
        outputs = block_failure(
            params,
            empty_streams(),
            f"Could not run the command in {target.where()}: {exc.message}",
            exc.reason,
            log,
            action=_ACTION,
        )
        return {"__wave_type": "result", "outputs": outputs, "secrets": []}

    log("INFO", f"Ran the command in pod '{target.pod}': exit code {exit_code}")
    outputs = block_success({"stdout": stdout, "stderr": stderr, "exit_code": exit_code})
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}
