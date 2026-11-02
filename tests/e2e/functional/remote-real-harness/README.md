# Remote real-service proofs (full chain) - functional E2E

The integration form of the real-stack SSH/Remote proofs: one workflow chains every capability
whose unit form lives in a per-suite spec (ssh-session-via-parent, ssh-session-script, ssh-tunnel,
remote-exec).

## Pre-requisites
- E2E stacks up; real-service stack up (`sshd` :9445, internal `nested-sshd`, internal
  `http-target`); shared env `E2E Execution Env`.

## Execution
Imports `fixture.json` (SSH host injected per mode), validates (zero errors), opens it in the
workbench, runs it once.

## Validation
- Session A (hop 1) -> Session B via parent A to the unpublished `nested-sshd` (hop 2); real
  `hostname` through the chain returns `nested-host`. (The direct-open isolation proof is the
  via-parent suite's.)
- Five real interpreters (sh/bash/python3/perl/node) run piped scripts over the 2-hop session
  and compute 42-family values.
- A tunnel OVER B forwards a WAVE-local port to `http-target`; a request through it returns the
  target's real health body through both hops.
- A Remote Execution container on B pushes the real bundle under B's python3; its HTTP body block
  reaches the stack-only `http-target` by service DNS (impossible from WAVE) and the worker's log
  is replayed (`HTTP 200 http://http-target:9444/api`); Remote Session ID binds (32-hex).
- After Tunnel Close the old forwarded port refuses (`All connection attempts failed`, caught).
- Closing A cascades across the real jump to B (2 session ids; both Connected variables flip
  false).
- Session outcome passed; every chain node succeeds; the guarded post-close probe fails.
