#!/usr/bin/env node
/**
 * Load a local plugin into a Desktop profile without publishing it.
 *
 * Desktop's plugin window takes npm registry specs only (an exact version, or
 * the profile manifest refuses to boot), and its dependency graph requires every
 * managed plugin to resolve *inside* the profile — so a folder on your disk can
 * never be a managed plugin. What it can be is a row in the profile's own
 * `cordis.patch.yml`: the loader mounts what that file names, the graph checks
 * never see it, and `runtime` profile resolution still supplies the host packages
 * the plugin declares as peers.
 *
 * This script owns one marker-delimited block in that file, so repeated runs are
 * idempotent and everything else in the patch (MCP servers, deployment overrides)
 * is left byte-identical. Rows here are invisible to the plugin window, cannot be
 * toggled, and are removed by a profile reset — the trade for not being an
 * installable package.
 *
 * It deliberately parses only the block it writes, with no YAML implementation
 * and no dependency on the app's runtime state, so it works on any machine that
 * has a Desktop profile.
 *
 * Usage:
 *   node scripts/desktop-local-plugin.mjs add <dir|file> [--id <id>] [--entry <file>]
 *                                                     [--config <json>] [--home <dir>]
 *   node scripts/desktop-local-plugin.mjs list [--home <dir>]
 *   node scripts/desktop-local-plugin.mjs remove <id> [--home <dir>]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveDshHome } from './shared/desktop-runtime.mjs'

const MARK_BEGIN = '# >>> xiaobo local plugins'
const MARK_END = '# <<< xiaobo local plugins'

/** @param {string} message */
function die(message) {
  console.error(`local plugin: ${message}`)
  process.exit(1)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { command: undefined, target: undefined, id: undefined, entry: undefined, config: undefined, home: undefined }
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--id') { options.id = argv[++i]; continue }
    if (arg === '--entry') { options.entry = argv[++i]; continue }
    if (arg === '--config') { options.config = argv[++i]; continue }
    if (arg === '--home') { options.home = argv[++i]; continue }
    if (arg.startsWith('-')) die(`unknown option ${arg}`)
    rest.push(arg)
  }
  options.command = rest[0]
  options.target = rest[1]
  if (options.command === undefined) die('expected: add <dir|file> | list | remove <id>')
  if (rest.length > 2) die(`unexpected argument ${rest[2]}`)
  if (options.command !== 'list' && options.target === undefined) die(`${options.command} needs a target`)
  return options
}

const args = parseArgs(process.argv.slice(2))
const dshHome = resolveDshHome(args.home)
const profileDir = join(dshHome, 'profiles', 'desktop')
const patchPath = join(profileDir, 'cordis.patch.yml')

// ── the block this script owns ──────────────────────────────────────────────

/** Read the patch file, split into the part this script owns and the rest. */
function readPatch() {
  if (!existsSync(patchPath)) return { head: '', rows: [] }
  const text = readFileSync(patchPath, 'utf8')
  const begin = text.indexOf(MARK_BEGIN)
  if (begin === -1) return { head: `${text.trimEnd()}\n`, rows: [] }
  const end = text.indexOf(MARK_END, begin)
  if (end === -1) die(`${patchPath} has ${MARK_BEGIN} without ${MARK_END}; fix it by hand`)
  const afterEnd = text.indexOf('\n', end)
  return {
    head: `${text.slice(0, begin).trimEnd()}\n`,
    tail: afterEnd === -1 ? '' : text.slice(afterEnd + 1),
    rows: parseBlock(text.slice(begin, end)),
  }
}

/** Parse the rows this script wrote: `- id`, `name`, and an optional JSON config. */
function parseBlock(body) {
  const rows = []
  let current
  for (const line of body.split('\n')) {
    const id = /^\s*-\s*id:\s*(\S+)\s*$/.exec(line)
    if (id !== null) {
      current = { id: id[1] }
      rows.push(current)
      continue
    }
    const name = /^\s*name:\s*(.*)$/.exec(line)
    if (name !== null && current !== undefined && current.name === undefined) {
      current.name = name[1].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')
      continue
    }
    const config = /^\s*config:\s*(.*)$/.exec(line)
    if (config !== null && current !== undefined && config[1].trim() !== '') {
      try {
        current.config = JSON.parse(config[1])
      } catch {
        die(`cannot read the config on row ${String(current.id)}; rewrite it as JSON on one line`)
      }
    }
  }
  const broken = rows.filter((row) => typeof row.name !== 'string' || row.name === '')
  if (broken.length > 0) die(`${patchPath} has local rows without a name: ${broken.map((row) => row.id).join(', ')}`)
  return rows
}

/** Render the whole patch: untouched text plus the block this script owns. */
function renderPatch({ head, tail = '' }, rows) {
  const body = rows.length === 0 ? '' : [
    MARK_BEGIN,
    '- insert:',
    ...rows.flatMap((row) => [
      `    - id: ${row.id}`,
      `      name: '${String(row.name).replaceAll("'", "''")}'`,
      ...(row.config === undefined ? [] : [`      config: ${JSON.stringify(row.config)}`]),
    ]),
    MARK_END,
    '',
  ].join('\n')
  return `${`${head}${body === '' ? '' : `\n${body}`}${tail}`.trimEnd()}\n`
}

/** Rewrite the patch, leaving everything outside the markers byte-identical. */
function writePatch(rows) {
  if (!existsSync(profileDir)) die(`no Desktop profile at ${profileDir}; launch the app once first`)
  writeFileSync(patchPath, renderPatch(readPatch(), rows), 'utf8')
}

// ── resolving a local plugin ────────────────────────────────────────────────

/** Resolve the module a row should name, from a package directory or a file. */
function resolveEntry(target) {
  const absolute = resolve(target)
  if (!existsSync(absolute)) die(`${absolute} does not exist`)
  const manifestPath = join(absolute, 'package.json')
  if (!existsSync(manifestPath)) {
    if (!absolute.endsWith('.js') && !absolute.endsWith('.mjs')) die(`${absolute} is neither a package directory nor a .js file`)
    return { entry: absolute, name: undefined, peers: [] }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  // `exports['.']` is often `{ types, default }`, so take the loadable value and
  // never resolve a declaration file.
  const pick = (value) => {
    if (typeof value === 'string') return value
    if (value === null || typeof value !== 'object') return undefined
    for (const key of ['default', 'import', 'require']) if (typeof value[key] === 'string') return value[key]
    return Object.values(value).find((candidate) => typeof candidate === 'string' && !candidate.endsWith('.d.ts'))
  }
  const exports = manifest.exports
  const root = exports !== null && typeof exports === 'object' && '.' in exports ? exports['.'] : exports
  const declared = args.entry ?? pick(root) ?? manifest.main
  const entry = resolve(absolute, declared ?? join('lib', 'index.js'))
  if (!existsSync(entry)) die(`${absolute} has no loadable entry (tried ${entry}); pass --entry <file>`)
  return {
    entry,
    name: typeof manifest.name === 'string' ? manifest.name : undefined,
    peers: Object.keys(manifest.peerDependencies ?? {}),
  }
}

// ── commands ────────────────────────────────────────────────────────────────

const { rows } = readPatch()

if (args.command === 'list') {
  if (rows.length === 0) console.log(`no local plugins in ${patchPath}`)
  for (const row of rows) console.log(`${row.id}\t${existsSync(row.name) ? 'ok' : 'MISSING'}\t${row.name}`)
} else if (args.command === 'remove') {
  const kept = rows.filter((row) => row.id !== args.target)
  if (kept.length === rows.length) die(`no local plugin with id ${args.target}`)
  writePatch(kept)
  console.log(`removed ${args.target} from ${patchPath}`)
  console.log('重启 Desktop 生效（Desktop 没有 patchReload / HMR）。')
} else if (args.command === 'add') {
  const { entry, name, peers } = resolveEntry(args.target)
  const id = args.id ?? (name ?? 'local-plugin').replace(/^@/, '').replaceAll('/', '-')
  if (rows.some((row) => row.id === id)) die(`id ${id} is already loaded; remove it first or pass --id`)
  let config
  if (args.config !== undefined) {
    try {
      config = JSON.parse(args.config)
    } catch (error) {
      die(`--config is not JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // A row name is a module specifier: the loader takes a path as-is and resolves a
  // bare name from the runtime, exactly like the row we used to write by hand.
  const row = { id, name: entry.replaceAll('\\', '/') }
  if (config !== undefined) row.config = config
  writePatch([...rows, row])
  console.log(`added ${id} → ${row.name}`)
  if (peers.length > 0) console.log(`  host peers declared: ${peers.join(', ')}（由 Desktop 运行时提供）`)
  console.log(`wrote ${patchPath}`)
  console.log('')
  console.log('重启 Desktop 生效（Desktop 没有 patchReload / HMR）。')
  console.log('这行不受插件窗口管理、不能开关、profile 重置会清除 —— 它不是受管插件。')
} else {
  die(`unknown command ${args.command}`)
}
