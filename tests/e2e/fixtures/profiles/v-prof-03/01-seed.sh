#!/bin/bash
# V-PROF-03: Seeds profile with tagged environments for Copy Values modal testing
# Creates environments WITH tags so the Recommended/Other sections and tag tooltips appear
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data including profiles and environments
_reset_all

# ============================================================================
# Create environments WITH tags via direct bulk API
# The standard _batch_environment doesn't support tags, so we use _bulk directly
# ============================================================================

ENV_STAGING="aa030001-0001-0001-0001-000000000001"
ENV_INTEGRATION="aa030002-0002-0002-0002-000000000002"
ENV_QA="aa030003-0003-0003-0003-000000000003"
ENV_DEV="aa030004-0004-0004-0004-000000000004"
ENV_PROD="aa030005-0005-0005-0005-000000000005"

TS="$(_ts)"

_bulk environments "[
  {\"op\":\"add\",\"entity\":{\"id\":\"$ENV_STAGING\",\"name\":\"Staging\",\"description\":\"Staging environment\",\"tags\":[\"staging\",\"testing\"],\"created_at\":\"$TS\",\"updated_at\":\"$TS\"}},
  {\"op\":\"add\",\"entity\":{\"id\":\"$ENV_INTEGRATION\",\"name\":\"Integration\",\"description\":\"Integration environment\",\"tags\":[\"testing\",\"staging\",\"integration\"],\"created_at\":\"$TS\",\"updated_at\":\"$TS\"}},
  {\"op\":\"add\",\"entity\":{\"id\":\"$ENV_QA\",\"name\":\"QA\",\"description\":\"QA environment\",\"tags\":[\"testing\",\"qa\"],\"created_at\":\"$TS\",\"updated_at\":\"$TS\"}},
  {\"op\":\"add\",\"entity\":{\"id\":\"$ENV_DEV\",\"name\":\"Development\",\"description\":\"Development environment\",\"tags\":[\"development\",\"local\"],\"created_at\":\"$TS\",\"updated_at\":\"$TS\"}},
  {\"op\":\"add\",\"entity\":{\"id\":\"$ENV_PROD\",\"name\":\"Production\",\"description\":\"Production environment\",\"tags\":[\"production\",\"critical\"],\"created_at\":\"$TS\",\"updated_at\":\"$TS\"}}
]"

# ============================================================================
# Create profile with values for all 5 environments
# When viewing from Staging (tags: staging, testing):
#   - Integration: 2 matches (testing, staging) → Recommended
#   - QA: 1 match (testing) → Other (with tooltip)
#   - Development: 0 matches → Other (no tooltip)
#   - Production: 0 matches → Other (no tooltip)
# ============================================================================

_add_profile "bb030001-0001-0001-0001-000000000001" "Database Config" "database" \
    "Multi-environment database connection" \
    '["database","infra"]' \
    '{"host":"localhost","port":"5432","database":"wave","username":"admin","password":"secret"}' \
    "{\"$ENV_STAGING\":{\"host\":\"staging-db.example.com\",\"port\":\"5432\"},\"$ENV_INTEGRATION\":{\"host\":\"int-db.example.com\",\"port\":\"5432\"},\"$ENV_QA\":{\"host\":\"qa-db.example.com\",\"port\":\"5432\"},\"$ENV_DEV\":{\"host\":\"localhost\",\"port\":\"5432\"},\"$ENV_PROD\":{\"host\":\"prod-db.example.com\",\"port\":\"5432\"}}"

echo "V-PROF-03 seeded: 5 tagged environments, 1 profile [2 HTTP requests]"
echo ""
echo "Environments (with tags):"
echo "  - Staging: [staging, testing]"
echo "  - Integration: [testing, staging, integration]"
echo "  - QA: [testing, qa]"
echo "  - Development: [development, local]"
echo "  - Production: [production, critical]"
echo ""
echo "Profile:"
echo "  - Database Config: values for all 5 environments"
echo ""
echo "When current env = Staging:"
echo "  Recommended: Integration (2 tags match: testing, staging)"
echo "  Other: QA (1 tag match: testing), Development (0), Production (0)"
