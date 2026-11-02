#!/bin/bash
# Seed data for V-PLUGIN-HTTP-02: Profile Binding E2E Execution Test
#
# Seeds:
# - 1 environment ("Local Dev")
# - 1 custom profile ("My Server") with environment_values containing url
# - 1 test ("Profile Binding Test") with HTTP Client node linked to start
#
# The test workflow has an HTTP Client node but NO profile bindings or
# configured url - the Playwright test will bind the custom profile and set the
# expression via UI, then run the test.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data
_reset_all

# --- Environment ---
ENV_ID="ab020001-0001-0001-0001-000000000001"
_add_environment "$ENV_ID" "Local Dev" "Local development environment"

# --- Custom Profile with per-environment url value ---
PROFILE_ID="ab020002-0002-0002-0002-000000000002"
_add_profile "$PROFILE_ID" "My Server" "custom" \
    "Custom server profile for testing" \
    '["server"]' \
    '{}' \
    "{\"$ENV_ID\":{\"url\":\"http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}/health\"}}"

# --- Test with HTTP Client node ---
TEST_ID="ab020003-0003-0003-0003-000000000003"
TIMESTAMP="$(_ts)"

_bulk tests "[{
  \"op\": \"add\",
  \"entity\": {
    \"id\": \"$TEST_ID\",
    \"name\": \"Profile Binding Test\",
    \"version\": \"1\",
    \"workflow\": {
      \"nodes\": [
        {
          \"id\": \"http-node-1\",
          \"type\": \"workflowNode\",
          \"position\": { \"x\": 300, \"y\": 0 },
          \"data\": {
            \"label\": \"HTTP Client\",
            \"elementType\": \"http-client\",
            \"nodeType\": \"plugin\",
            \"category\": \"network\",
            \"version\": \"1.0.0\",
            \"config\": {
              \"values\": {
                \"method\": \"GET\",
                \"url\": \"http://localhost:8000/health\"
              },
              \"outputBindings\": {},
              \"profileBindings\": []
            }
          }
        }
      ],
      \"edges\": [
        {\"source\": \"start-node\", \"target\": \"http-node-1\"}
      ]
    },
    \"variables\": {},
    \"metadata\": {},
    \"created_at\": \"$TIMESTAMP\",
    \"updated_at\": \"$TIMESTAMP\"
  }
}]"

echo "V-PLUGIN-HTTP-02 seeded:"
echo "  Environment: $ENV_ID (Local Dev)"
echo "  Profile: $PROFILE_ID (My Server, custom, url in env_values for $ENV_ID)"
echo "  Test: $TEST_ID (Profile Binding Test)"
