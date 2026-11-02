/**
 * Auth Store Tests - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Tests for the authentication state management store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Unmock the auth store to test the real implementation
vi.unmock('../../../../src/features/auth/stores/auth-store')

// Import the real implementation after unmocking
import { useAuthStore } from '@/features/auth/stores/auth-store'

describe('Auth Store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
    })
  })

  describe('Initial State', () => {
    it('starts with user not authenticated', () => {
      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
    })

    it('starts with loading state as false', () => {
      const state = useAuthStore.getState()
      expect(state.isLoading).toBe(false)
    })
  })

  describe('login', () => {
    it('sets isAuthenticated to true', () => {
      const { login } = useAuthStore.getState()
      login()

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(true)
    })

    it('sets isLoading to false', () => {
      // First set loading to true
      useAuthStore.getState().setLoading(true)
      expect(useAuthStore.getState().isLoading).toBe(true)

      // Login should set loading to false
      useAuthStore.getState().login()
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('transitions from unauthenticated to authenticated', () => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false)

      useAuthStore.getState().login()

      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })
  })

  describe('logout', () => {
    it('sets isAuthenticated to false', () => {
      // First login
      useAuthStore.getState().login()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)

      // Then logout
      useAuthStore.getState().logout()
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })

    it('sets isLoading to false', () => {
      // Set loading to true
      useAuthStore.getState().setLoading(true)
      expect(useAuthStore.getState().isLoading).toBe(true)

      // Logout should set loading to false
      useAuthStore.getState().logout()
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('transitions from authenticated to unauthenticated', () => {
      useAuthStore.getState().login()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)

      useAuthStore.getState().logout()
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })
  })

  describe('setLoading', () => {
    it('sets isLoading to true', () => {
      useAuthStore.getState().setLoading(true)
      expect(useAuthStore.getState().isLoading).toBe(true)
    })

    it('sets isLoading to false', () => {
      useAuthStore.getState().setLoading(true)
      useAuthStore.getState().setLoading(false)
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('does not affect isAuthenticated', () => {
      // Login first
      useAuthStore.getState().login()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)

      // Setting loading should not affect authenticated state
      useAuthStore.getState().setLoading(true)
      expect(useAuthStore.getState().isAuthenticated).toBe(true)

      useAuthStore.getState().setLoading(false)
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })
  })

  describe('State Transitions', () => {
    it('handles complete auth flow: loading -> login -> logout', () => {
      // Start loading
      useAuthStore.getState().setLoading(true)
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: false,
        isLoading: true,
      })

      // Complete login
      useAuthStore.getState().login()
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: true,
        isLoading: false,
      })

      // Logout
      useAuthStore.getState().logout()
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: false,
        isLoading: false,
      })
    })
  })
})
