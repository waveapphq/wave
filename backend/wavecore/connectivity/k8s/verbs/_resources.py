"""Resource targeting for the K8s verbs (REQ-5.1.1, REQ-3.4.1.5).

Namespace resolution, the kind a block names, the impersonation keywords a
client takes, API path building with every segment percent-encoded, live
discovery of a kind the way kubectl's REST mapper does it, and the pod,
container and namespace one exec-channel call targets.
"""

import urllib.parse
from dataclasses import dataclass
from typing import Any

from ..rest import K8sClient, K8sDiscoveryDenied, K8sResource
from ._context import K8sContext, require_context
from ._errors import K8sReadRejected, discovery_miss_message, map_api_error

DEFAULT_TIMEOUT = 30


def resolve_namespace(
    params: dict[str, Any], context: K8sContext, *, named: bool = False
) -> str | None:
    """Pick the namespace a read targets: none, the explicit one, or the session default."""
    # A read by name lives in one namespace, so a stray all-namespaces tick is ignored.
    if params.get("all_namespaces") and not named:
        return None
    namespace = params.get("namespace")
    if isinstance(namespace, str) and namespace.strip():
        return namespace.strip()
    return context.namespace


def present(params: dict[str, Any], name: str) -> bool:
    """True when a string param is set and not blank."""
    value = params.get(name)
    return isinstance(value, str) and bool(value.strip())


def typed_kind(params: dict[str, Any]) -> str:
    """The kind a block targets: the custom text under resource_type custom, else kind."""
    if params.get("resource_type", "default") == "custom":
        return str(params["kind_custom"]).strip()
    return str(params["kind"]).strip()


def client_options(params: dict[str, Any]) -> dict[str, Any]:
    """The impersonation keywords a read hands to its K8s client."""
    return {
        "impersonate_user": params.get("impersonate_user") or None,
        "impersonate_groups": _split_groups(params.get("impersonate_groups")),
    }


def _split_groups(value: Any) -> list[str] | None:
    if not isinstance(value, str):
        return None
    groups = [group.strip() for group in value.split(",") if group.strip()]
    return groups or None


def resource_path(
    resource: K8sResource,
    namespace: str | None,
    name: str | None = None,
    query: dict[str, str] | None = None,
    *,
    subresource: str | None = None,
) -> str:
    """The API path of a resource collection or one named object, with an optional query."""
    segments = [resource.path_root]
    if resource.namespaced and namespace:
        segments.append(f"namespaces/{urllib.parse.quote(namespace, safe='')}")
    segments.append(resource.name)
    if name:
        segments.append(urllib.parse.quote(name, safe=""))
    if subresource:
        segments.append(subresource)
    path = "/".join(segments)
    if query:
        return f"{path}?{urllib.parse.urlencode(query)}"
    return path


def resolve_read_resource(
    client: K8sClient, kind: str, api_version: str | None = None
) -> K8sResource:
    """Resolve a kind through live discovery, the way kubectl's REST mapper does."""
    try:
        # A named API version narrows the lookup; otherwise discovery picks the preferred one.
        if api_version:
            resource = client.discover(kind, api_version)
        else:
            resource = client.discover(kind)
    except K8sDiscoveryDenied as exc:
        raise K8sReadRejected(
            map_api_error(exc.status, exc.body, kind, "", None, verb="list"),
            exc.body.get("reason"),
        ) from exc
    if resource is None:
        raise K8sReadRejected(discovery_miss_message(kind, api_version), "NotFound")
    return resource


@dataclass(frozen=True)
class PodExec:
    """What one exec-channel call targets, and how a failure row names it."""

    context: K8sContext
    namespace: str
    pod: str
    container: str
    timeout: int

    def where(self) -> str:
        """The 'pod X (container Y) in namespace Z' clause the exec failure rows carry."""
        return f"pod '{self.pod}' (container '{self.container}') in namespace '{self.namespace}'"


def pod_exec(params: dict[str, Any], default_timeout: int) -> PodExec:
    """The context, namespace, pod, container and timeout one exec call targets."""
    context = require_context(params)
    return PodExec(
        context,
        resolve_namespace(params, context, named=True) or context.namespace,
        str(params["pod"]).strip(),
        str(params["container"]).strip(),
        params.get("timeout", default_timeout),
    )
