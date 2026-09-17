#!/usr/bin/env node
/**
 * Guard the manifest rules a Desktop (Electron) profile enforces.
 *
 * Desktop validates every third-party bundle against the runtime it ships, and
 * its failure mode is "no rollback" — a bad manifest leaves the profile needing
 * a manual reset. These checks reproduce the cheap, machine-independent subset
 * of that validation so a mistake is caught here instead of on a user's machine:
 *
 * - a bundle must declare `dsh.bundle.patch`, and the patch file must exist
 *   inside the package;
 * - `@deepseek-ai/*` packages are host-owned and must be `peerDependencies`,
 *   never `dependencies` / `optionalDependencies`;
 * - every host peer must also be an exact `devDependency`, so type checking uses
 *   the same release the runtime provides;
 * - the package must ship prebuilt JS at its declared `main` (Desktop never
 *   compiles TypeScript); a patch-only bundle declares no `main` and is allowed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(repoRoot, 'packages')
const HOST_SCOPE = '@deepseek-ai/'
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

/** @type {string[]} */
const failures = []

/** @param {string} message */
function fail(message) {
  failures.push(message)
}

/** @param {string} file @returns {Record<string, unknown>} */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** @param {unknown} value @returns {Record<string, string>} */
function stringMap(value) {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return /** @type {Record<string, string>} */ (value)
}

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const packageDir = join(packagesDir, entry.name)
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) {
    fail(`${entry.name}: missing package.json`)
    continue
  }
  const manifest = readJson(manifestPath)
  const label = typeof manifest.name === 'string' ? manifest.name : entry.name

  if (manifest.private === true) fail(`${label}: must not be private; Desktop installs it from the registry`)
  if (typeof manifest.version !== 'string' || !EXACT_VERSION.test(manifest.version)) {
    fail(`${label}: version must be an exact release, got ${JSON.stringify(manifest.version)}`)
  }

  const bundle = manifest.dsh && typeof manifest.dsh === 'object' ? manifest.dsh.bundle : undefined
  const patch = bundle && typeof bundle === 'object' ? bundle.patch : undefined
  if (typeof patch !== 'string' || patch === '') {
    fail(`${label}: missing dsh.bundle.patch`)
  } else {
    const patchPath = resolve(packageDir, patch)
    if ((patchPath !== packageDir && !patchPath.startsWith(packageDir + sep)) || !existsSync(patchPath)) {
      fail(`${label}: dsh.bundle.patch must resolve to a file inside the package`)
    }
  }

  const files = Array.isArray(manifest.files) ? manifest.files : []
  const main = typeof manifest.main === 'string' ? manifest.main : undefined
  if (main !== undefined && !files.includes(main)) {
    fail(`${label}: files must include the declared main entry ${main}`)
  }

  const dependencies = stringMap(manifest.dependencies)
  const optional = stringMap(manifest.optionalDependencies)
  for (const name of [...Object.keys(dependencies), ...Object.keys(optional)]) {
    if (name.startsWith(HOST_SCOPE)) {
      fail(`${label}: ${name} is host-owned and must be a peerDependency, not a runtime dependency`)
    }
  }

  const peers = stringMap(manifest.peerDependencies)
  const dev = stringMap(manifest.devDependencies)
  for (const name of Object.keys(peers)) {
    if (!(name in dev)) {
      fail(`${label}: peer ${name} needs a matching devDependency so type checking matches the host release`)
    }
  }
}

if (failures.length > 0) {
  console.error('desktop manifest check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('desktop manifest check passed')
}
