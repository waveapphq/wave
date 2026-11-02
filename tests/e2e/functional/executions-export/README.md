# Executions Export Functional Test

End-to-end proof of the executions export flows: the detail toolbar's
silent JSON download became a shared-ExportDialog flow, and the list gained
row + bulk export backed by the new `POST /executions/export`.

## Fixture

`fixture.json` - an instant Log-only workflow. The spec imports it via
`POST /tests`, validates it, wraps it in two uniquely-named suites, and runs
both to terminal so the export surfaces have real executions to act on.

## Execution steps (in the spec)

1. `POST /tests` (import) + `GET /tests/{id}/validate` (zero errors).
2. Wrap in 2 suites, `POST /executions` each, poll to terminal.
3. Detail page: toolbar Export -> dialog -> download YAML, then JSON.
4. List: search the execution row -> row Export -> download.
5. List: Mass Action -> select both rows -> bulk Export -> Download ZIP.
6. Cleanup: delete the executions, suites, and test via API.

## Validation

1. Every entry opens the shared ExportDialog: JSON preselected, NO secrets
   checkbox, "Download" (single) / "Download ZIP" + "Export 2 executions"
   (bulk).
2. The YAML download is not JSON (`JSON.parse` rejects it) and contains the
   execution id; the JSON download parses with `id`, `entity_type: suite`,
   and the execution name.
3. The row-level download is the single-execution JSON file.
4. `executions-export.zip` holds exactly 2 distinct `.json` entries (one per
   selected execution), verified by walking the ZIP central directory.
