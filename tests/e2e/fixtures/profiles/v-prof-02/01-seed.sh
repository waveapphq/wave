#!/bin/bash
# V-PROF-02: Seeds profiles for modal testing (create/edit)
# Creates profiles with different types, environments, and usage for constraint testing
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data including profiles and environments
_reset_all

# ============================================================================
# Batch all environments (3 environments) - Single HTTP request
# ============================================================================

_batch_environment "e00d0001-0001-0001-0001-000000000001" "Production" "Production environment"
_batch_environment "e00d0002-0002-0002-0002-000000000002" "Staging" "Staging environment"
_batch_environment "e00d0003-0003-0003-0003-000000000003" "Development" "Development environment"

_flush_environments  # Single HTTP request for all 3 environments

# ============================================================================
# Batch all profiles (6 profiles) - Single HTTP request
# Mix of with/without environments
# ============================================================================

# Database profile with usage and Production environment (for testing locked fields and disabled delete)
_batch_profile "aaaa1111-1111-1111-1111-111111111111" "Production Database" "database" \
    "PostgreSQL connection for production" \
    '["database","production"]' \
    '{"host":"prod-db.example.com","port":5432,"database":"wave_prod","username":"wave_admin","password":"********"}' \
    "e00d0001-0001-0001-0001-000000000001"

# SSH profile with usage and Staging environment
_batch_profile "bbbb1111-1111-1111-1111-111111111111" "SSH Bastion" "ssh" \
    "SSH bastion host for infrastructure access" \
    '["ssh","infrastructure"]' \
    '{"host":"bastion.example.com","port":22,"username":"admin","private_key":"********"}' \
    "e00d0002-0002-0002-0002-000000000002"

# HTTP profile with zero usage (no environment)
_batch_profile "cccc1111-1111-1111-1111-111111111111" "REST API Gateway" "http" \
    "Main API gateway" \
    '["api","gateway"]' \
    '{"base_url":"https://api.example.com","timeout":30}' \
    ""

# Directory profile (custom type) with tags and Development environment
_batch_profile "dddd1111-1111-1111-1111-111111111111" "Corporate LDAP" "custom" \
    "Corporate directory" \
    '["ldap","auth","corporate"]' \
    '{"host":"ldap.example.com","port":389,"base_dn":"dc=example,dc=com"}' \
    "e00d0003-0003-0003-0003-000000000003"

# Kubernetes profile with zero usage and Production environment
_batch_profile "eeee1111-1111-1111-1111-111111111111" "K8s Production" "kubernetes" \
    "Production cluster" \
    '["k8s","production"]' \
    '{"api_url":"https://prod.k8s.example:6443","namespace":"default"}' \
    "e00d0001-0001-0001-0001-000000000001"

# Custom profile with zero usage (no environment)
_batch_profile "ffff1111-1111-1111-1111-111111111111" "Redis Cache" "custom" \
    "Redis cache cluster" \
    '["cache","redis"]' \
    '{"host":"redis.example.com","port":6379}' \
    ""

_flush_profiles  # Single HTTP request for all 6 profiles

# ============================================================================
# Batch all tests (5 tests) - Single HTTP request
# ============================================================================

_batch_test "10010001-0001-0001-0001-000000000001" "DB Test 1" "" '["database"]' ""
_batch_test "10010002-0002-0002-0002-000000000002" "DB Test 2" "" '["database"]' ""
_batch_test "10010003-0003-0003-0003-000000000003" "DB Test 3" "" '["database"]' ""
_batch_test "10010004-0004-0004-0004-000000000004" "SSH Test 1" "" '["ssh"]' ""
_batch_test "10010005-0005-0005-0005-000000000005" "SSH Test 2" "" '["ssh"]' ""

_flush_tests  # Single HTTP request for all 5 tests

# ============================================================================
# Batch all profile-test links - Single HTTP request
# ============================================================================

_batch_link "aaaa1111-1111-1111-1111-111111111111" "10010001-0001-0001-0001-000000000001"
_batch_link "aaaa1111-1111-1111-1111-111111111111" "10010002-0002-0002-0002-000000000002"
_batch_link "aaaa1111-1111-1111-1111-111111111111" "10010003-0003-0003-0003-000000000003"
_batch_link "bbbb1111-1111-1111-1111-111111111111" "10010004-0004-0004-0004-000000000004"
_batch_link "bbbb1111-1111-1111-1111-111111111111" "10010005-0005-0005-0005-000000000005"

_flush_links  # Single HTTP request for all 5 links

echo "V-PROF-02 seeded: 3 environments, 6 profiles, 5 tests [4 HTTP requests]"
echo ""
echo "Environments:"
echo "  - Production: 2 profiles (Prod DB, K8s Production)"
echo "  - Staging: 1 profile (SSH Bastion)"
echo "  - Development: 1 profile (Corporate LDAP)"
echo ""
echo "Profiles with no environment:"
echo "  - REST API Gateway, Redis Cache"
echo ""
echo "Profiles:"
echo "  - Production Database (database): 3 tests, Production env (delete disabled)"
echo "  - SSH Bastion (ssh): 2 tests, Staging env (delete disabled)"
echo "  - REST API Gateway (http): 0 tests, no env (delete enabled)"
echo "  - Corporate LDAP (custom): 0 tests, Development env (delete enabled)"
echo "  - K8s Production (kubernetes): 0 tests, Production env (delete enabled)"
echo "  - Redis Cache (custom): 0 tests, no env (delete enabled)"
