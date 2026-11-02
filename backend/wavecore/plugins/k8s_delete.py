"""K8s Delete Plugin (REQ-5.1.1, REQ-3.4.1.5, K8SWRITE-5).

Removes one Kubernetes object by name or every object a label selector
matches, with kubectl's own cascade, grace period and wait-until-gone
controls. It follows kubectl on a missing target: a name that is already
gone is an error unless 'Ignore not found' is ticked, while a selector that
matches nothing is a pass with count 0. Carries the family output core and
the fail-or-record Failure Handling control.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import delete
from wavecore.plugins._k8s_common import (
    DEFAULT_KIND,
    STOCK_KINDS,
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

_ENUM_PARAMS = ("resource_type", "delete_by", "cascade", "on_error")


class K8sDeletePlugin(PluginBase):
    """Deletes one named object, or every object a label selector matches."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-delete",
            "name": "K8s Delete",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Deletes Kubernetes objects of any kind - one object by name, or every "
                "object a label selector matches - with kubectl's cascade, grace period "
                "and wait-until-gone controls."
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
                        "'default' picks a built-in kind from the list; 'custom' takes any "
                        "kind, plural, or short name the cluster serves (CRDs included)"
                    ),
                },
                {
                    "name": "kind",
                    "type": "string",
                    "required": False,
                    "default": DEFAULT_KIND,
                    "enum_values": list(STOCK_KINDS),
                    "required_when": {"field": "resource_type", "values": ["default"]},
                    "description": (
                        "Built-in kind to delete (used when 'resource_type' is default)"
                    ),
                },
                {
                    "name": "kind_custom",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "resource_type", "values": ["custom"]},
                    "description": (
                        "Kind, plural, or short name to delete, resolved through the cluster's "
                        "discovery (used when 'resource_type' is custom)"
                    ),
                },
                {
                    "name": "delete_by",
                    "type": "string",
                    "required": False,
                    "default": "name",
                    "enum_values": ["name", "selector"],
                    "description": (
                        "'name' deletes one object and fails when it is absent; 'selector' "
                        "deletes every match, where no match is a pass with count 0"
                    ),
                },
                {
                    "name": "name",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "delete_by", "values": ["name"]},
                    "description": "Name of the object to delete (used when 'delete_by' is name)",
                },
                {
                    "name": "label_selector",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "delete_by", "values": ["selector"]},
                    "description": (
                        "Label selector in kubectl syntax, e.g. app=web,tier!=cache "
                        "(used when 'delete_by' is selector)"
                    ),
                },
                {
                    "name": "ignore_not_found",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Treat a name that is already gone as a pass with count 0 instead "
                        "of an error, as kubectl's --ignore-not-found does"
                    ),
                },
                {
                    "name": "cascade",
                    "type": "string",
                    "required": False,
                    "default": "background",
                    "enum_values": ["background", "foreground", "orphan"],
                    "description": (
                        "How dependent objects are removed: 'background' deletes them after "
                        "the owner, 'foreground' before it, 'orphan' leaves them in place"
                    ),
                },
                {
                    "name": "grace_period_seconds",
                    "type": "integer",
                    "required": False,
                    "description": (
                        "Seconds the object gets to shut down cleanly; 0 removes it "
                        "immediately. Empty uses the kind's own default."
                    ),
                },
                {
                    "name": "wait_until_gone",
                    "type": "boolean",
                    "required": False,
                    "default": True,
                    "description": (
                        "Wait until the cluster no longer serves the object, bounded by the "
                        "block timeout; unticked returns as soon as the cluster accepts"
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
                        "One row per deleted object: the resource in kubectl's type/name "
                        "form and what happened to it"
                    ),
                },
                {
                    "name": "names",
                    "type": "array",
                    "description": "Names of the objects deleted, in the order the cluster gave",
                },
                {
                    "name": "count",
                    "type": "integer",
                    "description": "Number of objects deleted",
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "delete", "remove"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the per-mode required params, and the numbers."""
        require_session(params)
        require_impersonation_user(params)
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])
        kind_param = "kind_custom" if params.get("resource_type") == "custom" else "kind"
        if not params.get(kind_param):
            raise ValueError(f"Missing required parameter: {kind_param}")
        target = "name" if params.get("delete_by", "name") == "name" else "label_selector"
        if not params.get(target):
            raise ValueError(f"Missing required parameter: {target}")
        require_positive(params, "timeout")
        grace = params.get("grace_period_seconds")
        if grace is not None and grace < 0:
            raise ValueError("Parameter 'grace_period_seconds' must be non-negative")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Resolve the kind, delete the object or the matching set, then wait for it to go."""
        return await run_verb(delete.run, context["parameters"], context)
