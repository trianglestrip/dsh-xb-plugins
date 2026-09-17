# AGENTS.md — dsh-xb-plugins conventions

Xiaobo plugin collection for DeepSeek Harness. Every package here is an out-of-tree
**dsh bundle** loaded by a host harness; this repo is never a harness fork.

## Layout

| Path | What goes there |
|---|---|
| `packages/<name>/` | **Plugins only.** One independent, separately installable bundle per directory — a capability, never a composition. |
| `deploy/` | The **deployment layer**: a patch-only bundle that composes the product. It is deliberately **not** a plugin — it has no code and exists to override in-box rows for every Xiaobo deployment. |
| `docs/` | Chinese design and analysis documents, plus the plugin index (`docs/plugins.md`). |
| `dev/` | Dev tooling notes and the machine-generated overlays (git-ignored). |
| `scripts/` | Repo scripts: `check-manifests.mjs`, `dev-patch.mjs`, `desktop-snippet.mjs`. |

Keep the split honest: a capability goes in `packages/`, a decision about how the product is
composed goes in `deploy/`.

## Non-negotiables

- **No hardcoded deployment values.** Anything two deployments could reasonably set
  differently (text, locale, thresholds, endpoints, tool names) is a `Config` field with a
  schema default. The test is: can `cordis.patch.yml` change it without a code edit?
- **Harness packages are peers.** A plugin consumes `@deepseek-ai/*` as `peerDependencies`
  and keeps `deps.neverBundle: [/^@deepseek-ai\//]` in `tsdown.config.ts`. Never bundle a
  second copy of the harness runtime.
- **Pin what you type-check against.** The same harness versions that appear as peers must
  appear as exact `devDependencies` (`"@deepseek-ai/dsh-system-prompt": "0.1.6-alpha.1"`),
  because the published and vendored API can drift.
- **Stable sections, dynamic contexts.** Prompt text that only changes when the deployment
  changes goes through `systemPrompt.section()`. Anything that can change *during* a session
  (service health, knowledge scope, roster) goes through `systemPrompt.context()` — a section
  rewrites the system surface, breaks the prefix cache, and opens a new request series.
- **Reserved slot names belong to the registry.** `deployment:persona-prefix` and
  `deployment:persona-suffix` are registered globally by `dsh-system-prompt` from its own
  config. A global plugin must use a distinct section name at the same order (see
  `xiaobo-persona`); only a **scoped** mount may shadow the reserved name. Registering a
  reserved name unscoped fails the load.
- **Placement is code, content is config.** Numeric orders for plugin-owned sections are
  structural (they encode relative position against the first-party bands) and live as
  constants; the text they carry is config.
- **Capability plugins never patch another bundle's row.** Overriding an in-box row (for example
  `system-prompt`) replaces that row's whole config and therefore changes the composition, not the
  capability. Those overrides live in [`deploy`](deploy) — the Xiaobo deployment
  layer — so installing a capability bundle can never silently redefine the product.
- **Desktop (Electron) is the strictest target.** Every `@deepseek-ai/*` import must be a
  `peerDependency` with an exact `devDependency` twin, never a runtime `dependency` (Desktop's
  `validateDesktopPluginGraph` rejects the whole profile otherwise); the package must publish
  prebuilt `lib/index.js`, carry no install scripts, and be installable from the npm registry at an
  exact version. `pnpm run check:manifests` enforces the machine-checkable half of this — see
  [`docs/desktop-plugin-limits.md`](docs/desktop-plugin-limits.md) for the full gate list.

## Package shape

Every directory under `packages/` follows this shape:

```
packages/<name>/
├── package.json          # name, dsh.bundle.patch, peerDeps + exact devDeps, scripts
├── cordis.patch.yml      # the layer this bundle inserts, fully commented
├── tsconfig.json         # extends ../../tsconfig.base.json, includes src + tests
├── tsdown.config.ts      # entry src/index.ts → lib/index.js + lib/index.d.ts
├── src/index.ts          # export const name / inject / Config / apply
├── src/*.ts              # supporting modules (data, renderers)
└── tests/*.spec.ts       # unit tests + a real-registry integration test
```

`deploy/` is the one exception to the shape: it keeps `package.json` + `cordis.patch.yml` +
`README.md` and has no `src/`, `tsdown.config.ts`, tsconfig, or tests, because it ships no code.
`pnpm run check:manifests` covers it too — a bundle without a declared `main` is valid as long as
it declares `dsh.bundle.patch`.

`src/index.ts` exports, in the function-plugin form the harness documents:

- `name` — Cordis plugin name, stable, kebab-case;
- `inject` — the services `apply` needs, ready before it runs;
- `Config` — a schemastery `Schema<Config>` (not a plain object);
- `apply(ctx, config)` — registers capabilities; all registrations are effects and clean up
  on unload.

## Docs

`docs/` holds the Chinese design and analysis documents that justify the packages — the plugin
index and install routes (`docs/plugins.md`), the prompt inventory and section placement
(`docs/xiaobo-prompt.md`), the DocManager refactor (`docs/docmanager.md`), and the Desktop loading
limits (`docs/desktop-plugin-limits.md`). They are the reference for *why* a section sits at a given
order; keep them in sync when placement changes, and cross-link rather than duplicating a fact in
two places.

## File and comment style

- **Chinese by default for every human-facing document**: every `README.md` (root, `deploy/`,
  `packages/*/`, `dev/`), `docs/*.md`, and the `zh` prompt payloads.
- **English** for identifiers, file names, code comments, JSDoc, commit messages, and YAML/patch
  comments (`cordis.patch.yml`) — these sit next to code and are read alongside it.
- One-sentence JSDoc on every exported symbol: what it is, not how it works. Document the *why*
  only where a reader would otherwise make a wrong assumption (e.g. why a section is not a
  context).
- Tests assert observable contracts (registered names, assembly order, rendered text), not
  implementation details.

## Commands

```sh
pnpm install
pnpm run check        # typecheck → build → test
pnpm --filter <name> run build
```

Run `pnpm run check` before every commit. `lib/` is generated and git-ignored — build before
installing a package into a dsh profile.

## Git

- Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
- Commit messages are English and describe the user-visible effect.
- One package per commit where practical; state the package name in the scope when it helps
  (`feat(xiaobo-persona): ...`).
