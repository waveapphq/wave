# Shell Script / Python marked-output canary - functional E2E

Proves that a marked-secret output of a Shell Script block or a Python block leaks
nowhere. The Shell Script marks its `stdout` and one variable export secret, the
Python block marks one variable export secret, and each marked value reads the mask
on every output surface while the non-secret sibling outputs stay visible.

## Pre-requisites
- E2E stacks up; shared env `E2E Execution Env`. `/bin/bash` and python3 available on
  the backend host or container (the ubuntu:22.04 image ships both).

## Execution
Imports `fixture.json` and runs it. A leading Delay holds the run so the WS collector
subscribes before any output flows. The Shell Script (Script Type Source) sets
`SHELL_TOKEN` and `SHELL_PROOF` and echoes a line; its exports are bound to the string
variables `shell_token` and `shell_proof`, its stdout to `shell_stdout`, and stdout plus
`SHELL_TOKEN` are marked secret. A Log prints `shell_token`. The Python block (Script Type Source) sets
`py_token` and `py_proof` and exports both through `script_variables`; `py_token` is
marked secret, and a Log prints the bound `py_token_var`.
The bookend Log prints a non-secret variable and `shell-python-secrets-done`.

## Validation
- The run passes. The non-secret `SHELL_PROOF` export binds `shell-ran-42` as a plain
  value in the session variables, and both proofs (`shell-ran-42`, `py-ran-42`) appear
  in their block's DEBUG Outputs echo, so the scripts really ran.
- The marked Shell Script stdout, the marked `SHELL_TOKEN` export and the marked `py_token`
  export all read `********` in the session variables, the INFO console lines and the
  DEBUG Outputs echo; no canary sits on those surfaces.
- The INFO console reads `shell-out=******** shell-done`, `py-out=******** py-done` and
  the cleartext bookend `plain=plain-visible-sp-0000 shell-python-secrets-done`.
- No raw pre-masking output dump (`Shell Script output:`, `Extracted SHELL_TOKEN=`,
  `Extracted py_token=`) appears on the console or in the WS stream.
- The script source and the Python code contain the canary strings as the user's own
  code and ride the DEBUG Inputs echo, which is not a masked-value surface, so the leak
  sweeps cover the output surfaces only.
