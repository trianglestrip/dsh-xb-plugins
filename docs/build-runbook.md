# 产品构建 Runbook（Desktop）

> 目标：在**不改动别人配置、不发布到 npm** 的前提下，产出一个"装上即小博、界面写 BCPD AI"的 Desktop 发行版，并能逐项验证。
>
> 相关：[`../docs/plugins.md`](../docs/plugins.md)（三条免发布通道）、[`../docs/xiaobo-prompt.md`](../docs/xiaobo-prompt.md) §3.7（提示词落点）。

## 0. 一句话流程

```
stage 内容 → 打包（env 传品牌/图标/preset 清空）→ 目标机写 profile 策略 → 挂本地插件 → 启动 → 四条验证
```

## 1. 构建机上准备

```sh
# 我们的仓库
cd dsh-xb-plugins
pnpm install && pnpm run build            # packages/xiaobo-persona → lib/
pnpm run check                            # manifest 守卫 + 类型 + 构建 + 测试
```

## 2. 打包（在 harness 仓库）

```sh
cd deepseek-harness-main
V="<repo>/dsh-xb-plugins"

# 三个环境坑（本机必踩，先兜住）
export PATH="/c/Windows/System32:$PATH"                  # 用 bsdtar：msys GNU tar 会把 D:\ 当远程主机
export npm_execpath="C:/Users/<you>/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.mjs"   # 独立版 pnpm.exe 会被 node 当模块执行

# 身份与图标（全部有默认值，不传就是上游 DeepSeek Harness + 默认 Electron 图标）
export DSH_DESKTOP_APP_ID=ai.deepseek.dsh.desktop
export DSH_CLIENT_TITLE='BCPD AI'                        # HTML <title> + 界面标题
export DSH_DESKTOP_PRODUCT_NAME='BCPD AI'                # exe 名 / ProductName
export DSH_DESKTOP_ARTIFACT_BASENAME='bcpd-ai'
export DSH_DESKTOP_ICONS_DIR="$V/assets/icons"           # icon.ico / icon.icns / icon.png
export DSH_DESKTOP_CLEAR_PRESET_PERSONA=1                # 清空内置 preset 的身份行，身份只由我们的 section 给

# 若要把 bundle 打进 runtime（零安装交付），再给这两个：
#   node "$V/scripts/stage-desktop-bundles.mjs" --out <harness>/.desktop-build/vendor/xiaobo
#   export DSH_DESKTOP_EXTRA_BUNDLES=<…>/vendor/xiaobo/bundles
#   export DSH_DESKTOP_EXTRA_PRESETS=<…>/vendor/xiaobo/presets

node node_modules/tsx/dist/cli.mjs apps/desktop/scripts/package-target.ts win-x64 --unsigned --dir
# 去掉 --dir 出 NSIS 安装包；加 --unsigned 免签名（本地用）
```

产物：`.desktop-build/targets/win-x64/unsigned-artifacts/win-unpacked/BCPD AI.exe`

> **打包前必须关掉正在运行的 app**，否则 `EPERM: unlink d3dcompiler_47.dll` / `EBUSY: rmdir win-unpacked`：
> ```sh
> taskkill //IM "BCPD AI.exe" //F; taskkill //IM "DeepSeek Harness.exe" //F
> ```

## 3. 目标机（含本机自测）：三层落位

```sh
cd dsh-xb-plugins

# a) profile 策略层：deploy/cordis.patch.yml + deploy/desktop.cordis.patch.yml
node scripts/desktop-snippet.mjs --no-capability --write   # 写 system-prompt / agent-presets / web-runtime 三行

# b) 能力层：本地插件通道（不发布、不碰依赖、不改壳）
node scripts/desktop-local-plugin.mjs add packages/xiaobo-persona
node scripts/desktop-local-plugin.mjs list

# c) 启动 app，让它自己迁移 profile（bundle 前缀 → 内置名单）
"<...>/win-unpacked/BCPD AI.exe"
```

`--no-capability` 的含义：能力行的挂载交给 `desktop-local-plugin.mjs` 单独管理，两套 marker 互不覆盖（`# >>> xiaobo local plugins` vs `# >>> dsh-xb-plugins`）。

## 4. 验证（一遍命令）

```sh
node scripts/desktop-verify.mjs --runtime "<harness>/.desktop-build/targets/win-x64" \
  --expect-title "BCPD AI" --require-all
```

四条检查各自也能单跑：

| 检查 | 命令 | 断言 |
|---|---|---|
| 组合 | `dev:desktop-composition` | 4 层 bundle、`system-prompt.includeHarnessIdentity=false`、`xiaobo-persona` 可解析 |
| 提示词 | `dev:desktop-prompt` | 六段各一次、首句 `You are "Xiaobo"`、无通用身份行 |
| 会话日志 | `dev:desktop-session-prompt` | 真实会话里六段各 1 次、竞争身份 0 |
| 界面 | `dev:desktop-ui` | `document.title` 含品牌名（需 app 带 `--remote-debugging-port=9222`） |

会话日志检查需要"发过一条消息"（系统提示词在准备请求时才落盘）：用 CDP 输入并回车，或直接在人机上发一句。

## 5. 本机踩过的坑（按出现频率）

| 现象 | 原因 | 处理 |
|---|---|---|
| `EPERM unlink d3dcompiler_47.dll` / `EBUSY rmdir win-unpacked` | 还有 app 进程活着（可能多个子进程） | `taskkill` 全部同名进程后再打包 |
| `tar: Cannot connect to D: resolve failed` | PATH 上是 msys GNU tar | 用 `C:\Windows\System32\tar.exe`（bsdtar） |
| `ERR_UNKNOWN_FILE_EXTENSION ".exe"` | `npm_execpath` 指向独立版 pnpm.exe，被 `node <entry>` 当模块 | 指向 `pnpm/bin/pnpm.mjs` |
| `build:official` 报 `git rev-parse` 失败 | worktree 的 gitdir 被删 | 修 worktree，或临时 `DSH_CLIENT_COMMIT_HASH=<sha>` |
| 会话日志只解出 236 字符 | 日志是**多帧 zstd 追加**，Node 只解第一帧 | 用 `desktop-session-prompt.mjs`（按 magic 切片逐帧解） |
| 新会话报 `preset "xiaobo" not found` | preset 必须放在 `<runtime>/node_modules/@deepseek-ai/dsh/config/agent-presets/`（宿主从**包目录**推根） | 放对目录；`desktop-prompt` 现在也按这条规则找 |
| 每一段出现 2 次 | preset 的 persona 与我们的 section 同时给身份 | 用 `DSH_DESKTOP_CLEAR_PRESET_PERSONA=1` 或 `--persona plugin` 的空 persona preset |

## 6. 交付形态对照

| 形态 | 目标机操作 | 品牌/身份 | 何时用 |
|---|---|---|---|
| 本地插件通道（本文 §3） | 跑两条脚本 + 启动 | 完整（本机改 profile 策略） | 内测、开发 |
| 内置 bundle（`DSH_DESKTOP_EXTRA_BUNDLES`） | **零操作** | 完整 | 正式交付 |
| 发布到 registry + 插件窗口 | 点两下 | 完整 | 官方 exe、第三方 |
| agent preset（`dev:agent-preset`） | 拷目录 | 只有文本两槽 | 应急/演示 |
