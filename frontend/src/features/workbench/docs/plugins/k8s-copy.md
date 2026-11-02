---
id: k8s-copy
description: Copy files and directories between a pod and the WAVE side, in either direction
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-30"
    changelog:
      - "Full implementation released"
      - "Direction From Pod or To Pod, with fixed Source Path and Target Path rows whose meaning follows it"
      - "The WAVE side is an artifact path or an absolute or relative path where the block runs"
      - "Files and whole directories, moved with tar the way kubectl cp moves them"
      - "Summary reports one row per file, with its source, target and size"
      - "Max size (MiB) and Max files in Advanced for From Pod, 256 and 10,000 by default; 0 means no limit"
      - "From Pod writes each file to disk as it arrives; crossing a limit stops the copy and removes what it wrote"
---

The K8s Copy plugin copies files and directories between a pod and the WAVE side, over the same exec channel K8s Exec uses, through the K8s Session a K8s Connect block produced. It covers what `kubectl cp` covers, and like kubectl it moves the files with tar.

**Use Cases:**
- Pull a log, a dump or a report out of a container and keep it with the run
- Push a fixture file, a config or a script into a pod before another block uses it
- Copy a whole directory out of a pod and assert on what is in it
- Place a file an earlier block in the same test wrote inside a container

**Behavior:**
- Direction says which way the file moves. From Pod copies out of the pod onto the WAVE side, To Pod copies from the WAVE side into the pod
- Source Path and Target Path keep those names in both directions. Which of the two is the pod path and which is the WAVE path follows Direction, and each row says which it is
- The WAVE side is the run's artifacts. An `artifact://` path followed by a relative path lands in the run's artifact directory, and an absolute or relative path also resolves where the block runs: a relative path starts at the home folder of the user the WAVE server runs as on WAVE, and at the SSH user's home folder on the remote host inside a Remote Execution body. There is no upload from the browser, so a push takes a file an earlier block in the same test wrote
- A directory is copied whole, the way kubectl cp copies it, and its files land under the target
- No Preserve is unticked by default, which is kubectl's default and means permissions and ownership carry over. Tick it to leave them behind
- The copy runs tar inside the container. A pull needs `tar` there; a push needs a shell, `base64` and `tar`
- A push stages the encoded archive next to the target, in a directory it creates itself and removes when the copy finishes. That filesystem needs about two and a half times the size of what is being pushed free while the copy runs
- The copy never uses the command's standard input, so it runs on the same clusters K8s Exec runs on
- A copy from the pod is written to disk as it arrives, so WAVE's memory does not grow with its size. Max size (MiB), 256 by default, and Max files, 10,000 by default, bound it; 0 means no limit. Crossing either stops the copy at once, removes what it had written and puts back any file it had replaced as it was
- To Pod carries no size limit, because the files it copies come from the WAVE side
- There is no Retries row. kubectl's retry flag is for long copies over flaky links, and a failed copy is already covered by the block's own error handling
- Container is required. A pod with more than one container makes the cluster refuse a call that does not name one, and WAVE does not choose one for you the way kubectl does
- Namespace is empty by default, which uses the namespace the session carries. Otherwise it is the namespace the pod is in
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 60)
- **Direction**: From Pod or To Pod (default: From Pod)
- **Pod**: The pod to copy from or to (required)
- **Container**: Which container in the pod to use, named even when the pod has only one (required)
- **Source Path**: What to copy: the path inside the pod with Direction From Pod, the path on the WAVE side with To Pod (required)
- **Target Path**: Where to put it: the path on the WAVE side with Direction From Pod, the path inside the pod with To Pod (required)
- **No Preserve**: Do not carry the file's permissions and ownership across (default: off)
- **Namespace**: The namespace the pod is in; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **Max size (MiB)**: Largest total a copy from the pod may write (default: 256; 0 means no limit) (From Pod)
- **Max files**: Most files a copy from the pod may write (default: 10000; 0 means no limit) (From Pod)
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Summary**: One row per file: where it came from, where it landed, and its size
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
