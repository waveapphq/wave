#!/bin/bash
# V-SET-01: Seeds settings page with environments and profiles
# Creates 4 environments with varying profile usage counts
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data (including environments and profiles)
_reset_all

# Environment IDs (UUIDs)
ENV_PROD="e0e00001-e001-e001-e001-e00000000001"
ENV_STAGING="e0e00002-e002-e002-e002-e00000000002"
ENV_DEV="e0e00003-e003-e003-e003-e00000000003"
ENV_QA="e0e00004-e004-e004-e004-e00000000004"

# Create environments (matching wireframe)
_add_environment "$ENV_PROD" "Production" "Live customer environment"
_add_environment "$ENV_STAGING" "Staging" "Pre-release testing"
_add_environment "$ENV_DEV" "Development" "Local development"
_add_environment "$ENV_QA" "QA" "Quality assurance testing"

# Create profiles with environment_values to establish usage counts
# Production: 5 profiles referencing Production environment
_add_profile_with_envs "a0a00001-a001-a001-a001-a00000000001" "prod-us-east" "database" "$ENV_PROD"
_add_profile_with_envs "a0a00002-a002-a002-a002-a00000000002" "prod-us-west" "database" "$ENV_PROD"
_add_profile_with_envs "a0a00003-a003-a003-a003-a00000000003" "prod-eu-central" "database" "$ENV_PROD"
_add_profile_with_envs "a0a00004-a004-a004-a004-a00000000004" "prod-ap-south" "database" "$ENV_PROD"
_add_profile_with_envs "a0a00005-a005-a005-a005-a00000000005" "prod-ap-east" "database" "$ENV_PROD"

# Staging: 3 profiles referencing Staging environment
_add_profile_with_envs "a0a00006-a006-a006-a006-a00000000006" "staging-main" "ssh" "$ENV_STAGING"
_add_profile_with_envs "a0a00007-a007-a007-a007-a00000000007" "staging-release" "ssh" "$ENV_STAGING"
_add_profile_with_envs "a0a00008-a008-a008-a008-a00000000008" "staging-hotfix" "ssh" "$ENV_STAGING"

# Development: 8 profiles referencing Development environment
_add_profile_with_envs "a0a00009-a009-a009-a009-a00000000009" "dev-local" "custom" "$ENV_DEV"
_add_profile_with_envs "a0a0000a-a00a-a00a-a00a-a0000000000a" "dev-docker" "custom" "$ENV_DEV"
_add_profile_with_envs "a0a0000b-a00b-a00b-a00b-a0000000000b" "dev-k8s" "kubernetes" "$ENV_DEV"
_add_profile_with_envs "a0a0000c-a00c-a00c-a00c-a0000000000c" "dev-team-alpha" "database" "$ENV_DEV"
_add_profile_with_envs "a0a0000d-a00d-a00d-a00d-a0000000000d" "dev-team-beta" "database" "$ENV_DEV"
_add_profile_with_envs "a0a0000e-a00e-a00e-a00e-a0000000000e" "dev-team-gamma" "ssh" "$ENV_DEV"
_add_profile_with_envs "a0a0000f-a00f-a00f-a00f-a0000000000f" "dev-sandbox" "custom" "$ENV_DEV"
_add_profile_with_envs "a0a00010-a010-a010-a010-a00000000010" "dev-experimental" "custom" "$ENV_DEV"

# QA: 2 profiles referencing QA environment
_add_profile_with_envs "a0a00011-a011-a011-a011-a00000000011" "qa-manual" "custom" "$ENV_QA"
_add_profile_with_envs "a0a00012-a012-a012-a012-a00000000012" "qa-automated" "http" "$ENV_QA"

echo "V-SET-01 seeded: 4 environments, 18 profiles (Production=5, Staging=3, Development=8, QA=2)"
