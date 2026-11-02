---
id: sftp
description: Move files between WAVE and a server over an open SSH session, and manage files on that server
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-28"
    changelog:
      - "Full implementation released"
      - "Rides an open SSH session through Session ID: no connection rows, and the ssh profile on SSH Session Open carries the login"
      - "Operation: Upload, Download, List, Stats, Delete, Move or Create folder (default: Upload)"
      - "Source and Destination on Upload, Download and Move; Upload's Source and Download's Destination are on WAVE, with Browse"
      - "Path on List, Stats, Delete and Create folder"
      - "Wildcards *, ? and [...] in the paths of Upload, Download, List and Delete"
      - "If the file exists on Upload, Download and Move: Replace it or Fail the block"
      - "Include subfolders on List, Ignore missing on Delete"
      - "Timeout in Advanced, 300 seconds by default, bounding the whole block"
      - "Max size (MiB) and Max files in Advanced for Download, 1024 and 10,000 by default; 0 means no limit"
      - "On error: Fail the block, or Record and continue with Success, Error and Reason"
      - "Outputs: Summary on Upload and Download, Entries and Count on List, Exists, Type, Size and Modified on Stats"
      - "Runs on WAVE, also inside a Remote Execution body"
---

The SFTP plugin moves files between WAVE and a server, and manages files on that server, over a file-transfer channel on an SSH session that an SSH Session Open block opened. Operation picks what the block does; the sheet shows only the rows that operation uses.

**Use Cases:**
- Upload an input file from Test Data under a temporary name, then Move it to the name the system watches for, so processing never starts on a half-written file
- Wait for an output file with Stats, or with List, inside a Wait Until
- Download the output into the run's artifacts and check it with File I/O or the CSV block
- Clean up what the test left on the server with Delete
- Reach a server behind jump hosts, or behind an SSH Tunnel, through the session opened along the way
- Move a file between two hops with a Download on one session followed by an Upload on the other

**Behavior:**
- There are no connection rows. Login, host-key checking, jump hosts and keepalive all come from the session Session ID names, and the ssh profile bound on SSH Session Open carries the login
- The WAVE side is Upload's Source and Download's Destination. Each takes `testdata://`, `artifact://` or an absolute or relative path, and Browse picks it: a Test Data or Artifact entry for Upload's Source, an artifact save target for Download's Destination. Left empty, Download's Destination puts the files in the run's artifacts under their own names
- Every other path is a path on the server, typed as plain text, with no Browse
- The paths of Upload, Download, List and Delete accept the wildcards `*`, `?` and `[...]`. When nothing matches, Upload and Download fail with a message naming the pattern, Delete follows Ignore missing, and List returns no entries and a Count of 0
- A wildcard matches a name that starts with a dot only when the pattern starts with a dot, and List leaves out symbolic links and folders whose names start with a dot
- A destination that is an existing folder, or that ends with `/`, receives the files under their own names. Any other destination is the new name, and it is valid only when exactly one file matches
- A folder is transferred with everything inside it, and folders missing on the receiving side are created
- If the file exists decides what happens when the destination is taken. Upload and Download copy: a folder merges into a folder of the same name, Replace it overwrites each file already there, Fail the block stops before anything is written, and a file never replaces a folder nor a folder a file
- Move renames: with Replace it, whatever already holds the target name, a file or a whole folder, is removed and the source takes its place, so folders are not merged; with Fail the block, the block stops when anything holds that name
- A Move whose target is the source itself or a folder holding it is refused before anything is removed, and Move refuses a Source that names the account's home, a folder above it or the server root, like Delete
- Delete removes a file or a whole folder tree. A path that names the account's home, a folder above it or the server root (such as empty, `.`, `..`, `~` or `/`) is refused before anything is deleted; a wildcard such as `*` is allowed
- Create folder creates the folder together with any missing parent folders
- A download is bounded by Max size (MiB) and Max files. The block adds up the size and the file count of the match before it writes anything, and refuses a match over either limit with a message naming the limit
- A folder download skips symbolic links and fails on an entry name that could reach outside the destination folder
- A failed, timed-out or stopped transfer leaves no partial file behind: a download lands under a temporary name and takes its real name only when it is complete, and a partial upload is removed from the server
- Timeout bounds the whole block, every file of a folder transfer included. Timeout and Stop end the transfer at once
- The block never writes Test Data
- The block always runs on WAVE, because the session it rides lives there. Inside a Remote Execution body it carries the L badge, still runs on WAVE and keeps Browse, so its Test Data and artifact references keep resolving on WAVE
- The run console shows one summary line per operation, and every file written into the run's artifacts is logged with its name, path and size. File contents never appear in the console
- On error decides what a failure at run time does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on

**Parameters:**
- **Session ID**: The session from an SSH Session Open block (required)
- **Operation**: Upload, Download, List, Stats, Delete, Move or Create folder (default: Upload)
- **Source**: What to transfer or move: a file or folder on WAVE, with Browse (Upload), or on the server (Download, Move) (required)
- **Destination**: Where it goes: on the server (Upload, Move, required), or on WAVE with Browse, empty for the run's artifacts (Download)
- **If the file exists**: Replace it or Fail the block (default: Replace it) (Upload, Download, Move)
- **Path**: The file or folder on the server the operation acts on; List also takes a pattern (required) (List, Stats, Delete, Create folder)
- **Include subfolders**: List the entries inside subfolders too, at every depth (default: off) (List)
- **Ignore missing**: Pass when the path or pattern matches nothing (default: off) (Delete)
- **Timeout**: Seconds the whole block may take, in Advanced (default: 300)
- **Max size (MiB)**: Largest total a download may bring, in Advanced (default: 1024; 0 means no limit) (Download)
- **Max files**: Most files a download may bring, in Advanced (default: 10000; 0 means no limit) (Download)
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Summary**: One row per file transferred: source, destination and size (Upload, Download)
- **Entries**: One row per entry: name, path, type, modified and size; Include subfolders adds the entries of every subfolder (List)
- **Count**: Number of entries; 0 when nothing matches (List)
- **Exists**: True when the path is there on the server (Stats)
- **Type**: Whether the path is a file or a folder; empty when the path is missing (Stats)
- **Size**: Size in bytes of a file; 0 for a folder or a missing path (Stats)
- **Modified**: Last modified, ISO-8601 UTC; empty when the path is missing (Stats)
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue

Delete, Move and Create folder give only Success, Error and Reason.
