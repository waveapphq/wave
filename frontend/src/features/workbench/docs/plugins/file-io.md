---
id: file-io
description: Work with files and folders where the block runs - read, write, copy, move, delete, stats, list and create folder
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-06"
    changelog:
      - "Operations: read, write, copy, move, delete, stats, list and create folder"
      - "Stats operation: whether a path is there, what it is, when it changed, and its size or checksum on request"
      - "List operation: a folder's entries as a table, filtered by a RegEx Pattern, with Include subfolders"
      - "Create folder operation: makes a folder and its missing parents"
      - "If the file exists on Write, Copy and Move: Replace it, Append to it (Write only) or Fail the block"
      - "Ignore missing on Delete: succeed when there is nothing to delete"
      - "Browse on every path field: pick a Test Data or Artifact file or folder, or a save target"
      - "Remotable: inside a Remote Execution body the block runs on the remote host against its paths"
      - "Read and Write are UTF-8 text"
---

The File I/O plugin works with files and folders where the block runs: on WAVE, or on the remote host inside a Remote Execution body. Operation picks what the block does; the sheet shows only the rows that operation uses.

**Use Cases:**
- Read a fixture uploaded as test data (`testdata://fixtures/users.csv`) into a variable
- Write a report, a generated config or captured output into the run's artifacts
- Stage a test data file or folder into the artifacts with Copy, or rename an artifact with Move
- Check that a job produced a file, and compare its size or checksum against an expectation
- List a folder's entries as a table and loop over them
- Clean up with Delete, or prepare a folder tree with Create folder

**Behavior:**
- A path is `artifact://` (this run's artifacts), `testdata://` (this test's files, read-only), or an absolute or relative path where the block runs. A relative path starts at the home folder of the user the WAVE server runs as on WAVE, and at the SSH user's home folder on the remote host. A `..` segment is followed wherever it leads
- Read returns the file as UTF-8 text; a byte-order mark is honored
- Write creates the file and its missing folders; If the file exists decides whether it is replaced, appended to, or the block fails
- Copy and Move take a file or folder and the full target path including its new name; replacing a folder merges - files inside are replaced, others are kept
- `testdata://` is read-only, so Move's Source browses Artifacts only
- Delete removes a file, or a folder with everything inside it; Ignore missing makes an absent path a success
- Stats does not fail on a missing path: Exists is false and Type, Modified and Checksum are empty; a folder has no checksum and reports size 0
- List returns one row per entry, filtered by RegEx Pattern (a Python regular expression matched against each name), at every depth with Include subfolders; symlinks are followed on read and never listed
- Create folder makes the folder and its missing parents; an existing folder is not an error
- Inside a Remote Execution body every path is a path on the remote host: the test still saves with `artifact://` or `testdata://`, but the block fails at run time on either one, and Browse is not offered

**Parameters:**
- **Operation**: Read, Write, Copy, Move, Delete, Stats, List or Create folder (default: Read)
- **Path**: The file or folder the operation acts on; Browse picks a Test Data or Artifact entry (Read, Delete, Stats, List) or a save target (Write, Create folder)
- **Content**: Text to write, UTF-8 (Write)
- **If the file exists**: Replace it, Append to it (Write only) or Fail the block (default: Replace it) (Write, Copy, Move)
- **Source**: The file or folder to copy or move; Move browses Artifacts only (Copy, Move)
- **Destination**: The full target path including the new name; Browse presets the name to the source's (Copy, Move)
- **Ignore missing**: Succeed when there is nothing to delete (default: off) (Delete)
- **Size**: Include the size in bytes (default: off) (Stats, List). A folder's size is everything inside it, at every depth
- **Checksum**: None, MD5, SHA-1, SHA-256 or SHA-512 (default: None) (Stats)
- **Output format**: Individual outputs, one Map, or a one-row Table (default: Individual) (Stats)
- **RegEx Pattern**: Python regular expression matched against each entry name; empty lists everything (List)
- **Include subfolders**: List entries at every depth below the folder (default: off) (List)

**Outputs:**
- **Content**: The file's text (Read)
- **Exists**: True when the path is there (Stats, Output format Individual)
- **Type**: file, folder, or empty when the path is missing (Stats, Output format Individual)
- **Modified**: Last modified, ISO-8601 UTC; empty when the path is missing (Stats, Output format Individual)
- **Size**: Size in bytes; for a folder, the total of everything inside it (Stats, Output format Individual, Size ticked)
- **Checksum**: Hex digest; empty for a folder or a missing path (Stats, Output format Individual, Checksum chosen)
- **Stats**: The same values as one map (Output format Map) or a one-row table (Output format Table)
- **Entries**: One row per entry: name, path, type, modified, and size when ticked (List)
- **Count**: Number of entries (List)

Write, Copy, Move, Delete and Create folder have no outputs.
