---
id: k8s-apply
description: Apply a pasted manifest, or build a ConfigMap, Secret or Job from a short form
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-27"
    changelog:
      - "Full implementation released"
      - "Define with Manifest applies YAML or JSON, including several documents separated by ---"
      - "Define with Form builds a ConfigMap, a Secret of any of the three common types, or a Job from an image or an existing CronJob"
      - "If exists chooses between updating the object and refusing when it is already there"
      - "Secret data is a field of its own, encoded for you and hidden everywhere the run is recorded"
---

The K8s Apply plugin writes objects into the cluster through the K8s Session a K8s Connect block produced. It covers what `kubectl apply` covers: paste a manifest and apply it as it stands, or fill in a short form for one of the three kinds a test writes most often. The result comes back as the applied object, or as JSON or YAML text.

**Use Cases:**
- Stand up the fixtures a test needs, then assert on what the cluster made of them
- Create a ConfigMap or a Secret that later blocks read back
- Run a one-off Job from an image, or trigger an existing CronJob now without waiting for its schedule
- Re-apply the same manifest in a loop and check that nothing drifts

**Behavior:**
- Define with has two modes. Manifest applies the YAML or JSON you paste, and several documents separated by `---` are applied in order. Form builds one object from named fields, for ConfigMap, Secret or Job only. Anything else goes in a manifest
- A ConfigMap form takes Data as keys and values. Point a value at a secret variable to keep it out of the config
- A Secret form takes a Secret Type first. Opaque takes any keys. `kubernetes.io/tls` offers `tls.crt` and `tls.key`, and `kubernetes.io/dockerconfigjson` offers `.dockerconfigjson`. WAVE encodes the values for you, so do not paste base64, and the values are hidden everywhere the run is recorded. A Secret keeps its Data in a field of its own, so hiding it never hides a ConfigMap's. Kubernetes fixes a Secret's type when it is created and will not let it change
- A Job form runs either an image you name, with an optional command written as you would type it in a shell, or an existing CronJob, which runs the same thing the schedule would have run
- If exists decides what happens when the object is already there. Update brings it to match and can be run again safely. Fail creates it and refuses when it is already there
- Output Format decides the shape of Result. In Form mode the first option is Map, the applied object. In Manifest mode it is Array, one applied object per document. JSON and YAML are the same objects as text
- Namespace is empty by default, which uses the namespace the session carries. It is ignored for cluster-scoped kinds like Namespace, and a manifest that names its own namespace wins
- Impersonate user and Impersonate groups send the request as another identity, to check what a role is allowed to do
- On error decides what a cluster-side error does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. A bad session, a connection or TLS failure, or a timeout fails the block either way

**Parameters:**
- **K8s Session**: The session from a K8s Connect block (required, secret)
- **Timeout**: Request timeout in seconds (default: 30)
- **Define with**: Manifest or Form (default: Manifest)
- **Manifest**: The object to apply, as YAML or JSON (required in Manifest mode)
- **Kind**: ConfigMap, Secret or Job (default: ConfigMap, required in Form mode)
- **Name**: The object's name (required in Form mode)
- **Data**: The keys and values to store. A ConfigMap form and a Secret form each keep their own field, so Secret values are hidden everywhere the run is recorded while ConfigMap values stay readable
- **Secret Type**: Opaque, kubernetes.io/tls or kubernetes.io/dockerconfigjson (default: Opaque)
- **Job from**: Image or CronJob (default: Image)
- **CronJob Name**: The CronJob to copy (required when Job from is CronJob)
- **Image**: The container image to run (required when Job from is Image)
- **Command**: The command to run in the container
- **If exists**: Update or Fail (default: Update)
- **Output Format**: In Manifest mode Array, JSON or YAML (default: Array). In Form mode Map, JSON or YAML (default: Map)
- **Namespace**: Apply into a namespace other than the session's; empty uses the session's
- **Impersonate user / Impersonate groups**: Send the request as another identity
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Summary**: One row per object: the resource and what happened to it, as kubectl prints it
- **Result**: What was applied. Its type follows Output Format: a map for a form, an array for a manifest, or text for JSON and YAML
- **Names**: The names of the objects applied, in the order they were applied
- **Count**: How many objects were applied
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue
