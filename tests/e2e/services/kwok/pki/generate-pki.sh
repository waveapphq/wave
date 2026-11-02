#!/usr/bin/env bash
# Generate the kwok stack PKI: a dedicated CA, the apiserver serving/admin
# keypair, and the cert-auth client identity. TEST-ONLY material, 100-year
# validity so the checked-in files never rot.
#
# Usage: ./generate-pki.sh
# Output: ca.crt, ca.key, server.crt, server.key, client.crt, client.key

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Dedicated CA (kwok components + test clients all chain to it).
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt \
  -days 36500 -subj "/CN=wave-kwok-ca" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign"

# 2. Server keypair: replaces kwok's generated admin.crt/admin.key, so it is
#    the apiserver serving cert AND the kubeconfig admin identity AND the SA
#    signing key. SAN covers host, slirp gateway, and both compose DNS names.
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/O=system:masters/CN=kwok-admin"
cat > server-ext.cnf <<'EXT'
[v3_req]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:10.0.2.2,DNS:kwok,DNS:kwok-internal
EXT
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 36500 -extfile server-ext.cnf -extensions v3_req

# 3. Client identity for the cert-auth leg (system:masters bypasses RBAC).
openssl req -newkey rsa:2048 -nodes -keyout client.key -out client.csr \
  -subj "/O=system:masters/CN=wave-cert-user"
cat > client-ext.cnf <<'EXT'
[v3_req]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
EXT
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key \
  -out client.crt -days 36500 -extfile client-ext.cnf -extensions v3_req

# 4. Clean up intermediates.
rm -f server.csr client.csr server-ext.cnf client-ext.cnf ca.srl

echo "kwok PKI generated:"
ls -la ca.crt ca.key server.crt server.key client.crt client.key
