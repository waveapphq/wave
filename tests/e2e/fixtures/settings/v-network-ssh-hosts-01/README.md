# V-NET-01: SSH Hosts Page and Add Hosts Dialog

Verify Settings > Network > SSH Hosts (Host Key Policy, Trusted SSH Hosts) and the Add Hosts dialog in both modes, with staged edits only (nothing is saved).

## Prerequisites

- The E2E service stack is running, with the `sshd` service on `SSH_MAIN_PORT` (9445).
- Browser window 1440x900 (the scale the frames are drawn at).
- The stack's trusted hosts list is seeded (global setup): `SSH_TARGET_HOST`:9445 with the sshd ED25519 host key, `SSH_TARGET_HOST`:9448, and `sshd`:22. The host key policy is the default (Lock off, Disabled).
- The spec intercepts the read of the trusted hosts list and appends synthetic hosts until the table holds 27. By hand, add hosts until the table holds 27.
- For step 9 the spec draws no host at all. By hand, remove every trusted host first. No additional certificate is stored.
- `paste-lines.txt` in this folder: three valid known_hosts lines (ED25519 with two names, ECDSA, RSA) and `HostName ci-02.lab.internal` as line 3.

## Steps

1. Open http://localhost:3000/settings, expand Network, click Proxy twice, then click SSH Hosts
2. Choose Accept New in "Default block action", switch "Lock trusted hosts" on, open "Default block action", close it, switch Lock off, click Cancel
3. Page through the table, then back to page 1
4. Click Mass Action, check 10.20.4.15, artifacts.corp.example and bastion.corp.example, open "3 selected", click Delete, then click Cancel
5. Type `build-0` in the search, then clear it
6. Click Add hosts, enter the sshd host and port 9445, click Detect
7. Click Paste lines, paste `paste-lines.txt`, click Add, then click Cancel in the page header
8. Flip the theme from the sidebar and repeat steps 1, 3 and 7 up to the result table
9. With no trusted host, open SSH Hosts, then Certificates; flip the theme and look at both again; on SSH Hosts click the "Add hosts" button inside the table, then Cancel

## Validation

- **Nav:** Network (icon, chevron) between Variables and MCP Server; children SSH Hosts, Certificates and Proxy behind a left rule; Proxy (chevron, no icon) opens no page: the first click shows Setup and Blocks, indented once more behind their own left rule, the second hides them; SSH Hosts active (blue) at `/settings/network/ssh-hosts`
- **Header:** "Host Key Policy" with Cancel and Save disabled and faded while clean
- **Host Key Policy:** "Lock trusted hosts" / `No block can add hosts. New and existing SSH blocks using "Accept New" act as "Strict".` and "Default block action" / `New blocks are configured in this mode by default. Existing blocks keep their current setting.`; switch and 208px select centered against label + help; select shows Disabled
- **Lock:** with Accept New chosen, Lock on turns the select to Strict; open list Strict (checked), Accept New (faded, disabled), Disabled; Save and Cancel enable; Lock off keeps Strict; Cancel restores Lock off and Disabled
- **Table:** "Trusted SSH Hosts"; Host (sorted ascending), Port, Key type, Fingerprint (monospace, ellipsis), Added, trash; search left, Mass Action and Add hosts right; every column visible without scrolling sideways, headers on one line; "Showing 1-10 of 27 hosts", 3 pages; the seeded 9445 row shows the sshd key's real fingerprint
- **Selection:** checkboxes appear; "3 selected"; the menu holds only a red Delete; Delete removes the 3 rows at once (24 hosts, Save enabled) with no confirmation; Cancel brings them back
- **Search:** `build-0` leaves build-01.lab.example and build-02.lab.example ("Showing 1-2 of 2 hosts")
- **Detect:** 672px dialog titled "Add Hosts", no description, no corner X; "Detect from host" pressed; Host, Port (22, 96px), Detect on one line; one ED25519 row with the full fingerprint, "Already trusted" muted, checkbox disabled (faded, not-allowed cursor); Add disabled
- **Paste:** line numbers 1-4; three checked rows, the first reading "jump-02, 10.20.4.40"; host names shown whole and "Key type" on one line; `Line 3: not a known_hosts line` under the table in the error text color; Add enabled
- **Add:** dialog closes; 31 hosts, one row per name (jump-02, 10.20.4.40, etl-02.corp.example, files.corp.example) with Added "Unsaved"; Save enabled; Cancel returns to 27
- **Other theme:** same centering, faded header buttons, toolbar sides, columns fit, footer, one-line Detect row and bad-line error color
- **Empty table (step 9):** "Showing 0-0 of 0 hosts"; "No trusted SSH hosts" with an "Add hosts" button centered under it; that button and the toolbar's "Add hosts" are the same size (36px tall) with the same 1px border, background and 14px text, and "Add certificate" on the empty Additional Certificates table differs from them only in the width of its label; the same holds in the other theme; the button inside the table opens the Add Hosts dialog
