---
id: remote-execution
description: Run a body of blocks on a remote host over an open SSH session
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-06"
    changelog:
      - "Full implementation released"
      - "Container block (like For Loop): input, cyan body sub-flow, then continuation"
      - "Mandatory Session ID = an already-open SSH session (from SSH Session Open)"
      - "Interpreter compatibility validated on the host at run time (no config input)"
      - "Mixed-locus body: remotable blocks (like HTTP) run on the host, others run on WAVE"
      - "Agentless: a self-contained pure-Python bundle is pushed and torn down; nothing persists"
      - "Output: Remote Session ID"
---

The Remote Execution block is a container: blocks placed in its body sub-flow run on a remote host when they are remotable, and on WAVE otherwise. It rides an already-open SSH session, pushes a self-contained pure-Python runtime over that session, runs the remotable body blocks on the host, and tears the runtime down when the body finishes.

**Use Cases:**
- Run an HTTP request from inside a target network rather than from the WAVE backend
- Exercise services reachable only from a specific host, over an existing SSH session
- Read a Kubernetes cluster whose API answers only from inside the remote host's network, with no tunnel
- Keep remote execution agentless: nothing WAVE-authored is left behind on the host

**Behavior:**
- The Session ID is mandatory and must reference an open SSH session (bind the Session ID output of an SSH Session Open block - the same way SSH Execute and SSH Close reference a session)
- On execute it resolves that session's live connection, validates a compatible Python interpreter (3.10 or newer) on the host, opens one persistent remote worker, routes each remotable body block to it (other blocks run on WAVE), then tears the worker down
- Interpreter compatibility is a run-time check on the host, not a configuration input
- Each body block owns its own timeout; the container has none
- The body may hold any block; each is routed automatically by its remotable flag, and shows an R (host) or L (WAVE) locus badge
- Captured remote logs are replayed into the run with the same secret masking as local execution
- Bind the Remote Session ID output to a variable to identify the remote worker opened for this container

**Parameters:**
- **Session ID**: Session ID of an open SSH session whose host runs the body (required)

**Outputs:**
- **Remote Session ID**: Handle to the persistent remote worker opened on the SSH session host
