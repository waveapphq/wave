# V-SAVE-03: Draft Persistence Verification

Verify draft workflow state persists in localStorage and is correctly restored.

## Prerequisites

No fixture seeding required. Tests operate on fresh canvas state.

```bash
# Clear localStorage and reset canvas state (handled in beforeEach)
```

## Steps

1. Open http://localhost:3000/workbench
2. Add blocks to canvas
3. Navigate away (e.g., /tests)
4. Return to /workbench
5. Verify state is restored

## Validation

**Auto-Save Behavior:**
- Draft auto-saves to localStorage key `wave-workbench-draft`
- Saves on every canvas change (add/move/delete nodes, add edges)
- Draft contains nodes, edges, positions, viewport

**Restoration:**
- Navigate away and return: exact state restored
- Browser refresh: exact state preserved
- Node positions approximately same (+/- 50px tolerance)
- Multiple blocks and edges preserved

**Draft Clearing:**
- "Discard and Close" clears draft from localStorage
- Successful save clears draft from localStorage
- Draft is null after clearing

**Breadcrumb:**
- Restored draft shows "Draft Workflow" in breadcrumb
- Editing saved test shows test name (not "Draft Workflow")

**Edge Cases:**
- Draft not restored when loading saved test via ?editTest=
- Multiple nodes and edges all preserved correctly
