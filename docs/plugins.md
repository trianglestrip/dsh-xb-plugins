# 插件索引与使用方法

本文件是**插件索引与使用方法**。

- [`packages/`](../packages)：**只放插件**。每个子目录是一个独立的 dsh bundle（DeepSeek Harness 插件包），可单独安装、单独发版、单独启用/禁用，彼此不构成依赖。每个插件自己的 `README.md` 讲它的能力与 config 细节。
- [`deploy/`](../deploy)：**不是插件**。纯 patch、零代码的部署层，集中放「覆盖 in-box row」的组合值。

---

## 1. 索引

| 包 | 类型 | 作用 | 产物 / 落点 |
|---|---|---|---|
| [`deploy`](../deploy) | **部署层**（纯 patch，零代码，不是插件） | 覆盖 in-box row：关掉 `harness:identity`、清空 `dsh-web-app` 的通用 persona；后续承载 `toolOrder` 固定与 DocManager MCP 行 | 改 `system-prompt` 行 |
| [`xiaobo-persona`](../packages/xiaobo-persona) | **能力 bundle**（有代码） | 小博身份、接口调用约束、安全红线、交互规范、专业客观性、产品帮助 | 6 个 `systemPrompt.section()`：order 0 / 400 / 410 / 420 / 430 / 10200 |

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
pnpm dsh plugin --profile xb add <repo>/deploy
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
  --patch <repo>/deploy/cordis.patch.yml \
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

### 选哪条：C0 还是 C2

Desktop 不接受本地路径规格，所以**不发布**时只剩两条路，它们**互斥**（persona 会重叠，同时启用等于把同一段
文本送两遍）。选哪条看你要不要 §3.7 那套完整定义：

| 要插入的东西 | C2 profile patch | C0 agent preset |
|---|---|---|
| 六段独立 section（order 0 / 400 / 410 / 420 / 430 / 10200） | ✅ 原样成立 | ❌ 五段合并为 persona 前缀（order 0），help 并入后缀 |
| 逐段开关、逐段文本覆盖、`locale` 切换 | ✅ 插件的 `config` | ❌ 生成时定型，改一段要重跑脚本 |
| 关掉内置 `harness:identity`（白标） | ✅ 一行 `system-prompt` config | ❌ 关不掉（只能改 host 行，那就已是 C2） |
| 将来加 CAD 健康 / 知识作用域 / roster（`systemPrompt.context()`） | ✅ 同一条 patch 再插一个插件 | ❌ preset 只带文本 |
| 工具行 / MCP server 行 | ✅ 同样手写 row | ❌ 带不了 |
| 定型时机 / 改文案代价 | Host 启动；改完重启 Desktop | 每个新会话；改完不用重启 |
| profile reset / 换机 / dsh 升级 | ⚠️ reset 会删、路径是本机的、升级后重跑 `--write` | ✅ 纯数据目录，重跑生成脚本即可，不参与 profile 事务 |
| 插件窗口 | ❌ 看不见、不能开关、不过依赖闸 | ❌ 不是插件（在模式选择器里） |
| 需要发布 / registry / 绝对路径 | 不需要发布；需要绝对路径 | 两者都不需要 |

**结论**：要“小博定义完整可扩展”（做 DocManager 的 `context()`、`toolOrder`）→ **C2**；要“随 Desktop 升级
自愈、绝不动 profile” → **C0**（代价是合并为两槽 + 内置身份行）。两者都不需要发布。

```sh
# C2（当前采用）：写 profile patch + 生成配套的 persona 留空 preset
pnpm run build
pnpm run dev:desktop-snippet -- --write
pnpm run dev:agent-preset -- --persona plugin
pnpm run dev:desktop-composition          # 验证组合

# C2′（本地插件通道）：不经发布、不改 profile 里的依赖，挂任意本地目录
pnpm run dev:desktop-local-plugin -- add <repo>/packages/xiaobo-persona --config '{"locale":"zh"}'
pnpm run dev:desktop-local-plugin -- list        # 看已挂的本地行（路径不存在会报 MISSING）
pnpm run dev:desktop-local-plugin -- remove <id>
# 重启 Desktop 生效；这些 row 不受插件窗口管理、不过依赖闸、profile 重置会清除

# C0（只留文本）：不碰 profile，把文本放回 preset
pnpm run build && pnpm run dev:agent-preset -- --persona preset
# 再从 profile patch 里删掉 '# >>> dsh-xb-plugins' 与 '# <<< dsh-xb-plugins' 之间那段
```

C2 的 row 形状、C3 已实测排除的路见下文；完整对照与验收方法见
[`xiaobo-prompt.md`](xiaobo-prompt.md) §3.7。

### C0：不发布、不改动原有配置 —— 把提示词做成 agent preset

Desktop 只对**插件**要求 registry 包，而 **agent preset 只是一个 YAML 目录**
（`$DSH_HOME/.agent-presets/<id>/`），roster 默认就扫它（`includeUserRoot: true`）。
提示词本来就是数据，所以最干净的方式是**把它当数据、放进用户目录**：

```sh
pnpm run build            # 文本来自 packages/xiaobo-persona 的片段
pnpm run dev:agent-preset # 生成 ~/.dsh/.agent-presets/xiaobo/
```

生成物 = 上游 `standard` 组合 + 替换后的 `persona` row（其余 17 行逐字保留；实测 diff 只有一个 hunk），
文本直接取自插件的 `fragments.ts`，所以 preset 与插件**永远不会说法不一致**。

**它不动任何原有配置。** 生效方式有两种，都不需要 patch：

1. **在应用里选**：模式选择器（mode picker）会多出「小博」，逐会话选即可。
2. **设为默认**：这是**用户设置**，不是组合配置 —— `dsh-agent-presets` 注册了设置命名空间
   `agent-presets`，其 `default` 会覆盖 bundle 里的 `config.default`：

   ```yaml
   # $DSH_HOME/settings.yaml —— 与设置界面写入的是同一个位置
   agent-presets:
     default: xiaobo
     modeSelectionEnabled: true   # 注册基线的值；用户段是整体替换，所以必须一并写上
   ```

   设置文档是热加载的，改完对**下一个新建会话**生效，不必重启（`.agent-presets/` 目录本身也是每次读取）。

| 项 | 实际情况 |
|---|---|
| 改动原有配置 | ❌ 一个字节都不改：预设是新目录，默认走用户设置 |
| 需要 registry / publish | ❌ 都不需要 |
| 需要绝对路径 | ❌ 所有 row 都指向 runtime 自带的包 |
| 插件窗口可见 | ❌（preset 不是插件；它在**模式选择器**里） |
| 覆盖 `standard` 的 persona | ✅（preset 自己挂 `dsh-persona`，agent scope 覆盖全局） |
| dsh 升级后漂移 | ❌ 重跑生成脚本即可（它从运行时读上游 `standard`） |
| 多段 section 顺序（400/410/420/430） | 合并为一段 persona（order 0），仍在所有工具指导之前（`SECTION_ORDERS` 里 0 与 `PLAN_POLICY=500` 之间没有任何一等公民 section） |
| 与插件通道的关系 | **互斥**：preset 的 persona 在 agent scope 内 shadow 部署 persona 槽，同时挂 `dsh-xb-xiaobo-persona` 会把同一段文本送两遍。走插件时用 `--persona plugin`（见 C2） |
| 保留的差异 | 内置的 `harness:identity` 行（`You are an AI agent powered by DeepSeek Harness.`）会留在最前面。关掉它**只能**改 host 的 `system-prompt` 行 —— 那就不是“只增加”了，所以本路线不碰它（要白标时用 C1/C2 的 `dsh-xb-deploy`） |
| 局限 | 只能带**文本**。工具行、MCP server 行仍需插件/bundle 或 profile patch |

> 生成脚本会自检：用 runtime 自带的 `js-yaml` + `entryListSchema` 解析（与 roster 同一个解析器），
> 并逐行确认每个 `name` 在 runtime 里可解析；自检不过就不写文件。
>
> 风险：设置里的 `default: xiaobo` 指向用户目录里的预设，如果手动删掉该目录，新会话会找不到默认模式
> 而报错。恢复就是再跑一次 `pnpm run dev:agent-preset`；不想让它成为默认就把 `default` 改回 `standard`。

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

Desktop 版的 `dsh plugin add` 是 `<runtime>/desktop-plugins.js`（应用自己 spawn 的就是它）：

```sh
RT=".../desktop-runtime"
"$RT/node/node.exe" "$RT/desktop-plugins.js" \
  --node "$RT/node/node.exe" --pnpm "$RT/pnpm/bin/pnpm.mjs" --dsh "$RT/dsh" \
  add dsh-xb-xiaobo-persona@0.1.0
```

命令集：`list | add <spec> | remove <name> | update <name> <version> | toggle <name> <on|off> |
disable-all | reset`。它走完整事务（链接宿主包 → 校验依赖图 → 写 `dsh.profile.bundles`），
所以不必开插件窗口。

**与「不发布」如何兼容**：包名**不需要 scope** —— 只要发到公共 npm，`add` 直接可用。scope 只在
**本地/私有 registry** 时才需要，因为 Desktop 把默认 registry 硬编码成 `registry.npmjs.org`，而 pnpm 的
`@scope:registry` 能覆盖它（实测：在 `$DSH_HOME/desktop/pnpm/config/npmrc` 写
`@xb:registry=http://127.0.0.1:4873/` 后，内置 pnpm 会走本地，未加 scope 的包仍走公网）。

### C2 本地/内测路径（不发布，直接写 profile patch）

`$DSH_HOME/profiles/desktop/cordis.patch.yml` 仍然会被读取，且它的层序在 bundle 层之后、桌面组合层之前。
这个文件本来就用来挂本机 MCP，因此可以同样挂本地构建的插件。**这就是「不发布但要真正的六个 section」
的那条路**：

```sh
pnpm run build
pnpm run dev:desktop-snippet -- --write   # 合并进 profile patch（带 marker，可重复执行）
pnpm run dev:desktop-composition          # 用运行时自己的 composeEntries 断言两行确实生效
pnpm run dev:desktop-prompt               # 渲染真实会话的系统提示词，断言六段各一次
```

合并进去的两部分（脚本生成，不手写）：

```yaml
# 1) 部署层内容，逐字来自 deploy/cordis.patch.yml
- id: system-prompt
  config:
    includeHarnessIdentity: false
    personaPrefix: ''
    personaSuffix: ''

# 2) 能力插件 row，逐字来自 packages/xiaobo-persona/cordis.patch.yml：
#    仅把包名换成构建产物的绝对路径，id / config / 注释全部原样带过来
- insert:
    - id: xiaobo-persona
      name: '<repo>/packages/xiaobo-persona/lib/index.js'
      # config:        # ← 在 bundle 自己的 patch 里取消注释即生效，重跑 --write 即同步
      #   locale: zh
```

保存后**重启 Desktop** 生效。这条路径的性质（务必知道）：

| 项 | 实际情况 |
|---|---|
| 是否被插件窗口管理 | 否。row 不在 `dsh.profile.bundles` 里，插件窗口看不到、不能开关、`disable-all` 也管不到 |
| 是否过 Desktop 依赖闸 | 否。`validateDesktopPluginGraph` 只校验 bundle 列表里的包，手写 row 绕过了它 |
| profile 重置 | 会被删除（重置清空 profile 目录，除 lock 外）；重跑 `--write` 即可恢复 |
| 运行时依赖 | 插件只 import `@deepseek-ai/schemastery`，需要它从插件目录可解析 —— `<repo>/packages/xiaobo-persona/node_modules` 里已有（`pnpm install` 装的 3.18.2，与 Desktop 内置同版本）。已实测：在 Desktop 运行时自己的 `node.exe` 与自己的 `cordis` / `dsh-system-prompt` 下加载成功，六个 section 顺序与期望一致 |
| **与 preset 的关系** | **互斥**。preset 的 `dsh-persona` 在 agent scope 内 shadow 部署 persona 槽（而不是退回部署值），所以 `standard` 那行 `You are a coding agent powered by {{model}}` 会顶在 `xiaobo:identity` 之前，且文本重复。走这条路径时改用 `pnpm run dev:agent-preset -- --persona plugin`：persona 留空，文本全部由六个 section 提供 |
| 定位 | **本机验证 / 内测 / 不想发布时的交付**。要进插件窗口、能被开关与升级，请在 C1 发布 |

### C3 已实测排除的路

| 路线 | 结果 |
|---|---|
| `pnpm pack` + 内置 pnpm `add <tarball>` | ❌ 能装成真目录，但 profile manifest 会写 `file:...tgz`，而 `projectManifest()` 要求依赖是**精确 registry 版本** → 报 `plugin dependencies must use exact registry versions`；`reconcileProfile()` 会调它 → **Desktop 启动即失败** |
| 把默认 registry 指向本地 verdaccio | ❌ `--config.registry=https://registry.npmjs.org/` 硬编码，且 `NPM_CONFIG_REGISTRY` 被显式设置 |
| `link:` / `file:` / git / tarball 通过插件窗口 | ❌ `packageNameFromSpec` 直接拒绝 |
| `--patch` overlay / home patch 层 | ❌ Desktop 不读 |

## 7. 用法 D：测试里以编程方式挂载

不需要 harness 启动，直接挂真实 registry 断言装配顺序与渲染文本：

```sh
pnpm --filter dsh-xb-xiaobo-persona run test
```

契约测试在 [`packages/xiaobo-persona/tests/integration.spec.ts`](../packages/xiaobo-persona/tests/integration.spec.ts)，
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

Desktop（没有 `--dump-config`，用两个脚本代替）：

```sh
pnpm run dev:desktop-composition   # 组合：system-prompt / xiaobo-persona 两行生效
pnpm run dev:desktop-prompt        # 渲染：六段各一次、首句为 Xiaobo、无 harness 身份行
```

期望的 section 顺序（`system-prompt/assemble`）：

```
[xiaobo:identity]  →  [xiaobo:domain-policy]  →  [xiaobo:safety-redlines]
                   →  [xiaobo:interaction-norms]  →  [xiaobo:objectivity]
                   →  …(工具带 / MCP_SERVERS 3100)…  →  [xiaobo:product-help]
```

开部署层后 `harness:identity`（原 order −1000）不再出现，渲染文本以 `You are "Xiaobo"` 开头。
