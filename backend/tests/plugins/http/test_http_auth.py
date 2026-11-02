"""HTTP Auth config section + credential registration.

The Auth section composes its header at send time - basic sends
``Authorization: Basic base64(username:password)``, bearer sends
``Authorization: Bearer <token>``, api_key sends ``<header name>: <key>``.
The composed header overwrites any same-named (case-insensitive) header,
including entries arriving from expression-driven maps (already resolved by
execute time). The composed VALUE registers as a run secret at send, with
the block reveal exemption when the mode's secret field is in the block's
``unmasked_secret_fields``. Missing required fields fail fast with exact
messages BEFORE anything is sent.

The catalog-keyed request/response registration suites live here too; there
are no custom expression functions.
"""

import base64
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from tests.plugins.http.httpx_fakes import (
    make_client,
    make_mock_client,
    make_response,
    patch_async_client,
)

_AUTH_PARAM_NAMES = [
    "auth_enabled",
    "auth_mode",
    "auth_username",
    "auth_password",
    "auth_token",
    "auth_header_name",
    "auth_key",
]


def _context(parameters: dict[str, Any], **extra: Any) -> dict[str, Any]:
    context: dict[str, Any] = {"parameters": parameters, "logger": Mock(), "variables": {}}
    context.update(extra)
    return context


def _debug_messages(logger: Mock) -> list[str]:
    return [str(call.args[0]) for call in logger.debug.call_args_list if call.args]


def _basic_value(username: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode("ascii")


def _recorder() -> tuple[list[tuple[Any, bool]], Any]:
    recorded: list[tuple[Any, bool]] = []
    return recorded, lambda value, revealed=False: recorded.append((value, revealed))


class TestAuthParameterMetadata:
    """The 7 Auth section params, declared directly after headers."""

    @staticmethod
    def _params() -> dict[str, dict[str, Any]]:
        from wavecore.plugins.http_client import HTTPClientPlugin

        return {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

    def test_auth_params_follow_headers_in_declaration_order(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        names = [p["name"] for p in HTTPClientPlugin().metadata["parameters"]]
        start = names.index("headers") + 1
        assert names[start : start + 7] == _AUTH_PARAM_NAMES

    def test_auth_enabled_definition(self):
        param = self._params()["auth_enabled"]
        assert param["type"] == "boolean"
        assert param["required"] is False
        assert param["default"] is False

    def test_auth_mode_definition(self):
        param = self._params()["auth_mode"]
        assert param["type"] == "string"
        assert param["required"] is False
        assert param["default"] == "basic"
        assert param["enum_values"] == ["basic", "bearer", "api_key"]
        assert param.get("trim") is True

    def test_auth_username_definition(self):
        param = self._params()["auth_username"]
        assert param["type"] == "string"
        assert param["required"] is False
        assert not param.get("secret")

    def test_auth_header_name_definition(self):
        param = self._params()["auth_header_name"]
        assert param["type"] == "string"
        assert param["required"] is False
        assert param["default"] == "X-API-Key"
        assert param.get("trim") is True

    def test_credential_fields_declare_secret_like_client_key(self):
        """auth_password/auth_token/auth_key follow the client_key pattern exactly."""
        params = self._params()
        reference = params["client_key"]
        for name in ("auth_password", "auth_token", "auth_key"):
            param = params[name]
            assert param["type"] == reference["type"]
            assert param["required"] is False
            assert param["secret"] is reference["secret"]
            assert not param.get("trim")

    def test_credential_fields_are_secret_declared_for_sealing_and_masking(self):
        from wavecore.core.secrets.masking import secret_param_names
        from wavecore.plugins.http_client import HTTPClientPlugin

        names = secret_param_names(HTTPClientPlugin().metadata)
        assert {"auth_password", "auth_token", "auth_key"} <= names


class TestAuthParameterValidation:
    """validate() covers the Auth section's enum and boolean params."""

    @pytest.mark.asyncio
    async def test_validate_auth_mode_must_be_valid(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'auth_mode' must be one of: basic, bearer, api_key; "
                r"Actual value was 'digest'\.$"
            ),
        ):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "auth_mode": "digest"}
            )

    @pytest.mark.asyncio
    async def test_validate_auth_enabled_must_be_boolean(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'auth_enabled' must be a boolean$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "auth_enabled": "yes"}
            )


class TestAuthComposition:
    """Each mode composes its exact header on the wire."""

    @pytest.mark.asyncio
    async def test_basic_mode_composes_the_rfc7617_header_on_the_wire(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "basic",
                    "auth_username": "alice",
                    "auth_password": "wonder-pass",
                }
            )
        )

        sent = http_server.requests[0]["headers"]
        assert sent["authorization"] == _basic_value("alice", "wonder-pass")

    @pytest.mark.asyncio
    async def test_basic_mode_sends_a_numeric_username_and_password_as_text(self, http_server):
        """A whole-value expression can resolve either row to a number."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        http_server.enqueue(body=b"ok")

        await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "basic",
                    "auth_username": 1001,
                    "auth_password": 246810,
                }
            )
        )

        sent = http_server.requests[0]["headers"]
        assert sent["authorization"] == _basic_value("1001", "246810")

    @pytest.mark.asyncio
    async def test_bearer_mode_composes_the_rfc6750_header_on_the_wire(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "bearer",
                    "auth_token": "tok-11223344",
                }
            )
        )

        assert http_server.requests[0]["headers"]["authorization"] == "Bearer tok-11223344"

    @pytest.mark.asyncio
    async def test_api_key_mode_sends_the_key_under_the_configured_header(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "api_key",
                    "auth_header_name": "X-API-Key",
                    "auth_key": "ak-99887766",
                }
            )
        )

        assert http_server.requests[0]["headers"]["x-api-key"] == "ak-99887766"

    @pytest.mark.asyncio
    async def test_api_key_mode_honors_a_custom_header_name(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "api_key",
                    "auth_header_name": "X-Custom-Key",
                    "auth_key": "ck-55443322",
                }
            )
        )

        assert http_server.requests[0]["headers"]["x-custom-key"] == "ck-55443322"

    @pytest.mark.asyncio
    async def test_auth_mode_defaults_to_basic_when_absent(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_username": "bob",
                    "auth_password": "builder-pass",
                }
            )
        )

        sent = http_server.requests[0]["headers"]
        assert sent["authorization"] == _basic_value("bob", "builder-pass")


class TestAuthHeaderOverwrite:
    """The composed header overwrites same-named headers case-insensitively."""

    @pytest.mark.asyncio
    async def test_composed_header_overwrites_a_manual_header(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "headers": {"AUTHORIZATION": "Bearer manual-token-1"},
                    "auth_enabled": True,
                    "auth_mode": "basic",
                    "auth_username": "alice",
                    "auth_password": "wonder-pass",
                }
            )
        )

        request = http_server.requests[0]
        auth_rows = [v for n, v in request["raw_headers"] if n.lower() == "authorization"]
        assert auth_rows == [_basic_value("alice", "wonder-pass")]

    @pytest.mark.asyncio
    async def test_composed_header_overwrites_an_expression_map_header(self, http_server):
        """Expression-driven map headers are resolved by send time; auth still wins."""
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.plugins.http_client import HTTPClientPlugin

        resolved = resolve_parameters(
            parameters={"headers": {"Authorization": "'Bearer ' + tok"}},
            expression_fields=set(),
            variables={"tok": "map-token-1234"},
            parameter_types={"headers": "map"},
            map_expression_keys={"headers": {"Authorization"}},
        )
        assert resolved["headers"]["Authorization"] == "Bearer map-token-1234"

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "headers": resolved["headers"],
                    "auth_enabled": True,
                    "auth_mode": "bearer",
                    "auth_token": "real-token-5678",
                }
            )
        )

        request = http_server.requests[0]
        auth_rows = [v for n, v in request["raw_headers"] if n.lower() == "authorization"]
        assert auth_rows == ["Bearer real-token-5678"]

    @pytest.mark.asyncio
    async def test_api_key_overwrite_matches_the_custom_name_case_insensitively(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "headers": {"x-api-key": "manual-key-0"},
                    "auth_enabled": True,
                    "auth_mode": "api_key",
                    "auth_header_name": "X-API-Key",
                    "auth_key": "ak-99887766",
                }
            )
        )

        request = http_server.requests[0]
        key_rows = [v for n, v in request["raw_headers"] if n.lower() == "x-api-key"]
        assert key_rows == ["ak-99887766"]

    @pytest.mark.asyncio
    async def test_unrelated_manual_headers_survive_composition(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "headers": {"X-Trace-Id": "trace-42"},
                    "auth_enabled": True,
                    "auth_mode": "bearer",
                    "auth_token": "tok-11223344",
                }
            )
        )

        sent = http_server.requests[0]["headers"]
        assert sent["x-trace-id"] == "trace-42"
        assert sent["authorization"] == "Bearer tok-11223344"


class TestAuthRequiredFieldGuards:
    """Missing required fields raise the exact messages BEFORE sending."""

    @pytest.mark.asyncio
    async def test_basic_mode_missing_password_fails_before_sending(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match='^Auth mode "Basic" requires Username and Password$'):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{http_server.base_url}/auth",
                        "auth_enabled": True,
                        "auth_mode": "basic",
                        "auth_username": "alice",
                    }
                )
            )
        assert http_server.requests == []

    @pytest.mark.asyncio
    async def test_basic_mode_empty_username_fails(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match='^Auth mode "Basic" requires Username and Password$'):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{http_server.base_url}/auth",
                        "auth_enabled": True,
                        "auth_mode": "basic",
                        "auth_username": "",
                        "auth_password": "wonder-pass",
                    }
                )
            )
        assert http_server.requests == []

    @pytest.mark.asyncio
    async def test_bearer_mode_missing_token_fails(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match='^Auth mode "Bearer token" requires a Token$'):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{http_server.base_url}/auth",
                        "auth_enabled": True,
                        "auth_mode": "bearer",
                    }
                )
            )
        assert http_server.requests == []

    @pytest.mark.asyncio
    async def test_api_key_mode_missing_key_fails(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match='^Auth mode "API key" requires Header Name and Key$'):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{http_server.base_url}/auth",
                        "auth_enabled": True,
                        "auth_mode": "api_key",
                        "auth_header_name": "X-API-Key",
                    }
                )
            )
        assert http_server.requests == []

    @pytest.mark.asyncio
    async def test_api_key_mode_empty_header_name_fails(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match='^Auth mode "API key" requires Header Name and Key$'):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{http_server.base_url}/auth",
                        "auth_enabled": True,
                        "auth_mode": "api_key",
                        "auth_header_name": "",
                        "auth_key": "ak-99887766",
                    }
                )
            )
        assert http_server.requests == []


class TestAuthDisabled:
    """auth_enabled off (explicit or absent) composes nothing."""

    @pytest.mark.asyncio
    async def test_explicit_false_sends_no_composed_header(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": False,
                    "auth_mode": "basic",
                    "auth_username": "alice",
                    "auth_password": "wonder-pass",
                }
            )
        )

        assert "authorization" not in http_server.requests[0]["headers"]

    @pytest.mark.asyncio
    async def test_absent_flag_sends_no_composed_header(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_mode": "bearer",
                    "auth_token": "tok-11223344",
                }
            )
        )

        assert "authorization" not in http_server.requests[0]["headers"]

    @pytest.mark.asyncio
    async def test_disabled_auth_leaves_manual_headers_untouched(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "headers": {"Authorization": "Bearer manual-token-1"},
                    "auth_enabled": False,
                    "auth_username": "alice",
                    "auth_password": "wonder-pass",
                }
            )
        )

        assert http_server.requests[0]["headers"]["authorization"] == "Bearer manual-token-1"


class TestAuthComposedValueRegistration:
    """The composed VALUE registers as a run secret; the mode's secret field
    drives the block reveal exemption."""

    @pytest.mark.asyncio
    async def test_composed_basic_value_registers_unrevealed(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        registered, register = _recorder()

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "basic",
                    "auth_username": "alice",
                    "auth_password": "wonder-pass",
                },
                register_secret=register,
            )
        )

        assert (_basic_value("alice", "wonder-pass"), False) in registered

    @pytest.mark.asyncio
    async def test_revealed_password_exempts_every_registration_of_the_value(self, http_server):
        """No plain registration may clobber the exemption (protection wins in
        the registry, so a single revealed=False entry would defeat the reveal)."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        registered, register = _recorder()
        composed = _basic_value("alice", "wonder-pass")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "basic",
                    "auth_username": "alice",
                    "auth_password": "wonder-pass",
                },
                register_secret=register,
                unmasked_secret_fields=["auth_password"],
            )
        )

        assert (composed, True) in registered
        assert (composed, False) not in registered

    @pytest.mark.asyncio
    async def test_revealed_token_exempts_the_bearer_value(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        registered, register = _recorder()

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "bearer",
                    "auth_token": "tok-11223344",
                },
                register_secret=register,
                unmasked_secret_fields=["auth_token"],
            )
        )

        assert ("Bearer tok-11223344", True) in registered
        assert ("Bearer tok-11223344", False) not in registered

    @pytest.mark.asyncio
    async def test_api_key_value_registers_even_for_a_noncatalog_header_name(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        registered, register = _recorder()

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "api_key",
                    "auth_header_name": "X-Custom-Key",
                    "auth_key": "ck-55443322",
                },
                register_secret=register,
            )
        )

        assert ("ck-55443322", False) in registered

    @pytest.mark.asyncio
    async def test_revealed_key_exempts_the_api_key_value(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        registered, register = _recorder()

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "api_key",
                    "auth_header_name": "X-Custom-Key",
                    "auth_key": "ck-55443322",
                },
                register_secret=register,
                unmasked_secret_fields=["auth_key"],
            )
        )

        assert ("ck-55443322", True) in registered
        assert ("ck-55443322", False) not in registered

    @pytest.mark.asyncio
    async def test_revealing_an_unrelated_field_does_not_exempt(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        registered, register = _recorder()
        composed = _basic_value("alice", "wonder-pass")

        await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "basic",
                    "auth_username": "alice",
                    "auth_password": "wonder-pass",
                },
                register_secret=register,
                unmasked_secret_fields=["auth_token"],
            )
        )

        assert (composed, False) in registered
        assert (composed, True) not in registered

    @pytest.mark.asyncio
    async def test_composition_without_register_secret_still_sends(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/auth",
                    "auth_enabled": True,
                    "auth_mode": "bearer",
                    "auth_token": "tok-11223344",
                }
            )
        )

        assert result["status_code"] == 200
        assert http_server.requests[0]["headers"]["authorization"] == "Bearer tok-11223344"


class TestAuthComposedTraceMasking:
    """Composed Authorization rides the catalog name-masking in DEBUG entries."""

    @pytest.mark.asyncio
    async def test_composed_authorization_renders_masked_in_debug_entries(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        logger = Mock()
        composed = _basic_value("alice", "wonder-pass")
        context = _context(
            {
                "method": "GET",
                "url": f"{http_server.base_url}/auth",
                "auth_enabled": True,
                "auth_mode": "basic",
                "auth_username": "alice",
                "auth_password": "wonder-pass",
            }
        )
        context["logger"] = logger

        await plugin.execute(context)

        debug = _debug_messages(logger)
        assert any("> Authorization: ********" in line for line in debug)
        assert not any(composed in line for line in debug)

    @pytest.mark.asyncio
    async def test_revealed_mode_field_keeps_the_composed_header_raw(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        logger = Mock()
        composed = _basic_value("alice", "wonder-pass")
        context = _context(
            {
                "method": "GET",
                "url": f"{http_server.base_url}/auth",
                "auth_enabled": True,
                "auth_mode": "basic",
                "auth_username": "alice",
                "auth_password": "wonder-pass",
            }
        )
        context["logger"] = logger
        context["unmasked_secret_fields"] = ["auth_password"]

        result = await plugin.execute(context)

        assert any(f"> Authorization: {composed}" in line for line in _debug_messages(logger))
        hop_values = [
            value
            for name, value in result["trace"]["hops"][-1]["request"]["headers"]
            if name.lower() == "authorization"
        ]
        assert hop_values == [composed]


class TestRequestCredentialHeaderRegistration:
    """Request header values under the credential catalog register at send
    time - mirroring the response side (HTTP-5)."""

    @pytest.mark.asyncio
    async def test_authorization_request_header_value_registers(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        registered: list[Any] = []
        client, _ = make_mock_client(headers={"Content-Type": "text/plain"}, text="OK")

        with patch_async_client(client):
            await plugin.execute(
                {
                    "parameters": {
                        "method": "GET",
                        "url": "http://example.com",
                        "headers": {
                            "Authorization": "Bearer tok-abc-123",
                            "X-Custom": "visible-value",
                        },
                    },
                    "logger": Mock(),
                    "variables": {},
                    "register_secret": lambda value, revealed=False: registered.append(
                        (value, revealed)
                    ),
                }
            )

        assert ("Bearer tok-abc-123", False) in registered
        assert all(value != "visible-value" for value, _ in registered)

    @pytest.mark.asyncio
    async def test_catalog_match_is_case_insensitive_for_request_headers(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        registered: list[Any] = []
        client, _ = make_mock_client(headers={"Content-Type": "text/plain"}, text="OK")

        with patch_async_client(client):
            await plugin.execute(
                {
                    "parameters": {
                        "method": "GET",
                        "url": "http://example.com",
                        "headers": {"x-api-key": "ak-112233445566"},
                    },
                    "logger": Mock(),
                    "variables": {},
                    "register_secret": lambda value, revealed=False: registered.append(
                        (value, revealed)
                    ),
                }
            )

        assert ("ak-112233445566", False) in registered

    @pytest.mark.asyncio
    async def test_revealed_request_header_registers_flagged_revealed(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        registered: list[Any] = []
        client, _ = make_mock_client(headers={"Content-Type": "text/plain"}, text="OK")

        with patch_async_client(client):
            await plugin.execute(
                {
                    "parameters": {
                        "method": "GET",
                        "url": "http://example.com",
                        "headers": {"Authorization": "Bearer tok-abc-123"},
                    },
                    "logger": Mock(),
                    "variables": {},
                    "register_secret": lambda value, revealed=False: registered.append(
                        (value, revealed)
                    ),
                    "unmasked_secret_fields": ["authorization"],
                }
            )

        assert ("Bearer tok-abc-123", True) in registered

    @pytest.mark.asyncio
    async def test_request_registration_without_register_secret_still_works(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(headers={"Content-Type": "text/plain"}, text="OK")

        with patch_async_client(client):
            result = await plugin.execute(
                {
                    "parameters": {
                        "method": "GET",
                        "url": "http://example.com",
                        "headers": {"Authorization": "Bearer tok-abc-123"},
                    },
                    "logger": Mock(),
                    "variables": {},
                }
            )

        assert result["status_code"] == 200


class TestHTTPPluginResponseCredentialRegistration:
    """Response credential-header VALUES register with the run registry."""

    @staticmethod
    def _make_client(response_headers: dict[str, str]) -> AsyncMock:
        resp = make_response(
            status_code=200,
            reason_phrase="OK",
            headers=response_headers,
            text="OK",
            url="http://example.com/",
        )
        return make_client(AsyncMock(return_value=resp))

    @pytest.mark.asyncio
    async def test_response_credential_headers_register_their_full_values(self):
        """Set-Cookie registers INCLUDING its attribute tail."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        registered: list[Any] = []
        client = self._make_client(
            {
                "Content-Type": "text/plain",
                "Set-Cookie": "session=tok-c00kie-99; Path=/; HttpOnly",
                "X-Auth-Token": "auth-t0ken-value-1",
            }
        )

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
                "register_secret": lambda value, revealed=False: registered.append(value),
            }

            result = await plugin.execute(context)

        assert "session=tok-c00kie-99; Path=/; HttpOnly" in registered
        assert "auth-t0ken-value-1" in registered
        assert "text/plain" not in registered
        # The output itself stays viewable - only the credential bytes register.
        assert result["headers"]["Set-Cookie"] == "session=tok-c00kie-99; Path=/; HttpOnly"

    @pytest.mark.asyncio
    async def test_execution_without_register_secret_facility_still_works(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client = self._make_client(
            {"Content-Type": "text/plain", "Set-Cookie": "session=tok-c00kie-99"}
        )

        with patch_async_client(client):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
            }

            result = await plugin.execute(context)

        assert result["status_code"] == 200


class TestHTTPPluginPerFieldRegistrationGating:
    """REQ-3.1.3.16: _register_response_credentials registers every credential
    header run-wide; a revealed field still registers but is flagged
    ``revealed=True`` so the harness exempts only THIS block's own display lines.
    A revealed field must never disable scrubbing for any other block.
    """

    _HEADERS = {
        "Set-Cookie": "session=tok-c00kie-99; Path=/; HttpOnly",
        "X-Auth-Token": "auth-t0ken-value-1",
        "Content-Type": "text/plain",
    }

    def test_registers_all_sensitive_when_nothing_revealed(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        recorded, register = _recorder()
        plugin._register_response_credentials(dict(self._HEADERS), register, reveal=set())
        values = {value for value, _ in recorded}
        assert "session=tok-c00kie-99; Path=/; HttpOnly" in values
        assert "auth-t0ken-value-1" in values
        assert "text/plain" not in values
        assert all(revealed is False for _, revealed in recorded)

    def test_revealed_field_registers_flagged_revealed(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        recorded, register = _recorder()
        plugin._register_response_credentials(dict(self._HEADERS), register, reveal={"set-cookie"})
        assert ("session=tok-c00kie-99; Path=/; HttpOnly", True) in recorded
        assert ("auth-t0ken-value-1", False) in recorded

    def test_reveal_matches_header_name_case_insensitively(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        recorded, register = _recorder()
        plugin._register_response_credentials(
            {"Set-Cookie": "session=tok-c00kie-99; HttpOnly"},
            register,
            reveal={"set-cookie"},
        )
        assert recorded == [("session=tok-c00kie-99; HttpOnly", True)]

    def test_non_callable_register_secret_is_a_noop_with_reveal(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        # Should not raise even when a reveal set is supplied.
        plugin._register_response_credentials(
            {"Set-Cookie": "session=tok-c00kie-99"}, None, reveal={"authorization"}
        )


class TestHTTPPluginExecuteHonorsRevealSet:
    """REQ-3.1.3.16: execute() reads ``context['unmasked_secret_fields']`` and
    threads the reveal set into response-credential registration."""

    @staticmethod
    def _make_client(response_headers: dict[str, str]) -> AsyncMock:
        resp = make_response(
            status_code=200,
            reason_phrase="OK",
            headers=response_headers,
            text="OK",
            url="http://example.com/",
        )
        return make_client(AsyncMock(return_value=resp))

    @pytest.mark.asyncio
    async def test_default_execution_registers_response_credential(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        registered: list[Any] = []
        token = "session=tok-c00kie-99; Path=/; HttpOnly"

        with patch_async_client(
            self._make_client({"Content-Type": "text/plain", "Set-Cookie": token})
        ):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
                "register_secret": lambda value, revealed=False: registered.append(
                    (value, revealed)
                ),
            }
            await plugin.execute(context)

        assert (token, False) in registered

    @pytest.mark.asyncio
    async def test_revealed_field_still_registers_with_block_exemption(self):
        """A revealed field still registers run-wide; the reveal only exempts
        this block's own display lines (it is signaled via revealed=True)."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        registered: list[Any] = []
        token = "session=tok-c00kie-99; Path=/; HttpOnly"

        with patch_async_client(
            self._make_client({"Content-Type": "text/plain", "Set-Cookie": token})
        ):
            context = {
                "parameters": {"method": "GET", "url": "http://example.com"},
                "logger": Mock(),
                "variables": {},
                "register_secret": lambda value, revealed=False: registered.append(
                    (value, revealed)
                ),
                "unmasked_secret_fields": ["set-cookie"],
            }
            await plugin.execute(context)

        assert (token, True) in registered


class TestHTTPPluginSecretMaskFieldsCatalog:
    """REQ-3.1.3.16: the credential-field catalog lives in plugin metadata as
    ``secret_mask_fields`` so the engine harness reads it declaratively. Its FE
    twin (``SECRET_MASK_FIELDS['http-client']``) pins the same set, so the two
    declarations cannot silently diverge. Request-side registration reuses the
    same catalog.
    """

    def test_metadata_secret_mask_fields_is_the_canonical_eight(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        assert set(plugin.metadata["secret_mask_fields"]) == {
            "authorization",
            "proxy-authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
            "x-auth-token",
            "x-csrf-token",
            "x-xsrf-token",
        }

    def test_metadata_secret_mask_fields_are_all_lowercase(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        catalog = plugin.metadata["secret_mask_fields"]
        assert catalog == [name.lower() for name in catalog]
