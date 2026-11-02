# V-PLUGIN-HTTP-01: HTTP Client Profile Binding

Seed 3 connection profiles for profile binding modal tests.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-plugin-http-01/01-seed.sh
```

## Steps

1. Open http://localhost:3000/workbench
2. Drag HTTP Client from palette to canvas
3. Select node, open config modal, click "Profiles" button
4. Verify seeded profiles appear in binding modal

## Validation

- **Profiles listed:** 3 profiles visible (Production API, Dev Database, SSH Gateway)
- **Add flow:** Clicking Add moves profile to bound section with auto-generated alias
- **Alias auto-generation:** "Production API" becomes "production_api"
- **Autocomplete:** Typing alias + "." in expression field shows profile field completions
- **Persistence:** Profile binding survives save and reopen of config modal
