"""K8s Connect plugin tests (REQ-5.1.1, REQ-4.6.3, REQ-4.5.5, REQ-3.4.1.5).

Connect takes explicit modeless credentials (K8SCON-1), verifies the cluster
is Kubernetes 1.19+ via /version, optionally mints a run token through the
TokenRequest API, and emits a secret kubectl-compatible JSON Config session
named "wave" plus the raw cluster version. It always hard-fails: there is no
success/error/reason output core and no Failure Handling section.
"""

import base64
import json
import re
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from wavecore.connectivity import tls_capabilities
from wavecore.core.expressions.errors import NullValueError
from wavecore.plugins.k8s_connect import K8sConnectPlugin

EXPECTED_PARAM_ORDER = [
    "api_url",
    "namespace",
    "timeout",
    "token",
    "acquire_run_token",
    "run_token_service_account",
    "run_token_namespace",
    "run_token_duration",
    "verify_ssl",
    "ca_cert",
    "tls_server_name",
    "client_cert",
    "client_key",
    "tls_min_version",
    "tls_max_version",
    "cipher_suites",
]

_TRUST_DESCRIPTIONS = {
    "verify_ssl": (
        "Verify the server certificate: against CA Certificate when it is set, otherwise "
        "against the certificates WAVE trusts (Settings > Network > Certificates)"
    ),
    "ca_cert": (
        "CA certificate (variable reference or PEM string); when set, it is the "
        "only certificate this block trusts"
    ),
}

_CLIENT_TARGET = "wavecore.connectivity.k8s.verbs.connect.K8sClient"
_API_URL = "https://k8s.example:6443"

# Engine catalog suites for TLS 1.0-1.2, catalog preference order.
_LEGACY_CIPHERS = [
    "ECDHE-ECDSA-AES256-GCM-SHA384",
    "ECDHE-RSA-AES256-GCM-SHA384",
    "ECDHE-ECDSA-AES128-GCM-SHA256",
    "ECDHE-RSA-AES128-GCM-SHA256",
    "ECDHE-ECDSA-CHACHA20-POLY1305",
    "ECDHE-RSA-CHACHA20-POLY1305",
    "DHE-RSA-AES256-GCM-SHA384",
    "DHE-RSA-AES128-GCM-SHA256",
    "DHE-RSA-CHACHA20-POLY1305",
    "ECDHE-ECDSA-AES256-SHA384",
    "ECDHE-RSA-AES256-SHA384",
    "ECDHE-ECDSA-AES128-SHA256",
    "ECDHE-RSA-AES128-SHA256",
    "DHE-RSA-AES256-SHA256",
    "DHE-RSA-AES128-SHA256",
    "ECDHE-ECDSA-AES256-SHA",
    "ECDHE-RSA-AES256-SHA",
    "ECDHE-ECDSA-AES128-SHA",
    "ECDHE-RSA-AES128-SHA",
    "DHE-RSA-AES256-SHA",
    "DHE-RSA-AES128-SHA",
]
_TLS13_CIPHERS = [
    "TLS_AES_128_GCM_SHA256",
    "TLS_AES_256_GCM_SHA384",
    "TLS_CHACHA20_POLY1305_SHA256",
]
# The effective list Connect records for the default 1.2-1.3 range.
_DEFAULT_RANGE_CIPHERS = _LEGACY_CIPHERS + _TLS13_CIPHERS
_CA_PEM = "-----BEGIN CERTIFICATE-----\nZmFrZS1jYS1wZW0=\n-----END CERTIFICATE-----\n"
_CERT_PEM = "-----BEGIN CERTIFICATE-----\nZmFrZS1jbGllbnQ=\n-----END CERTIFICATE-----\n"
_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nZmFrZS1rZXk=\n-----END PRIVATE KEY-----\n"


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _params_by_name(plugin: K8sConnectPlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


def _outputs_by_name(plugin: K8sConnectPlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


def _valid_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {"api_url": _API_URL}
    params.update(overrides)
    return params


def _client_mock(
    version: str = "v1.33.0",
    granted: tuple[str, str] = ("minted-token", "2026-08-19T15:00:00Z"),
) -> MagicMock:
    client_cls = MagicMock()
    client_cls.return_value.server_version.return_value = version
    client_cls.return_value.token_request.return_value = granted
    return client_cls


def _context(parameters: dict[str, Any], logger: Any = None) -> dict[str, Any]:
    return {"parameters": parameters, "logger": logger or MagicMock(), "variables": {}}


async def _execute(
    params: dict[str, Any], client_cls: MagicMock | None = None, logger: Any = None
) -> Any:
    cls = client_cls if client_cls is not None else _client_mock()
    with patch(_CLIENT_TARGET, cls):
        return await K8sConnectPlugin().execute(_context(params, logger))


def _session_config(result: Any) -> dict[str, Any]:
    config: dict[str, Any] = json.loads(result["session"])
    return config


def _cluster(result: Any) -> dict[str, Any]:
    cluster: dict[str, Any] = _session_config(result)["clusters"][0]["cluster"]
    return cluster


def _user(result: Any) -> dict[str, Any]:
    user: dict[str, Any] = _session_config(result)["users"][0]["user"]
    return user


class TestMetadata:
    """Plugin identity, parameter set, and output schema."""

    def test_plugin_instantiates(self) -> None:
        assert K8sConnectPlugin() is not None

    def test_identity(self) -> None:
        meta = K8sConnectPlugin().metadata

        assert meta["id"] == "k8s-connect"
        assert meta["name"] == "K8s Connect"
        assert meta["category"] == "kubernetes"
        assert meta["version"] == "1.0.0"
        assert meta["return_type"] == "map"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sConnectPlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_remotable_is_true(self) -> None:
        assert K8sConnectPlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sConnectPlugin().metadata["proxy_support"] == "supported"

    def test_required_flags(self) -> None:
        params = _params_by_name(K8sConnectPlugin())

        assert params["api_url"]["required"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "api_url":
                continue
            assert params[name].get("required") is False

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sConnectPlugin())

        assert params["api_url"]["type"] == "string"
        assert params["namespace"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["token"]["type"] == "string"
        assert params["acquire_run_token"]["type"] == "boolean"
        assert params["run_token_service_account"]["type"] == "string"
        assert params["run_token_namespace"]["type"] == "string"
        assert params["run_token_duration"]["type"] == "integer"
        assert params["verify_ssl"]["type"] == "boolean"
        assert params["ca_cert"]["type"] == "string"
        assert params["tls_server_name"]["type"] == "string"
        assert params["client_cert"]["type"] == "string"
        assert params["client_key"]["type"] == "string"
        assert params["tls_min_version"]["type"] == "string"
        assert params["tls_max_version"]["type"] == "string"
        assert params["cipher_suites"]["type"] == "array"

    def test_defaults(self) -> None:
        params = _params_by_name(K8sConnectPlugin())

        assert params["namespace"]["default"] == "default"
        assert params["timeout"]["default"] == 30
        assert params["acquire_run_token"]["default"] is False
        assert params["run_token_namespace"]["default"] == "default"
        assert params["run_token_duration"]["default"] == 14400
        assert params["verify_ssl"]["default"] is True
        assert params["tls_min_version"]["default"] == "1.2"
        assert params["tls_max_version"]["default"] == "1.3"

    def test_secret_flags(self) -> None:
        params = _params_by_name(K8sConnectPlugin())

        assert params["token"]["secret"] is True
        assert params["client_key"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name in ("token", "client_key"):
                continue
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(K8sConnectPlugin())

        for name in (
            "api_url",
            "namespace",
            "tls_server_name",
            "run_token_service_account",
            "run_token_namespace",
            "tls_min_version",
            "tls_max_version",
        ):
            assert params[name]["trim"] is True

    def test_secret_params_do_not_trim(self) -> None:
        params = _params_by_name(K8sConnectPlugin())

        for name in ("token", "client_key"):
            assert params[name].get("trim", False) is False

    def test_tls_version_enums(self) -> None:
        params = _params_by_name(K8sConnectPlugin())

        assert params["tls_min_version"]["enum_values"] == ["1.0", "1.1", "1.2", "1.3"]
        assert params["tls_max_version"]["enum_values"] == ["1.0", "1.1", "1.2", "1.3"]

    def test_modeless_credentials_have_no_auth_mode(self) -> None:
        params = _params_by_name(K8sConnectPlugin())

        assert "auth_mode" not in params
        enum_params = {name for name, param in params.items() if "enum_values" in param}
        assert enum_params == {"tls_min_version", "tls_max_version"}

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sConnectPlugin().metadata["parameters"]:
            assert param.get("description")

    @pytest.mark.parametrize(("name", "description"), list(_TRUST_DESCRIPTIONS.items()))
    def test_the_trust_rows_state_the_trust_rule(self, name: str, description: str) -> None:
        """REQ-4.5.16."""
        assert _params_by_name(K8sConnectPlugin())[name]["description"] == description

    def test_output_schema(self) -> None:
        outputs = K8sConnectPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("session", "string"),
            ("cluster_version", "string"),
        ]

    def test_session_output_is_secret_flagged(self) -> None:
        outputs = _outputs_by_name(K8sConnectPlugin())

        assert outputs["session"]["secret"] is True
        assert outputs["cluster_version"].get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sConnectPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_no_success_error_reason_output_core(self) -> None:
        names = [o["name"] for o in K8sConnectPlugin().metadata["output_schema"]]

        assert names == ["session", "cluster_version"]
        assert "success" not in names
        assert "error" not in names
        assert "reason" not in names


class TestValidation:
    """validate() - required params, scheme rule, cert pair, ranges, enums."""

    async def test_minimal_params_pass(self) -> None:
        await K8sConnectPlugin().validate(_valid_params())

    async def test_full_params_pass(self) -> None:
        await K8sConnectPlugin().validate(
            _valid_params(
                namespace="apps",
                timeout=45,
                token="sa-tok",
                verify_ssl=True,
                ca_cert=_CA_PEM,
                tls_server_name="kwok-internal",
                client_cert=_CERT_PEM,
                client_key=_KEY_PEM,
                tls_min_version="1.0",
                tls_max_version="1.2",
                cipher_suites=["ECDHE-ECDSA-AES128-GCM-SHA256"],
                acquire_run_token=True,
                run_token_service_account="wave-tests",
                run_token_namespace="ops",
                run_token_duration=600,
            )
        )

    async def test_http_scheme_passes(self) -> None:
        await K8sConnectPlugin().validate({"api_url": "http://127.0.0.1:8001"})

    async def test_missing_api_url(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: api_url$"):
            await K8sConnectPlugin().validate({})

    async def test_empty_api_url_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: api_url$"):
            await K8sConnectPlugin().validate({"api_url": ""})

    async def test_bad_scheme_shows_the_quoted_value(self) -> None:
        message = "Parameter 'api_url' must start with http:// or https:// (got 'k8s.example:6443')"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": "k8s.example:6443"})

    async def test_ftp_scheme_is_rejected(self) -> None:
        message = (
            "Parameter 'api_url' must start with http:// or https:// (got 'ftp://k8s.example')"
        )

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": "ftp://k8s.example"})

    async def test_bad_scheme_at_50_chars_still_quotes_the_value(self) -> None:
        value = "x" * 50
        message = f"Parameter 'api_url' must start with http:// or https:// (got '{value}')"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": value})

    async def test_bad_scheme_beyond_50_chars_shows_only_the_length(self) -> None:
        value = "x" * 51
        message = (
            "Parameter 'api_url' must start with http:// or https:// " "(got a 51-character value)"
        )

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": value})

    @pytest.mark.parametrize(
        "api_url",
        ["HTTPS://k8s.internal:6443", "HTTP://k8s.internal:8001", "Https://k8s.internal"],
        ids=["https", "http", "mixed-case"],
    )
    async def test_a_scheme_in_capitals_passes(self, api_url: str) -> None:
        await K8sConnectPlugin().validate({"api_url": api_url})

    @pytest.mark.parametrize(
        "api_url",
        ["https://:6443", "https://wave@", "https://", "http://:8001", "HTTPS://:6443"],
        ids=[
            "port-without-host",
            "login-without-host",
            "scheme-only",
            "plain-http",
            "scheme-in-capitals",
        ],
    )
    async def test_an_address_with_no_host_shows_the_quoted_value(self, api_url: str) -> None:
        message = f"Parameter 'api_url' needs a host (got '{api_url}')"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": api_url})

    async def test_no_host_at_50_chars_still_quotes_the_value(self) -> None:
        value = "https://:6443/" + "x" * 36
        message = f"Parameter 'api_url' needs a host (got '{value}')"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": value})

    async def test_no_host_beyond_50_chars_shows_only_the_length(self) -> None:
        value = "https://:6443/" + "x" * 37
        message = "Parameter 'api_url' needs a host (got a 51-character value)"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": value})

    async def test_the_scheme_is_checked_before_the_host(self) -> None:
        message = "Parameter 'api_url' must start with http:// or https:// (got 'ftp://:6443')"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": "ftp://:6443"})

    @pytest.mark.parametrize(
        "api_url",
        ["https:/k8s.example", "https:k8s.example", "http:/k8s.example:8001", "HTTPS:k8s.example"],
        ids=["one-slash", "no-slash", "plain-http-one-slash", "capitals-no-slash"],
    )
    async def test_an_address_without_both_slashes_has_a_wrong_start(self, api_url: str) -> None:
        message = f"Parameter 'api_url' must start with http:// or https:// (got '{api_url}')"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": api_url})

    @pytest.mark.parametrize(
        "api_url",
        ["https://k8s.example:0", "https://k8s.example:99999", "https://k8s.example:abc"],
        ids=["zero", "far-above", "not-a-number"],
    )
    async def test_a_port_outside_1_to_65535_is_rejected(self, api_url: str) -> None:
        message = f"Parameter 'api_url' port must be between 1 and 65535 (got '{api_url}')"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate({"api_url": api_url})

    async def test_client_cert_without_key_is_rejected(self) -> None:
        message = "Parameters 'client_cert' and 'client_key' must be supplied together"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate(_valid_params(client_cert=_CERT_PEM))

    async def test_client_key_without_cert_is_rejected(self) -> None:
        message = "Parameters 'client_cert' and 'client_key' must be supplied together"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate(_valid_params(client_key=_KEY_PEM))

    async def test_empty_client_cert_with_key_is_rejected(self) -> None:
        message = "Parameters 'client_cert' and 'client_key' must be supplied together"

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate(_valid_params(client_cert="", client_key=_KEY_PEM))

    async def test_client_cert_pair_together_passes(self) -> None:
        await K8sConnectPlugin().validate(_valid_params(client_cert=_CERT_PEM, client_key=_KEY_PEM))

    async def test_run_token_duration_below_minimum_is_rejected(self) -> None:
        with pytest.raises(
            ValueError, match=r"^Parameter 'run_token_duration' must be at least 600$"
        ):
            await K8sConnectPlugin().validate(
                _valid_params(
                    acquire_run_token=True,
                    run_token_service_account="wave-tests",
                    run_token_duration=599,
                )
            )

    async def test_run_token_duration_at_minimum_passes(self) -> None:
        await K8sConnectPlugin().validate(
            _valid_params(
                acquire_run_token=True,
                run_token_service_account="wave-tests",
                run_token_duration=600,
            )
        )

    async def test_run_token_duration_ignored_while_toggle_off(self) -> None:
        await K8sConnectPlugin().validate(_valid_params(run_token_duration=599))

    async def test_missing_service_account_when_acquiring(self) -> None:
        with pytest.raises(
            ValueError, match=r"^Missing required parameter: run_token_service_account$"
        ):
            await K8sConnectPlugin().validate(_valid_params(acquire_run_token=True))

    async def test_empty_service_account_counts_as_missing(self) -> None:
        with pytest.raises(
            ValueError, match=r"^Missing required parameter: run_token_service_account$"
        ):
            await K8sConnectPlugin().validate(
                _valid_params(acquire_run_token=True, run_token_service_account="")
            )

    async def test_service_account_not_required_while_toggle_off(self) -> None:
        await K8sConnectPlugin().validate(_valid_params(acquire_run_token=False))

    async def test_zero_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sConnectPlugin().validate(_valid_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sConnectPlugin().validate(_valid_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await K8sConnectPlugin().validate(_valid_params(timeout=45))

    async def test_invalid_tls_min_version_is_rejected(self) -> None:
        message = (
            "Parameter 'tls_min_version' must be one of: 1.0, 1.1, 1.2, 1.3; "
            "Actual value was 'ssl3'."
        )

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate(_valid_params(tls_min_version="ssl3"))

    async def test_invalid_tls_max_version_is_rejected(self) -> None:
        message = (
            "Parameter 'tls_max_version' must be one of: 1.0, 1.1, 1.2, 1.3; "
            "Actual value was '2.0'."
        )

        with pytest.raises(ValueError, match=_exact(message)):
            await K8sConnectPlugin().validate(_valid_params(tls_max_version="2.0"))


class TestExecuteSession:
    """The emitted session: a kubectl-compatible JSON Config named wave."""

    async def test_result_carries_exactly_the_two_outputs(self) -> None:
        result = await _execute(_valid_params())

        assert set(result) == {"session", "cluster_version"}
        assert isinstance(result["session"], str)

    async def test_cluster_version_is_the_raw_git_version(self) -> None:
        result = await _execute(_valid_params(), _client_mock(version="v1.33.0"))

        assert result["cluster_version"] == "v1.33.0"

    async def test_session_is_a_kubectl_config_named_wave(self) -> None:
        result = await _execute(_valid_params(token="sa-tok"))
        config = _session_config(result)

        assert config["apiVersion"] == "v1"
        assert config["kind"] == "Config"
        assert config["current-context"] == "wave"
        assert [c["name"] for c in config["clusters"]] == ["wave"]
        assert [u["name"] for u in config["users"]] == ["wave"]
        assert [c["name"] for c in config["contexts"]] == ["wave"]
        assert config["clusters"][0]["cluster"]["server"] == _API_URL
        assert config["contexts"][0]["context"]["cluster"] == "wave"
        assert config["contexts"][0]["context"]["user"] == "wave"

    async def test_token_only_credential_form(self) -> None:
        result = await _execute(_valid_params(token="sa-tok"))

        assert _user(result) == {"token": "sa-tok"}

    async def test_cert_only_credential_form(self) -> None:
        result = await _execute(_valid_params(client_cert=_CERT_PEM, client_key=_KEY_PEM))

        assert _user(result) == {
            "client-certificate-data": _b64(_CERT_PEM),
            "client-key-data": _b64(_KEY_PEM),
        }

    async def test_both_credentials_form(self) -> None:
        result = await _execute(
            _valid_params(token="sa-tok", client_cert=_CERT_PEM, client_key=_KEY_PEM)
        )

        assert _user(result) == {
            "token": "sa-tok",
            "client-certificate-data": _b64(_CERT_PEM),
            "client-key-data": _b64(_KEY_PEM),
        }

    async def test_anonymous_credential_form(self) -> None:
        result = await _execute(_valid_params())

        assert _user(result) == {}

    async def test_ca_and_server_name_are_embedded(self) -> None:
        result = await _execute(_valid_params(ca_cert=_CA_PEM, tls_server_name="kwok-internal"))
        cluster = _cluster(result)

        assert cluster["certificate-authority-data"] == _b64(_CA_PEM)
        assert cluster["tls-server-name"] == "kwok-internal"

    async def test_skip_verify_flag_is_embedded(self) -> None:
        result = await _execute(_valid_params(verify_ssl=False))

        assert _cluster(result)["insecure-skip-tls-verify"] is True

    async def test_verify_on_omits_the_skip_verify_flag(self) -> None:
        result = await _execute(_valid_params())

        assert "insecure-skip-tls-verify" not in _cluster(result)

    async def test_tls_constraint_extension_records_the_effective_default_ciphers(self) -> None:
        result = await _execute(_valid_params())

        assert _cluster(result)["extensions"] == [
            {
                "name": "wave",
                "extension": {
                    "tls_min_version": "1.2",
                    "tls_max_version": "1.3",
                    "cipher_suites": _DEFAULT_RANGE_CIPHERS,
                },
            }
        ]
        assert _DEFAULT_RANGE_CIPHERS == tls_capabilities.suites_for_range("1.2", "1.3")
        assert len(_DEFAULT_RANGE_CIPHERS) == 24

    async def test_unset_ciphers_narrowed_range_records_only_in_range_ciphers(self) -> None:
        result = await _execute(_valid_params(tls_max_version="1.2"))
        extension = _cluster(result)["extensions"][0]["extension"]

        assert extension["cipher_suites"] == _LEGACY_CIPHERS
        assert extension["cipher_suites"] == tls_capabilities.suites_for_range("1.2", "1.2")

    async def test_unset_ciphers_tls13_only_range_records_the_tls13_family(self) -> None:
        result = await _execute(_valid_params(tls_min_version="1.3"))
        extension = _cluster(result)["extensions"][0]["extension"]

        assert extension["cipher_suites"] == _TLS13_CIPHERS

    async def test_explicit_empty_cipher_list_passes_through(self) -> None:
        result = await _execute(_valid_params(cipher_suites=[]))

        assert _cluster(result)["extensions"][0]["extension"]["cipher_suites"] == []

    async def test_tls_constraint_extension_carries_custom_pins(self) -> None:
        result = await _execute(
            _valid_params(
                tls_min_version="1.0",
                tls_max_version="1.2",
                cipher_suites=["ECDHE-ECDSA-AES128-GCM-SHA256", "TLS_AES_128_GCM_SHA256"],
            )
        )

        assert _cluster(result)["extensions"] == [
            {
                "name": "wave",
                "extension": {
                    "tls_min_version": "1.0",
                    "tls_max_version": "1.2",
                    "cipher_suites": [
                        "ECDHE-ECDSA-AES128-GCM-SHA256",
                        "TLS_AES_128_GCM_SHA256",
                    ],
                },
            }
        ]

    async def test_namespace_is_carried_in_the_context(self) -> None:
        result = await _execute(_valid_params(namespace="apps"))
        default_result = await _execute(_valid_params())

        assert _session_config(result)["contexts"][0]["context"]["namespace"] == "apps"
        namespace = _session_config(default_result)["contexts"][0]["context"]["namespace"]
        assert namespace == "default"


class TestExecuteVersionFloor:
    """The 1.19 floor via /version (REQ-4.6.3): parsed compare, raw report."""

    async def test_version_below_the_floor_reports_the_raw_git_version(self) -> None:
        message = "WAVE needs Kubernetes 1.19 or newer - this cluster reports v1.18.3"

        with pytest.raises(Exception, match=_exact(message)):
            await _execute(_valid_params(), _client_mock(version="v1.18.3"))

    async def test_version_at_the_floor_passes(self) -> None:
        result = await _execute(_valid_params(), _client_mock(version="v1.19.0"))

        assert result["cluster_version"] == "v1.19.0"

    async def test_vendor_suffixed_git_version_passes(self) -> None:
        result = await _execute(_valid_params(), _client_mock(version="v1.28.5-eks-5e0fdde"))

        assert result["cluster_version"] == "v1.28.5-eks-5e0fdde"

    async def test_minor_version_compares_numerically_not_lexically(self) -> None:
        result = await _execute(_valid_params(), _client_mock(version="v1.100.1"))

        assert result["cluster_version"] == "v1.100.1"

    async def test_version_read_failure_wraps_the_detail(self) -> None:
        client_cls = _client_mock()
        client_cls.return_value.server_version.side_effect = RuntimeError("connection reset")
        message = f"Could not read the Kubernetes version from {_API_URL}: connection reset"

        with pytest.raises(Exception, match=_exact(message)):
            await _execute(_valid_params(), client_cls)

    async def test_unparsable_git_version_is_unreadable(self) -> None:
        with pytest.raises(
            Exception,
            match=rf"^Could not read the Kubernetes version from {re.escape(_API_URL)}: .+$",
        ):
            await _execute(_valid_params(), _client_mock(version="unknown"))


class TestExecuteRunToken:
    """Run-token acquisition: request, session swap, granted expiry."""

    async def test_token_request_carries_the_requested_parameters(self) -> None:
        client_cls = _client_mock()

        await _execute(
            _valid_params(
                acquire_run_token=True,
                run_token_service_account="wave-tests",
                run_token_namespace="ops",
                run_token_duration=3600,
            ),
            client_cls,
        )

        token_request = client_cls.return_value.token_request
        assert token_request.call_count == 1
        args, kwargs = token_request.call_args
        assert list(args) + list(kwargs.values()) == ["wave-tests", "ops", 3600]

    async def test_token_request_defaults_namespace_and_duration(self) -> None:
        client_cls = _client_mock()

        await _execute(
            _valid_params(acquire_run_token=True, run_token_service_account="wave-tests"),
            client_cls,
        )

        args, kwargs = client_cls.return_value.token_request.call_args
        assert list(args) + list(kwargs.values()) == ["wave-tests", "default", 14400]

    async def test_granted_token_replaces_the_supplied_token(self) -> None:
        result = await _execute(
            _valid_params(
                token="org-token",
                acquire_run_token=True,
                run_token_service_account="wave-tests",
            ),
            _client_mock(granted=("minted-token", "2026-08-19T15:00:00Z")),
        )

        assert _user(result) == {"token": "minted-token"}

    async def test_granted_expiry_is_logged(self) -> None:
        logger = MagicMock()

        await _execute(
            _valid_params(acquire_run_token=True, run_token_service_account="wave-tests"),
            _client_mock(granted=("minted-token", "2026-08-19T15:00:00Z")),
            logger=logger,
        )

        logged = " ".join(str(call) for call in logger.info.call_args_list)
        assert "2026-08-19T15:00:00Z" in logged

    async def test_no_token_request_while_toggle_off(self) -> None:
        client_cls = _client_mock()

        await _execute(_valid_params(), client_cls)

        client_cls.return_value.token_request.assert_not_called()

    async def test_run_token_failure_names_the_service_account(self) -> None:
        client_cls = _client_mock()
        client_cls.return_value.token_request.side_effect = RuntimeError(
            "Kubernetes API request POST /api/v1/namespaces/ops/serviceaccounts/"
            "wave-tests/token failed (403): tokenrequests is forbidden"
        )
        message = (
            "Could not get a run token for service account 'wave-tests' in namespace 'ops': "
            "Kubernetes API request POST /api/v1/namespaces/ops/serviceaccounts/"
            "wave-tests/token failed (403): tokenrequests is forbidden"
        )

        with pytest.raises(Exception, match=_exact(message)):
            await _execute(
                _valid_params(
                    acquire_run_token=True,
                    run_token_service_account="wave-tests",
                    run_token_namespace="ops",
                ),
                client_cls,
            )


class TestClientConstruction:
    """Connect hands the REST core the parsed context and the timeout."""

    async def test_client_receives_the_context_and_timeout(self) -> None:
        client_cls = _client_mock()

        await _execute(
            _valid_params(
                namespace="apps",
                timeout=45,
                token="sa-tok",
                ca_cert=_CA_PEM,
                tls_server_name="kwok-internal",
                tls_min_version="1.0",
                tls_max_version="1.2",
                cipher_suites=["ECDHE-ECDSA-AES128-GCM-SHA256"],
            ),
            client_cls,
        )

        call = client_cls.call_args
        context = call.args[0] if call.args else call.kwargs["context"]
        if "timeout" in call.kwargs:
            timeout = call.kwargs["timeout"]
        else:
            timeout = call.args[1] if len(call.args) > 1 else None
        assert context.server == _API_URL
        assert context.token == "sa-tok"
        assert context.ca_cert == _CA_PEM
        assert context.verify is True
        assert context.server_name == "kwok-internal"
        assert context.tls_min_version == "1.0"
        assert context.tls_max_version == "1.2"
        assert context.cipher_suites == ["ECDHE-ECDSA-AES128-GCM-SHA256"]
        assert context.namespace == "apps"
        assert timeout == 45

    async def test_client_context_carries_the_resolved_default_ciphers(self) -> None:
        client_cls = _client_mock()

        result = await _execute(_valid_params(), client_cls)

        call = client_cls.call_args
        context = call.args[0] if call.args else call.kwargs["context"]
        recorded = _cluster(result)["extensions"][0]["extension"]["cipher_suites"]
        assert context.cipher_suites == _DEFAULT_RANGE_CIPHERS
        assert context.cipher_suites == recorded

    async def test_client_timeout_defaults_to_30(self) -> None:
        client_cls = _client_mock()

        await _execute(_valid_params(), client_cls)

        call = client_cls.call_args
        if "timeout" in call.kwargs:
            timeout = call.kwargs["timeout"]
        else:
            timeout = call.args[1] if len(call.args) > 1 else None
        assert timeout == 30


class TestNullCipherEntry:
    """A null Cipher Suites entry fails naming its row before anything connects
    (REQ-3.1.3.21)."""

    @pytest.mark.parametrize(
        ("ciphers", "row"),
        [
            pytest.param([None], 1, id="first-row"),
            pytest.param(["ECDHE-ECDSA-AES128-GCM-SHA256", None], 2, id="second-row"),
        ],
    )
    async def test_a_null_entry_fails_naming_its_row(self, ciphers: list[Any], row: int) -> None:
        client_cls = _client_mock()
        params = _valid_params(cipher_suites=ciphers)

        with pytest.raises(NullValueError, match=_exact(f"Row {row} in 'cipher_suites' is null")):
            await K8sConnectPlugin().validate(params)
            await _execute(params, client_cls)

        client_cls.assert_not_called()
