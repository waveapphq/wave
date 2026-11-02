# V-SECRET-ENTITY-GRID-FUNCTIONAL: Suite + Regression Secret Grid

Verify the unified secret model on the Suite and Regression variable grids: the
save-path guard preserves a sealed value across a masked re-save, and the grid
un-secure affordance prompts confirm-and-clear. Runs both proofs per scope.

## Prerequisites

- Backend + frontend running (standard functional-test stack); the stack's
  config file is a copy of `backend/config/config.example.yaml` with a
  throwaway encryption key the harness writes into it
- Creates and deletes its own suites / regressions (functional-destructive phase)

## Steps (per scope: Suite, Regression)

1. Create the entity via `POST /{suites|regressions}` with a secret variable
   (real canary) plus a plain variable
2. Read the raw store envelope set; read the masked variables via the API
3. `PUT` the whole variables map back with the secret echoed as `********` and
   the plain variable changed (the grid's masked re-save)
4. Re-read the raw store envelope set and the variables
5. Open the entity detail page and the Edit Variables dialog; toggle the secret
   variable's Secret checkbox

## Validation

- **Created sealed:** the canary appears nowhere in the store; the secret reads
  back `********`
- **Masked re-save:** the stored sealed envelope set is byte-identical to before
  (the guard preserved it), the plain edit persisted (`note-v2`), and the canary
  is still absent from the whole store
- **Un-secure confirm gate:** unchecking Secret opens the "Remove Secret
  Protection?" confirm; Cancel keeps the masked write-only cell
- **Un-secure confirm-and-clear:** confirming removes the masked cell; a re-entered
  plaintext value persists as a readable, non-secret variable after save + reload
