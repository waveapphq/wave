"""Synchronous Helm verbs, shared by the local plugins and the remote bundle.

One module per verb exposes run(params, log) and returns a JSON-safe result
envelope; the sibling _cli module holds the runner, the workspace and the
shaping helpers they share. Every module here imports the standard library and
the bundled Kubernetes core only, so the package can be copied onto a remote
host as is (REQ-3.5.3.1, REQ-3.4.1.5).
"""
