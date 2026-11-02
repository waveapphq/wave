#!/bin/bash
# The example config plus a throwaway secret key; a KEY_FILE keeps one key for a data folder that outlives the run.

set -euo pipefail

EXAMPLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backend/config/config.example.yaml"
EMPTY_KEY_LINE='  secret_key: ""'

config_file="${1:?usage: e2e-config-with-key.sh CONFIG_FILE [KEY_FILE]}"
key_file="${2:-}"

fail() {
  echo "e2e-config-with-key.sh: $*" >&2
  exit 1
}

new_key() {
  head -c 32 /dev/urandom | base64 | tr -d '\n'
}

matches="$(grep -cxF -- "$EMPTY_KEY_LINE" "$EXAMPLE" || true)"
[ "$matches" = "1" ] ||
  fail "expected exactly one line '${EMPTY_KEY_LINE}' in ${EXAMPLE}, found ${matches:-none}"

if [ -z "$key_file" ]; then
  key="$(new_key)"
else
  if [ ! -s "$key_file" ]; then
    (umask 077 && new_key > "$key_file")
  fi
  key="$(cat "$key_file")"
fi
[[ "$key" =~ ^[A-Za-z0-9+/]{43}=$ ]] ||
  fail "the key${key_file:+ in ${key_file}} is not 32 bytes of base64"

awk -v empty="$EMPTY_KEY_LINE" -v key="$key" \
  '$0 == empty { print "  secret_key: \"" key "\""; next } { print }' \
  "$EXAMPLE" > "$config_file"
