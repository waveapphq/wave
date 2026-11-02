/**
 * useProfileForm: the field errors of the profile modal.
 *
 * REQ-4.7.3, REQ-4.7.5; FIELDERR-1, FIELDERR-3, K8SPROF-6
 */

import { createElement, Fragment, type ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ToastContainer, ToastProvider } from '@/components/ui/toast'
import {
  useProfileForm,
  type UseProfileFormOptions,
} from '@/features/profiles/components/profile-form-modal/use-profile-form'
import type {
  Environment,
  Profile,
  ProfileTypeSchemaField,
} from '@/features/profiles/components/profile-form-modal/types'

const ENVIRONMENTS: Environment[] = [
  { id: 'env-1', name: 'Production', tags: [] },
  { id: 'env-2', name: 'Staging', tags: [] },
]

const PORT_MESSAGE = 'port must be between 1 and 65535'

// The database profile schema: target fields only, the port bounded like the block's Port row.
const DATABASE_SCHEMA: ProfileTypeSchemaField[] = [
  { name: 'host', type: 'string', required: false, secret: false },
  { name: 'port', type: 'integer', required: false, secret: false, minimum: 1, maximum: 65535 },
  { name: 'database', type: 'string', required: false, secret: false },
  { name: 'username', type: 'string', required: false, secret: false },
  { name: 'password', type: 'string', required: false, secret: true },
  { name: 'verify_ssl', type: 'boolean', required: false, secret: false, default: true },
  { name: 'ca_cert', type: 'string', required: false, secret: false },
  { name: 'client_cert', type: 'string', required: false, secret: false },
  { name: 'client_key', type: 'string', required: false, secret: true },
  { name: 'driver_options', type: 'map', required: false, secret: false },
]

const DATABASE_PROFILE: Profile = {
  id: 'profile-db',
  name: 'Shop DB',
  type: 'database',
  description: null,
  tags: [],
  usage: 0,
  parameters: [
    { id: 'param-host', name: 'host', type: 'string', secret: false, values: { 'env-1': 'db.lab', 'env-2': 'db.stage' } },
    { id: 'param-port', name: 'port', type: 'integer', secret: false, values: { 'env-1': '70000', 'env-2': '5432' } },
  ],
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
}

const CUSTOM_PROFILE: Profile = { ...DATABASE_PROFILE, id: 'profile-custom', type: 'custom' }

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ToastProvider, {
    children: createElement(Fragment, null, children, createElement(ToastContainer)),
  })
}

function renderForm(overrides: Partial<UseProfileFormOptions> = {}) {
  const options: UseProfileFormOptions = {
    open: true,
    mode: 'create',
    profile: undefined,
    environments: ENVIRONMENTS,
    onFetchTypeSchema: vi.fn().mockResolvedValue(DATABASE_SCHEMA),
    onSubmit: vi.fn(),
    onDelete: vi.fn(),
    loading: false,
    ...overrides,
  }
  const view = renderHook((props: UseProfileFormOptions) => useProfileForm(props), {
    initialProps: options,
    wrapper,
  })
  return { ...view, options }
}

type FormResult = ReturnType<typeof renderForm>['result']

/** Name the profile, pick the database type and wait for its rows; returns the port row id. */
async function pickDatabase(result: FormResult): Promise<string> {
  act(() => {
    result.current.handleFieldChange('name', 'Shop DB')
  })
  act(() => {
    result.current.handleTypeSelect('database')
  })
  await waitFor(() => {
    expect(result.current.formData.parameters).toHaveLength(DATABASE_SCHEMA.length)
  })
  const port = result.current.formData.parameters.find((p) => p.name === 'port')
  return port!.id
}

function setValue(result: FormResult, id: string, value: string) {
  act(() => {
    result.current.handleUpdateParameterValue(id, value)
  })
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useProfileForm - value bounds in create mode', () => {
  it('reads no schema before a type is picked, then once for the picked type', async () => {
    const onFetchTypeSchema = vi.fn().mockResolvedValue(DATABASE_SCHEMA)
    const { result } = renderForm({ onFetchTypeSchema })
    await settle()
    expect(onFetchTypeSchema).not.toHaveBeenCalled()

    await pickDatabase(result)

    expect(onFetchTypeSchema).toHaveBeenCalledTimes(1)
    expect(onFetchTypeSchema).toHaveBeenCalledWith('database')
  })

  it('names a port above the highest bound and blocks the form', async () => {
    const { result } = renderForm()
    const portId = await pickDatabase(result)

    setValue(result, portId, '70000')

    expect(result.current.valueErrors).toEqual({ [portId]: PORT_MESSAGE })
    expect(result.current.isFormValid).toBe(false)
    expect(result.current.canSubmit).toBe(false)
  })

  it('names a port below the lowest bound', async () => {
    const { result } = renderForm()
    const portId = await pickDatabase(result)

    setValue(result, portId, '0')

    expect(result.current.valueErrors).toEqual({ [portId]: PORT_MESSAGE })
    expect(result.current.isFormValid).toBe(false)
  })

  it.each(['5432', '', '1', '65535'])('accepts the port %j', async (port) => {
    const { result } = renderForm()
    const portId = await pickDatabase(result)

    setValue(result, portId, port)

    expect(result.current.valueErrors).toEqual({})
    expect(result.current.isFormValid).toBe(true)
  })

  it('clears the message once the port is back inside the range', async () => {
    const { result } = renderForm()
    const portId = await pickDatabase(result)
    setValue(result, portId, '70000')

    setValue(result, portId, '5432')

    expect(result.current.valueErrors).toEqual({})
    expect(result.current.isFormValid).toBe(true)
  })

  it('names the value of the environment on screen', async () => {
    const { result } = renderForm()
    const portId = await pickDatabase(result)
    setValue(result, portId, '70000')

    act(() => {
      result.current.handleEnvironmentSelect('env-2')
    })
    expect(result.current.valueErrors).toEqual({})

    act(() => {
      result.current.handleEnvironmentSelect('env-1')
    })
    expect(result.current.valueErrors).toEqual({ [portId]: PORT_MESSAGE })
  })

  it('checks no bounds on a custom profile, which has no schema', async () => {
    const onFetchTypeSchema = vi.fn().mockResolvedValue(DATABASE_SCHEMA)
    const { result } = renderForm({ onFetchTypeSchema })
    act(() => {
      result.current.handleFieldChange('name', 'Hand built')
    })
    act(() => {
      result.current.handleAddParameter()
    })
    const id = result.current.formData.parameters[0].id
    act(() => {
      result.current.handleUpdateParameter(id, { name: 'port', type: 'integer' })
    })

    setValue(result, id, '70000')

    expect(result.current.valueErrors).toEqual({})
    expect(result.current.isFormValid).toBe(true)
    expect(onFetchTypeSchema).not.toHaveBeenCalled()
  })

  // Every number cell keeps the one number rule, on a typed and a custom profile (REQ-3.1.3.14).
  it.each([
    ['-', 'Enter a valid integer value'],
    ['12345678901234567890', 'Maximum 19 digits'],
  ])('names a port %j and blocks the form', async (port, message) => {
    const { result } = renderForm()
    const portId = await pickDatabase(result)

    setValue(result, portId, port)

    expect(result.current.valueErrors).toEqual({ [portId]: message })
    expect(result.current.isFormValid).toBe(false)
  })

  it('compares a port with its bound exactly', async () => {
    const { result } = renderForm()
    const portId = await pickDatabase(result)

    setValue(result, portId, '0065536')

    expect(result.current.valueErrors).toEqual({ [portId]: PORT_MESSAGE })
  })

  it('names unfinished number text on a custom profile, which has no schema', () => {
    const { result } = renderForm()
    act(() => {
      result.current.handleFieldChange('name', 'Hand built')
    })
    act(() => {
      result.current.handleAddParameter()
    })
    const id = result.current.formData.parameters[0].id
    act(() => {
      result.current.handleUpdateParameter(id, { name: 'ratio', type: 'float' })
    })

    setValue(result, id, '2.')

    expect(result.current.valueErrors).toEqual({ [id]: 'Enter a valid float value' })
    expect(result.current.isFormValid).toBe(false)
  })

  it('flags no schema field as required, even left blank', async () => {
    const { result } = renderForm()
    await pickDatabase(result)

    const host = result.current.formData.parameters.find((p) => p.name === 'host')
    expect(host?.values['env-1']).toBe('')
    expect(result.current.valueErrors).toEqual({})
    expect(result.current.errors).toEqual({})
    expect(result.current.isFormValid).toBe(true)
  })
})

describe('useProfileForm - the Name once it is left', () => {
  it('flags a blank Name', () => {
    const { result } = renderForm()

    act(() => {
      result.current.handleNameBlur()
    })

    expect(result.current.errors).toEqual({ name: 'Name is required' })
  })

  it('flags a blank Name only once the click that left it has landed (FIELDERR-2)', async () => {
    const { result } = renderForm()

    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
      result.current.handleNameBlur()
    })
    expect(result.current.errors).toEqual({})

    act(() => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await waitFor(() => {
      expect(result.current.errors).toEqual({ name: 'Name is required' })
    })
  })

  it('flags a Name holding only spaces', () => {
    const { result } = renderForm()
    act(() => {
      result.current.handleFieldChange('name', '   ')
    })

    act(() => {
      result.current.handleNameBlur()
    })

    expect(result.current.errors).toEqual({ name: 'Name is required' })
  })

  it('leaves a typed Name alone', () => {
    const { result } = renderForm()
    act(() => {
      result.current.handleFieldChange('name', 'Shop DB')
    })

    act(() => {
      result.current.handleNameBlur()
    })

    expect(result.current.errors).toEqual({})
  })

  it('clears the message once a name is typed', () => {
    const { result } = renderForm()
    act(() => {
      result.current.handleNameBlur()
    })

    act(() => {
      result.current.handleFieldChange('name', 'Shop DB')
    })

    expect(result.current.errors).toEqual({})
  })
})

describe('useProfileForm - value bounds in edit mode', () => {
  it('reads the schema of the profile type once on open', async () => {
    const onFetchTypeSchema = vi.fn().mockResolvedValue(DATABASE_SCHEMA)
    const { result, rerender, options } = renderForm({
      mode: 'edit',
      profile: DATABASE_PROFILE,
      onFetchTypeSchema,
    })
    await waitFor(() => {
      expect(result.current.valueErrors).toEqual({ 'param-port': PORT_MESSAGE })
    })

    rerender({ ...options })
    await settle()

    expect(onFetchTypeSchema).toHaveBeenCalledTimes(1)
    expect(onFetchTypeSchema).toHaveBeenCalledWith('database')
  })

  it('applies the bounds to the stored value and blocks Save', async () => {
    const { result } = renderForm({ mode: 'edit', profile: DATABASE_PROFILE })

    await waitFor(() => {
      expect(result.current.valueErrors).toEqual({ 'param-port': PORT_MESSAGE })
    })
    expect(result.current.isFormValid).toBe(false)
    expect(result.current.canSubmit).toBe(false)
  })

  it('keeps the rows as stored and the form clean', async () => {
    const { result } = renderForm({ mode: 'edit', profile: DATABASE_PROFILE })

    await waitFor(() => {
      expect(result.current.valueErrors).toEqual({ 'param-port': PORT_MESSAGE })
    })
    expect(result.current.isDirty).toBe(false)
    expect(result.current.formData.parameters).toEqual(DATABASE_PROFILE.parameters)
  })

  it('names the value of the environment on screen', async () => {
    const { result } = renderForm({ mode: 'edit', profile: DATABASE_PROFILE })
    await waitFor(() => {
      expect(result.current.valueErrors).toEqual({ 'param-port': PORT_MESSAGE })
    })

    act(() => {
      result.current.handleEnvironmentSelect('env-2')
    })

    expect(result.current.valueErrors).toEqual({})
  })

  it('reads nothing for a custom profile', async () => {
    const onFetchTypeSchema = vi.fn().mockResolvedValue(DATABASE_SCHEMA)
    const { result } = renderForm({ mode: 'edit', profile: CUSTOM_PROFILE, onFetchTypeSchema })
    await settle()

    expect(onFetchTypeSchema).not.toHaveBeenCalled()
    expect(result.current.valueErrors).toEqual({})
  })

  it('stays silent and checks nothing when the schema read fails', async () => {
    const onFetchTypeSchema = vi.fn().mockRejectedValue(new Error('Service Unavailable'))
    const { result } = renderForm({ mode: 'edit', profile: DATABASE_PROFILE, onFetchTypeSchema })
    await waitFor(() => {
      expect(onFetchTypeSchema).toHaveBeenCalledTimes(1)
    })
    await settle()

    expect(document.querySelector('[data-toast]')).toBeNull()
    expect(result.current.valueErrors).toEqual({})
    expect(result.current.isDirty).toBe(false)
  })

  it('checks nothing without a schema reader', async () => {
    const { result } = renderForm({
      mode: 'edit',
      profile: DATABASE_PROFILE,
      onFetchTypeSchema: undefined,
    })
    await settle()

    expect(result.current.valueErrors).toEqual({})
    expect(result.current.isFormValid).toBe(true)
  })
})

describe('useProfileForm - element types per environment (REQ-3.1.3.19)', () => {
  async function driverOptionsRow(result: FormResult): Promise<string> {
    await pickDatabase(result)
    return result.current.formData.parameters.find((p) => p.name === 'driver_options')!.id
  }

  const row = (result: FormResult, id: string) =>
    result.current.formData.parameters.find((p) => p.id === id)!

  it('stores a value\'s element types under the selected environment, and drops them with the value', async () => {
    const { result } = renderForm()
    const id = await driverOptionsRow(result)
    act(() => {
      result.current.handleUpdateParameterValue(id, '{"n":"16"}', { n: 'integer' })
    })
    expect(row(result, id).elementTypes).toEqual({ 'env-1': { n: 'integer' } })

    act(() => {
      result.current.handleUpdateParameterValue(id, '')
    })
    expect(row(result, id).elementTypes).toBeUndefined()
  })

  it('copies the element types with the values from another environment', async () => {
    const { result } = renderForm()
    const id = await driverOptionsRow(result)
    act(() => {
      result.current.handleUpdateParameterValue(id, '{"n":"16"}', { n: 'integer' })
    })
    act(() => {
      result.current.handleEnvironmentSelect('env-2')
    })
    act(() => {
      result.current.handleCopyValuesConfirm('env-1')
    })
    expect(row(result, id).values['env-2']).toBe('{"n":"16"}')
    expect(row(result, id).elementTypes).toEqual({
      'env-1': { n: 'integer' },
      'env-2': { n: 'integer' },
    })
  })

  it('drops a parameter\'s element types when its type changes', async () => {
    const { result } = renderForm({ mode: 'edit', profile: CUSTOM_PROFILE })
    const id = 'param-host'
    act(() => {
      result.current.handleUpdateParameterValue(id, '[1]', ['integer'])
    })
    act(() => {
      result.current.handleUpdateParameter(id, { type: 'array' })
    })
    await waitFor(() => expect(row(result, id).type).toBe('array'))
    expect(row(result, id).elementTypes).toBeUndefined()
  })
})

describe('useProfileForm - plain-text fields', () => {
  const PLAIN_SCHEMA: ProfileTypeSchemaField[] = DATABASE_SCHEMA.map((field) =>
    ['host', 'ca_cert', 'client_cert'].includes(field.name) ? { ...field, plain: true } : field,
  )

  it('names nothing plain before a schema is read', () => {
    const { result } = renderForm({ onFetchTypeSchema: vi.fn().mockResolvedValue(PLAIN_SCHEMA) })
    expect([...result.current.plainTextNames]).toEqual([])
  })

  it('names the fields the picked type marks plain', async () => {
    const { result } = renderForm({ onFetchTypeSchema: vi.fn().mockResolvedValue(PLAIN_SCHEMA) })
    await pickDatabase(result)
    expect([...result.current.plainTextNames]).toEqual(['host', 'ca_cert', 'client_cert'])
  })

  it('names the plain fields of an edited profile once its schema is read', async () => {
    const { result } = renderForm({
      mode: 'edit',
      profile: DATABASE_PROFILE,
      onFetchTypeSchema: vi.fn().mockResolvedValue(PLAIN_SCHEMA),
    })
    await waitFor(() => {
      expect([...result.current.plainTextNames]).toEqual(['host', 'ca_cert', 'client_cert'])
    })
  })
})
