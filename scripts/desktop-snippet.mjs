#!/usr/bin/env node
/**
 * Project the Xiaobo bundles onto a Desktop profile that has no way to install
 * them: Desktop accepts neither `--patch` overlays nor path/git/tarball specs,
 * and publishing to npm is not always wanted, so the remaining door is the
 * profile's own `cordis.patch.yml` — the one patch file the app still reads.
 *
 * Two outputs, one source:
 * - the snippet (`dev/desktop-profile-patch.snippet.yml`) for pasting by hand;
 * - `--write`, which merges the same rows into
 *   `$DSH_HOME/profiles/desktop/cordis.patch.yml` between markers, so repeated
 *   runs are idempotent and the file's other rows (MCP servers) are untouched.
 *
 * The deployment values come from `deploy/cordis.patch.yml` and the capability
 * row from `packages/xiaobo-persona/cordis.patch.yml`, both projected verbatim
 * — the only edit is swapping the capability row's package spec for the built
 * entry's absolute path. A `config:` block in the bundle's own patch therefore
 * reaches the profile without a second place to keep in sync; edit the bundle,
 * rerun, and the profile follows.
 *
 * Caveats this path inherits by design (see `docs/plugins.md` §6 C2): rows here
 * are invisible to the plugin window, bypass the Desktop dependency graph
 * check, and are deleted by a profile reset. It is a local/validation path.
 *
 * Usage:
 *   node scripts/desktop-snippet.mjs [--write] [--home <dir>] [--runtime <dir>]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deriveDesktopRuntime, desktopDshDir, resolveDshHome } from './shared/desktop-runtime.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/** @param {string} message */
function die(message) {
  console.error(`desktop snippet: ${message}`)
  process.exit(1)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { write: false, home: undefined, runtime: undefined, capability: true }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write') { options.write = true; continue }
    if (arg === '--no-capability') { options.capability = false; continue }
    if (arg === '--home') { options.home = argv[++i]; continue }
    if (arg === '--runtime') { options.runtime = argv[++i]; continue }
    die(`unknown option ${arg}`)
  }
  return options
}

const args = parseArgs(process.argv.slice(2))
const dshHome = resolveDshHome(args.home)
const pluginEntry = join(repoRoot, 'packages', 'xiaobo-persona', 'lib', 'index.js')
const deployPatch = join(repoRoot, 'deploy', 'cordis.patch.yml')
const desktopPatch = join(repoRoot, 'deploy', 'desktop.cordis.patch.yml')
const capabilityPatch = join(repoRoot, 'packages', 'xiaobo-persona', 'cordis.patch.yml')

if (!existsSync(pluginEntry)) die(`missing ${pluginEntry} — run 'pnpm run build' first`)
for (const file of [deployPatch, capabilityPatch]) if (!existsSync(file)) die(`missing ${file}`)

// ── the block this script owns, wrapped in markers so a rewrite can replace it ──

const MARK_BEGIN = '# >>> dsh-xb-plugins'
const MARK_END = '# <<< dsh-xb-plugins'
const literal = pluginEntry.replaceAll('\\', '/')
const deployment = readFileSync(deployPatch, 'utf8').trimEnd()

/**
 * Project the capability bundle's patch, swapping only its package spec for the
 * built entry. Everything else — row id, any `config:` block, the comments that
 * document it — is copied verbatim, so the bundle file stays the single source.
 * @param text - Contents of `packages/xiaobo-persona/cordis.patch.yml`.
 * @returns the same patch, aimed at the built entry.
 */
function projectCapability(text) {
  const lines = text.split('\n')
  const idAt = lines.findIndex((line) => /^\s*-\s*id:\s*xiaobo-persona\s*$/.test(line))
  if (idAt === -1) die(`no '- id: xiaobo-persona' row in ${capabilityPatch}`)
  const nameAt = lines.findIndex((line, index) => index > idAt && /^\s*name:/.test(line))
  if (nameAt === -1) die(`the xiaobo-persona row in ${capabilityPatch} has no 'name:' line`)
  const indent = /^\s*/.exec(lines[nameAt])[0]
  lines[nameAt] = `${indent}name: '${literal}'`
  return lines.join('\n').trimEnd()
}

const capability = projectCapability(readFileSync(capabilityPatch, 'utf8'))

const block = [
  `${MARK_BEGIN} — generated; rerun 'pnpm run dev:desktop-snippet -- --write' instead of editing`,
  '',
  '# 1) 部署层内容，逐字来自 deploy/cordis.patch.yml（覆盖 in-box row，会整体替换该 row config）',
  deployment,
  ...(existsSync(desktopPatch)
    ? [
      '',
      '# 1b) Desktop 专属策略，逐字来自 deploy/desktop.cordis.patch.yml',
      readFileSync(desktopPatch, 'utf8').trimEnd(),
    ]
    : []),
  ...(args.capability
    ? [
      '',
      '# 2) 能力插件 row，逐字来自 packages/xiaobo-persona/cordis.patch.yml，',
      '#    仅把包名换成构建产物的绝对路径（Desktop 不读 --patch，也不接受本地路径规格）',
      capability,
    ]
    : ['', '# 2) 能力插件的 row 由 scripts/desktop-local-plugin.mjs 单独管理（--no-capability）']),
  MARK_END,
].join('\n')

/** Remove a previously generated block, or fail when the markers disagree. */
function stripGenerated(text) {
  const begin = text.indexOf(MARK_BEGIN)
  if (begin === -1) return text
  const end = text.indexOf(MARK_END, begin)
  if (end === -1) die(`found ${MARK_BEGIN} without ${MARK_END}; fix the file by hand`)
  const afterEnd = text.indexOf('\n', end)
  const tail = afterEnd === -1 ? '' : text.slice(afterEnd + 1)
  return `${text.slice(0, begin).trimEnd()}${tail.length > 0 ? tail : ''}`
}

/** @param {string} text @returns {string} the file content with this script's block (re)applied */
function merge(text) {
  const rest = stripGenerated(text).trimEnd()
  return `${rest.length > 0 ? `${rest}\n\n` : ''}${block}\n`
}

/** Parse with the same parser the Desktop roster uses, so a bad merge fails here. */
async function validate(text) {
  const runtime = deriveDesktopRuntime(dshHome, args.runtime)
  if (runtime === undefined) {
    console.warn('warning: no Desktop runtime derived; skipped YAML validation (pass --runtime <dir>)')
    return
  }
  const dshDir = desktopDshDir(runtime)
  const yaml = require(join(dshDir, 'node_modules', 'js-yaml'))
  // The loader's own schema, so `!!js` config expressions in a projected row parse
  // here exactly as they will in the app.
  const { entryListSchema } = await import(pathToFileURL(join(dshDir, 'node_modules', '@deepseek-ai', 'cordis-plugin-include', 'lib', 'index.js')).href)
  let parsed
  try {
    parsed = yaml.load(text, { schema: entryListSchema })
  } catch (error) {
    die(`merged patch is not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed)) die('merged patch is not a top-level list of patch entries')
  for (const row of parsed) {
    if (typeof row !== 'object' || row === null || (typeof row.id !== 'string' && !Array.isArray(row.insert))) {
      die(`merged patch has a row that is neither an 'id:' override nor an 'insert:' list: ${JSON.stringify(row)}`)
    }
  }
  // The capability row must come out the other side aimed at the built entry,
  // with whatever config the bundle's own patch carries. With --no-capability
  // that row is owned by scripts/desktop-local-plugin.mjs instead.
  const inserted = parsed.flatMap((row) => Array.isArray(row.insert) ? row.insert : []).filter((row) => typeof row === 'object' && row !== null)
  const capabilityRow = inserted.find((row) => row.id === 'xiaobo-persona')
  if (!args.capability) {
    console.log(`validated with ${join(dshDir, 'node_modules', 'js-yaml')} (${parsed.length} top-level rows, capability row managed separately)`)
    return
  }
  if (capabilityRow === undefined) die('the merged patch carries no xiaobo-persona row')
  if (capabilityRow.name !== literal) die(`the xiaobo-persona row names ${JSON.stringify(capabilityRow.name)} instead of ${JSON.stringify(literal)}`)
  const bundleRow = yaml.load(readFileSync(capabilityPatch, 'utf8'))
  const expected = Array.isArray(bundleRow) ? bundleRow.flatMap((row) => Array.isArray(row?.insert) ? row.insert : []).find((row) => row?.id === 'xiaobo-persona') : undefined
  const expectedConfig = JSON.stringify(expected?.config ?? {})
  const actualConfig = JSON.stringify(capabilityRow.config ?? {})
  if (expectedConfig !== actualConfig) die(`the projected xiaobo-persona config drifted from the bundle: projected ${actualConfig}, bundle ${expectedConfig}`)
  console.log(`validated with ${join(dshDir, 'node_modules', 'js-yaml')} (${parsed.length} top-level rows, capability config ${actualConfig})`)
}

// ── default output: the paste-in snippet ──

const snippetFile = join(repoRoot, 'dev', 'desktop-profile-patch.snippet.yml')
mkdirSync(dirname(snippetFile), { recursive: true })
writeFileSync(snippetFile, `${block}\n`, 'utf8')
console.log(`wrote ${snippetFile}`)

// ── --write: merge into the profile patch the app actually reads ──

const profilePatch = join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml')
const existing = existsSync(profilePatch) ? readFileSync(profilePatch, 'utf8') : ''
const merged = merge(existing)
await validate(merged)

if (args.write) {
  if (existing.length > 0) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const backup = `${profilePatch}.bak-${stamp}`
    copyFileSync(profilePatch, backup)
    console.log(`backed up ${backup}`)
  }
  writeFileSync(profilePatch, merged, 'utf8')
  console.log(`wrote ${profilePatch}`)
} else {
  console.log(`dry: would write ${profilePatch} (${merged.split('\n').length} lines) — pass --write to apply`)
}

console.log('')
console.log('这个 profile patch 的内容与本机路径绑定，且：')
console.log('  · 插件窗口看不到这些 row，不能开关、disable-all 也管不到；')
console.log('  · 不过 Desktop 的依赖图校验（校验的是 bundle 层）；')
console.log('  · Reset profile 会删掉它 —— 重跑本脚本即可恢复。')
console.log('改完重启 Desktop 生效（Desktop 没有 HMR / patchReload）。')
console.log('')
console.log('注意：它与 agent preset 是两条互斥的注入通道 —— preset 的 persona 与这里的')
console.log('xiaobo:identity 会把同一段文本送两遍。只留一条：')
console.log(`  ${join(dshHome, 'settings.yaml')} 的 agent-presets.default 设为 standard（只留插件）`)
console.log('  或删掉上面能力行（只留 preset：pnpm run dev:agent-preset）')
