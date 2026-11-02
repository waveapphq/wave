# V-FIELD-VARIABLE-REQUIRED: The Red Star and the Name Error on Open

Verify the New variable window marks Name as required and shows its error from the moment it opens
(FIELD-12). Spec:
`tests/e2e/visual/canvas/v-field-variable-required.spec.ts`.

## Prerequisites

None - each test creates a `zz-11541-s1-variable-required-` Test through `POST /tests` holding the String
variable `greeting` read by one Log Block, checks it validates with zero errors, opens it and deletes it
afterwards.

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Variable Manager "+ Add".
3. Type `release_tag` as the Name, then empty it.
4. Cancel the window (answer Close if it asks).

## Validation

- **Star:** `Name` followed by a red `*`; the field is named "Name required" for screen readers
- **Name error on open:** the empty Name field shows `variable_name`, outlined in red and marked invalid;
  `Name is required` in red right under it, before any key or click
- **Create:** disabled on open
- **Rest of the window:** `New variable`; Type `String` with `Text value`; Kind `Literal`; `Mark as secret (value
  will be masked)` and `Set to null` unticked; Value field with the Open editor expand (two diagonal arrows) right
  of it; Cancel then Create
- **Follows the Name:** a typed name takes the error and the red outline away and enables Create; emptying it
  brings them back and disables Create
- **Themes:** every check above in the dark and the light theme; a screenshot of the window is attached
