# V-PLUGIN-SFTP-01: SFTP Block Config Sheet

Verify the SFTP config sheet in all seven operations, its outputs, Browse, bounds, the Remote Execution body and Quick Insert.

## Prerequisites

No seed script. Each test imports its own Test through `POST /tests`, validates it and deletes it afterwards. The Test carries the string variable `ssh_session` and one SFTP block whose Session ID reads it in expression mode:

- Upload (as drawn): Source `testdata://orders.csv`, Destination `/inbound/orders.tmp`
- Download (as drawn): Source `/outbound/orders.out`, Destination empty
- List (as drawn): Path `/outbound/*.out`
- Bounds: the Download block with Timeout `0`, Max size (MiB) `-1`, Max files `-1`
- Switching: Upload with Source `seeded/placeholder.csv` and Destination `/inbound/placeholder.tmp`, both replaced through the sheet

The remote-body test imports a second Test with the Upload block inside a Remote Execution body.

## Steps

1. Open the Test at http://localhost:3000/workbench?editTest=<id> and open the SFTP config sheet
2. Read the Upload, Download and List sheets; expand Advanced and Failure Handling
3. Switch Operation through all seven values
4. Type a Source on Upload, switch to Download and Move, save, and switch to List and back to Upload
5. Set On error to Record and continue and back
6. Type Timeout `0`, Max size (MiB) `-1`, Max files `-1`
7. Open the remote-body Test and the SFTP block inside the body
8. With an empty canvas press Ctrl+Space

## Validation

- **Header:** cyan FolderSync glyph, title "SFTP - Edit Config", one version 1.0.0; the canvas block icon is cyan
- **Upload:** Session ID*, Operation*, Source* (Browse "Browse Test Data and Artifacts"), Destination*, If the file exists (Replace it / Fail the block); Advanced, Failure Handling, Secrets collapsed; outputs Summary, Success
- **Download:** Source* without Browse; Destination empty with Browse "Browse Artifacts"; Advanced holds Timeout 300, Max size (MiB) 1024, Max files 10000 with the footer "Limits for this block"
- **List:** Path*, Include subfolders unticked; Advanced holds Timeout only; outputs Entries, Count, Success
- **Stats, Delete, Move, Create folder:** their own rows and outputs, no Browse
- **Operation options:** Upload, Download, List, Stats, Delete, Move, Create folder
- **Switching:** Source survives Download and Move and is saved; the limit rows show only on Download and leave with it; Path starts empty on List
- **On error:** Record and continue adds Error and Reason after Success
- **Info badges:** every input and output row carries its exact text; only the starred rows carry the required mark
- **Bounds:** "Timeout must be at least 1", "Max size (MiB) must be at least 0", "Max files must be at least 0" under the field, Save disabled, value kept; the stored values paint the canvas alert badge
- **Remote body:** L badge; Upload Source keeps Browse
- **Quick Insert:** SFTP under Remote with the cyan glyph, after SSH Tunnel Close and before Remote Execution
