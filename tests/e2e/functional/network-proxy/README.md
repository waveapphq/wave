# Settings > Network > Proxy

The Proxy setting (REQ-4.7.14) sends the web requests made from the WAVE host
through a proxy. `v-network-proxy-functional.spec.ts` saves each proxy through
Settings > Network > Proxy > Setup and proves the route with a run: every
target is a compose DNS name that only the proxy can resolve, so an answer
from it came through the proxy and a name resolution failure is a direct
connection.

| Case id | Spec | Fixture | Proves |
|---------|------|---------|--------|
| V-NET-PROXY-FUNCTIONAL, HTTP routes | `v-network-proxy-functional.spec.ts` | `fixture-http-routes.json` | The HTTP block on WAVE setting goes through the open proxy and on Off connects directly; an Exact and a Regex entry in "All addresses except the list" connect directly; "Only the addresses in the list" sends the listed address alone through the proxy |
| V-NET-PROXY-FUNCTIONAL, login proxy | same | `fixture-http-login.json` | The saved Username and Password get 200 over plain HTTP and over HTTPS, the password stays masked and out of the console; a wrong password and a removed password get the 407 text inside a Try/Catch |
| V-NET-PROXY-FUNCTIONAL, K8s and OpenSearch | same | `fixture-k8s-opensearch.json` | K8s Connect, K8s Get and an OpenSearch search reach their target only while the list sends it through the proxy |
| V-NET-PROXY-FUNCTIONAL, Helm | same | `fixture-helm.json` | Helm Install deploys a chart from the proxy-only chart repository on the proxy-only cluster, and cannot fetch the chart once the repository leaves the list |
| V-NET-PROXY-FUNCTIONAL, Shell Exec and config file | same | `fixture-shell-env.json` | A Shell Exec sees no proxy variable while the Custom proxy is on; the stack's config file holds the setting with a sealed password |

Registered under the `functional-workflow` project of
`playwright.functional.config.ts` (`network-proxy/**`). The five tests run in
series, because the Proxy setting is shared by everything that runs against the
same backend.

The behavior of the two pages that needs no request to travel (the checks while
typing, what a Save keeps, the remembered sections, announced messages and
keyboard focus) is in `v-network-proxy-pages-functional.spec.ts`, described in
its own section at the end of this file.

## Prerequisites

- Backend and frontend running, and the shared execution environment
  (`ensureEnvironment` creates it if absent). The backend has no
  `HTTPS_PROXY`, `HTTP_PROXY` or `NO_PROXY` of its own (the last test checks
  this over `GET /network/proxy`).
- The real-service stack (see `tests/e2e/services/README.md`): `http-proxy`
  (9458, open), `http-proxy-auth` (9459, login `wave` / `proxy-secret`),
  `http-target`, `tls-lab`, `kwok-internal` and `opensearch`. helm must be on
  the PATH of the machine the backend runs on (the E2E runner image carries
  it).

  ```bash
  ./scripts/e2e-stack.sh up --wait http-proxy http-proxy-auth http-target tls-lab kwok-internal opensearch
  ```

- The proxies are dialed at `HTTP_TARGET_HOST`. The proxy-only targets are
  `http-target` (9444 plain, 9443 HTTPS), `tls-lab` (9463, the chart
  repository), `kwok-internal` (6443) and `opensearch` (9200); they are the
  same in host mode and in a container shard, so no fixture address is
  rewritten.
- The fixtures store no secret: the spec fills the WAVE Test CA, the kwok
  token and CA and the OpenSearch password from `helpers/config.ts`, and
  checks every block address against the same constants. `__TOKEN__` names
  the run's OpenSearch index (`wave-e2e-<token>-proxy`, seeded with the ten
  F-LOGS documents through the published port and deleted afterwards).
  `__NAMESPACE__` and `__RELEASE__` are new for each Helm run; the workflow
  creates and removes both on `kwok-internal` itself.
- Retry Count is 0 on every HTTP block, so a failing leg fails at once.
- `resetNetworkSettings` runs before and after every test: each test starts
  and ends with the proxy off.

## Steps

Every proxy change goes through the page: open
`/settings/network/proxy/setup`, edit, press Save, and read
`GET /network/proxy` back. Every run imports the fixture as a new test via
`POST /tests` (no repairs), confirms `POST /tests/{id}/validate?context=run`
reports zero errors, opens it in the workbench, sets the console to DEBUG
(the proxy line is a DEBUG line), picks the shared environment, presses Run
and waits for the run to pass and for the bookend line. The console is read
from its copy text (full source column), the outputs from the session
variables.

1. **HTTP routes.** Turn "Use a proxy" on, choose Custom, type the address
   and 9458, Save, run. Add an Exact entry `http://http-target:9444` and a
   Regex entry `^https://HTTP-TARGET(:\d+)?$`, Save, run. Choose "Only the
   addresses in the list" with the Exact entry alone, Save, run.
2. **Login proxy.** Custom with 9459, Username `wave`, Password
   `proxy-secret`, "Only the addresses in the list" with both `http-target`
   addresses, Save, reload the page, run. On the masked Password press
   "Delete & Edit", type a wrong password, Save, run. "Delete & Edit" again,
   Save with the field empty, run.
3. **K8s and OpenSearch.** Seed the index. Custom with 9458 and "Only the
   addresses in the list" holding `https://kwok-internal:6443`, Save, run.
   Replace the entry with the Regex `^https://opensearch:9200$`, Save, run.
4. **Helm.** Custom with 9458 and "Only the addresses in the list" holding
   `https://kwok-internal:6443` and `http://tls-lab:9463`, Save, run. Remove
   the chart repository entry, Save, run with new names.
5. **Shell Exec and config file.** Custom with 9459, the login, "Only the
   addresses in the list" with an Exact and a Regex entry, "Use the proxy for
   local addresses too" on, Save. Read the config file whose path
   `GET /server/status` reports as `config_file`. Run.

## Validation

- **Proxy line:** every block whose request went through the proxy writes
  `Using the proxy {host}:{port}` exactly once, at DEBUG, from its own source;
  no other block writes one. Each run's list of these lines is compared
  whole.
- **A direct connection** to a proxy-only name fails with
  `[Errno -2] Name or service not known` or
  `[Errno -3] Temporary failure in name resolution` (the resolver's answer
  differs by host).
- **HTTP routes, empty list:** WAVE setting gets 200 and the body
  `{"status":"healthy","port":9443}` from `http://http-target:9444/api`, 200
  from `http://tls-lab:9463/index.yaml`, and 200 from
  `https://http-target:9443/echo`, whose echo names the host
  `http-target:9443`; three proxy lines. The block on Off fails directly:
  the Try/Catch catches it, the catch branch logs `route-off caught`, the
  block shows `data-execution-status="failed"`.
- **HTTP routes, Exact and Regex in "All addresses except the list":** the
  plain block (Exact) and the HTTPS block (Regex, typed in capitals) fail
  directly; the chart repository, not in the list, still answers 200 with the
  one proxy line of the run.
- **HTTP routes, "Only the addresses in the list":** the plain block answers
  200 with the one proxy line; the chart repository and the HTTPS port of the
  same host fail directly.
- **Login proxy, right login:** 200 over plain HTTP and over HTTPS, the
  echoed request carries no `proxy-authorization` header, one
  `Using the proxy {host}:9459` line per block. After Save and after a reload
  the Password row holds the masked button "Password: Edit protected value" and no
  input; `GET /network/proxy` answers `password_set: true` and no password;
  the config file holds `password: wave:enc:v1:...` and no `proxy-secret`.
  Neither `proxy-secret` nor its Basic value is in any rendered console line
  or in the copied log text.
- **Login proxy, wrong password and removed password:** both blocks fail with
  `Proxy {host}:9459 refused the connection to http-target:9444: 407 Proxy Authentication Required`
  (9443 for HTTPS). For each: the ERROR line `Block '{name}' failed: {text}`,
  the WARN line `Try-path error caught: {text}`, the catch-branch line
  `login-plain caught` / `login-tls caught`, the Log line that prints the
  caught message, `data-execution-status="failed"` on the HTTP block, success
  on the Try/Catch and on the Log blocks, no proxy line, and a passed run.
  After the removal `password_set` is false and the config file holds
  `password: null`.
- **K8s and OpenSearch, the cluster in the list:** K8s Connect reads a
  `v1.33` version, K8s Get reads the one Namespace `default`, each with one
  proxy line; the search records Reason `Unreachable` and
  `Could not connect to OpenSearch at opensearch:9200: {name failure}`, Total
  results 0, the WARN `Search failed (Unreachable): {error}`, amber.
- **K8s and OpenSearch, the search in the list:** the search finds the 6
  ERROR documents with one proxy line; K8s Connect fails with
  `Could not read the Kubernetes version from https://kwok-internal:6443: Could not connect to the Kubernetes API at https://kwok-internal:6443: {name failure}`,
  caught by its Try/Catch, and K8s Get never runs.
- **Helm, both addresses in the list:** the release row reads `deployed`,
  chart `wave-demo-0.1.0`, revision 1, in the run's namespace; the console
  carries `Installed release '{release}' as revision 1` and
  `Uninstalled release '{release}'`; the K8s Delete removes 1 namespace; one
  proxy line each from K8s Connect, Helm Install, Helm Uninstall and K8s
  Delete.
- **Helm, the cluster alone in the list:** Helm Install records Success
  false, Reason `Unreachable` and helm's own text
  `INSTALLATION FAILED: ... Get "http://tls-lab:9463/index.yaml": dial tcp: lookup tls-lab ...`,
  an empty Status and the release table with no row, amber.
- **Shell Exec:** the HTTP block of the same run answers 200 through the
  login proxy; the `env` output holds `PATH`, no variable whose name contains
  `proxy`, and no `proxy-secret`; the only proxy line is the HTTP block's.
- **Config file:** `network.proxy` holds `enabled: true`, `source: custom`,
  the host, `port: 9459`, `username: wave`, `list_mode: only`,
  `proxy_local_addresses: true`, both entries with their kind and address,
  and a sealed `password`; the file holds `proxy-secret` nowhere.

## Proxy pages: `v-network-proxy-pages-functional.spec.ts`

Guards what the two pages Settings > Network > Proxy > Setup and Blocks do by
themselves, with no request sent through a proxy: the checks while typing, what a
Save keeps and discards, the open state of the Blocks sections, the messages a
screen reader hears and where keyboard focus lands (NET-1, NET-10, NET-11, SHELL-9,
SHELL-10, MCP-7; REQ-4.7.14, REQ-4.7.16, REQ-5.2.1.50, REQ-3.1.3.5).

### Prerequisites

- Backend and frontend running on the worker's stack ports. No compose service is
  used: the proxy address and login are only saved and read back, never dialed.
- The backend runs with no `HTTPS_PROXY`, `HTTP_PROXY` or `NO_PROXY` variable, as
  every containerized run does. Test 1 checks this first.
- `resetNetworkSettings` (`tests/e2e/helpers/network-settings.ts`) runs before and
  after every test, so each test starts with the proxy off and leaves it off. The
  tests run in series.
- Tests 9 to 12 start from a saved Custom proxy seeded through
  `PATCH /network/proxy`: `HTTP_TARGET_HOST`, `PROXY_AUTH_PORT`, `PROXY_AUTH_USER`,
  `PROXY_AUTH_SECRET`, "Only the addresses in the list" with the one entry
  `https://intranet.example.test`, and the local addresses switch on. Every saved
  proxy of this spec uses "Only" with a reserved `*.example.test` name, so no real
  address of the stack is ever routed through it.
- Tests 7 and 8 read the stack's own config file (path from `GET /server/status`).

### Steps

1. Run `./scripts/e2e-targeted-local.sh functional/network-proxy/v-network-proxy-pages-functional.spec.ts`.
2. Test 1: open Proxy Setup, turn "Use a proxy" on, choose Custom, type an address
   and a port, choose "WAVE host's settings" again, press Cancel.
3. Test 2: Custom with an address and a port; add `https://intranet.example.test`,
   choose "Only the addresses in the list"; add the same address as row 2, change
   it to `https://wiki.example.test:8443`, add a trailing slash, remove it; Save
   and reload.
4. Test 3: Custom with an address and a port; choose "Only the addresses in the
   list", then "All addresses except the list", then "Only" again and add one
   address; Save.
5. Test 4: Custom with an address, a port and one listed address; type `wave:admin`
   as Username, then `wave`; Save.
6. Test 5: open Proxy Blocks; click the "Not applicable" header twice.
7. Test 6: open Proxy Blocks, close "Blocks that use this proxy" and open "Not
   applicable"; go to General and back, to Dashboard and back, reload; close
   "Blocks that do not use this proxy" and reload; open the page in a new browser
   context.
8. Test 7: save Custom with the login proxy, its username and password, one "Only"
   address and the local addresses switch; turn "Use a proxy" off, Save, reload;
   turn it on, choose Custom, type an address, then a port.
9. Test 8: turn the proxy on, choose Custom, type `http://proxy` as the address;
   turn the proxy off, Save; turn it on and choose Custom.
10. Test 9: on the seeded proxy choose "WAVE host's settings"; then ask
    `POST /network/proxy/validate` with that source alone, with that source plus
    bad Custom values, and with Custom plus the same bad values; send the refused
    `PATCH`.
11. Test 10: on the seeded proxy type `http://proxy` as the address, then `12`
    after it; add a trailing slash to the list entry, then `ab` after it; put the
    saved address back, then the saved entry.
12. Test 11, keyboard only on the seeded proxy: Tab to the masked Password, Enter,
    Escape; Enter, Tab to Cancel, Enter; Enter, Tab to "Delete & Edit", Enter; type
    a password; Cancel on the page.
13. Test 12 on the seeded proxy: click into Username, open the question from the
    masked Password with a dispatched click (it moves no focus, as a click on a
    button does in WebKit), click Cancel; click into Username, open the question
    the same way, click "Delete & Edit", type a password.

### Validation

- **Test 1:** the three variables read "Not set"; the one message on the page is
  `This WAVE host has no HTTPS_PROXY or HTTP_PROXY set: choose Custom or turn the proxy off`,
  it is the description of the Source control and its line sits under the control;
  Save is disabled. Custom with no address shows the two "required" messages and
  with an address and a port enables Save; the WAVE host chosen again brings the
  message back and disables Save. `GET /network/proxy` still answers the defaults,
  and `PATCH /network/proxy` with that source answers 400 with the same text.
- **Test 2:** row 2 with the address of row 1 shows `The same address as entry 1`
  under row 2 only, marked `aria-invalid`, Save disabled; another address enables
  Save. The trailing slash shows `Remove everything after the host and port` under
  row 2, Save disabled; without it Save is enabled. After Save the API holds both
  entries in order and a reload shows them.
- **Test 3:** "Only" with no row shows
  `Add at least one address, or choose "All addresses except the list"` under "Use
  the proxy for", Save disabled; the other mode enables Save; "Only" with one
  address enables Save and the API holds `list_mode: only` with that entry.
- **Test 4:** `Username must not contain a colon` shows under Username, marked
  `aria-invalid`, Save disabled; `wave` is saved; a `PATCH` with the colon answers
  400 with the same text and the saved name stays.
- **Test 5:** the page has its title and no Cancel or Save. "Blocks that use this
  proxy" shows the groups Network, Database, Kubernetes, Helm with HTTP alone under
  Network; "Blocks that do not use this proxy" shows System with Shell Script,
  Shell Exec, Python. "Not applicable" shows no block until its header is clicked,
  then Network (Ping, Netcat), Remote, Database, System, Data. Each section holds
  as many blocks as `GET /network/proxy/blocks` lists for it, and no block shows
  twice.
- **Test 6:** after each of the three ways back the headers carry `aria-expanded`
  false / true / true and only the open sections show blocks; with the middle
  section closed a reload gives false / false / true; the new browser context gives
  true / true / false.
- **Test 7:** after the first Save the API holds every typed value with
  `password_set: true`, the Password row shows the masked field, and the proxy part
  of the config file holds the entry and a sealed password, never the typed one.
  After "off" and Save the API answers the defaults and the proxy part of the
  config file is exactly what it was before the first Save. Turned on again the
  source is "WAVE host's settings"; under Custom the address, port and username are
  empty, there is no masked field, the mode is "All addresses except the list", the
  list has no row and the local addresses switch is off. Save stays disabled with
  the two "required" messages, then with the Port one, and is enabled once both are
  typed.
- **Test 8:** `http://proxy` shows
  `IP or Hostname must be an IP address or a host name, with no protocol and no port`
  and Save is disabled; with the proxy turned off no message shows and Save is
  enabled; after Save the API answers the defaults, the config file does not hold
  `http://proxy`, and Custom shows an empty address.
- **Test 9:** the page shows the seeded values; with "WAVE host's settings" the
  Custom rows are gone, the one message is the missing-variable text under Source
  and Save is disabled. The check answers that one problem for the source alone
  and for the source plus bad Custom values; with Custom the same values give the
  address, port, username and list problems in that order. The refused `PATCH`
  answers 400 and the API still holds the seeded proxy. This stack's backend has no
  proxy variable, so the saved result of that choice is proven by the backend unit
  tests, not here.
- **Test 10:** before any message the region beside IP or Hostname and the one
  beside entry 1 are on the page with `aria-live="polite"` and no text. The message
  arrives inside that same region, its id is the field's `aria-describedby`, the
  field is `aria-invalid`, and nothing on the page is an alert. After two more
  characters with the same message the region has had no further change. A
  corrected field empties the same region.
- **Test 11:** after Escape and after Cancel the masked Password holds focus and
  Cancel and Save stay disabled. After "Delete & Edit" the empty Password input
  holds focus, the typed keys are its value and Username is unchanged. The API
  still holds the saved password, and Cancel on the page brings the masked field
  back.
- **Test 12:** after Cancel focus is on the masked Password, not in Username.
  After "Delete & Edit" focus is in Password, the typed keys are its value and
  Username is unchanged. The API still holds the saved password.
