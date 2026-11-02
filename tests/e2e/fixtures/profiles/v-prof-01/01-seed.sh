#!/bin/bash
# V-PROF-01: Seeds populated profiles list with various types, environments, and usage counts
# Creates 12 profiles (>10 for pagination testing) with different types, tags, environments, and usage
# Tests environment column display and various profile configurations
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data including profiles and environments
_reset_all

# ============================================================================
# Batch all environments (4 environments) - Single HTTP request
# ============================================================================

_batch_environment "e00d0001-0001-0001-0001-000000000001" "Production" "Production environment for live systems"
_batch_environment "e00d0002-0002-0002-0002-000000000002" "Staging" "Staging environment for pre-production testing"
_batch_environment "e00d0003-0003-0003-0003-000000000003" "Development" "Development environment for local testing"
_batch_environment "e00d0004-0004-0004-0004-000000000004" "QA" "QA environment for quality assurance"

_flush_environments  # Single HTTP request for all 4 environments

# ============================================================================
# Batch all profiles (12 profiles, 6 types) - Single HTTP request
# Some with environments, some without (null environment)
# ============================================================================

# Database profiles (most common) - with different environments
_batch_profile "aaaa1111-1111-1111-1111-111111111111" "Production Database" "database" \
    "PostgreSQL connection for production environment" \
    '["database","production"]' \
    '{"host":"prod-db.example.com","port":5432,"database":"wave_prod","username":"wave_admin"}' \
    "e00d0001-0001-0001-0001-000000000001"

_batch_profile "aaaa2222-2222-2222-2222-222222222222" "Staging Database" "database" \
    "PostgreSQL connection for staging environment" \
    '["database","staging"]' \
    '{"host":"staging-db.example.com","port":5432,"database":"wave_staging","username":"wave_staging"}' \
    "e00d0002-0002-0002-0002-000000000002"

_batch_profile "aaaa3333-3333-3333-3333-333333333333" "Dev Database" "database" \
    "Local development database" \
    '["database","dev"]' \
    '{"host":"localhost","port":5432,"database":"wave_dev","username":"wave_dev"}' \
    "e00d0003-0003-0003-0003-000000000003"

# SSH profiles - Production has env, API Keys has no env (null)
_batch_profile "bbbb1111-1111-1111-1111-111111111111" "SSH Bastion" "ssh" \
    "SSH bastion host for infrastructure access" \
    '["ssh","infrastructure"]' \
    '{"host":"bastion.example.com","port":22,"username":"admin"}' \
    "e00d0001-0001-0001-0001-000000000001"

_batch_profile "bbbb2222-2222-2222-2222-222222222222" "API Keys" "ssh" \
    "API credential storage" \
    '["api","credentials"]' \
    '{"host":"api.example.com","port":22,"username":"api_user"}' \
    ""

# HTTP profiles - no environment (null)
_batch_profile "cccc1111-1111-1111-1111-111111111111" "REST API Gateway" "http" \
    "Main API gateway for microservices" \
    '["api","gateway"]' \
    '{"base_url":"https://api.example.com","timeout":30}' \
    ""

# Directory profile (custom type) - QA environment
_batch_profile "dddd1111-1111-1111-1111-111111111111" "LDAP Server" "custom" \
    "Corporate LDAP directory" \
    '["ldap","auth"]' \
    '{"host":"ldap.example.com","port":389,"base_dn":"dc=example,dc=com"}' \
    "e00d0004-0004-0004-0004-000000000004"

# Kubernetes profiles - Production environment
_batch_profile "eeee1111-1111-1111-1111-111111111111" "K8s Production" "kubernetes" \
    "Production Kubernetes cluster" \
    '["k8s","production"]' \
    '{"api_url":"https://prod.k8s.example:6443","namespace":"default"}' \
    "e00d0001-0001-0001-0001-000000000001"

# OpenSearch profiles - Staging environment
_batch_profile "ffff1111-1111-1111-1111-111111111111" "OpenSearch Cluster" "opensearch" \
    "OpenSearch cluster for log aggregation" \
    '["opensearch","logging"]' \
    '{"url":"https://opensearch.example.com:9200"}' \
    "e00d0002-0002-0002-0002-000000000002"

# SSH profile for an SFTP server - Development environment
_batch_profile "0a0a1111-1111-1111-1111-111111111111" "SFTP Gateway" "ssh" \
    "SFTP server for file transfers" \
    '["sftp","transfer"]' \
    '{"host":"sftp.example.com","port":22,"username":"sftp_user"}' \
    "e00d0003-0003-0003-0003-000000000003"

# Custom profiles - no environments (null)
_batch_profile "0b0b1111-1111-1111-1111-111111111111" "Redis Cache" "custom" \
    "Redis cache cluster" \
    '["cache","redis"]' \
    '{"host":"redis.example.com","port":6379}' \
    ""

_batch_profile "0b0b2222-2222-2222-2222-222222222222" "Kafka Broker" "custom" \
    "Kafka message broker" \
    '["kafka","messaging"]' \
    '{"bootstrap_servers":"kafka.example.com:9092"}' \
    ""

_flush_profiles  # Single HTTP request for all 12 profiles

# ============================================================================
# Batch all tests (64 tests) - Single HTTP request
# ============================================================================

# Tests for Production Database (12 tests)
for i in $(seq 1 12); do
    _batch_test "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)" "DB Connection Test $i" "" '["database"]' ""
done

# Tests for Staging Database (8 tests)
for i in $(seq 13 20); do
    _batch_test "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)" "Staging Test $((i-12))" "" '["staging"]' ""
done

# Tests for API Keys profile (15 tests)
for i in $(seq 21 35); do
    _batch_test "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)" "API Test $((i-20))" "" '["api"]' ""
done

# Tests for SSH Bastion (6 tests)
for i in $(seq 36 41); do
    _batch_test "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)" "SSH Test $((i-35))" "" '["ssh"]' ""
done

# Tests for Dev Database (4 tests)
for i in $(seq 42 45); do
    _batch_test "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)" "Dev Test $((i-41))" "" '["dev"]' ""
done

# Tests for LDAP (9 tests)
for i in $(seq 46 54); do
    _batch_test "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)" "LDAP Test $((i-45))" "" '["ldap"]' ""
done

# Tests for HTTP Gateway (7 tests)
for i in $(seq 55 61); do
    _batch_test "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)" "HTTP Test $((i-54))" "" '["http"]' ""
done

# Tests for OpenSearch (3 tests)
for i in $(seq 62 64); do
    _batch_test "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)" "OpenSearch Test $((i-61))" "" '["opensearch"]' ""
done

_flush_tests  # Single HTTP request for all 64 tests

# ============================================================================
# Batch all profile-test links - Single HTTP request
# ============================================================================

# Link tests to Production Database (12 tests)
for i in $(seq 1 12); do
    _batch_link "aaaa1111-1111-1111-1111-111111111111" "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)"
done

# Link tests to Staging Database (8 tests)
for i in $(seq 13 20); do
    _batch_link "aaaa2222-2222-2222-2222-222222222222" "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)"
done

# Link tests to API Keys (15 tests)
for i in $(seq 21 35); do
    _batch_link "bbbb2222-2222-2222-2222-222222222222" "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)"
done

# Link tests to SSH Bastion (6 tests)
for i in $(seq 36 41); do
    _batch_link "bbbb1111-1111-1111-1111-111111111111" "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)"
done

# Link tests to Dev Database (4 tests)
for i in $(seq 42 45); do
    _batch_link "aaaa3333-3333-3333-3333-333333333333" "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)"
done

# Link tests to LDAP (9 tests)
for i in $(seq 46 54); do
    _batch_link "dddd1111-1111-1111-1111-111111111111" "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)"
done

# Link tests to HTTP Gateway (7 tests)
for i in $(seq 55 61); do
    _batch_link "cccc1111-1111-1111-1111-111111111111" "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)"
done

# Link tests to OpenSearch (3 tests)
for i in $(seq 62 64); do
    _batch_link "ffff1111-1111-1111-1111-111111111111" "$(printf '10010%03d-%04d-%04d-%04d-%012d' $i $i $i $i $i)"
done

_flush_links  # Single HTTP request for all 64 links

echo "V-PROF-01 seeded: 4 environments, 12 profiles (6 types), 64 tests [4 HTTP requests]"
echo ""
echo "Environments:"
echo "  - Production: 3 profiles (Prod DB, SSH Bastion, K8s Production)"
echo "  - Staging: 2 profiles (Staging DB, OpenSearch)"
echo "  - Development: 2 profiles (Dev DB, SFTP Gateway)"
echo "  - QA: 1 profile (LDAP Server)"
echo ""
echo "Profiles with no environment (null):"
echo "  - API Keys, REST API Gateway, Redis Cache, Kafka Broker"
echo ""
echo "Profile usage counts:"
echo "  - Production Database: 12 tests (Production env)"
echo "  - Staging Database: 8 tests (Staging env)"
echo "  - API Keys: 15 tests (no env)"
echo "  - SSH Bastion: 6 tests (Production env)"
echo "  - Dev Database: 4 tests (Development env)"
echo "  - LDAP Server: 9 tests (QA env)"
echo "  - REST API Gateway: 7 tests (no env)"
echo "  - OpenSearch Cluster: 3 tests (Staging env)"
echo "  - K8s Production: 0 tests (Production env, can be deleted)"
echo "  - SFTP Gateway: 0 tests (Development env, can be deleted)"
echo "  - Redis Cache: 0 tests (no env, can be deleted)"
echo "  - Kafka Broker: 0 tests (no env, can be deleted)"
