#!/usr/bin/env bash
# Generate self-signed CA + server certificates for HTTPS simulator testing.
# These are TEST-ONLY certs - never use for production.
#
# Usage: ./generate-certs.sh
# Output: ca.key, ca.pem, server.key, server.crt (in current directory)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Generate the CA only when absent (leaf-only regen keeps the pinned trust anchor)
if [ ! -f ca.pem ] || [ ! -f ca.key ]; then
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout ca.key -out ca.pem \
    -days 3650 -subj "/CN=WAVE Test CA/O=WAVE Test"
fi

# 2. Generate server private key and CSR
openssl req -newkey rsa:2048 -nodes \
  -keyout server.key -out server.csr \
  -subj "/CN=localhost/O=WAVE Test"

# 3. Create extensions file for SAN (Subject Alternative Names)
# 10.0.2.2 = slirp gateway (container-shard mode); http-target/http-echo = compose DNS.
cat > server-ext.cnf <<EOF
[v3_req]
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:10.0.2.2,DNS:http-target,DNS:http-echo
EOF

# 4. Sign server cert with our CA
openssl x509 -req -in server.csr \
  -CA ca.pem -CAkey ca.key -CAcreateserial \
  -out server.crt -days 3650 \
  -extfile server-ext.cnf -extensions v3_req

# 5. Clean up intermediate files
rm -f server.csr server-ext.cnf ca.srl

echo "Certificates generated successfully:"
ls -la ca.key ca.pem server.key server.crt
