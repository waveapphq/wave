"""K8s Rollout Plugin (REQ-5.1.1, REQ-3.4.1.5).

Restarts a Deployment, StatefulSet or DaemonSet, reports how its current
rollout is going, or rolls it back to an earlier revision. Restart and Undo
write and return without a verdict; Status reads once and never waits.
Carries the family output core and the fail-or-record Failure Handling
control, with Status gated behind its own operation.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import rollout
from wavecore.plugins._k8s_common import (
    WRITE_NAMESPACE_DESCRIPTION,
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

_ENUM_PARAMS = ("operation", "kind", "on_error")
_WORKLOAD_KINDS = ["Deployment", "StatefulSet", "DaemonSet"]


class K8sRolloutPlugin(PluginBase):
    """Restarts, reports on, or rolls back one workload's rollout."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-rollout",
            "name": "K8s Rollout",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Restarts a Deployment, StatefulSet or DaemonSet, reports how its current "
                "rollout is going, or rolls it back to an earlier revision. Restart and "
                "Undo write and return; Status reads once and never waits."
            ),
            "parameters": [
                session_parameter(),
                timeout_parameter(),
                {
                    "name": "operation",
                    "type": "string",
                    "required": False,
                    "default": "restart",
                    "enum_values": ["restart", "status", "undo"],
                    "description": (
                        "'restart' stamps the pod template so every pod is replaced, 'status' "
                        "reports how the current rollout is going, 'undo' rolls the workload "
                        "back to an earlier revision"
                    ),
                },
                {
                    "name": "kind",
                    "type": "string",
                    "required": True,
                    "default": "Deployment",
                    "enum_values": list(_WORKLOAD_KINDS),
                    "description": "Workload kind to roll: only these three have a rollout",
                },
                {
                    "name": "name",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "Name of the workload to roll",
                },
                {
                    "name": "to_revision",
                    "type": "integer",
                    "required": False,
                    "description": (
                        "Revision to roll back to (used when 'operation' is undo); empty "
                        "picks the previous revision"
                    ),
                },
                *namespace_parameters(
                    all_namespaces=False, description=WRITE_NAMESPACE_DESCRIPTION
                ),
                *impersonation_parameters(),
                on_error_parameter(),
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "summary",
                    "type": "table",
                    "description": (
                        "One row per workload rolled: the resource in kubectl's type/name "
                        "form, what happened to it, and the sentence kubectl prints"
                    ),
                },
                {
                    "name": "status",
                    "type": "string",
                    "show_when": {"field": "operation", "values": ["status"]},
                    "description": (
                        "The rollout verdict when 'operation' is status: 'complete', "
                        "'progressing' or 'failed'"
                    ),
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "rollout", "restart", "undo"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the name, the timeout and the revision."""
        require_session(params)
        require_impersonation_user(params)
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])
        if not params.get("name"):
            raise ValueError("Missing required parameter: name")
        require_positive(params, "timeout")
        revision = params.get("to_revision")
        if revision is not None and revision < 1:
            raise ValueError("Parameter 'to_revision' must be 1 or greater")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Resolve the workload, run the chosen operation, return the Summary."""
        return await run_verb(rollout.run, context["parameters"], context)
