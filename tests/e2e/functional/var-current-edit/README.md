# V-VMGR-CURRENT-EDIT Runtime Variable Override - Functional

End-to-end coverage of overriding a session variable's runtime value while a Debug run is paused
(REQ-3.2.1.6). A breakpoint pauses the run; the row
pencil opens the variable's one Edit window (VMGR-106), the value pill picks Current, the field takes a literal
override or a new expression source, and Save applies it to the live session. The watcher only shows values
(its Mode and View pills); it has no Edit of its own. Continue proves the override reaches downstream Blocks.

## Pre-requisites

- Backend on the per-worker port (Playwright fixtures).
- Frontend on the matching per-worker port.

## Execution Steps

1. POST `fixture.json` to `/tests` and assert `POST /tests/{id}/validate` returns zero errors.
2. Navigate to `/workbench?editTest={testId}`, expand the Variable Manager, set a breakpoint on `gate`, and
   start a Debug run; it pauses on `gate`.
3. While paused, check the `gate` kebab and right-click menus: Delete disabled, Toggle Breakpoint enabled.
4. Open the `factor` watcher (Current shows `10`). Pencil `factor`, pill Initial, field `99`, Save; the watcher's
   Current still reads `10`.
5. Pencil `count`, pill Current, field `7`, Save; the watcher shows `7` and `GET /workbench/{sid}/variables`
   returns 7. Reopen the window: it starts from `7`; Cancel.
6. Pencil `derived`, pill Current: the field shows `count * factor`; type `count + factor`, Save. The watcher's
   Expression view shows the new formula; the window reopens on it; the View stays on Expression.
7. Continue to the end; read the Console.
8. Separate tests: an override survives an ad-hoc Run Current and a full Run All seeds it away; an unsaved
   Current value in an open Edit window makes Continue ask first (Cancel / Drop Changes / Save Changes); Stop and
   Reset clear the paused halo.

## Validation Criteria

- The fixture validates with zero errors before any UI interaction.
- A literal Current override reaches the live session at once (`GET .../variables` returns the new value) and the
  downstream Log prints `count=7`, never `count=3`.
- An expression Current override re-arms the source: the downstream Log prints `derived=17` (`count + factor`),
  neither the definition's `70` nor the un-overridden `30`.
- Saving the Initial value while paused never moves the Current value; reopening the window starts from the
  active override; the watcher's Expression view shows the override source and keeps that View after an edit.
- The override survives an ad-hoc partial re-run (inherited, count 7) and a full Run All discards it (count 3).
- The conflict dialog names the variable: Cancel keeps the run paused with the window still holding the value;
  Drop Changes resets the window to the run's value and proceeds (`count=3`); Save Changes saves, closes the
  window and proceeds (`count=5` downstream and in the session read).
- While paused a Block keeps both menus with mutations disabled and Toggle Breakpoint enabled; Stop and Reset
  clear the paused halo.

## V-VMGR-CURRENT-EDIT-ELEMENT-TYPES

- Spec: `v-vmgr-current-edit-element-types.spec.ts`; fixture: `element-types-fixture.json`.
- Paused at `gate`, the watcher's Current view shows a typed map's numbers as numbers, its zip code as text and a
  19-digit whole number with every digit. The row pencil, pill Current and Open editor show the map in the "Edit
  value" sheet with every entry's type; the override keeps them in the running session, a second Current edit of
  the now-live map still starts from all 19 digits, the session read returns them exactly, and the downstream
  Log reads the override as a whole number and the 19-digit entry plus one exactly (REQ-3.1.3.19).
