# V-FN-DIG-IN (functional)

Regression guard: the dig-in (Open) action on a Shared
Function instance must be observable - never a silent no-op.

## Prerequisites

- Backend with `WAVE_ADMIN_ALLOWED=true` for the seed endpoints.
- Shared canvas helper: `waitForCanvasLoad`.

## Steps + Issue mapping

The spec seeds a library entry (`POST /functions`, body = one Log) and a host
Test with one Shared instance pinned to 1.0.0 (`POST /tests`), then drives two
branches by intercepting the pinned-version resolve
(`GET /functions/{id}/versions/1.0.0`):

| Test | Asserts |
|------|---------|
| Slow resolve | The dig-in glyph shows an instant pending spinner + `aria-busy="true"`; a stacked click while pending is ignored (the in-flight lock keeps the resolve count at 1); the canvas drills in once after the resolve completes. |
| Resolve failure | A 500 on the resolve leaves the instance on the parent canvas (no Function breadcrumb segment) and clears the pending state - the failure is surfaced, not swallowed. |

## Validation

- Pending state is read from the `node-dig-in` glyph (`aria-busy` + the
  `svg.animate-spin` spinner).
- The in-flight lock is proven by counting how many times the intercepted
  resolve actually fires (must be exactly 1 despite two clicks).
- Each `test()` carries an inline `// regression guard: ...` comment naming the
  issue.
