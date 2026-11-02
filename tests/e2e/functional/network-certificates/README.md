# Network Certificates - functional E2E

V-NET-CERT-FUNCTIONAL. Proves that Settings > Network > Certificates decides what a verify-on
block with a blank CA trusts, on the real wire against the tls-lab chain (REQ-4.5.16; NET-5,
NET-6, NET-7, NET-8). Every settings change goes through the page (Add certificate dialog, trash
icon, public authorities cards, Save); the run then proves the effect.

## Pre-requisites
- Backend + frontend E2E stacks up; real-service stack up (`scripts/e2e-stack.sh up --wait`):
  the `tls-lab` chain listeners 9480 (leaf + intermediate) and 9481 (leaf only), both signed by
  "WAVE E2E Chain Intermediate CA" under "WAVE E2E Chain Root CA"
  (`tests/e2e/services/tls-lab/certs/generate-chain-certs.sh`).
- Shared env `E2E Execution Env`.
- `resetNetworkSettings` runs before and after each test, so every other spec starts from the
  built-in list, no Additional Certificates and the stack's trusted SSH hosts.
- The stack's config file and data folder come from `GET /server/status` (`stackPaths`,
  `helpers/config-file.ts`); the second test reads the `network` section of the config file
  and `<data>/network/certificates.yaml`.

## Fixture - `fixture.json`
Three verify-on HTTP GETs, each in its own Try/Catch whose catch Log prints the caught message:
- `http-full`: CA blank, full-chain port (9480).
- `http-leaf`: CA blank, leaf-only port (9481).
- `http-blockca`: CA set to the WAVE Test CA (`CA_CERT_PEM`, which never signed the chain),
  full-chain port.

A closing Log prints `chain-done full={status} leaf={status} blockca={status}`. The spec fills
`ca_pem` and imports the fixture with `injectHttp` (the `127.0.0.1:9480` / `:9481` URLs move to
`HTTP_TARGET_HOST` in container mode), requiring zero validation errors.

## Spec - `v-network-certificates-functional.spec.ts`
The first test runs the fixture four times through the workbench as the settings change, with
the console set to DEBUG before each run (the trust line is a DEBUG line):

| Step | Settings | full-chain | leaf-only | Trust line (DEBUG, each blank-CA block) |
|------|----------|-----------|-----------|----------------------------------|
| 2 | built-in list only | fails, names the intermediate | fails, names the leaf | `Trusting WAVE's built-in certificate list ({label})` |
| 3 | + intermediate pasted, Saved | 200 | 200 | `... ({label}) and 1 additional certificate` |
| 4 | intermediate trashed, root dropped as a DER file, Saved | 200 | fails, names the leaf | `... ({label}) and 1 additional certificate` |
| 7 | this WAVE host's store + root, Saved | 200 | fails, names the leaf | `Trusting this WAVE host's certificate store {path} and 1 additional certificate` |

Failures read exactly `Certificate verification failed: no trusted issuer found for certificate
"CN=..., O=WAVE Test"`. The block-CA request fails naming the intermediate in every run (a block
CA is the only certificate that block trusts) and logs no trust line.

Validation:
- Step 3: the pasted intermediate lists one checked row of Type Intermediate; after Add + Save,
  `GET /network/certificates` holds exactly that certificate.
- Step 4: the DER file is written under a folder made in `os.tmpdir()` (removed afterwards) and
  dropped on the drop zone; the text area then holds exactly the PEM the parse call returned (the
  root), the zone names the file, and one Root row lists. After Save only the root is stored.
- Step 6: pasting a private key lists no rows and exactly
  `The text contains a private key; paste certificates only`; re-pasting the saved root lists it
  with "Already added" and a disabled, unchecked checkbox; Add stays disabled; Cancel leaves the
  page clean.
- Step 7 reads `settings.host_store.path` first. With a store, the card is selected and saved
  (`public_source` reads back `host`). Without one, the card is disabled (NET-6) so the page
  cannot send the change; the step asserts that and that `PATCH /network/certificates`
  refuses `public_source: "host"` with
  `No certificate store found on this WAVE host: looked in {paths}`.
- Every run passes (the Try/Catch blocks catch the failures) and the HTTP blocks are painted
  success or failed to match.

The second test proves where the public source is stored (no run):
1. The config file reads `public_source: builtin` under `network.certificates`.
2. With a host store: paste the chain root in Add certificate, Add, select "This WAVE host's
   store". The config file still reads `builtin`. Save: the config file reads
   `public_source: host`; `<data>/network/certificates.yaml` has the one top-level key
   `certificates` and the text `public_source` nowhere; `GET /network/certificates` reads
   `host` and the root.
3. `resetNetworkSettings`: the config file reads `public_source: builtin` again, the
   certificates file still holds `certificates` only, the API reads `builtin` and no
   Additional Certificates, and the reloaded page shows "WAVE's built-in list" selected and
   "No additional certificates".
4. Without a host store the card is disabled (NET-6); `PATCH /network/certificates` with
   `public_source: "host"` answers 400 and the config file still reads `builtin`.
