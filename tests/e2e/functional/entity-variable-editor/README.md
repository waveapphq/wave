# V-ENTITY-VARIABLE-EDITOR-FUNCTIONAL

Entity-scope (Suite / System / Regression) variable value editing migrates onto the
shared bodies. The variable table's Value column now renders the
shared `VariableValueCell` (via `renderValueCell` -> `EntityVariableValueCell`): scalars
inline, string + array / map / table through the shared "Edit value" sheet, secrets
through the uniform masked clear-and-edit affordance. A complex value is authored in
the Visual body, so it round-trips with no "Must be valid JSON format" error.

## Prerequisites

- Backend + frontend running on the worker's ports.
- No pre-seeded fixtures; each test creates / clears its own suite, regression, or system vars.

## Steps

- Suite: seed a suite with an integer + a secret string; open Edit Variables; re-enter a
  19-digit integer inline; clear-and-edit the secret through the sheet; add an `array`
  authored in the Visual body; Save; reopen.
- System Variables: open the settings Edit dialog; convert the seeded row to an `array`
  authored in the Visual body; Save; read the API; reopen.
- Regression: open Edit Variables; add an `array` authored in the Visual body; Save; reopen.

## Validation

- The array is authored in the shared sheet's Visual body (array-add-item / array-edit-input),
  NOT a one-line JSON input; its preview shows `2 items`.
- On reopen, the array cell still shows `2 items` and the dialog shows NO `Must be valid
  JSON format` / `Must be a JSON array` error.
- Suite: the integer keeps exact text (`1234567890123456789`) through save + reload; the
  edited secret re-masks (`Edit protected value`).
- System: the persisted value is an actual array `["alpha","beta"]` (verbatim entity storage).

## V-ENTITY-VAR-ELEMENT-TYPES

- Spec: `v-entity-var-element-types.spec.ts`; fixture: `element-types-probe.json`.
- A Suite, a Regression and a System map variable keep the type picked for every row through save and reopen, and a Test in the Suite reads `suite.m`, `regression.m` and the System map with every element as its declared type; a Suite integer scalar reads as a number too (REQ-3.1.3.19). Destructive: creates and deletes its own System variable.
