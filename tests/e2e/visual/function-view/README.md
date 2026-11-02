# Function View Visual Tests

DOM-assertion coverage of the read-only library View canvas: chrome, the
Function-only breadcrumb, the edit-mode Publish button, the single-outcome
publish confirm, and the FunctionSquare palette icon. Each spec self-seeds via
REST under a unique name, so they slot into the no-data phase.

| Spec | Design | Covers |
|------|--------|--------|
| `v-fn-view-01.spec.ts` | VIEW-1, VIEW-2 | Read-only chrome + Function-only breadcrumb; action bar drops Save/Edit, keeps Close. |
| `v-fn-view-02.spec.ts` | VIEW-6 | Edit-mode chrome: primary-blue Upload Publish button, rightmost in the cluster. |
| `v-fn-view-03.spec.ts` | VIEW-7 | Single-outcome publish confirm (Cancel + Publish), not the three-option dialog. |
| `v-fn-view-04.spec.ts` | VIEW-8 | FunctionSquare palette icon in both the collapsed and expanded palette. |

## Prerequisites

- Backend on port 8000 (or `WAVE_E2E_BACKEND_PORT`); frontend on 3000 (or `WAVE_E2E_FRONTEND_PORT`).
- No external seed - 01-03 POST their own library Function; 04 only needs the workbench palette.

## Steps

1. Seed a published Function (01-03) and open the read-only View
   (`/workbench?viewFunction={id}&version={v}`, or via the detail-page "View
   workflow" button for 01).
2. Assert the chrome / breadcrumb / Publish affordance / palette icon.

## Validation

- 01: `action-bar-edit-function-button` + Read-only pill visible; breadcrumb shows the Function name with no parent links; `toolbar-save-button` / `toolbar-edit-button` absent; `toolbar-close-button` enabled.
- 02: `action-bar-publish-button` is `bg-primary` with `svg.lucide-upload`, positioned right of Drop changes.
- 03: the `Publish a new version?` AlertDialog shows `v1.0.0 -> v1.0.1` with `publish-outcome-single-confirm` + Cancel only.
- 04: both `palette-icon-library` and `palette-blocks-library-button` contain `svg.lucide-function-square`; no `svg.lucide-blocks`.
