/**
 * checkPythonScript - the live warnings of the Python script editor.
 *
 * Contract under test (PYRUN-13), against a real tree-sitter parse:
 *   - a name read but bound nowhere it could come from is a warning: a call
 *     target reads "Function '{name}' is not recognized", anything else
 *     "Variable '{name}' is not defined", with "Did you mean" when a name in
 *     scope, an Input Variable or a builtin is close
 *   - Input Variables, the bridge's module globals and every Python builtin
 *     (blocked catalog entries included) are defined
 *   - an Input Variable of known type that the script never rebinds gets its
 *     method names and argument counts checked against the Python type it
 *     arrives as: string str, integer int, float Decimal, boolean bool,
 *     array list, map dict, table the bridge's table object
 *   - a binary operator whose operands are literals or such Input Variables is
 *     a warning only when Python always raises TypeError for those types
 *   - a star import or dynamic namespace access turns every check off
 *   - each warning carries its 1-based line, its span and the expression
 *     field's issue type, in document order
 *
 * REQ-3.4.1.2: Python script execution
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { initializeTreeSitter, type TreeSitterParser } from '@/features/workbench/lib/tree-sitter-init'
import {
  checkPythonScript,
  type ScriptInputs,
} from '@/features/workbench/lib/python-script-validation/check-script'
import { PYTHON_BUILTINS } from '@/features/workbench/lib/python-builtins'

let parser: TreeSitterParser

beforeAll(async () => {
  parser = await initializeTreeSitter()
})

const NO_INPUTS: ScriptInputs = { names: [], types: {} }

const TYPED_INPUTS: ScriptInputs = {
  names: ['label', 'count', 'threshold', 'flag', 'values', 'summary', 'readings', 'untyped'],
  types: {
    label: 'string',
    count: 'integer',
    threshold: 'float',
    flag: 'boolean',
    values: 'array',
    summary: 'map',
    readings: 'table',
  },
}

function check(source: string, inputs: ScriptInputs = NO_INPUTS) {
  return checkPythonScript(parser.parse(source).rootNode, inputs)
}

function messages(source: string, inputs: ScriptInputs = NO_INPUTS): string[] {
  return check(source, inputs).map((warning) => warning.message)
}

describe('checkPythonScript - unknown names', () => {
  it('warns about an unknown function, on the name', () => {
    expect(check("puts('test')")).toEqual([
      {
        line: 1,
        message: "Function 'puts' is not recognized",
        severity: 'warning',
        from: 0,
        to: 4,
        type: 'invalid_function',
      },
    ])
  })

  it('warns about an unknown variable, on the name', () => {
    expect(check('x = 1\nprint(x, qwertyuiop)')).toEqual([
      {
        line: 2,
        message: "Variable 'qwertyuiop' is not defined",
        severity: 'warning',
        from: 15,
        to: 25,
        type: 'unknown_variable',
      },
    ])
  })

  it('suggests a name the script binds in scope', () => {
    expect(messages('total = 1\nprint(totl)')).toEqual([
      "Variable 'totl' not defined. Did you mean 'total'?",
    ])
  })

  it('suggests an Input Variable', () => {
    expect(messages('print(threshld)', { names: ['threshold'], types: {} })).toEqual([
      "Variable 'threshld' not defined. Did you mean 'threshold'?",
    ])
  })

  it('suggests a builtin', () => {
    expect(messages('try:\n    pass\nexcept ValueErrr:\n    pass')).toEqual([
      "Variable 'ValueErrr' not defined. Did you mean 'ValueError'?",
    ])
  })

  it('offers no suggestion for an unknown function', () => {
    expect(messages('total = 1\ntotl()')).toEqual(["Function 'totl' is not recognized"])
  })

  it('warns once per read, in document order', () => {
    expect(check('puts(1)\nprint(ghost)\nputs(2)').map((warning) => [warning.line, warning.message])).toEqual([
      [1, "Function 'puts' is not recognized"],
      [2, "Variable 'ghost' is not defined"],
      [3, "Function 'puts' is not recognized"],
    ])
  })

  it('knows the Input Variables', () => {
    expect(messages('for row in readings:\n    print(row, limit)', { names: ['readings', 'limit'], types: {} })).toEqual([])
  })

  it("knows the bridge's module globals", () => {
    expect(messages('print(__name__, __file__, __doc__, __package__, __builtins__, __spec__, __loader__)')).toEqual([])
  })

  it('knows every Python builtin, the ones the expression field blocks included', () => {
    expect(messages('x = [1]\nprint(len(x), eval, exec, open, exit, super, ExceptionGroup, aiter, NotImplemented)')).toEqual([])
  })

  it('knows every builtin the completion catalog offers', () => {
    const script = PYTHON_BUILTINS.map((entry) => entry.name).join('\n')
    expect(messages(script)).toEqual([])
  })

  it('checks nothing when the script has a star import', () => {
    expect(messages('from os.path import *\nputs(join)\nthreshold * 1.5', TYPED_INPUTS)).toEqual([])
  })

  it('checks nothing when the script reaches a namespace dynamically', () => {
    expect(messages('globals()["ghost"] = 1\nprint(ghost)\nthreshold * 1.5', TYPED_INPUTS)).toEqual([])
  })
})

describe('checkPythonScript - methods on typed Input Variables', () => {
  it('warns about an unknown method, on the method name', () => {
    expect(check('label.shout()', TYPED_INPUTS)).toEqual([
      {
        line: 1,
        message: "'shout' is not a valid method for type 'str'",
        severity: 'warning',
        from: 6,
        to: 11,
        type: 'invalid_function',
      },
    ])
  })

  it('accepts a method of the type', () => {
    expect(messages('label.upper()\nlabel.removeprefix("a")', TYPED_INPUTS)).toEqual([])
  })

  it('names each WAVE type by the Python type the script receives', () => {
    expect(
      messages(
        'count.upper()\nthreshold.is_integer()\nflag.upper()\nvalues.push(1)\nsummary.has_key("k")\nreadings.row_count()',
        TYPED_INPUTS,
      ),
    ).toEqual([
      "'upper' is not a valid method for type 'int'",
      "'is_integer' is not a valid method for type 'Decimal'",
      "'upper' is not a valid method for type 'bool'",
      "'push' is not a valid method for type 'list'",
      "'has_key' is not a valid method for type 'dict'",
      "'row_count' is not a valid method for type 'table'",
    ])
  })

  it('accepts the methods each Python type really has', () => {
    expect(
      messages(
        'count.bit_length()\nthreshold.quantize(threshold)\nflag.bit_length()\nvalues.append(1)\nsummary.get("k")\nreadings.__len__()',
        TYPED_INPUTS,
      ),
    ).toEqual([])
  })

  it("reads a property of the table object as no method", () => {
    expect(messages('readings.columns()', TYPED_INPUTS)).toEqual([
      "'columns' is not a valid method for type 'table'",
    ])
  })

  it('warns about too many arguments, on the method name', () => {
    expect(check('label.split(",", 1, 2)', TYPED_INPUTS)).toEqual([
      {
        line: 1,
        message: "Method 'split' takes 0-2 arguments, got 3",
        severity: 'warning',
        from: 6,
        to: 11,
        type: 'invalid_function',
      },
    ])
  })

  it('warns about too few arguments', () => {
    expect(messages('label.join()', TYPED_INPUTS)).toEqual(["Method 'join' takes 1 argument, got 0"])
  })

  it('warns about an argument to a method that takes none', () => {
    expect(messages('label.upper(1)', TYPED_INPUTS)).toEqual(["Method 'upper' takes 0 arguments, got 1"])
  })

  it('counts keyword arguments', () => {
    expect(messages('label.split(sep=",", maxsplit=1)\nvalues.sort(key=len, reverse=True, extra=1)', TYPED_INPUTS)).toEqual([
      "Method 'sort' takes 0-2 arguments, got 3",
    ])
  })

  it('counts a bare generator argument as one', () => {
    expect(messages('label.join(str(v) for v in values)', TYPED_INPUTS)).toEqual([])
  })

  it('skips the count when an argument is unpacked', () => {
    expect(messages('parts = []\nopts = {}\nlabel.split(*parts)\nlabel.split(**opts)', TYPED_INPUTS)).toEqual([])
  })

  it('ignores a comment inside the argument list', () => {
    expect(messages('label.upper(\n    # nothing\n)', TYPED_INPUTS)).toEqual([])
  })

  it('skips the count for a method no signature fixes', () => {
    expect(messages('label.__class__(1, 2, 3)', TYPED_INPUTS)).toEqual([])
  })

  it('accepts the counts of a method whose signature is only known empirically', () => {
    expect(messages('summary.update(a=1, b=2, c=3)\nlabel.count("a", 0, 5)', TYPED_INPUTS)).toEqual([])
  })

  it('checks nothing on an Input Variable the script rebinds anywhere', () => {
    expect(messages('label = "x"\nlabel.shout()', TYPED_INPUTS)).toEqual([])
    expect(messages('def f(label):\n    return label.shout()', TYPED_INPUTS)).toEqual([])
    expect(messages('[label.shout() for label in []]', TYPED_INPUTS)).toEqual([])
  })

  it('checks nothing on an Input Variable of unknown type', () => {
    expect(messages('untyped.shout()', TYPED_INPUTS)).toEqual([])
    expect(messages('odd.shout()', { names: ['odd'], types: { odd: 'secret' } })).toEqual([])
  })

  it('checks only the method called on the Input Variable itself', () => {
    expect(messages('label.upper().shout()\nlabel.shout\nother = label\nother.shout()', TYPED_INPUTS)).toEqual([])
  })

  it('checks a method call inside a function', () => {
    expect(messages('def f():\n    return values.push(1)', TYPED_INPUTS)).toEqual([
      "'push' is not a valid method for type 'list'",
    ])
  })
})

describe('checkPythonScript - operator types', () => {
  it('warns about Decimal times float, on the operator', () => {
    expect(check('limit = threshold * 1.5', TYPED_INPUTS)).toEqual([
      {
        line: 1,
        message: "Cannot use '*' with Decimal and float",
        severity: 'warning',
        from: 18,
        to: 19,
        type: 'invalid_function',
      },
    ])
  })

  it('accepts Decimal with int and with Decimal', () => {
    expect(messages('threshold * 2\nthreshold + threshold\n2 ** threshold', TYPED_INPUTS)).toEqual([])
  })

  it('reads a signed or parenthesized literal as its type', () => {
    expect(messages('threshold * -1.5\n(threshold) / (+2.5)', TYPED_INPUTS)).toEqual([
      "Cannot use '*' with Decimal and float",
      "Cannot use '/' with Decimal and float",
    ])
  })

  it('hints at str() for str + int, either way round', () => {
    expect(messages('"a" + 1\n1 + label', TYPED_INPUTS)).toEqual([
      "Cannot use '+' with str and int - use str() to convert",
      "Cannot use '+' with int and str - use str() to convert",
    ])
  })

  it('warns about the literal types Python rejects', () => {
    expect(
      messages('b"a" + "b"\n1j // 2\n[1] * 2.0\n(1,) + [2]\nNone + 1\n2 @ 3\n{1} + {2}\n1 << 1.0', NO_INPUTS),
    ).toEqual([
      "Cannot use '+' with bytes and str",
      "Cannot use '//' with complex and int",
      "Cannot use '*' with list and float",
      "Cannot use '+' with tuple and list",
      "Cannot use '+' with NoneType and int",
      "Cannot use '@' with int and int",
      "Cannot use '+' with set and set",
      "Cannot use '<<' with int and float",
    ])
  })

  it('accepts the literal types Python accepts', () => {
    expect(
      messages(
        '"%d" % 5\n"%s" % readings\nb"%s" % b"x"\n{"a": 1} | {"b": 2}\n{1} - {2}\nTrue + 1\n[0] * 3\n3 * "ab"\n1 + 2.5j\nrb"a" + b"b"\n"a" "b" + "c"',
        TYPED_INPUTS,
      ),
    ).toEqual([])
  })

  it('reads a b prefix of any quoting as bytes, and no other prefix', () => {
    expect(
      messages('B"a" + "b"\nb\'\'\'a\'\'\' + "b"\nBr"""a""" + "b"\nr"a" + b"b"\nu"a" + b"b"\nf"a" + b"b"', NO_INPUTS),
    ).toEqual([
      "Cannot use '+' with bytes and str",
      "Cannot use '+' with bytes and str",
      "Cannot use '+' with bytes and str",
      "Cannot use '+' with str and bytes",
      "Cannot use '+' with str and bytes",
      "Cannot use '+' with str and bytes",
    ])
  })

  it('warns about a table in arithmetic', () => {
    expect(messages('readings + 1', TYPED_INPUTS)).toEqual(["Cannot use '+' with table and int"])
  })

  it('checks nothing when an operand is neither a literal nor a typed Input Variable', () => {
    expect(
      messages('rate = 1.5\nthreshold * rate\nfloat(threshold) * 1.5\nuntyped * 1.5\n-threshold * 1.5\nnot_a_name = 2', TYPED_INPUTS),
    ).toEqual([])
  })

  it('checks the innermost operation of a chain only', () => {
    expect(messages('threshold * 1.5 * 2', TYPED_INPUTS)).toEqual(["Cannot use '*' with Decimal and float"])
  })

  it('checks nothing on an Input Variable the script rebinds', () => {
    expect(messages('threshold = 1.0\nthreshold * 1.5', TYPED_INPUTS)).toEqual([])
  })

  it('never reads a comparison as an operator error', () => {
    expect(messages('threshold < 1.5\nlabel == 1', TYPED_INPUTS)).toEqual([])
  })

  it('checks inside f-strings and functions, never inside annotations', () => {
    expect(
      messages('f"{threshold * 1.5}"\ndef f(x: "a" + 1) -> "b" + 2:\n    return threshold * 1.5', TYPED_INPUTS),
    ).toEqual([
      "Cannot use '*' with Decimal and float",
      "Cannot use '*' with Decimal and float",
    ])
  })
})

describe('checkPythonScript - scripts that must stay quiet', () => {
  it('raises nothing on the capture script', () => {
    const script = [
      'import statistics',
      'import logging',
      '',
      'limit = float(threshold)',
      'values = [row["temp_c"] for row in readings]',
      'mean_temp = statistics.mean(values)',
      'out_of_range = [row for row in readings if row["temp_c"] > limit]',
      'logging.info("mean %.2f, %d readings above %.1f", mean_temp, len(out_of_range), limit)',
      'summary = {"mean": mean_temp, "above_limit": len(out_of_range)}',
      'assert len(out_of_range) < 3, "too many readings above the limit"',
    ].join('\n')

    expect(check(script, { names: ['readings', 'threshold'], types: { readings: 'table', threshold: 'float' } })).toEqual([])
  })

  it('raises nothing on the help tips, in the context they assume', () => {
    const script = [
      'import logging',
      'import os',
      'import sys',
      'import helpers',
      '',
      'limit = float(threshold)',
      'for row in readings: row["temp_c"]',
      'doubled = float(price) * 2',
      'mean_temp = limit',
      'summary = {"mean": mean_temp}',
      'rows = [{"id": 1, "ok": True}]',
      'count = len(rows)',
      'logging.info("done %d", count)',
      'ok = count > 0',
      'assert ok, "no rows"',
      'folder = os.environ["WAVE_TESTDATA_DIR"]',
      'sys.exit(2)',
    ].join('\n')

    expect(
      check(script, {
        names: ['threshold', 'readings', 'price'],
        types: { threshold: 'float', readings: 'table', price: 'float' },
      }),
    ).toEqual([])
  })
})
