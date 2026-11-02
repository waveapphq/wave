# Function Import/Export Functional Tests

Verifies Function export/import works end-to-end against the real backend,
rebuilt to the Tests/Suites per-feature pattern.

| Spec | Anchor |
|------|--------|
| `v-fn-import-export-functional.spec.ts` | REQ-3.1.2.5 - single YAML/JSON export, ZIP export for 2+, dry-run validate (persists nothing), import commit, conflict resolutions (skip / overwrite / rename), dependency-ordered batch, and the `/functions` Import dialog round-trip. |

## Prerequisites

- Backend running on port 8000 (or `WAVE_E2E_BACKEND_PORT`).
- Frontend running on port 3000 (or `WAVE_E2E_FRONTEND_PORT`).
- No external seed script - the spec self-seeds via `POST /functions` under a
  per-run name prefix and cleans up by deleting what it created.

## Steps

1. Seed Functions via `POST /functions`.
2. Export via `GET /functions/{id}/export` and `POST /functions/export`.
3. Validate via `POST /functions/import/validate` (dry-run) and commit via
   `POST /functions/import` (with `conflict_resolutions` where relevant).
4. For the UI round-trip, open `/functions`, click Import, upload the exported
   file, validate, and commit.

## Validation

- Single export contains the Function name (YAML + JSON content type).
- 2+ ids return `application/zip`; the ZIP re-imports both Functions.
- Validate reports `items` but persists nothing; commit creates / overwrites /
  renames per the conflict resolution.
- A dependent pair imports dependency-first (the dependency before its dependent).
