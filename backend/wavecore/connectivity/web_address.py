"""The one web address parser and the one Basic authorization value (REQ-4.7.14, REQ-5.1.2)."""

import base64
from dataclasses import dataclass
from urllib.parse import SplitResult, urlsplit

SCHEME = "scheme"
HOST = "host"
PORT = "port"

_DEFAULT_PORTS = {"http": 80, "https": 443}


def bracketed(host: str) -> str:
    """The host as an address writes it: an IPv6 host in brackets."""
    return f"[{host}]" if ":" in host else host


@dataclass(frozen=True)
class WebAddress:
    """The parts of an http or https address; the host is lower case and carries no brackets."""

    scheme: str
    host: str
    port: int | None
    username: str | None
    password: str | None
    path: str
    query: str
    fragment: str

    @property
    def default_port(self) -> int:
        return _DEFAULT_PORTS[self.scheme]

    @property
    def effective_port(self) -> int:
        return self.default_port if self.port is None else self.port

    @property
    def bracketed_host(self) -> str:
        return bracketed(self.host)

    @property
    def origin(self) -> str:
        """The normal form: scheme, host, and the port unless it is the scheme's default."""
        if self.effective_port == self.default_port:
            return f"{self.scheme}://{self.bracketed_host}"
        return f"{self.scheme}://{self.bracketed_host}:{self.port}"


class WebAddressError(ValueError):
    """A refused address: ``reason`` is the one word, ``address`` what a port refusal read."""

    def __init__(self, reason: str, address: WebAddress | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.address = address


def _split(text: str) -> SplitResult:
    try:
        return urlsplit(text)
    except ValueError:
        # Only an authority raises, so the scheme is read apart to keep the order of refusals.
        scheme = urlsplit(text.partition("//")[0]).scheme
        raise WebAddressError(HOST if scheme in _DEFAULT_PORTS else SCHEME) from None


def parse_web_address(text: str) -> WebAddress:
    """Split an address into its parts, refusing a scheme, a host or a port, in that order."""
    parts = _split(text)
    if parts.scheme not in _DEFAULT_PORTS:
        raise WebAddressError(SCHEME)
    host = parts.hostname
    if not host:
        raise WebAddressError(HOST)
    address = _address(parts, host, None)
    try:
        port = parts.port
    except ValueError:
        raise WebAddressError(PORT, address) from None
    if port is None:
        return address
    if not 1 <= port <= 65535:
        raise WebAddressError(PORT, address)
    return _address(parts, host, port)


def _address(parts: SplitResult, host: str, port: int | None) -> WebAddress:
    return WebAddress(
        parts.scheme,
        host,
        port,
        parts.username,
        parts.password,
        parts.path,
        parts.query,
        parts.fragment,
    )


def typed_reason(text: str, error: WebAddressError) -> str:
    """The reason to show for a typed address: without "//" its start is wrong, not its host."""
    starts_right = text.partition(":")[2].startswith("//")
    return error.reason if starts_right else SCHEME


def basic_authorization(username: str, password: str | None) -> str:
    """The Basic authorization header value; no password is the empty password."""
    pair = f"{username}:{password or ''}"
    return "Basic " + base64.b64encode(pair.encode("utf-8")).decode("ascii")
