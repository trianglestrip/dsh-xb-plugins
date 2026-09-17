# Desktop 插件加载限制 · 对比 Web/CLI profile

> 相关文档：[`xiaobo-prompt.md`](xiaobo-prompt.md)（提示词清点与 section 落点）、[`docmanager.md`](docmanager.md)（DocManager 改造与 MCP 接入）。
>
> 范围与依据：
> - 分析对象：`apps/desktop`（Electron 壳与插件管理）与 `apps/desktop-host`（私有 Desktop Host）
> - 对照对象：CLI/Web 路径 `apps/cli`（`dsh web` / `dsh plugin`）与 `packages/boot/app-boot`
> - 设计依据：`2026-09-08-desktop-bundled-runtime-and-external-plugins.md`、`2026-08-25-electron-desktop-packaging-and-updates.md`、`2026-09-09-desktop-in-place-profile.md`
> - 分析基线：`deepseek-harness-main`，分支 `electron`，HEAD `74a326cf6b`（2026-09-16 静态代码核对，非推测）

---

## 0. 结论摘要

1. **两条路径的组装权不同**。Web/CLI 的 profile 是「用户可编辑的组合」：`dsh plugin --profile <name> <任意 pnpm 参数>` 转发、`cordis.patch.yml` 用户层、`$DSH_HOME/cordis.patch.yml` home 层、`--patch` overlay、`patchReload: live` 热加载。Desktop 的 profile 是「签名运行时 + Electron 独占目录」：组合层固定为 `bundle 层 → profile 自身 cordis.patch.yml → desktop.cordis.patch.yml`，没有 home 层、没有 overlay、没有启动参数、没有 HMR。
2. **安装能力被收窄成结构化操作**。Desktop 只接受 npm registry 包名（可带 tag，落盘必须精确版本），只暴露 add / remove / update / toggle / disable-all，由内置 pnpm 在私有 store 中执行；`file:`/`link:`/相对或绝对路径/git/tarball/任意 pnpm 子命令全部不可用。
3. **插件形态被强制为 bundle**。被管理的每个依赖都必须声明 `dsh.bundle.patch`，且 patch 文件必须存在并位于包目录内；纯库依赖装不进来（Web 只是警告「装了但不激活」）。
4. **宿主包只能以 peer 身份消费**。`@deepseek-ai/dsh-*` 共享包不从 registry 安装、不能出现在 `dependencies`、不能有嵌套副本或别名，peer 版本必须满足内置版本；打包版由运行时解析代强制路由，不依赖 profile 内的链接。
5. **Web 能力面在 Desktop 被裁掉**。`webserver` / `web-startup` / `web-runtime` / `client-hmr` / `open-in-app` / `ui-open-in-app` / `directory-picker` 行被禁用或替换，因此 inject `webServer` / `webStartup` / `webRuntime` 的插件在 Desktop 不会激活，"Open In…" 类需要 HTTP 路由的功能不可用。
6. **失败语义是「不自动回滚」**。包事务停 Host、持独占锁执行，失败保留已改文件并留 pending 标记等下次启动重试；不兼容插件不会被静默删除或降级，需要用户禁用、修复或重置 profile。

---

## 1. 两条加载路径

| 维度 | Web/CLI profile | Desktop profile |
|---|---|---|
| 入口 | `dsh web`（`--profile web` 别名）、`dsh plugin --profile <name> …` | Electron 菜单里的插件窗口（IPC 结构化操作） |
| profile 目录 | `$DSH_HOME/profiles/<name>`，用户可改名/新建/由 CLI 初始化 | `$DSH_HOME/profiles/desktop`，Electron 独占；CLI 拒绝 boot 与 plugin 管理 |
| 组合层 | bundle 层 + profile patch + home patch + `--patch` overlay（+ telemetry 开关） | bundle 层 + profile patch + desktop patch |
| 重载 | `patchReload: live`，watcher 重读用户层；client HMR 行常驻 | 无 watcher、无 client HMR；变更 = 停 Host → 改 profile → 重启 Host |
| 包管理器 | 系统 `pnpm`（PATH 上，行为随用户环境） | 内置 pnpm + 私有 store/cache/config，registry 固定 `registry.npmjs.org` |
| 宿主包来源 | `$DSH_HOME/profiles/node_modules` 安装回退链接 | 打包版：运行时解析代（无 profile 内链接）；开发版：目录链接/junction |

`dsh --profile desktop` 与 `dsh plugin --profile desktop …` 都会以 `profile "desktop" is managed exclusively by the Electron application` 失败（`apps/cli/src/args.ts` 的 `rejectElectronProfile`）。反向也成立：Desktop 不读 CLI 的 profile 回退，插件依赖不允许解析到其他 dsh 安装（`validateDesktopPluginGraph` 的 `inside(profileRoot, …)` 检查）。

---

## 2. 安装来源与包管理器

### 2.1 规格白名单

`packageNameFromSpec`（`apps/desktop/src/project-manager.ts`）拒绝：`file:`/`link:` 前缀、含 `://`、含空格或反斜杠、以 `-` 开头，以及任何不以合法 npm 包名开头的路径。因此下列 Web 可用写法在 Desktop 全部不可用：

```sh
dsh plugin --profile web add ./hello-plugin          # 相对路径
dsh plugin --profile web add /abs/path/plugin        # 绝对路径
dsh plugin --profile web add github:you/hello-plugin # git
dsh plugin --profile web add ./hello-0.1.0.tgz       # tarball
dsh plugin --profile web add --save-dev x            # 任意 pnpm 参数
```

Desktop 只保留 registry 规格（`@scope/name` 或 `name`，可带 `@version` 或 tag）。版本落盘必须精确：安装用 `pnpm add … --save-exact`，profile manifest 的每个依赖都要求 `semver.valid(v) === v`；更新必须显式给出目标版本（UI 里是 `prompt` 输入），没有 "update to latest" 语义。

### 2.2 固定包管理器

- registry 硬编码 `https://registry.npmjs.org/`，`--config.registry` 与 `NPM_CONFIG_REGISTRY` 同时设置；store/cache/state/config/home 全部指向 `$DSH_HOME/desktop/pnpm/*`。
- 继承环境时剔除 `NODE_OPTIONS`、`NODE_PATH`、`DSH_DESKTOP_*`、`npm_*`/`pnpm_*`/`corepack_*`，因此用户的 `.npmrc`、镜像源、代理、`node-options` 都不生效。
- `pnpm-workspace.yaml` 固定 `nodeLinker: hoisted`、`autoInstallPeers: false`、`strictDepBuilds: true`。`autoInstallPeers: false` 意味着缺失的 peer 不会被自动补装——插件漏写 peer 会直接在依赖校验阶段失败。

### 2.3 生命周期脚本白名单

安装统一 `--ignore-scripts`；只有 `allowBuilds` 列表内的包能执行构建：

```yaml
allowBuilds:
  node-pty: true
  koffi: true
  fs-ext: true
  <dsh-subprocess-local@file:…>: true
  '@google/genai': false
  protobufjs: false
  node-addon-require-builtin: false
```

`strictDepBuilds: true` 下，白名单之外需要构建的包会让整个事务失败（README 的 Known limitations 明列此项）。这与 Web 的差别是：Web 用系统 pnpm 的默认策略，用户可以在自己的 `pnpm-workspace.yaml` 里补 allowlist；Desktop 的白名单随发布固化。

---

## 3. 依赖与模块解析约束

`validateDesktopPluginGraph`（`apps/desktop/src/profile-packages.ts`）在每次 profile 准备/变更后执行，规则如下：

| 约束 | 表现 |
|---|---|
| 必须有 `dsh.bundle.patch` | `inspectPlugin` 报 `does not declare dsh.bundle.patch`；`listPlugins()` 会对任一不合规依赖整体抛错 |
| patch 路径合法 | 必须解析到包目录内且文件存在 |
| 宿主包不得安装 | `runtime.sharedPackages` 中的名字被 `plugin-add` 直接拒绝（`cannot install host-owned package`） |
| 宿主包必须是 peer | 出现在 `dependencies`/`optionalDependencies` 即报 `must declare … as a peer dependency` |
| peer 版本必须满足 | 不满足内置版本报 `requires X@range, found version` |
| 不得有副本/别名 | link 模式下 profile 内出现同名的非链接副本报 `duplicate or aliased host package`；打包版由运行时解析代强制路由，副本不会被采用 |
| 依赖必须落在 profile 内 | 解析到 CLI 或其他祖先安装目录报 `resolves … outside its owned packages` |
| 不允许链接的私有包 | `linked private package`、`linked package container` 均被拒 |
| profile 目录本身不能是符号链接 | `withLock` 报 `profile directory must not be a link` |

模块身份上，Desktop 不开 `--preserve-symlinks`，宿主包与插件共享同一模块实例；需要跨插件共享单例的包必须进运行时 shared inventory，仅版本号相同不够。这直接对应本仓库的 AGENTS.md 约定：`@deepseek-ai/*` 一律 `peerDependencies`，绝不 bundle 第二份 harness 运行时。

---

## 4. 组合层与激活

- **bundle 列表固定**：必须以 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 开头，且不得重复；用户插件只能追加，不能替换内置 surface、不能改顺序。Web profile 的 bundle 列表则来自模板 + 安装顺序，可自由组成。
- **层顺序按包名字典序**：`writeProfilePlugins` 把启用插件按 name 排序后追加，而不是安装顺序。多个插件都要 patch 同一 row 时，优先级等于包名字典序——这是 Web（按依赖列出顺序追加）没有的隐性约束。
- **没有 home 层**：Desktop 的 patch 栈不含 `$DSH_HOME/cordis.patch.yml`。通过 home 层挂的插件在 Desktop 不会加载。
- **profile 自身 patch 仍生效**：`loadProfileDirectory` 默认读 `$DSH_HOME/profiles/desktop/cordis.patch.yml`，所以手工加 row 是可能的；但插件窗口不提供配置编辑，且没有 `--patch` overlay 与启动参数（Host 的 cmdline 是 `args: []`）。
- **CLI 参数为空**：`provideCmdline(hostCtx, { args: [], exit })`，任何依赖命令行开关的插件行在 Desktop 拿不到值。

激活失败的处理与 Web 一致（`auditStartupEntries`）：第三方插件行不在 `requiredStartupEntryIds`（`agent-loop`/`webserver`/`modules`/`connection`/`headless-runner`/`acp`/`sdk-jsonrpc-server`）中，停在 pending 只产生 warning，宿主继续运行——但插件等于没生效；只有复用 required id 的行才会让启动整体失败。

---

## 5. 运行时能力缺口

`apps/desktop-host/config/desktop.cordis.patch.yml` 在 Web 组合之上做了如下改动：

| 行 | 处理 | 后果 |
|---|---|---|
| `web-startup` | `disabled: true` | 无 `webStartup` 服务；依赖它的行不会激活 |
| `webserver` | `disabled: true` | 无 `webServer`，不开端口；注册 HTTP 路由的插件不可用 |
| `web-runtime` | `disabled: true` | 无 `webRuntime`；URL 打印、LAN trust 采样、浏览器打开都不存在 |
| `client-hmr` | `disabled: true` | 客户端插件无热更新，改动必须重启 |
| `open-in-app` / `ui-open-in-app` | `disabled: true` | Web 的 "Open In…" 不可用（host 插件需要 HTTP 路由） |
| `directory-picker` | `disabled: true` | 由 `directory-picker-native`（host + client 两行）替代 |
| `connection` | `inject: [credentials]`、`config: {}` | 传输改由 `dsh-app://` + 版本化字节管道承载 |

因此 **inject `webServer` / `webStartup` / `webRuntime` 的插件在 Desktop 属于「装了也不生效」**。客户端侧仍走 `clientModules.fetchBundle` 的 `/plugins/<id>/client.js`，但只服务与 shell 同版本的 client graph，且没有 HMR 链路。

---

## 6. 运行时与版本兼容

- **内置 Node 固定**：native 模块必须匹配内置 Node 的 ABI。Node 版本、平台或架构变化时，Desktop 用 `--frozen-lockfile --ignore-scripts` 重装整图，再对白名单包 `pnpm rebuild --pending`，然后重新校验插件图。
- **dsh 版本与 shell 绑定**：插件要兼容该精确 dsh 版本；Desktop 升级即 dsh 升级，升级后校验已启用插件的 peer 需求，不兼容时启动失败，且**不自动删除、不降级、不回滚**。
- **不编译 TypeScript 插件**：打包运行时按 file policy 剔除 `.d.ts`、可识别的 source map、TS 构建缓存、部分 native 编译产物与跨平台 node-pty prebuilds；Desktop 只执行预构建 JS 与生成的 Typert 元数据。插件必须发布构建好的 `lib/`。
- **共享包版本由发布决定**：`desktop-runtime.json` 记录 shared package 版本与文件清单，插件无法通过安装动作改变宿主依赖图。

---

## 7. 事务、失败与开发模式

- **先停后端再改**：`mutate` 先 `beforeChange()` 停 Host，成功后再 `afterChange()` 重启；插件变更期间主窗口回到启动页。
- **独占锁**：包事务持 `$DSH_HOME/profiles/desktop/lock`（内容为持有者 PID，死进程可回收）；另有进程级单实例锁，两个 Desktop 进程不会同时改同一 profile。
- **失败不回滚**：pnpm 或 Host 启动失败时保留已修改文件并报错；未完成的包操作留 `desktop-packages-pending` 标记，下次启动重试 locked install + pending builds。
- **恢复手段**：禁用全部第三方插件重试、重试后端、重置 profile。重置删除 profile 内除 lock 外的全部内容（含第三方包与 Desktop 配置，无备份），共享 tasks/settings/credentials/workspaces 不动。
- **未打包开发模式完全禁止包变更**：`plugins.list()` 返回空；add/remove/update/toggle 抛 `plugin package changes require a packaged application`；reset 抛 `requires a packaged application`；菜单项显示为 `Desktop Plugins… (available in packaged applications)`。开发模式的 profile 是 `.desktop-build/development/project`，只有它允许 `--allow-linked-profile` 解析外部 bundle。

---

## 8. 判断一个插件能否在 Desktop 加载

按顺序过四道闸：

1. **形态**：包必须声明 `dsh.bundle.patch`，patch 文件在包内且可解析。
2. **依赖**：所有 `@deepseek-ai/dsh-*` 宿主包写成 `peerDependencies`（不是 dependencies），版本范围要覆盖内置版本；其余依赖必须能在 profile 内解析，且不能是链接进来的私有包。
3. **服务**：不能 inject `webServer` / `webStartup` / `webRuntime`；不能用依赖 `client-hmr` 的热更新路径；目录选择要使用 native 变体。
4. **运行时**：native 依赖必须在 `allowBuilds` 白名单内并匹配内置 Node ABI；只提供预构建 JS（不依赖 TS 源码编译）。

另外，安装规格必须是 registry 包名，版本必须精确，且不能与运行时 shared inventory 中的包同名。

---

## 9. 对照速查

| 维度 | Web/CLI profile | Desktop |
|---|---|---|
| 安装命令 | `dsh plugin --profile web <任意 pnpm 参数>` | 插件窗口的 add / remove / update / toggle |
| 来源 | registry、本地路径、git、tarball、`file:`/`link:` | 仅 npm registry 名称（可带 tag，落盘精确版本） |
| 非 bundle 依赖 | 允许（警告，不激活） | 拒绝（必须 `dsh.bundle.patch`） |
| 宿主包 | `$DSH_HOME/profiles/node_modules` 回退链接 | 运行时解析代（打包）/ 目录链接（开发）；必须 peer |
| 插件层顺序 | 依赖列出顺序 | 包名字典序 |
| patch 组装 | bundle + profile + home + `--patch` | bundle + profile + desktop patch |
| 热更新 | `patchReload: live` + client HMR | 无，需重启 Host |
| webServer | 有（HTTP/端口/Open In…） | 无（`dsh-app://`，无端口） |
| 生命周期脚本 | 系统 pnpm 默认 + 用户 allowlist | `--ignore-scripts` + 发布固化 `allowBuilds` |
| 失败处理 | pnpm 自身语义 | 不回滚、pending 重试、需手动禁用/修复/重置 |
| CLI 可否管理 | 可以 | 不可以（`profile "desktop" is managed exclusively by the Electron application`） |

---

## 附：源码索引

- 安装与事务：`apps/desktop/src/project-manager.ts`（`packageNameFromSpec`、`profilePluginNames`、`inspectPlugin`、`workspaceFile`、`applyMutation`、`runPnpm`、`mutate`、`reconcileProfile`、`withLock`）
- 依赖校验与 profile 状态：`apps/desktop/src/profile-packages.ts`（`validateDesktopPluginGraph`、`linkDesktopHostPackages`、`recordDesktopRuntimeProfile`、`readDesktopProfileState`）
- 打包/开发解析模式与 IPC：`apps/desktop/src/main.ts`（`runtimeResources`、`mutate`、`pluginsList`）、`apps/desktop/src/ipc.ts`、`apps/desktop/src/paths.ts`
- Desktop 组合覆盖：`apps/desktop-host/config/desktop.cordis.patch.yml`、`apps/desktop-host/src/index.ts`（`desktopComposition`、root config 写入、`assetHandler`）
- CLI/Web 对照：`apps/cli/src/plugin.ts`（`anchorPathSpec`、`reconcilePlugins`、`runPlugin`）、`apps/cli/src/args.ts`（`rejectElectronProfile`）、`apps/cli/src/profile-boot.ts`（`resolutionMode`、home patch、`PluginPackages`）
- 组合与审计：`packages/boot/app-boot/src/profile.ts`（`loadProfileDirectory`、`resolveBundleDir`）、`packages/boot/app-boot/src/index.ts`（`requiredStartupEntryIds`、`auditStartupEntries`）
- 运维说明与决策：`apps/desktop/README.md`（Key technical decisions、Known limitations）、`.agents/notes/implemented/architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md`
