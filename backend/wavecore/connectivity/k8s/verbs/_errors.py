"""The K8s family's shared error-message rows (REQ-5.1.1, REQ-4.5.5).

map_api_error renders one message for any Kubernetes API error response,
discovery_miss_message names a kind the cluster does not serve, and
K8sReadRejected carries a rendered message and the cluster reason to the
on_error dispatch.
"""

import json
from contextlib import suppress
from typing import Any

_TYPED_PATCH_PREFIX = "failed to create typed patch object"


def map_api_error(
    status: int, body: dict[str, Any], kind: str, name: str, ns: str | None, *, verb: str
) -> str:
    """Render the shared K8s API error-message row for an error response."""
    message = body.get("message", "")
    details = body.get("details", {})
    scope = f" in namespace '{ns}'" if ns else ""
    target = f"{verb} {kind} '{name}'" if name else f"{verb} {kind} objects"
    if status == 404 and details.get("kind") == "namespaces":
        return f"K8s namespace '{details.get('name') or ns or ''}' not found"
    if status == 404 and name:
        return f"K8s {kind} '{name}' not found{scope}"
    if body.get("reason") == "AlreadyExists":
        return f"K8s {kind} '{name}' already exists{scope}"
    if message.startswith(_TYPED_PATCH_PREFIX):
        return f"Kubernetes rejected the manifest: {_manifest_rejection_detail(message)}"
    # A row that carries the cluster's text is only chosen when there is text to carry.
    if not message:
        return f"Kubernetes could not {target}{scope} (HTTP {status})"
    if status == 401:
        return f"Kubernetes API authentication failed: {message}"
    if status == 403:
        return f"Kubernetes API permission denied: {message}"
    if body.get("reason") == "Conflict":
        return (
            f"Kubernetes rejected the update to {kind} '{name}' "
            f"because it changed on the cluster first: {message}"
        )
    return f"Kubernetes could not {target}{scope}: {message}"


def _manifest_rejection_detail(message: str) -> str:
    """The apiserver ends its parenthesized object reference before the field path."""
    _reference, marker, detail = message.partition("): ")
    return detail.strip() if marker else message


def decode_status(payload: bytes) -> dict[str, Any]:
    """Parse a raw error body into its Status object; {} when it is not a JSON object."""
    decoded: Any = None
    with suppress(ValueError):
        decoded = json.loads(payload)
    return decoded if isinstance(decoded, dict) else {}


def discovery_miss_message(kind: str, api_version: str | None = None) -> str:
    """The message for a kind the cluster does not serve."""
    version = f" in API version '{api_version}'" if api_version else ""
    return (
        f"This cluster has no resource kind '{kind}'{version} "
        "- check the spelling, or whether the CRD is installed"
    )


class K8sReadRejected(Exception):
    """A cluster answer that the on_error dispatch turns into a recorded failure."""

    def __init__(self, message: str, reason: str | None) -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason
