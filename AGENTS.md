# 给 Agent 的工作规则

这个仓库是个人插件集合。改动前先读这一页，它能挡掉绝大多数会在 DSH 里翻车的写法。

## 三个不可动的东西

1. **不要手写 profile 的 `package.json` 或 `cordis.patch.yml`**。安装、启用、卸载一律走 `plugin_manager`；它写的那两个文件属于用户，不属于任何插件。
2. **不要在 bundle 的 patch 行里写 `inject`**。服务授权只有一处：模块级 `export const inject = [...]`。行级 `inject` 会把 Client 半一起锁死，症状是按钮根本不出现，而 Host 日志一片正常。
3. **不要碰 DOM 里的输入框**。读写草稿只用槽位注入的 `inputActions.setDraft` 与 `useInput`。拿不到就显式报错，不做静默降级。

## 仓库根的一次性准备

`pnpm install`。缺这一步，`install_bundle` 会报 `ERR_MODULE_NOT_FOUND`，而 profile 里的记录看着是成功的——这是最容易误判“插件坏了”的地方。写法固定为 `nodeLinker: hoisted`：Windows 上的 DSH Host 进程读不了 WSL 创建的符号链接。

## 新增插件的最小路径

1. `node scripts/new-plugin.mjs <name>` 生成骨架。
2. 用 `cordis_inspect_query` 确认要用的槽位与 Host 服务**在当前运行的 DSH 里真的存在**，再写代码。槽位名、`ownerProps`、`inject` 面都以 live inspection 为准，不以记忆为准。
3. 实现 → `node --check` → 跑包内测试 → `pnpm verify`。
4. `plugin_manager install_bundle <绝对路径>`，然后确认结果是 `application: applied`，并用 `cordis_inspect_query` 查新行是否 live。
5. 在页面上真实操作一遍。安装成功、槽位有占位项，都不等于用户看得见、点得动。

## 交付时必须写清的五件事

1. 经过验证的 DSH 版本范围（写进 `engines.dsh`，别只在 README 里提）；
2. 模板/文案是否可被用户覆盖，入口在哪；
3. 有状态功能（缓存、草稿、会话读取）的默认值；
4. 测试清单与通过情况；
5. **未验证项**：移动端窄视口、CLI/TUI、被其他插件接管 composer 的形态，凡没真跑过的都要列出来，不要用“全平台可用”糊过去。

## 中文文档

本仓库中文文档遵守 GB/T 15834-2011：全角标点，引号用“”与‘’，不用直角引号；代码、命令、路径、版本号内部保持原样。
