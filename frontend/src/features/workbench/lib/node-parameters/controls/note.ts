import type { InputParam, OutputParam } from '../types'

// Notes are pure canvas annotations - text and color live on data.config and
// are edited inline. No params, no element config; the param panel is suppressed
// in use-canvas-interactions.ts via the noteNode RF type guard.
export const inputs: InputParam[] = []

export const outputs: OutputParam[] = []
