# 插件工程约定

适用于 `packages/` 下的每个包。`scripts/verify.mjs` 会机械地检查其中可检查的部分。

## 1. Manifest

```json
{
  "name": "@qjysqjy/dsh-<slug>",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22", "dsh": ">=0.2.2-rc.1 <0.3.0-0" },
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  }
}
```

- **`engines.dsh` 必填。** 插件市场按它判断兼容性；不写就是“未知”，用户装上才知道崩。范围写成能覆盖你实测过的版本。
- **`files` 必须列出运行时真正需要的每个文件。** 本地目录安装是软链接，`files` 不生效，所以“本地能跑”证明不了发布后能跑。发版前用 `npm pack --dry-run` 核对一次实际打包清单。
- **`dsh.client.inject` 只写用来排序激活的包名**，不是权限声明；真正的服务访问在模块级 `inject`。

## 2. Patch

```yaml
- insert:
    - id: qjysqjy-<slug>
      name: '@qjysqjy/dsh-<slug>'
```

- 行 id 在整个集合内唯一，前缀带集合名，避免与社区插件撞行。
- **行里绝不写 `inject`。** 行级 `inject` 与模块级 `export const inject` 是同一套授权，写在行上会同时约束 Client 半。
- 需要默认配置就写 `config:`，但要与 `Config` schema 对得上，否则激活即校验失败。

## 3. Host 半

- 用 `export function apply(ctx, config)` 形式；可选 `export const inject`、`export const Config`。
- 只申报真正用到的服务。**可选依赖一律 `ctx.get(name)` 加 undefined 判断**，让插件在没有该服务的组合里安静地不激活，而不是抛错。
- 所有注册（路由、监听、定时器、工具）都包在 `ctx.effect(...)` 或 `ctx.on(...)` 里，并返回清理函数。插件被禁用时必须干净退出。
- 需要用户可调的值写进 `Config`，让用户在 profile 的 `cordis.patch.yml` 里覆盖；不要硬编码在 `apply` 里。
- 对外 HTTP 端点：同源、`content-type` 必须 JSON、body 有字节上限、空输入与超长输入在**调用模型之前**就返回 4xx。

## 4. Client 半

- 用 `window.__ModuleLoader__.load({ id, factory(require) })` 形式注册，`id` 等于包名。
- 槽位名、注册项、可用 props 以 `cordis_inspect_query` 的 `Slots.listSubTree` 结果为准。
- 用 `ctx.slots.inject(slot, () => ctx.slots.register(...))`，不要直接 `register`；`inject` 负责等槽位出现、并在槽位塌陷时卸掉你的贡献。
- 所有 UI 文案走 `locale` 服务，键集中在一处；`locale` 缺失时用英文表兜底，不要显示原始键名。
- 样式用 `--dsw-alias-*` 主题令牌，不用字面色值（插图除外）；注入的 `<style>` 带唯一的 `data-plugin-css` 标识并在卸载时移除。
- **输入框只通过 `inputActions` 读写。** 找不到写入方法就报错，不降级到 DOM 查询。

## 5. 有状态交互的四条硬规则

适用于任何“改写草稿 / 插入内容 / 替换选区”的控件：

1. **快照比对。** 请求发出时记录草稿快照，回填前重新读一遍；不一致就丢弃结果，不覆盖用户新写的字。
2. **归一化比较。** 比较用编辑器自己的归一化（换行风格、行尾空白），否则刚回填的内容会被判成“用户改过”。
3. **还原必须有失效条件。** 用户改写后又编辑，还原点立即失效；点击还原也不能覆盖。
4. **取消要真取消。** `AbortController.abort()` 让请求真的断开，Host 侧连带的模型调用一起停；只把 UI 改回 idle 属于 bug。

## 6. 展示资源

- `locale/en.json` 与 `locale/zh.json` 都要有 `meta.title`、`meta.description`，写清“这个插件让用户能做什么”，不要写技术实现。
- `icon.svg` 必须是自己画的或有可再分发许可的图形，保留必要的署名；体积不超过 256 KiB，路径不出包。
- 缺这两样不会让插件失效，只会让它在插件页里无法辨认。`scripts/verify.mjs` 会拦下来。

## 7. 测试

- 纯函数与引擎：`node --test`，用假的 `llm` 服务记录请求并回放答案，不真调模型。
- Client 状态机：加载**真实的** `lib/client.js`，用最小 React 替身驱动，断言渲染出的按钮与草稿写入序列。不要复制一份逻辑再测——那测的是副本。
- 至少覆盖：空输入不发请求、成功回填、回填后继续编辑时还原被拒、请求中取消真中断、请求中编辑则丢弃结果、缺 `inputActions` 显式报错。
