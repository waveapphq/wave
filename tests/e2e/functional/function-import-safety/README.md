# Function Import Safety Functional Tests

Verifies the Function import path is safe against manually-edited files end-to-end
against the real backend. Complements `functions-import-export/` (round-trip +
name-conflict resolutions) with the id-collision and history-preserving
overwrite contract.

| Spec | Anchor |
|------|--------|
| `v-fn-import-entry-problems-functional.spec.ts` | REQ-3.1.2.5, REQ-3.1.2.11 - a ZIP of three entries, each with a problem of its own (an input with no type, the version `one.two`, an enum input with no allowed values), goes through the Functions page Import dialog: Validate marks each Blocked with `0 importable, 3 blocked` and Import off, the dry run names `Function input 'who' is required and missing a type`, `Invalid version 'one.two'; expected a valid semver` and `Enum input 'level' has no allowed values`, a commit of the same file skips each entry with that message and the library holds none of them. |
| `v-fn-import-safety-functional.spec.ts` | REQ-3.1.2.5 - idempotent round-trip (same id restored); a UUID-colliding file is a conflict on the id axis (`conflict_reason: "id"`); rename mints a fresh uuid and leaves the colliding entry untouched; skip reports `UUID '<id>' already exists in the library` and changes nothing; overwrite targets the colliding id without a duplicate; overwrite upserts versions so available = existing UNION imported; a full-history export re-imported under overwrite is lossless. |

## Prerequisites

- Backend running on port 8000 (or `WAVE_E2E_BACKEND_PORT`).
- Frontend running on port 3000 (or `WAVE_E2E_FRONTEND_PORT`).
- No external seed script - the spec self-seeds via `POST /functions` (and
  `POST /functions/{id}/versions` for multi-version entries) under a per-run name
  prefix and isolates on the backend-assigned ids.

## Steps

1. Seed library Functions via `POST /functions`; add versions via
   `POST /functions/{id}/versions`.
2. Craft an import document whose `id` equals a seeded entry's id (an id
   collision) or whose `name` equals a seeded entry's name.
3. Dry-run via `POST /functions/import/validate`; commit via
   `POST /functions/import` with the relevant `conflict_resolutions`.
4. Read back the entry via `GET /functions/{id}` to assert its name and
   `available_versions` are exactly as expected.

## Validation

- A clean re-import after delete reports `action: created` and the SAME id.
- An id-colliding file validates as `conflict_reason: "id"`; rename reports
  `action: renamed` with a new id, the original entry keeps its name and single
  version, and the renamed copy is a separate entry.
- skip reports `total_skipped: 1` with reason
  `UUID '<id>' already exists in the library` and leaves the original unchanged.
- overwrite reports `action: overwritten` against the colliding id (no second
  entry) and the existing version survives.
- An overwrite from a single-version file keeps the library-only versions
  (available = existing UNION imported); a full-history export re-import is lossless.

## Out of scope (covered elsewhere)

- The intra-batch dependency remap (a renamed dependency rewired in its
  dependents inside a ZIP batch) is a ZIP-only behavior with no E2E ZIP-writer
  available. It is covered at the service layer by
  `backend/tests/api/services/functions/test_import_collision.py`
  (`TestIntraBatchDependencyRemap`).
