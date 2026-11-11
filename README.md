# dsh-qjysqjy

QJYSQJY 的个人 DeepSeek Harness 插件集合。一个插件一个包，共用一个仓库、一套约定、一条校验命令。

这里的每个包都是**可直接安装的 DSH bundle**：Host 半在 Node.js 进程里跑，Client 半在 Web 页面的槽位里渲染。集合本身不发布，发布的是 `packages/` 下的各个包。

## 目录结构

```text
dsh-qjysqjy/
├── packages/                 # 每个子目录是一个可独立发布、独立安装的插件
│   └── prompt-optimizer/     # @qjysqjy/dsh-prompt-optimizer
├── templates/plugin/         # 新插件的起手模板，被 scripts/new-plugin.mjs 使用
├── scripts/
│   ├── verify.mjs            # 全集合静态校验 + 各包测试
│   └── new-plugin.mjs        # 从模板生成一个新包
├── .github/workflows/
│   ├── verify.yml            # 每次 push/PR 跑校验
│   └── publish.yml           # 推 v* 标签时经 OIDC 发布到 npm
├── docs/
│   ├── layout.md             # 目录结构约定与取舍理由
│   ├── plugin-conventions.md # 插件工程约定（manifest、Host/Client、Config、展示资源）
│   ├── prompt-optimizer.md   # 该插件的已知限制与验证范围
│   └── release.md            # 安装来源、npm 发布、兼容性声明
├── AGENTS.md                 # 给 AI Agent 的工作规则
├── package.json              # 私有根包，只承载脚本与开发依赖
└── pnpm-workspace.yaml
```

**为什么是 monorepo 而不是一堆平铺目录**：插件之间会共享同一条校验流水线（manifest 形状、patch 语法、`inject` 授权层、展示元数据、测试），也会共享同一套“怎么装、怎么发”的知识。合在一个仓库里，这两件事各只有一份；分开发布仍然互不影响，因为每个包自带 `package.json`、`files` 与 `cordis.patch.yml`。

**为什么每个包必须自带 `cordis.patch.yml`**：DSH 通过 bundle patch 把插件行插进 profile 的 Loader 树。没有 patch 的包只能手动改用户的 `cordis.patch.yml`，那既不可升级也不可分发。

## 包列表

| 包 | 作用 | 状态 |
|---|---|---|
| [`@qjysqjy/dsh-prompt-optimizer`](packages/prompt-optimizer/README.md) | 把输入框草稿就地改写为结构化提示词，一键还原、真实取消 | 0.2.1，已发布到 npm |

## 安装

推荐路径只有一条：在 DSH Desktop 的插件页里点着装。其余方式列在后面，供没有 Desktop 或需要跟源码的场景使用。

### 在 DSH Desktop 里装（推荐）

1. 打开 DeepSeek Harness Desktop
2. 点左侧边栏的 **插件**
3. 点右上角 **添加插件**
4. 在包名输入框填 `@qjysqjy/dsh-prompt-optimizer`
5. 点 **安装**，装完在完成页点 **立即启用**

对话框里的“安装源”默认会探测最快的 registry，一般不用动。装完如果提示需要重启，按提示重启。

> 侧边栏的 **插件** 页才是可读写的那一页。**设置 → 内置插件** 是只读列表，只能看，不能装。

同一条输入框还能填其他来源：Git 仓库 `github:adonis797/dsh-qjysqjy#path:/packages/prompt-optimizer`（跟 `main` 最新提交），或包目录的绝对路径（改代码时用，见下）。点输入框右边的箭头选 **安装第三方插件** 打开的是同一个对话框。

### 升级

插件页会自己检查新版本。条目上出现 **可更新** 标记时，点 **更新** 即可——升级过程会先移除旧版本再装新版本，失败时自动回滚到原来的版本。

**升级后要重启 DSH。** 页面提示“已安装 x.y.z，重启后生效”时，Host 模块仍在旧进程里。

没有出现更新标记时，检查两件事：一是插件页的 **刷新** 按钮（手动刷新才会重新读版本），二是下面这条版本固化陷阱。

### 版本固化陷阱

profile 的 `package.json` 记的是安装时解析到的范围。用 `pnpm add` 装的包会被记成 `^x.y.z`，而 **`0.x` 的 caret 只锁 minor**：`^0.1.0` 的上界是 `0.2.0`，所以 0.2.0 发布后它不会跟过来。

本机就踩过这个：profile 里是 `^0.1.0`，实际装的还是 0.1.0，而 0.2.0 早已发布。要跨 minor 升级，卸载后重装并写精确版本：

```sh
dsh plugin --profile desktop remove @qjysqjy/dsh-prompt-optimizer
dsh plugin --profile desktop add @qjysqjy/dsh-prompt-optimizer@0.2.1
```

自测过：新目录里 `pnpm add @qjysqjy/dsh-prompt-optimizer` 直接拿到最新版并记成 `^0.2.x`，写精确版本同样装得下来，不会被新版本等待期挡住。

### 命令行（`dsh` 可用时）

```sh
dsh plugin --profile desktop add @qjysqjy/dsh-prompt-optimizer
```

跑 web profile 的换成 `--profile web`，重启 `dsh web` 生效。

三条必须知道的约束：

- **必须用 Desktop 自带的 `dsh` 命令。** 从 npm 或别处装的 `dsh` 会拒绝 `--profile desktop`，报 `profile "desktop" is managed exclusively by the Electron application`。这个命令从应用菜单 **管理 dsh 命令…** 安装（Windows 上菜单栏默认隐藏，先从窗口菜单唤出），装完开个新终端跑 `dsh --version` 验证。
- **执行前完全退出 Desktop**，不只是关窗口。Windows 要从托盘右键退出。否则会和运行中的进程抢 profile 目录。
- 装完再打开 Desktop 才会加载新插件。

### 本地目录（改代码时）

先在仓库根装依赖：

```bash
pnpm install
```

再把**包目录的绝对路径**填进插件页的包名输入框，例如：

```text
D:\path\to\dsh-qjysqjy\packages\prompt-optimizer
```

**`pnpm install` 这一步不能跳。** 本地目录来源只做链接，**不会**为它装依赖。包里的 `import '@deepseek-ai/schemastery'` 要靠仓库根的 `node_modules` 解析——少了它，安装报告 `application: failed` 与 `ERR_MODULE_NOT_FOUND`，而 profile 里的记录看起来还是成功的。`pnpm-workspace.yaml` 固定了 `nodeLinker: hoisted`，因为 Windows 上的 DSH Host 进程读不了 WSL 创建的符号链接。走 registry 或 Git 来源时没有这个问题，pnpm 会把依赖装进 profile。

改完代码：`lib/client.js` 刷新页面即可；`lib/index.js` 要禁用再启用插件行（Host 模块已在进程里）。

### 装好之后

插件页里出现一行，标题与图标来自包内 `locale/*.json` 与 `icon.svg`，**未激活时也能读到**。打开任一会话，输入框工具行、模型选择器左侧就是优化控件。

### 卸载

插件页里点该条目，选删除。命令行等价写法（需先完全退出 Desktop）：

```sh
dsh plugin --profile desktop remove @qjysqjy/dsh-prompt-optimizer
```

不要手动删 profile 的 `package.json` 条目。手动删会留下指向不存在目录的 `link:`，下次启动直接失败。

## 新增一个插件

```bash
node scripts/new-plugin.mjs my-widget \
  --title "我的组件" \
  --title-en "My widget" \
  --description "在输入框下方画一条装饰线。" \
  --description-en "Draws a decoration under the composer."
```

中英文标题与描述都是必填：插件页按当前语言读 `meta.title` 与 `meta.description`，缺一份就有一半用户看到的是包名。

它会在 `packages/my-widget/` 生成 `package.json`、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`、`locale/{en,zh}.json`、`icon.svg`、`README.md` 与一个冒烟测试，并把包名、行 id、locale 命名空间全部填好。之后按 [`docs/plugin-conventions.md`](docs/plugin-conventions.md) 改实现即可。

## 校验

```bash
pnpm install     # 首次
pnpm verify      # 或 node scripts/verify.mjs
```

校验内容：

1. **manifest 形状**：包名 scope、`type`、`exports` 五个必需子路径、`files`、`engines.node` 与 `engines.dsh`；
2. **patch 卫生**：`cordis.patch.yml` 能被解析，插入了至少一行，且**任何行都不带 `inject` 字段**（那会锁死 Client 半的服务访问）；
3. **行 id 唯一**：全集合内不允许两个插件抢同一个 Loader 行；
4. **依赖可解析**：`dependencies` 里声明的包能从该包解析到。链接安装不会替你装依赖，这一步把“装上了但 Host 导入失败”提前到本地；
5. **打包清单完整**：`files` 覆盖 `lib/` 下每个运行时模块与 README——本地链接安装不看 `files`，只有发布出去的 tarball 才会因为漏列而少文件；
6. **语法**：每个 `lib/*.js` 通过 `node --check`；
7. **展示资源**：`locale/*.json` 可解析且带 `meta.title` / `meta.description`，`icon.svg` 存在、体积合规、像 SVG；
8. **包内测试**：有测试就跑，失败即整体失败。

任何一项失败，命令以非零码退出，输出点名到包、规则与具体文件。

## 许可

MIT，见 [LICENSE](LICENSE)。
