"""The K8s Connect verb (REQ-5.1.1, REQ-4.6.3, REQ-4.5.5, REQ-3.4.1.5).

Connects to a Kubernetes cluster with explicit modeless credentials, verifies
the cluster runs Kubernetes 1.19 or newer via /version, optionally mints a run
token through the TokenRequest API, and emits the secret K8s Session plus the
raw cluster version. Connect always hard-fails: it has no success/error/reason
output core and no record mode.
"""

import dataclasses
import re
from collections.abc import Callable
from typing import Any

from wavecore.connectivity import tls_capabilities

from ..rest import K8sClient
from ._context import K8sContext, serialize_context

_VERSION_FLOOR = (1, 19)
_GIT_VERSION_PATTERN = re.compile(r"^v(\d+)\.(\d+)\.")


def _parse_major_minor(git_version: str) -> tuple[int, int]:
    match = _GIT_VERSION_PATTERN.match(git_version)
    if match is None:
        raise ValueError(f"unrecognized gitVersion '{git_version}'")
    return int(match.group(1)), int(match.group(2))


def _context_from_params(params: dict[str, Any]) -> K8sContext:
    tls_min = params.get("tls_min_version", "1.2")
    tls_max = params.get("tls_max_version", "1.3")
    ciphers = params.get("cipher_suites")
    if ciphers is None:
        # Unset resolves to the explicit effective list so the session is deterministic.
        ciphers = tls_capabilities.suites_for_range(tls_min, tls_max)
    return K8sContext(
        server=params["api_url"],
        ca_cert=params.get("ca_cert"),
        verify=params.get("verify_ssl", True),
        server_name=params.get("tls_server_name"),
        tls_min_version=tls_min,
        tls_max_version=tls_max,
        cipher_suites=ciphers,
        token=params.get("token"),
        client_cert=params.get("client_cert"),
        client_key=params.get("client_key"),
        namespace=params.get("namespace", "default"),
    )


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Version-check the cluster, optionally mint a run token, emit the session."""
    api_url = params["api_url"]
    k8s_context = _context_from_params(params)
    client = K8sClient(k8s_context, params.get("timeout", 30))

    try:
        version = client.server_version()
        major_minor = _parse_major_minor(version)
    except Exception as exc:
        raise ValueError(f"Could not read the Kubernetes version from {api_url}: {exc}") from exc
    if major_minor < _VERSION_FLOOR:
        raise ValueError(f"WAVE needs Kubernetes 1.19 or newer - this cluster reports {version}")
    log("INFO", f"Connected to Kubernetes {version} at {api_url}")

    if params.get("acquire_run_token", False):
        k8s_context = _with_run_token(client, params, k8s_context, log)

    return {
        "__wave_type": "result",
        "outputs": {"session": serialize_context(k8s_context), "cluster_version": version},
        "secrets": [],
    }


def _with_run_token(
    client: K8sClient,
    params: dict[str, Any],
    k8s_context: K8sContext,
    log: Callable[[str, str], None],
) -> K8sContext:
    """Mint the run token and swap it into the emitted session."""
    sa = params["run_token_service_account"]
    namespace = params.get("run_token_namespace", "default")
    duration = params.get("run_token_duration", 14400)
    try:
        minted, expiry = client.token_request(sa, namespace, duration)
    except Exception as exc:
        raise ValueError(
            f"Could not get a run token for service account '{sa}' "
            f"in namespace '{namespace}': {exc}"
        ) from exc
    # Servers may cap the requested duration; the granted expiry is the truth.
    log("INFO", f"Run token for service account '{sa}' granted until {expiry}")
    return K8sContext(**{**dataclasses.asdict(k8s_context), "token": minted})
