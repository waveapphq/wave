# V-CRED-FIELD-01: Declared credential input field

Verify the plugin credential-field status indicator + write-only masking
(SECFLD-1..4).

## Prerequisites

Self-seeds via the API - no seed script. Imports
`tests/e2e/fixtures/secrets/cred-field.json` (an SSH Session Open whose password is a
declared credential LITERAL, private_key references a NON-secret variable, and
passphrase references a SECRET variable) and opens the node's config sheet. Resets the
system masking flags to all-off in beforeEach so a sealed literal renders write-only.

## Steps

1. Import the fixture and open http://localhost:3000/workbench?editTest={id}
2. Double-click the SSH Session Open node to open its config sheet
3. Read the credential rows; expand the Advanced group and the Secrets section
4. Toggle the sealed password to expression; edit + re-save the password

## Validation

- **Sealed literal:** masked write-only affordance (`Edit protected value`) + a gray
  Lock carrying the literal tooltip; the `wave:enc:v1:` envelope never renders.
- **Non-secret expression:** an amber alert with the exact copy naming the variable.
- **Secret expression:** a gray Lock ("Value protected - references a secret variable.").
- **Mask specific fields:** password / private_key / passphrase rows in the Secrets section.
- **Literal -> expression:** a "Discard protected value?" confirm; the editor never shows
  the envelope; the persisted config carries no envelope for password afterward.
- **Post-save re-mask:** editing + saving re-masks the field write-only without a reload;
  the persisted config holds a new sealed envelope and never the typed plaintext.

# V-CRED-STORED-GATE-01: Variable Setter stored-secret gate

Verify the secret row of a Variable Setter: a saved secret is masked and can only be
replaced through the "Edit Protected Value?" question, and the question hands keyboard
focus back to the row whichever way it is answered (SECUI-9, REQ-3.1.3.5, REQ-3.1.3.18).

## Prerequisites

Self-seeds via the API - no seed script. Imports
`tests/e2e/fixtures/secrets/varset-gate.json` (one Variable Setter whose `saved_secret`
row is a saved secret text) and opens the block's config sheet. Resets the system
masking flags to all-off in beforeEach so the sealed value renders write-only.

## Steps

1. Import the fixture and open http://localhost:3000/workbench?editTest={id}
2. Double-click the Variable Setter block to open its config sheet
3. Click the masked value and answer the question: Cancel, then Escape, then
   "Delete & Edit" (each in the test that covers it)
4. After Cancel and Escape: change the Description, save the config sheet and the
   test, reopen the sheet and read the saved test over `GET /tests/{id}/workflow`
5. After "Delete & Edit": type a value in the editor, save the config sheet and the
   test, and reopen the sheet without a page reload

## Validation

- **Columns:** the Secret and Value columns carry their labels.
- **Saved secret:** exactly one masked field (`Edit protected value`); the stored text
  and the `wave:enc:v1:` envelope never render.
- **Cancel and Escape:** the question is gone, the config sheet stays open, no
  "Edit value" sheet opened, exactly one masked field shows and it holds keyboard focus.
- **Save after Cancel and Escape:** the reopened field is still masked; the saved test
  holds the new Description and the same sealed value as before, byte for byte.
- **Delete & Edit:** the "Edit value" sheet opens empty, the row is no longer masked,
  and keyboard focus is on the row's own Edit control, not on the page body.
- **Typed secret:** a value typed this session stays readable in the row until the test
  is saved, then masks again without a reload and never shows the typed text.

# V-CRED-MAP-GATE-01: Declared MAP credential input field

Verify the map form of the same gate on a K8s Apply block: `secret_data` (Secret Data)
is a declared MAP credential, so it seals value by value and its keys stay readable at
rest. The field is protected as a whole once stored, while the ConfigMap `data` (Data)
map beside it is not a credential and never changes (SECFLD-1, SECFLD-4, K8SWRITE-3,
REQ-3.1.3.18).

## Prerequisites

Self-seeds via the API - no seed script. Imports
`tests/e2e/fixtures/secrets/k8s-apply-map-gate.json` (two K8s Apply blocks: one Secret
form of type `kubernetes.io/tls` whose Data map the import seals, one ConfigMap form
whose Data map stays plain) and opens each block's config sheet. Resets the system
masking flags to all-off in beforeEach so a sealed map renders write-only.

## Steps

1. Import the fixture and open http://localhost:3000/workbench?editTest={id}
2. Double-click a K8s Apply block to open its config sheet
3. Read the Data rows; drive the Edit Protected Value dialog (Cancel and Delete & Edit)
4. Retype the Secret Data map, save the config sheet and the workbench, and reopen the
   sheet with and without a page reload

## Case ids

| Id | What it proves |
|---|---|
| `MG-a` | A stored Secret Data map renders as one protected value: no entry count, no keys, no values and no envelope, while the ConfigMap Data map still shows its entries as one line |
| `MG-b` | Cancel on the Edit Protected Value dialog opens no editor, leaves the row protected, and leaves the stored map on disk unchanged |
| `MG-c` | Delete & Edit clears the stored map and opens an empty key/value editor, and the row then shows the empty map `{}` |
| `MG-d` | A map typed this session offers its quick-insert keys and reads back as typed, and one save renders it protected with NO reload; the persisted values are envelopes and never the typed text |
| `MG-e` | After a full reload the saved Secret Data map is still protected while the ConfigMap Data map still shows its keys and values |
