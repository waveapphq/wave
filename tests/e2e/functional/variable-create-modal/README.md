# Variable Create Modal

Functional specs for the Variable Manager creation windows: the root "+ Add" window for a Test
variable and the in-Function Add menu's Variable, Input parameter and Output parameter windows.
Each spec seeds its own Test through `POST /tests` and drives the windows through the UI.

| V-TEST | Spec | Covers |
|--------|------|--------|
| V-VMGR-CREATE-FUNCTIONAL | `v-vmgr-create-functional.spec.ts` | A variable of every type and kind created from "+ Add" with the right type and kind badge; a destructive type switch confirms first |
| V-VMGR-CREATE-STRING | `v-vmgr-create-string.spec.ts` | The String Kind editors |
| V-VMGR-CREATE-COMPLEX | `v-vmgr-create-complex.spec.ts` | A table, array or map value's "Edit value" window (Open editor): Code editor, validation strip, numeric caps, per-element types; a type switch resets the window's value |
| V-VMGR-CREATE-ELEMENT-TYPES | `v-vmgr-create-element-types.spec.ts` | A map and a list keep each element's picked type through save, reload and a run |
| V-VMGR-CREATE-NESTED-ROUNDTRIP | `v-vmgr-create-nested-roundtrip.spec.ts` | A nested array item or map value keeps its type and value across save, reload and inspect |
| V-VMGR-CREATE-PRECISION | `v-vmgr-create-precision.spec.ts` | Table and nested map numbers survive save and a run exactly |
| V-VMGR-CREATE-SECRET | `v-vmgr-create-secret.spec.ts` | A secret's value is inspectable only while unsaved |
| V-VMGR-CREATE-SET-TO-NULL | `v-vmgr-create-set-to-null-functional.spec.ts` | Set to null (VMGR-97, REQ-3.1.3.24): a Test variable of every type created null, stored as a plain null, null after a reload and in a run; in the Variable, Function local, Input and Output windows the ticked look, untick bringing back the Kind and value (a table stored with its column types), an emptied integer or float box ticking on blur, Set to null hidden while Kind is Expression or Template (VMGR-111), and a secret created null showing the null look, never the mask (a secret input forces the box, `aria-disabled`) |

## Running

Containerized only (see `tests/e2e/README.md`); the folder runs in the `functional-workflow`
project of `playwright.functional.config.ts`.
