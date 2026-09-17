# 开发脚本与本地覆盖层

本目录只讲**开发期**怎么把尚未发布的插件临时挂进 harness。完整的安装方式（Web/CLI profile、
一次性 overlay、Desktop、测试内挂载）与配置速查见 [`../docs/plugins.md`](../docs/plugins.md)。

## 仓库脚本

| 脚本 | 作用 |
|---|---|
| `scripts/dev-patch.mjs` | 生成 `dev/cordis.xiaobo.local.yml`：把构建产物按**本机绝对路径**挂进一次启动的 overlay。路径是本机相关，文件已 gitignore |
| `scripts/check-manifests.mjs` | Desktop manifest 守卫：`dsh.bundle.patch` 合法、`@deepseek-ai/*` 不得出现在运行时依赖、host peer 必须有精确 devDep 配对、预构建入口在 `files` 里、非 private、精确版本 |

```sh
pnpm run dev:patch        # = node scripts/dev-patch.mjs
pnpm run check:manifests  # 已包含在 pnpm run check 里
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
（`profile "desktop" is managed exclusively by the Electron application`）。Desktop 的两种路径
（发布 npm 后从插件窗口安装 / 手写 profile patch 做本机验证）见
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
