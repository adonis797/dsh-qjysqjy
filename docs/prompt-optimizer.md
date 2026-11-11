# @qjysqjy/dsh-prompt-optimizer：已知限制与验证范围

包内 [README](../../packages/prompt-optimizer/README.md) 面向使用者，只讲装法与配置，不再列限制。限制记在这里，交付与验收时看这一页。

## 只在 Web UI 形态可用

`dsh.client.platform` 声明为 `"web"`。CLI/TUI 与 ACP 形态不注入任何槽位，**未做任何验证**。官方 `dsh --profile web` 与 Desktop 都属于 Web 形态，两者都可用。

## 可接管 chain 的影响

`conversation.composer` 是可被接管的 chain。若被其他插件临时接管，本控件随整条工具行一起不渲染。该形态**未构造验证**。

## 视口

移动端窄视口未在真机验证：控件尺寸按桌面工具行设计（28×28），触摸命中区域未测。

## 主题

深浅色主题只在实际使用的那套皮肤下截图确认过。控件只用 `--dsw-alias-*` 令牌，换肤应当跟随，但**未逐皮肤验证**。

## 已实测

DSH `0.2.2-rc.1`，Web UI，CDP 驱动真实页面逐条走过：

| 场景 | 结果 |
|---|---|
| 空草稿 | 按钮 `disabled`，`title` 为“草稿为空，无需优化”，无 network 请求 |
| 正常改写 | 200 回填，按钮变 ↩️，`data-done` 置位 |
| 请求中取消 | `fetch` 收到 `AbortError`，`signal.aborted === true`，草稿不变 |
| 请求中继续输入 | 请求照常返回 200，结果被丢弃，用户新写的字保留 |
| 改写后再编辑 | ↩️ 置 `disabled` 且 `data-stale`，强行触发点击也不覆盖 |
| 还原 | 草稿精确回到原文，按钮回 idle |
| 中文进 / 英文进 | `language` 分别为 `zh` / `en`，输出语言一致 |

## 与 `useContext` 默认值有关的两点

`useContext` 自 0.2.0 起默认为 `true`，改写会带上会话近期消息作为背景。0.1.x 里它是 `false`。

- **上下文只影响背景，不改变回填契约。** 快照比对、还原失效、取消中断这些规则与 `useContext` 无关。
- **读取失败不阻塞改写。** 会话冷启动或 `sessionQuery` 服务缺失时，`contextFor` 返回空串，请求照常只带草稿发出。
- 想恢复旧行为（只依据草稿改写），在 profile 的 `cordis.patch.yml` 里写 `useContext: false`。
