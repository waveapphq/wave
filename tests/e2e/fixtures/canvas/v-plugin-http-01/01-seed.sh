#!/bin/bash
# Seed data for V-PLUGIN-HTTP-01: HTTP Client plugin config modal tests
#
# Seeds profiles for the profile binding modal test.
# No test workflow is needed - tests drag-drop HTTP Client from palette.

set -e

source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data
_reset_all

# Create profiles for profile binding test
_batch_profile "aaa10001-0001-0001-0001-000000000001" "Production API" "http" \
    "Production HTTP API" \
    '["api","production"]' \
    '{"base_url":"https://api.example.com","timeout":30}' \
    ""

_batch_profile "aaa10002-0002-0002-0002-000000000002" "Dev Database" "database" \
    "Development database connection" \
    '["database","dev"]' \
    '{"host":"localhost","port":5432,"database":"wave_dev","username":"wave_dev"}' \
    ""

_batch_profile "aaa10003-0003-0003-0003-000000000003" "SSH Gateway" "ssh" \
    "SSH bastion host" \
    '["ssh","infrastructure"]' \
    '{"host":"bastion.example.com","port":22,"username":"admin"}' \
    ""

_flush_profiles

echo "V-PLUGIN-HTTP-01 seeded: 3 profiles (http, database, ssh)"
