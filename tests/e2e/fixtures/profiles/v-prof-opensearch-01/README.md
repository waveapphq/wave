# V-PROF-OPENSEARCH-01: OpenSearch Profile Form

Verify the Create Profile modal with Type opensearch: the nine fields of the opensearch profile, their types, secrets and starting values, that none of them is required, and that the url editor offers no Format control.

## Prerequisites

No seed script. The E2E environment must exist (the spec creates it when missing). Two tests create a profile named `V-PROF-OPENSEARCH-01 <label> <random>` and delete it afterwards.

## Steps

1. Open http://localhost:3000/profiles and click New Profile
2. Pick Type opensearch
3. Open the Edit value sheet of url, then of username
4. Type a Name, click Create
5. Open the Edit modal of an opensearch profile that holds a url and the four secrets

## Validation

- **Rows:** url, username, password, api_key, bearer_token, verify_ssl, ca_cert, client_cert, client_key, in that order
- **Types:** String for every row but verify_ssl, which is Boolean
- **No block-only rows:** no host, port, use_ssl, index or timeout row
- **Secrets:** under the lock column, password, api_key, bearer_token and client_key ticked, every other box unticked; verify_ssl's box disabled
- **Starting values:** verify_ssl on true; every string row `Edit…`
- **Nothing required:** no required marker and no row message; Create disabled with `Create is disabled: the settings have errors` until a Name is typed
- **Create:** a Name alone creates the profile; it is stored as type opensearch with verify_ssl true and every string field blank
- **Plain url:** the url Edit value sheet has no Format dropdown; the username sheet has one
- **Masked:** reopened, each stored secret shows `••••••••` behind Edit protected value and never its value; url shows its value
