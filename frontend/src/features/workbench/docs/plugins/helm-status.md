---
id: helm-status
description: Read a release, current or by revision, into a result and a status a Wait Until can poll
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-04"
    changelog:
      - "Full implementation released"
      - "Revision reads an earlier revision; empty reads the current one"
      - "Status is a scalar output, so Wait Until polls it directly"
      - "Result follows Output Format: the release as a table row, as the release document, or as JSON or YAML text"
      - "Timeout here is WAVE's bound on the read, not a helm operation timeout"
---

The Helm Status plugin reads a release, through the K8s Session a K8s Connect block produced. It runs the real `helm status`: WAVE ships no helm of its own, it calls the helm found where the block runs. It changes nothing, so it is the block a Wait Until control polls while a release comes up.

**Use Cases:**
- Wait for a release to reach deployed after an install or an upgrade, under a Wait Until control
- Assert on a release's revision, chart version or app version
- Read an earlier revision to compare it with the current one
- Read the rendered manifest or the chart's notes out of the release document

**Behavior:**
- Revision reads an earlier revision of the release. Leave it empty to read the current one
- Status is also a scalar output, so a Wait Until control polls it directly without digging into Result. A release that is not there, including one Atomic removed, reads as absent
- Timeout on this block is WAVE's bound on the read, 30 seconds by default, not a helm operation timeout: helm status has no timeout flag. The block is stopped and fails with a timeout the moment it runs out
- Output Format decides the shape of Result. Table is one row with helm's own list columns. Map is the release document helm reports. JSON and YAML are that same document as text, notes and rendered manifest included
- Namespace is empty by default, which uses the namespace the session carries
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to read
- Helm Path names the helm to run. Empty runs the helm on the PATH of wherever the block runs: the WAVE host, or the execution host when the block sits inside a Remote Execution container. A bare name is looked up on that PATH; an absolute path is called as it stands; a relative path starts at the home folder of the account the block runs as. Bind the row to an environment or global variable to set it once for a team. A missing helm fails the block under either On error setting, naming what was tried and, on a remote host, the host it was tried on
- The blocks emit only flags that behave the same on helm 3.13 and later and on every helm 4, so one block works against whichever helm a machine carries. WAVE never asks helm for its version on its own initiative; only when helm rejects a flag as unknown does WAVE read the version once and report that the helm it found is older than 3.13
- Which Kubernetes versions a helm supports is helm's own policy, the four minors up to the one it was built against. WAVE adds no check of its own
- helm 4 installs charts written for helm 3 and upgrades releases helm 3 created, but a release helm 4 created may not be manageable by helm 3. That matters when the WAVE server and a remote execution host carry different majors: install from one and the older helm on the other may refuse to read the release
- The session reaches helm as a kubeconfig written for one call and deleted after it. The server URL, credentials, certificate authority, server-name override and verification choice all carry across. The session's cipher-suite and TLS-version pins do not, because they cannot bind a helm process
- On error decides what a helm refusal does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. Record and continue is what a Wait Until poll uses, so a release that is not there yet does not end the test. A missing helm, an unreadable session, or a failure before helm runs fails the block either way
- Reason carries one of a fixed set, so a workflow branches on it and never on text. **NotFound**: the release or the revision was not found. **AlreadyExists**: a resource is still in use. **Forbidden**: the cluster denied the request. **Timeout**: the read passed WAVE's deadline. **Invalid**: helm rejected the request or a flag. **Unreachable**: the cluster could not be reached. **Failed**: everything else

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 30)
- **Release Name**: The release to read (required)
- **Revision**: The revision to read; empty reads the current one
- **Output Format**: Table, Map, JSON or YAML (default: Table)
- **Namespace**: Read a release in a namespace other than the session's; empty uses the session's
- **Helm Path**: The helm executable to run: a name looked up on the PATH, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs helm from the PATH
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Result**: The release in the shape Output Format asks for: one table row with Name, Namespace, Revision, Updated, Status, Chart and App Version, or the whole release document as a map, as JSON or as YAML
- **Status**: The release state helm reports, like deployed, failed or pending-upgrade. This is the output a Wait Until control polls
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
