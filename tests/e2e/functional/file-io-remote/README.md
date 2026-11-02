# V-PLUGIN-FILEIO-REMOTE-FUNCTIONAL: File I/O inside a Remote Execution body

Proves the File I/O block works on the execution host when a Remote Execution
container holds it, and that the effects are on the host's own filesystem and
not on WAVE. A second leg proves the other half of the rule: a WAVE-side
`testdata://` path on a block inside the body saves, and the remote host refuses
it when the run reaches the block (REQ-3.4.1.10, REQ-3.4.1.3, REQ-5.1.5;
decision FIO-10).

## Prerequisites

- Backend and frontend running on the worker's stack ports.
- Shared execution environment (`ensureEnvironment` creates it if absent).
- The real-service stack must be running (see `tests/e2e/services/README.md`).
  One service is needed:
  - `sshd` - the OpenSSH host (127.0.0.1:9445 -> in-stack 22) the Remote
    Execution pushes its worker to. Its `python3` meets the container's
    interpreter floor and its `/tmp` is writable by the `wave` user.

  ```bash
  ./scripts/e2e-stack.sh up --wait sshd
  ```

- The SSH block carries the fixture host sentinel; the `injectSsh` import option
  rewrites it for container-shard mode. The spec asserts the fixture's host,
  port, user and password against `SSH_FIXTURE_HOST_SENTINEL`, `SSH_MAIN_PORT`,
  `SSH_STACK_USER` and `SSH_STACK_PASSWORD` from `helpers/config.ts`, so a stack
  change cannot leave a stale literal behind.
- `remote.fixture.json` - one SSH session to the host, an SSH Session Exec that
  seeds `seed/marker.txt` under the run folder, then a Remote Execution body of
  seven File I/O blocks (create folder, write, read, read the seeded marker,
  stats with size and sha256, recursive list with sizes, delete) and a `then`
  branch that probes the host for the removed folder and logs the bookend.
  The run folder is a test variable the spec fills in per run.
- `abort-scheme.fixture.json` - the same shape reduced to one SSH Session Open,
  a Remote Execution container and a single File I/O read whose Path is
  `testdata://orders.csv`, and a `then` branch that logs `abort-scheme-then`.

## Isolation on the shared stack

The `sshd` host is shared by every parallel shard, so each run works under its
own `/tmp/wave-e2e-fio-<8 hex>` folder, named from a fresh UUID at test start.
The workflow's own last body block deletes that folder, and the `then` branch
probes the host to prove it is gone, so a passing run leaves the host exactly as
it found it. Each spec imports its own Test under a unique name and deletes it
in teardown, which cascades to the test's data folder. No server state is reset.

## Steps

1. Load `remote.fixture.json`, check its SSH target against the harness
   constants, and set the run folder variable to a fresh unique path.
2. Import via `POST /tests` and confirm `POST /tests/{id}/validate` reports zero
   errors, then open the test in the workbench.
3. Read the locus badges off the canvas before running anything.
4. Pick the shared environment, press Run, and wait for the terminal state and
   the run's bookend line.
5. Read the console and the session variables the run left behind.
6. Import the abort fixture the same way, confirm it validates with zero
   errors, press Run and wait for the refusal on the console.
7. Delete both imported Tests.

## Validation

- **Locus:** each of the seven File I/O blocks inside the body carries one `R`
  badge; the SSH blocks, the container and the `then` branch carry none, and no
  `L` badge is painted anywhere.
- **Round trip on the host:** the read returns the written payload byte for
  byte, and the plugin's own lines name the absolute host paths
  (`Created folder <run>/deep`, `Wrote N characters to <run>/deep/notes.txt`,
  `Read N characters from <run>/deep/notes.txt`).
- **The body's filesystem is the host's:** the body reads
  `<run>/seed/marker.txt`, a file only the SSH session created, and gets its
  contents back. The SSH session's own `hostname` reads `wave-e2e-host`.
- **Stats:** `exists` true, `type` `file`, `size` equal to the payload's byte
  length, `checksum` equal to the sha256 of the payload, and a non-empty
  modification time.
- **List:** five columns (Size adds the fifth), four rows in path order -
  `deep`, `deep/notes.txt`, `seed`, `seed/marker.txt` - with the folder and file
  types and the payload's size on the written file; `count` is 4.
- **Cleanup:** `Deleted <run>` on the console and the host-side probe reads
  `gone`.
- **Session outcome:** `passed`, with every block successful and
  `fileio-remote-done` bookending the run.
- **Run-time refusal:** the abort fixture saves and validates with zero errors.
  Its run fails; the console carries
  `testdata:// paths are not available on the remote host - use an absolute or relative path on the remote host`
  verbatim at the end of the File I/O block's failure line, the block is painted
  failed, and `abort-scheme-then` never appears.

## Running it

```bash
# from the repository root
./scripts/e2e-targeted-local.sh functional/file-io-remote/v-plugin-fileio-remote-functional.spec.ts
```

The suite runs in the `functional-workflow` project.
