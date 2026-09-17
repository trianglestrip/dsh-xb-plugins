#!/usr/bin/env node
/**
 * Recompute what Desktop actually composes, using the Desktop runtime's own
 * `loadProfileDirectory` + `composeEntries`, and assert what this repo's patch
 * is supposed to contribute.
 *
 * Desktop has no `--dump-config` (the CLI refuses its profile), so without a
 * script the only evidence a profile patch took effect is the app's behaviour.
 * This is that evidence, minus Electron: it reads the real profile, applies the
 * real bundle layers and the real desktop composition patch, and reports the
 * rows.
 *
 * Usage:
 *   node scripts/desktop-composition.mjs [--home <dir>] [--runtime <dir>] [--json]
 */
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { deriveDesktopRuntime, resolveDshHome } from './shared/desktop-runtime.mjs'
import { composeDesktopRows, modulePathOf } from './shared/desktop-composition.mjs'

/** @param {string} message */
function die(message) {
  console.error(`desktop composition: ${message}`)
  process.exit(1)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { home: undefined, runtime: undefined, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--home') { options.home = argv[++i]; continue }
    if (arg === '--runtime') { options.runtime = argv[++i]; continue }
    die(`unknown option ${arg}`)
  }
  return options
}

const args = parseArgs(process.argv.slice(2))
const dshHome = resolveDshHome(args.home)
const runtime = deriveDesktopRuntime(dshHome, args.runtime)
if (runtime === undefined) die('cannot derive the Desktop runtime; pass --runtime <dir>')

const { dshDir, projectDir, profile, rows } = await composeDesktopRows(dshHome, runtime)

if (args.json) {
  console.log(JSON.stringify(rows, undefined, 2))
  process.exit(0)
}

const byId = new Map(rows.filter((row) => typeof row.id === 'string').map((row) => [row.id, row]))
const persona = byId.get('xiaobo-persona')
const systemPrompt = byId.get('system-prompt')
const mcp = rows.filter((row) => row.name === '@deepseek-ai/dsh-mcp-client').map((row) => row.id)

console.log(`profile          : ${projectDir}`)
console.log(`bundle layers    : ${profile.layers.map((layer) => layer.packageName).join(', ')}`)
console.log(`composed rows    : ${rows.length}`)
console.log(`system-prompt    : ${JSON.stringify(systemPrompt?.config)}`)
console.log(`xiaobo-persona   : ${persona === undefined ? '(absent)' : persona.name}`)
console.log(`  its config     : ${JSON.stringify(persona?.config ?? {})}`)
console.log(`mcp-client rows  : ${mcp.join(', ') || '(none)'}`)

const problems = []
if (systemPrompt?.config?.includeHarnessIdentity !== false) {
  problems.push('the profile patch did not set system-prompt.includeHarnessIdentity: false (harness opener will precede the Xiaobo identity)')
}
if (persona === undefined) {
  problems.push('no xiaobo-persona row: run `pnpm run dev:desktop-snippet -- --write`, or install a build that ships the bundle')
} else if (typeof persona.name !== 'string') {
  problems.push(`xiaobo-persona names ${String(persona.name)}, which is not a module specifier`)
} else {
  // A profile-patch row names a path; an in-box bundle names a package the
  // runtime ships. Both are valid, so resolve either and require the entry to exist.
  const path = modulePathOf(persona.name, [dshDir, projectDir])
  if (!existsSync(path)) {
    problems.push(`xiaobo-persona resolves to ${path}, which does not exist (run 'pnpm run build' for a path row, or install a build that ships the bundle)`)
  } else {
    // The row must still be loadable by the runtime's own node, i.e. it must
    // import cleanly with the plugin's own dependency copies.
    const plugin = await import(pathToFileURL(path).href)
    if (typeof (plugin.default ?? plugin).apply !== 'function') problems.push(`${path} exports no apply()`)
  }
}
if (problems.length > 0) {
  console.error('')
  for (const problem of problems) console.error(`✗ ${problem}`)
  process.exit(1)
}
console.log('')
console.log('✓ the Desktop composition carries the Xiaobo patch')
console.log('  重启 Desktop 生效；会话若仍出现内置 harness 身份行，说明 profile patch 没被读到。')
console.log('  下一步：pnpm run dev:desktop-prompt（渲染该组合下真实会话的系统提示词）')
