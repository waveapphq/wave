# V-FN-CLOSE-NAG: edit-mode close nag ordering + relevance

The OK-only "Functions still in edit mode" nag fires BEFORE a close
completes, with the Test canvas still visible behind it, and only on the keep paths.

## Prerequisites

- A running stack (self-seeds via REST).

## Steps

1. **Clean close**: open a saved Test whose Shared Function is already in edit mode; Close.
2. **Save-and-Close**: open a clean ref, enter edit mode (kebab), Close, then Save and Close.
3. **Discard-and-Close**: same dirty edit-mode setup, Close, then Discard and Close.

## Validation

- **Clean close**: the nag fires immediately (no close-confirm), the canvas is still
  visible behind it; OK proceeds (canvas resets to the empty state).
- **Save-and-Close**: the close-confirm dialog shows FIRST; after Save and Close the nag
  fires (canvas still visible); OK proceeds.
- **Discard-and-Close**: NO nag (the discard makes the edit-mode state irrelevant); the
  close proceeds directly.
