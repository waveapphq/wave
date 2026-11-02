# Function View Functional Tests

End-to-end coverage of the read-only library View canvas: standalone run/edit/
publish lifecycle plus four regression guards (fold, renav, no-dirty,
dirty-switch). Each spec self-seeds via REST.

| Spec | Covers |
|------|--------|
| `v-fn-view-run-functional.spec.ts` | Standalone Run (declared defaults + console log), Run the edited draft, Publish a patch (View switches, library gains 1.0.1), and the read-only Create-Parameter guard. |
| `v-fn-view-edit-publish-functional.spec.ts` | Fold guard: adding an input forces a non-patch bump and the published version keeps the input. |
| `v-fn-view-renav-functional.spec.ts` | The View never auto-saves nor restores the Test draft store; View->Tests->View keeps the body and preserves a real draft. |
| `v-fn-view-nodirty-functional.spec.ts` | A clean View raises no switch dialog when a Test is opened afterwards. |
| `v-fn-view-switch-functional.spec.ts` | Dirty-switch protection across all four Test/Function combinations and both dialog entry points. |
| `v-fn-view-run-refused-functional.spec.ts` | A View edit-mode draft the save rules refuse (two Logs read names the Function does not declare) is refused before it starts. |
| `v-fn-view-run-secret-functional.spec.ts` | A View run of the Published version and of an edit-mode draft uses each secret's real value (secret local, secret output default). |
| `v-fn-view-breadcrumb-functional.spec.ts` | Drilled into an inner Function inside the View (read-only and edit mode), the root Function segment and the back arrow each show the outer body again, drop the inner segment, and keep the page on the View (FN-BC-3, FN-BC-4). |

## Prerequisites

- Backend on port 8000 (or `WAVE_E2E_BACKEND_PORT`); frontend on 3000 (or `WAVE_E2E_FRONTEND_PORT`).
- Run specs (`v-fn-view-run`, `v-fn-view-run-refused`, `v-fn-view-run-secret`) need the shared E2E environment (`ensureEnvironment`).
- No external seed - each spec POSTs its own library Function (and Tests where needed).

## Steps

1. Seed a published Function (and Tests for the switch/no-dirty specs).
2. Open the read-only View (`/workbench?viewFunction={id}&version={v}` or the
   detail-page "View workflow" button).
3. Drive Run / Edit / Publish / navigation and assert on the console, the
   library version list, the canvas body, and the switch dialog wording.

## Validation

- Run: the console shows the declared-default value, then the edited marker after a draft run; the library gains `1.0.1`; the read-only Create-Parameter affordance is absent.
- Edit-publish: the suggested bump is not a patch; the published version's inputs include the added one.
- Renav: `localStorage['wave-workbench-draft']` is never auto-written by the View and a real draft survives the round trip.
- No-dirty: `switch-test-dialog` count is 0 and the chosen Test loads.
- Switch: the dialog names the currently-open entity (`The test` vs `The function`); Tests offer Save & Open New, Functions offer Keep Editing only.
- Run refused: Run answers `Function draft has 2 validation error(s)` and lists each error naming its Block; the Run Error toast shows the same summary; nothing runs (the untouched Log prints nothing, the run status stays idle).
- Run secret: both runs print each secret's real length and last six characters (never the sealed envelope or `********`), and no console line holds either value or an envelope.
- Breadcrumb: after the root segment click or the back arrow, the URL is still `/workbench?viewFunction={id}`, the breadcrumb reads only the outer name (one Function segment), the outer Blocks show and the inner Log does not; in edit mode Publish is still shown.
