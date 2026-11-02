---
id: helm-upgrade
description: Upgrade a release to a chart version or a set of values, optionally installing it when absent
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-04"
    changelog:
      - "Full implementation released"
      - "Install if missing turns an upgrade of an absent release into an install"
      - "Reuse Values and Reset Values untick each other, and helm's own values rules are stated on the sheet"
      - "Atomic rolls a failed upgrade back; Cleanup on Fail removes what the failed upgrade newly created"
      - "Result follows Output Format: the release as a table row, as the release document, or as JSON or YAML text"
---

The Helm Upgrade plugin upgrades an existing release, through the K8s Session a K8s Connect block produced. It runs the real `helm upgrade`: WAVE ships no helm of its own, it calls the helm found where the block runs. Every control is a helm flag, named as helm names it and carrying helm's own default. With Install if missing on, an upgrade of a release that is not there installs it instead of failing.

**Use Cases:**
- Move a release to a new chart version and assert on what changed
- Change one value and check the workload picks it up
- Upgrade or install in one block, so the same test works on a clean cluster and on a dirty one
- Prove an upgrade rolls itself back when the new revision does not come up

**Behavior:**
- Chart takes what helm's own chart argument takes: a name resolved against Repository URL, a reference into an OCI registry, a URL to a packaged chart, or a path on the machine where the block runs. Version pins a version or a range, and empty takes the newest the repository offers
- The values in effect follow helm's own rules. With no Values and no Set passed, the previous release's values are kept. With values passed and neither Reuse Values nor Reset Values ticked, the previous values are forgotten: what applies is the chart's defaults plus what you passed. Reuse Values starts from the current release's values and applies Values and Set on top. Reset Values goes back to the chart's defaults even when nothing is passed
- Reuse Values and Reset Values untick each other: ticking one clears the other. Both may be off, and they are never both on
- Auth & TLS carries the credentials and trust of the chart's source only, a chart repository or an OCI registry: a user name, a password that is a declared credential, a CA certificate, and Verify Server Certificate, on by default. The cluster's own trust travels in the session
- helm runs with a clean environment that WAVE builds for each call. Registry logins stored on the machine it runs on are not used, whether made with `helm registry login` or with Docker. A private chart is pulled with Repository Username and Repository Password, which also reach an OCI registry
- From the WAVE host, helm's connections to the cluster and to the chart repository or registry follow Settings > Network > Proxy. A chart source connects directly in two cases, whatever that setting says: when it is on a local address, and when it is on the cluster's own host and port, or on a name under that host, while the cluster itself connects directly. On a remote host helm uses that host's own proxy settings
- A local chart directory whose dependencies are not downloaded yet: run `helm dependency update <dir>` from a Shell Script block first
- Install if missing installs the release when it does not exist yet, instead of failing. Create Namespace shows only while it is on, because that is the only state helm applies the namespace flag in
- Nothing waits for readiness, which is helm's own default. Compose a wait from Helm Status or K8s Get under a Wait Until control
- Atomic is the exception: helm waits for the release to come up within Timeout and, when it does not, rolls the release back to its previous revision. Cleanup on Fail deletes the resources the failed upgrade newly created, which a rollback alone would leave behind
- Timeout is helm's own operation timeout, 300 seconds by default, and the block is stopped the moment it runs out. Atomic and Cleanup on Fail add a Cleanup Timeout on top of it: helm has failed by then, and that is the room it gets to roll the release back and remove what it created. The block's whole bound is the two added together
- Output Format decides the shape of Result. Table is one row with helm's own list columns. Map is the release document helm reports. JSON and YAML are that same document as text, notes and rendered manifest included
- Namespace is empty by default, which uses the namespace the session carries
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- Helm Path names the helm to run. Empty runs the helm on the PATH of wherever the block runs: the WAVE host, or the execution host when the block sits inside a Remote Execution container. A bare name is looked up on that PATH; an absolute path is called as it stands; a relative path starts at the home folder of the account the block runs as. Bind the row to an environment or global variable to set it once for a team. A missing helm fails the block under either On error setting, naming what was tried and, on a remote host, the host it was tried on
- The blocks emit only flags that behave the same on helm 3.13 and later and on every helm 4, so one block works against whichever helm a machine carries. WAVE never asks helm for its version on its own initiative; only when helm rejects a flag as unknown does WAVE read the version once and report that the helm it found is older than 3.13
- Which Kubernetes versions a helm supports is helm's own policy, the four minors up to the one it was built against. WAVE adds no check of its own
- helm 4 installs charts written for helm 3 and upgrades releases helm 3 created, but a release helm 4 created may not be manageable by helm 3. That matters when the WAVE server and a remote execution host carry different majors: install from one and the older helm on the other may refuse to upgrade the release
- The session reaches helm as a kubeconfig written for one call and deleted after it. The server URL, credentials, certificate authority, server-name override and verification choice all carry across. The session's cipher-suite and TLS-version pins do not, because they cannot bind a helm process
- On error decides what a helm refusal does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A missing helm, an unreadable session, or a failure before helm runs fails the block either way
- Reason carries one of a fixed set, so a workflow branches on it and never on text. **NotFound**: the release, the chart or the repository was not found. **AlreadyExists**: a name is already in use, or a resource is still in use. **Forbidden**: the cluster denied the request. **Timeout**: helm's timeout ran out, or the process passed WAVE's deadline. **Invalid**: the chart, the values or a flag was rejected. **Unreachable**: the cluster or the chart repository could not be reached. **Failed**: everything else, including a release or hook that failed

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: How long helm gets to finish the operation, in seconds (default: 300)
- **Release Name**: The release to upgrade (required)
- **Chart**: A name in a repository, a path to a local directory or archive, or an OCI reference (required)
- **Version**: The chart version to use; empty takes the newest the repository offers
- **Repository URL**: The chart repository to fetch from; leave empty for a local path or an OCI reference
- **Values**: Values applied over the chart's own defaults, as YAML
- **Set**: Single values to override, one entry per key; nested keys use dots
- **Install if missing**: Install the release when it does not exist yet, instead of failing (default: off)
- **Reuse Values**: Start from the current release's values and apply Values and Set on top; unticks Reset Values (default: off)
- **Reset Values**: Start from the chart's own defaults and apply Values and Set on top; unticks Reuse Values (default: off)
- **Output Format**: Table, Map, JSON or YAML (default: Table)
- **Repository Username / Repository Password**: What the chart repository asks for; the password is a declared credential
- **Repository CA Certificate**: The PEM bundle that verifies the chart repository's certificate; when set, it is the only certificate trusted. Empty trusts the certificates WAVE trusts (Settings > Network > Certificates)
- **Verify Server Certificate**: Check the chart repository's certificate against Repository CA Certificate when it is set, otherwise against the certificates WAVE trusts (default: on)
- **Namespace**: Upgrade in a namespace other than the session's; empty uses the session's
- **Create Namespace**: Create the namespace first when it does not exist yet; offered only while Install if missing is on (default: off)
- **Helm Path**: The helm executable to run: a name looked up on the PATH, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs helm from the PATH
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **Atomic**: Roll the release back to its previous revision when the upgrade fails (default: off)
- **Cleanup on Fail**: Delete the resources this upgrade created when it fails, instead of leaving them behind (default: off)
- **Cleanup Timeout**: How long helm gets to undo the failed upgrade, in seconds, on top of Timeout. Offered only while Atomic or Cleanup on Fail is on (default: 300)
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Result**: The release in the shape Output Format asks for: one table row with Name, Namespace, Revision, Updated, Status, Chart and App Version, or the whole release document as a map, as JSON or as YAML
- **Status**: The release state helm reports, like deployed, failed or pending-upgrade
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
