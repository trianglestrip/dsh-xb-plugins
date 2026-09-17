# Loading these plugins into a harness

Two routes. Use the overlay for iteration, the profile install for anything you intend to keep.

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
pnpm dsh plugin --profile xb add <path-to>/dsh-xb-plugins/packages/xiaobo-persona
pnpm dsh --profile xb
```

Verify the layer without booting:

```sh
pnpm dsh --profile xb --dump-config | grep -A3 'dsh-xb-xiaobo-persona'
```

Remove it with `pnpm dsh plugin --profile xb remove dsh-xb-xiaobo-persona`.

## Where each plugin's config lives

| Concern | Layer | Why |
|---|---|---|
| Enable/disable the plugin row, locale, section toggles, text overrides | the bundle's own row `config` (profile patch can override) | deployment choice owned by this repo's schema |
| Suppressing `harness:identity`, pinning `toolOrder` | the **profile's** `cordis.patch.yml` | shared with other bundles; a patch replaces the row's whole config, so the profile is the right place to restate it |
| DocManager MCP connection | an `@deepseek-ai/dsh-mcp-client` row | transport config, not a prompt concern |

## Verifying the sections actually landed

```sh
pnpm dsh --profile xb --dump-config     # composition check
pnpm dsh --profile xb                   # boot; the persona applies to every session
```

A faster contract check that needs no harness boot lives in
`packages/xiaobo-persona/tests/integration.spec.ts`: it mounts the real
`@deepseek-ai/dsh-system-prompt` registry and asserts the assembly order.
