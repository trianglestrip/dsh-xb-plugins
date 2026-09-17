#!/usr/bin/env node
/**
 * Run every Desktop deployment check in one pass and report one verdict.
 *
 * A Desktop deployment has no `--dump-config`, so its evidence is spread across
 * three places: the composition the app builds, the prompt that composition
 * renders, and the log a real session recorded — plus, for the interface, the
 * window itself. Each check has its own script because each is useful alone; this
 * runs them in order, keeps going after a failure, and exits non-zero if any
 * required check failed.
 *
 * Session and interface checks skip when their precondition is absent (no session
 * yet, app not running with a debug port). `--require-all` turns those skips into
 * failures, which is what a release gate wants.
 *
 * Usage:
 *   node scripts/desktop-verify.mjs [--runtime <dir>] [--port 9222]
 *                                   [--expect-title BCPD AI] [--require-all]
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {string} message */
function die(message) {
  console.error(`desktop verify: ${message}`)
  process.exit(1)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { runtime: undefined, port: 9222, expectTitle: undefined, requireAll: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--require-all') { options.requireAll = true; continue }
    if (arg === '--runtime') { options.runtime = argv[++i]; continue }
    if (arg === '--port') { options.port = argv[++i]; continue }
    if (arg === '--expect-title') { options.expectTitle = argv[++i]; continue }
    die(`unknown option ${arg}`)
  }
  return options
}

const args = parseArgs(process.argv.slice(2))
const runtimeArgs = args.runtime === undefined ? [] : ['--runtime', args.runtime]

const checks = [
  {
    name: 'composition',
    script: 'scripts/desktop-composition.mjs',
    args: [...runtimeArgs],
    required: true,
  },
  {
    name: 'prompt',
    script: 'scripts/desktop-prompt.mjs',
    args: [...runtimeArgs],
    required: true,
  },
  {
    name: 'session',
    script: 'scripts/desktop-session-prompt.mjs',
    args: ['--allow-missing'],
    required: true,
  },
  {
    name: 'ui',
    script: 'scripts/desktop-ui.mjs',
    args: ['--port', String(args.port), ...(args.expectTitle === undefined ? [] : ['--expect-title', args.expectTitle])],
    required: args.requireAll,
  },
]

const results = []
for (const check of checks) {
  const result = spawnSync(process.execPath, [join(repoRoot, check.script), ...check.args], { encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const lines = output.split('\n')
  const skipped = lines.some((line) => line.startsWith('skip'))
  results.push({ name: check.name, code: result.status ?? 1, skipped, required: check.required || args.requireAll })
  console.log(`\n===== ${check.name} =====`)
  console.log(output)
}

console.log('\n===== summary =====')
let failed = 0
for (const result of results) {
  const verdict = result.code === 0 ? (result.skipped ? 'skip' : 'ok') : 'FAIL'
  if (verdict === 'FAIL') failed += 1
  console.log(`${verdict.padEnd(5)} ${result.name}${result.required ? '' : ' (optional)'}`)
}
if (failed > 0) {
  console.error(`\n✗ ${String(failed)} 项检查失败`)
  process.exit(1)
}
console.log('\n✓ 所有必需检查通过')
