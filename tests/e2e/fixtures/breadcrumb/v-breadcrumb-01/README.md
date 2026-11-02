# V-BREADCRUMB-01: Workbench Context Breadcrumb

Shared fixture for the canvas breadcrumb, detail-header cascade, tests-list
Suite cell, and EntityListPopover parity V-tests.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/breadcrumb/v-breadcrumb-01/01-seed.sh
```

## Seed Contents

- **Tests**: Login Check (short, in Smoke Suite), a 200-char name (in long suite),
  Shared Auth Test (in 3 suites - drives the multi-suite Suite cell popover)
- **Suites**: Smoke Suite (in Nightly Smoke regression), a 200-char name (in
  long regression), Alpha / Beta / Gamma Suites (shared multi-suite test)
- **Regressions**: Nightly Smoke (contains Smoke Suite), a 200-char name
  (contains long suite)
- **Executions**: standalone test exec for history-canvas breadcrumb,
  suite-type exec for execution-detail page DetailHeader assertions

## Steps

The seed is consumed by six spec files. Each spec drives its own navigation:

1. `canvas/v-canvas-breadcrumb-modes.spec.ts` -> open the workbench in
   each of the 7 modes
2. `canvas/v-canvas-breadcrumb-truncation.spec.ts` -> drive the A -> B -> C cascade
3. `detail-header/v-detail-header-cascade.spec.ts` -> open
   `/suites/<id>?regressionId=<id>` with short and long names
4. `detail-header/v-detail-header-icons.spec.ts` -> open the three detail pages
   and assert the entity-color icons
5. `tests-list/v-tests-list-suite-cell.spec.ts` -> open `/tests` and exercise
   the Suite column (single + multi suite)
6. `shared/v-entity-list-popover-parity.spec.ts` -> open each surface that
   consumes `EntityListPopover` and assert chrome parity

## Validation

- **Modes (S1-S8)**: each mode renders the expected segments, icons, and
  back-arrow target; pending parents render as skeletons before fetches land
- **Truncation cascade**: parents collapse to `...` once the bar overflows;
  the leaf hover tooltip surfaces the full name when it clips
- **Detail-header cascade**: suite-from-regression prefix link collapses
  identically to the canvas breadcrumb; popover navigation works
- **Detail-header icons**: entity colors match sidebar conventions
  (regression purple #A78BFA, suite orange #F59E0B, execution blue #60A5FA)
- **Tests-list Suite cell**: single suite uses TruncatedName with the tighter
  `clamp(8rem,18vw,22rem)` cap; multi-suite uses the shared popover
- **Popover parity**: identical chrome classes on the three E2E-testable
  surfaces (breadcrumb collapse, detail-header collapse, tests-list multi)
