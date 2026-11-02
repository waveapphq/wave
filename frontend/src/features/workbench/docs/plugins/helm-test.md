---
id: helm-test
description: Run a release's chart test hooks and report each hook's phase
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-04"
    changelog:
      - "Full implementation released"
      - "One Result row per test hook: Name, Kind, Phase, Started and Completed"
      - "Logs collects what each test pod printed, under helm's own per-pod headers"
      - "A chart with no tests reports an empty result and succeeds, as helm does"
      - "Under Record and continue a failed test still fills Result and Logs"
---

The Helm Test plugin runs a release's chart test hooks, through the K8s Session a K8s Connect block produced. It runs the real `helm test`: WAVE ships no helm of its own, it calls the helm found where the block runs. Every hook comes back as its own Result row, read from the release record rather than parsed out of helm's printed text, so a workflow asserts on a hook's phase directly.

**Use Cases:**
- Run the chart's own tests as a step of a larger WAVE test, and assert on each hook
- Collect a failing test pod's logs into the run, so the failure is diagnosable afterwards
- Run the tests again after an upgrade and compare the phases
- Check that a chart that ships no tests still passes cleanly

**Behavior:**
- Every test hook the release carries is reported as one Result row: its name, its kind, its phase, and when it started and completed. A chart with no tests gives an empty result and succeeds, which is what helm does
- Logs collects what each test pod printed and reports it in the Logs output, under helm's own per-pod headers. The Logs output is offered for binding only while the toggle is on, so an author who never asks for logs never sees a Logs variable
- Timeout is helm's own operation timeout, 300 seconds by default. The block is stopped and fails with a timeout the moment it runs out
- Output Format decides the shape of Result. Table is the row-per-hook summary. Map, JSON and YAML are the release document helm reports, as a map or as text
- Namespace is empty by default, which uses the namespace the session carries
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- Helm Path names the helm to run. Empty runs the helm on the PATH of wherever the block runs: the WAVE host, or the execution host when the block sits inside a Remote Execution container. A bare name is looked up on that PATH; an absolute path is called as it stands; a relative path starts at the home folder of the account the block runs as. Bind the row to an environment or global variable to set it once for a team. A missing helm fails the block under either On error setting, naming what was tried and, on a remote host, the host it was tried on
- The blocks emit only flags that behave the same on helm 3.13 and later and on every helm 4, so one block works against whichever helm a machine carries. WAVE never asks helm for its version on its own initiative; only when helm rejects a flag as unknown does WAVE read the version once and report that the helm it found is older than 3.13
- Which Kubernetes versions a helm supports is helm's own policy, the four minors up to the one it was built against. WAVE adds no check of its own
- helm 4 installs charts written for helm 3 and upgrades releases helm 3 created, but a release helm 4 created may not be manageable by helm 3. That matters when the WAVE server and a remote execution host carry different majors: install from one and the older helm on the other may refuse to test the release
- The session reaches helm as a kubeconfig written for one call and deleted after it. The server URL, credentials, certificate authority, server-name override and verification choice all carry across. The session's cipher-suite and TLS-version pins do not, because they cannot bind a helm process
- On error decides what a helm refusal does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. This block deviates from the family in one way: under Record and continue a failed test still fills Result and Logs, because each hook's phase and its logs exist and are what the test is for. A missing helm, an unreadable session, or a failure before helm runs fails the block either way
- Reason carries one of a fixed set, so a workflow branches on it and never on text. **NotFound**: the release was not found. **AlreadyExists**: a resource is still in use. **Forbidden**: the cluster denied the request. **Timeout**: helm's timeout ran out, or the process passed WAVE's deadline. **Invalid**: helm rejected the request or a flag. **Unreachable**: the cluster could not be reached. **Failed**: everything else, and the usual one here - a test pod that failed

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: How long helm gets to finish the operation, in seconds (default: 300)
- **Release Name**: The release whose test hooks to run (required)
- **Logs**: Collect what each test pod printed and report it in the Logs output (default: off)
- **Output Format**: Table, Map, JSON or YAML (default: Table)
- **Namespace**: Test a release in a namespace other than the session's; empty uses the session's
- **Helm Path**: The helm executable to run: a name looked up on the PATH, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs helm from the PATH
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Result**: One row per test hook: its name, kind, phase and when it started and completed. A chart with no tests gives an empty result
- **Logs**: What the test pods printed, in the sections helm prints them in. Offered only while Logs is on
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
