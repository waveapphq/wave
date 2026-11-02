# Validation: runtime enum validator

End-to-end coverage for the runtime enum check `validate_enum_param`, and for the
save check that refuses the same value written as a literal.

## What it asserts

- An HTTP node holding the literal `method='xyz'` is refused at save with
  `INVALID_ENUM_VALUE` and the exact text
  `Setting 'method' of block 'http-client' must be one of: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS`.
- The fixture holds the method as an expression (`'xyz'` and a 60-character
  value), so it saves and validates clean: an expression is checked when the
  Block runs.
- At execution time, both HTTP nodes raise with the exact anchored format:
  ```
  ^Parameter 'method' must be one of: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS; Actual value was '<value>'\.$
  ```
- For the 60-character value, the error names only its length
  (`a 60-character value`), never a prefix of it.
- Both errors are caught by the surrounding `try-catch-finally` blocks,
  whose catch-path log markers (`xyz-caught`, `long-caught`) prove the
  exception flow.
- Bookend log entries (`before-all`, `after-all`) prove the workflow ran
  to completion despite the runtime validation failures.

## Pre-requisites

- Backend + frontend running (the functional config spawns them in
  host-mode, or `WAVE_E2E_EXTERNAL_SERVICES=1` re-uses container-managed
  services).
- The shared E2E environment (`E2E_ENV_NAME`) exists. The test calls
  `ensureEnvironment(page.request)` which idempotently creates it.

## Run

```bash
./scripts/e2e-targeted-local.sh functional/validation-runtime-enum/v-validate-runtime-enum-functional.spec.ts
```

## Files

- `fixture.json` - 8-node workflow: bookend logs, two try-catches each
  wrapping an HTTP node whose `method` expression gives a value outside the list, plus per-branch catch
  logs that emit the marker strings the spec asserts on.
- `v-validate-runtime-enum-functional.spec.ts` - imports the fixture,
  validates, runs, and asserts on the exact log format and truncation.
