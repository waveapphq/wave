# System Variables Export/Import Functional Test

End-to-end proof of the server-side System Variables export/import: the
client-side serializer (which wrote JSON into a `.yaml` file) is gone, and the
Settings UI drives the shared Export/Import dialogs against the real endpoints.

## Fixture

No file fixture - each test seeds the collection via `POST /variables/system`
and resets it in `beforeEach` (`DELETE /variables/system`).

## Execution steps (in the spec)

1. Seed system variables (plain + integer + secret) via API.
2. Open Settings > System Variables > Edit Variables, select all rows, and
   export through the bulk Export button (shared ExportDialog).
3. Capture the download and assert on its bytes.
4. Drift the live collection via API, then re-import the downloaded file
   through the shared ImportDialog (upload -> validate -> review -> import).

## Validation

1. The export dialog is the shared ExportDialog with a single "System
   Variables" identity, YAML default, and NO secrets checkbox.
2. The `.yaml` download is real YAML (`JSON.parse` rejects it), carries the
   collection, and secret values arrive pre-masked (`********`) with the raw
   secret nowhere in the file.
3. The `.json` variant parses and carries the same values.
4. Re-import surfaces conflicts whose resolution select offers ONLY
   Overwrite / Skip (initial Overwrite, no Auto-rename), and importing
   restores the exported values in both the readonly table and the API.
