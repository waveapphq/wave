# V-FIELD-TIME-PICKER: From / To and the Time Picker

Verify the OpenSearch From and To rows as the one value field with the clock icon, and the time picker that
From's expand opens (FIELD-9, FIELD-1, FIELD-2,
FIELD-3, OS-4).
Spec: `tests/e2e/visual/canvas/v-field-time-picker.spec.ts`.

## Prerequisites

None - each test creates a `zz-11541-s2-` Test through `POST /tests` holding one OpenSearch Block (Cluster URL,
Index pattern `logs-*`, From `now-15m`, To not set, Query language DQL, Mode Search), checks it validates with
zero errors, opens it and deletes it afterwards.

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Open the OpenSearch Block's window from its cog.
3. Scroll From to the top of the window and click From's expand.
4. In the picker type `30` into Amount, then Cancel.
5. Open the picker again, type `30`, Save.
6. Save the window, then Save the Test.

## Validation

- **From / To:** a gray clock icon inside each field on the left; expand (two diagonal arrows,
  `Open editor for From` / `To`) and `{ }` in their own columns
- **Values:** From `now-15m` in the string color with the reset icon; To not set shows `now` in Text Muted
  with no reset icon
- **Other rows:** Query language `DQL` and Mode `Search` with no expand and no `{ }`; Query empty with `{ }`
- **Picker:** Absolute / Relative / Now tabs, Relative pressed in the primary color; Amount `15`, Unit
  `minutes ago`, `Round to the minute` unticked; result line `now-15m`
- **Footer:** `Cancel` (outlined, 1 px border) then `Save` (primary fill), right-aligned, 32 px tall
- **Place:** below From's expand, right edges lined up, inside the window; To's and Query's `{ }` uncovered
- **Draft:** Amount `30` shows `now-30m` on the result line only; Cancel keeps `now-15m`; Save writes
  `now-30m` in the string color
- **Stored Test:** `from` is `now-30m`, `to` is absent
- **Themes:** every check above in the dark and the light theme; a screenshot with the picker open is attached
