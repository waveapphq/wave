# V-QADD-02: Quick Insert Placement

Verify Quick Insert's Enter centers the new Block under the egress handle it links from, so the new link is straight.

## Prerequisites

- Backend and frontend running; each test seeds its own `zz-b29-` Test through `POST /tests` and deletes it.

## Steps

1. Open an empty Test for Start, or the seeded Test with its anchor selected, press Ctrl+Space, type `log`, press Enter.
2. Give the new Log a message, Save, and open the Test again.
3. Repeat from a Block 200 px wide, one 360 px wide, an If/Else whose first branch is linked and a fully linked Block 300 px wide; press Ctrl+Enter once instead of Enter.

## Validation

- **Straight link:** the anchor's egress handle and the new Block's top handle share one x within 1 px
- **Centered:** the new Block's center is on that x within 1 px; under the If/Else it is the second branch handle
- **Reload:** the new Block keeps its place after Save and reload
- **Fully linked anchor:** no link; the new Block is centered under the anchor
- **Ctrl+Enter:** no link; the new Block sits over the viewport center
