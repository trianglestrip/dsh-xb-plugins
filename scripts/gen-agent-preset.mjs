#!/usr/bin/env node
/**
 * Project the Xiaobo prompt onto a Desktop **agent preset**, so the text reaches
 * the model without publishing anything.
 *
 * Why this exists: Desktop's plugin path requires an npm registry package at an
 * exact version (`projectManifest()` rejects anything else, and its plugin window
 * rejects paths outright), while a *preset* is just a directory of YAML under
 * `$DSH_HOME/.agent-presets` that the roster scans by default. The prompt is data,
 * so it can be delivered as data — no package, no registry, no install, and no
 * absolute paths: every row names a package the Desktop runtime already ships.
 *
 * The preset is generated, never hand-edited. It takes the shipped `standard`
 * composition — with `include` unsupported in presets, a usable preset must be a
 * whole agent composition, so copying upstream is unavoidable and regenerating
 * is how drift is avoided — and replaces only the `persona` row. The text itself
 * comes from `packages/xiaobo-persona`, so the plugin and the preset can never
 * disagree about what Xiaobo says.
 *
 * Usage:
 *   node scripts/gen-agent-preset.mjs [--runtime <dir>] [--home <dir>]
 *                                     [--id <name>] [--locale en|zh] [--dry-run]
 *
 * Defaults: runtime from `$DSH_HOME/profiles/desktop/desktop-runtime-state.json`,
 * home `$DSH_HOME` (or `~/.dsh`), id `xiaobo`, locale `en`.
 *
 * After generating, the preset appears in the app's mode picker. To make it the
 * default instead, add to the Desktop profile patch:
 *
 *   - id: agent-presets
 *     config:
 *       default: xiaobo
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/** @param {string} message */
function die(message) {
  console.error(`agent preset: ${message}`)
  process.exit(1)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { runtime: undefined, home: undefined, id: 'xiaobo', locale: 'en', dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg === '--runtime') { options.runtime = argv[++i]; continue }
    if (arg === '--home') { options.home = argv[++i]; continue }
    if (arg === '--id') { options.id = argv[++i]; continue }
    if (arg === '--locale') { options.locale = argv[++i]; continue }
    die(`unknown option ${arg}`)
  }
  if (options.locale !== 'en' && options.locale !== 'zh') die('--locale takes en or zh')
  return options
}

const args = parseArgs(process.argv.slice(2))
const dshHome = resolve(args.home ?? (process.env.DSH_HOME?.trim() ? process.env.DSH_HOME : join(homedir(), '.dsh')))

// ── locate the Desktop runtime (it owns the node modules every preset row names) ──

function deriveRuntime() {
  if (args.runtime !== undefined) return resolve(args.runtime)
  const statePath = join(dshHome, 'profiles', 'desktop', 'desktop-runtime-state.json')
  if (!existsSync(statePath)) return undefined
  const link = JSON.parse(readFileSync(statePath, 'utf8')).links?.[0]?.target
  if (typeof link !== 'string') return undefined
  // <runtime>/dsh/node_modules/<pkg> → <runtime>
  return resolve(link, '..', '..', '..', '..')
}

const runtime = deriveRuntime()
if (runtime === undefined) die('cannot derive the Desktop runtime; pass --runtime <dir>')
const dshDir = join(runtime, 'dsh')
const shippedRoot = join(dshDir, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets')
const source = join(shippedRoot, 'standard', 'agent.cordis.yml')
if (!existsSync(source)) die(`no shipped 'standard' composition at ${source} (pass --runtime <dir>)`)

// ── render the Xiaobo text from the plugin's own fragments (single source) ──

const pluginEntry = join(repoRoot, 'packages', 'xiaobo-persona', 'lib', 'index.js')
if (!existsSync(pluginEntry)) die(`missing ${pluginEntry} — run 'pnpm run build' first`)
const fragments = await import(pathToFileURL(pluginEntry).href)
const { renderFragment, IDENTITY, DOMAIN_POLICY, SAFETY_REDLINES, INTERACTION_NORMS, OBJECTIVITY, PRODUCT_HELP } = fragments

const blocks = [IDENTITY, DOMAIN_POLICY, SAFETY_REDLINES, INTERACTION_NORMS, OBJECTIVITY]
  .map(fragment => renderFragment(fragment, args.locale))
const prefix = blocks.join('\n\n')
const suffix = `${renderFragment(PRODUCT_HELP, args.locale)}\n\nYour working directory is {{cwd}}.`

// ── replace the persona row, leaving every other upstream row byte-identical ──

/** Indent one block scalar body so it stays readable in the generated file. */
const indent = (text) => text.split('\n').map(line => (line === '' ? '' : `      ${line}`)).join('\n')

const composition = readFileSync(source, 'utf8')
const rowStart = composition.indexOf('- id: persona\n')
if (rowStart === -1) die("the shipped composition has no '- id: persona' row to replace")
// Drop upstream's own comment about that row along with it, so the generated
// file never carries prose describing a persona it no longer has.
const commented = composition.lastIndexOf('# The preset\'s own persona', rowStart)
const start = commented !== -1 && rowStart - commented < 400 ? commented : rowStart
const next = composition.indexOf('\n- ', rowStart)
if (next === -1) die('cannot find the row after persona')
const personaRow = [
  '# Generated by scripts/gen-agent-preset.mjs — edit packages/xiaobo-persona, not this file.',
  '# The persona carries the whole Xiaobo policy: order 0, so it precedes every',
  '# first-party section and lands ahead of all tool guidance, matching the product.',
  "- id: persona",
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    prefix: |-',
  indent(prefix),
  '    suffix: |-',
  indent(suffix),
].join('\n')
const generated = composition.slice(0, start) + personaRow + composition.slice(next)

const presetMeta = [
  'name: 小博',
  'description: 电力工程厂站设计 Agent：小博人设 + 接口调用约束 + 安全红线 + 交互规范 + 专业客观性。',
  'order: 0',
  '',
].join('\n')

// ── health check: the same parser and the same resolution rule the roster uses ──

const yaml = require(join(dshDir, 'node_modules', 'js-yaml'))
const { entryListSchema } = await import(pathToFileURL(join(dshDir, 'node_modules', '@deepseek-ai', 'cordis-plugin-include', 'lib', 'index.js')).href)

const destination = join(dshHome, '.agent-presets', args.id)
const harnessBase = dshDir

/** @param {string} pkg @returns {boolean} whether the package is installed at or above `base` */
function packageInstalled(pkg, base) {
  const name = pkg.split('/').slice(0, pkg.startsWith('@') ? 2 : 1).join('/')
  let dir = base
  for (;;) {
    if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/** @param {unknown[]} rows @param {string[]} problems @param {string} presetDir */
function checkRows(rows, problems, presetDir) {
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) { problems.push('a row is not a map'); continue }
    const { name, group, config } = row
    if (typeof name !== 'string' || name === '') { problems.push('a row names no plugin'); continue }
    if (group === true) { checkRows(Array.isArray(config) ? config : [], problems, presetDir); continue }
    if (name.startsWith('cordis:')) continue
    if (name.startsWith('.')) {
      if (!existsSync(resolve(presetDir, name))) problems.push(`${name} is not in the preset`)
      continue
    }
    if (name.startsWith('file:')) {
      if (!existsSync(fileURLToPath(name))) problems.push(`${name} does not exist`)
      continue
    }
    if (isAbsolute(name)) {
      if (!existsSync(name)) problems.push(`${name} does not exist`)
      continue
    }
    if (!packageInstalled(name, harnessBase)) problems.push(`${name} is not installed in the runtime`)
  }
}

const problems = []
let parsed
try {
  parsed = yaml.load(generated, { schema: entryListSchema })
} catch (error) {
  die(`generated composition is not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
}
checkRows(parsed, problems, destination)
if (problems.length > 0) die(`generated composition would be reported broken:\n- ${problems.join('\n- ')}`)

if (args.dryRun) {
  console.log(`--dry-run: would write ${destination}`)
  console.log(`prefix ${prefix.length} chars, suffix ${suffix.length} chars, rows ${parsed.length}`)
  process.exit(0)
}

mkdirSync(destination, { recursive: true })
writeFileSync(join(destination, 'agent.cordis.yml'), generated, 'utf8')
writeFileSync(join(destination, 'preset.yml'), presetMeta, 'utf8')

console.log(`wrote ${destination}`)
console.log(`  preset.yml, agent.cordis.yml (${parsed.length} rows, locale ${args.locale})`)
console.log(`  runtime: ${runtime}`)
console.log('')
console.log('The preset needs no install and no patch: it appears in the mode picker.')
console.log('To make it the default for new sessions, write the user setting (the same')
console.log('namespace the settings UI uses) instead of touching the profile composition:')
console.log('')
console.log(`  # ${join(dshHome, 'settings.yaml')}`)
console.log('  agent-presets:')
console.log(`    default: ${args.id}`)
console.log('    modeSelectionEnabled: true')
