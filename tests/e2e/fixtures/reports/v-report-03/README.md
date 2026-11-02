# V-REPORT-03: Workbench Session Artifacts

Verify the live workbench session-artifact surface: the breadcrumb Artifacts
chip with its count badge, the floating Session Artifacts sheet (populated
rows, header meta, footer note, empty state), per-row hard delete without a
confirm, the artifact-guarded Reset Session confirmation (instant at zero
artifacts), and the artifact-loss callout inside the workbench close dialog.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No fixtures need to be pre-seeded; the spec imports `fixture.json` via
  `POST /tests` under a unique name and runs it in the workbench (untracked
  session run, not `POST /executions`).

## Fixtures

- `fixture.json` - One test with 2 nodes:
  - File I/O `Write Report JSON` (write `artifact://report.json`, JSON text)
  - File I/O `Write Nested Data` (write `artifact://output/data.json`,
    JSON text - the nested path drives the folder subtitle row)

## Steps

1. Import `fixture.json` via `POST /tests`; validate with zero errors;
   open `/workbench?editTest=<id>`.
2. Run via the workbench Run button; wait for terminal `passed`.
3. Open the Session Artifacts sheet from the breadcrumb chip.
4. Delete one row (no confirm expected).
5. Click Reset: cancel the `Reset Session?` dialog, then reset again via the
   canvas context menu and confirm.
6. Re-run, then click the workbench close (X) button and cancel.
7. Delete every remaining artifact, then Reset again (instant, no dialog).

## Validation

- **Step 2:** Chip badge shows `2`; backend
  `GET /workbench/session/artifacts` lists `report.json` and
  `output/data.json` with non-zero sizes.
- **Step 3:** Sheet header reads `2 files - <size>`; rows show the mono
  name, the `output` folder subtitle on the nested row only, formatted
  sizes, download + delete actions; the temporary-lifecycle footer note is
  present.
- **Step 4:** Row disappears with NO confirmation dialog, badge decrements
  to `1`, the backend listing no longer returns the deleted path (hard
  delete).
- **Step 5:** ONE `Reset Session?` alertdialog: exact description,
  exact singular callout copy, red-tinted `rotate-ccw` icon circle and a
  non-transparent amber callout background, Cancel keeps run state +
  artifacts; confirming from the canvas context menu resets: status `idle`,
  badge gone, sheet shows the empty state, backend session cleared. The
  legacy `Reset Workflow?` dialog appears nowhere.
- **Step 6:** The close dialog (`Active Execution State`) carries the
  plural callout and the `Reset and Close` action; Cancel preserves the
  artifacts.
- **Step 7:** With zero artifacts Reset is INSTANT from the breadcrumb link
  (no dialog of any kind) - warn suppression (zero path).
