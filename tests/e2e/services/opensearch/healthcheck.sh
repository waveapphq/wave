#!/bin/sh
# Healthy only once the wave login answers 200 over verified TLS (the bootstrap window answers 503).
exec curl -sf --cacert /usr/share/opensearch/config/certs/ca.pem -u wave:os-secret \
  https://localhost:9200/_plugins/_security/authinfo -o /dev/null
