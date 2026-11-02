# V-CONSOLE-TABLE-RENDER Console Table Render - Functional

End-to-end coverage of how a Table logged to the run console is drawn: aligned
columns with two header lines (names, then column types in full), one dash rule
per column, numbers right-aligned and strings left-aligned. Five caps bound the
rendering - rows, columns, per-cell length, per-column width and a whole-message
backstop - and each one announces what it cut instead of cutting silently.

The same run also proves the secret rule: a cell is masked BEFORE the column
widths are measured, so the padding cannot disclose how long a protected value
is and no cap can cut a secret into a prefix the masker no longer matches. The
second spec proves the stored execution record carries the same masked
rendering, which is where the rendered table used to be written unmasked.

## Pre-requisites

- Backend on the per-worker port (Playwright fixtures).
- Frontend on the matching per-worker port.
- No external service: every leg converts text in-process.

## Execution Steps

One fixture, one workflow. Five CSV parses each bind their table output to a
table variable, and a Log block writes that variable to the console, so each
console entry is a real rendered table.

1. `align` - a 3-column table (string / integer / float) whose longest cell is
   28 characters.
2. `rowcap` - a 12-row table (the row cap is 10).
3. `colcap` - a 14-column table (the column cap is 12).
4. `cutcap` - one row holding a 60-character cell (over the 40-character column
   cap) and a 250-character cell (over the 200-character cell cap).
5. `secret` - one row whose middle cell is the value of a declared secret
   variable, composed at run time so the stored Test carries no plaintext.
6. `backstop` - a Log of a 20000-character string (the message cap is 16384).
   The spec writes that value into the fixture before importing it, so
   `fixture.json` stays readable.
7. `done` - the run's bookend marker, `CONSOLE-TABLE-RENDER-DONE`.

The first spec runs the workflow from the workbench and reads the console. The
second imports the same fixture, starts a tracked run through the API, and reads
the persisted variables of the finished execution.

## Validation Criteria

- The fixture validates with zero errors and both runs pass.
- Align: the rule line is three separate dash runs, the first column is 28 wide
  (not a fixed width), the 28-character value shows in full, the types line
  reads `string` / `integer` / `float` in full, `web` pads on the right and `12`
  pads on the left. The whole rendering matches its golden lines.
- Row cap: exactly 10 rows render, the last line reads `... and 2 more rows`,
  and rows 11 and 12 appear nowhere.
- Column cap: exactly 12 columns render, the last line reads
  `... and 2 more columns`, and column 13 appears nowhere.
- Cut caps: the 60-character cell renders as its first 37 characters plus `...`
  in a 40-wide column, the 250-character cell renders as
  `a 250-character value`, and neither raw value appears.
- Backstop: the long message ends with `... and 3680 more characters`, keeps its
  head token and has lost its tail token.
- Secret: the cell renders as `********`, its column is 8 wide (the mask width,
  not the 31-character value), and the plaintext appears nowhere in the entry.
- Stored record: `GET /executions/{id}/variables` returns the secret table as
  rendered text, its column is again the mask width, and the plaintext appears
  nowhere in the payload.

## Notes

- Assertions read each console entry's `data-copy-text` through
  `getLogCopyTexts`, never its text content. Only the copy attribute preserves
  the newlines the layout is made of; `getLogTexts` flattens them and would pass
  an assertion that proves nothing about alignment.
- The discriminators against the previous renderer are the full 28-character
  value, the full type names and the per-column rule. That renderer cut cells at
  15 characters with no marker, abbreviated types to three letters and drew one
  fixed-width rule.
- Known and accepted, deliberately NOT asserted: below roughly an 1800px window
  the console line wraps and the columns stop lining up on screen. The copy text
  the spec reads is unaffected.
- The golden lines in the spec are the exact output of the backend renderer for
  these fixtures. The same wording is pinned by the backend unit tests in
  `backend/tests/core/test_table.py` and `backend/tests/core/test_log_formatter.py`.
- `fixture.json` and the spec share three literals: the 60-character and
  250-character cut cells, and the secret value. Change one and change the other.
