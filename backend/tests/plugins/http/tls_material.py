"""Certificate/key factories for the pure-Python TLS engine tests.

Builds throwaway PKI material with `cryptography` (test-side only; the
engine under test never uses it): CAs, leaves, chains, assorted key types
and signature schemes, SAN variants, and custom validity windows.
"""

import datetime
import ipaddress
from dataclasses import dataclass

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa
from cryptography.x509.oid import NameOID

_NOW = datetime.datetime(2026, 7, 19, tzinfo=datetime.UTC)
DEFAULT_NOT_BEFORE = _NOW - datetime.timedelta(days=30)
DEFAULT_NOT_AFTER = _NOW + datetime.timedelta(days=335)


@dataclass
class Credential:
    """One certificate + its private key, in every needed encoding."""

    cert: x509.Certificate
    key: rsa.RSAPrivateKey | ec.EllipticCurvePrivateKey | ed25519.Ed25519PrivateKey

    @property
    def der(self) -> bytes:
        return self.cert.public_bytes(serialization.Encoding.DER)

    @property
    def cert_pem(self) -> str:
        return self.cert.public_bytes(serialization.Encoding.PEM).decode()

    @property
    def key_pem(self) -> str:
        return self.key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ).decode()


def make_key(kind: str = "rsa"):  # type: ignore[no-untyped-def]
    """A fresh private key of the requested kind."""
    if kind == "rsa":
        return rsa.generate_private_key(public_exponent=65537, key_size=2048)
    if kind == "ec256":
        return ec.generate_private_key(ec.SECP256R1())
    if kind == "ec384":
        return ec.generate_private_key(ec.SECP384R1())
    if kind == "ec521":
        return ec.generate_private_key(ec.SECP521R1())
    if kind == "ed25519":
        return ed25519.Ed25519PrivateKey.generate()
    raise ValueError(kind)


def make_credential(
    common_name: str,
    *,
    issuer: Credential | None = None,
    key_kind: str = "rsa",
    is_ca: bool = False,
    include_basic_constraints: bool = True,
    san_dns: list[str] | None = None,
    san_ips: list[str] | None = None,
    extra_name_attrs: list[tuple[x509.ObjectIdentifier, str]] | None = None,
    not_before: datetime.datetime = DEFAULT_NOT_BEFORE,
    not_after: datetime.datetime = DEFAULT_NOT_AFTER,
    sig_hash: hashes.HashAlgorithm | None = None,
    pss: bool = False,
) -> Credential:
    """Issue a certificate (self-signed when no issuer is given)."""
    key = make_key(key_kind)
    attrs = [x509.NameAttribute(NameOID.COMMON_NAME, common_name)]
    for oid, value in extra_name_attrs or []:
        attrs.append(x509.NameAttribute(oid, value))
    subject = x509.Name(attrs)
    issuer_name = issuer.cert.subject if issuer else subject
    signing_key = issuer.key if issuer else key

    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer_name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(not_before)
        .not_valid_after(not_after)
    )
    if include_basic_constraints:
        builder = builder.add_extension(
            x509.BasicConstraints(ca=is_ca, path_length=None), critical=True
        )
    names: list[x509.GeneralName] = [x509.DNSName(name) for name in san_dns or []]
    names += [x509.IPAddress(ipaddress.ip_address(ip)) for ip in san_ips or []]
    if names:
        builder = builder.add_extension(x509.SubjectAlternativeName(names), critical=False)

    if isinstance(signing_key, ed25519.Ed25519PrivateKey):
        cert = builder.sign(signing_key, None)
    elif pss:
        assert isinstance(signing_key, rsa.RSAPrivateKey)
        algorithm = sig_hash or hashes.SHA256()
        cert = builder.sign(
            signing_key,
            algorithm,
            rsa_padding=padding.PSS(mgf=padding.MGF1(algorithm), salt_length=algorithm.digest_size),
        )
    else:
        cert = builder.sign(signing_key, sig_hash or hashes.SHA256())
    return Credential(cert=cert, key=key)


def make_server_chain(
    hostname: str = "localhost",
    *,
    leaf_key_kind: str = "rsa",
    san_ips: list[str] | None = None,
) -> tuple[Credential, Credential, Credential]:
    """(root, intermediate, leaf) chain for hostname (+ optional IP SANs)."""
    root = make_credential("Test Root", is_ca=True)
    intermediate = make_credential("Test Intermediate", issuer=root, is_ca=True)
    leaf = make_credential(
        hostname,
        issuer=intermediate,
        key_kind=leaf_key_kind,
        san_dns=[hostname],
        san_ips=san_ips or ["127.0.0.1"],
    )
    return root, intermediate, leaf
