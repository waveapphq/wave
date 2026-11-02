"""Pure-Python TLS engine for the HTTP plugin.

Bundled TLS via tlslite-ng, with no OpenSSL/system-TLS dependency, so a
test's protocol-version and cipher choices put identical bytes on the wire
on every OS and on both the local backend and remote-execution hosts.

This module imports only tlslite/ecdsa/stdlib and the fixed catalog - never
httpx or other wavecore code - so its source is vendored, unchanged, into
Remote Execution bundles alongside tlslite. The httpx transport glue lives
in http_client; the remote worker drives a minimal HTTP/1.1 client. Both
share this engine.
"""

import datetime
import ipaddress
from dataclasses import dataclass, field
from typing import Any

from tlslite import HandshakeSettings, TLSConnection
from tlslite.constants import CipherSuite, SignatureScheme
from tlslite.errors import TLSAbruptCloseError, TLSLocalAlert, TLSRemoteAlert
from tlslite.handshakesettings import TLS13_PERMITTED_GROUPS
from tlslite.utils.asn1parser import ASN1Parser
from tlslite.utils.keyfactory import parsePEMKey
from tlslite.utils.pem import dePemList
from tlslite.x509 import X509
from tlslite.x509certchain import X509CertChain

from wavecore.connectivity import tls_capabilities


class TLSSetupError(Exception):
    """Invalid TLS configuration or unparsable certificate material."""


class TLSVerificationFailure(Exception):
    """Server certificate chain failed verification."""


class TLSHandshakeError(Exception):
    """The TLS handshake itself failed (alert, reset, or truncation)."""


_VERSION_WIRE = {"1.0": (3, 1), "1.1": (3, 2), "1.2": (3, 3), "1.3": (3, 4)}
_WIRE_VERSION_NAME = {(3, 1): "TLSv1", (3, 2): "TLSv1.1", (3, 3): "TLSv1.2", (3, 4): "TLSv1.3"}
_ALL_VERSIONS = [(3, 4), (3, 3), (3, 2), (3, 1)]
# Signaling values that ride the cipher-suite field; keep them when pinning.
_SCSVS = {0x00FF, 0x5600}
_MAX_CHAIN = 10
# Bulk ciphers the handshake settings never allow.
_WEAK_CIPHERS = frozenset({"3des", "rc4", "null"})
_PSS_SALT_LEN = {"sha1": 20, "sha256": 32, "sha384": 48, "sha512": 64}

_NAME_SHORT = {
    "2.5.4.3": "CN",
    "2.5.4.10": "O",
    "2.5.4.11": "OU",
    "2.5.4.6": "C",
    "2.5.4.7": "L",
    "2.5.4.8": "ST",
}
_MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)

_SUPPORTED_SCHEMES = frozenset(
    {
        "rsa_pkcs1_sha1",
        "rsa_pkcs1_sha256",
        "rsa_pkcs1_sha384",
        "rsa_pkcs1_sha512",
        "rsa_pss_rsae_sha256",
        "rsa_pss_rsae_sha384",
        "rsa_pss_rsae_sha512",
        "ecdsa_sha1",
        "ecdsa_secp256r1_sha256",
        "ecdsa_secp384r1_sha384",
        "ecdsa_secp521r1_sha512",
        "ed25519",
        "ed448",
    }
)


@dataclass
class TLSClientConfig:
    """The plugin's TLS parameters, engine-side."""

    min_version: str = "1.2"
    max_version: str = "1.3"
    # None = every catalog suite of the range; [] = explicit zero ciphers; [...] = explicit list.
    cipher_names: list[str] | None = None
    verify: bool = True
    # PEM trust anchors used when verify is on (the block CA or the certificates WAVE trusts).
    anchors_pem: str | None = None
    client_cert_pem: str | None = None
    client_key_pem: str | None = None


@dataclass
class CertFacts:
    """Parsed certificate fields for verification and the wire trace."""

    subject: str
    issuer: str
    subject_der: bytes
    issuer_der: bytes
    not_before: datetime.datetime
    not_after: datetime.datetime
    san_dns: list[str]
    san_ips: list[bytes]
    is_ca: bool
    scheme: str | None
    tbs: bytes
    signature: bytes
    public_key: Any


@dataclass
class HandshakeResult:
    """A completed handshake: the live connection and its negotiated facts."""

    connection: Any
    version: str
    cipher: str
    peer_chain_der: list[bytes] = field(default_factory=list)


def wire_cipher_codepoints(config: TLSClientConfig) -> list[int]:
    """The exact ordered wire cipher list for a config.

    An unset list offers every catalog suite of the range; a list becomes
    catalog code points with the TLS 1.3 family first, dropping suites out of the range.
    """
    names: list[str | None] = list(
        tls_capabilities.suites_for_range(config.min_version, config.max_version)
        if config.cipher_names is None
        else config.cipher_names
    )
    family13: list[int] = []
    family_legacy: list[int] = []
    for row_number, name in enumerate(names, start=1):
        if name is None:
            # Vendored into remote bundles, so the shared null-row text is spelled here.
            raise TLSSetupError(f"Row {row_number} in 'cipher_suites' is null")
        canonical = tls_capabilities.normalize(name)
        row = tls_capabilities.lookup(canonical) if canonical else None
        if row is None:
            raise TLSSetupError(f'Unknown cipher suite "{name}"')
        if not tls_capabilities.suite_in_range(
            row["openssl"], config.min_version, config.max_version
        ):
            continue
        (family13 if row["min_version"] == "1.3" else family_legacy).append(row["codepoint"])
    return family13 + family_legacy


def build_handshake_settings(config: TLSClientConfig) -> HandshakeSettings:
    """Map version pins onto a tlslite HandshakeSettings."""
    settings = HandshakeSettings()
    minimum = _VERSION_WIRE[config.min_version]
    maximum = _VERSION_WIRE[config.max_version]
    settings.minVersion = minimum
    settings.maxVersion = maximum
    settings.versions = [v for v in _ALL_VERSIONS if minimum <= v <= maximum]
    settings.cipherNames = [name for name in settings.cipherNames if name not in _WEAK_CIPHERS]
    if minimum >= (3, 4):
        settings.eccCurves = [c for c in settings.eccCurves if c in TLS13_PERMITTED_GROUPS]
    # Never compress our own certificate: tlslite-ng 0.8.2 gates client-cert
    # compression on the ClientHello, not the server's CertificateRequest, so it
    # would send an unsolicited CompressedCertificate that servers reject.
    settings.certificate_compression_send = []
    return settings


class _PinnedConnection(TLSConnection):  # type: ignore[misc]  # untyped tlslite base
    """A TLSConnection that rewrites the ClientHello to an exact cipher list."""

    wave_pinned: list[int] | None = None

    def _sendMsg(self, msg: Any, *args: Any, **kwargs: Any) -> Any:
        # tlslite calls this positionally and by keyword; pass through verbatim.
        if self.wave_pinned is not None and msg.__class__.__name__ == "ClientHello":
            scsvs = [suite for suite in msg.cipher_suites if suite in _SCSVS]
            msg.cipher_suites = list(self.wave_pinned) + scsvs
        return super()._sendMsg(msg, *args, **kwargs)


def _load_client_identity(config: TLSClientConfig) -> tuple[Any, Any]:
    """Parse the mutual-TLS client chain and private key, or (None, None)."""
    if not config.client_cert_pem:
        return None, None
    try:
        chain = X509CertChain()
        chain.parsePemList(config.client_cert_pem)
        key = None
        if config.client_key_pem:
            key = parsePEMKey(config.client_key_pem, private=True)
    except Exception as exc:
        raise TLSSetupError("Could not load the client certificate or key") from exc
    return chain, key


def tls_handshake(
    sock: Any,
    config: TLSClientConfig,
    server_hostname: str,
    now: datetime.datetime,
) -> HandshakeResult:
    """Handshake over a connected socket, honoring pins, mTLS, and verification."""
    pinned = wire_cipher_codepoints(config)
    settings = build_handshake_settings(config)
    cert_chain, private_key = _load_client_identity(config)
    connection = _PinnedConnection(sock)
    connection.wave_pinned = pinned
    # Servers that close without close_notify are common; treat it as clean EOF.
    connection.ignoreAbruptClose = True
    # SNI carries a DNS name only; an IP literal is verified but never sent as SNI.
    sni = None if _is_ip_literal(server_hostname) else server_hostname
    try:
        connection.handshakeClientCert(
            certChain=cert_chain,
            privateKey=private_key,
            settings=settings,
            serverName=sni,
            reqTack=False,
        )
    except (TLSLocalAlert, TLSRemoteAlert, TLSAbruptCloseError) as exc:
        raise TLSHandshakeError(f"TLS handshake failed: {exc}") from exc
    ders = _peer_chain_der(connection)
    if config.verify:
        verify_chain(ders, server_hostname, config.anchors_pem or "", now)
    return HandshakeResult(
        connection=connection,
        version=_WIRE_VERSION_NAME.get(connection.version, ""),
        cipher=CipherSuite.ietfNames.get(connection.session.cipherSuite, ""),
        peer_chain_der=ders,
    )


def _peer_chain_der(connection: Any) -> list[bytes]:
    chain = connection.session.serverCertChain
    if not chain:
        return []
    return [bytes(cert.bytes) for cert in chain.x509List]


def parse_certificate(der: bytes) -> CertFacts:
    """Parse a DER certificate into the fields verification and the trace need."""
    try:
        return _parse_certificate(der)
    except Exception as exc:
        raise TLSSetupError("Could not parse the certificate") from exc


def _parse_certificate(der: bytes) -> CertFacts:
    cert = ASN1Parser(bytearray(der))
    tbs_bytes = bytes(cert.getChildBytes(0))
    tbs = cert.getChild(0)
    signature = bytes(cert.getChild(2).value[1:])

    base = 1 if tbs.value[0] == 0xA0 else 0
    issuer_der = bytes(tbs.getChildBytes(base + 2))
    subject_der = bytes(tbs.getChildBytes(base + 4))
    validity = tbs.getChild(base + 3)
    not_before = _parse_time(validity.getChild(0))
    not_after = _parse_time(validity.getChild(1))
    extensions = _collect_extensions(tbs, base + 5)
    san_dns, san_ips = _parse_san(extensions.get("2.5.29.17"))
    is_ca = _parse_basic_constraints(extensions.get("2.5.29.19"))

    identity = X509()
    identity.parseBinary(bytearray(der))
    scheme = SignatureScheme.toRepr(identity.sigalg)
    return CertFacts(
        subject=_render_name(subject_der),
        issuer=_render_name(issuer_der),
        subject_der=subject_der,
        issuer_der=issuer_der,
        not_before=not_before,
        not_after=not_after,
        san_dns=san_dns,
        san_ips=san_ips,
        is_ca=is_ca,
        scheme=scheme,
        tbs=tbs_bytes,
        signature=signature,
        public_key=identity.publicKey,
    )


def _collect_extensions(tbs: ASN1Parser, spki_index: int) -> dict[str, bytes]:
    """Map extension OID string to its extnValue content bytes."""
    result: dict[str, bytes] = {}
    for index in range(spki_index + 1, tbs.getChildCount()):
        child = tbs.getChild(index)
        # The extensions live in the [3] context tag; a [1]/[2] unique-id is skipped.
        if child.type.tag_class == 2 and child.type.tag_id == 3:
            sequence = child.getChild(0)
            for ext_index in range(sequence.getChildCount()):
                extension = sequence.getChild(ext_index)
                oid = _decode_oid(bytes(extension.getChild(0).value))
                value = extension.getChild(extension.getChildCount() - 1)
                result[oid] = bytes(value.value)
    return result


def _parse_san(der: bytes | None) -> tuple[list[str], list[bytes]]:
    if der is None:
        return [], []
    names = ASN1Parser(bytearray(der))
    dns: list[str] = []
    ips: list[bytes] = []
    for index in range(names.getChildCount()):
        entry = names.getChild(index)
        if entry.type.tag_id == 2:
            dns.append(bytes(entry.value).decode("ascii"))
        elif entry.type.tag_id == 7:
            ips.append(bytes(entry.value))
    return dns, ips


def _parse_basic_constraints(der: bytes | None) -> bool:
    if der is None:
        return False
    constraints = ASN1Parser(bytearray(der))
    if constraints.getChildCount() == 0:
        return False
    first = constraints.getChild(0)
    return bool(first.type.tag_id == 1 and first.value[0] != 0)


def _parse_time(node: ASN1Parser) -> datetime.datetime:
    text = bytes(node.value).decode("ascii")
    if node.type.tag_id == 23:
        year = int(text[0:2])
        year += 2000 if year < 50 else 1900
        rest = text[2:]
    else:
        year = int(text[0:4])
        rest = text[4:]
    return datetime.datetime(
        year,
        int(rest[0:2]),
        int(rest[2:4]),
        int(rest[4:6]),
        int(rest[6:8]),
        int(rest[8:10]),
        # datetime.UTC is 3.11+; the remote bundle runs on 3.10 hosts (keep timezone.utc).
        tzinfo=datetime.timezone.utc,
    )


def _decode_oid(data: bytes) -> str:
    first = data[0]
    arcs = [str(first // 40), str(first % 40)]
    value = 0
    for byte in data[1:]:
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            arcs.append(str(value))
            value = 0
    return ".".join(arcs)


def _render_name(der: bytes) -> str:
    name = ASN1Parser(bytearray(der))
    parts: list[str] = []
    for rdn_index in range(name.getChildCount()):
        rdn = name.getChild(rdn_index)
        for atv_index in range(rdn.getChildCount()):
            atv = rdn.getChild(atv_index)
            oid = _decode_oid(bytes(atv.getChild(0).value))
            value = bytes(atv.getChild(1).value).decode("utf-8", errors="replace")
            parts.append(f"{_NAME_SHORT.get(oid, oid)}={value}")
    return ", ".join(parts)


def render_cert_time(moment: datetime.datetime) -> str:
    """Render a certificate time the way the wire trace shows it."""
    return (
        f"{_MONTHS[moment.month - 1]} {moment.day:>2} "
        f"{moment.hour:02d}:{moment.minute:02d}:{moment.second:02d} {moment.year} GMT"
    )


def certificate_summary(der: bytes, now: datetime.datetime) -> dict[str, Any]:
    """The trace-facing certificate facts for a leaf DER."""
    facts = parse_certificate(der)
    return {
        "peer_subject": facts.subject,
        "peer_issuer": facts.issuer,
        "not_before": render_cert_time(facts.not_before),
        "not_after": render_cert_time(facts.not_after),
        "days_to_expiry": (facts.not_after - now).days,
    }


def verify_chain(
    ders: list[bytes],
    hostname: str,
    anchors_pem: str,
    now: datetime.datetime,
) -> None:
    """Verify the presented chain against PEM trust anchors; raise on failure."""
    if not ders:
        raise TLSVerificationFailure(
            "Certificate verification failed: server presented no certificate chain"
        )
    if len(ders) > _MAX_CHAIN:
        raise TLSVerificationFailure(
            "Certificate verification failed: certificate chain is too long"
        )
    certs = [parse_certificate(der) for der in ders]
    _check_hostname(certs[0], hostname)
    anchors = _parse_anchors(anchors_pem)

    current = certs[0]
    # `remaining` strictly shrinks each step, so the walk always terminates.
    remaining = certs[1:]
    while True:
        _check_validity(current, now)
        anchor = _find_issuer(current, anchors)
        if anchor is not None:
            if anchor.subject_der == current.subject_der:
                return
            _require_ca(anchor)
            _check_validity(anchor, now)
            _verify_signature(current, anchor)
            return
        issuer = _find_issuer(current, remaining)
        if issuer is None:
            raise TLSVerificationFailure(
                "Certificate verification failed: no trusted issuer found "
                f'for certificate "{current.subject}"'
            )
        _require_ca(issuer)
        _verify_signature(current, issuer)
        remaining = [cert for cert in remaining if cert is not issuer]
        current = issuer


def _parse_anchors(anchors_pem: str) -> list[CertFacts]:
    if not anchors_pem.strip():
        return []
    return [parse_certificate(bytes(der)) for der in dePemList(anchors_pem, "CERTIFICATE")]


def _find_issuer(cert: CertFacts, candidates: list[CertFacts]) -> CertFacts | None:
    for candidate in candidates:
        if candidate.subject_der == cert.issuer_der:
            return candidate
    return None


def _require_ca(cert: CertFacts) -> None:
    if not cert.is_ca:
        raise TLSVerificationFailure(
            "Certificate verification failed: issuer certificate "
            f'"{cert.subject}" is not a certificate authority'
        )


def _check_validity(cert: CertFacts, now: datetime.datetime) -> None:
    if now < cert.not_before:
        raise TLSVerificationFailure(
            f'Certificate verification failed: certificate "{cert.subject}" is not yet valid'
        )
    if now > cert.not_after:
        raise TLSVerificationFailure(
            f'Certificate verification failed: certificate "{cert.subject}" has expired'
        )


def _verify_signature(cert: CertFacts, issuer: CertFacts) -> None:
    if cert.scheme is None or cert.scheme not in _SUPPORTED_SCHEMES:
        raise TLSVerificationFailure(
            "Certificate verification failed: unsupported signature algorithm "
            f'on certificate "{cert.subject}"'
        )
    key_type = SignatureScheme.getKeyType(cert.scheme)
    hash_name = SignatureScheme.getHash(cert.scheme)
    try:
        if key_type == "rsa":
            padding = SignatureScheme.getPadding(cert.scheme)
            ok = issuer.public_key.hashAndVerify(
                cert.signature,
                cert.tbs,
                rsaScheme=padding,
                hAlg=hash_name,
                sLen=_PSS_SALT_LEN[hash_name] if padding == "pss" else 0,
            )
        elif key_type == "ecdsa":
            ok = issuer.public_key.hashAndVerify(cert.signature, cert.tbs, hAlg=hash_name)
        else:
            ok = issuer.public_key.hashAndVerify(cert.signature, cert.tbs)
    except Exception:
        ok = False
    if not ok:
        raise TLSVerificationFailure(
            "Certificate verification failed: signature verification failed "
            f'for certificate "{cert.subject}"'
        )


def _check_hostname(cert: CertFacts, hostname: str) -> None:
    if _hostname_matches(cert, hostname):
        return
    raise TLSVerificationFailure(
        f'Certificate verification failed: hostname "{hostname}" does not match '
        "the server certificate"
    )


def _hostname_matches(cert: CertFacts, hostname: str) -> bool:
    try:
        wanted = ipaddress.ip_address(hostname)
    except ValueError:
        return any(_dns_matches(pattern, hostname) for pattern in cert.san_dns)
    return any(wanted.packed == packed for packed in cert.san_ips)


def _dns_matches(pattern: str, hostname: str) -> bool:
    pattern = pattern.lower()
    hostname = hostname.lower()
    pattern_labels = pattern.split(".")
    host_labels = hostname.split(".")
    if pattern_labels[0] == "*":
        if len(pattern_labels) != len(host_labels):
            return False
        return pattern_labels[1:] == host_labels[1:]
    return pattern == hostname


def _is_ip_literal(hostname: str) -> bool:
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return True
