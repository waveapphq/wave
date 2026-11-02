"""K8s Connect Plugin (REQ-5.1.1, REQ-4.6.3, REQ-4.5.5, REQ-3.4.1.5).

Connects to a Kubernetes cluster with explicit modeless credentials,
verifies the cluster runs Kubernetes 1.19 or newer via /version, optionally
mints a run token through the TokenRequest API, and emits the secret
K8s Session plus the raw cluster version. Connect always hard-fails: it has
no success/error/reason output core and no Failure Handling section.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import connect
from wavecore.connectivity.web_address import (
    HOST,
    PORT,
    SCHEME,
    WebAddressError,
    parse_web_address,
    typed_reason,
)
from wavecore.core.execution.plugin_executor import check_entry_nulls
from wavecore.plugins._executor_base import validate_enum_from_schema
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase

_TLS_VERSION_CHOICES = ["1.0", "1.1", "1.2", "1.3"]
_VALUE_DISPLAY_LIMIT = 50
_API_URL_REFUSALS = {
    SCHEME: "must start with http:// or https://",
    HOST: "needs a host",
    PORT: "port must be between 1 and 65535",
}


def _shown(value: str) -> str:
    """Quote a value up to 50 chars, else show only its length (value-scrub rule)."""
    if len(value) > _VALUE_DISPLAY_LIMIT:
        return f"a {len(value)}-character value"
    return f"'{value}'"


def _check_api_url(api_url: str) -> None:
    """Refuse an address with no http or https scheme, no host or a port no connection can use."""
    try:
        parse_web_address(api_url)
    except WebAddressError as error:
        refusal = _API_URL_REFUSALS[typed_reason(api_url, error)]
        raise ValueError(f"Parameter 'api_url' {refusal} (got {_shown(api_url)})") from error


class K8sConnectPlugin(PluginBase):
    """Produces the K8s Session every operational Kubernetes block rides."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-connect",
            "name": "K8s Connect",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Connects to a Kubernetes cluster: verifies the API server is "
                "reachable and runs Kubernetes 1.19 or newer, optionally mints a "
                "short-lived service-account run token, and emits the K8s Session "
                "the downstream Kubernetes blocks consume."
            ),
            "parameters": [
                {
                    "name": "api_url",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": (
                        "Full base URL of the Kubernetes API server: http or https, "
                        "any port, optional path prefix for gateway-mounted clusters "
                        "(e.g. http://srv:12345/k8s/clusters/c-1)"
                    ),
                },
                {
                    "name": "namespace",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "default",
                    "description": (
                        "Default namespace carried in the session for the downstream "
                        "K8s blocks. Default: 'default'."
                    ),
                },
                {
                    "name": "timeout",
                    "type": "integer",
                    "required": False,
                    "default": 30,
                    "description": "Request timeout in seconds. Default: 30.",
                },
                {
                    "name": "token",
                    "type": "string",
                    "required": False,
                    "secret": True,
                    "description": (
                        "Bearer token WAVE presents to the cluster; optional - leave "
                        "empty for certificate-only, anonymous, or proxied access"
                    ),
                },
                {
                    "name": "acquire_run_token",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Mint a short-lived service-account token via the TokenRequest "
                        "API and carry it in the session instead of the connection "
                        "credential. Default: off."
                    ),
                },
                {
                    "name": "run_token_service_account",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": (
                        "Service account the run token is minted for (used when "
                        "'Get SA Token' is on)"
                    ),
                },
                {
                    "name": "run_token_namespace",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "default",
                    "description": "Namespace of the service account. Default: 'default'.",
                },
                {
                    "name": "run_token_duration",
                    "type": "integer",
                    "required": False,
                    "default": 14400,
                    "description": (
                        "Requested token lifetime in seconds; the cluster may grant "
                        "less. Minimum: 600. Default: 14400."
                    ),
                },
                {
                    "name": "verify_ssl",
                    "type": "boolean",
                    "required": False,
                    "default": True,
                    "description": (
                        "Verify the server certificate: against CA Certificate when it is set, "
                        "otherwise against the certificates WAVE trusts "
                        "(Settings > Network > Certificates)"
                    ),
                },
                {
                    "name": "ca_cert",
                    "type": "string",
                    "required": False,
                    "description": (
                        "CA certificate (variable reference or PEM string); when set, it is the "
                        "only certificate this block trusts"
                    ),
                },
                {
                    "name": "tls_server_name",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "description": (
                        "Hostname used for SNI and certificate verification when "
                        "connecting through a tunnel or by IP address"
                    ),
                },
                {
                    "name": "client_cert",
                    "type": "string",
                    "required": False,
                    "description": (
                        "Client certificate (PEM) for mutual TLS; supplied together "
                        "with 'client_key'"
                    ),
                },
                {
                    "name": "client_key",
                    "type": "string",
                    "required": False,
                    "secret": True,
                    "description": (
                        "Client private key (PEM) for mutual TLS; supplied together "
                        "with 'client_cert'"
                    ),
                },
                {
                    "name": "tls_min_version",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "1.2",
                    "enum_values": _TLS_VERSION_CHOICES,
                    "description": "Lowest TLS protocol version offered to the server",
                },
                {
                    "name": "tls_max_version",
                    "type": "string",
                    "trim": True,
                    "required": False,
                    "default": "1.3",
                    "enum_values": _TLS_VERSION_CHOICES,
                    "description": "Highest TLS protocol version offered to the server",
                },
                {
                    "name": "cipher_suites",
                    "type": "array",
                    "required": False,
                    "description": (
                        "Cipher suites offered to the server, in client preference "
                        "order per protocol family. Unset offers every suite WAVE "
                        "supports for the selected TLS version range; an empty "
                        "selection offers no ciphers. The K8s Session always "
                        "carries the exact suites offered. OpenSSL and IANA names "
                        "accepted; a null entry fails the run."
                    ),
                },
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "session",
                    "type": "string",
                    "secret": True,
                    "description": (
                        "K8s Session: a kubectl-compatible kubeconfig carrying the "
                        "server, trust settings, credentials, and default namespace"
                    ),
                },
                {
                    "name": "cluster_version",
                    "type": "string",
                    "description": "Kubernetes version the cluster reports, e.g. 'v1.33.0'",
                },
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "session", "connection"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate required params, the URL scheme, the cert pair, ranges, enums."""
        api_url = params.get("api_url")
        if not api_url:
            raise ValueError("Missing required parameter: api_url")
        _check_api_url(api_url)
        if bool(params.get("client_cert")) != bool(params.get("client_key")):
            raise ValueError("Parameters 'client_cert' and 'client_key' must be supplied together")
        if params.get("acquire_run_token"):
            if not params.get("run_token_service_account"):
                raise ValueError("Missing required parameter: run_token_service_account")
            if params.get("run_token_duration", 14400) < 600:
                raise ValueError("Parameter 'run_token_duration' must be at least 600")
        if "timeout" in params and params["timeout"] <= 0:
            raise ValueError("Parameter 'timeout' must be positive")
        if "tls_min_version" in params:
            validate_enum_from_schema(
                "tls_min_version", params["tls_min_version"], self.metadata["parameters"]
            )
        if "tls_max_version" in params:
            validate_enum_from_schema(
                "tls_max_version", params["tls_max_version"], self.metadata["parameters"]
            )
        check_entry_nulls("cipher_suites", params.get("cipher_suites"))

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Version-check the cluster, optionally mint a run token, emit the session."""
        return await run_verb(connect.run, context["parameters"], context)
