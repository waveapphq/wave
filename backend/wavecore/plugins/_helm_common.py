"""WAVE-side material for the Helm plugin family (REQ-3.5.3.1 - REQ-3.5.3.5).

The rows and outputs more than one Helm block declares: the connection pair, the
release positional, the chart source, the chart-repository credentials, the
Advanced and Failure Handling tail, and the release Result and Status outputs.
The checks every block opens validate() with live here too, and the hook that
resolves a WAVE-side chart before the argv is built. The session, namespace,
impersonation and failure rows come from the Kubernetes builders underneath.
"""

import os
from collections.abc import Iterable
from typing import Any

from wavecore.connectivity.helm._cli import CLEANUP_TIMEOUT, DEFAULT_TIMEOUT
from wavecore.plugins._file_paths import has_plugin_scheme, plain_path, resolve_plugin_path
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
from wavecore.plugins._k8s_common import output_format_parameter as k8s_output_format_parameter
from wavecore.plugins._shared_params import require_positive, toggle_parameter

_ENUM_PARAMS = ("output_format", "on_error")

_TIMEOUT_DESCRIPTION = (
    "How long helm may take to finish the operation, in seconds (helm's own --timeout). "
    "Default: 300."
)
_OUTPUT_FORMAT_DESCRIPTION = (
    "Shape of 'result': 'table' is a WAVE table with one row for the release, 'map' is "
    "the release document, 'json' and 'yaml' are that document as text"
)
INSTALL_NAMESPACE_DESCRIPTION = (
    "Namespace to install the release into; empty uses the session default carried by K8s Connect"
)
RELEASE_NAMESPACE_DESCRIPTION = (
    "Namespace the release lives in; empty uses the session default carried by K8s Connect"
)
_HELM_PATH_DESCRIPTION = (
    "The helm executable to run: a name looked up on the PATH where the block runs, or a "
    "path; a relative path starts at the home folder of the account the block runs as. "
    "Empty runs 'helm' from the PATH"
)
_CLEANUP_TIMEOUT_DESCRIPTION = (
    "How long helm may take to undo a failed operation, in seconds, on top of the "
    "block's own timeout. Applies only with atomic or cleanup_on_fail. Default: 300."
)
_STATUS_DESCRIPTION = "The release status helm reported, like deployed or failed"
_REPO_DESCRIPTION = (
    "Chart repository URL to pull the chart from (--repo); empty uses the chart reference as given"
)
_SET_DESCRIPTION = (
    "Individual values to override, one --set key=value per entry; a null value passes key=null"
)


def _helm_path_parameter(description: str) -> dict[str, Any]:
    """The executable row: which helm to run."""
    return {
        "name": "helm_path",
        "type": "string",
        "trim": True,
        "required": False,
        "description": description,
    }


def connection_parameters(
    timeout: int = DEFAULT_TIMEOUT, description: str | None = _TIMEOUT_DESCRIPTION
) -> list[dict[str, Any]]:
    """The K8s session and the timeout, the two rows every Helm block opens with."""
    return [session_parameter(), timeout_parameter(default=timeout, description=description)]


def release_parameter(description: str) -> dict[str, Any]:
    """The release name, the one positional every Helm block requires."""
    return {
        "name": "release",
        "type": "string",
        "trim": True,
        "required": True,
        "description": description,
    }


def chart_parameters(*, chart: str, version: str, values: str) -> list[dict[str, Any]]:
    """The chart source: what to deploy, from where, and with which values."""
    return [
        {
            "name": "chart",
            "type": "string",
            "trim": True,
            "required": True,
            "description": chart,
        },
        {
            "name": "version",
            "type": "string",
            "trim": True,
            "required": False,
            "description": version,
        },
        {
            "name": "repo",
            "type": "string",
            "trim": True,
            "required": False,
            "description": _REPO_DESCRIPTION,
        },
        {
            "name": "values",
            "type": "string",
            "required": False,
            "description": values,
        },
        {
            "name": "set",
            "type": "map",
            "required": False,
            "description": _SET_DESCRIPTION,
        },
    ]


def _local_chart(chart: str) -> str:
    """A relative local chart from the home folder; helm's rule: it exists or starts with a dot."""
    if not chart or "://" in chart or os.path.isabs(chart):
        return chart
    local = plain_path(chart)
    return str(local) if chart.startswith(".") or local.exists() else chart


def prepare(params: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Resolve a WAVE-side chart (file or folder) to an absolute path; nothing to mask."""
    chart = str(params.get("chart") or "").strip()
    if not has_plugin_scheme(chart):
        return {**params, "chart": _local_chart(chart)}, []
    resolved = resolve_plugin_path(
        chart, context.get("artifacts_dir"), context.get("testdata_dirs"), read_only_ok=True
    )
    return {**params, "chart": str(resolved)}, []


def auth_parameters() -> list[dict[str, Any]]:
    """Credentials and trust for the chart repository, not for the cluster."""
    return [
        {
            "name": "repo_username",
            "type": "string",
            "trim": True,
            "required": False,
            "description": "Username for the chart repository (--username)",
        },
        {
            "name": "repo_password",
            "type": "string",
            "required": False,
            "secret": True,
            "description": "Password for the chart repository (--password)",
        },
        {
            "name": "repo_ca_cert",
            "type": "string",
            "required": False,
            "description": (
                "The PEM bundle that verifies the chart repository's certificate; when set, it "
                "is the only certificate trusted. Empty trusts the certificates WAVE trusts "
                "(Settings > Network > Certificates)."
            ),
        },
        {
            "name": "repo_verify_ssl",
            "type": "boolean",
            "required": False,
            "default": True,
            "description": (
                "Verify the chart repository's server certificate; off sends "
                "--insecure-skip-tls-verify"
            ),
        },
    ]


def output_format_parameter(description: str = _OUTPUT_FORMAT_DESCRIPTION) -> dict[str, Any]:
    """Output Format, starting on the one-row table view."""
    return k8s_output_format_parameter(default="table", description=description)


def cleanup_timeout_parameter() -> dict[str, Any]:
    """The room helm gets to undo a failed write, on top of the block's own timeout."""
    return {
        "name": "cleanup_timeout",
        "type": "integer",
        "required": False,
        "default": CLEANUP_TIMEOUT,
        "description": _CLEANUP_TIMEOUT_DESCRIPTION,
    }


def tail_parameters(
    *,
    namespace: str,
    create_namespace: str | None = None,
    atomic: str | None = None,
    cleanup_on_fail: str | None = None,
) -> list[dict[str, Any]]:
    """The Advanced and Failure Handling tail every Helm block closes its rows with."""
    parameters = namespace_parameters(all_namespaces=False, description=namespace)
    if create_namespace is not None:
        parameters.append(toggle_parameter("create_namespace", create_namespace))
    parameters.append(_helm_path_parameter(_HELM_PATH_DESCRIPTION))
    parameters.extend(impersonation_parameters())
    if atomic is not None:
        parameters.append(toggle_parameter("atomic", atomic))
    if cleanup_on_fail is not None:
        parameters.append(toggle_parameter("cleanup_on_fail", cleanup_on_fail))
    if atomic is not None or cleanup_on_fail is not None:
        parameters.append(cleanup_timeout_parameter())
    parameters.append(on_error_parameter())
    return parameters


def result_output(description: str) -> dict[str, Any]:
    """Result: a table by default, following Output Format from there."""
    return {
        "name": "result",
        "type": "table",
        "description": description,
        "type_when": [
            {"when": [{"field": "output_format", "values": ["map"]}], "type": "map"},
            {
                "when": [{"field": "output_format", "values": ["json", "yaml"]}],
                "type": "string",
            },
        ],
    }


def _status_output(description: str = _STATUS_DESCRIPTION) -> dict[str, Any]:
    """The release status scalar a Wait Until block can poll."""
    return {
        "name": "status",
        "type": "string",
        "description": description,
    }


def release_outputs(result: str, status: str = _STATUS_DESCRIPTION) -> list[dict[str, Any]]:
    """Result, Status and the gated output core: the schema of the release-shaped blocks."""
    return [result_output(result), _status_output(status), *output_core(gated=True)]


def validate_common(
    params: dict[str, Any],
    parameters: list[dict[str, Any]],
    *,
    enums: Iterable[str] = _ENUM_PARAMS,
    required: Iterable[str] = ("release",),
    positive: Iterable[str] = ("timeout",),
) -> None:
    """The family checks in order: session, impersonation, enums, required rows, numbers."""
    require_session(params)
    require_impersonation_user(params)
    validate_enums(params, enums, parameters)
    for name in required:
        if not str(params.get(name) or "").strip():
            raise ValueError(f"Parameter '{name}' is required")
    for name in positive:
        require_positive(params, name)
