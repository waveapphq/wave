/**
 * The body a Shared Function instance opens with: its edit-mode draft, else the
 * library entry, its local variables read into the canvas shape (REQ-3.1.2.1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getFunctionMock, getFunctionVersionMock } = vi.hoisted(() => ({
  getFunctionMock: vi.fn(),
  getFunctionVersionMock: vi.fn(),
}))

vi.mock('@/features/functions/api/functions-api', () => ({
  getFunction: (...args: unknown[]) => getFunctionMock(...args),
  getFunctionVersion: (...args: unknown[]) => getFunctionVersionMock(...args),
}))

import {
  fetchSharedBody,
  libraryBody,
  publishedDraftBody,
  sharedDraftBody,
} from '@/features/functions/canvas/shared-function-body'

const STORED_LOCAL = { name: 'api_key', type: 'string', value: 'wave:enc:v1:c2VhbGVk', secret: true }
const CANVAS_LOCAL = { id: 'var-1', name: 'api_key', type: 'string', value: 'x', isSecret: true }

function definition(extra: Record<string, unknown> = {}) {
  return { workflow: { nodes: [], edges: [] }, ...extra }
}

beforeEach(() => {
  getFunctionMock.mockReset()
  getFunctionVersionMock.mockReset()
})

describe('libraryBody - a library definition as the body a drill opens', () => {
  it('reads its locals into the canvas shape, with an id and isSecret', () => {
    const body = libraryBody(definition({ inputs: [{ name: 'who' }], outputs: [{ name: 'out' }], variables: [STORED_LOCAL] }))

    expect(body.inputs).toEqual([{ name: 'who' }])
    expect(body.outputs).toEqual([{ name: 'out' }])
    expect(body.variables).toEqual([
      expect.objectContaining({ name: 'api_key', type: 'string', value: 'wave:enc:v1:c2VhbGVk', isSecret: true, id: expect.any(String) }),
    ])
    expect(body.variables?.[0]).not.toHaveProperty('secret')
  })

  it('reads the locals of a nested Local body too', () => {
    const inner = {
      id: 'inner',
      data: { nodeType: 'function', localDefinition: definition({ variables: [STORED_LOCAL] }) },
    }

    const body = libraryBody(definition({ workflow: { nodes: [inner], edges: [] } }))

    const innerBody = (body.workflow.nodes[0].data as { localDefinition: { variables: unknown[] } }).localDefinition
    expect(innerBody.variables).toEqual([expect.objectContaining({ name: 'api_key', isSecret: true })])
  })

  it('gives a definition without parameters or locals empty lists', () => {
    expect(libraryBody(definition())).toEqual({ workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] })
  })
})

describe('sharedDraftBody - the edit-mode draft of a Shared instance', () => {
  it('opens the in-memory draft as it is, its canvas locals kept', () => {
    const draft = definition({ inputs: [], outputs: [], variables: [CANVAS_LOCAL] })

    expect(sharedDraftBody({ editMode: true, draft })).toEqual({ ...draft, variables: [CANVAS_LOCAL] })
  })

  it('gives a draft without locals an empty list', () => {
    expect(sharedDraftBody({ editMode: true, draft: definition() })?.variables).toEqual([])
  })

  it('is null outside edit mode or without a draft body', () => {
    expect(sharedDraftBody({ editMode: false, draft: definition() })).toBeNull()
    expect(sharedDraftBody({ editMode: true })).toBeNull()
    expect(sharedDraftBody({ editMode: true, draft: {} })).toBeNull()
  })
})

describe('fetchSharedBody - the library body at the pinned version', () => {
  it('reads the pinned version, its locals in the canvas shape', async () => {
    getFunctionVersionMock.mockResolvedValue({ definition: definition({ variables: [STORED_LOCAL] }) })

    const body = await fetchSharedBody('fn-1', '1.2.0')

    expect(getFunctionVersionMock).toHaveBeenCalledWith('fn-1', '1.2.0')
    expect(getFunctionMock).not.toHaveBeenCalled()
    expect(body.variables).toEqual([expect.objectContaining({ name: 'api_key', isSecret: true })])
  })

  it('reads the latest entry when no version is pinned', async () => {
    getFunctionMock.mockResolvedValue({ definition: definition() })

    const body = await fetchSharedBody('fn-1', undefined)

    expect(getFunctionMock).toHaveBeenCalledWith('fn-1')
    expect(body.variables).toEqual([])
  })
})

describe('publishedDraftBody - a just-published draft as the body a drill opens', () => {
  it('reads the stored draft into the canvas shape, like a library read', () => {
    const draft = definition({ variables: [STORED_LOCAL] })
    expect(publishedDraftBody(draft)?.variables).toEqual([
      expect.objectContaining({ name: 'api_key', type: 'string', value: STORED_LOCAL.value, isSecret: true }),
    ])
  })

  it('gives nothing for a draft without a body', () => {
    expect(publishedDraftBody({ name: 'Greet' })).toBeNull()
  })
})
