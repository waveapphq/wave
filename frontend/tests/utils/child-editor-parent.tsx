/**
 * A stand-in parent for child editor tests: it opens a scope, lists what its
 * open children report, and hands back the scope so a test can apply them.
 */

import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'

import {
  ChildEditorsProvider,
  useChildEditorScope,
  type ChildEditorScope,
} from '@/components/shared/child-editors/child-editor-scope'
import type { ChildEditorStatus } from '@/lib/child-editors'

let lastScope: ChildEditorScope | null = null

export function ChildEditorParent({ children }: Readonly<{ children: ReactNode }>) {
  const scope = useChildEditorScope()
  lastScope = scope
  return (
    <ChildEditorsProvider scope={scope}>
      <output data-testid="parent-children">{JSON.stringify(scope.children)}</output>
      {children}
    </ChildEditorsProvider>
  )
}

/** What the open children last reported to the stand-in parent. */
export function parentChildren(): ChildEditorStatus[] {
  return JSON.parse(screen.getByTestId('parent-children').textContent ?? '[]') as ChildEditorStatus[]
}

/** Writes every changed child into the stand-in parent. */
export function applyParentChildren(): void {
  lastScope?.applyAll()
}
