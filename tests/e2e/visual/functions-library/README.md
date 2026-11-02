# Function Library Visual + Functional Tests

Visual/interaction tests for the Function library list page, detail page, the
config-modal fixes, and the semver publish rules. Run in BOTH the no-data light
and dark projects, so theme-sensitive guards (the long-text wrap) are covered in both themes.

| Spec | Anchor |
|------|--------|
| `v-lib-01.spec.ts` | REQ-3.1.2.1 - `/functions` list (search, row actions, pagination, empty state); global name + semver version sort; long-description clip + popover. |
| `v-lib-detail-01.spec.ts` | REQ-3.1.2.3 - detail page (version select, ungated delete, sections, I/O descriptions); long-text wrap; usage count; usage nav; single by-version request + collapsed majors; metadata row + nav Usage header. |
| `v-fn-config-01.spec.ts` | REQ-3.1.2.4 - config modal FNCFG-2 (info on inputs + outputs), FNCFG-1 (aligned tables), FNCFG-4 (shared and edit-mode params populate). |
| `v-fn-publish-semver-01.spec.ts` | REQ-3.1.2.2 - full semver accepted + pre-release ordered below its release; VIEW-9 publish target at/below the latest of its major line rejected. |
| `v-lib-import-conflict-01.spec.ts` | REQ-3.1.2.5, FNLIST-12 - the shared Import dialog review row renders the conflict-reason sublabel ("ID already in library" / "Name already in use" / "Name and ID already in library") with the Auto-rename default; a clean row carries no sublabel and no resolution control. |

## Prerequisites

- Backend running on port 8000 (or `WAVE_E2E_BACKEND_PORT`), `WAVE_ADMIN_ALLOWED=true`.
- Frontend running on port 3000 (or `WAVE_E2E_FRONTEND_PORT`).
- No external seed script - each spec self-seeds via `POST /functions` (and
  `POST /functions/{id}/versions` / `POST /tests`) under a per-run name prefix.

## Steps

1. Seed the Functions / Tests the spec needs via the REST API.
2. Navigate to `/functions`, `/functions/{id}`, or open a Test in `/workbench`.
3. Drive the surface (search, sort, paginate, open a version, open the config modal).

## Validation

Each spec defines its pass criteria in the file docstring. Each regression
guard carries an inline comment naming the bug it guards.
