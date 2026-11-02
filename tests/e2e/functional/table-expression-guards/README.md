# V-TABLE-EXPRESSION-GUARDS: what a field expression may do to a table

Verify the read-only guard on element field expressions, the table query
operations, the save-time variable scan, and that text inside a string literal
is never read as code by the editor's checks.

## Pre-requisites

No seed. The guard cases call the expression-validation endpoint directly; the
run cases import their own fixture via `POST /tests` and execute it in the
workbench. No external service.

## Fixtures

| Fixture | Covers |
|---------|--------|
| `mutators` | an element field expression calling a whole-column mutator on a table variable |
| `chain` | one `filter -> filter -> order_by(two keys)` chain typed into the CSV converter's and the Excel converter's table parameter |
| `sandbox` | field expressions carrying a comprehension, a lambda and the sandbox builtins |
| `undeclared` | a field expression naming a variable that exists nowhere |
| `template-mutator` | a template field whose `{{ }}` marker calls a mutating method |
| `variable-mutator` | a Variable Manager expression entry calling a mutating method |
| `readonly-names` | `sorted()`, `keys()`, `reversed()` and slicing, on a field expression and inside a template marker |
| `quoted-text` | a table `final` with an `@timestamp` column and two Log Blocks the spec fills through the config sheet: a template marker and a field expression |

## Steps

1. `./scripts/e2e-targeted-local.sh functional/table-expression-guards/v-table-expression-guards.spec.ts` from the root of
   the clone, or the whole suite via `./scripts/ci-playwright-local.sh`.

## Validation

- **G1 guard catalog:** each of `add_col`, `insert_col`, `remove_col`,
  `set_row`, `insert_row`, `set_cell`, `add_row`, `remove_row` is refused by the
  expression validator with `Method '<name>' modifies data and is not allowed in
  field expressions`; `filter`, `order_by` and `col` stay callable.
- **G1 at save time:** saving the `mutators` fixture is refused with HTTP 422
  carrying `EXPRESSION_CHANGES_DATA`, whose message names the method and points
  at a Variable Setter Block - so a test that would restructure the table can
  never reach a run.
- **G2:** the `chain` run passes; the emitted CSV text is
  `region,rep,amount~west,cy,30~west,ada,10~west,zoe,10~` and the workbook read
  back holds `cy,ada,zoe` with amounts `[30, 10, 10]` - two filters and a
  two-key ordering, with the second key breaking the tie. The source variable
  still holds all five rows.
- **G3:** the `sandbox` fixture passes the zero-error import gate (which IS the
  save-time scan) and logs `guard-comp=A-1,B-2`, `guard-lambda=42` and
  `guard-builtins=1,2,3|True|7`; saving the `undeclared` fixture is refused with
  HTTP 422 carrying `UNDECLARED_VARIABLE` for `nowhere_var`.
- **G4 template marker and expression variable:** saving `template-mutator` is
  refused with HTTP 422 carrying `EXPRESSION_CHANGES_DATA` and the message
  `The append method changes data. An expression can only read data, not change
  it. To change a variable, add a Variable Setter Block. Block: Template
  Mutator. Field: message.`; saving `variable-mutator` is refused the same way,
  ending `Variable: grown_list.` Neither message carries the old
  `Blocked pattern` wording.
- **G5 names only:** `readonly-names` saves clean, passes the zero-error gate
  and runs green, logging `guard-sorted=ada,cy,zoe`, `guard-keys=a,b`,
  `guard-slice=ada,cy`, `guard-reversed=cy,ada,zoe` and
  `guard-template=ada,cy,zoe`.
- **G6 text inside quotes:** in the Edit value sheet with Template kind,
  `{{ final.cell(0, @timestamp) }}` is underlined and
  `{{ final.cell(0, '@timestamp') }}` is not; after Save the row shows no amber
  finding. In the expression row, each mark outside quotes gets its finding under
  the row (`Decorators (@) are not valid in expressions`, `Comments (#) are not
  valid in expressions`, `Semicolons are not valid in expressions`, `Unbalanced
  parentheses: unexpected )`) and the same mark inside quotes gets none. Both
  Blocks save as written (template field and expression field), and the run
  passes and logs `2026-09-27T10:00:00.000Z` and `marks=#;)`. The Test is deleted
  afterwards.

## Notes

- The five mutators listed first are the ones the guard used to miss: it named
  operations the table type does not have, so whole-column add / insert / remove
  and row replace / insert went through unguarded.
- G3 asserts both directions on purpose - widening the scan to free names must
  not blind it to a name that really is undeclared.
- G5 is the other direction of G4. The read-only rule matches whole method and
  constructor names, so a check that started refusing everything would still
  pass G4 and fail here. `reversed` is one letter from the blocked `reverse`
  method and is the sharpest case.
- While the author is still typing, the editor's inline advisory shows the
  older wording and a template field gets no warning border until save. That is
  known and is deliberately not asserted here.
