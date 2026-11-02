---
id: k8s-connect
description: Connect to a Kubernetes cluster and produce a secret kubectl-compatible session value
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-19"
    changelog:
      - "Full implementation released"
      - "Modeless credentials: optional bearer token and/or optional client certificate pair, any combination including none"
      - "Verifies cluster reachability and version (1.19 floor), then emits the secret K8s Session output"
      - "Optional Get SA Token mints a service account token for the requested duration and places it in the session"
---

The K8s Connect plugin verifies that a Kubernetes cluster is reachable, checks its version, and produces the K8s Session - a secret, kubectl-compatible value carrying the server URL, trust settings, credentials, and default namespace. Two K8s Connect blocks in one test give you two separate sessions, one for each cluster.

**Use Cases:**
- Keep the cluster address, trust settings, and credentials in one block, and hand them on as a single session value
- Validate credentials and cluster reachability up front, before any operational step runs
- Mint a short-lived service account token for the run instead of embedding a long-lived credential

**Behavior:**
- Calls the cluster's version endpoint and fails on clusters older than 1.19; the reported version is returned as an output
- Credentials are modeless, like a kubeconfig: the bearer token is optional, the client certificate pair is optional, and any combination works - including none for anonymous or proxied access
- The API URL is a full base URL (http or https, any port, optional path prefix), so gateway-mounted clusters work; every API call is joined under it
- Requests to the cluster made from the WAVE host follow Settings > Network > Proxy, for this block and for every block that uses its session. A block on a remote host does not use that setting
- With Get SA Token on, a service account token is requested for the configured duration (minimum 600 seconds); the cluster may cap it, the granted lifetime is logged, and the minted token replaces the bearer token inside the session
- The K8s Session output is kubectl-compatible and secret: its Secret checkbox is checked by default and unchecking it is a deliberate reveal
- Always hard-fails: a cluster that cannot be reached, verified, authenticated to, or version-checked is a block error; wrap the block in Try/Catch to tolerate it

**Parameters:**
- **API URL**: Full base URL of the Kubernetes API server (required)
- **Namespace**: Default namespace carried in the session (default: default)
- **Timeout**: Request timeout in seconds (default: 30)
- **Bearer Token**: Optional token sent in the Authorization header
- **Get SA Token**: Mint a service account token for the requested duration (default: off); reveals Service Account, SA Namespace, and Duration
- **Verify Server Certificate**: Check the server certificate against CA Certificate when it is set, otherwise against the certificates WAVE trusts (Settings > Network > Certificates) (default: on)
- **CA Certificate**: A variable reference or a PEM string; when set, it is the only certificate this block trusts
- **Client Certificate / Client Key**: PEM mutual-TLS identity material
- **TLS Server Name**: Hostname used for SNI and certificate verification through a tunnel or by IP
- **Min/Max TLS Version, Cipher Suites**: TLS protocol and cipher constraints, as on the HTTP plugin. Unset cipher suites offer every suite WAVE supports for the selected TLS version range, and the K8s Session always carries the exact suites offered

**Outputs:**
- **K8s Session**: Kubectl-compatible session carrying the server URL, trust settings, credentials, and default namespace (secret)
- **Cluster Version**: Version reported by the API server (e.g. v1.33.0)
