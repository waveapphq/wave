# V-FN-COMPOSITION-GUARDS (functional)

Regression guards for the two composition checks the recursive validation
walker adds (REQ-3.1.2.4):

- **`EDIT_MODE_DRAFT_IN_BODY`** - a Function body holding a nested
  Shared instance still in edit mode is publish-blocked. A top-level edit-mode
  instance (the normal edit flow) and a clean nested instance are NOT flagged.
- **Circular Function reference** - publishing a version whose body
  calls its own Function, directly or through another Function, is refused with
  `Circular Function reference: <name> -> ... -> <name>` (the Function names, the
  same text the Function import gives a circle) and the version is not stored.
  An acyclic chain publishes, and a Test that uses it validates without
  `SELF_REFERENTIAL_FUNCTION`. Through the UI, publishing an edit-mode draft of F
  whose body calls G (and G calls F) shows that text on the publish dialog.

## Prerequisites

- Backend with `WAVE_ADMIN_ALLOWED=true` (the admin bulk endpoint raw-persists
  the broken Tests, bypassing save validation).
- Helpers from `tests/e2e/helpers/fn-seed.ts`: `publishLibraryFunction`,
  `rawPersistTest`, `validateTest`, `codesOf`, `localFunctionNode`,
  `sharedNode`, `startEdge`.

## Seeding notes

- Cyclic / nested-edit-mode Tests are raw-persisted via `POST /admin/bulk/tests`
  (the import / hand-edited-file path) because `POST /tests` would reject them.
- Circular bodies are sent to `POST /functions/{id}/versions`, which runs the
  circular check on the body and answers 422, so a circle is never stored.
- Every library Function carries the run token in its name and is deleted in
  `afterAll` with `?cascade=true`.
- The UI case seeds its Test through `POST /tests` (validated with zero errors)
  and opens it with `openTest`, which clears the workbench session first.
- Assertions use `POST /tests/{id}/validate?context=run`; the walker runs in
  every endpoint context and `run` surfaces the findings as a 422 error list.

## Validation

- Draft in body: the nested case asserts `EDIT_MODE_DRAFT_IN_BODY` is present and
  carries a `function_path` + ties to the nested node; the top-level and clean cases
  assert it is absent.
- Circular reference: the direct + transitive cases assert the 422 answer, the
  whole message `Circular Function reference: <path of Function names>` (a self-reference reads
  `<name> -> <name>`), and that the Function still holds only 1.0.0; the acyclic
  chain asserts the new version is the latest and `SELF_REFERENTIAL_FUNCTION` is
  absent. The UI case enters edit mode on a Shared instance of F, drills in,
  drops G from the Functions Library after the body's Log, publishes from the
  kebab ("Publish and set New") and asserts the outcome dialog's error line reads
  `Circular Function reference: F -> G -> F`, F still holds only 1.0.0, and
  `POST /functions/import/validate` with a document of F calling G blocks it
  with the same text.
- Each `test()` carries an inline `// regression guard: ...` comment naming the
  issue.
