let pressing = false
const pending: Array<() => void> = []

function release(): void {
  pressing = false
  for (const run of pending.splice(0)) run()
}

// Capture phase, so no handler can hide a press from it.
globalThis.addEventListener('pointerdown', () => { pressing = true }, true)
// A press's click is dispatched in the same task as its pointerup, so the next task follows the click.
globalThis.addEventListener('pointerup', () => { setTimeout(release, 0) }, true)
globalThis.addEventListener('pointercancel', release, true)

/** Runs `run` now, or once the pointer press under way has clicked, so a growing row cannot move that click's target (FIELDERR-2). */
export function afterPress(run: () => void): void {
  if (pressing) pending.push(run)
  else run()
}
