"""K8s Script Plugin (REQ-5.1.1, REQ-3.4.1.5).

Runs an interpreter inside a pod container and feeds it a script body on
standard input, the way SSH Session Script feeds a remote shell. The
interpreter is one string split the way a shell splits it, so it may carry
flags, and it is invoked bare - never with -c. Standard input over
the exec channel needs the v5 subprotocol, so a cluster that offers no v5
refuses the run as an ordinary block failure carrying Error and Reason.
A non-zero exit code is data, not a failure. Session, transport, TLS and
timeout failures always raise.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import script
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
_BLANK_INTERPRETER = "Parameter 'interpreter' cannot be empty"


class K8sScriptPlugin(PluginBase):
    """Feeds a script body to an interpreter running in a pod container."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-script",
            "name": "K8s Script",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Runs a multi-line script in a pod container by starting an interpreter there "
                "and piping the script to it on standard input, then returns its standard "
                "output, standard error and exit code. Nothing is written to the container's "
                "filesystem, and a non-zero exit code comes back as data rather than failing "
                "the block."
            ),
            "parameters": [
                session_parameter(),
                timeout_parameter(script.TIMEOUT_DEFAULT),
                {
                    "name": "pod",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "The pod to run the script in.",
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
                    "name": "interpreter",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": script.DEFAULT_INTERPRETER,
                    "description": (
                        "The interpreter that runs the script. Anything that reads a program "
                        "on standard input: /bin/sh, bash, python3, perl, node. May include "
                        "flags."
                    ),
                },
                {
                    "name": "script",
                    "type": "string",
                    "required": True,
                    "description": (
                        "The script to run. It is fed to the interpreter on standard input."
                    ),
                },
                *namespace_parameters(all_namespaces=False),
                *impersonation_parameters(),
                on_error_parameter(),
            ],
            "return_type": "map",
            "output_schema": [*stream_outputs(), *output_core(gated=True)],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "script", "interpreter", "pod"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enum, the required rows, the interpreter and the timeout."""
        require_session(params)
        require_impersonation_user(params)
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])
        if not params.get("pod"):
            raise ValueError("Missing required parameter: pod")
        if not params.get("container"):
            raise ValueError("Missing required parameter: container")
        if not params.get("script"):
            raise ValueError("Missing required parameter: script")
        typed = params.get("interpreter")
        if typed is not None and not split_command(str(typed), name="interpreter"):
            raise ValueError(_BLANK_INTERPRETER)
        require_positive(params, "timeout")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Start the interpreter, write the body to its standard input, render the core."""
        return await run_verb(script.run, context["parameters"], context)
