# V-CANVAS-START-01: Start Node Geometry

Verify the Start node is 100 px wide with its content centered, its center on flow x 0, and the onboarding placeholder centered under it.

## Prerequisites

- Backend and frontend running; the spec seeds its own `zz-b29-` Test through `POST /tests` and deletes it.

## Steps

1. Open the seeded Test in the workbench.
2. Open a new empty Test (`/workbench` with no session).

## Validation

- **Width:** Start measures 100 px wide
- **Content:** the play glyph and the "Start" label are centered in Start within 1 px
- **Main line:** Start's center is flow x 0 within 1 px
- **Empty Test:** the onboarding placeholder's center matches Start's within 1 px
