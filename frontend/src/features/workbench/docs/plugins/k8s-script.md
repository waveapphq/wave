---
id: k8s-script
description: Run a multi-line script in a pod through an interpreter that reads it on standard input
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-30"
    changelog:
      - "Full implementation released"
      - "The script is fed to the interpreter on standard input, so no file is written inside the container"
      - "Interpreter defaults to /bin/sh, may include flags, and is invoked as written with no -c added"
      - "Stdout, Stderr and Exit Code outputs, with a non-zero exit code returned as data"
      - "Requires Kubernetes 1.30 or newer"
---

The K8s Script plugin runs a multi-line script inside a pod, over the cluster's exec channel, through the K8s Session a K8s Connect block produced. The script is fed to an interpreter on its standard input, the same way SSH Session Script does it, so no file is written inside the container.

**Use Cases:**
- Run a multi-line shell or scripting-language program in a container without leaving a file behind
- Pick the interpreter per pod, such as /bin/sh, bash, python3, perl or node, without installing anything
- Do several steps in one place and read the exit code of the script as a whole
- Run a script in a container whose filesystem is read-only

**Behavior:**
- The script is written to the interpreter's standard input and the input is closed when the body ends. Nothing is written to a file and nothing rides in the command line, so a long script is fine
- This block requires Kubernetes 1.30 or newer. That is the first version whose exec channel can close standard input by default, and closing it is how the interpreter knows the script has ended. On an older cluster the block fails like any other block failure, carrying Error and Reason. To run a script on an older cluster, copy it in with K8s Copy and run it with K8s Exec
- Interpreter defaults to `/bin/sh` and may include flags, such as `bash -e`. It is split the way a shell splits a command line, and it is invoked as written, with no `-c` added
- There is no working directory, because kubectl exec has no such flag. Change directory in the first line of the script
- Exit Code is data, not a failure. A non-zero code is returned and the block still succeeds; assert on it, or branch on it
- Container is required. A pod with more than one container makes the cluster refuse a call that does not name one, and WAVE does not choose one for you the way kubectl does
- Namespace is empty by default, which uses the namespace the session carries. Otherwise it is the namespace the pod is in
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 60)
- **Pod**: The pod to run the script in (required)
- **Container**: Which container in the pod to use, named even when the pod has only one (required)
- **Interpreter**: The interpreter that reads the script, such as /bin/sh, bash, python3, perl or node; it may include flags (default: /bin/sh)
- **Script**: The script, fed to the interpreter on standard input (required)
- **Namespace**: The namespace the pod is in; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Stdout**: Everything the script wrote to standard output
- **Stderr**: Everything the script wrote to standard error
- **Exit Code**: The exit code the interpreter returned. A non-zero code is returned as data, not treated as a failure
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
