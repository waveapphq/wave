# V-PARAM-TEMPLATE-TRIM-FUNCTIONAL: Single-line string param kinds + trim

Verify that an HTTP node's single-line `url` string param
resolves through all three value kinds and the strict-param trim, end-to-end
through a real run, plus that the re-homed multiline body template still renders.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- The compose stack's published `http-echo` service (`127.0.0.1:9449`) for the body case.
- The shared E2E environment (`ensureEnvironment`); the spec creates it if absent.
- No fixtures need pre-seeding; the spec imports its own fixture.

## Fixtures

- `fixture.json` - one workflow chaining four HTTP requests, each read back by a
  downstream Log:
  - `http-tmpl`: GET `{{base_url}}/health` (Template kind) -> `tmpl_url`
  - `http-expr`: GET `base_url + '/health'` (Expression kind) -> `expr_url`
  - `http-trim`: GET a literal url with a trailing newline -> `trim_url`
  - `http-body`: POST `/echo` on the published `http-echo` service
    (`127.0.0.1:9449`, container-mode host via `injectHttpHost`) with a
    multiline Template body `Greeting: {{ greeting }}\nDone` -> `echo_body`
  - `base_url` and the literal trim url are set at runtime.

## Steps

1. Import `fixture.json` via `POST /tests`; assert `POST /tests/<id>/validate`
   returns zero errors.
2. Navigate to `/workbench?editTest=<id>`, wait for the canvas.
3. Select the E2E environment and Run; wait for the run to leave `running`.
4. Read the console logs.

## Validation

- Step 1: the fixture validates with zero errors.
- Step 3: the workflow status is `passed`.
- Step 4: the console contains -
  - `tmpl=` + a URL ending `/health` with no `{{` (template rendered);
  - `expr=` + a URL containing `/health` (expression evaluated);
  - `trim=[` + a URL ending `/health]` (literal url trimmed - bracket flush, no
    trailing newline/space);
  - `Greeting: Ada` (multiline body template rendered at execution).
- Every node shows execution status `success`.
