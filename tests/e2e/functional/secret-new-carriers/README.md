# V-SECRET-NEW-CARRIERS-FUNCTIONAL: Setter Literal + Output-Bound Secret

Verify the two secret carriers: a Variable Setter secret literal (sealed
at rest, unsealed at run) and a plugin output bound to a secret variable. Both
mask on every runtime surface and compute on the real bytes.

## Prerequisites

- Backend + frontend running (standard functional-test stack); the stack's
  config file is a copy of `backend/config/config.example.yaml` with a
  throwaway encryption key the harness writes into it
- Shared E2E environment (created by the import helper if missing)
- Fixture: `fixture.json` (a Var Setter with a secret literal keyed by
  `config.variableSecretKeys`, a JSON Parser whose `secret_q` output binds to a
  secret variable, and Log nodes that slice-prove and directly print each)

## Steps

1. Import the fixture via `POST /tests` and open it in the workbench
2. Read the raw store: the setter node config must hold a `wave:enc:v1:` envelope
   and canary S must be absent everywhere
3. Run the workflow (subscribing to the WS stream inside the leading Delay)
4. Collect the console, WS events, session variables, and the generated report

## Validation

- **At rest:** the setter literal is sealed; canary S (`STseal-...`) appears
  nowhere in the store. (Canary O lives in the parser's design-time JSON literal,
  which is cleartext by design, so only canary S is swept at rest.)
- **Real values at run:** `s-proof=sierra-real-bytes` and `o-proof=oscar-real-bytes`
  both print; `pub=pub-visible-marker` prints raw
- **Masking:** the setter-direct and output-direct logs each collapse to a bare
  `********`; neither canary appears in any console line, WS payload,
  session-variable read, or report content
- **Session variables:** `setter_secret` and `bound_secret` read back `********`;
  `bound_public` reads the raw marker
