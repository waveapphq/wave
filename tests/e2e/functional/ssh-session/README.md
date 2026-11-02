# V-PLUGIN-SSH-SESSION-FUNCTIONAL: SSH Session Trio + Auth Matrix + Numeric Bounds

End-to-end proof that the SSH Session Open / Execute / Close plugins work against
real OpenSSH hosts (real-service harness, REQ-3.4.1.3 / REQ-5.1.5).

## Prerequisites

- The real-service stack must be running (`scripts/e2e-stack.sh up --wait`; started
  automatically by `playwright.functional.config.ts` webServer in host mode, by
  `scripts/e2e-targeted-local.sh` for targeted runs, and by `ci-playwright-local.sh`
  for full CI). See `tests/e2e/services/README.md` - user `wave`, password
  `wave-secret`, main host :9445, nested jump host reachable only in-stack.
- Strict host-key tests rely on WAVE's trusted SSH hosts list, never the
  account's `~/.ssh/known_hosts`. `setup/global-setup.ts` seeds it on every
  backend in both modes through `resetNetworkSettings`
  (`helpers/network-settings.ts`): the committed host key for :9445, a WRONG key
  for :9448, the host key for the tunnel far host `sshd` port 22, nothing for
  :9447. The auth spec calls the same helper before and after its test, so
  :9447 is untrusted when it runs.
- Fixtures are imported via `POST /tests` and validated via
  `POST /tests/{id}/validate?context=run` (zero errors) before the run. SSH hosts
  carry the `127.0.0.1` sentinel, rewritten by `injectServiceHost` per mode.

## Specs

### v-plugin-ssh-session-functional.spec.ts (`fixture.json`)

1. Import, validate, open in the workbench, select the shared E2E environment, Run.

- **Session outcome:** passed (the only node failure is caught by Try/Catch).
- **Open A (direct):** `A opened connected=True hop=1`, server banner (`SSH-2.0`).
- **Execute:** `A exec stdout=hello-from-a code=0`.
- **Non-zero exit:** real shell `echo failing with 3 >&2; exit 3` ->
  `A fail code=3 stderr=failing with 3` (exit returned, not raised).
- **Unknown command:** real shell 127 - `A 127 code=127` with `command not found`.
- **Chain (2 hops):** `B opened connected=True hop=2` through A to the nested
  host; `B exec stdout=hello-from-b-from-nested-host` proves the command really
  ran on `nested-host` (unreachable directly - see ssh-session-via-parent).
- **Cascade close + Connected flip:** closing A reports two `ssh_session_` ids and
  both bound Connected variables read `a_conn=False b_conn=False`.
- **Closed-session raise:** exec on the closed session is caught -
  `exec-after-close-caught` + `not found or already closed`.

### v-plugin-ssh-session-auth.spec.ts (`fixture-auth.json`)

Auth + host-key policy matrix in one run (the client private key is injected
from the committed `services/sshd/keys/client_ed25519` at import):

- **Password auth:** `auth-pw connected=True`.
- **Key auth:** `auth-key connected=True` (committed client keypair).
- **Strict + trusted correct key (:9445):** `strict-ok connected=True`.
- **Strict + wrong trusted key (:9448):** caught - `strict-wrong-caught conn=False`;
  the plugin's exact refusal `SSH host key verification failed for <host>:9448:
  the host offered a key that differs from the one in WAVE's trusted hosts list.
  Check Settings > Network > SSH Hosts` is the engine's caught line
  (`Try-path error caught: <refusal>`) and is in the bound error output
  (readable post-try/catch).
- **accept-new (:9447, untrusted):** `accept-new connected=True` - genuine first
  contact: before the run the list holds only the three stack hosts, after it
  also `<host>` port 9447 ED25519 with the host key's SHA256 fingerprint.
- **disabled (:9447):** `hkv-disabled connected=True`.

### v-plugin-ssh-bounds-functional.spec.ts (`fixture-bounds.json`, `fixture-bounds-stored.json`)

SSH numeric bounds (SSH-9, PING-17) on the field and when the block runs. No
server is written and no session connects; every Test the spec makes is deleted
in `afterAll`.

- **BND-1 (built through the UI):** an empty Test; SSH Session Open, Session Exec,
  Session Script and Tunnel Open dropped from the palette, their required rows
  filled in their sheets. Each literal outside its bound shows its message under
  the field as it is typed, the input is marked invalid, Save is disabled under
  `Save is disabled: the settings have errors`, the typed value is kept verbatim
  and no other row is flagged: Port 0 and 65536 (`Port must be between 1 and
  65535`), Connect Timeout 0 (`Connect Timeout must be at least 1`), Keep-Alive
  Interval -1 (`Keep-Alive Interval must be at least 0`), Keep-Alive Max Count 0
  (`Keep-Alive Max Count must be at least 1`), Session Exec and Session Script
  Timeout 0 (`Timeout must be at least 1`), Local Port -1 and 65536 (`Local Port
  must be between 0 and 65535`), Remote Port 0 and 65536 (`Remote Port must be
  between 1 and 65535`).
- **BND-2:** the edges are accepted with no message (Port 1 and 65535, Keep-Alive
  Interval 0, Local Port 0 and 65535, Remote Port 1 and 65535); the four sheets
  save and the Test reads back with the values as typed.
- **BND-3 (`fixture-bounds-stored.json`):** `POST /tests` refuses a Connect Timeout 0
  with `SETTING_BELOW_MINIMUM` "Setting 'connect_timeout' of block 'ssh-session-open' must
  be at least 1, got 0"; stored past the save (admin import), it paints the canvas
  alert badge with exactly `Connect Timeout must be at least 1` in its
  tooltip; the sheet's Save and the unsaved-changes question's Save stay shut and
  the stored Test keeps its old values until the value is back inside the bound;
  then the sheet saves, the badge clears and the Test reads back fixed.
- **BND-4 (`fixture-bounds.json`):** the out-of-range values as expressions (the
  form does not check them, so the canvas flags nothing), each block in its own
  Try/Catch; the run passes and each Try/Catch holds its backend text exactly:
  `Parameter 'port' must be between 1 and 65535` (Port 70000), `Connect timeout
  must be at least 1`, `Keep-alive interval must be 0 or more` (-1), `Keep-alive
  max count must be at least 1`, `Timeout must be at least 1` (Session Exec and
  Session Script), `Parameter 'local_port' must be between 0 and 65535` (70000),
  `Parameter 'remote_port' must be between 1 and 65535` (0). Session Exec, Script
  and Tunnel Open name a session that does not exist, so the bound text (not
  `not found or already closed`) proves the refusal comes before any session is
  touched; no console line reads `Connecting to ...`.
