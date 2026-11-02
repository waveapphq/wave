# V-PRERUN-DIRTY-GATE: the pre-run check reads the canvas, not the saved copy

The pre-run check validates the body that is about to run. A Block enabled and
configured on the canvas but not yet saved is what the engine executes, so it is
what the check must read - not the last saved copy of the Test.

Before this, a dirty canvas skipped the check entirely: a Block enabled on the
canvas was validated against its stored state (disabled, no config), so the run
started and the Block failed mid-run instead of being caught.

This directory covers the NON-K8s Blocks and every entry point that reaches the
shared gate. The four K8s read Blocks and their conditionally-required
parameters are covered in `../k8s-read/`.

## Pre-requisites

No external service and no seed script. Every case seeds its own Test through
the API and drives the workbench. The valid case runs a two-Log Test, so only
the shared E2E execution environment is needed.

## Blocks used

Two kinds, so the coverage cannot be plugin-specific:

| Block | Kind | Hole | Message |
|-------|------|------|---------|
| Log | plugin | `message` present but blank | `Required parameter 'message' is empty` |
| Delay | control | `duration` absent | `Required parameter 'duration' is missing` |

Both Blocks are seeded DISABLED, so the SAVED copy validates clean. Enabling one
on the canvas is the whole dirty edit - nothing is saved afterwards.

## Steps

1. `./scripts/e2e-targeted-local.sh functional/prerun-dirty-gate/v-prerun-dirty-gate-functional.spec.ts` from the root of
   the clone, or the whole suite via `./scripts/ci-playwright-local.sh`.

## Validation

- **Run.** With both Blocks enabled on the canvas and nothing saved, Run does
  not start: the dialog reads `Cannot Run Test`, one row names `Unconfigured
  Log` with its message hole and another names `Unset Delay` with its duration
  hole, and the workflow status stays `idle` while the dialog is up and after it
  is closed. The saved copy is asserted clean first (`validate?context=run`
  returns 200 with zero errors), so the findings can only have come from the
  canvas.
- **Debug.** The same unsaved hole refuses Debug, with the `Cannot Debug Test`
  wording.
- **Run Current.** The ad-hoc run from the Block's own menu is refused the same
  way.
- **Run Scope in a Function.** Drilled into a Local Function, Run Scope is
  refused by the same gate and names the top-level Block that carries the hole.
- **Saved.** The same two holes persisted through the admin bulk route (the
  ordinary write path refuses them) still fail `validate?context=run` with 422,
  and pressing Run on the loaded Test raises the same dialog with both rows.
- **A valid dirty canvas still runs.** A second Log Block, enabled on the canvas
  and never saved, produces no dialog: the run reaches passed and the console
  carries the enabled Block's line, which proves the in-memory body is what ran.

## Notes

- The last case is the regression trap. The gate used to pass everything a dirty
  canvas carried, so a check that refused everything would satisfy every other
  case here and fail only this one.
- The gate is one shared check, which is why the entry points are covered
  separately rather than assumed: Run, Debug, the ad-hoc run and the Function
  scope each reach it by their own route.
- A dirty canvas raises the holes from the canvas and a saved Test raises them
  from the backend. The two halves emit identical wording, so the row
  assertions match the Block name and the message inside one row rather than
  counting rows.
