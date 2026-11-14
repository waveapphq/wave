# V-CTRL-PARALLEL-03: Parallel Lane Rows

Verify that each Parallel lane row lines up with the If/Else name box and the Variable Setter value field, that an
{x} lane reads whole, and that a lane limit of 0 shows its message (PARALLEL-3, PARALLEL-5, FIELD-1, FIELD-16,
FIELDERR-1, FIELDERR-2). Spec: `tests/e2e/visual/canvas/v-ctrl-parallel-03.spec.ts`.

## Prerequisites

None - each test creates a `zz-ctrl-fields-` Test through `POST /tests` (seed in
`tests/e2e/visual/canvas/control-fields-seed.ts`), checks it validates with zero errors, opens it and deletes it
afterwards.

| Test | Parallel | Section Time Limit | Lanes | Join Mode |
|------|----------|--------------------|-------|-----------|
| `zz-ctrl-fields-lane-rows-` | `Check lanes` | not set | `api` 5000, `database` {x} `lane_limit * 2`, `cache` no limit | Wait for all |
| `zz-ctrl-fields-lanes-` | `Run checks` | 60000 | `ingest` 30000, `probe` 5000, `drain` 15000 | First to finish |

The `lane-rows` Test also holds the Test variable `lane_limit` (Integer, 30000).

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Open the Parallel's window from its cog.
3. `Check lanes`: click the {x} of `cache`.
4. `Run checks`: select `probe`'s time limit, type `0`, click the Description; click `+ Branch`; click the new lane's
   {x}.
5. Cancel the window and answer Close.

## Validation

- **Window:** 880 px wide
- **Name box:** fills the row between the BRANCH badge and the time limit, at most 201 px (199 px beside a 72 px
  badge); 40 px tall, radius 4, no {x}; the row ends 12 px inside the card
- **Time limit:** a 357 x 36 box, radius 8, in plain and in {x} mode, every box ending at the same x; numbers in the
  integer color
- **Icon columns:** the expand in its own 32 px column 8 px right of the box, empty on a plain lane; {x} 8 px further,
  at the same x on every lane and after a lane switches to {x}
- **{x} lane:** `database` shows `lane_limit * 2` whole, with no scrollbar
- **Headers:** `Name` and `Time limit (ms)` start at their boxes; 32 px spacers over the expand and {x} columns, a 64
  px one over the move and delete buttons
- **Section Time Limit:** a table row with its (i), `Section Time Limit`, `Integer`, `60000` in the integer color, an
  empty expand column and {x}
- **JOIN MODE:** `Wait for all` above `First to finish`, `First to finish` checked
- **Limit 0 (step 4):** `probe`'s box red, `0` still in the integer color, `Time Limit must be at least 1` 4 px under
  the box (12 / 16 px, destructive, whole), starting at the box; the card head 20 px taller; Save disabled with
  `Save is disabled: the settings have errors`
- **New lane (step 4):** `+ Branch` adds a lane whose box is empty with no hint (no `No limit`); its {x} switches
  with no question and sits at the same x as on the other lanes
- **Themes:** every check above in the dark and the light theme; a screenshot of the window is attached
