# WAVE Recipe Format

A recipe is one YAML document that describes a WAVE test structurally. You
author intent only: blocks, settings, control flow, variables, and functions.
WAVE compiles the recipe into a real canvas test - node wiring, handles, and
layout are always generated, never authored. Never include geometry, node ids,
positions, or edges in a recipe.

Workflow:

1. Call `get_recipe_guide` (this document plus worked examples).
2. Discover blocks with `list_blocks` / `get_block`, published Functions with
   `list_functions`, profiles with `list_profiles`.
3. Dry-run with `validate_recipe` until it returns `valid: true`.
4. Create the test in one of two modes (the created test is a first-class WAVE
   test either way: it opens and edits in the workbench like a hand-built one):
   - `create_test_from_recipe` - fast one-shot. Compiles and saves immediately;
     returns the saved test with no live workbench view.
   - `build_test_from_recipe` - live watch build. Holds the workbench session and
     reveals the test block by block so a person watching `/workbench` sees it
     assemble, then saves at completion. Offer this when the person wants to
     watch the build happen. If someone takes over the session mid-build, the
     build is abandoned and the partial draft is left for them to continue.

Both modes reject duplicate test names up front and offer amend-existing instead.
Validation findings come back as data, never as protocol errors. Every finding
is `{step, code, severity, problem, fix}` where `step` is a recipe path such as
`flow[1].if.then[0]` or `variables.token`, and `fix` is a proposed remedy or
null when the problem is a stated blocker. Invalid recipes are never persisted:
`create_test_from_recipe` creates either a fully valid test or nothing.

## Document shape

```yaml
test:
  name: Checkout smoke          # required, globally unique
  description: What it proves   # optional
  tags: [smoke, checkout]       # optional
  version: 1.2.0                # set by a readback; see 'Amending an existing test'
variables: {}                   # optional; name -> declaration
functions: []                   # optional; inline local functions
flow: []                        # required; ordered list of steps
```

## Variables

```yaml
variables:
  base_url: {type: string, value: "http://blackbox.local"}
  attempts: {type: integer, value: 3}
  password: {type: string, secret: true, value: "hunter2"}   # secret flag, not a type
  derived:  {type: string, expr: "base_url + '/api'"}        # expression-valued
  label:    {type: string, template: "run-{{ attempts }}"}   # template-valued
  session:  {type: string}                                   # holds null until a block writes it
```

- Types: `string`, `integer`, `float`, `boolean`, `array`, `map`, `table`.
  A `table` value is a list of row mappings sharing the same keys, which are its
  columns: `hosts: {type: table, value: [{host: a, port: 1}, {host: b, port: 2}]}`.
  A readback may show a table in its stored form instead, `{columns: [{name, type}],
  rows: [[...]]}`, whose columns carry their types; an amend may send it back as written.
  Read a cell as `row['host']`, iterate rows directly, and use `len(hosts)` for
  the row count. An `array` is a plain list and a `map` a plain mapping.
- Each element of an `array` or `map` keeps its YAML type: `16` is an integer,
  `"02134"` stays text, `1.5` is a float and `[1, 2]` a list. `element_types`
  declares an element's type instead: key -> type for a map (a key it omits keeps
  its YAML type), one type per item for an array. The element types are
  `string`, `integer`, `float`, `boolean`, `array` and `map`. A declared
  `integer` or `float` may be written as its exact text, which keeps every digit:
  `limits: {type: map, value: {max: "1234567890123456789", ratio: "0.10"}, element_types: {max: integer, ratio: float}}`.
  A readback writes `element_types` in full.
- A number is written in plain decimal digits: `30`, `-7`, `2.50`. An integer
  has at most 19 digits and a float at most 28 significant digits, and every
  digit written is kept, so `017` is 17. Any other spelling YAML knows as a
  number (`0x1F`, `0b101`, `1:30`, `+5`, `1_000`, `1e5`, `.5`, `.inf`, `.nan`)
  is text, so it is refused wherever a number is declared.
- A literal must match its declared type; an `integer` holding `"abc"` is a
  validation error rather than a surprise at run time. `null` fits every type,
  and a `null` item or map value fits any element type.
- YAML `value:` with nothing after it, `value: null` and `value: ~` all mean null.
- `expr:` gives the expression the variable's value comes from. `template:`
  gives a `string` variable a text whose `{{ }}` pieces are filled when it is
  read; on any other type it is refused (`TEMPLATE_NOT_STRING`), so use `expr:`
  for a computed value of that type. A readback writes each variable back in the
  form that wrote it, except that a secret one comes back without its value or
  source.
- `secret: true` marks a value as sensitive; it is sealed at rest and masked in
  every read surface.
- Names must match `[a-zA-Z_][a-zA-Z0-9_]*`, be 64 characters or fewer, and not
  be a Python keyword. A Test variable or a Function local is never named
  `system`, `suite` or `regression`: those are read as namespaces
  (`RESERVED_VARIABLE_NAME`). A Function input or output name starts with a
  letter.
- A `type` alone is a complete declaration: the variable holds null until a
  person fills it in or a Block writes it at run time. A block setting given
  null fails the run and names the setting, so give a start value to a variable
  a setting or an expression condition reads before anything writes it. A
  comparison (`{variable, operator}`) needs no start value: it reads null as
  holding nothing (see Conditions).
- Variables referenced by a `set:` step must be declared here. Capture targets
  (see below) are auto-declared when not listed, holding null.

### Secret write modes

A `secret: true` variable declares its value one of three ways:

```yaml
variables:
  provided:  {type: string, secret: true, value: "hunter2"}   # 1. provided inline
  from_file: {type: string, secret: true, value_from_file: "prod-token"}  # 2. server-side file
  deferred:  {type: string, secret: true}                     # 3. declare-empty
```

- **Provided value** - sealed at rest, never echoed back. The value does travel in
  the recipe, so use it only for a value whose exposure you do not mind.
- **`value_from_file`** - the file is read on the WAVE **server**, from its
  configured secrets input directory, and sealed at author time. This mode is for
  deployments where secrets are already provisioned onto the host by other means
  (a mounted secret, a vault agent, config management): the file must exist there
  before you reference it, and nothing you have locally can be used. A missing
  file or a path escaping the directory is reported as a `SECRET_FILE_NOT_FOUND`
  / `SECRET_FILE_OUTSIDE_ROOT` finding, and where the directory is not configured
  at all the mode is unavailable and says so (`SECRETS_DIR_NOT_CONFIGURED`).
- **Declare-empty** - holds null; unless a block's capture fills it, the authoring summary lists it as a manual
  action item (`NO_VALUE_VARIABLE`, "Secret variable '<name>' holds no value") for a
  person to fill in before the test runs. They fill it in the web UI, where the field
  is sealed and write-only. A secret that an import or a backup restore could not
  open, or that was imported from a masked export (`********`), holds null the same
  way and stays secret, wherever it sits: a test's variables or block settings, a
  suite's or regression's variables, a System variable the run reads, a profile it
  binds, a library Function a Function Block runs. `get_failure_report` lists each one under
  `pending_action_items` with its owner and `step`: a variable with the same text,
  a block setting or profile field as `NO_VALUE_SECRET` ("Secret field '<field>'
  holds no value").

**Choosing one.** If the value is already a file on the WAVE server, reference it.
Otherwise, if it must never appear in the conversation - a private key, a
production credential - declare it empty and let a person enter it in the UI.
Provide a value inline only when it is a throwaway a transcript may safely carry.

Masking replaces a secret's exact value wherever it appears, but a value *built*
from a secret (a slice, a concatenation) is a different string and is not masked.
So an expression or a `{{ }}` piece that reads a secret returns a
`SECRET_DERIVED_VALUE` warning, except where the whole value it builds is masked
anyway: a block setting the block declares secret (a password, a token, a key),
a Function input declared secret, and a variable declared `secret: true`.
Elsewhere, mark the derived variable `secret: true` if it must stay protected.

## Files

A block setting that names a file takes one of three forms:

- `testdata://<path>` - a file in the test's own Test Data, the files placed for
  this test (in the workbench, or with `write_testdata`). Blocks only read them:
  a block that writes, moves, or deletes anything in Test Data fails at run time
  (`testdata:// paths are read-only`).
- `artifact://<path>` - a file in the run's artifacts, where blocks write their
  outputs; missing folders are created. A block can read an artifact only after
  an earlier block in the same run wrote it.
- a plain path, absolute or relative - resolved where the block runs: on the
  WAVE server (a relative path starts at the home folder of the user the WAVE
  server runs as, and on Shell Script and Shell Exec a relative path other than
  Working Directory starts at the Working Directory), or on the remote host for a
  remotable block (`get_block` shows `remotable: true`) inside
  a Remote Execution body (a relative path starts at the SSH user's home folder).
  `..` is followed in every form.

For the Python block's Script File, the Netcat block's payload File, and the
SQL block's SQL File and Load table Table, a `testdata://` or `artifact://` file
is read on WAVE and sent along, so it works inside a Remote Execution body;
every other remotable block, and the SQL block's SQLite File, still fails at run
time with `testdata:// paths are not available on the remote host` (or
`artifact://`). A block that is not remotable (Shell Script, Shell Exec, Excel,
SFTP) runs on WAVE even inside a body, so both schemes work for it.

Validation warns `TESTDATA_NOT_FOUND` for a `testdata://` literal that names no
file in the target test's Test Data. Without a target test - `validate_recipe`
without a `test_ref`, `create_test_from_recipe` - there is no folder to look in,
so every literal warns; place the files with `write_testdata` and validate again
with the `test_ref`. A templated reference (`{{ ... }}`) is resolved at run time
and is not checked. See `08-files-testdata` for the whole story.

## Steps

`flow` is an ordered list. Consecutive steps run in order. Each step is a
mapping with exactly one step keyword.

### Blocks (plugins and controls)

Any catalog block runs with the uniform `- block: <id>` form. Get ids and
setting schemas from `list_blocks` / `get_block`.

```yaml
- block: http-client
  label: Fetch home             # optional; defaults to the block's display name
  settings:
    url: "{{ base_url }}/home"          # '{{ }}' in a string -> template
    method: GET                          # plain YAML literal
    timeout: {expr: "attempts * 10"}     # {expr: ...} -> expression
  capture:                      # block outputs -> variables
    status_code: home_status
  profiles:                     # optional credential profile bindings
    - profile: staging-creds    # by profile name (see list_profiles)
      alias: cred               # optional alias for referencing fields
      fields: [username, password]
```

Setting value forms:

- Plain YAML literal: used as-is and type-checked against the block schema.
- Template string: any string containing `{{ expression }}` markers.
- Expression: `{expr: "..."}` - a Python-style expression over variables.

Inside a map setting each entry may itself be `{expr: ...}` (a Shell Script
input variable, an HTTP header). A map setting holds text, except one whose
parameter `get_block` marks `typed_values: true` (the SQL block's
`driver_options`): each literal entry there keeps its YAML type like a map
variable's element, and an `element_types` key beside `settings`, keyed by
setting name, declares an entry's type
(`element_types: {driver_options: {cached_statements: integer}}`). A `set:` step
takes the same `element_types` key, keyed by variable name, for a map or list it
writes literally. Inside a list-of-rows setting each row field
may be `{expr: ...}` (a Shell Script argument row `{value: {expr: ...}}`, an
HTTP part). Templates apply to a whole string setting; inside an entry or row
use `{expr: ...}`.

A free-entry setting left out takes its default when the Block runs; a readback
lists only the settings the Block holds. A choice-list or true / false setting
left out is written with its default when the Block is made, and a readback
lists it.

`capture` maps a block **output name** (from the block's `output_schema`) to a
**variable name**. Undeclared capture targets are auto-declared with the
output's type, holding null until the block writes them.

Some blocks declare extra outputs through a setting (`get_block` marks the
parameter `declares_outputs: true`): Shell Script's and Python's
`script_variables` list the script variables to read back. List the name there,
then capture it like any output. The value is read as the target variable's
type, so declare the target with its type; an undeclared target is auto-declared
`string`. Shell Script reads back text; a Python export keeps the script
variable's own value, so a table stays a table and a decimal keeps its exact
digits, and a Python `None` export becomes null. See `09-shell-blocks` and
`10-python`.

A block step marks outputs Secret with `secret_outputs: [session]` beside its
`capture`, as the Secret column of the block's outputs table does: the variable a
marked output is captured into is masked like any secret, and a capture target
the step auto-declares is declared `secret: true`. Without `secret_outputs`, the
outputs the block's `output_schema` marks `secret: true` are marked (K8s
Connect's `session`); a list given is the whole choice, so `secret_outputs: []`
marks none. A declared script variable may be listed too. An output the block
does not have is refused (`UNKNOWN_SECRET_OUTPUT`). A readback writes
`secret_outputs` only when it differs from the schema's choice.

A marked output captured into a variable the recipe declares plain makes that
variable secret: the Test stores it `secret: true`, and the compile returns the
warning `VARIABLE_MADE_SECRET` naming the variable and the output. Its value is
masked from then on. Making it plain again clears its value. Declare the variable
`secret: true`, or leave the output out of `secret_outputs` to keep it plain.
This holds for a Function Block's marked outputs too.

The SQL block (`sql-client`) works with PostgreSQL, MySQL, Oracle, SQL Server or
SQLite (`database_type`: `postgresql`, `mysql`, `oracle`, `mssql`, `sqlite`) and
does one of three things, chosen by `operation`:

- `run_sql` runs the statements of `sql` in order (or, with `script_type: file`,
  those of the file `sql_file`). A `:name` in the SQL is a parameter: give each
  one a value in the `parameters` map (an entry may be `{expr: ...}`); the
  database receives it as a bound value, never as text spliced into the
  statement. `sql` may also be `{expr: ...}`: the expression gives the script
  text, and `:name` parameters still bind from `parameters`.
  `stop_on_error` (on by default) ends the script at the first
  failing statement. Outputs: `rows` (the last result set, a table capped at
  `max_rows` rows), `row_count` and `rows_changed`.
- `call_procedure` calls `procedure` with the `arguments` map, in call order,
  and reads the arguments listed in `out_arguments` (one row per name:
  `[{value: total}, {value: label}]`) back into `out_values` (a table); a
  result set the procedure returns comes back in `rows`. Not available on
  SQLite.
- `load_table` writes the table variable that `table` names (`{expr: "orders"}`),
  or rows given inline as a list of maps, into the existing `target_table`,
  `batch_size` rows at a time.
  `mode` is `add`, `add_or_replace` (rows matched on `key_columns`, a
  comma-separated list; blank means the primary key) or `overwrite` (the table
  is emptied first). `commit_each_batch` commits batch by batch instead of once
  at the end, and then `stop_on_error` applies as on `run_sql`. Output:
  `rows_changed`.

A network type connects with `host`, `port` (blank takes the type's default),
`database` (the service name on Oracle), `username` and `password`; SQLite
opens `file`. `tls` turns TLS on (off by default, on by default for SQL Server)
and reads `verify_ssl`, `ca_cert`, `client_cert` and `client_key`;
`driver_options` hands extra settings to the driver. `timeout` bounds the whole
block and `connect_timeout` the connection. A `database` profile holds `host`,
`port`, `database`, `username`, `password`, `verify_ssl`, `ca_cert`,
`client_cert`, `client_key` and `driver_options`: bind it and set each row from
its fields (`host: {expr: "db.host"}`). `password` and `client_key` are secret
settings, so a readback leaves them out like every secret: re-provide them when
you amend. See `11-sql`.

The OpenSearch block (`opensearch`) reads a cluster and never writes. `mode` is
`search` (the default) or `aggregate`. It connects with `url` (required) and at
most one sign-in: `username` and `password`, `api_key`, or `bearer_token`;
`verify_ssl`, `ca_cert`, `client_cert` and `client_key` set the TLS trust.
`password`, `api_key`, `bearer_token` and `client_key` are secret settings, so a
readback leaves them out like every secret. `index` (required) is the index
pattern. `from` and `to` take a timestamp, epoch milliseconds or `now` date
math (`now-15m`, `now/d`), by default `now-15m` and `now`, and bound
`time_field` (default `@timestamp`). `query_language` is `dql` (the default) or
`query_dsl`; `query` holds a DQL line or the query part of a Query DSL body as
JSON text. A `query` string holding `{{ }}` is a template whose values are
escaped for where they land; `{expr: ...}` gives the whole query (DQL text, or
a map or JSON text for Query DSL).

In `search` mode `fields` lists the columns as rows
(`[{value: "@timestamp"}, {value: log.level}]`; a row may be
`{value: {expr: ...}}`), `max_results` caps the rows (default 10000, 0 keeps
every match), `sort_by` names the sort field (blank is the Time field) and
`order` is `desc` (newest first, the default) or `asc`. The outputs are
`results` (a table, one row per matching document) and `total_results` (the
exact match count). In `aggregate` mode `group_by_time` is `none`, `10s`, `30s`,
`1m` (the default), `5m`, `15m` or `1h`; `group_by_field` gives each value of a
field its own rows, keeping its `top_values` most common (default 10); `stats`
lists the numbers to work out, one column each, as rows
`[{value: {stat: count}}, {value: {stat: percentile, field: latency_ms, percent: 95}}]`,
with `stat` one of `count`, `sum`, `average`, `min`, `max`, `percentile`,
`unique_count`, `increase` or `custom` (`custom` takes `json`, one aggregation,
and an optional `name` for its column). The outputs are the same two.
`timeout` bounds the whole block (default 300), `connect_timeout` the
connection (default 30), and `on_error` works as on every block. An
`opensearch` profile holds `url`, `username`, `password`, `api_key`,
`bearer_token`, `verify_ssl`, `ca_cert`, `client_cert` and `client_key`: bind it
and set each row from its fields (`url: {expr: "os.url"}`). See `12-opensearch`.

#### CSV and Excel filters and sorts

The CSV block (`csv-parser`, operations `parse` and `serialize`) and the Excel
block (`excel-parser`, operations `read` and `write`) take `sorts` and `filters`
as lists in the one shape the config sheet stores, which `get_block` also
describes. A sort is `{id, column, direction}` with `direction` `asc` or `desc`;
the first sort in the list wins, later ones break its ties. A filter is
`{id, column, asType, conditions}`: `asType` (`string`, `integer`, `float` or
`boolean`) is the type each cell of the column is read as, and `conditions` are
condition items of the check blocks that test the cell as the variable `_cell`,
with `value_type` equal to `asType` and `{type: operator, value: and}` (or `or`)
between two items. A literal item takes the operators the Conditions table lists
for its type and reads a null cell as holding nothing. A row is kept when every
filter keeps it. A `column` is `{mode: name, value: <header>}` or
`{mode: index, value: "<position counted from 0>"}`. Each `id` is any text unique
within its list.

```yaml
- block: csv-parser
  settings:
    operation: parse
    csv_content: "id,amount\na,3\nb,8\nc,12\n"
    sorts:
      - {id: by-amount, column: {mode: name, value: amount}, direction: desc}
    filters:
      - id: over-five
        column: {mode: name, value: amount}
        asType: integer
        conditions:
          - {id: amount-gt-5, type: literal, variable: _cell, value_type: integer,
             operator: greater_than, reference_value: 5, reference_is_expression: false}
  capture: {table: big_amounts}
```

### Conditions

Two interchangeable forms wherever a condition is expected:

```yaml
when: "home_status == 200"                                            # expression string
when: {variable: transport, operator: equals, value: TCP, value_type: string}  # comparison
```

Comparison operators by `value_type` (the runtime rejects any other combination):

| value_type | Operators |
|------------|-----------|
| integer, float | equals, not_equals, less_than, greater_than, less_or_equal, greater_or_equal, is_null, is_not_null |
| string | equals, not_equals, contains, does_not_contain, starts_with, ends_with, matches_regex, is_null, is_not_null |
| boolean | is_true, is_false, is_null, is_not_null |
| array | contains, does_not_contain, is_empty, is_not_empty, length_equals, is_null, is_not_null |
| map | has_key, does_not_have_key, is_empty, is_not_empty, is_null, is_not_null |
| table | is_null, is_not_null, is_empty (no rows), is_not_empty |

`is_true`, `is_false`, `is_empty`, `is_not_empty`, `is_null` and `is_not_null`
take no `value`. Every other operator compares with its `value`, and a `value`
that is null or left out fails the block and names the variable.
`length_equals` reads its `value` as a whole number.

A comparison reads a null value as holding nothing, the same way in every block
that checks (`assert`, `if`, `switch`, `while`, `wait_until`) and in the CSV and
Excel filters: `is_null`, `not_equals` (also against `''`), `does_not_contain`,
`does_not_have_key`, `is_empty` and `length_equals 0` are true, and every other
operator is false (`equals ''`, the orderings and `matches_regex '^$'` included).
On a value that is not null, `is_null` is false and `is_not_null` true, whatever
its type. A `switch` sends a null to `default` unless a case catches it first.
An expression string is plain Python and outside this rule, so give the names it
reads a start value.

A comparison with no `value_type` takes the variable's declared type when it has
no `value` (inside a function, its own inputs, outputs and variables), and the
type of its `value` otherwise. A name declared nowhere gets no type, and then only
`is_null` and `is_not_null` work.

### Constructs

```yaml
- if:
    when: "home_status == 200"
    then: [ ... steps ... ]
    elif:
      - when: "home_status == 503"
        then: [ ... ]
    else: [ ... ]

- switch:
    cases:                       # evaluated top-down; each case guards itself
      - when: "health_status == 200"
        steps: [ ... ]
      - when: {variable: transport, operator: equals, value: TCP, value_type: string}
        break: false             # fall through: the NEXT case's own condition is tested
        steps: [ ... ]
    default: [ ... ]             # runs when no case matched, and when a case
                                 # above falls through into it (it has no
                                 # condition to refuse with); omit -> nothing
                                 # runs when no case matches
    # break defaults to true (stop after this case). The flow always resumes at
    # the next sibling step, whether a case ran, several ran, or none did.

- for: {count: 3, body: [ ... ]}       # a null count runs zero times
- for: {range: {start: 0, end: 10, step: 2}, body: [ ... ]}   # a null start, end or step fails

- for_each:
    collection: {expr: "items"}          # a null collection runs zero times
    capture: {item: current, index: i}   # item is a typed envelope {type, value}
    body: [ ... ]
    # Read the item's raw value as current['value'] - in expressions
    # ("current['value'] != 'gamma'"), templates ("{{ current['value'] }}"),
    # and assertions alike. The index is a plain zero-based integer.

- while:
    label: retry_loop            # optional; break/continue can target it
    conditions: "i < 10"
    body: [ ... ]

- try:
    steps: [ ... ]
    catch: [ ... ]               # omit -> no catch path
    finally: [ ... ]             # omit -> no finally path
    capture: {error: err, caught: was_caught}

- parallel:
    branches:                    # at least two; each is a lane that runs concurrently
      - {name: ingest, steps: [ ... ], time_limit: 30000}   # name and time_limit optional
      - {name: probe, steps: [ ... ]}
    join: all                    # optional; 'all' (default) or 'first' to finish
    time_limit: 60000            # optional; milliseconds bounding the whole section

- assert:
    that:
      - "health_status == 200"
      - {variable: body, operator: contains, value: ok, value_type: string}
    fail_current_scope: true     # REQUIRED to gate a run; see 'Rules worth knowing'
    on_pass: [ ... ]             # presence of on_pass/on_fail -> split mode
    on_fail: [ ... ]

- remote:                        # remotable body blocks run on the host; the others run on WAVE
    settings: {session_id: {expr: "ssh_session"}}
    body: [ ... ]
    capture: {remote_session_id: rsid}

- wait_until:
    that:                        # same vocabulary as assert; at least one
      - "pod_phase == 'Running'"
      - {variable: replicas, operator: greater_or_equal, value: 3, value_type: integer}
    timeout: 30000               # REQUIRED; milliseconds bounding the whole wait
    interval: 1000               # optional; milliseconds between checks, default 1000
    message: "pod never reached Running"   # optional; logged when the wait gives up
    fail_current_scope: true     # optional; default false, see 'Rules worth knowing'
    retry:                       # optional; its presence selects Retry mode
      - block: http-client
        settings: {url: "http://api.local/pods/web-1", method: GET}
        capture: {body: pod_phase}
    capture: {passed: pod_ready, elapsed: waited_ms}
```

Loops and waits on null: a `for` whose `count` is null and a `for_each` whose
`collection` is null run zero times and the flow goes on, as with a count of 0 or
an empty list; the item variable keeps the value it held and the index reads 0.
A null element of a collection arrives as an item whose `current['value']` is
null. In range mode a null `start`, `end` or `step` fails the block and names it.
`while` and `wait_until` comparisons follow the holding-nothing rule of
Conditions, so a `wait_until` whose comparison is false on null keeps waiting
until its timeout, and one that tests `is_null` passes on its first check.

### Leaf shorthand steps

```yaml
- set: {counter: 0, greeting: {expr: "'hi ' + user"}}   # set declared variables
- delay: 500                                            # milliseconds; or {duration: 500}
- halt: {scope: test, status: failed, message: gave up}
- break: {}                                             # innermost loop; or {loop: <label>}
- continue: {}
- note: {text: Reviewed by QA, color: yellow}           # free-floating canvas annotation, never wired
```

## Functions

A Function Block step has the form of a block step: `- function: <name>` with
`settings`, `element_types`, `capture`, `secret_outputs`, `profiles` and
`label`, plus `version` for a library Function. A name defined under
`functions:` is an inline local Function; any other name is resolved in the
shared library and then an exact `version` is required. Local names shadow
library names. The Function's inputs are the Function Block's settings: each
takes every setting value form a block setting takes, and the settings are
checked like a block's (`UNKNOWN_SETTING`, `INVALID_SETTING_TYPE`,
`SETTING_TOO_MANY_DIGITS`, `INVALID_ENUM_VALUE`, `MISSING_REQUIRED_SETTING`), with
the Function's name as the block id.

```yaml
functions:
  - name: fetch_status
    inputs:  [{name: url, type: string, required: true}]
    outputs: [{name: status, type: integer}]
    variables: {attempts: {type: integer, value: 0}}   # the function's own variables
    flow:
      - block: http-client
        settings: {url: {expr: "url"}, method: GET}
        capture: {status_code: status}     # capture into an output name binds it

flow:
  - function: fetch_status
    settings: {url: {expr: "base_url + '/health'"}}
    capture: {status: health_status}
  - function: published_helper
    version: "1.2.0"                       # required for library Functions
    settings: {host: "myhost.local"}
    capture: {result: outcome}
```

Inside a function body the scope is flat bare names: inputs are read-only,
outputs are written by capturing into the output's name. Outer test variables
are not visible inside a function. A function's own `variables` take the same
form as the test's; a capture target in its body that is not an input, output
or own variable is auto-declared there, holding null. An optional input the
Function Block leaves out takes its default, else null. A required input must be
given (`MISSING_REQUIRED_SETTING`). A choice-list or true / false input, required
or not, is written with the Function's default when the Function Block is made,
and a readback lists it. Giving null to a required input, or to one with a
default, fails before the Function's body runs. An output nothing wrote returns
its default, else null.

A parameter takes `default:`, a plain value of its type; `default: null` and no
`default:` both mean no default. An input default of another type is refused
(`INVALID_VARIABLE_VALUE`). An input or output may also carry a
`description`, which a readback keeps. A `required` input may have a default: a
Function Block never uses it and always gives the value itself, so the default
is used only when the Function runs on its own. A boolean input that is not
secret needs one, as an enum input does (`BOOLEAN_INPUT_NO_DEFAULT`). A secret
input has no default, because the Function Block gives its value: a secret input
with a default is refused (`SECRET_INPUT_DEFAULT`).

An enum input is declared by the type of its values (`string`, `integer` or
`float`) with `required: true`, its allowed values in `enumValues`, and a
`default` that is one of them:
`{name: level, type: string, required: true, enumValues: [low, high], default: low}`.
The Function Block binds one of the values, and inside the body the input holds
that one value. An enum input of any other type is refused (`ENUM_INPUT_TYPE`),
and so is one that is not required (`ENUM_INPUT_NOT_REQUIRED`), has no allowed
values (`ENUM_INPUT_EMPTY`), lists a value that is not of its type
(`ENUM_VALUE_TYPE`), an empty text (`ENUM_VALUE_EMPTY`) or the same value
twice (`ENUM_VALUE_REPEATED`), has no default (`ENUM_INPUT_NO_DEFAULT`), has a default
that is not one of its allowed values (`ENUM_DEFAULT_NOT_ALLOWED`), or is
secret (`SECRET_ENUM_INPUT`). A secret output may have a default; it is sealed
at rest and a readback leaves it out.

A name cannot be both an input and an output, or both a parameter and one of
the Function's own `variables` (`DUPLICATE_PARAMETER_NAME`).

A Function step marks outputs Secret with `secret_outputs: [token]`: the variable
a marked output is captured into is masked like any secret, and a capture target
the step auto-declares is declared `secret: true`. Without `secret_outputs`, every output
the function declares secret is marked; a list given is the whole choice, so
`secret_outputs: []` marks none. An output the function does not have is refused
(`UNKNOWN_SECRET_OUTPUT`). A readback writes `secret_outputs` only when it differs
from what the function declares secret. A marked output captured into a variable
the recipe (or the function body) declares plain makes it secret, with the
warning `VARIABLE_MADE_SECRET` (see Blocks).

An output may take `expr:` or `template:` instead of a default, the kinds a
variable takes: `{name: total, type: integer, expr: "count * 2"}`,
`{name: label, type: string, template: "id-{{ count }}"}`. Such an output is
evaluated once, at its first read in the body or when the function returns, and
counts as written. As for a variable, `template:` needs `type: string`
(`TEMPLATE_NOT_STRING`). An input refuses both (`INPUT_KIND_NOT_ALLOWED`): give it a
plain default and compute the value inside the function.

A function that declares an input no block in it uses, or an output no block
writes, logs a WARN in the run log each time a Function Block runs it, one line
per name when the Function starts. The warning never blocks saving, running or
publishing.

## Rules worth knowing

- Test names are globally unique; a conflict is reported as a `NAME_CONFLICT`
  finding. To change an existing test, amend it (see below) instead of creating
  a second one.
- Blocks marked as not implemented in the catalog compile with a `STUB_BLOCK`
  warning; they will fail at runtime.
- Expressions are checked for syntax and safety at validation time; undefined
  variable references are reported by the platform validation stage.
- A block setting given null fails at run time and names the setting, so a
  secret nobody filled in stops its block before it sends anything. A `for`
  `count` and a `for_each` `collection` are the exception: on null they run
  zero times.
- A null map value or list row reaches the Block as null; each Block's setting
  description says what it does with one (use it, skip it, or fail naming the
  setting and the entry).
- A null `{{ }}` piece fails the block and names the piece; a Log message
  prints it as `null`.
- A null sent to a script as text (an input variable, argument or environment
  entry) fails the block before the script starts.
- SQL sends empty text as empty text and null as NULL.
- `break`/`continue` are only valid inside a loop body.
- A failing assertion is informational by default: it logs a warning, paints the
  block amber, and the run still ends `passed`. To make an assertion gate the
  run, set `fail_current_scope: true` on it. Without `on_pass`/`on_fail` a failed
  gating assertion fails its block and the flow stops there: a surrounding `try`
  catches it, otherwise the function or test it runs in ends failed. With
  `on_pass`/`on_fail` the flow continues down `on_fail`, which is where cleanup
  goes, and the function or test it runs in ends failed; a `try` does not catch
  that.
- A `wait_until` that gives up logs a warning, paints the block amber, and the
  flow continues past it. Set `fail_current_scope: true` to make giving up fail
  the block instead: the flow stops there, a surrounding `try` catches it,
  otherwise the function or test it runs in ends failed. Its `retry` steps run
  between checks, so they are what makes the condition become true; omit `retry`
  when something else in the run will satisfy it.
- A key the format does not define is rejected rather than ignored, so a typo
  like `captur:` never silently discards what you meant to write.
- A variable's literal value must match its declared type (`null` fits every
  type), and a capture target must be a valid variable name.
- A number past 19 digits for an integer, or past 28 significant digits for a
  float, is refused: a block setting, or an entry of its typed list, map or table,
  as `SETTING_TOO_MANY_DIGITS`, a variable or an input default as
  `INVALID_VARIABLE_VALUE`.

## Amending an existing test (round-trip)

`get_test_recipe` reads a test back as a recipe plus an `expressible` verdict.
Edit that recipe and hand it to `amend_test_from_recipe` to replace the test's
workflow, bumping its version and preserving the positions of blocks you did not
move. Secret values are never included in a readback - re-provide them (inline,
`value_from_file`, or declare-empty) in the amended recipe. A block or Function step
may carry `key: <name>`, a name of your own for it: an amendment keeps a Block's
place on the canvas when its step keeps the same `key`, even after steps before it
are added or removed. A step with no `key` is matched by its place in the flow.

A readback carries `test.version`. Because an amendment applies the whole recipe,
one built on a readback that has since been superseded - by a person editing in
the workbench, or by your own earlier amendment - would discard the newer content.
Amendment is refused in that case (`STALE_RECIPE_VERSION`): read the test back
again and re-apply your changes. Keep the `version` line as the readback wrote it;
a recipe written by hand simply omits it.

A test whose wiring the recipe format cannot express (hand-built cross-branch
edges, cycles, unstructured joins) reports `expressible: false` with a named
`inexpressible` list; amendment is refused for it (`TARGET_NOT_RECIPE_EXPRESSIBLE`)
so that hand-built connectivity is never silently dropped. Edit such a test in
the workbench.
