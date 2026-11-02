# null-start-value

REQ-3.1.3.20, REQ-3.1.3.23, REQ-3.1.3.17, REQ-5.2.7.12; design decision VMGR-93.

A declared variable with no value holds null - for every type, secret or not. It
keeps its declared type, reads `null` in the Variable Manager in the null look
(gray italic monospace, never dimmed), and is null at run time. The create window
in the Variable Manager is different: it presets the type's default value, so a
variable created there holds that value, not null.

This is a shared variable surface, not one Block's: every Block reads variables
this way, so the specs live in their own folder.

Project: `functional-workflow`.

Every `test.step` in the three specs carries one local id, `NULL-START`: the one
contract this suite proves. It is local to this folder and means nothing outside it.

## Prerequisites

- The E2E stack's backend and frontend; no external service.
- `v-null-start-recipe.spec.ts` drives the live MCP listener through
  `../recipe-authoring/mcp_tool_client.py` (needs `poetry` in `backend/`).

## Files

| File | What it proves |
|---|---|
| `v-null-start-functional.spec.ts` | The API accepts a declaration with no value of every type and a secret, with no `NO_VALUE_VARIABLE` refusal; the read carries no `value` key and no `variable_warnings` field; every row reads `null` in the null look, not dimmed, under its declared type; a run starts each of them on null, so the first Log, which adds text to a null string, fails and no later block runs; the secret with no value reads `null` on both reveal paths. |
| `v-null-start-authoring.spec.ts` | The create window: a variable created without touching the value body stores the type default it preset, its row reads that default, the boolean stores `false`, and the saved test carries every value. |
| `v-null-start-recipe.spec.ts` | The recipe format: a type alone and `value: null` are both accepted; only a SECRET with no value raises an action item; the readback keeps a bare type bare and writes `value: null` back; the stored test and the Variable Manager keep every declared type and read null; `reveal_secret` on the secret with no value answers `value_not_set`. |

## Steps and validation

### v-null-start-functional.spec.ts

1. `POST /tests` with `z_string`, `z_integer`, `z_float`, `z_boolean`, `z_array`,
   `z_map`, `z_table` declared as a type alone, `z_secret` a secret with no value and
   `f_secret` a filled secret: answers 201, the Test validates with zero errors,
   `GET /tests/{id}` returns `{"type": "<type>"}` for each and no `variable_warnings`;
   a `PUT` keeps them.
2. Open the Test: every `z_*` row reads `null` - italic, monospace, the
   muted-foreground color, effective opacity 1 - and its type pill shows the declared
   type; `f_secret` reads `********`.
3. Run: the run ends `failed`; the console carries
   `Block 'Log Scalars' failed: A value is null: can only concatenate str (not "null") to str`;
   `Log Scalars` is `failed`, `Log Containers`, `Log Secret` and `Assert Null` never
   run (no run state on the canvas, none in the session's block states);
   `GET /workbench/{session}/variables` holds null for every `z_*` variable and for
   `z_secret`; the rows still read `null` under their declared types.
4. With the test-variables reveal off and then on, `z_secret` reads `null` in the
   null look; `f_secret` reads `********`, then `filled-secret-9f2a`.

### v-null-start-authoring.spec.ts

1. Create `u_string`, `u_integer`, `u_float`, `u_array`, `u_map`, `u_table` with
   the value body untouched: the rows read blank, `0`, `0`, `[0 items]`, `{0 keys}`,
   `0×0 table`.
2. Create `u_boolean` untouched: it reads `false`. Create the secret `u_secret`
   untouched: it reads blank, not masked.
3. Save: Save settles disabled and no "Variables Without Values" toast shows.
4. `GET /tests/{id}` carries `''`, `0`, `0`, `[]`, `{}`, `[]`, `false` and the
   secret's `''` under their declared types.

### v-null-start-recipe.spec.ts

1. `get_recipe_guide` says "A `type` alone is a complete declaration".
2. `create_test_from_recipe` with `session` and `attempts` as a type alone, `limit`
   (integer) and `labels` (map) as `value: null`, and the secret `token` with no
   value: created; the only action item is `NO_VALUE_VARIABLE` on `variables.token`.
3. `get_test_recipe`: `session` and `attempts` read back as a bare type, `limit` and
   `labels` as their type plus `value: null`, `token` as its type plus `secret: true`.
4. `GET /tests/{id}` stores each one as declared; opened in the workbench every row
   reads `null` in the null look under its declared type.
5. `reveal_secret` on `token` answers `value_not_set`.

## Notes

- `v-null-start-functional.spec.ts` and `v-null-start-recipe.spec.ts` flip the
  system `test_variables` reveal flag, and the recipe spec drives the live MCP
  listener; both reset what they changed in `afterEach`.
