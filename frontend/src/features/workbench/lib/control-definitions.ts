/**
 * Control Definitions - REQ-5.2.1.48
 *
 * Hardcoded definitions for the flow controls in WAVE.
 * Provides typed definitions with iconName references (not direct component imports).
 */

/**
 * Control category type.
 */
export type ControlCategory = 'conditional' | 'loop' | 'flow' | 'timing' | 'misc'

/**
 * Control definition interface.
 */
export interface ControlDefinition {
  /** Unique identifier (e.g., 'if-else', 'delay') */
  id: string
  /** Display name (e.g., 'If / Else', 'Delay') */
  name: string
  /** Category for grouping */
  category: ControlCategory
  /** Icon name from icon-registry */
  iconName: string
  /** Tailwind color class for the icon */
  colorClass: string
}

/**
 * Category definition interface.
 */
export interface CategoryDefinition {
  /** Unique identifier (e.g., 'conditional', 'loop') */
  id: ControlCategory
  /** Display name (e.g., 'Conditionals', 'Loops') */
  name: string
  /** Tailwind color class for the category */
  colorClass: string
}

/**
 * Category color classes.
 */
const CATEGORY_COLORS: Record<ControlCategory, string> = {
  conditional: 'text-orange-500',
  loop: 'text-cyan-500',
  flow: 'text-green-500',
  timing: 'text-yellow-500',
  misc: 'text-slate-400',
}

/** Build a control definition with automatic color class from category. */
function def(id: string, name: string, category: ControlCategory, iconName: string): ControlDefinition {
  return { id, name, category, iconName, colorClass: CATEGORY_COLORS[category] }
}

/**
 * All 14 control definitions.
 *
 * Inventory:
 * - Conditional (3): If/Else, Switch/Case, Assert
 * - Loop (5): For, ForEach, While, Break, Continue
 * - Flow (4): Parallel, Try/Catch, Halt, Var Setter
 * - Timing (2): Delay, Wait Until
 */
export const CONTROL_DEFINITIONS: readonly ControlDefinition[] = [
  // Conditionals (orange) - 3 controls
  def('if-else', 'If / Else', 'conditional', 'GitFork'),
  def('switch-case', 'Switch', 'conditional', 'ListTree'),
  def('assert', 'Assert', 'conditional', 'CheckCircle'),

  // Loops (cyan) - 5 controls
  def('for', 'For Loop', 'loop', 'Repeat'),
  def('for-each', 'For Each', 'loop', 'IterationCw'),
  def('while', 'While Loop', 'loop', 'RefreshCw'),
  def('break', 'Break', 'loop', 'LogOut'),
  def('continue', 'Continue', 'loop', 'SkipForward'),

  // Flow (green) - 4 controls
  def('parallel', 'Parallel', 'flow', 'Split'),
  def('try-catch-finally', 'Try / Catch', 'flow', 'ShieldCheck'),
  def('halt', 'Halt', 'flow', 'OctagonX'),
  def('variable-setter', 'Var Setter', 'flow', 'Variable'),

  // Timing (yellow) - 2 controls
  def('delay', 'Delay', 'timing', 'Timer'),
  def('wait-until', 'Wait Until', 'timing', 'Hourglass'),

  // Misc (slate) - 1 control
  def('note', 'Note', 'misc', 'StickyNote'),
]

/**
 * The 4 control categories with display info.
 */
export const CONTROL_CATEGORIES: readonly CategoryDefinition[] = [
  { id: 'conditional', name: 'Conditionals', colorClass: CATEGORY_COLORS.conditional },
  { id: 'loop', name: 'Loops', colorClass: CATEGORY_COLORS.loop },
  { id: 'flow', name: 'Flow', colorClass: CATEGORY_COLORS.flow },
  { id: 'timing', name: 'Timing', colorClass: CATEGORY_COLORS.timing },
  { id: 'misc', name: 'Misc', colorClass: CATEGORY_COLORS.misc },
]

/**
 * Get a control definition by its ID.
 *
 * @param id - The control ID to look up
 * @returns The control definition or undefined if not found
 */
export function getControlById(id: string): ControlDefinition | undefined {
  return CONTROL_DEFINITIONS.find((c) => c.id === id)
}

/**
 * Get all controls in a given category.
 *
 * @param category - The category to filter by
 * @returns Array of controls in the category (empty if invalid category)
 */
export function getControlsByCategory(category: ControlCategory): ControlDefinition[] {
  return CONTROL_DEFINITIONS.filter((c) => c.category === category)
}

/** The color of a control category, for its palette header. */
export function getControlCategoryColor(category: ControlCategory): string {
  return CATEGORY_COLORS[category]
}
