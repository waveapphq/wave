# V-NET-02: Settings > Network > Certificates

Verify the Certificates page: the public source cards, Built-in Authorities, the WAVE Host's Store summary, the certificate dialog, and the Add Certificate dialog with staged rows. Nothing is saved.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
curl -sf -X POST http://localhost:8000/admin/enable -H "Content-Type: application/json" -d '{"reason": "E2E network reset"}'
curl -sf -X POST http://localhost:8000/admin/reset -H "Content-Type: application/json" -d '{"confirm": true, "scope": ["network"]}'
curl -sf -X POST http://localhost:8000/admin/disable
```

- Certificate settings at their defaults (the `network` reset gives this; `reset.sh` alone leaves them): "WAVE's built-in list" selected, no additional certificates.
- `valid-ca.pem` (CA "WAVE E2E Fixture CA", valid 2026-01-01 to 2046-01-01) and `expired-ca.pem` (CA "WAVE E2E Expired CA 2020", valid 2020-01-01 to 2021-01-01) in this folder, made once by `./generate-certs.sh`.
- Note `label`, `count` and `host_store` from `GET http://localhost:8000/network/certificates`.

## Steps

1. Open http://localhost:3000/settings/network/certificates
2. Type an organization name, for example "Amazon", in "Search authorities…", then clear it
3. Click the eye on the first Built-in Authorities row; close with the corner X; open it again and close with Close
4. Select "This WAVE host's store", then click Cancel
5. Click "Add certificate", paste `valid-ca.pem`, click Add
6. Click the eye on the "WAVE E2E Fixture CA" row, then Close
7. Click "Add certificate", paste `expired-ca.pem` followed by `valid-ca.pem`, click Cancel
8. Click Cancel in the page header
9. Flip the theme in the sidebar, compare the two Add certificate buttons again, and repeat steps 1, 3, 5, 7 and 8

## Validation

- **Header:** "Public Certificate Authorities"; Cancel and Save disabled while nothing is staged
- **Option cards:** two equal cards on one row; "WAVE's built-in list" reads "Mozilla's public list, {label}, {count} authorities." and "Same on every WAVE host." and is selected; "This WAVE host's store" reads "Follows this machine's system updates."
- **Built-in Authorities (step 1-2):** placeholder "Search authorities…"; columns Name (sorted ascending), Organization, Expires and an eye per row; no checkboxes, no Mass Action, no Add; footer "Showing 1-10 of {count} authorities"; the search shows only matching rows and clearing it restores all
- **Certificate dialog (step 3):** titled with the row's name; Subject, Issuer, Type, Path length, Valid from, Valid to with a "Valid" / "Expires in N days" / "Expired" badge after the date, SHA-256 fingerprint on two lines with a copy button, Serial number, Key, Signature algorithm, Key usage, Subject Key ID, Authority Key ID, each equal to `GET /network/certificates/{id}`; "PEM" with Copy over a scrollable monospace box; the corner X and Close both close it
- **Host store (step 4):** Cancel and Save enable; Built-in Authorities gives way to "WAVE Host's Store" with Store (monospace path), Certificates and Last changed equal to `host_store`, each with a lock; Cancel brings back the built-in card and table and disables both buttons. With `host_store.path` null the card is disabled and reads "No certificate store found on this WAVE host"
- **Additional Certificates (before step 5):** "No additional certificates" with an Add certificate button; toolbar "Search certificates…", Mass Action, Add certificate; the two Add certificate buttons are the same size (36px tall) with the same 1px border, background and 14px text
- **Add Certificate (step 5):** 672px dialog titled "Add Certificate", no description, no corner X; monospace 12px text area about 138px tall; under it one 48px dashed row "Click or drop file here" with ".pem, .crt, or .cer"; footer Cancel then Add, both 40px; Add disabled while empty; the pasted CA shows one checked row under a checked select-all, with Type 128px and Expires 184px wide; Add closes the dialog, the row appears in Additional Certificates, Cancel and Save enable
- **Staged row (step 6):** the dialog shows the pasted certificate's detail without reading `GET /network/certificates/{id}`
- **Bundle (step 7):** "WAVE E2E Expired CA 2020" shows "Expired" after 2021-01-01 and stays checked; "WAVE E2E Fixture CA" reads "Already added" after its name with a disabled, faded checkbox; Add enabled; after Cancel only the staged row remains
- **Page Cancel (step 8):** Additional Certificates is empty again; Cancel and Save disabled
- **Theme (step 9):** the same results in the other theme; CI runs the dark projects, so the spec flips to light inside the test
