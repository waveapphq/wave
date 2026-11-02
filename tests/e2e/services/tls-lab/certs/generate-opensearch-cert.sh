#!/usr/bin/env bash
# Generate the OpenSearch node leaf (HTTP and transport) the opensearch E2E
# service serves, signed by the EXISTING WAVE Test CA
# (tests/e2e/simulators/https/certs). TEST-ONLY material.
#
# Usage: ./generate-opensearch-cert.sh
# Output: opensearch.key, opensearch.crt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
CA_DIR="$(cd "$SCRIPT_DIR/../../../simulators/https/certs" && pwd)"

# Subject written O first so its RFC 2253 form reads CN=wave-e2e-opensearch,O=WAVE Test (nodes_dn).
openssl req -newkey rsa:2048 -nodes \
  -keyout opensearch.key -out opensearch.csr \
  -subj "/O=WAVE Test/CN=wave-e2e-opensearch"
# SAN covers host, slirp gateway and the compose DNS name; the container name
# wave-e2e-opensearch is left out on purpose (far-name negative).
cat > opensearch-ext.cnf <<EXT
[v3_req]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:10.0.2.2,DNS:opensearch
EXT
openssl x509 -req -in opensearch.csr \
  -CA "$CA_DIR/ca.pem" -CAkey "$CA_DIR/ca.key" -set_serial "0x$(openssl rand -hex 16)" \
  -out opensearch.crt -days 3650 \
  -extfile opensearch-ext.cnf -extensions v3_req

rm -f opensearch.csr opensearch-ext.cnf

echo "opensearch node certificate generated:"
ls -la opensearch.key opensearch.crt
