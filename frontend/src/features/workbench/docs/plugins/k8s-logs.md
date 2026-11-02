---
id: k8s-logs
description: Read one container's log from a pod, with tail, age, timestamp and size limits
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-22"
    changelog:
      - "Full implementation released"
      - "One pod and one container per block, with the previous instance on request"
      - "Tail Lines, Since, Timestamps and Max Bytes limits"
      - "Output Format String or one line at a time, which Timestamps names Array when off and a TIME and MESSAGE table when on"
---

The K8s Logs plugin reads a container's log from one pod through the K8s Session a K8s Connect block produced. It covers what `kubectl logs` covers: the running container or its previous, terminated instance, cut down by line count, age and size.

**Use Cases:**
- Assert that a service logged a line after a request was sent
- Capture the last lines of a crashing container and attach them to a failure
- Read the previous instance's log to see why a container restarted

**Behavior:**
- One pod per block; there is no label selector
- Container is required. A pod with more than one container makes the cluster refuse a call that does not name one, and WAVE does not choose one for you the way kubectl does
- Previous Instance reads the terminated instance instead of the running one, and fails when the container has not restarted
- Tail Lines counts back from the end, Since reads back that many seconds, and Max Bytes stops reading after that many bytes; anything past it is cut off. Leave them empty for the whole log
- Timestamps prefixes every line with the time the container wrote it. It also names the second Output Format option, so it takes a literal on or off rather than an expression
- Output Format decides the shape the log comes back in. String is the raw text. The other option splits the log line by line: it reads Array with Timestamps off, one entry per line, and Table with Timestamps on, two columns holding the time and the message. Ticking Timestamps renames that option, it does not clear the choice
- Namespace is empty by default, which reads from the namespace the session carries; fill it in to read from another one. There is no All namespaces, because kubectl logs has no such flag
- Impersonate user and Impersonate groups send the request as another identity
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 30)
- **Pod**: The pod to read from (required)
- **Container**: Which container in the pod to use, named even when the pod has only one (required)
- **Previous Instance**: Read the previous, terminated instance (default: off)
- **Tail Lines**: How many lines to return, counting back from the end
- **Since (s)**: How far back to read, in seconds
- **Timestamps**: Prefix every line with its time (default: off)
- **Output Format**: String or Array with Timestamps off, String or Table with Timestamps on (default: String)
- **Max Bytes**: Stop reading after this many bytes
- **Namespace**: The namespace the pod is in; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Logs**: The log, cut to Tail Lines, Since and Max Bytes. Its type follows Output Format: text for String, one entry per line for Array, a row per line for Table
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
