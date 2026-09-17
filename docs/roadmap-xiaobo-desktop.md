# 小博 Desktop 产品化 · 剩余任务规格

> 前置已就绪（本轮完成）：本地插件通道、Desktop 专属策略层、四条验证（`dev:desktop-verify`）、产品构建 runbook（[`build-runbook.md`](build-runbook.md)）。
> 本文只写**还没做**的四件事，每条都能独立分派；文件所有权互斥，验收命令独立。

## 全局约束（每条任务都要守）

1. harness 源码不出现产品名；产品值走构建输入（`DSH_CLIENT_TITLE` / `DSH_DESKTOP_PRODUCT_NAME` / `productName` row）或我们的 bundle。
2. 同一会话内 section 逐字节稳定；会变的走 `context()`。
3. 一个 bundle 一个 `cordis.patch.yml`；能力插件不 patch 别人的 row，组合决策进 `deploy/`。
4. 验收只用 `pnpm run dev:desktop-verify`（组合 / 提示词 / 会话日志 / 界面），别靠肉眼看界面。
5. 需要出 exe 的任务排进同一个"打包窗口"（一次一个），且打包前必须 `taskkill` 掉 `BCPD AI.exe`（否则 EPERM）。

---

## A2 · UI 白标：自研品牌 client 插件

**目标**：侧栏品牌（mark + name）与关于页显示 BCPD AI 自己的标识，替换官方 wordmark。

**已核实的机制**（避免重复踩）

- `@deepseek-ai/dsh-client-modules` **扫描 Host loader 的 entry**，对声明 `dsh.client` 的包建表（`table.set(packageName, …)`），并要求该包 `exports` 里有 `"./client"`（否则报 `declares dsh.client but exports no "./client" bundle`）。
- 因此**本地路径插件也能供 client bundle**：entry 是我们的 row，包名来自最近的 `package.json`，`lib/client.js` 由 host 从磁盘读并服务到 `/plugins/<id>/client.js`。→ 本任务不需要走内置通道。
- 品牌槽是纯插件行：官方 `ui-brand-official` 在 web-app bundle 里注册 `sidebar.brand.mark` / `sidebar.brand.name` 两个 slot。我们在 `deploy/desktop.cordis.patch.yml` 里 `- id: ui-brand-official disabled: true`，再由我们的 client 插件注册同名 slot。
- 官方实现只做两件事：`FishLogo`（mark）+ `BrandWordmark`（name），都来自 `@deepseek-ai/dsh-client-ui-primitives`。

**交付物**

```
packages/xiaobo-brand/
├─ package.json          # name: xiaobo-brand; exports: { ".": lib/index.js, "./client": lib/client.js };
│                        # dsh.client: { inject: [renderer, sidebar], external: [...] }
├─ cordis.patch.yml      # insert: [{ id: xiaobo-brand, name: xiaobo-brand }]
├─ tsdown.config.ts      # 双入口（host + client），client 侧 external: react + @deepseek-ai/dsh-client-*
├─ src/index.ts          # host 半边（可空 apply，仅保证 row 合法）
├─ src/client/index.tsx  # 注册 sidebar.brand.mark / .name（BCPD AI）
└─ assets/brand.svg      # 我们的 mark（可用 assets/icons/icon.png 派生）
```

**步骤**：① 复制 `packages/client/ui-brand-official` 的 package.json 形状与 `dsh.client.external` 写法；② 写 client 入口；③ 在 `deploy/desktop.cordis.patch.yml` 禁用官方行；④ `desktop-local-plugin add packages/xiaobo-brand`；⑤ 重启 + `dev:desktop-ui`。

**验收**：`dev:desktop-verify --expect-title "BCPD AI" --require-all` 通过，且侧栏 mark 渲染为我们自己的 SVG（用 CDP 断言 `sidebar` 区域的 `svg` 数量/尺寸，或断言官方 wordmark 的 path 特征字符串不存在）。

**风险**：client bundle 版本必须与 shell 的 client graph 同代；`dsh.client.external` 漏写会把宿主依赖打进 bundle（违反"不打包第二份运行时"）。估时 2–3 天。

---

## A3 · i18n 与关于页文案清点

**目标**：界面里**产品语义**的 "DeepSeek / DeepSeek Harness" 全部换成 BCPD AI；**服务商语义**（DeepSeek API Key、DeepSeek 模型、web-search provider）保持不动。

**清点结果（已做，不用重来）**：客户端源码含 `DeepSeek` 的文件 16 个（排除 `lib/`、`tests/`），其中约 11 个属于服务商语义（`ui-settings-models/*` 的 key/模型编辑器、`ui-settings-plugins` 的 web-search 卡片），**只该动 3–5 处**：

| 文件 | 语义 | 处理 |
|---|---|---|
| `ui-settings-plugins/src/client/locales.ts` | 产品名 | 由我们的插件覆盖该 locale 键（若能注入），或上游加可配置项 |
| `ui-brand-official/src/client/Brand.tsx` | 产品名/标识 | 被 A2 整体替换 |
| `apps/web/vite.config.ts` 的 `DEFAULT_CLIENT_TITLE` | 非 official 构建标题 | 保持上游默认；产品构建走 `DSH_CLIENT_TITLE` |
| `ui-settings-*/**` 其余 | 服务商 | **不动** |

**验收**：CDP 遍历设置页各分区文本，断言不存在产品语义的 "DeepSeek"（保留白名单：API Key、模型名、provider 名）。

---

## B1 · 自有 CAD composition（唯一组合）

**目标**：`standard` 的工具集换成设计工具集，成为 roster 里唯一的组合；模式选择器彻底消失（`includeShippedRoot: false`）。

**前置**：CAD 工具 bundle（`cad_*` skill + `python_*` + DocManager MCP）存在。没有它们之前保持现状（`deploy/desktop.cordis.patch.yml` 里已写明切换点）。

**步骤**：① 生成 `packages/xiaobo-desktop/presets/xiaobo/agent.cordis.yml`（基于目标 runtime 的 `standard`，替换工具行）；② `deploy/desktop.cordis.patch.yml` 改 `includeShippedRoot: false` + `default: xiaobo`；③ `stage-desktop-bundles.mjs` 带上 preset；④ 打包；⑤ 固定 `toolOrder`（`deploy` 层，跨插件）。

**验收**：新会话工具目录只含设计相关工具；`dev:desktop-prompt` 六段各一次且 persona 前缀为空；同一会话内 `request/header` 不因工具集变化开新序列。

---

## B2 · 大规模提示词：内容迁到数据文件 + 长文拆 skill

**目标**：常驻段（≤3k 字符）留在 section，长文（SOP、手册、行业差异）进 skill；内容不再埋在 TS 字符串里。

**现状**：6 段共 5805 字符（en），在 `packages/xiaobo-persona/src/fragments.ts`。

**步骤（可切片交付）**

1. **切片 1（安全重构）**：`scripts/export-fragments.mjs` 把 `fragments.ts` 导出成 `packages/xiaobo-persona/prompt/{en,zh}/*.md`；`src/index.ts` 在 `apply()` 时 `readFileSync` 一次并常驻；`package.json` 的 `files` 带上 `prompt/`。验收：渲染结果与迁移前**逐字节相同**（对同一条 prompt 做哈希比较），且 Desktop 本地插件通道下改 md → 重启即生效（不用重新 build）。
2. **切片 2（长度纪律）**：测试加断言——单段 ≤ 预算、en/zh 段数一致、必含关键句（`cad_*`、`[BCPD_AI]`）；超限即红。
3. **切片 3（拆 skill）**：新建 `packages/xiaobo-skill-cad/skills/*.md`（frontmatter: name/description），composition 挂 `skill-filesystem` + `tool-skill` 并把目录加进 `customSkillDirs`；把长流程从 section 移进去。验收：`skill` catalog 里能看到，且 system prompt 长度下降；模型按需 read 的内容出现在会话日志的 tool result 里。

---

## 分派建议（三条并行线）

| 线 | 任务 | 独占文件 | 可否并行 |
|---|---|---|---|
| 1 | B2 切片 1 → 2 → 3 | `packages/xiaobo-persona/**`、`packages/xiaobo-skill-cad/**` | ✅ 与 2/3 零重叠 |
| 2 | A1 收尾 → A2 → A3 | `packages/xiaobo-brand/**`、`deploy/desktop.cordis.patch.yml` | ✅ 与 1/3 零重叠 |
| 3 | B1（需 CAD 工具包就绪） | `packages/xiaobo-desktop/**`、`scripts/stage-desktop-bundles.mjs` | 需工具包，且与"打包窗口"串行 |

**串行点**：任何要出 exe 的验收（A2、B1 完成后）排进同一窗口；打包前关 app。
