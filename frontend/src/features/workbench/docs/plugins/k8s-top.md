---
id: k8s-top
description: Measure CPU and memory usage of pods or nodes through the metrics API
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-22"
    changelog:
      - "Full implementation released"
      - "One block measures pods or nodes, all of them, one by name, or the ones matching a label selector"
      - "Per-container breakdown for pods, capacity and allocatable for nodes"
      - "Raw quantities converted from the wire units, never percentages"
---

The K8s Top plugin measures CPU and memory usage through the K8s Session a K8s Connect block produced. It covers what `kubectl top pod` and `kubectl top node` cover, in one block: Measure picks pods or nodes, and Select by picks all of them, one by name, or the ones that match a label selector.

**Use Cases:**
- Assert that a pod stays under a memory ceiling while a load test runs
- Compare node usage before and after a rollout
- Record per-container usage for a pod and log it with the run

**Behavior:**
- Measure pods or measure whole nodes. Node numbers include the kubelet and other system processes, not just pods
- Select by All measures every pod or node, Name one by name, Selector the ones matching the Label Selector
- Include containers, offered for pods, reports usage per container instead of one total per pod
- Raw quantities are returned, never percentages, so the test picks its own denominator. The wire units are converted: cpu comes back as cores and memory as bytes. Nodes also carry capacity and allocatable in the same units
- Namespace is empty by default, which measures pods in the namespace the session carries; fill it in to measure another one. All namespaces, offered in All and Selector mode, measures pods in every namespace at once and hides Namespace while it is on. Nodes are not namespaced, so the namespace rows are not offered for them
- Impersonate user and Impersonate groups send the request as another identity
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A cluster with no metrics API fails the block either way, as does a bad session, a connection or TLS failure, or a timeout

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 30)
- **Measure**: Pods or Nodes (default: Pods)
- **Select by**: All, Name or Selector (default: All)
- **Name**: The pod or node name to measure (required in Name mode)
- **Label Selector**: Match pods or nodes by label in Selector mode, like app=web
- **Include containers**: Report usage per container (default: off)
- **All namespaces**: Measure pods in every namespace in All and Selector mode (default: off)
- **Namespace**: Measure pods in a namespace other than the session's; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Usage**: A table, one row per pod, container or node. Pods give NAME, CPU and MEMORY, with CONTAINER added when Include containers is on; nodes add CAPACITY CPU, CAPACITY MEMORY, ALLOCATABLE CPU and ALLOCATABLE MEMORY. Cpu is in cores and memory in bytes, and a node the metrics API does not report comes back with empty cpu and memory
- **Count**: How many rows Usage holds: pods, containers when Include containers is on, or nodes
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
