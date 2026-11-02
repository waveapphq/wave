# V-FN-* (Function Lifecycle) - Functional tests

End-to-end coverage for the publish + detach lifecycle transitions. Each test
self-seeds its data via `POST /functions` (library entries) and `POST /tests`
(host Test); no shared seed script.

## Prerequisites

- Backend with `WAVE_ADMIN_ALLOWED=true` for the seed endpoints.
- The shared canvas helpers (`tests/e2e/helpers/canvas.ts`) are used directly:
  `dragSourceToCanvas` for the "New Function" handle and the Library card
  drag, `expandPalette` / `waitForCanvasLoad` for the navigation chrome.

## Files

| Spec | Lifecycle transition | Permutations covered | Regression-guard coverage |
|------|----------------------|----------------------|---------------------------|
| `v-fn-publish-functional.spec.ts` | local → shared | P1 saved+clean (BE path) / P2 saved+dirty (in-memory fallback) / P3 draft canvas (in-memory fallback) | Publish-on-draft is NOT silent; Publish-on-saved-dirty falls back; Test is not auto-saved by publish |
| `v-fn-detach-functional.spec.ts`  | shared → local | D1 saved+clean (BE path) / D2 saved+dirty (in-memory via GET /functions/{id}) | Make Local leaves library untouched; deep-copy lands on the canvas |
| `v-fn-lib-drop-functional.spec.ts` | library → canvas | a card dragged from the Functions Library; V-FN-LIB-CONTRACT: dropped on the Test flow, into a For Loop body, into a Local Function body, pasted, Quick Insert, a library Block inside a library body (drilled in a Test, library View, edit mode), a contract read that fails once | The new Block is a shared reference; its sheet lists the library Function's inputs right away (no reload), an input value saves (stored as an expression field) and the run prints it; inside a Local Function body the input is listed again after the Test is opened anew; a library Block stored with no contract inside a library body lists its inputs when the body opens and saves an input value in edit mode; a failed contract read blocks the page with "Could not load Function versions" until Try Again reads it |
| `v-fn-publish-locals-functional.spec.ts` | local → shared, edit mode → new version, library → canvas, shared → local | Publish to Library from Local / publish a new version from edit mode / drag a library Function onto the canvas / Make Local | Every transition keeps the Function's local variables: the stored body holds them, the library View lists them, and the run prints the local's value |
| `v-fn-regression-guards.spec.ts`  | n/a (bundle)   | POST /tests dup name returns 409 / GET /functions/tags is deduped sorted / Ctrl+A + Delete clears the selection | Three orthogonal guards that didn't fit on any single lifecycle wireframe |

## Steps + Issue mapping

### v-fn-publish-functional

1. **P1: saved + clean** - load a fixture with one local Function; open kebab → Publish to Library; fill name; submit. Assert: dialog closes, canvas node swaps to shared, library entry exists.
2. **P2: saved + dirty** - same fixture, then drag a fresh local Function so the canvas is dirty; publish that new node. Assert: in-memory fallback path creates the library entry, canvas node swaps, Test stays dirty (Save button enabled).
3. **P3: draft canvas** - open the workbench with no editTest query; drag a local Function; publish. Assert: dialog closes (no zombie), library entry created, canvas node is shared.

### v-fn-detach-functional

1. **D1: saved + clean** - load a fixture with one shared reference to a known library entry; open kebab → Make Local…; confirm. Assert: canvas node now local, library entry still exists.
2. **D2: saved + dirty** - open the Library modal; drag a card to make the canvas dirty; Make Local. Assert: in-memory detach via GET /functions/{id}, canvas node now local, library entry untouched.

### v-fn-publish-locals-functional

Seeds (API): blank `zz-` Tests; a `zz-` library Function whose local `fn_kept` = `kept-value` is read by its body Log; a Test holding that Function's Block under Start.

1. **Publish from Local** - drag a New Function under Start, add the local `fn_kept` and a Log printing it, kebab → Publish to Library; Save; Run. Assert: the publish is accepted, the run prints `kept-value`, the library View lists `fn_kept`.
2. **Edit mode** - kebab → Edit; drill in; add the local `fn_added`; kebab → Publish → Publish and set New. Assert: the new version stores `fn_kept` and `fn_added`, its View lists both, the re-pinned Test prints `kept-value`.
3. **Drag** - drag the library card under Start; Save; Run. Assert: the run prints `kept-value`.
4. **Make Local** - kebab → Make Local…; Save; Run. Assert: `localDefinition.variables` holds `fn_kept` = `kept-value`, the run prints it, the drilled row shows it.

## Validation

- Every assertion ties back to the `function-lifecycle/` wireframes or a regression guard.
- Each guard carries an inline `// regression guard: ...` comment naming the issue.
- No mutation of cross-test state happens beyond the seeded library entries (which are name-stamped with `Date.now()` + a random suffix so workers don't collide).
