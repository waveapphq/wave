# V-VALIDATE-LOAD-01: Validation System Comprehensive Tests

Tests the full validation system: two-phase Load validation (fatal + fixable), Fix All, save-time 422 rejection, Run/Debug pre-validation, the persistent alert icon, the post-modal pulse, and disabled-element exclusion.

## Prerequisites

Backend and frontend servers must be running. Seed script resets all data, creates one environment, and creates 16 test entities.

## Seeded Data

One environment (`Validation Env`) plus 16 test entities with deterministic IDs (`ad010e00-00NN-...`):

| Scenario | ID Suffix | Description | Expected Behavior |
|----------|-----------|-------------|-------------------|
| S01 | 0001 | Clean test - no errors | No dialog, no toast, no alert icon, canvas loads |
| S02 | 0002 | Missing required params (visible warnings) | No dialog, no toast, alert icon on the node, canvas loads |
| S03 | 0003 | MISSING_LABEL (fixable) | Fixable dialog "Test Issues Found", Fix All generates label |
| S04 | 0004 | DANGLING_EDGE (fixable) | Fixable dialog, Fix All removes bad edge |
| S05 | 0005 | UNKNOWN_BLOCK_TYPE (fixable) | Fixable dialog, Fix All removes unknown node |
| S06 | 0006 | SELF_LOOP_EDGE (fixable) | Fixable dialog, Fix All removes self-loop |
| S07 | 0007 | INVALID_VARIABLE x3 (fixable) | Fixable dialog, Fix All refactors variables |
| S08 | 0008 | INVALID_VARIABLE_TYPE (fixable) | Fixable dialog, Fix All corrects type |
| S09 | 0009 | MISSING_WORKFLOW (fatal) | Fatal dialog "Cannot Load Test", Close only, navigates to /tests |
| S10 | 0010 | INVALID_NODES (fatal) | Fatal dialog, Close only, navigates to /tests |
| S11 | 0011 | Disabled node with missing params | No dialog, no toast, no alert icon (disabled skips validation) |
| S12 | 0012 | Valid test for API context param test | API-only: context=bogus returns 400 |
| S13 | 0013 | Missing required params (saved) | Loads with alert icon; Save -> "Cannot Save Test" modal -> Close pulses icon |
| S14 | 0014 | MULTIPLE_EDGES (fixable) | Fixable dialog, Fix All removes excess edges |
| S15 | 0015 | SELF_LOOP + MULTIPLE_EDGES (fixable) | Fixable dialog, Fix All handles combined |
| S16 | 0016 | MISSING_POSITION + INVALID_POSITION | Fixable dialog, Fix All assigns positions |
| S17 | (reuses S13) | Run pre-validation | Run -> "Cannot Run Test" modal -> Close pulses icon |
| S18 | (reuses S13) | Debug pre-validation | Debug -> "Cannot Debug Test" modal -> Close pulses icon |

## Validation Behavior Summary

- **Load-time validation**: Runs when opening a test in workbench
  - Fatal errors: "Cannot Load Test" dialog, Close only, navigates to /tests
  - Invisible (auto-fixable) errors: "Test Issues Found" dialog, Close + Fix All buttons
  - Visible warnings only (REQUIRED_PARAM_*, INVALID_OUTPUT_BINDING_TYPE): no dialog, no toast, persistent alert icon on the affected node
  - Clean: no dialog, no toast, no alert icon, canvas loads normally
- **Save-time validation**: Runs when saving (422 from PUT/POST)
  - "Cannot Save Test" dialog, Close only (stays on canvas)
  - Closing the modal triggers a one-shot pulse on the alert icon
- **Run-time pre-validation**: Runs when clicking the Run primary action
  - "Cannot Run Test" dialog, Close only
  - Close triggers the pulse on affected nodes
- **Debug-time pre-validation**: Same as Run, with title "Cannot Debug Test"
- **Disabled nodes**: Skipped entirely during param validation

## Validation Steps

1. Run the seed script: `./tests/e2e/fixtures/canvas/v-validate-load-01/01-seed.sh`
2. Run the spec from the project root: `npm --prefix tests/e2e test -- v-validate-load-01`
3. Each test asserts on its own entity ID, so groups are independent and the file can be re-run without re-seeding (the spec uses `test.beforeAll` for the seed call).
