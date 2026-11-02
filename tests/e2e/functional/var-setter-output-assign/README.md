# V-VARSET-OUTPUT-SECRET: a Variable Setter Secret row makes the Function output it writes secret

`v-varset-output-secret-functional.spec.ts` - ticking Secret on a Variable Setter row that writes a declared
Function output asks first, then makes the output secret everywhere: its row, the saved Function and the run
(SECUI-12, REQ-3.1.3.5, REQ-3.1.2.9).

## Prerequisites

- A running stack and the shared E2E environment (`ensureEnvironment`).
- No fixture file: the spec seeds via `POST /tests` a Local Function `Secret_Out_Fn` declaring a plain string
  output `res`, whose body is a Variable Setter row writing a literal into `res` and then a Log of `res`; the Test
  validates with zero errors.

## Steps

1. Open the Test, pick the shared environment and drill into `Secret_Out_Fn`.
2. Read the output row `res` in the Variable Manager.
3. Open the Setter's sheet, tick Secret on its row and Save; answer the make-secret warning with
   "Make secret and save".
4. Read the output row `res` again.
5. Save the Test from the toolbar and read the stored Test.
6. Go back to the root, run the Test and read the console.

## Validation

- Before the change the output row `res` carries OUT and no SECRET badge.
- The Block Save opens the make-secret warning naming `res`; "Make secret and save" closes the sheet.
- The output row `res` then carries the SECRET badge and its value is masked.
- The stored Function declares `res` secret, and the Setter keeps its Secret row with a sealed literal.
- The run prints the Log of `res` as `********`; the literal appears in no console line.
