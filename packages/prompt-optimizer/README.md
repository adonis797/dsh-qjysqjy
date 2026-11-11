# 提示词优化

在 DSH Web UI 输入框的工具行里加一个**优化**控件：把当前草稿就地改写为结构化提示词，回填输入框，并且可以一键还原原文。

- 改写是**纯文本操作**：不执行工具、不发消息、不产生会话轮次。
- 复用**当前会话自己的模型路由**，不需要额外配置 API Key 或供应商账号。
- 只动**草稿**。附件与 `@` 引用芯片保持原样；草稿以斜杠命令开头时控件不生效。

## 样子

| 草稿已填 | 优化进行中（再点即取消） | 改写完成（点一下还原） |
|---|---|---|
| ![typed](./screenshots/composer-typed.jpg) | ![optimizing](./screenshots/toolrow-optimizing.jpg) | ![undo](./screenshots/toolrow-undo.jpg) |

![plugin row](./screenshots/plugins-row.jpg)

## 安装

```text
plugin_manager install_bundle @qjysqjy/dsh-prompt-optimizer
```

也可以在 **侧边栏 → 插件 → 添加插件** 里输入同一个包名。想跟最新提交就改用 `github:adonis797/dsh-qjysqjy#path:/packages/prompt-optimizer`；改代码则从本地克隆装，先在仓库根 `pnpm install`。

装好刷新页面即可，控件出现在输入框工具行、模型选择器左侧。

## 配置

每个字段都可选，缺省走内置默认值。在 profile 的 `cordis.patch.yml` 里按行 id 覆盖：

```yaml
- id: qjysqjy-prompt-optimizer
  config:
    useContext: false
    maxOutputTokens: 2048
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `systemTemplate` | 内置 | 系统提示词。空字符串表示用内置契约。 |
| `userTemplate` | 内置 | 首次改写的用户提示词，占位符 `{draft}`。 |
| `revisionTemplate` | 内置 | 增量修订的用户提示词，占位符 `{draft}`、`{previous}`。 |
| `contextTemplate` | 内置 | 携带上下文时追加的段落，占位符 `{context}`。 |
| `useContext` | `true` | 是否把会话近期消息作为背景发给模型。关掉可省 token，也让改写只依据草稿。 |
| `maxContextChars` | `2000` | 开启上下文时保留的字符数上限。 |
| `maxDraftChars` | `12000` | 接受的最大草稿长度，超过直接拒绝且不调模型。 |
| `maxOutputTokens` | `4096` | 单次改写的输出上限。 |
| `provider` / `model` | 未设 | 可选的固定路由，两者同时设置才生效，用于停止跟随会话。 |

## 行为

| 状态 | 触发 | 控件 | 点击后 |
|---|---|---|---|
| idle | 首次渲染、还原之后 | ✨ | 发起优化 |
| optimizing | ✨ 被按下 | 转圈 | **取消**——`fetch` 被 abort，Host 侧连带中断模型调用 |
| done | 改写已回填 | ↩️ | 还原为捕获的原文 |
| dirty | 回填后用户又编辑 | ↩️ 禁用，并多出一个 ✨ | 还原被拒绝；新 ✨ 基于当前编辑做增量修订 |

几条钉住的规则：空草稿不发请求；请求期间用户继续输入，结果**被丢弃**而不是覆盖；还原绝不覆盖改写之后用户自己写的字；语言锁定，中文进中文出、英文进英文出。

## HTTP 端点

```text
POST /__qjysqjy-prompt-optimizer/optimize
请求：{ text: string, sessionId: string, previousResult?: string }
响应：{ enhanced: string, language: string, provider: string, model: string }
```

空草稿、超长、缺 `sessionId` 一律 4xx 且不调模型；请求体上限 96 KiB；无可用路由返回 409，模型失败返回 502。

## 开发

```text
lib/index.js     Host 半：路由、路由解析、模型调用
lib/optimize.js  引擎：流收集、失败映射
lib/prompt.js    纯函数：模板、清洗、语言判定
lib/client.js    Client 半：槽位注册、状态机、样式
```

```text
node --test test/unit.test.js test/client.test.mjs
```

Client 套件加载**真实的** `lib/client.js`，用最小 React 替身驱动，因此测的是发布出去的那份代码。
