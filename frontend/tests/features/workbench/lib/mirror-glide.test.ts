/**
 * The glide of a watched change: which Blocks move, how far a glide
 * has gone, where each moving Block sits on the way, which frames glide, and
 * the phase the canvas shows.
 */

import { describe, it, expect } from 'vitest'
import {
  GLIDE_MS,
  glideMoves,
  glideProgress,
  glidePhase,
  glidesFrame,
  placeGliding,
  type MirrorGlide,
} from '@/features/workbench/lib/mirror-glide'

function at(id: string, x: number, y: number) {
  return { id, position: { x, y } }
}

describe('glideMoves', () => {
  it('takes every shown Block the frame places elsewhere, from where it shows to its new place', () => {
    const moves = glideMoves([at('a', 0, 0), at('b', 0, 200), at('c', 40, 400)], [at('a', 0, 0), at('b', 0, 400), at('c', 80, 400)])

    expect([...moves.keys()]).toEqual(['b', 'c'])
    expect(moves.get('b')).toEqual({ from: { x: 0, y: 200 }, to: { x: 0, y: 400 } })
    expect(moves.get('c')).toEqual({ from: { x: 40, y: 400 }, to: { x: 80, y: 400 } })
  })

  it('leaves out a Block the canvas does not show yet and a Block the frame removes', () => {
    const moves = glideMoves([at('a', 0, 0), at('r', 0, 400)], [at('a', 0, 0), at('n', 0, 200)])

    expect(moves.size).toBe(0)
  })
})

describe('glideProgress', () => {
  it('runs from 0 to 1 over the glide, quick at first and settling at the end', () => {
    expect(GLIDE_MS).toBe(300)
    expect(glideProgress(0)).toBe(0)
    const half = glideProgress(GLIDE_MS / 2)
    expect(half).toBeGreaterThan(0.5)
    expect(half).toBeLessThan(1)
    expect(glideProgress(GLIDE_MS)).toBe(1)
  })

  it('stays within 0 and 1 outside the glide', () => {
    expect(glideProgress(-16)).toBe(0)
    expect(glideProgress(GLIDE_MS * 2)).toBe(1)
  })
})

describe('placeGliding', () => {
  const moves = glideMoves([at('b', 0, 200)], [at('b', 0, 400)])

  it('places every moving Block that far along its way and leaves the others as they are', () => {
    const still = at('a', 0, 0)
    const placed = placeGliding([still, at('b', 0, 400)], moves, 0.25)

    expect(placed[0]).toBe(still)
    expect(placed[1].position).toEqual({ x: 0, y: 250 })
  })

  it('places a Block exactly on its new place at the end', () => {
    const fractional = glideMoves([at('b', 0.1, 0.1)], [at('b', 0.3, 0.7)])

    expect(placeGliding([at('b', 0.1, 0.1)], fractional, 1)[0].position).toEqual({ x: 0.3, y: 0.7 })
  })

  it('keeps every other field of a moving Block', () => {
    const node = { ...at('b', 0, 200), data: { label: 'B' } }

    expect(placeGliding([node], moves, 0.5)[0]).toEqual({ id: 'b', position: { x: 0, y: 300 }, data: { label: 'B' } })
  })
})

describe('glidesFrame', () => {
  const firstStep = {
    watch_kind: 'change',
    final_bounds: { x: 0, y: 0, width: 200, height: 400 },
    active_node_id: null,
    test_id: 'test-7',
  }

  it('glides the first step of a watched change of the test the canvas shows', () => {
    expect(glidesFrame(firstStep, 'test-7')).toBe(true)
  })

  it('places every other frame at once', () => {
    expect(glidesFrame({ ...firstStep, active_node_id: 'n' }, 'test-7')).toBe(false)
    expect(glidesFrame({ ...firstStep, watch_kind: 'build' }, 'test-7')).toBe(false)
    expect(glidesFrame({ ...firstStep, watch_kind: null }, 'test-7')).toBe(false)
    expect(glidesFrame({ ...firstStep, final_bounds: null }, 'test-7')).toBe(false)
    expect(glidesFrame({ test_id: 'test-7' }, 'test-7')).toBe(false)
  })

  it('places the Blocks at once when the canvas shows another test or a new draft', () => {
    expect(glidesFrame(firstStep, 'test-other')).toBe(false)
    expect(glidesFrame(firstStep, null)).toBe(false)
    expect(glidesFrame({ ...firstStep, test_id: null }, null)).toBe(false)
  })
})

describe('glidePhase', () => {
  const glide = (startedAt: number | null): MirrorGlide => ({ moves: new Map(), startedAt, frame: 1 })

  it('names no phase when nothing glides', () => {
    expect(glidePhase(null)).toBeUndefined()
  })

  it('is framing while the view still frames the finished test, then moving', () => {
    expect(glidePhase(glide(null))).toBe('framing')
    expect(glidePhase(glide(16))).toBe('moving')
  })
})
