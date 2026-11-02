/**
 * Sheet layers: where floating sheets mount, and the form freeze they inherit.
 */

import { createContext, useCallback, useState, type ReactNode } from 'react'

/** The element floating sheets mount into; null means the page body. */
export const SheetLayerContext = createContext<HTMLElement | null>(null)

/** Whether the form a sheet was opened from is frozen; undefined outside any such form. */
export const SheetFrozenContext = createContext<boolean | undefined>(undefined)

/** Mounts the sheets opened beneath it inside this surface, beside one another, never inside their opener. */
export function SheetLayer({ children }: Readonly<{ children: ReactNode }>) {
  // Created up front so a sheet open on the very first render already has its layer.
  const [layer] = useState(() => {
    const element = document.createElement('div')
    element.dataset.sheetLayer = ''
    element.style.display = 'contents'
    return element
  })
  // Stable, so the layer is placed once and never re-inserted under an open sheet's focus.
  const attach = useCallback(
    (host: HTMLDivElement | null) => {
      host?.appendChild(layer)
    },
    [layer],
  )
  return (
    <>
      <div ref={attach} className="contents" />
      <SheetLayerContext value={layer}>{children}</SheetLayerContext>
    </>
  )
}

/** A form region whose disabled state also freezes every sheet opened from inside it. */
export function FreezableFieldset({
  disabled,
  children,
}: Readonly<{ disabled: boolean; children: ReactNode }>) {
  return (
    <fieldset disabled={disabled} className="contents">
      <SheetFrozenContext value={disabled}>{children}</SheetFrozenContext>
    </fieldset>
  )
}
