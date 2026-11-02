# V-TABLE-EXPR-OPS-01: Table query operations in the expression editor

Verify the expression editor offers the table type's query operations, and that
naming a column offers that column's operators.

## Prerequisites

None. The test imports `fixture.json` via `POST /tests` and opens it in the
workbench. No database reset and no seed script.

## Steps

1. Open the Log element's configuration and switch its message to an expression.
2. Type `orders.` and read the completion list.
3. Type `orders.filter('qty').` and read the completion list.

## Validation

- **Table operations:** the completion list offers `filter`, `order_by` and `col`.
- **Column operators:** after naming a column, the list offers the comparison
  operators the filter step returns - `equals`, `greater_than`, `contains`.

## Notes

- The engine carries non-mutating filtering and ordering on the table type, and
  the editor's catalog lists them, so the validator accepts them. This covers the
  completion half.
- That such an expression validates clean and actually runs is covered by
  `tests/e2e/functional/table-expression-guards/`.
