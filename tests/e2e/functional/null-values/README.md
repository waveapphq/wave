# V-NULL-VALUES Null Values - Functional

End-to-end coverage of null as the one empty value (REQ-3.1.3.20 to REQ-3.1.3.23). A block
setting, a Function input or a `{{ }}` piece that is null fails the block before it starts and
names what is null; a null map value or list row reaches the Block, which uses it its own way
(HTTP Request sends an empty header, SQL binds NULL, Helm passes `key=null`) or fails naming the
field and the entry (Shell Script, Python, K8s Apply); an entry in expression mode with nothing
typed blocks Save (FIELD-13); a blank setting falls back to its default; WAVE's own printing
writes null as `null`, booleans as `true` / `false` and lists and maps as JSON text; the editors
show a stored null as the null chip; Fix All declares a missing variable holding null; and the
MCP run tools treat null and overrides the same way.

Every spec imports its own fixture or recipe with unique names, checks it validates with zero
errors, and deletes what it made. Every case that must fail sits in its own Try/Catch whose
catch path logs or binds the caught error, so one run covers all permutations (the gateway
null leg of the settings spec is the one exception, see below).

## Pre-requisites

- Backend and frontend on the per-worker ports (Playwright fixtures).
- E2E stack services, brought up by the targeted / CI scripts:

| Spec | Fixture / recipe | Services |
|------|------------------|----------|
| `v-null-settings-functional.spec.ts` | `fixture-settings.json`, `fixture-settings-gateway-null.json` | `sshd`, `http-target` (behind `sshd`), `http-echo`, `kwok` (direct), `k8s-gateway` (reachable from the SSH host only); per-run namespace from `seedRun(..., 'minimal')` |
| `v-null-function-inputs-functional.spec.ts` | `fixture-function-inputs.json` | none |
| `v-null-text-scripts-functional.spec.ts` | `fixture-text-scripts.json` | `http-echo`, `sshd` (Remote Execution, `python3` on the host) |
| `v-null-sql-functional.spec.ts` | `fixture-sql.json` | `postgres`, `mariadb` |
| `v-null-opensearch-functional.spec.ts` | `fixture-opensearch.json` | `opensearch` (direct node) |
| `v-null-editors-functional.spec.ts` | `fixture-editors.json` | none |
| `v-null-print-form-functional.spec.ts` | `fixture-print-form.json` | none |
| `v-null-mcp-functional.spec.ts` | `recipe-mcp-owed-secret-variables.yaml`, `recipe-mcp-run-overrides.yaml` | the backend's MCP endpoint (the spec enables it on a per-stack port), `poetry` for `functional/recipe-authoring/mcp_tool_client.py`, the E2E environment |
| `v-field-http-null-header-functional.spec.ts` | `fixture-http-null-header.json` | `http-echo` |
| `v-field-entry-nulls-functional.spec.ts` | `fixture-entry-nulls.json` | `http-echo`, `postgres`, `kwok` (direct); per-run namespace from `seedRun(..., 'minimal')` |

`null-entry-helpers.ts` holds the refused-save check the specs share: PUT the stored workflow with
one Block changed, expect 422 and an unchanged stored Test.

## Execution Steps

### v-null-settings-functional.spec.ts

1. Test 1 imports `fixture-settings.json` (the per-run namespace, the kwok CA and the token
   filled in) and runs it once: Logs of a null and two boolean variables, and of message
   expressions giving a whole integer, a list holding null and a map; SSH Tunnel Open with
   Local Port `None` and blank; HTTP with a header entry holding null and with an empty header
   plus a header expression giving `''` against `http-echo`; K8s Get with namespace `None` and
   blank on kwok; K8s Get with a blank namespace through `k8s-gateway` in a Remote Execution body.
   After the run it PUTs the Test with the `X-Blank` expression entry blank.
2. Test 2 imports `fixture-settings-gateway-null.json`: K8s Get with namespace `None` through
   `k8s-gateway` inside a Remote Execution body. A body cannot sit in a Try/Catch, so this run
   must fail.

### v-null-function-inputs-functional.spec.ts

1. Five Function Blocks running Local Functions that declare a required input `req_in`, a
   defaulted `def_in` and an optional `opt_in`, each input a field of the Function Block given
   as an expression: `req_in` given `None`, `def_in` given `None`, `opt_in` given `None`,
   `req_in` given `1 / 0`, and `def_in` left blank. The three refused Function Blocks sit in
   Try/Catch blocks.

### v-null-text-scripts-functional.spec.ts

1. Imports the fixture with a per-run token (echo key, marker folders on WAVE and on `sshd`)
   and checks the stored Test holds the literal nulls seeded through the API; PUTs the Test with
   the Shell Script and Python expression entries blank.
2. One run: an HTTP URL with a null `{{ }}` piece, then two retry probes on the same echo key; a
   Log with null, boolean and list pieces; a Variable Setter row writing `None`; Shell Script and
   Python entries and rows given `None`, given `''` and stored as a literal null, on WAVE and
   inside Remote Execution bodies on `sshd` (each refused case in its own Try/Catch); a list
   holding null passed to a script; Python exports that fit, a `None` export and an `"abc"`
   export bound to integers, on WAVE and on `sshd`; two probes that report and remove the
   marker files.

### v-null-sql-functional.spec.ts

1. On PostgreSQL and MariaDB, inside a Try/Catch with Finally: a script creates a per-run table
   and procedure, inserts one row with `:empty_note` = `''` and one with `:null_note` = `None`,
   and reads both back; Call procedure with argument `v` given `None` and `''`; a Log per
   database. The Finally path drops the table and procedure and checks they are gone.

### v-null-opensearch-functional.spec.ts

1. `beforeAll` creates the per-test index `wave-e2e-<token>-nulls` and seeds two documents.
2. One run: a Query DSL script query with `{{ nothing }}` (null) and `{{ empty }}` (empty text)
   standing alone as `params.v`; then, each in its own Try/Catch, `{{ nothing }}` inside a JSON
   string, bare in DQL and inside a DQL quoted phrase.
3. `afterAll` deletes the index.

### v-null-editors-functional.spec.ts

1. Table: opens the `grid` table holding null cells in its Edit window's "Edit value" sheet,
   clicks each null cell, saves the sheet and the window.
2. List and map: edits the `tags` list and the `limits` map around their null items and saves; reloads,
   clicks each null chip and saves again.
3. Fix All on Save: deletes `pause_ms` (read by a Delay's duration), saves, and uses Fix All in
   `Cannot Save Test`; then saves and reloads.
4. Fix All on open: stores the Test without `pause_ms`, opens it and uses Fix All in
   `Test Issues Found`.

### v-null-print-form-functional.spec.ts

1. One run: five failing Asserts in single mode (a string, an integer, a list, a list holding
   null, a 1200-character string), an Assert on a null variable inside a Try/Catch, and a Log
   whose f-string prints a table holding boolean and null cells.

### v-null-mcp-functional.spec.ts

1. Creates a Test from `recipe-mcp-owed-secret-variables.yaml` over MCP, runs it with
   `start_execution` and reads `get_failure_report`.
2. Creates a Test from `recipe-mcp-run-overrides.yaml` and calls `start_execution` with
   `{"nope": 1}`.
3. Creates it again and calls `start_execution` with null, a type-only form, a bare map, a map
   shaped like a typed form of another type and a typed map form.

### v-field-http-null-header-functional.spec.ts

1. One run of two HTTP Request Blocks against `http-echo`: the `X-Trace` header entry is an
   expression giving `None` in the first and a stored literal null in the second.

### v-field-entry-nulls-functional.spec.ts

1. Imports the fixture (per-run namespace, kwok CA and token filled in). In the HTTP Request
   window, opens the Headers editor, switches the empty `X-Id` entry to an expression, saves the
   editor, reads the row error and Save, and cancels the window; then PUTs the Test with that
   entry blank.
2. One run: the HTTP Request, a PostgreSQL query whose `parameters` hold a literal null, a
   `None` expression and empty text, K8s Connect, and a K8s Apply ConfigMap form whose `data`
   entry `k` is null inside a Try/Catch.

## Validation Criteria

### v-null-settings-functional.spec.ts

- The Log of a null variable prints `null`; the Logs of boolean variables print `true` and
  `false` and their catch paths never run.
- The Log message takes a value of any type: message expressions giving a whole integer, a
  list holding null and a map print `42`, `[1,null]` and `{"host":"web-1","port":null}`.
- Local Port `None` fails with `'local_port' is null` and namespace `None` with
  `'namespace' is null`: each Try/Catch binds that exact message for that block, the catch path
  runs, the block is failed and nothing is bound.
- A header entry holding null is sent empty: `http-echo` received `x-null: ''` beside
  `x-set: set-value`, nothing is caught and the catch Log never runs.
- A blank Local Port auto-assigns a port and a GET through it returns 200 `healthy`.
- `http-echo` received `x-empty: ''` and `x-blank: ''` beside `x-set: set-value`.
- The PUT with the `X-Blank` expression entry blank answers 422 with exactly one finding,
  `REQUIRED_PARAM_EMPTY` `'X-Blank' in 'headers' is required` on `Echo Empty Headers`, and the
  stored Test is unchanged.
- A blank namespace reads the seeded pod from the run's namespace, directly and through
  `k8s-gateway` (the read line names that namespace twice); every other block succeeded and the
  run passes.
- Test 2: exactly one ERROR line `Block 'Gateway Get Null Namespace' failed: 'namespace' is
  null`, no read line, nothing bound, the Get after it and the bookend never ran, the Get and
  its body are failed, and the run failed.

### v-null-function-inputs-functional.spec.ts

- `req_in` given `None` fails with `'req_in' is null`, `def_in` given `None` with
  `'def_in' is null`, `1 / 0` with `Expression evaluation failed for '1 / 0': division by zero`;
  in each case the Function Block is failed, the catch path ran and no Block of the Function flow
  has a run state or printed its line.
- `opt_in` given `None` prints `null` inside the Function flow; a blank `def_in` prints
  `def-value` and `opt_in` left out prints `null`; the run passes.

### v-null-text-scripts-functional.spec.ts

- The null URL piece fails with `'{{ nothing }}' in 'url' is null`, and the next probe on the
  same echo key answers attempt 1, so no request was sent.
- The Log prints `null-piece nothing=null flag=true items=[1,null,2]`; the Variable Setter row
  sets `vs_target` to null.
- Shell Script `TOKEN` given None fails with `'TOKEN' in 'input_vars' is null`, Python `TEAM`
  with `'TEAM' in 'environment' is null`, a row given None with `Row 2 in 'arguments' is null`,
  on WAVE and in the bodies (Python on `sshd` prefixed with `Remote Execution failed on host
  '<host>': `); no marker file of those scripts exists on WAVE or on `sshd`; each of the six
  remote Python blocks writes one start line.
- Entries stored as a literal null fail like None: Shell Script with
  `'TOKEN' in 'input_vars' is null`, Python with `'TEAM' in 'environment' is null`, on WAVE and in
  the bodies, and their marker files are missing.
- The PUTs with the expression entries blank answer 422 naming `Row 2 in 'arguments' is required`
  and `'TOKEN' in 'input_vars' is required` (Shell Script) or `'TEAM' in 'environment' is
  required` (Python); the stored Test is unchanged.
- A list `[1, None, 2]` reaches the script as `[1,null,2]`.
- Entries given `''` arrive as empty text: Shell Script prints `n=2 1=[a] 2=[] token=set[]`,
  Python prints `['a', '']` and `''`, on WAVE and in the bodies.
- A Python input variable given None is `None` in the script; a `None` export binds null and a
  fitting export binds `42`, on WAVE and on `sshd`.
- An `"abc"` export into an integer records `Script variable 'n_bad' is not a valid integer`,
  reason `OutputVariable`, and binds nothing, on WAVE and on `sshd`; the run passes.

### v-null-sql-functional.spec.ts

- On both databases both inserts land and the read-back is `[1, '', IS NULL false]` and
  `[2, null, IS NULL true]` (`false/true` on PostgreSQL, `0/1` on MariaDB).
- The script's `Inputs:` line carries `"parameters":{"empty_note":"","null_note":null}`.
- The procedure argument given None binds NULL (`is-null`) and given `''` binds empty text
  (`is-empty`).
- The Logs print `empty=[] null=[null]`; the Finally path finds the table and procedure gone,
  nothing was caught, no line carries the password, and the run passes.

### v-null-opensearch-functional.spec.ts

- The standalone null is rendered and sent as `"v": null` (Rendered line and the logged
  `POST /<index>/_search` body) and matches both documents; the standalone empty text is sent as
  `"v": ""` and matches none.
- Each of the three other cases fails with `'{{ nothing }}' in 'query' is null`: the Try/Catch
  binds that exact text, the catch Log prints it, the block wrote no request, Search, Rendered or
  `Inputs:` line, and Total results keeps `-1`; the run passes.

### v-null-editors-functional.spec.ts

- Table: each null cell is a button reading `null` in the null look (italic, monospace, Text Muted),
  named `Row <n> <column> (null)`, tooltip `Click to enter a value`; a click gives `''`, `0` or
  `false` by column type, and the saved Test holds those values beside the untouched cells, with
  each column's name and type stored in the `{columns, rows}` form; the `grid` row reads
  `2×3 table` before and after.
- List and map: `Item 1 (null)`, `mem (null)` and `debug (null)` read `null` in the null look; editing
  another item keeps each null in the saved Test; after a reload a click enters `''`, `0` and
  `false`, and Save writes them.
- Fix All on Save: the 422 carries `UNDECLARED_VARIABLE` with `Add variable to manager (type:
  integer)`; after Fix All the `pause_ms` row reads `null` in the null look, not dimmed, with the
  integer type; the saved Test declares it with no value and validates clean.
- Fix All on open: `Test Issues Found` lists the integer fix; after Fix All `pause_ms` is an integer
  holding null, stored with no value, and the Test validates clean.

### v-null-print-form-functional.spec.ts

- The Assert details end with `actual: 'done'`, `actual: 3`, `actual: [1,2]` and
  `actual: [1,null]`; the 1200-character actual is cut to its first 500 characters, ` ... `,
  its last 500.
- The Assert on the null variable is an ordinary false check: it ends amber and its detail ends
  `actual: null`; nothing is caught and the catch path never runs.
- The table prints `true`, `false` and `null` in its aligned cells and the stored table keeps
  them; the failing Asserts are amber and the run passes.

### v-null-mcp-functional.spec.ts

- Authoring announces exactly one `NO_VALUE_VARIABLE` item, for the uncaptured secret; the run
  fails only on it, the two captured secrets are written (masked) and the owed one holds null;
  `get_failure_report` lists exactly that one pending item.
- `{"nope": 1}` is refused with `Error executing tool start_execution: Variable 'nope' is not
  declared by this test` and leaves no execution of the Test running.
- The override run passes and its Log prints `overrides target=null typed_null=null
  config={"region":"eu","tier":2} shaped={"type":"integer","value":5} typed_config={"k":"v"}`;
  the run's variables hold the same values and the stored Test's variables do not change.

### v-field-http-null-header-functional.spec.ts

- The stored Test keeps the literal null entry as null; the run passes, both Blocks answer 200,
  `http-echo` received `x-trace: ''` from each beside the control header `x-leg`, and no console
  line refuses the header.

### v-field-entry-nulls-functional.spec.ts

- The window shows exactly `'X-Id' in 'headers' is required` under Headers and Save stays off;
  the PUT answers 422 with that one `REQUIRED_PARAM_EMPTY` finding on the HTTP Request Block and
  the stored Test is unchanged.
- PostgreSQL reads back `[true, true, false, '']`: the literal null and the `None` parameter bind
  NULL, empty text binds empty text.
- K8s Apply fails with exactly `'k' in 'data' is null`: the Try/Catch binds it for the Apply
  Block, the catch Log runs, the Block is failed, no ConfigMap was created, and the run passes.
