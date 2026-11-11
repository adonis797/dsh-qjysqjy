# 本地安装与发布

## 本地安装（开发期）

先在仓库根执行 `pnpm install`。`install_bundle` 只做链接，不碰包的依赖；缺依赖时安装报告 `application: failed` 与 `ERR_MODULE_NOT_FOUND`，而 profile 里的记录看起来是成功的。

`plugin_manager install_bundle` 的 `target` 是**包目录的绝对路径**：

```text
plugin_manager install_bundle <仓库根>/packages/prompt-optimizer
```

它会把这个包链接进当前 profile（`<profile>/package.json` 的 dependency 记成 `link:...`，并把包名加进 `dsh.profile.bundles`）。之后：

- **改 Client 半（`lib/client.js`、样式、文案）**：刷新页面即可，不用重装。
- **改 Host 半（`lib/index.js` 等）**：需要重新应用插件（禁用再启用，或重装），因为 Host 模块已经被加载进进程。
- **改 `package.json` 的 `dsh` 段**：必须重装，加载器只在那时读。

安装结果要看返回里的 `application` 与 `warnings`，不要看进程列表或日志猜。`applied` 才算生效。

**链接安装不会重新拷贝代码**：profile 里的那份就是仓库里的这份。所以“改了没生效”通常是 Host 模块缓存，而不是文件没同步。

## 从仓库直接安装（给别人用）

对方克隆仓库后要先在仓库根跑 `pnpm install`，再 `install_bundle` 指向包目录。**不能省**：链接安装不会装包的依赖，声明了 `@deepseek-ai/schemastery` 的包少了仓库根的 `node_modules` 就会导入失败。

发布到 registry 的版本没有这个问题——`install_bundle` / `dsh plugin add` 走的是正常包安装，依赖会一起装进来。

## npm 发布

包是公开发布也好、私有 registry 也好，步骤一致：

```bash
cd packages/prompt-optimizer
npm pack --dry-run     # 先核对实际打包清单
npm publish            # 私有 registry 加 --registry
```

发布前的三道自检：

1. **`npm pack --dry-run` 里每个运行时文件都在。** 本地是软链接安装，`files` 不生效；发布后 `files` 才生效，缺文件就是“装上了但按钮没有”。
2. **`engines.dsh` 覆盖你实测过的版本**，并且没有写成一个宽到无意义的范围。市场用它来隐藏不兼容项，写宽了等于把风险转给用户。
3. **`private` 为 `false` 或不存在**，`version` 已递增。

## 版本与兼容性

- 插件版本独立递增，不跟 DSH 版本联动。
- `engines.dsh` 用 DSH 的发布版本号，例如 `>=0.2.2-rc.1 <0.3.0-0`。`<0.3.0-0` 这种带 `-0` 的上界是刻意的：它把 `0.3.0` 的所有预发布版也排除在外，避免“下一个大版本的 rc 被当成兼容”。
- 破坏性变更（改槽位、改配置字段名、改 HTTP 路径）必须升 minor 以上，并在 README 的变更段写清迁移方式。

## 升级已安装的插件

`install_bundle` 对已存在的包会重建链接与行配置，但**新版本的 JavaScript 模块需要重启才加载**。本地链接安装时，重新应用插件行通常足够；从 tarball 或 registry 升级则按返回里的 `nextStep` 走。

## 卸载

用 `plugin_manager remove_bundle <包名>`，不要手动删 profile 的 `package.json` 条目。手动删会留下指向不存在目录的 `link:`，下次启动直接失败。
