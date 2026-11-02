# V-PLUGIN-HTTP-02: Profile Binding End-to-End Execution

Seed an environment, custom profile with per-environment URL, and a test workflow with an HTTP Client node for end-to-end profile binding execution.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-plugin-http-02/01-seed.sh
```

## Steps

1. Open http://localhost:3000/workbench?editTest={TEST_ID}
2. Select HTTP node, open config modal
3. Open Profiles modal, bind "My Server" profile with alias "my_srv"
4. Toggle URL to expression mode, use autocomplete to select my_srv.url
5. Save config, select "Local Dev" environment, save test, run

## Validation

- **Profile binding:** Custom profile "My Server" can be bound to HTTP Client node
- **Autocomplete - top-level:** Ctrl+Space shows "my_srv" under "Profiles" section header
- **Autocomplete - dot-completion:** Typing "my_srv." shows "my_srv.url" sub-completion
- **Expression resolution:** Profile URL resolves to http://localhost:{BACKEND_PORT}/health at runtime
- **Execution success:** Workflow status shows "passed", HTTP node shows "success"
