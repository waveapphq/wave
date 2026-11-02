# V-CANVAS-FN-CFG-04: Function Block Window - Inputs by Kind

Verify how the Function Block window draws each input and output (REQ-3.1.1.5,
REQ-3.1.3.20, REQ-3.1.2.9, REQ-3.1.2.11; FNCFG-6, FNCFG-7). Spec:
`tests/e2e/visual/canvas/v-canvas-fn-cfg-04.spec.ts`.

## Prerequisites

None - the spec seeds its own `zz-` Tests through `POST /tests` and its library Functions through
`POST /functions`, opens `/workbench?editTest={id}`, and deletes the Tests, the library Functions
(with `cascade=true`) and the workbench session afterwards. Seeds:

- a Local Function whose optional integer input `n_int` is stored with `default: null`; one with
  the integer input `k_int` and the float input `k_float`, each stored with `default: null`;
- an empty Local Function, whose inputs of every free-entry field kind (string, integer, float,
  array, map, table) the spec creates in the input window with Set to null;
- a library Function whose inputs of every free-entry field kind are stored with `default: null`;
- a Local Function and a library Function whose inputs of every field kind hold a default;
- a Local Function `fetch_token`: secret input `api_key` holding a literal, Integer enum input
  `retries` (`1`, `2`, `10`) holding `2`, plain input `region`, secret output `token`; and a Log
  block beside it.

## Steps

1. Read the stored Test back (`GET /tests/{id}`).
2. Double-click the Function to open its Function Block window.
3. Read each row in its literal widget, then switch it to the expression field.
4. Created-null test: dig into the Function, add one input per field kind with Set to null, go
   back to the Test, Save, then open the Function Block window.
5. Wireframe tests: read the `api_key`, `retries` and `token` rows; open the Log block's sheet to
   compare its Level select; untick Secret on `token`, Save, and reopen.

## Validation

- **Stored input:** `n_int` keeps `default: null`; every input created with Set to null is stored null
- **Literal opening:** every input opens as its literal widget
- **Null default:** every free-entry field kind shows its box holding no text with the italic gray
  `null` and the null button pressed; switched, an empty expression field with no placeholder
- **Held default:** every free-entry field kind shows its default in gray (a table as its rows' JSON
  without quotes), Local and library; the true / false input shows its default as a value, never
  gray
- **Secret input:** `Edit protected value` with the pencil and eight dots, the lock with the
  literal tooltip, the expression button; the stored literal never shows
- **Enum input:** a select showing `2`, options `1`, `2`, `10` in order, required star,
  expression button; its trigger draws exactly as the Log block's Level select
- **Secret output:** `token` opens with Secret ticked; unticked and saved, it reopens unticked
