# V-RC-FUNCTIONAL: Run-Current (in-memory body execution)

A dirty canvas runs its EXACT in-memory body, not the last-saved backend state
(REQ-3.2.1.1, REQ-3.2.1.2). No run-confirm modal.

## Prerequisites

- A running stack (the functional config seeds its own data via REST).

## Steps (per test)

1. **A - whole Test**: seed a Test with two enabled Logs; open it; right-click the
   second Log and Disable it; Run.
2. **B - drilled scope**: seed a local Function with two inner Logs; drill in via the
   dig-in chevron; disable an inner Log; Run Scope.
3. **C - in-Test edit mode**: seed a CLEAN published reference; open; enter edit mode
   via the kebab (client-side); Run.
4. **D - WARN**: seed a top-level edit-mode instance; open; Run by test id.

## Validation

- **A**: the kept line runs; the disabled line does NOT (proves the in-memory body ran).
- **B**: the run dispatches `scope_mode=function` AND an in-memory `workflow`; the kept
  inner line runs, the disabled inner line does NOT.
- **C**: the edit-mode WARN line surfaces (proves run-current threaded the in-memory edit
  state - a run of the clean on-disk ref would not warn).
- **D**: exactly one edit-mode WARN line is emitted.
- No test ever shows a "Save and Run" / run-confirm dialog.

# V-RC-VARIABLE-EDITS: a variable edited between block runs

A variable edited after a block run reaches the next Run Current. A value a block wrote, and a
Current-mode edit, still win over a later pencil edit until Reset or a full Run (REQ-3.2.1.5,
REQ-3.2.1.6, VMGR-19, VMGR-63). What a run made secret stays masked in the next block run
(REQ-3.1.3.5).

Spec: `v-rc-variable-edits-functional.spec.ts`. Fixtures: `fixture-variable-edits-port.json`,
`fixture-variable-edits-logs.json`, `fixture-variable-edits-secrets.json`.

## Prerequisites

- A running stack with the `http-echo` service (plain-HTTP health listener and the HTTPS
  `/secret-payload` endpoint). Hosts and ports come from `tests/e2e/helpers/config.ts`.
- Each test imports its fixture with `POST /tests`, checks `POST /tests/{id}/validate` returns
  zero errors, opens it in the Workbench and selects the environment.

## Steps (per test)

1. **Pencil edit after a run** (`port` fixture): add the integer variable `lport` in the
   Variable Manager without touching its value (the create window presets `0`); set the request URL to `f'http://<host>:{lport}/health'` in the
   HTTP block dialog; point the Variable Setter row at `lport` with the health port. Run
   Current on the request. Pencil-edit `lport` to the health port, Run Current. Pencil-edit
   to the closed port, Run Current. Run Current on the Setter, pencil-edit `lport` to `0`,
   Run Current on the request. Reset, Run Current on the request.
2. **Function body** (`logs` fixture): Run Current on `Top Port`; pencil-edit `lport` from
   `8080` to `9090`; drill into `Port Function`; Run Current on `Inner Port`.
3. **Expression, Current value** (`logs`): Run Current on `Print Url`; open `url`'s Edit window
   with the row pencil, switch the pill to Current, set the source to
   `'https://' + host + '/v2'`, Save; Run Current on `Print Url`.
4. **Expression after a Run Scope** (`logs`): drill into `Port Function`, Run Scope, go back to
   the Test; Current-mode edit of `url` as in step 3; Run Current on `Print Url`.
5. **Current mode after a pencil edit** (`logs`): Run Current on `Print Retries`; pencil-edit
   `retries` from `3` to `8`; open its watcher; Run Current on `Print Retries`.
6. **Secret output, plain variable** (`secrets`): console level DEBUG; Run Current on
   `Marked Request` (its body output is marked secret and bound to the plain variable
   `marked_body`); Run Current on `Print Marked`.
7. **Marked secret afterwards** (`secrets`): console level DEBUG; Run Current on
   `Filled Request` (fills the plain variable `filled_body`); tick Secret on the `body` output
   row of that block and Save; confirm the Save warning with "Make secret and save"; Run
   Current on `Print Filled`.
8. **Setter writes 0** (`logs`): Run Current on `Write Zero`, which writes `0` to the integer
   variable `count` that is declared with no value (it holds null).
9. **Edits staged before any run** (`logs`): add the secret variable `api_key`; set the
   `Print Staged` message to print it, the template `tpl` and the secret's tail; with no run
   yet, give `api_key` a new Current value and `tpl` the Current source `wss://{{ host }}` in
   their Edit windows; console
   level DEBUG; Run Current on `Print Staged`.

## Validation

- **1**: the row of `lport` reads `0`. First run: the block is `failed` and the console
  holds `Block 'Health Request' failed: URL port must be between 1 and 65535 (got
  'http://<host>:0/health')`. After the first edit: the block is `success`, the console holds
  `HTTP GET http://<host>:<health port>/health (timeout: ...)` and `HTTP 200 OK (...)`, and no
  port refusal. After the second edit: the block is `failed` with `Block 'Health Request'
  failed: [Errno 111] Connection refused`, and the request line names the closed port. After
  the Setter ran, the row shows the written port; with the definition edited to `0` the
  request still goes to the written port and passes. After Reset the port-0 refusal is back.
- **2**: the console holds `inner port=9090`, and neither `inner port=8080` nor the input's
  default `inner port=7070`.
- **3**: first `url=http://b`, then `url=https://b/v2` and no `url=http://b`.
- **4**: the Run Scope passes and prints `inner port=7070` (the optional input's default); the Current-mode Save answers 200,
  no `Current Value Not Saved` toast shows; the next block run prints `url=https://b/v2`.
- **5**: the watcher opens in Current mode and shows `8`; Initial shows `8`; the next
  block run prints `retries=8`.
- **6**: after each run no rendered console line and no copied log text holds the body token;
  the request's DEBUG `Outputs:` line holds `"body":"********"`; the Log prints
  `marked=********`; the row of `marked_body` and the session read show `********`.
- **7**: after the first run the request's DEBUG `Outputs:` line and the session read of
  `filled_body` hold the body token. The Save opens the warning naming `filled_body`; after
  "Make secret and save" the sheet closes and the row carries the SECRET badge. The Log prints `filled=********`; no rendered
  line and no copied text of that run holds the token; the row and the session read show
  `********`.
- **8**: the row of `count` reads `null` in the null look (italic, monospace, muted, not
  dimmed; VMGR-93) before the run and `0` after it; the session read returns `0`.
- **9**: the console holds `tok=******** tpl=wss://b tail=staged-222` (the tail proves the
  staged value ran; a sliced secret is readable by design); no rendered line and no copied
  text holds either full secret value; the row of `api_key` shows `********`.
