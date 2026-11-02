#!/usr/bin/env bash
# Generate the k8s-stub PKI: a dedicated CA and the TLS serving keypair.
# TEST-ONLY material, 100-year validity so the checked-in files never rot.
#
# Usage: ./generate-certs.sh
# Output: ca.crt, ca.key, server.crt, server.key

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Dedicated CA, created only when absent (a leaf regen keeps the pinned anchor).
if [ ! -f ca.crt ] || [ ! -f ca.key ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt \
    -days 36500 -subj "/CN=wave-k8s-stub-ca" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign"
fi

# 2. Serving keypair. SAN covers host, slirp gateway and the compose DNS name.
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/CN=k8s-stub/O=WAVE Test"
cat > server-ext.cnf <<'EXT'
[v3_req]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:10.0.2.2,DNS:k8s-stub
EXT
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 36500 -extfile server-ext.cnf -extensions v3_req

# 3. Clean up intermediates.
rm -f server.csr server-ext.cnf ca.srl

echo "k8s-stub PKI generated:"
ls -la ca.crt ca.key server.crt server.key
