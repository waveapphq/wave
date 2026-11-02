# V-JSON-CONTENT-KINDS (functional): JSON parser content kinds + output modes

JSON parser `json_content` runs as a literal, an expression, and a template, across
both output modes. Removing `noExpression` from `json_content`
adds an expression body that resolves and parses at runtime (new capability);
Template still renders (no behavioral loss); the literal path is unchanged; and
`output_mode` drives results both as a combined map and as individual typed variables.

## Prerequisites

- Backend + frontend running on the worker's ports.
- The shared E2E environment (`ensureEnvironment`); the test imports its own fixture.

## Fixtures

`fixture.json` - three JSON parsers chained through Logs:

- `json-lit`: literal `json_content`, combined mode; queries `name_q` / `count_q`.
- `json-expr`: expression `json_content` = `raw_json` (a string variable holding
  `{"price":19.99,"qty":5,"active":true}`), individual mode; queries coerced to
  float / integer / boolean.
- `json-tmpl`: template `json_content` = `{"store": "{{ who }}", "n": 2}` (`who="BookShop"`),
  combined mode; query `store_q`.

## Steps

1. Import the fixture via `POST /tests`; assert `GET /tests/{id}/validate` returns zero errors.
2. Open the test in the workbench, select the E2E environment, and Run to a terminal state.
3. Read the console log messages and the per-node execution status.

## Validation

- Run status is `passed`; every JSON parser and Log node reports `data-execution-status="success"`.
- Literal + combined: console shows `Ada` and `7` (from `lit_results`).
- Expression + individual: console shows `19.99` (float), `5` (integer), `True` (boolean),
  proving the `json_content` EXPRESSION resolved and parsed and per-query coercion ran.
- Template + combined: console shows `BookShop`, proving the `{{ who }}` template
  rendered to JSON and parsed.
