"""K8s Events Plugin (REQ-3.3.5.4, REQ-3.4.1.5).

Lists core v1 Events namespace-wide, cluster-wide, or scoped to one object,
filtered by type, reason and age, and hands them back newest-first as a map,
a WAVE table, JSON text or YAML text. Carries the family output core and the
fail-or-record Failure Handling control.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import events
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

_ENUM_PARAMS = ("object_type", "event_type", "output_format", "on_error")
_POSITIVE_PARAMS = ("within_seconds", "max_events", "timeout")


class K8sEventsPlugin(PluginBase):
    """Lists Kubernetes Events, filtered and newest-first."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-events",
            "name": "K8s Events",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Lists Kubernetes Events for a namespace, the whole cluster, or one object, "
                "filtered by type, reason and age, newest first - as a parsed list, a WAVE "
                "table, JSON text or YAML text."
            ),
            "parameters": [
                session_parameter(),
                timeout_parameter(),
                {
                    "name": "scope_to_object",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": "Only the events about one object, named by kind and name",
                },
                {
                    "name": "object_type",
                    "type": "string",
                    "required": False,
                    "default": "default",
                    "enum_values": ["default", "custom"],
                    "description": (
                        "'default' picks a kind from the built-in list; 'custom' takes any "
                        "other kind the cluster serves (CRDs included), by kind, plural "
                        "or short name"
                    ),
                },
                {
                    "name": "object_kind",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": DEFAULT_KIND,
                    "enum_values": list(STOCK_KINDS),
                    "required_when_all": [
                        {"field": "scope_to_object", "values": ["true"]},
                        {"field": "object_type", "values": ["default"]},
                    ],
                    "description": (
                        "Kind of the object the events are about, e.g. Pod "
                        "(used when 'scope_to_object' is ticked and 'object_type' is default)"
                    ),
                },
                {
                    "name": "object_kind_custom",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when_all": [
                        {"field": "scope_to_object", "values": ["true"]},
                        {"field": "object_type", "values": ["custom"]},
                    ],
                    "description": (
                        "Kind, plural, or short name of the object the events are about, "
                        "resolved through the cluster's discovery; a kind this cluster "
                        "does not serve fails the block (used when 'scope_to_object' is "
                        "ticked and 'object_type' is custom)"
                    ),
                },
                {
                    "name": "object_name",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "scope_to_object", "values": ["true"]},
                    "description": (
                        "Name of the object the events are about "
                        "(used when 'scope_to_object' is ticked)"
                    ),
                },
                {
                    "name": "event_type",
                    "type": "string",
                    "required": False,
                    "default": "any",
                    "enum_values": ["any", "Warning", "Normal"],
                    "description": "Keep only Warning or only Normal events; 'any' keeps both",
                },
                {
                    "name": "reason",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": "Keep only events with this reason, e.g. BackOff or Scheduled",
                },
                {
                    "name": "within_seconds",
                    "type": "integer",
                    "required": False,
                    "description": (
                        "Keep only events last seen within this many seconds, "
                        "in every output format"
                    ),
                },
                {
                    "name": "max_events",
                    "type": "integer",
                    "required": False,
                    "description": (
                        "Return at most this many events, newest first, in every output format"
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
                    "type": "array",
                    "description": (
                        "The events that passed the filters, newest first, cut at "
                        "'max_events'. Its type follows 'output_format': an array for 'map', "
                        "a table for 'table', text for 'json' and 'yaml'"
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
                    ],
                },
                {
                    "name": "count",
                    "type": "integer",
                    "description": "Number of events in 'result', after the age and count limits",
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "events", "read", "list"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the object rows when scoping, and the limits."""
        require_session(params)
        require_impersonation_user(params)
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])
        if params.get("scope_to_object"):
            kind_param = (
                "object_kind_custom" if params.get("object_type") == "custom" else "object_kind"
            )
            if not params.get(kind_param):
                raise ValueError(f"Missing required parameter: {kind_param}")
            if not params.get("object_name"):
                raise ValueError("Missing required parameter: object_name")
        for name in _POSITIVE_PARAMS:
            require_positive(params, name)

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """List the events, order and trim them in the block, render per output_format."""
        return await run_verb(events.run, context["parameters"], context)
