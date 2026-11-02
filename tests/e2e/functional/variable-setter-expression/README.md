# Variable Setter overrides an expression variable (lazy-realization race)

Functional regression guard for `backend/wavecore/controls/variable_setter.py`:
writing a name declared as a still-pending expression variable must supersede it
via a direct write WITHOUT realizing the expression, so no deferred
`variable_changed` push of the OLD value races and clobbers the setter's own
overwrite push, and the watched Current value never reverts.

## Prerequisites

None - the spec imports `fixture.json` via `POST /tests`, ensures the shared
`E2E Execution Env` environment exists, and validates the fixture
(`POST /tests/{id}/validate`, zero errors) before running it.

## Steps

1. Import `fixture.json` (expression variable `s1` source `"123"`; a Variable
   Setter that sets `s1 = "new value!"`; a Delay; a Log reading `s1`).
2. Open the inspect watcher on `s1` (idle: "Not evaluated yet.").
3. Run the workflow via the canvas Run button.

## Validation

- **Validation gate:** `POST /tests/{id}/validate` returns zero errors.
- **Terminal state:** the run reaches `passed`.
- **Watched value:** the watcher's evaluated Current value settles on
  `"new value!"` after the run and never reverts to `"123"`.
- **Propagation:** the downstream Log emits `final=new value!`, never
  `final=123`.
- **Scope:** `GET /workbench/{session_id}/variables` returns
  `s1 = "new value!"` (type `string`).
- **Node status:** the Var Setter and Log nodes both reach `success`.
