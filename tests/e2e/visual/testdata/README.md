# V-TESTDATA-01: Test Data chip, sheet and file-reference picker

Verify the workbench Test Data chip, the populated Test Data sheet and the four
modes of the file-reference picker (TDATA-3, TDATA-4, TDATA-5, TDATA-7,
TDATA-8, TDATA-9, TDATA-11).

## Prerequisites

Self-seeds via the API - no seed script. Creates one test whose workflow holds
four File I/O blocks (Write, Read, Copy, List, all on `artifact://`) plus a Log
bookend, creates the `fixtures` folder, uploads three small files one request at
a time (`path`, `replace`, then the file part), and runs the test once as a
tracked execution so the artifact drill has rows. The test is deleted in
`afterAll`, which cascades and removes its data folder.

## Steps

1. Open http://localhost:3000/workbench?editTest={id} and click the Test Data chip
2. Open http://localhost:3000/executions/history/{executionId} (read-only canvas)
3. Open each File I/O block's config sheet and press Browse on Path or Source
4. Open http://localhost:3000/artifacts/{executionId} and read the Files section

## Validation

- **Chip (TD-a):** sits left of the Artifacts chip, same font size and height, no
  count badge, opens the sheet; neither chip exists on the historical canvas.
- **Header (TD-b):** decorative folder icon immediately before the "Test Data"
  title; Upload and New folder are 32 px text buttons with a leading icon,
  portalled into the header; Refresh and Close are square icon-only buttons.
- **Filter row (TD-b):** "Filter files…" input plus a "3 files - 55 B" meta line;
  the tree is the first child of the zone directly under it and the sheet holds
  exactly one heading, so there are no section headers.
- **Rows (TD-c):** the folder row shows its subtree size and a Collapse chevron;
  file rows carry the type tile for their extension (spreadsheet / json / text),
  a monospaced name and their own size; the footer states the read-only contract.
- **Copy path (TD-d):** first action on a file row (before Download and the
  kebab) and on a folder row (after the chevron); a click marks the button
  copied, announces "Path copied" and puts `testdata://<path>` on the clipboard.
- **Picker (TD-e):** per-mode title on the sheet and its aria-label, both source
  tabs with the tab of the row's scheme in front (Artifacts, since every seeded
  row holds an `artifact://` path), file mode picks files only, file-or-folder
  picks either, folder mode mutes files (`aria-disabled`, half opacity, no tab
  stop); the Reference line shows the fixed scheme of the tab in front
  (`testdata://` or `artifact://`) and an editable path under it that alone
  decides whether Select is live; each tab keeps its own path.
- **Save as (TD-f):** no source tabs, artifacts-only pane with its hint and empty
  state, Name seeded from the row value, the Reference under the fixed
  `artifact://` scheme, Select disabled once Name is empty.
- **Artifact rows (TD-g):** Copy path is the first action before Download and
  Delete and copies `artifact://data/output.json`.

# V-TESTDATA-02: Test Data sheet with nothing in it

Verify the sheet's empty state on a saved test with no files and its save-first
state on a canvas that was never saved (`testdata/td-sheet-empty-*`; TDATA-3,
TDATA-4, TDATA-6).

## Prerequisites

Runs on a clean database. TE-a/TE-b creates a one-Log test through the API and
deletes it in `afterEach`, so the database is clean on either side. TE-c needs no
backend entity at all: it opens a blank workbench after clearing the session and
localStorage.

## Steps

1. Open http://localhost:3000/workbench?editTest={id} and click the Test Data chip
2. Upload one file through the API and press Refresh
3. Open http://localhost:3000/workbench (never saved) and click the Test Data chip

## Validation

- **Empty state (TE-a):** "No test data yet" over "Upload the files this test
  reads. Reference them as testdata:// paths where a block reads a file." with an
  "Upload files" button that opens the same hidden file input; it renders inside
  the drop zone; Upload and New folder are live; no filter row, no meta line, no
  footer note.
- **Listing-driven (TE-b):** one uploaded file plus Refresh replaces the empty
  state with the file row, the singular "1 file - 9 B" meta line and the footer.
- **Save first (TE-c):** "Save the test first to add files."; Upload and New
  folder are disabled AND visibly disabled (opacity 0.5, not-allowed cursor); no
  filter row, no drop zone, no tree, no empty state, no footer note.
