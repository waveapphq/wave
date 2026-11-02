# V-HTTP-01: HTTP Headers Editor - Everyday State + Guard Rails

Verify the HTTP headers editor: per-entry value kinds and their switch warning,
the Content-Type scaffold, the Auth generated row, key-policy guard rails, the
Code view grammar, and load-validation parity with node issue badges.

## Prerequisites

None. The spec self-seeds:

- one Test via `POST /tests` (everyday headers node, form-mode node, auth-on node)
- two intentionally invalid Tests via `POST /admin/bulk/tests` (bad header
  set; `artifact://` file source inside a Remote Execution body)

## Steps

1. Open the seeded test in `/workbench?editTest=<id>`
2. Double-click the HTTP node, open the Headers map editor from the field's
   expand ("Open editor for Headers")
3. Exercise the entry kinds and scaffolds, type the guard-rails header set,
   switch to Code view
4. Load the admin-bulk-seeded invalid tests and dismiss the validation dialog

## Validation

- **Editor note:** exact one-line copy, no Content-Type sentence
- **Kind toggles:** literal row unpressed; expression row pressed; every entry
  has its expand; {x} on an entry holding a value asks "Switch the field to a
  plain value?" / "Switch the field to an expression?" and Cancel keeps it
- **Scaffolds:** no "+ Auth"; "+ Content-Type" in every body mode
- **Guard rails:** offending keys aria-invalid, strip = exact first message +
  "(+1 more)" expander, Save disabled, 3 "Unsecured credential" advisories
- **Code view:** literal entries are quoted strings, expression entries a bare
  `{{ expr }}`; anything else blocks Save and locks the Visual switch
- **Load parity:** "Test Issues Found" dialog carries the verbatim messages;
  after dismissal the node badge tooltip carries the same messages; the Remote
  Execution body config lists only the file-body REMOTE_UNSUPPORTED message
  and paints no badge
