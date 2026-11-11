# 目录结构约定

## 目标形状

```text
dsh-qjysqjy/
├── packages/<slug>/          # 一个可独立发布、独立安装的插件
│   ├── package.json          # 包名、exports、files、engines、dsh bundle/client 声明
│   ├── cordis.patch.yml      # 把本插件的 Loader 行插进 profile
│   ├── lib/
│   │   ├── index.js          # Host 半：服务注册、Config、可选服务读取
│   │   ├── client.js         # Client 半：槽位注册、状态机、样式
│   │   └── <pure>.js         # 纯函数模块：模板、清洗、算法（可单测、无副作用）
│   ├── locale/{en,zh}.json   # 展示元数据：meta.title / meta.description
│   ├── icon.svg              # 插件管理器里显示的原作图
│   ├── README.md             # 这个插件做什么、配置项、行为契约、已知限制
│   └── test/                 # node --test 可跑的测试
├── templates/plugin/         # 骨架，被 scripts/new-plugin.mjs 复制
├── scripts/                  # 仓库级工具：校验、脚手架
├── docs/                     # 约定与发布说明（本目录）
└── AGENTS.md                 # Agent 工作规则
```

## 每条约定的理由

**一个插件一个包，不是一个插件一个仓库。** 插件的安装单元就是 npm 包：DSH 的 `plugin_manager` 装的是包，读的是包里的 `cordis.patch.yml`。仓库边界和安装边界没必要绑在一起；但校验边界和发布边界必须一致，所以每个包自带可以独立跑的测试与 manifest。

**包内 `lib/`，没有 `src/` + 构建。** 这些插件是纯 JavaScript，没有 TS 编译、没有打包器。多一层构建就多一层“本地能跑、发布后跑的是旧产物”的坑。哪天某个插件真需要 TS，就在该包内单独引入构建步骤，产物仍然落进 `lib/`，仓库里其他包不受影响。

**纯函数单独成文件。** 模板拼装、输出清洗、语言判定这类逻辑没有 Cordis 依赖，可以脱离 Host 直接单测。插件里最容易出错的两块——模型输出的脏东西、草稿比较的归一化——都落在这种文件里，测试覆盖它们比覆盖 UI 便宜得多。

**`locale/` 与 `icon.svg` 是必需项，不是装饰。** DSH 的插件页在**不激活插件**的情况下读 `package.json` 的 `exports` 找出这两个资源。缺了不会报错，只会让插件在列表里显示成包名加默认图，用户无从判断该不该启用。

**根包是私有的。** 集合本身不发布，只承载脚本与开发依赖。`packages/*` 各自发布，互不牵连。

## 什么时候该拆成新包

同一个包里放两件互不相关的能力，会让用户只能全装或全不装。出现下列任一情况就拆：

- 需要不同的 `dsh.client.platform`（一个 Web-only，一个非 Web）；
- 一个能力需要 Host 服务，另一个完全不需要，而强制 `inject` 会缩小可安装范围；
- 两者没有共享的纯函数模块；
- 用户可能只想装其中一个。

反过来，像“输入框旁的控件 + 它的 Host 端点”这种必须成对存在的东西，绝不能拆成两个包：拆开就会出现只装了 Client 半、按钮点了报 404 的形态。
