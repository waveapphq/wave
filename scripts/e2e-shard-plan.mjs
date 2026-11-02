#!/usr/bin/env node
// Duration-weighted E2E shard planner: packs spec files into N bins (greedy LPT) for run-e2e-shard.sh.
// The bin that gets the empty-db-dark item owns that project and runs it once per CI run.
// Usage:
//   # one shard's slice (container self-plan):
//   node e2e-shard-plan.mjs --shards N --shard-index K --out-dir DIR --weights F --e2e-dir D
//   # all shards + balance summary (host preview):
//   node e2e-shard-plan.mjs --shards N --artifacts DIR --weights F --e2e-dir D

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const EMPTY_DB_PROJECT = 'empty-db-dark'
// Shard 1 type-checks tests/e2e before its tests start (run-e2e-shard.sh).
const SHARD1_TYPECHECK_SECONDS = 12
// A profiled weight of 0 is a real, tiny file (all skipped or sub-second), not a missing one.
const ZERO_WEIGHT_SECONDS = 0.1

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def
}

const nShards = Number(arg('shards', '4'))
const artifactsRoot = arg('artifacts')
const weightsPath = arg('weights')
const e2eDir = arg('e2e-dir')
const shardIndexArg = arg('shard-index')
const outDir = arg('out-dir')
const singleShard = shardIndexArg !== undefined

if (!Number.isInteger(nShards) || nShards < 1 || !weightsPath || !e2eDir) {
  console.error('e2e-shard-plan: --shards (>=1), --weights and --e2e-dir are required')
  process.exit(1)
}
if (singleShard) {
  const k = Number(shardIndexArg)
  if (!Number.isInteger(k) || k < 1 || k > nShards || !outDir) {
    console.error('e2e-shard-plan: --shard-index must be 1..N and paired with --out-dir')
    process.exit(1)
  }
} else if (!artifactsRoot) {
  console.error('e2e-shard-plan: provide --artifacts (all shards) or --shard-index + --out-dir')
  process.exit(1)
}

function playwrightCommand() {
  const local = path.resolve(e2eDir, 'node_modules', '.bin', 'playwright')
  return existsSync(local) ? [local, []] : ['npx', ['playwright']]
}

// File -> test count, in total and per project (--list runs no globalSetup and needs no backend).
function listTests(playwrightArgs) {
  const [command, prefix] = playwrightCommand()
  const out = execFileSync(command, [...prefix, 'test', ...playwrightArgs, '--list', '--reporter=json'], {
    cwd: e2eDir,
    env: { ...process.env, WAVE_E2E_EXTERNAL_SERVICES: '1', CI: '1' },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  const report = JSON.parse(out)
  const byFile = new Map()
  const walk = (suite) => {
    for (const spec of suite.specs || []) {
      const entry = byFile.get(spec.file) || { count: 0, projects: new Map() }
      for (const test of spec.tests || []) {
        entry.count++
        const project = test.projectName || ''
        entry.projects.set(project, (entry.projects.get(project) || 0) + 1)
      }
      byFile.set(spec.file, entry)
    }
    for (const child of suite.suites || []) walk(child)
  }
  for (const suite of report.suites || []) walk(suite)
  return byFile
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Seconds per test for one phase: median over its profiled files of weight / test count.
function secondsPerTest(list, table) {
  const ratios = []
  for (const [file, entry] of list) {
    const weight = table[file]
    if (typeof weight === 'number' && weight > 0 && entry.count > 0) ratios.push(weight / entry.count)
  }
  return ratios.length ? median(ratios) : 1
}

// A file missing from the profile weighs its test count x the phase's seconds per test.
function makePhase(list, table) {
  const perTest = secondsPerTest(list, table)
  const missing = []
  const weightOf = (file) => {
    const weight = table[file]
    if (typeof weight === 'number' && weight >= 0) return Math.max(weight, ZERO_WEIGHT_SECONDS)
    missing.push(file)
    return list.get(file).count * perTest
  }
  return { perTest, missing, weightOf }
}

const weights = JSON.parse(readFileSync(weightsPath, 'utf8'))

const functionalList = listTests(['--config=playwright.functional.config.ts'])
const visualList = listTests(['--project=empty-db-dark', '--project=no-data-dark', '--project=fixture-dark'])

const fn = makePhase(functionalList, weights.functional || {})
const vis = makePhase(visualList, weights.visual || {})

const items = []
for (const file of functionalList.keys()) {
  items.push({ key: file, file, phase: 'functional', weight: fn.weightOf(file) })
}

// A file with tests in empty-db-dark and in another project splits its weight by test count.
const emptyDbFiles = []
let emptyDbWeight = 0
for (const [file, entry] of visualList) {
  const fileWeight = vis.weightOf(file)
  const emptyDbTests = entry.projects.get(EMPTY_DB_PROJECT) || 0
  if (emptyDbTests) {
    emptyDbFiles.push(file)
    emptyDbWeight += (fileWeight * emptyDbTests) / entry.count
  }
  if (entry.count > emptyDbTests) {
    const weight = (fileWeight * (entry.count - emptyDbTests)) / entry.count
    items.push({ key: file, file, phase: 'visual', weight })
  }
}
if (emptyDbFiles.length) {
  items.push({ key: EMPTY_DB_PROJECT, file: null, phase: 'emptyDb', weight: emptyDbWeight })
}

const bins = Array.from({ length: nShards }, () => ({
  functional: [],
  visual: [],
  emptyDb: false,
  preload: 0,
  funcW: 0,
  visW: 0,
  total: 0,
}))
bins[0].preload = nShards > 1 ? SHARD1_TYPECHECK_SECONDS : 0
bins[0].total = bins[0].preload

// Greedy LPT: heaviest first, each onto the currently-lightest bin (lowest index on a tie).
items.sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
for (const item of items) {
  let best = 0
  for (let i = 1; i < nShards; i++) {
    if (bins[i].total < bins[best].total) best = i
  }
  const bin = bins[best]
  bin.total += item.weight
  if (item.phase === 'functional') {
    bin.functional.push(item.file)
    bin.funcW += item.weight
  } else if (item.phase === 'visual') {
    bin.visual.push(item.file)
    bin.visW += item.weight
  } else {
    bin.emptyDb = true
    bin.visW += item.weight
  }
}

const fmt = (n) => `${Math.round(n)}s`

function writeBin(dir, bin) {
  mkdirSync(dir, { recursive: true })
  const join = (list) => (list.length ? list.join('\n') + '\n' : '')
  writeFileSync(path.join(dir, 'plan-functional.txt'), join(bin.functional))
  writeFileSync(path.join(dir, 'plan-visual.txt'), join(bin.visual))
  writeFileSync(path.join(dir, 'plan-empty-db.txt'), join(bin.emptyDb ? emptyDbFiles : []))
}

const nMissing = fn.missing.length + vis.missing.length
const missingNote =
  `${nMissing} new file(s) weighted by test count` +
  ` (functional ${fn.perTest.toFixed(2)}s, visual ${vis.perTest.toFixed(2)}s per test)`

if (singleShard) {
  const k = Number(shardIndexArg)
  const b = bins[k - 1]
  writeBin(outDir, b)
  console.log(
    `shard ${k}/${nShards} plan: ${b.functional.length} functional + ${b.visual.length} visual files` +
      `${b.emptyDb ? ` + ${EMPTY_DB_PROJECT} (${emptyDbFiles.length} files, once per run)` : ''}` +
      ` (~${fmt(b.total)})${nMissing ? `; ${missingNote}` : ''}`,
  )
} else {
  for (let i = 0; i < nShards; i++) writeBin(path.join(artifactsRoot, `shard-${i + 1}`), bins[i])

  const totals = bins.map((b) => b.total)
  const max = Math.max(...totals)
  const min = Math.min(...totals)
  const ideal = totals.reduce((a, b) => a + b, 0) / nShards
  const owner = bins.findIndex((b) => b.emptyDb) + 1
  console.log(
    `Shard plan: ${nShards} bins, ${functionalList.size} functional + ${items.filter((i) => i.phase === 'visual').length}` +
      ` visual files; ${EMPTY_DB_PROJECT} (${emptyDbFiles.length} files, ${fmt(emptyDbWeight)}) runs once,` +
      ` in shard ${owner || '-'}`,
  )
  for (let i = 0; i < nShards; i++) {
    const b = bins[i]
    console.log(
      `  shard ${i + 1}: total ${fmt(b.total).padStart(6)}` +
        ` (func ${fmt(b.funcW).padStart(5)} / ${String(b.functional.length).padStart(3)}f,` +
        ` visual ${fmt(b.visW).padStart(5)} / ${String(b.visual.length).padStart(3)}f` +
        `${b.emptyDb ? ` + ${EMPTY_DB_PROJECT}` : ''}${b.preload ? `, type-check ${fmt(b.preload)}` : ''})`,
    )
  }
  console.log(
    `  predicted balance: max ${fmt(max)} / ideal ${fmt(ideal)} / min ${fmt(min)}` +
      `  (spread ${fmt(max - min)}, ${((max / ideal - 1) * 100).toFixed(1)}% over ideal)`,
  )
  if (nMissing) {
    console.log(`  note: ${missingNote} - re-run generate-shard-weights.sh to refresh`)
  }
}
