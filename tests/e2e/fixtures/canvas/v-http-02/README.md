# V-HTTP-02: HTTP Body Modes and Proxy Row

Verify the HTTP block's config sheet: the Body Mode menu, per-mode rows with
generated Content-Type notes, GET-with-body, the JSON advisory, draft retention,
the grouped section cards, the cipher picker, and the Proxy row of the
Connection group on the WAVE host and inside a Remote Execution body.

## Prerequisites

None. The spec self-seeds its Tests via `POST /tests`:

- the body Test: a GET node with a JSON text body and no Content-Type header, a
  POST node in form mode with 3 fields, and two nodes with a stored cipher list
- an SSH Session Open node, for the group footer spot-check
- the Proxy Test: SSH Session Open, a Remote Execution block with one HTTP node
  in its body (Proxy stored as Off), and after it one HTTP node with no stored
  Proxy choice and one with Proxy stored as Off

## Steps

1. Open the seeded test in `/workbench?editTest=<id>`
2. Double-click each HTTP node and inspect the body area and groups
3. Open the Body Mode menu; switch modes; add a Content-Type header
4. Open the cipher picker on the three cipher nodes
5. In the Proxy Test open the two HTTP nodes after the Remote Execution block,
   expand Connection, open the Proxy menu, pick the other choice, Save the sheet,
   then Save the Test and read the two nodes over `GET /tests/<id>/workflow`
6. Open the HTTP node inside the Remote Execution body and expand Connection
7. Switch the theme and repeat the Proxy menu and the remote row checks

## Validation

- **GET-with-body:** Body Mode "Text" + Body row visible under GET
- **JSON advisory:** amber "Missing Content-Type" icon inside the Body field;
  disappears once a Content-Type header row is added
- **Mode menu:** Text / Form (URL-encoded) / Multipart (form-data) / File in
  order, muted sublabels "file upload" and "file as body"
- **Form mode:** Form Fields row (per-entry kinds) + exact generated-CT note;
  Body row hidden
- **Groups:** Auth / Body / Timeouts & Retries / Response / TLS / Certificates /
  Connection (no "Security"); Response=File reveals File Path; Connection holds
  Allow Redirects, Max Redirects and Proxy
- **Draft retention:** Text -> Form -> Text keeps the Body draft
- **Cipher picker:** opened from the Cipher Suites field's expand; two tables,
  "All 24 enabled" with "Default" by default; a stored list keeps its order; an
  empty stored list is saveable
- **Proxy menu:** exactly "WAVE setting" and "Off", in that order, the current
  one checked; a node with no stored choice reads "WAVE setting"; the row has no
  expression toggle; after Save the node that picked "Off" stores `off` and the
  node that picked "WAVE setting" stores `wave-setting`
- **Proxy row on a remote host:** the row is at 50 percent opacity with the
  not-allowed cursor; its control is disabled, reads "Remote host's settings"
  although `off` is stored, and opens no menu; Allow Redirects and Max Redirects
  stay at full strength
- **Themes:** the Proxy menu and the remote row hold in both themes
