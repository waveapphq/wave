# V-CANVAS-FN-INNER-MUTATIONS-01: Inner-Function kebab mutations (regression guard)

Drill into a local Function and exercise every kebab mutation (Duplicate / Unlink / Disable / Skip / Cut). Each block has a `// regression guard:` comment so a future failure points at the drill-aware store behavior it guards.

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json` (one root Shell Script + one local Function with two inner Logs connected by an edge).

## Steps

Each `test()` does its own drill-in:

1. **Duplicate inner-1** - inner node count increases by 1, root tree untouched after pop.
2. **Unlink inner-1** - `.react-flow__edge` count drops 1 -> 0; both inner nodes still visible.
3. **Disable inner-2** - `data-disabled="true"` appears on inner-2; root Shell Script never gains it.
4. **Skip inner-2** - `data-skipped="true"` appears on inner-2; root Shell Script never gains it.
5. **Cut inner-2** - inner-2 removed from canvas; inner-1 still visible.

## Validation

- Every kebab mutation (Duplicate, Unlink, Disable, Skip, Cut) routes through the active subtree and never bleeds into root state.
- `data-disabled` and `data-skipped` attrs on the workflow-node wrapper provide the assertion surface.
- React Flow's `.react-flow__edge` count tracks the active edges list.
