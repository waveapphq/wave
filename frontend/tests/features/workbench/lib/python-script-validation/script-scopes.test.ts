/**
 * analyzeScriptScopes - which names a Python script reads without binding them.
 *
 * Contract under test (PYRUN-13), always against a real tree-sitter parse:
 *   - a name is bound by assignment, import, def/class, parameter, a for / with /
 *     except / walrus / comprehension / match target, a global or nonlocal
 *     declaration, del, or a type parameter
 *   - module, function, lambda, comprehension and class scopes follow Python:
 *     a class body's names are not visible in its methods, lambdas or later
 *     comprehension clauses, and a module-level name bound anywhere is visible in
 *     every function
 *   - there is no flow analysis: a read before the assignment is not reported
 *   - decorators, defaults, class bases and the first comprehension iterable are
 *     read in the enclosing scope; annotations are never read
 *   - a read inside a try whose handler catches NameError is not reported
 *   - a star import and dynamic namespace access are reported as flags
 *
 * REQ-3.4.1.2: Python script execution
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { initializeTreeSitter, type TreeSitterParser } from '@/features/workbench/lib/tree-sitter-init'
import { analyzeScriptScopes } from '@/features/workbench/lib/python-script-validation/script-scopes'
import { RUNTIME_BUILTIN_NAMES } from '@/features/workbench/lib/python-script-validation/runtime-builtin-names'

let parser: TreeSitterParser

beforeAll(async () => {
  parser = await initializeTreeSitter()
})

function scopesOf(source: string) {
  return analyzeScriptScopes(parser.parse(source).rootNode)
}

/** The names read without a binding the script makes and without a builtin of that name. */
function unbound(source: string): string[] {
  const scopes = scopesOf(source)
  return scopes.reads
    .filter((read) => !scopes.isBound(read) && !RUNTIME_BUILTIN_NAMES.has(read.name))
    .map((read) => read.name)
}

describe('analyzeScriptScopes - reads', () => {
  it('reports a name nothing binds', () => {
    expect(unbound('print(value)')).toEqual(['value'])
  })

  it('reports each read with its span, its 1-based line and whether it is called', () => {
    const scopes = scopesOf('a = 1\nputs(a, ghost)')

    expect(scopes.reads.map(({ name, from, to, line, callTarget }) => ({ name, from, to, line, callTarget }))).toEqual([
      { name: 'puts', from: 6, to: 10, line: 2, callTarget: true },
      { name: 'a', from: 11, to: 12, line: 2, callTarget: false },
      { name: 'ghost', from: 14, to: 19, line: 2, callTarget: false },
    ])
  })

  it('never reads an attribute name or a keyword argument name', () => {
    expect(unbound('def call(**kw):\n    return kw\nx = 1\ncall(key=x.real.imag)')).toEqual([])
  })

  it('reads the object of an attribute and the parts of a subscript', () => {
    expect(unbound('obj.attr.deep\nitems[key]')).toEqual(['obj', 'items', 'key'])
  })

  it('reads the expressions of an f-string, format spec included', () => {
    expect(unbound('f"{name!r:>{width}}"')).toEqual(['name', 'width'])
  })

  it('binds nothing through an f-string', () => {
    expect(unbound('name = "a"\nwidth = 3\nf"{name!r:>{width}}"')).toEqual([])
  })

  it('never reads an annotation', () => {
    expect(unbound('def f(a: Unknown, b: Other = 1) -> Result:\n    return a, b\nv: Missing = 1')).toEqual([])
  })

  it('reads the default of an annotated parameter', () => {
    expect(unbound('def f(b: int = fallback):\n    return b')).toEqual(['fallback'])
  })
})

describe('analyzeScriptScopes - module bindings', () => {
  it('binds an assignment', () => {
    expect(unbound('value = 1\nprint(value)')).toEqual([])
  })

  it('binds every name of a chained assignment', () => {
    expect(unbound('a = b = 1\nprint(a, b)')).toEqual([])
  })

  it('binds an augmented assignment target', () => {
    expect(unbound('total += 1')).toEqual([])
  })

  it('binds tuple, list and starred targets and reads the value', () => {
    expect(unbound('a, [b, *c] = source\nprint(a, b, c)')).toEqual(['source'])
  })

  it('reads the object of an attribute target and the parts of a subscript target', () => {
    expect(unbound('obj.attr = 1\nitems[key] = 2')).toEqual(['obj', 'items', 'key'])
  })

  it('binds an annotated assignment target', () => {
    expect(unbound('limit: int = 3\nprint(limit)')).toEqual([])
  })

  it('binds a del target', () => {
    expect(unbound('del ghost')).toEqual([])
  })

  it('does no flow analysis: a read before the assignment is bound', () => {
    expect(unbound('print(value)\nvalue = 1')).toEqual([])
  })
})

describe('analyzeScriptScopes - imports', () => {
  it('binds an imported module', () => {
    expect(unbound('import os\nos.getcwd()')).toEqual([])
  })

  it('binds only the first name of a dotted import', () => {
    expect(unbound('import os.path\nos.path.join("a")\npath')).toEqual(['path'])
  })

  it('binds the alias of a dotted import, not its first name', () => {
    expect(unbound('import xml.etree as tree\ntree\nxml')).toEqual(['xml'])
  })

  it('binds a from-import name, or its alias instead', () => {
    expect(unbound('from json import loads\nfrom json import dumps as write\nloads, write, dumps')).toEqual(['dumps'])
  })

  it('binds a relative from-import name', () => {
    expect(unbound('from . import helpers\nhelpers.run()')).toEqual([])
  })

  it('binds a __future__ feature name', () => {
    expect(unbound('from __future__ import annotations\nannotations')).toEqual([])
  })

  it('flags a star import', () => {
    expect(scopesOf('from os.path import *').starImport).toBe(true)
  })

  it('flags no star import for a plain import', () => {
    expect(scopesOf('from os.path import join\nimport sys').starImport).toBe(false)
  })
})

describe('analyzeScriptScopes - functions', () => {
  it('binds the function name in the enclosing scope', () => {
    expect(unbound('def helper():\n    pass\nhelper()')).toEqual([])
  })

  it('binds every kind of parameter inside the body', () => {
    expect(
      unbound('def f(a, /, b=1, *args, c, d=2, **kw):\n    return a, b, args, c, d, kw, e\ndef g(*, key: int, flag: bool = True):\n    return key, flag'),
    ).toEqual(['e'])
  })

  it('keeps parameters out of the enclosing scope', () => {
    expect(unbound('def f(param):\n    return param\nparam')).toEqual(['param'])
  })

  it('reads a default in the enclosing scope', () => {
    expect(unbound('def f(a=a):\n    return a')).toEqual(['a'])
  })

  it('reads a decorator in the enclosing scope', () => {
    expect(unbound('@decorate\ndef f():\n    pass')).toEqual(['decorate'])
  })

  it('sees a variable of the enclosing function', () => {
    expect(unbound('def outer():\n    v = 1\n    def inner():\n        return v\n    return inner')).toEqual([])
  })

  it('does not see a variable of a sibling function', () => {
    expect(unbound('def one():\n    v = 1\ndef two():\n    return v')).toEqual(['v'])
  })

  it('sees a module-level name bound later in the file', () => {
    expect(unbound('def f():\n    return later\nlater = 1')).toEqual([])
  })

  it('does not see a name only another function binds', () => {
    expect(unbound('def f():\n    return later\ndef g():\n    later = 1')).toEqual(['later'])
  })

  it('treats a global declaration as a binding', () => {
    expect(unbound('def f():\n    global flag\n    return flag')).toEqual([])
  })

  it('makes a name a function assigns under global visible to other functions', () => {
    expect(unbound('def init():\n    global counter\n    counter = 1\ndef read():\n    return counter')).toEqual([])
  })

  it('does not make a plain local assignment visible to other functions', () => {
    expect(unbound('def init():\n    counter = 1\ndef read():\n    return counter')).toEqual(['counter'])
  })

  it('treats a nonlocal declaration as a binding', () => {
    expect(unbound('def outer():\n    def inner():\n        nonlocal ghost\n        return ghost\n    return inner')).toEqual([])
  })

  it('reports the same read without the nonlocal declaration', () => {
    expect(unbound('def outer():\n    def inner():\n        return ghost\n    return inner')).toEqual(['ghost'])
  })

  it('binds async for and async with targets', () => {
    expect(unbound('async def f(src, ctx):\n    async for row in src:\n        pass\n    async with ctx as held:\n        return row, held')).toEqual([])
  })

  it('binds a type parameter', () => {
    expect(unbound('def first[T](items: list[T]) -> T:\n    return items[0]\nclass Box[V]:\n    pass')).toEqual([])
  })

  it('binds a type alias name and never reads its value', () => {
    expect(unbound('type Pair[T] = tuple[T, Missing]\nPair')).toEqual([])
  })
})

describe('analyzeScriptScopes - lambdas', () => {
  it('binds lambda parameters in the body and reads defaults outside', () => {
    expect(unbound('f = lambda x, *rest, y=z, **kw: x + y + w')).toEqual(['z', 'w'])
  })

  it('keeps lambda parameters out of the enclosing scope', () => {
    expect(unbound('f = lambda q: q\nq')).toEqual(['q'])
  })
})

describe('analyzeScriptScopes - classes', () => {
  it('binds the class name in the enclosing scope', () => {
    expect(unbound('class Point:\n    pass\nPoint()')).toEqual([])
  })

  it('reads bases and keywords in the enclosing scope', () => {
    expect(unbound('class C(Base, metaclass=Meta):\n    pass')).toEqual(['Base', 'Meta'])
  })

  it('sees a class-body name in the class body', () => {
    expect(unbound('class C:\n    size = 1\n    double = size * 2')).toEqual([])
  })

  it('does not see a class-body name inside a method', () => {
    expect(unbound('class C:\n    size = 1\n    def m(self):\n        return size')).toEqual(['size'])
  })

  it('does not see a class-body name inside a lambda of the body', () => {
    expect(unbound('class C:\n    k = 1\n    f = lambda: k')).toEqual(['k'])
  })

  it('does not see an outer class-body name inside a nested class', () => {
    expect(unbound('class Outer:\n    k = 1\n    class Inner:\n        j = k')).toEqual(['k'])
  })

  it('sees a module name inside a method', () => {
    expect(unbound('limit = 1\nclass C:\n    def m(self):\n        return limit')).toEqual([])
  })

  it('reads a method default in the class body', () => {
    expect(unbound('class C:\n    size = 1\n    def m(self, n=size):\n        return n')).toEqual([])
  })

  it('reads __class__ inside a method', () => {
    expect(unbound('class C:\n    def m(self):\n        def inner():\n            return __class__\n        return inner')).toEqual([])
  })

  it('reports __class__ outside a class', () => {
    expect(unbound('def f():\n    return __class__')).toEqual(['__class__'])
  })

  it('sees the implicit class-body names in the class body only', () => {
    expect(unbound('class C:\n    where = __module__, __qualname__, __firstlineno__\n    def m(self):\n        return __qualname__')).toEqual(['__qualname__'])
  })
})

describe('analyzeScriptScopes - comprehensions', () => {
  it('binds the targets inside the comprehension', () => {
    expect(unbound('nums = [1]\n[n * 2 for n in nums]')).toEqual([])
  })

  it('keeps the targets out of the enclosing scope', () => {
    expect(unbound('[n for n in range(3)]\nn')).toEqual(['n'])
  })

  it('binds every for clause and reads later iterables inside', () => {
    expect(unbound('xs = [[1]]\n[b for a in xs if a for b in a if b > limit]')).toEqual(['limit'])
  })

  it('binds dictionary, set and generator comprehension targets', () => {
    expect(unbound('pairs = []\n{k: v for k, v in pairs}\n{s for s in pairs}\nsum(g for g in pairs)')).toEqual([])
  })

  it('reads the first iterable in the class body', () => {
    expect(unbound('class C:\n    xs = [1]\n    ys = [x for x in xs]')).toEqual([])
  })

  it('does not see a class-body name after the first iterable', () => {
    expect(unbound('class C:\n    xs = [1]\n    lim = 2\n    ys = [x for x in xs if x < lim]')).toEqual(['lim'])
  })

  it('sees function locals', () => {
    expect(unbound('def f(xs):\n    lim = 1\n    return [x for x in xs if x > lim]')).toEqual([])
  })
})

describe('analyzeScriptScopes - statement targets', () => {
  it('binds a for target', () => {
    expect(unbound('for i, (j, k) in []:\n    pass\nelse:\n    pass\nprint(i, j, k)')).toEqual([])
  })

  it('binds with targets and reads the context expressions', () => {
    expect(unbound('with open(p) as fh, lock as (a, b):\n    pass\nprint(fh, a, b)')).toEqual(['p', 'lock'])
  })

  it('binds a with target that is an attribute or subscript by reading its parts', () => {
    expect(unbound('with ctx as holder.slot:\n    pass')).toEqual(['ctx', 'holder'])
  })

  it('binds an except-as name and reads the exception types', () => {
    expect(unbound('try:\n    pass\nexcept (ValueError, Missing) as err:\n    print(err)')).toEqual(['Missing'])
  })

  it('binds an except-star name', () => {
    expect(unbound('try:\n    pass\nexcept* OSError as group:\n    print(group)')).toEqual([])
  })

  it('binds a walrus target in the scope it sits in', () => {
    expect(unbound('if (n := 10) > 5:\n    print(n)')).toEqual([])
  })

  it('binds a walrus target inside a comprehension in the enclosing scope', () => {
    expect(unbound('[last := v for v in range(3)]\nprint(last)')).toEqual([])
  })

  it('keeps a walrus target inside a function out of the module', () => {
    expect(unbound('def f():\n    (m := 1)\nm')).toEqual(['m'])
  })
})

describe('analyzeScriptScopes - match statements', () => {
  it('binds capture, star, double-star, keyword value and as patterns', () => {
    expect(
      unbound(
        'cmd = None\nclass Point:\n    pass\nmatch cmd:\n    case [x, *rest]:\n        print(x, rest)\n    case {"k": v, **others}:\n        print(v, others)\n    case Point(x=px) as whole:\n        print(px, whole)\n    case other:\n        print(other)\n    case _:\n        pass',
      ),
    ).toEqual([])
  })

  it('reads the subject, class patterns, value patterns and guards', () => {
    expect(
      unbound('match cmd:\n    case Point(x=0):\n        pass\n    case Color.RED | str():\n        pass\n    case [y] if y > limit:\n        pass'),
    ).toEqual(['cmd', 'Point', 'Color', 'limit'])
  })

  it('reads a value pattern used as a mapping key', () => {
    expect(unbound('match {}:\n    case {Keys.NAME: value}:\n        print(value)')).toEqual(['Keys'])
  })
})

describe('analyzeScriptScopes - NameError guards', () => {
  it('does not report a read inside a try whose handler catches NameError', () => {
    expect(unbound('try:\n    unicode\nexcept NameError:\n    pass')).toEqual([])
    expect(unbound('try:\n    reduce\nexcept (ImportError, NameError):\n    pass')).toEqual([])
  })

  it('reports the read when no handler catches NameError', () => {
    expect(unbound('try:\n    ghost\nexcept ValueError:\n    pass\nfinally:\n    pass')).toEqual(['ghost'])
  })

  it('reports a read in the handler itself', () => {
    expect(unbound('try:\n    pass\nexcept NameError:\n    ghost')).toEqual(['ghost'])
  })
})

describe('analyzeScriptScopes - flags and names', () => {
  it('flags dynamic namespace access', () => {
    expect(scopesOf('globals()["x"] = 1').dynamicNamespace).toBe(true)
    expect(scopesOf('exec("x = 1")').dynamicNamespace).toBe(true)
    expect(scopesOf('import builtins').dynamicNamespace).toBe(true)
    expect(scopesOf('import builtins as b').dynamicNamespace).toBe(true)
    expect(scopesOf('from builtins import print as p').dynamicNamespace).toBe(true)
    expect(scopesOf('v = vars()').dynamicNamespace).toBe(true)
  })

  it('flags no dynamic namespace access for an ordinary script', () => {
    expect(scopesOf('import os\nimport json as j\nvalues = [len(x) for x in os.listdir(".")]').dynamicNamespace).toBe(false)
  })

  it('collects every name the script binds, in any scope', () => {
    const scopes = scopesOf('a = 1\ndef f(b):\n    c = 2\n    return [d for d in b]\nclass K:\n    e = 3')

    expect([...scopes.boundNames].sort()).toEqual(['K', 'a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('lists the names visible at a read, innermost scope first', () => {
    const scopes = scopesOf('top = 1\nclass K:\n    hidden = 2\n    def m(self, arg):\n        local = 3\n        return missing')
    const read = scopes.reads.find((entry) => entry.name === 'missing')

    expect(read).toBeDefined()
    expect(scopes.visibleNames(read!)).toEqual(['self', 'arg', 'local', 'top', 'K'])
  })
})
