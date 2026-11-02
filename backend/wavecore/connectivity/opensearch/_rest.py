"""The OpenSearch REST transport: one `http.client` connection per request (REQ-5.1.2, OS-11).

TLS goes through the promoted context under the far host's name; each live socket is handed
to the held cancel, which shuts it down so a blocked read wakes at once. No retries. Each
connection is dialed through the proxy core, which tunnels it when a proxy route is in force
(REQ-4.7.14).
"""

import http.client
import json
import socket
import time
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

from wavecore.connectivity import proxy
from wavecore.connectivity.tls_context import build_context

from ._errors import connect_timeout, failure_for, no_answer, unreachable
from ._json_text import dumps
from ._url import ClusterUrl

if TYPE_CHECKING:
    # Typing only: importing wavecore.plugins at load time would import the OpenSearch block.
    from wavecore.plugins._held_run import Live


@dataclass(frozen=True)
class Answer:
    """The status line, the headers with lower-cased names, and the whole body."""

    status: int
    reason: str
    headers: dict[str, str]
    body: bytes


def _unlogged(_line: str) -> None:
    """No request lines unless the caller asks for them."""


def _shutdown_socket(sock: Any) -> None:
    """The held cancel: wake a blocked read at once; a bare close would leave it blocked."""
    with suppress(OSError):
        sock.shutdown(socket.SHUT_RDWR)


class Client:
    """Requests to one cluster, each on its own connection, all under one held cancel."""

    def __init__(
        self,
        url: ClusterUrl,
        tls_rows: dict[str, Any],
        connect_timeout: float,
        live: "Live",
        *,
        authorization: str | None,
        server_name: str | None = None,
        host_header: str | None = None,
        debug: Callable[[str], None] = _unlogged,
    ) -> None:
        self.url = url
        self._debug = debug
        self._tls_rows = tls_rows
        self._connect_timeout = connect_timeout
        self._live = live
        self._deadline = time.monotonic() + live.seconds
        self._server_name = server_name or url.host
        headers = {
            "Host": host_header or url.authority,
            "Accept": "application/json",
            "User-Agent": "WAVE",
        }
        if authorization is not None:
            headers["Authorization"] = authorization
        self._headers = headers

    def request(
        self,
        method: str,
        path: str,
        query: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Answer:
        """Send one request and read its whole answer; an error status is an answer too."""
        self._live.check()
        target = f"{path}?{urlencode(query, safe='*')}" if query else path
        text = None if body is None else dumps(body)
        # The DEBUG line: the request exactly as it goes on the wire.
        self._debug(f"{method} {target}" if text is None else f"{method} {target} {text}")
        payload = None if text is None else text.encode()
        sock = self._dial()
        try:
            self._live.attach(sock)
            try:
                return self._exchange(sock, method, target, payload)
            finally:
                self._live.detach(sock)
        finally:
            sock.close()

    def json(self, answer: Answer, query_as_sent: Any = None) -> dict[str, Any]:
        """A 2xx JSON object with exact decimals; anything else raises its failure."""
        if 200 <= answer.status < 300:
            with suppress(ValueError):
                parsed = json.loads(answer.body, parse_float=Decimal)
                if isinstance(parsed, dict):
                    return parsed
        raise failure_for(answer, query_as_sent)

    def _dial(self) -> socket.socket:
        try:
            context = build_context(self._tls_rows, self._server_name) if self.url.tls else None
            scheme = "https" if self.url.tls else "http"
            sock = proxy.connect(self.url.host, self.url.port, self._connect_timeout, scheme)
            return sock if context is None else context.wrap_socket(sock)
        except TimeoutError as error:
            self._live.check()
            raise connect_timeout(self.url.where, self._connect_timeout) from error
        except OSError as error:
            self._live.check()
            raise unreachable(self.url.where, error) from error

    def _exchange(
        self, sock: socket.socket, method: str, target: str, payload: bytes | None
    ) -> Answer:
        # The deadline timer ends a hung read first; this bound is a backstop.
        sock.settimeout(max(self._deadline - time.monotonic(), 0) + 1)
        conn = http.client.HTTPConnection(self.url.host, self.url.port)
        conn.sock = sock
        try:
            conn.putrequest(method, target, skip_host=True, skip_accept_encoding=True)
            for name, value in self._headers_for(payload).items():
                conn.putheader(name, value)
            conn.endheaders(payload)
            response = conn.getresponse()
            headers = {name.lower(): value for name, value in response.getheaders()}
            return Answer(response.status, response.reason, headers, response.read())
        except (OSError, http.client.HTTPException) as error:
            self._live.check()
            raise no_answer(self.url.where, error) from error
        finally:
            conn.close()

    def _headers_for(self, payload: bytes | None) -> dict[str, str]:
        if payload is None:
            return self._headers
        sized = {"Content-Type": "application/json", "Content-Length": str(len(payload))}
        return {**self._headers, **sized}
