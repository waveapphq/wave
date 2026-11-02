# V-SECRETS-AT-REST-FUNCTIONAL: Encrypt-at-Rest Canary

Verify secret values are sealed on disk (test variables + profile credentials),
runs compute on the real unsealed values, and no canary leaks into any output
or persisted execution record.

## Prerequisites

- Backend + frontend running (standard functional-test stack); the stack's
  config file is a copy of `backend/config/config.example.yaml` with a
  throwaway encryption key the harness writes into it
- Shared E2E environment (created by the spec if missing)
- Fixtures: `fixture.json` (secret variable canary A + plain sibling),
  `profile-http.json` (http profile with credential canary B)

## Steps

1. Create the http profile and import the fixture via `POST /tests`
2. Validate the test (`/tests/{id}/validate`) - zero errors
3. Read the raw store files (test definition, profile) and sweep the whole
   store directory for both canaries
4. Run the workflow in the workbench; collect console, WS events, session
   variables, and the generated report
5. Start a tracked execution (`POST /executions`) of the same fixture and
   read its persisted record

## Validation

- **At rest:** definition and profile files carry `wave:enc:v1:` envelopes;
  canaries A and B appear nowhere in the store; the plain sibling variable
  and `base_url` stay cleartext
- **Real values at run:** slice-transforms print `a-proof=alpha-real-bytes`
  and `b-proof=bravo-real-bytes`; the run completes as passed
- **Masking over sealing:** the direct log of the secret variable renders
  bare `********`; neither canary appears in any console line, WS payload,
  session-variable read, or report content
- **Execution record:** `GET /executions/{id}/variables` and the persisted
  execution files contain no canary and no `creds.*` alias entries; the
  post-run store sweep finds neither canary anywhere on disk

# V-SECRETS-AT-REST-FN-LOCALS: Function-local secrets

Spec: `v-secrets-at-rest-fn-locals-functional.spec.ts`. A Function's own secret variable, in a
Local Function and in a library Function, is sealed at rest and masked on every surface
(REQ-3.1.2.1, REQ-3.1.3.5, REQ-4.5.1).

## Prerequisites

- Backend + frontend of the run's own stack; no seed script. Each test creates its own `zz-`
  Test and, for the library cases, its own library Function, and deletes them (Functions with
  `cascade=true`). The MCP test resets the MCP settings afterwards.

## Steps

1. Create the local `fn_tok` marked as secret through the in-Function Add menu and Save, or
   publish such a Function to the library.
2. Open the Test, drill into the Function Block, run the Test from the toolbar, and run it as a
   tracked execution (`POST /executions`).
3. Read the store, the exports in each Secret values mode, a backup archive and the MCP reads.

## Validation

- No store file holds the value; the Test or library Function carries an envelope.
- The `fn_tok` row reads `********` while drilled, before and after a run; the body Log prints
  `in=******** tail=<real tail>`, so the run used the real value.
- Exports write `********` (Mask), an envelope (Keep encrypted) or the value (Decrypt); a backup
  member holds the mask or an envelope; the recipe readback leaves the value out and
  `get_function` masks it.
- The tracked execution's variables and record hold the masked body line and never the value.
