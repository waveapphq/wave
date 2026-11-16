"""HTTP wire-level evidence trace (REQ-3.4.1.4).

Every run leaves a wire-level evidence trail. INFO keeps today's summary
lines. At DEBUG the node logs COMBINED multiline entries - connection
establishment (+ negotiated TLS), one entry per exchange (every redirect hop
and retry attempt is an exchange, headers as actually sent/received), and a
timing breakdown - so a 1-redirect GET yields 4 DEBUG entries, not 13; a
plain GET yields 3. Bodies never appear in the trace (sizes only). The same
facts surface as the structured `trace` output:

- tls: {protocol, cipher, peer_subject, peer_issuer, not_before, not_after,
  days_to_expiry} (empty map for plain HTTP)
- timing: {dns_ms, connect_ms, tls_ms, first_byte_ms, download_ms, total_ms}
- hops: ordered [{kind: redirect|retry|final, request: {method, url, headers:
  [[name, value], ...]}, response: {status, reason, headers: [[name, value],
  ...]}, duration_ms}] - header lists preserve order and duplicates
- sizes: {request_body, response} (bytes)

Masking stays value-based: header values flow through the node logger (the
registry-aware surface scrubs them downstream) and credential values register
at send time.
"""

from typing import Any
from unittest.mock import AsyncMock, Mock

import httpx
import pytest

from tests.plugins.http.httpx_fakes import make_client, make_mock_client, patch_async_client


def _context(parameters: dict[str, Any], **extra: Any) -> dict[str, Any]:
    context: dict[str, Any] = {"parameters": parameters, "logger": Mock(), "variables": {}}
    context.update(extra)
    return context


def _debug_messages(logger: Mock) -> list[str]:
    return [str(call.args[0]) for call in logger.debug.call_args_list if call.args]


def _info_messages(logger: Mock) -> list[str]:
    return [str(call.args[0]) for call in logger.info.call_args_list if call.args]


class TestTraceOutputStructure:
    """The structured `trace` output map (minimum schema contract)."""

    @pytest.mark.asyncio
    async def test_trace_carries_the_four_top_level_sections(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"trace-me")

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/data"})
        )

        trace = result["trace"]
        assert set(trace) >= {"tls", "timing", "hops", "sizes"}

    @pytest.mark.asyncio
    async def test_tls_section_is_empty_for_plain_http(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"plain")

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/data"})
        )

        assert result["trace"]["tls"] == {}

    @pytest.mark.asyncio
    async def test_timing_breakdown_carries_all_six_phases(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"timed")

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/data"})
        )

        timing = result["trace"]["timing"]
        for key in ("dns_ms", "connect_ms", "tls_ms", "first_byte_ms", "download_ms", "total_ms"):
            assert key in timing
            assert isinstance(timing[key], int | float)
            assert timing[key] >= 0

    @pytest.mark.asyncio
    async def test_single_exchange_yields_one_final_hop(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"hop-body")

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/single"})
        )

        hops = result["trace"]["hops"]
        assert len(hops) == 1
        hop = hops[0]
        assert hop["kind"] == "final"
        assert hop["request"]["method"] == "GET"
        assert hop["request"]["url"] == f"{http_server.base_url}/single"
        assert any(name.lower() == "host" for name, _ in hop["request"]["headers"])
        assert hop["response"]["status"] == 200
        assert hop["response"]["reason"] == "OK"
        assert isinstance(hop["duration_ms"], int | float)

    @pytest.mark.asyncio
    async def test_sizes_report_request_and_response_bytes(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"0123456789")

        result = await plugin.execute(
            _context(
                {
                    "method": "POST",
                    "url": f"{http_server.base_url}/data",
                    "body": "req-body",
                }
            )
        )

        sizes = result["trace"]["sizes"]
        assert sizes["request_body"] == len(b"req-body")
        assert sizes["response"] == len(b"0123456789")

    @pytest.mark.asyncio
    async def test_redirect_hops_are_ordered_redirect_then_final(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(status=301, headers=[("Location", "/final")], body=b"")
        http_server.enqueue(body=b"landed")

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/hop"})
        )

        hops = result["trace"]["hops"]
        assert [hop["kind"] for hop in hops] == ["redirect", "final"]
        assert [hop["response"]["status"] for hop in hops] == [301, 200]

    @pytest.mark.asyncio
    async def test_retry_attempts_appear_as_retry_hops(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(status=503, body=b"busy")
        http_server.enqueue(body=b"recovered")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/flaky",
                    "retry_count": 1,
                    "retry_delay": 0.01,
                    "retryable_status_codes": ["503"],
                }
            )
        )

        hops = result["trace"]["hops"]
        assert [hop["kind"] for hop in hops] == ["retry", "final"]
        assert [hop["response"]["status"] for hop in hops] == [503, 200]

    @pytest.mark.asyncio
    async def test_duplicate_response_headers_preserved_ordered_in_trace(self, http_server):
        """The trace keeps duplicates ordered; the headers OUTPUT stays a map.

        Catalog-keyed values (Set-Cookie) carry the placeholder in
        the hop structure; non-catalog duplicates stay raw and ordered."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(
            body=b"cookies",
            headers=[
                ("Set-Cookie", "first=1; Path=/"),
                ("Set-Cookie", "second=2; Path=/"),
                ("X-Tag", "alpha"),
                ("X-Tag", "beta"),
            ],
        )

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/cookies"})
        )

        hop = result["trace"]["hops"][-1]
        cookie_values = [
            value for name, value in hop["response"]["headers"] if name.lower() == "set-cookie"
        ]
        tag_values = [
            value for name, value in hop["response"]["headers"] if name.lower() == "x-tag"
        ]
        assert cookie_values == ["********", "********"]
        assert tag_values == ["alpha", "beta"]
        assert isinstance(result["headers"], dict)

    async def test_an_empty_catalog_header_stays_empty_in_the_trace(self, http_server):
        """An empty credential holds nothing, so nothing is masked (REQ-4.5.1)."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(
            body=b"cookies", headers=[("Set-Cookie", ""), ("Set-Cookie", "second=2; Path=/")]
        )

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/cookies"})
        )

        hop = result["trace"]["hops"][-1]
        cookie_values = [
            value for name, value in hop["response"]["headers"] if name.lower() == "set-cookie"
        ]
        assert cookie_values == ["", "********"]


class TestTraceTLSSection:
    """Negotiated TLS facts against a real local TLS server."""

    @pytest.mark.asyncio
    async def test_tls_section_carries_protocol_cipher_and_peer_identity(
        self, tls_server, tls_material
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"secure")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/secure",
                    "ca_cert": tls_material.ca_cert_path,
                }
            )
        )

        tls = result["trace"]["tls"]
        assert str(tls["protocol"]).startswith("TLSv")
        assert tls["cipher"]
        assert "wave-test-server" in str(tls["peer_subject"])
        assert "wave-test-ca" in str(tls["peer_issuer"])
        assert tls["not_before"]
        assert tls["not_after"]
        assert isinstance(tls["days_to_expiry"], int)
        assert 90 <= tls["days_to_expiry"] <= 100


class TestTraceTLSDegradedFacts:
    """TLS facts degrade honestly when the handshake evidence is partial."""

    @pytest.mark.asyncio
    async def test_tls_facts_stay_empty_without_an_ssl_object(self):
        """A TLS-complete event over a stream exposing no ssl_object adds nothing."""
        from wavecore.plugins.http_client import HTTPClientPlugin, _RequestRun

        run = _RequestRun()
        stream = Mock()
        stream.get_extra_info = Mock(return_value=None)
        await run.collector.on_event("connection.start_tls.complete", {"return_value": stream})

        trace = HTTPClientPlugin()._build_trace(run)

        assert trace["tls"] == {}

    @pytest.mark.asyncio
    async def test_missing_peer_chain_reports_empty_cert_facts(self):
        """A handshake without a captured peer DER keeps protocol/cipher, zeroes the cert."""
        from wavecore.plugins.http_client import HTTPClientPlugin, _NegotiatedTLS, _RequestRun
        from wavecore.plugins.http_tls import HandshakeResult

        result = HandshakeResult(
            connection=None, version="TLSv1.3", cipher="TLS_AES_256_GCM_SHA384"
        )
        stream = Mock()
        stream.get_extra_info = Mock(return_value=_NegotiatedTLS(result))
        run = _RequestRun()
        await run.collector.on_event("connection.start_tls.complete", {"return_value": stream})

        trace = HTTPClientPlugin()._build_trace(run)

        assert trace["tls"]["protocol"] == "TLSv1.3"
        assert trace["tls"]["cipher"] == "TLS_AES_256_GCM_SHA384"
        assert trace["tls"]["peer_subject"] == ""
        assert trace["tls"]["peer_issuer"] == ""
        assert trace["tls"]["not_before"] == ""
        assert trace["tls"]["not_after"] == ""
        assert trace["tls"]["days_to_expiry"] == 0


class TestCombinedDebugEntries:
    """DEBUG renders combined multiline entries: connect+TLS / per exchange / timing."""

    @pytest.mark.asyncio
    async def test_plain_get_emits_exactly_three_debug_entries(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=b"three-entries")

        context = _context({"method": "GET", "url": f"{http_server.base_url}/data"})
        context["logger"] = logger
        await plugin.execute(context)

        assert len(_debug_messages(logger)) == 3

    @pytest.mark.asyncio
    async def test_one_redirect_get_emits_exactly_four_debug_entries(self, http_server):
        """4 entries for a redirect GET, not 13."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(status=301, headers=[("Location", "/final")], body=b"")
        http_server.enqueue(body=b"landed-content")

        context = _context({"method": "GET", "url": f"{http_server.base_url}/hop"})
        context["logger"] = logger
        await plugin.execute(context)

        debug = _debug_messages(logger)
        assert len(debug) == 4
        assert any("301" in msg and "/hop" in msg for msg in debug)
        assert any("200" in msg for msg in debug)

    @pytest.mark.asyncio
    async def test_bodies_never_appear_in_debug_entries(self, http_server):
        """Bodies are excluded from the trace - sizes only."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=b"response-secret-payload")

        context = _context(
            {
                "method": "POST",
                "url": f"{http_server.base_url}/data",
                "body": "request-secret-payload",
            }
        )
        context["logger"] = logger
        await plugin.execute(context)

        for msg in _debug_messages(logger):
            assert "request-secret-payload" not in msg
            assert "response-secret-payload" not in msg

    @pytest.mark.asyncio
    async def test_headers_actually_sent_appear_and_credential_value_registers(self, http_server):
        """Trace shows the headers as sent; masking stays value-based: the
        credential bytes register at send time so every downstream surface
        (including these very entries) scrubs them via the run registry."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        registered: list[Any] = []
        http_server.enqueue(body=b"authed")

        context = _context(
            {
                "method": "GET",
                "url": f"{http_server.base_url}/private",
                "headers": {"Authorization": "Bearer tr4ce-t0ken-1"},
            }
        )
        context["logger"] = logger
        context["register_secret"] = lambda value, revealed=False: registered.append(value)
        await plugin.execute(context)

        debug = _debug_messages(logger)
        assert any("Authorization" in msg for msg in debug)
        assert "Bearer tr4ce-t0ken-1" in registered

    @pytest.mark.asyncio
    async def test_info_summary_lines_are_unchanged(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=b"summary")

        url = f"{http_server.base_url}/data"
        context = _context({"method": "GET", "url": url})
        context["logger"] = logger
        await plugin.execute(context)

        info = _info_messages(logger)
        assert f"HTTP GET {url} (timeout: 30s)" in info
        assert any(msg.startswith("HTTP 200 OK (") for msg in info)

    @pytest.mark.asyncio
    async def test_redirect_info_line_is_unchanged(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(status=301, headers=[("Location", "/final")], body=b"")
        http_server.enqueue(body=b"landed")

        context = _context({"method": "GET", "url": f"{http_server.base_url}/hop"})
        context["logger"] = logger
        await plugin.execute(context)

        assert any(msg.startswith("Redirected to: ") for msg in _info_messages(logger))


class TestResponseCredentialTraceMasking:
    """Secret leak via response trace: catalog credential
    response headers must register BEFORE the combined DEBUG entries are
    emitted (the run-log scrub applies at emission time), and the structured
    trace output must mask through the same registry path as other outputs."""

    _COOKIE = "wave_session=wave-guard-c00kie-9917; Path=/; HttpOnly"
    _TOKEN = "wave-guard-c00kie-9917"

    @staticmethod
    def _scrubbing_capture():
        """A logger that scrubs at emission time, mimicking the add_log chokepoint."""
        from wavecore.core.secrets.masking import mask_text
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        lines: list[str] = []

        class _EmissionScrubLogger:
            def _emit(self, message: Any) -> None:
                lines.append(mask_text(str(message), registry.scan_values()))

            def info(self, message: Any) -> None:
                self._emit(message)

            def debug(self, message: Any) -> None:
                self._emit(message)

            def warning(self, message: Any) -> None:
                self._emit(message)

        return _EmissionScrubLogger(), registry, lines

    def _cookie_context(self, url: str) -> tuple[dict[str, Any], Any, list[str]]:
        logger, registry, lines = self._scrubbing_capture()
        context = _context({"method": "GET", "url": url})
        context["logger"] = logger
        context["register_secret"] = lambda value, revealed=False: registry.register_value(
            value, "plugin:http-client"
        )
        return context, registry, lines

    @pytest.mark.asyncio
    async def test_set_cookie_renders_masked_in_the_combined_debug_entry(self, http_server):
        # Register before emission
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"cookie-set", headers=[("Set-Cookie", self._COOKIE)])
        context, _, lines = self._cookie_context(f"{http_server.base_url}/cookie")

        await plugin.execute(context)

        assert any("< Set-Cookie: ********" in line for line in lines)
        for line in lines:
            assert self._TOKEN not in line

    @pytest.mark.asyncio
    async def test_redirect_hop_set_cookie_never_leaks_into_any_emitted_line(self, http_server):
        # Intermediate hops register too
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(
            status=302,
            headers=[("Location", "/landing"), ("Set-Cookie", self._COOKIE)],
            body=b"",
        )
        http_server.enqueue(body=b"landed")
        context, _, lines = self._cookie_context(f"{http_server.base_url}/hop")

        await plugin.execute(context)

        assert any("< Set-Cookie: ********" in line for line in lines)
        for line in lines:
            assert self._TOKEN not in line

    @pytest.mark.asyncio
    async def test_marked_headers_output_masks_noncatalog_header_in_debug_entry(self, http_server):
        # User-marked headers output
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        secret = "cnr6-style-custom-header-secret"
        http_server.enqueue(body=b"payload", headers=[("X-Custom-Session", secret)])
        context, _, lines = self._cookie_context(f"{http_server.base_url}/payload")
        context["output_secret_fields"] = ["headers"]

        await plugin.execute(context)

        assert any("< X-Custom-Session: ********" in line for line in lines)
        for line in lines:
            assert secret not in line

    @pytest.mark.asyncio
    async def test_unmarked_noncatalog_header_stays_visible_in_debug_entry(self, http_server):
        # Boundary guard: no blanket masking without the headers-output marking
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"payload", headers=[("X-Request-Id", "req-42-visible")])
        context, _, lines = self._cookie_context(f"{http_server.base_url}/payload")

        await plugin.execute(context)

        assert any("< X-Request-Id: req-42-visible" in line for line in lines)

    @pytest.mark.asyncio
    async def test_trace_output_map_masks_through_the_shared_registry_path(self, http_server):
        # Trace output rides mask_structure
        # Catalog-keyed hop values mask by NAME in the structure itself
        from wavecore.core.secrets.masking import mask_structure
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"cookie-set", headers=[("Set-Cookie", self._COOKIE)])
        context, registry, _ = self._cookie_context(f"{http_server.base_url}/cookie")

        result = await plugin.execute(context)

        hop_values = [
            value
            for name, value in result["trace"]["hops"][-1]["response"]["headers"]
            if name.lower() == "set-cookie"
        ]
        assert hop_values == ["********"]
        assert result["headers"]["set-cookie"] == self._COOKIE
        masked = mask_structure({"trace": result["trace"], "headers": result["headers"]}, registry)
        assert self._TOKEN not in str(masked)


class TestCatalogHeaderNameMasking:
    """Short-credential trace leak: catalog-keyed
    header values mask BY NAME in the hop structure and every rendered line,
    regardless of value length - the value-scrub floor must not apply to
    headers the plugin itself declares credential."""

    @pytest.mark.asyncio
    async def test_short_catalog_request_header_masks_by_name_in_debug_entry(self, http_server):
        # Guard: 'X-Api-Key: open' (below scan floor) leaked raw
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        logger = Mock()
        context = _context(
            {
                "method": "GET",
                "url": f"{http_server.base_url}/data",
                "headers": {"X-Api-Key": "open"},
            }
        )
        context["logger"] = logger

        await plugin.execute(context)

        debug = _debug_messages(logger)
        assert any("> X-Api-Key: ********" in line for line in debug)
        assert not any("> X-Api-Key: open" in line for line in debug)

    @pytest.mark.asyncio
    async def test_short_catalog_response_header_masks_by_name_in_trace_output(self, http_server):
        # Guard: short catalog values must not ride raw in the trace output
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok", headers=[("Set-Cookie", "sid=1")])

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/data"})
        )

        hop_values = [
            value
            for name, value in result["trace"]["hops"][-1]["response"]["headers"]
            if name.lower() == "set-cookie"
        ]
        assert hop_values == ["********"]

    @pytest.mark.asyncio
    async def test_revealed_catalog_header_stays_raw_in_hop_and_debug_entry(self, http_server):
        # Boundary: the per-block reveal contract keeps this block's own lines readable
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")
        logger = Mock()
        context = _context(
            {
                "method": "GET",
                "url": f"{http_server.base_url}/data",
                "headers": {"X-Api-Key": "open"},
            }
        )
        context["logger"] = logger
        context["unmasked_secret_fields"] = ["X-Api-Key"]

        result = await plugin.execute(context)

        assert any("> X-Api-Key: open" in line for line in _debug_messages(logger))
        hop_values = [
            value
            for name, value in result["trace"]["hops"][-1]["request"]["headers"]
            if name.lower() == "x-api-key"
        ]
        assert hop_values == ["open"]

    @pytest.mark.asyncio
    async def test_noncatalog_short_header_value_stays_raw(self, http_server):
        # Boundary: name-masking applies to the credential catalog only
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok", headers=[("X-Request-Id", "id-7")])
        logger = Mock()
        context = _context({"method": "GET", "url": f"{http_server.base_url}/data"})
        context["logger"] = logger

        result = await plugin.execute(context)

        assert any("< X-Request-Id: id-7" in line for line in _debug_messages(logger))
        hop_values = [
            value
            for name, value in result["trace"]["hops"][-1]["response"]["headers"]
            if name.lower() == "x-request-id"
        ]
        assert hop_values == ["id-7"]


class TestMarkedTraceOutput:
    """A user-marked `trace` output receives
    the marked-`headers` treatment - every hop header value registers BEFORE
    the combined DEBUG entries emit."""

    @pytest.mark.asyncio
    async def test_marked_trace_output_masks_noncatalog_header_in_debug_entry(self, http_server):
        # Guard: marking trace behaves like marking headers
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        secret = "marked-trace-session-value-77"
        http_server.enqueue(body=b"payload", headers=[("X-Custom-Session", secret)])
        context, _, lines = TestResponseCredentialTraceMasking()._cookie_context(
            f"{http_server.base_url}/payload"
        )
        context["output_secret_fields"] = ["trace"]

        await plugin.execute(context)

        assert any("< X-Custom-Session: ********" in line for line in lines)
        for line in lines:
            assert secret not in line


class TestWireWindowTiming:
    """Timing total_ms is the pure wire window -
    first wire event to last wire event across attempts - never the plugin
    wall clock (client construction and artifact writing are not wire time)."""

    def test_total_ms_is_the_span_between_first_and_last_wire_event(self):
        # Guard: total said 20.9ms while wire activity was ~2.3ms
        from wavecore.plugins.http_client import _RequestRun

        run = _RequestRun()
        run.collector.events = [
            ("connect_tcp.started", 100.0),
            ("send_request_headers.started", 100.001),
            ("receive_response_body.complete", 100.005),
        ]

        from wavecore.plugins.http_client import HTTPClientPlugin

        trace = HTTPClientPlugin()._build_trace(run)

        assert trace["timing"]["total_ms"] == pytest.approx(5.0, abs=0.01)

    def test_total_ms_is_zero_without_wire_events(self):
        # Boundary: no wire evidence -> no invented wire total
        from wavecore.plugins.http_client import HTTPClientPlugin, _RequestRun

        trace = HTTPClientPlugin()._build_trace(_RequestRun())

        assert trace["timing"]["total_ms"] == 0.0

    @pytest.mark.asyncio
    async def test_total_ms_covers_the_timing_components(self, http_server):
        # Live guard: the window is a superset of every component span
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"ok")

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/data"})
        )

        timing = result["trace"]["timing"]
        for component in ("connect_ms", "tls_ms", "first_byte_ms", "download_ms"):
            assert timing["total_ms"] >= timing[component]


class TestTraceWithoutWireEvidence:
    """Responses surfacing without wire-level evidence (no trace events, no
    elapsed clock - e.g. a pooled transport) still trace honestly: unknown
    hop durations report 0.0 and no connection entry is invented."""

    @staticmethod
    def _real_response_client() -> AsyncMock:
        request = httpx.Request("GET", "http://example.com/api")
        response = httpx.Response(
            200, request=request, headers={"Content-Type": "text/plain"}, text="ok"
        )
        return make_client(AsyncMock(return_value=response))

    @pytest.mark.asyncio
    async def test_hop_without_an_elapsed_clock_reports_zero_duration(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with patch_async_client(self._real_response_client()):
            result = await plugin.execute(
                _context({"method": "GET", "url": "http://example.com/api"})
            )

        hops = result["trace"]["hops"]
        assert len(hops) == 1
        assert hops[0]["kind"] == "final"
        assert hops[0]["duration_ms"] == 0.0

    @pytest.mark.asyncio
    async def test_no_connection_entry_without_a_connect_event(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()

        with patch_async_client(self._real_response_client()):
            context = _context({"method": "GET", "url": "http://example.com/api"})
            context["logger"] = logger
            await plugin.execute(context)

        debug = _debug_messages(logger)
        assert len(debug) == 2
        assert not any(msg.startswith("Connected to") for msg in debug)
        assert any(msg.startswith("GET http://example.com/api -> 200") for msg in debug)
        assert any(msg.startswith("Timing: ") for msg in debug)


class TestHTTPPluginLogging:
    """INFO summary formatting details."""

    @pytest.mark.asyncio
    async def test_response_logging_kb_size_display(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        large_body = "y" * 2048

        client, _ = make_mock_client(
            headers={"content-type": "text/plain"},
            text=large_body,
            reason_phrase="OK",
            url="http://example.com/",
        )
        logger = Mock()

        with patch_async_client(client):
            context = _context({"method": "GET", "url": "http://example.com"})
            context["logger"] = logger
            await plugin.execute(context)

        info_calls = [str(c) for c in logger.info.call_args_list]
        assert any("KB" in c for c in info_calls), f"Expected KB in log calls: {info_calls}"


class TestHTTPPluginLogBranches:
    """Logging early-return branches."""

    def test_log_request_no_logger(self):
        from wavecore.plugins.http_client import HTTPClientPlugin, HTTPRequestConfig

        plugin = HTTPClientPlugin()
        req = HTTPRequestConfig(
            method="GET",
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
            logger=None,
        )
        # Should return without error when logger is None
        plugin._log_request(req)

    def test_log_request_logger_without_debug(self):
        from wavecore.plugins.http_client import HTTPClientPlugin, HTTPRequestConfig

        logger = Mock(spec=["info"])
        plugin = HTTPClientPlugin()
        req = HTTPRequestConfig(
            method="POST",
            url="http://example.com/api",
            body='{"key": "value"}',
            headers={"Content-Type": "application/json"},
            query_params={"q": "test"},
            timeout_seconds=30,
            verify_ssl=True,
            ca_cert=None,
            allow_redirects=True,
            max_redirects=10,
            retry_count=0,
            retry_delay=1,
            retry_backoff_factor=2,
            logger=logger,
        )
        plugin._log_request(req)
        logger.info.assert_called()

    def test_log_response_no_logger(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        response = Mock(status_code=200, reason_phrase="OK", headers={}, url="http://example.com")
        plugin._log_response(None, response, 0.5, "body", "http://example.com")

    def test_log_response_logger_without_debug(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        logger = Mock(spec=["info"])
        plugin = HTTPClientPlugin()
        response = Mock(
            status_code=200,
            reason_phrase="OK",
            headers={"Content-Type": "text/html"},
            url="http://example.com",
        )
        plugin._log_response(logger, response, 0.1, "response body", "http://example.com")
        logger.info.assert_called()


class TestHTTPPluginNoRawIoDumps:
    """REQ-4.5.3: the plugin never dumps raw request/response headers or
    body lines - the engine harness owns
    the masked Inputs/Outputs lines, and the combined trace entries are the
    only wire evidence the plugin itself emits."""

    _DUMP_PREFIXES = (
        "Request headers:",
        "Request body:",
        "Response headers:",
        "Response body:",
    )

    @pytest.mark.asyncio
    async def test_no_raw_request_or_response_dumps_at_debug(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        client, _ = make_mock_client(
            headers={"Content-Type": "text/plain", "Set-Cookie": "session=tok-c00kie-99"},
            text="OK-body-content",
            url="http://example.com/api",
        )

        with patch_async_client(client):
            context = _context(
                {
                    "method": "POST",
                    "url": "http://example.com/api",
                    "body": '{"user": "u"}',
                    "headers": {"Authorization": "Bearer l0ng-s3cr3t-t0ken"},
                    "verify_ssl": False,
                }
            )
            context["logger"] = logger
            await plugin.execute(context)

        debug_msgs = _debug_messages(logger)
        for prefix in self._DUMP_PREFIXES:
            assert not any(
                msg.startswith(prefix) for msg in debug_msgs
            ), f"plugin still dumps a raw {prefix!r} line at DEBUG"

    @pytest.mark.asyncio
    async def test_info_summaries_and_tls_diagnostics_still_emit(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        client, _ = make_mock_client(
            headers={"Content-Type": "text/plain"},
            text="OK",
            url="http://example.com/api",
        )

        with patch_async_client(client):
            context = _context(
                {
                    "method": "POST",
                    "url": "http://example.com/api",
                    "body": '{"user": "u"}',
                    "verify_ssl": False,
                }
            )
            context["logger"] = logger
            await plugin.execute(context)

        info_msgs = _info_messages(logger)
        debug_msgs = _debug_messages(logger)
        assert any(msg.startswith("HTTP POST http://example.com/api") for msg in info_msgs)
        assert any(msg.startswith("HTTP 200 OK") for msg in info_msgs)
        assert any("TLS verification: disabled" in msg for msg in debug_msgs)
