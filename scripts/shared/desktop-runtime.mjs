/**
 * Locate the Desktop runtime, so a dev script can validate what it generates
 * against the very app that will load it.
 *
 * The Desktop runtime is the only place that owns the harness packages a
 * profile or preset names (`@deepseek-ai/dsh-*`), the `node.exe` whose ABI
 * native modules must match, and the YAML parser the roster itself uses.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Resolve the harness home: an explicit override, then `$DSH_HOME`, then `~/.dsh`.
 * @param override - `--home` value, if given.
 * @returns the absolute `$DSH_HOME` path.
 */
export function resolveDshHome(override) {
  if (override !== undefined) return resolve(override)
  const fromEnv = process.env.DSH_HOME?.trim()
  return resolve(fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh'))
}

/**
 * Derive the Desktop runtime directory from the profile the app recorded.
 *
 * The app writes `$DSH_HOME/profiles/desktop/desktop-runtime-state.json` with
 * links pointing into the runtime tree, so the runtime can be recovered from
 * one of them without the caller knowing where the app was installed.
 * @param home - Resolved `$DSH_HOME`.
 * @param override - `--runtime` value, if given.
 * @returns the runtime directory, or `undefined` when it cannot be derived.
 */
export function deriveDesktopRuntime(home, override) {
  if (override !== undefined) return resolve(override)
  const statePath = join(home, 'profiles', 'desktop', 'desktop-runtime-state.json')
  if (!existsSync(statePath)) return undefined
  let link
  try {
    link = JSON.parse(readFileSync(statePath, 'utf8')).links?.[0]?.target
  } catch {
    return undefined
  }
  if (typeof link !== 'string') return undefined
  // <runtime>/dsh/node_modules/<pkg> → <runtime>
  return resolve(link, '..', '..', '..', '..')
}

/**
 * The shipped dsh tree inside a Desktop runtime: every preset row resolves from here.
 * @param runtime - Runtime directory.
 * @returns the path of the runtime's `dsh` directory.
 */
export function desktopDshDir(runtime) {
  return join(runtime, 'dsh')
}
