/**
 * Watched build view geometry (WATCH-8): whether a finished test fits the
 * canvas at its smallest zoom, the smallest-zoom view on the top of one that
 * does not, and the least pan that brings a new Block into view.
 *
 * Canvas: 1000 x 600 px, zoom 0.5 to 2, the canvas fit padding 0.2, which
 * leaves 83 px at the sides and 50 px at the top and bottom.
 */

import { describe, it, expect } from 'vitest'
import { fitsCanvas, panIntoView, topFrame, unionRect } from '@/features/workbench/lib/build-view'

const SIZE = { width: 1000, height: 600, minZoom: 0.5, maxZoom: 2 }
const PADDING = 0.2

describe('unionRect', () => {
  it('spans both rects', () => {
    expect(unionRect({ x: 0, y: 0, width: 10, height: 10 }, { x: -5, y: 20, width: 10, height: 10 })).toEqual({
      x: -5,
      y: 0,
      width: 15,
      height: 30,
    })
  })
})

describe('fitsCanvas', () => {
  it('fits a test the canvas fit shows above its smallest zoom', () => {
    expect(fitsCanvas({ x: 0, y: 0, width: 400, height: 300 }, SIZE, PADDING)).toBe(true)
  })

  it('fits a test the canvas fit shows at exactly its smallest zoom', () => {
    expect(fitsCanvas({ x: 0, y: 0, width: 160, height: 1000 }, SIZE, PADDING)).toBe(true)
  })

  it('does not fit a test too tall for the smallest zoom', () => {
    expect(fitsCanvas({ x: 0, y: 0, width: 160, height: 2000 }, SIZE, PADDING)).toBe(false)
  })

  it('does not fit a test too wide for the smallest zoom', () => {
    expect(fitsCanvas({ x: 0, y: 0, width: 4000, height: 100 }, SIZE, PADDING)).toBe(false)
  })

  it('fits a tiny test the canvas fit caps at its largest zoom', () => {
    expect(fitsCanvas({ x: 0, y: 0, width: 10, height: 10 }, SIZE, PADDING)).toBe(true)
  })
})

describe('topFrame', () => {
  it('shows a tall test at the smallest zoom, centered across, its top under the fit margin', () => {
    const tall = { x: -80, y: -20, width: 160, height: 2000 }
    const start = { x: -50, y: -20, width: 100, height: 44 }

    expect(topFrame(tall, start, SIZE, PADDING)).toEqual({ x: 500, y: 60, zoom: 0.5 })
  })

  it('centers a test too wide to show across on where its build begins', () => {
    const wide = { x: -3000, y: 0, width: 4000, height: 300 }
    const start = { x: 100, y: 0, width: 100, height: 44 }

    expect(topFrame(wide, start, SIZE, PADDING)).toEqual({ x: 425, y: 50, zoom: 0.5 })
  })
})

describe('panIntoView', () => {
  const VIEW = { x: 500, y: 50, zoom: 0.5 }

  it('leaves a Block already in view where it is', () => {
    expect(panIntoView(VIEW, { x: -100, y: 140, width: 200, height: 80 }, SIZE, PADDING)).toBeNull()
  })

  it('moves down just enough to show a Block below the view', () => {
    expect(panIntoView(VIEW, { x: -100, y: 1200, width: 200, height: 80 }, SIZE, PADDING)).toEqual({
      x: 500,
      y: -90,
      zoom: 0.5,
    })
  })

  it('moves down just enough for a Block cut off at the bottom', () => {
    expect(panIntoView(VIEW, { x: -100, y: 1060, width: 200, height: 80 }, SIZE, PADDING)).toEqual({
      x: 500,
      y: -20,
      zoom: 0.5,
    })
  })

  it('moves up for a Block above the view', () => {
    expect(panIntoView(VIEW, { x: -100, y: -200, width: 200, height: 80 }, SIZE, PADDING)).toEqual({
      x: 500,
      y: 150,
      zoom: 0.5,
    })
  })

  it('moves across for a Block left of the view', () => {
    expect(panIntoView(VIEW, { x: -1200, y: 140, width: 200, height: 80 }, SIZE, PADDING)).toEqual({
      x: 683,
      y: 50,
      zoom: 0.5,
    })
  })

  it('moves across for a Block right of the view', () => {
    expect(panIntoView(VIEW, { x: 1000, y: 140, width: 200, height: 80 }, SIZE, PADDING)).toEqual({
      x: 317,
      y: 50,
      zoom: 0.5,
    })
  })

  it('shows the top of a Block taller than the view', () => {
    expect(panIntoView(VIEW, { x: -100, y: 1200, width: 200, height: 2000 }, SIZE, PADDING)).toEqual({
      x: 500,
      y: -550,
      zoom: 0.5,
    })
  })
})
