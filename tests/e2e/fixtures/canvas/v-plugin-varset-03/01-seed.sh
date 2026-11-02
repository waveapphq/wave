#!/bin/bash
# Seed data for V-PLUGIN-VARSET-03 Variable Watcher live update tests
#
# This script seeds:
# 1. A test with a Variable Setter workflow node that changes variable values
# 2. Variables at test scope for watching
#
# The Variable Setter is pre-configured to change:
#   - watch_str: "" -> "updated by setter"
#   - watch_int: 0 -> 99
#
# Test ID: a0030e00-0001-0001-0001-000000000001 (deterministic for test navigation)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data
_reset_all

TEST_ID="a0030e00-0001-0001-0001-000000000001"
TIMESTAMP="$(_ts)"

# Create a test with:
# - A Variable Setter control pre-configured to change watch_str and watch_int
# - Variables at test scope that will be watched during execution
echo "Creating test with pre-configured Variable Setter..."

_bulk tests "[{
  \"op\": \"add\",
  \"entity\": {
    \"id\": \"$TEST_ID\",
    \"name\": \"Variable Watcher Live Update Test\",
    \"version\": \"1.0.0\",
    \"description\": \"Test workflow verifying Variable Watcher receives live updates from Variable Setter\",
    \"workflow\": {
      \"nodes\": [
        {
          \"id\": \"varset-node\",
          \"type\": \"workflowNode\",
          \"position\": {\"x\": 400, \"y\": 200},
          \"data\": {
            \"label\": \"Var Setter\",
            \"elementType\": \"variable-setter\",
            \"nodeType\": \"control\",
            \"category\": \"flow\",
            \"version\": \"1.0.0\",
            \"description\": \"Update Watched Vars\",
            \"hasNewerVersion\": false,
            \"expressionFields\": [],
            \"templateFields\": [],
            \"variableExpressionKeys\": [],
            \"config\": {
              \"values\": {
                \"variables\": {
                  \"watch_str\": \"updated by setter\",
                  \"watch_int\": 99
                }
              },
              \"outputBindings\": {},
              \"profileBindings\": []
            }
          }
        }
      ],
      \"edges\": [
        {\"source\": \"start-node\", \"target\": \"varset-node\"}
      ]
    },
    \"variables\": {
      \"watch_str\": {\"value\": \"original\", \"type\": \"string\", \"scope\": \"test\"},
      \"watch_int\": {\"value\": 0, \"type\": \"integer\", \"scope\": \"test\"}
    },
    \"metadata\": {},
    \"created_at\": \"$TIMESTAMP\",
    \"updated_at\": \"$TIMESTAMP\"
  }
}]"

# Create an environment for execution
ENV_ID="e0030e00-0001-0001-0001-000000000001"
_add_environment "$ENV_ID" "Test Env" "Environment for variable watcher test"

echo "V-PLUGIN-VARSET-03: Seeded test with pre-configured Variable Setter"
echo "  Test ID: $TEST_ID"
echo "  Variables: watch_str (string), watch_int (integer)"
echo "  Setter changes: watch_str -> 'updated by setter', watch_int -> 99"
