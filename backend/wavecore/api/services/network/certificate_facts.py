"""Certificate facts behind Settings > Network > Certificates (REQ-4.5.16, NET-7, NET-8, NET-9)."""

import datetime
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, TypeVar

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import dsa, ec, ed448, ed25519, rsa, x448, x25519
from cryptography.x509.oid import NameOID, SignatureAlgorithmOID

from wavecore.plugins._tls_material import PEM_MARKER

PRIVATE_KEY_MESSAGE = "The text contains a private key; paste certificates only"
NO_CERTIFICATE_MESSAGE = "No certificate found"
EXPIRING_DAYS = 30

_CERTIFICATE_BLOCK = re.compile(
    re.escape(PEM_MARKER) + r" CERTIFICATE-----.*?-----END CERTIFICATE-----", re.DOTALL
)
_PRIVATE_KEY = re.compile(re.escape(PEM_MARKER) + r" [A-Z0-9 ]*PRIVATE KEY-----")
_NAME_OVERRIDES = {NameOID.EMAIL_ADDRESS: "emailAddress"}
_CURVES = {"secp256r1": "P-256", "secp384r1": "P-384", "secp521r1": "P-521"}
_FIXED_KEYS: tuple[tuple[type, str], ...] = (
    (ed25519.Ed25519PublicKey, "Ed25519"),
    (ed448.Ed448PublicKey, "Ed448"),
    (x25519.X25519PublicKey, "X25519"),
    (x448.X448PublicKey, "X448"),
)
_SIGNATURES = {
    SignatureAlgorithmOID.RSA_WITH_MD5: "MD5 with RSA",
    SignatureAlgorithmOID.RSA_WITH_SHA1: "SHA-1 with RSA",
    SignatureAlgorithmOID.RSA_WITH_SHA224: "SHA-224 with RSA",
    SignatureAlgorithmOID.RSA_WITH_SHA256: "SHA-256 with RSA",
    SignatureAlgorithmOID.RSA_WITH_SHA384: "SHA-384 with RSA",
    SignatureAlgorithmOID.RSA_WITH_SHA512: "SHA-512 with RSA",
    SignatureAlgorithmOID.RSASSA_PSS: "RSA-PSS",
    SignatureAlgorithmOID.ECDSA_WITH_SHA1: "SHA-1 with ECDSA",
    SignatureAlgorithmOID.ECDSA_WITH_SHA224: "SHA-224 with ECDSA",
    SignatureAlgorithmOID.ECDSA_WITH_SHA256: "SHA-256 with ECDSA",
    SignatureAlgorithmOID.ECDSA_WITH_SHA384: "SHA-384 with ECDSA",
    SignatureAlgorithmOID.ECDSA_WITH_SHA512: "SHA-512 with ECDSA",
    SignatureAlgorithmOID.DSA_WITH_SHA1: "SHA-1 with DSA",
    SignatureAlgorithmOID.DSA_WITH_SHA224: "SHA-224 with DSA",
    SignatureAlgorithmOID.DSA_WITH_SHA256: "SHA-256 with DSA",
    SignatureAlgorithmOID.ED25519: "Ed25519",
    SignatureAlgorithmOID.ED448: "Ed448",
}
_KEY_USAGES = (
    ("digital_signature", "Digital signature"),
    ("content_commitment", "Content commitment"),
    ("key_encipherment", "Key encipherment"),
    ("data_encipherment", "Data encipherment"),
    ("key_agreement", "Key agreement"),
    ("key_cert_sign", "Certificate sign"),
    ("crl_sign", "CRL sign"),
)
# Readable only when key agreement is set; cryptography raises otherwise.
_KEY_AGREEMENT_USAGES = (("encipher_only", "Encipher only"), ("decipher_only", "Decipher only"))

_Extension = TypeVar("_Extension", bound=x509.ExtensionType)


@dataclass(frozen=True)
class ParseError:
    """One problem in pasted or uploaded certificate input; index is the 1-based block."""

    index: int | None
    message: str


class InvalidCertificate(ValueError):
    """The input is not exactly one parsable certificate."""


class NotCACertificate(ValueError):
    """A certificate without basicConstraints CA=true."""


def _extension(cert: x509.Certificate, kind: type[_Extension]) -> _Extension | None:
    try:
        return cert.extensions.get_extension_for_class(kind).value
    except x509.ExtensionNotFound:
        return None


def _ca_certificate(load: Callable[[], x509.Certificate]) -> x509.Certificate:
    try:
        cert = load()
        constraints = _extension(cert, x509.BasicConstraints)
    except ValueError as exc:
        raise InvalidCertificate(str(exc)) from exc
    if constraints is None or not constraints.ca:
        raise NotCACertificate("not a CA certificate")
    return cert


def _pem_loader(block: str) -> Callable[[], x509.Certificate]:
    return lambda: x509.load_pem_x509_certificate(block.encode("utf-8"))


def _collect(
    loaders: Sequence[Callable[[], x509.Certificate]],
) -> tuple[list[x509.Certificate], list[ParseError]]:
    certificates: list[x509.Certificate] = []
    errors: list[ParseError] = []
    for index, load in enumerate(loaders, start=1):
        try:
            certificates.append(_ca_certificate(load))
        except NotCACertificate:
            errors.append(ParseError(index, f"Certificate {index}: not a CA certificate"))
        except InvalidCertificate:
            errors.append(ParseError(index, f"Certificate {index}: not a valid certificate"))
    return certificates, errors


def parse_text(text: str) -> tuple[list[x509.Certificate], list[ParseError]]:
    """The CA certificates of pasted PEM text in text order, plus one error per problem."""
    if not text.strip():
        return [], []
    if _PRIVATE_KEY.search(text):
        return [], [ParseError(None, PRIVATE_KEY_MESSAGE)]
    blocks = pem_blocks(text)
    if not blocks:
        return [], [ParseError(None, NO_CERTIFICATE_MESSAGE)]
    return _collect([_pem_loader(block) for block in blocks])


def parse_file(file_name: str, data: bytes) -> tuple[list[x509.Certificate], list[ParseError]]:
    """A PEM file through parse_text, else one DER certificate, else the file is refused."""
    if PEM_MARKER.encode("ascii") in data:
        return parse_text(data.decode("utf-8", errors="replace"))
    try:
        cert = x509.load_der_x509_certificate(data)
    except ValueError:
        return [], [ParseError(None, f"{file_name} is not a PEM or DER certificate file")]
    return _collect([lambda: cert])


def single_ca_certificate(text: str) -> x509.Certificate:
    """Exactly one PEM CA certificate with no private key beside it."""
    blocks = pem_blocks(text)
    if _PRIVATE_KEY.search(text) or len(blocks) != 1:
        raise InvalidCertificate("not exactly one PEM certificate")
    return _ca_certificate(_pem_loader(blocks[0]))


def pem_blocks(text: str) -> list[str]:
    """The PEM certificate blocks of a text in text order."""
    return list(_CERTIFICATE_BLOCK.findall(text))


def certificate_count(text: str) -> int:
    """How many PEM certificate blocks a bundle text holds."""
    return len(pem_blocks(text))


def certificate_id(cert: x509.Certificate) -> str:
    """The SHA-256 fingerprint as lowercase hex without colons."""
    return cert.fingerprint(hashes.SHA256()).hex()


def pem_of(cert: x509.Certificate) -> str:
    """The certificate re-encoded as PEM by WAVE."""
    return cert.public_bytes(serialization.Encoding.PEM).decode("ascii")


def _colon_hex(data: bytes) -> str:
    return ":".join(f"{byte:02X}" for byte in data)


def _name_text(name: x509.Name) -> str:
    return ", ".join(
        rdn.rfc4514_string(attr_name_overrides=_NAME_OVERRIDES) for rdn in reversed(name.rdns)
    )


def _first(name: x509.Name, oid: x509.ObjectIdentifier) -> str:
    values = name.get_attributes_for_oid(oid)
    return str(values[0].value) if values else ""


def _type_of(cert: x509.Certificate) -> str:
    return "Root" if cert.subject == cert.issuer else "Intermediate"


def row_of(cert: x509.Certificate) -> dict[str, Any]:
    """The table row: id, name (CN, else O, else the subject), organization, type, expiry date."""
    organization = _first(cert.subject, NameOID.ORGANIZATION_NAME)
    name = _first(cert.subject, NameOID.COMMON_NAME) or organization or _name_text(cert.subject)
    return {
        "id": certificate_id(cert),
        "name": name,
        "organization": organization,
        "type": _type_of(cert),
        "expires": cert.not_valid_after_utc.strftime("%Y-%m-%d"),
    }


def _key_label(cert: x509.Certificate) -> str:
    key = cert.public_key()
    if isinstance(key, ec.EllipticCurvePublicKey):
        return f"EC {_CURVES.get(key.curve.name, key.curve.name)}"
    if isinstance(key, rsa.RSAPublicKey):
        return f"RSA {key.key_size}"
    if isinstance(key, dsa.DSAPublicKey):
        return f"DSA {key.key_size}"
    return next(label for kind, label in _FIXED_KEYS if isinstance(key, kind))


def _serial_text(serial: int) -> str:
    magnitude = abs(serial)
    text = _colon_hex(magnitude.to_bytes(max(1, (magnitude.bit_length() + 7) // 8), "big"))
    return f"-{text}" if serial < 0 else text


def _key_usage(cert: x509.Certificate) -> list[str]:
    usage = _extension(cert, x509.KeyUsage)
    if usage is None:
        return []
    names = [label for attribute, label in _KEY_USAGES if getattr(usage, attribute)]
    if usage.key_agreement:
        names += [label for attribute, label in _KEY_AGREEMENT_USAGES if getattr(usage, attribute)]
    return names


def _key_ids(cert: x509.Certificate) -> tuple[str | None, str | None]:
    subject_id = _extension(cert, x509.SubjectKeyIdentifier)
    authority_id = _extension(cert, x509.AuthorityKeyIdentifier)
    authority_key = authority_id.key_identifier if authority_id is not None else None
    return (
        _colon_hex(subject_id.digest) if subject_id is not None else None,
        _colon_hex(authority_key) if authority_key is not None else None,
    )


def _status(days_to_expiry: int) -> str:
    if days_to_expiry < 0:
        return "expired"
    return "expiring" if days_to_expiry <= EXPIRING_DAYS else "valid"


def detail_of(cert: x509.Certificate, now: datetime.datetime) -> dict[str, Any]:
    """Every field the certificate dialog shows, with its status at ``now``."""
    row = row_of(cert)
    not_after = cert.not_valid_after_utc
    days_to_expiry = (not_after - now).days
    constraints = _extension(cert, x509.BasicConstraints)
    subject_key_id, authority_key_id = _key_ids(cert)
    return {
        "id": row["id"],
        "name": row["name"],
        "subject": _name_text(cert.subject),
        "issuer": _name_text(cert.issuer),
        "type": row["type"],
        "path_length": constraints.path_length if constraints is not None else None,
        "valid_from": cert.not_valid_before_utc.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "valid_to": not_after.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "status": _status(days_to_expiry),
        "days_to_expiry": days_to_expiry,
        "sha256_fingerprint": _colon_hex(cert.fingerprint(hashes.SHA256())),
        "serial_number": _serial_text(cert.serial_number),
        "key": _key_label(cert),
        "signature_algorithm": _SIGNATURES.get(
            cert.signature_algorithm_oid, cert.signature_algorithm_oid.dotted_string
        ),
        "key_usage": _key_usage(cert),
        "subject_key_id": subject_key_id,
        "authority_key_id": authority_key_id,
        "pem": pem_of(cert),
    }
