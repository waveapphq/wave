# V-FIELD-LIST-FIELDS: One-Line List Fields

Verify list settings drawn as one-line list fields:
OpenSearch Fields and Stats, Python Arguments, HTTP Parts, Verify Server Certificate and Cipher Suites
(FIELD-10, FIELD-6, FIELD-2, FIELD-1, HTTP-13).
Spec: `tests/e2e/visual/canvas/v-field-list-fields.spec.ts`.

## Prerequisites

None - each test creates a `zz-11541-s2-` Test through `POST /tests`, checks it validates with zero errors,
opens it and deletes it afterwards. It holds:

- an OpenSearch Block in Search mode with Fields `@timestamp`, `message`
- an OpenSearch Block in Aggregate mode with Stats `{"stat": "count"}`, `{"stat": "sum", "field": "bytes"}`
- a Python Block with Arguments `alpha` and the {x} item `run_id` (Test variable `run_id = "r-42"`)
- an HTTP Request Block in multipart Body Mode with two text Parts, Verify Server Certificate ticked and
  Cipher Suites not set

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Open each Block's window from its cog and Cancel it; on the HTTP Request window open the Body and the
   TLS / Certificates groups.
3. Read `GET /api/v1/system/tls-capabilities` for the HTTP Request list of TLS 1.2 to 1.3.

## Validation

- **Fields:** `["@timestamp", "message"]` in the list color, with the reset icon, expand and `{ }`
- **Stats:** `[{"stat": "count"}, {"stat": "sum", "field": "bytes"}]` (one space after each `,` and `:`),
  list color, cut with "…"
- **Arguments:** `["alpha", {{ run_id }}]` with `{{ run_id }}` unquoted in the expression color; expand, no `{ }`
- **Parts:** `[{"kind": "text", "name": "title", "value": "Release notes…` in the list color, cut with "…"
- **Verify Server Certificate:** the label in full on two lines, checkbox ticked, no expand, `{ }`
- **Cipher Suites:** not set; the gray default (Text Muted) is the HTTP Request list for TLS 1.2 to 1.3, the
  whole catalog in catalog order (`["ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-…`), cut with "…", no reset icon
- **Stored Test:** each line is its Block's stored value; Cipher Suites is not stored
- **Themes:** every check above in the dark and the light theme; a screenshot of each window is attached
