/**
 * Note Color Presets
 *
 * Color configuration data for note nodes: one preset per Note color id, and a lookup helper.
 *
 * NOTE: All Tailwind class names are written as fully-qualified static strings
 * so the JIT compiler keeps them. Do NOT switch to template literals like
 * `bg-${color}-50` - Tailwind cannot statically detect those, the classes get
 * purged in production builds, and the note colors silently break.
 */

import { controlDefault } from '@/features/workbench/lib/node-parameters'
import { NOTE_COLOR_IDS, type NoteColorId } from '@/features/workbench/lib/node-parameters/controls/note'

/** Note color preset configuration */
export interface NoteColorPreset {
  id: NoteColorId
  label: string
  bg: string
  darkBg: string
  border: string
  darkBorder: string
  dot: string
}

type PresetLook = Omit<NoteColorPreset, 'id'>

// Each look is a single-line literal so the table reads like a config row
// rather than five visually identical multi-line objects (the latter trips
// SonarQube's CPD duplication detector). Class strings stay fully qualified.
// prettier-ignore
const PRESET_LOOKS: Record<NoteColorId, PresetLook> = {
  yellow: { label: 'Yellow', bg: 'bg-yellow-50',  darkBg: 'dark:bg-yellow-900/40', border: 'border-yellow-300', darkBorder: 'dark:border-yellow-700/60', dot: 'bg-yellow-400' },
  pink:   { label: 'Pink',   bg: 'bg-pink-50',    darkBg: 'dark:bg-pink-900/40',   border: 'border-pink-300',   darkBorder: 'dark:border-pink-700/60',   dot: 'bg-pink-400'   },
  blue:   { label: 'Blue',   bg: 'bg-blue-50',    darkBg: 'dark:bg-blue-900/40',   border: 'border-blue-300',   darkBorder: 'dark:border-blue-700/60',   dot: 'bg-blue-400'   },
  green:  { label: 'Green',  bg: 'bg-green-50',   darkBg: 'dark:bg-green-900/40',  border: 'border-green-300',  darkBorder: 'dark:border-green-700/60',  dot: 'bg-green-400'  },
  slate:  { label: 'Slate',  bg: 'bg-slate-100',  darkBg: 'dark:bg-slate-800/50',  border: 'border-slate-300',  darkBorder: 'dark:border-slate-600/60',  dot: 'bg-slate-400'  },
}

const PRESETS_BY_ID = new Map<string, NoteColorPreset>(NOTE_COLOR_IDS.map((id) => [id, { id, ...PRESET_LOOKS[id] }]))

export const NOTE_COLOR_PRESETS: readonly NoteColorPreset[] = [...PRESETS_BY_ID.values()]

const DEFAULT_PRESET = PRESETS_BY_ID.get(controlDefault('note', 'color') as NoteColorId) as NoteColorPreset

/** Get a color preset by ID; an unknown id gets the Note field list's default color. */
export function getNoteColorPreset(colorId: string): NoteColorPreset {
  return PRESETS_BY_ID.get(colorId) ?? DEFAULT_PRESET
}
