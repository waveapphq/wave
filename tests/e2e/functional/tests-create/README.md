# V-TESTS-CREATE: making, copying and removing a Test

End-to-end proof for the Test entity's own lifecycle from the Tests list and
the new-test gesture: the redirect that opens a blank canvas, the two refusals
that stop New Test when the workbench session cannot be read or cleared, the
duplicate-node-id refusal on the write path, and - in
`v-tests-clone-testdata.spec.ts` - the rule that a test's data files are part
of the test, so Duplicate copies them and Delete takes them away.

- `v-tests-new-redirect.spec.ts` - `/tests/new` and the Dashboard's Create Test
  quick action both land on a blank workbench canvas.
- `v-tests-new-session-not-cleared.spec.ts` - a failed session clear refuses New
  Test, raises a toast carrying the server's reason, and leaves the session
  standing.
- `v-duplicate-node-id-validation.spec.ts` - a workflow whose nodes repeat an id
  is refused by validate with `DUPLICATE_NODE_ID` and a unique-id fix action.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service: every leg drives WAVE's own API and UI, so nothing from
  `tests/e2e/services/` is required
- No checked-in fixtures: each spec builds its workflow in TypeScript through
  the node factories in `helpers/k8s-nodes.ts` or posts a literal document

## Isolation on the shared stack

Every spec creates its own uniquely named Tests through `POST /tests`, uploads
its own data files through `POST /tests/{id}/testdata/upload` (one file per
request), and deletes what it made in teardown - the delete cascades and takes
the test's data folder with it. The Tests list is filtered by the spec's own
unique name before any row is touched, so a shard with many tests cannot hide
the row behind pagination. No server state is reset.

## Steps

1. Seed the Test (and, where the case needs them, its data files) through the API
   and confirm `POST /tests/{id}/validate` reports zero errors
2. Drive the gesture under test - `/tests/new`, New Test, or the row overflow
   menu on the Tests list
3. Read the outcome back from the server, from the canvas, or from the Test Data
   sheet
4. For the clone case, open the copy in the workbench and run it

## Validation

- **Blank-canvas redirect:** `/tests/new` lands on `/workbench` with the start
  node and the onboarding placeholder
- **New Test refusals:** a failed session read and a failed session clear each
  raise their own toast carrying the server's reason, open no form, and leave
  the session standing
- **Duplicate node id:** `POST /tests/{id}/validate` reports `DUPLICATE_NODE_ID`
- **Clone copies the files:** the clone's listing carries the same relative
  paths and byte sizes, its Test Data sheet lists both entries, and a run of the
  clone resolves `testdata://` against the clone's own folder even after the
  source is deleted
- **Delete cascades:** `GET /tests/{deleted id}/testdata` answers 404 `NOT_FOUND`
  with `Test not found: {id}` - not an empty listing
