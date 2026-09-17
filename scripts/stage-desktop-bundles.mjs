#!/usr/bin/env node
/**
 * Stage the Xiaobo bundles and its agent preset the way a Desktop product build
 * consumes them: two npm-shaped package directories plus one preset directory,
 * all with no machine-specific paths.
 *
 * This is the difference between the two no-publish routes. The profile patch
 * (`desktop-snippet.mjs --write`) points at an absolute build path and therefore
 * only works on the machine that built it. A **product build** ships the packages
 * *inside* the Desktop runtime instead, so the profile never mentions a path:
 * the bundles are listed in the shell's built-in bundle list and resolved by the
 * loader from the runtime's own `node_modules`, exactly like `dsh-base`.
 *
 * Output, ready for the packaging step:
 *   <out>/bundles/dsh-xb-deploy/            package.json + cordis.patch.yml
 *   <out>/bundles/dsh-xb-xiaobo-persona/    package.json + lib/ + cordis.patch.yml
 *   <out>/presets/xiaobo/                   preset.yml + agent.cordis.yml (empty persona)
 *
 * Usage:
 *   node scripts/stage-desktop-bundles.mjs --out <dir> [--preset <dir>] [--locale en|zh]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from './shared/desktop-runtime.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {string} message */
function die(message) {
  console.error(`stage desktop bundles: ${message}`)
  process.exit(1)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { out: undefined, preset: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') { options.out = argv[++i]; continue }
    if (arg === '--preset') { options.preset = argv[++i]; continue }
    die(`unknown option ${arg}`)
  }
  if (options.out === undefined) die('--out <dir> is required')
  return options
}

const args = parseArgs(process.argv.slice(2))
const out = resolve(args.out)
const dshHome = resolveDshHome(undefined)
const presetSource = resolve(args.preset ?? join(dshHome, '.agent-presets', 'xiaobo'))

const personaRoot = join(repoRoot, 'packages', 'xiaobo-persona')
const personaEntry = join(personaRoot, 'lib', 'index.js')
if (!existsSync(personaEntry)) die(`missing ${personaEntry} — run 'pnpm run build' first`)

// Only the files npm would publish: a product image must not carry sources or
// tests that the runtime never loads (they would also fail the runtime's own
// file policy expectations).
const BUNDLES = [
  {
    dir: join(repoRoot, 'deploy'),
    name: 'dsh-xb-deploy',
    files: ['package.json', 'cordis.patch.yml', 'README.md'],
  },
  {
    dir: personaRoot,
    name: 'dsh-xb-xiaobo-persona',
    files: ['package.json', 'cordis.patch.yml', 'README.md', 'lib/index.js', 'lib/index.d.ts'],
  },
]

rmSync(out, { recursive: true, force: true })
for (const bundle of BUNDLES) {
  const manifest = JSON.parse(readFileSync(join(bundle.dir, 'package.json'), 'utf8'))
  if (manifest.name !== bundle.name) die(`${bundle.dir}/package.json names ${manifest.name}, expected ${bundle.name}`)
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string') die(`${bundle.name} declares no dsh.bundle.patch — Desktop rejects it`)
  const target = join(out, 'bundles', bundle.name)
  mkdirSync(target, { recursive: true })
  for (const file of bundle.files) {
    const from = join(bundle.dir, file)
    if (!existsSync(from)) die(`${bundle.name} is missing ${file}`)
    cpSync(from, join(target, file))
  }
  // The runtime's own copy of a host package must never ship beside the plugin:
  // the bundle declares them as peers and resolves them from the runtime.
  console.log(`staged bundles/${bundle.name} (patch ${patch})`)
}

if (!existsSync(join(presetSource, 'agent.cordis.yml'))) {
  die(`no preset at ${presetSource} — run 'pnpm run dev:agent-preset -- --persona plugin'`)
}
const presetTarget = join(out, 'presets', 'xiaobo')
mkdirSync(presetTarget, { recursive: true })
cpSync(join(presetSource, 'agent.cordis.yml'), join(presetTarget, 'agent.cordis.yml'))
cpSync(join(presetSource, 'preset.yml'), join(presetTarget, 'preset.yml'))
console.log(`staged presets/xiaobo from ${presetSource}`)

console.log('')
console.log(out)
console.log('')
console.log('Feed this to the Desktop product build:')
console.log(`  DSH_DESKTOP_EXTRA_BUNDLES='${join(out, 'bundles')}' \\`)
console.log(`  DSH_DESKTOP_EXTRA_PRESETS='${join(out, 'presets')}' \\`)
console.log('  pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64:unsigned -- --dir')
