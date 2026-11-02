# Console log-level accumulation - functional E2E

Proves the console log-level dropdown is a CLIENT-SIDE filter over accumulated entries: changing the
level never wipes earlier runs' logs.

## Pre-requisites
- E2E stacks up; shared env `E2E Execution Env`. (No SSH simulator needed - pure UI/console.)

## Execution
Imports `fixture.json` (three Log nodes: INFO / WARN / INFO), then runs each via ad-hoc Run Current
(three distinct sessions accumulate in the console).

## Validation
- default INFO: all three run markers visible.
- WARN: only the WARN marker shows; the INFO markers are filtered out (not wiped).
- back to INFO: every earlier run's marker reappears - proving entries were kept, not re-fetched
  (the first run's session is never re-subscribed).
