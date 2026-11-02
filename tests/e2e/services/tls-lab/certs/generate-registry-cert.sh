#!/usr/bin/env bash
# Generate the OCI registry leaf the oci-registry E2E service serves, signed by
# the EXISTING WAVE Test CA (tests/e2e/simulators/https/certs).
# TEST-ONLY material. Leaves every other lab leaf untouched.
#
# Usage: ./generate-registry-cert.sh
# Output: registry.key, registry.crt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
CA_DIR="$(cd "$SCRIPT_DIR/../../../simulators/https/certs" && pwd)"

# SAN covers host, slirp gateway and the compose DNS name, so the direct,
# container-shard and through-the-proxy legs all verify.
openssl req -newkey rsa:2048 -nodes \
  -keyout registry.key -out registry.csr \
  -subj "/CN=wave-e2e-oci-registry/O=WAVE Test"
cat > registry-ext.cnf <<EXT
[v3_req]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:10.0.2.2,DNS:oci-registry
EXT
openssl x509 -req -in registry.csr \
  -CA "$CA_DIR/ca.pem" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -out registry.crt -days 3650 \
  -extfile registry-ext.cnf -extensions v3_req

# Never leave ca.srl next to the pinned CA.
rm -f registry.csr registry-ext.cnf "$CA_DIR/ca.srl"

echo "registry server certificate generated:"
ls -la registry.key registry.crt
