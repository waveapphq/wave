---
id: k8s-rollout
description: Restart a workload, report on its rollout, or roll it back to an earlier revision
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-27"
    changelog:
      - "Full implementation released"
      - "Operation Restart, Status or Undo on a Deployment, StatefulSet or DaemonSet"
      - "Undo takes an optional revision, and goes back to the previous one when it is left empty"
      - "Status returns the rollout verdict, ready to drive a Wait Until control"
---

The K8s Rollout plugin drives one workload through its rollout, using the K8s Session a K8s Connect block produced. It covers what `kubectl rollout` covers: restart the pods, report on how the current rollout is going, or roll the workload back to an earlier revision.

**Use Cases:**
- Restart a Deployment after changing the ConfigMap it reads and check it comes back healthy
- Wait for a rollout to finish before the rest of the test runs
- Roll a workload back to a known-good revision when a step fails
- Assert that a rollout reports failed when the new image is broken

**Behavior:**
- Operation has three modes. Restart replaces the pods with fresh ones. Status reports how the current rollout is going. Undo rolls the workload back to an earlier revision
- Kind offers the three kinds that have a rollout: Deployment, StatefulSet and DaemonSet. Anything else has no rollout to restart or report on
- To revision belongs to Undo alone. Leave it empty to go back to the previous revision
- Status is the only mode that returns a verdict, so the Status output is offered in that mode only. It reads complete, progressing or failed, which is what a Wait Until control needs
- Namespace is empty by default, which uses the namespace the session carries. Otherwise it is the namespace the workload is in
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 30)
- **Operation**: Restart, Status or Undo (default: Restart)
- **Kind**: Deployment, StatefulSet or DaemonSet (required, default: Deployment)
- **Name**: The object's name (required)
- **To revision**: The revision to roll back to, in Undo mode; empty goes back to the previous one
- **Namespace**: The namespace the workload is in; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Summary**: One row per object: the resource, what happened to it, and the cluster's own sentence about the rollout
- **Status**: The rollout verdict - complete, progressing or failed - in Status mode
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
