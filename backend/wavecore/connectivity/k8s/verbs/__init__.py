"""Synchronous Kubernetes verbs, shared by the local plugins and the remote bundle.

One module per verb exposes run(params, log) and returns a JSON-safe result
envelope; the underscore modules hold the helpers the verbs share. Every module
here imports the standard library, the sibling REST and WS cores and the bundled
TLS engine only, so the package can be copied onto a remote host as is
(REQ-5.1.1, REQ-3.4.1.5).
"""
