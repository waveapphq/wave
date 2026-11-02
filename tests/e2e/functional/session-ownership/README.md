# Session Ownership & Live Mirroring

Two-context E2E proof that one holder edits while every other viewer mirrors
read-only, the full take-over protocol, and the tab-lifetime rules that keep a
session from being lost while its tab is still open.

## Prerequisites

- Backend + frontend E2E stack (started by the Playwright config / `ci-playwright-local.sh`).
- No seed for the mirror / take-over / continuity walks. Each test drives the
  single GLOBAL ownership slot directly and resets it (force -> release) in
  `beforeEach` / `afterEach`.
- The continuity test that opens another test seeds one extra Test via `POST /tests` (the other test the
  watcher opens).

## Steps

Each test opens two or three isolated browser contexts (distinct "users")
against one backend. The first to open `/workbench` claims the editing lock;
the others mirror read-only.

## Specs

- `v-sess-mirror-functional.spec.ts` - live canvas + variable mirroring, the
  read-only lock (canvas `data-readonly`, environment selector, debug gear,
  Run, Debug, Variable Manager create + row mutation), the holder liveness
  signal and the "N watching" pill, and the assistant-held See connection
  deep-link.
- `v-sess-takeover-functional.spec.ts` - request / approve / deny, force
  (replaces the holder's open approval modal with the taken-over outcome; no
  toast), cancel (retracts the pending request), and the holder leaving, which
  promotes nobody: every watcher detaches to the amber no-holder banner and
  becomes the holder only by pressing Take Session.
- `v-sess-continuity-functional.spec.ts` - the session belongs to the tab: the
  browse-away / reload / come-back walk with a watcher present, the
  holder keeping the session while it is away from the Workbench, and a
  mirroring tab opening another test without an unsaved-changes dialog.

## Validation

Every assertion anchors on observable state - the holder banner text and its
`data-holder-kind`, the `data-readonly` canvas, disabled controls and their
explanatory tooltips, the outcome-modal copy, a mirrored node / variable, and
the backend `/workbench/ownership` holder - so losing a behavior breaks the
test (REQ-5.2.7.15 / REQ-5.2.7.16).
