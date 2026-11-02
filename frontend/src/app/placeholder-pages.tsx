/**
 * Simple Placeholder Pages
 *
 * Minimal stub pages for routes that haven't been fully implemented yet.
 */

import { type ReactNode } from 'react'

// User page
export function UserPage(): ReactNode {
  return <div data-testid="user-page">User Profile</div>
}

// WorkbenchPage implementation is in workbench-container.tsx (re-exported as WorkbenchPage from index.ts)

// Profile pages
// ProfilesListPage was replaced by ProfilesListContainer

export function ProfileDetailPage(): ReactNode {
  return <div data-testid="profile-detail-page">Profile Detail</div>
}

export function ProfileCreatePage(): ReactNode {
  return <div data-testid="profile-create-page">Profile Create</div>
}

export function ProfileEditPage(): ReactNode {
  return <div data-testid="profile-edit-page">Profile Edit</div>
}

// Report pages live in features/reports (container + detail/report-viewer-page)

// Artifact pages live in features/artifacts (container + detail/artifact-drill-page)
