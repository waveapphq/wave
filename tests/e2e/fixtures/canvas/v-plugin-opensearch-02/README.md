# V-PLUGIN-OPENSEARCH-02: OpenSearch Editor States

Verify the OpenSearch Query editor in DQL and Query DSL mode: its footer, coloring, keys, the Get fields suggestion row, the Fields chip in each state with the Fields popover, the FIELDS list, the unknown-field check, key and value suggestions, the Custom (JSON) aggregation editor, the Index pattern and field-kind lists with the suggestion rows as the one value field, the blank Index pattern, and the editor size.

## Prerequisites

The E2E OpenSearch service is up (`https://127.0.0.1:9477`, user `wave` / `os-secret`, the lab CA). No seed script: the spec seeds its own indexes as `admin` under a fresh run token and deletes them afterwards:

- `wave-e2e-<token>-app-logs`: MAP-LOGS with the ten F-LOGS documents
- `wave-e2e-<token>-daily-<YYYY.MM.DD>` for today and the two days before (UTC): MAP-LOGS, one document each

Each test persists its own Test holding one OpenSearch block (Cluster URL `https://<OpenSearch host>:9477`, Username `wave`, Password `os-secret`, CA Certificate the lab CA, Verify Server Certificate on, Index pattern `wave-e2e-<token>-app-logs`) and deletes it afterwards. Blocks that differ:

- dql mode, coloring: Query `log.level:ERROR or (log.level:INFO and not message:"Load test finished")` / `and service.name:{{ svc }} and host.name:check` as a Template, Test variable `svc`
- chip failed: Cluster URL `https://127.0.0.1:9479` (nothing listens there)
- query dsl: Query language Query DSL, a `bool` query holding `{{ svc }}` as a Template
- custom json: Mode Aggregate, one Custom (JSON) stat `{"max": {"field": "latency_ms"}}`
- indexes: Index pattern `wave-e2e-<token>-*`, Mode Aggregate, Stats Count and Sum of `latency_ms`
- blank index: Index pattern empty (persisted through the admin bulk route)
- size: Cluster URL `https://127.0.0.1:9479`, Query language Query DSL, Query `{"match_all": {}}`

## Steps

1. Open the Test at http://localhost:3000/workbench?editTest=<id>, open the OpenSearch config sheet and the Query row's Edit value sheet
2. dql mode: open the Kind list, switch Kind to Literal and back, open F1 Help
3. keys: click line 2, press Ctrl+F, Esc, then Ctrl+G
4. suggest (blank Query): press Ctrl+Space and click `Get fields from the cluster`
5. chip states: click Get fields while the pull is held, click Stop; click Get fields again; put the cursor at the end of the line, open the chip's Fields popover and click `service.name`
6. chip failed: click Get fields, hover the chip, click it again
7. fields list: click Get fields, type ` and service.` at the end of the line
8. unknown field: click Get fields, replace the text with `log.invalid: ERROR`
9. query dsl: replace the text with `{"match": {"message": {"query": "Payment", "operator": ` and type `"`, press Ctrl+Space; on a blank Query DSL block type `{"mat` and walk the list to `match`, `match_all` and `match_phrase`
10. custom json: open the stat, click Edit JSON, replace the text with `{"avg": {"invalid_param": "latency_ms"}}`
11. indexes: open the Index pattern list and click Get indexes; open the Time field list (Advanced) and pick `@timestamp`; open the Stats editor and the Sum stat's Field list; pick `wave-e2e-<token>-app-logs` in the Index pattern list
12. blank index: open Query, hover and click the chip; type ` and ` at the end of the line and press Ctrl+Space
13. size: open Cluster URL, drag its header, close it; open Query, set Kind to Literal, drag the corner grip to the top-left, click Get fields

## Validation

- **DQL footer:** STRING badge; Kind Template (Literal, Template offered); Format hidden in Template and `DQL` locked in Literal; F1 Help lists Autocomplete, Run, Save, Close, Find and replace, Go to line, Indent / outdent, Undo / redo; chip `Get fields` with the database icon; Close, Save, Run in one row, Run primary
- **Coloring:** field names before `:` in the property color, `and` / `or` / `not` in the keyword color, `"Load test finished"` in the string color, `{{ svc }}` in the placeholder color (cyan)
- **Keys:** Ctrl+F opens the find panel, Esc closes it with the editor still open; Ctrl+G opens Go to line on line 2
- **Suggest:** with nothing loaded the list holds only `Get fields from the cluster` under FIELDS; picking it loads the fields, the text is unchanged, and the list turns into the 16 fields of MAP-LOGS
- **Chip states:** `Getting fields...` with a spinner and a square Stop; Stop returns to `Get fields`; `Got 16 fields` with a check in the success colors; `Fields · 16` with Refresh fields beside it; the popover (Search fields…) lists 16 fields and the pick inserts `service.name` at the cursor
- **Chip failed:** `Could not get fields` in the error color with the alert icon; tooltip `Could not connect to OpenSearch at 127.0.0.1:9479: ...`; a click sends a new pull and ends failed again
- **FIELDS list:** after `service.` only `service.name` and `service.version`, each with `keyword` muted at the right
- **Unknown field:** `log.invalid` has the amber wavy underline; strip `Line 1: Unknown field log.invalid in wave-e2e-<token>-app-logs`; Save and Run enabled
- **Query DSL:** keys, strings, numbers and `{{ svc }}` each in their color in Template kind; the operator value offers `and` and `or`; `{"mat` offers `match`, `match_all` and `match_phrase`, each with its description
- **Custom (JSON):** no Kind, Format `JSON` locked, no Run; `"invalid_param"` underlined with `Line 1: "invalid_param" is not a parameter of avg`
- **Indexes:** the Index pattern list shows `wave-e2e-<token>-app-logs` (index) and `wave-e2e-<token>-daily-*` (3 indexes); Time field, not set, shows `@timestamp` in gray with no reset icon and offers only `@timestamp`; picked, it is the value (not gray) with the reset icon; the Sum stat's Field offers only `latency_ms`; the picked index is the value with no reset icon (Index pattern has no default)
- **Blank index:** chip `Get fields` disabled and dimmed with the tooltip `Fill in Index pattern to get fields`; a click starts no pull; no Get fields row in the suggestion list
- **Size:** the Query editor opens at 720 x 460 after the moved plain sheet; at its floor the width stays 720; with Query DSL, Literal and the failed chip every footer label is on one line and Run is inside the sheet
