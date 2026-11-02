# long-names-overflow fixture

Shared seed for the overflow specs:

- `tests/e2e/visual/lists/v-list-name-truncate.spec.ts` (truncation across
  Tests / Suites / Regressions / Profiles / Environments)
- `tests/e2e/visual/suites/v-metadata-sidebar-description-wrap.spec.ts`
  (sidebar break-words regression guard)

## Pre-requisites

- Backend running on `${WAVE_E2E_BACKEND_PORT:-8000}` with admin enabled.

## What it seeds

- One short test (`Short Name`) + one 200-char single-token test.
- One suite with a 200-char single-token description.
- One regression with a 200-char single-token description.
- One environment with a 200-char single-token name.
- One profile with a 200-char single-token name.

## Validation criteria

- The 200-char names render in their list pages without pushing sibling
  columns out, with ellipsis at the truncation cap, and a multiline tooltip
  on hover.
- The 200-char single-token descriptions in the suite + regression detail
  sidebars wrap inside the sidebar (no horizontal overflow into the right
  pane).
