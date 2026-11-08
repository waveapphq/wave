"""The K8s Script verb (REQ-5.1.1, REQ-3.4.1.5).

Runs an interpreter inside a pod container and feeds it a script body on
standard input, the way SSH Session Script feeds a remote shell. The
interpreter is one string split the way a shell splits it, so it may carry
flags, and it is invoked bare - never with -c. Standard input over the exec
channel needs the v5 subprotocol, so a cluster that offers no v5 refuses the
run as an ordinary block failure carrying Error and Reason. A non-zero exit
code is data, not a failure. Session, transport, TLS and timeout failures
always raise.
"""

from collections.abc import Callable
from typing import Any

from .. import ws
from ..rest import seconds
from ._manifest import split_command
from ._outputs import block_failure, block_success, empty_streams
from ._resources import client_options, pod_exec

TIMEOUT_DEFAULT = 60
DEFAULT_INTERPRETER = "/bin/sh"
_ACTION = "Script"
_NEEDS_V5 = (
    "K8s Script needs Kubernetes 1.30 or newer. Use K8s Copy and K8s Exec on older clusters."
)


def _failed(
    params: dict[str, Any], message: str, reason: str | None, log: Callable[[str, str], None]
) -> dict[str, Any]:
    """The result envelope of a recorded refusal; raises under on_error=fail."""
    outputs = block_failure(params, empty_streams(), message, reason, log, action=_ACTION)
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Start the interpreter, write the body to its standard input, render the core."""
    target = pod_exec(params, TIMEOUT_DEFAULT)
    typed = str(params.get("interpreter") or DEFAULT_INTERPRETER)
    argv = split_command(typed, name="interpreter")
    try:
        stdout, stderr, exit_code = ws.exec_in_pod(
            target.context,
            target.namespace,
            target.pod,
            target.container,
            argv,
            str(params["script"]),
            target.timeout,
            **client_options(params),
        )
    except ws.ExecVersionUnsupported:
        return _failed(params, _NEEDS_V5, "UnsupportedVersion", log)
    except ws.ExecTimeout as exc:
        raise ValueError(f"Script execution timed out after {seconds(target.timeout)}") from exc
    except ws.ExecTransportError as exc:
        raise ValueError(f"Could not run the script in {target.where()}: {exc}") from exc
    except ws.ExecRejected as exc:
        message = f"Could not run the script in {target.where()}: {exc.message}"
        return _failed(params, message, exc.reason, log)

    log("INFO", f"Ran the script in pod '{target.pod}': exit code {exit_code}")
    outputs = block_success({"stdout": stdout, "stderr": stderr, "exit_code": exit_code})
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}
