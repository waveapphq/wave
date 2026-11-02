# V-MCP-RECIPE-FUNCTIONAL: Recipe Authoring via MCP

Verify a recipe-authored test created through the live MCP `create_test_from_recipe`
tool is a real, runnable test: branching, loops, a parallel section, and a split assert
execute correctly and every rejoin edge survives persistence.

The fixture uses only constructs with an implemented engine runtime; Wait Until is
excluded until its runtime lands. Parallel is included for its container
topology - both branches execute concurrently and the flow continues through the
section's `then` egress.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- No fixture import: the test is created through the MCP endpoint at runtime
- `recipe.yaml` - the fixture recipe (unique test name injected per run)
- `mcp_recipe_client.py` - one-shot MCP client run through the backend poetry env

## Steps

1. Enable the MCP listener until-restart via `PUT /mcp/settings` (per-stack port)
2. Run `validate_recipe` over the live endpoint (dry-run)
3. Run `create_test_from_recipe` over the live endpoint
4. `POST /tests/{id}/validate` and inspect the persisted workflow via `GET /tests/{id}`
5. Disable the MCP listener
6. Open the created test in the workbench (`/workbench?editTest={id}`)
7. Run the test via the toolbar Run button
8. Read console logs, node statuses, and session variables

## Validation

- **Dry-run:** `valid: true`, zero findings, nothing persisted
- **Create:** `created: true`, version `1.0.0`, zero warnings
- **Platform validation:** zero errors on the persisted test
- **Rejoin edges:** if/else tails -> `ingress_1`; if/elif/else tails ->
  `ingress_1`/`ingress_2` (`_fix_multi_edges` regression guard).
  Parallel branches dead-end, so the assert hangs off the section's `then` egress
- **Canvas sanity:** 22 nodes + start node attached, 25 edges rendered, no
  overlapping node bounding boxes
- **Execution:** taken-branch markers log exactly once, loop body logs 3 times,
  both parallel branches log, untaken-branch markers never log, rejoin-downstream
  nodes execute, `retries == 2` after the labeled break, session outcome passed
- **Clean end state:** MCP listener disabled (running false, no URLs)

---

# V-MCP-RECIPE-LIFECYCLE-FUNCTIONAL: Recipe Lifecycle over MCP

End-to-end guard for the recipe surface an LLM actually uses: the packaged
guide examples, branch fall-through wiring, note round-trips, and the tracked
failure-report shape.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- No fixture import: recipes are inline; tools run over the live MCP endpoint
- `mcp_tool_client.py` - general one-shot MCP client (tool name in argv, JSON
  args on stdin, envelope on stdout) run through the backend poetry env; used
  wherever a tool needs more than a bare `recipe` argument
  (`start_execution`, `amend_test_from_recipe`, `get_failure_report`, ...);
  `WAVE_MCP_CLIENT_NAME` overrides the declared client name (default
  `wave-e2e-tool-client`); a tracked run is attributed `mcp:<client name>`

## Steps

1. `get_recipe_guide` + `validate_recipe` over every packaged example; run an
   executable slice of the branching-loops example (if, switch, loops, break)
   as a tracked execution
2. Create + run a fall-through recipe (if with no else, a then ending in
   break); create, inspect and run a switch whose only case misses and that
   carries no default
3. Create a recipe carrying a sticky note; read it back via `get_test_recipe`
4. Create a for_each recipe with a split `fail_current_scope` assert (its
   `on_fail` records the blocking node); run tracked;
   read `get_execution` + `get_failure_report`

## Validation

- **Guide:** every example returns structured findings; the self-contained
  examples (01-03) validate fully clean; the packaged switch example carries no
  removed `on`/`equals` key; the loops example teaches `item['value']` and its
  construct slice RUNS with real item values (no typed-envelope repr in any
  rendered line), only the matching case body logging and the step after the
  switch running
- **Fall-through:** the step after an if-with-no-else executes; the loop tail
  after a then-ending-in-break executes on non-break passes; a switch with no
  default keeps its authored label, wires the next step from its `then` handle,
  and at runtime skips the missed case while still running that next step
- **Notes:** the saved test reads back expressible with the note preserved
- **Failure shape:** tracked run failed; exactly one failed test row with one
  failed block whose label is the assert's label and whose error is
  `Assertion failed: 1 of 3 assertions failed`; the expression detail and the
  FATAL verdict appear in the WARN-and-above log excerpt

---

# V-MCP-RECIPE-GEOMETRY-FUNCTIONAL: Recipe Block Sizing

A recipe-built block is stored at the width the canvas draws for its name; the
longest names stop at the maximum instead of growing; a hand-set size survives
an amend while a compiler-generated one is regenerated for the new name; and a
recipe readback carries no geometry at all.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- No fixture import: the test is created through the MCP endpoint at runtime
- `mcp_tool_client.py` - the shared one-shot MCP client (tool name in argv,
  JSON args on stdin), run through the backend poetry env; two of the three
  calls need a `test_ref`, which the recipe-only client cannot send

## Steps

1. Enable the MCP listener until-restart via `PUT /mcp/settings` (per-stack port)
2. `create_test_from_recipe` with three log blocks: a 28-character label, a
   51-character label and an unlabeled block
3. Read the stored widths via `GET /tests/{id}`
4. Open the test in the workbench and read the inline widths and the title
   clipping
5. `PUT /tests/{id}` with a hand-set width and height on the first block
6. Leave the workbench, free the ownership slot, then `amend_test_from_recipe`
   with the third block renamed and a fourth appended
7. `get_test_recipe` and check the YAML for geometry keys

## Validation

- **Stored widths:** 338 / 360 / 160; no `height` key on any node
- **Canvas:** the inline widths match the stored ones; the 28-character title is
  laid out in full, the 51-character title is clipped
- **Amend:** the hand-set 230 / 73 survive, the pinned position holds, the
  renamed block regenerates to 348, and the appended block is 160 with no height
- **Readback:** expressible, and the YAML carries no `width`, `height` or
  `position`

## V-MCP-RECIPE-ELEMENT-TYPES-FUNCTIONAL

- Spec: `v-mcp-recipe-element-types-functional.spec.ts`; fixture: none (the recipe is built in the spec).
- A recipe declares `element_types` on variables, a set step and a SQL block step; the created Test stores the web UI form, the run reads every element as its declared type, and a readback writes `element_types` in full; a float element written as `.nan` or `.inf` is refused (REQ-3.1.3.19).

## V-MCP-RECIPE-CHOICE-WORDS-FUNCTIONAL

- Spec: `v-mcp-recipe-choice-words-functional.spec.ts`; fixture: none (the recipe is built in the spec).
- A recipe whose HTTP block says `proxy_mode: off` with no quotes is created, stores the word `off`, reads back as `proxy_mode: 'off'` and shows "Off" on the block's Proxy row; a bare `on` is refused with `Setting 'proxy_mode' of block 'http-client' expects string, got boolean` and stores nothing (REQ-5.2.7.3, REQ-3.4.3.9).

## V-MCP-RECIPE-FILTERS-FUNCTIONAL

- Spec: `v-mcp-recipe-filters-functional.spec.ts`; fixture: none (the recipe is built in the spec).
- `get_recipe_guide` carries a filters subsection showing the stored filter item shape; a recipe whose CSV block writes a filter in that shape is created and stored as written, its config sheet shows one filter block on `amount` as Integer with the literal condition "greater than" `5`, and the run keeps rows `b,c` (CSV-12, REQ-5.2.7.3, REQ-5.2.7.7).
- `get_block` describes the sort and filter item shape; the guide's own filter example, placed in a recipe as written, compiles, its sheet shows the sort (`amount` descending) and the filter (`amount` as Integer, greater than 5), and the run keeps `c,b` (REQ-5.2.7.8).

## V-MCP-RECIPE-NULL-PARAMS-FUNCTIONAL

- Spec: `v-mcp-recipe-null-params-functional.spec.ts`; fixture: none (each recipe is built in the spec, created with `create_test_from_recipe`, run tracked with `start_execution` and deleted after).
- A secret Function input with a default is refused by `validate_recipe` and `create_test_from_recipe` with `SECRET_INPUT_DEFAULT` "Secret input 'tok' cannot have a default" and nothing is stored; the same input with no default creates (VMGR-103, REQ-3.1.2.9).
- `default: null` on an input and an output stores no default; the run prints `who=null` from the input the Function Block gives nothing and `res_out=null` from the unwritten output (REQ-3.1.3.21).
- An output written `expr:` / `template:` is stored `isExpression` / `isTemplate` with its source in `default`, reads back in the same form, and the run prints `total=42 label=id-21` with no unwritten-output WARN; an input written that way is refused with `INPUT_KIND_NOT_ALLOWED` (VMGR-99, REQ-3.1.2.8); `get_test_recipe` reads the Function step back as `- function: kind_outputs` with `settings` and `capture`, and an amend of that readback with `count: 5` changes the same Function Block, whose run prints `total=10 label=id-5`.
- An `is_null` comparison with no `value_type` stores the declared type of its variable for all seven types and for a Function's input, output and local; null takes the then path, a held value the else path (REQ-3.1.3.25).
