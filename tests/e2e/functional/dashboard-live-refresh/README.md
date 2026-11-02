# Dashboard Live Refresh Functional Test (REQ-3.2.2.17)

Verify that the Dashboard's Recent Executions section auto-updates without any user click on a Refresh button.

## Prerequisites

- Backend + frontend stack running (host mode spins them up via `playwright.functional.config.ts`).
- E2E environment seeded via `ensureEnvironment` in the test setup.

## Steps

1. Open http://localhost:3000/dashboard.
2. Verify the Live-refresh indicator in the header reads `Live`.
3. Without interacting with the Dashboard, start a tracked test execution via `POST /executions`.
4. Wait for the new execution's card to appear in the Recent Executions list.
5. Wait for that card's status to transition from `running` to `passed`.

## Validation

- **No user click**: the test never invokes any Refresh button; the card appears and updates purely via the container's 5 s polling.
- **Card appears within the cache + poll envelope**: once started, the running execution becomes visible in Recent Executions inside one cache-TTL + poll-interval window.
- **Status transition is reflected**: after the 1 s delay completes on the backend, the same card flips to the `passed` status without any user action.
- **Live pill remains green throughout**: the header indicator stays `data-status="live"` for the whole happy path; no flap to `reconnecting`.
