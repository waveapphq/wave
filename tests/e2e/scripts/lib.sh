#!/bin/bash
# Shared functions for E2E test scripts
# Source this: source "$(dirname "$0")/../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

# ============================================================================
# Namespace Support for Parallel Test Execution
# ============================================================================
# Set NS (namespace) before calling seed functions to prefix all IDs.
# This allows multiple test fixtures to coexist without conflicts.
#
# Example:
#   NS="vd02"  # v-dash-02 namespace
#   _add_test "test-1" "My Test"  # Creates: vd02-test-1
#
# Without NS set (or NS=""), IDs are used as-is (backward compatible).
# ============================================================================
NS="${NS:-}"

# Helper to apply namespace prefix to an ID
_ns_id() {
    local id="$1"
    if [[ -n "$NS" ]]; then
        echo "${NS}-${id}"
    else
        echo "$id"
    fi
}

# Generate a valid UUID v4
# Uses uuidgen if available, falls back to /proc/sys/kernel/random/uuid on Linux,
# or Python as last resort
_uuid() {
    if command -v uuidgen &> /dev/null; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    elif [[ -f /proc/sys/kernel/random/uuid ]]; then
        cat /proc/sys/kernel/random/uuid
    else
        python3 -c "import uuid; print(str(uuid.uuid4()))"
    fi
}

_admin_on() {
    curl -sf -X POST "${BACKEND_URL}/admin/enable" -H "Content-Type: application/json" \
        -d '{"reason": "E2E test"}' > /dev/null
}

_admin_off() {
    curl -sf -X POST "${BACKEND_URL}/admin/disable" > /dev/null 2>&1 || true
}

_reset() {
    curl -sf -X POST "${BACKEND_URL}/admin/reset" -H "Content-Type: application/json" \
        -d '{"confirm": true}' > /dev/null
}

# Reset everything including environments and profiles (for settings tests)
_reset_all() {
    curl -sf -X POST "${BACKEND_URL}/admin/reset" -H "Content-Type: application/json" \
        -d '{"confirm": true, "scope": ["entities", "blocks", "executions", "artifacts", "environments", "profiles"]}' > /dev/null
    # Also clear system variables (not part of admin reset scope)
    curl -sf -X DELETE "${BACKEND_URL}/variables/system" > /dev/null 2>&1 || true
    # Clear workbench session - a stale session pointing to an entity that
    # was just wiped by the reset above triggers the "Test not found" modal
    # on the next /workbench navigation, whose Radix overlay blocks clicks
    # in concurrent visual tests.
    curl -sf -X DELETE "${BACKEND_URL}/workbench/session" > /dev/null 2>&1 || true
}

# _set_system_variables <json_variables>
# Sets system variables via POST /variables/system
# Example: _set_system_variables '{"api_url": {"type": "string", "default": "https://api.example.com"}}'
_set_system_variables() {
    local variables="$1"
    curl -sf -X POST "${BACKEND_URL}/variables/system" \
        -H "Content-Type: application/json" \
        -d "{\"variables\": $variables}" > /dev/null
}

# _delete_system_variables
# Deletes all system variables
_delete_system_variables() {
    curl -sf -X DELETE "${BACKEND_URL}/variables/system" > /dev/null
}

_ts() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

_ts_old() {
    date -u -d "48 hours ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
    date -u -v-48H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || _ts
}

_bulk() {
    local endpoint="$1" ops="$2"
    curl -sf -X POST "${BACKEND_URL}/admin/bulk/${endpoint}" \
        -H "Content-Type: application/json" -d "{\"operations\": $ops}" > /dev/null
}

# _add_test <id> <name> [parent_suite_name] [tags_json_array] [status]
# If parent_suite_name is provided, test is assigned to that suite
# If tags_json_array is provided (e.g., '["api","health"]'), tags are added
# If status is provided (passed/failed/never_run), it sets the test status in metadata
# Note: ID is auto-prefixed with namespace (NS) if set
_add_test() {
    local id="$(_ns_id "$1")" name="$2" parent_suite="${3:-}" tags="${4:-}" status="${5:-}" ts="$(_ts)"
    local metadata_parts=()
    [[ -n "$parent_suite" ]] && metadata_parts+=("\"parent_suite\":\"$parent_suite\"")
    [[ -n "$tags" ]] && metadata_parts+=("\"tags\":$tags")
    [[ -n "$status" ]] && metadata_parts+=("\"status\":\"$status\",\"last_run\":\"$ts\"")
    local metadata="{}"
    if [[ ${#metadata_parts[@]} -gt 0 ]]; then
        local IFS=","
        metadata="{${metadata_parts[*]}}"
    fi
    _bulk tests "[{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\",\"version\":\"1.0.0\",\"created_at\":\"$ts\",\"updated_at\":\"$ts\",\"metadata\":$metadata}}]"
}

# _add_suite <id> <name> [parent_regression_name] [tests_json_array]
# parent_regression_name links the suite to a regression for test count computation
# tests_json_array is a JSON array of test UUIDs, e.g. '["uuid1","uuid2"]'
# Note: ID is auto-prefixed with namespace (NS) if set
# Note: test IDs in the tests array are NOT auto-prefixed - use full IDs
_add_suite() {
    local id="$(_ns_id "$1")" name="$2" parent_regression="${3:-}" tests="${4:-}" ts="$(_ts)"
    local metadata="{}"
    if [[ -n "$parent_regression" ]]; then
        metadata="{\"parent_regression\":\"$parent_regression\"}"
    fi
    local tests_json="[]"
    if [[ -n "$tests" ]]; then
        tests_json="$tests"
    fi
    _bulk suites "[{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\",\"version\":\"1.0.0\",\"created_at\":\"$ts\",\"updated_at\":\"$ts\",\"metadata\":$metadata,\"tests\":$tests_json}}]"
}

# _add_regression <id> <name>
# test_count is computed by summing suite.tests arrays from suites with matching parent_regression
# Note: ID is auto-prefixed with namespace (NS) if set
_add_regression() {
    local id="$(_ns_id "$1")" name="$2" ts="$(_ts)"
    _bulk regressions "[{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\",\"version\":\"1.0.0\",\"created_at\":\"$ts\",\"updated_at\":\"$ts\",\"metadata\":{}}}]"
}

# _add_exec <id> <entity_id> <status> <progress> [timestamp] [tests_total] [tests_selected] [entity_type]
# Note: Both id and entity_id are auto-prefixed with namespace (NS) if set
_add_exec() {
    local id="$(_ns_id "$1")" entity_id="$(_ns_id "$2")" status="$3" progress="$4"
    local ts="${5:-$(_ts)}"
    local tests_total="${6:-1}" tests_selected="${7:-1}" entity_type="${8:-test}"
    local completed=""
    [[ "$status" == "passed" || "$status" == "failed" ]] && completed=",\"completed_at\":\"$ts\""
    _bulk executions "[{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"entity_type\":\"$entity_type\",\"entity_id\":\"$entity_id\",\"status\":\"$status\",\"progress\":$progress,\"started_at\":\"$ts\",\"updated_at\":\"$ts\",\"tests_total\":$tests_total,\"tests_selected\":$tests_selected$completed}}]"
}

# _update_exec <id> <progress> <status>
# Note: ID is auto-prefixed with namespace (NS) if set
_update_exec() {
    local id="$(_ns_id "$1")" progress="$2" status="$3" ts="$(_ts)"
    local completed=""
    [[ "$status" == "passed" || "$status" == "failed" ]] && completed=",\"completed_at\":\"$ts\""
    _bulk executions "[{\"op\":\"modify\",\"entity\":{\"id\":\"$id\",\"status\":\"$status\",\"progress\":$progress,\"updated_at\":\"$ts\"$completed}}]"
}

# _add_environment <id> <name> [description]
# Note: ID is auto-prefixed with namespace (NS) if set
_add_environment() {
    local id="$(_ns_id "$1")" name="$2" description="${3:-}" ts="$(_ts)"
    local desc_json=""
    [[ -n "$description" ]] && desc_json=",\"description\":\"$description\""
    _bulk environments "[{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\"$desc_json,\"created_at\":\"$ts\",\"updated_at\":\"$ts\"}}]"
}

# _add_profile <id> <name> <type> [description] [tags_json_array] [config_json] [environment_values_json]
# Creates a profile with type, optional description, tags, config, and environment_values
# Example: _add_profile "uuid" "My DB" "database" "Description" '["prod","db"]' '{"host":"localhost"}' '{"env-id":{"host":"localhost"}}'
# Note: ID is auto-prefixed with namespace (NS) if set
_add_profile() {
    local id="$(_ns_id "$1")" name="$2" type="$3" description="${4:-}" tags="${5:-[]}" config="${6:-"{}"}" env_values="${7:-"{}"}" ts="$(_ts)"
    local desc_json=""
    [[ -n "$description" ]] && desc_json=",\"description\":\"$description\""
    _bulk profiles "[{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\",\"type\":\"$type\"$desc_json,\"tags\":$tags,\"config\":$config,\"environment_values\":$env_values,\"created_at\":\"$ts\",\"updated_at\":\"$ts\"}}]"
}

# _create_profile <name> <type> [description] [tags_json_array] [config_json] [environment_values_json]
# Creates a profile using the regular POST /profiles API (properly persists to storage)
# Unlike _add_profile which uses admin bulk, this uses the standard API endpoint
# Note: Does NOT support custom ID - ID is generated by the server
_create_profile() {
    local name="$1"
    local type="$2"
    local description="$3"
    local tags="$4"
    local config="$5"
    local env_values="$6"
    # Apply defaults
    [[ -z "$tags" ]] && tags='[]'
    [[ -z "$config" ]] && config='{}'
    [[ -z "$env_values" ]] && env_values='{}'
    local desc_json=""
    [[ -n "$description" ]] && desc_json=",\"description\":\"$description\""
    curl -sf -X POST "${BACKEND_URL}/profiles" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"$name\",\"type\":\"$type\"$desc_json,\"tags\":$tags,\"config\":$config,\"environment_values\":$env_values}" > /dev/null
}

# _add_profile_with_envs <id> <name> <type> <env_ids_space_separated> [description] [tags_json_array]
# Creates a profile associated with specified environments (simpler helper for usage count tests)
# Example: _add_profile_with_envs "uuid" "My DB" "database" "env-1 env-2" "Description" '["prod","db"]'
# Note: ID and env_ids are auto-prefixed with namespace (NS) if set
_add_profile_with_envs() {
    local id="$(_ns_id "$1")" name="$2" type="$3" env_ids="$4" description="${5:-}" tags="${6:-[]}" ts="$(_ts)"
    local desc_json=""
    [[ -n "$description" ]] && desc_json=",\"description\":\"$description\""
    # Build environment_values JSON with empty config for each environment
    local env_values="{"
    local first=true
    for env_id in $env_ids; do
        local ns_env_id="$(_ns_id "$env_id")"
        if $first; then
            first=false
        else
            env_values+=","
        fi
        env_values+="\"$ns_env_id\":{}"
    done
    env_values+="}"
    _bulk profiles "[{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\",\"type\":\"$type\"$desc_json,\"tags\":$tags,\"config\":{},\"environment_values\":$env_values,\"created_at\":\"$ts\",\"updated_at\":\"$ts\"}}]"
}

# _link_profile_to_test <profile_id> <test_id>
# Links a profile to a test for usage count computation
# Note: Both IDs are auto-prefixed with namespace (NS) if set
_link_profile_to_test() {
    local profile_id="$(_ns_id "$1")" test_id="$(_ns_id "$2")"
    # Update test metadata to reference this profile
    local ts="$(_ts)"
    _bulk tests "[{\"op\":\"modify\",\"entity\":{\"id\":\"$test_id\",\"updated_at\":\"$ts\",\"metadata\":{\"profile_id\":\"$profile_id\"}}}]"
}

# ============================================================================
# Batch Operations - Build arrays and flush in single requests
# ============================================================================

# Global arrays for batch operations
_BATCH_PROFILES=()
_BATCH_TESTS=()
_BATCH_LINKS=()
_BATCH_ENVIRONMENTS=()

# _batch_environment <id> <name> [description]
# Adds environment to batch (does NOT send request)
# Note: ID is auto-prefixed with namespace (NS) if set
_batch_environment() {
    local id="$(_ns_id "$1")" name="$2" description="${3:-}" ts="$(_ts)"
    local desc_json=""
    [[ -n "$description" ]] && desc_json=",\"description\":\"$description\""
    _BATCH_ENVIRONMENTS+=("{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\"$desc_json,\"created_at\":\"$ts\",\"updated_at\":\"$ts\"}}")
}

# _batch_profile <id> <name> <type> [description] [tags_json_array] [config_json] [environment_id]
# Adds profile to batch (does NOT send request)
# If environment_id is provided, sets environment_values to {env_id: config_json}
# Note: ID and environment_id are auto-prefixed with namespace (NS) if set
_batch_profile() {
    local id="$(_ns_id "$1")" name="$2" type="$3" description="${4:-}" tags="${5:-[]}" config="${6:-"{}"}" env_id="${7:-}" ts="$(_ts)"
    local desc_json=""
    local env_values="{}"
    [[ -n "$description" ]] && desc_json=",\"description\":\"$description\""
    # Set environment_values if environment_id is provided (namespace the env_id too)
    if [[ -n "$env_id" ]]; then
        local ns_env_id="$(_ns_id "$env_id")"
        env_values="{\"$ns_env_id\":$config}"
    fi
    _BATCH_PROFILES+=("{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\",\"type\":\"$type\"$desc_json,\"tags\":$tags,\"config\":$config,\"environment_values\":$env_values,\"created_at\":\"$ts\",\"updated_at\":\"$ts\"}}")
}

# _batch_test <id> <name> [parent_suite_name] [tags_json_array] [status]
# Adds test to batch (does NOT send request)
# Note: ID is auto-prefixed with namespace (NS) if set
_batch_test() {
    local id="$(_ns_id "$1")" name="$2" parent_suite="${3:-}" tags="${4:-}" status="${5:-}" ts="$(_ts)"
    local metadata_parts=()
    [[ -n "$parent_suite" ]] && metadata_parts+=("\"parent_suite\":\"$parent_suite\"")
    [[ -n "$tags" ]] && metadata_parts+=("\"tags\":$tags")
    [[ -n "$status" ]] && metadata_parts+=("\"status\":\"$status\",\"last_run\":\"$ts\"")
    local metadata="{}"
    if [[ ${#metadata_parts[@]} -gt 0 ]]; then
        local IFS=","
        metadata="{${metadata_parts[*]}}"
    fi
    _BATCH_TESTS+=("{\"op\":\"add\",\"entity\":{\"id\":\"$id\",\"name\":\"$name\",\"version\":\"1.0.0\",\"created_at\":\"$ts\",\"updated_at\":\"$ts\",\"metadata\":$metadata}}")
}

# _batch_link <profile_id> <test_id>
# Adds profile-test link to batch (does NOT send request)
# Note: Both IDs are auto-prefixed with namespace (NS) if set
_batch_link() {
    local profile_id="$(_ns_id "$1")" test_id="$(_ns_id "$2")" ts="$(_ts)"
    _BATCH_LINKS+=("{\"op\":\"modify\",\"entity\":{\"id\":\"$test_id\",\"updated_at\":\"$ts\",\"metadata\":{\"profile_id\":\"$profile_id\"}}}")
}

# _flush_profiles - Send all batched profiles in single request
_flush_profiles() {
    if [[ ${#_BATCH_PROFILES[@]} -gt 0 ]]; then
        local IFS=","
        _bulk profiles "[${_BATCH_PROFILES[*]}]"
        _BATCH_PROFILES=()
    fi
}

# _flush_tests - Send all batched tests in single request
_flush_tests() {
    if [[ ${#_BATCH_TESTS[@]} -gt 0 ]]; then
        local IFS=","
        _bulk tests "[${_BATCH_TESTS[*]}]"
        _BATCH_TESTS=()
    fi
}

# _flush_links - Send all batched links in single request
_flush_links() {
    if [[ ${#_BATCH_LINKS[@]} -gt 0 ]]; then
        local IFS=","
        _bulk tests "[${_BATCH_LINKS[*]}]"
        _BATCH_LINKS=()
    fi
}

# _flush_environments - Send all batched environments in single request
_flush_environments() {
    if [[ ${#_BATCH_ENVIRONMENTS[@]} -gt 0 ]]; then
        local IFS=","
        _bulk environments "[${_BATCH_ENVIRONMENTS[*]}]"
        _BATCH_ENVIRONMENTS=()
    fi
}

# _flush_all - Flush all pending batches (environments first since profiles may reference them)
_flush_all() {
    _flush_environments
    _flush_profiles
    _flush_tests
    _flush_links
}
