#!/usr/bin/env bash
# Generate the V-NET-02 fixture CA certificates. TEST-ONLY material; the private
# keys stay in memory and are never written.
#
# Usage: ./generate-certs.sh
# Output: valid-ca.pem (2026-01-01 to 2046-01-01), expired-ca.pem (2020-01-01 to 2021-01-01)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../../../../../backend" && pwd)"

cd "$BACKEND_DIR"
FIXTURE_DIR="$SCRIPT_DIR" poetry run python - <<'PY'
import datetime
import os
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

OUT = Path(os.environ["FIXTURE_DIR"])


def ca(common_name: str, start: datetime.datetime, end: datetime.datetime, path_length: int | None) -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "WAVE E2E"),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        ]
    )
    public = key.public_key()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(public)
        .serial_number(x509.random_serial_number())
        .not_valid_before(start)
        .not_valid_after(end)
        .add_extension(x509.BasicConstraints(ca=True, path_length=path_length), critical=True)
        .add_extension(
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
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(public), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(public), critical=False)
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM).decode("ascii")


UTC = datetime.UTC
(OUT / "valid-ca.pem").write_text(
    ca("WAVE E2E Fixture CA", datetime.datetime(2026, 1, 1, tzinfo=UTC), datetime.datetime(2046, 1, 1, tzinfo=UTC), 1)
)
(OUT / "expired-ca.pem").write_text(
    ca("WAVE E2E Expired CA 2020", datetime.datetime(2020, 1, 1, tzinfo=UTC), datetime.datetime(2021, 1, 1, tzinfo=UTC), None)
)
PY

echo "V-NET-02 fixture certificates generated:"
ls -la "$SCRIPT_DIR"/valid-ca.pem "$SCRIPT_DIR"/expired-ca.pem
