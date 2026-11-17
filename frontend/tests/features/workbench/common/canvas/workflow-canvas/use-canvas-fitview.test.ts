/**
 * fitCanvas - the canvas fit behind every fit request.
 *
 * A plain request fits the rendered nodes with the canvas padding. A watched
 * build's request fits its finished bounds together with what the canvas
 * already shows (the Start node); a finished test too big for the smallest zoom
 * starts at that zoom on its top instead (WATCH-8).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fitCanvas } from '@/features/workbench/common/canvas/workflow-canvas/use-canvas-fitview'

const SIZE = { width: 1000, height: 600, minZoom: 0.5, maxZoom: 2 }
const START = { x: -50, y: 0, width: 100, height: 44 }

const flow = {
  fitView: vi.fn(),
  fitBounds: vi.fn(),
  setViewport: vi.fn(),
  getNodes: vi.fn(),
  getNodesBounds: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  flow.getNodes.mockReturnValue([{ id: 'start-node' }])
  flow.getNodesBounds.mockReturnValue(START)
})

describe('fitCanvas', () => {
  it('fits the rendered nodes with the canvas padding by default', () => {
    fitCanvas(flow, SIZE, null)

    expect(flow.fitView).toHaveBeenCalledWith({ padding: 0.2, duration: 200 })
  })

  it('honors the requested padding and duration', () => {
    fitCanvas(flow, SIZE, { padding: 0.5, duration: 0 })

    expect(flow.fitView).toHaveBeenCalledWith({ padding: 0.5, duration: 0 })
  })

  it("fits a build's finished bounds together with the Start node", () => {
    fitCanvas(flow, SIZE, { duration: 0, bounds: { x: -80, y: 140, width: 160, height: 353 } })

    expect(flow.getNodesBounds).toHaveBeenCalledWith([{ id: 'start-node' }])
    expect(flow.fitBounds).toHaveBeenCalledWith(
      { x: -80, y: 0, width: 160, height: 493 },
      { padding: 0.2, duration: 0 },
    )
    expect(flow.fitView).not.toHaveBeenCalled()
    expect(flow.setViewport).not.toHaveBeenCalled()
  })

  it('starts a finished test too tall for the smallest zoom on its top, at that zoom', () => {
    fitCanvas(flow, SIZE, { duration: 0, bounds: { x: -80, y: 140, width: 160, height: 2860 } })

    expect(flow.setViewport).toHaveBeenCalledWith({ x: 500, y: 50, zoom: 0.5 }, { duration: 0 })
    expect(flow.fitBounds).not.toHaveBeenCalled()
    expect(flow.fitView).not.toHaveBeenCalled()
  })

  it('fits the bounds alone while the canvas shows nothing yet', () => {
    flow.getNodes.mockReturnValue([])

    fitCanvas(flow, SIZE, { duration: 0, bounds: { x: -80, y: 140, width: 160, height: 353 } })

    expect(flow.getNodesBounds).not.toHaveBeenCalled()
    expect(flow.fitBounds).toHaveBeenCalledWith(
      { x: -80, y: 140, width: 160, height: 353 },
      { padding: 0.2, duration: 0 },
    )
  })
})
