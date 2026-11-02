# V-CANVAS-FN-PARAM-PERSIST-01: Input/Output/Variable persistence (regression guard)

Drill into a local Function, add one input + one output + one variable via the +Add dropdown, verify each lands in the correct group immediately, save, reload, drill back in - all three survive.

## Specs in this folder

| Spec | What it proves | Seeds (API) |
|------|----------------|-------------|
| `v-canvas-fn-param-persist-01.spec.ts` | Input, output and variable rows added in a Local Function survive Save and reload (below) | `fixture.json` (one empty Local Function) |
| `v-canvas-fn-block-fields-functional.spec.ts` (V-CANVAS-FN-BLOCK-FIELDS) | Function Block inputs open as their literal widget, an expression or variable opens as its text, and opening and closing the Function Block window changes nothing; an unset input shows its default in gray in both modes and the true / false input holds its default as a value, never gray; a mode switch stores nothing, a cleared value stores nothing and the run uses the default; the typed list and map editors store numbers (`[1, 2, 3]`, `{'a': 5}`); a table input previews its rows' JSON without quotes, gray when unset | `zz-` Tests with Local Functions (inputs holding literals of every field kind, held defaults of every field kind, a list and a map input, a table input) and a library Function instance, deleted after each test; the library Function deleted with `cascade=true` |
| `v-fn-block-nameless-import-functional.spec.ts` (V-FN-BLOCK-NAMELESS-IMPORT-FUNCTIONAL) | A For Loop with no Name in a Local Function imports named `For Loop`, the stored Test saves clean, the Block reads `For Loop` on the canvas, and the run prints `iter-0` and `iter-1` | `fixture-fn-block-nameless.json`, imported through the Tests page Import dialog under a `zz-` name and deleted afterwards |
| `v-fn-block-window-functional.spec.ts` (V-FN-BLOCK-WINDOW-FUNCTIONAL) | The Function Block window's Name gate (`Name is required`, Save off, a new Name saved on the Block and its Local Function), its footer Profiles count `2` (none shown for a Block with no profile), and an edit-mode Description stored on the Block while the draft keeps the library description | `zz-` Tests with a Local Function, two `custom` profiles and a library Function on a Shared Function Block, all deleted afterwards; the library Function with `cascade=true` |
| `v-fn-input-remove-drops-field-functional.spec.ts` (V-FN-INPUT-REMOVE-DROPS-FIELD-FUNCTIONAL) | Removing a declared input or output in the Variable Manager drops the Function Block's field with its flags, entry flags and item types, on a Local Function and on a Shared Function Block's edit-mode draft; each saved Test runs and passes | `zz-` Tests with root variables and a Function with kept and removed inputs and outputs (Local, and a library Function for the Shared case), deleted after each test; the library Function with `cascade=true` |
| `v-fn-scope-names-functional.spec.ts` (V-FN-SCOPE-NAMES-FUNCTIONAL) | Nested Function Blocks inside a Function flow offer the enclosing Function's names, not the root flow's; their badges `Required parameter 'x' is missing` and `Required parameter 'who' is missing` clear once the inputs are set; the run prints `AL\|B` and `hello Bo` | a `zz-` Test with a Local Function holding two nested Local Function Blocks with no values, stored through the admin bulk route (the save refuses an empty Required input), deleted afterwards |
| `v-fn-template-entry-kept-functional.spec.ts` (V-FN-TEMPLATE-ENTRY-KEPT-FUNCTIONAL) | A Template input and a map input's {x} entry keep their kind through Save and reload, and the run prints `Hello Ann\|42` | a `zz-` Test (`POST /tests`) with the variables `who` and `base` and a Local Function `Greet_Fn`, deleted afterwards |

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json` (one empty local Function).

## Steps

1. Open `/workbench?editTest={id}`. Drill into Function_1.
2. + Add ▾ → Input parameter. Name=`username`, default=`admin`, Save. Row at `[data-testid="in-badge-param:input:username"]` appears immediately.
3. + Add ▾ → Output parameter. Name=`result`, type=integer, default=`0`, Save. Row at `[data-testid="out-badge-param:output:result"]` appears.
4. + Add ▾ → Variable. Name=`tmp`, default=`x`, Save. New row appears in `[data-testid="var-group-variables"]`.
5. Click `toolbar-save-button`. Reload (`/workbench?editTest={id}`). Drill back in.
6. All three rows present in the right groups.

## Validation

- `handleCreateParameter` routes Input mode to `addInputParam` and Output mode to `addOutputParam`.
- `displayVariables` reactivity re-fires on inner mutation so the row appears immediately, not "after another render".
- `PUT /tests/{id}` payload includes `localDefinition.inputs / .outputs / .variables` and the load path rehydrates them.

# V-CANVAS-FN-PARAM-NULL: Function locals, inputs and outputs created null

Spec: `v-canvas-fn-param-null-functional.spec.ts`. Set to null (VMGR-97, REQ-3.1.3.24) in the
Function local and Output windows for every type, and in the Input window for every free-entry type
(a true / false input always declares a default, REQ-3.1.2.10), and Create enum turning it off
(VMGR-104).

## Prerequisites

No fixture. Each test seeds a `zz-` Test through `POST /tests`: Start, a Local Function `fn1` with
one body Log; the output test adds a Log after the Function and the root flow variables `c_<type>`,
each holding a value that is not null. The Test is deleted afterwards and the published library
Function with `cascade=true`.

## Steps

1. Drill into `fn1`; + Add > Variable / Input parameter / Output parameter; name, Type, tick Set to
   null, Create - once per type.
2. Set the body Log's message to a map reading every new name (locals, inputs), or bind each output
   to its `c_<type>` in the Function Block window (outputs).
3. Save, read the stored Test, reload, drill back in, Run.
4. Enum test: an Array input with Set to null ticked, then Create enum on, off and on again.
5. Publish test: one null item of every type across the three windows; Save, reload, Publish to
   Library, read the library version, open the Function View.

## Validation

- **Created:** Kind is hidden, the window shows one `null` field, the row reads `null` in the null look
- **Stored:** a local keeps `value: null`, an input or output `default: null`, with no kind flag; an
  input stays optional
- **Run:** the body Log prints `{"string":null,"integer":null,...}` for locals, and for the inputs
  the Function Block gives nothing (every free-entry type); for outputs every bound `c_<type>` holds null in the session and the Log after the Function prints it
- **Create enum:** unticks and disables Set to null; off again, Set to null is enabled; the enum
  input is stored Required with its allowed values and no default
- **Publish:** the library version stores every item null with no kind flag; the Function View rows
  read `null`
