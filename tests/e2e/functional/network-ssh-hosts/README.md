# V-NET-SSH-FUNCTIONAL: Trusted SSH Hosts Built in Settings, Proven by Real SSH Runs

End-to-end proof that Settings > Network > SSH Hosts (REQ-4.5.14, NET-1 to NET-4) changes
what SSH blocks do. Every Settings change is made through the page (trash, Mass Action, Add
Hosts by Detect from host and by Paste lines, Lock trusted hosts, Default block action, Save,
Cancel) and its effect is proven by a real SSH Session Open run and by `GET /network/ssh-hosts`.

## Prerequisites

- The real-service stack (`tests/e2e/services/README.md`): `sshd` on `SSH_MAIN_PORT` (9445)
  and `sshd-no-sftp` on `SSH_NO_SFTP_PORT` (9447), reached at `SSH_TARGET_HOST`. Both offer
  the same ED25519 host key (`SSH_HOST_KEY`).
- `resetNetworkSettings` (`helpers/network-settings.ts`) runs before and after every test:
  it resets the `network` and `ssh-hosts` settings (policy back to Lock off and Disabled in
  the stack's config file, hosts emptied) and re-seeds the stack's trusted hosts
  (`STACK_TRUSTED_HOSTS`: the host on 9445 with the right key, on 9448 with the wrong key,
  and `sshd:22`). 9447 is never seeded, so it is the "unknown host" of every case.
- The stack's config file and data folder come from `GET /server/status` (`stackPaths`,
  `helpers/config-file.ts`). The spec reads the `network` section of the config file and
  `<data>/network/ssh_hosts.yaml`, and changes modes with `withMode`, which puts the mode
  back when the step ends. The backend and the spec run as the same account, not root, so
  mode bits are honored.
- Detect on a closed port dials `127.0.0.1:NETCAT_CLOSED_PORT` (9479), where nothing listens
  on the WAVE host.
- Fixtures are imported via `POST /tests` and pass validation with zero errors before any
  run. Their Host carries the `127.0.0.1` sentinel (rewritten per mode by
  `injectServiceHost`); the spec sets the Port from the config constants.

## Fixtures

- `fixture-strict.json`: SSH Session Open "Strict open" (Strict, `SSH_MAIN_PORT`, password
  auth) -> Log `strict connected=<conn> hops=<hops>` -> SSH Session Close -> Log
  `strict-done closed=<count>`.
- `fixture-accept-new.json`: the same chain with "Accept New open" (Accept New,
  `SSH_NO_SFTP_PORT`) and the `accept-new` prefix. SSH-9 also uses it as the saved block that
  keeps Accept New.
- `fixture-disabled.json`: the same chain with "Disabled open" (Disabled, `SSH_NO_SFTP_PORT`)
  and the `disabled` prefix.
- `fixture-placed.json`: Start -> Log `placed-start`, with a free exit. SSH-10 drops an SSH
  Session Open from the palette under that Log, which links it, and fills Host, Port
  (`SSH_NO_SFTP_PORT`), Username and Password in its sheet.

A connecting run passes with every block successful, the console line `Connected to <host>
(session ssh_session_<id>, 1 hop) - SSH-2.0-...`, `<prefix> connected=True hops=1` and
`<prefix>-done closed=1`. A refused run fails at "... open": the block fails, the later
blocks never succeed, no `Connected to` line appears, and the console carries
`Block '<Name>' failed: <refusal>` with the exact refusal text, where the Name is the SSH
Session Open block's own ("Strict open", "Accept New open", "Disabled open").

## Tests

1. **SSH-1:** trash the 9445 row and Save; a Strict run is refused with `SSH host key
   verification failed for <host>:9445: the host is not in WAVE's trusted hosts list and the
   host key policy is 'strict'. Add it in Settings > Network > SSH Hosts`. Add Hosts > Detect
   from host on 9445 shows one ED25519 row with the host key's fingerprint, checked; Add
   stages it with Added "Unsaved" (muted); Save stores it and the row shows the stored Added
   date; the Strict run then connects.
2. **SSH-2:** trash the 9445 row, then Cancel: the row is back (table and API, same id), Save
   and Cancel are disabled again, and a Strict run connects.
3. **SSH-3:** Mass Action, the row's checkbox, "1 selected", the red Delete, Save: only that
   row is removed; a Strict run is refused with the exact strict text. Then Paste lines with
   the host's own `[<host>]:9445` line: the row is checked, Add stages it as "Unsaved", Save
   stores it with its Added date, and the Strict run connects.
4. **SSH-4:** Paste lines (a comment, `HostName ci-02.lab.internal`, then 9447 with the host
   key, 9445 with the host key, 9445 with the wrong key) shows exactly `Line 2: not a
   known_hosts line` under the table; the 9447 row is checked and can be unchecked (Add
   disabled) and checked again; the 9445 rows read "Already trusted" (muted) and "Key
   changed" (error color), both with disabled checkboxes; Add stages only 9447 and Cancel
   drops it, nothing stored.
5. **SSH-5:** Detect on `127.0.0.1:9479` shows exactly `Could not reach 127.0.0.1:9479:
   Connection refused` under the Host row, no rows, Add disabled; nothing staged.
6. **SSH-6:** an Accept New run to 9447 connects; the reloaded page lists 9447 with the host
   key's fingerprint and an Added date equal to the API `added` value in the page's date
   format, which is today.
7. **SSH-7:** a pasted `[<host>]:9447` line with the wrong key is staged; an Accept New run
   started through `POST /executions` trusts the real key meanwhile; Save answers 409 with the
   failure toast "Could Not Save SSH Hosts" reading exactly `<host> port 9447 already has a
   trusted ED25519 key; remove it before adding another`; the staged row stays and the stored
   entry is unchanged.
8. **SSH-8:** with the default on Accept New, Lock on changes the select to Strict and Accept
   New is listed but disabled; Save stores `{lock_trusted_hosts: true, default_block_action:
   strict}` and the reloaded page shows the same; an Accept New run to 9447 is refused with
   `SSH host key verification failed for <host>:9447: the host is not in WAVE's trusted hosts
   list and trusted hosts are locked. Add it in Settings > Network > SSH Hosts` and the API
   holds no 9447 entry.
9. **SSH-9:** Default block action Strict + Save: an SSH Session Open dropped from the palette
   shows Host Key Verification `strict`, the saved Accept New block still shows `accept-new`;
   Disabled + Save: a dropped block shows `disabled`.
10. **SSH-10:** Default block action Strict + Save, then the network reset: the API, the
    config file (`lock_trusted_hosts: false`, `default_block_action: disabled`) and the
    reloaded page (Lock off, Disabled) are back on the default. An SSH Session Open dropped
    under the Log of `fixture-placed.json` shows Host Key Verification `disabled`; with Host,
    Port 9447, Username and Password filled and the Test saved, the stored block holds
    `host_key_verification: disabled`, run validation reports zero errors, the run passes
    with `placed-start` and the `Connected to <host> (session ..., 1 hop)` line, the block
    is successful, and neither `GET /network/ssh-hosts` nor the page lists 9447.
11. **SSH-11:** Default block action Strict: the config file still reads
    `default_block_action: disabled` before Save and `default_block_action: strict` after it.
    Lock on + Save: the config file reads `lock_trusted_hosts: true`. After each Save
    `<data>/network/ssh_hosts.yaml` has the one top-level key `hosts` (no `policy`).
12. **SSH-12:** Strict and a pasted `[<host>]:9447` line are staged; with `<data>/network` at
    mode 0555, Save answers 500 and the failure toast "Could Not Save SSH Hosts" carries the
    API's message. Afterwards the config file still reads `default_block_action: disabled`,
    `ssh_hosts.yaml` and the folder listing are unchanged, the API holds the default policy
    and no 9447 entry, the select still shows Strict and the row still reads "Unsaved". With
    the mode back, the same Save stores `default_block_action: strict` and the host.
13. **SSH-13:** with `<data>/network/ssh_hosts.yaml` at mode 0000, a Strict run and an Accept
    New run fail at "... open" with exactly `WAVE's trusted SSH hosts list <path> cannot be
    read: [Errno 13] Permission denied: '<path>'` and no `Connected to` line; a Disabled run
    to 9447 connects. With the mode back, the list holds the seeded hosts and no 9447 entry.

Every Test the spec imports is deleted in `afterAll`.
