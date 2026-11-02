#!/bin/sh
# Generate the HS256 signing key and the fixed JWT the opensearch E2E service
# accepts (subject wave-jwt, role wave_e2e_read, no expiry). TEST-ONLY material.
# Keeps an existing key, so a re-run writes the same token byte for byte.
#
# Usage: ./generate-jwt.sh
# Output: wave-e2e.key, wave-e2e.jwt

set -eu

cd "$(dirname "$0")"
[ -f wave-e2e.key ] || openssl rand -base64 32 > wave-e2e.key

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

KEY_HEX=$(tr -d '\n' < wave-e2e.key | openssl base64 -d -A | od -An -tx1 | tr -d ' \n')
H=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
P=$(printf '%s' '{"sub":"wave-jwt","roles":["wave_e2e_read"],"iat":1790294400}' | b64url)
S=$(printf '%s' "$H.$P" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$KEY_HEX" -binary | b64url)
printf '%s.%s.%s\n' "$H" "$P" "$S" > wave-e2e.jwt

echo "opensearch JWT generated:"
ls -la wave-e2e.key wave-e2e.jwt
