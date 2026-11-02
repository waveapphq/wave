# V-FLOAT-PRECISION Float Decimal Pipeline - Functional

End-to-end coverage of the float half of REQ-3.1.3.14 (exact numeric precision, no IEEE-754
rounding). A long float
carried as an exact string survives storage, realization, the WS push, and display un-rounded; an
expression deriving from it stays exact; a Variable Setter overwriting a float mid-run updates the open
watcher; a rename in the variable's window (VMGR-106, VMGR-108) persists and refactors references from
either value view; a live Current float value set in the window propagates downstream.

## Pre-requisites

- Backend on the per-worker port (Playwright fixtures).
- Frontend on the matching per-worker port.

## Execution Steps

1. POST `fixture.json` to `/tests` and assert `POST /tests/{id}/validate` returns zero errors.
2. Navigate to `/workbench?editTest={testId}`, expand the Variable Manager.
3. Pipeline test: stage the `rate` watcher, select the environment, Run to `passed`; assert the watcher
   Current value, Compare panes, GET variables, and the Logs are all the exact strings (`price`
   un-rounded, `total = price + 0.01` exact, `rate` overwritten to `21.5892`); `price` shows no Compare
   delta.
4. Rename test: Run to `passed` (live session), open the `total` watcher on Current, open its window
   from the pencil (the pill reads Current), rename to `grand_total`, Save; Save the Test, read it back,
   reload; then rename `grand_total` to `final_total` from the row pencil (the pill reads Initial) and
   Save the Test again.
5. Current value test: breakpoint `gate`, Debug to the pause, open the `price` window from its Current
   watcher, set `-1.5`, Save, Continue; assert the Logs print `price=-1.5` and the derived
   `total=-1.49`.

## Validation Criteria

- The fixture validates with zero errors before any UI interaction.
- A float value carries end-to-end as the EXACT input string with plain decimal notation (no rounding,
  no `E`/exponential): the stored value, the GET-variables runtime value, the watcher display, and the
  Log all read `-2123.123213123123699999`.
- The derived expression `price + 0.01` evaluates exactly to `-2123.113213123123699999` (a double
  would round both operands).
- A Variable Setter overwriting `rate` (19.99 -> 21.5892) updates the open watcher's Current value and
  Compare view; the `variable_changed` WS push carries the Decimal as a plain string.
- An unchanged float shows the same value in both Compare panes and NO delta metric.
- A rename made on the window's Current view persists (row + definition renamed, the `read-total` Log
  reads the new name) and survives a reload; a rename made on the Initial view persists too.
- A live Current float value set in the window applies to the session immediately
  (`GET .../variables` returns `-1.5`) and propagates downstream (`price=-1.5`, `total=-1.49`).
