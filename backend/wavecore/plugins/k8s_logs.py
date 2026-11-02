"""K8s Logs Plugin (REQ-3.3.2.1, REQ-3.4.1.5).

Reads one container's log through the pod log subresource, like kubectl logs,
and hands it back as text or per line, where a per-line read with Timestamps
on is a TIME and MESSAGE table, with the shared success/error/reason output
core. The container is always named on the block (K8SREAD-20). A cluster 400
('previous' on a container that never restarted, a container the pod does not
have) surfaces the cluster's own message; the other cluster rows come from the
shared mapper; session, transport, TLS and timeout failures always raise.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import logs
from wavecore.plugins._k8s_common import (
    impersonation_parameters,
    namespace_parameters,
    on_error_parameter,
    output_core,
    require_impersonation_user,
    require_session,
    session_parameter,
    timeout_parameter,
    validate_enums,
)
from wavecore.plugins._shared_params import require_positive
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase

_POSITIVE_PARAMS = ("tail_lines", "since_seconds", "max_bytes", "timeout")
_ENUM_PARAMS = ("output_format", "on_error")


class K8sLogsPlugin(PluginBase):
    """Reads a pod container's log text through the K8s Session."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-logs",
            "name": "K8s Logs",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Reads one container's log from a pod through the Kubernetes pod log "
                "subresource, like kubectl logs, and hands it back as text or as one entry "
                "per line, where a per-line read with 'timestamps' on is a TIME and "
                "MESSAGE table."
            ),
            "parameters": [
                session_parameter(),
                timeout_parameter(),
                {
                    "name": "pod",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "Name of the pod whose log is read",
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
                    "name": "previous",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Read the log of the previous, terminated instance of the container"
                    ),
                },
                {
                    "name": "tail_lines",
                    "type": "integer",
                    "required": False,
                    "description": "Return only the last N lines of the log",
                },
                {
                    "name": "since_seconds",
                    "type": "integer",
                    "required": False,
                    "description": "Return only log lines newer than this many seconds",
                },
                {
                    "name": "timestamps",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": "Prefix every line with its RFC3339 timestamp",
                },
                {
                    "name": "output_format",
                    "type": "string",
                    "required": False,
                    "default": "string",
                    "enum_values": ["string", "array"],
                    "description": (
                        "Shape of 'logs': 'string' is the text as it came back, 'array' is "
                        "one entry per line, which with 'timestamps' on is a WAVE table of "
                        "TIME and MESSAGE split from the timestamp each line carries"
                    ),
                },
                {
                    "name": "max_bytes",
                    "type": "integer",
                    "required": False,
                    "description": "Cap the returned log at this many bytes",
                },
                *namespace_parameters(all_namespaces=False),
                *impersonation_parameters(),
                on_error_parameter(),
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "logs",
                    "type": "string",
                    "description": (
                        "The log the cluster returned, empty on failure. Its type follows "
                        "'output_format' and 'timestamps': text for 'string', one entry per "
                        "line for 'array', a TIME and MESSAGE table for 'array' with "
                        "'timestamps' on"
                    ),
                    "type_when": [
                        {
                            "when": [
                                {"field": "output_format", "values": ["array"]},
                                {"field": "timestamps", "values": ["true"]},
                            ],
                            "type": "table",
                        },
                        {
                            "when": [{"field": "output_format", "values": ["array"]}],
                            "type": "array",
                        },
                    ],
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "logs", "pod"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the required params, the positive integers, and the enums."""
        require_session(params)
        require_impersonation_user(params)
        if not params.get("pod"):
            raise ValueError("Missing required parameter: pod")
        if not params.get("container"):
            raise ValueError("Missing required parameter: container")
        for name in _POSITIVE_PARAMS:
            require_positive(params, name)
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Read the log subresource once and render the output core."""
        return await run_verb(logs.run, context["parameters"], context)
