# V-MCP-READBACK-INTEGRITY-FUNCTIONAL: Faithful Readback or Honest Refusal

Verify `get_test_recipe` either expresses a hand-built test faithfully or names
what it dropped: custom branch ids must read back with their children intact,
and a lane the walk cannot express must make the readback inexpressible so the
amend loop refuses it instead of silently deleting blocks.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- `fixture.json` - hand-built if-else with custom branch ids (`branch_hit` /
  `branch_pass`), a rejoin edge, and a leaf assert carrying `fail_current_scope`
- `fixture-switch.json` - hand-built switch whose declared branches are
  `branch_0` (case) and `branch_1` (default), wired from the undeclared handle
  `branch_stray` plus a `then` continuation
- `../recipe-authoring/mcp_tool_client.py` - one-shot MCP client run through the
  backend poetry env (tool name in argv, JSON args on stdin)

## Steps

1. Import the fixture via `POST /tests` and confirm `POST /tests/{id}/validate`
   reports zero errors
2. Enable the MCP listener until-restart via `PUT /mcp/settings` (per-stack port)
3. Run `get_test_recipe` over the live endpoint
4. For the switch fixture, feed the readback recipe straight back into
   `amend_test_from_recipe`
5. Reset the MCP settings

## Validation

- **Custom branch ids:** `expressible: true`, zero inexpressible items; the
  recipe carries an `if` construct (not a leaf block) with its then-branch child,
  the rejoin block, and the assert's `fail_current_scope: true`
- **Undeclared switch lane:** `expressible: false`; the inexpressible list names
  the dropped child node; the recipe still carries the `switch` construct and its
  `then` continuation, and never carries the dropped lane's block
- **Refusal:** `amend_test_from_recipe` returns `amended: false` with a
  `TARGET_NOT_RECIPE_EXPRESSIBLE` finding
