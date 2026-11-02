#!/bin/bash
# Seed data for V-PLUGIN-VARSET-02 functional tests
#
# This script seeds:
# 1. A test with a Variable Setter workflow node
# 2. Variables at suite, regression, and test scopes (for autocomplete and shadowing)
#
# Test ID: a0020e00-0001-0001-0001-000000000001 (deterministic for test navigation)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data
_reset_all

TEST_ID="a0020e00-0001-0001-0001-000000000001"
TIMESTAMP="$(_ts)"

# Create a test with:
# - A Variable Setter control node in the workflow
# - Variables at multiple scopes for autocomplete/shadowing testing
#
# Variable Setter is a control (nodeType: "control"), not a plugin.
# elementType: "variable-setter" matches the control definition ID.
#
# Variables at different scopes:
# - regression: reg_env (string), reg_debug (boolean)
# - suite: suite_timeout (integer), suite_retries (integer)
# - test: test_name (string), test_count (integer), test_ratio (float), init_var (string)
echo "Creating test with Variable Setter workflow..."

_bulk tests "[{
  \"op\": \"add\",
  \"entity\": {
    \"id\": \"$TEST_ID\",
    \"name\": \"Variable Setter Functional Test\",
    \"version\": \"1.0.0\",
    \"description\": \"Test workflow with a Variable Setter control and multi-scope variables\",
    \"workflow\": {
      \"nodes\": [
        {
          \"id\": \"varset-node-1\",
          \"type\": \"workflowNode\",
          \"position\": {\"x\": 400, \"y\": 200},
          \"data\": {
            \"label\": \"Set Variables\",
            \"elementType\": \"variable-setter\",
            \"nodeType\": \"control\",
            \"category\": \"flow\",
            \"version\": \"1.0.0\",
            \"config\": {
              \"values\": {
                \"variables\": {\"init_var\": \"hello\"}
              }
            }
          }
        }
      ],
      \"edges\": [
        {\"source\": \"start-node\", \"target\": \"varset-node-1\"}
      ]
    },
    \"variables\": {
      \"reg_env\": {\"value\": \"production\", \"type\": \"string\", \"scope\": \"regression\"},
      \"reg_debug\": {\"value\": false, \"type\": \"boolean\", \"scope\": \"regression\"},
      \"suite_timeout\": {\"value\": 30, \"type\": \"integer\", \"scope\": \"suite\"},
      \"suite_retries\": {\"value\": 3, \"type\": \"integer\", \"scope\": \"suite\"},
      \"test_name\": {\"value\": \"my test\", \"type\": \"string\", \"scope\": \"test\"},
      \"test_count\": {\"value\": 42, \"type\": \"integer\", \"scope\": \"test\"},
      \"test_ratio\": {\"value\": 3.14, \"type\": \"float\", \"scope\": \"test\"},
      \"init_var\": {\"value\": \"hello\", \"type\": \"string\", \"scope\": \"test\"}
    },
    \"metadata\": {},
    \"created_at\": \"$TIMESTAMP\",
    \"updated_at\": \"$TIMESTAMP\"
  }
}]"

echo "V-PLUGIN-VARSET-02: Seeded test with Variable Setter workflow"
echo "  Test ID: $TEST_ID"
echo "  Variables: 2 regression, 2 suite, 4 test scope"
