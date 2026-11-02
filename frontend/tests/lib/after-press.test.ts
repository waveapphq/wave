/**
 * afterPress - a layout change waits for the pointer press under way to click.
 *
 * Module: frontend/src/lib/after-press.ts
 *
 * A field message that appears when a field is left grows its row (FIELDERR-2,
 * FIELDERR-3). Leaving by pressing a control below that row must not move the
 * control before its click lands, so the change runs once the press has clicked.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { afterPress } from '@/lib/after-press'

function press(type: 'pointerdown' | 'pointerup' | 'pointercancel', target: EventTarget) {
  target.dispatchEvent(new Event(type, { bubbles: true }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('afterPress', () => {
  it('runs at once when no pointer is pressed', () => {
    const run = vi.fn()
    afterPress(run)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('waits through the press and its click, then runs once', () => {
    vi.useFakeTimers()
    const button = document.createElement('button')
    document.body.appendChild(button)
    const order: string[] = []
    button.addEventListener('click', () => order.push('click'))
    const run = vi.fn(() => order.push('run'))

    press('pointerdown', button)
    afterPress(run)
    expect(run).not.toHaveBeenCalled()

    press('pointerup', button)
    button.click()
    expect(run).not.toHaveBeenCalled()

    vi.runOnlyPendingTimers()
    expect(order).toEqual(['click', 'run'])
    expect(run).toHaveBeenCalledTimes(1)
    button.remove()
  })

  it('runs every change that waited on the same press, in order', () => {
    vi.useFakeTimers()
    const order: number[] = []

    press('pointerdown', window)
    afterPress(() => order.push(1))
    afterPress(() => order.push(2))
    press('pointerup', window)
    vi.runOnlyPendingTimers()

    expect(order).toEqual([1, 2])
  })

  it('runs at once when the press is canceled, since no click follows', () => {
    const run = vi.fn()

    press('pointerdown', document.body)
    afterPress(run)
    press('pointercancel', document.body)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs at once again after a press has ended', () => {
    vi.useFakeTimers()
    press('pointerdown', window)
    press('pointerup', window)
    vi.runOnlyPendingTimers()

    const run = vi.fn()
    afterPress(run)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
