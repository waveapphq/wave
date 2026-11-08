"""HTTP network identity and path: mTLS, the proxy choice, TLS pins, verification.

TLS is the bundled pure-Python engine (tlslite-ng) behind a custom httpx
network backend - no stdlib ssl in the plugin path. Version pins (1.0-1.3)
and ordered cipher pins (OpenSSL or IANA names, from the fixed catalog) drive
REAL handshakes against the local server fixtures; negotiated facts are
asserted from the wire trace (result["trace"]["tls"]). Mutual TLS presents
the configured client identity and carries data at every pinned version,
including TLS 1.3. Server
verification checks the presented
chain against the custom CA or the bundled trust store; httpx itself is
always built verify=False because the backend verifies. Transport failures
(refused, connect timeout, read timeout) surface as the matching httpx errors.

The proxy choice (REQ-3.4.3.9) runs on a real client against an in-process
forward proxy. WAVE setting sends each request, and each redirect hop, where
the route decision of the proxy in force says: through the proxy of its own
protocol, or direct. Off connects directly. The process environment is never
read, the run log names a used proxy once per block run, a proxy failure
fails the block with its own text, an address list pattern that takes too
long fails only its own block run, and an https target behind the proxy is
still handshaken and verified by the bundled engine.

A connection to 127.0.0.1 or localhost at the Local Port of one of the run's open
SSH tunnels sends the tunnel's far host as the TLS server name and checks the
server's certificate under it, one connection at a time.
"""

import asyncio
import inspect
import re
import socket
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import httpx
import pytest

from tests.connectivity._proxy_servers import Proxy, closed_port
from tests.connectivity.opensearch.fakes import record_sni
from tests.plugins.http.httpx_fakes import make_mock_client, patch_async_client
from tests.plugins.netcat.conftest import tunnel_registry

Decision = Callable[[str, str, int], bool]

_LOGIN = ("wave", "s3cret")
_LOGIN_HEADER = "Basic d2F2ZTpzM2NyZXQ="
_USERNAME_ONLY_HEADER = "Basic d2F2ZTo="
_PROXY_VARIABLES = (
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
)
_EXCEPTION_VARIABLES = ("NO_PROXY", "no_proxy")
_PROXY_MODE_DESCRIPTION = (
    "Proxy: WAVE setting follows Settings > Network > Proxy; Off connects directly. "
    "On a remote host the block uses that host's own proxy settings."
)
_UNTRUSTED = (
    r"^Certificate verification failed: no trusted issuer found "
    r'for certificate "CN=wave-test-server"$'
)
_UNUSABLE_HOST_VALUE = (
    "This WAVE host's proxy address socks5://proxy.example:1080 is not an http:// address: "
    "choose Custom or turn the proxy off"
)
# Alternatives that overlap make the engine try every split of the run of letters.
_BACKTRACKING = "(a|aa)+$"
_STUCK_HOST = "a" * 60 + ".example"
_LOWERED_LIMIT_S = 0.005
_SHIPPED_LIMIT_S = 0.1
_LIMIT_MARGIN_S = 0.05
_ANSWER_DELAY_S = 0.05
_LEFT_OUT: dict[str, Any] = {}
_WAVE_SETTING: dict[str, Any] = {"proxy_mode": "wave-setting"}
_OFF: dict[str, Any] = {"proxy_mode": "off"}
_follows_the_setting = pytest.mark.parametrize(
    "choice", [_LEFT_OUT, _WAVE_SETTING], ids=["left out", "wave-setting"]
)
_every_choice = pytest.mark.parametrize(
    "choice", [_LEFT_OUT, _WAVE_SETTING, _OFF], ids=["left out", "wave-setting", "off"]
)


def _context(parameters: dict[str, Any], **extra: Any) -> dict[str, Any]:
    context: dict[str, Any] = {"parameters": parameters, "logger": Mock(), "variables": {}}
    context.update(extra)
    return context


def _exact(text: str) -> str:
    return f"^{re.escape(text)}$"


def _always(_scheme: str, _host: str, _port: int) -> bool:
    return True


def _never(_scheme: str, _host: str, _port: int) -> bool:
    return False


def _only(host: str) -> Decision:
    """A decision that sends one host through the proxy and every other address direct."""

    def decide(_scheme: str, asked_host: str, _port: int) -> bool:
        return asked_host == host

    return decide


def _recording(asked: list[tuple[str, str, int]]) -> Decision:
    """A decision that keeps what it was asked and sends everything through the proxy."""

    def decide(scheme: str, host: str, port: int) -> bool:
        asked.append((scheme, host, port))
        return True

    return decide


def _proxy_core() -> Any:
    """Resolved on call, so only a case that puts a proxy in force needs the module."""
    from wavecore.connectivity import proxy

    return proxy


def _unusable(scheme: str) -> Decision:
    """The decision of a WAVE host whose proxy value for one protocol cannot be used."""

    def decide(asked_scheme: str, host: str, _port: int) -> bool:
        if host == "localhost":
            return False
        if asked_scheme == scheme:
            raise _proxy_core().ProxyError(_UNUSABLE_HOST_VALUE)
        return True

    return decide


def _stuck_list(monkeypatch: pytest.MonkeyPatch) -> Decision:
    """The real address list decision: one pattern built to backtrack, on a lowered time limit."""
    from wavecore.api.services.network import _proxy_addresses

    monkeypatch.setattr(_proxy_addresses, "PATTERN_MATCH_LIMIT_S", _LOWERED_LIMIT_S)
    entry = {"kind": "regex", "address": _BACKTRACKING}
    rule: Decision = _proxy_addresses.list_rule("except", [entry], False)
    return rule


def _too_slow(address: str) -> str:
    return f"Proxy address list: the pattern {_BACKTRACKING} took too long to match {address}"


def _endpoint(server: Proxy, username: str | None = None, password: str | None = None) -> Any:
    return _proxy_core().ProxyEndpoint(server.host, server.port, username, password)


def _use_proxy(https: Any = None, http: Any = None, through_proxy: Decision = _always) -> None:
    """Put a proxy in force the way the WAVE host does: through the registered resolver."""
    core = _proxy_core()
    spec = core.ProxySpec(https=https, http=http, through_proxy=through_proxy)
    core.set_resolver(lambda: spec)


def _put_in_force(server: Proxy, through_proxy: Decision = _always) -> None:
    """One proxy for both protocols, as a Custom proxy in Settings gives."""
    endpoint = _endpoint(server)
    _use_proxy(endpoint, endpoint, through_proxy)


def _other(scheme: str) -> str:
    return "http" if scheme == "https" else "https"


def _asked(server: Proxy) -> list[tuple[str, str]]:
    """Each request a proxy received: its method and the target as sent."""
    return [(request.method, request.target) for request in server.requests]


def _proxy_lines(logger: Mock) -> list[tuple[str, str]]:
    """The proxy lines of one block run, each with the logger method that wrote it."""
    return [
        (name, str(args[0]))
        for name, args, _kwargs in logger.method_calls
        if args and str(args[0]).startswith("Using the proxy")
    ]


def _name_a_dead_proxy_in_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point every proxy variable at an address nothing listens on, with no exceptions."""
    dead = f"http://127.0.0.1:{closed_port()}"
    for name in _PROXY_VARIABLES:
        monkeypatch.setenv(name, dead)
    for name in _EXCEPTION_VARIABLES:
        monkeypatch.delenv(name, raising=False)


async def _run(parameters: dict[str, Any], logger: Mock | None = None) -> dict[str, Any]:
    """One block run on the real client."""
    from wavecore.plugins.http_client import HTTPClientPlugin

    return await HTTPClientPlugin().execute(_context(parameters, logger=logger or Mock()))


@dataclass
class _Target:
    """One in-process server the block calls, with the block settings that reach it."""

    scheme: str
    server: Any
    settings: dict[str, Any]

    @property
    def port(self) -> int:
        return int(self.server.server_address[1])

    def url(self, path: str = "/", host: str = "127.0.0.1") -> str:
        return f"{self.scheme}://{host}:{self.port}{path}"

    def parameters(self, path: str = "/", host: str = "127.0.0.1", **more: Any) -> dict[str, Any]:
        return {"method": "GET", "url": self.url(path, host), **self.settings, **more}

    def asked_of_a_proxy(self, path: str = "/", host: str = "127.0.0.1") -> tuple[str, str]:
        """What a proxy records for one request here: a tunnel, or the forwarded request."""
        if self.scheme == "https":
            return ("CONNECT", f"{host}:{self.port}")
        return ("GET", self.url(path, host))


@dataclass
class _Built:
    """The real clients a test's block runs built, and the trust_env of every transport."""

    clients: list[httpx.AsyncClient] = field(default_factory=list)
    transport_trust_env: list[Any] = field(default_factory=list)


@pytest.fixture
def plain_target(http_server: Any) -> _Target:
    return _Target("http", http_server, {})


@pytest.fixture
def tls_target(tls_server: Any, tls_material: Any) -> _Target:
    return _Target("https", tls_server, {"ca_cert": tls_material.ca_cert_path})


@pytest.fixture(params=["http", "https"])
def target(request: pytest.FixtureRequest) -> _Target:
    """The same case against a plain target and against a TLS target."""
    name = "tls_target" if request.param == "https" else "plain_target"
    found: _Target = request.getfixturevalue(name)
    return found


@pytest.fixture
def forward_proxy() -> Iterator[Proxy]:
    """A forward proxy on a loopback port; a test puts it in force itself."""
    with Proxy() as server:
        yield server


@pytest.fixture
def built(monkeypatch: pytest.MonkeyPatch) -> _Built:
    """Record every client and transport the block builds, then build it for real."""
    record = _Built()
    real_init = httpx.AsyncHTTPTransport.__init__
    signature = inspect.signature(real_init)

    class _RecordedClient(httpx.AsyncClient):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(**kwargs)
            record.clients.append(self)

    def init(transport: httpx.AsyncHTTPTransport, *args: Any, **kwargs: Any) -> None:
        bound = signature.bind(transport, *args, **kwargs)
        bound.apply_defaults()
        record.transport_trust_env.append(bound.arguments["trust_env"])
        real_init(transport, *args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", _RecordedClient)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "__init__", init)
    return record


def _le12_ecdsa_rows() -> list[dict[str, Any]]:
    """<=1.2 ECDHE-ECDSA catalog rows (the fixture server presents an ECDSA cert)."""
    from wavecore.connectivity import tls_capabilities

    return [
        dict(row)
        for row in tls_capabilities.catalog()
        if row["min_version"] != "1.3" and row["openssl"].startswith("ECDHE-ECDSA-")
    ]


class TestNetworkParameterMetadata:
    """TLS-identity and proxy parameters."""

    def test_client_cert_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        client_cert = params["client_cert"]
        assert client_cert["type"] == "string"
        assert client_cert["required"] is False

    def test_client_key_is_a_declared_credential_field(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        client_key = params["client_key"]
        assert client_key["type"] == "string"
        assert client_key["required"] is False
        assert client_key["secret"] is True

    def test_declared_credential_fields_feed_the_masking_extractor(self):
        from wavecore.core.secrets.masking import secret_param_names
        from wavecore.plugins.http_client import HTTPClientPlugin

        names = secret_param_names(HTTPClientPlugin().metadata)
        assert {"client_key"} <= names

    def test_proxy_mode_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        proxy_mode = params["proxy_mode"]
        assert proxy_mode["type"] == "string"
        assert proxy_mode["required"] is False
        assert proxy_mode["default"] == "wave-setting"
        assert proxy_mode["enum_values"] == ["wave-setting", "off"]
        assert proxy_mode["description"] == _PROXY_MODE_DESCRIPTION

    def test_proxy_url_is_not_a_parameter(self):
        """The block holds no proxy address of its own."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        names = {p["name"] for p in HTTPClientPlugin().metadata["parameters"]}
        assert "proxy_url" not in names

    def test_http2_is_not_a_parameter(self):
        """HTTP/2 is dropped - the client is HTTP/1.1 only."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        names = {p["name"] for p in HTTPClientPlugin().metadata["parameters"]}
        assert "http2" not in names

    @pytest.mark.parametrize("removed", ["explicit", "system"])
    @pytest.mark.asyncio
    async def test_invalid_proxy_mode_rejected_with_enum_message(self, removed):
        """The two removed choices are refused like any other value outside the list."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'proxy_mode' must be one of: "
                r"wave-setting, off; "
                rf"Actual value was '{removed}'\.$"
            ),
        ):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "proxy_mode": removed}
            )


class TestClientWiring:
    """httpx.AsyncClient construction: backend-owned verification, HTTP/1.1 only."""

    @pytest.mark.asyncio
    async def test_client_is_built_verify_off_and_http1_only(self):
        """The pure-Python backend verifies; httpx never does, and h2 is off."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK", url="https://example.com/")

        with patch_async_client(client) as mock_client:
            await plugin.execute(_context({"method": "GET", "url": "https://example.com"}))

        kwargs = mock_client.call_args.kwargs
        assert kwargs["verify"] is False
        assert kwargs["http1"] is True
        assert kwargs["http2"] is False

    @pytest.mark.asyncio
    async def test_verify_ssl_off_still_builds_the_client_verify_off(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK", url="https://example.com/")

        with patch_async_client(client) as mock_client:
            await plugin.execute(
                _context({"method": "GET", "url": "https://example.com", "verify_ssl": False})
            )

        assert mock_client.call_args.kwargs["verify"] is False


class TestMutualTLS:
    """Real handshakes against a server that REQUIRES a client certificate."""

    @pytest.mark.asyncio
    async def test_client_certificate_paths_complete_the_handshake(self, mtls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        mtls_server.enqueue(body=b"mutually-authenticated")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{mtls_server.base_url}/secure",
                    "ca_cert": tls_material.ca_cert_path,
                    "client_cert": tls_material.client_cert_path,
                    "client_key": tls_material.client_key_path,
                }
            )
        )

        assert result["status_code"] == 200
        assert result["body"] == "mutually-authenticated"
        assert result["trace"]["tls"]["protocol"] == "TLSv1.3"

    @pytest.mark.asyncio
    async def test_relative_certificate_paths_start_from_the_server_users_home(
        self, mtls_server, tls_material, tmp_path, monkeypatch, server_home
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        (server_home / "certs").mkdir()
        for name in ("ca.pem", "client-cert.pem", "client-key.pem"):
            source = Path(tls_material.ca_cert_path).parent / name
            (server_home / "certs" / name).write_text(source.read_text())
        monkeypatch.chdir(tmp_path)
        mtls_server.enqueue(body=b"relative-identity")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{mtls_server.base_url}/secure",
                    "ca_cert": "certs/ca.pem",
                    "client_cert": "certs/client-cert.pem",
                    "client_key": "certs/../certs/client-key.pem",
                }
            )
        )

        assert result["status_code"] == 200
        assert result["body"] == "relative-identity"

    @pytest.mark.asyncio
    async def test_inline_pem_client_identity_completes_the_handshake(
        self, mtls_server, tls_material
    ):
        """Same forms as ca_cert: inline PEM material works like file paths."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        mtls_server.enqueue(body=b"inline-pem-ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{mtls_server.base_url}/secure",
                    "ca_cert": tls_material.ca_cert_pem,
                    "client_cert": tls_material.client_cert_pem,
                    "client_key": tls_material.client_key_pem,
                }
            )
        )

        assert result["status_code"] == 200

    @pytest.mark.asyncio
    async def test_mtls_with_an_explicit_13_pin_negotiates_tls13(self, mtls_server, tls_material):
        """A client certificate carries data reliably at TLS 1.3 (client-cert
        compression is off, so the server accepts a plain Certificate)."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        mtls_server.enqueue(body=b"mtls-13")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{mtls_server.base_url}/secure",
                    "ca_cert": tls_material.ca_cert_path,
                    "client_cert": tls_material.client_cert_path,
                    "client_key": tls_material.client_key_path,
                    "tls_min_version": "1.3",
                    "tls_max_version": "1.3",
                }
            )
        )

        assert result["status_code"] == 200
        assert result["body"] == "mtls-13"
        assert result["trace"]["tls"]["protocol"] == "TLSv1.3"

    @pytest.mark.asyncio
    async def test_missing_client_identity_fails_the_handshake(self, mtls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(httpx.HTTPError):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{mtls_server.base_url}/secure",
                        "ca_cert": tls_material.ca_cert_path,
                        "tls_max_version": "1.2",
                    }
                )
            )


class TestProxyModes:
    """How the block's proxy choice reaches the httpx client it builds."""

    @pytest.mark.asyncio
    async def test_off_mode_ignores_the_proxy_environment(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client) as mock_client:
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": "http://example.com",
                        "proxy_mode": "off",
                    }
                )
            )

        assert mock_client.call_args.kwargs.get("trust_env") is False

    @_follows_the_setting
    @pytest.mark.asyncio
    async def test_wave_setting_never_reads_the_environment(self, choice):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client) as mock_client:
            await plugin.execute(_context({"method": "GET", "url": "http://example.com", **choice}))

        assert mock_client.call_args.kwargs.get("trust_env") is False


class TestWaveSettingWithoutAProxy:
    """With no proxy in force the request connects directly; the environment is never read."""

    @_every_choice
    async def test_the_proxy_variables_of_the_environment_are_never_used(
        self, target, monkeypatch, choice
    ):
        _name_a_dead_proxy_in_the_environment(monkeypatch)
        target.server.enqueue(body=b"reached directly")
        logger = Mock()

        result = await _run(target.parameters("/data", **choice), logger)

        assert result["status_code"] == 200
        assert result["body"] == "reached directly"
        assert _proxy_lines(logger) == []

    @_follows_the_setting
    async def test_a_proxy_setting_that_is_off_connects_directly(self, target, monkeypatch, choice):
        _proxy_core().set_resolver(lambda: None)
        _name_a_dead_proxy_in_the_environment(monkeypatch)
        target.server.enqueue(body=b"reached directly")
        logger = Mock()

        result = await _run(target.parameters("/data", **choice), logger)

        assert result["status_code"] == 200
        assert result["body"] == "reached directly"
        assert _proxy_lines(logger) == []

    @_every_choice
    async def test_the_client_and_every_transport_are_built_without_the_environment(
        self, target, built, choice
    ):
        result = await _run(target.parameters("/data", **choice))

        assert result["status_code"] == 200
        assert built.clients and built.transport_trust_env
        assert [client.trust_env for client in built.clients] == [False] * len(built.clients)
        assert built.transport_trust_env == [False] * len(built.transport_trust_env)


class TestWaveSettingRouting:
    """With a proxy in force each request goes where the route decision sends it."""

    @_follows_the_setting
    async def test_a_request_the_decision_sends_through_the_proxy_uses_it(
        self, target, forward_proxy, choice
    ):
        _put_in_force(forward_proxy)
        target.server.enqueue(body=b"through the proxy")

        result = await _run(target.parameters("/data", **choice))

        assert result["status_code"] == 200
        assert result["body"] == "through the proxy"
        assert _asked(forward_proxy) == [target.asked_of_a_proxy("/data")]
        assert [seen["path"] for seen in target.server.requests] == ["/data"]

    async def test_a_request_the_decision_sends_direct_never_touches_the_proxy(
        self, target, forward_proxy
    ):
        _put_in_force(forward_proxy, _never)
        target.server.enqueue(body=b"reached directly")
        logger = Mock()

        result = await _run(target.parameters("/data", **_WAVE_SETTING), logger)

        assert result["status_code"] == 200
        assert result["body"] == "reached directly"
        assert forward_proxy.untouched
        assert _proxy_lines(logger) == []

    async def test_the_decision_is_asked_with_the_scheme_host_and_port(self, target, forward_proxy):
        asked: list[tuple[str, str, int]] = []
        _put_in_force(forward_proxy, _recording(asked))

        await _run(target.parameters("/data", **_WAVE_SETTING))

        assert set(asked) == {(target.scheme, "127.0.0.1", target.port)}

    async def test_a_url_without_a_port_asks_with_the_default_port(self, target):
        asked: list[tuple[str, str, int]] = []
        default_port = 443 if target.scheme == "https" else 80
        url = f"{target.scheme}://localhost/data"

        with Proxy(upstream=("127.0.0.1", target.port)) as server:
            _put_in_force(server, _recording(asked))

            result = await _run({**target.parameters(), "url": url, **_WAVE_SETTING})

            assert len(server.requests) == 1

        assert result["status_code"] == 200
        assert set(asked) == {(target.scheme, "localhost", default_port)}
        assert [seen["path"] for seen in target.server.requests] == ["/data"]

    async def test_each_protocol_uses_its_own_proxy(self, target):
        with Proxy() as secure, Proxy() as plain:
            _use_proxy(https=_endpoint(secure), http=_endpoint(plain))
            used, unused = (secure, plain) if target.scheme == "https" else (plain, secure)

            result = await _run(target.parameters("/data", **_WAVE_SETTING))

            assert _asked(used) == [target.asked_of_a_proxy("/data")]
            assert unused.untouched

        assert result["status_code"] == 200

    async def test_a_protocol_without_a_proxy_connects_directly(self, target, forward_proxy):
        """There is no fall-back to the proxy of the other protocol."""
        _use_proxy(**{_other(target.scheme): _endpoint(forward_proxy)})
        target.server.enqueue(body=b"reached directly")
        logger = Mock()

        result = await _run(target.parameters("/data", **_WAVE_SETTING), logger)

        assert result["status_code"] == 200
        assert result["body"] == "reached directly"
        assert forward_proxy.untouched
        assert _proxy_lines(logger) == []

    async def test_a_forwarded_request_carries_the_proxy_login(self, plain_target):
        with Proxy(login=_LOGIN) as server:
            _use_proxy(http=_endpoint(server, *_LOGIN))

            result = await _run(plain_target.parameters("/data", **_WAVE_SETTING))

            assert [asked.headers.get("proxy-authorization") for asked in server.requests] == [
                _LOGIN_HEADER
            ]

        assert result["status_code"] == 200
        assert [seen["path"] for seen in plain_target.server.requests] == ["/data"]

    @pytest.mark.parametrize(
        ("username", "password"), [(None, None), ("", "s3cret")], ids=["none", "empty username"]
    )
    async def test_a_proxy_without_a_username_is_sent_no_login(
        self, target, forward_proxy, username, password
    ):
        endpoint = _endpoint(forward_proxy, username, password)
        _use_proxy(endpoint, endpoint)

        result = await _run(target.parameters("/data", **_WAVE_SETTING))

        assert result["status_code"] == 200
        assert [asked.headers.get("proxy-authorization") for asked in forward_proxy.requests] == [
            None
        ]

    async def test_a_proxy_on_an_ipv6_address_is_used_and_named_in_brackets(self, target):
        logger = Mock()

        with Proxy("::1") as server:
            _put_in_force(server)

            result = await _run(target.parameters("/data", **_WAVE_SETTING), logger)

            assert _asked(server) == [target.asked_of_a_proxy("/data")]
            assert _proxy_lines(logger) == [("debug", f"Using the proxy [::1]:{server.port}")]

        assert result["status_code"] == 200

    async def test_off_connects_directly_with_a_proxy_in_force(self, target, forward_proxy):
        _put_in_force(forward_proxy)
        target.server.enqueue(body=b"reached directly")
        logger = Mock()

        result = await _run(target.parameters("/data", **_OFF), logger)

        assert result["status_code"] == 200
        assert result["body"] == "reached directly"
        assert forward_proxy.untouched
        assert _proxy_lines(logger) == []

    @_every_choice
    async def test_the_environment_is_not_read_with_a_proxy_in_force(
        self, target, forward_proxy, built, choice
    ):
        _put_in_force(forward_proxy)

        result = await _run(target.parameters("/data", **choice))

        assert result["status_code"] == 200
        assert built.clients and built.transport_trust_env
        assert [client.trust_env for client in built.clients] == [False] * len(built.clients)
        assert built.transport_trust_env == [False] * len(built.transport_trust_env)


class TestRedirectHopsAreRoutedOneByOne:
    """Each redirect hop is routed by its own address, not by the address the block was given."""

    async def test_a_direct_hop_can_redirect_to_a_proxied_address(self, plain_target):
        there = plain_target.url("/next", host="localhost")
        plain_target.server.enqueue(status=302, headers=[("Location", there)])
        plain_target.server.enqueue(body=b"arrived")

        with Proxy(upstream=("127.0.0.1", plain_target.port)) as server:
            _put_in_force(server, _only("localhost"))

            result = await _run(plain_target.parameters("/start", **_WAVE_SETTING))

            assert _asked(server) == [("GET", there)]

        assert result["status_code"] == 200
        assert result["body"] == "arrived"
        assert result["final_url"] == there
        assert [seen["path"] for seen in plain_target.server.requests] == ["/start", "/next"]

    async def test_a_proxied_hop_can_redirect_to_a_direct_address(self, plain_target):
        start = plain_target.url("/start", host="localhost")
        there = plain_target.url("/next")
        plain_target.server.enqueue(status=302, headers=[("Location", there)])
        plain_target.server.enqueue(body=b"arrived")

        with Proxy(upstream=("127.0.0.1", plain_target.port)) as server:
            _put_in_force(server, _only("localhost"))

            result = await _run(
                plain_target.parameters("/start", host="localhost", **_WAVE_SETTING)
            )

            assert _asked(server) == [("GET", start)]

        assert result["status_code"] == 200
        assert result["body"] == "arrived"
        assert result["final_url"] == there
        assert [seen["path"] for seen in plain_target.server.requests] == ["/start", "/next"]

    async def test_a_hop_to_the_other_protocol_uses_that_protocols_proxy(
        self, plain_target, tls_target
    ):
        there = tls_target.url("/next")
        plain_target.server.enqueue(status=302, headers=[("Location", there)])
        tls_target.server.enqueue(body=b"arrived")

        with Proxy() as secure, Proxy() as plain:
            _use_proxy(https=_endpoint(secure), http=_endpoint(plain))

            result = await _run(
                plain_target.parameters("/start", **tls_target.settings, **_WAVE_SETTING)
            )

            assert _asked(plain) == [plain_target.asked_of_a_proxy("/start")]
            assert _asked(secure) == [tls_target.asked_of_a_proxy("/next")]

        assert result["status_code"] == 200
        assert result["body"] == "arrived"
        assert result["final_url"] == there


class TestTheProxyLogLine:
    """The run log names the proxy once per block run whose request went through it."""

    async def test_a_request_through_the_proxy_names_it(self, target, forward_proxy):
        _put_in_force(forward_proxy)
        logger = Mock()

        await _run(target.parameters("/data", **_WAVE_SETTING), logger)

        assert _proxy_lines(logger) == [
            ("debug", f"Using the proxy 127.0.0.1:{forward_proxy.port}")
        ]

    async def test_two_proxied_hops_write_the_line_once(self, plain_target, forward_proxy):
        _put_in_force(forward_proxy)
        there = plain_target.url("/next")
        plain_target.server.enqueue(status=302, headers=[("Location", there)])
        plain_target.server.enqueue(body=b"arrived")
        logger = Mock()

        result = await _run(plain_target.parameters("/start", **_WAVE_SETTING), logger)

        assert result["body"] == "arrived"
        assert _asked(forward_proxy) == [
            plain_target.asked_of_a_proxy("/start"),
            plain_target.asked_of_a_proxy("/next"),
        ]
        assert _proxy_lines(logger) == [
            ("debug", f"Using the proxy 127.0.0.1:{forward_proxy.port}")
        ]

    async def test_a_retried_request_writes_the_line_once(self, plain_target, forward_proxy):
        _put_in_force(forward_proxy)
        plain_target.server.enqueue(status=503)
        plain_target.server.enqueue(body=b"second try")
        logger = Mock()

        result = await _run(
            plain_target.parameters("/data", retry_count=1, retry_delay=0.01, **_WAVE_SETTING),
            logger,
        )

        assert result["body"] == "second try"
        assert _asked(forward_proxy) == [plain_target.asked_of_a_proxy("/data")] * 2
        assert _proxy_lines(logger) == [
            ("debug", f"Using the proxy 127.0.0.1:{forward_proxy.port}")
        ]

    async def test_each_block_run_writes_its_own_line(self, plain_target, forward_proxy):
        _put_in_force(forward_proxy)
        loggers = [Mock(), Mock()]

        for logger in loggers:
            await _run(plain_target.parameters("/data", **_WAVE_SETTING), logger)

        expected = [("debug", f"Using the proxy 127.0.0.1:{forward_proxy.port}")]
        assert [_proxy_lines(logger) for logger in loggers] == [expected, expected]

    async def test_a_run_whose_hops_all_went_direct_writes_no_line(
        self, plain_target, forward_proxy
    ):
        _put_in_force(forward_proxy, _never)
        plain_target.server.enqueue(status=302, headers=[("Location", plain_target.url("/next"))])
        plain_target.server.enqueue(body=b"arrived")
        logger = Mock()

        result = await _run(plain_target.parameters("/start", **_WAVE_SETTING), logger)

        assert result["body"] == "arrived"
        assert forward_proxy.untouched
        assert _proxy_lines(logger) == []

    async def test_the_line_never_carries_the_login(self, target):
        logger = Mock()

        with Proxy(login=_LOGIN) as server:
            endpoint = _endpoint(server, *_LOGIN)
            _use_proxy(endpoint, endpoint)

            result = await _run(target.parameters("/data", **_WAVE_SETTING), logger)

            assert _proxy_lines(logger) == [("debug", f"Using the proxy 127.0.0.1:{server.port}")]

        assert result["status_code"] == 200

    async def test_the_line_is_written_on_the_event_loop_thread(self, target, forward_proxy):
        _put_in_force(forward_proxy)
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

        await _run(target.parameters("/data", **_WAVE_SETTING), logger)

        assert [entry for entry in written if entry[0].startswith("Using the proxy")] == [
            (f"Using the proxy 127.0.0.1:{forward_proxy.port}", threading.get_ident(), True)
        ]

    async def test_a_tunnel_whose_certificate_check_fails_still_names_the_proxy(
        self, tls_target, forward_proxy
    ):
        """The proxy carries the request once the tunnel is up, whatever the target then does."""
        _put_in_force(forward_proxy)
        logger = Mock()

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await _run({"method": "GET", "url": tls_target.url("/secure"), **_WAVE_SETTING}, logger)

        assert _asked(forward_proxy) == [tls_target.asked_of_a_proxy()]
        assert tls_target.server.requests == []
        assert _proxy_lines(logger) == [
            ("debug", f"Using the proxy 127.0.0.1:{forward_proxy.port}")
        ]

    async def test_a_failed_certificate_check_tried_again_writes_the_line_once(
        self, tls_target, forward_proxy
    ):
        _put_in_force(forward_proxy)
        logger = Mock()

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await _run(
                {
                    "method": "GET",
                    "url": tls_target.url("/secure"),
                    "retry_count": 1,
                    "retry_delay": 0.01,
                    **_WAVE_SETTING,
                },
                logger,
            )

        assert _asked(forward_proxy) == [tls_target.asked_of_a_proxy()] * 2
        assert _proxy_lines(logger) == [
            ("debug", f"Using the proxy 127.0.0.1:{forward_proxy.port}")
        ]

    async def test_a_request_that_fails_inside_the_tunnel_still_names_the_proxy(
        self, tls_target, forward_proxy
    ):
        _put_in_force(forward_proxy)
        tls_target.server.enqueue(body=b"slow", delay=1.5)
        logger = Mock()

        with pytest.raises(httpx.ReadTimeout):
            await _run(tls_target.parameters("/slow", timeout=1, **_WAVE_SETTING), logger)

        assert _asked(forward_proxy) == [tls_target.asked_of_a_proxy()]
        assert _proxy_lines(logger) == [
            ("debug", f"Using the proxy 127.0.0.1:{forward_proxy.port}")
        ]

    async def test_a_tunnel_hop_after_a_forwarded_hop_writes_the_line_once(
        self, plain_target, tls_target, forward_proxy
    ):
        _put_in_force(forward_proxy)
        there = tls_target.url("/secure")
        plain_target.server.enqueue(status=302, headers=[("Location", there)])
        logger = Mock()

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await _run(plain_target.parameters("/start", **_WAVE_SETTING), logger)

        assert _asked(forward_proxy) == [
            plain_target.asked_of_a_proxy("/start"),
            tls_target.asked_of_a_proxy(),
        ]
        assert _proxy_lines(logger) == [
            ("debug", f"Using the proxy 127.0.0.1:{forward_proxy.port}")
        ]

    @pytest.mark.parametrize(
        ("status", "reason"), [(403, "Forbidden"), (407, "Proxy Authentication Required")]
    )
    async def test_a_refused_tunnel_writes_no_line(self, tls_target, status, reason):
        logger = Mock()

        with Proxy(refuse=(status, reason)) as server:
            _put_in_force(server)

            with pytest.raises(httpx.ProxyError, match=rf": {status} {reason}$"):
                await _run(tls_target.parameters("/secure", **_WAVE_SETTING), logger)

            assert _asked(server) == [tls_target.asked_of_a_proxy()]

        assert _proxy_lines(logger) == []

    async def test_a_login_asked_of_a_forwarded_request_writes_no_line(self, plain_target):
        logger = Mock()

        with Proxy(login=_LOGIN) as server:
            _put_in_force(server)

            with pytest.raises(httpx.ProxyError, match=r": 407 Proxy Authentication Required$"):
                await _run(plain_target.parameters("/data", **_WAVE_SETTING), logger)

        assert _proxy_lines(logger) == []

    async def test_a_proxy_that_cannot_be_reached_writes_no_line(self, target):
        port = closed_port()
        dead = _proxy_core().ProxyEndpoint("127.0.0.1", port, None, None)
        _use_proxy(dead, dead)
        logger = Mock()

        with pytest.raises(
            httpx.ConnectError, match=rf"^Proxy 127\.0\.0\.1:{port} cannot be reached: .+$"
        ):
            await _run(target.parameters("/data", timeout=5, **_WAVE_SETTING), logger)

        assert _proxy_lines(logger) == []

    async def test_a_direct_address_whose_certificate_check_fails_writes_no_line(
        self, tls_target, forward_proxy
    ):
        _put_in_force(forward_proxy, _never)
        logger = Mock()

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await _run({"method": "GET", "url": tls_target.url("/secure"), **_WAVE_SETTING}, logger)

        assert forward_proxy.untouched
        assert _proxy_lines(logger) == []


class TestProxyFailures:
    """A proxy that refuses, cannot be reached or wants a login fails the block in its own words."""

    @pytest.mark.parametrize(
        ("status", "reason"), [(403, "Forbidden"), (407, "Proxy Authentication Required")]
    )
    async def test_a_refused_tunnel_names_the_proxy_the_target_and_the_answer(
        self, tls_target, status, reason
    ):
        with Proxy(refuse=(status, reason)) as server:
            _put_in_force(server)

            with pytest.raises(
                Exception,
                match=_exact(
                    f"Proxy 127.0.0.1:{server.port} refused the connection to "
                    f"127.0.0.1:{tls_target.port}: {status} {reason}"
                ),
            ):
                await _run(tls_target.parameters("/secure", **_WAVE_SETTING))

        assert tls_target.server.requests == []

    @pytest.mark.parametrize(
        ("scheme", "host", "named"),
        [
            ("https", "[2001:db8::7]", "[2001:db8::7]"),
            ("https", "bücher.test", "xn--bcher-kva.test"),
            ("http", "[2001:db8::7]", "[2001:db8::7]"),
        ],
        ids=["ipv6-tunnel", "idna-tunnel", "ipv6-forwarded"],
    )
    async def test_a_refusal_names_the_target_as_an_address_writes_it(self, scheme, host, named):
        """An IPv6 target keeps its brackets and a name outside ASCII is in its IDNA form."""
        with Proxy(refuse=(407, "Proxy Authentication Required")) as server:
            _put_in_force(server)

            with pytest.raises(
                Exception,
                match=_exact(
                    f"Proxy 127.0.0.1:{server.port} refused the connection to "
                    f"{named}:8443: 407 Proxy Authentication Required"
                ),
            ):
                await _run({"method": "GET", "url": f"{scheme}://{host}:8443/x", **_WAVE_SETTING})

    async def test_a_proxy_that_cannot_be_reached_is_named(self, target):
        core = _proxy_core()
        port = closed_port()
        dead = core.ProxyEndpoint("127.0.0.1", port, None, None)
        _use_proxy(dead, dead)

        with pytest.raises(Exception, match=rf"^Proxy 127\.0\.0\.1:{port} cannot be reached: .+$"):
            await _run(target.parameters("/data", timeout=5, **_WAVE_SETTING))

        assert target.server.requests == []

    async def test_a_login_asked_of_a_forwarded_request_fails_the_block(self, plain_target):
        """The proxy's own 407 is a refusal, never a response the block returns."""
        with Proxy(login=_LOGIN) as server:
            _put_in_force(server)

            with pytest.raises(
                Exception,
                match=_exact(
                    f"Proxy 127.0.0.1:{server.port} refused the connection to "
                    f"127.0.0.1:{plain_target.port}: 407 Proxy Authentication Required"
                ),
            ):
                await _run(plain_target.parameters("/data", **_WAVE_SETTING))

        assert plain_target.server.requests == []


class TestRetryCountAndTheProxy:
    """A proxy that fails is retried like a server that cannot be reached; a setting is not."""

    async def test_a_refused_tunnel_is_asked_for_again(self, tls_target):
        logger = Mock()

        with Proxy(refuse=(403, "Forbidden")) as server:
            _put_in_force(server)
            refused = (
                f"Proxy 127.0.0.1:{server.port} refused the connection to "
                f"127.0.0.1:{tls_target.port}: 403 Forbidden"
            )

            with pytest.raises(httpx.ProxyError, match=_exact(refused)):
                await _run(
                    tls_target.parameters(
                        "/secure", retry_count=1, retry_delay=0.01, **_WAVE_SETTING
                    ),
                    logger,
                )

            assert _asked(server) == [tls_target.asked_of_a_proxy()] * 2

        logger.warning.assert_called_once_with(f"Request failed: {refused}, retrying (1/1)")

    async def test_a_login_asked_of_a_forwarded_request_is_sent_again(self, plain_target):
        with Proxy(login=_LOGIN) as server:
            _put_in_force(server)

            with pytest.raises(httpx.ProxyError, match=r": 407 Proxy Authentication Required$"):
                await _run(
                    plain_target.parameters(
                        "/data", retry_count=1, retry_delay=0.01, **_WAVE_SETTING
                    )
                )

            assert _asked(server) == [plain_target.asked_of_a_proxy("/data")] * 2

    async def test_a_proxy_that_cannot_be_reached_is_dialed_again(self, target):
        core = _proxy_core()
        port = closed_port()
        dead = core.ProxyEndpoint("127.0.0.1", port, None, None)
        _use_proxy(dead, dead)
        logger = Mock()

        with pytest.raises(
            httpx.ConnectError, match=rf"^Proxy 127\.0\.0\.1:{port} cannot be reached: .+$"
        ) as caught:
            await _run(
                target.parameters(
                    "/data", timeout=5, retry_count=1, retry_delay=0.01, **_WAVE_SETTING
                ),
                logger,
            )

        logger.warning.assert_called_once_with(f"Request failed: {caught.value}, retrying (1/1)")

    async def test_a_route_decision_that_fails_is_not_asked_again(self, target, forward_proxy):
        asked: list[str] = []

        def decide(scheme: str, _host: str, _port: int) -> bool:
            asked.append(scheme)
            raise _proxy_core().ProxyError(_UNUSABLE_HOST_VALUE)

        _put_in_force(forward_proxy, decide)
        logger = Mock()

        with pytest.raises(_proxy_core().ProxyError, match=_exact(_UNUSABLE_HOST_VALUE)):
            await _run(
                target.parameters("/data", retry_count=2, retry_delay=0.01, **_WAVE_SETTING),
                logger,
            )

        assert asked == [target.scheme]
        assert forward_proxy.untouched
        logger.warning.assert_not_called()


class TestAWaveHostValueWaveCannotUse:
    """A proxy value of the WAVE host that WAVE cannot use fails only a request that needs it."""

    async def test_a_request_that_would_use_the_value_fails_with_its_text(
        self, target, forward_proxy
    ):
        _use_proxy(
            **{_other(target.scheme): _endpoint(forward_proxy)},
            through_proxy=_unusable(target.scheme),
        )

        with pytest.raises(Exception, match=_exact(_UNUSABLE_HOST_VALUE)):
            await _run(target.parameters("/data", **_WAVE_SETTING))

        assert forward_proxy.untouched
        assert target.server.requests == []

    async def test_a_request_of_the_other_protocol_still_goes_through_its_proxy(
        self, target, forward_proxy
    ):
        _use_proxy(
            **{target.scheme: _endpoint(forward_proxy)},
            through_proxy=_unusable(_other(target.scheme)),
        )

        result = await _run(target.parameters("/data", **_WAVE_SETTING))

        assert result["status_code"] == 200
        assert _asked(forward_proxy) == [target.asked_of_a_proxy("/data")]

    async def test_an_address_sent_direct_still_works(self, target, forward_proxy):
        _use_proxy(
            **{_other(target.scheme): _endpoint(forward_proxy)},
            through_proxy=_unusable(target.scheme),
        )
        target.server.enqueue(body=b"reached directly")

        result = await _run(target.parameters("/data", host="localhost", **_WAVE_SETTING))

        assert result["status_code"] == 200
        assert result["body"] == "reached directly"
        assert forward_proxy.untouched


class TestAListPatternThatTakesTooLong:
    """A Regex entry of the address list that takes too long fails that block run and no other."""

    @pytest.mark.parametrize(
        ("url", "address"),
        [
            (f"https://{_STUCK_HOST}/data", f"https://{_STUCK_HOST}"),
            (f"http://{_STUCK_HOST}:8080/data", f"http://{_STUCK_HOST}:8080"),
        ],
        ids=["default-port", "other-port"],
    )
    async def test_the_block_run_fails_at_the_limit_and_sends_nothing(
        self, plain_target, monkeypatch, url, address
    ):
        spans = []

        with Proxy(upstream=("127.0.0.1", plain_target.port)) as server:
            _put_in_force(server, _stuck_list(monkeypatch))

            for _ in range(5):
                started = time.perf_counter()
                with pytest.raises(Exception, match=_exact(_too_slow(address))):
                    await _run({"method": "GET", "url": url, **_WAVE_SETTING})
                spans.append(time.perf_counter() - started)

            assert server.untouched

        bound = _LOWERED_LIMIT_S + _LIMIT_MARGIN_S
        # The bound sits under the shipped limit, so the lowered value is the one the match used.
        assert bound < _SHIPPED_LIMIT_S
        assert min(spans) < bound
        assert plain_target.server.requests == []

    async def test_a_second_block_run_started_with_it_still_completes(
        self, plain_target, monkeypatch
    ):
        """A local address connects directly, so the second run never meets the list."""
        plain_target.server.enqueue(body=b"still served")

        with Proxy(upstream=("127.0.0.1", plain_target.port)) as server:
            _put_in_force(server, _stuck_list(monkeypatch))

            stuck, served = await asyncio.gather(
                _run({"method": "GET", "url": f"https://{_STUCK_HOST}/data", **_WAVE_SETTING}),
                _run(plain_target.parameters("/data", **_WAVE_SETTING)),
                return_exceptions=True,
            )

            assert server.untouched

        assert isinstance(stuck, Exception)
        assert str(stuck) == _too_slow(f"https://{_STUCK_HOST}")
        assert isinstance(served, dict)
        assert served["status_code"] == 200
        assert served["body"] == "still served"
        assert [seen["path"] for seen in plain_target.server.requests] == ["/data"]


class TestTheProxyPasswordNeverShows:
    """Nothing the block returns, logs or fails with carries the proxy password."""

    async def test_a_request_through_the_proxy_shows_no_password(self, target):
        logger = Mock()

        with Proxy(login=_LOGIN) as server:
            endpoint = _endpoint(server, *_LOGIN)
            _use_proxy(endpoint, endpoint)

            result = await _run(target.parameters("/data", **_WAVE_SETTING), logger)

            assert server.requests[0].headers["proxy-authorization"] == _LOGIN_HEADER

        assert result["status_code"] == 200
        assert "s3cret" not in repr(result)
        assert "s3cret" not in repr(logger.mock_calls)

    async def test_a_refused_tunnel_shows_no_password(self, tls_target):
        logger = Mock()

        with Proxy(refuse=(403, "Forbidden")) as server:
            endpoint = _endpoint(server, *_LOGIN)
            _use_proxy(endpoint, endpoint)

            with pytest.raises(
                Exception,
                match=_exact(
                    f"Proxy 127.0.0.1:{server.port} refused the connection to "
                    f"127.0.0.1:{tls_target.port}: 403 Forbidden"
                ),
            ) as caught:
                await _run(tls_target.parameters("/secure", **_WAVE_SETTING), logger)

        assert "s3cret" not in repr(caught.value)
        assert "s3cret" not in repr(logger.mock_calls)

    async def test_a_proxy_that_cannot_be_reached_shows_no_password(self, target):
        logger = Mock()
        port = closed_port()
        dead = _proxy_core().ProxyEndpoint("127.0.0.1", port, *_LOGIN)
        _use_proxy(dead, dead)

        with pytest.raises(
            Exception, match=rf"^Proxy 127\.0\.0\.1:{port} cannot be reached: .+$"
        ) as caught:
            await _run(target.parameters("/data", timeout=5, **_WAVE_SETTING), logger)

        assert "s3cret" not in f"{caught.value} {caught.value!r}"
        assert "s3cret" not in repr(logger.mock_calls)

    async def test_a_login_the_proxy_does_not_accept_shows_no_password(self, plain_target):
        logger = Mock()

        with Proxy(login=("wave", "another")) as server:
            _use_proxy(http=_endpoint(server, *_LOGIN))

            with pytest.raises(
                Exception,
                match=_exact(
                    f"Proxy 127.0.0.1:{server.port} refused the connection to "
                    f"127.0.0.1:{plain_target.port}: 407 Proxy Authentication Required"
                ),
            ) as caught:
                await _run(plain_target.parameters("/data", **_WAVE_SETTING), logger)

        assert "s3cret" not in repr(caught.value)
        assert "s3cret" not in repr(logger.mock_calls)


class TestHttpsThroughTheProxy:
    """An https target behind the proxy is handshaken and verified by WAVE's own TLS engine."""

    async def test_the_block_ca_verifies_the_target_and_the_trace_has_its_tls_facts(
        self, tls_target, forward_proxy
    ):
        _put_in_force(forward_proxy)
        tls_target.server.enqueue(body=b"through the tunnel")

        result = await _run(tls_target.parameters("/secure", **_WAVE_SETTING))

        assert _asked(forward_proxy) == [tls_target.asked_of_a_proxy()]
        assert result["status_code"] == 200
        assert result["body"] == "through the tunnel"
        tls = result["trace"]["tls"]
        assert tls["protocol"] == "TLSv1.3"
        assert tls["cipher"]
        assert tls["peer_subject"] == "CN=wave-test-server"
        assert tls["peer_issuer"] == "CN=wave-test-ca"
        assert tls["not_before"]
        assert tls["not_after"]
        assert 90 <= tls["days_to_expiry"] <= 100

    async def test_a_target_outside_the_trust_set_fails_verification(
        self, tls_target, forward_proxy
    ):
        """No block CA means WAVE's built-in list, which does not hold the test CA."""
        _put_in_force(forward_proxy)

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await _run({"method": "GET", "url": tls_target.url("/secure"), **_WAVE_SETTING})

        assert _asked(forward_proxy) == [tls_target.asked_of_a_proxy()]
        assert tls_target.server.requests == []

    async def test_ssl_cert_file_naming_the_test_ca_adds_no_trust(
        self, tls_target, tls_material, forward_proxy, monkeypatch
    ):
        monkeypatch.setenv("SSL_CERT_FILE", tls_material.ca_cert_path)
        _put_in_force(forward_proxy)

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await _run({"method": "GET", "url": tls_target.url("/secure"), **_WAVE_SETTING})

        assert _asked(forward_proxy) == [tls_target.asked_of_a_proxy()]

    async def test_ssl_cert_file_naming_a_missing_file_breaks_nothing(
        self, tls_target, forward_proxy, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("SSL_CERT_FILE", str(tmp_path / "missing.pem"))
        _put_in_force(forward_proxy)
        tls_target.server.enqueue(body=b"through the tunnel")

        result = await _run(tls_target.parameters("/secure", **_WAVE_SETTING))

        assert result["status_code"] == 200
        assert result["body"] == "through the tunnel"
        assert _asked(forward_proxy) == [tls_target.asked_of_a_proxy()]

    @pytest.mark.parametrize(
        ("password", "header"),
        [("s3cret", _LOGIN_HEADER), (None, _USERNAME_ONLY_HEADER)],
        ids=["password", "no password"],
    )
    async def test_the_connect_line_names_the_target_and_carries_the_login(
        self, tls_target, password, header
    ):
        with Proxy(login=("wave", password or "")) as server:
            _use_proxy(https=_endpoint(server, "wave", password))

            result = await _run(tls_target.parameters("/secure", **_WAVE_SETTING))

            assert [
                (asked.method, asked.target, asked.headers.get("proxy-authorization"))
                for asked in server.requests
            ] == [("CONNECT", f"127.0.0.1:{tls_target.port}", header)]

        assert result["status_code"] == 200

    async def test_the_connect_line_names_the_default_port_of_a_url_without_one(self, tls_target):
        url = "https://localhost/secure"

        with Proxy(upstream=("127.0.0.1", tls_target.port)) as server:
            _put_in_force(server)

            result = await _run({**tls_target.parameters(), "url": url, **_WAVE_SETTING})

            assert _asked(server) == [("CONNECT", "localhost:443")]

        assert result["status_code"] == 200

    async def test_an_address_sent_direct_is_dialed_directly(self, tls_target, forward_proxy):
        _put_in_force(forward_proxy, _never)
        tls_target.server.enqueue(body=b"reached directly")

        result = await _run(tls_target.parameters("/secure", **_WAVE_SETTING))

        assert forward_proxy.untouched
        assert result["status_code"] == 200
        assert result["body"] == "reached directly"
        assert result["trace"]["tls"]["peer_subject"] == "CN=wave-test-server"

    async def test_an_address_sent_direct_is_still_verified(self, tls_target, forward_proxy):
        _put_in_force(forward_proxy, _never)

        with pytest.raises(httpx.HTTPError, match=_UNTRUSTED):
            await _run({"method": "GET", "url": tls_target.url("/secure"), **_WAVE_SETTING})

        assert forward_proxy.untouched

    async def test_the_first_byte_is_timed_on_the_targets_answer(self, tls_target, forward_proxy):
        """The proxy's answer to the tunnel request is not the response the trace times."""
        _put_in_force(forward_proxy)
        tls_target.server.enqueue(body=b"slow", delay=_ANSWER_DELAY_S)

        result = await _run(tls_target.parameters("/secure", **_WAVE_SETTING))

        timing = result["trace"]["timing"]
        assert result["body"] == "slow"
        assert timing["first_byte_ms"] >= _ANSWER_DELAY_S * 1000
        assert timing["total_ms"] >= timing["first_byte_ms"]

    async def test_a_407_from_a_target_behind_the_tunnel_is_its_response(
        self, tls_target, forward_proxy
    ):
        """Through a tunnel only the target can answer the request, so its 407 is returned."""
        _put_in_force(forward_proxy)
        tls_target.server.enqueue(status=407, body=b"asked by the target")

        result = await _run(tls_target.parameters("/secure", **_WAVE_SETTING))

        assert result["status_code"] == 407
        assert result["body"] == "asked by the target"
        assert _asked(forward_proxy) == [tls_target.asked_of_a_proxy()]


class TestTLSConfigParameterMetadata:
    """Section 11 TLS params: version pins + ordered cipher_suites."""

    @pytest.mark.parametrize(
        ("name", "default"), [("tls_min_version", "1.2"), ("tls_max_version", "1.3")]
    )
    def test_tls_version_parameter_definitions(self, name, default):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        version_param = params[name]
        assert version_param["type"] == "string"
        assert version_param["trim"] is True
        assert version_param["required"] is False
        assert version_param["default"] == default
        assert version_param["enum_values"] == ["1.0", "1.1", "1.2", "1.3"]

    def test_cipher_suites_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        cipher_param = params["cipher_suites"]
        assert cipher_param["type"] == "array"
        assert cipher_param["required"] is False
        assert "default" not in cipher_param

    def test_tls_params_sit_after_client_key(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        names = [p["name"] for p in HTTPClientPlugin().metadata["parameters"]]

        anchor = names.index("client_key")
        assert names[anchor + 1 : anchor + 4] == [
            "tls_min_version",
            "tls_max_version",
            "cipher_suites",
        ]

    @pytest.mark.asyncio
    async def test_invalid_tls_version_rejected_with_enum_message(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'tls_min_version' must be one of: "
                r"1\.0, 1\.1, 1\.2, 1\.3; "
                r"Actual value was 'ssl3'\.$"
            ),
        ):
            await plugin.validate(
                {"method": "GET", "url": "https://example.com", "tls_min_version": "ssl3"}
            )

    @pytest.mark.asyncio
    async def test_auto_is_no_longer_a_tls_version(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'tls_max_version' must be one of: "
                r"1\.0, 1\.1, 1\.2, 1\.3; "
                r"Actual value was 'auto'\.$"
            ),
        ):
            await plugin.validate(
                {"method": "GET", "url": "https://example.com", "tls_max_version": "auto"}
            )

    @pytest.mark.asyncio
    async def test_cipher_suites_must_be_an_array(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match=r"^Parameter 'cipher_suites' must be an array$"):
            await plugin.validate(
                {"method": "GET", "url": "https://example.com", "cipher_suites": "AES256-SHA"}
            )


class TestTLSVersionPins:
    """Version pins bound the engine's offered range (real handshakes)."""

    @pytest.mark.asyncio
    async def test_default_range_negotiates_tls13(self, tls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"modern")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/pin",
                    "ca_cert": tls_material.ca_cert_path,
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["protocol"] == "TLSv1.3"

    @pytest.mark.asyncio
    async def test_max_pin_caps_the_negotiated_protocol(self, tls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"capped")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/pin",
                    "ca_cert": tls_material.ca_cert_path,
                    "tls_max_version": "1.2",
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["protocol"] == "TLSv1.2"

    @pytest.mark.asyncio
    async def test_equal_min_and_max_pins_are_accepted(self, tls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"exact")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/pin",
                    "ca_cert": tls_material.ca_cert_path,
                    "tls_min_version": "1.2",
                    "tls_max_version": "1.2",
                }
            )
        )

        assert result["trace"]["tls"]["protocol"] == "TLSv1.2"

    @pytest.mark.asyncio
    async def test_min_above_max_fails_before_sending(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                ValueError, match=r"^Min TLS Version cannot exceed Max TLS Version$"
            ):
                await plugin.execute(
                    _context(
                        {
                            "method": "GET",
                            "url": "https://example.com",
                            "tls_min_version": "1.3",
                            "tls_max_version": "1.2",
                        }
                    )
                )

        client.request.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_verify_ssl_off_with_a_pin_still_pins(self, tls_server):
        """Skipping verification must not skip the version pin."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"unverified-pin")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/pin",
                    "verify_ssl": False,
                    "tls_max_version": "1.2",
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["protocol"] == "TLSv1.2"


class TestCipherSuitePins:
    """Ordered cipher pins restrict negotiation; both name formats accepted."""

    @pytest.mark.asyncio
    async def test_pinned_ciphers_restrict_negotiation(self, tls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        rows = _le12_ecdsa_rows()
        assert rows
        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"cipher-pinned")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/ciphers",
                    "ca_cert": tls_material.ca_cert_path,
                    "tls_max_version": "1.2",
                    "cipher_suites": [row["openssl"] for row in rows],
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["cipher"] in {row["iana"] for row in rows}

    @pytest.mark.asyncio
    async def test_single_suite_pin_negotiates_exactly_that_suite(self, tls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        row = _le12_ecdsa_rows()[0]
        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"exact-suite")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/ciphers",
                    "ca_cert": tls_material.ca_cert_path,
                    "tls_max_version": "1.2",
                    "cipher_suites": [row["openssl"]],
                }
            )
        )

        assert result["trace"]["tls"]["cipher"] == row["iana"]

    @pytest.mark.asyncio
    async def test_iana_names_normalize_to_the_same_negotiation(self, tls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        rows = _le12_ecdsa_rows()
        assert rows
        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"iana-pinned")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/ciphers",
                    "ca_cert": tls_material.ca_cert_path,
                    "tls_max_version": "1.2",
                    "cipher_suites": [row["iana"] for row in rows],
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["cipher"] in {row["iana"] for row in rows}

    @pytest.mark.asyncio
    async def test_unknown_cipher_name_fails_before_sending(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(ValueError, match=r'^Unknown cipher suite "NOT-A-CIPHER"$'):
                await plugin.execute(
                    _context(
                        {
                            "method": "GET",
                            "url": "https://example.com",
                            "cipher_suites": ["NOT-A-CIPHER"],
                        }
                    )
                )

        client.request.assert_not_awaited()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("ciphers", "row"),
        [
            pytest.param([None], 1, id="first-row"),
            pytest.param(["TLS_AES_128_GCM_SHA256", None], 2, id="second-row"),
        ],
    )
    async def test_a_null_cipher_entry_fails_naming_its_row_before_sending(
        self, ciphers: list[Any], row: int
    ):
        """REQ-3.1.3.21: the block names the null entry, never 'Unknown cipher suite "None"'."""
        from wavecore.core.expressions.errors import NullValueError
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        params = {"method": "GET", "url": "https://example.com", "cipher_suites": ciphers}
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                NullValueError, match=_exact(f"Row {row} in 'cipher_suites' is null")
            ):
                await plugin.validate(params)
                await plugin.execute(_context(params))

        client.request.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_tls13_suite_pin_negotiates_that_suite(self, tls_server, tls_material):
        """TLS 1.3 suites are selectable - a 1.3 pin negotiates the named suite."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"tls13-suite")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/ciphers",
                    "ca_cert": tls_material.ca_cert_path,
                    "tls_min_version": "1.3",
                    "tls_max_version": "1.3",
                    "cipher_suites": ["TLS_AES_128_GCM_SHA256"],
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["protocol"] == "TLSv1.3"
        assert result["trace"]["tls"]["cipher"] == "TLS_AES_128_GCM_SHA256"

    @pytest.mark.asyncio
    async def test_tls13_suite_name_is_accepted_in_the_default_range(
        self, tls_server, tls_material
    ):
        """No 'TLS 1.3 suites are fixed' rejection remains anywhere."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"accepted")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/ciphers",
                    "ca_cert": tls_material.ca_cert_path,
                    "cipher_suites": ["TLS_AES_128_GCM_SHA256"],
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["cipher"] == "TLS_AES_128_GCM_SHA256"


class TestLegacyTLS:
    """Legacy 1.0/1.1 pins complete real handshakes against a permissive server."""

    @pytest.mark.asyncio
    async def test_legacy_range_pin_completes_a_tls10_handshake(
        self, legacy_tls_server, tls_material
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        legacy_tls_server.enqueue(body=b"legacy-ok")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{legacy_tls_server.base_url}/legacy",
                    "ca_cert": tls_material.ca_cert_path,
                    "tls_min_version": "1.0",
                    "tls_max_version": "1.0",
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["protocol"] == "TLSv1"

    @pytest.mark.asyncio
    async def test_legacy_min_pin_keeps_pinned_ciphers_live(self, tls_server, tls_material):
        """A lowered floor never disables the cipher pin."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        rows = _le12_ecdsa_rows()
        assert rows
        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"legacy-min")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/legacy-min",
                    "ca_cert": tls_material.ca_cert_path,
                    "tls_min_version": "1.0",
                    "tls_max_version": "1.2",
                    "cipher_suites": [row["openssl"] for row in rows],
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["protocol"] == "TLSv1.2"
        assert result["trace"]["tls"]["cipher"] in {row["iana"] for row in rows}

    @pytest.mark.asyncio
    async def test_lone_legacy_max_fails_the_version_order_guard(self):
        """A legacy max without a lowered min violates the 1.2 default minimum."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(text="OK")

        with patch_async_client(client):
            with pytest.raises(
                ValueError, match=r"^Min TLS Version cannot exceed Max TLS Version$"
            ):
                await plugin.execute(
                    _context(
                        {
                            "method": "GET",
                            "url": "https://example.com",
                            "tls_max_version": "1.0",
                        }
                    )
                )

        client.request.assert_not_awaited()


class TestZeroCipherSuites:
    """An explicit empty cipher list offers no ciphers - the server refuses."""

    @pytest.mark.asyncio
    async def test_zero_ciphers_fail_the_real_handshake(self, tls_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(httpx.HTTPError):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{tls_server.base_url}/zero",
                        "verify_ssl": False,
                        "cipher_suites": [],
                    }
                )
            )


class TestServerVerification:
    """The backend verifies the presented chain against the configured anchors."""

    @pytest.mark.asyncio
    async def test_default_trust_rejects_a_private_ca(self, tls_server):
        """No ca_cert means the bundled trust store - the throwaway CA fails it."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            httpx.HTTPError,
            match=(
                r"^Certificate verification failed: no trusted issuer found "
                r'for certificate "CN=wave-test-server"$'
            ),
        ):
            await plugin.execute(
                _context({"method": "GET", "url": f"{tls_server.base_url}/secure"})
            )

    @pytest.mark.asyncio
    async def test_custom_ca_file_path_passes_verification(self, tls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"trusted")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/secure",
                    "ca_cert": tls_material.ca_cert_path,
                }
            )
        )

        assert result["status_code"] == 200

    @pytest.mark.asyncio
    async def test_custom_ca_inline_pem_passes_verification(self, tls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"inline-trusted")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/secure",
                    "ca_cert": tls_material.ca_cert_pem,
                }
            )
        )

        assert result["status_code"] == 200

    @pytest.mark.asyncio
    async def test_verify_ssl_off_accepts_any_certificate(self, tls_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"unverified")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{tls_server.base_url}/secure",
                    "verify_ssl": False,
                }
            )
        )

        assert result["status_code"] == 200
        assert result["trace"]["tls"]["protocol"].startswith("TLSv")


async def _run_with_tunnels(registry: Any, parameters: dict[str, Any]) -> dict[str, Any]:
    """One block run on the real client, in a run whose SSH tunnels `registry` holds."""
    from wavecore.plugins.http_client import HTTPClientPlugin

    return await HTTPClientPlugin().execute(_context(parameters, ssh_session_registry=registry))


def _far_host_mismatch(far_host: str) -> str:
    return _exact(
        f'Certificate verification failed: hostname "{far_host}" does not match '
        "the server certificate"
    )


class TestAnSshTunnel:
    """A connection to an open tunnel's Local Port names and checks the tunnel's far host."""

    async def test_the_far_host_is_the_server_name_and_the_checked_name(self, tls_target):
        names = record_sni(tls_target.server)
        registry = tunnel_registry({tls_target.port: "localhost:443"}, Mock())

        result = await _run_with_tunnels(registry, tls_target.parameters("/secure"))

        assert result["status_code"] == 200
        assert names == ["localhost"]

    @pytest.mark.parametrize("host", ["127.0.0.1", "localhost"])
    async def test_a_far_host_the_certificate_does_not_name_fails_verification(
        self, tls_target, host
    ):
        registry = tunnel_registry({tls_target.port: "api.internal:443"}, Mock())

        with pytest.raises(httpx.HTTPError, match=_far_host_mismatch("api.internal")):
            await _run_with_tunnels(registry, tls_target.parameters("/secure", host))

        assert tls_target.server.requests == []

    async def test_verify_off_still_sends_the_far_host_name(self, tls_target):
        names = record_sni(tls_target.server)
        registry = tunnel_registry({tls_target.port: "api.internal:443"}, Mock())

        result = await _run_with_tunnels(
            registry, tls_target.parameters("/secure", verify_ssl=False)
        )

        assert result["status_code"] == 200
        assert names == ["api.internal"]

    async def test_a_port_with_no_open_tunnel_checks_the_url_host(self, tls_target):
        names = record_sni(tls_target.server)
        registry = tunnel_registry({tls_target.port + 1: "api.internal:443"}, Mock())

        result = await _run_with_tunnels(registry, tls_target.parameters("/secure"))

        assert result["status_code"] == 200
        assert names == [None]

    async def test_a_redirect_off_the_tunnel_checks_the_new_host(
        self, tls_target, legacy_tls_server
    ):
        tunneled, elsewhere = record_sni(tls_target.server), record_sni(legacy_tls_server)
        tls_target.server.enqueue(302, [("Location", f"{legacy_tls_server.base_url}/next")])
        registry = tunnel_registry({tls_target.port: "localhost:443"}, Mock())

        result = await _run_with_tunnels(registry, tls_target.parameters("/secure"))

        assert result["status_code"] == 200
        assert (tunneled, elsewhere) == (["localhost"], [None])

    async def test_a_tunnel_the_proxy_setting_sends_direct_names_the_far_host(
        self, tls_target, forward_proxy
    ):
        _put_in_force(forward_proxy, _never)
        names = record_sni(tls_target.server)
        registry = tunnel_registry({tls_target.port: "api.internal:443"}, Mock())

        with pytest.raises(httpx.HTTPError, match=_far_host_mismatch("api.internal")):
            await _run_with_tunnels(registry, tls_target.parameters("/secure", **_WAVE_SETTING))

        assert names == ["api.internal"]
        assert forward_proxy.untouched


class TestNetworkFailurePaths:
    """Transport failures surface as the matching httpx errors."""

    @pytest.mark.asyncio
    async def test_https_connection_refused_maps_to_connect_error(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        dead_port = probe.getsockname()[1]
        probe.close()
        plugin = HTTPClientPlugin()

        with pytest.raises(httpx.ConnectError):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"https://127.0.0.1:{dead_port}/x",
                        "verify_ssl": False,
                        "timeout": 5,
                    }
                )
            )

    @pytest.mark.asyncio
    async def test_saturated_backlog_maps_to_connect_timeout(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(0)
        port = listener.getsockname()[1]
        saturating: list[socket.socket] = []
        for _ in range(4):
            filler = socket.socket()
            filler.setblocking(False)
            try:
                filler.connect(("127.0.0.1", port))
            except BlockingIOError:
                pass
            saturating.append(filler)
        plugin = HTTPClientPlugin()

        try:
            with pytest.raises(httpx.ConnectTimeout):
                await plugin.execute(
                    _context({"method": "GET", "url": f"http://127.0.0.1:{port}/x", "timeout": 1})
                )
        finally:
            for filler in saturating:
                filler.close()
            listener.close()

    @pytest.mark.asyncio
    async def test_tls_response_delay_maps_to_read_timeout(self, tls_server, tls_material):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        tls_server.enqueue(body=b"slow", delay=3.0)

        with pytest.raises(httpx.ReadTimeout):
            await plugin.execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{tls_server.base_url}/slow",
                        "ca_cert": tls_material.ca_cert_path,
                        "timeout": 1,
                    }
                )
            )

    @pytest.mark.asyncio
    async def test_plain_response_delay_maps_to_read_timeout(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"slow", delay=3.0)

        with pytest.raises(httpx.ReadTimeout):
            await plugin.execute(
                _context({"method": "GET", "url": f"{http_server.base_url}/slow", "timeout": 1})
            )


_TLS_VERSIONS = ("1.0", "1.1", "1.2", "1.3")
_TLS_RANGES = [(low, high) for i, low in enumerate(_TLS_VERSIONS) for high in _TLS_VERSIONS[i:]]
# Signaling values that ride the ClientHello cipher list; they are not suites.
_SIGNALING_SUITES = {0x00FF, 0x5600}


def _suites_offered_unset(min_version: str, max_version: str) -> list[int]:
    """The cipher suites the engine's ClientHello offers when Cipher Suites is unset."""
    import datetime

    from tlslite.messages import ClientHello
    from tlslite.utils.codec import Parser

    from wavecore.plugins import http_tls

    config = http_tls.TLSClientConfig(
        min_version=min_version, max_version=max_version, verify=False
    )
    now = datetime.datetime(2026, 7, 19, tzinfo=datetime.UTC)
    client, server = socket.socketpair()
    try:
        server.shutdown(socket.SHUT_WR)
        with pytest.raises(http_tls.TLSHandshakeError):
            http_tls.tls_handshake(client, config, "tls.test", now)
        client.close()
        sent = b""
        while chunk := server.recv(65536):
            sent += chunk
    finally:
        client.close()
        server.close()
    # Past the record header (5 bytes) and the handshake type byte.
    hello = ClientHello().parse(Parser(bytearray(sent[6:])))
    return [suite for suite in hello.cipher_suites if suite not in _SIGNALING_SUITES]


class TestCipherSuitesLeftUnset:
    """An unset Cipher Suites offers its default list and nothing else (REQ-3.1.1.5)."""

    @pytest.mark.parametrize(("low", "high"), _TLS_RANGES)
    def test_the_wire_carries_exactly_the_default_list(self, low: str, high: str) -> None:
        from wavecore.connectivity import tls_capabilities
        from wavecore.plugins import http_tls

        typed = http_tls.TLSClientConfig(
            min_version=low,
            max_version=high,
            cipher_names=tls_capabilities.suites_for_range(low, high),
        )

        assert _suites_offered_unset(low, high) == http_tls.wire_cipher_codepoints(typed)

    @pytest.mark.parametrize(("low", "high"), _TLS_RANGES)
    def test_no_suite_outside_the_catalog_goes_on_the_wire(self, low: str, high: str) -> None:
        from wavecore.connectivity import tls_capabilities

        catalog = {row["codepoint"] for row in tls_capabilities.catalog()}
        offered = _suites_offered_unset(low, high)

        assert [hex(suite) for suite in offered if suite not in catalog] == []


class TestWireCipherRange:
    """The engine drops a pinned suite outside the TLS range by the one rank table."""

    @pytest.mark.parametrize(("low", "high"), _TLS_RANGES)
    def test_a_pinned_suite_goes_on_the_wire_only_inside_its_range(
        self, low: str, high: str
    ) -> None:
        from wavecore.connectivity import tls_capabilities
        from wavecore.plugins import http_tls

        for row in tls_capabilities.catalog():
            config = http_tls.TLSClientConfig(
                min_version=low, max_version=high, cipher_names=[row["openssl"]]
            )
            in_range = tls_capabilities.suite_in_range(row["openssl"], low, high)

            expected = [row["codepoint"]] if in_range else []
            assert http_tls.wire_cipher_codepoints(config) == expected

    def test_the_engine_keeps_no_rank_table_of_its_own(self) -> None:
        from wavecore.plugins import http_tls

        assert not hasattr(http_tls, "_version_rank")
