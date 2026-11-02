# WAVE Server Sessions

Two/three-context E2E proof that every connected browser Workbench session is a
first-class, administratively visible, terminable connection: it appears in the
WAVE Server roster with an Active (holder) / Watching (mirror) role, the person
mirror banner is traceable to it via See Connection, and Disconnect ends it for
real.

## Prerequisites

- Backend + frontend E2E stack (started by the Playwright config / `ci-playwright-local.sh`).
- No seed. Each test opens real browser contexts against one backend; the
  Workbench tabs register themselves in the session registry via the WebSocket
  `identify` frame, and the tests reset the global ownership slot
  (force -> release) in `beforeEach` / `afterEach` and close every opened
  context in `afterEach`.

## Steps

Each test opens isolated browser contexts (distinct "browsers"). The first to
open `/workbench` claims the editing lock (its roster row reads Active); a
second mirrors read-only (Watching). A neutral third context views
`/settings/server` to drive the roster UI (its own tab is a settings page, not a
Workbench session, so it never joins the roster).

## Spec

- `v-wave-server-sessions-functional.spec.ts`
  - roster lists the real holder + mirror with Active / Watching roles
    (persisted `/server/status` roles AND the rendered pills);
  - the person mirror banner names the connection identity and its ungated See
    Connection deep-links to the holder's Active row (highlighted, no "From your
    workbench" chip - that chip is MCP-only);
  - per-row Disconnect (confirmation-gated) boots the target tab to `/dashboard`
    with the admin-disconnect modal, drops its row, and it does not reappear;
  - Disconnect Others spares the caller and boots the rest, then Disconnect All
    boots the caller too (driven at the endpoint because the roster UI's caller
    is a settings tab, never itself a roster member);
  - closing a Workbench tab removes its row promptly (graceful leave);
  - the Frontend fact card advertises the single serving origin.

## Validation

Every assertion anchors on observable state - the backend `/server/status`
roster + `active_session_id` / `watching_session_ids`, the rendered role pills,
the terminated tab's `/dashboard` redirect + `admin-disconnect-dialog` modal, and
the deep-link `data-highlighted` row - so losing a behavior breaks the test. The
timed dead-connection reaper (abrupt drop, ~1-2 min) is proven at the backend
unit layer (`backend/tests/websocket/test_manager_session_tracking.py`); this
suite proves the deterministic graceful-leave path.
