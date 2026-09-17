# dsh-xb-deploy

小博的**部署层**：一个纯 patch 的 dsh bundle，承载"属于产品组合、而不属于任何单一能力"的配置。
它不含代码，也不插入自己的 row —— 只覆盖 in-box（内置）row。

## 为什么要单独一个 bundle

dsh 的 profile 是逐层叠加 patch 组装出来的：in-box bundle 各自拥有自己的值（`dsh-base` 给默认值，
`dsh-web-app` 给浏览器界面的值），部署方负责声明自己不同意的部分。有两条规则把"小博特有的值"
挤出了能力插件：

1. **patch 会整体替换目标 row 的 config。** 关掉 `harness:identity` 就必须同时重申
   `personaPrefix` / `personaSuffix`，于是 `dsh-web-app` 写的通用 persona 也被清掉。这是部署决策；
   放进 `dsh-xb-xiaobo-persona` 会让"只想复用 persona 能力"的人被静默改掉自己已有的 persona。
2. **层序在不同形态下不一样。** Desktop 上第三方 bundle 的层序是**包名字典序**而不是安装序，
   所以"哪个 bundle 赢哪一行"是组合事实，不是插件事实。

把覆盖放在这里，能力插件才能保持纯粹：只注册自己的 section，永不 patch 别人的 row。

## 它改了什么

```yaml
- id: system-prompt
  config:
    includeHarnessIdentity: false   # 去掉内置的 "powered by DeepSeek Harness" 开头
    personaPrefix: ''               # 清掉 dsh-web-app 的通用 coding-agent persona
    personaSuffix: ''
    # toolOrder 省略：暂时走 schema 默认（字典序）
```

## 安装

一次小博部署会同时列出「本 bundle」与它所组合的能力 bundle；顺序无关（Web/CLI 按安装序，
Desktop 按包名字典序）。

```sh
# Web/CLI（harness 源码 checkout）
pnpm dsh plugin --profile xb add <path-to>/dsh-xb-plugins/deploy
pnpm dsh plugin --profile xb add <path-to>/dsh-xb-plugins/packages/xiaobo-persona
pnpm dsh --profile xb
```

```text
# Desktop，在插件窗口里逐个添加
dsh-xb-deploy@0.1.0
dsh-xb-xiaobo-persona@0.1.0
```

其余安装方式（Web/CLI profile、一次性 overlay、Desktop 正式与本机验证路径）见
[`docs/plugins.md`](../docs/plugins.md)。

## 验证

```sh
pnpm dsh --profile xb --dump-config | sed -n '/system-prompt/,+5p'
```

渲染出的系统提示词应以小博身份开头，而不是内置 harness 开头句。对应的契约测试在
`packages/xiaobo-persona/tests/integration.spec.ts`（"drops the harness identity when the
deployment layer suppresses it"）。

## 后续往这里放什么

只放部署级的值，不放能力行为：

- `toolOrder` —— 等 CAD / Python / DocManager 工具包就位后固定工具顺序，保证工具目录逐 step 字节稳定。
- DocManager 的 `@deepseek-ai/dsh-mcp-client` row（若部署希望默认开启）。
- 白标构建需要的任何 `system-prompt` 值（**插件自己的** `locale` 仍留在插件 row 的 config 里；
  只要归 registry 管的就放这里）。
