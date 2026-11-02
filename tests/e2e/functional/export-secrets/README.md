# V-EXPORT-SECRETS: per-export Secret values choice

Verify the shared "Secret values" picker (Mask / Keep encrypted / Decrypt) drives
the emitted secret form on real exports, that the functions and global-variable
surfaces carry the mode, and that importing a foreign-encrypted secret warns per
entity without blocking the import. REQ-4.5.1, REQ-5.2.4.9.

## Prerequisites

- Backend + frontend running (a dev secret encryption key is provisioned).
- No seed script: each test self-seeds via `POST /tests`, `POST /functions`, and
  `POST /variables/system`, then cleans up.

## Steps

1. Tests: create a test with a secret + plain variable, open its export dialog on
   `/tests`, and download in each of the three modes (JSON format).
2. Functions: create a library function, open its export dialog on `/functions`.
3. Global variables: set a secret + plain GV, export via the API in encrypted mode.
4. Import: upload a GV file whose secret is a `wave:enc:v1:` envelope this instance
   cannot decrypt, through the System Variables import dialog.

## Validation

- **Mask:** exported `secret_var.value` is `********` with `masked: true`; the raw
  value appears nowhere.
- **Keep encrypted:** `secret_var.value` is a `wave:enc:v1:` envelope, never the raw
  value, and carries no `masked` flag.
- **Decrypt:** the amber plaintext warning is shown before download; the exported
  `secret_var.value` is the real cleartext value.
- **Functions dialog:** the export dialog shows the Secret values picker with three
  options (Mask / Keep encrypted / Decrypt) and Mask selected by default. The
  functions payload transform (all modes + version history) is unit-covered in
  `backend/tests/functions/test_import_export_export.py`.
- **Global variables encrypted:** `gv_secret.value` is a `wave:enc:v1:` envelope;
  the plain GV stays cleartext.
- **Foreign import warning:** the review step shows the per-secret warning
  "Secret '<name>' is encrypted by another WAVE instance and cannot be decrypted
  here; re-enter it after import"; the import still completes and the imported
  secret is stored null and stays secret (an encrypted export reads null).

# V-IMPORT-FOREIGN-SECRETS and V-IMPORT-MASKED-SECRETS: secrets an import cannot keep

`v-import-foreign-secrets-functional.spec.ts` and `v-import-masked-secrets-functional.spec.ts`
bring in a secret WAVE cannot open (sealed by another WAVE) or the `********` a masked export
leaves, at every place a secret lives: a Test variable, a Variable Setter secret literal, an HTTP
basic password, a Suite variable, a Regression variable, a System variable, an HTTP profile
password, a library Function workflow secret, and all of them by a backup restore. The legs live
in `import-secrets-harness.ts`. REQ-4.5.19, REQ-3.1.3.20, REQ-3.1.3.21; EXPORT-5, EXPORT-7.

## Prerequisites

- Backend + frontend running, the shared stack's `http-echo` service up.
- No seed script: each leg seeds its entity with a real secret through the API, exports it masked
  or encrypted (envelopes swapped for a foreign one), deletes it and imports the file through the
  UI; the restore legs cut a fresh backup archive to their own members. Everything is deleted after.

## Steps

1. Import the file through the list page's Import dialog (Tests, Suites, Regressions, Profiles,
   Functions, System Variables) or restore the archive on the Backup page.
2. Read the stored value (plaintext export, and the null look on the Variable Manager, Suite,
   Regression and System Variables lists).
3. Run the Test, Suite or Regression; the block reading the secret sits in a Try/Catch and an
   http-echo `/retry` probe with the run's key follows it.
4. Read the run's failure report through MCP `get_failure_report`.

## Validation

- The secret is stored null and stays secret.
- The block that reads it fails before sending and names the null setting; the probe answers
  attempt 1, so nothing was sent.
- The failure report lists it as owed ("Secret variable '<name>' holds no value", "Secret field
  '<field>' holds no value").
- A masked archive restored with Overwrite over the stored secrets keeps every real secret.
