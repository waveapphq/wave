"""The proxy core every raw-socket transport dials through (REQ-4.7.14, REQ-4.6.8).

`connect` gives a transport its socket: straight to the target when no proxy applies, else
through an HTTP CONNECT tunnel on the proxy the registered resolver names. The proxy for https
targets and the one for http targets are chosen apart, the run log names a used proxy once per
block run, every proxy failure is a `ProxyError`, and the process environment is never read.
"""

import contextvars
import dataclasses
import logging
import re
import socket
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

from tests.connectivity._proxy_servers import (
    EchoTarget,
    Proxy,
    closed_port,
)
from tests.core.remote_exec._vendorability import (
    import_candidates,
    is_stdlib,
    matches,
    parses_at_the_floor,
    post_floor_names,
)
from wavecore.connectivity import proxy
from wavecore.connectivity.proxy import (
    ProxyEndpoint,
    ProxyError,
    ProxySpec,
    active_proxy,
    connect,
    route_for,
    set_resolver,
)
from wavecore.connectivity.run_log import RUN_LOG, RunLog

_PATH = Path(str(proxy.__file__))
# Carried beside the proxy module in the remote bundle.
_VENDORED_SIBLINGS = ("wavecore.connectivity.run_log", "wavecore.connectivity.web_address")
_TARGET = "target.example"
_TIMEOUT = 5.0
_LOGIN = ("wave", "s3cret")
_LOGIN_HEADER = "Basic d2F2ZTpzM2NyZXQ="
_USERNAME_ONLY_HEADER = "Basic d2F2ZTo="
_HTTPS_ENDPOINT = ProxyEndpoint("secure-proxy.example", 3128, None, None)
_HTTP_ENDPOINT = ProxyEndpoint("plain-proxy.example", 8080, None, None)
_PROXY_VARIABLES = (
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
)
_EXCEPTION_VARIABLES = ("NO_PROXY", "no_proxy")
# Ends a call that ignores its timeout, so a broken bound fails the test and never hangs it.
_HANG_GUARD = 2.0

Lines = list[tuple[str, str]]
Decision = Callable[[str, str, int], bool]


def _exact(text: str) -> str:
    return f"^{re.escape(text)}$"


def _always(_scheme: str, _host: str, _port: int) -> bool:
    return True


def _never(_scheme: str, _host: str, _port: int) -> bool:
    return False


def _recording(asked: list[tuple[str, str, int]]) -> Decision:
    """A decision that keeps what it was asked and sends everything through the proxy."""

    def decide(scheme: str, host: str, port: int) -> bool:
        asked.append((scheme, host, port))
        return True

    return decide


def _endpoint(
    server: Proxy, username: str | None = None, password: str | None = None
) -> ProxyEndpoint:
    return ProxyEndpoint(server.host, server.port, username, password)


def _use(
    https: ProxyEndpoint | None = None,
    http: ProxyEndpoint | None = None,
    through_proxy: Decision = _always,
) -> None:
    """Put a proxy in force the way the WAVE host does: through the registered resolver."""
    spec = ProxySpec(https, http, through_proxy)
    set_resolver(lambda: spec)


def _echoed(sock: socket.socket, payload: bytes = b"ping") -> bytes:
    """Send bytes down the socket and read the target's whole answer to them."""
    sock.sendall(payload)
    wanted = len(b"echo:") + len(payload)
    answer = b""
    while len(answer) < wanted and (more := sock.recv(wanted - len(answer))):
        answer += more
    return answer


def _until_blank_line(sock: socket.socket) -> bytes:
    """Read from the socket up to the next blank line."""
    data = b""
    while not data.endswith(b"\r\n\r\n") and (more := sock.recv(1024)):
        data += more
    return data


@contextmanager
def _hanging_up() -> Iterator[int]:
    """A loopback listener that reads one request and closes without an answer; gives its port."""
    with socket.create_server(("127.0.0.1", 0)) as listener:

        def serve() -> None:
            near, _ = listener.accept()
            with near:
                near.recv(65536)

        served = threading.Thread(target=serve, daemon=True)
        served.start()
        yield listener.getsockname()[1]
        served.join(_HANG_GUARD)


def _set_environment(monkeypatch: pytest.MonkeyPatch, proxy_address: str, exceptions: str) -> None:
    """Name one proxy in every proxy variable and one entry in every exception variable."""
    for name in _PROXY_VARIABLES:
        monkeypatch.setenv(name, proxy_address)
    for name in _EXCEPTION_VARIABLES:
        monkeypatch.setenv(name, exceptions)


def _sink(lines: Lines) -> RunLog:
    return RunLog(lambda level, message: lines.append((level, message)))


def _line(server: Proxy) -> tuple[str, str]:
    return ("DEBUG", f"Using the proxy {server.authority}")


@pytest.fixture(autouse=True)
def no_resolver() -> Iterator[None]:
    set_resolver(None)
    yield
    set_resolver(None)


@pytest.fixture
def run_lines() -> Iterator[Lines]:
    """One block run: its sink is active for the test and removed after."""
    lines: Lines = []
    token = RUN_LOG.set(_sink(lines))
    yield lines
    RUN_LOG.reset(token)


@pytest.fixture
def target() -> Iterator[EchoTarget]:
    with EchoTarget() as server:
        yield server


@pytest.fixture
def tunnel_proxy(target: EchoTarget) -> Iterator[Proxy]:
    """A proxy that tunnels to the in-process target whatever address it is asked for."""
    with Proxy(upstream=(target.host, target.port)) as server:
        yield server


@pytest.fixture
def in_force(tunnel_proxy: Proxy) -> Proxy:
    """The tunneling proxy, in force for https and http targets alike."""
    _use(_endpoint(tunnel_proxy), _endpoint(tunnel_proxy))
    return tunnel_proxy


class TestProxyEndpoint:
    """One proxy address with its login."""

    def test_the_fields_in_order(self) -> None:
        names = [field.name for field in dataclasses.fields(ProxyEndpoint)]

        assert names == ["host", "port", "username", "password"]

    def test_it_is_frozen(self) -> None:
        endpoint = ProxyEndpoint("proxy.example", 3128, None, None)

        with pytest.raises(dataclasses.FrozenInstanceError):
            endpoint.host = "other.example"

    @pytest.mark.parametrize(
        ("host", "port", "display"),
        [
            ("proxy.example", 3128, "proxy.example:3128"),
            ("10.0.0.5", 8080, "10.0.0.5:8080"),
            ("::1", 3128, "[::1]:3128"),
            ("2001:db8::5", 8080, "[2001:db8::5]:8080"),
        ],
    )
    def test_display_is_the_host_and_port_with_an_ipv6_host_in_brackets(
        self, host: str, port: int, display: str
    ) -> None:
        assert ProxyEndpoint(host, port, None, None).display == display

    def test_display_never_shows_the_login(self) -> None:
        assert ProxyEndpoint("proxy.example", 3128, *_LOGIN).display == "proxy.example:3128"


class TestProxySpec:
    """The effective proxy: one endpoint per protocol and the WAVE host's route decision."""

    def test_the_fields_in_order(self) -> None:
        names = [field.name for field in dataclasses.fields(ProxySpec)]

        assert names == ["https", "http", "through_proxy"]

    def test_it_is_frozen(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)

        with pytest.raises(dataclasses.FrozenInstanceError):
            spec.https = None


class TestRouteFor:
    """Each protocol has its own endpoint, and the spec's decision says whether it is used."""

    def test_no_spec_is_a_direct_connection(self) -> None:
        assert route_for("https", "a.example", 443, None) is None

    def test_an_https_target_uses_the_https_endpoint(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)

        assert route_for("https", "a.example", 443, spec) == _HTTPS_ENDPOINT

    def test_an_http_target_uses_the_http_endpoint(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)

        assert route_for("http", "a.example", 80, spec) == _HTTP_ENDPOINT

    def test_an_https_target_never_falls_back_to_the_http_endpoint(self) -> None:
        spec = ProxySpec(None, _HTTP_ENDPOINT, _always)

        assert route_for("https", "a.example", 443, spec) is None

    def test_an_http_target_never_falls_back_to_the_https_endpoint(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, None, _always)

        assert route_for("http", "a.example", 80, spec) is None

    @pytest.mark.parametrize(
        ("scheme", "host", "port"),
        [("https", "k8s.example", 6443), ("http", "search.example", 9200)],
    )
    def test_the_decision_is_asked_with_the_scheme_host_and_port(
        self, scheme: str, host: str, port: int
    ) -> None:
        asked: list[tuple[str, str, int]] = []
        decide = _recording(asked)

        route_for(scheme, host, port, ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, decide))

        assert asked == [(scheme, host, port)]

    @pytest.mark.parametrize("scheme", ["https", "http"])
    def test_a_direct_decision_is_a_direct_connection(self, scheme: str) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _never)

        assert route_for(scheme, "a.example", 8443, spec) is None

    def test_the_decision_is_asked_even_when_the_protocol_has_no_endpoint(self) -> None:
        asked: list[tuple[str, str, int]] = []
        decide = _recording(asked)

        route_for("https", "a.example", 443, ProxySpec(None, _HTTP_ENDPOINT, decide))

        assert asked == [("https", "a.example", 443)]

    @pytest.mark.parametrize(
        "error",
        [ProxyError("the decision failed"), ValueError("the decision failed")],
        ids=["a proxy error", "any other error"],
    )
    @pytest.mark.parametrize("https", [_HTTPS_ENDPOINT, None], ids=["endpoint", "no endpoint"])
    def test_an_error_the_decision_raises_reaches_the_caller_unchanged(
        self, error: Exception, https: ProxyEndpoint | None
    ) -> None:
        def decide(_scheme: str, _host: str, _port: int) -> bool:
            raise error

        with pytest.raises(type(error)) as caught:
            route_for("https", "a.example", 443, ProxySpec(https, None, decide))

        assert caught.value is error


class TestResolver:
    """The WAVE host registers one reader of the effective proxy; without it there is none."""

    def test_without_a_resolver_there_is_no_proxy(self) -> None:
        assert active_proxy() is None

    def test_a_registered_resolver_answers(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)
        set_resolver(lambda: spec)

        assert active_proxy() is spec

    def test_the_resolver_is_read_at_each_call(self) -> None:
        first = ProxySpec(_HTTPS_ENDPOINT, None, _always)
        second = ProxySpec(None, _HTTP_ENDPOINT, _always)
        answers = iter([first, second])
        set_resolver(lambda: next(answers))

        assert active_proxy() is first
        assert active_proxy() is second

    def test_a_resolver_may_answer_no_proxy(self) -> None:
        set_resolver(lambda: None)

        assert active_proxy() is None

    def test_clearing_the_resolver_leaves_no_proxy(self) -> None:
        set_resolver(lambda: ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always))
        set_resolver(None)

        assert active_proxy() is None

    def test_an_error_the_resolver_raises_reaches_the_caller_unchanged(self) -> None:
        error = ProxyError("the stored proxy cannot be used")

        def resolver() -> ProxySpec | None:
            raise error

        set_resolver(resolver)

        with pytest.raises(ProxyError) as caught:
            active_proxy()

        assert caught.value is error


class TestProxyError:
    """The one type every proxy failure is raised as, so a transport's own handling sees it."""

    def test_it_is_an_os_error(self) -> None:
        assert issubclass(ProxyError, OSError)

    def test_its_text_is_the_message_it_was_given(self) -> None:
        text = "Proxy proxy.example:3128 cannot be reached: timed out"

        assert str(ProxyError(text)) == text


class TestDirectConnection:
    """Without a route the target is dialed directly and the proxy never hears of it."""

    def test_without_a_resolver_the_target_is_dialed_directly(self, target: EchoTarget) -> None:
        with connect(target.host, target.port, _TIMEOUT) as sock:
            assert isinstance(sock, socket.socket)
            assert _echoed(sock) == b"echo:ping"

        assert target.received == b"ping"

    def test_a_resolver_answering_no_proxy_dials_directly(self, target: EchoTarget) -> None:
        set_resolver(lambda: None)

        with connect(target.host, target.port, _TIMEOUT) as sock:
            assert _echoed(sock) == b"echo:ping"

    @pytest.mark.parametrize("scheme", ["https", "http"])
    def test_a_direct_decision_dials_directly(self, target: EchoTarget, scheme: str) -> None:
        with Proxy() as server:
            _use(_endpoint(server), _endpoint(server), _never)

            with connect(target.host, target.port, _TIMEOUT, scheme) as sock:
                assert _echoed(sock) == b"echo:ping"

            assert server.untouched

    def test_an_https_target_without_an_https_endpoint_dials_directly(
        self, target: EchoTarget
    ) -> None:
        with Proxy() as server:
            _use(https=None, http=_endpoint(server))

            with connect(target.host, target.port, _TIMEOUT, "https") as sock:
                assert _echoed(sock) == b"echo:ping"

            assert server.untouched

    def test_an_http_target_without_an_http_endpoint_dials_directly(
        self, target: EchoTarget
    ) -> None:
        with Proxy() as server:
            _use(https=_endpoint(server), http=None)

            with connect(target.host, target.port, _TIMEOUT, "http") as sock:
                assert _echoed(sock) == b"echo:ping"

            assert server.untouched

    def test_the_socket_keeps_the_timeout_for_the_callers_reads(self, target: EchoTarget) -> None:
        with connect(target.host, target.port, 7.5) as sock:
            assert sock.gettimeout() == 7.5

    def test_a_target_that_cannot_be_reached_is_not_a_proxy_failure(self) -> None:
        with pytest.raises(OSError) as caught:
            connect("127.0.0.1", closed_port(), _TIMEOUT)

        assert not isinstance(caught.value, ProxyError)

    def test_a_dial_replaced_on_the_socket_module_is_the_one_used(
        self, target: EchoTarget, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        real = socket.create_connection
        asked: list[tuple[tuple[str, int], float]] = []

        def dial(address: tuple[str, int], timeout: float) -> socket.socket:
            asked.append((address, timeout))
            return real((target.host, target.port), timeout)

        monkeypatch.setattr(socket, "create_connection", dial)

        with connect("search.example", 9200, _TIMEOUT) as sock:
            assert _echoed(sock) == b"echo:ping"

        assert asked == [(("search.example", 9200), _TIMEOUT)]


class TestTunnel:
    """With a route the socket is an HTTP CONNECT tunnel through the proxy to the target."""

    def test_bytes_reach_the_target_and_its_answer_comes_back(
        self, in_force: Proxy, target: EchoTarget
    ) -> None:
        with connect(_TARGET, 443, _TIMEOUT) as sock:
            assert isinstance(sock, socket.socket)
            assert _echoed(sock, b"ping") == b"echo:ping"
            assert _echoed(sock, b"again") == b"echo:again"

        assert target.received == b"pingagain"

    def test_the_connect_request_names_the_target_host_and_port(self, in_force: Proxy) -> None:
        with connect(_TARGET, 6443, _TIMEOUT):
            pass

        assert [(asked.method, asked.target) for asked in in_force.requests] == [
            ("CONNECT", "target.example:6443")
        ]

    def test_an_ipv6_target_is_named_in_brackets(self, in_force: Proxy) -> None:
        with connect("2001:db8::7", 6443, _TIMEOUT):
            pass

        assert in_force.requests[0].target == "[2001:db8::7]:6443"

    def test_the_scheme_defaults_to_https(self, tunnel_proxy: Proxy) -> None:
        _use(https=_endpoint(tunnel_proxy), http=None)

        with connect(_TARGET, 443, _TIMEOUT):
            pass

        assert tunnel_proxy.requests[0].target == "target.example:443"

    def test_an_https_target_tunnels_through_the_https_endpoint(self, target: EchoTarget) -> None:
        upstream = (target.host, target.port)
        with Proxy(upstream=upstream) as for_https, Proxy(upstream=upstream) as for_http:
            _use(_endpoint(for_https), _endpoint(for_http))

            with connect(_TARGET, 443, _TIMEOUT, "https") as sock:
                assert _echoed(sock) == b"echo:ping"

            assert for_https.requests[0].target == "target.example:443"
            assert for_http.untouched

    def test_an_http_target_tunnels_through_the_http_endpoint(self, target: EchoTarget) -> None:
        upstream = (target.host, target.port)
        with Proxy(upstream=upstream) as for_https, Proxy(upstream=upstream) as for_http:
            _use(_endpoint(for_https), _endpoint(for_http))

            with connect(_TARGET, 80, _TIMEOUT, "http") as sock:
                assert _echoed(sock) == b"echo:ping"

            assert [(asked.method, asked.target) for asked in for_http.requests] == [
                ("CONNECT", "target.example:80")
            ]
            assert for_https.untouched

    @pytest.mark.parametrize(("scheme", "port"), [("https", 6443), ("http", 9200)])
    def test_the_decision_is_asked_about_the_target(
        self, tunnel_proxy: Proxy, scheme: str, port: int
    ) -> None:
        asked: list[tuple[str, str, int]] = []
        decide = _recording(asked)

        _use(_endpoint(tunnel_proxy), _endpoint(tunnel_proxy), decide)

        with connect(_TARGET, port, _TIMEOUT, scheme):
            pass

        assert asked == [(scheme, _TARGET, port)]

    def test_the_resolver_is_read_at_each_connection(
        self, tunnel_proxy: Proxy, target: EchoTarget
    ) -> None:
        spec = ProxySpec(_endpoint(tunnel_proxy), None, _always)
        answers = iter([spec, None])
        set_resolver(lambda: next(answers))

        with connect(_TARGET, 443, _TIMEOUT) as tunneled:
            assert _echoed(tunneled) == b"echo:ping"
        with connect(target.host, target.port, _TIMEOUT) as direct:
            assert _echoed(direct) == b"echo:ping"

        assert tunnel_proxy.connections == 1

    def test_the_socket_keeps_the_timeout_for_the_callers_reads(self, in_force: Proxy) -> None:
        with connect(_TARGET, 443, 7.5) as sock:
            assert sock.gettimeout() == 7.5

    def test_a_name_outside_ascii_is_asked_for_in_its_idna_form(self, in_force: Proxy) -> None:
        with connect("bücher.example", 443, _TIMEOUT) as sock:
            assert _echoed(sock) == b"echo:ping"

        assert in_force.requests[0].target == "xn--bcher-kva.example:443"

    def test_headers_in_the_proxy_answer_are_not_tunnel_bytes(self) -> None:
        answer = b"HTTP/1.1 200 Connection established\r\nVia: "
        with EchoTarget(prefix=answer) as answering:
            _use(ProxyEndpoint(answering.host, answering.port, None, None))

            with connect(_TARGET, 443, _TIMEOUT) as sock:
                sock.sendall(b"ping\r\n\r\n")

                assert _until_blank_line(sock) == answer + b"ping\r\n\r\n"

    def test_bytes_right_behind_the_proxy_answer_stay_in_the_tunnel(self) -> None:
        with EchoTarget(prefix=b"HTTP/1.1 200 Connection established\r\n\r\n") as answering:
            _use(ProxyEndpoint(answering.host, answering.port, None, None))

            with connect(_TARGET, 443, _TIMEOUT) as sock:
                behind = _until_blank_line(sock)

        assert behind == answering.received
        assert behind.startswith(b"CONNECT target.example:443 ")


class TestProxyLogin:
    """A username on the endpoint is sent to the proxy as Basic proxy authorization."""

    def test_a_username_and_password_are_sent(self, tunnel_proxy: Proxy) -> None:
        _use(_endpoint(tunnel_proxy, *_LOGIN))

        with connect(_TARGET, 443, _TIMEOUT):
            pass

        assert tunnel_proxy.requests[0].headers["proxy-authorization"] == _LOGIN_HEADER

    @pytest.mark.parametrize("password", ["", None], ids=["empty", "none"])
    def test_a_username_without_a_password_is_sent_with_an_empty_one(
        self, tunnel_proxy: Proxy, password: str | None
    ) -> None:
        _use(_endpoint(tunnel_proxy, "wave", password))

        with connect(_TARGET, 443, _TIMEOUT):
            pass

        assert tunnel_proxy.requests[0].headers["proxy-authorization"] == _USERNAME_ONLY_HEADER

    def test_without_a_username_no_authorization_is_sent(self, in_force: Proxy) -> None:
        with connect(_TARGET, 443, _TIMEOUT):
            pass

        assert "proxy-authorization" not in in_force.requests[0].headers

    def test_the_login_of_the_http_endpoint_goes_with_an_http_target(
        self, tunnel_proxy: Proxy
    ) -> None:
        _use(_endpoint(tunnel_proxy), _endpoint(tunnel_proxy, *_LOGIN))

        with connect(_TARGET, 80, _TIMEOUT, "http"):
            pass

        assert tunnel_proxy.requests[0].headers["proxy-authorization"] == _LOGIN_HEADER

    def test_a_proxy_that_asks_for_the_login_opens_the_tunnel(self, target: EchoTarget) -> None:
        with Proxy(upstream=(target.host, target.port), login=_LOGIN) as server:
            _use(_endpoint(server, *_LOGIN))

            with connect(_TARGET, 443, _TIMEOUT) as sock:
                assert _echoed(sock) == b"echo:ping"


class TestRefusedConnect:
    """A proxy that answers CONNECT with a refusal fails the dial with the proxy's own answer."""

    @pytest.mark.parametrize(
        ("status", "reason"),
        [(403, "Forbidden"), (407, "Proxy Authentication Required"), (502, "Bad Gateway")],
    )
    def test_the_failure_names_the_proxy_the_target_and_the_answer(
        self, status: int, reason: str
    ) -> None:
        with Proxy(refuse=(status, reason)) as server:
            _use(_endpoint(server))

            with pytest.raises(
                ProxyError,
                match=_exact(
                    f"Proxy 127.0.0.1:{server.port} refused the connection to "
                    f"target.example:443: {status} {reason}"
                ),
            ):
                connect(_TARGET, 443, _TIMEOUT)

    def test_a_refused_http_target_is_named_with_its_own_port(self) -> None:
        with Proxy(refuse=(403, "Forbidden")) as server:
            _use(http=_endpoint(server))

            with pytest.raises(
                ProxyError,
                match=_exact(
                    f"Proxy 127.0.0.1:{server.port} refused the connection to "
                    "target.example:9200: 403 Forbidden"
                ),
            ):
                connect(_TARGET, 9200, _TIMEOUT, "http")

    def test_a_missing_login_is_refused_with_the_proxy_answer(self, target: EchoTarget) -> None:
        with Proxy(upstream=(target.host, target.port), login=_LOGIN) as server:
            _use(_endpoint(server))

            with pytest.raises(
                ProxyError,
                match=_exact(
                    f"Proxy 127.0.0.1:{server.port} refused the connection to "
                    "target.example:443: 407 Proxy Authentication Required"
                ),
            ):
                connect(_TARGET, 443, _TIMEOUT)

            assert target.untouched

    def test_the_login_never_appears_in_the_failure(self) -> None:
        with Proxy(refuse=(403, "Forbidden")) as server:
            _use(_endpoint(server, *_LOGIN))

            with pytest.raises(
                ProxyError,
                match=_exact(
                    f"Proxy 127.0.0.1:{server.port} refused the connection to "
                    "target.example:443: 403 Forbidden"
                ),
            ):
                connect(_TARGET, 443, _TIMEOUT)


class TestUnreachableProxy:
    """A proxy that cannot be reached, or does not answer in time, fails the dial."""

    @pytest.mark.parametrize("scheme", ["https", "http"])
    def test_a_proxy_nothing_listens_on_cannot_be_reached(self, scheme: str) -> None:
        port = closed_port()
        dead = ProxyEndpoint("127.0.0.1", port, None, None)
        _use(dead, dead)

        with pytest.raises(ProxyError, match=rf"^Proxy 127\.0\.0\.1:{port} cannot be reached: .+$"):
            connect(_TARGET, 443, _TIMEOUT, scheme)

    def test_a_proxy_that_never_answers_fails_within_the_timeout(self) -> None:
        with Proxy(stall=True) as server:
            _use(_endpoint(server))
            guard = threading.Timer(_HANG_GUARD, server.stop)
            guard.start()
            started = time.monotonic()
            try:
                with pytest.raises(ProxyError):
                    connect(_TARGET, 443, 0.05)
            finally:
                guard.cancel()

            assert time.monotonic() - started < _HANG_GUARD

    def test_a_proxy_that_hangs_up_without_an_answer_cannot_be_reached(
        self, run_lines: Lines
    ) -> None:
        with _hanging_up() as port:
            _use(ProxyEndpoint("127.0.0.1", port, None, None))

            with pytest.raises(
                ProxyError, match=rf"^Proxy 127\.0\.0\.1:{port} cannot be reached: .+$"
            ):
                connect(_TARGET, 443, _TIMEOUT)

        assert run_lines == []


class TestFailuresFromTheWaveHost:
    """An error the resolver or the route decision raises reaches the transport as it is."""

    @pytest.mark.parametrize("with_endpoint", [True, False], ids=["endpoint", "no endpoint"])
    def test_an_error_the_decision_raises_is_not_reworded(
        self, target: EchoTarget, with_endpoint: bool
    ) -> None:
        error = ProxyError("the decision failed")

        def decide(_scheme: str, _host: str, _port: int) -> bool:
            raise error

        with Proxy() as server:
            _use(_endpoint(server) if with_endpoint else None, None, decide)

            with pytest.raises(ProxyError) as caught:
                connect(target.host, target.port, _TIMEOUT)

            assert caught.value is error
            assert server.untouched
            assert target.untouched

    def test_an_error_the_resolver_raises_is_not_reworded(self, target: EchoTarget) -> None:
        error = ProxyError("the stored proxy cannot be used")

        def resolver() -> ProxySpec | None:
            raise error

        set_resolver(resolver)

        with pytest.raises(ProxyError) as caught:
            connect(target.host, target.port, _TIMEOUT)

        assert caught.value is error
        assert target.untouched


class TestProxyLogLine:
    """The run log names the proxy once per block run, and only when a connection used it."""

    def test_a_tunnel_writes_the_line(self, in_force: Proxy, run_lines: Lines) -> None:
        with connect(_TARGET, 443, _TIMEOUT):
            pass

        assert run_lines == [("DEBUG", f"Using the proxy 127.0.0.1:{in_force.port}")]

    def test_many_connections_in_one_run_write_it_once(
        self, in_force: Proxy, run_lines: Lines
    ) -> None:
        for port, scheme in ((443, "https"), (6443, "https"), (9200, "http")):
            with connect(_TARGET, port, _TIMEOUT, scheme):
                pass

        assert in_force.connections == 3
        assert run_lines == [_line(in_force)]

    def test_two_runs_each_write_the_line(self, in_force: Proxy) -> None:
        first: Lines = []
        second: Lines = []

        def run(lines: Lines) -> None:
            RUN_LOG.set(_sink(lines))
            with connect(_TARGET, 443, _TIMEOUT):
                pass

        for lines in (first, second):
            contextvars.copy_context().run(run, lines)

        assert first == second == [_line(in_force)]

    def test_the_login_never_appears_in_the_line(
        self, tunnel_proxy: Proxy, run_lines: Lines
    ) -> None:
        _use(_endpoint(tunnel_proxy, *_LOGIN))

        with connect(_TARGET, 443, _TIMEOUT):
            pass

        assert run_lines == [_line(tunnel_proxy)]
        assert "wave" not in run_lines[0][1]
        assert "s3cret" not in run_lines[0][1]

    def test_without_a_resolver_nothing_is_written(
        self, target: EchoTarget, run_lines: Lines
    ) -> None:
        with connect(target.host, target.port, _TIMEOUT):
            pass

        assert run_lines == []

    def test_a_direct_decision_writes_nothing(self, target: EchoTarget, run_lines: Lines) -> None:
        with Proxy() as server:
            _use(_endpoint(server), _endpoint(server), _never)

            with connect(target.host, target.port, _TIMEOUT):
                pass

        assert run_lines == []

    def test_a_protocol_without_an_endpoint_writes_nothing(
        self, target: EchoTarget, run_lines: Lines
    ) -> None:
        with Proxy() as server:
            _use(https=None, http=_endpoint(server))

            with connect(target.host, target.port, _TIMEOUT, "https"):
                pass

        assert run_lines == []

    def test_a_refused_tunnel_writes_nothing(self, run_lines: Lines) -> None:
        with Proxy(refuse=(403, "Forbidden")) as server:
            _use(_endpoint(server))

            with pytest.raises(ProxyError):
                connect(_TARGET, 443, _TIMEOUT)

        assert run_lines == []

    def test_an_unreachable_proxy_writes_nothing(self, run_lines: Lines) -> None:
        _use(ProxyEndpoint("127.0.0.1", closed_port(), None, None))

        with pytest.raises(ProxyError):
            connect(_TARGET, 443, _TIMEOUT)

        assert run_lines == []

    def test_outside_a_run_nothing_is_written(
        self, in_force: Proxy, caplog: pytest.LogCaptureFixture, capsys: pytest.CaptureFixture[str]
    ) -> None:
        assert RUN_LOG.get() is None

        with caplog.at_level(logging.DEBUG), connect(_TARGET, 443, _TIMEOUT) as sock:
            assert _echoed(sock) == b"echo:ping"

        assert caplog.records == []
        assert capsys.readouterr() == ("", "")


class TestIpv6Proxy:
    """A proxy on an IPv6 address is dialed as given and written in brackets in every text."""

    def test_the_tunnel_runs_through_a_proxy_on_the_ipv6_loopback(self, target: EchoTarget) -> None:
        with Proxy("::1", upstream=(target.host, target.port)) as server:
            _use(ProxyEndpoint("::1", server.port, None, None))

            with connect(_TARGET, 443, _TIMEOUT) as sock:
                assert _echoed(sock) == b"echo:ping"

            assert server.requests[0].target == "target.example:443"

    def test_the_log_line_writes_the_address_in_brackets(
        self, target: EchoTarget, run_lines: Lines
    ) -> None:
        with Proxy("::1", upstream=(target.host, target.port)) as server:
            _use(ProxyEndpoint("::1", server.port, None, None))

            with connect(_TARGET, 443, _TIMEOUT):
                pass

            assert run_lines == [("DEBUG", f"Using the proxy [::1]:{server.port}")]

    def test_a_refusal_writes_the_address_in_brackets(self) -> None:
        with Proxy("::1", refuse=(403, "Forbidden")) as server:
            _use(ProxyEndpoint("::1", server.port, None, None))

            with pytest.raises(
                ProxyError,
                match=_exact(
                    f"Proxy [::1]:{server.port} refused the connection to "
                    "target.example:443: 403 Forbidden"
                ),
            ):
                connect(_TARGET, 443, _TIMEOUT)

    def test_an_unreachable_proxy_writes_the_address_in_brackets(self) -> None:
        port = closed_port("::1")
        _use(ProxyEndpoint("::1", port, None, None))

        with pytest.raises(ProxyError, match=rf"^Proxy \[::1\]:{port} cannot be reached: .+$"):
            connect(_TARGET, 443, _TIMEOUT)


class TestEnvironmentIsNeverRead:
    """Proxy variables of the process, in either spelling, never choose or change a route."""

    @pytest.mark.parametrize("scheme", ["https", "http"])
    def test_a_dead_proxy_in_the_environment_does_not_stop_a_direct_connection(
        self, target: EchoTarget, monkeypatch: pytest.MonkeyPatch, scheme: str
    ) -> None:
        _set_environment(monkeypatch, f"http://127.0.0.1:{closed_port()}", "elsewhere.example")

        with connect(target.host, target.port, _TIMEOUT, scheme) as sock:
            assert _echoed(sock) == b"echo:ping"

    @pytest.mark.parametrize("scheme", ["https", "http"])
    def test_a_live_proxy_in_the_environment_is_never_dialed(
        self, target: EchoTarget, monkeypatch: pytest.MonkeyPatch, scheme: str
    ) -> None:
        with Proxy() as server:
            _set_environment(monkeypatch, server.url, "elsewhere.example")

            with connect(target.host, target.port, _TIMEOUT, scheme) as sock:
                assert _echoed(sock) == b"echo:ping"

            assert server.untouched

    def test_no_proxy_in_the_environment_does_not_take_a_target_off_its_route(
        self, in_force: Proxy, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _set_environment(monkeypatch, f"http://127.0.0.1:{closed_port()}", "*")

        with connect(_TARGET, 443, _TIMEOUT) as sock:
            assert _echoed(sock) == b"echo:ping"

        assert in_force.requests[0].target == "target.example:443"


class TestRidesToRemoteHosts:
    """The vendored K8s, OpenSearch and Helm packages import the module at load on Python 3.10."""

    def test_it_imports_only_the_standard_library_the_run_log_and_the_web_address(self) -> None:
        outside = [
            sorted(names)
            for names in import_candidates(proxy.__name__, _PATH)
            if not is_stdlib(names)
            and not any(matches(name, sibling) for name in names for sibling in _VENDORED_SIBLINGS)
        ]

        assert outside == []

    def test_it_parses_at_the_interpreter_floor(self) -> None:
        source = _PATH.read_text(encoding="utf-8")

        assert parses_at_the_floor(source)
        assert post_floor_names(source) == set()


_HELM_CLUSTER = ("https", "k8s.example", 6443)
_HELM_CHART = ("https", "charts.example", 443)
_SECURE_URL = "http://secure-proxy.example:3128"
_PLAIN_URL = "http://plain-proxy.example:8080"


def _only(*hosts: str) -> Decision:
    """A decision that sends the named hosts through the proxy and every other one direct."""

    def decide(_scheme: str, host: str, _port: int) -> bool:
        return host in hosts

    return decide


def _http_targets(scheme: str, _host: str, _port: int) -> bool:
    """A decision that sends http targets through the proxy and https targets direct."""
    return scheme == "http"


def _port_443(_scheme: str, _host: str, port: int) -> bool:
    """A decision that sends port 443 through the proxy and every other port direct."""
    return port == 443


_CORP_CLUSTER = ("https", "k8s.corp.example", 443)
_CORP_CHART = ("https", "charts.k8s.corp.example", 443)
_CORP_EXCEPTION = "k8s.corp.example:443"


class TestHelmRoute:
    """What helm is told for its two addresses: the cluster and the chart source (REQ-3.5.3.6)."""

    def test_the_fields_in_order(self) -> None:
        names = [field.name for field in dataclasses.fields(proxy.HelmProxy)]

        assert names == [
            "env",
            "cluster_proxy_url",
            "used",
            "local_chart_host",
            "direct_cluster_chart_host",
        ]

    def test_cluster_and_chart_source_through_the_proxy(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)

        route = proxy.helm_route(spec, _HELM_CLUSTER, _HELM_CHART)

        assert route.env == {"HTTPS_PROXY": _SECURE_URL, "HTTP_PROXY": _PLAIN_URL}
        assert route.cluster_proxy_url == _SECURE_URL
        assert route.used == _HTTPS_ENDPOINT
        assert route.local_chart_host is None

    def test_only_the_cluster_through_the_proxy(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _only("k8s.example"))

        route = proxy.helm_route(spec, _HELM_CLUSTER, _HELM_CHART)

        assert route.env == {}
        assert route.cluster_proxy_url == _SECURE_URL
        assert route.used == _HTTPS_ENDPOINT
        assert route.local_chart_host is None

    def test_only_the_chart_source_through_the_proxy(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _only("charts.example"))

        route = proxy.helm_route(spec, _HELM_CLUSTER, _HELM_CHART)

        assert route.env == {
            "HTTPS_PROXY": _SECURE_URL,
            "HTTP_PROXY": _PLAIN_URL,
            "NO_PROXY": "k8s.example:6443",
        }
        assert route.cluster_proxy_url is None
        assert route.used == _HTTPS_ENDPOINT
        assert route.local_chart_host is None

    def test_neither_through_the_proxy(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _never)

        route = proxy.helm_route(spec, _HELM_CLUSTER, _HELM_CHART)

        assert route.env == {}
        assert route.cluster_proxy_url is None
        assert route.used is None
        assert route.local_chart_host is None

    @pytest.mark.parametrize(
        "chart_source",
        [_HELM_CHART, ("https", "localhost", 8443), None],
        ids=["chart source", "local chart source", "no chart source"],
    )
    def test_no_spec_tells_helm_nothing(self, chart_source: tuple[str, str, int] | None) -> None:
        route = proxy.helm_route(None, _HELM_CLUSTER, chart_source)

        assert route.env == {}
        assert route.cluster_proxy_url is None
        assert route.used is None
        assert route.local_chart_host is None
        assert route.direct_cluster_chart_host is None

    def test_a_chart_that_is_not_downloaded_leaves_only_the_cluster_route(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)

        route = proxy.helm_route(spec, _HELM_CLUSTER, None)

        assert route.env == {}
        assert route.cluster_proxy_url == _SECURE_URL
        assert route.used == _HTTPS_ENDPOINT
        assert route.local_chart_host is None

    def test_the_decision_is_asked_about_the_cluster_and_the_chart_source(self) -> None:
        asked: list[tuple[str, str, int]] = []
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _recording(asked))

        proxy.helm_route(spec, _HELM_CLUSTER, _HELM_CHART)

        assert set(asked) == {_HELM_CLUSTER, _HELM_CHART}

    def test_an_http_chart_source_goes_through_the_http_endpoint(self) -> None:
        spec = ProxySpec(None, _HTTP_ENDPOINT, _only("charts.example"))

        route = proxy.helm_route(spec, _HELM_CLUSTER, ("http", "charts.example", 80))

        assert route.env == {"HTTP_PROXY": _PLAIN_URL, "NO_PROXY": "k8s.example:6443"}
        assert route.used == _HTTP_ENDPOINT

    def test_only_an_endpoint_that_exists_becomes_a_variable(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, None, _only("charts.example"))

        route = proxy.helm_route(spec, _HELM_CLUSTER, _HELM_CHART)

        assert route.env == {"HTTPS_PROXY": _SECURE_URL, "NO_PROXY": "k8s.example:6443"}

    @pytest.mark.parametrize(
        ("chart_source", "https", "http"),
        [
            (("https", "charts.example", 443), None, _HTTP_ENDPOINT),
            (("http", "charts.example", 80), _HTTPS_ENDPOINT, None),
        ],
        ids=["https chart source", "http chart source"],
    )
    def test_a_chart_source_never_falls_back_to_the_other_endpoint(
        self,
        chart_source: tuple[str, str, int],
        https: ProxyEndpoint | None,
        http: ProxyEndpoint | None,
    ) -> None:
        spec = ProxySpec(https, http, _only("charts.example"))

        route = proxy.helm_route(spec, _HELM_CLUSTER, chart_source)

        assert route.env == {}
        assert route.cluster_proxy_url is None
        assert route.used is None

    @pytest.mark.parametrize(
        ("cluster", "https", "http", "address"),
        [
            (("https", "k8s.example", 6443), _HTTPS_ENDPOINT, _HTTP_ENDPOINT, _SECURE_URL),
            (("http", "k8s.example", 8080), _HTTPS_ENDPOINT, _HTTP_ENDPOINT, _PLAIN_URL),
            (("https", "k8s.example", 6443), None, _HTTP_ENDPOINT, None),
            (("http", "k8s.example", 8080), _HTTPS_ENDPOINT, None, None),
        ],
        ids=["https cluster", "http cluster", "https without endpoint", "http without endpoint"],
    )
    def test_the_cluster_uses_the_endpoint_of_its_own_protocol(
        self,
        cluster: tuple[str, str, int],
        https: ProxyEndpoint | None,
        http: ProxyEndpoint | None,
        address: str | None,
    ) -> None:
        spec = ProxySpec(https, http, _only("k8s.example"))

        assert proxy.helm_route(spec, cluster, None).cluster_proxy_url == address

    @pytest.mark.parametrize(
        ("username", "password", "encoded"),
        [
            ("wave", "s3cret", "wave:s3cret"),
            ("us:er@x", "p@ss:w/rd%1", "us%3Aer%40x:p%40ss%3Aw%2Frd%251"),
            ("usér name", "pä ss#?&=+", "us%C3%A9r%20name:p%C3%A4%20ss%23%3F%26%3D%2B"),
        ],
        ids=["plain", "reserved characters", "space, accent and plus"],
    )
    def test_a_login_is_percent_encoded_in_every_address(
        self, username: str, password: str, encoded: str
    ) -> None:
        https = ProxyEndpoint("secure-proxy.example", 3128, username, password)
        http = ProxyEndpoint("plain-proxy.example", 8080, username, password)

        route = proxy.helm_route(ProxySpec(https, http, _always), _HELM_CLUSTER, _HELM_CHART)

        assert route.env == {
            "HTTPS_PROXY": f"http://{encoded}@secure-proxy.example:3128",
            "HTTP_PROXY": f"http://{encoded}@plain-proxy.example:8080",
        }
        assert route.cluster_proxy_url == f"http://{encoded}@secure-proxy.example:3128"

    def test_each_endpoint_carries_its_own_login(self) -> None:
        https = ProxyEndpoint("secure-proxy.example", 3128, "us:er@x", "p@ss:w/rd%1")
        http = ProxyEndpoint("plain-proxy.example", 8080, *_LOGIN)

        route = proxy.helm_route(ProxySpec(https, http, _always), _HELM_CLUSTER, _HELM_CHART)

        assert route.env == {
            "HTTPS_PROXY": "http://us%3Aer%40x:p%40ss%3Aw%2Frd%251@secure-proxy.example:3128",
            "HTTP_PROXY": "http://wave:s3cret@plain-proxy.example:8080",
        }

    def test_an_ipv6_proxy_address_is_written_in_brackets(self) -> None:
        https = ProxyEndpoint("2001:db8::5", 3128, None, None)
        http = ProxyEndpoint("::1", 8080, "us:er@x", "p@ss:w/rd%1")

        route = proxy.helm_route(ProxySpec(https, http, _always), _HELM_CLUSTER, _HELM_CHART)

        assert route.env == {
            "HTTPS_PROXY": "http://[2001:db8::5]:3128",
            "HTTP_PROXY": "http://us%3Aer%40x:p%40ss%3Aw%2Frd%251@[::1]:8080",
        }
        assert route.cluster_proxy_url == "http://[2001:db8::5]:3128"

    @pytest.mark.parametrize(
        ("cluster", "entry"),
        [
            (("https", "k8s.example", 6443), "k8s.example:6443"),
            (("https", "k8s.example", 443), "k8s.example:443"),
            (("http", "k8s.example", 80), "k8s.example:80"),
            (("https", "10.0.0.7", 6443), "10.0.0.7:6443"),
            (("https", "2001:db8::10", 6443), "[2001:db8::10]:6443"),
            (("https", "2001:db8::10", 443), "[2001:db8::10]:443"),
            (("https", "127.0.0.1", 6443), "127.0.0.1:6443"),
            (("https", "localhost", 6443), "localhost:6443"),
            (("https", "::1", 6443), "[::1]:6443"),
        ],
    )
    def test_a_direct_cluster_is_the_one_exception_with_its_port_always_written(
        self, cluster: tuple[str, str, int], entry: str
    ) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _only("charts.example"))

        route = proxy.helm_route(spec, cluster, _HELM_CHART)

        assert route.env == {
            "HTTPS_PROXY": _SECURE_URL,
            "HTTP_PROXY": _PLAIN_URL,
            "NO_PROXY": entry,
        }

    @pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1"])
    def test_a_cluster_on_a_local_address_is_routed_like_any_other(self, host: str) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)

        route = proxy.helm_route(spec, ("https", host, 6443), _HELM_CHART)

        assert route.cluster_proxy_url == _SECURE_URL
        assert route.env == {"HTTPS_PROXY": _SECURE_URL, "HTTP_PROXY": _PLAIN_URL}

    @pytest.mark.parametrize(
        ("scheme", "host"),
        [
            ("https", "localhost"),
            ("https", "127.0.0.1"),
            ("https", "127.8.9.10"),
            ("http", "localhost"),
        ],
    )
    def test_a_local_chart_source_is_never_given_proxy_variables(
        self, scheme: str, host: str
    ) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)

        route = proxy.helm_route(spec, _HELM_CLUSTER, (scheme, host, 8443))

        assert route.env == {}
        assert route.local_chart_host == host
        assert route.cluster_proxy_url == _SECURE_URL
        assert route.used == _HTTPS_ENDPOINT

    def test_the_ipv6_loopback_is_a_local_chart_source(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)

        route = proxy.helm_route(spec, _HELM_CLUSTER, ("https", "::1", 8443))

        assert route.env == {}
        assert route.local_chart_host is not None

    def test_a_local_chart_source_beside_a_direct_cluster_uses_no_proxy_at_all(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _only("localhost"))

        route = proxy.helm_route(spec, _HELM_CLUSTER, ("https", "localhost", 8443))

        assert route.env == {}
        assert route.cluster_proxy_url is None
        assert route.used is None
        assert route.local_chart_host == "localhost"

    @pytest.mark.parametrize(
        "through", [_never, _only("k8s.example")], ids=["all direct", "only the cluster"]
    )
    def test_a_local_chart_source_the_decision_sends_direct_is_not_named(
        self, through: Decision
    ) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, through)

        route = proxy.helm_route(spec, _HELM_CLUSTER, ("https", "localhost", 8443))

        assert route.env == {}
        assert route.local_chart_host is None

    @pytest.mark.parametrize(
        "failing", ["k8s.example", "charts.example"], ids=["cluster", "chart source"]
    )
    def test_an_error_the_decision_raises_reaches_the_caller_unchanged(self, failing: str) -> None:
        error = ProxyError("the decision failed")

        def decide(_scheme: str, host: str, _port: int) -> bool:
            if host == failing:
                raise error
            return False

        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, decide)

        with pytest.raises(ProxyError) as caught:
            proxy.helm_route(spec, _HELM_CLUSTER, _HELM_CHART)

        assert caught.value is error

    @pytest.mark.parametrize(
        ("cluster_host", "chart_host"),
        [
            ("k8s.corp.example", "charts.k8s.corp.example"),
            ("k8s.corp.example", "a.b.k8s.corp.example"),
            ("k8s.corp.example", "Charts.K8S.Corp.Example"),
            ("K8S.Corp.Example", "charts.k8s.corp.example"),
        ],
        ids=["one label under", "two labels under", "chart in capitals", "cluster in capitals"],
    )
    def test_a_chart_source_under_a_direct_clusters_address_gets_no_proxy(
        self, cluster_host: str, chart_host: str
    ) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _only(chart_host))

        route = proxy.helm_route(spec, ("https", cluster_host, 443), ("https", chart_host, 443))

        assert route.env == {}
        assert route.cluster_proxy_url is None
        assert route.used is None
        assert route.direct_cluster_chart_host == chart_host
        assert route.local_chart_host is None

    @pytest.mark.parametrize(
        ("cluster_host", "chart_host"),
        [
            ("k8s.corp.example", "k8s.corp.example"),
            ("k8s.corp.example", "K8S.Corp.Example"),
            ("10.0.0.7", "10.0.0.7"),
            ("2001:db8::10", "2001:db8::10"),
            ("2001:db8::10", "2001:DB8:0:0:0:0:0:10"),
        ],
        ids=["name", "name in capitals", "ipv4", "ipv6", "ipv6 written out"],
    )
    def test_a_chart_source_on_a_direct_clusters_own_host_gets_no_proxy(
        self, cluster_host: str, chart_host: str
    ) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _http_targets)

        route = proxy.helm_route(spec, ("https", cluster_host, 8443), ("http", chart_host, 8443))

        assert route.env == {}
        assert route.cluster_proxy_url is None
        assert route.used is None
        assert route.direct_cluster_chart_host == chart_host
        assert route.local_chart_host is None

    @pytest.mark.parametrize(
        ("cluster_host", "chart_host", "entry"),
        [
            ("10.0.0.7", "charts.10.0.0.7", "10.0.0.7:443"),
            ("10.0.0.7", "10.0.0.8", "10.0.0.7:443"),
            ("2001:db8::10", "2001:db8::11", "[2001:db8::10]:443"),
        ],
        ids=["a name ending in the address", "another ipv4 address", "another ipv6 address"],
    )
    def test_a_cluster_given_as_an_ip_address_covers_only_that_address(
        self, cluster_host: str, chart_host: str, entry: str
    ) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _only(chart_host))

        route = proxy.helm_route(spec, ("https", cluster_host, 443), ("https", chart_host, 443))

        assert route.env == {
            "HTTPS_PROXY": _SECURE_URL,
            "HTTP_PROXY": _PLAIN_URL,
            "NO_PROXY": entry,
        }
        assert route.used == _HTTPS_ENDPOINT
        assert route.direct_cluster_chart_host is None

    @pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "::1"])
    def test_a_local_chart_source_on_the_clusters_host_is_the_local_case(self, host: str) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _http_targets)

        route = proxy.helm_route(spec, ("https", host, 8443), ("http", host, 8443))

        assert route.env == {}
        assert route.local_chart_host is not None
        assert route.direct_cluster_chart_host is None

    def test_a_chart_source_under_a_proxied_clusters_address_keeps_the_proxy(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _always)

        route = proxy.helm_route(spec, _CORP_CLUSTER, _CORP_CHART)

        assert route.env == {"HTTPS_PROXY": _SECURE_URL, "HTTP_PROXY": _PLAIN_URL}
        assert route.cluster_proxy_url == _SECURE_URL
        assert route.used == _HTTPS_ENDPOINT
        assert route.direct_cluster_chart_host is None

    @pytest.mark.parametrize("chart_host", ["charts.k8s.corp.example", "k8s.corp.example"])
    def test_a_chart_source_on_another_port_than_the_cluster_keeps_the_proxy(
        self, chart_host: str
    ) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _port_443)

        route = proxy.helm_route(
            spec, ("https", "k8s.corp.example", 6443), ("https", chart_host, 443)
        )

        assert route.env == {
            "HTTPS_PROXY": _SECURE_URL,
            "HTTP_PROXY": _PLAIN_URL,
            "NO_PROXY": "k8s.corp.example:6443",
        }
        assert route.used == _HTTPS_ENDPOINT
        assert route.direct_cluster_chart_host is None

    @pytest.mark.parametrize(
        "chart_host",
        ["xk8s.corp.example", "k8s.corp.example.org", "corp.example"],
        ids=["a longer first label", "a longer name", "the name above the cluster"],
    )
    def test_a_name_that_only_looks_like_the_clusters_keeps_the_proxy(
        self, chart_host: str
    ) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _only(chart_host))

        route = proxy.helm_route(spec, _CORP_CLUSTER, ("https", chart_host, 443))

        assert route.env == {
            "HTTPS_PROXY": _SECURE_URL,
            "HTTP_PROXY": _PLAIN_URL,
            "NO_PROXY": _CORP_EXCEPTION,
        }
        assert route.used == _HTTPS_ENDPOINT
        assert route.direct_cluster_chart_host is None

    def test_a_chart_source_the_decision_sends_direct_is_not_named(self) -> None:
        spec = ProxySpec(_HTTPS_ENDPOINT, _HTTP_ENDPOINT, _never)

        route = proxy.helm_route(spec, _CORP_CLUSTER, _CORP_CHART)

        assert route.env == {}
        assert route.used is None
        assert route.direct_cluster_chart_host is None

    def test_a_chart_source_whose_protocol_has_no_endpoint_is_not_named(self) -> None:
        spec = ProxySpec(None, _HTTP_ENDPOINT, _only("charts.k8s.corp.example"))

        route = proxy.helm_route(spec, _CORP_CLUSTER, _CORP_CHART)

        assert route.env == {}
        assert route.used is None
        assert route.direct_cluster_chart_host is None

    def test_a_local_chart_source_whose_protocol_has_no_endpoint_is_not_named(self) -> None:
        spec = ProxySpec(None, _HTTP_ENDPOINT, _always)

        route = proxy.helm_route(spec, _HELM_CLUSTER, ("https", "localhost", 8443))

        assert route.env == {}
        assert route.used is None
        assert route.local_chart_host is None
