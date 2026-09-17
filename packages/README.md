# 插件索引与使用方法

本目录每个子目录都是**一个独立的 dsh bundle**（DeepSeek Harness 插件包）：可以单独安装、单独发版、
单独启用/禁用，彼此不构成依赖关系。每个包自己的 `README.md` 讲该包的能力与 config 细节，本文件讲
**有哪些插件、怎么装、装到哪**。

---

## 1. 索引

| 包 | 类型 | 作用 | 产物 / 落点 |
|---|---|---|---|
| [`deploy`](deploy) | **部署层**（纯 patch，零代码） | 覆盖 in-box row：关掉 `harness:identity`、清空 `dsh-web-app` 的通用 persona；后续承载 `toolOrder` 固定与 DocManager MCP 行 | 改 `system-prompt` 行 |
| [`xiaobo-persona`](xiaobo-persona) | **能力 bundle**（有代码） | 小博身份、接口调用约束、安全红线、交互规范、专业客观性、产品帮助 | 6 个 `systemPrompt.section()`：order 0 / 400 / 410 / 420 / 430 / 10200 |

规划中：`xiaobo-docmanager`（把 DocManager 可见知识信源注册为运行时 context）。

## 2. 两个包如何配合

```
dsh-xb-deploy          ← 只做「组合」：覆盖 in-box row（会整体替换该 row 的 config）
dsh-xb-xiaobo-persona  ← 只做「能力」：注册自己的 row / section
```

规则（见 [`../AGENTS.md`](../AGENTS.md)）：**能力插件绝不 patch 别人的 row**，组合值一律进 `deploy`。
原因：覆盖 `system-prompt` 会连带清掉 `dsh-web-app` 写的 persona，这是产品组合决策，不是 persona 能力；
而且 Desktop 的第三方 bundle 层序是**包名字典序**，"谁赢哪一行"属于组合事实而非插件事实。

一次 Xiaobo 部署**装两个包**，顺序无关（Web/CLI 按安装序、Desktop 按包名字典序）。

## 3. 前置：构建

`lib/` 是生成物且被 git 忽略，任何安装方式前都要先构建：

```sh
pnpm install
pnpm run build        # → packages/*/lib/index.js + lib/index.d.ts
pnpm run check        # manifest 守卫 + tsc + build + vitest
```

---

## 4. 用法 A：Web / CLI profile（源码 checkout）

适用于 `dsh web` 与 CLI。每个包声明了 `dsh.bundle`，`dsh plugin add` 会链接它并把包名追加进 profile 的
bundle 列表。

```sh
# 在 harness 源码 checkout 里
pnpm dsh plugin --profile xb add <repo>/packages/deploy
pnpm dsh plugin --profile xb add <repo>/packages/xiaobo-persona
pnpm dsh --profile xb
```

`add`/`remove` 支持任意 pnpm 参数与任意来源（本地路径 / git / tarball），也可以直接手改
`$DSH_HOME/profiles/xb/cordis.patch.yml` 或加 `--patch` overlay。

验证组合（不启动）：

```sh
pnpm dsh --profile xb --dump-config | grep -A4 'dsh-xb-deploy\|dsh-xb-xiaobo-persona'
```

## 5. 用法 B：一次性 overlay（`--patch`）——只用于迭代

不改 profile，直接把构建产物按绝对路径挂进一次启动：

```sh
pnpm run build
node scripts/dev-patch.mjs       # 生成 dev/cordis.xiaobo.local.yml（机器相关，已 gitignore）
pnpm dsh web --patch <repo>/dev/cordis.xiaobo.local.yml
```

也可以叠上部署层一起看效果：

```sh
pnpm dsh web \
  --patch <repo>/packages/deploy/cordis.patch.yml \
  --patch <repo>/dev/cordis.xiaobo.local.yml
```

> 该路径**Desktop 不支持**（Desktop 不读 `--patch` 覆盖层，见下）。

## 6. 用法 C：Desktop（Electron）

Desktop 的 profile 由 Electron 独占，安装能力被收窄成结构化操作：

- 只接受 **npm registry 包名**（可带 `@版本` 或 tag），安装时 `--save-exact`；
  `file:` / 相对路径 / 绝对路径 / `git:` / tarball / 任意 pnpm 参数全部被 `packageNameFromSpec` 拒绝。
- registry 硬编码 `https://registry.npmjs.org/`，环境里的 `npm_*` / `NODE_OPTIONS` 等一律被剔除，
  所以本地 registry 也不可用。
- CLI 拒绝管理：`dsh --profile desktop` / `dsh plugin --profile desktop` 直接报
  `profile "desktop" is managed exclusively by the Electron application`。
- 没有 `--patch` 覆盖层、没有 home patch 层、没有 HMR，改动 = 重启 Host。
- 校验失败**不回滚**，需要手动禁用/修复/重置 profile。

### C1 正式路径（需要先发布到 npm）

Desktop 只认 registry，所以先发布这两个包（精确版本，`0.1.0`）：

```sh
pnpm run check
pnpm --filter dsh-xb-deploy publish --access public
pnpm --filter dsh-xb-xiaobo-persona publish --access public
```

然后在 Desktop 的插件窗口里**逐个添加**：

```text
dsh-xb-deploy@0.1.0
dsh-xb-xiaobo-persona@0.1.0
```

- 两个包都是直接依赖 → 都会成为 bundle 层，层序为包名字典序（`dsh-xb-deploy` 在前）。
- 更新必须显式给目标版本（UI 里手动输入），没有 "update to latest"。
- 发布后名称要固定：Desktop 的 profile 依赖精确版本，改名等于换包。

### C2 本地验证路径（不发布，直接写 profile patch）

`$DSH_HOME/profiles/desktop/cordis.patch.yml` 仍然会被读取，且它的层序在 bundle 层之后、桌面组合层之前。
这个文件本来就用来挂本机 MCP，因此可以同样挂本地构建的插件：

```yaml
# %USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml
#
# 1) 部署层内容（覆盖 in-box row）
- id: system-prompt
  config:
    includeHarnessIdentity: false
    personaPrefix: ''
    personaSuffix: ''

# 2) 能力插件（绝对路径指向构建产物）
- insert:
    - id: xiaobo-persona
      name: '<repo>/packages/xiaobo-persona/lib/index.js'
```

保存后**重启 Desktop** 生效。

这条路径的性质（务必知道）：

| 项 | 实际情况 |
|---|---|
| 是否被插件窗口管理 | 否。row 不在 `dsh.profile.bundles` 里，插件窗口看不到、不能开关、`disable-all` 也管不到 |
| 是否过 Desktop 依赖闸 | 否。`validateDesktopPluginGraph` 只校验 bundle 列表里的包，手写 row 绕过了它 |
| profile 重置 | 会被删除（重置清空 profile 目录，除 lock 外） |
| 运行时依赖 | 插件只 import `@deepseek-ai/schemastery`，需要它从插件目录可解析 —— `<repo>/packages/xiaobo-persona/node_modules` 里已有（`pnpm install` 装的 3.18.2，与 Desktop 内置同版本） |
| 定位 | **本机验证 / 内测用途，不是发布路径**。要交付给用户请在 C1 发布 |

## 7. 用法 D：测试里以编程方式挂载

不需要 harness 启动，直接挂真实 registry 断言装配顺序与渲染文本：

```sh
pnpm --filter dsh-xb-xiaobo-persona run test
```

契约测试在 [`xiaobo-persona/tests/integration.spec.ts`](xiaobo-persona/tests/integration.spec.ts)，
覆盖：默认装配顺序、与 registry 保留名不冲突、locale 与 include 开关、部署层关掉 `harness:identity`。

---

## 8. 配置速查（`dsh-xb-xiaobo-persona`）

全部可选，schema 自带默认值（默认英文 + 六段全开），所以**不配置就是可用状态**：

| 字段 | 默认 | 说明 |
|---|---|---|
| `locale` | `en` | `zh` 切换全部片段语言 |
| `includeIdentity` … `includeProductHelp` | `true` | 逐段开关 |
| `interpolate` | registry 默认（`true`） | 覆盖文本里带 `{{...}}` 字面量时设 `false` |
| `identity` … `productHelp` | 内置片段 | 非空时替换该段文本 |

`dsh-xb-deploy` 目前没有 config（值写在它自己的 `cordis.patch.yml` 里）。

## 9. 验证清单

```sh
pnpm run check                                                   # 本仓库：manifest 守卫 + 类型 + 构建 + 测试
pnpm dsh --profile xb --dump-config                              # Web/CLI：组合与层序
pnpm dsh --profile xb                                             # 启动；persona 对每个会话生效
```

期望的 section 顺序（`system-prompt/assemble`）：

```
[xiaobo:identity]  →  [xiaobo:domain-policy]  →  [xiaobo:safety-redlines]
                   →  [xiaobo:interaction-norms]  →  [xiaobo:objectivity]
                   →  …(工具带 / MCP_SERVERS 3100)…  →  [xiaobo:product-help]
```

开部署层后 `harness:identity`（原 order −1000）不再出现，渲染文本以 `You are "Xiaobo"` 开头。
