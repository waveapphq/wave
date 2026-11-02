---
id: k8s-events
description: Read Kubernetes events for a namespace or one object, filtered by type, reason, age and count
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-22"
    changelog:
      - "Full implementation released"
      - "Namespace-wide or scoped to one object by kind and name"
      - "Filters on event type, reason, age and count, sorted newest first"
      - "Output Format Array, Table, JSON or YAML"
      - "Object Kind picked from the built-in kind list, or typed under Object Type Custom"
      - "Result declares the type its Output Format returns"
---

The K8s Events plugin reads the cluster's event stream through the K8s Session a K8s Connect block produced. It covers what `kubectl get events` covers: every event in a namespace, across all namespaces, or only the events about one object, filtered down to what the test is looking for.

**Use Cases:**
- Find the Warning events behind a pod that will not start, like BackOff or FailedScheduling
- Assert that no Warning event was recorded for a Deployment during a rollout
- Read the last few events about one object and log them when a check fails

**Behavior:**
- With Scope to object off, every event in the namespace is read. With it on, only the events about the named object are read; the kind is resolved the way kubectl resolves it, so Pod, pod, pods and po all reach the same kind, and a kind this cluster does not serve fails the block; a deleted object of the same name still shows its events until the cluster discards them
- Event Type keeps both types, or only Warning, or only Normal. Event Reason keeps events with that reason. Max Age keeps events last seen within that many seconds, and Max Events caps how many come back
- Events are sorted newest first inside the block; it is not a parameter
- Output Format decides the shape of Result. Events always read a list, so the first option is Array, the parsed list. Table is the printed table with every column the cluster returns, and JSON and YAML are the same objects as JSON or YAML text. Count is populated in every format, and in every format the objects come back without their managedFields bookkeeping, the way kubectl prints them
- Namespace is empty by default, which reads from the namespace the session carries; fill it in to read from another one. All namespaces reads events from every namespace at once, and hides Namespace while it is on
- Impersonate user and Impersonate groups send the request as another identity
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 30)
- **Scope to object**: Return only the events about one object (default: off)
- **Object Type**: Default picks the kind from the built-in list, Custom takes any other kind (default: Default, offered when scoped)
- **Object Kind / Object Name**: The object the events are about (required when scoped)
- **Event Type**: Any, Warning or Normal (default: Any)
- **Event Reason**: Keep only events with this reason
- **Max Age (s)**: Keep only events last seen within this many seconds
- **Max Events**: Keep at most this many events, newest first
- **Output Format**: Array, Table, JSON or YAML (default: Array)
- **All namespaces**: Read events from every namespace (default: off)
- **Namespace**: Read events from a namespace other than the session's; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Result**: The events that passed the filters, newest first. Its type follows Output Format: the parsed list for Array, a table for Table, text for JSON and YAML
- **Count**: How many events were kept
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
