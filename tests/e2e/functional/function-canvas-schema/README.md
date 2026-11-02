# V-CANVAS-FN-SCHEMA-01: Function schema editor

Drill into a local Function, create an Input parameter via the +Add ▾ dropdown, verify the IN-badged row lands under PARAMETERS / INPUTS. Verify single-namespace duplicate rules (cross-section + within-section).

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json`.

## Steps

1. Open `/workbench?editTest={id}`. S1: at Test root the +Add is a single button (no chevron). Drill into Function_1 - +Add gains the chevron dropdown.
2. S2: + Add ▾ → Input parameter. The "New input parameter" window opens. Fill name=`user_id`, default=`admin`. Save - row appears at `[data-testid="variable-row-param:input:user_id"]` with IN badge.
3. S3: + Add ▾ → Output parameter. Type name=`payload` (an Input already named `payload`). Inline `name-error` appears with "already exists"; `save-btn` is disabled. Inputs and outputs share one Function-scoped namespace (FN-PARAM-4).
4. S4: + Add ▾ → Input parameter. Type name=`token` (an existing Input). Same inline-error contract.

## Validation

- The scoped + Add dropdown lists Input / Output / Variable in that order (FN-VMGR-4).
- Function-mode window title is "New input parameter" / "New output parameter" (FN-PARAM-2).
- Declared inputs render with the IN badge under PARAMETERS / INPUTS (FN-VMGR-1, FN-VMGR-2, FN-VMGR-3).
- Single namespace per Function rejects duplicates regardless of category (FN-PARAM-4).

# V-CANVAS-FN-PARAM-WINDOW: one window body for variables and parameters

Spec: `v-canvas-fn-param-window-functional.spec.ts` (VMGR-97, VMGR-98, VMGR-99, VMGR-110, VMGR-112). The Variable window (Test
"+ Add") and the Function local, input and output windows (in-Function "+ Add") are one body.

## Prerequisites

No external seed script. Each test creates a `zz-` Test holding one empty Local Function through
`POST /tests` and deletes it afterwards.

## Steps

1. Open each window: read its field order; pick each Kind; create a Template and an Expression; type an
   Array, Map and Table in the "Edit value" window's Code view and read them in its Visual view; resize
   the window.
2. Save the Test and read it back (`GET /tests/{id}`).
3. For each window and value type (String, Template, Expression, Integer, Float, Boolean, Array, Map,
   Table, an enum's Default select, a Required input's default, Set to null), on a 1280x420 screen and
   dragged to its smallest size,
   scroll the form to its end.
4. At 1400x900, open an input window with its String default.

## Validation

- Every window reads Name, Description (parameters), Type with Kind beside it (none on an input), the
  checkboxes together (an input: Required, Mark as secret, Set to null, Create enum), the value last
- Kind offers Literal, Expression and Template on a String (Literal, Expression otherwise); the stored
  entries carry `isTemplate` / `isExpression` with the source text and the rows show the kind badge
- Code-typed lists show in Visual and are stored typed (`[1, "two"]`, `{"k": 5}`, and the table
  `[{"id": 1, "name": "a"}]` with its columns `id` integer and `name` string)
- The value field is one line of one height for String and Array in every window, also after a resize
- Scrolled to its end, every window shows the whole value field (label, field, error line) above the
  footer; the input window opens with its String default field whole and nothing to scroll

# V-CANVAS-FN-ADD-WINDOWS: one window per Add

Spec: `v-canvas-fn-add-windows-functional.spec.ts` (VMGR-101, VMGR-102).

## Prerequisites

No external seed script. Each test creates a `zz-` Test holding two empty Local Functions (`Fn_A`, `Fn_B`)
through `POST /tests` and deletes it afterwards.

## Steps

1. In `Fn_A`, open several windows with "+ Add" and fill them; Create and Cancel them one by one.
2. Drag the middle of three cascaded windows.
3. Open windows in `Fn_A`, go to the Test and into `Fn_B`, then Create.
4. Save the Test and read it back (`GET /tests/{id}`).

## Validation

- Each Add opens another window; earlier windows keep their drafts
- Create and Cancel close only their own window; the stored Function holds exactly what was created
- Windows cascade 24 px apart; a dragged window moves alone and comes to the front
- A window keeps creating into the Function it was opened in: `Fn_A` holds the new input, local and
  output; `Fn_B` and the Test hold none
