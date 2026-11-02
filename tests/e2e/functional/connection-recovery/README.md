# Connection Recovery (Functional)

Spec: `v-conn-recovery-functional.spec.ts`

Verifies the FE's BE-outage handling end-to-end - the connection-monitor
probe, the offline banner, and the route-content remount on reconnection.

## Pre-requisites

- A backend on the per-worker port (the standard playwright stack).
- No fixture or seed required - the test only needs `/tests` to respond
  successfully when not mocked.

## Execution steps

1. Open `/tests` (real BE: list loads, banner not present).
2. Capture initial request count for `/api/tests`.
3. Mock every `**/api/**` request to return the dev proxy's 502 body
   (`Cannot reach the backend at <address>`).
4. Reload `/tests` so the list hook fires a fresh fetch under the mock.
5. Assert the banner appears.
6. Replace the mock so `**/api/health` returns `200 healthy` while
   everything else still 502s.
7. Click "Retry" on the banner (forces an immediate probe).
8. Assert the banner clears.
9. Drop ALL route mocks so the real BE serves `/api/tests` again.
10. Assert the request count for `/api/tests` increased after the
    banner cleared - this proves the route content remounted via the
    `dataEpoch` mechanism and re-fetched, without a full page reload.

## Validation criteria

- **Outage detected**: the offline banner is visible after the first
  502 response from a real api-client request.
- **Recovery clears banner**: with /api/health 200, clicking Retry hides
  the banner within the probe window.
- **Content refreshes without full reload**: a NEW `/api/tests` request
  is observed after the banner clears, while the page's URL/document
  identity is unchanged (no `window.location.reload()`).

---

# Connection Reason (Functional)

Spec: `v-conn-reason-functional.spec.ts`

Verifies that the two outages the browser reports identically - nothing
listening at the backend address, and requests blocked for origin policy -
reach the user as different, actionable reasons.

## Pre-requisites

- A backend on the per-worker port (the standard playwright stack).
- No fixture or seed required.

## Execution steps

1. Land on the app shell with a clean client store.
2. Abort the one supporting read the Profiles page blocks on, at the network
   level, so the client asks for a diagnosis. Every other read still reaches
   the real backend, so the shell and the route render normally.
3. Abort the health probe too, so nothing answers at the address.
4. Open Profiles and read the reason from the blocked card's details panel.
5. Repeat with one change: let the no-cors diagnosis probe answer while the
   real read still fails. That is the shape of an origin rejection.

## Validation criteria

- **Unreachable**: the reason reads `Cannot reach the backend at <address>`.
- **Origin rejected**: the reason instead says the backend at that address is
  running but rejected requests from this origin, and names the origin to add.
- **Not interchangeable**: the origin-rejected reason never carries the
  unreachable wording.
- **No missing status**: neither reason contains `undefined` or `NaN`.
