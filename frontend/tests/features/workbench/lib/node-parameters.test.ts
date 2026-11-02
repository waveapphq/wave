/**
 * Node Parameters Tests
 *
 * Tests for node input/output parameter schemas and version-specific lookups.
 */

import { describe, it, expect } from 'vitest'
import {
  getInputParams,
  getOutputParams,
  hasNodeParams,
  CONTROL_INPUTS,
  CONTROL_OUTPUTS,
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  validateOutputBindings,
  blockInputParams,
  blockOutputParams,
} from '@/features/workbench/lib/node-parameters'
import {
  PARAM_TYPE_TO_VAR_TYPE,
  OUTPUT_TYPE_COMPAT,
  type InputParam,
} from '@/features/workbench/lib/node-parameters/types'

describe('Node Parameters', () => {
  describe('CONTROL_INPUTS', () => {
    it('contains delay control with duration parameter', () => {
      const delay = CONTROL_INPUTS['delay']
      expect(delay).toBeDefined()
      expect(delay).toHaveLength(1)
      expect(delay[0].name).toBe('duration')
      expect(delay[0].type).toBe('integer')
      expect(delay[0].required).toBe(true)
    })

    it('contains all 15 flow controls', () => {
      const controlIds = [
        'if-else',
        'switch-case',
        'assert',
        'for',
        'for-each',
        'while',
        'break',
        'continue',
        'parallel',
        'try-catch-finally',
        'halt',
        'delay',
        'wait-until',
        'variable-setter',
        'note',
      ]

      for (const id of controlIds) {
        expect(CONTROL_INPUTS[id]).toBeDefined()
      }
    })
  })

  describe('getInputParams', () => {
    it('returns input params array for known control', () => {
      const inputs = getInputParams('delay')
      expect(inputs).toBeDefined()
      expect(inputs).toHaveLength(1)
    })

    it('returns undefined for unknown control', () => {
      const inputs = getInputParams('unknown-control')
      expect(inputs).toBeUndefined()
    })
  })

  describe('getOutputParams', () => {
    it('returns output params array for known control', () => {
      const outputs = getOutputParams('http-client')
      expect(outputs).toBeDefined()
      expect(outputs!.length).toBeGreaterThan(0)
    })

    it('returns undefined for unknown control', () => {
      const outputs = getOutputParams('unknown-control')
      expect(outputs).toBeUndefined()
    })
  })

  describe('hasNodeParams', () => {
    it('returns true for known control', () => {
      expect(hasNodeParams('delay')).toBe(true)
      expect(hasNodeParams('if-else')).toBe(true)
    })

    it('returns false for unknown control', () => {
      expect(hasNodeParams('unknown')).toBe(false)
    })
  })

  // ==========================================================================
  // HTTP Client schema (REQ-3.4.1.4, REQ-3.1.1.5)
  // ==========================================================================

  describe('HTTP Client Parameter Schema (REQ-3.4.1.4)', () => {
    it('has headers parameter with map type', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const headers = inputs.find((p) => p.name === 'headers')
      expect(headers).toBeDefined()
      expect(headers!.type).toBe('map')
    })

    // Headers carry auth; the full pin lives in
    // tests/features/workbench/lib/node-parameters/plugins/http-schema.test.ts.
    it('has headers description referencing auth', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const headers = inputs.find((p) => p.name === 'headers')
      expect(headers!.description).toMatch(/auth/i)
    })

    // Body is legal on any method; body_mode gates it.
    it('has body parameter gated by body_mode, not method', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const body = inputs.find((p) => p.name === 'body')
      expect(body).toBeDefined()
      expect(body!.showWhen).toBeDefined()
      expect(body!.showWhen!.field).toBe('body_mode')
      expect(body!.showWhen!.values).toEqual(['text'])
    })

    it('has timeout default of 30 (seconds, not milliseconds)', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const timeout = inputs.find((p) => p.name === 'timeout')
      expect(timeout).toBeDefined()
      expect(timeout!.defaultValue).toBe(30)
    })

    it('has timeout description referencing seconds', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const timeout = inputs.find((p) => p.name === 'timeout')
      expect(timeout!.description).toMatch(/seconds/i)
      expect(timeout!.description).not.toMatch(/milliseconds/i)
    })

    it('has output named status_code (not status)', () => {
      const outputs = PLUGIN_OUTPUTS['http-client']
      const statusOutput = outputs.find((o) => o.name === 'status_code')
      expect(statusOutput).toBeDefined()
      expect(statusOutput!.type).toBe('integer')
    })

    it('does not have output named status (old name)', () => {
      const outputs = PLUGIN_OUTPUTS['http-client']
      const oldStatus = outputs.find((o) => o.name === 'status')
      expect(oldStatus).toBeUndefined()
    })

    it('has output headers with map type', () => {
      const outputs = PLUGIN_OUTPUTS['http-client']
      const headersOutput = outputs.find((o) => o.name === 'headers')
      expect(headersOutput).toBeDefined()
      expect(headersOutput!.type).toBe('map')
    })

    it('preserves existing correct parameters (url, method)', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const url = inputs.find((p) => p.name === 'url')
      expect(url!.type).toBe('string')
      expect(url!.required).toBe(true)

      const method = inputs.find((p) => p.name === 'method')
      expect(method!.type).toBe('string')
      expect(method!.required).toBe(true)
      expect(method!.enumValues).toEqual([
        'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
      ])
      expect(method!.defaultValue).toBe('GET')
    })

    // Body modes, response modes, mTLS / proxy rows, the Auth and Body sections, and the TLS version / cipher rows.
    it('has 36 input parameters total (profile handled by binding modal)', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      expect(inputs).toHaveLength(36)
    })

    // Size, sha256 and trace are among the outputs.
    it('has 9 outputs total', () => {
      const outputs = PLUGIN_OUTPUTS['http-client']
      expect(outputs).toHaveLength(9)
    })

    it('has query_params parameter with map type', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const qp = inputs.find((p) => p.name === 'query_params')
      expect(qp).toBeDefined()
      expect(qp!.type).toBe('map')
      expect(qp!.required).toBe(false)
    })

    it('has retry_count parameter with integer type and default 0', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const rc = inputs.find((p) => p.name === 'retry_count')
      expect(rc).toBeDefined()
      expect(rc!.type).toBe('integer')
      expect(rc!.required).toBe(false)
      expect(rc!.defaultValue).toBe(0)
    })

    it('has retry_delay parameter with float type and default 1', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const rd = inputs.find((p) => p.name === 'retry_delay')
      expect(rd).toBeDefined()
      expect(rd!.type).toBe('float')
      expect(rd!.required).toBe(false)
      expect(rd!.defaultValue).toBe(1)
    })

    it('has retry_backoff_factor parameter with float type and default 2', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const rbf = inputs.find((p) => p.name === 'retry_backoff_factor')
      expect(rbf).toBeDefined()
      expect(rbf!.type).toBe('float')
      expect(rbf!.required).toBe(false)
      expect(rbf!.defaultValue).toBe(2)
    })

    it('has retryable_status_codes parameter with array type', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const rsc = inputs.find((p) => p.name === 'retryable_status_codes')
      expect(rsc).toBeDefined()
      expect(rsc!.type).toBe('array')
      expect(rsc!.required).toBe(false)
      expect(rsc!.defaultValue).toEqual(['502', '503', '504'])
    })

    it('has verify_ssl parameter with boolean type and default true', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const vs = inputs.find((p) => p.name === 'verify_ssl')
      expect(vs).toBeDefined()
      expect(vs!.type).toBe('boolean')
      expect(vs!.required).toBe(false)
      expect(vs!.defaultValue).toBe(true)
    })

    it('has ca_cert parameter with string type', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const cc = inputs.find((p) => p.name === 'ca_cert')
      expect(cc).toBeDefined()
      expect(cc!.type).toBe('string')
      expect(cc!.required).toBe(false)
    })

    it('locks url to allowedFormats plain', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const url = inputs.find((p) => p.name === 'url')
      expect(url!.allowedFormats).toEqual(['plain'])
    })

    it('locks ca_cert to allowedFormats plain', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const cc = inputs.find((p) => p.name === 'ca_cert')
      expect(cc!.allowedFormats).toEqual(['plain'])
    })

    it('leaves body unrestricted - no allowedFormats, full picker', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const body = inputs.find((p) => p.name === 'body')
      expect(body!.allowedFormats).toBeUndefined()
    })

    it('has allow_redirects parameter with boolean type and default true', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const ar = inputs.find((p) => p.name === 'allow_redirects')
      expect(ar).toBeDefined()
      expect(ar!.type).toBe('boolean')
      expect(ar!.required).toBe(false)
      expect(ar!.defaultValue).toBe(true)
    })

    it('has max_redirects parameter with integer type and default 10', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const mr = inputs.find((p) => p.name === 'max_redirects')
      expect(mr).toBeDefined()
      expect(mr!.type).toBe('integer')
      expect(mr!.required).toBe(false)
      expect(mr!.defaultValue).toBe(10)
    })

    it('does not include profile parameter (handled by profile binding modal)', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const profile = inputs.find((p) => p.name === 'profile')
      expect(profile).toBeUndefined()
    })

    it('has content_type output with string type', () => {
      const outputs = PLUGIN_OUTPUTS['http-client']
      const ct = outputs.find((o) => o.name === 'content_type')
      expect(ct).toBeDefined()
      expect(ct!.type).toBe('string')
    })

    it('has response_time output with float type', () => {
      const outputs = PLUGIN_OUTPUTS['http-client']
      const rt = outputs.find((o) => o.name === 'response_time')
      expect(rt).toBeDefined()
      expect(rt!.type).toBe('float')
    })

    it('has final_url output with string type', () => {
      const outputs = PLUGIN_OUTPUTS['http-client']
      const fu = outputs.find((o) => o.name === 'final_url')
      expect(fu).toBeDefined()
      expect(fu!.type).toBe('string')
    })
  })

  describe('Log Plugin Parameter Schema (REQ-3.4.1.17)', () => {
    it('has 2 input parameters total', () => {
      const inputs = PLUGIN_INPUTS['log']
      expect(inputs).toHaveLength(2)
    })

    it('has 0 outputs total', () => {
      const outputs = PLUGIN_OUTPUTS['log']
      expect(outputs).toHaveLength(0)
    })

    it('has message parameter with string type and required', () => {
      const inputs = PLUGIN_INPUTS['log']
      const message = inputs.find((p) => p.name === 'message')
      expect(message).toBeDefined()
      expect(message!.type).toBe('string')
      expect(message!.required).toBe(true)
    })

    it('has message parameter with non-empty description', () => {
      const inputs = PLUGIN_INPUTS['log']
      const message = inputs.find((p) => p.name === 'message')
      expect(message!.description).toBeTruthy()
      expect(message!.description!.length).toBeGreaterThan(0)
    })

    it('leaves message unrestricted - no allowedFormats, any format', () => {
      const inputs = PLUGIN_INPUTS['log']
      const message = inputs.find((p) => p.name === 'message')
      expect(message!.allowedFormats).toBeUndefined()
    })

    it('has level parameter with string type and not required', () => {
      const inputs = PLUGIN_INPUTS['log']
      const level = inputs.find((p) => p.name === 'level')
      expect(level).toBeDefined()
      expect(level!.type).toBe('string')
      expect(level!.required).toBe(false)
    })

    it('has level parameter with enumValues for all 5 log levels', () => {
      const inputs = PLUGIN_INPUTS['log']
      const level = inputs.find((p) => p.name === 'level')
      expect(level!.enumValues).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])
    })

    it('has level parameter with default value INFO', () => {
      const inputs = PLUGIN_INPUTS['log']
      const level = inputs.find((p) => p.name === 'level')
      expect(level!.defaultValue).toBe('INFO')
    })

    it('has level parameter with non-empty description', () => {
      const inputs = PLUGIN_INPUTS['log']
      const level = inputs.find((p) => p.name === 'level')
      expect(level!.description).toBeTruthy()
      expect(level!.description!.length).toBeGreaterThan(0)
    })

    it('has no parameter groups (no group field on any parameter)', () => {
      const inputs = PLUGIN_INPUTS['log']
      for (const param of inputs) {
        expect(param.group).toBeUndefined()
      }
    })
  })

  describe('Var Setter Parameters', () => {
    it('exists in CONTROL_INPUTS registry', () => {
      expect(CONTROL_INPUTS['variable-setter']).toBeDefined()
    })

    it('has exactly 1 parameter (variables)', () => {
      const inputs = CONTROL_INPUTS['variable-setter']
      expect(inputs).toHaveLength(1)
      expect(inputs[0].name).toBe('variables')
    })

    it('has variables parameter of type map and required', () => {
      const inputs = CONTROL_INPUTS['variable-setter']
      const variables = inputs[0]
      expect(variables.type).toBe('map')
      expect(variables.required).toBe(true)
    })

    it('has variables parameter with non-empty description', () => {
      const inputs = CONTROL_INPUTS['variable-setter']
      const variables = inputs[0]
      expect(variables.description).toBeTruthy()
      expect(variables.description!.length).toBeGreaterThan(0)
    })

    it('has no scope parameter', () => {
      const inputs = CONTROL_INPUTS['variable-setter']
      const scope = inputs.find((p) => p.name === 'scope')
      expect(scope).toBeUndefined()
    })

    it('has 0 outputs', () => {
      const outputs = CONTROL_OUTPUTS['variable-setter']
      expect(outputs).toHaveLength(0)
    })

    it('has no parameter groups (no group field on any parameter)', () => {
      const inputs = CONTROL_INPUTS['variable-setter']
      for (const param of inputs) {
        expect(param.group).toBeUndefined()
      }
    })

    it('has no showWhen on any parameter', () => {
      const inputs = CONTROL_INPUTS['variable-setter']
      for (const param of inputs) {
        expect(param.showWhen).toBeUndefined()
      }
    })
  })

  describe('XML Parser Parameters', () => {
    it('exists in PLUGIN_INPUTS registry', () => {
      expect(PLUGIN_INPUTS['xml-parser']).toBeDefined()
    })

    it('has 4 parameters', () => {
      const inputs = PLUGIN_INPUTS['xml-parser']
      expect(inputs).toHaveLength(4)
    })

    it('has xml_content as a required string', () => {
      const inputs = PLUGIN_INPUTS['xml-parser']
      const param = inputs.find((p) => p.name === 'xml_content')
      expect(param).toBeDefined()
      expect(param!.type).toBe('string')
      expect(param!.required).toBe(true)
    })

    it('has xml_content with allowedFormats locked to xml', () => {
      const inputs = PLUGIN_INPUTS['xml-parser']
      const param = inputs.find((p) => p.name === 'xml_content')
      expect(param!.allowedFormats).toEqual(['xml'])
    })

    it('has xml_content WITHOUT noExpression (expression allowed via the {} toggle)', () => {
      const inputs = PLUGIN_INPUTS['xml-parser']
      const param = inputs.find((p) => p.name === 'xml_content')
      expect(param!.noExpression).toBeFalsy()
    })

    it('has output_mode with noExpression (rendered as the Output Mode radio section)', () => {
      const inputs = PLUGIN_INPUTS['xml-parser']
      const param = inputs.find((p) => p.name === 'output_mode')
      expect(param!.noExpression).toBe(true)
    })

    it('does not expose namespaces parameter (auto-extracted from XML)', () => {
      const inputs = PLUGIN_INPUTS['xml-parser']
      const param = inputs.find((p) => p.name === 'namespaces')
      expect(param).toBeUndefined()
    })

    it('has output_mode as optional string with enum values', () => {
      const inputs = PLUGIN_INPUTS['xml-parser']
      const param = inputs.find((p) => p.name === 'output_mode')
      expect(param).toBeDefined()
      expect(param!.type).toBe('string')
      expect(param!.required).toBe(false)
      expect(param!.enumValues).toEqual(['combined', 'individual'])
      expect(param!.defaultValue).toBe('combined')
    })

    it('has queries as required map', () => {
      const inputs = PLUGIN_INPUTS['xml-parser']
      const param = inputs.find((p) => p.name === 'queries')
      expect(param).toBeDefined()
      expect(param!.type).toBe('map')
      expect(param!.required).toBe(true)
    })

    it('has query_output_types as optional map', () => {
      const inputs = PLUGIN_INPUTS['xml-parser']
      const param = inputs.find((p) => p.name === 'query_output_types')
      expect(param).toBeDefined()
      expect(param!.type).toBe('map')
      expect(param!.required).toBe(false)
    })

    it('has 3 outputs (success, errors, results)', () => {
      const outputs = PLUGIN_OUTPUTS['xml-parser']
      expect(outputs).toHaveLength(3)
      const outputNames = outputs.map((o) => o.name)
      expect(outputNames).toContain('success')
      expect(outputNames).toContain('errors')
      expect(outputNames).toContain('results')
    })

    it('has correct output types', () => {
      const outputs = PLUGIN_OUTPUTS['xml-parser']
      const outputMap = Object.fromEntries(outputs.map((o) => [o.name, o]))
      expect(outputMap['success'].type).toBe('boolean')
      expect(outputMap['errors'].type).toBe('array')
      expect(outputMap['results'].type).toBe('map')
    })
  })

  describe('JSON Parser Parameters', () => {
    it('exists in PLUGIN_INPUTS registry', () => {
      expect(PLUGIN_INPUTS['json-parser']).toBeDefined()
    })

    it('has 4 parameters', () => {
      const inputs = PLUGIN_INPUTS['json-parser']
      expect(inputs).toHaveLength(4)
    })

    it('has json_content as a required string', () => {
      const inputs = PLUGIN_INPUTS['json-parser']
      const param = inputs.find((p) => p.name === 'json_content')
      expect(param).toBeDefined()
      expect(param!.type).toBe('string')
      expect(param!.required).toBe(true)
    })

    it('has json_content with allowedFormats', () => {
      const inputs = PLUGIN_INPUTS['json-parser']
      const param = inputs.find((p) => p.name === 'json_content')
      expect(param!.allowedFormats).toEqual(['json'])
    })

    it('has json_content WITHOUT noExpression (expression allowed via the {} toggle)', () => {
      const inputs = PLUGIN_INPUTS['json-parser']
      const param = inputs.find((p) => p.name === 'json_content')
      expect(param!.noExpression).toBeFalsy()
    })

    it('has output_mode with noExpression (rendered as the Output Mode radio section, never an expression)', () => {
      const inputs = PLUGIN_INPUTS['json-parser']
      const param = inputs.find((p) => p.name === 'output_mode')
      expect(param!.noExpression).toBe(true)
    })

    it('has output_mode as optional string with enum values', () => {
      const inputs = PLUGIN_INPUTS['json-parser']
      const param = inputs.find((p) => p.name === 'output_mode')
      expect(param).toBeDefined()
      expect(param!.type).toBe('string')
      expect(param!.required).toBe(false)
      expect(param!.enumValues).toEqual(['combined', 'individual'])
      expect(param!.defaultValue).toBe('combined')
    })

    it('has queries as required map', () => {
      const inputs = PLUGIN_INPUTS['json-parser']
      const param = inputs.find((p) => p.name === 'queries')
      expect(param).toBeDefined()
      expect(param!.type).toBe('map')
      expect(param!.required).toBe(true)
    })

    it('has query_output_types as optional map', () => {
      const inputs = PLUGIN_INPUTS['json-parser']
      const param = inputs.find((p) => p.name === 'query_output_types')
      expect(param).toBeDefined()
      expect(param!.type).toBe('map')
      expect(param!.required).toBe(false)
    })

    it('has 3 outputs (success, errors, results)', () => {
      const outputs = PLUGIN_OUTPUTS['json-parser']
      expect(outputs).toHaveLength(3)
      const outputNames = outputs.map((o) => o.name)
      expect(outputNames).toContain('success')
      expect(outputNames).toContain('errors')
      expect(outputNames).toContain('results')
    })

    it('has correct output types', () => {
      const outputs = PLUGIN_OUTPUTS['json-parser']
      const outputMap = Object.fromEntries(outputs.map((o) => [o.name, o]))
      expect(outputMap['success'].type).toBe('boolean')
      expect(outputMap['errors'].type).toBe('array')
      expect(outputMap['results'].type).toBe('map')
    })
  })

  describe('If/Else Parameter Schema', () => {
    it('exists in CONTROL_INPUTS registry', () => {
      expect(CONTROL_INPUTS['if-else']).toBeDefined()
    })

    it('has exactly 1 parameter (branches)', () => {
      const inputs = CONTROL_INPUTS['if-else']
      expect(inputs).toHaveLength(1)
      expect(inputs[0].name).toBe('branches')
    })

    it('has branches parameter of type array and required', () => {
      const inputs = CONTROL_INPUTS['if-else']
      const branches = inputs[0]
      expect(branches.type).toBe('array')
      expect(branches.required).toBe(true)
    })

    it('has branches parameter with noExpression flag', () => {
      const inputs = CONTROL_INPUTS['if-else']
      const branches = inputs[0]
      expect(branches.noExpression).toBe(true)
    })

    it('has branches parameter with non-empty description', () => {
      const inputs = CONTROL_INPUTS['if-else']
      const branches = inputs[0]
      expect(branches.description).toBeTruthy()
      expect(branches.description!.length).toBeGreaterThan(0)
    })

    it('has 0 outputs (branching is via handles, not output variables)', () => {
      const outputs = CONTROL_OUTPUTS['if-else']
      expect(outputs).toHaveLength(0)
    })

    it('does not have old condition parameter', () => {
      const inputs = CONTROL_INPUTS['if-else']
      const condition = inputs.find((p) => p.name === 'condition')
      expect(condition).toBeUndefined()
    })

    it('does not have old result output', () => {
      const outputs = CONTROL_OUTPUTS['if-else']
      const result = outputs.find((o) => o.name === 'result')
      expect(result).toBeUndefined()
    })

    it('has no parameter groups', () => {
      const inputs = CONTROL_INPUTS['if-else']
      for (const param of inputs) {
        expect(param.group).toBeUndefined()
      }
    })

    it('has no showWhen on any parameter', () => {
      const inputs = CONTROL_INPUTS['if-else']
      for (const param of inputs) {
        expect(param.showWhen).toBeUndefined()
      }
    })
  })

  describe('Assert Parameter Schema', () => {
    it('exists in CONTROL_INPUTS registry', () => {
      expect(CONTROL_INPUTS['assert']).toBeDefined()
    })

    it('describes fail_current_scope in both modes', () => {
      const inputs = CONTROL_INPUTS['assert']
      const failScope = inputs.find((p) => p.name === 'fail_current_scope')
      expect(failScope!.description).toBe(
        'When enabled, a failed assertion in single mode fails the block and stops the flow; in split mode the flow continues down the fail branch and the Test or Function it runs in ends failed'
      )
    })

    it('has exactly 3 parameters (assertions, mode, fail_current_scope)', () => {
      const inputs = CONTROL_INPUTS['assert']
      expect(inputs).toHaveLength(3)
      const names = inputs.map((p) => p.name)
      expect(names).toEqual(['assertions', 'mode', 'fail_current_scope'])
    })

    it('has assertions parameter of type array and required', () => {
      const inputs = CONTROL_INPUTS['assert']
      const assertions = inputs.find((p) => p.name === 'assertions')
      expect(assertions).toBeDefined()
      expect(assertions!.type).toBe('array')
      expect(assertions!.required).toBe(true)
    })

    it('has assertions parameter with noExpression flag', () => {
      const inputs = CONTROL_INPUTS['assert']
      const assertions = inputs.find((p) => p.name === 'assertions')
      expect(assertions!.noExpression).toBe(true)
    })

    it('has assertions parameter with non-empty description', () => {
      const inputs = CONTROL_INPUTS['assert']
      const assertions = inputs.find((p) => p.name === 'assertions')
      expect(assertions!.description).toBeTruthy()
      expect(assertions!.description!.length).toBeGreaterThan(0)
    })

    it('has mode parameter of type string and required', () => {
      const inputs = CONTROL_INPUTS['assert']
      const mode = inputs.find((p) => p.name === 'mode')
      expect(mode).toBeDefined()
      expect(mode!.type).toBe('string')
      expect(mode!.required).toBe(true)
    })

    it('has mode parameter with defaultValue split', () => {
      const inputs = CONTROL_INPUTS['assert']
      const mode = inputs.find((p) => p.name === 'mode')
      expect(mode!.defaultValue).toBe('split')
    })

    it('has mode parameter with enumValues single and split', () => {
      const inputs = CONTROL_INPUTS['assert']
      const mode = inputs.find((p) => p.name === 'mode')
      expect(mode!.enumValues).toEqual(['single', 'split'])
    })

    it('has mode parameter with noExpression flag', () => {
      const inputs = CONTROL_INPUTS['assert']
      const mode = inputs.find((p) => p.name === 'mode')
      expect(mode!.noExpression).toBe(true)
    })

    it('all parameters have noExpression set to true', () => {
      const inputs = CONTROL_INPUTS['assert']
      for (const param of inputs) {
        expect(param.noExpression).toBe(true)
      }
    })

    it('has exactly 1 output (passed)', () => {
      const outputs = CONTROL_OUTPUTS['assert']
      expect(outputs).toHaveLength(1)
      expect(outputs[0].name).toBe('passed')
    })

    it('has passed output with boolean type', () => {
      const outputs = CONTROL_OUTPUTS['assert']
      const passed = outputs[0]
      expect(passed.type).toBe('boolean')
    })

    it('has passed output with non-empty description', () => {
      const outputs = CONTROL_OUTPUTS['assert']
      const passed = outputs[0]
      expect(passed.description).toBeTruthy()
      expect(passed.description!.length).toBeGreaterThan(0)
    })

    it('does not have old condition parameter', () => {
      const inputs = CONTROL_INPUTS['assert']
      const condition = inputs.find((p) => p.name === 'condition')
      expect(condition).toBeUndefined()
    })

    it('does not have old message parameter', () => {
      const inputs = CONTROL_INPUTS['assert']
      const message = inputs.find((p) => p.name === 'message')
      expect(message).toBeUndefined()
    })

    it('has no parameter groups (no group field on any parameter)', () => {
      const inputs = CONTROL_INPUTS['assert']
      for (const param of inputs) {
        expect(param.group).toBeUndefined()
      }
    })

    it('has no showWhen on any parameter', () => {
      const inputs = CONTROL_INPUTS['assert']
      for (const param of inputs) {
        expect(param.showWhen).toBeUndefined()
      }
    })
  })

  describe('HTTP Client Parameter Groups', () => {
    // The body rows sit in the Body section.
    it('ungrouped parameters have no group field', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const ungrouped = ['url', 'method', 'headers', 'query_params']
      for (const name of ungrouped) {
        const param = inputs.find((p) => p.name === name)
        expect(param).toBeDefined()
        expect(param!.group).toBeUndefined()
      }
    })

    it('timeout and retry parameters are in "Timeouts & Retries" group', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const groupParams = ['timeout', 'retry_count', 'retry_delay', 'retry_backoff_factor', 'retryable_status_codes']
      for (const name of groupParams) {
        const param = inputs.find((p) => p.name === name)
        expect(param).toBeDefined()
        expect(param!.group).toBe('Timeouts & Retries')
      }
    })

    // The TLS rows sit in the "TLS / Certificates" group.
    it('security parameters are in "TLS / Certificates" group', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const groupParams = ['verify_ssl', 'ca_cert']
      for (const name of groupParams) {
        const param = inputs.find((p) => p.name === name)
        expect(param).toBeDefined()
        expect(param!.group).toBe('TLS / Certificates')
      }
    })

    it('connection parameters are in "Connection" group', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const groupParams = ['allow_redirects', 'max_redirects']
      for (const name of groupParams) {
        const param = inputs.find((p) => p.name === name)
        expect(param).toBeDefined()
        expect(param!.group).toBe('Connection')
      }
    })

    // The Response, Auth and Body groups join the named groups.
    it('has exactly 7 distinct groups (6 named + 1 ungrouped)', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const groups = new Set(inputs.map((p) => p.group).filter(Boolean))
      expect(groups.size).toBe(6)
      expect(groups).toEqual(
        new Set(['Auth', 'Body', 'Timeouts & Retries', 'Response', 'TLS / Certificates', 'Connection']),
      )
    })

    it('preserves parameter insertion order (ungrouped first, then groups)', () => {
      const inputs = PLUGIN_INPUTS['http-client']
      const names = inputs.map((p) => p.name)
      // Ungrouped params first
      expect(names.indexOf('url')).toBeLessThan(names.indexOf('timeout'))
      expect(names.indexOf('method')).toBeLessThan(names.indexOf('timeout'))
      expect(names.indexOf('query_params')).toBeLessThan(names.indexOf('timeout'))
      // Timeouts & Retries group before Security
      expect(names.indexOf('timeout')).toBeLessThan(names.indexOf('verify_ssl'))
      // Security before Connection
      expect(names.indexOf('ca_cert')).toBeLessThan(names.indexOf('allow_redirects'))
    })
  })

  // ==========================================================================
  // Halt Control schema (REQ-3.5.1.4, REQ-3.5.1.14)
  // ==========================================================================

  describe('Halt Control Parameter Schema (REQ-3.5.1.4, REQ-3.5.1.14)', () => {
    it('has exactly 3 parameters (scope, status, message)', () => {
      const inputs = CONTROL_INPUTS['halt']
      expect(inputs).toHaveLength(3)
      const names = inputs.map((p) => p.name)
      expect(names).toEqual(['scope', 'status', 'message'])
    })

    it('has scope parameter with string type', () => {
      const inputs = CONTROL_INPUTS['halt']
      const scope = inputs.find((p) => p.name === 'scope')
      expect(scope).toBeDefined()
      expect(scope!.type).toBe('string')
    })

    it('has scope parameter that is not required', () => {
      const inputs = CONTROL_INPUTS['halt']
      const scope = inputs.find((p) => p.name === 'scope')
      expect(scope!.required).toBe(false)
    })

    it('has scope parameter with defaultValue test', () => {
      const inputs = CONTROL_INPUTS['halt']
      const scope = inputs.find((p) => p.name === 'scope')
      expect(scope!.defaultValue).toBe('test')
    })

    it('has scope parameter with enumValues test/suite/regression/function', () => {
      const inputs = CONTROL_INPUTS['halt']
      const scope = inputs.find((p) => p.name === 'scope')
      expect(scope!.enumValues).toEqual(['test', 'suite', 'regression', 'function'])
    })

    it('has scope parameter with noExpression flag', () => {
      const inputs = CONTROL_INPUTS['halt']
      const scope = inputs.find((p) => p.name === 'scope')
      expect(scope!.noExpression).toBe(true)
    })

    it('has scope parameter with non-empty description', () => {
      const inputs = CONTROL_INPUTS['halt']
      const scope = inputs.find((p) => p.name === 'scope')
      expect(scope!.description).toBeTruthy()
      expect(scope!.description!.length).toBeGreaterThan(0)
    })

    it('has status parameter with string type', () => {
      const inputs = CONTROL_INPUTS['halt']
      const status = inputs.find((p) => p.name === 'status')
      expect(status).toBeDefined()
      expect(status!.type).toBe('string')
    })

    it('has status parameter that is not required', () => {
      const inputs = CONTROL_INPUTS['halt']
      const status = inputs.find((p) => p.name === 'status')
      expect(status!.required).toBe(false)
    })

    it('has status parameter with defaultValue failed', () => {
      const inputs = CONTROL_INPUTS['halt']
      const status = inputs.find((p) => p.name === 'status')
      expect(status!.defaultValue).toBe('failed')
    })

    it('has status parameter with enumValues passed/failed/skipped', () => {
      const inputs = CONTROL_INPUTS['halt']
      const status = inputs.find((p) => p.name === 'status')
      expect(status!.enumValues).toEqual(['passed', 'failed', 'skipped'])
    })

    it('has status parameter with noExpression flag', () => {
      const inputs = CONTROL_INPUTS['halt']
      const status = inputs.find((p) => p.name === 'status')
      expect(status!.noExpression).toBe(true)
    })

    it('has status parameter with non-empty description', () => {
      const inputs = CONTROL_INPUTS['halt']
      const status = inputs.find((p) => p.name === 'status')
      expect(status!.description).toBeTruthy()
      expect(status!.description!.length).toBeGreaterThan(0)
    })

    it('has message parameter with string type', () => {
      const inputs = CONTROL_INPUTS['halt']
      const message = inputs.find((p) => p.name === 'message')
      expect(message).toBeDefined()
      expect(message!.type).toBe('string')
    })

    it('has message parameter that is not required', () => {
      const inputs = CONTROL_INPUTS['halt']
      const message = inputs.find((p) => p.name === 'message')
      expect(message!.required).toBe(false)
    })

    it('has message parameter with non-empty description', () => {
      const inputs = CONTROL_INPUTS['halt']
      const message = inputs.find((p) => p.name === 'message')
      expect(message!.description).toBeTruthy()
      expect(message!.description!.length).toBeGreaterThan(0)
    })

    it('has message parameter without noExpression flag (expressions allowed)', () => {
      const inputs = CONTROL_INPUTS['halt']
      const message = inputs.find((p) => p.name === 'message')
      // message does NOT have noExpression - users may want to interpolate variables
      expect(message!.noExpression).toBeFalsy()
    })

    it('does not have exitCode parameter', () => {
      const inputs = CONTROL_INPUTS['halt']
      const exitCode = inputs.find((p) => p.name === 'exitCode')
      expect(exitCode).toBeUndefined()
    })

    it('has 0 outputs (halt is a dead-end)', () => {
      const outputs = CONTROL_OUTPUTS['halt']
      expect(outputs).toHaveLength(0)
    })

    it('has no parameter groups (no group field on any parameter)', () => {
      const inputs = CONTROL_INPUTS['halt']
      for (const param of inputs) {
        expect(param.group).toBeUndefined()
      }
    })

    it('has no showWhen on any parameter', () => {
      const inputs = CONTROL_INPUTS['halt']
      for (const param of inputs) {
        expect(param.showWhen).toBeUndefined()
      }
    })

    it('parameter order is scope, status, message', () => {
      const inputs = CONTROL_INPUTS['halt']
      expect(inputs[0].name).toBe('scope')
      expect(inputs[1].name).toBe('status')
      expect(inputs[2].name).toBe('message')
    })

    it('returns full parameters for production version (1.0.0)', () => {
      const inputs = getInputParams('halt')
      expect(inputs).toBeDefined()
      expect(inputs).toHaveLength(3)
      expect(inputs![0].name).toBe('scope')
    })
  })

  // ==========================================================================
  // Try/Catch/Finally Control Parameter Schema (REQ-3.2.2.6)
  // ==========================================================================

  describe('Try/Catch/Finally Control Parameter Schema (REQ-3.2.2.6)', () => {
    it('has exactly 2 parameters (enable_catch, enable_finally)', () => {
      const inputs = CONTROL_INPUTS['try-catch-finally']
      expect(inputs).toHaveLength(2)
      const names = inputs.map((p) => p.name)
      expect(names).toEqual(['enable_catch', 'enable_finally'])
    })

    it('has no error_variable parameter (error uses output binding)', () => {
      const inputs = CONTROL_INPUTS['try-catch-finally']
      const param = inputs.find((p) => p.name === 'error_variable')
      expect(param).toBeUndefined()
    })

    it('has enable_catch parameter with boolean type', () => {
      const inputs = CONTROL_INPUTS['try-catch-finally']
      const param = inputs.find((p) => p.name === 'enable_catch')
      expect(param).toBeDefined()
      expect(param!.type).toBe('boolean')
    })

    it('has enable_catch parameter with defaultValue true', () => {
      const inputs = CONTROL_INPUTS['try-catch-finally']
      const param = inputs.find((p) => p.name === 'enable_catch')
      expect(param!.defaultValue).toBe(true)
    })

    it('has enable_catch parameter with noExpression flag', () => {
      const inputs = CONTROL_INPUTS['try-catch-finally']
      const param = inputs.find((p) => p.name === 'enable_catch')
      expect(param!.noExpression).toBe(true)
    })

    it('has enable_finally parameter with boolean type', () => {
      const inputs = CONTROL_INPUTS['try-catch-finally']
      const param = inputs.find((p) => p.name === 'enable_finally')
      expect(param).toBeDefined()
      expect(param!.type).toBe('boolean')
    })

    it('has enable_finally parameter with defaultValue false', () => {
      const inputs = CONTROL_INPUTS['try-catch-finally']
      const param = inputs.find((p) => p.name === 'enable_finally')
      expect(param!.defaultValue).toBe(false)
    })

    it('has enable_finally parameter with noExpression flag', () => {
      const inputs = CONTROL_INPUTS['try-catch-finally']
      const param = inputs.find((p) => p.name === 'enable_finally')
      expect(param!.noExpression).toBe(true)
    })

    it('has exactly 2 outputs (error, caught)', () => {
      const outputs = CONTROL_OUTPUTS['try-catch-finally']
      expect(outputs).toHaveLength(2)
      const names = outputs.map((o) => o.name)
      expect(names).toEqual(['error', 'caught'])
    })

    it('has error output with map type', () => {
      const outputs = CONTROL_OUTPUTS['try-catch-finally']
      const output = outputs.find((o) => o.name === 'error')
      expect(output).toBeDefined()
      expect(output!.type).toBe('map')
    })

    it('has caught output with boolean type', () => {
      const outputs = CONTROL_OUTPUTS['try-catch-finally']
      const output = outputs.find((o) => o.name === 'caught')
      expect(output).toBeDefined()
      expect(output!.type).toBe('boolean')
    })

    it('has non-empty description on all parameters', () => {
      const inputs = CONTROL_INPUTS['try-catch-finally']
      for (const param of inputs) {
        expect(param.description).toBeTruthy()
        expect(param.description!.length).toBeGreaterThan(0)
      }
    })

    it('returns full parameters for production version (1.0.0)', () => {
      const inputs = getInputParams('try-catch-finally')
      expect(inputs).toBeDefined()
      expect(inputs).toHaveLength(2)
      expect(inputs![0].name).toBe('enable_catch')
    })
  })

  describe('InputParam Type Extensions (REQ-3.1.1.5)', () => {
    it('type union includes map', () => {
      // Verify that a parameter with type 'map' is valid in the type system
      const mapParam: InputParam = {
        name: 'test',
        type: 'map',
        required: false,
      }
      expect(mapParam.type).toBe('map')
    })

    it('supports optional showWhen property', () => {
      // Verify that showWhen is a valid property on InputParam
      const paramWithShowWhen: InputParam = {
        name: 'body',
        type: 'string',
        required: false,
        showWhen: { field: 'method', values: ['POST', 'PUT'] },
      }
      expect(paramWithShowWhen.showWhen).toBeDefined()
      expect(paramWithShowWhen.showWhen!.field).toBe('method')
      expect(paramWithShowWhen.showWhen!.values).toEqual(['POST', 'PUT'])
    })

    it('showWhen is optional (undefined when not set)', () => {
      const paramWithoutShowWhen: InputParam = {
        name: 'url',
        type: 'string',
        required: true,
      }
      expect(paramWithoutShowWhen.showWhen).toBeUndefined()
    })

    it('supports optional group property', () => {
      const paramWithGroup: InputParam = {
        name: 'timeout',
        type: 'integer',
        required: false,
        group: 'Timeouts & Retries',
      }
      expect(paramWithGroup.group).toBe('Timeouts & Retries')
    })

    it('group is optional (undefined when not set)', () => {
      const paramWithoutGroup: InputParam = {
        name: 'url',
        type: 'string',
        required: true,
      }
      expect(paramWithoutGroup.group).toBeUndefined()
    })
  })

  describe('PARAM_TYPE_TO_VAR_TYPE', () => {
    it('maps all 7 canonical types as identity', () => {
      expect(PARAM_TYPE_TO_VAR_TYPE['string']).toBe('string')
      expect(PARAM_TYPE_TO_VAR_TYPE['integer']).toBe('integer')
      expect(PARAM_TYPE_TO_VAR_TYPE['float']).toBe('float')
      expect(PARAM_TYPE_TO_VAR_TYPE['boolean']).toBe('boolean')
      expect(PARAM_TYPE_TO_VAR_TYPE['array']).toBe('array')
      expect(PARAM_TYPE_TO_VAR_TYPE['map']).toBe('map')
      expect(PARAM_TYPE_TO_VAR_TYPE['table']).toBe('table')
    })

    it('does not contain legacy type keys', () => {
      expect(PARAM_TYPE_TO_VAR_TYPE['number']).toBeUndefined()
      expect(PARAM_TYPE_TO_VAR_TYPE['duration']).toBeUndefined()
      expect(PARAM_TYPE_TO_VAR_TYPE['enum']).toBeUndefined()
      expect(PARAM_TYPE_TO_VAR_TYPE['expression']).toBeUndefined()
      expect(PARAM_TYPE_TO_VAR_TYPE['object']).toBeUndefined()
    })
  })

  describe('Duration Default Values (milliseconds)', () => {
    it('wait-until check_interval default is 1000 (numeric ms)', () => {
      const inputs = CONTROL_INPUTS['wait-until']
      const checkInterval = inputs.find((p) => p.name === 'check_interval')
      expect(checkInterval).toBeDefined()
      expect(checkInterval!.defaultValue).toBe(1000)
    })
  })

  // The window takes the minimum the control checks at run (REQ-3.4.2.2).
  describe('Delay and Wait Until bounds', () => {
    const controlInput = (id: string, name: string) => CONTROL_INPUTS[id].find((p) => p.name === name)

    it('refuses a Delay duration below 1 ms', () => {
      expect(controlInput('delay', 'duration')?.minimum).toBe(1)
    })

    it('refuses a Wait Until timeout below 1 ms', () => {
      expect(controlInput('wait-until', 'timeout')?.minimum).toBe(1)
    })

    it('refuses a Wait Until check interval below 1 ms', () => {
      expect(controlInput('wait-until', 'check_interval')?.minimum).toBe(1)
    })
  })

  // One lookup by Block data for every Block: plugin, control and Function (REQ-3.1.1.5).
  describe('blockInputParams / blockOutputParams', () => {
    const FUNCTION_INPUTS = [
      { name: 'host', type: 'string', required: true, default: 'db.local', description: 'Where to connect' },
      { name: 'retries', type: 'integer', required: false, default: 3, description: '' },
      { name: 'level', type: 'integer', required: true, enumValues: [1, 2], default: 1, description: '' },
      { name: 'ratio', type: 'float', required: true, enumValues: [2.5, 5], default: 2.5, description: '' },
      { name: 'priority', type: 'string', required: true, enumValues: ['low', 'high'], default: 'low', description: '' },
      { name: 'token', type: 'string', required: false, secret: true, default: 'x', description: '' },
      { name: 'ids', type: 'array', required: false, default: [1, 2], description: '' },
    ]
    const FUNCTION_OUTPUTS = [
      { name: 'body', type: 'string', description: 'Response body' },
      { name: 'secret_out', type: 'string', description: '', secret: true },
    ]

    function localFunctionData(inputs: unknown[] = FUNCTION_INPUTS, outputs: unknown[] = FUNCTION_OUTPUTS) {
      return {
        label: 'Fetch',
        nodeType: 'function',
        elementType: 'function',
        functionLifecycle: 'local',
        localDefinition: { name: 'Fetch', inputs, outputs, workflow: { nodes: [], edges: [] } },
      }
    }

    function sharedFunctionData(extra: Record<string, unknown>) {
      return {
        label: 'fetch_user',
        nodeType: 'function',
        elementType: 'function',
        functionLifecycle: 'shared',
        functionId: 'fn-1',
        functionVersion: '1.0.0',
        ...extra,
      }
    }

    it('serves a plugin Block the rows of its own schema', () => {
      const data = { nodeType: 'plugin', elementType: 'log', version: '1.0.0' }

      expect(blockInputParams(data)).toEqual(getInputParams('log'))
      expect(blockOutputParams(data)).toEqual(getOutputParams('log'))
    })

    it('serves a control Block the rows of its own schema', () => {
      const data = { nodeType: 'control', elementType: 'delay', version: '1.0.0' }

      expect(blockInputParams(data)).toEqual(CONTROL_INPUTS['delay'])
      expect(blockOutputParams(data)).toEqual(CONTROL_OUTPUTS['delay'])
    })

    it('serves a Block with no version its fields', () => {
      const data = { nodeType: 'control', elementType: 'wait-until' }

      expect(blockInputParams(data)).toEqual(getInputParams('wait-until'))
    })

    it('serves a Local Function Block its declared inputs as fields', () => {
      const fields = blockInputParams(localFunctionData())

      expect(fields?.map((field: InputParam) => [field.name, field.type, field.required])).toEqual([
        ['host', 'string', true],
        ['retries', 'integer', false],
        ['level', 'integer', true],
        ['ratio', 'float', true],
        ['priority', 'string', true],
        ['token', 'string', false],
        ['ids', 'array', false],
      ])
    })

    it('gives a Local Function Block field a default only for an optional plain input', () => {
      const byName = Object.fromEntries((blockInputParams(localFunctionData()) ?? []).map((f: InputParam) => [f.name, f]))

      expect(byName.host.defaultValue).toBeUndefined()
      expect(byName.retries.defaultValue).toBe(3)
      expect(byName.token.defaultValue).toBeUndefined()
      expect(byName.token.secret).toBe(true)
      expect(byName.ids.defaultValue).toEqual([1, 2])
      expect(byName.ids.typedValues).toBe(true)
    })

    it('offers enum inputs their typed allowed values (REQ-3.1.2.11)', () => {
      const byName = Object.fromEntries((blockInputParams(localFunctionData()) ?? []).map((f: InputParam) => [f.name, f]))

      expect(byName.level.enumValues).toEqual([1, 2])
      expect(byName.ratio.enumValues).toEqual([2.5, 5])
      expect(byName.priority.enumValues).toEqual(['low', 'high'])
    })

    it('serves a Local Function Block its declared outputs', () => {
      const outputs = blockOutputParams(localFunctionData())

      expect(outputs).toHaveLength(2)
      expect(outputs?.[0]).toMatchObject({ name: 'body', type: 'string', description: 'Response body' })
      expect(outputs?.[1]).toMatchObject({ name: 'secret_out', type: 'string', secret: true })
    })

    it('serves a Shared Function Block in edit mode the inputs of its draft', () => {
      const data = sharedFunctionData({
        editMode: true,
        draft: {
          inputs: [{ name: 'draft_in', type: 'string', required: false, default: null, description: '' }],
          outputs: [{ name: 'draft_out', type: 'map', description: '' }],
          workflow: { nodes: [], edges: [] },
        },
        resolvedInputs: [{ name: 'pinned_in', type: 'string', required: false, default: null, description: '' }],
        resolvedOutputs: [{ name: 'pinned_out', type: 'string', description: '' }],
      })

      expect(blockInputParams(data)?.map((field: InputParam) => field.name)).toEqual(['draft_in'])
      expect(blockOutputParams(data)?.map((field) => field.name)).toEqual(['draft_out'])
    })

    it('serves a pinned Shared Function Block the inputs of the version it pins', () => {
      const data = sharedFunctionData({
        resolvedInputs: [{ name: 'level', type: 'integer', required: true, enumValues: [1, 2], default: 1, description: '' }],
        resolvedOutputs: [{ name: 'pinned_out', type: 'string', description: '' }],
      })

      expect(blockInputParams(data)?.map((field: InputParam) => [field.name, field.enumValues])).toEqual([
        ['level', [1, 2]],
      ])
      expect(blockOutputParams(data)?.map((field) => field.name)).toEqual(['pinned_out'])
    })

    it('serves no rows for a pinned Shared Function Block whose contract is not read yet', () => {
      const data = sharedFunctionData({})

      expect(blockInputParams(data)).toBeUndefined()
      expect(blockOutputParams(data)).toBeUndefined()
    })

    it('serves no rows for an element no registry declares', () => {
      expect(blockInputParams({ nodeType: 'plugin', elementType: 'no-such-block', version: '1.0.0' })).toBeUndefined()
    })

    it('serves no rows for a Local Function Block with no definition', () => {
      const data = { label: 'Fetch', nodeType: 'function', elementType: 'function', functionLifecycle: 'local' }

      expect(blockInputParams(data) ?? []).toEqual([])
      expect(blockOutputParams(data) ?? []).toEqual([])
    })

    it('skips malformed input entries of a Local Function: null, a text, a number, an entry without a name', () => {
      const data = localFunctionData([null, 'host', 42, { type: 'string', required: false }, FUNCTION_INPUTS[1]], [])

      expect(blockInputParams(data)?.map((field: InputParam) => field.name)).toEqual(['retries'])
    })

    it('skips malformed output entries of a Local Function the same way', () => {
      const data = localFunctionData([], [null, 'body', { type: 'string' }, FUNCTION_OUTPUTS[0]])

      expect(blockOutputParams(data)?.map((field) => field.name)).toEqual(['body'])
    })

    it('skips malformed entries in the pinned contract of a Shared Function Block', () => {
      const data = sharedFunctionData({
        resolvedInputs: [null, 'level', { type: 'integer' }, FUNCTION_INPUTS[1]],
        resolvedOutputs: [null, { type: 'string' }, FUNCTION_OUTPUTS[0]],
      })

      expect(blockInputParams(data)?.map((field: InputParam) => field.name)).toEqual(['retries'])
      expect(blockOutputParams(data)?.map((field) => field.name)).toEqual(['body'])
    })
  })

  // The Wait Until schema drives everything the config sheet renders. Until it
  // matches the control, the panel shows an empty parameter table and no
  // outputs.
  describe('wait-until schema', () => {
    const waitInputs = () => CONTROL_INPUTS['wait-until']
    const waitInput = (name: string) => waitInputs().find((p) => p.name === name)

    it('declares the six parameters in panel order', () => {
      expect(waitInputs().map((p) => p.name)).toEqual([
        'conditions',
        'timeout',
        'check_interval',
        'message',
        'mode',
        'fail_current_scope',
      ])
    })

    it('takes the condition as a required assertion list edited outside the table', () => {
      const conditions = waitInput('conditions')
      expect(conditions).toMatchObject({ type: 'array', required: true, noExpression: true })
    })

    it('requires a timeout in milliseconds', () => {
      expect(waitInput('timeout')).toMatchObject({ type: 'integer', required: true })
    })

    it('labels the timeout fields the way the config sheet shows them', () => {
      expect(waitInput('timeout')?.label).toBe('Timeout')
      expect(waitInput('check_interval')?.label).toBe('Check Interval')
      expect(waitInput('message')?.label).toBe('Timeout Message')
    })

    it('makes the check interval and the timeout message optional', () => {
      expect(waitInput('check_interval')).toMatchObject({ type: 'integer', required: false })
      expect(waitInput('message')).toMatchObject({ type: 'string', required: false })
    })

    it('offers retry and watch as the wait mode, defaulting to retry', () => {
      expect(waitInput('mode')).toMatchObject({
        type: 'string',
        enumValues: ['retry', 'watch'],
        defaultValue: 'retry',
        noExpression: true,
      })
    })

    it('offers fail current scope as an optional boolean defaulting off', () => {
      expect(waitInput('fail_current_scope')).toMatchObject({
        type: 'boolean',
        required: false,
        defaultValue: false,
        description: 'Fail the block and stop the flow when the wait gives up',
      })
    })

    it('declares exactly the passed and elapsed outputs', () => {
      expect(CONTROL_OUTPUTS['wait-until'].map((o) => o.name)).toEqual(['passed', 'elapsed'])
      expect(CONTROL_OUTPUTS['wait-until'].map((o) => o.type)).toEqual(['boolean', 'integer'])
    })

    it('drops the parameters and output the control no longer has', () => {
      const names = waitInputs().map((p) => p.name)
      expect(names).not.toContain('condition')
      expect(names).not.toContain('poll_interval')
      expect(CONTROL_OUTPUTS['wait-until'].map((o) => o.name)).not.toContain('timedOut')
    })

    it('serves the parameters at the implemented version instead of an empty table', () => {
      expect(getInputParams('wait-until')).toHaveLength(6)
      expect(getOutputParams('wait-until')).toHaveLength(2)
    })
  })

  describe('OUTPUT_TYPE_COMPAT', () => {
    it('maps string to string only', () => {
      expect(OUTPUT_TYPE_COMPAT['string']).toEqual(new Set(['string']))
    })

    it('maps integer to integer only', () => {
      expect(OUTPUT_TYPE_COMPAT['integer']).toEqual(new Set(['integer']))
    })

    it('maps float to float and integer', () => {
      expect(OUTPUT_TYPE_COMPAT['float']).toEqual(new Set(['float', 'integer']))
    })

    it('maps boolean to boolean only', () => {
      expect(OUTPUT_TYPE_COMPAT['boolean']).toEqual(new Set(['boolean']))
    })

    it('maps map to map only', () => {
      expect(OUTPUT_TYPE_COMPAT['map']).toEqual(new Set(['map']))
    })

    it('maps array to array only', () => {
      expect(OUTPUT_TYPE_COMPAT['array']).toEqual(new Set(['array']))
    })

    it('maps table to table only', () => {
      expect(OUTPUT_TYPE_COMPAT['table']).toEqual(new Set(['table']))
    })

  })

  describe('validateOutputBindings', () => {
    const makeNode = (
      elementType: string,
      label: string,
      outputBindings: Record<string, string>,
      version = '1.0.0'
    ) => ({
      data: {
        elementType,
        label,
        version,
        config: { outputBindings },
      },
    })

    it('returns empty array for valid bindings', () => {
      const nodes = [
        makeNode('http-client', 'HTTP 1', { status_code: 'code_var' }),
      ]
      const variables = [{ name: 'code_var', type: 'integer' }]
      expect(validateOutputBindings(nodes, variables)).toEqual([])
    })

    it('returns error for type mismatch', () => {
      const nodes = [
        makeNode('http-client', 'HTTP 1', { status_code: 'bad_var' }),
      ]
      const variables = [{ name: 'bad_var', type: 'boolean' }]
      const errors = validateOutputBindings(nodes, variables)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toEqual({
        nodeLabel: 'HTTP 1',
        paramName: 'status_code',
        paramType: 'integer',
        varName: 'bad_var',
        varType: 'boolean',
      })
    })

    it('skips empty binding values', () => {
      const nodes = [
        makeNode('http-client', 'HTTP 1', { status_code: '' }),
      ]
      const variables = [{ name: 'bad_var', type: 'boolean' }]
      expect(validateOutputBindings(nodes, variables)).toEqual([])
    })

    it('skips missing variables (handled by reconcile-on-load)', () => {
      const nodes = [
        makeNode('http-client', 'HTTP 1', { status_code: 'nonexistent' }),
      ]
      const variables: Array<{ name: string; type: string }> = []
      expect(validateOutputBindings(nodes, variables)).toEqual([])
    })

    it('skips nodes without config', () => {
      const nodes = [{ data: { elementType: 'http-client', label: 'HTTP 1', version: '1.0.0' } }]
      expect(validateOutputBindings(nodes, [])).toEqual([])
    })

    it('skips nodes without outputBindings', () => {
      const nodes = [{ data: { elementType: 'http-client', label: 'HTTP 1', version: '1.0.0', config: { values: {} } } }]
      expect(validateOutputBindings(nodes, [])).toEqual([])
    })

    it('allows matching type for for-each item output', () => {
      // for-each item output is type "map" (typed envelope)
      const nodes = [
        makeNode('for-each', 'Loop', { item: 'my_item' }),
      ]
      const variables = [{ name: 'my_item', type: 'map' }]
      expect(validateOutputBindings(nodes, variables)).toEqual([])
    })

    it('allows compatible types (float accepts integer)', () => {
      // float output should accept integer variable
      const nodes = [
        makeNode('http-client', 'HTTP 1', { status_code: 'int_var' }),
      ]
      const variables = [{ name: 'int_var', type: 'integer' }]
      expect(validateOutputBindings(nodes, variables)).toEqual([])
    })

    it('reports multiple errors across nodes', () => {
      const nodes = [
        makeNode('http-client', 'HTTP 1', { status_code: 'bool_var', body: 'int_var' }),
        makeNode('assert', 'Check', { passed: 'str_var' }),
      ]
      const variables = [
        { name: 'bool_var', type: 'boolean' },
        { name: 'int_var', type: 'integer' },
        { name: 'str_var', type: 'string' },
      ]
      const errors = validateOutputBindings(nodes, variables)
      // status_code (integer) -> bool_var (boolean) = error
      // body (string) -> int_var (integer) = error
      // passed (boolean) -> str_var (string) = error
      expect(errors).toHaveLength(3)
    })

    it('uses elementType as label fallback when label is missing', () => {
      const nodes = [{
        data: {
          elementType: 'http-client',
          version: '1.0.0',
          config: { outputBindings: { status_code: 'bad_var' } },
        },
      }]
      const variables = [{ name: 'bad_var', type: 'boolean' }]
      const errors = validateOutputBindings(nodes, variables)
      expect(errors[0].nodeLabel).toBe('http-client')
    })

    it('defaults param type to string for unknown output params', () => {
      // Binding to an output param not in the schema defaults to string type
      const nodes = [
        makeNode('http-client', 'HTTP 1', { unknown_output: 'str_var' }),
      ]
      const variables = [{ name: 'str_var', type: 'string' }]
      expect(validateOutputBindings(nodes, variables)).toEqual([])
    })

    it('handles nodes with missing elementType and version', () => {
      // elementType and version fallback to '' and '1.0.0' respectively
      const nodes = [{
        data: {
          label: 'Custom',
          config: { outputBindings: { out: 'my_var' } },
        },
      }]
      const variables = [{ name: 'my_var', type: 'string' }]
      // Unknown block -> no declared outputs -> the name is skipped (SHRUN-6)
      expect(validateOutputBindings(nodes, variables)).toEqual([])
    })

    it('handles unknown block type with null schema', () => {
      const nodes = [
        makeNode('nonexistent-block', 'Custom', { some_param: 'bad_var' }),
      ]
      const variables = [{ name: 'bad_var', type: 'boolean' }]
      // An unknown block declares no outputs, so the name is skipped (SHRUN-6)
      expect(validateOutputBindings(nodes, variables)).toEqual([])
    })

    it('skips validation when compat set is empty', () => {
      // Temporarily set string compat to empty set to exercise compat.size === 0 branch
      const original = OUTPUT_TYPE_COMPAT['string']
      OUTPUT_TYPE_COMPAT['string'] = new Set()

      try {
        // body is a declared string output, so the compat check is reached
        const nodes = [
          makeNode('http-client', 'HTTP 1', { body: 'my_var' }),
        ]
        const variables = [{ name: 'my_var', type: 'boolean' }]

        // With empty compat set, validation is skipped (no error even though types differ)
        expect(validateOutputBindings(nodes, variables)).toEqual([])
      } finally {
        OUTPUT_TYPE_COMPAT['string'] = original
      }
    })

    it('skips an output name the schema does not declare (SHRUN-6)', () => {
      // A script variable is declared by the block's own settings, so this
      // validator has no type for it and leaves the binding alone.
      const nodes = [
        makeNode('http-client', 'HTTP 1', { COUNT: 'line_count' }),
      ]
      const variables = [{ name: 'line_count', type: 'integer' }]
      expect(validateOutputBindings(nodes, variables)).toEqual([])
    })

    describe('reports the resolved output type, not the declared one (K8SREAD-6)', () => {
      const k8sGetNode = (
        values: Record<string, unknown> | undefined,
        outputBindings: Record<string, string>,
      ) => ({
        data: {
          elementType: 'k8s-get',
          label: 'Read pods',
          version: '1.0.0',
          config: values === undefined ? { outputBindings } : { values, outputBindings },
        },
      })

      it('names table on a Table-mode read bound to a map variable', () => {
        const nodes = [k8sGetNode({ output_format: 'table' }, { result: 'pods' })]
        const errors = validateOutputBindings(nodes, [{ name: 'pods', type: 'map' }])
        expect(errors).toHaveLength(1)
        expect(errors[0].paramType).toBe('table')
      })

      it('accepts a table variable on a Table-mode read', () => {
        const nodes = [k8sGetNode({ output_format: 'table' }, { result: 'pods' })]
        expect(validateOutputBindings(nodes, [{ name: 'pods', type: 'table' }])).toEqual([])
      })

      it('names array on a List read', () => {
        const nodes = [k8sGetNode({ search_by: 'list' }, { result: 'pods' })]
        const errors = validateOutputBindings(nodes, [{ name: 'pods', type: 'map' }])
        expect(errors[0].paramType).toBe('array')
      })

      it('falls back to the parameter defaults when the node stores no values', () => {
        const nodes = [k8sGetNode(undefined, { result: 'pods' })]
        expect(validateOutputBindings(nodes, [{ name: 'pods', type: 'map' }])).toEqual([])
        const errors = validateOutputBindings(nodes, [{ name: 'pods', type: 'array' }])
        expect(errors[0].paramType).toBe('map')
      })
    })
  })
})
