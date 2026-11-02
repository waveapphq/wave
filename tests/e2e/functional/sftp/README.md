# SFTP functional suite

Eight specs prove the SFTP block against real OpenSSH servers: files moved between WAVE and the
server of an open SSH session, and listed, inspected, deleted, moved and created on that server
(REQ-3.4.1.8; SFTP-1 to SFTP-10). Every spec imports `test` / `expect` from
`helpers/playwright-fixtures` and its shared base from `sftp-cases.ts`.

| V-TEST | Spec | Fixture | Proves |
|--------|------|---------|--------|
| V-PLUGIN-SFTP-FLOW-FUNCTIONAL | `v-plugin-sftp-flow-functional.spec.ts` | None: built on the canvas | A partner-exchange flow built entirely through the UI: Upload by Browse, Move, a server-side job, a Wait Until polling Stats until the answer lands, Download, File I/O Read and Assert, Delete and a final Stats (FLOW-1 to FLOW-9) |
| V-PLUGIN-SFTP-WILDCARDS-FUNCTIONAL | `v-plugin-sftp-wildcards-functional.spec.ts` | `fixture-wildcards.json` | `*`, `?` and `[...]` on Upload, List, Download and Delete; hidden files, no-match outcomes, several matches onto one name, and the save-as Name preset (WILD-1 to WILD-10) |
| V-PLUGIN-SFTP-FOLDERS-FUNCTIONAL | `v-plugin-sftp-folders-functional.spec.ts` | `fixture-folders.json` | Folder trees: upload and merge, If the file exists = Fail the block, a download that skips a symbolic link, Stats on a file, a folder and a missing path, Move into a missing parent, Create folder and Delete, a Move onto the folder holding its source (refused, nothing removed) and a Move of the account's home caught by Try/Catch (FOLD-1 to FOLD-11) |
| V-PLUGIN-SFTP-REFUSALS-FUNCTIONAL | `v-plugin-sftp-refusals-functional.spec.ts` | `fixture-refusals.json` | Max files and Max size (MiB) refusals set through the sheet, the read-only Test Data, a closed session, a server with no SFTP subsystem, a missing source caught by Try/Catch, and a Download Destination picker with no Test Data tab (REF-1 to REF-8) |
| V-PLUGIN-SFTP-STOP-FUNCTIONAL | `v-plugin-sftp-stop-functional.spec.ts` | `fixture-stop.json` | A 4 GiB sparse download ended by Timeout and by the canvas Stop, leaving no file and no partial file on WAVE and the source untouched (STOP-1 to STOP-5) |
| V-PLUGIN-SFTP-HOPS-FUNCTIONAL | `v-plugin-sftp-hops-functional.spec.ts` | `fixture-hops.json` | A three-hop chain (`sshd` > `sshd-no-sftp` > `sshd`): the transfer runs on the last session's own channel, and a file moves from one hop to another through WAVE (HOP-1 to HOP-5) |
| V-PLUGIN-SFTP-TUNNEL-FUNCTIONAL | `v-plugin-sftp-tunnel-functional.spec.ts` | `fixture-tunnel.json` | SFTP on a session opened through an SSH tunnel with Strict host keys checked under the far host, and the refusal for a far host not in WAVE's trusted hosts list (TUN-1 to TUN-4) |
| V-PLUGIN-SFTP-DROPZONE-FUNCTIONAL | `v-plugin-sftp-dropzone-functional.spec.ts` | `fixture-dropzone.json` | The chrooted, SFTP-only `dropzone` account, its login typed into the Session Open sheet: the jail root, a round trip through `/inbound` and `/outbound`, a refused write at the jail root (DZ-1 to DZ-7) |

`fixture-cleanup.json` (as `wave`) and `fixture-cleanup-dropzone.json` (as `dropzone`) are the
headless cleanup runs every spec starts from its `afterAll` through `runCleanup`.

## Shared base (`sftp-cases.ts`)

- `newSftpRun(spec)` gives the run uuid and the server folder `e2e-<spec>-<uuid>`.
- `loadSftpFixture(dir, file, run, extra)` replaces `__RUN_UUID__`, `__FOLDER__`, the `extra`
  keys and every `__NEW_ID_<KEY>__` (one fresh v4 id per key), refuses any placeholder left over,
  and rewrites the `127.0.0.1` SSH host sentinel for the shard mode.
- `importSftpTest(page, fixture, seed)` imports through `POST /tests` (zero load errors, no
  repairs), creates the Test Data folders (parents first, empty ones too), uploads the files and
  opens the Test on the canvas.
- `runSftpTest` / `startSftpRun` + `finishSftpRun` check `POST /tests/{id}/validate?context=run`
  for zero errors, run, wait for the bookend Log line and return the verdict, every console entry
  and the session variables.
- Readers: `summaryRows`, `entryRows`, `out`, `sftpLines`, `sftpLine` (the exact SFTP console
  line texts, SFTP-9), `expectRecorded`, `expectArtifactText`, `storageMatches` (a download's
  target name and its `.<name>.<8 hex>.part` partials under `STORAGE_BASE_PATH`). An SFTP block
  writes to the console under the source `SFTP : <Name>` (EXEC-25), so every block a spec reads by
  its console lines carries its own Name: unique on the canvas, at most 32 characters.
- Sheet rows: `fillTextRow` (a literal string row through its Edit value sheet) and
  `replaceSecretRow` (a stored secret: Edit protected value, Delete & Edit, the new text).
- `runCleanup(request, { account, paths, probe })` runs the cleanup fixture headless with
  `runTrackedTest`, asserts it passed, deletes its Test and clears the settled workbench session.

## Prerequisites

- Backend and frontend running on the worker's stack ports, and the shared execution environment
  (`ensureEnvironment` creates it if absent).
- The real-service stack (`tests/e2e/services/README.md`):
  - `sshd` - 127.0.0.1:9445 published, `sshd:22` inside the stack; SFTP on, forwarding on, users
    `wave` and the chrooted SFTP-only `dropzone`.
  - `sshd-no-sftp` - 127.0.0.1:9447 published, `sshd-no-sftp:22` inside the stack; no SFTP
    subsystem (the refusals spec dials it directly, the hops spec as its middle hop).
  - `sshd-no-fwd` - dialed by service name as the tunnel spec's far host that is not in WAVE's
    trusted hosts list.

  ```bash
  ./scripts/e2e-stack.sh up --wait sshd sshd-no-sftp sshd-no-fwd
  ```

- Host keys: Strict only against `<host>` port 9445 and the far host `sshd` port 22 (tunnel
  spec), both in WAVE's trusted SSH hosts list as `setup/global-setup.ts` seeds it
  (`resetNetworkSettings` in `helpers/network-settings.ts`); every other session uses
  `disabled`. No spec uses `accept-new`.
- Test Data is uploaded by each spec into its own Test; nothing is seeded beforehand.

## Isolation

- Shards share the stack. Each spec works only in its own server folder `e2e-<spec>-<uuid>`
  under the account's home (for `dropzone`, under `/inbound` and `/outbound`), and nothing else
  on any server is written.
- The workflow removes its folder itself (a Try/Catch Finally path or its own last Delete) and a
  Stats or a List proves it gone.
- `afterAll` runs `runCleanup` as the safety net: as `wave` an SSH Session Exec `rm -rf` of the
  spec folders (with an optional Stats before removal), as `dropzone` an SFTP Delete with Ignore
  missing on for each folder. The cleanup refuses any path without an `e2e-<spec>-<uuid>`
  segment. Then every Test and profile the spec made is deleted.
- `DELETE /workbench/session/` runs before the first navigation of every spec.

## Running

```bash
./scripts/e2e-targeted-local.sh functional/sftp/v-plugin-sftp-dropzone-functional.spec.ts
```
