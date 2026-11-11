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
├── docs/
│   ├── layout.md             # 目录结构约定与取舍理由
│   ├── plugin-conventions.md # 插件工程约定（manifest、Host/Client、Config、展示资源）
│   └── release.md            # 本地安装、npm 发布、兼容性声明
├── AGENTS.md                 # 给 AI Agent 的工作规则
├── package.json              # 私有根包，只承载脚本与开发依赖
└── pnpm-workspace.yaml
```

**为什么是 monorepo 而不是一堆平铺目录**：插件之间会共享同一条校验流水线（manifest 形状、patch 语法、`inject` 授权层、展示元数据、测试），也会共享同一套“怎么装、怎么发”的知识。合在一个仓库里，这两件事各只有一份；分开发布仍然互不影响，因为每个包自带 `package.json`、`files` 与 `cordis.patch.yml`。

**为什么每个包必须自带 `cordis.patch.yml`**：DSH 通过 bundle patch 把插件行插进 profile 的 Loader 树。没有 patch 的包只能手动改用户的 `cordis.patch.yml`，那既不可升级也不可分发。

## 包列表

| 包 | 作用 | 状态 |
|---|---|---|
| [`@qjysqjy/dsh-prompt-optimizer`](packages/prompt-optimizer/README.md) | 把输入框草稿就地改写为结构化提示词，一键还原、真实取消 | 0.1.0 |

## 安装一个插件

先装依赖，再装插件：

```bash
pnpm install
```

```text
plugin_manager install_bundle <本仓库中该包的绝对路径>
```

例如 `<仓库根>/packages/prompt-optimizer`。

**这一步不能跳。** `install_bundle` 只把包目录链接进 profile，**不会**为它安装依赖。包里的 `import '@deepseek-ai/schemastery'` 要靠仓库根的 `node_modules` 解析——少了它，安装结果会是 `application: failed`，报 `ERR_MODULE_NOT_FOUND`。`pnpm-workspace.yaml` 固定了 `nodeLinker: hoisted`，因为 Windows 上的 DSH Host 进程读不了 WSL 创建的符号链接。

装好后在 **设置 → 插件** 里能看到该包一行，标题与图标来自包内 `locale/*.json` 与 `icon.svg`，不需要先激活插件。

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
