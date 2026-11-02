# V-BACKUP-RESTORE: Backup and restore

Proves that a backup archive is a complete, honest picture of the store: it
holds the selected entity types and each Test's own data files, its preview
reports what a restore would do, the restore puts everything back, and a
failure at either step is stated on screen instead of being presented as
success.

- `v-backup-functional.spec.ts` - the seed, backup, reset, upload, preview and
  restore round trip, a selective backup in JSON format, the periodic schedule
  on the Backup page (see below), and the network settings round trip (SSH
  Hosts and Additional Certificates, see below).
- `v-backup-failure-functional.spec.ts` - a backup file the server refuses and
  a restore that fails are each reported on screen, with nothing presented as
  restored.
- `v-backup-roundtrip-functional.spec.ts` - a backup restored on an empty store
  gives every item back as itself, links included; the same archive again
  under Skip, Overwrite and Rename; a Test whose Function is missing; a profile
  without a type (see below).
- `v-backup-upload-functional.spec.ts` - the Restore page sends the backup file
  once, sends it again by itself when the backend no longer knows it, and drops
  the kept upload on Clear, on another pick and when the page is left (see
  below).

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Admin API reachable (`WAVE_ADMIN_ALLOWED=true`) - the reset between steps
  goes through it
- Shared execution environment (`ensureEnvironment` creates it if absent);
  `v-backup-testdata-travel.spec.ts` runs a workflow and needs it
- No external service: everything is served by the WAVE backend itself, so
  nothing from `tests/e2e/services/` is required
- `../../fixtures/testdata-travel/fixture.json` - reads
  `testdata://travel-root.txt` and `testdata://fixtures/travel-nested.json`,
  logs both, and ends on a bookend Log line, so a round trip is proved by the
  run and not by a listing

## Isolation on the shared stack

This suite is destructive by design and is registered in the
`functional-destructive` project: a backup reads whatever the store holds and a
restore writes into it, so every spec resets the store through
`tests/e2e/scripts/reset.sh` before it seeds and again when it is done. Files in
this project never share a backend, so the reset only ever affects this spec's
own stack.

## Steps

1. Reset the store, then seed the entities the case needs through their own
   create routes (`POST /environments`, `POST /tests`, `POST /suites`,
   `POST /regressions`), each name with a run token, plus
   `POST /tests/{id}/testdata/upload` for a Test that carries files. The round
   trip of `v-backup-functional.spec.ts` seeds two Environments, three Tests of
   one Log block each, a Suite of the three Tests and a Regression of the Suite
2. Create the archive with `POST /api/backup/create`, choosing the entity types,
   format, compression and secrets mode
3. Read the ZIP's own central directory where the case asserts on what the
   archive carries: member names and the decompressed bytes of each member
4. Reset the store, or delete the seeded Test, so the restore has work to do
5. Restore - through the Settings > Backup page (upload, preview, Restore) or
   through `POST /api/backup/restore`
6. Read the restored entities back through the API, and where the case needs it
   open the restored Test in the workbench, pick the shared environment, press
   Run and read the console

## Validation

- **Archive shape:** the download is `application/zip` and carries the selected
  entity types only
- **Preview accuracy:** the validation preview names the uploaded file, its
  format and its secrets mode, lists a row per entity type, and every type is
  selected when the store is empty; each row counts its seeded entities as OK
  with no conflict, nothing fixable and no error, and no entry list is
  drawn
- **Restore:** each result line reads `<type>: <n> imported, 0 skipped`, with no
  failed count, and names no entity; the entity counts come back, and every
  seeded entity answers under the ID it had with its name, the Suite listing
  its Tests and the Regression its Suite (REQ-5.2.4.9.5); a selective backup
  restores only the
  types it holds: its answer holds those parts alone, each with nothing
  skipped and nothing left out, and the Suite and the Regression answer 404
- **Schedule:** a periodic schedule persists through the API and shows its cron
  expression, description and next run on the page; turned off with
  `PUT {enabled: false}` it answers every other setting at its default: an
  empty cron, every entity type (Tests, Environments, Profiles, Suites,
  Regressions, Functions, System Variables, SSH Hosts and Additional
  Certificates), YAML, Deflate at level 6, 5 backups and the folder
  `~/wave-backups` (the full list is under "Periodic schedule")
- **Failure is never silent:** a file the server refuses is reported and offers
  nothing to restore from; a restore that fails is stated, shows no completion
  panel, leaves no progress bar behind, keeps the button usable, and changes
  nothing in the store
- **Files travel:** the backup carries each Test's files as
  `tests/testdata/<test id>/<rel>` holding the uploaded bytes; validating it
  reports the file count on the tests summary; after the Test is deleted the
  restore brings it back under the ID it had, with no copy under another ID
  (REQ-5.2.4.9.5), and writes its files back there byte for byte, and a run of
  the restored Test resolves `testdata://<rel>` and logs the content back

## V-BACKUP-ELEMENT-TYPES

- Spec: `v-backup-element-types.spec.ts`; fixture: `element-types-fixture.json`.
- A backup restore brings back the element types on a Test's variables, Variable Setter and SQL block, on a Suite, on a System variable and on a profile field, and the restored Test runs with every element as its declared type (REQ-3.1.3.19, REQ-3.5.2.4).

## V-BACKUP-RT: restore gives back the same WAVE

- Spec: `v-backup-roundtrip-functional.spec.ts` (REQ-5.2.4.9.5, REQ-5.2.4.9.6,
  BACKUP-1 to BACKUP-9). Eight tests in one serial describe on one store.
- A backup made on the Backup page and restored on an empty WAVE gives back
  every item under its own ID, with its content, its history and its links,
  and the restored Suite runs. The same archive is then restored again with
  Skip, Overwrite and Rename, an archive without its Functions is restored,
  the preview is read with Functions unticked, a profile whose archive
  member has no type is restored with auto-repair off and on, and a second
  Restore with Overwrite asks before it writes over what the first one wrote.
- Pre-requisites: none beyond the stack and the admin API. The spec owns the
  store while it runs: it starts and ends with `tests/e2e/scripts/reset.sh`
  plus `DELETE /functions/<id>?cascade=true` for every library Function (the
  reset leaves the Functions library alone), which also removes the `(2)`
  copies of the Rename restore. Every seeded name carries a run token. A Suite
  is run through `POST /executions` only and is waited to its end before the
  next restore: a workbench session on a Test makes the Test count as running.
- The fixture, seeded through the API: one Environment; one Profile of type
  `custom` with a value for that Environment; Function FnA in versions 1.0.0
  and 1.1.0, each logging its own line; Function FnB, which calls FnA 1.0.0; a
  Test that calls FnB 1.0.0 and has a Log block bound to the Profile, updated
  once (version 1.1.0, two history rows), with the data file `sample.csv`; a
  Test that calls FnA 1.0.0 inside a Local Function; a plain Test; a Suite of
  the three Tests; a Regression of the Suite. Every seeded Test validates with
  zero errors and the Suite passes before the first backup.
- Steps:
  1. `V-BACKUP-RT-1`: on the Backup page tick Tests, Environments, Profiles,
     Suites, Regressions and Functions and press Create & Download; clean up;
     upload the archive and press Restore; run the Suite
  2. `V-BACKUP-RT-2`: upload the same archive, open every preview row, press
     Restore with Skip, open every result line; run the Suite
  3. `V-BACKUP-RT-3`: change the description of the first Test with
     `PUT /tests/{id}`; upload, pick Overwrite, press Restore, press Cancel in
     the dialog, press Restore again and Overwrite in the dialog; run the Suite
  4. `V-BACKUP-RT-4`: upload, pick Rename, press Restore; run the renamed Suite
     with the renamed Environment
  5. `V-BACKUP-RT-5`: clean up and seed again; make an archive with Functions
     not ticked; clean up; upload it and press Restore
  6. `V-BACKUP-RT-6`: clean up; upload the archive of step 1; untick Functions
     in the preview while the validate answer is held back; tick it again
  7. `V-BACKUP-RT-7`: clean up; make two profiles of type `custom`; make a
     JSON backup of Profiles through `POST /api/backup/create`, drop the `type`
     key of one member and rebuild the archive (`buildZip` in
     `../../helpers/zip-writer.ts`); delete both profiles; upload, press
     Restore, switch auto-repair on and press Restore again. The second
     profile is there because Restore stays disabled when nothing can be
     restored
  8. `V-BACKUP-RT-8`: clean up; make an Environment and a Test; back up Tests
     and Environments on the Backup page; delete the Test; upload, pick
     Overwrite, untick Environments and press Restore; change the description
     of the Test with `PUT /tests/{id}`; press Restore, press Cancel in the
     dialog, press Restore again and Overwrite in the dialog
- Validation:
  - The archive holds a member for each seeded item, both versions of FnA in
    its member and the data file under `tests/testdata/<test id>/`
  - On the emptied store the preview has a row per part in the order of the
    part list, under the column headers Type, Total, OK, Conflicts, Fixable and
    `Errors` (BACKUP-9), and names no seeded item; after the restore every item
    answers
    under the ID it had, the first Test has its description, tags, owner,
    version 1.1.0, two history rows and its data file, FnA has both versions,
    the Suite lists its Tests, the Regression its Suite, the Profile keys its
    value by the Environment, the bound block holds the Profile's ID, and the
    Suite passes with the line of FnA 1.0.0 in the log and not the line of 1.1.0
  - Skip: every preview row has a toggle labeled `Expand <part>` and lists each
    seeded item as a conflict with `Already in this WAVE`; every result line
    lists each one as skipped with the same reason; a conflict line and a
    skipped line show the reason alone (BACKUP-9); the preview rows close when
    the restore completes; no ID and no last update changed and no copy exists
  - Overwrite: the items stay listed as conflicts and the choice stays picked;
    the first click on Restore opens the dialog `Overwrite conflicting
    entities?` and sends no restore; after Cancel the Test still has the
    changed description and version 1.2.0; after Restore and Overwrite one
    restore was sent and the Test has the same ID, the backup's description,
    version 1.1.0 and two history rows
  - Rename: every item is still there under its ID with its last update, and
    one copy named `<name> (2)` exists under a new ID; the renamed Suite lists
    the renamed Tests, the renamed Tests call the renamed Functions and bind
    the renamed Profile, the renamed FnB calls the renamed FnA, the renamed
    Regression lists the renamed Suite, the renamed Profile keys its value by
    the renamed Environment, and the renamed Suite passes
  - Functions missing: the Tests row starts open and names both Tests that
    call a Function as fatal with `Cannot be restored. Uses Function "<block
    name>", which is not in the backup or in this WAVE` (for the nested one,
    the name of the block inside the Local Function); the restore answers a
    result whose Tests line starts open with `Not restored. Uses Function
    "<block name>", which is not in this WAVE`; the result lines read `Tests: 1
    imported, 0 skipped, 2 failed` and `<part>: 1 imported, 0 skipped` for the
    four other parts, so a line counts failed items only when it has some
    (BACKUP-9); the plain Test, the Suite, the Regression, the Environment and
    the Profile are back under their IDs and neither fatal Test exists
  - Unticking Functions: Restore is disabled while the newer preview loads;
    then the Tests row is open and names both Tests fatal with `Cannot be
    restored. Uses Function "<block name>", which is not in this WAVE` and the
    Functions row is still drawn; ticked again, the Tests row has no list
  - A profile without a type: the auto-repair switch shows and no preview list
    names the profile; with the switch off the Profiles result line starts
    open and names it fatal with `Not restored. Has no type`, and
    `GET /profiles/<id>` answers 404; with the switch on the profile exists
    under its ID with type `custom`
  - The preview after a restore: the first Restore sends one restore with no
    dialog and writes the Test; the Tests row then has a toggle and lists the
    Test as a conflict with `Already in this WAVE`; the next click on Restore
    opens the dialog and sends nothing; after Cancel the Test has the changed
    description; after Restore and Overwrite two restores were sent and the
    Test has the backup's description under the same ID
  - Every restore on the page is followed by one read of the preview

## V-BACKUP-UP: the backup file is sent once

- Spec: `v-backup-upload-functional.spec.ts` (REQ-5.2.4.9.6, BACKUP-5). Five
  tests on one fixture. No backup route is mocked: the spec reads what the
  page sends and asks the backend what it still keeps.
- Pre-requisites: none beyond the stack and the admin API. The spec starts and
  ends with `tests/e2e/scripts/reset.sh`. After each test it deletes what a
  restore wrote and sends `DELETE /api/backup/uploads/<id>` for every upload it
  saw the backend keep.
- The fixture, seeded through the API, every name with a run token: two
  Environments and two Profiles of type `custom`; a JSON backup of both parts
  made through `POST /api/backup/create`, with the `type` key of one Profile
  member dropped and the archive rebuilt (`buildZip` in
  `../../helpers/zip-writer.ts`); then one Environment and both Profiles are
  deleted. The preview of that archive counts one conflict and one fixable
  item, so the conflict choice and the auto-repair switch show and the button
  reads `Restore 3 entities`.
- Steps:
  1. `V-BACKUP-UP-1`: upload the archive; untick Profiles and tick it again;
     pick Rename; switch auto-repair on; press Restore and wait for the read of
     the preview that follows it
  2. `V-BACKUP-UP-2`: upload the archive; send
     `DELETE /api/backup/uploads/<id>` for its upload through REST; untick
     Profiles
  3. `V-BACKUP-UP-3`: upload the archive and press Clear
  4. `V-BACKUP-UP-4`: upload a file that is not a ZIP archive, then upload the
     archive
  5. `V-BACKUP-UP-5`: upload the archive and click About in the Settings
     section list
- Validation:
  - One upload: exactly one `POST /api/backup/uploads` left the page. The six
    `POST /api/backup/validate` requests and the one `POST /api/backup/restore`
    each carry `upload_id` with that upload's ID, the ticked parts, the
    conflict choice and auto-repair as they were on screen, and no file part;
    every one is answered 200 and no upload is dropped. The result reads
    `Environments: 2 imported, 0 skipped` and `Profiles: 2 imported, 0
    skipped`; the Environment that was here has a copy named `<name> (2)`, and
    the Profile without a type exists as type `custom`
  - Unknown upload: after the REST delete, `POST /api/backup/validate` with
    that `upload_id` answers 404 `BACKUP_UPLOAD_NOT_FOUND` (`Backup upload not
    found`). The page's next read is answered 404 once, a second
    `POST /api/backup/uploads` leaves the page, the read is repeated once under
    the new upload ID and answered 200; the button reads `Restore 2 entities`
    and neither `restore-validate-error` nor `restore-backup-error` is drawn
  - Dropped on Clear, on another pick and on leaving: before the action a read
    by `upload_id` through REST shows the upload is kept; the action sends
    `DELETE /api/backup/uploads/<id>` for exactly that ID, answered 204; after
    it the same read answers 404. On another pick the first file is one the
    backend keeps but refuses to preview (`Invalid backup file: not a ZIP
    archive`), which leaves the upload zone in place; the second file is sent
    once and stays kept

## Periodic schedule

- Spec: the `periodic schedule` describe in `v-backup-functional.spec.ts`
  (REQ-4.7.16, REQ-4.7.20, SETTINGS-18, SETTINGS-21, SHELL-10, BACKUP-1).
- The schedule lives in the stack's own config file. Every test reads that
  file from disk; its path and the data folder come from `GET /server/status`
  (`stackPaths` in `../../helpers/config-file.ts`).
- Pre-requisites: none beyond the stack. Each test stores the schedule it
  needs through `PUT /api/backup/schedule`, saves into a folder it creates
  under the temp folder, and afterwards sends `PUT {enabled: false}` and
  removes its folders. Test 10 publishes one library Function named with a run
  token and deletes it afterwards with `DELETE /functions/<id>?cascade=true`
  (the reset leaves the Functions library alone).
- Steps (all on Settings > Backup, Periodic Backup):
  1. Open the page with nothing changed; switch "Enable periodic backups" on;
     press Cancel
  2. Store a schedule, save it off, then switch it on and read the fields,
     the API and the config file without pressing Save
  3. Switch on, type a cron and a folder under the temp folder, press Save
  4. With a stored schedule that is on and holds its own cron, two entity
     types, JSON, Bzip2 at level 5, 7 backups and its own folder, switch it off
     and press Save; switch it on again and press Save without typing a cron
  5. Switch on, type a cron, then type the data folder, then a folder inside
     it, as Save Directory and press Save each time
  6. Save a schedule with the cron `* * * * *` and Max Backups to Keep 1; wait
     for the first run, leave to About and come back to Backup, then wait for
     the second run (about two minutes in all); switch it off, press Save and
     switch it on again
  7. Send `DELETE /api/backup/schedule` while the schedule is on
  8. Stage the switch and click About in the Settings section list; answer
     the "Unsaved changes" dialog with Cancel, then Discard; switch on again,
     type a cron and a folder under the temp folder and answer Save; with the
     data folder typed as Save Directory, answer Save once more
  9. With a stored schedule that is on, empty "Max Backups to Keep", type 8
     and press Save; then empty the box again and click away
  10. Publish a library Function; switch on, leave every entity type as it is,
      type the cron `* * * * *` and a folder under the temp folder, press Save
      and wait for the first run (up to a minute)
- Validation:
  - Cancel and Save on the "Periodic Backup" heading line are disabled while
    nothing changed, enabled by a staged change and disabled again after
    Cancel; the section has no other save button
  - Switching on shows the defaults (an empty cron, the folder
    `~/wave-backups`, 5 backups), not the values stored before the schedule
    was saved off; no PUT is sent, and the API and the config file still say
    `enabled: false`
  - Save writes `enabled: true`, the cron and the folder under
    `backup.schedule` of the config file, and the page shows the next run
  - Switched off and saved, the API and the file say off with the cron, the
    entity types, the format, the compression, the count and the folder back
    at their defaults, and the old cron and folder are nowhere in the
    `backup` section of the file; switched on again the fields show the
    defaults, and Save without a cron answers 400 with the toast "Could Not
    Save Backup Schedule" reading `Cron expression is required` while the
    schedule stays off
  - A Save Directory that is the data folder or inside it answers 400 and the
    toast "Could Not Save Backup Schedule" reads
    `Save directory must be outside the data folder: {data folder}`; the typed
    value stays, the API and the config file are unchanged
  - The first run leaves one `wave-backup-*.zip` in the folder and the file
    records `last_run` (the time of that run) and `last_run_status: success`;
    back on the page the line reads `Last run: success at {last_run}`, with
    that time shown in the browser's time zone; after the second run the
    folder holds exactly one archive, the newer one; switched off and saved
    after that, the cron is empty and `last_run` and `last_run_status: success`
    stay in the API and in the file, and switched on again the page still
    reads `Last run: success at {last_run}`
  - `DELETE` answers 405 and the schedule stays on
  - The dialog offers Cancel, Discard and Save: Cancel stays with the staged
    switch, Discard leaves and saves nothing, Save writes `enabled: true` with
    the typed cron and folder and leaves, and a Save refused for the data
    folder stays on Backup with the typed folder and the toast
  - The emptied box stays empty, the number typed next stands alone and Save
    writes it; left empty, the box shows its number again and nothing is staged
  - Switched on from its defaults, all nine entity types are ticked and the
    saved schedule holds the nine; the archive of the first run counts the
    nine types in `manifest.json`, `functions` among them, and holds the
    member `functions/<Function name>.yaml` with the Function's ID, name and
    body (BACKUP-1, REQ-4.7.20)

## Network settings in a backup

- Spec: the `network settings` describe in `v-backup-functional.spec.ts`
  (REQ-5.2.4.9.2, REQ-4.5.14, REQ-4.5.16).
- Pre-requisites: `resetNetworkSettings` (`../../helpers/network-settings.ts`)
  runs before and after the test, so the stack's seeded trusted hosts are back
  for every later spec; the certificate is `CA_CERT_PEM` from
  `../../helpers/config.ts` (the WAVE Test CA).
- Steps:
  1. Through the API, trust one more host (`backup-e2e.lab.internal` port 2222)
     beside the stack's three and add the WAVE Test CA to Additional
     Certificates
  2. On the Backup page select only "SSH Hosts" and "Additional Certificates"
     and press Create & Download
  3. On Settings > Network > SSH Hosts press the host's trash icon, then Save;
     on Settings > Network > Certificates press the certificate's trash icon,
     then Save
  4. Upload the downloaded archive on the Backup page and press Restore with
     the default Skip resolution
  5. Read `GET /network/ssh-hosts` and `GET /network/certificates`, then open
     both Network pages
- Validation:
  - The archive's manifest counts exactly the two selected types: four hosts
    and one certificate
  - After each Save the page has nothing left to save and the API no longer
    lists the removed host or certificate
  - The preview counts the removed host as OK and the three saved hosts as
    conflicts, and the certificate as OK
  - The result reads `SSH Hosts: 1 imported, 3 skipped` and
    `Additional Certificates: 1 imported, 0 skipped`
  - The host is back with the same key type and fingerprint, each stack host is
    listed once, the certificate is back with the same id and name, and both
    show on their Network pages
