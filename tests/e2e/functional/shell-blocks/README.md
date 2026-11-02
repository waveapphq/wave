# Shell Blocks: Shell Script and Shell Exec - functional E2E

End-to-end proof that the Shell Script and Shell Exec blocks work the way an
author sees them: arguments, input variables, typed and secret variable exports,
exit codes, the three ways WAVE stops a script (timeout, Stop, a pattern match)
and the rule that a stop ends the whole process tree, Log Output, Working
Directory and Browse, the two `WAVE_` directories, the config sheet rules, and a
Stop or a dropped session during a remote block (REQ-3.4.1.1, REQ-3.4.1.18;
SHRUN-1 to SHRUN-19).

Every spec imports its own Test from a JSON fixture in this folder. Each fixture
carries the placeholder `__TOKEN__`, which the spec replaces with a fresh token
(`sh` plus 8 hex characters, `newToken` and `withToken` in `shell-helpers.ts`),
and ends with a bookend Log `SH-<n>-done-__TOKEN__`; the host probe fixture
used by SH-17 and SH-18 (`fixture-host-probe.json`) names its bookend
`SH-17-probe-done-__TOKEN__`. Every file a script writes
goes under `$WAVE_ARTIFACTS_DIR/sh-<n>-<token>/`, every background process a
spec starts is proven gone by that spec's own tree probe
(`treeProbeCommand` / `pairTreeProbeCommand`), stdout and stderr are compared
with one trailing newline removed (`stripOneNewline`), and `afterAll` deletes
the Test. A script never contains the literal text an assertion looks for; it
builds it from parts (`P=qu; echo "${P}iet-<token>"`), because the DEBUG Inputs
echo carries the source. The exception is the SH-10 pattern scripts in
`fixture-pattern.json`, which print the matched line as is; that is safe because
those assertions compare whole console messages, not substrings.

## Prerequisites

- Backend and frontend running on the functional-stack ports, and the shared
  execution environment (`ensureEnvironment` creates it if absent).
- `/bin/sh` (dash) and `/bin/bash` on the machine the backend runs on. The E2E
  image (Ubuntu 22.04) carries both.
- The E2E backend runs as the non-root `ciuser` (`scripts/Containerfile.e2e`).
  SH-13 relies on it: a script's write into its own Test Data must fail with
  "Permission denied".
- The backend is started with `WAVE_CONFIG_FILE`, `WAVE_ADMIN_ALLOWED` and
  `WAVE_STORAGE_BASE_PATH` set, as the functional stack does. SH-14 checks that
  they reach the script.
- The real-service stack, for three cases only (see `tests/e2e/services/README.md`):
  - `sshd` - the shared OpenSSH host, used by the SH-12 remote-body run leg,
    SH-17 and SH-18, connection-scoped. SH-18 writes one per-run file,
    `/tmp/sh-18-<token>.pid`, the suite's only remote write.
  - `http-target` - SH-17 and SH-18 hold a remote request open against
    `https://http-target:9443/delay/60` (self-signed, `verify_ssl` false).

  ```bash
  ./scripts/e2e-stack.sh up --wait sshd http-target
  ```

- SH-17 and SH-18 share the `sshd` host with every other suite that opens a
  Remote Execution worker, so they judge only this run's own worker pids; the
  host-wide worker count is a non-vacuity check and is never asserted as zero.

## v-plugin-shell-script-arguments-functional.spec.ts (SH-1)

Steps:
1. Import `fixture-arguments.json`: Shell Script `sh-args` runs
   `echo "$1|$2|$3"; echo "n=$#"` with the arguments `one`, `two words` and the
   expression `arg3` (variable `arg3` = "three"), stdout -> `args_out`.
2. Open `sh-args`, open Arguments from its expand (the shared list editor), press
   "Move argument $3 up", then "Move argument $1 down", save the editor.
3. Save the config and the workbench, then run.

Validation:
- The line reads `["one", "two words", {{ arg3 }}]` before the moves; the items read
  `$1` `arg3` (expression), `$2` `one`, `$3` `two words`.
- `args_out` lines are exactly `three|one|two words` and `n=3`.
- The persisted node holds `arguments` `[{value: "arg3"}, {value: "one"}, {value: "two words"}]`,
  with `arguments.0.value` in expressionFields and no `arguments.2.value`.
- The run passes.

## v-plugin-shell-script-file-functional.spec.ts (SH-2)

Steps:
1. Import `fixture-script-file.json` with the Test Data file `scripts/hello.sh`
   (`#!/usr/bin/python3` then `echo "file-mode $1"`).
2. Open `sh-file`, select Script Type File, Browse on Script File, pick
   `scripts/hello.sh` in the Test Data tab and confirm.
3. Save, then run to any verdict.

Validation:
- The Script row disappears and Script File appears with Browse; the picker's
  Reference line shows the scheme `testdata://` and the path `scripts/hello.sh`,
  and the row reads `testdata://scripts/hello.sh`.
- The verdict is not `failed`, and `file_out` reads `file-mode ok` (the python
  shebang is ignored).
- `sh-file-missing` (Record and continue): `m_ok` false, `m_reason` `StartFailed`,
  `m_err` exactly `Script file not found: testdata://scripts/missing-<token>.sh`,
  `m_code` -1.
- One WARN console entry reads exactly
  `Script failed (StartFailed): Script file not found: testdata://scripts/missing-<token>.sh`.

## v-plugin-shell-script-input-vars-functional.spec.ts (SH-3)

Steps:
1. Import `fixture-input-vars.json`: Input Variables `GREETING` literal
   `hello world`, and `COUNT`, `FLAG`, `ITEMS` as expressions over `num` (42),
   `flag` (true) and `items` (`["a", 2, true]`); the script prints them from a
   child `bash -c` process into `iv_out`.
2. Run, then open the block.

Validation:
- `iv_out` is exactly `hello world|42|true|["a",2,true]`.
- The Input Variables row reads "4 entries".

## v-plugin-shell-script-exports-functional.spec.ts (SH-4, SH-5)

Steps:
1. Each fixture starts with a Delay `ws-hold` of 2000 ms. Start the run, read
   the session id, open the WS collector on `log:` and `variable:`, then wait
   for the end.
2. SH-4 (`fixture-typed.json`): the script sets `COUNT=7`, `OK=yes`,
   `LIST=(a "b c" "")`, an associative array `M`, a secret `TOKEN` and an
   unbound `SPARE`; the first five are bound to `count_v`, `ok_v`, `list_v`,
   `map_v`, `token_v`, and TOKEN is marked secret.
3. SH-5 (`fixture-unset.json`): `sh-unset` sets only `SET_ONE` of
   `[SET_ONE, NEVER]`; `sh-hook-gone` sets `SET_TWO` and then `exec /bin/true`.
   Both are Record and continue.

Validation (SH-4):
- The export table lists six rows under Script Variable, Type, Secret and WAVE
  Variable. Each row's Type select (`output-list-type-<i>`) is disabled on the
  five bound rows and reads Integer, Boolean, Array, Map, String; on the unbound
  SPARE row it is enabled and reads String. No row shows "from variable".
  TOKEN's Secret box is ticked.
- After the run `count_v` is the number 7, `ok_v` true, `list_v`
  `["a", "b c", ""]`, `map_v` `{k1: "v1", k2: "v 2"}`, and `token_v` reads the mask.
- No console text or WS event carries `shsec-tok-<token>`; the DEBUG Outputs
  echo (the harvested message starting `Outputs:` and containing `COUNT`) shows
  TOKEN masked.
- The session variables have no key `SPARE`, and no harvested message contains
  `spare-<token>` (an unbound export is read and discarded, SHRUN-6).

Validation (SH-5):
- `a_one` is 1, `a_never` still "keep-a", `a_ok` true, `a_reason` "" and `a_err` ""
  (an unset export is not a failure, SHRUN-7).
- Exactly one harvested DEBUG message reads
  `Variable export 'NEVER' was never set; the bound variable keeps its value`.
- `sh-unset` paints `success`, and no console entry reads
  `Script variable 'NEVER' was not set by the script`.
- `b_two` still 9, `b_ok` true, `b_code` 0; exactly one WARN console entry reads
  `Variable exports were not read: the script replaced WAVE's exit handler`, and
  `sh-hook-gone` paints `warning` (amber), not `failed`.

## v-plugin-shell-script-exit-code-functional.spec.ts (SH-6)

Steps:
1. Import `fixture-exit.json` and run: `sh-exit-fail` (Fail, inside Try/Catch,
   error map -> `f_error`) and `sh-exit-record` (Record) both run
   `echo out; echo err >&2; exit 3`; `sh-exit-trap` (Record) runs
   `trap 'STATUS=cleaned' EXIT; COUNT=5; exit 4` with exports `[STATUS, COUNT]`
   bound to `t_status` (seeded "keep-status") and `t_count` (seeded 11).

Validation:
- The catch branch runs, the caught message is exactly
  `Script exited with code 3: err`, and `f_out` is still "unset".
- `r_out` `out`, `r_err` `err`, `r_code` 3, `r_ok` false, `r_reason` `NonZeroExit`,
  `r_msg` `Script exited with code 3: err`; exactly one WARN line reads
  `Script failed (NonZeroExit): Script exited with code 3: err` (the Fail leg writes
  none), and `sh-exit-record` paints `warning`.
- The script's own EXIT trap replaces WAVE's exit hook (SHRUN-7): `t_code` 4,
  `t_reason` `NonZeroExit`, `t_status` still "keep-status", `t_count` still 11,
  one WARN line reads
  `Variable exports were not read: the script replaced WAVE's exit handler`, and
  `sh-exit-trap` paints `warning`.

## v-plugin-shell-script-termination-functional.spec.ts (SH-7, SH-8, SH-9)

Steps:
1. SH-7 (`fixture-timeout.json`): `sh-timeout` (Record, timeout 2) starts a
   background `sleep 300`, writes its pid to `bg.pid`, prints `started` and
   sleeps; the probe Shell Exec reads `bg.pid`. Run with a 60 s ceiling.
2. SH-8 top level (`fixture-stop.json`): `sh-stop` (Log Output ticked) writes
   `bg.pid` and prints `ready-<token>`. Wait for that console line, press Stop
   and choose immediate, then Run Current on `sh-stop-probe`.
3. SH-8 Parallel (`fixture-stop-parallel.json`): lanes `sh-stop-a` and
   `sh-stop-b` write `a.pid` / `b.pid` and print `ready-a-<token>` /
   `ready-b-<token>`. Wait for both lines, Stop immediately, then Run Current on
   `sh-stop-par-probe`. Every Run Current waits for the new session id. The
   probe's description wraps to two lines, so the bookend Log sits 130 units
   below it; any closer and the Log node covers the probe's kebab.
4. SH-9 (`fixture-leftover.json`): `sh-leftover` (timeout 60) leaves a
   background `sleep 300` running and exits; the probe reads `left.pid`. Run
   with a 20 s ceiling.

Validation:
- SH-7: `t_code` 137, `t_reason` `Timeout`, `t_err` exactly
  `Script timed out after 2 seconds`, `t_out` `started`, one WARN line reads
  `Script failed (Timeout): Script timed out after 2 seconds`, `sh-timeout`
  paints `warning`, `probe` `gone`, and the run ends within 60 s.
- SH-8 top level: the run status reaches `stopped` within 10 s, `sh-stop` paints
  `stopped`, `stop_probe` is still "" (the probe never ran in the stopped run),
  and after Run Current `stop_probe` reads `gone`.
- SH-8 Parallel: the run status reaches `stopped` within 10 s, both lane nodes
  paint `stopped`, `par_probe` is still "", and after Run Current `par_probe`
  reads exactly `gone gone`.
- SH-9: the run passes well before 60 s, `l_code` 0, `sh-leftover` paints
  `success`, and `probe` reads `gone` (a leftover job is killed at normal exit,
  SHRUN-15).

## v-plugin-shell-script-stop-pattern-functional.spec.ts (SH-10)

Steps:
1. Import `fixture-pattern.json` (starts with `ws-hold`), start the run, open the
   WS collector, and wait for the end with a 30 s ceiling:
   `sh-pass -> sh-fail -> sh-exec-pass -> sh-pass-secret -> sh-pass-stuck ->
   Try/Catch (sh-fail-hard) -> sh-pattern-probe -> sh-stuck-probe -> bookend`.
2. `sh-pass` (pass pattern `^READY-`, timeout 60) writes `pass.pid`, sets
   `X=late`, prints `READY-<token>` and sleeps; export `[X]` -> `p_x` (seeded "orig").
3. `sh-fail` (Record, fail pattern `ERROR|FATAL`, timeout 60) writes `fail.pid`,
   sets `Y=early`, prints `starting`, then `ERROR disk full <token>`, and sleeps;
   export `[Y]` -> `f_y` (seeded "orig").
4. `sh-exec-pass` (Shell Exec, pass pattern `^GO-`) prints `GO-<token>` and sleeps.
5. `sh-pass-secret` (Stdout marked secret, pass pattern `^shsec-go-`) prints
   `shsec-go-<token>` and sleeps.
6. `sh-pass-stuck` (pass pattern `^STUCK-`, export `[Z]` -> `k_z` seeded "orig")
   starts a child that ignores TERM, writes the child's pid to `stuck.pid`,
   prints `STUCK-<token>` and sleeps.
7. `sh-fail-hard` (Fail, inside Try/Catch, error map -> `h_error`, fail pattern
   `ERROR|FATAL`) sets `Z=early`, prints `FATAL hard stop <token>` and sleeps;
   export `[Z]` -> `h_z` (seeded "orig"), Exit Code -> `h_code` (seeded -99).

Validation:
- `sh-pass`: `p_ok` true, `p_code` 137, `p_x` reads `late` (a pattern stop
  reads the exports, SHRUN-7, SHRUN-13), and the node paints `success`.
- One INFO console entry reads exactly
  `Output matched the pass pattern: READY-<token>`, and the WS log stream carries
  it before the block's Outputs echo, which shows `'X': 'late'`.
- `sh-fail`: `f_reason` `FailPattern`, `f_err` exactly
  `Output matched the fail pattern: ERROR disk full <token>`, `f_ok` false,
  `f_code` 137, `f_y` reads `early`, one WARN line reads
  `Script failed (FailPattern): Output matched the fail pattern: ERROR disk full <token>`,
  and the node paints `warning` (amber).
- `pattern_probe` reads exactly `gone gone`: a pattern stop ends the whole
  tree (SHRUN-15).
- `sh-exec-pass`: `e_ok` true, `e_code` 137, and one INFO line
  `Output matched the pass pattern: GO-<token>` streams before its Outputs echo.
- `sh-pass-secret`: `s_ok` true, `s_code` 137, exactly one INFO line reads
  `Output matched the pass pattern`, and `shsec-go-<token>` is on no console
  entry and no WS event.
- `sh-pass-stuck`: `k_ok` true, `k_code` 137, `k_z` still "orig", one WARN line
  reads `Variable exports were not read: the script did not end after the pattern match`,
  the node paints `warning`, and `stuck_probe` reads `gone`.
- `sh-fail-hard`: the catch branch runs, the caught message is exactly
  `Output matched the fail pattern: FATAL hard stop <token>`, `h_z` is still
  "orig", `h_code` still -99, and no `Script failed (FailPattern)` WARN line is
  written for it (under Fail nothing binds, SHRUN-9).

## v-plugin-shell-script-console-functional.spec.ts (SH-11)

Steps:
1. Import `fixture-console.json` (starts with `ws-hold`), start the run and open
   the WS collector; wait for the end with a 60 s ceiling.
2. `sh-live` (Log Output ticked) prints `line-one-<token>`, sleeps 15 s, prints
   `line-two-<token>` and `line-err-<token>` on stderr; stdout -> `live_out`
   (seeded "seed").
3. `sh-quiet` (unticked, stdout -> `quiet_out`), `sh-secret-stream` (ticked,
   Stdout marked secret, stdout -> `sec_out`) and `sh-secret-input` (ticked,
   `SECRET_IN` from the secret variable `sec_var`, `echo "got $SECRET_IN"`).
   The Shell Script blocks keep the type's own Name, so the console source reads
   exactly `Shell Script` (EXEC-25). The source column cuts it to its width (`Shell Scr…`
   at 10ch), so the spec reads level, source and message from each row's copy
   text, which keeps the full source.

Validation:
- Right after `line-one-<token>` lands, `sh-live` still paints `running` and
  `live_out` is still "seed" (nothing is published while the script runs, SHRUN-8).
- After the run the console holds `line-one-<token>` and `line-two-<token>` once
  each at INFO with source `Shell Script`, and `line-err-<token>` once at WARN;
  `live_out` reads the two lines.
- `quiet_out` reads `quiet-<token>` (the block ran), and no INFO or WARN entry
  contains it.
- No console entry or WS event carries `shsec-live-<token>`, no console entry
  reads just the mask, and `sec_out` reads the mask (a secret stream is never
  written live, SHRUN-12).
- One console line reads `got ` followed by the mask, and `shsec-in-<token>` is
  on no console entry, WS event or session variable.

## v-plugin-shell-script-paths-functional.spec.ts (SH-12)

Steps:
1. `fixture-paths.json`: `sh-pwd -> py-temp -> sh-mkdir -> sh-pwd-art -> bookend`.
   Run 1. `sh-pwd` leaves Working Directory empty and runs `pwd` -> `wd_default`;
   `py-temp` prints `tempfile.gettempdir()` -> `wave_temp`; `sh-mkdir` writes
   `sh-12-<token>/keep.txt` into the run's artifacts.
2. Open `sh-pwd-art`, expand Execution, Browse on Working Directory in folder
   mode, open the Artifacts tab, pick the folder `sh-12-<token>`, confirm, save,
   and press Run again (a full run; wait for the new session id).
3. `fixture-remote-gating.json` (never run): an SSH Session Open and a Remote
   Execution body holding File I/O `fio-inside`, Shell Script
   `shell-script-inside` and Shell Exec `shell-exec-inside`.
4. `fixture-remote-body.json` (imported with SSH injection, uses `sshd`): a
   top-level Shell Script runs `hostname` -> `wave_host`; in the body
   `shell-script-inside` runs `hostname` -> `body_host` and `ssh-session-exec`
   runs `hostname` -> `ssh_host`.

Validation:
- After run 1 `wd_default` equals `wave_temp`, an absolute path: an empty
  Working Directory starts the script in the temp folder Python reports on the
  machine the block runs on (SHRUN-10, REQ-3.4.3.11), never a fixed path.
- The picker's Reference line shows the scheme `artifact://` and the path
  `sh-12-<token>`; the Working Directory row and the saved Test hold
  `artifact://sh-12-<token>` as a literal (not an expression), and after the
  second run `wd_art` ends with `/sh-12-<token>`.
- In the body both shell blocks carry the locus badge `L` (`fio-inside` carries
  `R`); `shell-script-inside`
  shows Browse on Working Directory and, after switching to File, on Script
  File; `shell-exec-inside` shows Browse on Working Directory; `fio-inside` has
  no Browse on Path.
- After the remote-body run `body_host == wave_host` and `body_host != ssh_host`
  (SHRUN-1).

## v-plugin-shell-script-environment-functional.spec.ts (SH-13, SH-14)

Steps:
1. Import `fixture-environment.json` with the Test Data file
   `inputs/data-<token>.txt` (`td-<token>`); the folder is created first, and the
   server leaves it read-only.
2. Run. `sh-td` reads the file and writes `sh-13-<token>/out.txt` into the
   artifacts; `sh-td-write` (Record) writes into `inputs/`; `sh-env` and
   `sh-env-exec` report which `WAVE_` variables are present.
3. Open the artifacts chip.

Validation (SH-13):
- `td_out` reads `td-<token>`.
- In the session artifacts sheet exactly one file row carries `out.txt`, and its
  subtitle reads exactly `sh-13-<token>`.
- `w_code` 1, `w_reason` `NonZeroExit`, `w_stderr` contains `Permission denied`,
  `w_msg` `Script exited with code 1: ` followed by the last `w_stderr` line, trimmed
  and cut to 200 characters, `sh-td-write` paints `warning`, and the
  Test Data listing still holds `inputs/data-<token>.txt` and has no
  `inputs/new-<token>.txt` (SHRUN-11).

Validation (SH-14):
- `env_out` lines are exactly `[present][present][present][present][present]`
  and `rc=0`; `env_exec_out` reads `rc=0`. Only presence is asserted, never a
  value (SHRUN-2).

## v-plugin-shell-exec-functional.spec.ts (SH-15)

Steps:
1. Import `fixture-shell-exec.json` and run: `sh-exec-bash` (shell `/bin/bash`),
   `sh-exec-sh` (Record, shell `/bin/sh`, the same `[[ ... ]]` command),
   `sh-exec-pipe` (Log Output ticked), `sh-exec-flags`
   (shell `/bin/bash -o pipefail`) and `sh-exec-env` (Input Variable `NAME` from
   the variable `who`).

Validation:
- `c1_out` reads `bash-ok`.
- `c2_code` 127, `c2_reason` `NonZeroExit`, `c2_stderr` contains `[[: not found`,
  `c2_msg` exactly `Command exited with code 127: /bin/sh: 1: [[: not found`, and
  `sh-exec-sh` paints
  `warning`.
- `c3_out` reads `3`, and its one console entry `3` sits at INFO with source
  `Shell Exec` (every block keeps the type's own Name, EXEC-25), read from the row's copy
  text as in SH-11.
- `c4_out` reads `rc=1`.
- `c5_out` reads `hi wave-<token>` (SHRUN-17, SHRUN-18).
- The four other Shell Exec nodes paint `success`.

## v-plugin-shell-script-sheet-functional.spec.ts (SH-16)

Steps (no run; `fixture-sheet.json` holds one Shell Script with script
`echo seed` and the variables `f3_count` integer and `STATUS` string):
1. Script Type: set Script to `echo keep`, select File, select Source again.
2. Arguments: in the shared list editor add three items `a`, `b`, `c`, then press
   "Remove argument $2", then "Move argument $2 up", then add `d` and remove it, Save.
3. Variable exports: add two rows named `A` and `A`, then rename the second to
   `stdout`, `1x` and `B`, pressing Tab after each name, then remove row B.
4. Stop on pattern: expand the group, tick Stop on pattern with both patterns
   empty, then set Pass pattern to `^ok`.
5. Input Variables: open the map editor, add a row and type `WAVE_X`, then
   `1X`, then `X1`.
6. Bound type: add the export `COUNT` bound to `f3_count`, save the config and
   the workbench, reload, change Script to `echo seed2`, save both again.
7. Rename binding: add the export `STATUS` bound to `STATUS`, save the config,
   rename the variable to `STATUS_RENAMED` in the Variable Manager, save the
   workbench.

Validation:
- Script Type: Source shows Script and not Script File; File shows Script File
  with Browse and no Script; back on Source the Script preview reads
  `echo keep`. The Shell row stays directly under Script Type in both.
- Arguments: Add is named `Add argument`; items read `$1`..`$3` with `a`, `b`, `c`;
  after the removal item 0 is `a` at `$1`, item 1 is `c` at `$2`, there is no item 2
  and focus is on the item that took its place; the moved item keeps focus on its
  arrow (its down arrow, now at `$1`); removing the last item puts focus on
  `Add argument`; Save writes `[{value: c}, {value: a}]`.
- Variable exports: no error shows while a new name field has focus. After Tab
  the error sits on its own table row under the export row and reads exactly
  `Another variable export has this name` for `A` / `A` (Save disabled),
  `A block output already has this name` for `stdout`,
  `Name must start with a letter or underscore, and contain only letters, numbers, and underscores`
  for `1x`, and clears for `B`.
- Stop on pattern: Fail pattern shows the required asterisk, its alert reads
  exactly `Set a pass pattern, a fail pattern or both`, and both Save buttons are
  disabled; after `^ok` the asterisk and the alert go and Save is enabled.
- Input Variables: `WAVE_X` sets `aria-invalid="true"` and the strip reads
  exactly `Variable names may not start with WAVE_: 'WAVE_X'`; `1X` reads exactly
  `Invalid variable name: '1X'`; `X1` clears the strip.
- Bound type: the Variable Manager shows `f3_count` as Integer, the persisted
  Test keeps `integer`, and the COUNT row's Type select is disabled and reads
  Integer.
- Rename binding: the row name stays `STATUS` and its binding reads
  `STATUS_RENAMED`; the persisted node has `outputBindings.STATUS`
  `STATUS_RENAMED`, `outputBindings.COUNT` still `f3_count`, no key
  `STATUS_RENAMED`, and `script_variables` contains `STATUS`.

## v-plugin-shell-remote-stop-functional.spec.ts (SH-17, SH-18)

Steps:
1. `fixture-host-probe.json` (SSH injection): an SSH Session Exec prints the
   host-wide count of `wave-worker` processes into `host_probe` (seeded "seed").
   Run it first for the baseline, and again after each main run with the pid
   list written into its checker command, which prints `gone` or `alive` per pid.
2. SH-17 (`fixture-remote-stop.json`): in a Remote Execution body, a File I/O
   host read starts the worker, an SSH Session Exec prints the pids of this
   connection's own workers into `probe_during`, a Log prints
   `SH-17-armed-<token>`, and an HTTP block waits on the 60 s delay. Wait for the
   armed line, then Stop immediately.
3. SH-18 (`fixture-remote-drop.json`, its probe Test named `SH-18 probe <token>`):
   two SSH sessions; lane (a) is a Try/Catch whose try leg is the same body and
   whose catch leg logs `SH-18-caught-<token>`; the body records this run's own
   worker pid into `/tmp/sh-18-<token>.pid`; lane (b) waits 5 s and kills that
   worker's parent `sshd` process on the killer session, printing
   `dropped <pid> <ppid>` into `killed_pid`.
4. Before each probe run after a main run, the spec clears the workbench
   session, reopens the probe Test, types the checker for the recorded pids
   into its command through the config sheet, and saves the sheet and the
   workbench. Every run waits for its new session id.

Validation:
- The probe Test's first run reads a number, not its seed.
- SH-17: the run status reaches `stopped` within 10 s; `probe_during` holds at
  least one pid; the saved probe command is exactly the checker; every one of
  those pids reads `gone` in the probe Test's second run (SHRUN-15).
- SH-18: the run ends (any verdict) within 60 s and the console carries
  `SH-18-caught-<token>` after the killer lane's `Wait complete` line, so the
  catch comes from the drop and not from an earlier failure of the body;
  `probe_during` is exactly one pid; `killed_pid` reads
  `dropped <pid> <ppid>` whose pid is exactly that one; that pid reads `gone` in
  the probe Test's second run within 20 s, polled as in SH-17. No absolute
  host-wide count is asserted.

## v-plugin-start-line-functional.spec.ts (SH-19)

Steps:
1. `fixture-start-line.json` seeds one Test with eleven blocks and a Test Data
   file `scripts/sl-probe.sh`: Shell Script in Source and File mode, Shell Exec,
   and Python with an empty and with a named Interpreter row, plus the seven
   failure legs (`sl-exit-short`, `sl-exit-long`, `sl-exit-bare`, `sl-exit-ws`,
   `sl-secret`, `sl-exec-exit`, `sl-py-exit`), all under Record and continue so
   one run carries every case. The bookend Log reads `SH-19-done-<token>`.
2. Run it once and read the console from each row's copy text.

Validation:
- Exactly eleven INFO start lines, one per block, each sourced to the block that
  wrote it (`{type} : {Name}`, every block carrying its own Name, EXEC-25),
  reading `Running the script under {program} on the WAVE server` and,
  for Shell Exec, `Running the command under {shell} on the WAVE server`.
- The three planted body markers appear on no console line: a typed script's text
  and Shell Exec's command are never echoed by the start line.
- The File-mode line names the file as written,
  `Running testdata://scripts/sl-probe.sh under /bin/sh on the WAVE server`.
- A Python block with an empty Interpreter row says `WAVE's own interpreter`.
- A non-zero exit with a non-blank Stderr line fails with
  `Script exited with code {n}: {last non-blank Stderr line}`, trimmed and cut to
  200 characters (`Command exited with code {n}: ...` for Shell Exec); empty or
  whitespace-only Stderr keeps the bare `Script exited with code {n}`.
- A Stderr marked secret gives the bare message, masks the bound variable, and
  puts no secret text on the console.
- The run passes and reaches its bookend.
