---
id: k8s-delete
description: Delete one Kubernetes object by name, or every object a selector matches
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-27"
    changelog:
      - "Full implementation released"
      - "Delete by Name or by Selector, with Ignore not found turning an already-gone name into a pass"
      - "Kind picker with the 23 stock kinds in five groups, plus a Custom resource type for any other kind"
      - "Cascade Background, Foreground or Orphan, and an optional grace period"
      - "Wait until gone keeps checking until the object is really gone, within the block's timeout"
---

The K8s Delete plugin removes objects from the cluster through the K8s Session a K8s Connect block produced. It covers what `kubectl delete` covers: one object by name, or every object of the kind that matches a label selector, with the same cascade and grace-period choices kubectl offers.

**Use Cases:**
- Tear down the fixtures a test created, so the next run starts clean
- Delete every pod carrying a label and watch the workload bring them back
- Remove an object and assert that a dependent one goes with it, or survives as an orphan
- Delete something that may or may not be there, without failing the test

**Behavior:**
- Delete by has two modes. Name deletes one object and, as in kubectl, a name that is already gone is an error unless Ignore not found is ticked. Selector deletes every object of the kind that matches the Label Selector
- Resource Type Default offers the 23 kinds a stock cluster serves, grouped and searchable by kubectl short name. Custom takes any other kind as plain text, including custom resources; a kind the cluster does not serve fails the block
- Cascade decides what happens to the children. Background returns at once and the cluster removes them after. Foreground waits until the children are gone. Orphan leaves them running
- Grace Period is how long the object gets to shut down. 0 removes it immediately. Leave it empty for the kind's own default
- Wait until gone is on by default, matching kubectl: the block keeps checking until the object is really gone, within the block's timeout. Untick it to return as soon as the cluster accepts the delete
- Namespace is empty by default, which uses the namespace the session carries. It is ignored for cluster-scoped kinds like Node or PersistentVolume
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 30)
- **Resource Type**: Default or Custom (default: Default)
- **Kind**: The resource kind, from the picker or typed as the cluster names it (required)
- **Delete by**: Name or Selector (default: Name)
- **Name**: The object's name (required in Name mode)
- **Label Selector**: Match objects by label, like app=web or tier in (a,b) (required in Selector mode)
- **Ignore not found**: Treat a name that is already gone as a success (default: off)
- **Cascade**: Background, Foreground or Orphan (default: Background)
- **Grace Period (s)**: How long the object gets to shut down; empty uses the kind's default
- **Wait until gone**: Keep checking until the object is really gone (default: on)
- **Namespace**: Delete from a namespace other than the session's; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Summary**: One row per object: the resource and what happened to it, as kubectl prints it
- **Names**: The names of the objects deleted, in the order the cluster reported them
- **Count**: How many objects were deleted; 0 when a selector matched nothing
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
