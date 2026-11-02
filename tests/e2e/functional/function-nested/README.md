# Nested Function Functional Tests

Functional E2E coverage for nested Function composition (REQ-3.1.1.4): a local
Function may contain Functions (local or published) to arbitrary depth, and
the whole structure validates, drills, and runs end-to-end.

## Prerequisites

- Backend + frontend running on the worker's ports
- Shared E2E environment present (handled by `ensureEnvironment` at test start)

## Specs & Fixtures

- `v-fn-nested-functional.spec.ts` - 2-level variations built programmatically:
  Local-in-Local (drill + run, deepest line propagates) and Shared-in-Local
  (drill shows the S badge, runs the library version's line).
- `v-fn-nested-3level-functional.spec.ts` + `fixture-3level.json` - three local
  Functions nested Level1 > Level2 > Level3, each logging a line. Imports,
  validates (zero errors), runs, and asserts every level's line surfaces -
  proving 3-deep execution and propagation through two enclosing boundaries.

## Validation

- `POST /tests/{id}/validate` returns zero errors on the 3-level nest (no false
  circular / missing-reference flags).
- Run reaches `passed`; the console contains `fn3-lvl1`, `fn3-lvl2`, and
  `fn3-lvl3-deepest`.
