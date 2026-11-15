import { param, type InputParam, type OutputParam } from '../types'

/** The five Note colors, written once for the field list and the canvas presets. */
export const NOTE_COLOR_IDS = ['yellow', 'pink', 'blue', 'green', 'slate'] as const

export type NoteColorId = (typeof NOTE_COLOR_IDS)[number]

// Text and color live under config.values and are edited on the canvas; a Note opens no config window.
export const inputs: InputParam[] = [
  param('text', 'Text', 'string', false, 'Note text content', { defaultValue: '', noExpression: true }),
  param('color', 'Color', 'string', false, 'Note background color', {
    enumValues: [...NOTE_COLOR_IDS],
    defaultValue: 'slate',
    noExpression: true,
  }),
]

export const outputs: OutputParam[] = []
