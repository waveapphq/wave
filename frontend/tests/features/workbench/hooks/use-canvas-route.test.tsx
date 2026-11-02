/**
 * useCanvasRoute Hook Tests
 *
 * Tests for the canvas route detection hook that enables sidebar
 * auto-collapse on canvas routes per SHELL-6.
 *
 * Visual Test: V-CANVAS-01a
 *
 * Canvas Routes (trigger auto-collapse):
 * - /workbench - live workbench
 * - /workbench/:blockId - live workbench editing a specific entity
 * - /executions/history/:runId - historical test canvas
 */

import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createSimpleRouterWrapper } from '../../../utils/router-test-utils'
import { useCanvasRoute } from '@/features/workbench/hooks/use-canvas-route'

describe('useCanvasRoute', () => {
  describe('canvas route detection', () => {
    it('returns true for /workbench route', () => {
      const wrapper = createSimpleRouterWrapper(['/workbench'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(true)
    })

    it('returns true for /workbench/:blockId route', () => {
      const wrapper = createSimpleRouterWrapper(['/workbench/block-456'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(true)
    })

    it('returns true for /executions/history/:runId route', () => {
      const wrapper = createSimpleRouterWrapper(['/executions/history/run-1'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(true)
    })

    it('handles UUID-style block IDs', () => {
      const wrapper = createSimpleRouterWrapper(['/workbench/a1b2c3d4-e5f6-7890-abcd-ef1234567890'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(true)
    })
  })

  describe('non-canvas route detection', () => {
    it('returns false for /tests list route', () => {
      const wrapper = createSimpleRouterWrapper(['/tests'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(false)
    })

    it('returns false for /tests/:testId detail route (read-only)', () => {
      const wrapper = createSimpleRouterWrapper(['/tests/test-123'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(false)
    })

    it('returns false for /suites routes (non-canvas forms)', () => {
      const wrapperList = createSimpleRouterWrapper(['/suites'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapperList }).result.current).toBe(false)

      const wrapperNew = createSimpleRouterWrapper(['/suites/new'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapperNew }).result.current).toBe(false)

      const wrapperEdit = createSimpleRouterWrapper(['/suites/suite-123/edit'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapperEdit }).result.current).toBe(false)
    })

    it('returns false for /regressions routes', () => {
      const wrapper = createSimpleRouterWrapper(['/regressions'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(false)
    })

    it('returns false for /executions routes', () => {
      const wrapper = createSimpleRouterWrapper(['/executions'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(false)
    })

    it('returns false for /dashboard route', () => {
      const wrapper = createSimpleRouterWrapper(['/dashboard'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(false)
    })

    it('returns false for /settings routes', () => {
      const wrapperSettings = createSimpleRouterWrapper(['/settings'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapperSettings }).result.current).toBe(false)

      const wrapperSection = createSimpleRouterWrapper(['/settings/environments'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapperSection }).result.current).toBe(false)
    })

    it('returns false for /profiles routes', () => {
      const wrapper = createSimpleRouterWrapper(['/profiles'])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(false)
    })

    it('returns false for /blocks list and detail routes', () => {
      const wrapperList = createSimpleRouterWrapper(['/blocks'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapperList }).result.current).toBe(false)

      const wrapperDetail = createSimpleRouterWrapper(['/blocks/block-123'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapperDetail }).result.current).toBe(false)
    })

    it('returns false for root path and login', () => {
      const wrapperRoot = createSimpleRouterWrapper(['/'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapperRoot }).result.current).toBe(false)

      const wrapperLogin = createSimpleRouterWrapper(['/login'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapperLogin }).result.current).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('returns false for routes that look similar but are not canvas routes', () => {
      // /workbench-settings - different route entirely
      const wrapper1 = createSimpleRouterWrapper(['/workbench-settings'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapper1 }).result.current).toBe(false)

      // /executions/exec-1/tests - missing testId segment
      const wrapper2 = createSimpleRouterWrapper(['/executions/exec-1/tests'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapper2 }).result.current).toBe(false)
    })

    it('handles trailing slashes consistently', () => {
      // /workbench/ with trailing slash
      const wrapper1 = createSimpleRouterWrapper(['/workbench/'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapper1 }).result.current).toBe(true)

      // /executions/history/run-1/ with trailing slash
      const wrapper2 = createSimpleRouterWrapper(['/executions/history/run-1/'])
      expect(renderHook(() => useCanvasRoute(), { wrapper: wrapper2 }).result.current).toBe(true)
    })

    it('handles empty or malformed paths', () => {
      const wrapper = createSimpleRouterWrapper([''])
      const { result } = renderHook(() => useCanvasRoute(), { wrapper })

      expect(result.current).toBe(false)
    })
  })
})
