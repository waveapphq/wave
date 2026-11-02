# V-FN-INPUT-COMPUTED-BINDING: a Function input bound to a computed variable

Verify that a Function input bound to an expression or a template variable receives the
variable's evaluated value, not its name: in a full run where no block read the variable
before the Function, and at the start of a Run Current inside the Function after the
variable it reads was edited.

Spec: `v-fn-input-computed-binding-functional.spec.ts`. Fixture:
`computed-binding-fixture.json`. Shared steps: `../fn-local-vars-runtime/fn-adhoc-drive.ts`.

## Prerequisites

- Backend and frontend of the run's own stack (the Playwright fixtures pick the ports).
- The shared E2E execution environment (created on demand).
- No seed script: each test imports the fixture through `POST /tests` under its own name,
  checks that it validates with zero errors, and deletes it afterwards.

The fixture declares `port = 8080`, the expression `expr_url` and the template `tmpl_url`,
which both read `port`. The local Function `Reads_Expression` binds its input to `expr_url`
and prints `fn-expr:<input>`; `Reads_Template` binds its input to `tmpl_url` and prints
`fn-tmpl:<input>`. The Log `Outer Read` comes after both and prints
`outer-read:<expr_url>|<tmpl_url>`. No request is sent: the URLs are only printed.

## Steps

1. **Full run** - open the Test, pick the environment, Run.
2. **Block run in the Function after an edit** - open the Test, pick the environment, Run
   Current on `Outer Read` from its kebab, change `port` to 9090 with the row's pencil, open
   `Reads_Expression` and Run Current on its Log, go back to the Test canvas, open
   `Reads_Template` and Run Current on its Log. Neither Function has run in the session
   before its Run Current: a Function that already ran keeps the inputs its last run left.

## Validation

- **Step 1:** the `fn-` lines are exactly `fn-expr:http://api.example:8080/expression` and
  `fn-tmpl:http://api.example:8080/template`, in that order, and `Outer Read` prints
  `outer-read:http://api.example:8080/expression|http://api.example:8080/template`. No line carries
  `expr_url` or `tmpl_url` as text.
- **Step 2:** `Outer Read` prints the two results for port 8080; after the edit the only
  `fn-expr:` line is `fn-expr:http://api.example:9090/expression` and the only `fn-tmpl:` line is
  `fn-tmpl:http://api.example:9090/template`.
