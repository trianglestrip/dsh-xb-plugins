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
`"You are an AI agent powered by DeepSeek Harness."`) unless the row disables it. For a
white-label Xiaobo deployment, turn it off in the **profile's own** patch layer, which
outranks every bundle layer:

```yaml
# $DSH_HOME/profiles/xb/cordis.patch.yml
- id: system-prompt
  config:
    includeHarnessIdentity: false
    # A patch replaces the row's whole config, so restate what the profile needs:
    personaPrefix: ''
    personaSuffix: ''
```

This bundle deliberately does **not** override the `system-prompt` row: replacing its config
would clobber persona values set by other bundles (`dsh-web-app` sets them too).

## What this package does not do

- It does not register runtime context. CAD service health and DocManager's visible knowledge
  scope change during a session and must go through `systemPrompt.context()` in a separate
  plugin — a section would rewrite the system surface and open a new request series.
- It does not define tools or MCP servers. DocManager connects through
  `@deepseek-ai/dsh-mcp-client`; its server `instructions` become the `mcp:<server>` section
  at order 3100 automatically.
- It does not pin `toolOrder`. Tool ordering is a deployment-wide concern shared with the
  CAD/Python providers and belongs in the `system-prompt` row config.
