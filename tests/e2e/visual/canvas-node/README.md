# Canvas Node Visual Tests (V-CANVAS-NODE-01..13)

Visual coverage for the canvas-node redesign: persistent status bar, description row, run-state badges, note edit-mode chrome morph, handle positioning, function lifecycle badges, and the read-only config-modal contract during run.

## Prerequisites

No external seed script. Self-seeding tests build their fixtures inline:

- Palette-drop tests (V-01, V-03, V-06, V-07, V-08, V-11): drop a Shell Script plugin, If/Else control, or Note via `dragPaletteItemToCanvas`. No backend state needed beyond an empty database.
- Fixture tests (V-02, V-09, V-10, V-13): POST `/tests` with a workflow that carries the node-data shape under test, then navigate to `/workbench?editTest=<id>`.
- Structural-only test (V-04): drops an HTTP plugin with its required `url` parameter unset, then asserts the persistent alert-badge structure (left cluster, body bg-elevated). Does NOT cover FAIL run-state visuals; those need a live workflow run (see V-05).
- Not covered (V-05, V-12): RUN-state pulse (V-05) and read-only modal during run (V-12) both require a live workflow execution (env seed + Run-button click + wait), not a mock. Intercepting `GET /executions/history/{runId}` with `page.route` does not work: the apiClient response-envelope wrapping keeps the mocked payload from reaching the component.

## Steps (per test ID)

| Test         | Steps                                                                                                    |
|--------------|----------------------------------------------------------------------------------------------------------|
| V-CANVAS-NODE-01 | Drop Shell Script plugin -> assert persistent bar, cog + kebab, no badges, no description row.               |
| V-CANVAS-NODE-02 | Seed test w/ description -> assert description row, chevron sibling of body, overflow toggle works.  |
| V-CANVAS-NODE-03 | Drop If/Else control -> assert persistent bar; no L/S, no dig-in, no description row.                |
| V-CANVAS-NODE-04 | Drop HTTP without url -> assert alert badge structural (left cluster, body bg-elevated). FAIL run-state assertions need a live run (see V-05). |
| V-CANVAS-NODE-05 | (not covered) RUN badge + animate-execution-pulse needs a live workflow run. |
| V-CANVAS-NODE-06 | Drop Shell Script, kebab -> Disable -> assert grayscale + opacity 0.55, DISABLED badge.                      |
| V-CANVAS-NODE-07 | Drop Note -> assert slim bar with kebab only, both flow handles, no color picker in idle.            |
| V-CANVAS-NODE-08 | Drop Note, double-click -> assert color/accept/cancel cluster, solid blue border, no canvas zoom.    |
| V-CANVAS-NODE-09 | Seed function node w/ `functionLifecycle: 'local'` -> assert L badge + dig-in glyph.                 |
| V-CANVAS-NODE-10 | Seed function node w/ `functionLifecycle: 'shared'` -> assert S badge + ver-arrow ordering.          |
| V-CANVAS-NODE-11 | Drop Shell Script -> measure handle bounding boxes vs card -> assert vertical centers within +/- 2 px.       |
| V-CANVAS-NODE-12 | (not covered) Read-only modal during run needs a live workflow run.      |
| V-CANVAS-NODE-13 | Seed test w/ long description -> assert chevron is `<button>`, no nested-button warnings on toggle.  |

## Validation

Each test asserts `data-testid`-based selectors defined in the canvas-node source files (`node.tsx`, `node-status-bar.tsx`, `node-description-row.tsx`, `note-node.tsx`, `input-handles.tsx`, `output-handles.tsx`) and run-state CSS classes from `frontend/src/features/workbench/common/canvas/workflow-node/execution-styles.ts`. The body and bar carry no execution-bg tint - all execution state is communicated through the colored outline and the badge in the bar.
