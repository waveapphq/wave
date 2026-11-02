"""WAVE's certificate trust core: the trust spec, its sources and the run log line (REQ-4.5.16).

A blank CA trusts the Additional Certificates plus WAVE's built-in list or the host's own store,
any trusted certificate completes a chain, and environment variables never change trust.
"""

import contextvars
import dataclasses
import json
import re
import ssl
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import certifi
import OpenSSL.crypto
import OpenSSL.SSL
import pytest

from tests.core.remote_exec._vendorability import (
    FUNCTION,
    TRY,
    TYPE_CHECKING,
    import_sites,
    is_stdlib,
    matches,
    parses_at_the_floor,
    post_floor_names,
)
from tests.plugins.http import tls_material
from wavecore.connectivity import run_log, trust_store
from wavecore.connectivity.trust_store import (
    ACTIVE_SPEC,
    TrustSpec,
    active_spec,
    allow_partial_chain,
    allow_partial_chain_openssl,
    anchors_pem,
    locate_host_store,
    log_line,
    set_resolver,
)

_PATH = Path(str(trust_store.__file__))
_SERVER_NAME = "db.internal"
_LABEL = "June 2026"
_REMOTE = "the remote host"
_BUILT_IN_LINE = "Trusting WAVE's built-in certificate list (June 2026)"
_HOST_STORE_PATHS = (
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/pki/tls/cacert.pem",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/ssl/cert.pem",
)
# Carried beside trust_store in the remote bundle.
_VENDORED_SIBLINGS = ("wavecore.connectivity.run_log",)
# Read only where they exist: certifi on the WAVE host, pyOpenSSL beside SQL Server's driver.
_GUARDED_THIRD_PARTY = ("certifi", "OpenSSL")
_GUARDS = frozenset({FUNCTION, TRY, TYPE_CHECKING})

Lines = list[tuple[str, str]]


@dataclass
class _Chain:
    """A root, an intermediate it signed and a db.internal leaf the intermediate signed."""

    root: tls_material.Credential
    intermediate: tls_material.Credential
    leaf: tls_material.Credential
    leaf_only: Path
    leaf_key: Path


@pytest.fixture(scope="module")
def chain(tmp_path_factory: pytest.TempPathFactory) -> _Chain:
    folder = tmp_path_factory.mktemp("trust-chain")
    root = tls_material.make_credential("WAVE Chain Root", key_kind="ec256", is_ca=True)
    intermediate = tls_material.make_credential(
        "WAVE Chain Intermediate", issuer=root, key_kind="ec256", is_ca=True
    )
    leaf = tls_material.make_credential(
        _SERVER_NAME, issuer=intermediate, key_kind="ec256", san_dns=[_SERVER_NAME]
    )
    (folder / "leaf.pem").write_text(leaf.cert_pem, encoding="utf-8")
    (folder / "leaf-key.pem").write_text(leaf.key_pem, encoding="utf-8")
    return _Chain(root, intermediate, leaf, folder / "leaf.pem", folder / "leaf-key.pem")


@pytest.fixture(autouse=True)
def no_resolver() -> None:
    set_resolver(None)


@pytest.fixture
def request_spec() -> Iterator[Callable[[TrustSpec], TrustSpec]]:
    """Set the request's trust spec, as the remote worker does per request."""
    tokens: list[contextvars.Token[TrustSpec | None]] = []

    def use(spec: TrustSpec) -> TrustSpec:
        tokens.append(ACTIVE_SPEC.set(spec))
        return spec

    yield use
    for token in reversed(tokens):
        ACTIVE_SPEC.reset(token)


@pytest.fixture
def run_lines() -> Iterator[Lines]:
    lines: Lines = []
    token = run_log.RUN_LOG.set(run_log.RunLog(lambda level, text: lines.append((level, text))))
    yield lines
    run_log.RUN_LOG.reset(token)


@pytest.fixture
def host_stores(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Callable[..., tuple[Path, ...]]:
    """Point the store walk at files under tmp_path; `present` names the ones that exist."""

    def place(
        *present: str, names: tuple[str, ...] = ("first.crt", "second.crt", "third.crt")
    ) -> tuple[Path, ...]:
        paths = tuple(tmp_path / "stores" / name for name in names)
        (tmp_path / "stores").mkdir(exist_ok=True)
        for path in paths:
            if path.name in present:
                path.write_text(f"store {path.name}\n", encoding="utf-8")
        monkeypatch.setattr(trust_store, "HOST_STORE_PATHS", tuple(str(path) for path in paths))
        return paths

    return place


def _spec(
    source: str = "builtin",
    additional_pem: str = "",
    additional_count: int = 0,
    builtin_label: str = _LABEL,
) -> TrustSpec:
    return TrustSpec(
        source=source,
        additional_pem=additional_pem,
        additional_count=additional_count,
        builtin_label=builtin_label,
    )


def _looked_in(paths: tuple[Path, ...]) -> str:
    return re.escape(", ".join(str(path) for path in paths))


def _python_handshake(client: ssl.SSLContext, chain: _Chain) -> None:
    """A TLS handshake in memory with a server that sends only its leaf."""
    server = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server.load_cert_chain(chain.leaf_only, chain.leaf_key)
    client_in, client_out, server_in, server_out = (ssl.MemoryBIO() for _ in range(4))
    near = client.wrap_bio(client_in, client_out, server_hostname=_SERVER_NAME)
    far = server.wrap_bio(server_in, server_out, server_side=True)
    for _ in range(8):
        finished = 0
        for side in (near, far):
            try:
                side.do_handshake()
                finished += 1
            except ssl.SSLWantReadError:
                pass
        server_in.write(client_out.read())
        client_in.write(server_out.read())
        if finished == 2:
            return
    raise AssertionError("the handshake did not finish")


def _python_client(anchor_pem: str) -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(cadata=anchor_pem)
    return context


def _openssl_client(anchor: tls_material.Credential) -> OpenSSL.SSL.Context:
    context = OpenSSL.SSL.Context(OpenSSL.SSL.TLS_CLIENT_METHOD)
    context.get_cert_store().add_cert(OpenSSL.crypto.X509.from_cryptography(anchor.cert))
    return context


def _openssl_verify(context: OpenSSL.SSL.Context, leaf: tls_material.Credential) -> None:
    """Verify the leaf against the context's own store; the caller keeps the context alive."""
    store = context.get_cert_store()
    assert store is not None
    certificate = OpenSSL.crypto.X509.from_cryptography(leaf.cert)
    OpenSSL.crypto.X509StoreContext(store, certificate).verify_certificate()


class TestTrustSpec:
    """The one description of what a blank CA trusts, shipped to remote hosts on each request."""

    def test_the_fields_in_order(self) -> None:
        assert [field.name for field in dataclasses.fields(TrustSpec)] == [
            "source",
            "additional_pem",
            "additional_count",
            "builtin_label",
        ]

    def test_it_is_frozen(self) -> None:
        spec = _spec()

        with pytest.raises(dataclasses.FrozenInstanceError):
            spec.source = "host"

    def test_the_wire_form_holds_every_field(self) -> None:
        spec = _spec("host", "-----BEGIN CERTIFICATE-----\n", 1)

        assert spec.to_wire() == {
            "source": "host",
            "additional_pem": "-----BEGIN CERTIFICATE-----\n",
            "additional_count": 1,
            "builtin_label": _LABEL,
        }

    @pytest.mark.parametrize(
        "spec",
        [
            pytest.param(_spec(), id="built-in"),
            pytest.param(_spec("builtin", "pem-a\npem-b\n", 2), id="built-in-with-additional"),
            pytest.param(_spec("host", "pem-a\n", 1), id="host-store"),
        ],
    )
    def test_the_wire_form_round_trips_through_a_json_request_line(self, spec: TrustSpec) -> None:
        line = json.dumps(spec.to_wire())

        assert TrustSpec.from_wire(json.loads(line)) == spec


class TestActiveSpec:
    """The request's spec wins, else the registered resolver, else the built-in list alone."""

    def test_the_request_variable_holds_nothing_by_default(self) -> None:
        assert contextvars.Context().run(ACTIVE_SPEC.get) is None

    def test_without_a_request_spec_or_resolver_only_the_built_in_list_is_trusted(self) -> None:
        spec = active_spec()

        assert (spec.source, spec.additional_pem, spec.additional_count) == ("builtin", "", 0)

    def test_a_registered_resolver_answers(self) -> None:
        settings = _spec("host", "pem-a\n", 1)
        set_resolver(lambda: settings)

        assert active_spec() == settings

    def test_the_resolver_is_read_at_each_call(self) -> None:
        answers = iter([_spec(), _spec("host")])
        set_resolver(lambda: next(answers))

        assert [active_spec().source, active_spec().source] == ["builtin", "host"]

    def test_the_request_spec_wins_and_the_resolver_is_not_read(
        self, request_spec: Callable[[TrustSpec], TrustSpec]
    ) -> None:
        reads: list[TrustSpec] = []

        def resolver() -> TrustSpec:
            reads.append(_spec("host"))
            return reads[-1]

        set_resolver(resolver)
        sent = request_spec(_spec("builtin", "pem-a\n", 1))

        assert active_spec() == sent
        assert reads == []

    def test_clearing_the_resolver_falls_back_to_the_built_in_list(self) -> None:
        set_resolver(lambda: _spec("host", "pem-a\n", 1))
        set_resolver(None)

        assert active_spec().source == "builtin"


class TestLocateHostStore:
    """The host's store is the first existing file of a fixed list; nothing else is consulted."""

    def test_the_fixed_list_in_its_order(self) -> None:
        assert tuple(trust_store.HOST_STORE_PATHS) == _HOST_STORE_PATHS

    def test_the_first_existing_file_is_the_store(
        self, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        paths = host_stores("second.crt", "third.crt")

        assert locate_host_store() == paths[1]

    def test_an_earlier_location_wins_over_a_later_one(
        self, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        paths = host_stores("first.crt", "third.crt")

        assert locate_host_store() == paths[0]

    def test_a_folder_at_a_location_is_not_a_store(
        self, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        paths = host_stores("second.crt")
        paths[0].mkdir()

        assert locate_host_store() == paths[1]

    def test_no_existing_file_is_no_store(
        self, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        host_stores()

        assert locate_host_store() is None

    def test_the_environment_never_names_the_store(
        self,
        host_stores: Callable[..., tuple[Path, ...]],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        chain: _Chain,
    ) -> None:
        bundle = tmp_path / "env" / "bundle.pem"
        bundle.parent.mkdir()
        bundle.write_text(chain.root.cert_pem, encoding="utf-8")
        monkeypatch.setenv("SSL_CERT_FILE", str(bundle))
        monkeypatch.setenv("SSL_CERT_DIR", str(bundle.parent))
        host_stores()

        assert locate_host_store() is None

    def test_the_environment_does_not_displace_a_found_store(
        self,
        host_stores: Callable[..., tuple[Path, ...]],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        bundle = tmp_path / "bundle.pem"
        bundle.write_text("env bundle\n", encoding="utf-8")
        monkeypatch.setenv("SSL_CERT_FILE", str(bundle))
        monkeypatch.setenv("SSL_CERT_DIR", str(tmp_path))
        paths = host_stores("third.crt")

        assert locate_host_store() == paths[2]


class TestAnchorsPem:
    """The PEM a blank CA trusts: the Additional Certificates, then the chosen public source."""

    def test_the_built_in_source_is_the_bundled_list(self) -> None:
        assert anchors_pem(_spec()) == certifi.contents()

    def test_additional_certificates_come_before_the_built_in_list(self, chain: _Chain) -> None:
        additional = chain.root.cert_pem + chain.intermediate.cert_pem

        assert anchors_pem(_spec(additional_pem=additional, additional_count=2)) == (
            additional + certifi.contents()
        )

    def test_the_host_source_is_the_located_store(
        self, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        host_stores("second.crt")

        assert anchors_pem(_spec("host")) == "store second.crt\n"

    def test_additional_certificates_come_before_the_host_store(
        self, host_stores: Callable[..., tuple[Path, ...]], chain: _Chain
    ) -> None:
        host_stores("first.crt")
        spec = _spec("host", chain.root.cert_pem, 1)

        assert anchors_pem(spec) == chain.root.cert_pem + "store first.crt\n"

    def test_the_built_in_source_never_needs_a_host_store(
        self, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        host_stores()

        assert anchors_pem(_spec()) == certifi.contents()

    def test_the_environment_never_adds_a_certificate(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, chain: _Chain
    ) -> None:
        bundle = tmp_path / "bundle.pem"
        bundle.write_text(chain.root.cert_pem, encoding="utf-8")
        monkeypatch.setenv("SSL_CERT_FILE", str(bundle))
        monkeypatch.setenv("SSL_CERT_DIR", str(tmp_path))

        assert anchors_pem(_spec()) == certifi.contents()

    def test_no_store_on_this_wave_host_is_refused(
        self, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        paths = host_stores()

        with pytest.raises(
            ValueError,
            match=rf"^No certificate store found on this WAVE host: looked in {_looked_in(paths)}$",
        ):
            anchors_pem(_spec("host"))

    def test_the_refusal_names_every_location_in_order(
        self, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        paths = host_stores(names=("a.crt", "b.crt", "c.crt", "d.crt", "e.crt", "f.crt"))

        with pytest.raises(ValueError) as raised:
            anchors_pem(_spec("host"), "this WAVE host")

        listed = str(raised.value).split(": looked in ", 1)[1]
        assert listed.split(", ") == [str(path) for path in paths]

    def test_no_store_on_the_remote_host_is_refused(
        self, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        paths = host_stores()

        with pytest.raises(
            ValueError,
            match=rf"^No certificate store found on the remote host: looked in "
            rf"{_looked_in(paths)}$",
        ):
            anchors_pem(_spec("host"), _REMOTE)


class TestLogLine:
    """The run log names the source a blank CA used and how many additional certificates."""

    @pytest.mark.parametrize(
        ("count", "suffix"),
        [
            (0, ""),
            (1, " and 1 additional certificate"),
            (2, " and 2 additional certificates"),
            (12, " and 12 additional certificates"),
        ],
    )
    @pytest.mark.parametrize("where", ["this WAVE host", _REMOTE])
    def test_the_built_in_list(self, count: int, suffix: str, where: str) -> None:
        assert log_line(_spec(additional_count=count), where, None) == _BUILT_IN_LINE + suffix

    def test_the_built_in_list_names_its_label(self) -> None:
        assert log_line(_spec(builtin_label="March 2027"), "this WAVE host", None) == (
            "Trusting WAVE's built-in certificate list (March 2027)"
        )

    @pytest.mark.parametrize(
        ("count", "suffix"),
        [
            (0, ""),
            (1, " and 1 additional certificate"),
            (2, " and 2 additional certificates"),
        ],
    )
    def test_this_wave_hosts_store(self, count: int, suffix: str) -> None:
        line = log_line(
            _spec("host", additional_count=count),
            "this WAVE host",
            "/etc/ssl/certs/ca-certificates.crt",
        )

        assert line == (
            "Trusting this WAVE host's certificate store /etc/ssl/certs/ca-certificates.crt"
            + suffix
        )

    @pytest.mark.parametrize(
        ("count", "suffix"),
        [
            (0, ""),
            (1, " and 1 additional certificate"),
            (2, " and 2 additional certificates"),
        ],
    )
    def test_the_remote_hosts_store(self, count: int, suffix: str) -> None:
        line = log_line(
            _spec("host", additional_count=count), _REMOTE, "/etc/pki/tls/certs/ca-bundle.crt"
        )

        assert line == (
            "Trusting the remote host's certificate store /etc/pki/tls/certs/ca-bundle.crt" + suffix
        )


class TestTrustIsLogged:
    """anchors_pem writes the source line once per block run, and only into a run's log."""

    def test_the_built_in_line_is_logged_once_per_run(self, run_lines: Lines) -> None:
        anchors_pem(_spec(additional_count=1, additional_pem="pem-a\n"))
        anchors_pem(_spec(additional_count=1, additional_pem="pem-a\n"))

        assert run_lines == [("DEBUG", f"{_BUILT_IN_LINE} and 1 additional certificate")]

    def test_the_host_line_names_the_located_store(
        self, run_lines: Lines, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        paths = host_stores("second.crt")

        anchors_pem(_spec("host"))

        assert run_lines == [("DEBUG", f"Trusting this WAVE host's certificate store {paths[1]}")]

    def test_the_remote_host_line_names_its_store(
        self, run_lines: Lines, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        paths = host_stores("first.crt")

        anchors_pem(_spec("host", "pem-a\npem-b\n", 2), _REMOTE)

        assert run_lines == [
            (
                "DEBUG",
                f"Trusting the remote host's certificate store {paths[0]} and 2 additional "
                "certificates",
            )
        ]

    def test_without_a_run_nothing_is_logged(self) -> None:
        assert run_log.RUN_LOG.get() is None

        assert anchors_pem(_spec()) == certifi.contents()

    def test_two_runs_each_log_the_line(self) -> None:
        first: Lines = []
        second: Lines = []

        for lines in (first, second):
            sink = run_log.RunLog(lambda level, text, into=lines: into.append((level, text)))
            token = run_log.RUN_LOG.set(sink)
            try:
                anchors_pem(_spec())
            finally:
                run_log.RUN_LOG.reset(token)

        assert first == second == [("DEBUG", _BUILT_IN_LINE)]

    def test_a_refused_host_store_logs_nothing(
        self, run_lines: Lines, host_stores: Callable[..., tuple[Path, ...]]
    ) -> None:
        host_stores()

        with pytest.raises(ValueError):
            anchors_pem(_spec("host"))

        assert run_lines == []


class TestTrustLocation:
    """A caller that names no place gets the module location; the remote worker sets it."""

    def test_the_location_is_this_wave_host_by_default(self) -> None:
        assert trust_store.LOCATION == "this WAVE host"

    def test_a_remote_location_names_the_remote_hosts_store(
        self,
        run_lines: Lines,
        host_stores: Callable[..., tuple[Path, ...]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(trust_store, "LOCATION", trust_store.REMOTE_HOST)
        paths = host_stores("second.crt")

        anchors_pem(_spec("host"))

        assert run_lines == [("DEBUG", f"Trusting the remote host's certificate store {paths[1]}")]

    def test_a_remote_location_refuses_a_missing_store_naming_the_remote_host(
        self, host_stores: Callable[..., tuple[Path, ...]], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(trust_store, "LOCATION", trust_store.REMOTE_HOST)
        paths = host_stores()

        with pytest.raises(
            ValueError,
            match=rf"^No certificate store found on the remote host: looked in "
            rf"{_looked_in(paths)}$",
        ):
            anchors_pem(_spec("host"))

    def test_a_named_place_wins_over_the_location(
        self,
        run_lines: Lines,
        host_stores: Callable[..., tuple[Path, ...]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(trust_store, "LOCATION", trust_store.REMOTE_HOST)
        paths = host_stores("first.crt")

        anchors_pem(_spec("host"), "this WAVE host")

        assert run_lines == [("DEBUG", f"Trusting this WAVE host's certificate store {paths[0]}")]


class TestPartialChain:
    """Any trusted certificate completes a chain, root or intermediate (curl parity)."""

    def test_the_python_flag_is_added_to_the_flags_already_set(self) -> None:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        before = context.verify_flags

        allow_partial_chain(context)

        assert context.verify_flags == before | ssl.VERIFY_X509_PARTIAL_CHAIN

    def test_a_python_context_trusting_an_intermediate_accepts_its_leaf(
        self, chain: _Chain
    ) -> None:
        context = _python_client(chain.intermediate.cert_pem)

        allow_partial_chain(context)

        _python_handshake(context, chain)

    def test_without_the_flag_an_intermediate_alone_is_not_enough(self, chain: _Chain) -> None:
        context = _python_client(chain.intermediate.cert_pem)

        with pytest.raises(ssl.SSLCertVerificationError) as raised:
            _python_handshake(context, chain)

        assert raised.value.verify_message == "unable to get issuer certificate"

    def test_a_python_context_trusting_the_root_still_needs_the_intermediate(
        self, chain: _Chain
    ) -> None:
        context = _python_client(chain.root.cert_pem)
        allow_partial_chain(context)

        with pytest.raises(ssl.SSLCertVerificationError) as raised:
            _python_handshake(context, chain)

        assert raised.value.verify_message == "unable to get local issuer certificate"

    def test_an_openssl_store_trusting_an_intermediate_accepts_its_leaf(
        self, chain: _Chain
    ) -> None:
        context = _openssl_client(chain.intermediate)

        allow_partial_chain_openssl(context)

        _openssl_verify(context, chain.leaf)

    def test_without_the_flag_an_openssl_store_refuses_the_leaf(self, chain: _Chain) -> None:
        context = _openssl_client(chain.intermediate)

        with pytest.raises(
            OpenSSL.crypto.X509StoreContextError, match=r"^unable to get issuer certificate$"
        ):
            _openssl_verify(context, chain.leaf)


class TestRidesToRemoteHosts:
    """The worker sets the request's spec, so the module is carried verbatim to Python 3.10."""

    def test_unguarded_imports_are_the_standard_library_or_the_run_log(self) -> None:
        outside = [
            sorted(site.names)
            for site in import_sites(trust_store.__name__, _PATH)
            if not site.guards & _GUARDS
            and not is_stdlib(site.names)
            and not any(
                matches(name, sibling) for name in site.names for sibling in _VENDORED_SIBLINGS
            )
        ]

        assert outside == []

    def test_third_party_packages_are_read_only_inside_a_function_or_a_guard(self) -> None:
        guarded = [
            site
            for site in import_sites(trust_store.__name__, _PATH)
            if site.guards & _GUARDS and not is_stdlib(site.names)
        ]

        assert [
            sorted(site.names)
            for site in guarded
            if site.root not in _GUARDED_THIRD_PARTY
            and not any(
                matches(name, sibling) for name in site.names for sibling in _VENDORED_SIBLINGS
            )
        ] == []

    def test_it_never_reaches_into_the_api_or_the_core(self) -> None:
        names = {name for site in import_sites(trust_store.__name__, _PATH) for name in site.names}

        assert (
            sorted(
                name
                for name in names
                if matches(name, "wavecore.api") or matches(name, "wavecore.core")
            )
            == []
        )

    def test_it_parses_at_the_interpreter_floor(self) -> None:
        source = _PATH.read_text(encoding="utf-8")

        assert parses_at_the_floor(source)
        assert post_floor_names(source) == set()


class TestBuiltInList:
    """WAVE's built-in list: certifi on the WAVE host, the bundle's copy where certifi is absent."""

    def test_the_label_is_the_release_month_of_the_bundled_list(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(certifi, "__version__", "2027.03.09")

        assert trust_store.builtin_list_label() == "March 2027"

    def test_the_built_in_only_spec_names_the_bundled_release(self) -> None:
        assert active_spec().builtin_label == trust_store.builtin_list_label()

    def test_a_set_list_replaces_certifi_until_cleared(self) -> None:
        trust_store.set_builtin_pem("remote list\n")
        try:
            assert trust_store.builtin_pem() == "remote list\n"
            assert anchors_pem(_spec("builtin", "pem-a\n", 1)) == "pem-a\nremote list\n"
        finally:
            trust_store.set_builtin_pem(None)

        assert trust_store.builtin_pem() == certifi.contents()
