#!/usr/bin/env node
// Harvest per-file E2E wall time (hooks included) from a ci-playwright-local.sh run into shard-weights.json.
//
// Usage: node e2e-shard-weights.mjs --artifacts DIR --out FILE [--stamp ISO] [--previous FILE]

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def
}

const artifactsRoot = arg('artifacts')
const outPath = arg('out')
const stamp = arg('stamp', '')
// The profile being replaced; it weighs a file whose tests all failed in this run.
const previousPath = arg('previous', outPath)

if (!artifactsRoot || !outPath) {
  console.error('e2e-shard-weights: --artifacts and --out are required')
  process.exit(1)
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// One Playwright JSON report -> { end, results in run order: { file, start, duration, failed, passed } }.
function readResults(report) {
  const results = []
  const walk = (suite) => {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        for (const result of test.results || []) {
          const start = Date.parse(result.startTime)
          // Playwright's own rule: test.fail() tests that fail are green.
          const ran = result.status !== 'skipped'
          results.push({
            file: spec.file,
            start: Number.isNaN(start) ? null : start,
            duration: result.duration || 0,
            failed: ran && result.status !== test.expectedStatus,
            passed: ran && result.status === test.expectedStatus,
          })
        }
      }
    }
    for (const child of suite.suites || []) walk(child)
  }
  for (const suite of report.suites || []) walk(suite)
  const end = Date.parse(report.stats?.startTime) + (report.stats?.duration ?? Number.NaN)
  return { end: Number.isNaN(end) ? null : end, results: results.sort((a, b) => (a.start ?? 0) - (b.start ?? 0)) }
}

// phase -> [{ end, results } of one report]
const reports = { functional: [], visual: [] }

const shardDirs = readdirSync(artifactsRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^shard-\d+$/.test(d.name))
  .map((d) => path.join(artifactsRoot, d.name))

for (const dir of shardDirs) {
  for (const phase of ['functional', 'visual']) {
    const reportPath = path.join(dir, `${phase}-report.json`)
    if (existsSync(reportPath)) reports[phase].push(readResults(JSON.parse(readFileSync(reportPath, 'utf8'))))
  }
}

if (reports.functional.length + reports.visual.length === 0) {
  console.error(`e2e-shard-weights: no *-report.json found under ${artifactsRoot}`)
  process.exit(1)
}

const previous = previousPath && existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) : {}

// Per report: each test plus the gap after it (its beforeAll / afterAll), not after a failure; a failed test = its file's median pass.
function reducePhase(phaseReports, previousTable) {
  const passing = new Map()
  const allPassing = []
  for (const { results } of phaseReports) {
    for (const r of results) {
      if (!r.passed) continue
      if (!passing.has(r.file)) passing.set(r.file, [])
      passing.get(r.file).push(r.duration)
      allPassing.push(r.duration)
    }
  }
  const phaseMedian = median(allPassing)
  const fileMedian = new Map([...passing].map(([file, durations]) => [file, median(durations)]))

  const samples = new Map()
  const allFailed = new Set()
  for (const { end, results } of phaseReports) {
    const perFile = new Map()
    const add = (file, ms) => perFile.set(file, (perFile.get(file) || 0) + ms)
    let lastEnd = null
    let lastFailed = false
    let prevFile = null
    for (const r of results) {
      let ms = r.duration
      if (r.failed) {
        if (fileMedian.has(r.file)) ms = fileMedian.get(r.file)
        else {
          ms = phaseMedian
          allFailed.add(r.file)
        }
      }
      if (r.start !== null) {
        if (lastEnd !== null && !lastFailed) add(prevFile, Math.max(0, r.start - lastEnd))
        lastEnd = Math.max(lastEnd ?? 0, r.start + r.duration)
        lastFailed = r.failed
        prevFile = r.file
      }
      add(r.file, ms)
    }
    if (end !== null && lastEnd !== null && !lastFailed) add(prevFile, Math.max(0, end - lastEnd))
    for (const [file, ms] of perFile) {
      if (!samples.has(file)) samples.set(file, [])
      samples.get(file).push(ms / 1000)
    }
  }

  const table = {}
  const fromPrevious = []
  for (const file of [...samples.keys()].sort()) {
    const vals = samples.get(file)
    // Averaged over shards: the --shard fallback runs empty-db-dark in every shard.
    let seconds = vals.reduce((a, b) => a + b, 0) / vals.length
    const old = previousTable[file]
    if (allFailed.has(file) && typeof old === 'number' && old > 0) {
      seconds = old
      fromPrevious.push(file)
    }
    table[file] = Math.round(seconds * 10) / 10
  }
  return { table, allFailed: [...allFailed], fromPrevious }
}

const fn = reducePhase(reports.functional, previous.functional || {})
const vis = reducePhase(reports.visual, previous.visual || {})

const out = {
  _note: 'Per-file E2E wall time (seconds, hooks included) for duration-balanced sharding. Regenerate with scripts/generate-shard-weights.sh.',
  _generatedAt: stamp || undefined,
  functional: fn.table,
  visual: vis.table,
}

writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')

const sum = (t) => Object.values(t).reduce((a, b) => a + b, 0)
console.log(
  `Wrote ${outPath}: ` +
    `${Object.keys(out.functional).length} functional (${Math.round(sum(out.functional))}s), ` +
    `${Object.keys(out.visual).length} visual (${Math.round(sum(out.visual))}s)`,
)
for (const [phase, r] of [['functional', fn], ['visual', vis]]) {
  for (const file of r.allFailed) {
    const how = r.fromPrevious.includes(file) ? 'kept its previous weight' : 'weighed by test count'
    console.log(`  note: every ${phase} test of ${file} failed - ${how}`)
  }
}
