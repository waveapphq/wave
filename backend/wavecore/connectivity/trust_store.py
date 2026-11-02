"""What a blank CA trusts: the Additional Certificates plus one public source (REQ-4.5.16)."""

import functools
import ssl
from collections.abc import Callable, Mapping
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from wavecore.connectivity import run_log

BUILTIN = "builtin"
HOST = "host"
WAVE_HOST = "this WAVE host"
REMOTE_HOST = "the remote host"
# Where blank-CA connections run; the remote worker sets REMOTE_HOST once at start.
LOCATION = WAVE_HOST

# Distro bundle locations, first existing file wins; environment variables are never read.
HOST_STORE_PATHS = (
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/pki/tls/cacert.pem",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/ssl/cert.pem",
)

_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


@dataclass(frozen=True)
class TrustSpec:
    """The trust set a blank CA uses, as shipped to remote hosts."""

    source: str
    additional_pem: str
    additional_count: int
    builtin_label: str

    def to_wire(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_wire(cls, data: Mapping[str, Any]) -> "TrustSpec":
        return cls(
            source=str(data["source"]),
            additional_pem=str(data["additional_pem"]),
            additional_count=int(data["additional_count"]),
            builtin_label=str(data["builtin_label"]),
        )


ACTIVE_SPEC: ContextVar[TrustSpec | None] = ContextVar("wave_trust_spec", default=None)

_resolver: Callable[[], TrustSpec] | None = None
_builtin_pem: str | None = None


def set_resolver(resolver: Callable[[], TrustSpec] | None) -> None:
    """Register the reader of the saved trust settings; None clears it."""
    global _resolver
    _resolver = resolver


def set_builtin_pem(pem: str | None) -> None:
    """Use ``pem`` as WAVE's built-in list where certifi is not installed; None restores certifi."""
    global _builtin_pem
    _builtin_pem = pem


@functools.lru_cache(maxsize=1)
def _certifi_pem() -> str:
    import certifi

    return certifi.contents()


def builtin_pem() -> str:
    """WAVE's built-in list of public authorities as PEM text."""
    return _builtin_pem if _builtin_pem is not None else _certifi_pem()


def builtin_list_label() -> str:
    """The built-in list's release month from the certifi version, e.g. ``June 2026``."""
    import certifi

    year, month = certifi.__version__.split(".")[:2]
    return f"{_MONTHS[int(month) - 1]} {year}"


def active_spec() -> TrustSpec:
    """The request's spec, else the registered resolver's answer, else the built-in list alone."""
    spec = ACTIVE_SPEC.get()
    if spec is not None:
        return spec
    resolver = _resolver
    if resolver is not None:
        return resolver()
    return TrustSpec(BUILTIN, "", 0, builtin_list_label())


def locate_host_store() -> Path | None:
    """The first existing file of the fixed store locations."""
    for location in HOST_STORE_PATHS:
        path = Path(location)
        if path.is_file():
            return path
    return None


def log_line(spec: TrustSpec, where: str, store_path: str | None) -> str:
    """The run log line naming the trust source and the additional certificate count."""
    if store_path is None:
        line = f"Trusting WAVE's built-in certificate list ({spec.builtin_label})"
    else:
        line = f"Trusting {where}'s certificate store {store_path}"
    count = spec.additional_count
    if count == 1:
        return f"{line} and 1 additional certificate"
    if count > 1:
        return f"{line} and {count} additional certificates"
    return line


def anchors_pem(spec: TrustSpec, where: str | None = None) -> str:
    """The PEM a blank CA trusts, naming ``where`` (default LOCATION); logs the source once."""
    if where is None:
        where = LOCATION
    if spec.source == HOST:
        store = locate_host_store()
        if store is None:
            looked_in = ", ".join(HOST_STORE_PATHS)
            raise ValueError(f"No certificate store found on {where}: looked in {looked_in}")
        public = store.read_text(encoding="utf-8", errors="replace")
        store_path: str | None = str(store)
    else:
        public = builtin_pem()
        store_path = None
    run_log.log_once("DEBUG", log_line(spec, where, store_path))
    return spec.additional_pem + public


def allow_partial_chain(context: ssl.SSLContext) -> None:
    """Let any trusted certificate, root or intermediate, complete a chain."""
    context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN


def allow_partial_chain_openssl(context: Any) -> None:
    """The same rule on a pyOpenSSL context's store."""
    from OpenSSL.crypto import X509StoreFlags

    context.get_cert_store().set_flags(X509StoreFlags.PARTIAL_CHAIN)
