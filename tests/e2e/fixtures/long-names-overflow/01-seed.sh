#!/bin/bash
# Long-names overflow fixture.
#
# Seeds one row per list/sidebar surface with a name long enough to trigger
# the truncation contract:
#   - Test name (255-char cap): one short test, one 200-char test.
#   - Suite (with a 200-char single-token description): proves the metadata
#     sidebar wrap regression guard for v-metadata-sidebar-description-wrap.
#   - Regression (with a 200-char single-token description): same guard.
#   - Profile + environment with long names so the lists list-truncate spec
#     can exercise the same primitive across all entity types.
set -e
source "$(dirname "$0")/../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data so this fixture stands alone (matches v-list-* seeds).
_reset_all

# 200-char single-token name (truncation target for list pages + breadcrumb).
LONG_NAME="$(printf 'd%.0s' {1..200})"
# 200-char single-token DESCRIPTION (no whitespace) for sidebar wrap test.
LONG_DESC="$(printf 'x%.0s' {1..200})"

# A short row so the list still has variety and the truncation assertions can
# diff against a non-truncating sibling.
_add_test "aaaa1111-1111-1111-1111-111111111111" "Short Name" "" '["short"]'

# Long-name test (truncation row).
_add_test "aaaa2222-2222-2222-2222-222222222222" "$LONG_NAME" "" '["long"]'

# Suite with the long single-token description for the sidebar wrap guard.
_add_suite "bbbb1111-1111-1111-1111-111111111111" "Long Desc Suite"
# The _add_suite helper does not take description; fall back to a direct
# admin bulk modify so we can attach the long-token description.
TS="$(_ts)"
_bulk suites "[{\"op\":\"modify\",\"entity\":{\"id\":\"bbbb1111-1111-1111-1111-111111111111\",\"version\":\"1.0.0\",\"created_at\":\"$TS\",\"updated_at\":\"$TS\",\"description\":\"$LONG_DESC\",\"metadata\":{}}}]"

# Regression with the long single-token description for the sidebar wrap guard.
_add_regression "cccc1111-1111-1111-1111-111111111111" "Long Desc Regression"
_bulk regressions "[{\"op\":\"modify\",\"entity\":{\"id\":\"cccc1111-1111-1111-1111-111111111111\",\"version\":\"1.0.0\",\"created_at\":\"$TS\",\"updated_at\":\"$TS\",\"description\":\"$LONG_DESC\",\"metadata\":{}}}]"

# Long-named profile + environment so the list-name-truncate spec can exercise
# the truncate cell across all five entity surfaces.
_add_environment "dddd1111-1111-1111-1111-111111111111" "$LONG_NAME"
_add_profile "eeee1111-1111-1111-1111-111111111111" "$LONG_NAME" "database" "" "[]" "{}" "{}"
