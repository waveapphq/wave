"""K8s Get Plugin (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

Reads any Kubernetes kind by name, by label/field selector, or as a plain
list, and renders the answer as a map, a WAVE table, JSON text or YAML
text. The kind is resolved through live discovery, so custom resources
and short names work without a WAVE-side catalog. Reading kind Secret
registers every data value with the run secret registry. Carries the family
output core and the fail-or-record Failure Handling control.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import get
from wavecore.plugins._k8s_common import (
    DEFAULT_KIND,
    STOCK_KINDS,
    impersonation_parameters,
    namespace_parameters,
    on_error_parameter,
    output_core,
    output_format_parameter,
    require_impersonation_user,
    require_session,
    session_parameter,
    timeout_parameter,
    validate_enums,
)
from wavecore.plugins._shared_params import require_positive
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase

_ENUM_PARAMS = ("resource_type", "search_by", "output_format", "on_error")


class K8sGetPlugin(PluginBase):
    """Reads one object or a list of objects of any kind the cluster serves."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-get",
            "name": "K8s Get",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Reads Kubernetes objects of any kind - one object by name, a filtered "
                "set by label or field selector, or the whole list - as a parsed map for "
                "one named object and an array for a selector or list read, a WAVE table, "
                "or JSON or YAML text re-serialized from the same objects with "
                "managedFields dropped. Reading kind Secret registers every data value "
                "with the run secret registry."
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
                    "description": "Built-in kind to read (used when 'resource_type' is default)",
                },
                {
                    "name": "kind_custom",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "resource_type", "values": ["custom"]},
                    "description": (
                        "Kind, plural, or short name to read, resolved through the cluster's "
                        "discovery (used when 'resource_type' is custom)"
                    ),
                },
                {
                    "name": "search_by",
                    "type": "string",
                    "required": False,
                    "default": "name",
                    "enum_values": ["name", "selector", "list"],
                    "description": (
                        "'name' reads one object and fails when it is absent; 'selector' "
                        "and 'list' read a list, where an empty result is a pass with count 0"
                    ),
                },
                {
                    "name": "name",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "search_by", "values": ["name"]},
                    "description": "Name of the object to read (used when 'search_by' is name)",
                },
                {
                    "name": "label_selector",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": (
                        "Label selector in kubectl syntax, e.g. app=web,tier!=cache "
                        "(used when 'search_by' is selector)"
                    ),
                },
                {
                    "name": "field_selector",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": (
                        "Field selector in kubectl syntax, e.g. status.phase=Running "
                        "(used when 'search_by' is selector)"
                    ),
                },
                output_format_parameter(),
                *namespace_parameters(all_namespaces=True),
                *impersonation_parameters(),
                on_error_parameter(),
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "result",
                    "type": "map",
                    "description": (
                        "What the cluster returned. Its type follows 'output_format': a map "
                        "for one named object, an array for a selector or list read, a table "
                        "for 'table', text for 'json' and 'yaml'"
                    ),
                    "type_when": [
                        {
                            "when": [{"field": "output_format", "values": ["table"]}],
                            "type": "table",
                        },
                        {
                            "when": [{"field": "output_format", "values": ["json", "yaml"]}],
                            "type": "string",
                        },
                        {
                            "when": [
                                {"field": "output_format", "values": ["map"]},
                                {"field": "search_by", "values": ["selector", "list"]},
                            ],
                            "type": "array",
                        },
                    ],
                },
                {
                    "name": "names",
                    "type": "array",
                    "description": (
                        "Names of the objects read, in the order the cluster listed them"
                    ),
                },
                {
                    "name": "count",
                    "type": "integer",
                    "description": "Number of objects read",
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "get", "read", "list"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the per-mode required params, and the timeout."""
        require_session(params)
        require_impersonation_user(params)
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])
        kind_param = "kind_custom" if params.get("resource_type") == "custom" else "kind"
        if not params.get(kind_param):
            raise ValueError(f"Missing required parameter: {kind_param}")
        if params.get("search_by", "name") == "name" and not params.get("name"):
            raise ValueError("Missing required parameter: name")
        require_positive(params, "timeout")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Resolve the kind, read the object or list, render it per output_format."""
        return await run_verb(get.run, context["parameters"], context)
