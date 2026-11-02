"""The K8s session a Connect block emits and every other block reads (REQ-5.1.1).

K8sContext is the parsed connection identity a K8s Connect block emits as its
secret session output - a kubectl-compatible JSON Config named 'wave'.
serialize_context and require_context are the emit/parse inverse pair.
"""

import base64
import json
from dataclasses import dataclass
from typing import Any

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)


@dataclass(frozen=True)
class K8sContext:
    """Connection identity for one cluster, as carried by a session value."""

    server: str
    ca_cert: str | None = None
    verify: bool = True
    server_name: str | None = None
    tls_min_version: str = "1.2"
    tls_max_version: str = "1.3"
    cipher_suites: list[str] | None = None
    token: str | None = None
    client_cert: str | None = None
    client_key: str | None = None
    namespace: str = "default"


def serialize_context(context: K8sContext) -> str:
    """Render the context as a kubectl-compatible JSON Config named 'wave'."""
    cluster: dict[str, Any] = {"server": context.server}
    if context.ca_cert:
        cluster["certificate-authority-data"] = _encode(context.ca_cert)
    if context.server_name:
        cluster["tls-server-name"] = context.server_name
    if not context.verify:
        cluster["insecure-skip-tls-verify"] = True
    # TLS constraints ride one cluster extension so the value stays kubectl-loadable.
    cluster["extensions"] = [
        {
            "name": "wave",
            "extension": {
                "tls_min_version": context.tls_min_version,
                "tls_max_version": context.tls_max_version,
                "cipher_suites": context.cipher_suites,
            },
        }
    ]
    user: dict[str, Any] = {}
    if context.token:
        user["token"] = context.token
    if context.client_cert and context.client_key:
        user["client-certificate-data"] = _encode(context.client_cert)
        user["client-key-data"] = _encode(context.client_key)
    return json.dumps(
        {
            "apiVersion": "v1",
            "kind": "Config",
            "clusters": [{"name": "wave", "cluster": cluster}],
            "users": [{"name": "wave", "user": user}],
            "contexts": [
                {
                    "name": "wave",
                    "context": {
                        "cluster": "wave",
                        "user": "wave",
                        "namespace": context.namespace,
                    },
                }
            ],
            "current-context": "wave",
        }
    )


def require_context(params: dict[str, Any]) -> K8sContext:
    """Parse the 'session' param into a K8sContext; reject anything unreadable."""
    session = params.get("session")
    if not isinstance(session, str):
        raise ValueError(_SESSION_MESSAGE)
    try:
        return _parse_config(json.loads(session))
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ValueError(_SESSION_MESSAGE) from exc


def _parse_config(config: Any) -> K8sContext:
    if config["kind"] != "Config":
        raise ValueError(_SESSION_MESSAGE)
    cluster = config["clusters"][0]["cluster"]
    user = config["users"][0]["user"]
    context = config["contexts"][0]["context"]
    server = cluster["server"]
    if not isinstance(server, str):
        raise ValueError(_SESSION_MESSAGE)
    constraints = _wave_extension(cluster)
    return K8sContext(
        server=server,
        ca_cert=_decode(cluster.get("certificate-authority-data")),
        verify=not cluster.get("insecure-skip-tls-verify", False),
        server_name=cluster.get("tls-server-name"),
        tls_min_version=constraints.get("tls_min_version", "1.2"),
        tls_max_version=constraints.get("tls_max_version", "1.3"),
        cipher_suites=constraints.get("cipher_suites"),
        token=user.get("token"),
        client_cert=_decode(user.get("client-certificate-data")),
        client_key=_decode(user.get("client-key-data")),
        namespace=context.get("namespace", "default"),
    )


def _wave_extension(cluster: dict[str, Any]) -> dict[str, Any]:
    matches: list[dict[str, Any]] = [
        entry["extension"] for entry in cluster.get("extensions", []) if entry["name"] == "wave"
    ]
    return matches[0] if matches else {}


def _encode(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _decode(value: str | None) -> str | None:
    return base64.b64decode(value).decode() if value else None
