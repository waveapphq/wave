---
id: helm-rollback
description: Roll a release back to an earlier revision, or to the one before the current
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-04"
    changelog:
      - "Full implementation released"
      - "Revision picks the target; empty goes back to the revision before the current one"
      - "Cleanup on Fail removes the resources a failed rollback newly created"
      - "Result is the release read back after the rollback, shaped by Output Format"
---

The Helm Rollback plugin puts a release back on an earlier revision, through the K8s Session a K8s Connect block produced. It runs the real `helm rollback`: WAVE ships no helm of its own, it calls the helm found where the block runs. There is no chart here, so no chart-repository rows and no Create Namespace. helm rollback prints only text, so Result is the release read back after the rollback.

**Use Cases:**
- Undo a bad upgrade and assert the workload is back on the previous image
- Walk a release back several revisions and check each state
- Prove a rollback is what your operational runbook says it is

**Behavior:**
- Revision is the revision to go back to. Leave it empty to go back to the revision before the current one, which is what helm does
- Rolling back makes a new revision. It does not delete the revision you came from, so a release can be rolled forward again
- Nothing waits for readiness, which is helm's own default. Compose a wait from Helm Status or K8s Get under a Wait Until control. helm rollback has no atomic flag, so Cleanup on Fail and the cleanup room it buys are all that sit above On error
- Cleanup on Fail deletes the resources the failed rollback newly created, instead of leaving them behind
- Timeout is helm's own operation timeout, 300 seconds by default, and the block is stopped the moment it runs out. Cleanup on Fail adds a Cleanup Timeout on top of it: helm has failed by then, and that is the room it gets to remove what the failed rollback created. The block's whole bound is the two added together
- Output Format decides the shape of Result. Table is one row with helm's own list columns. Map is the release document helm reports. JSON and YAML are that same document as text. The document is read back after the rollback, because helm rollback itself prints no release
- Namespace is empty by default, which uses the namespace the session carries
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- Helm Path names the helm to run. Empty runs the helm on the PATH of wherever the block runs: the WAVE host, or the execution host when the block sits inside a Remote Execution container. A bare name is looked up on that PATH; an absolute path is called as it stands; a relative path starts at the home folder of the account the block runs as. Bind the row to an environment or global variable to set it once for a team. A missing helm fails the block under either On error setting, naming what was tried and, on a remote host, the host it was tried on
- The blocks emit only flags that behave the same on helm 3.13 and later and on every helm 4, so one block works against whichever helm a machine carries. WAVE never asks helm for its version on its own initiative; only when helm rejects a flag as unknown does WAVE read the version once and report that the helm it found is older than 3.13
- Which Kubernetes versions a helm supports is helm's own policy, the four minors up to the one it was built against. WAVE adds no check of its own
- helm 4 installs charts written for helm 3 and upgrades releases helm 3 created, but a release helm 4 created may not be manageable by helm 3. That matters when the WAVE server and a remote execution host carry different majors: install from one and the older helm on the other may refuse to roll the release back
- The session reaches helm as a kubeconfig written for one call and deleted after it. The server URL, credentials, certificate authority, server-name override and verification choice all carry across. The session's cipher-suite and TLS-version pins do not, because they cannot bind a helm process
- On error decides what a helm refusal does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A missing helm, an unreadable session, or a failure before helm runs fails the block either way. A rollback that succeeds but whose read-back fails is reported like any other failure
- Reason carries one of a fixed set, so a workflow branches on it and never on text. **NotFound**: the release or the revision was not found. **AlreadyExists**: a resource is still in use. **Forbidden**: the cluster denied the request. **Timeout**: helm's timeout ran out, or the process passed WAVE's deadline. **Invalid**: helm rejected the request or a flag. **Unreachable**: the cluster could not be reached. **Failed**: everything else, including a release or hook that failed

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: How long helm gets to finish the operation, in seconds (default: 300)
- **Release Name**: The release to roll back (required)
- **Revision**: The revision to go back to; empty goes back to the revision before the current one
- **Output Format**: Table, Map, JSON or YAML (default: Table)
- **Namespace**: Roll back in a namespace other than the session's; empty uses the session's
- **Helm Path**: The helm executable to run: a name looked up on the PATH, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs helm from the PATH
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **Cleanup on Fail**: Delete the resources this rollback created when it fails, instead of leaving them behind (default: off)
- **Cleanup Timeout**: How long helm gets to undo the failed rollback, in seconds, on top of Timeout. Offered only while Cleanup on Fail is on (default: 300)
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Result**: The release after the rollback, in the shape Output Format asks for: one table row with Name, Namespace, Revision, Updated, Status, Chart and App Version, or the whole release document as a map, as JSON or as YAML
- **Status**: The release state helm reports, like deployed or failed
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
