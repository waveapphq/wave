"""WAVE-side material for the Kubernetes plugin family (REQ-5.1.1, REQ-4.5.5).

The parameter descriptors every K8s block declares, the pydantic-side
validation checks, and the stream outputs the exec blocks declare. The sync
verb bridge the blocks run their verbs through lives in _verb_bridge.
"""

from collections.abc import Iterable
from typing import Any

from wavecore.connectivity.k8s.verbs._resources import DEFAULT_TIMEOUT, client_options
from wavecore.plugins import _shared_params
from wavecore.plugins._executor_base import validate_enum_from_schema

_EMPTY_SESSION_MESSAGE = (
    "Parameter 'session' is set but what it points at is empty: check it names the "
    "variable a K8s Connect block assigns its 'session' output to, and that Connect "
    "ran before this block"
)
_GROUPS_WITHOUT_USER_MESSAGE = (
    "Parameter 'impersonate_groups' cannot be used on its own: set 'impersonate_user' to the "
    "user to run the request as, or clear the groups"
)
OUTPUT_FORMATS = ("map", "table", "json", "yaml")
_DEFAULT_FORMAT_DESCRIPTION = (
    "Shape of 'result': 'map' is the parsed object or list, 'table' is a WAVE "
    "table with the columns kubectl prints, 'json' and 'yaml' are the object "
    "as JSON or YAML text"
)
WRITE_NAMESPACE_DESCRIPTION = (
    "Namespace to act on; empty uses the session default carried by K8s Connect"
)
_READ_NAMESPACE_DESCRIPTION = (
    "Namespace to read from; empty uses the session default carried by K8s Connect"
)
# The Kind picker's stock kinds in the window's order (K8SREAD-5).
STOCK_KINDS = (
    "CronJob",
    "DaemonSet",
    "Deployment",
    "Job",
    "Pod",
    "ReplicaSet",
    "StatefulSet",
    "Endpoints",
    "Ingress",
    "NetworkPolicy",
    "Service",
    "ConfigMap",
    "Secret",
    "ServiceAccount",
    "PersistentVolume",
    "PersistentVolumeClaim",
    "StorageClass",
    "ClusterRole",
    "ClusterRoleBinding",
    "Namespace",
    "Node",
    "Role",
    "RoleBinding",
)
DEFAULT_KIND = "Pod"


def session_parameter() -> dict[str, Any]:
    """The secret 'session' parameter every K8s block reads."""
    return {
        "name": "session",
        "type": "string",
        "trim": True,
        "required": True,
        "secret": True,
        "description": (
            "K8s Session: the 'session' output of a K8s Connect block, carrying the "
            "server, trust settings, credentials, and default namespace"
        ),
    }


def timeout_parameter(
    default: int = DEFAULT_TIMEOUT, description: str | None = None
) -> dict[str, Any]:
    """The per-request timeout parameter."""
    return _shared_params.timeout_parameter(
        default,
        f"Request timeout in seconds. Default: {default}." if description is None else description,
    )


def namespace_parameters(
    all_namespaces: bool, description: str | None = None
) -> list[dict[str, Any]]:
    """The namespace group: an optional all-namespaces tick, then the optional namespace."""
    parameters: list[dict[str, Any]] = []
    if all_namespaces:
        parameters.append(
            {
                "name": "all_namespaces",
                "type": "boolean",
                "required": False,
                "default": False,
                "description": "Read across every namespace instead of a single one",
            }
        )
    parameters.append(
        {
            "name": "namespace",
            "type": "string",
            "trim": True,
            "required": False,
            "description": _READ_NAMESPACE_DESCRIPTION if description is None else description,
        }
    )
    return parameters


def impersonation_parameters() -> list[dict[str, Any]]:
    """The optional impersonation pair sent as Impersonate-User / Impersonate-Group headers."""
    return [
        {
            "name": "impersonate_user",
            "type": "string",
            "trim": True,
            "required": False,
            "description": "Run the request as this user (Impersonate-User header)",
        },
        {
            "name": "impersonate_groups",
            "type": "string",
            "trim": True,
            "required": False,
            "description": (
                "Comma-separated groups to run the request as (Impersonate-Group headers)"
            ),
        },
    ]


def on_error_parameter() -> dict[str, Any]:
    """The failure-handling enum: fail the block or record the error and continue."""
    return _shared_params.on_error_parameter(
        "What a cluster error does: 'fail' stops the block, 'record' sets "
        "success=false with the error and reason and continues"
    )


def output_core(*, gated: bool) -> list[dict[str, Any]]:
    """The success/error/reason outputs; gated hides the two error rows outside Record."""
    return _shared_params.output_core(
        gated=gated,
        success_description=(
            "True when the cluster carried out the operation without error; false "
            "when On error is Record and continue and the cluster refused it"
        ),
        reason_description=(
            "The cluster reason for the failure, like NotFound or Forbidden; empty "
            "when the operation succeeded"
        ),
    )


def stream_outputs() -> list[dict[str, Any]]:
    """The three streams a block that runs something in a pod hands back."""
    return [
        {
            "name": "stdout",
            "type": "string",
            "description": "Everything the command wrote to standard output.",
        },
        {
            "name": "stderr",
            "type": "string",
            "description": "Everything the command wrote to standard error.",
        },
        {
            "name": "exit_code",
            "type": "integer",
            "description": (
                "The exit code the command returned. A non-zero code is returned as "
                "data, not treated as a failure."
            ),
        },
    ]


def output_format_parameter(
    *,
    formats: tuple[str, ...] = OUTPUT_FORMATS,
    default: str = "map",
    description: str | None = None,
) -> dict[str, Any]:
    """The output_format enum: the parsed structure, a WAVE table, or raw JSON/YAML text."""
    return {
        "name": "output_format",
        "type": "string",
        "required": False,
        "default": default,
        "enum_values": list(formats),
        "description": _DEFAULT_FORMAT_DESCRIPTION if description is None else description,
    }


def require_session(params: dict[str, Any]) -> None:
    """Reject an unset 'session', and separately one that resolved to empty."""
    session = params.get("session")
    if session is None:
        raise ValueError("Missing required parameter: session")
    if not session:
        raise ValueError(_EMPTY_SESSION_MESSAGE)


def require_impersonation_user(params: dict[str, Any]) -> None:
    """Reject groups given with no user: the apiserver answers that shape with a bare 500."""
    options = client_options(params)
    if options["impersonate_groups"] and not options["impersonate_user"]:
        raise ValueError(_GROUPS_WITHOUT_USER_MESSAGE)


def validate_enums(
    params: dict[str, Any], names: Iterable[str], parameters: list[dict[str, Any]]
) -> None:
    """Check every enum param that is present against its declared values."""
    for name in names:
        if name in params:
            validate_enum_from_schema(name, params[name], parameters)
