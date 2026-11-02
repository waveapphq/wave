# V-BACKUP-02: Backup & Restore - Restore Section

Verify the Restore from Backup section renders correctly with validation preview.

## Prerequisites

No data seeding required. API responses are intercepted with route mocking: the upload
(`POST /api/backup/uploads` answers an upload ID, `DELETE /api/backup/uploads/<id>` answers 204),
the preview (`POST /api/backup/validate`), the restore (`POST /api/backup/restore`) and the
schedule. The page sends the file once; every preview and restore request names the upload ID and
carries no file, so the spec reads the file name from the upload request (BACKUP-5).

Two backups are mocked. The five-part one (Tests, Environments, Profiles, Suites, Regressions)
has no named entries. The nine-part one is the sample the restore preview and result wireframes
draw:
Tests 18 / 8 / 9 / 0 / 1 with one fatal and nine conflicting entries, Profiles with one conflict,
Functions with two, the six other parts without entries, "Restore 41 entities".

## Steps

1. Open http://localhost:3000/settings/backup
2. Upload a backup file (mocked via route interception)
3. Review validation preview
4. Open and close the parts that have entries; untick and tick parts
5. Press Restore and review the result; with Overwrite picked, answer the confirmation

## Validation

- **Upload zone:** Visible with drag & drop instructions and ".zip archives only" hint
- **After validation:**
  - Backup metadata displayed (file name, version, format, created date, secrets mode)
  - Entity summary table with columns: checkbox, Type, Total, OK, Conflicts, Fixable, Errors
    (BACKUP-9)
  - Entity type rows with correct counts and color coding, in the order of the part list:
    Tests, Environments, Profiles, Suites, Regressions, Functions, System Variables, SSH Hosts,
    Additional Certificates (BACKUP-7)
  - Auto-repair toggle visible when fixable entities exist
  - Conflict resolution radio buttons (Skip/Overwrite/Rename) visible when conflicts exist
  - Restore button with entity count
  - Clear button to reset file selection; Clear drops the kept upload
- **Opening rows (BACKUP-2):**
  - The nine Type names start at the same x, 24px into the Type cell
  - A part with entries (Tests, Profiles, Functions) has one button holding a chevron and the
    name; the six other rows have no button
  - Every part row is 36px high and has seven cells
  - Tests (one fatal entry) starts open with its list in the next row; Profiles and Functions
    (conflicts only) start closed; `aria-expanded` and the label "Expand <text>" /
    "Collapse <text>" say so
  - The chevron, the name and Enter open and close a row; Tab moves from the toggle to the list
  - A row closed by hand stays closed through a re-read; a re-read that gives a part its first
    fatal entry opens it
  - Every preview row is closed after a restore
- **Entry list (BACKUP-3, BACKUP-6, BACKUP-9):**
  - The fatal entry first, then the conflicts; each line a 14px status icon, the name, the reason
  - Reasons word for word. The fatal line states its outcome first: `Cannot be restored. Uses
    Function "Create invoice", which is not in the backup or in this WAVE`. The conflict lines
    show the reason alone: `Already in this WAVE`, `Name already in use`
  - The icons of the fatal and the conflict lines have the shape and color of the table header's
    icons
  - An entry on one text line is 28px; names share one column and so do reasons
  - With ten entries the box is 168px high inside its border, six 28px lines fill it and the list
    scrolls
  - A long reason wraps and its name stays on one line; a 150 character name wraps and the box
    never scrolls sideways
- **Preview re-reads (BACKUP-5):**
  - Unticking a part reads the preview again with the ticked parts; the request names the kept
    upload's ID and carries no file, and the file is not sent again; the table stays and Restore
    is disabled until the answer lands
  - A re-read that fails shows the server's reason under the table; the table stays; Restore is
    disabled
  - Unticking the last ticked part sends no request and keeps the last preview; ticking it back
    sends none; ticking a different part reads
  - The Conflict Resolution choice stays once shown, also when the next preview counts no
    conflict, until the file is cleared
  - Of two files picked one after the other, the preview and the restore belong to the last one:
    each file is sent once, the first file's kept upload is dropped, and the restore names the
    upload ID of the last file
  - When a restore ends the preview is read again with the ticked parts and the choices on
    screen, by the same upload ID; the table stays and Restore is disabled until the answer
    lands; then the Environments row counts its three items as conflicts and opens to list them
- **Restore result (BACKUP-9):** each line reads `<part>: N imported, N skipped` after restore
  completes, and `, N failed` after it only when that count is above 0 (`Profiles: 3 imported,
  1 skipped, 1 failed` beside `Tests: 8 imported, 2 skipped`)
- **Opening result lines (BACKUP-4, BACKUP-7):**
  - One block per part in the order of the part list; each line 16px high; all texts start at
    the same x
  - The Tests line (one fatal entry) starts open; its list is the next sibling of the line, with
    the fatal entry first (`Not restored. Uses Function "Create invoice", which is not in this
    WAVE`) and the skipped entries after it, each with the skip icon in the muted color and the
    reason alone
  - Profiles and Functions (skipped entries only) have a toggle and start closed; the six other
    lines have none; a click on the line text opens a line
  - A toggle is described by its whole line text (`Tests: 8 imported, 9 skipped, 1 failed`) and
    labeled "Expand <text>" / "Collapse <text>"
- **Overwrite confirmation (BACKUP-8):**
  - With Overwrite picked and a conflict in a ticked part, Restore sends nothing and opens an
    alert dialog titled "Overwrite conflicting entities?" with the body "The ones in this WAVE get
    the backup's content. This cannot be undone." and the buttons Cancel and Overwrite
  - "Overwrite" closes it and sends one restore with the overwrite choice; the result shows
  - "Cancel" closes it and sends nothing; the preview, the ticked parts and the choice stay;
    Restore asks again
  - No dialog for Skip, for Rename, or for Overwrite when no ticked part has a conflict
  - Escape and a click outside do not close it (REQ-5.2.1.23)
  - After a restore under Overwrite with the parts with conflicts unticked, the new preview
    counts the environments as conflicts and the next click on Restore asks; no second restore
    is sent
- **Other theme:** the preview rows, the entry lists and the result lines hold after the theme is
  flipped from the sidebar
- **Periodic Backup first read:** the mocked schedule draws; a failed first read shows the reason and Try Again loads it
