# Loading these plugins into a harness

Three routes. A and B are Web/CLI only; C is the Electron Desktop app. Desktop cannot use A or B
— see [`../docs/desktop-plugin-limits.md`](../docs/desktop-plugin-limits.md).

## Route C — Desktop (Electron) app

Desktop does not accept paths, links, git or tarballs, does not read `--patch` overlays, and refuses
to let the CLI touch its profile (`profile "desktop" is managed exclusively by the Electron
application`). The only way in is a published **registry package with an exact version**, installed
from the app's plugin window:

```sh
# one-time, by the publisher
pnpm run check
pnpm --filter dsh-xb-deploy publish --access public
pnpm --filter dsh-xb-xiaobo-persona publish --access public
```

Then in Desktop, add **both** (they are independent bundles; the deployment layer carries the
composition values, the capability bundle carries the prompt sections):

```text
dsh-xb-deploy@0.1.0
dsh-xb-xiaobo-persona@0.1.0
```

Updates require naming the target version explicitly (there is no "latest" action), the Host
restarts, and there is no rollback if the new version fails validation.

Because the plugin window cannot edit config, deployment values (`locale`, section toggles) must be
baked into the bundle's own `cordis.patch.yml` row; alternatively hand-edit
`$DSH_HOME/profiles/desktop/cordis.patch.yml`, which Desktop still reads.

## Route A — one-off overlay (`--patch`)

Works against a harness **source checkout** and needs no profile. The row points at the built
entry by absolute path, so generate the overlay on this machine first:

```sh
# in dsh-xb-plugins
pnpm run build
node scripts/dev-patch.mjs          # writes dev/cordis.xiaobo.local.yml

# in the harness checkout
pnpm dsh web --patch <path-to>/dsh-xb-plugins/dev/cordis.xiaobo.local.yml
```

The generated file is machine-specific and git-ignored. Loader rows must resolve; if you point
at `src/index.ts` instead of `lib/index.js`, the harness loads the TypeScript directly (slower,
but no build step).

## Route B — install the bundle into a profile (`dsh plugin add`)

Each package declares `dsh.bundle` with its patch file, so `dsh plugin add` links it and appends
it to the profile's bundle list.

```sh
# in dsh-xb-plugins
pnpm install && pnpm run build

# in the harness checkout
pnpm dsh plugin --profile xb add <path-to>/dsh-xb-plugins/packages/deploy
pnpm dsh plugin --profile xb add <path-to>/dsh-xb-plugins/packages/xiaobo-persona
pnpm dsh --profile xb
```

Verify the layers without booting:

```sh
pnpm dsh --profile xb --dump-config | grep -A3 'dsh-xb-deploy\|dsh-xb-xiaobo-persona'
```

Remove them with `pnpm dsh plugin --profile xb remove <name>`.

## Where each plugin's config lives

| Concern | Layer | Why |
|---|---|---|
| Enable/disable the plugin row, locale, section toggles, text overrides | the capability bundle's own row `config` | capability-owned values; the profile patch can still override them |
| Suppressing `harness:identity`, clearing the `web-app` persona, pinning `toolOrder` | `packages/deploy` (the deployment layer), or the profile's own `cordis.patch.yml` | these override an **in-box row**, so they are composition changes; a patch replaces the row's whole config |
| DocManager MCP connection | an `@deepseek-ai/dsh-mcp-client` row (planned: `packages/deploy`) | transport config, not a prompt concern |

## Verifying the sections actually landed

```sh
pnpm dsh --profile xb --dump-config     # composition check
pnpm dsh --profile xb                   # boot; the persona applies to every session
```

A faster contract check that needs no harness boot lives in
`packages/xiaobo-persona/tests/integration.spec.ts`: it mounts the real
`@deepseek-ai/dsh-system-prompt` registry and asserts the assembly order.
