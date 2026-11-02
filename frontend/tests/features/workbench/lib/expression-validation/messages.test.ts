/**
 * The wording the expression field and the Python script checks share.
 *
 * Contract under test:
 *   - an unknown variable reads "Variable '{name}' is not defined", or with a
 *     suggestion "Variable '{name}' not defined. Did you mean '{suggestion}'?"
 *   - the label is replaceable ("Identifier" for a complex expression)
 *   - an unknown function reads "Function '{name}' is not recognized"
 *   - an unknown method reads "'{method}' is not a valid method", naming the type when known
 *   - a wrong argument count reads "Method '{method}' takes {expected}, got {n}"
 *   - the expected count reads "N argument(s)", "min-max arguments",
 *     "0 or more arguments" or "at least N argument(s)"
 *   - an operator type error reads "Cannot use '{op}' with {left} and {right}",
 *     with a str() hint for str + int and int + str
 *
 * REQ-3.4.1.2: Python script execution
 */

import { describe, it, expect } from 'vitest'

import {
  expectedArgCount,
  invalidMethodMessage,
  methodArgCountMessage,
  operatorTypeMessage,
  unknownFunctionMessage,
  unknownVariableMessage,
} from '@/features/workbench/lib/expression-validation/messages'

describe('unknownVariableMessage', () => {
  it('names the variable', () => {
    expect(unknownVariableMessage('usr')).toMatch(/^Variable 'usr' is not defined$/)
  })

  it('offers the suggestion when there is one', () => {
    expect(unknownVariableMessage('usr', 'user')).toMatch(
      /^Variable 'usr' not defined\. Did you mean 'user'\?$/,
    )
  })

  it('uses the label it is given', () => {
    expect(unknownVariableMessage('usr', undefined, 'Identifier')).toMatch(
      /^Identifier 'usr' is not defined$/,
    )
    expect(unknownVariableMessage('usr', 'user', 'Identifier')).toMatch(
      /^Identifier 'usr' not defined\. Did you mean 'user'\?$/,
    )
  })
})

describe('unknownFunctionMessage', () => {
  it('names the function', () => {
    expect(unknownFunctionMessage('puts')).toMatch(/^Function 'puts' is not recognized$/)
  })
})

describe('invalidMethodMessage', () => {
  it('names the method alone when the type is unknown', () => {
    expect(invalidMethodMessage('shout')).toMatch(/^'shout' is not a valid method$/)
  })

  it('names the type when it is known', () => {
    expect(invalidMethodMessage('shout', 'str')).toMatch(
      /^'shout' is not a valid method for type 'str'$/,
    )
  })
})

describe('expectedArgCount', () => {
  it('reads one argument in the singular', () => {
    expect(expectedArgCount(1, 1)).toMatch(/^1 argument$/)
  })

  it('reads an exact count in the plural', () => {
    expect(expectedArgCount(0, 0)).toMatch(/^0 arguments$/)
    expect(expectedArgCount(2, 2)).toMatch(/^2 arguments$/)
  })

  it('reads a range', () => {
    expect(expectedArgCount(0, 2)).toMatch(/^0-2 arguments$/)
  })

  it('reads an open range with no minimum', () => {
    expect(expectedArgCount(0, -1)).toMatch(/^0 or more arguments$/)
  })

  it('reads an open range with a minimum', () => {
    expect(expectedArgCount(1, -1)).toMatch(/^at least 1 argument$/)
    expect(expectedArgCount(3, -1)).toMatch(/^at least 3 arguments$/)
  })
})

describe('methodArgCountMessage', () => {
  it('names the method, the expected count and the count given', () => {
    expect(methodArgCountMessage('split', '0-2 arguments', 3)).toMatch(
      /^Method 'split' takes 0-2 arguments, got 3$/,
    )
  })
})

describe('operatorTypeMessage', () => {
  it('names the operator and both types', () => {
    expect(operatorTypeMessage('*', 'Decimal', 'float')).toMatch(
      /^Cannot use '\*' with Decimal and float$/,
    )
  })

  it('hints at str() for str + int', () => {
    expect(operatorTypeMessage('+', 'str', 'int')).toMatch(
      /^Cannot use '\+' with str and int - use str\(\) to convert$/,
    )
  })

  it('hints at str() for int + str', () => {
    expect(operatorTypeMessage('+', 'int', 'str')).toMatch(
      /^Cannot use '\+' with int and str - use str\(\) to convert$/,
    )
  })

  it('gives no hint for another operator on str and int', () => {
    expect(operatorTypeMessage('-', 'str', 'int')).toMatch(/^Cannot use '-' with str and int$/)
  })

  it('gives no hint for + on other types', () => {
    expect(operatorTypeMessage('+', 'str', 'float')).toMatch(
      /^Cannot use '\+' with str and float$/,
    )
  })
})
