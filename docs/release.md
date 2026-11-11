# 安装与发布

## 推荐路径：插件页点装

日常使用走插件页，不需要命令行：

1. 侧边栏 **插件** → 右上角 **添加插件**
2. 包名输入框填 `@qjysqjy/dsh-prompt-optimizer`
3. **安装** → 完成页 **立即启用**

同一条输入框也接受 Git spec 与本地绝对路径，箭头菜单里的 **安装第三方插件** 打开的是同一个对话框。

## 安装来源总览

| 来源 | 桌面版写法 | `dsh web` 写法 | 依赖 |
|---|---|---|---|
| npm | 插件页 → 添加插件 → 填包名 | `dsh plugin --profile web add @qjysqjy/dsh-prompt-optimizer` | pnpm 自动装 |
| Git | 同上，填 `github:adonis797/dsh-qjysqjy#path:/packages/prompt-optimizer` | `dsh plugin --profile web add github:adonis797/dsh-qjysqjy#path:/packages/prompt-optimizer` | pnpm 自动装 |
| 本地目录 | 同上，填包目录**绝对路径** | `dsh plugin --profile web add <包目录绝对路径>` | **要自己先 `pnpm install`** |

## 桌面版的三条硬约束

这三条不是建议，踩了会失败：

1. **`--profile desktop` 只有 Desktop 自带的 `dsh` 能操作。** `@deepseek-ai/dsh/lib/bin.js` 里的 `rejectElectronProfile` 会对其他任何安装抛出 `profile "desktop" is managed exclusively by the Electron application`。`manageDesktopProfile: true` 只在 `dsh-desktop-host/lib/cli.js` 的 `runDesktopCli` 里传入。所以别用 `npm i -g` 或 `npx` 那份去管 Desktop 的插件；用应用菜单 **管理 dsh 命令…** 装的那个。**走插件页点装则完全不受这条限制**，因为那是 Desktop 自己的进程在操作。
2. **命令行操作前必须完全退出 Desktop。** `dsh plugin --profile desktop` 会对 profile 的 `package.json` 加写锁（`lockWaitMs` 12 万毫秒），也和运行中的 Host 抢同一份清单。插件页点装不需要退出——它就在应用里跑。
3. **Desktop 至少启动过一次**，`$DSH_HOME/profiles/desktop/package.json` 才存在；否则报 `Open DeepSeek Harness Desktop once to initialize its profile`。

## 插件页 vs 设置

- **侧边栏 → 插件**：可读写。安装、升级、启停、卸载、改配置都在这一页。
- **设置 → 内置插件**：只读列表，看运行状态用。

两个页面的中文文案来自 `dsh-client-ui-plugin-manager` 与 `dsh-client-ui-settings-plugins` 的 locale，“插件”与“内置插件”是两个不同入口，别混。

## 升级

插件页原生支持升级：条目出现 **可更新** 时点 **更新**，流程是“检查 → 停止并移除旧版本 → 从 registry 安装新版本”，失败会自动重新安装原版本并把结果报成 `updateRestored`。升级后 Host 模块要重启才换。

源码依据：`updateRefusal` 只对满足这些条件的条目开放更新——`installed` 为真、`availability: "profile"`、非 official、`source` 可解析为同名 registry 包、且不 `readOnlyReason`（承载插件管理的包不能自我移除）。`readOnlyReason` 这条意味着客户端界面类插件不能走升级流程。

版本固化的坑见下节。

## 本地安装（开发期）

先在仓库根执行 `pnpm install`。本地目录来源只做链接，不碰包的依赖；缺依赖时安装报告 `application: failed` 与 `ERR_MODULE_NOT_FOUND`，而 profile 里的记录看起来是成功的。

`plugin_manager install_bundle` 的 `target` 是**包目录的绝对路径**（`dsh plugin ... add` 用的也是同一种写法）：

```text
plugin_manager install_bundle <仓库根>/packages/prompt-optimizer
dsh plugin --profile desktop add <仓库根>/packages/prompt-optimizer
```

它会把这个包链接进当前 profile（`<profile>/package.json` 的 dependency 记成 `link:...`，并把包名加进 `dsh.profile.bundles`）。之后：

- **改 Client 半（`lib/client.js`、样式、文案）**：刷新页面即可，不用重装。
- **改 Host 半（`lib/index.js` 等）**：需要重新应用插件（禁用再启用，或重装），因为 Host 模块已经被加载进进程。
- **改 `package.json` 的 `dsh` 段**：必须重装，加载器只在那时读。

安装结果要看返回里的 `application` 与 `warnings`，不要看进程列表或日志猜。`applied` 才算生效。

**链接安装不会重新拷贝代码**：profile 里的那份就是仓库里的这份。所以“改了没生效”通常是 Host 模块缓存，而不是文件没同步。

## 从 Git 安装

```text
github:adonis797/dsh-qjysqjy#path:/packages/prompt-optimizer
```

`#path:` 片段指向 monorepo 里的包目录，去掉就是仓库根——仓库根不是可安装的 bundle，会失败。这条来源装的是 `main` 上的最新提交，lockfile 会钉住当时的 commit；要某个确定的版本请用 npm 加精确版本号。

Git / 压缩包来源的 `engines.dsh` 检查发生在**抓取之后**：不满足时安装会把 profile 清单与锁文件恢复原样，再报告失败。注册表来源则在 `pnpm` 运行前就拒绝，什么都不会下载。

GitHub 来源在 pnpm 之前还有一次 `git ls-remote` 预检（默认 5 秒超时，只探仓库可达性，会剥掉 `#` 之后的内容）。预检失败会带 `failedAt: 'spec-host'` 返回，不进入下载。

## npm 发布

**默认走 CI。** `.github/workflows/publish.yml` 在推送 `v*` 标签时运行：

```bash
# 1. 改 packages/<包>/package.json 的 version
# 2. 本地跑一遍
pnpm verify
# 3. 提交、打标签、推送
git commit -am "chore: release <包名> <版本>"
git tag -a v<版本> -m "<包名> <版本>"
git push && git push --follow-tags
```

工作流做三件事：跑 `pnpm verify`、核对标签与包版本一致（不一致直接失败，避免发错版本）、再发布。已经存在的版本会被跳过，所以重复推标签不会炸。

### 一次性配置：Trusted Publisher

CI 用 OIDC 认证，仓库里不存任何 token。首次启用前要在 npm 网页上把包和 workflow 绑起来：

1. 打开 `https://www.npmjs.com/package/<包名>/settings`
2. **Trusted Publisher** → **GitHub Actions**，填：
   - Organization or user：`adonis797`
   - Repository：`dsh-qjysqjy`
   - Workflow filename：`publish.yml`
   - Allowed actions：勾 **npm publish**
3. 保存。配置本身不会被校验，写错只有发布时才报错。

新配置要在 2 天内完成第一次成功发布，否则过期，得删掉重建。

绑定好之后，可以到 **Settings → Publishing access** 选 **Require two-factor authentication and disallow tokens**，把本地 token 发布这条路彻底关掉。OIDC 不受该设置影响。

### 手动发布（CI 不可用时）

包里已声明 `publishConfig.access: public`，scoped 包不用再带 `--access public`：

```bash
cd packages/prompt-optimizer
npm pack --dry-run     # 先核对实际打包清单
npm publish            # 私有 registry 加 --registry
```

⚠️ 新包的默认发布策略要求 **2FA 或带 bypass-2FA 的 granular token**。账号没开 2FA 时，普通 token 会在 PUT 阶段被 403 拒绝，报“Two-factor authentication or granular access token with bypass 2fa enabled is required”。届时到 `https://www.npmjs.com/settings/<用户名>/tokens` 建一个 granular token，勾上 **Bypass two-factor authentication**，权限给 `Read and write`、范围选 `@qjysqjy`，写进 `~/.npmrc` 的 `//registry.npmjs.org/:_authToken=`。

发布前自检：

1. **`npm pack --dry-run` 里每个运行时文件都在。** 本地是软链接安装，`files` 不生效；发布后 `files` 才生效，缺文件就是“装上了但按钮没有”。
2. **`engines.dsh` 覆盖你实测过的版本**，并且没有写成一个宽到无意义的范围。市场用它来隐藏不兼容项，写宽了等于把风险转给用户。
3. **`private` 为 `false` 或不存在**，`version` 已递增。
4. **包内 README 是给人看的最终版。** npm 页面上渲染的是 tarball 里那份，改了仓库里的 README 但不发版，页面就是旧的。

### 关于 `0.0.0-stage`

本包首次发布时，registry 里多出一个 `0.0.0-stage` 版本（描述是 "Temporary package placeholder for staged publishing"，2 个文件、351 B）。这是 npm 在包名尚未存在时用来占位的一次性产物，**不是**任何一次真实 tarball 的内容，也不影响安装：`dist-tags.latest` 指向最新正式版本，装包名拿到的是它。

它不能删（npm 不允许 unpublish 整个包的唯一版本），也不需要处理。`npm view <包名> versions` 会把它和正式版本一起列出，别被误导。

## 版本与兼容性

- 插件版本独立递增，不跟 DSH 版本联动。
- `engines.dsh` 用 DSH 的发布版本号，例如 `>=0.2.2-rc.1 <0.3.0-0`。`<0.3.0-0` 这种带 `-0` 的上界是刻意的：它把 `0.3.0` 的所有预发布版也排除在外，避免“下一个大版本的 rc 被当成兼容”。
- 破坏性变更（改槽位、改配置字段名、改 HTTP 路径、**改任何配置项的默认值**）必须升 minor 以上，并在文档里写清迁移方式。`useContext` 从 `false` 改成 `true` 就是这类：改的是默认行为，装上新版本的人会立刻感受到差异，所以走的是 `0.1.0` → `0.2.0`。

## 升级已安装的插件

**首选插件页的“更新”。** 它自己检查新版本、停止并移除旧版本、安装新版本，失败时回滚。升级后 **Host 模块要重启才换**——新版本的文件已经在盘上，但旧模块还挂在进程里。

`install_bundle` 对已存在的包会重建链接与行配置，但同样需要重启才加载新代码。本地链接安装时，重新应用插件行通常足够；从 tarball 或 registry 升级则按返回里的 `nextStep` 走。

### 跨 minor 升级的版本固化坑

profile 的 `package.json` 记的是安装时解析出的范围，`pnpm add` 会把它写成 `^x.y.z`。**`0.x` 的 caret 只锁 minor**：`^0.1.0` 的上界是 `0.2.0`，所以 0.2.0 发布后它不会跟过来。

本机实际踩到过：profile 里是 `^0.1.0`，装的还是 0.1.0，而 0.2.0 已经发布。要跨 minor，卸载后重装并写精确版本：

```sh
dsh plugin --profile desktop remove @qjysqjy/dsh-prompt-optimizer
dsh plugin --profile desktop add @qjysqjy/dsh-prompt-optimizer@0.2.0
```

实测确认：干净目录里 `pnpm add @qjysqjy/dsh-prompt-optimizer` 解析到 0.2.0 并记成 `^0.2.0`；写精确 `@0.2.0` 也能装下来。**新版本等待期在这里没有实际拦截效果**——本机 pnpm 11.28.5 的 `minimumReleaseAge` 未配置（`config get` 返回 `undefined`），0.2.0 发布约 20 分钟后即可直接安装。

从 GitHub 装的同理，重装才会拉到新提交。判断装的是哪一份，看 profile 的 `package.json`：`link:` 是本地路径，`github:` 是仓库，其余是 registry 版本。

## 卸载

插件页里点该条目删除即可。命令行等价写法：`dsh plugin --profile desktop remove <包名>`（需先完全退出 Desktop），或 Agent 侧 `plugin_manager remove_bundle <包名>`。

不要手动删 profile 的 `package.json` 条目。手动删会留下指向不存在目录的 `link:`，下次启动直接失败。
