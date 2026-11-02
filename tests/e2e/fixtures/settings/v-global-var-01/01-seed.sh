#!/bin/bash
# V-GLOBAL-VAR-01: Seeds settings page with system variables
# Creates a mix of variable types to test the Global Variables tab
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset_all

# Seed system variables with mixed types
_set_system_variables '{
  "api_url": {"type": "string", "value": "https://api.example.com"},
  "timeout_seconds": {"type": "integer", "value": 30},
  "retry_enabled": {"type": "boolean", "value": true},
  "rate_limit": {"type": "float", "value": 1.5},
  "api_key": {"type": "string", "value": "sk-test-12345", "secret": true}
}'

echo "V-GLOBAL-VAR-01 seeded: 5 system variables (string, integer, boolean, float, secret)"
