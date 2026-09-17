# DocManager 改造 · 接入 deepseek-harness

> 姊妹文档：[`xiaobo-prompt.md`](xiaobo-prompt.md)（提示词清点、整理与 section 落点）。
>
> 范围与依据：
> - 改造对象：`D:/gitProject/testCAD/portable/AgentServer/DocManager/`（外层仓库 AIEP）
> - 对照文档：[`FLOW-user-request.md`](../../deepseek-harness-main/FLOW-user-request.md)（`deepseek-harness-main`，`electron` 分支）
> - 对照实现：[`packages/xiaobo-persona`](../packages/xiaobo-persona)（动态 context 的注册形态可参照）
> - 分析基线：外层 HEAD `73f38090`（2026-09 静态代码核对，非推测）

---

## 0. 结论摘要

1. **DocManager 在当前产品里同时扮演四个角色**：本地知识数据面、MCP 工具面、自建问答 agent（第二套 system prompt + 首轮强制路由）、WebPage 发送前的预检索路由。
2. **在 dsh 的流程观下它不应是独立 agent**：数据面保留，工具面接 `systemPrompt.tools()`，提示词面上移到 `MCP_SERVERS`（order 3100），**代理面删除**（由主 Agent 承担）。
3. **MCP 接入不需要写插件**：复用 `@deepseek-ai/dsh-mcp-client`，加一条 server 配置行即可；server 的 `instructions` 字段会被自动注册成 `mcp:<serverName>` section（order 3100，`interpolate:false`），工具进入 `ctx.tools`，名字空间为 `mcp__docmanager__*`。
4. **两处必须改掉的语义冲突**：DocManager 的 `_initial_tool_choice`（服务端强制 `tool_choice=search_context`）在 dsh 无对应强制层；引用编号 `[n]` 的**进程级全局递增**与 dsh 的「模型可见即已记录」不兼容。
5. **可见知识范围是动态事实**，必须走 `systemPrompt.context()`（计划中的 `dsh-xb-docmanager` 插件），不能写成 section。

---

## 1. DocManager 现状：四个面

| 面 | 载体 | 关键事实 |
|---|---|---|
| **数据面** | `runtime/sag_api/` + LanceDB + `models/fastembed`（bge-small-zh-v1.5） | 上传 → Markdown 分块 → 中文向量化 → 检索索引；API `127.0.0.1:9666`；离线严格模式（禁 HuggingFace/PyPI 下载） |
| **MCP 工具面** | `runtime/sag_api/mcp/server.py:302` `build_source_mcp()` | 3 工具 `list_sources` / `search` / `get_entity`；server `instructions`（`:310`）；引用编号 `[n]` 进程级全局递增；`stateless_http=True`；回环免鉴权 + 反代头护栏 |
| **自建 agent 面** | `runtime/sag_api/generation/prompt.py` + `services/agent_service.py` + `tools/builtin.py` | `_identity_prompt` + `persona.system_prompt` + `_GUIDANCE` + 时间规则 + guardrails；`_initial_tool_choice`（`:129`）服务端强制首轮 `tool_choice=search_context`；内置工具 `search_context` / `get_entity` / `get_time` / `web_search` / `open_webpage` |
| **前端预检索面** | `WebPage/src/lib/docManager/client.ts`、`KnowledgePage.vue`、`DocManagerPanel.vue` | 对话发送前调用 DocManager 做意图判断 / 问题拆解 / 向量检索，把结果拼进 prompt |

已确立且应保留的工程结论（来自 `DocManager/README.md` 的实测）：

- **工具面收敛有效**：`list_sources + search + get_entity` 三件套后，粗精度问答物理上不再有 `outline/get_chunk/grep` 慢路径，1× search ≈ 37.5s。
- **按需检索优于预检索**：非知识问答 0 工具调用；预检索会让每条消息都付检索成本。
- **必须是 stateless**：opencode/MiMo 客户端不携带 `mcp-session-id`，stateful 端点会让全部 `tools/call` 报 `Missing session ID`。

---

## 2. dsh 侧接入机制

### 2.1 MCP 是「配置行」，不是「自写插件」

dsh 用 `@deepseek-ai/dsh-mcp-client` 托管所有外部 MCP server，每台服务器一条记录：

```yaml
- id: mcp-docmanager
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: docmanager
    transport: streamable-http
    url: http://127.0.0.1:9666/mcp/
    # headers: { Authorization: ... }   # 回环免鉴权时不需要
```

这一行带来的效果：

| 产物 | 说明 |
|---|---|
| `ctx.tools` 中的 `mcp__docmanager__list_sources` / `__search` / `__get_entity` | namespace 由 `serverName` 决定；DocManager 内部 `FastMCP("sag-knowledge")` 的名字**不参与** dsh 命名 |
| `mcp:docmanager` section（order 3100） | 由 server 的 `instructions` 字段**自动**注册，`interpolate:false`；DocManager 现有 instructions（`mcp/server.py:310`）可原样复用 |
| 断线/重连的 `ServerContext` | `instructions()` 读取最近一次成功连接的快照 |

参考：`packages/mcp/mcp-client/src/server-context.ts:35`、`packages/mcp/mcp-client/README.zh.md`。

> 只有想让工具名去掉 `mcp__` 前缀、或想要原生工具面时，才需要自写工具包（`systemPrompt.tools()` provider）——那是另一条路，不建议在改造初期走。

### 2.2 两条线的唯一汇合点：`toolOrder`

提示词插件与 MCP 行互不依赖，但 `system-prompt.config.toolOrder` 必须同时列出：

```
cad_*            （CAD Skill）
python_*         （内置 Python 工具）
mcp__docmanager__list_sources / __search / __get_entity
<unlisted-tools> （TOOL_ORDER_REST，恰好一次）
```

否则工具集顺序随插件加载顺序变化 → `request/header` 的 `toolsChanged` 判定为变化 → 开新请求序列、破坏前缀缓存。详见 [`xiaobo-prompt.md`](xiaobo-prompt.md) §3.5。

### 2.3 可见知识范围 → 动态上下文（计划中的第二个插件）

DocManager 的「当前可见信源」是会变的运行时事实：范围变化只应刷新运行时上下文快照，而不该重写 system surface。落点：

```ts
// 计划：packages/xiaobo-docmanager/src/index.ts
ctx.inject(['systemPrompt'], (scope) => {
  scope.systemPrompt.context({
    name: 'xiaobo:knowledge-scope',
    order: 125,                       // 与 SANDBOX_POLICY(110) / APPROVAL_POLICY(115) 同带
    text: () => renderKnowledgeScope(currentVisibleSources),
  })
})
```

要点：

- 快照文本以 dsh 的运行时上下文前缀出现；**内容不变就不产生新 user 消息**，关闭时写 `Current runtime context: none.` 清除语句。
- 信源列表必须来自会话可重建的状态，不能是进程内缓存的事实（对应 §4 冲突点 1）。

---

## 3. 目标形态：四面解耦

```
数据面  ── 保留（本地知识服务：上传/分块/embedding/索引/检索）        ← 不变
工具面  ── 收敛为 dsh tools provider（MCP 行，3 工具，顺序锁定）      ← mcp-client 配置
提示词面 ── server instructions 落 3100；"何时用知识工具"并入同一段    ← 无需新插件
代理面  ── 删除：不再维护第二套 system prompt / tool_choice 强制       ← 由主 Agent 承担
状态面  ── 可见信源 → systemPrompt.context()（新增小插件）             ← dsh-xb-docmanager
```

判断标准：**DocManager 只输出证据，不输出人格，也不决定「先检索还是先推理」。**

---

## 4. 改造项

| # | 改造 | 现状 | 目标（dsh 语义） |
|---|---|---|---|
| 1 | 工具使用指导上移 | 只写在 MCP server `instructions` | 保留 3100 自动注入；「知识性问题优先 search、概述类一次搜索即够、证据不足再改写 query」并入同一段文本，避免模型跨 `TOOL_*`(1000~3000) 与 `MCP_SERVERS`(3100) 两处拼语义 |
| 2 | 工具面/顺序固定 | 工具面收敛为 3 个，但顺序未锁 | 在 `toolOrder` 固定 `mcp__docmanager__*` 位次（与 `cad_*` / `python_*` 一起） |
| 3 | 可见知识范围 → 动态上下文 | 每次调用靠 `source_id` 或「查询全部」 | 注册 `systemPrompt.context({name:'xiaobo:knowledge-scope', order:125})`；范围变化才刷新 |
| 4 | 删除 `_initial_tool_choice` | 服务端正则强制首轮 `tool_choice=search_context` | dsh 无 tool_choice 强制层；改为「单检索入口 + 提示词引导」，与已收敛的 3 工具面一致 |
| 5 | 删除 DocManager 的第二套 system prompt | `generation/prompt.py` 的 `_identity_prompt`/`_GUIDANCE`/guardrails | 知识检索的行为约定并入 [`xiaobo:domain-policy`](../packages/xiaobo-persona/src/fragments.ts)；DocManager 只输出证据 |
| 6 | 预检索路由迁移 | WebPage 发送前调 DocManager，结果拼进 prompt | 改为 dsh `agent/pre-step`（inject）或纯工具调用；保证「模型可见即已记录」，避免前端拼装绕过会话日志 |
| 7 | 引用编号语义 | `_citation_allocate` 进程级全局递增，跨会话续号 | 见 §5 冲突点 1：改为会话作用域分配，或降级为每次 `search` 结果内的局部编号 |
| 8 | 附件不再入 DocManager | — | 按 `AgentServer/docs/attachment-refactor-plan.md`，附件走 MiMo upload + 引用；DocManager 只吃「知识库内容」 |
| 9 | 传输保持 stateless | `stateless_http=True` | 保持。dsh 的 mcp-client 同样不应依赖 `mcp-session-id` |
| 10 | 离线白名单 | 只允许回环 + LLM 主机 | dsh 侧继承该策略；若 DocManager 改为原生工具（非 MCP），白名单逻辑需搬到工具实现 |

---

## 5. 需要明确的冲突点

1. **引用编号 vs 回放不变量（最关键）**
   当前 `[n]` 由 `_citation_allocate()` 按**进程级**全局递增，跨会话续号。这属于「进程内状态未落日志」：进程重启后起点归零、回放同一会话得到不同编号，与 dsh 的「模型可见即已记录」直接冲突。
   建议：把分配器状态落到会话作用域（例如起始号写进 `tool/result` 事件），或直接降级为每次 `search` 结果内的局部编号——后者最简单，且不影响单轮引用可读性。
2. **双 system prompt**
   DocManager 内置 agent 与小博主 Agent 会各自设定人格与「是否先检索」的行为；接入主 Agent 后必须只保留一套，否则同一轮里两套行为约定互相抵消。
3. **预检索 vs 按需检索**
   README 实测结论是「工具面收敛后 1×search 最快（37.5s）」，说明按需检索优于预检索。预检索路由应默认关闭或降级为兜底，而不是前置必经步骤。
4. **MCP 段位 vs 工具指导段位**
   `mcp:<server>` 固定在 3100，而工具指导带（`TOOL_*`）在 1000~3000。两者语义相近却分居两处；知识工具的「何时用」最好并入 3100 段的同一段文本。

---

## 6. 路线图与验收（DocManager）

### P2（dsh 接入与收敛）

1. 加 `mcp-client` server 配置行（`serverName: docmanager`，`streamable-http` → `9666/mcp/`），先用 `dsh plugin ... --dump-config` 验证组合。
2. 加 `toolOrder` 固定 `mcp__docmanager__*` / `cad_*` / `python_*`。
3. 新增 `packages/xiaobo-docmanager`：注册 `xiaobo:knowledge-scope` context（order 125），内容 = 当前可见信源。
4. 删除 `_initial_tool_choice` 强制路由与第二套 system prompt。
5. 预检索路由改为 `agent/pre-step` inject 或默认关闭。
6. 引用编号改为会话作用域或局部编号。

**验收**：

- 三模式问答（概述 / 精读 / 非知识）在 dsh 下路径为 `list_sources → search`（≤2 次工具调用）或 0 工具；非知识问答零知识工具调用。
- 同一会话内信源范围变化**不**改变 surface 节点、**不**开新请求序列；范围未变时不产生新的运行时上下文 user 消息。
- 跨会话回放得到相同的证据文本与编号。
- `mcp:docmanager` section 出现在 order 3100，且其文本等于 server 的 `instructions` 字面量。

---

## 7. 关键代码索引

### 7.1 DocManager（外层 AIEP）

- MCP 定义与 instructions：`AgentServer/DocManager/runtime/sag_api/mcp/server.py:302`（`build_source_mcp`）、`:310`（instructions）、`:323`（工具 schema）
- 挂载 / 鉴权 / stateless：`AgentServer/DocManager/runtime/sag_api/mcp/mount.py`
- 内置 agent 提示词：`AgentServer/DocManager/runtime/sag_api/generation/prompt.py:205`（`_identity_prompt`）、`:236`（`build_agent_messages`）
- 首轮强制路由：`AgentServer/DocManager/runtime/sag_api/services/agent_service.py:129`（`_initial_tool_choice`）
- 内置工具：`AgentServer/DocManager/runtime/sag_api/tools/builtin.py:198`（`search_context`）、`:292`（`get_entity`）
- 前端接入：`AgentServer/WebPage/src/lib/docManager/client.ts`、`AgentServer/WebPage/src/pages/KnowledgePage.vue`
- 工程结论与实测：`AgentServer/DocManager/README.md`

### 7.2 dsh MCP 与上下文机制

- MCP 客户端说明：`deepseek-harness-main/packages/mcp/mcp-client/README.zh.md`
- server instructions → section：`deepseek-harness-main/packages/mcp/mcp-client/src/server-context.ts:35`
- 工具注册：`deepseek-harness-main/packages/mcp/mcp-client/src/tools.ts`
- context 注册与 order 表：`deepseek-harness-main/packages/core/system-prompt/src/index.ts:490`（`context`）、`:165`（`CONTEXT_ORDERS`）
- 运行时上下文快照语义：`deepseek-harness-main/packages/core/agent-loop/src/runtime-context.ts`
- 同类实现参照：`deepseek-harness-main/packages/sandbox/sandbox-policy/src/index.ts:142`（`systemPrompt.context`）、`deepseek-harness-main/packages/interaction/user-approval/src/index.ts`
- 流程依据：`deepseek-harness-main/FLOW-user-request.md`

### 7.3 本仓库相关

- 提示词侧实现与落点：[`xiaobo-prompt.md`](xiaobo-prompt.md)、[`packages/xiaobo-persona`](../packages/xiaobo-persona)
- 待建：`packages/xiaobo-docmanager`（知识作用域 context）
