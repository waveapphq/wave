# V-PICKER-PAGINATE-FUNCTIONAL-01: Cross-Page Picker Selection

Verify EntityPickerModal selection survives infinite-scroll page loads and that
Add Selected persists every picked entity on both consumers (suite test picker,
regression suite picker).

## Prerequisites

```bash
./tests/e2e/fixtures/shared/v-picker-paginate-functional-01/01-seed.sh
```

Seeds (no reset, PKR2 namespace): 60 "PKR2T Cand NNN" tests, empty "PKR2 Target
Suite", 60 "PKR2S Suite NNN" suites each with a failed execution, empty
"PKR2 Target Regression". Tear down with `02-cleanup.sh` from the same directory.

## Steps

1. Open the target suite, enter Edit Tests, open Add Tests
2. Search "PKR2T"; select the first row; scroll the list to load pages 2 and 3
3. Select the last row (page 3); click "Add Selected (2)"; Save
4. Open the target regression, enter Edit Suites, open Add Suites
5. Search "PKR2S"; repeat the page-1 + page-3 cross-page selection; Add; Save

## Validation

- **Selection persistence:** the page-1 pick stays selected while pages 2-3 load; the Add button counts 1 then 2
- **Persisted suite:** `GET /suites/{id}` returns exactly the two picked test ids
- **Cached metadata:** the regression edit-mode rows for both added suites show the Failed status badge (picker-cached), never the never_run placeholder
- **Persisted regression:** `GET /regressions/{id}` returns exactly the two picked suite ids
