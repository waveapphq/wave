# V-CSV-SECRET-MASKING-FUNCTIONAL: secret masking via CSV/Log

Verify the secret-masking fix (scrub-before-truncate + both-quote-context
escaped forms) end-to-end, using the CSV plugin as the vehicle - the leak was
first hit with a multiline CSV-content secret. Backend unit guards already cover
it at 100%; this is the E2E belt-and-suspenders.

## Prerequisites

No seed. The single `fixture.json` declares `secret: true` variables carrying distinctive
family tokens that survive both the raw value and every repr-escaped form
(`CSVNL-` newline, `CSVSP-` tab/quote/backslash, `CSVAP-` apostrophe, `CSVLG-` >2048 chars),
plus a 4-char PIN and a non-secret control. A leading Delay holds the run while the spec
subscribes to the WS log stream.

## Steps

1. `./scripts/e2e-targeted-local.sh functional/csv-secret-masking/v-csv-secret-masking-functional.spec.ts` from the root of
   the clone, or the whole suite via `./scripts/ci-playwright-local.sh`.

## Validation

- **G-1..G-4 (Inputs echo):** each secret masks (`********`) in its node's DEBUG Inputs
  echo; its family token appears nowhere in that echo (raw or repr-escaped).
- **G-3/G-6 (INFO console):** the composed apostrophe secret and the 4-char PIN mask
  (`g3=********`, `g6=********`); the non-secret sibling stays cleartext (masking is
  selective).
- **Out of scope:** a parsed table is a transform of the secret whose cells are
  substrings of the registered value, so it is visible by WAVE's documented model (the
  registry scrubs the exact registered value, not its substrings) - the sweep is scoped
  to the plugin INPUT echo, not the whole run.
- **G-5 / G-7:** the enum-validator length-only error and the per-field reveal cross-secret
  behavior belong to plugins the CSV plugin lacks (no base-validator enum param, no declared
  secret param); they are covered by `validation-runtime-enum`, `secret-field-cycle`,
  `secret-field-masking`, `secret-reveal-controls`, and the backend
  `test_enum_validator.py` / `test_secret_runtime.py`.
