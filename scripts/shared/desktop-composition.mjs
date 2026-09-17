/**
 * Recompute the Desktop composition — the layer stack the app itself builds —
 * so dev scripts can assert or render against what the app will load.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { desktopDshDir } from './desktop-runtime.mjs'

/**
 * Load the real profile plus the real desktop composition patch and compose the
 * rows, mirroring `desktopComposition()` in `apps/desktop-host/src/index.ts`.
 * @param home - Resolved `$DSH_HOME`.
 * @param runtime - Desktop runtime directory.
 * @returns the composed rows and the pieces a caller needs to mount them.
 */
export async function composeDesktopRows(home, runtime) {
  const dshDir = desktopDshDir(runtime)
  const installAnchor = join(dshDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  if (!existsSync(installAnchor)) throw new Error(`no dsh install at ${installAnchor}`)
  const desktopPatch = join(dshDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'config', 'desktop.cordis.patch.yml')
  if (!existsSync(desktopPatch)) throw new Error(`no desktop composition patch at ${desktopPatch}`)

  const boot = await import(pathToFileURL(join(dshDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')).href)
  const projectDir = join(home, 'profiles', 'desktop')
  const profile = boot.loadProfileDirectory('dsh desktop', projectDir, installAnchor)
  const layers = [
    ...profile.layers.map((layer) => layer.patches),
    profile.patches,
    boot.loadOverlayPatches('dsh desktop', desktopPatch),
  ]
  const rows = boot.composeEntries(layers)
  return { dshDir, projectDir, profile, rows }
}

/**
 * Resolve a composed row's `name` to an absolute path Node can import.
 * @param spec - A composed row name: a `file:` URL or a package specifier.
 * @param searchPaths - Directories a package specifier is resolved from.
 * @returns the absolute module path.
 */
export function modulePathOf(spec, searchPaths) {
  if (spec.startsWith('file:')) return fileURLToPath(spec)
  const require = createRequire(join(searchPaths[0], 'package.json'))
  return require.resolve(spec, { paths: searchPaths })
}

/**
 * Import a harness package out of a Desktop runtime, which owns the exact
 * versions the app loads.
 * @param dshDir - The runtime's `dsh` directory.
 * @param name - Package name, e.g. `@deepseek-ai/dsh-system-prompt`.
 * @returns the imported module namespace.
 */
export async function importRuntimePackage(dshDir, name) {
  const entry = createRequire(join(dshDir, 'package.json')).resolve(name)
  return import(pathToFileURL(entry).href)
}
