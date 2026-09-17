# dsh-xb-deploy

The Xiaobo **deployment layer**: a patch-only dsh bundle carrying the configuration that belongs to
the product composition rather than to any one capability. It ships no code and inserts no rows of
its own — it only overrides in-box rows.

## Why a separate bundle

dsh composes a profile by stacking patch layers. The in-box bundles own their own values
(`dsh-base` supplies defaults, `dsh-web-app` supplies the browser surface), and a deployment is
expected to state where it differs. Two rules force the Xiaobo-specific values out of the capability
plugins:

1. **A patch replaces the target row's entire config.** Turning off `harness:identity` means
   restating `personaPrefix` / `personaSuffix` too, which wipes `dsh-web-app`'s generic persona. That
   is a deployment decision, and doing it inside `dsh-xb-xiaobo-persona` would surprise anyone who
   installed that plugin to reuse the persona in a profile that already has its own persona.
2. **Layer order differs per surface.** On Desktop the third-party bundle order is package-name
   alphabetical, not install order, so which bundle "wins" a row is a composition fact, not a plugin
   fact.

Keeping the override here means capability bundles stay pure: they register their own sections and
never patch another bundle's row.

## What it changes

```yaml
- id: system-prompt
  config:
    includeHarnessIdentity: false   # drop the in-box "powered by DeepSeek Harness" opener
    personaPrefix: ''               # clear dsh-web-app's generic coding-agent persona
    personaSuffix: ''
    # toolOrder omitted: schema default (lexicographic) applies for now
```

## Install

A Xiaobo deployment lists this bundle **and** the capability bundles it composes, in either order
(the order is normalised per surface: install order on Web/CLI, package-name order on Desktop).

```sh
# Web/CLI source checkout
pnpm dsh plugin --profile xb add <path-to>/dsh-xb-plugins/packages/deploy
pnpm dsh plugin --profile xb add <path-to>/dsh-xb-plugins/packages/xiaobo-persona
pnpm dsh --profile xb
```

```text
# Desktop, from the plugin window
dsh-xb-deploy@0.1.0
dsh-xb-xiaobo-persona@0.1.0
```

## Verify

```sh
pnpm dsh --profile xb --dump-config | sed -n '/system-prompt/,+5p'
```

The rendered system prompt starts with the Xiaobo identity instead of the harness opener; the
contract test lives in `packages/xiaobo-persona/tests/integration.spec.ts`
("drops the harness identity when the deployment layer suppresses it").

## What goes here next

Deployment-wide values only, never capability behaviour:

- `toolOrder` — pin `cad_*` / `python_*` / `mcp__docmanager__*` once those tool bundles land, so the
  tool catalog is byte-stable across steps.
- The DocManager `@deepseek-ai/dsh-mcp-client` row, when the deployment wants it on by default.
- Any `system-prompt` value a white-label build needs (`locale` of the *plugin* stays in the
  plugin's own row config; anything the registry owns goes here).
