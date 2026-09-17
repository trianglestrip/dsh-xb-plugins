# dsh-xb-plugins

Xiaobo (小博) plugin collection for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

Each package under `packages/` is an independently installable **dsh bundle**: it ships a
`cordis.patch.yml` layer and a compiled plugin entry, and declares `dsh.bundle` in its
`package.json`. Nothing here is a fork of the harness; every package consumes the published
`@deepseek-ai/*` packages as peers and is loaded by the host harness.

## Packages

| Package | Registers | Status |
|---|---|---|
| [`dsh-xb-deploy`](packages/deploy) | Deployment-wide harness policy: drops the in-box harness identity and the generic `dsh-web-app` persona; later owns `toolOrder` and the DocManager MCP row | v0.1.0 |
| [`dsh-xb-xiaobo-persona`](packages/xiaobo-persona) | Xiaobo identity + domain/safety/interaction policy prompt sections | v0.1.0 |
| *(next)* `dsh-xb-docmanager` | DocManager knowledge scope as runtime context | planned |

## Design docs

Background and placement rationale behind the packages, written before the code:

- [`docs/xiaobo-prompt.md`](docs/xiaobo-prompt.md) — the Xiaobo prompt inventory, the fragment plan,
  and where each fragment lands in the DeepSeek Harness turn flow (`systemPrompt.section()` orders).
- [`docs/docmanager.md`](docs/docmanager.md) — the DocManager refactor: what stays (local knowledge
  data), what moves (MCP tool surface + `MCP_SERVERS` section), and what goes away (the second
  system prompt and the forced first-turn tool choice).

## Toolchain

| Tool | Version | Source |
|---|---|---|
| Node.js | ^22.19.0 \|\| >=24 | host requirement of the harness |
| pnpm | 12.3.4 | `packageManager` in the root manifest |
| TypeScript | ^6.0.3 | `catalog:` in `pnpm-workspace.yaml` |
| tsdown | ^0.22.2 | `catalog:` |
| vitest | ^4.1.8 | `catalog:` |

Version-sensitive dependencies (the harness packages) are pinned to the exact release the
target harness build uses, so type checking and runtime agree.

## Commands

```sh
pnpm install          # link workspace packages and install peers
pnpm run check        # typecheck + build + test, in that order
pnpm run typecheck    # tsc --noEmit for every package
pnpm run build        # tsdown → packages/*/lib/{index.js,index.d.ts}
pnpm run test         # vitest run
```

`lib/` is generated and git-ignored; build before installing a package into a dsh profile.

## Load into a harness

Both routes are documented in [`dev/README.md`](dev/README.md). The short version, from a
harness source checkout:

```sh
# 1. build this repo once
pnpm install && pnpm run build

# 2. install the bundle into a profile and boot it
pnpm dsh plugin --profile xb add ../../dsh-xb-plugins/packages/xiaobo-persona
pnpm dsh --profile xb
```

## Add a plugin

1. `mkdir packages/<name>` and copy the shape of `packages/xiaobo-persona`
   (`package.json` with `dsh.bundle`, `cordis.patch.yml`, `tsconfig.json`,
   `tsdown.config.ts`, `src/index.ts`, `tests/`).
2. Add the harness packages you consume as `peerDependencies`, and the exact same
   versions as `devDependencies` for type checking.
3. Keep `deps.neverBundle: [/^@deepseek-ai\//]` so the host supplies its own runtime.
4. `pnpm run check`.

See [`AGENTS.md`](AGENTS.md) for the conventions this repo enforces (English code and
comments, plugin shape, config over hardcoding).
