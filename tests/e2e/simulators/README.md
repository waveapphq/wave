# Retired: in-process protocol simulators

The in-process simulators are gone. All external-protocol E2E coverage runs
against the real compose service stack - see `../services/README.md` (managed
by `scripts/e2e-stack.sh`).

## Why this directory still exists

`simulators/https/` is retained ONLY as the container image source for the
stack's `http-target` and `http-echo` services (one shared image whose
Containerfile COPYs `simulators/https/`; `tls-lab` also copies `certs/ca.pem`).
The `certs/` PKI carries the pinned WAVE Test CA trust anchor exported as
`CA_CERT_PEM`. Nothing starts
`server.ts` in-process anymore - no Playwright `webServer` entry, no shard
start block, no `HTTPS_SIMULATOR_PORT` / `HTTPS_HEALTH_PORT` constants.

Do not add new simulators here. A protocol the stack can serve for real gets a
service in `../services/`.
