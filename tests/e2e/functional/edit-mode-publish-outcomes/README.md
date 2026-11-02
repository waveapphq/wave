# V-FN-EDIT-PUBLISH-OUTCOMES (functional)

End-to-end coverage of the three-option publish outcome (CANVAS-219..220) and its
in-memory, no-forced-save semantics (CANVAS-221) plus the single-step
undo/redo version-pin flip (CANVAS-222).

## Prerequisites

- Backend with `WAVE_ADMIN_ALLOWED=true` for the seed endpoints.
- Shared canvas helpers (`tests/e2e/helpers/canvas.ts`): `clickNodeKebabItem`,
  `expectNodeKebabItem`, `dragSourceToCanvas`, `expandPalette`,
  `waitForCanvasLoad`.

## Steps + design mapping

The single spec self-seeds a library entry (`POST /functions`) and a host Test
with one Shared instance at v1.0.0 (`POST /tests`). Every test drives the real
UI flow: node kebab -> Edit -> kebab -> Publish -> fill Changelog -> Publish ->
the `PublishOutcomeDialog`.

| Test | Design | Asserts |
|------|-------|---------|
| Publish and keep Old | CANVAS-220 | The new library version is created, but the instance stays pinned to its source version and exits edit mode (overlay gone; config trigger shows v1.0.0). |
| No force-save / other edits intact | CANVAS-221 | An unrelated unsaved local Function stays on the canvas; `GET /tests` still holds exactly one Function node at v1.0.0 (neither the unrelated node nor the re-pin was persisted). |
| Undo/redo pin flip | CANVAS-222 | After Set New, one undo reverts the pin to the source version on a clean reference (draft unreachable, overlay absent, kebab offers Edit); redo re-pins to the new version. |

## Validation

- The pinned version is read from the Shared config modal's
  `version-dropdown-trigger` (`v{functionVersion}`), because the re-pin is held
  in memory only - publish never saves the Test (CANVAS-221).
- Each `test()` carries an inline `// regression guard: ...` comment naming the
  behavior it locks down.
- Library entries are name-stamped with a random suffix so parallel workers
  never collide.
