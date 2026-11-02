#!/bin/bash
# Seed workflow data for VI-INT-03 tests
#
# This script seeds test workflows for connection testing:
# 1. Unconnected blocks (for creating new edges)
# 2. Connected pair (for duplicate/reverse edge testing)

set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Seed test with unconnected blocks
curl -s -X POST "${BACKEND_URL}/api/v1/tests" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-unconnected-blocks",
    "description": "Test workflow with unconnected blocks for edge creation",
    "workflow": {
      "nodes": [
        {
          "id": "node-1",
          "type": "workflowNode",
          "position": { "x": 200, "y": 100 },
          "data": {
            "label": "Source Block",
            "elementType": "http-client",
            "nodeType": "plugin",
            "category": "network",
            "version": "1.0.0",
            "config": { "values": {} }
          }
        },
        {
          "id": "node-2",
          "type": "workflowNode",
          "position": { "x": 200, "y": 300 },
          "data": {
            "label": "Target Block",
            "elementType": "sql-client",
            "nodeType": "plugin",
            "category": "database",
            "version": "1.0.0",
            "config": { "values": {} }
          }
        },
        {
          "id": "node-3",
          "type": "workflowNode",
          "position": { "x": 400, "y": 200 },
          "data": {
            "label": "Third Block",
            "elementType": "assert",
            "nodeType": "control",
            "category": "conditional",
            "version": "1.0.0",
            "config": { "values": {} }
          }
        }
      ],
      "edges": []
    }
  }' > /dev/null || echo "Note: API seeding may require backend to be running"

# Seed test with connected pair for duplicate testing
curl -s -X POST "${BACKEND_URL}/api/v1/tests" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-connected-pair",
    "description": "Test workflow with connected block pair",
    "workflow": {
      "nodes": [
        {
          "id": "node-a",
          "type": "workflowNode",
          "position": { "x": 200, "y": 100 },
          "data": {
            "label": "First Block",
            "elementType": "http-client",
            "nodeType": "plugin",
            "category": "network",
            "version": "1.0.0",
            "config": { "values": {} }
          }
        },
        {
          "id": "node-b",
          "type": "workflowNode",
          "position": { "x": 200, "y": 300 },
          "data": {
            "label": "Second Block",
            "elementType": "sql-client",
            "nodeType": "plugin",
            "category": "database",
            "version": "1.0.0",
            "config": { "values": {} }
          }
        }
      ],
      "edges": [
        { "id": "edge-a-b", "source": "node-a", "target": "node-b" }
      ]
    }
  }' > /dev/null || echo "Note: API seeding may require backend to be running"

echo "VI-INT-03: Seeded workflows for edge connection testing"
