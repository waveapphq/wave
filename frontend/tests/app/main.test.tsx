/**
 * Entry Point Tests
 *
 * The entry point mounts the app into the page's root element, inside StrictMode.
 *
 * Module: frontend/src/app/main.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { StrictMode, isValidElement, type ReactElement } from 'react'

const { createRoot, renderRoot, FakeApp } = vi.hoisted(() => {
  const renderRoot = vi.fn()
  const createRoot = vi.fn(() => ({ render: renderRoot, unmount: vi.fn() }))
  const FakeApp = () => null
  return { createRoot, renderRoot, FakeApp }
})

vi.mock('react-dom/client', () => ({ default: { createRoot }, createRoot }))
vi.mock('@/app/App', () => ({ default: FakeApp }))

describe('main entry point', () => {
  afterEach(() => {
    document.getElementById('root')?.remove()
  })

  it('renders the app in StrictMode into the root element', async () => {
    const rootElement = document.createElement('div')
    rootElement.id = 'root'
    document.body.append(rootElement)

    await import('@/app/main')

    expect(createRoot).toHaveBeenCalledTimes(1)
    expect(createRoot).toHaveBeenCalledWith(rootElement)
    expect(renderRoot).toHaveBeenCalledTimes(1)
    const tree = renderRoot.mock.calls[0][0] as ReactElement<{ children: ReactElement }>
    expect(isValidElement(tree)).toBe(true)
    expect(tree.type).toBe(StrictMode)
    expect(tree.props.children.type).toBe(FakeApp)
  })
})
