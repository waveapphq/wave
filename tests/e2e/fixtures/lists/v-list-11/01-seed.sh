#!/bin/bash
# V-LIST-11: Seeds executions list with various statuses, types, and triggered_by values
# Creates 30 executions (>25 for pagination) with Running, Passed, Failed, and Stopped statuses
# Per wireframe: Name, Type, Triggered By, Started, Duration, Status, Actions
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

# Calculate a timestamp N minutes ago
_ts_ago() {
    local minutes=$1
    if date --version >/dev/null 2>&1; then
        # GNU date (Linux)
        date -u -d "$minutes minutes ago" +"%Y-%m-%dT%H:%M:%SZ"
    else
        # BSD date (macOS)
        date -u -v-"${minutes}M" +"%Y-%m-%dT%H:%M:%SZ"
    fi
}

# Add execution with all fields for V-LIST-11
# _add_full_exec <id> <name> <type> <status> <triggered_by> <started_minutes_ago> <duration_seconds> <entity_id>
_add_full_exec() {
    local id="$1"
    local name="$2"
    local entity_type="$3"
    local status="$4"
    local triggered_by="$5"
    local started_ago="$6"
    local duration="$7"
    local entity_id="$8"

    local started_at=$(_ts_ago "$started_ago")
    local completed=""
    local completed_at=""

    # Only add completed_at for non-running executions
    if [[ "$status" != "running" ]]; then
        # Calculate completed time based on started_at and duration
        local completed_ago=$((started_ago - (duration / 60)))
        if [[ $completed_ago -lt 0 ]]; then
            completed_ago=0
        fi
        completed_at=$(_ts_ago "$completed_ago")
        completed=",\"completed_at\":\"$completed_at\""
    fi

    curl -sf -X POST "${BACKEND_URL}/admin/bulk/executions" \
        -H "Content-Type: application/json" \
        -d "{\"operations\":[{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\",\"entity_type\":\"$entity_type\",\"entity_id\":\"$entity_id\",\"status\":\"$status\",\"triggered_by\":\"$triggered_by\",\"started_at\":\"$started_at\",\"duration\":$duration,\"progress\":100$completed}}]}" > /dev/null
}

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# UUIDs for entities (using predictable patterns for test reproducibility)
# Tests: a0a00000-0000-0000-0000-000000000001 through 00a
# Suites: b0b00000-0000-0000-0000-000000000001 through 005
# Regressions: c0c00000-0000-0000-0000-000000000001 through 003
# Executions: e0e00000-0000-0000-0000-000000000001 through 01e (30)

# Create tests first (required for entity references)
curl -sf -X POST "${BACKEND_URL}/admin/bulk/tests" \
    -H "Content-Type: application/json" \
    -d '{"operations":[
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-000000000001","name":"API Health Check","version":"1"}},
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-000000000002","name":"Database Migration","version":"1"}},
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-000000000003","name":"Payment Flow","version":"1"}},
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-000000000004","name":"User Management","version":"1"}},
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-000000000005","name":"File Upload Test","version":"1"}},
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-000000000006","name":"Cache Validation","version":"1"}},
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-000000000007","name":"Session Handling","version":"1"}},
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-000000000008","name":"Email Notification","version":"1"}},
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-000000000009","name":"Search Functionality","version":"1"}},
        {"op":"add","entity":{"id":"a0a00000-0000-0000-0000-00000000000a","name":"Report Generation","version":"1"}}
    ]}' > /dev/null

# Create suites
curl -sf -X POST "${BACKEND_URL}/admin/bulk/suites" \
    -H "Content-Type: application/json" \
    -d '{"operations":[
        {"op":"add","entity":{"id":"b0b00000-0000-0000-0000-000000000001","name":"Authentication Suite","version":"1"}},
        {"op":"add","entity":{"id":"b0b00000-0000-0000-0000-000000000002","name":"Core API Suite","version":"1"}},
        {"op":"add","entity":{"id":"b0b00000-0000-0000-0000-000000000003","name":"Integration Suite","version":"1"}},
        {"op":"add","entity":{"id":"b0b00000-0000-0000-0000-000000000004","name":"Performance Suite","version":"1"}},
        {"op":"add","entity":{"id":"b0b00000-0000-0000-0000-000000000005","name":"Security Suite","version":"1"}}
    ]}' > /dev/null

# Create regressions
curl -sf -X POST "${BACKEND_URL}/admin/bulk/regressions" \
    -H "Content-Type: application/json" \
    -d '{"operations":[
        {"op":"add","entity":{"id":"c0c00000-0000-0000-0000-000000000001","name":"WAVE 25.12","version":"1"}},
        {"op":"add","entity":{"id":"c0c00000-0000-0000-0000-000000000002","name":"Billing v2.1","version":"1"}},
        {"op":"add","entity":{"id":"c0c00000-0000-0000-0000-000000000003","name":"Release Candidate","version":"1"}}
    ]}' > /dev/null

# Create executions with various statuses, types, and triggered_by values
# Format: id, name, type, status, triggered_by, started_minutes_ago, duration_seconds, entity_id
# IMPORTANT: First 10 must include all 4 status types for V-LIST-11-S8 test (backend default sort is by ID)

# First 10 executions: include all 4 status types (3 running, 3 passed, 2 failed, 2 stopped)
_add_full_exec "e0e00000-0000-0000-0000-000000000001" "WAVE 25.12" "regression" "running" "CI Pipeline" 45 4320 "c0c00000-0000-0000-0000-000000000001"
_add_full_exec "e0e00000-0000-0000-0000-000000000002" "Integration Suite" "suite" "running" "Scheduled" 30 1800 "b0b00000-0000-0000-0000-000000000003"
_add_full_exec "e0e00000-0000-0000-0000-000000000003" "Performance Suite" "suite" "running" "Ashley" 15 900 "b0b00000-0000-0000-0000-000000000004"
_add_full_exec "e0e00000-0000-0000-0000-000000000004" "API Health Check" "test" "passed" "Will" 60 154 "a0a00000-0000-0000-0000-000000000001"
_add_full_exec "e0e00000-0000-0000-0000-000000000005" "Authentication Suite" "suite" "passed" "Ashley" 90 525 "b0b00000-0000-0000-0000-000000000001"
_add_full_exec "e0e00000-0000-0000-0000-000000000006" "Database Migration" "test" "passed" "Scheduled" 120 45 "a0a00000-0000-0000-0000-000000000002"
_add_full_exec "e0e00000-0000-0000-0000-000000000007" "Payment Flow" "test" "failed" "Will" 150 192 "a0a00000-0000-0000-0000-000000000003"
_add_full_exec "e0e00000-0000-0000-0000-000000000008" "Authentication Suite" "suite" "failed" "Ashley" 180 515 "b0b00000-0000-0000-0000-000000000001"
_add_full_exec "e0e00000-0000-0000-0000-000000000009" "Payment Flow Run 2" "test" "stopped" "Will" 210 192 "a0a00000-0000-0000-0000-000000000003"
_add_full_exec "e0e00000-0000-0000-0000-00000000000a" "Performance Suite" "suite" "stopped" "Scheduled" 240 423 "b0b00000-0000-0000-0000-000000000004"

# Remaining passed executions (12 more)
_add_full_exec "e0e00000-0000-0000-0000-00000000000b" "Core API Suite" "suite" "passed" "Edward" 270 922 "b0b00000-0000-0000-0000-000000000002"
_add_full_exec "e0e00000-0000-0000-0000-00000000000c" "User Management" "test" "passed" "Ashley" 300 68 "a0a00000-0000-0000-0000-000000000004"
_add_full_exec "e0e00000-0000-0000-0000-00000000000d" "Billing v2.1" "regression" "passed" "CI Pipeline" 330 2730 "c0c00000-0000-0000-0000-000000000002"
_add_full_exec "e0e00000-0000-0000-0000-00000000000e" "File Upload Test" "test" "passed" "Will" 360 175 "a0a00000-0000-0000-0000-000000000005"
_add_full_exec "e0e00000-0000-0000-0000-00000000000f" "Security Suite" "suite" "passed" "Scheduled" 390 645 "b0b00000-0000-0000-0000-000000000005"
_add_full_exec "e0e00000-0000-0000-0000-000000000010" "Cache Validation" "test" "passed" "Edward" 420 92 "a0a00000-0000-0000-0000-000000000006"
_add_full_exec "e0e00000-0000-0000-0000-000000000011" "Session Handling" "test" "passed" "Will" 450 38 "a0a00000-0000-0000-0000-000000000007"
_add_full_exec "e0e00000-0000-0000-0000-000000000012" "Release Candidate" "regression" "passed" "CI Pipeline" 480 3890 "c0c00000-0000-0000-0000-000000000003"
_add_full_exec "e0e00000-0000-0000-0000-000000000013" "Email Notification" "test" "passed" "Ashley" 510 156 "a0a00000-0000-0000-0000-000000000008"
_add_full_exec "e0e00000-0000-0000-0000-000000000014" "Authentication Suite" "suite" "passed" "Scheduled" 540 498 "b0b00000-0000-0000-0000-000000000001"
_add_full_exec "e0e00000-0000-0000-0000-000000000015" "Search Functionality" "test" "passed" "Will" 570 214 "a0a00000-0000-0000-0000-000000000009"
_add_full_exec "e0e00000-0000-0000-0000-000000000016" "Core API Suite" "suite" "passed" "Edward" 600 567 "b0b00000-0000-0000-0000-000000000002"

# Remaining failed executions (5 more)
_add_full_exec "e0e00000-0000-0000-0000-000000000017" "WAVE 25.12" "regression" "failed" "CI Pipeline" 630 4125 "c0c00000-0000-0000-0000-000000000001"
_add_full_exec "e0e00000-0000-0000-0000-000000000018" "Security Suite" "suite" "failed" "Scheduled" 660 387 "b0b00000-0000-0000-0000-000000000005"
_add_full_exec "e0e00000-0000-0000-0000-000000000019" "Report Generation" "test" "failed" "Edward" 690 145 "a0a00000-0000-0000-0000-00000000000a"
_add_full_exec "e0e00000-0000-0000-0000-00000000001a" "Integration Suite" "suite" "failed" "Ashley" 720 678 "b0b00000-0000-0000-0000-000000000003"
_add_full_exec "e0e00000-0000-0000-0000-00000000001b" "File Upload Test" "test" "failed" "Will" 750 89 "a0a00000-0000-0000-0000-000000000005"

# Remaining stopped executions (3 more)
_add_full_exec "e0e00000-0000-0000-0000-00000000001c" "Billing v2.1" "regression" "stopped" "CI Pipeline" 780 1856 "c0c00000-0000-0000-0000-000000000002"
_add_full_exec "e0e00000-0000-0000-0000-00000000001d" "Cache Validation" "test" "stopped" "Ashley" 810 54 "a0a00000-0000-0000-0000-000000000006"
_add_full_exec "e0e00000-0000-0000-0000-00000000001e" "Core API Suite" "suite" "stopped" "Edward" 840 312 "b0b00000-0000-0000-0000-000000000002"

echo "V-LIST-11 seeded: 30 executions (3 running, 15 passed, 7 failed, 5 stopped)"
echo "  - Types: 12 tests, 12 suites, 6 regressions"
echo "  - Triggered by: Will, Ashley, Edward, CI Pipeline, Scheduled"
