# Template variable renders lazily on reference

Functional proof that a template value kind realizes end-to-end (REQ-3.1.3.15).
A template variable `greeting = "Hello {{user}}!"` renders to `"Hello Ada!"` when
a Log node references it: the reference routes through `LazyVariables.__getitem__`,
which realizes the template via `plugin_executor._evaluate_template`, substituting
the literal `user`. Also guards two behaviors of the live
inspect watcher (the footer metric and unreferenced computed vars).

## Prerequisites

None - the spec imports `fixture.json` via `POST /tests`, ensures the shared
`E2E Execution Env` environment exists, and validates the fixture
(`POST /tests/{id}/validate`, zero errors) before running it.

## Steps

1. Import `fixture.json` (template `greeting = "Hello {{user}}!"` referencing the
   literal `user = "Ada"`; an unreferenced template `farewell` and an unreferenced
   expression `total`; a Log whose message expression reads `greeting`).
2. Open the inspect watcher on `greeting` (idle: "Not rendered yet.").
3. Run the workflow via the canvas Run button.

## Validation

- **Validation gate:** `POST /tests/{id}/validate` returns zero errors.
- **Kind badge:** the `greeting` manager row carries the cyan `{{ }}` template badge.
- **Realization:** after the run the `greeting` watcher's Rendered view shows the
  realized string `Hello Ada!` with the `10 chars` metric; the Template
  (source) view shows `Hello {{user}}!` and carries no metric.
- **Propagation:** the downstream Log emits `Hello Ada!`.
- **Scope:** `GET /workbench/{session_id}/variables` returns `greeting = "Hello Ada!"`
  (type `string`).
- **Node status:** the Log node reaches `success`.
- **Unreferenced computed vars:** after the run, the never-referenced
  `farewell` (template) and `total` (expression) Current watchers show the empty
  state (`Not rendered yet.` / `Not evaluated yet.`), not their source.
