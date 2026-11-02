# V-SHEET-03: Sheet reopen affordance (raise + pulse)

Pressing the control that opened a sheet while that sheet is still open brings it
back to the front and pulses it once (`animate-sheet-select-pulse` on the sheet
root); it never opens a second copy. Covers the workbench sheets (S1, S2) and
the sheets opened from a config sheet (S3, S4).

## Prerequisites

- No seed script. Tests that need a canvas import their own Test through
  `POST /tests` (fixture built inline by `buildFixture`) and delete it in `afterAll`.
- `DELETE /workbench/session` before every test.

## Fixture

Built inline: one Log block (`log-node-1`, message `hello`), one SFTP block
(`sftp-node-1`) on Download with Source `/srv/in/a.txt` and Destination
`artifact://out/a.txt`, and one Test variable `greeting`.

## Steps

1. **S1a**: open the Function library from the palette, press its button again.
2. **S1b**: open the Log's config sheet, park it clear of the node, double-click
   the node again, then use the gear Configure action.
3. **S1c**: open the `greeting` watcher, move it off its row, re-open the row.
4. **S1d**: open Session Artifacts from the breadcrumb chip, press the chip again.
5. **S2**: open Session Artifacts, then the Function library over it; press the
   Artifacts chip again.
6. **S3**: open the SFTP config sheet; press Destination's edit control; click
   the config sheet's header; press the edit control again. Click the header;
   press Destination's Browse; click the header; press Browse again.
7. **S4**: open the SFTP config sheet; press Profiles; click the config sheet's
   header; press Profiles again.

## Validation

- **S1**: each second press pulses the open sheet (the class clears on
  animationend) and leaves exactly one copy of it.
- **S2**: the back sheet takes `data-active="true"` from the front one; one copy
  of each.
- **S3**: after the second press of the edit control there is exactly one
  `value-editor-sheet`, it carries `data-active="true"` and the pulse, and
  `element-config-sheet` no longer carries `data-active`. Browse replaces the clean
  Edit value sheet with the picker (a field holds one of the two at a time); after
  the second press of Browse there is exactly one `file-reference-picker-sheet`
  with `data-active="true"` and the pulse, and the config sheet has no
  `data-active`.
- **S4**: after the second press of Profiles there is exactly one
  `profile-binding-sheet` with `data-active="true"` and the pulse, and the config
  sheet has no `data-active`.
- The pulse is a 750 ms animation, so S3 and S4 watch the sheet root's class
  with a MutationObserver installed before the second press instead of sampling it.
