# V-NET-03: Settings > Network > Proxy > Setup and Blocks

Verify Proxy Setup in its off, host, custom and invalid-input states and Proxy Blocks with its section cards, in both themes. Nothing is saved.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
curl -sf -X POST http://localhost:8000/admin/enable -H "Content-Type: application/json" -d '{"reason": "E2E network reset"}'
curl -sf -X POST http://localhost:8000/admin/reset -H "Content-Type: application/json" -d '{"confirm": true, "scope": ["network"]}'
curl -sf -X POST http://localhost:8000/admin/disable
```

- Browser window 1396x900 (the scale the whole-page frames are drawn at).
- The proxy setting at its defaults (the `network` reset gives this): `GET http://localhost:8000/network/proxy` answers `enabled: false`, `source: "host"`, an empty list and three `null` host values, so the backend runs with no `HTTPS_PROXY`, `HTTP_PROXY` or `NO_PROXY`.
- The spec stages three states by laying values over the answer of `GET /network/proxy`; by hand, start a backend that has them:
  - **Host values:** `HTTPS_PROXY` and `HTTP_PROXY` set to `http://svc-wave:<password>@proxy.corp.example:3128`, `NO_PROXY` set to `.corp.example,localhost`.
  - **Custom:** "Use a proxy" on, Source Custom, IP or Hostname `proxy.corp.example`, Port `3128`, Username `svc-wave`, a saved password, and the Exact entries `https://registry.corp.example`, `http://10.20.0.15:9200` and `https://[2001:db8::1]:6443`.
- The spec answers `POST /network/proxy/validate` itself: no problem for the host and custom states, the four messages below for the invalid state. A real backend words the fourth one `Not a valid regular expression: missing ) at position 21`.

## Steps

1. Open http://localhost:3000/settings/network/proxy/setup with the default setting
2. Switch "Use a proxy" on (once with no host value, once with the three host values), then click Cancel
3. With the Custom state stored, open the page, click Add, press Regex on entry 4 and type `\.cluster\.local(:\d+)?$`
4. Type `65535999` and then `31a2b8` into Port, then click Cancel
5. Click Add, press Regex on entry 4, set entry 2 to `https://registry.corp.example/`, entry 3 to `HTTPS://Registry.corp.example:443`, entry 4 to `\.cluster\.local(:\d+`, then set IP or Hostname to `http://proxy.corp.example`
6. Set IP or Hostname back to `proxy.corp.example`, then click Cancel
7. With the default setting, focus "Use a proxy", press Space, press Tab, press Tab again
8. Open Network > Proxy > Blocks from the Settings menu
9. Click "Blocks that use this proxy", then "Not applicable"
10. Flip the theme in the sidebar at steps 1, 2, 3, 5, 7, 8 and 9 and look again
11. Make the browser window 1024 px wide, open Network > Proxy > Blocks and click "Not applicable"; hover a block name that ends in an ellipsis, then one that shows whole
12. Make the browser window 1396x560 and open Proxy Setup; scroll the Settings menu down to About and click it
13. At 1396x900 with the default setting, open Proxy Setup, switch "Use a proxy" on and move the pointer over "Custom" in Source, in each theme

## Validation

- **Off (step 1):** "Proxy Setup" is the only heading; Cancel and Save (save icon) at the right end of its line, both disabled and faded; under it the 14px muted line "For web requests (HTTP and HTTPS) made from the WAVE host. Your browser and blocks on a remote host do not use it."; one bordered group with the one row "Use a proxy", no help line, the switch off and centered against the label
- **Host (step 2):** Source shows "WAVE host's settings" pressed (filled primary, white text) and "Custom"; one full-width row lists HTTPS_PROXY, HTTP_PROXY and NO_PROXY one per line, each a 12px muted label, a lock and a monospace value, with labels, locks and values in three aligned columns; a proxy address shows its password as `********`, never `****`; with no host value each reads "Not set"; Cancel and Save are enabled; Cancel returns to the off frame
- **Menu (step 3):** Network is open with SSH Hosts, Certificates and Proxy; Proxy (a chevron, no icon) is open behind its own left rule with Setup (blue, active) and Blocks under it
- **Custom (step 3):** eight rows split by hairlines, every control at one right edge and centered against its label: Use a proxy (on), Source (Custom pressed), IP or Hostname (256px), Port (112px, right-aligned, monospace), Username (256px), Password (a 256 x 40 masked field with a pencil, eight dots and a lock, the help line "Stored sealed; shown write-only like other credentials.", no input), Use the proxy for ("All addresses except the list" pressed) and Use the proxy for local addresses too (off)
- **Address list (step 3):** inside the "Use the proxy for" row with no hairline above it; four rows, each a two-part Exact / Regex control (the pressed part filled like Source), a monospace address and a trash button on one line, in aligned columns; a 36px "Add" under the last row at the list's left edge; Cancel and Save enabled
- **Handles (step 4):** Port reads `65535`, then `3128`; Cancel leaves the three stored rows and fades both buttons
- **Invalid input (step 5):** the error border and a 12px message in the error text color under IP or Hostname ("IP or Hostname must be an IP address or a host name, with no protocol and no port", ending at the field's right edge) and under entry 2 ("Remove everything after the host and port"), entry 3 ("The same address as entry 1") and entry 4 ("Not a valid regular expression: missing ), unterminated subpattern at position 15"), each starting at the address's left edge; entry 1 and the other fields unmarked; the IP or Hostname label and field do not move and the field keeps focus when its message appears; Save disabled and faded, Cancel enabled
- **Corrected (step 6):** the IP or Hostname message and border go; Save stays disabled for the three list rows; Cancel clears every message
- **Focus ring (step 7):** on the pressed part and then on the unpressed part of Source a 2px ring is drawn 4px inside the part, whole on all four sides; white on the pressed part, the app's focus color on the unpressed one; the other part shows no ring
- **Blocks (step 8):** the menu marks Blocks active; the title "Proxy Blocks" alone, no line under it, no Cancel and no Save; three bordered cards with a chevron at the right end of each header; "Blocks that use this proxy" (Network: HTTP; Database: OpenSearch; Kubernetes: 12 blocks; Helm: 6 blocks) and "Blocks that do not use this proxy" (System: Shell Script, Shell Exec, Python) open, "Not applicable" closed; each group is one row with its name in capitals in the palette color and its blocks (20px icon in that color, then the name) in four aligned columns
- **Blocks open (step 9):** the first card is its header alone with a right-pointing chevron; "Not applicable" lists Network (Ping, Netcat), Remote (7 blocks), Database (SQL), System (File I/O, Log) and Data (CSV, Excel, XML, JSON)
- **Loading:** while the first read of a page is in flight its title shows over a one-row skeleton with no Cancel, no Save and no control
- **Nothing saved:** `GET /network/proxy` answers the defaults after every step
- **Theme (step 10):** the same results in the other theme; CI runs the dark projects, so the spec flips to light inside each test
- **Cut block name (step 11):** a block name that does not fit its column is cut with an ellipsis and shows its whole name in the shared tooltip on hover; a name that fits shows no tooltip
- **Short window (step 12):** the menu's rows are taller than the space the window leaves, and the menu scrolls on its own; About scrolls into view whole and opens the About page
- **Source hover (step 13):** under the pointer "Custom" gets a background and a darker text in the light theme, a lighter text in the dark theme; with the pointer away it has no background; nothing is pressed, "WAVE host's settings" stays the pressed part
