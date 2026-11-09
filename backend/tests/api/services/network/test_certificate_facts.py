"""Certificate facts behind Settings > Network > Certificates (REQ-4.5.16, NET-7, NET-8, NET-9).

Rows and the certificate dialog's detail are read from generated material: an RSA 2048 root
and an EC P-256 intermediate with fixed serials, key identifiers and validity, plus a leaf.
"""

import datetime
import re
from dataclasses import dataclass

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import dsa, ec, ed25519, rsa
from cryptography.x509.oid import NameOID

from wavecore.api.services.network import certificate_facts
from wavecore.api.services.network.certificate_facts import ParseError

PrivateKey = rsa.RSAPrivateKey | ec.EllipticCurvePrivateKey | ed25519.Ed25519PrivateKey

UTC = datetime.UTC
NOT_BEFORE = datetime.datetime(2025, 7, 1, tzinfo=UTC)
ROOT_NOT_AFTER = datetime.datetime(2036, 6, 30, 23, 59, 59, tzinfo=UTC)
ISSUING_NOT_AFTER = datetime.datetime(2028, 6, 30, 23, 59, 59, tzinfo=UTC)
NOW = datetime.datetime(2026, 10, 2, 12, 0, 0, tzinfo=UTC)

ROOT_SERIAL = 0x2B7E151628AED2A6ABF7158809CF4F3C
ISSUING_SERIAL = 0x4A1F0C937E225BD1086E3CF491A7205D
ROOT_SKI = bytes.fromhex("51B70E9C24F683AD1F6AC972E5380BD4974CA61E")
ISSUING_SKI = bytes.fromhex("8C215EF03A97D46B12C87FE3059AB1446D2EF8C3")

PRIVATE_KEY_MESSAGE = "The text contains a private key; paste certificates only"
NO_CERTIFICATE_MESSAGE = "No certificate found"
BAD_BLOCK = "-----BEGIN CERTIFICATE-----\nTm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----\n"

DETAIL_KEYS = {
    "id",
    "name",
    "subject",
    "issuer",
    "type",
    "path_length",
    "valid_from",
    "valid_to",
    "status",
    "days_to_expiry",
    "sha256_fingerprint",
    "serial_number",
    "key",
    "signature_algorithm",
    "key_usage",
    "subject_key_id",
    "authority_key_id",
    "pem",
}


@dataclass(frozen=True)
class _Pki:
    root: x509.Certificate
    root_key: rsa.RSAPrivateKey
    issuing: x509.Certificate
    issuing_key: ec.EllipticCurvePrivateKey
    leaf: x509.Certificate
    leaf_key: ec.EllipticCurvePrivateKey


def _name(
    *,
    common_name: str | None = None,
    organization: str | None = None,
    unit: str | None = None,
) -> x509.Name:
    """A subject in the usual DER order (C, O, OU, CN), so RFC 4514 reads CN first."""
    attributes = [x509.NameAttribute(NameOID.COUNTRY_NAME, "US")]
    if organization is not None:
        attributes.append(x509.NameAttribute(NameOID.ORGANIZATION_NAME, organization))
    if unit is not None:
        attributes.append(x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, unit))
    if common_name is not None:
        attributes.append(x509.NameAttribute(NameOID.COMMON_NAME, common_name))
    return x509.Name(attributes)


def _issue(
    subject: x509.Name,
    key: PrivateKey,
    *,
    issuer: tuple[x509.Name, PrivateKey] | None = None,
    ca: bool | None = True,
    path_length: int | None = None,
    key_usage: bool = True,
    ski: bytes | None = None,
    aki: bytes | None = None,
    serial: int = 0x1001,
    not_after: datetime.datetime = ROOT_NOT_AFTER,
    sig_hash: hashes.HashAlgorithm | None = None,
) -> x509.Certificate:
    """Issue a certificate; self-signed without an issuer, no basicConstraints when ca is None."""
    issuer_name, signing_key = issuer if issuer is not None else (subject, key)
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer_name)
        .public_key(key.public_key())
        .serial_number(serial)
        .not_valid_before(NOT_BEFORE)
        .not_valid_after(not_after)
    )
    if ca is not None:
        builder = builder.add_extension(
            x509.BasicConstraints(ca=ca, path_length=path_length if ca else None), critical=True
        )
    if key_usage:
        builder = builder.add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
    if ski is not None:
        builder = builder.add_extension(x509.SubjectKeyIdentifier(ski), critical=False)
    if aki is not None:
        builder = builder.add_extension(
            x509.AuthorityKeyIdentifier(
                key_identifier=aki, authority_cert_issuer=None, authority_cert_serial_number=None
            ),
            critical=False,
        )
    if isinstance(signing_key, ed25519.Ed25519PrivateKey):
        return builder.sign(signing_key, None)
    return builder.sign(signing_key, sig_hash or hashes.SHA256())


def _pem(cert: x509.Certificate) -> str:
    return cert.public_bytes(serialization.Encoding.PEM).decode()


def _der(cert: x509.Certificate) -> bytes:
    return cert.public_bytes(serialization.Encoding.DER)


def _colon_hex(data: bytes) -> str:
    return ":".join(f"{byte:02X}" for byte in data)


def _sha256_id(cert: x509.Certificate) -> str:
    return cert.fingerprint(hashes.SHA256()).hex()


def _ec_ca(
    subject: x509.Name, *, ca: bool | None = True, key_usage: bool = True
) -> x509.Certificate:
    key = ec.generate_private_key(ec.SECP256R1())
    return _issue(subject, key, ca=ca, key_usage=key_usage)


@pytest.fixture(scope="module")
def pki() -> _Pki:
    root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    root = _issue(
        _name(common_name="Corp Root CA 2031", organization="Corp Example Inc."),
        root_key,
        serial=ROOT_SERIAL,
        ski=ROOT_SKI,
    )
    issuing_key = ec.generate_private_key(ec.SECP256R1())
    issuing = _issue(
        _name(common_name="Corp Issuing CA 2", organization="Corp Example Inc."),
        issuing_key,
        issuer=(root.subject, root_key),
        path_length=0,
        ski=ISSUING_SKI,
        aki=ROOT_SKI,
        serial=ISSUING_SERIAL,
        not_after=ISSUING_NOT_AFTER,
        sig_hash=hashes.SHA384(),
    )
    leaf_key = ec.generate_private_key(ec.SECP256R1())
    leaf = _issue(
        _name(common_name="api.corp.example", organization="Corp Example Inc."),
        leaf_key,
        issuer=(issuing.subject, issuing_key),
        ca=False,
        key_usage=False,
        not_after=ISSUING_NOT_AFTER,
    )
    return _Pki(root, root_key, issuing, issuing_key, leaf, leaf_key)


class TestRowOf:
    def test_root_row(self, pki: _Pki) -> None:
        assert certificate_facts.row_of(pki.root) == {
            "id": _sha256_id(pki.root),
            "name": "Corp Root CA 2031",
            "organization": "Corp Example Inc.",
            "type": "Root",
            "expires": "2036-06-30",
        }

    def test_intermediate_row(self, pki: _Pki) -> None:
        assert certificate_facts.row_of(pki.issuing) == {
            "id": _sha256_id(pki.issuing),
            "name": "Corp Issuing CA 2",
            "organization": "Corp Example Inc.",
            "type": "Intermediate",
            "expires": "2028-06-30",
        }

    def test_id_is_the_lowercase_sha256_hex_without_colons(self, pki: _Pki) -> None:
        row_id = certificate_facts.row_of(pki.root)["id"]

        assert re.fullmatch(r"[0-9a-f]{64}", row_id) is not None
        assert row_id == pki.root.fingerprint(hashes.SHA256()).hex()

    def test_name_falls_back_to_the_organization(self) -> None:
        cert = _ec_ca(_name(organization="Lab Authority Ltd."))

        row = certificate_facts.row_of(cert)

        assert row["name"] == "Lab Authority Ltd."
        assert row["organization"] == "Lab Authority Ltd."

    def test_name_falls_back_to_the_full_subject(self) -> None:
        cert = _ec_ca(_name(unit="Lab Unit"))

        row = certificate_facts.row_of(cert)

        assert row["name"] == "OU=Lab Unit, C=US"
        assert row["organization"] == ""


class TestDetailOf:
    def test_root_detail(self, pki: _Pki) -> None:
        assert certificate_facts.detail_of(pki.root, NOW) == {
            "id": _sha256_id(pki.root),
            "name": "Corp Root CA 2031",
            "subject": "CN=Corp Root CA 2031, O=Corp Example Inc., C=US",
            "issuer": "CN=Corp Root CA 2031, O=Corp Example Inc., C=US",
            "type": "Root",
            "path_length": None,
            "valid_from": "2025-07-01 00:00:00 UTC",
            "valid_to": "2036-06-30 23:59:59 UTC",
            "status": "valid",
            "days_to_expiry": 3559,
            "sha256_fingerprint": _colon_hex(pki.root.fingerprint(hashes.SHA256())),
            "serial_number": "2B:7E:15:16:28:AE:D2:A6:AB:F7:15:88:09:CF:4F:3C",
            "key": "RSA 2048",
            "signature_algorithm": "SHA-256 with RSA",
            "key_usage": ["Certificate sign", "CRL sign"],
            "subject_key_id": "51:B7:0E:9C:24:F6:83:AD:1F:6A:C9:72:E5:38:0B:D4:97:4C:A6:1E",
            "authority_key_id": None,
            "pem": _pem(pki.root),
        }

    def test_intermediate_detail(self, pki: _Pki) -> None:
        assert certificate_facts.detail_of(pki.issuing, NOW) == {
            "id": _sha256_id(pki.issuing),
            "name": "Corp Issuing CA 2",
            "subject": "CN=Corp Issuing CA 2, O=Corp Example Inc., C=US",
            "issuer": "CN=Corp Root CA 2031, O=Corp Example Inc., C=US",
            "type": "Intermediate",
            "path_length": 0,
            "valid_from": "2025-07-01 00:00:00 UTC",
            "valid_to": "2028-06-30 23:59:59 UTC",
            "status": "valid",
            "days_to_expiry": 637,
            "sha256_fingerprint": _colon_hex(pki.issuing.fingerprint(hashes.SHA256())),
            "serial_number": "4A:1F:0C:93:7E:22:5B:D1:08:6E:3C:F4:91:A7:20:5D",
            "key": "EC P-256",
            "signature_algorithm": "SHA-384 with RSA",
            "key_usage": ["Certificate sign", "CRL sign"],
            "subject_key_id": "8C:21:5E:F0:3A:97:D4:6B:12:C8:7F:E3:05:9A:B1:44:6D:2E:F8:C3",
            "authority_key_id": "51:B7:0E:9C:24:F6:83:AD:1F:6A:C9:72:E5:38:0B:D4:97:4C:A6:1E",
            "pem": _pem(pki.issuing),
        }

    def test_fingerprint_is_colon_separated_uppercase_hex(self, pki: _Pki) -> None:
        fingerprint = certificate_facts.detail_of(pki.root, NOW)["sha256_fingerprint"]

        assert re.fullmatch(r"(?:[0-9A-F]{2}:){31}[0-9A-F]{2}", fingerprint) is not None

    def test_an_ecdsa_signature_is_labeled_with_its_hash(self, pki: _Pki) -> None:
        assert certificate_facts.detail_of(pki.leaf, NOW)["signature_algorithm"] == (
            "SHA-256 with ECDSA"
        )

    def test_an_ec_p384_key(self) -> None:
        cert = _issue(
            _name(common_name="P384 Root"),
            ec.generate_private_key(ec.SECP384R1()),
            sig_hash=hashes.SHA384(),
        )

        detail = certificate_facts.detail_of(cert, NOW)

        assert detail["key"] == "EC P-384"
        assert detail["signature_algorithm"] == "SHA-384 with ECDSA"

    def test_an_ed25519_key(self) -> None:
        cert = _issue(_name(common_name="Edwards Root"), ed25519.Ed25519PrivateKey.generate())

        assert certificate_facts.detail_of(cert, NOW)["key"] == "Ed25519"

    def test_no_key_usage_and_no_key_identifiers(self) -> None:
        cert = _ec_ca(_name(common_name="Bare Root"), key_usage=False)

        detail = certificate_facts.detail_of(cert, NOW)

        assert detail["key_usage"] == []
        assert detail["subject_key_id"] is None
        assert detail["authority_key_id"] is None

    def test_detail_carries_every_field(self, pki: _Pki) -> None:
        assert set(certificate_facts.detail_of(pki.leaf, NOW)) == DETAIL_KEYS


class TestStatus:
    @pytest.mark.parametrize(
        ("now", "status", "days"),
        [
            (ISSUING_NOT_AFTER - datetime.timedelta(days=31), "valid", 31),
            (ISSUING_NOT_AFTER - datetime.timedelta(days=30), "expiring", 30),
            (ISSUING_NOT_AFTER - datetime.timedelta(days=1), "expiring", 1),
            (ISSUING_NOT_AFTER + datetime.timedelta(days=1), "expired", -1),
        ],
        ids=["31-days-left", "30-days-left", "1-day-left", "1-day-past"],
    )
    def test_status_and_days_to_expiry(
        self, pki: _Pki, now: datetime.datetime, status: str, days: int
    ) -> None:
        detail = certificate_facts.detail_of(pki.issuing, now)

        assert detail["status"] == status
        assert detail["days_to_expiry"] == days


def _key_pem(key: PrivateKey, form: str) -> str:
    plain = serialization.NoEncryption()
    formats: dict[str, tuple[serialization.PrivateFormat, serialization.KeySerializationEncryption]]
    formats = {
        "pkcs8": (serialization.PrivateFormat.PKCS8, plain),
        "traditional": (serialization.PrivateFormat.TraditionalOpenSSL, plain),
        "encrypted": (
            serialization.PrivateFormat.PKCS8,
            serialization.BestAvailableEncryption(b"lab-secret"),
        ),
        "openssh": (serialization.PrivateFormat.OpenSSH, plain),
    }
    private_format, encryption = formats[form]
    return key.private_bytes(serialization.Encoding.PEM, private_format, encryption).decode()


class TestParseText:
    @pytest.mark.parametrize("text", ["", "   \n\t\n"], ids=["empty", "whitespace"])
    def test_blank_text_yields_nothing(self, text: str) -> None:
        assert certificate_facts.parse_text(text) == ([], [])

    def test_ca_certificates_in_text_order(self, pki: _Pki) -> None:
        text = _pem(pki.root) + _pem(pki.issuing)

        assert certificate_facts.parse_text(text) == ([pki.root, pki.issuing], [])

    def test_text_around_the_blocks_is_ignored(self, pki: _Pki) -> None:
        text = (
            "# Issuer: CN=Corp Root CA 2031\n"
            + _pem(pki.root)
            + "\n# Label: Corp Issuing CA 2\n"
            + _pem(pki.issuing)
        )

        assert certificate_facts.parse_text(text) == ([pki.root, pki.issuing], [])

    @pytest.mark.parametrize(
        ("signer", "form"),
        [
            ("issuing", "pkcs8"),
            ("issuing", "traditional"),
            ("root", "traditional"),
            ("issuing", "encrypted"),
            ("issuing", "openssh"),
        ],
        ids=["pkcs8", "ec-traditional", "rsa-traditional", "encrypted", "openssh"],
    )
    def test_a_private_key_refuses_the_whole_text(self, pki: _Pki, signer: str, form: str) -> None:
        key = pki.issuing_key if signer == "issuing" else pki.root_key
        text = _pem(pki.root) + _key_pem(key, form) + _pem(pki.issuing)

        assert certificate_facts.parse_text(text) == (
            [],
            [ParseError(index=None, message=PRIVATE_KEY_MESSAGE)],
        )

    def test_a_private_key_alone(self, pki: _Pki) -> None:
        assert certificate_facts.parse_text(_key_pem(pki.issuing_key, "pkcs8")) == (
            [],
            [ParseError(index=None, message=PRIVATE_KEY_MESSAGE)],
        )

    def test_text_without_a_certificate_block(self) -> None:
        assert certificate_facts.parse_text("not a certificate at all") == (
            [],
            [ParseError(index=None, message=NO_CERTIFICATE_MESSAGE)],
        )

    def test_a_public_key_block_is_not_a_certificate(self, pki: _Pki) -> None:
        public_pem = (
            pki.issuing_key.public_key()
            .public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
            .decode()
        )

        assert certificate_facts.parse_text(public_pem) == (
            [],
            [ParseError(index=None, message=NO_CERTIFICATE_MESSAGE)],
        )

    def test_a_block_that_does_not_parse_is_numbered(self, pki: _Pki) -> None:
        certificates, errors = certificate_facts.parse_text(_pem(pki.root) + BAD_BLOCK)

        assert certificates == [pki.root]
        assert errors == [ParseError(index=2, message="Certificate 2: not a valid certificate")]

    def test_a_leaf_is_not_a_ca_certificate(self, pki: _Pki) -> None:
        certificates, errors = certificate_facts.parse_text(_pem(pki.leaf) + _pem(pki.root))

        assert certificates == [pki.root]
        assert errors == [ParseError(index=1, message="Certificate 1: not a CA certificate")]

    def test_a_certificate_without_basic_constraints_is_not_a_ca_certificate(self) -> None:
        cert = _ec_ca(_name(common_name="Legacy Root"), ca=None)

        assert certificate_facts.parse_text(_pem(cert)) == (
            [],
            [ParseError(index=1, message="Certificate 1: not a CA certificate")],
        )

    def test_numbering_counts_the_blocks_that_fail(self, pki: _Pki) -> None:
        text = BAD_BLOCK + _pem(pki.leaf) + _pem(pki.root)

        certificates, errors = certificate_facts.parse_text(text)

        assert certificates == [pki.root]
        assert errors == [
            ParseError(index=1, message="Certificate 1: not a valid certificate"),
            ParseError(index=2, message="Certificate 2: not a CA certificate"),
        ]

    def test_parse_error_fields(self) -> None:
        error = ParseError(index=3, message="Certificate 3: not a CA certificate")

        assert error.index == 3
        assert error.message == "Certificate 3: not a CA certificate"


class TestPemBlocks:
    def test_blocks_in_text_order_without_the_text_around_them(self, pki: _Pki) -> None:
        text = (
            "# Issuer: CN=Corp Root CA 2031\n" + _pem(pki.root) + "\n# Label\n" + _pem(pki.issuing)
        )

        assert certificate_facts.pem_blocks(text) == [
            _pem(pki.root).strip(),
            _pem(pki.issuing).strip(),
        ]

    def test_text_without_a_block_has_none(self) -> None:
        assert certificate_facts.pem_blocks("# no certificate here\n") == []


class TestParseFile:
    def test_a_der_file_yields_one_certificate(self, pki: _Pki) -> None:
        assert certificate_facts.parse_file("root.cer", _der(pki.root)) == ([pki.root], [])

    def test_a_pem_file_with_two_certificates_yields_two(self, pki: _Pki) -> None:
        data = (_pem(pki.root) + _pem(pki.issuing)).encode()

        assert certificate_facts.parse_file("chain.pem", data) == ([pki.root, pki.issuing], [])

    def test_a_junk_file_is_named_in_the_message(self) -> None:
        assert certificate_facts.parse_file("leaf.bin", b"\x00\x01\x02 junk \xff\xfe") == (
            [],
            [ParseError(index=None, message="leaf.bin is not a PEM or DER certificate file")],
        )

    def test_a_text_file_without_pem_is_not_a_certificate_file(self) -> None:
        assert certificate_facts.parse_file("notes.txt", b"just some notes") == (
            [],
            [ParseError(index=None, message="notes.txt is not a PEM or DER certificate file")],
        )

    def test_a_der_leaf_is_not_a_ca_certificate(self, pki: _Pki) -> None:
        assert certificate_facts.parse_file("leaf.der", _der(pki.leaf)) == (
            [],
            [ParseError(index=1, message="Certificate 1: not a CA certificate")],
        )

    def test_a_pem_file_holding_a_private_key_is_refused(self, pki: _Pki) -> None:
        data = (_pem(pki.root) + _key_pem(pki.issuing_key, "pkcs8")).encode()

        assert certificate_facts.parse_file("bundle.pem", data) == (
            [],
            [ParseError(index=None, message=PRIVATE_KEY_MESSAGE)],
        )


def _self_signed(
    subject: x509.Name,
    key: dsa.DSAPrivateKey | ec.EllipticCurvePrivateKey,
    *extensions: x509.ExtensionType,
) -> x509.Certificate:
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(0x1001)
        .not_valid_before(NOT_BEFORE)
        .not_valid_after(ROOT_NOT_AFTER)
    )
    for extension in extensions:
        builder = builder.add_extension(extension, critical=False)
    return builder.sign(key, hashes.SHA256())


class TestDetailOfLessCommonCertificates:
    def test_a_dsa_key(self) -> None:
        cert = _self_signed(_name(common_name="DSA Root"), dsa.generate_private_key(1024))

        detail = certificate_facts.detail_of(cert, NOW)

        assert detail["key"] == "DSA 1024"
        assert detail["signature_algorithm"] == "SHA-256 with DSA"

    def test_key_agreement_usages_follow_key_agreement(self) -> None:
        usage = x509.KeyUsage(
            digital_signature=False,
            content_commitment=False,
            key_encipherment=False,
            data_encipherment=False,
            key_agreement=True,
            key_cert_sign=True,
            crl_sign=False,
            encipher_only=True,
            decipher_only=False,
        )
        cert = _self_signed(
            _name(common_name="Agreement Root"), ec.generate_private_key(ec.SECP256R1()), usage
        )

        assert certificate_facts.detail_of(cert, NOW)["key_usage"] == [
            "Key agreement",
            "Certificate sign",
            "Encipher only",
        ]

    def test_an_email_address_in_a_name_is_labeled(self) -> None:
        subject = x509.Name(
            [
                x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
                x509.NameAttribute(NameOID.COMMON_NAME, "Mail Root"),
                x509.NameAttribute(NameOID.EMAIL_ADDRESS, "ca@lab.example"),
            ]
        )
        cert = _self_signed(subject, ec.generate_private_key(ec.SECP256R1()))

        assert certificate_facts.detail_of(cert, NOW)["subject"] == (
            "emailAddress=ca@lab.example, CN=Mail Root, C=US"
        )
