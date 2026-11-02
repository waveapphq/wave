# V-SECRET-FIELD-MASKING-FUNCTIONAL: Per-Block Secret Masking

Verify the per-block Secret masking control (REQ-3.1.3.16): a plugin masks a
declared credential field by default (registered with the run's secret registry
so it is scrubbed everywhere) but leaves it visible when the block reveals it via
`unmasked_secret_fields`. Field masking is value-level - the surrounding
container output stays viewable.

## Prerequisites

- Backend + frontend running (standard functional-test stack)
- The compose stack's published `http-echo` service (exposes `/cookie`; see `../../services/README.md`)
- Imports and runs its own Test via `POST /tests` (functional-workflow phase)

## Steps

1. Import `fixture.json` and gate on `POST /tests/{id}/validate` (zero errors)
2. Run the workflow to `passed`. It runs two HTTP blocks against the http-echo
   cookie endpoint, each logging its bound response headers map:
   - Block A (`http-mask`): Set-Cookie CHECKED (default) - uses the service's
     server-side default cookie token
   - Block B (`http-reveal`): Set-Cookie REVEALED (`unmasked_secret_fields`) -
     uses a distinct token via `?value=`
3. Read the console logs; generate + read the session report

## Validation

- **Masked field scrubbed:** Block A's cookie token appears nowhere in the logs
  or the report (registered + scrubbed run-wide)
- **Container viewable:** Block A's headers-map log still shows `Set-Cookie` as
  the `********` placeholder while `Content-Type: application/json` stays readable
- **Revealed field visible:** Block B's headers-map log carries the raw
  `wave_session=<token>` cookie value; the token is present in the report
- **Distinct tokens:** the two blocks use different tokens by construction, so
  Block A's run-wide registration cannot mask Block B's revealed value
