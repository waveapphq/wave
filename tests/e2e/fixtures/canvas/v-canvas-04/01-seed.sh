#!/bin/bash
# Seed data for V-CANVAS-04 execution state visualization tests
#
# This script seeds:
# 1. Test environments for execution
# 2. A test with a simple Log workflow that can be executed
#
# Test ID: ac04e000-0001-0001-0001-000000000001 (deterministic for test navigation)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data
_reset_all

# Create environments (using valid UUIDs with hex-only characters)
echo "Creating environments..."
_add_environment "ac04e001-0001-0001-0001-000000000001" "Development" "Development environment for testing"
_add_environment "ac04e002-0002-0002-0002-000000000002" "Staging" "Staging environment for testing"
_add_environment "ac04e003-0003-0003-0003-000000000003" "Production" "Production environment for testing"

# Create a test with a simple Log workflow
# The workflow has: Start -> Log -> End
# IMPORTANT: Node type must be "workflowNode" (not "plugin") to be recognized by the execution engine
# The data.nodeType and data.elementType specify the block details
echo "Creating test with Log workflow..."

TEST_ID="ac04e000-0001-0001-0001-000000000001"
TIMESTAMP="$(_ts)"

# Create the test using bulk API
# Frontend node structure:
# - type: "workflowNode" (only valid stored type)
# - data.nodeType: "plugin" | "control" (WAVE block category)
# - data.elementType: "log" | "delay" | etc (specific block type)
# - data.label: display name
# - data.version: block version
_bulk tests "[{
  \"op\": \"add\",
  \"entity\": {
    \"id\": \"$TEST_ID\",
    \"name\": \"Execution Test Workflow\",
    \"version\": \"1.0.0\",
    \"description\": \"A simple workflow for testing execution states\",
    \"workflow\": {
      \"nodes\": [
        {
          \"id\": \"log-node-1\",
          \"type\": \"workflowNode\",
          \"position\": {\"x\": 400, \"y\": 150},
          \"data\": {
            \"label\": \"Log Step\",
            \"elementType\": \"log\",
            \"nodeType\": \"plugin\",
            \"category\": \"core\",
            \"version\": \"1.0.0\",
            \"config\": {
              \"values\": {
                \"message\": \"Hello from test\"
              }
            }
          }
        }
      ],
      \"edges\": [
        {\"source\": \"start-node\", \"target\": \"log-node-1\"}
      ]
    },
    \"variables\": {},
    \"metadata\": {},
    \"created_at\": \"$TIMESTAMP\",
    \"updated_at\": \"$TIMESTAMP\"
  }
}]"

echo "V-CANVAS-04: Seeded environments and test workflow"
echo "  Test ID: $TEST_ID"
echo "  Test Name: Execution Test Workflow"
echo "  Environments: Development, Staging, Production"
