"""An in-process HTTP proxy and a plain TCP target for tests that dial through a proxy.

`Proxy` is a real forward proxy on a loopback port. A CONNECT request opens a tunnel and every
byte after it is piped untouched, so TLS runs end to end between the client and the target. A
request written with an absolute `http://` address is forwarded in origin form, without its
proxy headers, and answered with `Connection: close`. The proxy can also refuse every request,
ask for a login, or never answer. `EchoTarget` is the far end for a raw tunnel.

Each request is put in `Proxy.requests` before the proxy answers it, so a test reads the record
as soon as its client returns. Nothing here sleeps or polls, and both servers are plain threads,
so they work the same from sync and asyncio tests.

A raw tunnel to a target that has no real address::

    with EchoTarget() as target, Proxy(upstream=(target.host, target.port)) as server:
        ...  # dial ("target.example", 443) through (server.host, server.port)
        assert server.requests[0].target == "target.example:443"

A TLS or plain server on loopback behind the proxy (the proxy dials the address it is asked for)::

    with Proxy() as server:
        ...  # the client's CONNECT names 127.0.0.1 and the far server's port; TLS as usual
        assert server.requests[0].method == "CONNECT"

`httpx` and `urllib`, CONNECT for https and forwarding for plain http::

    httpx.AsyncClient(proxy=server.url, trust_env=False)
    monkeypatch.setenv("HTTPS_PROXY", server.url)

A direct dial that must not touch the proxy::

    assert server.untouched
"""

import base64
import selectors
import socket
import threading
from contextlib import suppress
from dataclasses import dataclass
from types import TracebackType
from typing import Self
from urllib.parse import urlsplit

# Captured at import: a test may replace socket.create_connection for the code it tests.
_dial = socket.create_connection

_CHUNK = 65536
_HEAD_END = b"\r\n\r\n"
_WAIT = 5.0
_PROXY_ONLY_HEADERS = frozenset({"connection", "proxy-authorization", "proxy-connection"})
_CONNECTION_HEADERS = frozenset({"connection", "keep-alive"})
_LOGIN_NEEDED = (407, "Proxy Authentication Required")


def _family(host: str) -> socket.AddressFamily:
    return socket.AF_INET6 if ":" in host else socket.AF_INET


def _bound(host: str) -> socket.socket:
    listener = socket.socket(_family(host), socket.SOCK_STREAM)
    try:
        listener.bind((host, 0))
    except OSError:
        listener.close()
        raise
    return listener


def closed_port(host: str = "127.0.0.1") -> int:
    """A port on `host` that nothing listens on: dialing it is refused at once."""
    with _bound(host) as probe:
        return int(probe.getsockname()[1])


def _shut(sock: socket.socket, how: int = socket.SHUT_RDWR) -> None:
    with suppress(OSError):
        sock.shutdown(how)


def _field_name(line: str) -> str:
    return line.partition(":")[0].strip().lower()


def _head(first: str, fields: list[str], dropped: frozenset[str]) -> bytes:
    """A message head without the dropped fields, closing the connection after one exchange."""
    kept = [line for line in fields if _field_name(line) not in dropped]
    return "\r\n".join([first, *kept, "Connection: close"]).encode("latin-1") + _HEAD_END


def _pump(source: socket.socket, sink: socket.socket) -> None:
    """Copy bytes one way until the source ends, then end the sink's direction too."""
    with suppress(OSError):
        while data := source.recv(_CHUNK):
            sink.sendall(data)
    _shut(sink, socket.SHUT_WR)


class _Listener:
    """A loopback listener that serves every connection on a thread of its own."""

    def __init__(self, host: str) -> None:
        self.host = host
        self.port = 0
        self.connections = 0
        self._guard = threading.Lock()
        self._stop_guard = threading.Lock()
        self._stopping = threading.Event()
        self._listener: socket.socket | None = None
        self._wake: tuple[socket.socket, socket.socket] | None = None
        self._acceptor: threading.Thread | None = None
        self._sockets: list[socket.socket] = []
        self._threads: list[threading.Thread] = []

    @property
    def authority(self) -> str:
        """`host:port`, an IPv6 host in brackets."""
        host = f"[{self.host}]" if ":" in self.host else self.host
        return f"{host}:{self.port}"

    @property
    def untouched(self) -> bool:
        """True while no connection has arrived, served or still waiting to be accepted."""
        self._accept_waiting()
        return self.connections == 0

    def start(self) -> Self:
        """Bind port 0 on the host and start serving; `port` is known from here on."""
        self._listener = _bound(self.host)
        self._listener.listen()
        self._listener.setblocking(False)
        self.port = int(self._listener.getsockname()[1])
        self._wake = socket.socketpair()
        self._acceptor = threading.Thread(target=self._accept_loop, daemon=True)
        self._acceptor.start()
        return self

    def stop(self) -> None:
        """Close the listener and every open connection, then wait for the threads to end."""
        with self._stop_guard:
            if self._listener is None or self._acceptor is None or self._wake is None:
                return
            if self._stopping.is_set():
                return
            self._stopping.set()
            self._wake[1].send(b"\0")
            self._acceptor.join(_WAIT)
            with self._guard:
                sockets, threads = list(self._sockets), list(self._threads)
            for sock in sockets:
                _shut(sock)
            for thread in threads:
                thread.join(_WAIT)
            for sock in (self._listener, *self._wake):
                sock.close()

    def __enter__(self) -> Self:
        return self.start()

    def __exit__(
        self,
        _kind: type[BaseException] | None,
        _error: BaseException | None,
        _trace: TracebackType | None,
    ) -> None:
        self.stop()

    def _accept_loop(self) -> None:
        assert self._listener is not None and self._wake is not None
        with selectors.DefaultSelector() as waiting:
            waiting.register(self._listener, selectors.EVENT_READ)
            waiting.register(self._wake[0], selectors.EVENT_READ)
            while not self._stopping.is_set():
                waiting.select()
                self._accept_waiting()

    def _accept_waiting(self) -> None:
        """Accept whatever waits on the listener, so the connection count is exact on return."""
        if self._listener is None:
            return
        with self._guard:
            while True:
                try:
                    near, _ = self._listener.accept()
                except OSError:
                    return
                near.setblocking(True)
                self.connections += 1
                self._sockets.append(near)
                thread = threading.Thread(target=self._run, args=(near,), daemon=True)
                self._threads.append(thread)
                thread.start()

    def _track(self, sock: socket.socket) -> None:
        """Let stop() end a socket a serving thread opened; one opened after stop ends now."""
        with self._guard:
            self._sockets.append(sock)
        if self._stopping.is_set():
            _shut(sock)

    def _run(self, near: socket.socket) -> None:
        try:
            if self._stopping.is_set():
                return
            self._serve(near)
        except OSError:
            pass
        finally:
            near.close()

    def _serve(self, near: socket.socket) -> None:
        raise NotImplementedError


class EchoTarget(_Listener):
    """A plain TCP server on loopback that answers each chunk it reads with `prefix` + chunk.

    `host` is `127.0.0.1` or `::1`. Use it as a context manager, or call `start()` and `stop()`.
    """

    def __init__(self, host: str = "127.0.0.1", prefix: bytes = b"echo:") -> None:
        super().__init__(host)
        self.prefix = prefix
        self._chunks: list[bytes] = []

    @property
    def received(self) -> bytes:
        """Every byte the target has read so far, over all its connections."""
        return b"".join(self._chunks)

    def _serve(self, near: socket.socket) -> None:
        while data := near.recv(_CHUNK):
            self._chunks.append(data)
            near.sendall(self.prefix + data)


@dataclass(frozen=True)
class ProxyRequest:
    """One request as the proxy received it.

    `target` is the request target as sent: `host:port` for CONNECT, the absolute address for a
    forwarded request. `headers` has lower-case names.
    """

    method: str
    target: str
    version: str
    headers: dict[str, str]


class Proxy(_Listener):
    """A forward HTTP proxy on a loopback port, reached over a plain connection.

    Use it as a context manager, or call `start()` and `stop()`. Arguments:

    - `host`: `127.0.0.1` or `::1`.
    - `upstream`: the address every tunnel and forwarded request is dialed at, whatever address
      the request names. Without it the proxy dials the address the request names.
    - `refuse`: a status and reason answered to every request, e.g. `(403, "Forbidden")`.
    - `login`: the username and password a request must carry as Basic `Proxy-Authorization`;
      any other request is answered `407 Proxy Authentication Required`.
    - `stall`: record each request and never answer it, until `stop()`.

    What a test reads afterwards: `requests` (every request, in arrival order), `connections`
    (how many connections were accepted), `untouched` (no connection ever arrived), `not_http`
    (the first bytes of each connection that did not open with an HTTP request, for example a
    TLS handshake sent at the proxy itself), `host`, `port`, `authority` and `url`.
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        *,
        upstream: tuple[str, int] | None = None,
        refuse: tuple[int, str] | None = None,
        login: tuple[str, str] | None = None,
        stall: bool = False,
    ) -> None:
        super().__init__(host)
        self.requests: list[ProxyRequest] = []
        self.not_http: list[bytes] = []
        self._upstream = upstream
        self._refuse = refuse
        self._login = login
        self._stall = stall

    @property
    def url(self) -> str:
        """The proxy address as a client setting, e.g. `http://127.0.0.1:3128`."""
        return f"http://{self.authority}"

    def _serve(self, near: socket.socket) -> None:
        data = near.recv(_CHUNK)
        while data[:1].isalpha() and _HEAD_END not in data:
            more = near.recv(_CHUNK)
            if not more:
                break
            data += more
        head, found, rest = data.partition(_HEAD_END)
        first, *fields = head.decode("latin-1").split("\r\n")
        parts = first.split(" ")
        if not found or not first[:1].isalpha() or len(parts) != 3:
            if data:
                self.not_http.append(data)
            return
        headers = {_field_name(line): line.partition(":")[2].strip() for line in fields}
        request = ProxyRequest(parts[0], parts[1], parts[2], headers)
        self.requests.append(request)
        if self._stall:
            self._stopping.wait()
            return
        refusal = self._refusal(request)
        if refusal is not None:
            self._answer(near, *refusal)
            return
        named = self._named(request)
        if named is None:
            self._answer(near, 400, "Bad Request")
            return
        host, port, path = named
        try:
            far = _dial(self._upstream or (host, port), _WAIT)
        except OSError:
            self._answer(near, 502, "Bad Gateway")
            return
        try:
            far.settimeout(None)
            self._track(far)
            if request.method == "CONNECT":
                self._tunnel(near, far, rest)
            else:
                first = f"{request.method} {path} {request.version}"
                self._forward(near, far, _head(first, fields, _PROXY_ONLY_HEADERS) + rest)
        finally:
            far.close()

    def _refusal(self, request: ProxyRequest) -> tuple[int, str] | None:
        if self._refuse is not None:
            return self._refuse
        if self._login is None:
            return None
        token = base64.b64encode(":".join(self._login).encode()).decode("ascii")
        if request.headers.get("proxy-authorization") == f"Basic {token}":
            return None
        return _LOGIN_NEEDED

    @staticmethod
    def _answer(near: socket.socket, status: int, reason: str) -> None:
        """Answer without a body, then read on until the client closes, so no reset reaches it."""
        ask = 'Proxy-Authenticate: Basic realm="proxy"\r\n' if status == 407 else ""
        head = f"HTTP/1.1 {status} {reason}\r\n{ask}Content-Length: 0\r\nConnection: close"
        near.sendall(head.encode("latin-1") + _HEAD_END)
        _shut(near, socket.SHUT_WR)
        while near.recv(_CHUNK):
            pass

    @staticmethod
    def _named(request: ProxyRequest) -> tuple[str, int, str] | None:
        """The host, the port and the origin-form path a request names; None when it names none."""
        connect = request.method == "CONNECT"
        try:
            parts = urlsplit(f"//{request.target}" if connect else request.target)
            port = parts.port or (443 if connect else 80)
        except ValueError:
            return None
        if parts.hostname is None:
            return None
        path = parts.path or "/"
        return parts.hostname, port, f"{path}?{parts.query}" if parts.query else path

    @staticmethod
    def _tunnel(near: socket.socket, far: socket.socket, early: bytes) -> None:
        near.sendall(b"HTTP/1.1 200 Connection established" + _HEAD_END)
        far.sendall(early)
        back = threading.Thread(target=_pump, args=(far, near), daemon=True)
        back.start()
        _pump(near, far)
        back.join(_WAIT)

    @staticmethod
    def _forward(near: socket.socket, far: socket.socket, opening: bytes) -> None:
        far.sendall(opening)
        body = threading.Thread(target=_pump, args=(near, far), daemon=True)
        body.start()
        answer = b""
        while _HEAD_END not in answer and (more := far.recv(_CHUNK)):
            answer += more
        head, found, rest = answer.partition(_HEAD_END)
        if found:
            status, *answer_fields = head.decode("latin-1").split("\r\n")
            near.sendall(_head(status, answer_fields, _CONNECTION_HEADERS) + rest)
            _pump(far, near)
        else:
            near.sendall(answer)
            _shut(near, socket.SHUT_WR)
        body.join(_WAIT)
