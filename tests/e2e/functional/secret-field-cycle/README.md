# V-SECRET-FIELD-CYCLE-FUNCTIONAL: Per-Field Reveal then Re-mask Cycle

Verify the "Mask specific fields" list in the block "Secrets" section drives
per-field masking through a full UI cycle (REQ-3.1.3.16): reveal a credential
field, prove it flows cleartext, re-mask it, and prove it renders the placeholder
after a console reset.

## Prerequisites

- Backend + frontend running (standard functional-test stack)
- The compose stack's published `http-echo` service (exposes `/cookie`; see `../../services/README.md`)
- Imports and runs its own Test via `POST /tests` (functional-workflow phase)

## Steps

1. Import `fixture.json` and gate on `POST /tests/{id}/validate` (zero errors).
   The fixture is one HTTP block hitting the http-echo cookie endpoint plus a Log that
   prints its bound response headers map
2. Open the HTTP node config, expand "Secrets", and UNCHECK `Set-Cookie` under
   "Mask specific fields" (reveal); apply the config and save the workbench
3. Run to `passed` and read the console
4. Re-open the config and RE-CHECK `Set-Cookie` (re-mask); apply and save
5. Reset the console (entries accumulate across runs) and re-run

## Validation

- **Revealed run:** the cookie credential flows cleartext -
  `wave_session=<token>` appears in the response-headers log line
- **Re-masked run:** the cookie token appears nowhere; the `Set-Cookie` header
  renders as the `********` placeholder in the log line
