"""The TLS client context the SQL drivers and the OpenSearch REST core take (SQL-8)."""

import os
import socket
import ssl
import tempfile
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from typing import Any

from wavecore.connectivity import trust_store


class _NamedContext(ssl.SSLContext):
    """Checks and sends the server name WAVE chose, whatever name the driver dials."""

    server_name = ""

    def wrap_socket(
        self,
        sock: socket.socket,
        server_side: bool = False,
        do_handshake_on_connect: bool = True,
        suppress_ragged_eofs: bool = True,
        server_hostname: str | bytes | None = None,
        session: ssl.SSLSession | None = None,
    ) -> ssl.SSLSocket:
        return super().wrap_socket(
            sock,
            server_side,
            do_handshake_on_connect,
            suppress_ragged_eofs,
            self.server_name,
            session,
        )

    def wrap_bio(
        self,
        incoming: ssl.MemoryBIO,
        outgoing: ssl.MemoryBIO,
        server_side: bool = False,
        server_hostname: str | bytes | None = None,
        session: ssl.SSLSession | None = None,
    ) -> ssl.SSLObject:
        return super().wrap_bio(incoming, outgoing, server_side, self.server_name, session)


@contextmanager
def _private_file(text: str) -> Iterator[str]:
    """PEM text in a file only this user can read, removed as soon as it is loaded."""
    handle, path = tempfile.mkstemp(suffix=".pem")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(text)
        yield path
    finally:
        os.unlink(path)


def load_material(
    tls_rows: dict[str, Any],
    trust: Callable[[str], Any],
    identity: Callable[[str, str | None], Any],
) -> None:
    """Hand a TLS library the CA (else WAVE's trust set) and the client pair as PEM files."""
    # Loaded here: importing wavecore.plugins imports the SQL block, which imports the dialects.
    from wavecore.plugins._tls_material import read_pem

    if tls_rows.get("verify_ssl", True):
        ca_cert = tls_rows.get("ca_cert")
        anchors = (
            read_pem(ca_cert) if ca_cert else trust_store.anchors_pem(trust_store.active_spec())
        )
        with _private_file(anchors) as path:
            trust(path)
    client_cert, client_key = tls_rows.get("client_cert"), tls_rows.get("client_key")
    if client_cert:
        with ExitStack() as files:
            cert_path = files.enter_context(_private_file(read_pem(client_cert)))
            key_path = (
                files.enter_context(_private_file(read_pem(client_key))) if client_key else None
            )
            identity(cert_path, key_path)


def build_context(tls_rows: dict[str, Any], server_name: str) -> ssl.SSLContext:
    """A client context that checks the certificate under `server_name`."""
    context = _NamedContext(ssl.PROTOCOL_TLS_CLIENT)
    context.server_name = server_name
    if not tls_rows.get("verify_ssl", True):
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    trust_store.allow_partial_chain(context)
    load_material(
        tls_rows, lambda path: context.load_verify_locations(cafile=path), context.load_cert_chain
    )
    return context
