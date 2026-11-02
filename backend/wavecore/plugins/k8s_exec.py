"""K8s Exec Plugin (REQ-5.1.1, REQ-3.4.1.5).

Runs one command line inside a pod container over the Kubernetes exec channel,
like kubectl exec, and hands back what the command wrote to standard output and
standard error together with its exit code. The command line is one string the
block splits the way a shell splits it, so quotes group arguments,
and standard input is never opened. A non-zero exit code is data, not a
failure. A cluster-reported refusal carries the shared output core and honors
Failure Handling; session, transport, TLS and timeout failures always raise.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import exec as exec_verb
from wavecore.connectivity.k8s.verbs._manifest import split_command
from wavecore.plugins._k8s_common import (
    impersonation_parameters,
    namespace_parameters,
    on_error_parameter,
    output_core,
    require_impersonation_user,
    require_session,
    session_parameter,
    stream_outputs,
    timeout_parameter,
    validate_enums,
)
from wavecore.plugins._shared_params import require_positive
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase

_ENUM_PARAMS = ("on_error",)
_EMPTY_COMMAND = "Parameter 'command' cannot be empty - at least one argument required"


class K8sExecPlugin(PluginBase):
    """Runs one command line in a pod container over the exec channel."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-exec",
            "name": "K8s Exec",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Runs one command line in a pod container and returns its standard output, "
                "standard error and exit code. Quotes group arguments the way a shell does. "
                "The command reads nothing on standard input, and a non-zero exit code comes "
                "back as data rather than failing the block."
            ),
            "parameters": [
                session_parameter(),
                timeout_parameter(exec_verb.TIMEOUT_DEFAULT),
                {
                    "name": "pod",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "The pod to run the command in.",
                },
                {
                    "name": "container",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": (
                        "Which container in the pod to use. Name it even when the pod has only one."
                    ),
                },
                {
                    "name": "command",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": (
                        "One command line. Quotes group arguments the way a shell does, "
                        'so sh -c "echo hi there" is three arguments.'
                    ),
                },
                *namespace_parameters(all_namespaces=False),
                *impersonation_parameters(),
                on_error_parameter(),
            ],
            "return_type": "map",
            "output_schema": [*stream_outputs(), *output_core(gated=True)],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "exec", "command", "pod"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enum, the required rows, the command line and the timeout."""
        require_session(params)
        require_impersonation_user(params)
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])
        if not params.get("pod"):
            raise ValueError("Missing required parameter: pod")
        if not params.get("container"):
            raise ValueError("Missing required parameter: container")
        if "command" not in params:
            raise ValueError("Missing required parameter: command")
        if not split_command(str(params["command"])):
            raise ValueError(_EMPTY_COMMAND)
        require_positive(params, "timeout")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run the command line over the exec channel and render the output core."""
        return await run_verb(exec_verb.run, context["parameters"], context)
