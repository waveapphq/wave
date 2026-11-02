/**
 * Auth-helper builtins FE/BE parity (REQ-3.4.1.4).
 *
 * The basic_auth / bearer / secret expression helpers do not exist on either
 * side (BE SAFE_BUILTINS + SECRET_RESULT_BUILTINS, FE python-builtins mirror).
 * This pins their ABSENCE: the canonical builtin set does not contain them, and
 * the expression whitelist rejects calling them.
 */
import { describe, it, expect } from 'vitest'
import {
  ALLOWED_BUILTINS,
  FIELD_ALLOWED_BUILTINS,
  PYTHON_BUILTINS,
  getBuiltinByName,
} from '@/features/workbench/lib/python-builtins'
import { validateExpressions } from '@/features/workbench/lib/expression-validation'

// The deleted helper trio - absent from the FE mirror exactly as it is absent
// from the backend SAFE_BUILTINS (and its SECRET_RESULT_BUILTINS metadata set).
const DELETED_HELPERS = ['basic_auth', 'bearer', 'secret'] as const

describe('python-builtins mirror no longer lists the helper trio', () => {
  it.each(DELETED_HELPERS)('does not declare %s at all', (name) => {
    expect(getBuiltinByName(name)).toBeUndefined()
  })

  it.each(DELETED_HELPERS)('%s is absent from the canonical PYTHON_BUILTINS set', (name) => {
    expect(PYTHON_BUILTINS.some((b) => b.name === name)).toBe(false)
  })

  it('exposes none of the trio through ALLOWED_BUILTINS (autocomplete + node issues)', () => {
    const names = new Set(ALLOWED_BUILTINS.map((b) => b.name))
    for (const helper of DELETED_HELPERS) {
      expect(names.has(helper), `${helper} in ALLOWED_BUILTINS`).toBe(false)
    }
  })

  it('exposes none of the trio through FIELD_ALLOWED_BUILTINS (field expressions)', () => {
    const names = new Set(FIELD_ALLOWED_BUILTINS.map((b) => b.name))
    for (const helper of DELETED_HELPERS) {
      expect(names.has(helper), `${helper} in FIELD_ALLOWED_BUILTINS`).toBe(false)
    }
  })
})

describe('expression validation rejects the deleted helpers (whitelist parity)', () => {
  it.each(DELETED_HELPERS)('flags %s(...) as an unrecognized function', (name) => {
    const issues = validateExpressions(`${name}(api_token)`, new Set(['api_token']))
    expect(issues.some((i) => i.type === 'invalid_function' && i.identifier === name)).toBe(true)
  })

  it('still rejects any other unknown function (whitelist stays a whitelist)', () => {
    const issues = validateExpressions('digest_auth(user)', new Set(['user']))
    expect(issues.some((i) => i.type === 'invalid_function')).toBe(true)
  })

  it('keeps genuine builtins callable (len survives the deletion)', () => {
    expect(validateExpressions('len(api_token)', new Set(['api_token']))).toEqual([])
  })
})
