# V-FN-SELF-REF-DROP (functional)

Regression guard for the composition-time drop guard half of the circular Function
reference check (the recursive-walker half lives in `fn-composition-guards`).

While the user is drilled into a Function's editable body, dropping the SAME
library Function from the Functions Library must be rejected - no node is added
and a toast explains why.

## Prerequisites

- Backend with `WAVE_ADMIN_ALLOWED=true` for the seed endpoints.
- Shared canvas helpers: `clickNodeKebabItem`, `expandPalette`,
  `waitForCanvasLoad`.

## Steps + Issue mapping

1. Seed a library entry (`POST /functions`, body = one Log so the draft drills
   into something) and a host Test with one Shared instance (`POST /tests`).
2. Enter edit mode on the instance (the body is editable there - a read-only
   published body rejects drops anyway, so the editable case is the guard's
   real target).
3. Drill into the edit-mode draft via the dig-in glyph (records this Function
   in the drill path).
4. Open the Functions Library, search for this Function, and drag its card onto
   the drilled body.

## Validation

- A rejection toast appears ("A Function cannot be nested inside itself").
- No Function node is added to the body.
- Because the drop is rejected (no node ever added), the synthetic drag is
  retried until the toast appears rather than waiting for a node count to rise.

The `useCanvasDrop` unit tests cover the guard logic; this spec is the
end-to-end UI proof.
