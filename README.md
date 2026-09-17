# dsh-xb-plugins

小博（Xiaobo）的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件集合。

## 仓库结构

```
dsh-xb-plugins/
├─ packages/            ← 只放插件：每个子目录一个独立可安装的 bundle
│  └─ xiaobo-persona/        小博身份与工程规范提示词（有代码）
├─ deploy/              ← 部署层：纯 patch、零代码，不是插件
├─ docs/                ← 中文设计/分析文档 + 插件索引
├─ dev/                 ← 开发脚本说明 + 本机生成的 overlay（gitignore）
└─ scripts/             ← check-manifests / dev-patch / desktop-snippet / desktop-composition / desktop-prompt / gen-agent-preset
```

Desktop 不发布（profile patch + agent preset）的完整插入流程、验证命令与选型对照，见
[`docs/plugins.md`](docs/plugins.md) 第 6 节与 [`docs/xiaobo-prompt.md`](docs/xiaobo-prompt.md) §3.7。

`packages/` 下每个插件都随包交付一个 `cordis.patch.yml` 配置层与编译好的插件入口，并在
`package.json` 里声明 `dsh.bundle`；`deploy/` 只交付前者。本仓库不是 harness 的 fork —— 每个包都以
peer 方式消费已发布的 `@deepseek-ai/*` 包，由宿主 harness 自己加载运行。

> 完整的插件清单、四种安装方式（Web/CLI profile、一次性 overlay、Desktop、测试内挂载）与配置速查，
> 见 [`docs/plugins.md`](docs/plugins.md)。

## 插件与部署层

| 产物 | 类型 | 注册内容 | 状态 |
|---|---|---|---|
| [`packages/xiaobo-persona`](packages/xiaobo-persona) | **插件**（有代码） | 小博身份 + 接口约束 / 安全红线 / 交互规范 / 客观性等提示词 section | v0.1.0 |
| [`deploy`](deploy) | **部署层**（纯 patch，非插件） | 关掉内置 `harness:identity`、清空 `dsh-web-app` 的通用 persona；后续承载 `toolOrder` 与 DocManager MCP 行 | v0.1.0 |
| *(规划中)* `packages/xiaobo-docmanager` | 插件 | 把 DocManager 可见知识信源注册为运行时 context | — |

分界线：**能力进 `packages/`，"产品如何组合"进 `deploy/`**。能力插件绝不 patch 别人的 row。

## 设计文档

先有结论、后有代码，放置理由都在这里：

- [`docs/xiaobo-prompt.md`](docs/xiaobo-prompt.md) —— 小博提示词清点（改动提交、12 个被改文件、逐字原文、
  被删的 `xiaobo.txt` 中文人设）、整理方案，以及每段在 DeepSeek Harness 回合流里落到哪个
  `systemPrompt.section()` order。
- [`docs/docmanager.md`](docs/docmanager.md) —— DocManager 改造：什么保留（本地知识数据面）、什么上移
  （MCP 工具面 + `MCP_SERVERS` 段）、什么删除（第二套 system prompt 与首轮强制 tool_choice）。
- [`docs/desktop-plugin-limits.md`](docs/desktop-plugin-limits.md) —— Desktop（Electron）相对 Web/CLI 的
  插件加载限制对照。

## 工具链

| 工具 | 版本 | 来源 |
|---|---|---|
| Node.js | ^22.19.0 \|\| >=24 | harness 的宿主要求 |
| pnpm | 12.3.4 | 根 `package.json` 的 `packageManager` |
| TypeScript | ^6.0.3 | `pnpm-workspace.yaml` 的 `catalog:` |
| tsdown | ^0.22.2 | 同上 |
| vitest | ^4.1.8 | 同上 |

对版本敏感的依赖（harness 包）与目标 harness 构建**精确对齐**：`peerDependencies` 给范围，
`devDependencies` 给同版本精确值，保证类型检查与运行时一致。

## 常用命令

```sh
pnpm install          # 链接 workspace 包并安装 peer
pnpm run check        # manifest 守卫 → typecheck → build → test
pnpm run typecheck    # 每个包 tsc --noEmit
pnpm run build        # tsdown → packages/*/lib/{index.js,index.d.ts}
pnpm run test         # vitest run
```

`lib/` 是生成物且被 git 忽略：**装进 dsh profile 之前必须先构建**。

## 装进 harness

最短路径（harness 源码 checkout 里执行）：

```sh
# 1. 先构建本仓库
pnpm install && pnpm run build

# 2. 把两个 bundle 装进 profile 并启动
pnpm dsh plugin --profile xb add ../../dsh-xb-plugins/deploy
pnpm dsh plugin --profile xb add ../../dsh-xb-plugins/packages/xiaobo-persona
pnpm dsh --profile xb
```

Desktop（Electron）只能从 npm registry 按精确版本安装，步骤见
[`docs/plugins.md`](docs/plugins.md) 第 6 节。

## 新增插件

1. `mkdir packages/<name>`，照抄 `packages/xiaobo-persona` 的形状（`package.json` 带 `dsh.bundle`、
   `cordis.patch.yml`、`tsconfig.json`、`tsdown.config.ts`、`src/index.ts`、`tests/`）。
2. 把用到的 harness 包写进 `peerDependencies`，并把**同一版本**写进 `devDependencies` 供类型检查。
3. `tsdown.config.ts` 保留 `deps.neverBundle: [/^@deepseek-ai\//]`，让宿主提供自己的运行时实例。
4. `pnpm run check`。

若新东西是“覆盖 in-box row”的组合值而不是能力，不要放 `packages/`，放 [`deploy/`](deploy)（它
同样是 workspace 成员，但不上 `packages/` 的插件清单）。仓库强制的约定（插件形态、能力插件不得 patch
别人 row、Desktop manifest 约束等）见 [`AGENTS.md`](AGENTS.md)。
