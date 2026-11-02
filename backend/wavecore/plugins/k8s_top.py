"""K8s Top Plugin (REQ-5.1.1, REQ-3.4.1.5).

Reads resource usage from the aggregated metrics API for pods or nodes,
selected by name, by label selector, or all of them. Wire quantities are
converted to raw cores and bytes, never percentages, so the workflow picks
its own denominator. A pod's usage is the sum over its containers, with an
optional per-container breakdown; a node row also carries the node's
capacity and allocatable. A cluster without the metrics API hard-fails in
both on_error modes.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import top
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

_ENUM_PARAMS = ("scope", "select_by", "on_error")


class K8sTopPlugin(PluginBase):
    """Reads pod or node resource usage from the metrics API."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-top",
            "name": "K8s Top",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Reads CPU and memory usage for pods or nodes from the cluster's "
                "metrics API, as raw cores and bytes, optionally broken down per "
                "container; node rows also carry capacity and allocatable."
            ),
            "parameters": [
                session_parameter(),
                timeout_parameter(),
                {
                    "name": "scope",
                    "type": "string",
                    "required": True,
                    "default": "pod",
                    "enum_values": ["pod", "node"],
                    "description": "Measure pods or nodes. Default: pod.",
                },
                {
                    "name": "select_by",
                    "type": "string",
                    "required": True,
                    "default": "all",
                    "enum_values": ["all", "name", "selector"],
                    "description": (
                        "How to pick the targets: every one, a single name, or a label "
                        "selector. Default: all."
                    ),
                },
                {
                    "name": "name",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "select_by", "values": ["name"]},
                    "description": "Name of the single pod or node to measure",
                },
                {
                    "name": "label_selector",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": "Label selector the targets must match (e.g. app=web)",
                },
                {
                    "name": "include_containers",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Emit one row per container instead of one per pod. Pods only."
                    ),
                },
                *namespace_parameters(all_namespaces=True),
                *impersonation_parameters(),
                on_error_parameter(),
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "usage",
                    "type": "table",
                    "description": (
                        "One row per target: NAME, CPU (cores) and MEMORY (bytes), both "
                        "null for a node the metrics API does not report; CONTAINER when "
                        "broken down; the node's capacity and allocatable columns for nodes"
                    ),
                },
                {
                    "name": "count",
                    "type": "integer",
                    "description": "Number of rows in usage",
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "top", "metrics", "usage"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the conditional name, the timeout range, and enums."""
        require_session(params)
        require_impersonation_user(params)
        if params.get("select_by", "all") == "name" and not params.get("name"):
            raise ValueError("Missing required parameter: name")
        require_positive(params, "timeout")
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Probe the metrics API, read the usage rows, and emit them with the output core."""
        return await run_verb(top.run, context["parameters"], context)
