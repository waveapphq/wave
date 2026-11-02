# V-PROF-DATABASE-01: Database Profile Form

Verify the Create Profile modal with Type database: the ten fields of the database profile, their types, secrets and starting values, and that none of them is required.

## Prerequisites

No seed script. The E2E environment must exist (the spec creates it when missing). One test creates a profile named `V-PROF-DATABASE-01 <random>` and deletes it afterwards.

## Steps

1. Open http://localhost:3000/profiles and click New Profile
2. Pick Type database
3. Type a Name, click Create
4. Open the new profile's Edit modal

## Validation

- **Rows:** host, port, database, username, password, verify_ssl, ca_cert, client_cert, client_key, driver_options, in that order
- **Types:** String, Integer, String, String, String, Boolean, String, String, String, Map
- **No block-only rows:** no timeout, connect timeout, failover, TLS, database type, Max rows, Batch size or SQLite file row
- **Secrets:** password and client_key ticked, every other box unticked; verify_ssl's box disabled
- **Starting values:** port an empty number box with no placeholder; verify_ssl on true; driver_options `0 pairs`; every string row `Edit…`
- **Messages:** no `Name is required` after picking the Type and no row message; Create disabled with `Create is disabled: the settings have errors` under it
- **Geometry:** every row 49 px tall; the name, type and value boxes 32 px tall, the port number box included
- **Create:** a Name alone enables Create; the saved profile is type database with verify_ssl true and no port number; reopened, port is empty, nothing is flagged and no settings-errors note shows
