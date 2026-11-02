"""Shared TLS client context (REQ-5.1.2, REQ-5.1.4, REQ-3.4.1.6, REQ-4.5.16, SQL-8, SQL-15).

build_context turns a block's trust rows into the ssl.SSLContext the SQL drivers and the
OpenSearch REST core take: always a client context (the TLS on / off decision is the
caller's) that checks the certificate under the server name WAVE chose (the far host through
a tunnel) whatever name the driver dials, trusts the CA row alone or, when it is blank, the
certificates WAVE trusts, accepts any trusted certificate as the end of a chain, and presents
the client certificate pair. Each case handshakes with a loopback TLS server.
"""

import asyncio
import contextvars
import inspect
import os
import re
import shutil
import socket
import ssl
import stat
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

import certifi
import OpenSSL.crypto
import pytest

from tests.plugins.http import tls_material
from wavecore.connectivity.tls_context import build_context, load_material

_BOUND_S = 1.0
_SERVER_NAME = "db.internal"
_DIALED = "127.0.0.1"
_CLIENT_NAME = "wave-client"
_LABEL = "June 2026"
_BUILT_IN_LINE = "Trusting WAVE's built-in certificate list (June 2026)"

Lines = list[tuple[str, str]]


@dataclass
class _Pki:
    """A server certificate for db.internal and a client certificate, each under its own CA."""

    ca_pem: str
    ca_path: Path
    server_cert: Path
    server_key: Path
    client_ca_pem: str
    client_cert_pem: str
    client_key_pem: str
    client_cert: Path
    client_key: Path


@pytest.fixture(scope="module")
def pki(tmp_path_factory: pytest.TempPathFactory) -> _Pki:
    folder = tmp_path_factory.mktemp("tls-context")
    ca = tls_material.make_credential("WAVE Test CA", key_kind="ec256", is_ca=True)
    server = tls_material.make_credential(
        _SERVER_NAME, issuer=ca, key_kind="ec256", san_dns=[_SERVER_NAME]
    )
    client_ca = tls_material.make_credential("WAVE Client CA", key_kind="ec256", is_ca=True)
    client = tls_material.make_credential(_CLIENT_NAME, issuer=client_ca, key_kind="ec256")
    files = {
        "ca.pem": ca.cert_pem,
        "server.pem": server.cert_pem,
        "server-key.pem": server.key_pem,
        "client.pem": client.cert_pem,
        "client-key.pem": client.key_pem,
    }
    for name, text in files.items():
        (folder / name).write_text(text, encoding="utf-8")
    return _Pki(
        ca_pem=ca.cert_pem,
        ca_path=folder / "ca.pem",
        server_cert=folder / "server.pem",
        server_key=folder / "server-key.pem",
        client_ca_pem=client_ca.cert_pem,
        client_cert_pem=client.cert_pem,
        client_key_pem=client.key_pem,
        client_cert=folder / "client.pem",
        client_key=folder / "client-key.pem",
    )


@dataclass
class _Chain:
    """A root, an intermediate it signed, and a db.internal leaf the intermediate signed."""

    root_pem: str
    intermediate_pem: str
    leaf_only: Path
    full_chain: Path
    leaf_key: Path


@pytest.fixture(scope="module")
def chain(tmp_path_factory: pytest.TempPathFactory) -> _Chain:
    folder = tmp_path_factory.mktemp("tls-chain")
    root = tls_material.make_credential("WAVE Chain Root", key_kind="ec256", is_ca=True)
    intermediate = tls_material.make_credential(
        "WAVE Chain Intermediate", issuer=root, key_kind="ec256", is_ca=True
    )
    leaf = tls_material.make_credential(
        _SERVER_NAME, issuer=intermediate, key_kind="ec256", san_dns=[_SERVER_NAME]
    )
    files = {
        "chain-leaf.crt": leaf.cert_pem,
        "chain-leaf-fullchain.crt": leaf.cert_pem + intermediate.cert_pem,
        "chain-leaf.key": leaf.key_pem,
    }
    for name, text in files.items():
        (folder / name).write_text(text, encoding="utf-8")
    return _Chain(
        root_pem=root.cert_pem,
        intermediate_pem=intermediate.cert_pem,
        leaf_only=folder / "chain-leaf.crt",
        full_chain=folder / "chain-leaf-fullchain.crt",
        leaf_key=folder / "chain-leaf.key",
    )


@pytest.fixture
def trust() -> ModuleType:
    """The trust store with no resolver registered, so a blank CA reads only what a test sets."""
    from wavecore.connectivity import trust_store

    trust_store.set_resolver(None)
    return trust_store


@pytest.fixture
def use_spec(trust: ModuleType) -> Iterator[Callable[..., Any]]:
    """Set the trust spec a blank CA reads for the rest of the test."""
    tokens: list[contextvars.Token[Any]] = []

    def use(source: str = "builtin", additional: tuple[str, ...] = ()) -> Any:
        spec = trust.TrustSpec(
            source=source,
            additional_pem="".join(additional),
            additional_count=len(additional),
            builtin_label=_LABEL,
        )
        tokens.append(trust.ACTIVE_SPEC.set(spec))
        return spec

    yield use
    for token in reversed(tokens):
        trust.ACTIVE_SPEC.reset(token)


@pytest.fixture
def run_lines() -> Iterator[Lines]:
    """One block run's log: the lines its connections wrote."""
    from wavecore.connectivity import run_log

    lines: Lines = []
    token = run_log.RUN_LOG.set(run_log.RunLog(lambda level, text: lines.append((level, text))))
    yield lines
    run_log.RUN_LOG.reset(token)


class _TlsServer:
    """A one-connection loopback TLS server that records the peer it saw and sends b"ok"."""

    def __init__(
        self,
        pki: _Pki,
        *,
        require_client: bool,
        certfile: Path | None = None,
        keyfile: Path | None = None,
    ) -> None:
        self._context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self._context.load_cert_chain(certfile or pki.server_cert, keyfile or pki.server_key)
        if require_client:
            self._context.verify_mode = ssl.CERT_REQUIRED
            self._context.load_verify_locations(cadata=pki.client_ca_pem)
        self._listener = socket.create_server((_DIALED, 0))
        self._listener.settimeout(_BOUND_S)
        self.port: int = self._listener.getsockname()[1]
        self.peer: str | None = None
        self.error: BaseException | None = None
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self) -> None:
        try:
            raw, _address = self._listener.accept()
        except OSError as error:
            self.error = error
            return
        with raw:
            raw.settimeout(_BOUND_S)
            try:
                with self._context.wrap_socket(raw, server_side=True) as tls:
                    certificate = tls.getpeercert() or {}
                    subject = dict(pair[0] for pair in certificate.get("subject", ()))
                    self.peer = subject.get("commonName", "")
                    tls.sendall(b"ok")
            except OSError as error:
                self.error = error

    def close(self) -> None:
        self._thread.join(_BOUND_S)
        self._listener.close()


@pytest.fixture
def serve(pki: _Pki) -> Iterator[Callable[..., _TlsServer]]:
    started: list[_TlsServer] = []

    def start(
        *,
        require_client: bool = False,
        certfile: Path | None = None,
        keyfile: Path | None = None,
    ) -> _TlsServer:
        server = _TlsServer(pki, require_client=require_client, certfile=certfile, keyfile=keyfile)
        started.append(server)
        return server

    yield start
    for server in started:
        server.close()


def _rows(**overrides: Any) -> dict[str, Any]:
    """The four trust rows as the callers hand them over: verification on, no files."""
    base = {"verify_ssl": True, "ca_cert": "", "client_cert": "", "client_key": ""}
    return {**base, **overrides}


def _handshake(
    context: ssl.SSLContext, port: int, server_hostname: str | None = _DIALED
) -> tuple[bytes, str | None]:
    """Dial the loopback server the way a driver does; answer what it read and the name used."""
    with socket.create_connection((_DIALED, port), timeout=_BOUND_S) as raw:
        with context.wrap_socket(raw, server_hostname=server_hostname) as tls:
            return tls.recv(2), tls.server_hostname


def _private(path: str) -> bool:
    return stat.S_IMODE(os.stat(path).st_mode) & 0o077 == 0


class TestAlwaysAContext:
    """The context is built whatever a TLS row says; the caller decides whether TLS is on."""

    @pytest.mark.parametrize(
        "rows",
        [
            pytest.param({}, id="no-rows"),
            pytest.param({"tls": False}, id="tls-off"),
            pytest.param({"tls": None}, id="tls-none"),
        ],
    )
    def test_a_client_context_under_the_server_name(self, rows: dict[str, Any]) -> None:
        context = build_context(rows, _SERVER_NAME)

        assert isinstance(context, ssl.SSLContext)
        assert context.protocol == ssl.PROTOCOL_TLS_CLIENT
        tls = context.wrap_bio(ssl.MemoryBIO(), ssl.MemoryBIO(), server_hostname=_DIALED)
        assert tls.server_hostname == _SERVER_NAME

    def test_a_tls_row_that_is_off_still_reads_the_ca(self) -> None:
        with pytest.raises(
            FileNotFoundError,
            match=r"^\[Errno 2\] No such file or directory: '/nonexistent/ca\.pem'$",
        ):
            build_context({"tls": False, "ca_cert": "/nonexistent/ca.pem"}, _SERVER_NAME)


class TestServerVerification:
    """Verify Server Certificate on checks the chain and the server name WAVE chose."""

    def test_verification_on_is_a_client_context_checking_certificate_and_name(
        self, pki: _Pki
    ) -> None:
        context = build_context(_rows(ca_cert=pki.ca_pem), _SERVER_NAME)

        assert isinstance(context, ssl.SSLContext)
        assert context.protocol == ssl.PROTOCOL_TLS_CLIENT
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.check_hostname is True

    def test_verification_defaults_to_on(self, pki: _Pki) -> None:
        context = build_context({"ca_cert": pki.ca_pem}, _SERVER_NAME)

        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.check_hostname is True

    def test_an_inline_ca_trusts_the_server_under_the_server_name(
        self, pki: _Pki, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve()
        context = build_context(_rows(ca_cert=pki.ca_pem), _SERVER_NAME)

        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)

    def test_a_ca_file_path_trusts_the_server(
        self, pki: _Pki, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve()
        context = build_context(_rows(ca_cert=str(pki.ca_path)), _SERVER_NAME)

        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)

    def test_a_ca_path_under_the_home_folder_trusts_the_server(
        self,
        pki: _Pki,
        serve: Callable[..., _TlsServer],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("HOME", str(tmp_path))
        (tmp_path / "certs").mkdir()
        shutil.copy(pki.ca_path, tmp_path / "certs" / "ca.pem")
        server = serve()
        context = build_context(_rows(ca_cert="~/certs/ca.pem"), _SERVER_NAME)

        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)

    def test_a_driver_that_passes_no_server_hostname_still_checks_the_server_name(
        self, pki: _Pki, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve()
        context = build_context(_rows(ca_cert=pki.ca_pem), _SERVER_NAME)

        assert _handshake(context, server.port, server_hostname=None) == (b"ok", _SERVER_NAME)

    def test_another_server_name_fails_verification(
        self, pki: _Pki, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve()
        context = build_context(_rows(ca_cert=pki.ca_pem), "other.internal")

        with pytest.raises(ssl.SSLCertVerificationError) as raised:
            _handshake(context, server.port)

        assert raised.value.verify_message == (
            "Hostname mismatch, certificate is not valid for 'other.internal'."
        )

    def test_without_a_ca_a_private_authority_is_not_trusted(
        self, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve()
        context = build_context(_rows(), _SERVER_NAME)

        with pytest.raises(ssl.SSLCertVerificationError) as raised:
            _handshake(context, server.port)

        assert raised.value.verify_message == "unable to get local issuer certificate"

    def test_a_missing_ca_file_raises_the_open_error(self) -> None:
        with pytest.raises(
            FileNotFoundError,
            match=r"^\[Errno 2\] No such file or directory: '/nonexistent/ca\.pem'$",
        ):
            build_context(_rows(ca_cert="/nonexistent/ca.pem"), _SERVER_NAME)


class TestVerificationOff:
    """Verify Server Certificate off accepts any certificate under any name (a lab)."""

    def test_the_context_checks_nothing(self) -> None:
        context = build_context(_rows(verify_ssl=False), _SERVER_NAME)

        assert context.protocol == ssl.PROTOCOL_TLS_CLIENT
        assert context.verify_mode == ssl.CERT_NONE
        assert context.check_hostname is False

    def test_an_unknown_authority_under_another_name_is_accepted(
        self, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve()
        context = build_context(_rows(verify_ssl=False), "other.internal")

        data, _name = _handshake(context, server.port)

        assert data == b"ok"


class TestClientIdentity:
    """Client Certificate and Client Key are presented for mutual TLS, inline or as paths."""

    def test_an_inline_pair_completes_mutual_tls(
        self, pki: _Pki, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve(require_client=True)
        rows = _rows(
            ca_cert=pki.ca_pem, client_cert=pki.client_cert_pem, client_key=pki.client_key_pem
        )
        context = build_context(rows, _SERVER_NAME)

        data, _name = _handshake(context, server.port)
        server.close()

        assert data == b"ok"
        assert server.peer == _CLIENT_NAME

    def test_a_pair_of_paths_completes_mutual_tls(
        self, pki: _Pki, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve(require_client=True)
        rows = _rows(
            ca_cert=pki.ca_pem, client_cert=str(pki.client_cert), client_key=str(pki.client_key)
        )
        context = build_context(rows, _SERVER_NAME)

        data, _name = _handshake(context, server.port)
        server.close()

        assert data == b"ok"
        assert server.peer == _CLIENT_NAME

    def test_inline_material_loads_from_private_files_removed_at_once(
        self, pki: _Pki, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        loaded: list[tuple[str, bool]] = []
        real = ssl.SSLContext.load_cert_chain

        def spy(
            context: ssl.SSLContext, certfile: Any, keyfile: Any = None, password: Any = None
        ) -> None:
            for path in (certfile, keyfile):
                if path is not None:
                    loaded.append((os.fspath(path), _private(os.fspath(path))))
            real(context, certfile, keyfile, password)

        monkeypatch.setattr(ssl.SSLContext, "load_cert_chain", spy)
        rows = _rows(
            verify_ssl=False, client_cert=pki.client_cert_pem, client_key=pki.client_key_pem
        )

        build_context(rows, _SERVER_NAME)

        assert loaded
        assert [private for _path, private in loaded] == [True] * len(loaded)
        assert [path for path, _private in loaded if os.path.exists(path)] == []

    def test_path_material_is_left_where_it_is(self, pki: _Pki, tmp_path: Path) -> None:
        certificate = shutil.copy(pki.client_cert, tmp_path / "client.pem")
        key = shutil.copy(pki.client_key, tmp_path / "client-key.pem")
        rows = _rows(verify_ssl=False, client_cert=str(certificate), client_key=str(key))

        build_context(rows, _SERVER_NAME)

        assert Path(certificate).read_text(encoding="utf-8") == pki.client_cert_pem
        assert Path(key).read_text(encoding="utf-8") == pki.client_key_pem

    def test_a_missing_client_certificate_file_raises_the_open_error(self, pki: _Pki) -> None:
        rows = _rows(
            verify_ssl=False, client_cert="/nonexistent/client.pem", client_key=pki.client_key_pem
        )

        with pytest.raises(
            FileNotFoundError,
            match=r"^\[Errno 2\] No such file or directory: '/nonexistent/client\.pem'$",
        ):
            build_context(rows, _SERVER_NAME)


class TestWrapBio:
    """The memory-BIO path (asyncio streams) uses the server name too."""

    def test_wrap_bio_takes_the_server_name_over_the_dialed_name(self, pki: _Pki) -> None:
        context = build_context(_rows(ca_cert=pki.ca_pem), _SERVER_NAME)

        tls = context.wrap_bio(ssl.MemoryBIO(), ssl.MemoryBIO(), server_hostname=_DIALED)

        assert tls.server_hostname == _SERVER_NAME

    async def test_an_asyncio_stream_verifies_under_the_server_name(
        self, pki: _Pki, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve()
        context = build_context(_rows(ca_cert=pki.ca_pem), _SERVER_NAME)

        reader, writer = await asyncio.open_connection(
            _DIALED, server.port, ssl=context, server_hostname=_DIALED
        )
        data = await asyncio.wait_for(reader.readexactly(2), _BOUND_S)
        writer.close()
        await writer.wait_closed()

        assert data == b"ok"

    async def test_an_asyncio_stream_under_another_name_fails(
        self, pki: _Pki, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve()
        context = build_context(_rows(ca_cert=pki.ca_pem), "other.internal")

        with pytest.raises(ssl.SSLCertVerificationError):
            await asyncio.wait_for(
                asyncio.open_connection(_DIALED, server.port, ssl=context, server_hostname=_DIALED),
                _BOUND_S,
            )


def _hash_link(folder: Path, pem: str) -> None:
    """The CA under OpenSSL's subject-hash name, the form a certificate folder needs."""
    certificate = OpenSSL.crypto.load_certificate(OpenSSL.crypto.FILETYPE_PEM, pem.encode())
    (folder / f"{certificate.get_subject().hash():08x}.0").write_text(pem, encoding="utf-8")


def _identity_unused(_certificate: str, _key: str | None) -> None:
    raise AssertionError("no client pair was set")


def _refuse_settings() -> Any:
    raise AssertionError("the Settings trust was read")


class TestPartialChain:
    """Any trusted certificate ends the chain, a root or an intermediate (REQ-4.5.16)."""

    def test_the_context_accepts_a_partial_chain(self, pki: _Pki) -> None:
        context = build_context(_rows(ca_cert=pki.ca_pem), _SERVER_NAME)

        assert context.verify_flags & ssl.VERIFY_X509_PARTIAL_CHAIN

    def test_an_intermediate_ca_trusts_a_server_that_sends_only_its_leaf(
        self, chain: _Chain, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve(certfile=chain.leaf_only, keyfile=chain.leaf_key)
        context = build_context(_rows(ca_cert=chain.intermediate_pem), _SERVER_NAME)

        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)

    def test_a_root_ca_refuses_a_server_that_sends_only_its_leaf(
        self, chain: _Chain, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve(certfile=chain.leaf_only, keyfile=chain.leaf_key)
        context = build_context(_rows(ca_cert=chain.root_pem), _SERVER_NAME)

        with pytest.raises(ssl.SSLCertVerificationError) as raised:
            _handshake(context, server.port)

        assert raised.value.verify_message == "unable to get local issuer certificate"

    def test_a_root_ca_trusts_a_server_that_also_sends_the_intermediate(
        self, chain: _Chain, serve: Callable[..., _TlsServer]
    ) -> None:
        server = serve(certfile=chain.full_chain, keyfile=chain.leaf_key)
        context = build_context(_rows(ca_cert=chain.root_pem), _SERVER_NAME)

        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)

    def test_an_additional_intermediate_trusts_a_server_that_sends_only_its_leaf(
        self, chain: _Chain, serve: Callable[..., _TlsServer], use_spec: Callable[..., Any]
    ) -> None:
        use_spec(additional=(chain.intermediate_pem,))
        server = serve(certfile=chain.leaf_only, keyfile=chain.leaf_key)
        context = build_context(_rows(), _SERVER_NAME)

        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)


class TestBlankCaTrust:
    """A blank CA trusts the Additional Certificates plus the public source chosen in Settings."""

    def test_an_additional_certificate_is_trusted_and_logged(
        self,
        pki: _Pki,
        serve: Callable[..., _TlsServer],
        use_spec: Callable[..., Any],
        run_lines: Lines,
    ) -> None:
        use_spec(additional=(pki.ca_pem,))
        server = serve()
        context = build_context(_rows(), _SERVER_NAME)

        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)
        assert run_lines == [("DEBUG", f"{_BUILT_IN_LINE} and 1 additional certificate")]

    def test_the_built_in_list_alone_refuses_a_private_authority(
        self, serve: Callable[..., _TlsServer], use_spec: Callable[..., Any], run_lines: Lines
    ) -> None:
        use_spec()
        server = serve()
        context = build_context(_rows(), _SERVER_NAME)

        with pytest.raises(ssl.SSLCertVerificationError) as raised:
            _handshake(context, server.port)

        assert raised.value.verify_message == "unable to get local issuer certificate"
        assert run_lines == [("DEBUG", _BUILT_IN_LINE)]

    def test_the_host_store_source_trusts_the_located_store(
        self,
        pki: _Pki,
        serve: Callable[..., _TlsServer],
        trust: ModuleType,
        use_spec: Callable[..., Any],
        run_lines: Lines,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        store = tmp_path / "ca-bundle.crt"
        store.write_text(pki.ca_pem, encoding="utf-8")
        monkeypatch.setattr(trust, "HOST_STORE_PATHS", (str(tmp_path / "absent.crt"), str(store)))
        use_spec("host")
        server = serve()
        context = build_context(_rows(), _SERVER_NAME)

        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)
        assert run_lines == [("DEBUG", f"Trusting this WAVE host's certificate store {store}")]

    def test_the_host_store_source_without_a_store_is_refused(
        self,
        trust: ModuleType,
        use_spec: Callable[..., Any],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        absent = tmp_path / "absent.crt"
        monkeypatch.setattr(trust, "HOST_STORE_PATHS", (str(absent),))
        use_spec("host")

        with pytest.raises(
            ValueError,
            match=(
                r"^No certificate store found on this WAVE host: looked in "
                rf"{re.escape(str(absent))}$"
            ),
        ):
            build_context(_rows(), _SERVER_NAME)

    def test_one_line_per_run_however_many_connections(
        self, pki: _Pki, use_spec: Callable[..., Any], run_lines: Lines
    ) -> None:
        use_spec(additional=(pki.ca_pem,))

        build_context(_rows(), _SERVER_NAME)
        build_context(_rows(), _SERVER_NAME)

        assert run_lines == [("DEBUG", f"{_BUILT_IN_LINE} and 1 additional certificate")]

    def test_the_settings_are_read_at_each_connection(
        self, pki: _Pki, serve: Callable[..., _TlsServer], trust: ModuleType
    ) -> None:
        reads: list[Any] = []

        def resolver() -> Any:
            reads.append(
                trust.TrustSpec(
                    source="builtin",
                    additional_pem=pki.ca_pem,
                    additional_count=1,
                    builtin_label=_LABEL,
                )
            )
            return reads[-1]

        trust.set_resolver(resolver)
        server = serve()

        build_context(_rows(), _SERVER_NAME)
        context = build_context(_rows(), _SERVER_NAME)

        assert len(reads) == 2
        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)


class TestSetCaIsExclusive:
    """A CA set on the block is the only certificate it trusts; Settings are not read."""

    def test_additional_certificates_do_not_widen_a_set_ca(
        self,
        pki: _Pki,
        chain: _Chain,
        serve: Callable[..., _TlsServer],
        use_spec: Callable[..., Any],
        run_lines: Lines,
    ) -> None:
        use_spec(additional=(pki.ca_pem,))
        server = serve()
        context = build_context(_rows(ca_cert=chain.root_pem), _SERVER_NAME)

        with pytest.raises(ssl.SSLCertVerificationError) as raised:
            _handshake(context, server.port)

        assert raised.value.verify_message == "unable to get local issuer certificate"
        assert run_lines == []

    def test_a_set_ca_verifies_whatever_settings_hold(
        self,
        pki: _Pki,
        chain: _Chain,
        serve: Callable[..., _TlsServer],
        use_spec: Callable[..., Any],
        run_lines: Lines,
    ) -> None:
        use_spec(additional=(chain.root_pem,))
        server = serve()
        context = build_context(_rows(ca_cert=pki.ca_pem), _SERVER_NAME)

        assert _handshake(context, server.port) == (b"ok", _SERVER_NAME)
        assert run_lines == []

    def test_a_set_ca_never_reads_the_settings(
        self, pki: _Pki, trust: ModuleType, run_lines: Lines
    ) -> None:
        trust.set_resolver(_refuse_settings)

        context = build_context(_rows(ca_cert=pki.ca_pem), _SERVER_NAME)

        assert context.verify_mode == ssl.CERT_REQUIRED
        assert run_lines == []

    def test_verification_off_reads_no_trust_and_logs_nothing(
        self, trust: ModuleType, run_lines: Lines
    ) -> None:
        trust.set_resolver(_refuse_settings)

        context = build_context(_rows(verify_ssl=False), _SERVER_NAME)

        assert context.verify_mode == ssl.CERT_NONE
        assert run_lines == []


class TestEnvironmentNeverChangesTrust:
    """Variables of the WAVE host that name certificate files or folders never add trust."""

    def test_ssl_cert_file_naming_the_lab_ca_is_ignored(
        self,
        pki: _Pki,
        serve: Callable[..., _TlsServer],
        trust: ModuleType,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("SSL_CERT_FILE", str(pki.ca_path))
        server = serve()
        context = build_context(_rows(), _SERVER_NAME)

        with pytest.raises(ssl.SSLCertVerificationError) as raised:
            _handshake(context, server.port)

        assert raised.value.verify_message == "unable to get local issuer certificate"

    def test_ssl_cert_dir_holding_the_lab_ca_is_ignored(
        self,
        pki: _Pki,
        serve: Callable[..., _TlsServer],
        trust: ModuleType,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        _hash_link(tmp_path, pki.ca_pem)
        monkeypatch.setenv("SSL_CERT_DIR", str(tmp_path))
        server = serve()
        context = build_context(_rows(), _SERVER_NAME)

        with pytest.raises(ssl.SSLCertVerificationError) as raised:
            _handshake(context, server.port)

        assert raised.value.verify_message == "unable to get local issuer certificate"

    @pytest.mark.parametrize(
        ("verify_ssl", "with_ca"),
        [
            pytest.param(True, False, id="blank-ca"),
            pytest.param(True, True, id="set-ca"),
            pytest.param(False, False, id="verification-off"),
        ],
    )
    def test_the_default_certificate_paths_are_never_loaded(
        self,
        pki: _Pki,
        trust: ModuleType,
        monkeypatch: pytest.MonkeyPatch,
        verify_ssl: bool,
        with_ca: bool,
    ) -> None:
        calls: list[str] = []

        def load_default_certs(_context: ssl.SSLContext, *_args: Any, **_kwargs: Any) -> None:
            calls.append("load_default_certs")

        def set_default_verify_paths(_context: ssl.SSLContext) -> None:
            calls.append("set_default_verify_paths")

        monkeypatch.setattr(ssl.SSLContext, "load_default_certs", load_default_certs)
        monkeypatch.setattr(ssl.SSLContext, "set_default_verify_paths", set_default_verify_paths)
        rows = _rows(verify_ssl=verify_ssl, ca_cert=pki.ca_pem if with_ca else "")

        build_context(rows, _SERVER_NAME)

        assert calls == []


class TestLoadMaterial:
    """The hand-off every TLS library shares: the trust as one PEM file, then the client pair."""

    def test_it_takes_the_rows_the_trust_and_the_identity(self) -> None:
        assert list(inspect.signature(load_material).parameters) == [
            "tls_rows",
            "trust",
            "identity",
        ]

    def test_a_blank_ca_hands_over_the_active_anchors_in_a_private_file(
        self, pki: _Pki, trust: ModuleType, use_spec: Callable[..., Any]
    ) -> None:
        spec = use_spec(additional=(pki.ca_pem,))
        handed: list[tuple[str, str, bool]] = []

        def take(path: str) -> None:
            handed.append((path, Path(path).read_text(encoding="utf-8"), _private(path)))

        load_material(_rows(), take, _identity_unused)

        assert [(text, private) for _path, text, private in handed] == [
            (trust.anchors_pem(spec), True)
        ]
        assert pki.ca_pem in handed[0][1]
        assert certifi.contents() in handed[0][1]
        assert not os.path.exists(handed[0][0])

    def test_a_set_ca_hands_over_that_ca_alone(
        self, pki: _Pki, use_spec: Callable[..., Any]
    ) -> None:
        use_spec(additional=(pki.client_ca_pem,))
        handed: list[str] = []

        load_material(
            _rows(ca_cert=pki.ca_pem),
            lambda path: handed.append(Path(path).read_text(encoding="utf-8")),
            _identity_unused,
        )

        assert handed == [pki.ca_pem]

    def test_verification_off_hands_over_no_trust(self, trust: ModuleType) -> None:
        handed: list[str] = []

        load_material(_rows(verify_ssl=False), handed.append, _identity_unused)

        assert handed == []
