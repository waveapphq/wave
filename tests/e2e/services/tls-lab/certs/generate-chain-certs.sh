#!/usr/bin/env bash
# Generate the tls-lab chain PKI: a root CA, an intermediate CA (pathlen 0)
# signed by the root, and a server leaf signed by the intermediate. Served on
# 9480 (leaf + intermediate) and 9481 (leaf only). TEST-ONLY material.
#
# Usage: ./generate-chain-certs.sh
# Output: chain-root.crt, chain-intermediate.crt, chain-leaf.crt,
#         chain-leaf.key, chain-leaf-fullchain.crt
# The CA keys live only in a scratch folder that is removed on exit, so every
# run reissues the whole chain.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

WORK="$(mktemp -d "$SCRIPT_DIR/.chain-work.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

CA_DAYS=7300
LEAF_DAYS=3700

cat > "$WORK/chain.cnf" <<EOF
[req]
distinguished_name = dn

[dn]

[root_ca]
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash

[intermediate_ca]
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always

[leaf]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, IP:127.0.0.1, IP:10.0.2.2, DNS:tls-lab
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF

# 1. Root CA, self-signed.
openssl req -x509 -newkey rsa:2048 -nodes -sha256 \
  -config "$WORK/chain.cnf" -extensions root_ca \
  -keyout "$WORK/root.key" -out chain-root.crt -days "$CA_DAYS" \
  -subj "/CN=WAVE E2E Chain Root CA/O=WAVE Test"

# 2. Intermediate CA, signed by the root; it may sign leaves only (pathlen 0).
openssl req -newkey rsa:2048 -nodes -sha256 \
  -config "$WORK/chain.cnf" \
  -keyout "$WORK/intermediate.key" -out "$WORK/intermediate.csr" \
  -subj "/CN=WAVE E2E Chain Intermediate CA/O=WAVE Test"
openssl x509 -req -sha256 -in "$WORK/intermediate.csr" \
  -CA chain-root.crt -CAkey "$WORK/root.key" \
  -CAserial "$WORK/root.srl" -CAcreateserial \
  -out chain-intermediate.crt -days "$CA_DAYS" \
  -extfile "$WORK/chain.cnf" -extensions intermediate_ca

# 3. Server leaf, signed by the intermediate. SAN covers host, slirp gateway and compose DNS.
openssl req -newkey rsa:2048 -nodes -sha256 \
  -config "$WORK/chain.cnf" \
  -keyout chain-leaf.key -out "$WORK/leaf.csr" \
  -subj "/CN=tls-lab/O=WAVE Test"
openssl x509 -req -sha256 -in "$WORK/leaf.csr" \
  -CA chain-intermediate.crt -CAkey "$WORK/intermediate.key" \
  -CAserial "$WORK/intermediate.srl" -CAcreateserial \
  -out chain-leaf.crt -days "$LEAF_DAYS" \
  -extfile "$WORK/chain.cnf" -extensions leaf

# 4. What 9480 sends: the leaf, then the intermediate.
cat chain-leaf.crt chain-intermediate.crt > chain-leaf-fullchain.crt

openssl verify -CAfile chain-root.crt -untrusted chain-intermediate.crt chain-leaf.crt

echo "tls-lab chain certificates generated:"
ls -la chain-root.crt chain-intermediate.crt chain-leaf.crt chain-leaf.key chain-leaf-fullchain.crt
