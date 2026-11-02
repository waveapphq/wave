# V-DIRTY-SWITCH-SINGLE-PROMPT: single-prompt dirty switch

Opening a different Test while dirty and choosing Discard prompts EXACTLY ONCE - the
Workbench remount's session recovery must not restore the stale draft and re-fire the
switch dialog. Reproducible fail-first guard.

## Prerequisites

- A running stack (self-seeds two Tests via REST).

## Steps

1. Open Test A and dirty it (drag a node so Save enables).
2. Navigate to the Tests list client-side and click Test B.
3. On the switch dialog, click "Discard & Open New".

## Validation

- The switch dialog appears once.
- After Test B loads (`/workbench?editTest=<B>`), the switch dialog does NOT re-appear
  (no stale-draft re-prompt on the remount).
