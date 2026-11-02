# V-FN-VER-REMEDIATE-01: missing-version remediation journey

Verify the config-modal missing-version state clears LIVE when an available
version is picked (live-clear), and that saving the modal clears the canvas
node's missing-version alert badge (save badge-clear).

## Prerequisites

No external seed script. The spec self-seeds:

1. `POST /functions` publishes a library Function at `1.0.0`.
2. `POST /admin/enable` then `POST /admin/bulk/tests` raw-persists a Test whose
   top-level Shared instance pins the absent `2.0.0` (the write path would
   reject it; this models "the library version was deleted after the save").

## Steps

1. Open `/workbench?editTest={id}`; dismiss the load-time "Test Issues Found" dialog.
2. The Shared node shows the missing-version alert badge.
3. Open Edit Config: a destructive `missing-version-banner` names `2.0.0`, and the
   version trigger shows `2.0.0` struck-through with a "Missing" chip.
4. Open the version dropdown and pick `1.0.0`. WITHOUT saving, the banner, the
   strikethrough, and the "Missing" chip all clear.
5. Save the modal. The canvas node's missing-version alert badge is gone.

## Validation

- Step 4 guards the live-clear fix: `selectedVersionMissing` is computed live from the
  selected vs fetched versions (not the stale load-time `element.missingVersion`).
- Step 5 guards the save badge-clear fix: `handleFunctionConfigSave` clears `missingVersion` and
  re-resolves the pinned contract instead of carrying the stale flag.
- Reproduce-first: reverting either fix leaves the banner/chip (step 4) or the
  node badge (step 5) present, failing the spec.
