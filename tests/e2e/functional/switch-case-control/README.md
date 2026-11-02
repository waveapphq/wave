# V-CTRL-SWITCH: Switch/Case Control End-to-End

Verify the Switch container executes its condition-guarded cases exactly as the
control promises: a case runs only on its own condition, Break ends the pass,
Break-off walks on to the next branch, the default is the last stop of that walk
(reached by fall-through as well as by nothing matching), and the `then` egress
always runs. Also covers the container consequences of that model - a disabled
Switch cascades every lane, Skip Block is offered rather than refused, and a
config save never sweeps the `then` edge.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- `fixture.json` - eight chained Switch blocks, one per rule, every `then` lane
  wired so the chain only reaches the end if each egress fires
- `fixture-no-exit.json` - one Switch with NOTHING wired to its `then` handle
  whose matched case chain fails
- `fixture-no-exit-pass.json` - a wired Switch chained into a Switch with nothing
  wired to its `then` handle, both matching a passing case
- `fixture-exit-wired-fail.json` - the same failing case chain WITH the `then`
  lane wired
- The disabled / skip and then-edge specs build their own small fixtures inline

## Steps

1. Import the fixture via `POST /tests` and confirm `POST /tests/{id}/validate`
   reports zero errors
2. Open the test in the workbench, pick the shared environment, press Run
3. Read the console log once the session reaches a terminal state
4. For the disabled case: import the same shape with the Switch disabled and run it
5. For the skip case: set a breakpoint on the Switch, Debug, press Skip Block,
   then Continue
6. For the save case: edit a case label in the config sheet, Save the sheet and
   the workflow, then read `GET /tests/{id}/workflow`
7. For the step case: set a breakpoint on the first block of the S6 case chain,
   Debug with pause-on-first off, press Step Over, then Continue

## Validation

- **S1 break:** `s1-c1` logged, `s1-c2` absent, `s1-then` logged after `s1-c1`
- **S2 fall-through into a match:** `s2-c1` then `s2-c2`, both logged in that order
- **S3 fall-through into a non-match:** `s3-c1` only, `s3-then` still logged
- **S4 no match with a default:** neither case body logs, `s4-def` logs, then `s4-then`
- **S5 no match without a default:** no case body logs, the run log says
  "No case matched", `s5-then` still logs
- **S6 lazy guards:** `s6-c1` writes the variable `s6-c2`'s condition tests, and
  `s6-c2` logs - proof each condition is evaluated when its case is reached
- **S7 fall-through reaches the default:** `s7-c1`, then `s7-def`, with `s7-c2` absent
- **S8 break stops before the default:** `s8-c1` only; `s8-c2` and `s8-def` absent
- **Session outcome:** `passed`, with `sw-before` and `sw-after` bookending the run
- **Canvas paint:** both S2 case lanes read `success` in the same run; un-taken
  lanes read `skipped`
- **Disabled Switch:** neither the case nor the default body logs; the `then`
  body does; session `passed`
- **Skip Block:** the paused Switch offers Skip (not `aria-disabled`), the lanes
  leave no log, and the run re-pauses on the `then` block before continuing
- **Config save:** after renaming a case, the persisted Switch still carries
  `branch_0`, `branch_1` and `then`; after deleting the second case it carries
  `branch_0` and `then`
- **Step Over inside a case chain:** the step ends on the chain's next block
  before that block runs (`s6-c1` has not logged at the pause), and Continue
  finishes the chain through `s6-then` to a `passed` run - a step that never
  ends would mute every later pause in the chain instead
- **Failing case chain, no exit wired:** the failing Log reads `failed`, the
  Switch reads `failed`, the session ends `failed`, the log carries
  `halted with status: failed` and never carries `completed successfully`
- **Passing case chain, no exit wired:** the wired Switch ahead of it still
  carries the flow on (`snp-1-then` logs and reads `success`), the second
  Switch's matched case logs while its unmatched case does not, the session ends
  `passed` and the log carries `completed successfully`
- **Failing case chain, exit wired:** unchanged - the exit lane carries no
  execution status on the live canvas (a container's skipped exit lane is stored
  but never broadcast), neither `sew-then` nor `sew-after` logs, and the session
  ends `failed`
