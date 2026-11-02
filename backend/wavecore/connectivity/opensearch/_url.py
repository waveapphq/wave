"""The Cluster URL rules and the index-pattern path segment (REQ-5.1.2, REQ-3.3.2.5)."""

from dataclasses import dataclass
from urllib.parse import quote

from wavecore.connectivity.web_address import (
    HOST,
    PORT,
    SCHEME,
    WebAddress,
    WebAddressError,
    bracketed,
    parse_web_address,
)

from ._errors import VALIDATION, OpenSearchFailure

_REFUSALS = {
    SCHEME: "Cluster URL must start with http:// or https://",
    HOST: "Cluster URL needs a host, such as https://opensearch.internal:9200",
    PORT: "Cluster URL port must be between 1 and 65535",
}


@dataclass(frozen=True)
class ClusterUrl:
    """A parsed Cluster URL; `prefix` is the gateway path every request starts with."""

    scheme: str
    host: str
    port: int
    prefix: str
    tls: bool

    @property
    def bracketed_host(self) -> str:
        return bracketed(self.host)

    @property
    def where(self) -> str:
        return f"{self.bracketed_host}:{self.port}"

    @property
    def authority(self) -> str:
        """The Host header: the port is left out when it is the scheme's default."""
        return self.bracketed_host if self.port == _default_port(self.tls) else self.where


def parse_cluster_url(text: str) -> ClusterUrl:
    """Refuse a URL that cannot reach a cluster: scheme, host, credentials, query, then port."""
    try:
        address = parse_web_address(text)
    except WebAddressError as error:
        # Only a refused port carries what was read: a login or a query is refused first.
        if error.address is not None:
            _refuse_login_and_query(text, error.address)
        raise _refused(_REFUSALS[error.reason]) from error
    _refuse_login_and_query(text, address)
    tls = address.scheme == "https"
    return ClusterUrl(
        address.scheme, address.host, address.effective_port, address.path.rstrip("/"), tls
    )


def encoded(pattern: str) -> str:
    """The whole Index pattern row as one path segment; the cluster resolves it."""
    return quote(pattern, safe="")


def index_path(prefix: str, pattern: str, endpoint: str) -> str:
    return f"{prefix}/{encoded(pattern)}/{endpoint}" if pattern else f"{prefix}/{endpoint}"


def _refuse_login_and_query(text: str, address: WebAddress) -> None:
    if address.username is not None:
        raise _refused(
            "Cluster URL must not hold a username or password: put them in Username and Password"
        )
    # Read off the text: a bare "?" or "#" leaves the parsed query and fragment empty.
    if "?" in text or "#" in text:
        raise _refused("Cluster URL must not hold a query (?...) or fragment (#...)")


def _default_port(tls: bool) -> int:
    return 443 if tls else 80


def _refused(message: str) -> OpenSearchFailure:
    return OpenSearchFailure(message, VALIDATION)
