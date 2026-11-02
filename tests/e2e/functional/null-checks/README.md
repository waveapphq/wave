# V-NULL-CHECKS Checks on null and typed values - Functional

End-to-end coverage of the check blocks (Assert, If/Else, Switch, While, Wait Until) on a null
value and on typed values (REQ-3.1.3.25, REQ-3.3.1.4). Each spec builds its checks through the
config sheet on a blank `zz-` Test it creates, runs it, reads each block's status and the
console, and deletes the Test. Where a matrix is too large to build by hand
(`v-null-check-assert-functional.spec.ts`), the spec first proves that the sheet stores the same
row shape as `literalCondition` (`helpers/nesting-graph.ts`), then imports a generated `zz-` Test
with one Single Assert per cell. `check-chain.ts` holds the shared chain builder and the
generator.

## Pre-requisites

- Backend and frontend on the per-worker ports (Playwright fixtures).
- No stack services.

| Spec | What it builds | Services |
|------|----------------|----------|
| `v-check-length-contains-functional.spec.ts` | `nums` = `[1, 2, 3]` (integer items) from the Variable Manager; Single-mode Asserts `nums` length equals `3` and `nums` contains `2` typed into the value box; then length equals 3 / 0, contains 2 and does not contain 2 on `nums` and on a null `nums_null` (seeded) | none |
| `v-null-check-operators-functional.spec.ts` | One test per check block (Assert, If/Else, Switch, While, Wait Until) on a Test seeded with one variable per type: seven rows built in the sheet, the operator list of each type read in order, is null / not null picked (value box and `{}` toggle gone), saved, and the stored rows read back; an Assert whose rows the variable pick lands on is true / is null, copied and pasted; a CSV filter row switched from String to Boolean | none |
| `v-null-check-assert-functional.spec.ts` | Test 1 builds five Single Asserts in the sheet on a null `status` (not equals, equals, is null, not null with its `actual: null` lines) and a null compare-to expression; tests 2-8 import one generated Assert per operator of each type on a null and on a held value; test 9 is null / not null on `'abc'` checked as integer; test 10 a null compare-to value in Assert, If/Else, Switch, While and Wait Until, each on its own Try path | none |
| `v-null-check-table-functional.spec.ts` | Four Single Asserts built in the sheet on the table `hosts` (is null, not null, is empty, is not empty), seeded null, empty and filled, one test each; the row offers only the four table operators | none |
| `v-null-check-ifelse-functional.spec.ts` | Test 1: an If/Else from the palette, If `i_null not null`, an added Else If `s_null not equals x`, a Log on each lane. Tests 2-3: a generated Test with one If/Else per cell (7 types x is null / not null / one holds-nothing check), a Variable Setter on each lane writing `route_<cell>` | none |
| `v-null-check-switch-functional.spec.ts` | Test 1: a Switch from the palette, case `m_null has key k`, an added case `t_null is empty`, a Default, a Log on each lane. Tests 2-3: a generated Test with one Switch per cell: a first case false on null, the cell's case, a Default, each lane writing `route_<cell>` | none |
| `v-null-check-while-functional.spec.ts` | Test 1: a While from the palette, `b_null is false` OR `f_null not null`, a Log on the body and then lanes. Tests 2-3: a generated Test with one While per cell (at most 3 passes, index bound), its body a Variable Setter writing a held value of the type, then a pass Log | none |
| `v-null-check-wait-until-functional.spec.ts` | Test 1: a Wait Until from the palette, Retry, 600 ms, every 200 ms, `a_null not null` OR `a_null contains x`, a Log on the retry and then lanes. Tests 2-3: a generated Test with one Wait Until per cell (Retry, 600 ms, every 200 ms, passed / elapsed bound), a round Log on the retry lane | none |

The If/Else, Switch, While and Wait Until specs share `routing-cells.ts`: the cell table, the
generated Tests and the run reader. Their first test proves through the sheet that the stored
condition rows equal the generated ones; the generated Tests are imported with POST /tests and
deleted after the file.
