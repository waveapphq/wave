# Secret Function Parameters

Verify that a Function input or output marked secret acts as a block's secret field
(REQ-3.1.2.9, VMGR-103, VMGR-104, FNCFG-7, SECUI-10, SECUI-11).

Specs:

| V-TEST ID | Spec | What it proves |
|-----------|------|----------------|
| V-FN-SECRET-INPUT | `v-fn-secret-input-functional.spec.ts` | A secret input has no default (the window forces Set to null and says why), excludes Create enum, is a credential field on the Function Block (a literal typed there is sealed at rest), masks whatever the Function Block passes in on every run surface, never makes the Test's plain variable secret, and a recipe giving it a default is refused (`Secret input '<input>' cannot have a default`) |
| V-FN-SECRET-OUTPUT | `v-fn-secret-output-functional.spec.ts` | A secret output seeds Secret ticked on the Function Block (the author may untick it), a new variable typed into Assign to is created secret, and its default is sealed at rest and masked in the Variable Manager, the inspect window, the Function Block, MCP reads, every export mode and a backup |

## Prerequisites

- Backend and frontend of the run's own stack (the Playwright fixtures pick the ports).
- No seed script: each test creates its own `zz-` Test (`POST /tests`) and, for the library
  cases, its own library Function (`POST /functions`), and deletes them afterwards (Functions
  with `cascade=true`).
- The MCP tests turn the listener on until restart and reset the MCP settings afterwards.

## Steps

1. Input window: Add > Input parameter, tick Mark as secret (with and without Required), then
   Create enum against Mark as secret on a String input.
2. Function Block (Local and library Function): type a literal into the secret input, or give
   it a plain or a secret Test variable by {x}; Save and run.
3. Recipe: `validate_recipe` and `create_test_from_recipe` with and without a default on a
   secret input.
4. Output window: Add > Output parameter `out_tok`, a default holding a per-run canary, Mark as
   secret, Create, Save; or publish such a Function to the library.
5. Function Block outputs table: untick Secret and bind a new variable, or bind a new variable
   on the ticked row; Save and run.
6. Read the stored Test and library Function, the exports in each Secret values mode, a backup
   archive and the MCP reads.

## Validation

- The secret input stores no default; Set to null is ticked and locked (`aria-disabled`); the
  row's tooltip reads "A secret input has no default: the Function Block gives the value."
- A literal typed on the Function Block: no store file holds it, `GET /tests` returns it sealed
  (`wave:enc:v1:`, as for a Block password), the row reopens masked, and the run console prints
  `in=******** tail=<real tail>`.
- A plain variable given to the secret input: masked on the console, the session read, the run
  report and the input row while drilled; it stays plain (stored without `secret`, no SECRET
  badge).
- A secret output: Secret opens ticked; an untick is stored (`outputSecretFields: []`) and the
  bound variable reads its plain value after the run, also when it shares the output's name and
  in a tracked run; a new variable on the ticked row is stored `secret: true` and reads
  `********`; a Save that leaves Secret as declared stores no `outputSecretFields`.
- The secret output default: no store file holds it; it reads `********` in the Variable
  Manager, never shows in the inspect window or the Function Block, is left out of the recipe
  readback and masked by `get_function`; exports write `********` (Mask), an envelope (Keep
  encrypted) or the value (Decrypt); a backup member holds the mask or an envelope.
