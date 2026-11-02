# V-SECRET-REVEAL-CONTROLS-FUNCTIONAL: Controlled Secret Reveal

Verify the per-block run-output reveal control (REQ-3.1.3.5) and the scope-based
system reveal toggles (REQ-3.1.3.17) end-to-end. One fixture chains three Log blocks
that print the same secret with distinct tri-state settings, plus a saved secret
variable (`api_token`) the panel and watcher reveal.

The scope-based controls:
- `test_variables` - the whole workbench Variable Manager surface (panel rows AND the
  inspect/watcher modal, together).
- `shared_variables` - the global / regression / suite variable editors.
- `run_output` (per-block + system run-output reveal) is unchanged.

## Prerequisites

- Backend + frontend running (standard functional-test stack)
- Admin masking route reachable (`GET/PUT /admin/secret-masking`)
- Every test resets all four flags to masked in beforeEach/afterEach so a revealed
  flag never leaks to another spec on the same backend

## Steps

1. Import `fixture.json` and gate on `POST /tests/{id}/validate` (zero errors)
2. Block-level tri-state: run with every system flag off and read the console
3. run_output toggle: run masked, flip `run_output` on, clear the console, re-run
4. test_variables toggle: read the panel cell + open the watcher, off then on
5. shared_variables toggle: read the system-variables read-only table, off then on;
   confirm a workbench test variable stays masked (scope isolation)

## Validation

- **Always reveal:** the `REVEAL:` line shows the token in cleartext; a run-start
  WARN naming the block and a pre-block WARN are emitted (exact strings)
- **Use system setting (off):** the `SYSTEM:` line masks the secret bytes
- **Always mask:** the `MASK:` line masks regardless of the setting
- **run_output on:** the `SYSTEM:` line reveals the token WITHOUT editing the block,
  and both warnings are suppressed
- **test_variables on:** the saved secret reveals in the panel AND the watcher together
  (both masked/locked when off)
- **shared_variables on:** a secret system variable reveals in the read-only table while
  a workbench test variable stays masked (scope isolation)

## Function specs

Three specs carry the same reveal rules into Function bodies. They share `masking-flags.ts`, which sets the four
system reveal settings through `PUT /admin/secret-masking` (`ALL_MASKED` is the state each test starts from and
restores). Each seeds its own Test (and library Function where named) through the API, with zero validation errors.

### V-FN-CREDENTIAL-FIELD-FUNCTIONAL

`v-fn-credential-field-functional.spec.ts` - a credential field on a Block inside a Local Function
(SECFLD-1, SECFLD-2, SECREV-6).

- Prerequisites: a Test with an SSH Session Open at the root and one inside a Local Function, each holding a
  stored password.
- Steps: type a new password into the Block inside the Local Function and save the Test; then turn "Unmask plugin
  credential input fields" off and on and reopen both Blocks.
- Validation: right after the Test save (no reload) the Function's password shows masked and write-only, as the
  root Block's does, and the saved Test holds a sealed envelope for each and never the typed text; with the
  setting off the Function's Block shows its password masked, with it on it shows the stored value, as at the root.

### V-FN-REVEAL-WARNINGS-FUNCTIONAL

`v-fn-reveal-warnings-functional.spec.ts` - every revealing Block is announced, library Function bodies included
(SECREV-2, SECREV-5).

- Prerequisites: a library Function (`POST /functions`) whose body holds an "Always reveal" Log on its main flow,
  one in a Try path and one in a For loop body, then a plain Log; a Test with a revealing root Log followed by a
  Function Block running it. Run-output reveal stays off.
- Steps: run the Test and read the console.
- Validation: the run-start WARN names every revealing Block, the Function's included, in order; each revealing
  Block gets `Secret masking bypassed for this block - ...` right before it runs (root, Function body, Try path,
  loop body); the plain Log gets no such WARN.

### V-FN-SECRET-REVEAL-FUNCTIONAL

`v-fn-secret-reveal-functional.spec.ts` - the reveal settings cover a Function's own secrets (SECREV-6, VMGR-11).

- Prerequisites: a Test whose Local Function declares a secret local and a secret output with a default, and a
  library Function declaring the same plus an SSH Session Open holding a stored password.
- Steps: drill into the Local Function with "Reveal test variables" off, then on (before and after a run); then
  read the Test and every Function read (latest, `?version=`, `/versions/{v}`) under each setting.
- Validation: off, the secret local and output rows show `********`, their watchers cannot be opened and no
  `8 chars` metric appears; on, the rows and watchers show the real values with the metric of each value's own
  length. With both settings off every read returns `********` for the local and output and a sealed credential;
  "Reveal test variables" alone reveals the local and output only; "Unmask plugin credential input fields" alone
  reveals the credential only.
