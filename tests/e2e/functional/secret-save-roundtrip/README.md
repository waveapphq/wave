# V-SECRET-SAVE-ROUNDTRIP-FUNCTIONAL: Save-Path Round-Trip Guard

Verify that re-saving a test whose secret variable reads back as the mask
placeholder never overwrites the stored sealed value, so a later run still
computes on the real bytes. Also guards where Mark as secret lives: the watcher
carries no secret control, the Edit window carries Mark as secret, and a saved
secret stays write-only (SECUI-1).

## Prerequisites

- Backend + frontend running (standard functional-test stack); the stack's
  config file is a copy of `backend/config/config.example.yaml` with a
  throwaway encryption key the harness writes into it
- Shared E2E environment (created by the import helper if missing)
- Fixture: `fixture.json` (a secret string variable + a plain integer variable +
  Log nodes that slice-prove the secret and print the plain value)

## Steps

1. Import the fixture via `POST /tests` and open it in the workbench
2. Read the raw store and record the single sealed envelope; run the workflow
   and read the console
3. Reload the test, edit the plain integer variable in its Edit window, and
   click the toolbar Save (the secret rides along as `********`)
4. Re-read the persisted test and the raw store envelope
5. Reload and run the workflow again
6. (Second test) Open the plain variable's watcher and Edit window, the saved
   secret's Edit window ("Delete & Edit", then Close), and the Add window

## Validation

- **First run:** the console shows `rt-proof=mike-real-bytes` (real slice), a
  bare `********` (direct log), and `plain=7`; the canary appears nowhere
- **After the masked re-save:** `plain_counter` reads `99` (the edit persisted),
  `secret_token` reads `********`, the sealed envelope is byte-identical to
  before, and the canary is absent from the whole store
- **Second run:** the console STILL shows `rt-proof=mike-real-bytes`
  and `plain=99`; a guard regression would slice the placeholder and fail
- **Mark as secret:** the watcher renders no secret control; the plain variable's
  Edit window shows Mark as secret unticked; the saved secret's shows it ticked
  with the masked field, and "Delete & Edit" opens the field empty (write-only);
  the Add window renders Mark as secret

## V-SECRET-TYPED-ELEMENTS-ROUNDTRIP

- Spec: `v-secret-typed-elements-roundtrip.spec.ts`; fixture: `element-types-fixture.json`
  (a secret map and a secret list with declared element types, a plain typed map,
  a plain integer, and a Log that reads them and a Suite's secret map).
- The Test read, a masked export and the Suite read show each secret as the bare
  `********` with no element types, so no key is named and no item counted; the
  plain map keeps its types.
- A run reads every secret element as its declared type; after an unrelated
  toolbar save and a Suite save that echo the masked secrets, the reads stay
  opaque and a second run still reads every element as its declared type
  (REQ-3.1.3.19, REQ-3.1.3.5).
- Isolation: the spec creates its own Suite and Test under a per-run name and
  deletes both after.
