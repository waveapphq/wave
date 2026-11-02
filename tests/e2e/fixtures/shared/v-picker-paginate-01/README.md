# V-PICKER-PAGINATE-01: EntityPickerModal Pagination & Error Surfacing

Verify the shared entity picker paginates (25/page, infinite scroll), shows the
refine nudge, and surfaces fetch errors (page-1 ListErrorState, load-more retry pill).

## Prerequisites

```bash
./tests/e2e/fixtures/shared/v-picker-paginate-01/01-seed.sh
```

Seeds (after a reset): 60 tests, 1 empty target suite + 59 candidate suites
(60 suites total), 1 empty target regression.

## Steps

1. Open http://localhost:3000/suites/e8000001-0001-0001-0001-000000000001
2. Click "Edit Tests", then "Add Tests" to open the test picker
3. Scroll the picker list to the bottom twice (loads pages 2 and 3)
4. Open http://localhost:3000/regressions/e8000002-0001-0001-0001-000000000001
5. Click "Edit Suites", then "Add Suites" to open the suite picker

## Validation

- **First page:** exactly 25 rows; nudge "60 tests - refine your search to narrow down" below the list, left-aligned
- **Infinite scroll:** bottom-center "Loading…" pill while the next page is in flight; rows append 25 -> 50 -> 60; page-1 rows remain; nudge hides at 60/60
- **Suite picker:** same behavior; nudge reads "60 suites - refine your search to narrow down"
- **Page-1 failure:** ListErrorState ("Unable to load tests"/"Unable to load suites" + "Try Again"), never the silent empty state; Try Again reloads rows
- **Load-more failure:** loaded rows remain; bottom-center pill swaps to "Try Again"; clicking it appends page 2
