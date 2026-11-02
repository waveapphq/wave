# V-FN-EDIT-LIFECYCLE: client-side edit-mode lifecycle (node state)

Edit-mode entry and drop are client-side; entry persists only through the
normal Test Save. Asserts NODE STATE only (undo/redo of Drop is out of scope).

## Prerequisites

- A running stack (self-seeds via REST).

## Steps

1. **Enter -> Drop**: open a clean published reference; enter edit mode (kebab); Drop
   changes (kebab -> confirm).
2. **Enter -> Save -> reload**: open a clean reference; enter edit mode; Save the Test;
   reopen it from storage.

## Validation

- **Enter -> Drop**: the edit-mode markers are gone (no asterisk overlay); the kebab
  offers Edit again and no Drop changes.
- **Enter -> Save -> reload**: after the reload the node is STILL in edit mode (overlay
  visible; kebab offers Drop changes, not Edit).
