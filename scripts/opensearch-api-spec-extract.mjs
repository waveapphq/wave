#!/usr/bin/env node
/**
 * Builds the Query DSL and aggregation vocabulary the OpenSearch editor checks against (REQ-3.3.2.5, OS-12).
 *
 * Reads a checkout of opensearch-project/opensearch-api-specification and writes a trimmed extract:
 * the query types of `QueryContainer`, the aggregation types of `AggregationContainer`, each with its
 * description and its parameters (value kind, enum values, description, version added), and the
 * field-keyed query types.
 *
 * Usage:
 *   node scripts/opensearch-api-spec-extract.mjs --spec-dir <checkout> --commit <40-hex sha>
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const yaml = require('js-yaml')

const REPOSITORY = 'opensearch-project/opensearch-api-specification'
const OUTPUT = fileURLToPath(
  new URL('../backend/wavecore/api/services/opensearch_tools/api-spec-extract.json', import.meta.url),
)
const QUERY_FILE = '_common.query_dsl.yaml'
const AGGREGATION_FILE = '_common.aggregations.yaml'
const COMBINERS = ['allOf', 'oneOf', 'anyOf']

function fail(message) {
  console.error(`opensearch-api-spec-extract: ${message}`)
  process.exit(1)
}

const { values: args } = parseArgs({
  options: { 'spec-dir': { type: 'string' }, commit: { type: 'string' } },
})
if (!args['spec-dir'] || !args.commit) {
  fail('usage: --spec-dir <checkout of the specification> --commit <40-hex commit sha>')
}
if (!/^[0-9a-f]{40}$/.test(args.commit)) fail(`--commit must be a 40-hex commit sha, got ${args.commit}`)

const specDir = path.resolve(args['spec-dir'])
const schemasDir = path.join(specDir, 'spec', 'schemas')
if (!existsSync(path.join(schemasDir, QUERY_FILE))) fail(`no spec/schemas/${QUERY_FILE} under ${specDir}`)
if (existsSync(path.join(specDir, '.git'))) {
  const head = execFileSync('git', ['-C', specDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== args.commit) fail(`the checkout is at ${head}, not at --commit ${args.commit}`)
}

const documents = new Map()

function schemasOf(file) {
  if (!documents.has(file)) {
    const text = readFileSync(path.join(schemasDir, file), 'utf8')
    documents.set(file, yaml.load(text).components.schemas)
  }
  return documents.get(file)
}

/** A `$ref` as the located schema it names; `file` is where the referring schema lives. */
function resolve(ref, file) {
  const [target, pointer] = ref.split('#')
  const targetFile = target || file
  const name = pointer.replace('/components/schemas/', '')
  const schema = schemasOf(targetFile)[name]
  if (schema === undefined) fail(`unresolved $ref ${ref} in ${file}`)
  return { schema, file: targetFile, key: `${targetFile}#${name}` }
}

function isSchema(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Follow a `$ref` chain; the first description and version met on the way are kept. */
function followed(located) {
  let current = located
  let description = located.schema.description
  let version = located.schema['x-version-added']
  const seen = new Set()
  while (isSchema(current.schema) && current.schema.$ref && !seen.has(current.schema.$ref)) {
    seen.add(current.schema.$ref)
    current = resolve(current.schema.$ref, current.file)
    description ??= current.schema.description
    version ??= current.schema['x-version-added']
  }
  return { ...current, description, version }
}

const KIND_OF_TYPE = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
  null: 'null',
}

function valueKind(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return KIND_OF_TYPE[typeof value] ?? 'any'
}

/** Every kind a value of the schema can take. */
function kinds(located, seen = new Set()) {
  const { schema, file } = located
  if (!isSchema(schema)) return new Set(['any'])
  if (schema.$ref) {
    const target = resolve(schema.$ref, file)
    if (seen.has(target.key)) return new Set(['any'])
    return kinds(target, new Set(seen).add(target.key))
  }
  if (schema.type !== undefined) {
    return new Set([].concat(schema.type).map((type) => KIND_OF_TYPE[type] ?? 'any'))
  }
  for (const combiner of ['oneOf', 'anyOf']) {
    if (schema[combiner]) {
      return new Set(schema[combiner].flatMap((branch) => [...kinds({ schema: branch, file }, seen)]))
    }
  }
  if (schema.allOf) {
    const found = schema.allOf.flatMap((branch) => [...kinds({ schema: branch, file }, seen)])
    const defined = found.filter((kind) => kind !== 'any')
    return new Set(defined.length ? defined : ['any'])
  }
  if (schema.const !== undefined) return new Set([valueKind(schema.const)])
  if (schema.enum) return new Set(schema.enum.map(valueKind))
  if (schema.properties || schema.additionalProperties || schema.propertyNames) return new Set(['object'])
  return new Set(['any'])
}

/** One extract kind: `null` alternatives are dropped, and several kinds make `any`. */
function kindOf(located) {
  const found = [...kinds(located)].filter((kind) => kind !== 'null')
  return found.length === 1 ? found[0] : 'any'
}

/** The string values the schema is limited to, in spec order; empty when it is not limited. */
function enumOf(located, seen = new Set()) {
  const { schema, file } = located
  if (!isSchema(schema)) return []
  if (schema.$ref) {
    const target = resolve(schema.$ref, file)
    return seen.has(target.key) ? [] : enumOf(target, new Set(seen).add(target.key))
  }
  if (schema.enum) return schema.enum.every((value) => typeof value === 'string') ? schema.enum : []
  if (typeof schema.const === 'string') return [schema.const]
  for (const combiner of ['oneOf', 'anyOf']) {
    if (schema[combiner]) {
      const branches = schema[combiner].map((branch) => enumOf({ schema: branch, file }, seen))
      return branches.every((values) => values.length) ? [...new Set(branches.flat())] : []
    }
  }
  return []
}

function oneLine(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
}

function paramOf(located, inherited) {
  const target = followed(located)
  const param = { kind: kindOf(located) }
  const values = enumOf(located)
  const description = oneLine(target.description)
  const version = target.version ?? inherited
  if (values.length) param.enum = values
  if (description) param.description = description
  if (version !== undefined) param.version_added = String(version)
  return param
}

/** Two sightings of one parameter (from `oneOf` branches) as one: differing kinds make `any`. */
function merged(first, second) {
  const param = { kind: first.kind === second.kind ? first.kind : 'any' }
  const values = first.enum && second.enum ? [...new Set([...first.enum, ...second.enum])] : []
  const description = first.description || second.description
  const version = first.version_added ?? second.version_added
  if (values.length && param.kind === 'string') param.enum = values
  if (description) param.description = description
  if (version !== undefined) param.version_added = version
  return param
}

/** Every property the schema's object can hold, through `$ref`, `allOf`, `oneOf` and `anyOf`. */
function collect(located, params = {}, inherited = undefined, seen = new Set()) {
  const { schema, file } = located
  if (!isSchema(schema)) return params
  const version = schema['x-version-added'] ?? inherited
  if (schema.$ref) {
    const target = resolve(schema.$ref, file)
    if (!seen.has(target.key)) collect(target, params, version, new Set(seen).add(target.key))
  }
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const param = paramOf({ schema: property, file }, version)
    params[name] = name in params ? merged(params[name], param) : param
  }
  for (const combiner of COMBINERS) {
    for (const branch of schema[combiner] ?? []) collect({ schema: branch, file }, params, version, seen)
  }
  return params
}

/** Every `required` name the schema's object declares, through `$ref` and `allOf`. */
function required(located, names = new Set(), seen = new Set()) {
  const { schema, file } = located
  if (!isSchema(schema)) return names
  for (const name of schema.required ?? []) names.add(name)
  if (schema.$ref) {
    const target = resolve(schema.$ref, file)
    if (!seen.has(target.key)) required(target, names, new Set(seen).add(target.key))
  }
  for (const branch of schema.allOf ?? []) required({ schema: branch, file }, names, seen)
  return names
}

/** The property schema of `name` in the branch, through `$ref` and `allOf`. */
function propertyIn(located, name, seen = new Set()) {
  const { schema, file } = located
  if (!isSchema(schema)) return undefined
  if (schema.properties?.[name] !== undefined) return { schema: schema.properties[name], file }
  if (schema.$ref) {
    const target = resolve(schema.$ref, file)
    if (!seen.has(target.key)) {
      const found = propertyIn(target, name, new Set(seen).add(target.key))
      if (found) return found
    }
  }
  for (const branch of schema.allOf ?? []) {
    const found = propertyIn({ schema: branch, file }, name, seen)
    if (found) return found
  }
  return undefined
}

/** A query type keyed by field name: the type's own object maps each field to its options. */
function fieldKeyed(located) {
  const { schema } = followed(located)
  return isSchema(schema) && schema.propertyNames !== undefined && isSchema(schema.additionalProperties)
}

/** A type's entry: the first description met on its `$ref` chain, when there is one, and its parameters. */
function typeEntry(located, params) {
  const description = oneLine(followed(located).description)
  return description ? { description, params } : { params }
}

function queries() {
  const container = schemasOf(QUERY_FILE).QueryContainer
  const types = {}
  const keyed = []
  for (const [type, property] of Object.entries(container.properties)) {
    const located = { schema: property, file: QUERY_FILE }
    if (fieldKeyed(located)) {
      const target = followed(located)
      keyed.push(type)
      types[type] = typeEntry(
        located,
        collect({ schema: target.schema.additionalProperties, file: target.file }),
      )
    } else {
      types[type] = typeEntry(located, collect(located))
    }
  }
  return { types, keyed }
}

function aggregations() {
  const container = schemasOf(AGGREGATION_FILE).AggregationContainer
  const holder = container.allOf.find((branch) => branch.oneOf)
  const types = {}
  for (const branch of holder.oneOf) {
    const located = { schema: branch, file: AGGREGATION_FILE }
    const names = [...required(located)]
    if (names.length !== 1) fail(`an aggregation branch requires ${names.length} properties: ${names}`)
    const [type] = names
    const property = propertyIn(located, type)
    types[type] = typeEntry(property, collect(property))
  }
  return types
}

function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (!isSchema(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, key === 'enum' ? value[key] : sortedKeys(value[key])]),
  )
}

const { types: queryTypes, keyed } = queries()
const extract = sortedKeys({
  source: {
    repository: REPOSITORY,
    commit: args.commit,
    generated: new Date().toISOString().slice(0, 10),
  },
  field_keyed_queries: [...keyed].sort(),
  queries: queryTypes,
  aggregations: aggregations(),
})
writeFileSync(OUTPUT, `${JSON.stringify(extract, null, 2)}\n`)
console.log(
  `Wrote ${path.relative(process.cwd(), OUTPUT)}: ${Object.keys(extract.queries).length} query types ` +
    `(${extract.field_keyed_queries.length} field-keyed), ` +
    `${Object.keys(extract.aggregations).length} aggregation types, commit ${args.commit}`,
)
