# V-VARPICK: the shared variable picker on every condition surface

Verify that naming a variable in a condition behaves the same everywhere the
platform asks for one - Switch cases, If/Else branches, Assert and While - and
that the picker offers exactly what can be picked: namespace MEMBERS
(`system.x`, `suite.x`, `regression.x`) with their real types, never the bare
namespace roots, which are containers rather than variables. Expression
autocomplete keeps the roots, because `system.` is a legitimate prefix to type
there. Also pins the OUT badge to its one meaning: a node writes this variable.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- The namespaces spec seeds its own System variables, Suite (with variables),
  Regression (with variables, owning the suite) and a Test inside that suite,
  and deletes them again afterwards
- The surfaces spec seeds a Test carrying one Switch, If/Else, Assert, While and
  CSV Parser node plus a 60-character variable name
- The suggest-focus spec (`v-varpick-suggest-focus-functional.spec.ts`) seeds a
  blank `zz-` Test per test and builds every editor host through the UI

## Steps

1. Seed the entities via the API and open the test in the workbench
2. Open the Switch config and click the case condition's variable field
3. Read the offered options, their type pills and their badges
4. Pick a namespaced member, save the sheet and the workflow, then read
   `GET /tests/{id}/workflow`
5. Open the Log config and type a namespace prefix into the message expression
6. Repeat step 2 on the If/Else, Assert and While config sheets
7. Open the CSV Parser config, add a filter predicate and a sort key

## Validation

- **Members offered:** `system.sys_flag`, `system.sys_count`, `suite.suite_host`
  and `regression.reg_env` all appear as selectable options
- **Roots withheld:** no option is exactly `system`, `suite` or `regression`
- **Real types:** each member's pill reads its own type (boolean / integer /
  string), never a namespace type
- **OUT badge:** the system member carries none; `loop_index`, bound to the While
  loop's output, carries one
- **Persistence:** after picking `system.sys_count`, the saved test's condition
  reads `variable: "system.sys_count"` and `value_type: "integer"`
- **Expression autocomplete:** typing `sys` in a plugin parameter expression
  offers the bare `system` alongside its members
- **Per surface (Switch / If/Else / Assert / While):** the long name truncates
  on screen, exposes its full text through `title`, keeps its type visible, the
  option list never scrolls horizontally, typing narrows the list to one option,
  no character counter appears, and discarding the filter restores the bound name
- **Table Transform:** a filter predicate's autocomplete offers the same test
  variable, and a sort key records one column
- **Suggestion list follows focus (suggest-focus spec):** in a block setting
  expression, a check row expression, a table filter row, a Function Block input
  binding, the create window (Expression and Template kind), the variable's
  window in Edit (Expression and Template source), an Edit value sheet in
  Template kind, the full expression editor and a Python script body, typing
  opens the list while the field has focus, leaving the field closes it, and
  typing then leaving at once leaves no list on screen after the list's delay;
  in the variable's window in Edit the list offers the variable in scope
  (`t_src`) and Ctrl/Cmd+E opens the full expression editor
