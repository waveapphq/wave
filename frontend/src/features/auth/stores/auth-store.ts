/**
 * Auth Store - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Zustand store for managing authentication state.
 * Used by navigation guards for protected routes.
 */

import { create } from 'zustand'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  login: () => void
  logout: () => void
  setLoading: (loading: boolean) => void
}

/**
 * Zustand store for authentication state
 *
 * In development mode, default to authenticated to allow UI development
 * without requiring a backend. In production, this would be false.
 */
export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: true,
  isLoading: false,
  login: () => set({ isAuthenticated: true, isLoading: false }),
  logout: () => set({ isAuthenticated: false, isLoading: false }),
  setLoading: (loading: boolean) => set({ isLoading: loading }),
}))
