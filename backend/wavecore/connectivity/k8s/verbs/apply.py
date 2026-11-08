"""The K8s Apply verb (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

Writes Kubernetes objects from a hand-typed manifest or from a short form for
ConfigMap, Secret and Job. Update brings each object to match with a
server-side apply patch; Fail creates it and surfaces the cluster's own
already-exists answer. A multi-document manifest applies in order and never
rolls back, so a partial failure reports what landed. Every value written to
a Secret rides the envelope's secrets list, as typed and as the cluster
encodes it back. Carries the family output core and the fail-or-record
Failure Handling control.
"""

import json
from collections.abc import Callable
from typing import Any

from wavecore.connectivity.block_outputs import block_failure, block_success, summary_table

from ..rest import K8sClient, K8sResource
from ._context import K8sContext, require_context
from ._errors import K8sReadRejected, map_api_error
from ._manifest import parse_manifest, secret_values, synthesize_manifest
from ._outputs import object_names, type_name
from ._resources import (
    DEFAULT_TIMEOUT,
    client_options,
    resolve_namespace,
    resolve_read_resource,
    resource_path,
)

_APPLY_CONTENT_TYPE = "application/apply-patch+yaml"
_APPLY_QUERY = {"fieldManager": "wave", "force": "true"}
# kubectl's own default; a cluster too old to know the parameter ignores it.
_CREATE_QUERY = {"fieldManager": "wave", "fieldValidation": "Strict"}
_SUMMARY_COLUMNS: list[tuple[str, str]] = [("RESOURCE", "string"), ("OUTCOME", "string")]
_TEXT_FORMATS = ("json", "yaml")


def job_from_cronjob(params: dict[str, Any]) -> bool:
    """True when the form builds a Job from an existing CronJob's template."""
    return params.get("kind") == "Job" and params.get("job_from", "image") == "cronjob"


def job_from_image(params: dict[str, Any]) -> bool:
    """True when the form builds a Job that runs a named image."""
    return params.get("kind") == "Job" and params.get("job_from", "image") == "image"


def _form_from_cronjob(params: dict[str, Any]) -> bool:
    return params.get("define_with", "manifest") == "form" and job_from_cronjob(params)


def _form_document(params: dict[str, Any]) -> dict[str, Any]:
    """The Secret form carries its values on their own wire name, which the log line masks."""
    if params.get("kind") == "Secret":
        return synthesize_manifest({**params, "data": params.get("secret_data")})
    return synthesize_manifest(params)


def given_documents(params: dict[str, Any]) -> list[dict[str, Any]]:
    """The objects the block spells out itself: every manifest document, or the form's one.

    A Job built from a CronJob is copied from the cluster instead, so it is not listed.
    """
    if _form_from_cronjob(params):
        return []
    if params.get("define_with", "manifest") != "form":
        return parse_manifest(str(params["manifest"]))
    return [_form_document(params)]


def _result_value(params: dict[str, Any], applied: list[dict[str, Any]]) -> Any:
    """The 'result' value: the object, the list of objects, or either as text."""
    output_format = params.get("output_format", "map")
    listed = params.get("define_with", "manifest") != "form"
    if not applied:
        if output_format in _TEXT_FORMATS:
            return ""
        return [] if listed else {}
    value: Any = applied if listed else applied[0]
    if output_format == "json":
        return json.dumps(value)
    if output_format == "yaml":
        return {"__wave_type": "yaml", "value": value}
    return value


def _outputs(
    params: dict[str, Any], applied: list[dict[str, Any]], rows: list[list[Any]]
) -> dict[str, Any]:
    return {
        "summary": summary_table(_SUMMARY_COLUMNS, rows),
        "result": _result_value(params, applied),
        "names": object_names(applied),
        "count": len(applied),
    }


def _envelope(outputs: dict[str, Any], secrets: list[Any]) -> dict[str, Any]:
    return {"__wave_type": "result", "outputs": outputs, "secrets": secrets}


def _document_namespace(
    params: dict[str, Any], k8s_context: K8sContext, document: dict[str, Any]
) -> str | None:
    own = (document.get("metadata") or {}).get("namespace")
    if isinstance(own, str) and own.strip():
        return own.strip()
    return resolve_namespace(params, k8s_context)


def _rejected(
    status: int,
    parsed: dict[str, Any],
    resource: K8sResource,
    name: str,
    namespace: str | None,
    verb: str,
) -> K8sReadRejected:
    message = map_api_error(status, parsed, resource.kind, name, namespace, verb=verb)
    return K8sReadRejected(message, parsed.get("reason"))


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Apply every document in order, summarizing what landed."""
    k8s_context = require_context(params)
    client = K8sClient(
        k8s_context, params.get("timeout", DEFAULT_TIMEOUT), **client_options(params)
    )
    applied: list[dict[str, Any]] = []
    rows: list[list[Any]] = []
    secrets: list[Any] = []
    try:
        documents = _documents(client, k8s_context, params)
        secrets.extend(secret_values(documents))
        for document in documents:
            obj, row = _apply_document(client, k8s_context, params, document)
            applied.append(obj)
            rows.append(row)
            # The gate is the kind the request carried; the cluster echoes the encoded values.
            if document.get("kind") == "Secret":
                secrets.extend(secret_values([obj]))
            for warning in client.last_warnings:
                log("WARN", f"Cluster warning: {warning}")
    except K8sReadRejected as exc:
        outputs = block_failure(
            params, _outputs(params, applied, rows), exc.message, exc.reason, log, action="Apply"
        )
        return _envelope(outputs, secrets)
    log("INFO", f"Applied {len(applied)} object(s)")
    return _envelope(block_success(_outputs(params, applied, rows)), secrets)


def _documents(
    client: K8sClient, k8s_context: K8sContext, params: dict[str, Any]
) -> list[dict[str, Any]]:
    """The objects to apply: what the block spells out, or the Job a CronJob template describes."""
    if _form_from_cronjob(params):
        return [
            {
                "apiVersion": "batch/v1",
                "kind": "Job",
                "metadata": {"name": str(params.get("name", ""))},
                "spec": _cronjob_spec(client, k8s_context, params),
            }
        ]
    return given_documents(params)


def _cronjob_spec(
    client: K8sClient, k8s_context: K8sContext, params: dict[str, Any]
) -> dict[str, Any]:
    """The job template a named CronJob carries, which becomes the Job's own spec."""
    resource = resolve_read_resource(client, "CronJob")
    namespace = resolve_namespace(params, k8s_context) if resource.namespaced else None
    name = str(params["cronjob_name"]).strip()
    path = resource_path(resource, namespace, name)
    status, parsed = client.request("GET", path, None)
    if status >= 400:
        raise _rejected(status, parsed, resource, name, namespace, "read")
    return dict((parsed.get("spec", {}).get("jobTemplate", {})).get("spec", {}))


def _apply_document(
    client: K8sClient,
    k8s_context: K8sContext,
    params: dict[str, Any],
    document: dict[str, Any],
) -> tuple[dict[str, Any], list[Any]]:
    """Write one object and report the object the cluster answered with, plus its row."""
    api_version = str(document["apiVersion"])
    resource = resolve_read_resource(client, str(document["kind"]), api_version)
    namespace = _document_namespace(params, k8s_context, document) if resource.namespaced else None
    name = str((document.get("metadata") or {}).get("name", ""))
    if params.get("if_exists", "update") == "fail":
        path = resource_path(resource, namespace, query=dict(_CREATE_QUERY))
        status, parsed = client.request("POST", path, document)
    else:
        path = resource_path(resource, namespace, name, dict(_APPLY_QUERY))
        status, parsed = client.request("PATCH", path, document, content_type=_APPLY_CONTENT_TYPE)
    if status >= 400:
        raise _rejected(status, parsed, resource, name, namespace, "apply")
    outcome = "created" if status == 201 else "configured"
    applied_name = str((parsed.get("metadata") or {}).get("name", ""))
    return parsed, [type_name(resource, applied_name), outcome]
