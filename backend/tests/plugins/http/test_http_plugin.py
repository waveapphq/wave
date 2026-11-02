"""Unit tests for the HTTP plugin core: metadata, validation, execution basics.

Tests requirements:
- REQ-3.4.1.4: HTTP/HTTPS client operations
- REQ-5.1.6: HTTP/HTTPS for service APIs
- REQ-3.4.1.3: remotable (bundle-safe) so the HTTP block runs inside a
  Remote Execution container as well as locally on WAVE.

The suite is split by area:
- tests/plugins/http/test_http_headers_policy.py - runtime key policy
- tests/plugins/http/test_http_auth.py - auth section + catalog registration
- tests/plugins/http/test_http_body_modes.py - body modes + streaming
- tests/plugins/http/test_http_response_modes.py - response modes + cap
- tests/plugins/http/test_http_trace.py - evidence trace + logging
- tests/plugins/http/test_http_network.py - mTLS / proxy / TLS pins / server TLS

This file keeps the cross-cutting core: metadata shape (36 parameters,
9 outputs), parameter validation, method coverage, retry logic, redirects,
error handling, and pass-through semantics.
"""

import re
from dataclasses import fields
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest

from tests.plugins.http.httpx_fakes import (
    make_client,
    make_mock_client,
    make_response,
    patch_async_client,
)

_EXPECTED_PARAMETERS = {
    # Existing params keep today's names, types, and defaults.
    "method",
    "url",
    "body",
    "headers",
    "query_params",
    "timeout",
    "verify_ssl",
    "ca_cert",
    "allow_redirects",
    "max_redirects",
    "retry_count",
    "retry_delay",
    "retry_backoff_factor",
    "retryable_status_codes",
    # Body, response, TLS identity and proxy parameters.
    "body_mode",
    "form_fields",
    "parts",
    "file_source",
    "response_mode",
    "file_path",
    "max_size",
    "client_cert",
    "client_key",
    "proxy_mode",
    # Auth section parameters.
    "auth_enabled",
    "auth_mode",
    "auth_username",
    "auth_password",
    "auth_token",
    "auth_header_name",
    "auth_key",
    # Body section parameters.
    "body_auto_headers",
    "file_content_type",
    # TLS config parameters.
    "tls_min_version",
    "tls_max_version",
    "cipher_suites",
}

_EXPECTED_OUTPUTS = {
    "status_code",
    "body",
    "headers",
    "content_type",
    "response_time",
    "final_url",
    "size",
    "sha256",
    "trace",
}


def _exact(text: str) -> str:
    return f"^{re.escape(text)}$"


class TestHTTPPluginMetadata:
    """Test suite for HTTP plugin metadata and creation."""

    def test_http_plugin_exists(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        assert plugin is not None

    def test_metadata_structure(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        meta = HTTPClientPlugin().metadata

        assert meta["id"] == "http-client"
        assert meta["name"] == "HTTP Client"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "network"
        assert meta["description"] is not None
        assert "parameters" in meta
        assert "return_type" in meta

    def test_metadata_declares_remotable(self):
        """HTTP is bundle-safe (pure-Python httpx) so it runs inside a Remote body."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        assert HTTPClientPlugin().metadata["remotable"] is True

    def test_metadata_parameters_are_the_contract_set(self):
        """Exactly the contract set - 14 core, 10 body/response/network, 7 auth, 2 body,
        3 TLS params."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        param_names = {p["name"] for p in HTTPClientPlugin().metadata["parameters"]}

        assert param_names == _EXPECTED_PARAMETERS
        # profile is NOT a user-configurable parameter (injected via context)
        assert "profile" not in param_names

    def test_proxy_url_is_not_a_parameter(self):
        """REQ-3.4.3.9: the block holds no proxy address of its own."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        names = {p["name"] for p in HTTPClientPlugin().metadata["parameters"]}

        assert "proxy_url" not in names

    def test_proxy_mode_defaults_to_the_wave_setting(self):
        """REQ-3.4.3.9: a block that stores no proxy choice follows the Proxy setting."""
        from wavecore.plugins.http_client import HTTPClientPlugin, HTTPRequestConfig

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}
        config_fields = {f.name: f for f in fields(HTTPRequestConfig)}

        assert params["proxy_mode"]["default"] == "wave-setting"
        assert config_fields["proxy_mode"].default == "wave-setting"

    def test_the_request_config_has_no_proxy_url_field(self):
        """REQ-3.4.3.9: a request carries the proxy choice, never a proxy address."""
        from wavecore.plugins.http_client import HTTPRequestConfig

        assert "proxy_url" not in {f.name for f in fields(HTTPRequestConfig)}

    def test_map_and_parts_params_do_not_declare_templatable(self):
        """Section 18: the templatable hybrid model is retired; values are
        literal-or-expression via dotted expressionFields, never whole-map {{ }}."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        for name in ("headers", "query_params", "form_fields", "parts"):
            assert "templatable" not in params[name]

    def test_headers_key_policy_drops_mode_conflicts_and_declares_generated_keys(self):
        """Section 9: mode-conflict rules retired; generated rows drive the dup rule."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        policy = params["headers"]["key_policy"]
        assert "mode_conflicts" not in policy
        assert policy["blocked_keys"] == ["Content-Length"]
        assert policy["generated_keys"] == [
            {
                "when": {"auth_enabled": [True], "auth_mode": ["basic", "bearer"]},
                "key": "Authorization",
            },
            {
                "when": {"auth_enabled": [True], "auth_mode": ["api_key"]},
                "key_param": "auth_header_name",
            },
            {
                "when": {"body_auto_headers": [True], "body_mode": ["form", "file"]},
                "key": "Content-Type",
            },
            {"when": {"body_mode": ["multipart"]}, "key": "Content-Type"},
        ]

    def test_metadata_outputs_are_the_contract_set(self):
        """Existing outputs keep name and type; size/sha256/trace join."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        output_names = {o["name"] for o in HTTPClientPlugin().metadata["output_schema"]}

        assert output_names == _EXPECTED_OUTPUTS

    def test_method_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        method_param = params["method"]
        assert method_param["type"] == "string"
        assert method_param["required"] is True
        assert method_param["default"] == "GET"
        assert set(method_param["enum_values"]) == {
            "GET",
            "POST",
            "PUT",
            "DELETE",
            "PATCH",
            "HEAD",
            "OPTIONS",
        }

    def test_url_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        url_param = params["url"]
        assert url_param["type"] == "string"
        assert url_param["required"] is True
        assert url_param["description"] is not None

    def test_strict_string_params_declare_trim(self):
        """url and method are strict single-line values - they declare trim=True."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        assert params["url"].get("trim") is True
        assert params["method"].get("trim") is True

    def test_freeform_string_params_do_not_trim(self):
        """body (request payload) and ca_cert (PEM) preserve whitespace verbatim."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        assert not params["body"].get("trim")
        assert not params["ca_cert"].get("trim")

    def test_headers_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        headers_param = params["headers"]
        assert headers_param["type"] == "map"
        assert headers_param["required"] is False

    def test_query_params_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        query_param = params["query_params"]
        assert query_param["type"] == "map"
        assert query_param["required"] is False

    def test_timeout_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        timeout_param = params["timeout"]
        assert timeout_param["type"] == "integer"
        assert timeout_param["required"] is False
        assert timeout_param["default"] == 30

    def test_verify_ssl_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        verify_param = params["verify_ssl"]
        assert verify_param["type"] == "boolean"
        assert verify_param["required"] is False
        assert verify_param["default"] is True

    def test_ca_cert_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        ca_cert_param = params["ca_cert"]
        assert ca_cert_param["type"] == "string"
        assert ca_cert_param["required"] is False

    def test_verify_ssl_description_states_the_trust_rule(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        assert params["verify_ssl"]["description"] == (
            "Verify the server certificate: against CA Certificate when it is set, otherwise "
            "against the certificates WAVE trusts (Settings > Network > Certificates)"
        )

    def test_ca_cert_description_says_it_is_the_only_trusted_certificate(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        assert params["ca_cert"]["description"] == (
            "CA certificate (file path, variable reference, or PEM string); when set, it is the "
            "only certificate this block trusts"
        )

    def test_cipher_suites_description_says_unset_offers_every_suite_of_the_range(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        assert params["cipher_suites"]["description"] == (
            "Cipher suites offered to the server, in client preference order per protocol "
            "family (OpenSSL or IANA names). Unset offers every suite WAVE supports for the "
            "selected TLS version range; an empty list offers no ciphers; a null entry fails "
            "the run."
        )

    def test_allow_redirects_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        redirects_param = params["allow_redirects"]
        assert redirects_param["type"] == "boolean"
        assert redirects_param["required"] is False
        assert redirects_param["default"] is True

    def test_max_redirects_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        max_redir_param = params["max_redirects"]
        assert max_redir_param["type"] == "integer"
        assert max_redir_param["required"] is False
        assert max_redir_param["default"] == 10

    def test_return_type_is_map(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        assert HTTPClientPlugin().metadata["return_type"] == "map"

    def test_plugin_model_validation(self):
        """Plugin metadata converts to a valid Plugin model."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        model = HTTPClientPlugin().get_plugin_model()

        assert model.id == "http-client"
        assert model.version == "1.0.0"
        assert model.category == "network"
        assert len(model.parameters) == len(_EXPECTED_PARAMETERS)


class TestHTTPPluginValidation:
    """Test suite for HTTP plugin parameter validation (REQ-3.4.2.3)."""

    @pytest.mark.asyncio
    async def test_validate_requires_method_parameter(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Missing required parameter: method$"):
            await plugin.validate({})

    @pytest.mark.asyncio
    async def test_validate_method_must_be_string(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'method' must be a string$"):
            await plugin.validate({"method": 123})

    @pytest.mark.asyncio
    async def test_validate_method_must_be_valid(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'method' must be one of: "
                r"GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS; "
                r"Actual value was 'INVALID'\.$"
            ),
        ):
            await plugin.validate({"method": "INVALID"})

    @pytest.mark.asyncio
    async def test_validate_method_long_invalid_value_shows_length_not_content(self):
        """A long invalid method value is shown only by length, never its content
        (a secret bound to the method param must not leak a truncated prefix)."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        long_method = "z" * 60
        with pytest.raises(ValueError) as excinfo:
            await plugin.validate({"method": long_method})
        message = str(excinfo.value)
        assert "Actual value was a 60-character value." in message
        assert "zzzz" not in message

    @pytest.mark.asyncio
    async def test_validate_requires_url_parameter(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Missing required parameter: url$"):
            await plugin.validate({"method": "GET"})

    @pytest.mark.asyncio
    async def test_validate_url_must_be_string(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'url' must be a string$"):
            await plugin.validate({"method": "GET", "url": 123})

    @pytest.mark.asyncio
    async def test_validate_url_cannot_be_empty(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Parameter 'url' cannot be empty$"):
            await plugin.validate({"method": "GET", "url": ""})

    @pytest.mark.asyncio
    async def test_validate_url_must_have_http_scheme(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^URL must start with http:// or https://"):
            await plugin.validate({"method": "GET", "url": "htps://example.com"})

    @pytest.mark.asyncio
    async def test_validate_url_without_scheme(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^URL must start with http:// or https://"):
            await plugin.validate({"method": "GET", "url": "example.com"})

    @pytest.mark.asyncio
    async def test_validate_url_missing_double_slash(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^URL must start with http:// or https://"):
            await plugin.validate({"method": "GET", "url": "http:localhost:8000/health"})

    @pytest.mark.asyncio
    async def test_validate_url_with_ftp_scheme(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^URL must start with http:// or https://"):
            await plugin.validate({"method": "GET", "url": "ftp://example.com"})

    @pytest.mark.parametrize(
        "url",
        [
            "htps://example.com",
            "example.com",
            "http:localhost:8000/health",
            "ftp://example.com",
            "//example.com",
        ],
    )
    @pytest.mark.asyncio
    async def test_validate_url_with_a_wrong_or_missing_scheme_quotes_the_value(self, url):
        from wavecore.plugins.http_client import HTTPClientPlugin

        message = f"URL must start with http:// or https:// (got '{url}')"

        with pytest.raises(ValueError, match=_exact(message)):
            await HTTPClientPlugin().validate({"method": "GET", "url": url})

    @pytest.mark.parametrize(
        "url", ["https://:6443", "https://wave@", "https://", "http:///health", "https://[::1"]
    )
    @pytest.mark.asyncio
    async def test_validate_url_with_a_scheme_and_no_host(self, url):
        """A URL that names no host is refused at the check, not when it connects."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        with pytest.raises(ValueError, match=_exact(f"URL needs a host (got '{url}')")):
            await HTTPClientPlugin().validate({"method": "GET", "url": url})

    @pytest.mark.asyncio
    async def test_validate_url_without_a_host_quotes_50_characters_of_the_trimmed_value(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        url = "https://:6443/" + "a" * 60
        message = f"URL needs a host (got '{url[:50]}')"

        with pytest.raises(ValueError, match=_exact(message)):
            await HTTPClientPlugin().validate({"method": "GET", "url": f"  {url}\n"})

    @pytest.mark.parametrize(
        "url", ["http://example.com:0", "http://example.com:99999", "http://example.com:abc/x"]
    )
    @pytest.mark.asyncio
    async def test_validate_url_with_a_port_outside_1_to_65535(self, url):
        """A port no request can use is refused at the check."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        message = f"URL port must be between 1 and 65535 (got '{url}')"

        with pytest.raises(ValueError, match=_exact(message)):
            await HTTPClientPlugin().validate({"method": "GET", "url": url})

    @pytest.mark.asyncio
    async def test_validate_url_accepts_http(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        # Should not raise
        await HTTPClientPlugin().validate({"method": "GET", "url": "http://example.com"})

    @pytest.mark.asyncio
    async def test_validate_url_accepts_https(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        # Should not raise
        await HTTPClientPlugin().validate({"method": "GET", "url": "https://example.com"})

    @pytest.mark.asyncio
    async def test_validate_url_accepts_localhost(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        # Should not raise
        await HTTPClientPlugin().validate({"method": "GET", "url": "http://localhost:8080"})

    @pytest.mark.asyncio
    async def test_validate_url_with_query_params_valid(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        # Should not raise
        await HTTPClientPlugin().validate(
            {
                "method": "GET",
                "url": "http://example.com",
                "query_params": {"page": "1"},
            }
        )

    @pytest.mark.asyncio
    async def test_validate_body_must_be_string(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'body' must be a string$"):
            await plugin.validate(
                {
                    "method": "POST",
                    "url": "http://example.com",
                    "body": {"key": "value"},  # Should be string, not dict
                }
            )

    @pytest.mark.asyncio
    async def test_validate_headers_must_be_dict(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'headers' must be a dict$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "headers": "not-a-dict"}
            )

    @pytest.mark.asyncio
    async def test_validate_headers_keys_must_be_strings(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^All header keys must be strings$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "headers": {123: "value"}}
            )

    @pytest.mark.asyncio
    async def test_validate_accepts_a_non_string_header_value(self):
        """A resolved expression header value need not be a string at validation -
        it is coerced to str at send, so validation must not reject it."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        # Does not raise - the int value is coerced to "123" when the request is sent.
        await plugin.validate(
            {"method": "GET", "url": "http://example.com", "headers": {"Content-Type": 123}}
        )

    @pytest.mark.asyncio
    async def test_validate_query_params_must_be_dict(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'query_params' must be a dict$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "query_params": "not-a-dict"}
            )

    @pytest.mark.asyncio
    async def test_validate_query_params_keys_must_be_strings(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^All query parameter keys must be strings$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "query_params": {123: "value"}}
            )

    @pytest.mark.asyncio
    async def test_validate_accepts_a_non_string_query_param_value(self):
        """A resolved expression query value need not be a string at validation -
        it is coerced to str at send, so validation must not reject it."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        # Does not raise - the int value is coerced to "123" when the request is sent.
        await plugin.validate(
            {
                "method": "GET",
                "url": "http://example.com",
                "query_params": {"page": 123},
            }
        )

    @pytest.mark.asyncio
    async def test_validate_accepts_stored_string_maps(self):
        """The common case: string-valued header/query maps pass validation."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        # Should not raise.
        await plugin.validate(
            {
                "method": "GET",
                "url": "http://example.com",
                "headers": {"X-Tag": "literal"},
                "query_params": {"page": "1"},
            }
        )

    @pytest.mark.asyncio
    async def test_validate_timeout_must_be_positive(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Parameter 'timeout' must be positive$"):
            await plugin.validate({"method": "GET", "url": "http://example.com", "timeout": -1})

        with pytest.raises(ValueError, match="^Parameter 'timeout' must be positive$"):
            await plugin.validate({"method": "GET", "url": "http://example.com", "timeout": 0})

    @pytest.mark.asyncio
    async def test_validate_verify_ssl_must_be_boolean(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'verify_ssl' must be a boolean$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "verify_ssl": "yes"}
            )

    @pytest.mark.asyncio
    async def test_validate_ca_cert_must_be_string(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'ca_cert' must be a string$"):
            await plugin.validate({"method": "GET", "url": "http://example.com", "ca_cert": 123})

    @pytest.mark.asyncio
    async def test_validate_allow_redirects_must_be_boolean(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'allow_redirects' must be a boolean$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "allow_redirects": "yes"}
            )

    @pytest.mark.asyncio
    async def test_validate_max_redirects_must_be_positive(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Parameter 'max_redirects' must be positive$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "max_redirects": -1}
            )

        with pytest.raises(ValueError, match="^Parameter 'max_redirects' must be positive$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "max_redirects": 0}
            )

    @pytest.mark.asyncio
    async def test_validate_timeout_must_be_number(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'timeout' must be a number$"):
            await plugin.validate({"method": "GET", "url": "http://example.com", "timeout": "30"})

    @pytest.mark.asyncio
    async def test_validate_max_redirects_must_be_number(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'max_redirects' must be a number$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "max_redirects": "10"}
            )

    @pytest.mark.asyncio
    async def test_validate_retry_count_must_be_number(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'retry_count' must be a number$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "retry_count": "3"}
            )

    @pytest.mark.asyncio
    async def test_validate_retry_delay_must_be_number(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'retry_delay' must be a number$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "retry_delay": "1"}
            )

    @pytest.mark.asyncio
    async def test_validate_retry_backoff_factor_must_be_number(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'retry_backoff_factor' must be a number$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "retry_backoff_factor": "2"}
            )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "name", ["timeout", "max_redirects", "max_size", "retry_count", "retry_delay"]
    )
    @pytest.mark.parametrize("value", [True, False, float("nan"), float("inf")])
    async def test_validate_a_boolean_or_a_number_that_is_not_finite_is_not_a_number(
        self, name: str, value: Any
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        with pytest.raises(TypeError, match=f"^Parameter '{name}' must be a number$"):
            await HTTPClientPlugin().validate(
                {"method": "GET", "url": "http://example.com", name: value}
            )

    @pytest.mark.asyncio
    async def test_validate_success_with_minimal_params(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        # Should not raise
        await HTTPClientPlugin().validate({"method": "GET", "url": "http://example.com"})

    @pytest.mark.asyncio
    async def test_validate_success_with_all_params(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        # Should not raise
        await HTTPClientPlugin().validate(
            {
                "method": "POST",
                "url": "http://example.com/api",
                "body": '{"key": "value"}',
                "headers": {"Content-Type": "application/json"},
                "query_params": {"page": "1"},
                "timeout": 60,
                "verify_ssl": True,
                "ca_cert": "/path/to/cert.pem",
                "allow_redirects": True,
                "max_redirects": 5,
            }
        )


class TestHTTPPluginExecution:
    """Test suite for HTTP plugin execution."""

    @pytest.mark.asyncio
    async def test_execute_simple_get_request(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            status_code=200,
            headers={"Content-Type": "text/plain"},
            text="Hello, World!",
            url="http://example.com/",
        )

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 200
            assert result["headers"] == {"Content-Type": "text/plain"}
            assert result["body"] == "Hello, World!"
            assert result["content_type"] == "text/plain"
            assert "response_time" in result
            assert result["final_url"] == "http://example.com/"

    @pytest.mark.asyncio
    async def test_url_trimmed_end_to_end(self):
        """A url carrying a trailing newline reaches the request trimmed.

        Exercises the metadata -> trim_fields -> resolve_parameters -> execute
        chain: the framework strips the resolved url before the plugin builds
        the request, so an accidental newline never breaks the call.
        """
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        trim_fields = {p["name"] for p in plugin.metadata["parameters"] if p.get("trim")}
        parameter_types = {p["name"]: p["type"] for p in plugin.metadata["parameters"]}

        resolved = resolve_parameters(
            parameters={"method": "GET", "url": "http://example.com/\n"},
            expression_fields=set(),
            variables={},
            parameter_types=parameter_types,
            trim_fields=trim_fields,
        )
        assert resolved["url"] == "http://example.com/"

        client, _ = make_mock_client(text="OK", url="http://example.com/")

        with patch_async_client(client):
            await plugin.execute({"parameters": resolved, "logger": Mock(), "variables": {}})

        client.request.assert_awaited_once()
        assert client.request.call_args.kwargs["url"] == "http://example.com/"

    @pytest.mark.asyncio
    async def test_execute_post_with_body(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            status_code=201,
            headers={"Content-Type": "application/json"},
            text='{"id": "123"}',
            url="http://example.com/api/resource",
        )

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "POST",
                    "url": "http://example.com/api/resource",
                    "body": '{"name": "test"}',
                    "headers": {"Content-Type": "application/json"},
                },
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 201
            assert result["body"] == '{"id": "123"}'
            assert isinstance(result["body"], str)
            assert client.request.call_args.kwargs["method"] == "POST"
            assert client.request.call_args.kwargs["content"] == '{"name": "test"}'

    @pytest.mark.asyncio
    async def test_execute_response_body_not_parsed(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            headers={"Content-Type": "application/json"},
            text='{"key": "value"}',
            url="http://example.com/",
        )

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            # Body should be raw string, NOT parsed dict
            assert result["body"] == '{"key": "value"}'
            assert isinstance(result["body"], str)
            assert not isinstance(result["body"], dict)

    @pytest.mark.asyncio
    async def test_execute_xml_response_not_parsed(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        xml_content = '<?xml version="1.0"?><root><item>value</item></root>'

        client, _ = make_mock_client(
            headers={"Content-Type": "application/xml"},
            text=xml_content,
            url="http://example.com/",
        )

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["body"] == xml_content
            assert isinstance(result["body"], str)

    @pytest.mark.asyncio
    async def test_execute_with_custom_headers(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="OK", url="http://example.com/")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com",
                    "headers": {
                        "Authorization": "Bearer token123",
                        "X-Custom-Header": "custom-value",
                    },
                },
                "logger": Mock(),
                "variables": {},
            }

            await plugin.execute(context)

            client.request.assert_awaited_once()
            call_kwargs = client.request.call_args.kwargs
            assert "headers" in call_kwargs
            assert call_kwargs["headers"]["Authorization"] == "Bearer token123"
            assert call_kwargs["headers"]["X-Custom-Header"] == "custom-value"

    @pytest.mark.asyncio
    async def test_execute_with_query_params(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="OK", url="http://example.com/?page=1&limit=10")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com",
                    "query_params": {"page": "1", "limit": "10"},
                },
                "logger": Mock(),
                "variables": {},
            }

            await plugin.execute(context)

            client.request.assert_awaited_once()
            call_kwargs = client.request.call_args.kwargs
            assert "params" in call_kwargs
            assert call_kwargs["params"] == {"page": "1", "limit": "10"}

    @pytest.mark.asyncio
    async def test_execute_coerces_non_string_query_param_values(self):
        """Whole-value {{ expression }} query params resolve to any Python value;
        HTTP requires strings, so the plugin coerces (non-str -> str, None -> "")."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                {
                    "parameters": {
                        "method": "GET",
                        "url": "http://example.com",
                        "query_params": {"page": 1, "empty": None, "tag": "raw"},
                    },
                    "logger": Mock(),
                    "variables": {},
                }
            )

        assert client.request.call_args.kwargs["params"] == {
            "page": "1",
            "empty": "",
            "tag": "raw",
        }

    @pytest.mark.asyncio
    async def test_execute_response_includes_timing(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="OK", url="http://example.com/")

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert "response_time" in result
            assert isinstance(result["response_time"], int | float)
            assert result["response_time"] >= 0

    @pytest.mark.asyncio
    async def test_execute_delete_with_body(self):
        """DELETE with body is valid per RFC 9110 - content forwards to httpx."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            headers={"Content-Type": "application/json"},
            text='{"deleted": 3}',
            url="http://example.com/api/resources",
        )

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "DELETE",
                    "url": "http://example.com/api/resources",
                    "body": '{"ids": [1, 2, 3]}',
                    "headers": {"Content-Type": "application/json"},
                },
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 200
            assert result["body"] == '{"deleted": 3}'
            client.request.assert_awaited_once()
            call_kwargs = client.request.call_args.kwargs
            assert call_kwargs["method"] == "DELETE"
            assert call_kwargs["content"] == '{"ids": [1, 2, 3]}'

    @pytest.mark.asyncio
    async def test_execute_delete_with_body_and_custom_headers(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(status_code=204, text="", url="http://example.com/api/batch")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "DELETE",
                    "url": "http://example.com/api/batch",
                    "body": '{"ids": [10, 20]}',
                    "headers": {
                        "Content-Type": "application/json",
                        "X-Request-Id": "abc-123",
                    },
                },
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 204
            call_kwargs = client.request.call_args.kwargs
            assert call_kwargs["content"] == '{"ids": [10, 20]}'
            assert call_kwargs["headers"] == {
                "Content-Type": "application/json",
                "X-Request-Id": "abc-123",
            }

    @pytest.mark.asyncio
    async def test_execute_delete_without_body_sends_no_content(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            status_code=204, text="", url="http://example.com/api/resource/1"
        )

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "DELETE",
                    "url": "http://example.com/api/resource/1",
                },
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 204
            call_kwargs = client.request.call_args.kwargs
            assert call_kwargs.get("content") is None


class TestHTTPPluginAuthentication:
    """Literal auth headers pass through untouched."""

    @pytest.mark.asyncio
    async def test_bearer_token_authentication(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="Authenticated", url="http://example.com/")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com",
                    "headers": {"Authorization": "Bearer secret-token-123"},
                },
                "logger": Mock(),
                "variables": {},
            }

            await plugin.execute(context)

            call_kwargs = client.request.call_args.kwargs
            assert call_kwargs["headers"]["Authorization"] == "Bearer secret-token-123"

    @pytest.mark.asyncio
    async def test_basic_authentication(self):
        import base64

        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        credentials = base64.b64encode(b"user:pass").decode("ascii")
        auth_header = f"Basic {credentials}"

        client, _ = make_mock_client(text="Authenticated", url="http://example.com/")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com",
                    "headers": {"Authorization": auth_header},
                },
                "logger": Mock(),
                "variables": {},
            }

            await plugin.execute(context)

            call_kwargs = client.request.call_args.kwargs
            assert call_kwargs["headers"]["Authorization"] == auth_header

    @pytest.mark.asyncio
    async def test_custom_api_key_authentication(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="Authenticated", url="http://example.com/")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com",
                    "headers": {"X-API-Key": "api-key-12345"},
                },
                "logger": Mock(),
                "variables": {},
            }

            await plugin.execute(context)

            call_kwargs = client.request.call_args.kwargs
            assert call_kwargs["headers"]["X-API-Key"] == "api-key-12345"


class TestHTTPPluginRedirects:
    """Test suite for HTTP plugin redirect handling."""

    @pytest.mark.asyncio
    async def test_redirects_followed_by_default(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="OK", url="http://example.com/final")

        with patch_async_client(client) as mock_client:
            context = {
                "parameters": {"method": "GET", "url": "http://example.com/redirect"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["final_url"] == "http://example.com/final"
            assert mock_client.call_args.kwargs.get("follow_redirects", True) is True

    @pytest.mark.asyncio
    async def test_redirects_can_be_disabled(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            status_code=302,
            headers={"Location": "http://example.com/target"},
            text="",
            url="http://example.com/redirect",
        )

        with patch_async_client(client) as mock_client:
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com/redirect",
                    "allow_redirects": False,
                },
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 302
            assert mock_client.call_args.kwargs.get("follow_redirects") is False

    @pytest.mark.asyncio
    async def test_max_redirects_limit(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="OK", url="http://example.com/final")

        with patch_async_client(client) as mock_client:
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com/redirect",
                    "max_redirects": 5,
                },
                "logger": Mock(),
                "variables": {},
            }

            await plugin.execute(context)

            assert mock_client.call_args.kwargs.get("max_redirects") == 5


class TestHTTPPluginErrorHandling:
    """Test suite for HTTP plugin error handling."""

    @pytest.mark.asyncio
    async def test_4xx_errors_returned_as_response_data(self):
        """4xx is data, not an exception - verdicts belong to Assert."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            status_code=404,
            headers={"Content-Type": "text/plain"},
            text="Not Found",
            url="http://example.com/missing",
        )

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com/missing"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 404
            assert result["body"] == "Not Found"

    @pytest.mark.asyncio
    async def test_5xx_errors_returned_as_response_data(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            status_code=500,
            headers={"Content-Type": "text/plain"},
            text="Internal Server Error",
            url="http://example.com/error",
        )

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com/error"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 500
            assert result["body"] == "Internal Server Error"

    @pytest.mark.asyncio
    async def test_connection_timeout_error(self):
        """Transport failures still fail the node."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client = make_client(AsyncMock(side_effect=TimeoutError("Connection timeout")))

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com", "timeout": 5},
                "logger": Mock(),
                "variables": {},
            }

            with pytest.raises(TimeoutError):
                await plugin.execute(context)

    @pytest.mark.asyncio
    async def test_connection_refused_error(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client = make_client(AsyncMock(side_effect=ConnectionError("Connection refused")))

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
            }

            with pytest.raises(ConnectionError, match="Connection refused"):
                await plugin.execute(context)

    @pytest.mark.asyncio
    async def test_httpx_transport_error_raised(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client = make_client(AsyncMock(side_effect=httpx.ConnectError("no route")))

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
            }

            with pytest.raises(httpx.HTTPError, match="no route"):
                await plugin.execute(context)

    @pytest.mark.asyncio
    async def test_unsupported_http_method_raises_error(self):
        from wavecore.plugins.http_client import HTTPClientPlugin, HTTPRequestConfig

        plugin = HTTPClientPlugin()

        # Directly test _execute_request with an unsupported method.
        with pytest.raises(ValueError, match="^Unsupported HTTP method: UNSUPPORTED$"):
            await plugin._execute_request(
                HTTPRequestConfig(
                    method="UNSUPPORTED",
                    url="http://example.com",
                    body=None,
                    headers={},
                    query_params={},
                    timeout_seconds=30,
                    verify_ssl=True,
                    ca_cert=None,
                    allow_redirects=True,
                    max_redirects=10,
                    retry_count=0,
                    retry_delay=1,
                    retry_backoff_factor=2,
                    retryable_status_codes=["502", "503", "504"],
                    variables={},
                    logger=Mock(),
                )
            )

    @pytest.mark.asyncio
    async def test_defensive_fallback_when_no_exception_stored(self):
        from dataclasses import replace

        from wavecore.plugins.http_client import HTTPClientPlugin, HTTPRequestConfig

        plugin = HTTPClientPlugin()

        original_execute = plugin._execute_request

        async def patched_execute(req):
            req_modified = replace(req, retry_count=-1)  # while 0 <= -1 is False
            return await original_execute(req_modified)

        with pytest.raises(RuntimeError, match="Request failed after all retry attempts"):
            await patched_execute(
                HTTPRequestConfig(
                    method="GET",
                    url="http://example.com",
                    body=None,
                    headers={},
                    query_params={},
                    timeout_seconds=30,
                    verify_ssl=False,
                    ca_cert=None,
                    allow_redirects=True,
                    max_redirects=10,
                    retry_count=0,
                    retry_delay=1,
                    retry_backoff_factor=2,
                    retryable_status_codes=["502", "503", "504"],
                    variables={},
                    logger=None,
                )
            )

    @pytest.mark.asyncio
    async def test_defensive_fallback_with_stored_exception(self):
        from wavecore.plugins.http_client import HTTPClientPlugin, HTTPRequestConfig

        plugin = HTTPClientPlugin()

        mock_exception = httpx.HTTPError("Test exception")
        client = make_client(AsyncMock(side_effect=mock_exception))

        original_execute = plugin._execute_request

        async def intercepting_execute(req):
            try:
                return await original_execute(req)
            except httpx.HTTPError as e:
                last_exception = e
                if last_exception:
                    raise last_exception from None

        with patch_async_client(client):
            with pytest.raises(httpx.HTTPError, match="Test exception"):
                await intercepting_execute(
                    HTTPRequestConfig(
                        method="GET",
                        url="http://example.com",
                        body=None,
                        headers={},
                        query_params={},
                        timeout_seconds=30,
                        verify_ssl=False,
                        ca_cert=None,
                        allow_redirects=True,
                        max_redirects=10,
                        retry_count=0,
                        retry_delay=1,
                        retry_backoff_factor=2,
                        retryable_status_codes=["502", "503", "504"],
                        variables={},
                        logger=None,
                    )
                )


class TestHTTPPluginAllMethods:
    """Test suite for all HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)."""

    @pytest.mark.asyncio
    async def test_execute_put_request(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="Updated", url="http://example.com/resource/1")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "PUT",
                    "url": "http://example.com/resource/1",
                    "body": '{"name": "updated"}',
                },
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 200
            client.request.assert_awaited_once()
            assert client.request.call_args.kwargs["method"] == "PUT"

    @pytest.mark.asyncio
    async def test_execute_delete_request(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(status_code=204, text="", url="http://example.com/resource/1")

        with patch_async_client(client):
            context = {
                "parameters": {"method": "DELETE", "url": "http://example.com/resource/1"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 204
            client.request.assert_awaited_once()
            assert client.request.call_args.kwargs["method"] == "DELETE"

    @pytest.mark.asyncio
    async def test_execute_patch_request(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            text='{"status": "patched"}', url="http://example.com/resource/1"
        )

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "PATCH",
                    "url": "http://example.com/resource/1",
                    "body": '{"field": "value"}',
                },
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 200
            client.request.assert_awaited_once()
            assert client.request.call_args.kwargs["method"] == "PATCH"

    @pytest.mark.asyncio
    async def test_execute_head_request(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            headers={"Content-Length": "1234", "Content-Type": "text/html"},
            text="",  # HEAD has no body
            url="http://example.com/",
        )

        with patch_async_client(client):
            context = {
                "parameters": {"method": "HEAD", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 200
            assert result["body"] == ""
            assert result["headers"]["Content-Length"] == "1234"
            client.request.assert_awaited_once()
            assert client.request.call_args.kwargs["method"] == "HEAD"

    @pytest.mark.asyncio
    async def test_execute_options_request(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            headers={"Allow": "GET, POST, PUT, DELETE, OPTIONS"},
            text="",
            url="http://example.com/",
        )

        with patch_async_client(client):
            context = {
                "parameters": {"method": "OPTIONS", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 200
            assert "Allow" in result["headers"]
            client.request.assert_awaited_once()
            assert client.request.call_args.kwargs["method"] == "OPTIONS"


class TestHTTPPluginRetryLogic:
    """Test suite for retry logic with exponential backoff."""

    def test_retry_parameters_in_metadata(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        param_names = [p["name"] for p in HTTPClientPlugin().metadata["parameters"]]

        assert "retry_count" in param_names
        assert "retry_delay" in param_names
        assert "retry_backoff_factor" in param_names
        assert "retryable_status_codes" in param_names

    @pytest.mark.asyncio
    async def test_validate_retry_count_must_be_non_negative(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Parameter 'retry_count' must be non-negative$"):
            await plugin.validate({"method": "GET", "url": "http://example.com", "retry_count": -1})

    @pytest.mark.asyncio
    async def test_validate_retry_delay_must_be_positive(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Parameter 'retry_delay' must be positive$"):
            await plugin.validate({"method": "GET", "url": "http://example.com", "retry_delay": 0})

    @pytest.mark.asyncio
    async def test_validate_retry_backoff_factor_must_be_positive(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Parameter 'retry_backoff_factor' must be positive$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "retry_backoff_factor": 0}
            )

    @pytest.mark.asyncio
    async def test_validate_retryable_status_codes_must_be_array(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            TypeError, match="^Parameter 'retryable_status_codes' must be an array$"
        ):
            await plugin.validate(
                {
                    "method": "GET",
                    "url": "http://example.com",
                    "retryable_status_codes": "not-an-array",
                }
            )

    @pytest.mark.asyncio
    async def test_retry_on_connection_error(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        ok = make_response(text="OK", url="http://example.com/")
        request = AsyncMock(side_effect=[ConnectionError("Connection failed"), ok])
        client = make_client(request)

        with patch_async_client(client):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                context = {
                    "parameters": {
                        "method": "GET",
                        "url": "http://example.com",
                        "retry_count": 2,
                        "retry_delay": 1,
                    },
                    "logger": Mock(),
                    "variables": {},
                }

                result = await plugin.execute(context)

                assert result["status_code"] == 200
                assert request.call_count == 2

    @pytest.mark.asyncio
    async def test_retry_on_retryable_status_codes(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        resp_503 = make_response(
            status_code=503, text="Service Unavailable", url="http://example.com/"
        )
        resp_200 = make_response(status_code=200, text="OK", url="http://example.com/")
        request = AsyncMock(side_effect=[resp_503, resp_200])
        client = make_client(request)

        with patch_async_client(client):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                context = {
                    "parameters": {
                        "method": "GET",
                        "url": "http://example.com",
                        "retry_count": 2,
                        "retry_delay": 1,
                        "retryable_status_codes": ["502", "503", "504"],
                    },
                    "logger": Mock(),
                    "variables": {},
                }

                result = await plugin.execute(context)

                assert result["status_code"] == 200
                assert request.call_count == 2

    @pytest.mark.asyncio
    async def test_no_retry_on_non_retryable_status_codes(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(status_code=404, text="Not Found", url="http://example.com/")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com",
                    "retry_count": 3,
                    "retry_delay": 1,
                    "retryable_status_codes": ["502", "503", "504"],
                },
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

            assert result["status_code"] == 404
            assert client.request.call_count == 1  # No retry

    @pytest.mark.asyncio
    async def test_retry_with_exponential_backoff(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        ok = make_response(text="OK", url="http://example.com/")
        request = AsyncMock(side_effect=[ConnectionError("Failed"), ConnectionError("Failed"), ok])
        client = make_client(request)

        with patch_async_client(client):
            with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
                context = {
                    "parameters": {
                        "method": "GET",
                        "url": "http://example.com",
                        "retry_count": 3,
                        "retry_delay": 1,
                        "retry_backoff_factor": 2,
                    },
                    "logger": Mock(),
                    "variables": {},
                }

                await plugin.execute(context)

                # delay * factor^attempt: 1 * 2^0 = 1, then 1 * 2^1 = 2
                assert mock_sleep.call_count == 2
                delays = [call.args[0] for call in mock_sleep.call_args_list]
                assert delays == [1, 2]

    @pytest.mark.asyncio
    async def test_status_code_retry_backoff_consistent_with_connection_retry(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        resp_503 = make_response(status_code=503, text="Unavailable", url="http://example.com/")
        resp_200 = make_response(status_code=200, text="OK", url="http://example.com/")
        request = AsyncMock(side_effect=[resp_503, resp_503, resp_200])
        client = make_client(request)

        with patch_async_client(client):
            with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
                context = {
                    "parameters": {
                        "method": "GET",
                        "url": "http://example.com",
                        "retry_count": 3,
                        "retry_delay": 1,
                        "retry_backoff_factor": 2,
                        "retryable_status_codes": ["503"],
                    },
                    "logger": Mock(),
                    "variables": {},
                }

                await plugin.execute(context)

                assert mock_sleep.call_count == 2
                delays = [call.args[0] for call in mock_sleep.call_args_list]
                assert delays == [1, 2]


class TestHTTPPluginVariableSubstitution:
    """The plugin passes already-resolved values through without substitution."""

    @pytest.mark.asyncio
    async def test_url_passed_through_without_substitution(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="OK", url="http://example.com/users/123")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com/users/123",  # Already resolved
                },
                "logger": Mock(),
                "variables": {},
            }

            await plugin.execute(context)

            assert client.request.call_args.kwargs["url"] == "http://example.com/users/123"

    @pytest.mark.asyncio
    async def test_headers_passed_through_without_substitution(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(text="OK", url="http://example.com/")

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "GET",
                    "url": "http://example.com",
                    "headers": {"Authorization": "Bearer secret-token-123"},  # Already resolved
                },
                "logger": Mock(),
                "variables": {},
            }

            await plugin.execute(context)

            call_kwargs = client.request.call_args.kwargs
            assert call_kwargs["headers"]["Authorization"] == "Bearer secret-token-123"

    @pytest.mark.asyncio
    async def test_body_passed_through_without_substitution(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        client, _ = make_mock_client(
            status_code=201, text='{"id": "456"}', url="http://example.com/api"
        )

        with patch_async_client(client):
            context = {
                "parameters": {
                    "method": "POST",
                    "url": "http://example.com/api",
                    "body": '{"name": "Alice", "email": "alice@example.com"}',  # Already resolved
                },
                "logger": Mock(),
                "variables": {},
            }

            await plugin.execute(context)

            call_kwargs = client.request.call_args.kwargs
            assert call_kwargs.get("content") == '{"name": "Alice", "email": "alice@example.com"}'


class TestShouldRetryStatusBranches:
    """Tests for _should_retry_status edge cases."""

    def test_should_retry_status_exhausted_attempts(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        response = Mock(status_code=503)
        result = plugin._should_retry_status(
            response=response,
            retryable_status_codes=["503"],
            attempt=3,
            retry_count=3,
            logger=Mock(),
        )
        assert result is False


async def _run_block(params: dict[str, Any]) -> dict[str, Any]:
    """One HTTP Request in the engine's order: validate, then execute."""
    from wavecore.plugins.http_client import HTTPClientPlugin

    plugin = HTTPClientPlugin()
    await plugin.validate(params)
    result: dict[str, Any] = await plugin.execute(
        {"parameters": params, "logger": Mock(), "variables": {}}
    )
    return result


class TestNullEntries:
    """A null map value or list item reaches the block, which uses it its own way
    (REQ-3.1.3.20, REQ-3.1.3.21)."""

    async def test_a_null_query_value_is_sent_as_an_empty_pair(self, http_server):
        http_server.enqueue(body=b"ok")

        await _run_block(
            {
                "method": "GET",
                "url": f"{http_server.base_url}/items",
                "query_params": {"page": None, "tag": "raw"},
            }
        )

        assert http_server.requests[0]["path"] == "/items?page=&tag=raw"

    async def test_a_null_form_value_is_sent_as_an_empty_pair(self, http_server):
        http_server.enqueue(body=b"ok")

        await _run_block(
            {
                "method": "POST",
                "url": f"{http_server.base_url}/notes",
                "body_mode": "form",
                "form_fields": {"note": None, "user": "alice"},
            }
        )

        assert http_server.requests[0]["body"] == b"note=&user=alice"

    async def test_a_null_retry_code_is_skipped_and_the_others_still_retry(self):
        busy = make_response(status_code=503, text="busy", url="http://example.com/")
        ok = make_response(status_code=200, text="OK", url="http://example.com/")
        request = AsyncMock(side_effect=[busy, ok])

        with patch_async_client(make_client(request)):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await _run_block(
                    {
                        "method": "GET",
                        "url": "http://example.com",
                        "retry_count": 2,
                        "retry_delay": 1,
                        "retryable_status_codes": [None, "503"],
                    }
                )

        assert result["status_code"] == 200
        assert request.call_count == 2

    async def test_a_list_of_only_null_retry_codes_retries_nothing(self):
        client, _ = make_mock_client(status_code=503, text="busy", url="http://example.com/")

        with patch_async_client(client):
            result = await _run_block(
                {
                    "method": "GET",
                    "url": "http://example.com",
                    "retry_count": 3,
                    "retry_delay": 1,
                    "retryable_status_codes": [None],
                }
            )

        assert result["status_code"] == 503
        assert client.request.call_count == 1
