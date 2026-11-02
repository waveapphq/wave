/**
 * Quick-insert scaffold menu data for the shared map editor ("+ Content-Type").
 * Pure types: schemas declare menus, the editor renders them, so both sides
 * stay ignorant of each other.
 */

/** One quick-insert menu item: the row it inserts. */
export interface QuickInsertItem {
  label: string
  /** Muted second line in the menu (e.g. "empty row, key prefilled"). */
  sublabel?: string
  key: string
  value: string
}

/** A scaffold menu on a map param's editor. */
export interface QuickInsertMenu {
  label: string
  items: QuickInsertItem[]
}
