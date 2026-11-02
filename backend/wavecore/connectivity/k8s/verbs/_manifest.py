"""Manifest helpers for the K8s write verbs (REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5).

The engine hands a verb its manifest as canonical JSON, so parse_manifest reads
JSON only and vets every document before anything reaches the cluster.
synthesize_manifest builds the one object the Apply form describes,
split_command turns a typed command line into an argument list, and
secret_values lists every value a Secret document carries, plaintext and
base64 alike, so the run can mask it.
"""

import base64
import json
import shlex
from contextlib import suppress
from typing import Any

_MANIFEST_KIND_MESSAGE = "Parameter 'manifest' must include 'apiVersion' and 'kind'"
_MANIFEST_NAME_MESSAGE = "Parameter 'manifest' must include 'metadata.name'"


def parse_manifest(text: str) -> list[dict[str, Any]]:
    """The objects a canonical JSON manifest declares: one object, or an array of them."""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Parameter 'manifest' is not valid YAML or JSON: {exc}") from exc
    documents = parsed if isinstance(parsed, list) else [parsed]
    if not documents:
        raise ValueError(_MANIFEST_KIND_MESSAGE)
    return [_vetted_document(document) for document in documents]


def _vetted_document(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict) or not _filled(document, "apiVersion", "kind"):
        raise ValueError(_MANIFEST_KIND_MESSAGE)
    metadata = document.get("metadata")
    name = metadata.get("name", "") if isinstance(metadata, dict) else ""
    if not isinstance(name, str) or not name.strip():
        raise ValueError(_MANIFEST_NAME_MESSAGE)
    return document


def _filled(document: dict[str, Any], *keys: str) -> bool:
    """A manifest key counts as given only when it holds text; blank or null does not."""
    return all(isinstance(document.get(key), str) and document[key].strip() for key in keys)


def synthesize_manifest(params: dict[str, Any]) -> dict[str, Any]:
    """The one object the Apply form describes, per kind."""
    name = str(params.get("name", ""))
    data = dict(params.get("data") or {})
    if params.get("kind") == "Secret":
        return _secret_object(name, data, params.get("secret_type"))
    if params.get("kind") == "Job":
        return _job_object(name, params)
    return {"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": name}, "data": data}


def _secret_object(name: str, data: dict[str, Any], secret_type: Any) -> dict[str, Any]:
    """WAVE writes plaintext to stringData and lets the cluster do the base64."""
    obj: dict[str, Any] = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": name},
        "stringData": data,
    }
    if secret_type:
        obj["type"] = secret_type
    return obj


def _job_object(name: str, params: dict[str, Any]) -> dict[str, Any]:
    container: dict[str, Any] = {"name": name, "image": params.get("image", "")}
    command = split_command(str(params.get("command") or ""))
    if command:
        container["command"] = command
    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {"name": name},
        "spec": {"template": {"spec": {"containers": [container], "restartPolicy": "Never"}}},
    }


def split_command(text: str, *, name: str = "command") -> list[str]:
    """The argument list a typed command line describes."""
    try:
        return shlex.split(text)
    except ValueError as exc:
        raise ValueError(f"Parameter '{name}' has an unclosed quote") from exc


def secret_values(documents: list[dict[str, Any]]) -> list[Any]:
    """Every value the Secret documents carry, plaintext and base64 alike, for masking."""
    values: list[Any] = []
    for document in documents:
        if document.get("kind") != "Secret":
            continue
        for plaintext in (document.get("stringData") or {}).values():
            values.append(plaintext)
            if isinstance(plaintext, str):
                values.append(base64.b64encode(plaintext.encode()).decode())
        for encoded in (document.get("data") or {}).values():
            values.append(encoded)
            with suppress(ValueError, TypeError):
                values.append(base64.b64decode(encoded, validate=True).decode())
    return values
