# V-IMPORT-EXPORT: Test export and import

Proves that a Test leaves WAVE and comes back whole: the document in either
format, the secret-value mode chosen for the export, a multi-test archive, and
a Test's own data files traveling with it through export and import.

- `v-export.spec.ts` - one Test exported as YAML and as JSON, the mask,
  encrypted and plaintext secret modes, and two or more Tests downloading as
  one ZIP.
- `v-import.spec.ts` - a YAML upload and a JSON upload each creating a Test,
  a ZIP archive creating every Test it holds, and an import over an existing
  name with an unknown conflict choice being skipped (one Test keeps the name).

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent);
  `v-testdata-travel.spec.ts` runs a workflow and needs it
- No external service: everything is served by the WAVE backend itself, so
  nothing from `tests/e2e/services/` is required
- `fixture.json` - a two-Block Test (an explicit start node plus a Log) with one
  plain and one secret Test variable, used by the export and ZIP-import specs
- `../../fixtures/testdata-travel/fixture.json` - reads `testdata://travel-root.txt`
  and `testdata://fixtures/travel-nested.json`, logs both, and ends on a bookend
  Log line, so a round trip is proved by the run and not by a listing

## Isolation on the shared stack

Every spec creates its own Tests under a unique name through `POST /tests` (or
the admin bulk route where the fixture's shape must survive verbatim), uploads
its own files one request at a time, and deletes what it created in teardown.
The Test delete cascades and removes the Test's data folder. No server state is
reset and no other shard is affected.

## Steps

1. Create the Test through the API and, where the case needs files, upload them
   with `POST /tests/{id}/testdata/upload` - one file per request, form fields
   in the order `path`, `replace`, then the file part
2. Export through `GET /tests/{id}/export` or `POST /tests/export` and read the
   response body, its content type and its content disposition
3. For an archive, read the ZIP's own central directory: member names and the
   decompressed bytes of each member
4. Delete the Test, then send the archive to `POST /tests/import/validate` and
   `POST /tests/import`, with `conflict_resolutions` where the case needs one
5. Read the imported Test's files back through
   `GET /tests/{id}/testdata/content/{rel}`
6. Open the imported Test in the workbench, pick the shared environment, press
   Run, and read the console once the session reaches a terminal state

## Validation

- **Document export:** YAML and JSON each carry the Test name, its Blocks and
  its edges; the content type and the download name follow the format
- **Secret values:** `mask` writes `********` with `masked: true`, `encrypted`
  writes the sealed `wave:enc:v1:` envelope, `plaintext` writes the real value
- **Bulk export:** two or more Tests download as `tests-export.zip`
- **Document import:** a YAML and a JSON upload each create one Test that reads
  back under its own name; a ZIP creates every Test it holds
- **Files travel (export):** a Test carrying files downloads as a zip whose
  members are the document plus `testdata/<test id>/<rel>` per file, each
  holding the uploaded bytes; a Test with no files still downloads as the plain
  document
- **Files travel (import):** import validate reports the archive's file count in
  `testdata_files`; the import writes the files under the new Test id with the
  archive's bytes, and a run of the imported Test resolves `testdata://<rel>`
  and logs the content back
- **Overwrite:** importing over an existing Test leaves only the archive's
  files - the file the archive never carried is gone and the replaced one holds
  the archive's bytes

## V-EXPORT-ELEMENT-TYPES

- Spec: `v-export-element-types.spec.ts`; fixture: `element-types-fixture.json`.
- Element types travel through YAML and JSON Test export / import and through Suite, Regression, System and profile export / import, and the re-imported Test runs with every element as its declared type (REQ-3.1.3.19). Destructive: clears and restores the System variables.
