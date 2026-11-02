# V-STORAGE-DIRECTORY-FOLLOW: lists follow their storage directories

The storage directory is the record. The Tests, Profiles and Environments lists
are reconciled against their directories on every list read, so a record that
appears or disappears on disk shows up or drops out with no backend restart,
and one record file that cannot be read is skipped instead of taking the whole
list down.

Executions are deliberately outside that reconcile. The second spec proves the
half that IS true for them: a delete made through the product clears the
execution from the in-memory record as well as from disk.

## Prerequisites

- Backend + frontend running (standard functional-test stack)
- Runs in the `functional-destructive` project: it removes files from the
  running backend's data directory

## Files

| File | Proves |
|---|---|
| `v-storage-directory-follow.spec.ts` | the three lists follow their directories; a deleted Profile is not readable and its name is free |
| `v-execution-delete-clears-memory.spec.ts` | deleting an execution through the product leaves nothing behind |

## Steps (repeated for Tests, Profiles and Environments)

1. Seed two records through the entity's own API - a keeper and a victim - and
   see both in the list
2. Read the victim's record file into memory, remove its whole id directory,
   reload the list
3. Write the same bytes back under the same id directory, reload the list
4. Plant a record file under a fresh id that cannot be read (leading `0xff`, so
   not valid UTF-8, plus a NUL byte, so not valid YAML either, whatever the
   backend process encoding is), reload the list

Step 4 uses a record the cache has never seen. A file corrupted in place would
prove nothing: the directory scan keys on the file's presence and carries no
modification time, so an already-cached record is never re-read.

`chmod 000` is deliberately not used. Whether it blocks a read depends on the
uid the backend runs as, and a mode change is one more thing teardown can leave
behind.

## Validation

- **Deleted from disk:** the victim's row is gone, the keeper's row is still
  there, and the page shows no read-failure surface. No restart happened.
- **Put back underneath:** the victim's row is listed again.
- **Unreadable record:** no read-failure surface, and both seeded rows still
  render. This is the leg that used to fail - a permission-denied or non-UTF-8
  file made the whole page answer an error.
- **Deleted Profile opened from a stale row:** the page reports
  `Profile with ID '<id>' not found`, no editor opens, and the API answers 404.
  It used to open and show the profile's old values.
- **Name freed:** re-creating a Profile or Environment with the deleted
  record's name succeeds immediately.
- **Execution deleted through the product:** the row leaves the list, the
  record and its variables answer 404, its directory is gone, and a fresh read
  of the list does not bring it back.

## Not asserted (known and unfixed)

- A record file MODIFIED in place is still served stale on all three entities.
- Saves are not atomic.
- An unreadable record is invisible rather than flagged, so the user just sees
  one fewer row.
- An execution whose files are deleted by hand stays in the Executions list
  until someone opens it.

## Safety

Every filesystem path is built by one fenced helper that refuses any path that
is not `<STORAGE_BASE_PATH>/<one of the three entity directories>/<a uuid this
spec created>`. `STORAGE_BASE_PATH` is already per-stack, so nothing here can
reach another shard's data. Teardown deletes every id the spec created or
planted through the entity's own API and then removes any directory left
behind.
