# V-ROOT-VAR-DELETE-CONFIRM: Root Variable Delete Confirmation Dialog

Deleting a root (Test) variable must open the Delete-variable confirmation
dialog regardless of whether any element references the variable. Reproduces a
regression in which the modal disappeared at the Test root after recent
variable manager edits.

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using
`fixture.json` (one root Log node whose `message` references root variable
`mytest`).

## Steps

1. Seed the fixture and open `/workbench?editTest={id}`.
2. Hover the `mytest` row in the Variable Manager and click its delete
   affordance.
3. Verify the Delete-variable confirmation dialog opens and contains the
   reference-count copy ("variable is used by 1").
4. Re-seed the fixture in a fresh page, create a second root variable
   `unused_var` via `+ Add`, then click its delete affordance.
5. Verify the Delete-variable confirmation dialog opens for the unreferenced
   row as well (always-confirm contract).

## Validation

- The first scenario asserts the Delete-variable dialog opens and surfaces the
  reference count for a referenced root variable.
- The second scenario asserts that the same confirmation dialog opens even when
  the variable has no references; the previous "confirm only if referenced"
  shortcut was the bug being reproduced.
