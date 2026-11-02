#!/usr/bin/env bash
# Generate the database server leaf the postgres, mariadb and mssql E2E services
# serve, signed by the EXISTING WAVE Test CA (tests/e2e/simulators/https/certs).
# TEST-ONLY material. Leaves the tls-lab leaf and client identity untouched.
#
# Usage: ./generate-database-cert.sh
# Output: database.key, database.crt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
CA_DIR="$(cd "$SCRIPT_DIR/../../../simulators/https/certs" && pwd)"

# SAN covers host, slirp gateway, and every database's compose DNS name, so the
# direct, tunnel (far-host server name) and remote-host legs all verify.
openssl req -newkey rsa:2048 -nodes \
  -keyout database.key -out database.csr \
  -subj "/CN=wave-e2e-database/O=WAVE Test"
cat > database-ext.cnf <<EXT
[v3_req]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:10.0.2.2,DNS:postgres,DNS:mariadb,DNS:mssql
EXT
openssl x509 -req -in database.csr \
  -CA "$CA_DIR/ca.pem" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -out database.crt -days 3650 \
  -extfile database-ext.cnf -extensions v3_req

# Never leave ca.srl next to the pinned CA.
rm -f database.csr database-ext.cnf "$CA_DIR/ca.srl"

echo "database server certificate generated:"
ls -la database.key database.crt
