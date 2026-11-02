# V-ARTIF-01: Artifact Browser (list + drill)

Verify the execution-first artifact browser landing list and the per-execution
drill (Failure / Reports / Logs / Files) against the wireframes.

## Prerequisites

The spec self-seeds via the API - no seed script. It imports
`tests/e2e/fixtures/artifacts/fixture.json` (a failing test that writes File I/O
artifacts under `data/`, emits an ERROR, and fails via `Assert(fail_current_scope)`),
runs it as a tracked execution, and generates `report.html` + `report.json`.

## Steps

1. Open http://localhost:3000/artifacts (search for the seeded execution name)
2. Open http://localhost:3000/artifacts/{executionId}

## Validation

- **Landing columns:** Execution, Type chip (entity icon + label), Status
  (dot + label), Finished, Artifacts (archive icon + count), Size
- **Grand total:** a filter-aware total-size chip in the header (`artifacts-total-size`)
- **Selection:** Mass Action -> row checkbox -> counter reads `X of Y · <size>`;
  the mass-action menu holds Download (.zip) + Delete artifacts only (no view/export)
- **Drill sections:** Failure summary, Reports, Logs, Files in that fixed order;
  the Failure summary carries a `1 failures` badge
- **Drill header:** the meta line (finished · count · size) renders inside the
  header block above the divider (not in the scroll body); an entity chip and a
  status-colored (error, not muted) status label; Download all (.zip) has a
  leading download icon
- **No preview:** no eye / preview / open-in-viewer affordance anywhere; each
  file row exposes only Download + Delete
- **Logs tree:** the failed test leaf is tinted red (`rgb(239, 68, 68)`);
  Tree|Flat toggle present on Logs + Files only (Failure/Reports are flat)
- **Files tree:** the `data/` directory node carries subtree Download + Delete
  (no preview slot) over indented leaves
- **Truncation:** a long file name clips to a hover popover (shared TruncatedName)
- **Soft-delete:** deleting a file hides it; Show removed reveals a muted, struck
  tombstone tagged `Removed` with no actions (no restore)
