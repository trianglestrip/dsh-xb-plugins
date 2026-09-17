# dsh-xb-xiaobo-persona

Xiaobo (小博) identity and engineering-policy prompt sections for DeepSeek Harness.

The plugin contributes six ordered `systemPrompt.section()` registrations and nothing else —
no tools, no services, no runtime state. Tool surfaces (`cad_*`, `python_*`, the DocManager
MCP) stay owned by their own providers; this package only tells the model who it is and how
it must behave.

## Sections

| Section | Order | Content |
|---|---|---|
| `xiaobo:identity` | 0 (`DEPLOYMENT_PERSONA_PREFIX`) | Full-stack power-engineering design agent; working-directory knowledge model |
| `xiaobo:domain-policy` | 400 | CAD invocation via `cad_*`, Python via `python_*`, HTTP status/idempotency contract |
| `xiaobo:safety-redlines` | 410 | Human-in-the-loop stop for destructive/large-scope operations; credential and injection isolation |
| `xiaobo:interaction-norms` | 420 | Single-line progress reporting for long calls; ask for missing boundary conditions instead of guessing |
| `xiaobo:objectivity` | 430 | Technical accuracy over agreement |
| `xiaobo:product-help` | 10200 (`DEPLOYMENT_PERSONA_SUFFIX`) | Bochao documentation entry point and `/help` |

Orders 400–430 sit between the deployment persona (0) and the first-party plan policy (500),
so domain and safety guidance precedes every tool band (`TOOL_BASH` 1000 … `MCP_SERVERS` 3100).
The identity and help sections reuse the registry's own reserved orders but **not** its
reserved names: `dsh-system-prompt` registers `deployment:persona-prefix` /
`deployment:persona-suffix` globally from its config, and an unscoped duplicate name fails the
load. Empty registry sections are dropped at render, so by default only the Xiaobo text appears.

## Config

All fields are optional; the schema carries the defaults.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `locale` | `'en' \| 'zh'` | `'en'` | Which shipped fragment text to use |
| `includeIdentity` … `includeProductHelp` | `boolean` | `true` | Register or drop each section |
| `interpolate` | `boolean` | registry default (`true`) | Set `false` when an override carries literal `{{…}}` |
| `identity` … `productHelp` | `string` | shipped fragment | Non-empty value replaces the fragment for that section |

```yaml
- id: xiaobo-persona
  name: dsh-xb-xiaobo-persona
  config:
    locale: zh
    includeObjectivity: false
```

## Install

```sh
# in a harness source checkout, with this repo already built
pnpm dsh plugin --profile xb add <path-to>/dsh-xb-plugins/packages/xiaobo-persona
pnpm dsh --profile xb
```

Or boot a source checkout with a one-off overlay — see [`../../dev/README.md`](../../dev/README.md).

## Deployment note: the harness identity line

`dsh-system-prompt` prepends its own `harness:identity` section (order −1000,
`"You are an AI agent powered by DeepSeek Harness."`) unless the row disables it. A white-label
Xiaobo deployment turns it off in [`dsh-xb-deploy`](../deploy), the deployment layer that owns
every override of an in-box row:

```yaml
# packages/deploy/cordis.patch.yml
- id: system-prompt
  config:
    includeHarnessIdentity: false
    # A patch replaces the row's whole config, so restate what the deployment needs:
    personaPrefix: ''
    personaSuffix: ''
```

This bundle deliberately does **not** override the `system-prompt` row. Replacing that row's config
is a composition change — it also clears the persona values `dsh-web-app` sets — so it belongs in the
deployment layer, not in a reusable capability. A profile that wants both installs both bundles.

## Desktop (Electron) compatibility

Desktop composes a different profile from Web/CLI and validates every third-party bundle against the
runtime it ships. The gates that matter here:

| Gate | Requirement | Status |
|---|---|---|
| Bundle form | package declares `dsh.bundle.patch`; patch file exists inside the package | ✓ |
| Host packages are peers | every `@deepseek-ai/*` imported at runtime must be a `peerDependency`, never a `dependency` | ✓ (`schemastery` moved out of `dependencies`) |
| Peer ranges | must satisfy the bundled versions (`cordis@4.0.2`, `dsh-system-prompt@0.1.6-alpha.1`, `schemastery@3.18.2`) | ✓ |
| Registry-only install | `file:` / `link:` / path / git / tarball are rejected; only npm registry names, at an exact version | requires publishing to npm |
| No service gap | must not inject `webServer` / `webStartup` / `webRuntime` | ✓ (only `systemPrompt`) |
| Prebuilt JS | Desktop never compiles TypeScript; `lib/index.js` must be in the published tarball | ✓ (`prepack` builds) |
| No install scripts | install runs with `--ignore-scripts` and a fixed `allowBuilds` list | ✓ |

Desktop-specific consequences:

- **No `--patch` overlay, no home layer.** The Web/CLI overlay route in
  [`../../dev/README.md`](../../dev/README.md) does not apply; Desktop installs registry packages
  through its own plugin window only.
- **The plugin window cannot edit config.** Anything the deployment needs (`locale`, section
  toggles, text overrides) must be baked into this bundle's own `cordis.patch.yml` row, or written
  by hand into `$DSH_HOME/profiles/desktop/cordis.patch.yml`.
- **Bundle layer order is package-name alphabetical**, not install order, so when two third-party
  bundles patch the same row the alphabetically later one wins. This package only `insert`s its own
  row, so it is order-independent today; keep it that way.
- **No reload/HMR.** Changing prompt text means a new version, an explicit
  `plugin-update <version>`, and a Host restart.
- **Failure is not rolled back.** A bundle that fails validation stays installed and the profile
  needs manual disable/fix/reset, so publish only after `pnpm run check` is green.

Because Desktop has no config editor and no overlay, the in-band way to suppress `harness:identity`
is a bundle that overrides the `system-prompt` row — and a patch replaces that row's whole config,
including the persona values `dsh-web-app` sets. That is [`dsh-xb-deploy`](../deploy)'s job, not this
package's.

## What this package does not do

- It does not register runtime context. CAD service health and DocManager's visible knowledge
  scope change during a session and must go through `systemPrompt.context()` in a separate
  plugin — a section would rewrite the system surface and open a new request series.
- It does not define tools or MCP servers. DocManager connects through
  `@deepseek-ai/dsh-mcp-client`; its server `instructions` become the `mcp:<server>` section
  at order 3100 automatically.
- It does not pin `toolOrder`. Tool ordering is a deployment-wide concern shared with the
  CAD/Python providers and belongs in the `system-prompt` row config.
