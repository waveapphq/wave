"""The pure-Python TLS transport: stream error mapping and what a verified connection trusts.

The tlslite-backed streams translate socket and record-layer failures into
httpcore's exception vocabulary so httpx surfaces them uniformly. The happy
paths run through the live-server suites; these cover the error edges.

With Verify on, a CA Certificate set on the block is the only certificate it trusts;
blank, the block trusts what Settings > Network > Certificates resolves, and the run
log names that source once per block run (REQ-4.5.16, REQ-3.4.1.4).
"""

import ast
import asyncio
import re
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import httpcore
import httpx
import pytest

from tests.plugins.http import tls_material as pki
from wavecore.plugins import http_client, http_tls


def _tls_stream(connection: object) -> http_client._TlsStream:
    result = http_tls.HandshakeResult(
        connection=connection, version="TLSv1.2", cipher="X", peer_chain_der=[]
    )
    return http_client._TlsStream(Mock(), result)


class TestTlsStreamErrors:
    async def test_read_timeout_maps_to_read_timeout(self) -> None:
        connection = Mock(read=Mock(side_effect=TimeoutError("slow")))

        with pytest.raises(httpcore.ReadTimeout):
            await _tls_stream(connection).read(16)

    async def test_read_failure_maps_to_read_error(self) -> None:
        connection = Mock(read=Mock(side_effect=ValueError("record layer")))

        with pytest.raises(httpcore.ReadError):
            await _tls_stream(connection).read(16)

    async def test_write_timeout_maps_to_write_timeout(self) -> None:
        connection = Mock(write=Mock(side_effect=TimeoutError("slow")))

        with pytest.raises(httpcore.WriteTimeout):
            await _tls_stream(connection).write(b"x")

    async def test_write_failure_maps_to_write_error(self) -> None:
        connection = Mock(write=Mock(side_effect=ValueError("record layer")))

        with pytest.raises(httpcore.WriteError):
            await _tls_stream(connection).write(b"x")

    async def test_close_swallows_connection_errors(self) -> None:
        connection = Mock(close=Mock(side_effect=ValueError("already closed")))
        stream = _tls_stream(connection)

        await stream.aclose()

        stream._sock.close.assert_called_once()

    def test_ssl_object_is_exposed_only_for_that_key(self) -> None:
        stream = _tls_stream(Mock())

        assert stream.get_extra_info("ssl_object") is not None
        assert stream.get_extra_info("anything_else") is None


class TestPlainStreamErrors:
    def _plain_stream(self, sock: object) -> http_client._PlainStream:
        return http_client._PlainStream(sock, http_tls.TLSClientConfig())

    async def test_read_socket_error_maps_to_read_error(self) -> None:
        sock = Mock(recv=Mock(side_effect=OSError("reset")))

        with pytest.raises(httpcore.ReadError):
            await self._plain_stream(sock).read(16)

    async def test_read_timeout_maps_to_read_timeout(self) -> None:
        sock = Mock(recv=Mock(side_effect=TimeoutError("slow")))

        with pytest.raises(httpcore.ReadTimeout):
            await self._plain_stream(sock).read(16)

    async def test_write_socket_error_maps_to_write_error(self) -> None:
        sock = Mock(sendall=Mock(side_effect=OSError("broken pipe")))

        with pytest.raises(httpcore.WriteError):
            await self._plain_stream(sock).write(b"x")

    def test_get_extra_info_is_none(self) -> None:
        assert self._plain_stream(Mock()).get_extra_info("ssl_object") is None

    @pytest.mark.parametrize(
        ("raised", "surfaced"),
        [
            (http_tls.TLSHandshakeError("TLS handshake failed: x"), httpcore.ConnectError),
            (TimeoutError("timed out"), TimeoutError),
        ],
        ids=["refused handshake", "handshake timeout"],
    )
    async def test_a_failed_upgrade_closes_the_socket(
        self, monkeypatch: pytest.MonkeyPatch, raised: Exception, surfaced: type[Exception]
    ) -> None:
        def _raise(*args: object, **kwargs: object) -> None:
            raise raised

        monkeypatch.setattr(http_tls, "tls_handshake", _raise)
        sock = Mock()
        stream = http_client._PlainStream(sock, http_tls.TLSClientConfig(verify=False))

        with pytest.raises(surfaced):
            await stream.start_tls(None, "host.test")

        sock.close.assert_called_once_with()

    async def test_a_trust_source_that_cannot_be_read_closes_the_socket(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.connectivity import trust_store

        def _raise(*args: object, **kwargs: object) -> None:
            raise ValueError("No certificate store found on this WAVE host: looked in /srv/none")

        monkeypatch.setattr(trust_store, "anchors_pem", _raise)
        sock = Mock()

        with pytest.raises(ValueError, match=r"^No certificate store found on this WAVE host"):
            await self._plain_stream(sock).start_tls(None, "host.test")

        sock.close.assert_called_once_with()


class TestBackendConnectErrors:
    async def test_connect_timeout_maps_to_connect_timeout(self, monkeypatch) -> None:
        def _raise(*args: object, **kwargs: object) -> None:
            raise TimeoutError("slow")

        monkeypatch.setattr(http_client.socket, "create_connection", _raise)
        backend = http_client._TlsliteBackend(http_tls.TLSClientConfig())

        with pytest.raises(httpcore.ConnectTimeout):
            await backend.connect_tcp("host.test", 443)

    async def test_connect_refused_maps_to_connect_error(self, monkeypatch) -> None:
        def _raise(*args: object, **kwargs: object) -> None:
            raise OSError("refused")

        monkeypatch.setattr(http_client.socket, "create_connection", _raise)
        backend = http_client._TlsliteBackend(http_tls.TLSClientConfig())

        with pytest.raises(httpcore.ConnectError):
            await backend.connect_tcp("host.test", 443)


class TestProxyDialErrors:
    """A proxied pool only dials its proxy, so a failed dial names the proxy and keeps its kind."""

    @pytest.mark.parametrize(
        ("raised", "kind", "text"),
        [
            (TimeoutError("timed out"), httpcore.ConnectTimeout, "timed out"),
            (OSError("refused"), httpcore.ConnectError, "refused"),
        ],
        ids=["timeout", "refused"],
    )
    @pytest.mark.parametrize(
        ("host", "named"), [("proxy.test", "proxy.test"), ("::1", "[::1]")], ids=["name", "ipv6"]
    )
    async def test_a_failed_dial_names_the_proxy(
        self, monkeypatch, raised, kind, text, host, named
    ) -> None:
        from wavecore.connectivity import proxy

        def _raise(*args: object, **kwargs: object) -> None:
            raise raised

        monkeypatch.setattr(http_client.socket, "create_connection", _raise)
        endpoint = proxy.ProxyEndpoint(host, 3128, "wave", "s3cret")
        backend = http_client._TlsliteBackend(http_tls.TLSClientConfig(), endpoint)

        with pytest.raises(kind) as caught:
            await backend.connect_tcp(host, 3128)

        assert type(caught.value) is kind
        assert str(caught.value) == f"Proxy {named}:3128 cannot be reached: {text}"


# REQ-4.5.16 / REQ-3.4.1.4: what a verified HTTPS connection trusts, and the run log line.

_LABEL = "June 2026"
_BUILT_IN_LINE = "Trusting WAVE's built-in certificate list (June 2026)"
_UNTRUSTED = (
    r"^Certificate verification failed: no trusted issuer found "
    r'for certificate "CN=wave-test-server"$'
)


@dataclass
class _Handshake:
    """What the TLS engine was handed for one handshake, and the run log it ran under."""

    anchors_pem: str | None
    run_log: Any


def _trust_store() -> Any:
    """Resolved on call so a missing module fails its own tests, not this module's collection."""
    from wavecore.connectivity import trust_store

    return trust_store


def _run_log() -> Any:
    from wavecore.connectivity import run_log

    return run_log


def _spec(source: str = "builtin", additional_pem: str = "", additional_count: int = 0) -> Any:
    return _trust_store().TrustSpec(
        source=source,
        additional_pem=additional_pem,
        additional_count=additional_count,
        builtin_label=_LABEL,
    )


def _other_ca_pem() -> str:
    """A CA that signed nothing the test servers present."""
    return pki.make_credential("Unrelated Root", key_kind="ec256", is_ca=True).cert_pem


def _context(parameters: dict[str, Any], logger: Any = None) -> dict[str, Any]:
    return {"parameters": parameters, "logger": logger or Mock(), "variables": {}}


def _trust_lines(logger: Mock) -> list[str]:
    return [
        str(entry.args[0])
        for entry in logger.debug.call_args_list
        if entry.args and str(entry.args[0]).startswith("Trusting ")
    ]


@pytest.fixture
def trust_settings() -> Iterator[Callable[[Any], None]]:
    """Stand in for Settings > Network > Certificates: the spec the WAVE host resolves."""
    store = _trust_store()

    def use(spec: Any) -> None:
        store.set_resolver(lambda: spec)

    yield use
    store.set_resolver(None)


@pytest.fixture
def host_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Callable[[str | None], Path]:
    """Point the WAVE host's store walk at two files; the second holds `content` when given."""
    missing = tmp_path / "stores" / "missing.crt"
    store = tmp_path / "stores" / "store.crt"
    store.parent.mkdir()
    monkeypatch.setattr(_trust_store(), "HOST_STORE_PATHS", (str(missing), str(store)))

    def place(content: str | None) -> Path:
        if content is not None:
            store.write_text(content, encoding="utf-8")
        return store

    return place


@pytest.fixture
def handshakes(monkeypatch: pytest.MonkeyPatch) -> list[_Handshake]:
    """Record every handshake the engine performs, then perform it for real."""
    seen: list[_Handshake] = []
    real = http_tls.tls_handshake

    def spy(sock: Any, config: http_tls.TLSClientConfig, *args: Any, **kwargs: Any) -> Any:
        seen.append(_Handshake(config.anchors_pem, _run_log().RUN_LOG.get()))
        return real(sock, config, *args, **kwargs)

    monkeypatch.setattr(http_tls, "tls_handshake", spy)
    return seen


def _looked_in(*paths: Path) -> str:
    return re.escape(", ".join(str(path) for path in paths))


class TestThePluginKeepsNoTrustOfItsOwn:
    """trust_store is the one reader of WAVE's built-in list on the WAVE host."""

    def test_the_bundled_trust_helper_is_gone(self) -> None:
        assert not hasattr(http_client, "_bundled_trust")

    def test_the_plugin_never_imports_certifi(self) -> None:
        tree = ast.parse(Path(str(http_client.__file__)).read_text(encoding="utf-8"))
        imported = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        } | {
            (node.module or "").split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
        }

        assert "certifi" not in imported


class TestABlankCaTrustsWhatWaveTrusts:
    """A blank CA Certificate trusts the Additional Certificates plus the public source."""

    async def test_an_additional_certificate_verifies_the_server(
        self, tls_server: Any, tls_material: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec(additional_pem=tls_material.ca_cert_pem, additional_count=1))

        result = await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"})
        )

        assert result["status_code"] == 200

    async def test_the_handshake_is_handed_the_active_specs_anchors(
        self,
        tls_server: Any,
        tls_material: Any,
        trust_settings: Callable[[Any], None],
        handshakes: list[_Handshake],
    ) -> None:
        spec = _spec(additional_pem=tls_material.ca_cert_pem, additional_count=1)
        trust_settings(spec)

        await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"})
        )

        assert [shake.anchors_pem for shake in handshakes] == [_trust_store().anchors_pem(spec)]

    async def test_the_built_in_list_alone_rejects_a_private_ca(
        self, tls_server: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec())

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await http_client.HTTPClientPlugin().execute(
                _context({"method": "GET", "url": f"{tls_server.base_url}/secure"})
            )

    async def test_the_wave_hosts_store_verifies_the_server(
        self,
        tls_server: Any,
        tls_material: Any,
        trust_settings: Callable[[Any], None],
        host_store: Callable[[str | None], Path],
    ) -> None:
        host_store(tls_material.ca_cert_pem)
        trust_settings(_spec("host"))

        result = await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"})
        )

        assert result["status_code"] == 200

    async def test_no_store_on_this_wave_host_is_refused(
        self,
        tls_server: Any,
        tmp_path: Path,
        trust_settings: Callable[[Any], None],
        host_store: Callable[[str | None], Path],
    ) -> None:
        store = host_store(None)
        trust_settings(_spec("host"))
        expected = (
            r"^No certificate store found on this WAVE host: looked in "
            rf"{_looked_in(tmp_path / 'stores' / 'missing.crt', store)}$"
        )

        with pytest.raises(ValueError, match=expected):
            await http_client.HTTPClientPlugin().execute(
                _context({"method": "GET", "url": f"{tls_server.base_url}/secure"})
            )

    async def test_settings_are_read_again_for_each_run(
        self, tls_server: Any, tls_material: Any
    ) -> None:
        store = _trust_store()
        current = [_spec()]
        store.set_resolver(lambda: current[0])
        plugin = http_client.HTTPClientPlugin()
        params = {"method": "GET", "url": f"{tls_server.base_url}/secure"}
        try:
            with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
                await plugin.execute(_context(params))
            current[0] = _spec(additional_pem=tls_material.ca_cert_pem, additional_count=1)

            result = await plugin.execute(_context(params))
        finally:
            store.set_resolver(None)

        assert result["status_code"] == 200


class TestASetCaIsTheOnlyTrust:
    """A CA Certificate on the block is the only certificate it trusts (curl --cacert)."""

    async def test_the_handshake_is_handed_the_block_ca_alone(
        self,
        tls_server: Any,
        tls_material: Any,
        trust_settings: Callable[[Any], None],
        handshakes: list[_Handshake],
    ) -> None:
        trust_settings(_spec(additional_pem=_other_ca_pem(), additional_count=1))

        result = await http_client.HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/secure",
                    "ca_cert": tls_material.ca_cert_path,
                }
            )
        )

        assert result["status_code"] == 200
        assert [shake.anchors_pem for shake in handshakes] == [tls_material.ca_cert_pem]

    async def test_a_set_ca_replaces_the_additional_certificates(
        self, tls_server: Any, tls_material: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec(additional_pem=tls_material.ca_cert_pem, additional_count=1))

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await http_client.HTTPClientPlugin().execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{tls_server.base_url}/secure",
                        "ca_cert": _other_ca_pem(),
                    }
                )
            )

    async def test_a_set_ca_never_reads_the_settings_trust(
        self,
        tls_server: Any,
        tls_material: Any,
        trust_settings: Callable[[Any], None],
        host_store: Callable[[str | None], Path],
    ) -> None:
        host_store(None)
        trust_settings(_spec("host"))

        result = await http_client.HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/secure",
                    "ca_cert": tls_material.ca_cert_pem,
                }
            )
        )

        assert result["status_code"] == 200


class TestTheTrustLine:
    """One DEBUG line per block run that verifies with a blank CA, naming the source."""

    async def test_a_failed_verification_still_names_the_built_in_list(
        self, tls_server: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec())
        logger = Mock()

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await http_client.HTTPClientPlugin().execute(
                _context({"method": "GET", "url": f"{tls_server.base_url}/secure"}, logger)
            )

        assert _trust_lines(logger) == [_BUILT_IN_LINE]

    async def test_two_additional_certificates_are_counted(
        self, tls_server: Any, tls_material: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        additional = tls_material.ca_cert_pem + _other_ca_pem()
        trust_settings(_spec(additional_pem=additional, additional_count=2))
        logger = Mock()

        await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"}, logger)
        )

        assert _trust_lines(logger) == [f"{_BUILT_IN_LINE} and 2 additional certificates"]

    async def test_one_additional_certificate_is_named_in_the_singular(
        self, tls_server: Any, tls_material: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec(additional_pem=tls_material.ca_cert_pem, additional_count=1))
        logger = Mock()

        await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"}, logger)
        )

        assert _trust_lines(logger) == [f"{_BUILT_IN_LINE} and 1 additional certificate"]

    async def test_the_wave_hosts_store_line_names_the_store(
        self,
        tls_server: Any,
        tls_material: Any,
        trust_settings: Callable[[Any], None],
        host_store: Callable[[str | None], Path],
    ) -> None:
        store = host_store(tls_material.ca_cert_pem)
        trust_settings(_spec("host"))
        logger = Mock()

        await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"}, logger)
        )

        assert _trust_lines(logger) == [f"Trusting this WAVE host's certificate store {store}"]

    async def test_two_connections_in_one_run_log_the_line_once(
        self,
        tls_server: Any,
        tls_material: Any,
        trust_settings: Callable[[Any], None],
        handshakes: list[_Handshake],
    ) -> None:
        trust_settings(_spec(additional_pem=tls_material.ca_cert_pem, additional_count=1))
        port = tls_server.server_address[1]
        # A second origin on the same server, so the redirect opens a second connection.
        tls_server.enqueue(status=302, headers=[("Location", f"https://localhost:{port}/next")])
        tls_server.enqueue(body=b"ready")
        logger = Mock()

        result = await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"}, logger)
        )

        assert result["status_code"] == 200
        assert len(handshakes) == 2
        assert _trust_lines(logger) == [f"{_BUILT_IN_LINE} and 1 additional certificate"]

    async def test_each_run_logs_its_own_line(
        self, tls_server: Any, tls_material: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec(additional_pem=tls_material.ca_cert_pem, additional_count=1))
        plugin = http_client.HTTPClientPlugin()
        loggers = [Mock(), Mock()]

        for logger in loggers:
            await plugin.execute(
                _context({"method": "GET", "url": f"{tls_server.base_url}/secure"}, logger)
            )

        expected = [f"{_BUILT_IN_LINE} and 1 additional certificate"]
        assert [_trust_lines(logger) for logger in loggers] == [expected, expected]

    async def test_the_line_is_written_on_the_event_loop_thread(
        self, tls_server: Any, tls_material: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec(additional_pem=tls_material.ca_cert_pem, additional_count=1))
        written: list[tuple[str, int, bool]] = []

        def debug(message: str) -> None:
            try:
                asyncio.get_running_loop()
                on_loop = True
            except RuntimeError:
                on_loop = False
            written.append((message, threading.get_ident(), on_loop))

        logger = Mock()
        logger.debug.side_effect = debug

        await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"}, logger)
        )

        assert [entry for entry in written if entry[0].startswith("Trusting ")] == [
            (
                f"{_BUILT_IN_LINE} and 1 additional certificate",
                threading.get_ident(),
                True,
            )
        ]

    async def test_a_set_ca_logs_no_trust_line(
        self, tls_server: Any, tls_material: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec(additional_pem=tls_material.ca_cert_pem, additional_count=1))
        logger = Mock()

        await http_client.HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/secure",
                    "ca_cert": tls_material.ca_cert_path,
                },
                logger,
            )
        )

        assert _trust_lines(logger) == []

    async def test_verify_off_logs_no_trust_line(
        self, tls_server: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec())
        logger = Mock()

        await http_client.HTTPClientPlugin().execute(
            _context(
                {"method": "GET", "url": f"{tls_server.base_url}/secure", "verify_ssl": False},
                logger,
            )
        )

        assert _trust_lines(logger) == []

    async def test_verify_off_never_reads_the_settings_trust(
        self,
        tls_server: Any,
        trust_settings: Callable[[Any], None],
        host_store: Callable[[str | None], Path],
    ) -> None:
        host_store(None)
        trust_settings(_spec("host"))

        result = await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure", "verify_ssl": False})
        )

        assert result["status_code"] == 200

    async def test_a_plain_http_run_logs_no_trust_line(
        self, http_server: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec())
        logger = Mock()

        await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/plain"}, logger)
        )

        assert _trust_lines(logger) == []

    async def test_a_plain_http_run_never_needs_a_host_store(
        self,
        http_server: Any,
        trust_settings: Callable[[Any], None],
        host_store: Callable[[str | None], Path],
    ) -> None:
        host_store(None)
        trust_settings(_spec("host"))

        result = await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/plain"})
        )

        assert result["status_code"] == 200


class TestTheRunHoldsARunLog:
    """The HTTP block run sets the run's log sink, so connection lines reach its log once."""

    async def test_the_handshake_runs_under_the_runs_log(
        self,
        tls_server: Any,
        tls_material: Any,
        trust_settings: Callable[[Any], None],
        handshakes: list[_Handshake],
    ) -> None:
        trust_settings(_spec(additional_pem=tls_material.ca_cert_pem, additional_count=1))

        await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"})
        )

        assert len(handshakes) == 1
        assert isinstance(handshakes[0].run_log, _run_log().RunLog)

    async def test_the_run_log_is_unset_once_the_run_ends(
        self, tls_server: Any, tls_material: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec(additional_pem=tls_material.ca_cert_pem, additional_count=1))

        await http_client.HTTPClientPlugin().execute(
            _context({"method": "GET", "url": f"{tls_server.base_url}/secure"})
        )

        assert _run_log().RUN_LOG.get() is None

    async def test_the_run_log_is_unset_when_the_run_fails(
        self, tls_server: Any, trust_settings: Callable[[Any], None]
    ) -> None:
        trust_settings(_spec())

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await http_client.HTTPClientPlugin().execute(
                _context({"method": "GET", "url": f"{tls_server.base_url}/secure"})
            )

        assert _run_log().RUN_LOG.get() is None
