# 开发脚本与本地覆盖层

本目录只讲**开发期**怎么把尚未发布的插件临时挂进 harness。完整的安装方式（Web/CLI profile、
一次性 overlay、Desktop、测试内挂载）与配置速查见 [`../docs/plugins.md`](../docs/plugins.md)。

## 仓库脚本

| 脚本 | 作用 |
|---|---|
| `scripts/dev-patch.mjs` | 生成 `dev/cordis.xiaobo.local.yml`：把构建产物按**本机绝对路径**挂进一次启动的 overlay。路径是本机相关，文件已 gitignore |
| `scripts/desktop-snippet.mjs` | 生成 `dev/desktop-profile-patch.snippet.yml`：Desktop profile patch 的可粘贴片段（绝对路径，已 gitignore）。加 `--write` 则直接把同一段（带 marker，可重复执行）合并进 `$DSH_HOME/profiles/desktop/cordis.patch.yml`，保留文件里原有的 MCP 行 |
| `scripts/desktop-composition.mjs` | 用 Desktop 运行时自己的 `loadProfileDirectory` + `composeEntries` 复算 profile 的组合，断言 `system-prompt` 与 `xiaobo-persona` 两行确实生效（含该 row 的模块能被运行时 node 导入）。Desktop 没有 `--dump-config`，这是它的替代品 |
| `scripts/desktop-prompt.mjs` | 把上一步的组合真正**渲染成会话系统提示词**：用运行时自己的 `cordis` / `dsh-system-prompt` / `dsh-scope`，加上选中的 agent preset 的 persona 行，打印 section 渲染顺序、字符数、首尾文本，并断言六段各出现一次。它也是两条通道重复注入的检测器（preset 带文本 + 插件同时挂载 → 每段 2 次，退出码 1） |
| `scripts/desktop-local-plugin.mjs` | **本地插件通道**（不发布的第三种）：`add <dir\|file> [--id] [--entry] [--config]` / `list` / `remove <id>`，按 marker 块管理 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 里的 plugin row。不碰 `dependencies`，所以不过 Desktop 的精确版本与图校验；代价是插件窗口看不到、不能开关、profile 重置会清除。改本地插件后重启 Desktop 即生效（无需重打包） |
| `scripts/gen-agent-preset.mjs` | 把提示词投影成 Desktop 的 **agent preset**（`$DSH_HOME/.agent-presets/xiaobo/`）：不用发布、不用 registry、不用绝对路径，也不改任何原有配置。文本取自 `packages/xiaobo-persona`，并在写入前自检 YAML 与每行 `name` 可解析。`--persona plugin` 生成**persona 留空**的版本，配合 profile patch 里的插件使用；想让新会话默认用它，写**用户设置**（不是 patch）：`$DSH_HOME/settings.yaml` 的 `agent-presets` 命名空间 |
| `scripts/check-manifests.mjs` | Desktop manifest 守卫：`dsh.bundle.patch` 合法、`@deepseek-ai/*` 不得出现在运行时依赖、host peer 必须有精确 devDep 配对、预构建入口在 `files` 里、非 private、精确版本 |

```sh
pnpm run dev:patch                # = node scripts/dev-patch.mjs
pnpm run dev:desktop-snippet      # = node scripts/desktop-snippet.mjs（--write 才落盘 profile patch）
pnpm run dev:desktop-composition  # = node scripts/desktop-composition.mjs
pnpm run dev:desktop-prompt       # = node scripts/desktop-prompt.mjs（--full 打印整段提示词）
pnpm run dev:desktop-local-plugin # = node scripts/desktop-local-plugin.mjs（add/list/remove 本地插件）
pnpm run dev:agent-preset         # = node scripts/gen-agent-preset.mjs
pnpm run check:manifests          # 已包含在 pnpm run check 里
```

## 用覆盖层跑 harness（Web/CLI 源码 checkout）

不改 profile，直接挂绝对路径，适合迭代：

```sh
# 在 dsh-xb-plugins
pnpm run build
pnpm run dev:patch                    # 写出 dev/cordis.xiaobo.local.yml

# 在 harness 源码 checkout
pnpm dsh web --patch <repo>/dev/cordis.xiaobo.local.yml
```

如果还想同时看部署层（关掉 `harness:identity`）的效果，再叠一层：

```sh
pnpm dsh web \
  --patch <repo>/deploy/cordis.patch.yml \
  --patch <repo>/dev/cordis.xiaobo.local.yml
```

Loader 的 row 只要能被解析即可；把 `name` 指向 `src/index.ts` 而不是 `lib/index.js` 也能跑（harness 会
直接加载 TypeScript，慢一点，但省掉构建）。

## 为什么 Desktop 用不了覆盖层

Desktop 不读 `--patch`，没有 home patch 层，且 CLI 拒绝管理它的 profile
（`profile "desktop" is managed exclusively by the Electron application`）。Desktop 的不发布路径有两条：

1. **profile patch**（`pnpm run dev:desktop-snippet -- --write`）—— 把部署层内容与构建产物按绝对路径
   合并进 `$DSH_HOME/profiles/desktop/cordis.patch.yml`，得到真正的六个 section；
2. **agent preset**（`pnpm run dev:agent-preset`）—— 只带文本，persona 两槽。

两者**互斥**（同时启用会把同一段文本送两遍）：走插件时 preset 用 `--persona plugin`。完整对照见
[`../docs/plugins.md`](../docs/plugins.md) 第 6 节，限制细节见
[`../docs/desktop-plugin-limits.md`](../docs/desktop-plugin-limits.md)。

## 配置放哪一层

| 关注点 | 放哪 | 为什么 |
|---|---|---|
| 插件 row 的启停、`locale`、段落开关、文本覆盖 | 能力 bundle 自己的 row `config` | 能力自身的值；profile patch 仍可覆盖 |
| 关掉 `harness:identity`、清空 web-app persona、固定 `toolOrder` | `deploy`（部署层），或 profile 自己的 `cordis.patch.yml` | 这些是**覆盖 in-box row**，属于组合变更；patch 会整体替换该 row 的 config |
| DocManager MCP 连接 | `@deepseek-ai/dsh-mcp-client` 的 row（规划中放 `deploy`） | 传输配置，不是提示词问题 |

## 验证

```sh
pnpm dsh --profile xb --dump-config     # 组合与层序
pnpm dsh --profile xb                   # 启动；persona 对每个会话生效
```

不需要启动 harness 的更快契约检查在
`packages/xiaobo-persona/tests/integration.spec.ts`：它挂载**真实的** `@deepseek-ai/dsh-system-prompt`
registry，断言 section 装配顺序与渲染文本。
