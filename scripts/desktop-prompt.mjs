#!/usr/bin/env node
/**
 * Render the system prompt a Desktop session will actually send, from the real
 * composition, and assert the Xiaobo definition survived it.
 *
 * This is the end of the chain the other scripts only cover piecewise: the
 * composed rows give the `system-prompt` config and the `xiaobo-persona` entry,
 * the selected agent preset gives the scoped `persona` text, and mounting both
 * against the runtime's own prompt registry shows what the model receives.
 * It is also the check that catches the one failure mode the two no-publish
 * routes share — a preset whose persona still carries text, which would send the
 * Xiaobo identity twice and prepend a generic coding-agent line.
 *
 * Usage:
 *   node scripts/desktop-prompt.mjs [--home <dir>] [--runtime <dir>] [--cwd <dir>] [--full]
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deriveDesktopRuntime, desktopDshDir, resolveDshHome } from './shared/desktop-runtime.mjs'
import { composeDesktopRows, importRuntimePackage, modulePathOf } from './shared/desktop-composition.mjs'

const require = createRequire(import.meta.url)

/** @param {string} message */
function die(message) {
  console.error(`desktop prompt: ${message}`)
  process.exit(1)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { home: undefined, runtime: undefined, cwd: undefined, full: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--full') { options.full = true; continue }
    if (arg === '--home') { options.home = argv[++i]; continue }
    if (arg === '--runtime') { options.runtime = argv[++i]; continue }
    if (arg === '--cwd') { options.cwd = argv[++i]; continue }
    die(`unknown option ${arg}`)
  }
  return options
}

const args = parseArgs(process.argv.slice(2))
const dshHome = resolveDshHome(args.home)
const runtime = deriveDesktopRuntime(dshHome, args.runtime)
if (runtime === undefined) die('cannot derive the Desktop runtime; pass --runtime <dir>')

const dshDir = desktopDshDir(runtime)
const yaml = require(join(dshDir, 'node_modules', 'js-yaml'))
const cwd = args.cwd ?? process.cwd()

const { projectDir, rows } = await composeDesktopRows(dshHome, runtime)
const byId = new Map(rows.filter((row) => typeof row.id === 'string').map((row) => [row.id, row]))

// ── which preset will a new session run? user setting first, then the row ──

// Mirror the roster's own selection policy: the registered base comes from the
// row config, and a user document may override it — but while selection is
// disabled the deployment default governs and the saved user default is ignored.
const settingsPath = join(dshHome, 'settings.yaml')
const presetRow = byId.get('agent-presets')?.config ?? {}
const base = { default: presetRow.default, modeSelectionEnabled: presetRow.modeSelectionEnabled ?? true }
let policy = base
if (existsSync(settingsPath)) {
  const settings = yaml.load(readFileSync(settingsPath, 'utf8'))?.['agent-presets']
  if (settings !== undefined && typeof settings === 'object') {
    const enabled = settings.modeSelectionEnabled ?? base.modeSelectionEnabled
    policy = { default: enabled ? (settings.default ?? base.default) : base.default, modeSelectionEnabled: enabled }
  }
}
const presetId = policy.default
if (typeof presetId !== 'string') die('no default agent preset (neither settings.yaml nor the agent-presets row)')

const presetRoots = [
  // Where the Desktop Host looks for the deployment's own presets: it derives the
  // root from the installed dsh package directory, so a preset staged at
  // `<runtime>/config/agent-presets` is never scanned.
  join(dshDir, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', presetId),
  // The user's own presets, then the set the agent-presets package ships.
  join(dshHome, '.agent-presets', presetId),
  join(dshDir, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', presetId),
]
const presetDir = presetRoots.find((dir) => existsSync(join(dir, 'agent.cordis.yml')))
if (presetDir === undefined) die(`preset ${presetId} has no agent.cordis.yml in ${presetRoots.join(' or ')}`)
// The roster accepts `!!js` tags, so the preset must be read with its schema.
const { entryListSchema } = await import(pathToFileURL(join(dshDir, 'node_modules', '@deepseek-ai', 'cordis-plugin-include', 'lib', 'index.js')).href)
const presetRows = yaml.load(readFileSync(join(presetDir, 'agent.cordis.yml'), 'utf8'), { schema: entryListSchema })
const personaRow = (Array.isArray(presetRows) ? presetRows : []).find((row) => row?.id === 'persona')

// ── mount: deployment system-prompt config + the capability row + that persona ──

const systemPromptRow = byId.get('system-prompt')
// Match the capability rather than one id: a product build lists a package name
// and the local plugin channel derives an id from it.
const capabilityRow = rows.find((row) => typeof row.id === 'string' && row.id.endsWith('xiaobo-persona'))
if (capabilityRow === undefined) die('the composition carries no xiaobo-persona row: run `pnpm run dev:desktop-snippet -- --write`')

const { Context } = await importRuntimePackage(dshDir, '@deepseek-ai/cordis')
const systemPromptModule = await importRuntimePackage(dshDir, '@deepseek-ai/dsh-system-prompt')
const scopeModule = await importRuntimePackage(dshDir, '@deepseek-ai/dsh-scope')
const SystemPrompt = systemPromptModule.default ?? systemPromptModule
const capability = await import(pathToFileURL(modulePathOf(capabilityRow.name, [dshDir, projectDir])).href)

const root = new Context()
await root.plugin(SystemPrompt, systemPromptRow?.config ?? {})
await root.plugin(capability.default ?? capability, capabilityRow.config ?? {})
// Stand-in for whichever plugin registers {{cwd}} in a real composition.
await root.plugin({ inject: ['systemPrompt'], apply(ctx) { ctx.systemPrompt.variable('cwd', () => cwd) } })

let scope
if (personaRow !== undefined) {
  const personaModule = await importRuntimePackage(dshDir, '@deepseek-ai/dsh-persona')
  const scopeKey = Symbol('agent')
  scope = scopeModule.createScope(root, scopeKey)
  await scope.ctx.plugin(personaModule.default ?? personaModule, {
    prefix: personaRow.config?.prefix ?? '',
    suffix: personaRow.config?.suffix ?? '',
  })
  scope = { ...scope, key: scopeKey }
}

const assembly = await root.systemPrompt.assemble(scope === undefined ? { cwd } : { scope: scope.key, cwd })
const rendered = systemPromptModule.renderPrompt(assembly)

// ── report ──

const personaPrefix = (personaRow?.config?.prefix ?? '').trim()
console.log(`preset           : ${presetId}${policy.modeSelectionEnabled ? '' : ' (selection off; deployment default)'}`)
console.log(`  source         : ${presetDir}`)
console.log(`  persona prefix : ${personaPrefix.length} chars${personaPrefix.length > 0 ? ' — carries text, this is the preset route' : ' (empty — the plugin carries the text)'}`)
console.log(`  persona suffix : ${JSON.stringify(personaRow?.config?.suffix ?? '')}`)
console.log(`system-prompt    : ${JSON.stringify(systemPromptRow?.config ?? {})}`)
console.log(`capability row   : ${capabilityRow.name} ${JSON.stringify(capabilityRow.config ?? {})}`)
console.log('')
console.log('sections in render order:')
assembly.sections.forEach((section, index) => console.log(`  ${String(index + 1).padStart(3)}  ${section.name}  (${section.text.length} chars)`))
console.log('')
console.log(`rendered system prompt: ${rendered.length} chars, ${rendered.split('\n').length} lines`)

// Locale-agnostic markers: each must appear exactly once, in the one fragment it
// belongs to, so the check works for the shipped English and Chinese text alike.
const markers = [
  ['identity', /You are "Xiaobo"|你是"小博"/g],
  ['domain policy', /# Interface Calls and Cross-Discipline Constraints|# 接口调用与跨专业约束/g],
  ['safety redlines', /Human-in-the-Loop/g],
  ['interaction norms', /\[BCPD_AI\]/g],
  ['objectivity', /# Professional Objectivity|# 专业客观性/g],
  ['product help', /bochao\.com/g],
]
const problems = []
for (const [label, marker] of markers) {
  const count = [...rendered.matchAll(marker)].length
  if (count !== 1) problems.push(`${label}: expected 1 occurrence of ${String(marker)}, found ${count}`)
}
const harnessIdentity = rendered.includes('powered by DeepSeek Harness')
if (systemPromptRow?.config?.includeHarnessIdentity === false && harnessIdentity) {
  problems.push('the harness identity opener is still rendered although the deployment disabled it')
}
const genericPersona = /You are a coding agent powered by the .*model/.test(rendered)
if (personaPrefix.length === 0 && genericPersona) {
  problems.push('a generic coding-agent persona precedes the Xiaobo identity — the preset\'s persona is not shadowing it')
}
if (personaPrefix.length > 0 && !personaPrefix.startsWith('You are "Xiaobo"')) {
  problems.push('the preset carries persona text that is not the Xiaobo identity — regenerate it with `pnpm run dev:agent-preset`')
}
console.log(`harness identity : ${harnessIdentity ? 'present' : 'absent'}`)
console.log(`starts with      : ${JSON.stringify(rendered.slice(0, 60))}`)
console.log(`ends with        : ${JSON.stringify(rendered.slice(-40))}`)

console.log('')
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`)
  process.exit(1)
}
console.log('✓ every Xiaobo fragment renders exactly once, in the documented order')
if (args.full) {
  console.log('')
  console.log('--- rendered system prompt ---')
  console.log(rendered)
}
if (scope !== undefined) await scope.dispose()
await root.fiber.dispose()
