# V-NET-PAGES-FUNCTIONAL: Settings > Network page guards

One spec, `v-network-settings-pages-functional.spec.ts`, guards how the Network
pages sit in the app, how the three with settings - SSH Hosts, Certificates and
Proxy Setup - hold unsaved changes, and how the Network and Proxy menu groups
remember the user's choice (NET-1, NET-3, NET-10, SHELL-9, SETTINGS-1, SETTINGS-2,
LIST-2; REQ-4.5.14, REQ-4.5.16, REQ-4.7.14, REQ-4.7.16, REQ-5.2.1.42, REQ-5.2.1.50).

## Prerequisites

- Backend and frontend running on the worker's stack ports. No compose service is
  needed: nothing here connects to an SSH host, an HTTPS server or a proxy. The
  proxy address is only saved, never used: `HTTP_TARGET_HOST` and `PROXY_PORT`
  from `tests/e2e/helpers/config.ts`.
- `resetNetworkSettings` (`tests/e2e/helpers/network-settings.ts`) runs before and
  after every test, so each test starts from the stack's three trusted hosts, no
  additional certificates, the default policy and the proxy off, and leaves them
  that way.
- Seeds go through the API: hosts through `PATCH /network/ssh-hosts` with freshly
  generated ED25519 keys and unique `net-pages-*.example.test` names; the one
  additional certificate is the WAVE Test CA (`CA_CERT_PEM`) through
  `PATCH /network/certificates`; one blank test through `POST /tests`, deleted at
  the end of the test that made it.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/network-settings-pages/v-network-settings-pages-functional.spec.ts`.
2. Criterion 1: trust 30 more hosts, open SSH Hosts, then Certificates, at 1280x800. Wheel
   over the hosts table body (SSH Hosts) and over the authorities choice
   (Certificates).
3. Criterion 2: trust 30 more hosts and create one test. At 1440x900, then 1440x640, open
   `/tests` and measure its pagination, then SSH Hosts and measure its pagination;
   wheel over the hosts table body.
4. Criterion 3, four times: Lock trusted hosts switched on (SSH Hosts), a seeded host's
   trash icon (SSH Hosts), the seeded certificate's trash icon (Certificates), a
   Custom proxy (Proxy Setup: "Use a proxy" on, Source "Custom", the address and
   the port typed, then wait until Save is enabled).
   Each time: load the page, stage the change, Cancel, stage it again, Save, reload.
5. Criterion 4, for SSH Hosts (Lock trusted hosts) and Certificates (the seeded
   certificate's trash icon), once per exit - the General section, the Dashboard
   app nav item, browser Back - and for Proxy Setup (the Custom proxy), once per
   exit - the General section, and Blocks in the Proxy group. Open General, open
   the page from the Network group, stage the change, leave and press Cancel;
   leave and press Discard, then come back in-app; stage again, leave and press
   Save, then reload the page. Then open the page clean and leave it by each exit
   in turn.
6. Criterion 5, once for the Network group (opened through SSH Hosts) and once for the
   Proxy group inside it (opened through Proxy Setup): open the page, go to MCP
   Server; collapse the group, go to Dashboard and back to Settings, reload on
   General; expand the group, go to Dashboard and back, reload on General.

## Validation

- **Criterion 1, both pages:** the app nav and its Dashboard link are visible; the document
  is exactly as tall as the viewport and the window's scroll position stays 0;
  the wheel scrolls the part of the Settings content column that overflows - the
  hosts table body on SSH Hosts, the whole column on Certificates - and the
  Settings section list (and on SSH Hosts the pagination) keep their boxes.
- **Criterion 2, both sizes:** the pagination reads `Showing 1-10 of 33 hosts`; its gap to
  the bottom of the viewport matches the `/tests` pagination gap within 1px; the
  hosts table body overflows and scrolls while the window, the pagination and the
  section list stay put.
- **Criterion 3, each change:** freshly loaded, Cancel and Save are disabled at opacity 0.5;
  after the staged change both are enabled at opacity 1; after Cancel both are
  disabled, the page shows the saved state and the API still holds it; after Save
  both are disabled, the API holds the change, and a reload shows it with both
  disabled. For Proxy Setup the API is `GET /network/proxy`: it answers
  `enabled: true`, `source: custom`, the address and the port only after Save.
- **Criterion 4, each page and exit:** leaving with a staged change opens "Unsaved changes"
  with Cancel, Discard and Save while the URL and the page stay. Cancel closes it,
  the change is still staged and Cancel and Save stay enabled. Discard arrives at
  `/settings` (section, Back), `/dashboard` (app nav) or
  `/settings/network/proxy/blocks` with the Proxy Blocks page showing, the API
  never got the change, and the page opened again in-app shows the saved state
  with both buttons disabled. Save arrives at the same target, the API holds the
  change, and the reloaded page shows it with both buttons disabled. A clean page
  reaches every target with no dialog.
- **Criterion 5, each group:** the group is expanded on its own page and stays expanded on
  MCP Server, with its first page listed. Collapsed, it stays collapsed after
  Dashboard and back and after a reload on General, and its pages are not listed.
  Expanded again, it stays expanded after Dashboard and back and after a reload
  on General.
