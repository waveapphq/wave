#!/usr/bin/env bash
# Generate the tls-lab server leaf + client certs, signed by the EXISTING
# WAVE Test CA (tests/e2e/simulators/https/certs). TEST-ONLY material.
#
# Usage: ./generate-certs.sh
# Output: server.key, server.crt, client.key, client.crt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
CA_DIR="$(cd "$SCRIPT_DIR/../../../simulators/https/certs" && pwd)"

# 1. Server leaf: SAN covers host, slirp gateway, and compose DNS.
openssl req -newkey rsa:2048 -nodes \
  -keyout server.key -out server.csr \
  -subj "/CN=tls-lab/O=WAVE Test"
cat > server-ext.cnf <<EOF
[v3_req]
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:10.0.2.2,DNS:tls-lab
EOF
openssl x509 -req -in server.csr \
  -CA "$CA_DIR/ca.pem" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -out server.crt -days 3650 \
  -extfile server-ext.cnf -extensions v3_req

# 2. Client identity for the mTLS listener (same CA).
openssl req -newkey rsa:2048 -nodes \
  -keyout client.key -out client.csr \
  -subj "/CN=wave-e2e-client/O=WAVE Test"
openssl x509 -req -in client.csr \
  -CA "$CA_DIR/ca.pem" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -out client.crt -days 3650

# 3. Clean up intermediates; never leave ca.srl next to the pinned CA.
rm -f server.csr client.csr server-ext.cnf "$CA_DIR/ca.srl"

echo "tls-lab certificates generated:"
ls -la server.key server.crt client.key client.crt
