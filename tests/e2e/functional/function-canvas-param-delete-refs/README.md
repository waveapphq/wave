# V-CANVAS-FN-PARAM-DELETE-REFS-01: delete confirmation when refs exist (regression guard)

Drill into a local Function carrying one input, one output, and one local variable, each referenced by an inner Log plugin's `message` expression. Deleting any of the three rows must open the confirmation dialog titled `Delete "<name>"?`.

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json`.

## Steps

1. Open `/workbench?editTest={id}`. Drill into `Function_1`.
2. Hover the `fn_input` row, click `delete-button-param:input:fn_input`. Confirmation dialog opens (`The input parameter is used by 1 block`).
3. Click Cancel. Row remains visible.
4. Repeat for `fn_output` (description holds `The output parameter is used by 1 block`).
5. Repeat for the `local_var` row (description holds `The variable is used by 1 block`).

## Validation

- `handleVariableDelete` looks up `inputRefCounts.get(name)` for `param:input:` and `param:output:` ids and opens the confirmation when the count is non-zero.
- `inputRefCounts` is scope-aware - it walks the inner subtree when drilled in, so inner Log message expressions actually contribute to the count.
- The confirmation dialog at `workbench-dialogs.tsx` is the single shared surface.

## V-FN-DELETE-CLEARS-BINDINGS

`v-fn-delete-clears-bindings-functional.spec.ts` - deleting a Function local or output clears the inner Block
bindings that write it, and one undo brings both back (REQ-3.1.2.3). No fixture file: the spec builds the Test
in code.

### Prerequisites

No external seed script. The spec seeds a Local Function `Bind_Fn` with a local `bound_local` and an output
`res_out`, and inside it one CSV Parser writing its Row Count into each, via `POST /tests`, zero validation
errors.

### Steps

1. Open the Test and drill into `Bind_Fn`.
2. Delete `bound_local` from its Variable Manager row and confirm; open the Block that wrote it.
3. Undo from the toolbar; check the local and the Block's binding.
4. Repeat 2-3 for the output `res_out`.
5. Rename a Block, Save the Test and read the stored Test.

### Validation

- After each delete the Row Count binding of the Block that wrote the name is empty in its sheet.
- One undo brings back both the variable and the binding.
- After the undos nothing is left unsaved; the later Save stores a Function that still declares
  `bound_local` and `res_out` and Blocks that still write them.
