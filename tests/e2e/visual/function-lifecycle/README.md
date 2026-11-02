# V-FN-* (Function Lifecycle) - Visual tests

Visual coverage for the Function lifecycle surfaces (publish dialog,
library modal, Make Local confirmation, read-only inspect chrome, Profiles
button). All tests seed their own data via `POST /functions` (library
entries) and `POST /tests` (workbench host); no shared fixture script.

## Prerequisites

- Dev servers up on the per-worker stack ports (handled by `playwright.config.ts`).
- Backend with `WAVE_ADMIN_ALLOWED=true` so library + test seeds round-trip.

## Files in this directory

| Spec | Design | Pass criteria count | Regression-guard coverage |
|------|--------|---------------------|---------------------------|
| `v-fn-pub-01.spec.ts` | FN-LC-1..5 | 5 | Version not readonly, NameField counter, grid `1fr_220px`, chip-style Tags, semver popover, aria-describedby |
| `v-fn-lib-01.spec.ts` | FN-LC-6..8 | 5 | Drag-doesn't-select text, filtered-empty copy, viewport drag |
| `v-fn-mk-local-01.spec.ts` | FN-LC-16..17 | 2 | Nested-shared copy clarification, aria-describedby, Cancel-is-no-op |
| `v-fn-ro-01.spec.ts` | FN-LC-12..14 | 4 | Read-only chrome wired in live workbench (showReadOnlyChrome + readOnly props) |
| `v-fn-profile-01.spec.ts` | FN-LC-9..11 | 3 | Profiles button on BOTH variants |

## Validation criteria

Each spec asserts:

1. The elements named in the design decisions.
2. The correct lifecycle badge / pill colors (slate L, indigo S, indigo READ-ONLY).
3. The exact copy strings called out in the design decisions (footer note,
   empty-state copy, semver popover labels).
4. The regression-guard assertions - each guard carries an inline
   `// regression guard: ...` comment naming the issue it prevents.

## Phase placement

All five specs use seeded fixtures (POST /tests, POST /functions) so they
belong in the `fixture-*` phases of `playwright.config.ts`. They do not
modify cross-test state, so workers do not need to serialize on them beyond
the in-file `test.beforeAll`.
