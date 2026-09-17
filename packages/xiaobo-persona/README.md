# dsh-xb-xiaobo-persona

小博（Xiaobo）的身份与工程规范提示词 section，供 DeepSeek Harness 使用。

本插件只注册六个有序的 `systemPrompt.section()`，别的什么都不做 —— 无工具、无服务、无运行时状态。
工具面（`cad_*`、`python_*`、DocManager MCP）仍由各自的提供方拥有；本包只负责告诉模型"它是谁、
必须怎么做"。

## 注册的 section

| section | order | 内容 |
|---|---|---|
| `xiaobo:identity` | 0（`DEPLOYMENT_PERSONA_PREFIX`） | 工业厂站全栈智能设计 Agent；工作目录知识模型 |
| `xiaobo:domain-policy` | 400 | CAD 只走 `cad_*`、Python 只走 `python_*`、HTTP 状态码与幂等契约 |
| `xiaobo:safety-redlines` | 410 | 高风险/大范围操作必须 Human-in-the-Loop 暂停；凭证与注入隔离 |
| `xiaobo:interaction-norms` | 420 | 长耗时调用单行通报进度；缺边界条件先索取而非盲猜 |
| `xiaobo:objectivity` | 430 | 技术准确性优先于迎合 |
| `xiaobo:product-help` | 10200（`DEPLOYMENT_PERSONA_SUFFIX`） | Bochao 文档入口与 `/help` |

400~430 位于"部署 persona（0）"与"内置 plan policy（500）"之间，因此领域与安全规范排在**所有工具
指导带之前**（`TOOL_BASH` 1000 … `MCP_SERVERS` 3100）。身份段与帮助段复用了 registry 保留的
order，但**没有**用它的保留名：`dsh-system-prompt` 会在全局层注册 `deployment:persona-prefix` /
`deployment:persona-suffix`，全局重名会直接加载失败。空的 registry section 在渲染时被丢弃，所以
默认只会看到小博的文本。

## 配置

所有字段可选，默认值在 schema 里。**不配置就是可用状态**（英文 + 六段全开）。

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `locale` | `'en' \| 'zh'` | `'en'` | 使用哪一版内置片段文本 |
| `includeIdentity` … `includeProductHelp` | `boolean` | `true` | 逐段注册 / 丢弃 |
| `interpolate` | `boolean` | registry 默认（`true`） | 覆盖文本里含 `{{…}}` 字面量时设 `false` |
| `identity` … `productHelp` | `string` | 内置片段 | 非空时替换该段文本 |

```yaml
- id: xiaobo-persona
  name: dsh-xb-xiaobo-persona
  config:
    locale: zh
    includeObjectivity: false
```

## 安装

```sh
# 在 harness 源码 checkout 里，先构建本仓库
pnpm dsh plugin --profile xb add <path-to>/dsh-xb-plugins/packages/xiaobo-persona
pnpm dsh --profile xb
```

或用一次性 overlay 启动源码 checkout —— 见 [`../../dev/README.md`](../../dev/README.md)；
Desktop 的两种路径见 [`docs/plugins.md`](../../docs/plugins.md) 第 6 节。

## 部署注意：内置的 harness 身份行

`dsh-system-prompt` 会在 order −1000 自带一段 `harness:identity`
（`"You are an AI agent powered by DeepSeek Harness."`），除非那一行把它关掉。白标的小博部署在
[`dsh-xb-deploy`](../../deploy)（部署层，所有"覆盖 in-box row"的唯一住所）里关：

```yaml
# deploy/cordis.patch.yml
- id: system-prompt
  config:
    includeHarnessIdentity: false
    # patch 会整体替换该行 config，所以要把部署需要的键一并重申：
    personaPrefix: ''
    personaSuffix: ''
```

本包**故意不**覆盖 `system-prompt` 行。替换该行 config 属于组合变更 —— 它同时会清掉 `dsh-web-app`
写的 persona —— 所以归部署层，而不是可复用的能力插件。需要两者的 profile 就同时装两个 bundle。

## Desktop（Electron）兼容性

Desktop 组装的是另一套 profile，并且会用它自带的运行时校验每个第三方 bundle。与本包相关的闸门：

| 闸门 | 要求 | 现状 |
|---|---|---|
| bundle 形态 | 声明 `dsh.bundle.patch`，且 patch 文件在包目录内 | ✓ |
| 宿主包必须是 peer | 运行时 import 的每个 `@deepseek-ai/*` 必须是 `peerDependency`，不能是 `dependency` | ✓（`schemastery` 已从 `dependencies` 移出） |
| peer 版本范围 | 必须满足内置版本（`cordis@4.0.2`、`dsh-system-prompt@0.1.6-alpha.1`、`schemastery@3.18.2`） | ✓ |
| 只认 registry | `file:` / `link:` / 路径 / git / tarball 全被拒；只接受 npm 包名 + 精确版本 | 需要先发布到 npm |
| 服务不能缺 | 不得 inject `webServer` / `webStartup` / `webRuntime` | ✓（只用 `systemPrompt`） |
| 预构建 JS | Desktop 不编译 TypeScript；`lib/index.js` 必须在发布物里 | ✓（`prepack` 会构建） |
| 无安装脚本 | 安装用 `--ignore-scripts` + 固定 `allowBuilds` 白名单 | ✓ |

Desktop 特有的后果：

- **没有 `--patch` 覆盖层，也没有 home patch 层。** [`../../dev/README.md`](../../dev/README.md) 的
  overlay 路径在 Desktop 无效；Desktop 只通过自己的插件窗口安装 registry 包。
- **插件窗口不能编辑 config。** 部署需要的值（`locale`、段落开关）要么写死在本包自己的
  `cordis.patch.yml` row 里，要么手写进 `$DSH_HOME/profiles/desktop/cordis.patch.yml`。
- **bundle 层序是包名字典序**（不是安装序），两个第三方 bundle 改同一 row 时名字靠后的赢。本包只
  `insert` 自己的 row，天然与顺序无关；请保持这样。
- **没有热更新。** 改提示词文本 = 发新版本 + 显式 `plugin-update <version>` + 重启 Host。
- **失败不回滚。** 校验失败会留在 profile 里，需要手动禁用/修复/重置，所以务必 `pnpm run check` 全绿
  再发布。

Desktop 上没有 config 编辑器也没有 overlay，所以带内关掉 `harness:identity` 的唯一方式是让某个
bundle 覆盖 `system-prompt` 行 —— 而 patch 会整体替换该行 config（含 `dsh-web-app` 的 persona 值）。
那是 [`dsh-xb-deploy`](../../deploy) 的职责，不是本包的。

## 本包不做什么

- **不注册运行时 context。** CAD 服务健康状态、DocManager 可见知识范围会在会话中途变化，必须由独立
  插件通过 `systemPrompt.context()` 提供 —— 写成 section 会重写 system surface 并开启新的请求序列。
- **不定义工具或 MCP server。** DocManager 通过 `@deepseek-ai/dsh-mcp-client` 接入；它的 server
  `instructions` 会自动变成 order 3100 的 `mcp:<server>` section。
- **不固定 `toolOrder`。** 工具顺序是跨插件的部署级问题（与 CAD/Python 提供方共享），归
  `system-prompt` 行的 config。
