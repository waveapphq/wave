---
id: parallel
description: Execute multiple branches concurrently with fork-join semantics
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-02"
    changelog:
      - "Named branch lanes whose bodies run concurrently over the test's live variables"
      - "Always-present then egress: the join, and the only way out of the section"
      - "Join mode: wait for all branches, or release on the first to finish"
      - "Optional time limits at two independent levels: per branch and per section"
      - "A failed branch ends the section and stops its running siblings"
      - "Stable branch ids so renaming or reordering never re-points a wired edge"
---

## Parallel Control

A container control. Each branch lane holds its own sub-flow, and those sub-flows
run at the same time. The lanes dead-end; the flow leaves the section through the
`then` egress, which is the join.

### Branches
- Two at minimum - one branch is a sequence, which the canvas already expresses.
- Each carries an optional name used by lane tooltips, the run log and reports.
- Each carries an optional time limit in milliseconds.
- A lane with nothing wired to it is legal and finishes immediately.

### Join Mode
- **Wait for all** (the default): the exit runs once every branch has finished.
- **First to finish**: the exit runs as soon as one branch finishes; the others stop at their next block. A stopped loser is the mode working, not a failure.

### Time Limits
Two independent optional limits:
- **Per branch**: when it expires, that branch fails, which ends the section.
- **Per section**: when it expires, every branch still running stops and the section fails. A branch that already finished keeps its outcome.

### Variables
Branches share the test's live variables. There is no copy at the fork and no
merge at the join: a read in one branch sees an earlier write from another, and
what a branch wrote is simply the variable's value after the section. Concurrent
writes to one variable are last-write-wins. Reads and writes are atomic per
variable, so a compound value is never observed half-written.

Work that shares no state - file I/O, HTTP calls - carries no such guarantee.
Coordinate it with Wait Until in Watch mode, gated on a variable a sibling writes.

### Behavior
- A branch failure fails the section, stops running siblings at their next block boundary, and skips the exit lane, so the run stops there. Try/Catch inside a branch is how a failure is tolerated.
- A Halt in a branch ends the section and travels outward with the scope the author declared.
- A failing Assert is not a branch failure: the branch carries on and the exit still runs.
- A debug pause parks the whole section: siblings hold at their next block, Step drives the paused branch alone, Continue releases them all.
- Sections nest at any depth, including inside loops, Try/Catch paths and Function bodies.
- A disabled Parallel skips every branch body and continues through `then`.

### Parameters
| Name | Type | Required | Description |
|------|------|----------|-------------|
| branches | array | Yes | Branch lanes, each with an id, an optional name and an optional time limit in milliseconds |
| join | string | No | Join mode: `all` waits for every branch, `first` for the first |
| time_limit | integer | No | Optional limit for the whole section in milliseconds |
