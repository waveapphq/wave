"""K8s Apply Plugin (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

Writes Kubernetes objects from a hand-typed manifest or from a short form for
ConfigMap, Secret and Job. Update brings each object to match with a
server-side apply patch; Fail creates it and surfaces the cluster's own
already-exists answer. A multi-document manifest applies in order and never
rolls back, so a partial failure reports what landed. Every value written to a
Secret registers with the run secret registry, as typed and as the cluster
encodes it back. Carries the family output core and the fail-or-record Failure
Handling control.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import apply
from wavecore.connectivity.k8s.verbs._manifest import parse_manifest, secret_values, split_command
from wavecore.connectivity.k8s.verbs._resources import present
from wavecore.core.execution.plugin_executor import check_entry_nulls
from wavecore.plugins._k8s_common import (
    WRITE_NAMESPACE_DESCRIPTION,
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

_ENUM_PARAMS = (
    "define_with",
    "kind",
    "secret_type",
    "job_from",
    "if_exists",
    "output_format",
    "on_error",
)
_OUTPUT_FORMAT_DESCRIPTION = (
    "Shape of 'result': the applied object, or the same object as JSON or YAML text"
)


def _required(params: dict[str, Any], name: str) -> None:
    if not present(params, name):
        raise ValueError(f"Missing required parameter: {name}")


def prepare(params: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], list[Any]]:
    """Mask every Secret value the block is about to write before the verb thread starts."""
    return params, secret_values(apply.given_documents(params))


class K8sApplyPlugin(PluginBase):
    """Applies one object from a form or any number of objects from a manifest."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-apply",
            "name": "K8s Apply",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Writes Kubernetes objects from a hand-typed manifest or from a short "
                "form for ConfigMap, Secret and Job. Update brings each object to match "
                "with a server-side apply; Fail creates it and refuses one that is "
                "already there. Values written to a Secret register with the run secret "
                "registry."
            ),
            "parameters": [
                session_parameter(),
                timeout_parameter(),
                {
                    "name": "define_with",
                    "type": "string",
                    "required": False,
                    "default": "manifest",
                    "enum_values": ["manifest", "form"],
                    "description": (
                        "'manifest' applies the documents typed below; 'form' builds one "
                        "object from the rows the chosen kind shows"
                    ),
                },
                {
                    "name": "manifest",
                    "type": "string",
                    "required": False,
                    "required_when": {"field": "define_with", "values": ["manifest"]},
                    "wire_format": "json",
                    "description": (
                        "YAML or JSON manifest to apply; several documents separated by "
                        "--- apply in the order they are typed"
                    ),
                },
                {
                    "name": "kind",
                    "type": "string",
                    "required": False,
                    "default": "ConfigMap",
                    "enum_values": ["ConfigMap", "Secret", "Job"],
                    "required_when": {"field": "define_with", "values": ["form"]},
                    "description": (
                        "Kind of object the form builds (used when 'define_with' is form)"
                    ),
                },
                {
                    "name": "name",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when": {"field": "define_with", "values": ["form"]},
                    "description": "Name of the object the form builds",
                },
                {
                    "name": "data",
                    "type": "map",
                    "required": False,
                    "description": (
                        "Key/value pairs the ConfigMap carries; an empty map is valid and "
                        "creates the ConfigMap with no data; a null value fails the run"
                    ),
                },
                {
                    "name": "secret_data",
                    "type": "map",
                    "required": False,
                    "secret": True,
                    "description": (
                        "Key/value pairs the Secret carries; an empty map is valid and "
                        "creates the Secret with no data; a null value fails the run"
                    ),
                },
                {
                    "name": "secret_type",
                    "type": "string",
                    "required": False,
                    "default": "Opaque",
                    "enum_values": [
                        "Opaque",
                        "kubernetes.io/tls",
                        "kubernetes.io/dockerconfigjson",
                    ],
                    "description": (
                        "Type of the Secret the form builds; the cluster checks the keys a "
                        "typed Secret requires"
                    ),
                },
                {
                    "name": "job_from",
                    "type": "string",
                    "required": False,
                    "default": "image",
                    "enum_values": ["image", "cronjob"],
                    "description": (
                        "'image' runs the named image; 'cronjob' runs what an existing "
                        "CronJob would have run"
                    ),
                },
                {
                    "name": "cronjob_name",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when_all": [
                        {"field": "define_with", "values": ["form"]},
                        {"field": "kind", "values": ["Job"]},
                        {"field": "job_from", "values": ["cronjob"]},
                    ],
                    "description": "Name of the CronJob whose job template the Job copies",
                },
                {
                    "name": "image",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "required_when_all": [
                        {"field": "define_with", "values": ["form"]},
                        {"field": "kind", "values": ["Job"]},
                        {"field": "job_from", "values": ["image"]},
                    ],
                    "description": "Container image the Job runs, e.g. busybox:1.36",
                },
                {
                    "name": "command",
                    "type": "string",
                    "required": False,
                    "description": (
                        "Command line the Job runs, split the way a shell splits it; empty "
                        "leaves the image's own entrypoint alone"
                    ),
                },
                {
                    "name": "if_exists",
                    "type": "string",
                    "required": False,
                    "default": "update",
                    "enum_values": ["update", "fail"],
                    "description": (
                        "'update' applies server-side and takes over fields another tool "
                        "owns; 'fail' creates the object and refuses one that already exists"
                    ),
                },
                output_format_parameter(
                    formats=("map", "json", "yaml"), description=_OUTPUT_FORMAT_DESCRIPTION
                ),
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
                        "What the block did: one row per object, with the resource in "
                        "kubectl's type/name form and the outcome created or configured"
                    ),
                },
                {
                    "name": "result",
                    "type": "map",
                    "description": (
                        "The objects the cluster returned. Its type follows "
                        "'output_format': the applied object for a form, an array for a "
                        "manifest, text for 'json' and 'yaml'"
                    ),
                    "type_when": [
                        {
                            "when": [{"field": "output_format", "values": ["json", "yaml"]}],
                            "type": "string",
                        },
                        {
                            "when": [{"field": "define_with", "values": ["manifest"]}],
                            "type": "array",
                        },
                    ],
                },
                {
                    "name": "names",
                    "type": "array",
                    "description": "Names of the objects applied, in the order they were applied",
                },
                {
                    "name": "count",
                    "type": "integer",
                    "description": "Number of objects applied",
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "apply", "create", "write"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the required rows, the manifest and the timeout."""
        require_session(params)
        require_impersonation_user(params)
        # A blank 'kind' is an unfilled row, so the required-row step reports it missing.
        checked = [name for name in _ENUM_PARAMS if name != "kind" or present(params, "kind")]
        validate_enums(params, checked, self.metadata["parameters"])
        form = params.get("define_with", "manifest") == "form"
        if form:
            self._require_form_rows(params)
        else:
            _required(params, "manifest")
            parse_manifest(str(params["manifest"]))
        if form and apply.job_from_image(params):
            split_command(str(params.get("command") or ""))
        require_positive(params, "timeout")

    @staticmethod
    def _require_form_rows(params: dict[str, Any]) -> None:
        """The rows the chosen kind and job source make mandatory; ConfigMap and Secret values
        are text, so a null value fails naming its key (REQ-3.1.3.21)."""
        _required(params, "kind")
        _required(params, "name")
        if params["kind"] == "ConfigMap":
            check_entry_nulls("data", params.get("data"))
        elif params["kind"] == "Secret":
            check_entry_nulls("secret_data", params.get("secret_data"))
        if apply.job_from_cronjob(params):
            _required(params, "cronjob_name")
        elif apply.job_from_image(params):
            _required(params, "image")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Apply every document in order, summarizing what landed."""
        return await run_verb(apply.run, context["parameters"], context, prepare=prepare)
