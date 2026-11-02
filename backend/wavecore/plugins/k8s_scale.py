"""K8s Scale Plugin (REQ-5.1.1, REQ-3.4.1.5).

Sets the replica count of any scalable kind through the /scale subresource:
the count already in place is read first, then the new one is written back as
a merge patch. The block does not wait and does not poll, and a kind the
cluster serves no scale endpoint for is refused before anything is written.
Carries the family output core and the fail-or-record Failure Handling control.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import scale
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

_ENUM_PARAMS = ("resource_type", "kind", "on_error")
_SCALE_KINDS = ["Deployment", "ReplicaSet", "ReplicationController", "StatefulSet"]


class K8sScalePlugin(PluginBase):
    """Writes a replica count to any kind the cluster serves a scale endpoint for."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-scale",
            "name": "K8s Scale",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Sets the replica count of a Deployment, ReplicaSet, ReplicationController, "
                "StatefulSet or any custom kind the cluster serves a scale endpoint for. "
                "The block writes the count and returns; it does not wait for the cluster "
                "to reach it."
            ),
            "parameters": [
                session_parameter(),
                timeout_parameter(),
                {
                    "name": "resource_type",
                    "type": "string",
                    "required": False,
                    "default": "default",
                    "enum_values": ["default", "custom"],
                    "description": (
                        "'default' picks a scalable kind from the list; 'custom' takes any "
                        "kind the cluster serves a scale endpoint for (CRDs included)"
                    ),
                },
                {
                    "name": "kind",
                    "type": "string",
                    "required": False,
                    "default": "Deployment",
                    "required_when": {"field": "resource_type", "values": ["default"]},
                    "enum_values": list(_SCALE_KINDS),
                    "description": "Built-in kind to scale (used when 'resource_type' is default)",
                },
                {
                    "name": "kind_custom",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "resource_type", "values": ["custom"]},
                    "description": (
                        "Kind to scale, resolved through the cluster's discovery "
                        "(used when 'resource_type' is custom)"
                    ),
                },
                {
                    "name": "name",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "Name of the object to scale",
                },
                {
                    "name": "replicas",
                    "type": "integer",
                    "required": True,
                    "description": (
                        "Replica count to set. Zero is valid and scales the workload down "
                        "to no replicas"
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
                        "One row per scaled object: the resource in kubectl's type/name form, "
                        "what happened to it, the count it carried, and the count now set"
                    ),
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "scale", "replicas", "write"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the per-mode kind, the name, replicas and timeout."""
        require_session(params)
        require_impersonation_user(params)
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])
        kind_param = "kind_custom" if params.get("resource_type") == "custom" else "kind"
        if not params.get(kind_param):
            raise ValueError(f"Missing required parameter: {kind_param}")
        if not params.get("name"):
            raise ValueError("Missing required parameter: name")
        replicas = params.get("replicas")
        if replicas is None:
            raise ValueError("Missing required parameter: replicas")
        if replicas < 0:
            raise ValueError("Parameter 'replicas' must be non-negative")
        require_positive(params, "timeout")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Read the scale subresource for the count in place, then merge-patch the new one."""
        return await run_verb(scale.run, context["parameters"], context)
