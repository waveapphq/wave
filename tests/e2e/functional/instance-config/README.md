# Instance config functional tests

This WAVE's own settings live in its config file (REQ-4.7.15 to REQ-4.7.18, REQ-5.2.7.1). Three specs share this folder.

## V-INSTANCE-CONFIG-STARTUP

`v-instance-config-startup.spec.ts`: WAVE starts from one config file, refuses a file it
cannot use, and keeps every saved setting in that file across a restart.

### Prerequisites

- None on the stack. Each test starts its own backend with `spawnBackend`
  (`helpers/spawn-backend.ts`): `poetry run uvicorn` from `backend/` on a free port, with
  `WAVE_CONFIG_FILE` naming `config/config.yaml` in a new folder under the temp folder and
  `WAVE_ADMIN_ALLOWED=true`. Unless the test writes its own text, the file is a copy of
  `backend/config/config.example.yaml` with a throwaway key the helper writes into
  `security.secret_key` (a new random key each run), so the data folder is `data` in the same
  new folder. The example as shipped has an empty key; a test that needs it exactly as shipped
  passes `SHIPPED_EXAMPLE_CONFIG_TEXT`.
- No `WAVE_*` variable of the stack reaches a spawned backend; a test adds the ones it needs.
- `removeSpawnedBackends` runs after every test: it stops the backends and removes their
  folders. The stack's backend, config file and data folder are never used.

### Steps

1. **STARTUP-1 to STARTUP-5:** start a backend on a config file it must refuse: a file that
   does not exist, a relative `WAVE_CONFIG_FILE`, a file holding a YAML list, a file that does
   not parse, `mcp.port: 80`, `mcp.auth_password: plain`, and `WAVE_LOG_LEVEL=verbose` on a
   valid file.
2. **STARTUP-6:** start a backend on the example with a throwaway key.
3. **STARTUP-7:** start one with `WAVE_ENV=production` set.
4. **STARTUP-8:** save log level DEBUG, `run_output: true`, MCP port 8799 with authentication
   and a password, a schedule turned on with the cron `0 3 1 1 *` and its own save folder,
   SSH default block action Strict and certificate source `host` (every value differs from
   its default); stop the backend; start one on the same file. The WAVE host needs a
   certificate store for `host`; the e2e image holds `/etc/ssl/certs/ca-certificates.crt`.
5. **STARTUP-9:** start with `WAVE_LOG_LEVEL=WARN` on a file holding level INFO, save level
   DEBUG, stop, start again with the same variable.
6. **STARTUP-10:** start on the example with a throwaway key, and on a copy without the
   `network` and `backup` sections.
7. **STARTUP-11:** start on a copy with an unknown key inside `mcp` and inside
   `network.ssh_hosts` and an unknown top-level section, then save log level DEBUG.
8. **STARTUP-12:** turn a schedule on, then save `{enabled: false}`.
9. **STARTUP-13 to STARTUP-15:** start a backend on a secret encryption key it must refuse: no
   `secret_key` line in `security` with no `WAVE_SECRET_KEY`; the example exactly as shipped,
   whose `security.secret_key` is empty (STARTUP-13b); a `WAVE_SECRET_KEY` that is not base64,
   then one that is 16 bytes of base64; and another 32-byte key on the config file and data
   folder of a backend that ran and was stopped.
10. **STARTUP-16 to STARTUP-18:** start a backend on a data folder it must refuse: a config
    file with no `storage` section and no `WAVE_STORAGE_BASE_PATH`; `WAVE_STORAGE_BASE_PATH=data`;
    and `storage.base_path: config.yaml/data`, which puts the data folder under the config file.

### Validation

- **Refused starts (STARTUP-1 to 5):** the process exits with code 1 and its output holds one
  FATAL line with the exact text: `Config file not found: <path> (set WAVE_CONFIG_FILE to use
  another file)`, `WAVE_CONFIG_FILE must be an absolute path: <value>`, `Config file <path>
  does not hold a YAML mapping`, `Config file <path> cannot be read: <the parser's reason>`,
  `Config file <path>: mcp.port must be a whole number from 1024 to 65535`, `Config file
  <path>: mcp.auth_password must be set from Settings > MCP Server, where it is stored
  sealed`, `WAVE_LOG_LEVEL must be one of DEBUG, INFO, WARN, ERROR, FATAL: verbose`.
- **STARTUP-6:** `/health` answers 200; the output holds `Config file: <path>` before
  `Data folder: <path>`; `GET /server/status` names both; the data folder exists; the file
  still equals the text it was written with.
- **STARTUP-7:** the backend runs on the named file and at the file's level, INFO.
- **STARTUP-8:** the file starts on `public_source: builtin`; after the saves it holds each
  saved value, `public_source: host` under `network.certificates` among them. After the
  restart every route reads the saved value back (certificate source `host`),
  `auth_password_set` is true, the file still holds each value, its `auth_password` is a
  `wave:enc:v1:` value and the password itself is nowhere in the file. The restarted
  backend's output holds `Periodic backup scheduler task created` and `Next periodic backup
  at <next run> (in <n> seconds)`.
- **STARTUP-9:** the level in force is WARN at the start, DEBUG right after the save (the
  file holds `level: DEBUG`), and WARN again after the restart while the file still holds
  DEBUG.
- **STARTUP-10:** on both files the schedule answers every backup entity type in sorted
  order and the save folder `~/wave-backups`, and the SSH policy answers default block
  action `disabled`.
- **STARTUP-11:** the backend starts and answers its defaults; after the save the file
  equals the text it started on with only `level: INFO` changed to `level: DEBUG`.
- **STARTUP-12:** after the second save the output holds `Periodic backup scheduler stopped`
  and `No active periodic backup schedule`, and the schedule answers off with an empty cron
  and no next run.
- **Refused keys (STARTUP-13 to 15):** the process exits with code 1 and its output holds one
  FATAL line: exactly `No secret encryption key configured: make one with 'poetry run
  wave-new-secret-key' in the backend folder, then set it as security.secret_key in the config
  file or as the WAVE_SECRET_KEY environment variable` (no key line, and the example as
  shipped); exactly `Secret
  encryption key must be a base64-encoded 32-byte value. Check WAVE_SECRET_KEY /
  security.secret_key.` (both malformed keys); a line holding `does not decrypt existing sealed
  data` (another key, after the first start left `secret_key_sentinel.yaml` in the data folder).
- **Refused data folders (STARTUP-16 to 18):** the process exits with code 1 and its output
  holds one FATAL line: exactly `Data folder not set: add storage.base_path to the config file or
  set WAVE_STORAGE_BASE_PATH`, and no data folder is made; exactly `WAVE_STORAGE_BASE_PATH must
  be an absolute path: data`; `Data folder <config file>/data cannot be created: <the system's
  reason>`, and the config file is still a file.

## V-INSTANCE-CONFIG-FUNCTIONAL

Spec: `v-instance-config-functional.spec.ts`. Settings > General saves the log level and the secret
reveal flags into the stack's own config file, the Time Zone into the browser, and nothing before
Save (REQ-4.7.15 to REQ-4.7.18, REQ-3.1.3.17; SETTINGS-14, SETTINGS-18, WSRV-11, NET-1).

### Prerequisites

- The standard functional stack: one backend with its own config file (a copy of
  `backend/config/config.example.yaml` with a throwaway key the harness writes into it) and data
  folder, and the frontend.
- The spec reads the config file path from `GET /server/status` (`config_file`) and reads, edits and
  changes the mode of that file on disk. It never touches `backend/config/config.yaml`.
- The admin API is on (`WAVE_ADMIN_ALLOWED=true`).
- Fixture `fixture-secret-run.json`: a Delay, a Log block on "Use system setting" that prints the
  secret variable `cfg_token`, and a marker Log block.
- After every test the spec puts the four reveal flags back to off and the log level back to the
  level found at the start (both through the API) and removes the marker it wrote into the file.

### Steps

1. Open Settings > WAVE Server and read the Config file row; press its copy button.
2. Open Settings > General. Stage Log Level DEBUG, "Reveal secrets in run output" and Time Zone UTC,
   then Cancel.
3. Stage the same three values and Save. Read the config file and open Settings > About.
4. Write a comment line and an `e2e_marker: {note: kept}` section into the config file, then save
   another reveal switch from General.
5. Make the config file read-only (mode 0444), stage a level and a switch, and Save. Put the mode
   back and Save again.
6. Save "Reveal secrets in run output" on, import the fixture and run it; save it off and run it
   again.
7. Save Log Level DEBUG, then ERROR, reloading the page after each Save.
8. With a staged level, leave General three ways (another Settings section, the app sidebar, browser
   Back); answer the dialog with Cancel, then Discard, then Save.
9. With the config file read-only, answer the dialog with Save.
10. Open General with `GET /admin/log-level` held open, then let it answer.
11. Reach the two selects by their labels and stage a value through each.
12. Open the fixture on the canvas, go to Settings through the sidebar, save "Reveal test variables"
    on, and go back to the workbench through the sidebar; then the same with the switch off.
13. With the server holding `test_variables: true`, load the workbench while the app's first
    `GET /admin/secret-masking` answers 500; then open General and the workbench through the sidebar.

### Validation

- **Config file row:** the path is absolute, sits beside the stack's data folder and is not
  `backend/config/config.yaml`; the row shows exactly that path with the lock icon; the copy button
  puts it on the clipboard.
- **Staged, not saved:** Cancel and Save are disabled on a clean page and enabled after a change; no
  write request leaves the page, `GET /admin/log-level`, `GET /admin/secret-masking` and the file
  are unchanged, `wave.timezone` is not set, and the Released date in another tab is unchanged;
  Cancel restores the saved values.
- **Save:** `GET /admin/log-level` reads DEBUG and the select shows it; the file holds
  `level: DEBUG` and `run_output: true`; only those two lines differ; every comment line of the
  example file is still there; the file mode is the same; `wave.timezone` is `utc` and the Released
  date ends in `UTC`.
- **Hand edit:** after the later Save the comment line and the `e2e_marker: {note: kept}` line are
  unchanged and only the saved line differs.
- **Read-only file:** the toast "Could Not Save General Settings" reads exactly
  `Settings cannot be saved: the config file {path} is read-only`; the staged values stay; both GETs
  and the file are unchanged; the mode is put back and the same values then save.
- **Run output reveal:** the console line reads `CFG:wave-cfg-s3cr3t-7731` with the reveal saved on
  and `CFG:********` with it saved off, and the secret is nowhere in that console.
- **Level in force:** each saved level is what `GET /admin/log-level` reads at once and what the
  reloaded page shows.
- **Leaving:** each way of leaving opens "Unsaved changes" with Cancel, Discard and Save while
  General stays; Cancel keeps the staged level; Discard leaves and the saved level shows on return;
  Save writes `level:` into the file and leaves. With the file read-only the dialog's Save shows the
  refusal toast, the dialog closes, General stays with the staged level and nothing is written.
- **Loading:** while the read is open there is one skeleton row for Log Level and four for Secret
  Masking, no select, no switch, and no Cancel or Save on the Logging heading line; they all appear
  once it answers.
- **Labels:** "Log Level" names `log-level-select` and "Time Zone" names `timezone-select`.
- **Saved flag reaches the open app:** the Variable Manager shows the secret's value after "Reveal
  test variables" is saved on and masks it after it is saved off, with no reload in between.
- **General brings the app in line:** the toast "Could Not Load Masking Settings" carries the
  reason and the Variable Manager masks the secret; after General is opened it shows the value.

## V-MCP-SETTINGS-FUNCTIONAL

`v-mcp-settings-functional.spec.ts`: Settings > MCP Server stages every change, saves it into
the stack's config file, and starts, moves and stops the real MCP endpoint.

### Prerequisites

- The stack's own backend and config file (`GET /server/status` `config_file`); no fixture.
- Before every test the MCP settings are stored through `PUT /mcp/settings`: the defaults with
  the port `BACKEND_PORT + 781`. The tests also use `+ 791` and `+ 801`; no other spec binds
  these ports.
- After every test `resetMcpSettings` (`helpers/mcp.ts`) stores the defaults, clears the stored
  password and stops the endpoint.
- "The port answers" means a real MCP `initialize` sent to `http://127.0.0.1:<port>/mcp` is
  answered by the server named `WAVE`; "the port refuses" means the connection is refused
  (`askMcpEndpoint`).
- Tests 7a to 7d start from a running endpoint with authentication and a stored password, and
  tests 7e and 7f from a stopped one with the same login, all stored through
  `PUT /mcp/settings`. "The stored password" is that passphrase.
- Test 14 keeps one MCP client connected: `connectMcpClient` runs the SDK client with
  `poetry run python` from `backend/` until the test ends it.

### Steps

1. **1:** open Settings > MCP Server on a stopped endpoint; type port 80; click Cancel.
2. **1a:** keep a handle to the message region of the Port row; type port 80; watch the region
   with a `MutationObserver` and type two more digits in front (`0080`); type a valid port. Read
   the name of each switch and click the row label "Require authentication".
3. **2:** turn on Enable MCP server; click Save.
4. **3:** turn on Enable MCP server, then Enable until restart; click Save.
5. **4:** on a running endpoint type another port; click Save; Cancel in the confirmation;
   click Save again and `Save and restart`.
6. **5:** on a stopped endpoint choose Bind scope Network; click Save; Cancel in the
   confirmation; Save again and confirm with Save. Then on a running endpoint choose Network,
   click Save and `Save and restart`.
7. **6:** turn on Require authentication, type a username, type `password` in Password, then a
   long passphrase, then clear the field; type `password` again and click Save.
8. **7:** turn on Enable MCP server and Require authentication, type a username and a
   passphrase; click Save; reload the page.
9. **7a:** click the masked Password and Cancel in "Edit Protected Value?"; click it again and
   "Delete & Edit"; type another passphrase; click Save and `Save and restart`.
10. **7b:** click the masked Password and "Delete & Edit"; turn off Require authentication;
    click Save and `Save and restart`; reload and turn Require authentication on.
11. **7c:** click the masked Password and "Delete & Edit"; type nothing; click Save and
    `Save and restart`.
12. **7d:** click the masked Password and "Delete & Edit"; click Cancel on the heading line.
    Again "Delete & Edit", type another passphrase, wait for its score, click Cancel on the
    heading line.
13. **7e:** keyboard only. Focus Username and press Tab, then Enter. Press Enter on Cancel.
    Press Enter, then Escape. Press Enter, Tab to "Delete & Edit", Enter, and type.
14. **7f:** click into Username, send a click to the masked Password that leaves focus in
    Username (`dispatchEvent('click')`, what a browser that does not focus a clicked button
    does), and click Cancel. Do the same again, click "Delete & Edit" and type.
15. **8:** on a running endpoint turn off Enable MCP server; click Save.
16. **9:** on a running endpoint type another port, make the config file read-only (mode 0444,
    put back when the step ends), click Save and `Save and restart`.
17. **10:** `POST /api/v1/system/password-strength` with `password`, an empty password, a
    passphrase, and a password built from a username with and without that username in
    `user_inputs`; then type that username and that password in the page.
18. **10a:** on a running endpoint type another port and click About in the Settings section
    list; click Save in "Unsaved changes" and `Save and restart`. Come back, type a third port,
    click About, Save, then Cancel in the confirmation. Click About again and Discard.
19. **11:** store a running endpoint with authentication and a password; call
    `resetMcpSettings`.
20. **12:** open the page with `GET /mcp/settings` answered 500 with a reason; remove the route
    and click Try Again.
21. **13:** on a running endpoint answer `GET /mcp/status` with 500 and a reason; stop the
    endpoint through the API; remove the route.
22. **14:** with one MCP client connected, answer `DELETE /mcp/sessions/{id}` with 500 and a
    reason and click Disconnect; remove the route and click Disconnect again.

### Validation

- **1:** Cancel, then Save, sit on the "MCP Server" heading line and are disabled. Enablement
  and Endpoint are each a heading, one subtitle (exact text) and their rows; Sessions comes
  right after Endpoint. Port 80 shows `Port must be between 1024 and 65535`, Save stays
  disabled, Cancel is enabled; Cancel shows the saved port again and the file is unchanged.
- **1a:** before any message the Port row holds an empty region with `aria-live="polite"`. With
  port 80 that same node holds `Port must be between 1024 and 65535`; the Port field has
  `aria-invalid="true"`, its `aria-describedby` names the message and its description reads the
  help line and the message; the page holds no `alert`. While `0080` is typed the observer
  records no change in the region; with a valid port it records one, the region is empty and
  the field is no longer invalid. Each switch has its row label as its name and no `aria-label`;
  a click on the row label "Require authentication" turns the switch on and enables Username.
- **2:** before Save the status reads Stopped, `GET /mcp/settings` reads `enabled: false` and
  the port refuses. Save sends the write at once with no confirmation; the status reads
  Running, the file holds `enabled: true` and the port answers.
- **3:** the second switch turns the first one off. After Save `until_restart_active` is true,
  `enabled` is false in the API and in the file, and the port answers.
- **4:** the confirmation is titled `Save MCP server changes?`, holds the restart sentence and
  the buttons Cancel and `Save and restart`. After Cancel the staged port stays and the saved
  port still answers. After `Save and restart` the new port answers, the old one refuses and
  the file holds the new port.
- **5:** stopped: the confirmation holds the exposure warning alone with Cancel and Save;
  Cancel writes nothing; Save writes `bind: network`. Running: the warning sits with the
  restart sentence and the confirm reads `Save and restart`; after it the status reads bind
  `network` and the port answers.
- **6:** `password` shows four empty segments and the word `Very weak`; the passphrase shows
  four filled segments and `Very strong`; the word is the only text under the input; the score
  is named `Password strength` with the word as its value text; clearing the field hides it.
  Save is enabled with the weak password and the Save is stored (`auth_password_set: true`);
  the Password row then shows the masked field.
- **7:** the file holds `auth_enabled: true`, the username and an `auth_password` that is a
  `wave:enc:v1:` value; the passphrase is nowhere in the file or in `GET /mcp/settings`. The
  Password row shows the button "Password: Edit protected value", which the label "Password" points at,
  with no input and nothing under it, also after a reload. The endpoint answers 401 without
  credentials or with a wrong password, and 200 with the right ones.
- **7a:** the question is titled "Edit Protected Value?", holds its warning and the buttons
  Cancel and "Delete & Edit". After Cancel the masked field stays and the page is clean. After
  "Delete & Edit" the row shows an empty password input, Cancel and Save are enabled, no
  `PUT /mcp/settings` left the page, the file's `auth_password` line is unchanged and the
  stored password still opens the endpoint. `Save and restart` sends `auth_password` alone;
  the masked field is back, the file holds another `wave:enc:v1:` value and never the new
  passphrase, the endpoint answers 401 with the old password and 200 with the new one.
- **7b:** before Save the API still reads `auth_enabled: true` and `auth_password_set: true`
  and the endpoint answers 401. The write carries exactly `auth_enabled: false` and
  `auth_password: ""`; after it the file holds `auth_enabled: false`, an empty `auth_password`
  and no `wave:enc:` value, `auth_password_set` is false and the endpoint answers 200 with no
  credentials. After a reload, Require authentication turned on shows an empty, enabled
  password input and no masked field.
- **7c:** the write carries `auth_password: ""` alone and answers 400; the toast is titled
  "Could Not Save MCP Server" and reads exactly `Password is required when authentication is
  enabled`. The empty input stays, Cancel and Save stay enabled, the file is byte for byte
  unchanged, and the endpoint still answers 401 without credentials and 200 with the stored
  ones.
- **7d:** after each Cancel the button "Password: Edit protected value" is back in
  `mcp-auth-password-row`, `#mcp-password-strength` holds nothing, and Cancel and Save are
  disabled. No `PUT /mcp/settings` left the page, the file is unchanged, the stored password
  opens the endpoint and the typed one is refused.
- **7e:** Tab from Username puts focus on the masked field and Enter opens the question. After
  Cancel and after Escape `document.activeElement` is the masked field (the next Enter opens
  the question from it). After "Delete & Edit" it is the empty Password input, and the typed
  keys are its value.
- **7f:** after Cancel focus is on the masked field. After "Delete & Edit" focus is in the
  Password input, the typed keys are its value and Username still holds the saved username.
- **8:** before Save the status reads Running and the port answers. Save sends the write at
  once with no confirmation; the status reads Stopped, the file holds `enabled: false` and
  the port refuses.
- **9:** the write answers 500; the toast is titled "Could Not Save MCP Server" and reads
  exactly `Settings cannot be saved: the config file <path> is read-only`. The staged port
  stays, the file is byte for byte unchanged, the saved port still answers and the new one
  refuses.
- **10:** the answer's `data` is exactly `score` and `label` (`0`, `Very weak` for `password`
  and for an empty password) with `Cache-Control: no-store`. The password built from the
  username scores lower with the username in `user_inputs`; the page sends the typed username
  and shows that lower score.
- **10a:** each click on About shows "Unsaved changes" (Cancel, Discard, Save) and stays on
  MCP Server. Save closes it and opens `Save MCP server changes?`; `Save and restart` saves,
  arrives on About and the new port answers. With the confirmation canceled the page stays on
  MCP Server with the staged port and nothing is saved. Discard arrives on About, nothing is
  saved, and the page shows the saved port when reopened.
- **11:** `GET /mcp/settings` reads the defaults with `auth_password_set: false`; the file's
  `mcp` section holds the defaults and no `wave:enc:` value; the port refuses.
- **12:** the page shows exactly the reason and Try Again, and the heading line has no Cancel
  or Save. After Try Again the status bar, Enablement, Endpoint and the saved port show, with
  Cancel and Save disabled.
- **13:** `mcp-status-stale` reads `<reason> (showing the last known state)`; the status bar
  keeps Running and its address and both groups stay, also after the endpoint stopped. After
  the route is removed the line goes and the status reads Stopped.
- **14:** the refused Disconnect shows the toast "Could Not Disconnect Session" with the
  reason; the row stays and the session still answers. Disconnect answers 204, the row goes,
  the list reads "No connected clients.", `GET /mcp/status` lists no session and the endpoint
  answers that session with 404 `Session terminated`.
