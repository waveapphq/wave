# V-FIELD-SWITCH-WARNING: The Switch Warning

Verify the dialog asked before a field that holds a value switches to {x}
(FIELD-7). Spec:
`tests/e2e/visual/canvas/v-field-switch-warning.spec.ts`.

## Prerequisites

None - each test creates a `zz-11541-s1-switch-warning-` Test through `POST /tests` holding the Local Function
Block `deploy_check` (seed in `tests/e2e/visual/canvas/deploy-check-seed.ts`; `owner` holds `qa-team` over the
default `platform`, `prefix` holds empty text with no default), checks it validates with zero errors, opens it and
deletes it afterwards.

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Open `deploy_check`'s window from its cog.
3. Click `owner`'s {x}; answer Cancel.
4. Click `prefix`'s {x}; answer Cancel.
5. Cancel the window.

## Validation

- **Backdrop:** the Block window sits under a dark see-through layer
- **Icon and texts:** red X on top; title `Switch the field to an expression?` in the normal title color, not
  the accent; body `The current value is cleared.`; no field name in the dialog
- **Buttons, owner:** `Cancel`, `Clear & Default`, `Clear & Empty` left to right on one row, each label on one
  line; `Clear & Default` outlined; `Clear & Empty` the primary button; focus on `Cancel`
- **Buttons, prefix:** `Cancel`, `Clear`, `Clear & Empty`
- **Cancel:** `owner` keeps `qa-team` and `prefix` keeps `<empty string>`, both in plain mode; Save stays disabled
- **Stored Test:** unchanged
- **Themes:** every check above in the dark and the light theme; a screenshot of the dialog is attached
