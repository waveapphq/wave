"""SQL Server through python-tds (REQ-3.4.1.6, REQ-5.1.4)."""

import functools
import ipaddress
import operator
from typing import TYPE_CHECKING, Any

from wavecore.connectivity import trust_store
from wavecore.connectivity.sql.dialects._common import PROGRAM_NAME
from wavecore.connectivity.sql.dialects._common import execute as execute
from wavecore.connectivity.tls_context import load_material

if TYPE_CHECKING:
    from wavecore.connectivity.sql.dialects import Handle

NAME = "SQL Server"
DEFAULT_PORT = 1433
SQLGLOT = "tsql"
TLS_DEFAULT = True


class _TlsMaterial(str):
    """python-tds takes only a CA file name; this one carries the context WAVE built."""

    context: Any


def placeholder(_index: int) -> str:
    return "%s"


def _dns_matches(pattern: str, server_name: str) -> bool:
    """Exact, or a `*.` wildcard for the whole first label of a name of three labels or more."""
    pattern, name = pattern.lower(), server_name.lower()
    first, _, rest = name.partition(".")
    return pattern == name or (
        pattern.startswith("*.") and first != "" and "." in rest and pattern[2:] == rest
    )


def _names_server(der: bytes, server_name: str) -> bool:
    """OpenSSL's own name check: SAN entries, and the CN only when no DNS entry exists."""
    from asn1crypto import x509

    leaf = x509.Certificate.load(der)
    entries = leaf.subject_alt_name_value or []
    try:
        address = ipaddress.ip_address(server_name)
    except ValueError:
        patterns = [entry.native for entry in entries if entry.name == "dns_name"] or [
            pair["value"].native
            for relative in leaf.subject.chosen
            for pair in relative
            if pair["type"].native == "common_name"
        ]
        return any(_dns_matches(pattern, server_name) for pattern in patterns)
    return any(
        entry.name == "ip_address" and ipaddress.ip_address(entry.native) == address
        for entry in entries
    )


def verify_peer(
    server_name: str, _connection: Any, certificate: Any, _error: int, depth: int, ok: int
) -> bool:
    """The chain's verdict, and at the leaf also the server name WAVE chose (SQL-8, SQL-15)."""
    if not ok or depth:
        return bool(ok)
    import OpenSSL.crypto

    der = OpenSSL.crypto.dump_certificate(OpenSSL.crypto.FILETYPE_ASN1, certificate)
    return _names_server(der, server_name)


def _tls_arguments(rows: dict[str, Any]) -> dict[str, Any]:
    """python-tds's TLS arguments, its pyOpenSSL context built from the block's TLS rows."""
    import OpenSSL.SSL
    import pytds.tls

    context = OpenSSL.SSL.Context(OpenSSL.SSL.TLS_CLIENT_METHOD)
    context.set_min_proto_version(OpenSSL.SSL.TLS1_2_VERSION)
    if rows["verify_ssl"]:
        context.set_verify(
            OpenSSL.SSL.VERIFY_PEER, functools.partial(verify_peer, rows["server_name"])
        )
    else:
        context.set_verify(OpenSSL.SSL.VERIFY_NONE)

    def identity(certificate: str, key: str | None) -> None:
        context.use_certificate_chain_file(certificate)
        context.use_privatekey_file(key or certificate)

    trust_store.allow_partial_chain_openssl(context)
    load_material(rows, context.load_verify_locations, identity)
    material = _TlsMaterial(rows["server_name"])
    material.context = context
    pytds.tls.create_context = operator.attrgetter("context")
    # python-tds's own check calls an API pyOpenSSL dropped and reads the dialed name.
    return {"cafile": material, "validate_host": False}


def connect(rows: dict[str, Any], connect_timeout: int) -> Any:
    import pytds

    arguments = {
        "server": rows["host"],
        "port": rows["port"],
        "database": rows["database"],
        "user": rows["username"],
        "password": rows["password"],
        "login_timeout": connect_timeout,
        "appname": PROGRAM_NAME,
    }
    if rows["tls"]:
        arguments.update(_tls_arguments(rows))
    return pytds.connect(**{**arguments, **rows["driver_options"]})


def autocommit(connection: Any, on: bool) -> None:
    connection.autocommit = on


def server_version(connection: Any) -> str:
    version = int(connection.product_version)
    return f"{version >> 24}.{(version >> 16) & 0xFF}.{version & 0xFFFF}"


def cancel(handle: "Handle") -> None:
    """An attention packet on the running session; it reads nothing back."""
    if handle.connection is not None:
        handle.connection._tds_socket.main_session.put_cancel()
