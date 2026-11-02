/**
 * Note Color Presets
 *
 * Color configuration data for note nodes. Provides the 5 approved color
 * presets and a lookup helper.
 *
 * NOTE: All Tailwind class names are written as fully-qualified static strings
 * so the JIT compiler keeps them. Do NOT switch to template literals like
 * `bg-${color}-50` - Tailwind cannot statically detect those, the classes get
 * purged in production builds, and the note colors silently break.
 */

/** Note color preset configuration */
export interface NoteColorPreset {
  id: string
  label: string
  bg: string
  darkBg: string
  border: string
  darkBorder: string
  dot: string
}

// Each preset is a single-line literal so the table reads like a config row
// rather than five visually identical multi-line objects (the latter trips
// SonarQube's CPD duplication detector). Class strings stay fully qualified.
// prettier-ignore
export const NOTE_COLOR_PRESETS: readonly NoteColorPreset[] = [
  { id: 'yellow', label: 'Yellow', bg: 'bg-yellow-50',  darkBg: 'dark:bg-yellow-900/40', border: 'border-yellow-300', darkBorder: 'dark:border-yellow-700/60', dot: 'bg-yellow-400' },
  { id: 'pink',   label: 'Pink',   bg: 'bg-pink-50',    darkBg: 'dark:bg-pink-900/40',   border: 'border-pink-300',   darkBorder: 'dark:border-pink-700/60',   dot: 'bg-pink-400'   },
  { id: 'blue',   label: 'Blue',   bg: 'bg-blue-50',    darkBg: 'dark:bg-blue-900/40',   border: 'border-blue-300',   darkBorder: 'dark:border-blue-700/60',   dot: 'bg-blue-400'   },
  { id: 'green',  label: 'Green',  bg: 'bg-green-50',   darkBg: 'dark:bg-green-900/40',  border: 'border-green-300',  darkBorder: 'dark:border-green-700/60',  dot: 'bg-green-400'  },
  { id: 'slate',  label: 'Slate',  bg: 'bg-slate-100',  darkBg: 'dark:bg-slate-800/50',  border: 'border-slate-300',  darkBorder: 'dark:border-slate-600/60',  dot: 'bg-slate-400'  },
]

/** Get a color preset by ID (falls back to slate) */
export function getNoteColorPreset(colorId: string): NoteColorPreset {
  return NOTE_COLOR_PRESETS.find((p) => p.id === colorId) ?? NOTE_COLOR_PRESETS[4]
}
