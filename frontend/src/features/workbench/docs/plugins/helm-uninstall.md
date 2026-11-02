---
id: helm-uninstall
description: Remove a release, optionally keeping its history so it can still be rolled back
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-04"
    changelog:
      - "Full implementation released"
      - "Keep History leaves the release history behind so the release can still be rolled back"
      - "Ignore Not Found turns a release that is already gone into a pass"
      - "Cascade Background, Foreground or Orphan, as helm offers it"
      - "Reports the shared outcome outputs only: once the release is gone there is nothing left to describe"
---

The Helm Uninstall plugin removes a release, through the K8s Session a K8s Connect block produced. It runs the real `helm uninstall`: WAVE ships no helm of its own, it calls the helm found where the block runs. Once the release is gone there is nothing left to describe, so this is the one Helm block with no Result, no Status and no Output Format row.

**Use Cases:**
- Tear down the release a test installed, so the next run starts clean
- Remove a release that may or may not be there, without failing the test
- Keep the history on the way out, so a later block can still roll the release back
- Check what a cascade choice leaves behind

**Behavior:**
- Keep History keeps the release history so the release can still be rolled back after it is removed. Without it the history goes with the release
- Ignore Not Found treats a release that is already gone as a success instead of an error, which is what makes an uninstall safe to run twice
- Cascade decides what happens to the children. Background returns at once and lets the cluster remove them after. Foreground waits until the children are gone. Orphan leaves them running
- Nothing waits for readiness, which is helm's own default. Compose a wait from Helm Status or K8s Get under a Wait Until control
- Timeout is helm's own operation timeout, 300 seconds by default. The block is stopped and fails with a timeout the moment it runs out
- Namespace is empty by default, which uses the namespace the session carries
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- Helm Path names the helm to run. Empty runs the helm on the PATH of wherever the block runs: the WAVE host, or the execution host when the block sits inside a Remote Execution container. A bare name is looked up on that PATH; an absolute path is called as it stands; a relative path starts at the home folder of the account the block runs as. Bind the row to an environment or global variable to set it once for a team. A missing helm fails the block under either On error setting, naming what was tried and, on a remote host, the host it was tried on
- The blocks emit only flags that behave the same on helm 3.13 and later and on every helm 4, so one block works against whichever helm a machine carries. Ignore Not Found is the newest flag the blocks emit and is what sets the 3.13 floor. WAVE never asks helm for its version on its own initiative; only when helm rejects a flag as unknown does WAVE read the version once and report that the helm it found is older than 3.13
- Which Kubernetes versions a helm supports is helm's own policy, the four minors up to the one it was built against. WAVE adds no check of its own
- helm 4 installs charts written for helm 3 and upgrades releases helm 3 created, but a release helm 4 created may not be manageable by helm 3. That matters when the WAVE server and a remote execution host carry different majors: install from one and the older helm on the other may refuse to remove the release
- The session reaches helm as a kubeconfig written for one call and deleted after it. The server URL, credentials, certificate authority, server-name override and verification choice all carry across. The session's cipher-suite and TLS-version pins do not, because they cannot bind a helm process
- On error decides what a helm refusal does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A missing helm, an unreadable session, or a failure before helm runs fails the block either way
- Reason carries one of a fixed set, so a workflow branches on it and never on text. **NotFound**: the release was not found, and Ignore Not Found was off. **AlreadyExists**: a resource is still in use. **Forbidden**: the cluster denied the request. **Timeout**: helm's timeout ran out, or the process passed WAVE's deadline. **Invalid**: helm rejected the request or a flag. **Unreachable**: the cluster could not be reached. **Failed**: everything else, including a hook that failed

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: How long helm gets to finish the operation, in seconds (default: 300)
- **Release Name**: The release to remove (required)
- **Keep History**: Keep the release history so the release can still be rolled back (default: off)
- **Ignore Not Found**: Treat a release that is already gone as a success (default: off)
- **Cascade**: Background, Foreground or Orphan (default: Background)
- **Namespace**: Remove from a namespace other than the session's; empty uses the session's
- **Helm Path**: The helm executable to run: a name looked up on the PATH, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs helm from the PATH
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
