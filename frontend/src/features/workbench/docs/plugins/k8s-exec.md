---
id: k8s-exec
description: Run one command line in a pod and capture its stdout, stderr and exit code
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-30"
    changelog:
      - "Full implementation released"
      - "One command line per block, split the way a shell splits it, so quotes group arguments"
      - "Stdout, Stderr and Exit Code outputs, with a non-zero exit code returned as data"
      - "Container is required, because a pod with more than one container makes the cluster refuse a call that does not name one"
---

The K8s Exec plugin runs one command line inside a pod, over the cluster's exec channel, through the K8s Session a K8s Connect block produced. It covers what `kubectl exec` covers: name the pod, write the command as you would type it in a shell, and read back what it wrote and what it returned.

**Use Cases:**
- Check a file, a process or an environment variable inside a running container
- Run a service's own health or admin command and assert on what it prints
- Read the exit code of a command and branch on it
- Check that a role is allowed, or not allowed, to exec into a pod

**Behavior:**
- Command is one string, split the way a shell splits it, so quotes group arguments: `sh -c "echo hi there"` is three arguments. A command with an unclosed quote is rejected before anything is sent to the cluster
- The command is run directly and not through a shell, exactly as kubectl runs it, so pipes, redirects and globs only work when you invoke a shell yourself with `sh -c "..."`
- There is nothing to type on the command's standard input. One command line goes in, and standard output, standard error and the exit code come back. Use K8s Script for a multi-line program
- Exit Code is data, not a failure. A non-zero code is returned and the block still succeeds; assert on it, or branch on it
- Container is required. A pod with more than one container makes the cluster refuse a call that does not name one, and WAVE does not choose one for you the way kubectl does
- Namespace is empty by default, which uses the namespace the session carries. Otherwise it is the namespace the pod is in
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 60)
- **Pod**: The pod to run the command in (required)
- **Container**: Which container in the pod to use, named even when the pod has only one (required)
- **Command**: One command line, written as you would type it in a shell (required)
- **Namespace**: The namespace the pod is in; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Stdout**: Everything the command wrote to standard output
- **Stderr**: Everything the command wrote to standard error
- **Exit Code**: The exit code the command returned. A non-zero code is returned as data, not treated as a failure
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
