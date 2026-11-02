---
id: k8s-get
description: Read one Kubernetes object by name, or a list by selector, in the format the test wants
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-22"
    changelog:
      - "Full implementation released"
      - "Search by Name, Selector or List, with Name failing on a missing object and the list modes returning an empty list"
      - "Kind picker with the 23 stock kinds in five groups, plus a Custom resource type for any other kind"
      - "Output Format Map, Table, JSON or YAML in Name mode, and Array, Table, JSON or YAML in Selector and List mode, with Names and Count populated in every format"
      - "Result declares the type its Output Format and Search by return"
---

The K8s Get plugin reads objects of one kind from the cluster through the K8s Session a K8s Connect block produced. It covers what `kubectl get` covers: one object by name, the objects that match a label or field selector, or every object of the kind. The result comes back as a parsed structure, a printed table, or JSON or YAML text.

**Use Cases:**
- Check that a Deployment, Pod, Service or any other object exists and read its current state
- List the pods behind a label selector and assert on how many there are
- Read a ConfigMap or Secret value and feed it into later blocks
- Pull the cluster's own printed table for a kind and assert on its columns

**Behavior:**
- Search by has three modes. Name reads one object and fails the block when it is not there. Selector reads the objects matching the Label Selector and Field Selector. List reads every object of the kind. Selector and List read a list, and an empty list is a pass with Count 0
- Resource Type Default offers the 23 kinds a stock cluster serves, grouped and searchable by kubectl short name. Custom takes any other kind as plain text, including custom resources; a kind the cluster does not serve fails the block
- Output Format decides the shape of Result, and its first option is named after what the mode returns: Map, the parsed object, in Name mode, and Array, the parsed list, in Selector and List mode. Table is a WAVE table carrying every column the cluster prints, with column names verbatim. JSON and YAML are the same objects as JSON or YAML text. Names and Count are populated in every format, and in every format the objects come back without their managedFields bookkeeping, the way kubectl prints them
- Namespace is empty by default, which reads from the namespace the session carries; fill it in to read from another one. All namespaces, offered in Selector and List mode, reads across every namespace at once and hides Namespace while it is on. Both are ignored for cluster-scoped kinds like Node or PersistentVolume
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to read
- Reading kind Secret registers every data value with the run's secret registry, so the values are masked wherever they surface
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 30)
- **Resource Type**: Default or Custom (default: Default)
- **Kind**: The resource kind, from the picker or typed as the cluster names it (required)
- **Search by**: Name, Selector or List (default: Name)
- **Name**: The object's name (required in Name mode)
- **Label Selector / Field Selector**: Selector mode filters, like app=web or status.phase=Running
- **Output Format**: In Name mode Map, Table, JSON or YAML (default: Map). In Selector and List mode Array, Table, JSON or YAML (default: Array)
- **All namespaces**: Read across every namespace in Selector and List mode (default: off)
- **Namespace**: Read from a namespace other than the session's; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Result**: What the cluster returned. Its type follows Output Format: a map for one named object, an array for a Selector or List read, a table for Table, text for JSON and YAML
- **Names**: The names of the objects read
- **Count**: How many objects were read
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
