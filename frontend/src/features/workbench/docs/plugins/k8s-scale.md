---
id: k8s-scale
description: Set the replica count on a Deployment, ReplicaSet, ReplicationController or StatefulSet
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-27"
    changelog:
      - "Full implementation released"
      - "Kind offers the four kinds a stock cluster serves a scale endpoint for, plus a Custom resource type"
      - "Replicas accepts 0, scaling the object down to nothing"
      - "Summary reports the replica count before and after"
---

The K8s Scale plugin writes one replica count onto one scalable object, through the K8s Session a K8s Connect block produced. It covers what `kubectl scale` covers: name the object, say how many replicas it should run, and the cluster does the rest.

**Use Cases:**
- Scale a Deployment up before a load step and back down after
- Scale a workload to 0 and assert that its traffic fails the way the test expects
- Bring a StatefulSet to a known replica count so the rest of the test starts from a fixed state
- Check that a role is allowed, or not allowed, to change a replica count

**Behavior:**
- Resource Type Default offers the four kinds a stock cluster serves a scale endpoint for: Deployment, ReplicaSet, ReplicationController and StatefulSet. Custom takes any other kind as plain text, including custom resources, and a kind with no scale endpoint is refused before anything is written
- Replicas is required. 0 is allowed and scales the object down to nothing
- The block writes the count and returns. It does not wait for the pods to come up or go away; use a K8s Rollout Status or a Wait Until control for that
- Namespace is empty by default, which uses the namespace the session carries. Otherwise it is the namespace the object is in
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 30)
- **Resource Type**: Default or Custom (default: Default)
- **Kind**: The kind to scale, from the four scalable kinds or typed as the cluster names it (default: Deployment)
- **Name**: The object's name (required)
- **Replicas**: How many replicas to run (required)
- **Namespace**: The namespace the object is in; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Summary**: One row per object: the resource, what happened to it, and the replica count before and after
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
