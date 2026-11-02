"""HTTP plugin runtime header key policy (REQ-3.4.1.4).

One key policy, one message set: the FE editor and save validation carry the
design-time wording; when the node executes, dynamically produced (or
re-checked literal) header maps fail BEFORE sending with the source
attributed:

    Headers from <source> contain "<Key>": <design-time sentence, with
    "remove this row" replaced by "remove it there">

`<source>` is `headers` for the literal map, `the headers expression` for
expression maps, or `profile "<name>"` for profile-bound maps; upstream
resolution supplies the rendered label via context["parameter_sources"]
(param name -> label), defaulting to the literal-map label.

Blocklist is Content-Length ONLY: Transfer-Encoding is forwarded
to the transport (rejection there = node failure), and Host and Connection
stay allowed (vhost + keep-alive testing). The blocked-key sentence renders
the key in canonical casing regardless of how the user typed it; the wrapper
keeps the key as typed. Content-Type is an ordinary header; the
mode-conflict rejection is RETIRED - when a body mode
generates a Content-Type, the generated header silently wins at runtime
(pinned in test_http_body_modes.py).
"""

from typing import Any
from unittest.mock import Mock

import pytest

from tests.plugins.http.httpx_fakes import make_mock_client, patch_async_client


def _context(
    parameters: dict[str, Any], parameter_sources: dict[str, str] | None = None
) -> dict[str, Any]:
    context: dict[str, Any] = {
        "parameters": parameters,
        "logger": Mock(),
        "variables": {},
    }
    if parameter_sources is not None:
        context["parameter_sources"] = parameter_sources
    return context


class TestBlockedFramingHeadersAtExecution:
    """Content-Length is the only blocked key; the HTTP stack owns length framing."""

    @pytest.mark.asyncio
    async def test_content_length_in_literal_map_fails_before_sending(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                ValueError,
                match=(
                    r'^Headers from headers contain "Content-Length": '
                    r'Header "Content-Length" cannot be set manually '
                    r"- the HTTP stack blocks length overrides$"
                ),
            ):
                await plugin.execute(
                    _context(
                        {
                            "method": "GET",
                            "url": "http://example.com",
                            "headers": {"Content-Length": "42"},
                        }
                    )
                )

        client.request.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_blocked_key_wrapper_shows_typed_casing_sentence_stays_canonical(self):
        """The wrapper keeps the key as typed; the sentence is canonical."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                ValueError,
                match=(
                    r'^Headers from headers contain "content-length": '
                    r'Header "Content-Length" cannot be set manually '
                    r"- the HTTP stack blocks length overrides$"
                ),
            ):
                await plugin.execute(
                    _context(
                        {
                            "method": "GET",
                            "url": "http://example.com",
                            "headers": {"content-length": "10"},
                        }
                    )
                )


class TestContentTypeIsAnOrdinaryHeader:
    """There is no mode-conflict rejection."""

    @pytest.mark.asyncio
    async def test_text_mode_with_content_type_row_is_allowed(self):
        """Content-Type is an ordinary user-owned header in text mode."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            result = await plugin.execute(
                _context(
                    {
                        "method": "POST",
                        "url": "http://example.com",
                        "body": "{}",
                        "headers": {"Content-Type": "application/json"},
                    }
                )
            )

        assert result["status_code"] == 200
        client.request.assert_awaited_once()
        sent = client.request.call_args.kwargs["headers"]
        assert sent["Content-Type"] == "application/json"

    @pytest.mark.asyncio
    async def test_generating_modes_no_longer_reject_content_type_rows(self):
        """A form-mode Content-Type row executes - the generated header wins silently."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            result = await plugin.execute(
                _context(
                    {
                        "method": "POST",
                        "url": "http://example.com",
                        "body_mode": "form",
                        "form_fields": {"a": "1"},
                        "headers": {"Content-Type": "application/json"},
                    }
                )
            )

        assert result["status_code"] == 200
        sent = client.request.call_args.kwargs["headers"]
        assert sent["Content-Type"] == "application/x-www-form-urlencoded"


class TestAllowedHeadersStayAllowed:
    """Host, Connection, and Transfer-Encoding remain user-settable."""

    @pytest.mark.asyncio
    async def test_transfer_encoding_header_is_forwarded_to_the_transport(self):
        """Manual Transfer-Encoding forwards; the transport owns rejection."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            result = await plugin.execute(
                _context(
                    {
                        "method": "POST",
                        "url": "http://example.com",
                        "body": "x",
                        "headers": {"Transfer-Encoding": "chunked"},
                    }
                )
            )

        assert result["status_code"] == 200
        assert client.request.call_args.kwargs["headers"]["Transfer-Encoding"] == "chunked"

    @pytest.mark.asyncio
    async def test_host_header_is_allowed(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            result = await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": "http://example.com",
                        "headers": {"Host": "virtual.example.com"},
                    }
                )
            )

        assert result["status_code"] == 200
        assert client.request.call_args.kwargs["headers"]["Host"] == "virtual.example.com"

    @pytest.mark.asyncio
    async def test_connection_header_is_allowed(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            result = await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": "http://example.com",
                        "headers": {"Connection": "close"},
                    }
                )
            )

        assert result["status_code"] == 200
        assert client.request.call_args.kwargs["headers"]["Connection"] == "close"


class TestRuntimeHeaderValueCoercion:
    """A whole-value {{ expression }} header resolves to any Python value; HTTP
    requires strings, so the plugin coerces every resolved header VALUE at send
    time (non-str -> str, None -> "", literal strings pass through unchanged)."""

    @pytest.mark.asyncio
    async def test_non_string_expression_value_is_sent_as_a_string(self):
        """A header bound to `abs(-1)` resolves to int 1 and is sent as "1"."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context({"method": "GET", "url": "http://example.com", "headers": {"X-Count": 1}})
            )

        assert client.request.call_args.kwargs["headers"]["X-Count"] == "1"

    @pytest.mark.asyncio
    async def test_empty_expression_value_is_sent_as_empty_string(self):
        """An empty {{}} header resolves to None and is sent as "" (not "None")."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context(
                    {"method": "GET", "url": "http://example.com", "headers": {"X-Empty": None}}
                )
            )

        assert client.request.call_args.kwargs["headers"]["X-Empty"] == ""

    @pytest.mark.asyncio
    async def test_literal_string_value_passes_through_unchanged(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": "http://example.com",
                        "headers": {"X-Tag": "verbatim"},
                    }
                )
            )

        assert client.request.call_args.kwargs["headers"]["X-Tag"] == "verbatim"


class TestSourceAttribution:
    """The execution-time message names the offending source."""

    @pytest.mark.asyncio
    async def test_expression_map_source_is_named(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                ValueError,
                match=(
                    r'^Headers from the headers expression contain "Content-Length": '
                    r'Header "Content-Length" cannot be set manually '
                    r"- the HTTP stack blocks length overrides$"
                ),
            ):
                await plugin.execute(
                    _context(
                        {
                            "method": "GET",
                            "url": "http://example.com",
                            "headers": {"Content-Length": "42"},
                        },
                        parameter_sources={"headers": "the headers expression"},
                    )
                )

    @pytest.mark.asyncio
    async def test_profile_bound_map_source_is_named(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                ValueError,
                match=(
                    r'^Headers from profile "Payments API" contain "Content-Length": '
                    r'Header "Content-Length" cannot be set manually '
                    r"- the HTTP stack blocks length overrides$"
                ),
            ):
                await plugin.execute(
                    _context(
                        {
                            "method": "GET",
                            "url": "http://example.com",
                            "headers": {"Content-Length": "12"},
                        },
                        parameter_sources={"headers": 'profile "Payments API"'},
                    )
                )
