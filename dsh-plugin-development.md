# DSH 插件开发指南（AI 参考手册）

> 本文档是 DeepSeek Harness（DSH）插件开发的范本。读完本文档即可独立开发、安装、验证一个 DSH 插件。
> 内容基于对 dsh v0.1.0-rc.8 源码与实际安装过程的验证，所有契约均以真实代码为准。

---

## 0. 30 秒速览（TL;DR）

一个 DSH 插件 = 一个 npm 包，满足三个条件：

1. `package.json` 声明 `dsh.bundle.patch`（host 组合行）和 `dsh.client`（浏览器 bundle，可选）；
2. 附带 `cordis.patch.yml`，用 `- insert:` 把自己的插件行插进 profile 组合树；
3. 用 `dsh plugin --profile <name> add <包路径|包名>` 安装，重启 dsh 后生效。

浏览器端 UI 通过 **Slot（插槽）** 注册：在 `apply(ctx)` 里调 `ctx.slots.register({ name: '<slot名>', id: '<你的id>' }, 组件)`。

---

## 1. 两种插件形态：先选对形态再动手

| 形态 | 生命周期 | 适用场景 | 开发方式 |
|---|---|---|---|
| **动态 Cordis 插件** | 仅当前进程，重启即消失 | 快速试验、临时 UI、一次性工具 | 会话内用 `cordis_define` / `cordis_run` 工具，代码作为字符串传入，不落盘 |
| **Profile 静态插件**（本文重点） | 永久，随 profile 启动加载 | 正式功能、长期安装 | 本地 npm 包 + `dsh plugin add` |

判断标准：用户要"装上""以后都用"→ 静态插件；用户要"现在试一下""临时加个按钮"→ 动态插件。

---

## 2. 架构基础（必须理解的概念）

### 2.1 一切能力都是 composition 里的一行

DSH 的运行时由 Cordis 组合（composition）描述：一个 YAML 插件行（row）列表。每行：

```yaml
- id: some-unique-id        # 行 id，组合树内唯一
  name: 'some-npm-package'  # 解析为 node_modules 里的包
  disabled: true            # 可选：禁用
  config: { ... }           # 可选：传给插件的配置
```

### 2.2 Profile 的层叠结构

Profile 目录：`$DSH_HOME/profiles/<name>/`（`DSH_HOME` 默认为 `~/.dsh`）。

```
profiles/web/
├── package.json        # 关键：dependencies + dsh.profile.bundles 列表
├── cordis.yml          # profile 根（通常是空数组 []，不要直接编辑）
├── cordis.patch.yml    # 用户层 patch（禁用某行、覆盖 config 在这里做）
└── node_modules/       # pnpm 管理的插件包
```

组合顺序（自下而上）：

1. `package.json` 的 `dsh.profile.bundles` 数组里每个 bundle 包自带的 patch 文件（由包内 `dsh.bundle.patch` 指定，通常是 `cordis.patch.yml`）；
2. profile 的 `cordis.patch.yml`（用户层，机器本地偏好）；
3. 命令行 `--patch` 覆盖层。

**插件包通过"自己是 bundle、自带 patch 插入自己的行"来激活。** `dsh plugin add` 会自动把声明了 `dsh.bundle` 的包加进 `dsh.profile.bundles`。

### 2.3 Host 与 Client 两个平面

| 平面 | 运行环境 | 能力 |
|---|---|---|
| **Host（node 半部分）** | DSH 的 Node.js 进程 | 文件、网络、命令、会话、模型工具、RPC 端点 |
| **Client（browser 半部分）** | 浏览器页面 | 主题、布局、Slot UI、页面状态 |

一个包可以同时携带两半：`lib/index.js`（host 入口，`main` 指向它）+ `lib/client.js`（浏览器 bundle，`exports["./client"]` 指向它）。两半用同一个行 id 加载，**不需要也不允许第二行**（重复 id 会加载失败）。

### 2.4 Web 插件图谱的组装机制（理解后能排查加载问题）

Host 端的 `ClientModuleRegistry`（来自 `@deepseek-ai/dsh-client-modules`）会：

1. 扫描 loader 中所有已激活行，解析其包的 `package.json`；
2. 若包声明了 `dsh.client.platform: "web"` 且 `exports["./client"]` 存在，就把它加入 web 插件图谱；
3. 把图谱注入 HTML 为 `window.__DSH_BOOT__`，并按 `/plugins/<包名>/client.js` 提供 bundle 文件；
4. 浏览器端的模块系统（`window.__ModuleLoader__`）按图谱顺序执行各 bundle 的 factory。

推论：
- **插件集合的变化需要重启 dsh 进程**（包的元信息判定有永久缓存）；
- 浏览器需要**刷新页面**才能读到新的 `__DSH_BOOT__`；
- bundle 文件内容变化靠 rev 哈希传播（HMR 场景），但新增/删除行必须重启。

---

## 3. 插件包结构（完整范本）

以真实可用的五子棋插件 `dsh-gomoku-local` 为例（纯浏览器插件，host 半部分为空）：

```
dsh-gomoku-local/
├── package.json        # 声明 dsh.bundle + dsh.client
├── cordis.patch.yml    # 插入自己的组合行
└── lib/
    ├── index.js        # node 半部分（host 入口）
    └── client.js       # 浏览器 bundle（手写，无需构建）
```

### 3.1 package.json

```json
{
  "name": "dsh-gomoku-local",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json",
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-conversation"
      ]
    }
  }
}
```

字段要点：

| 字段 | 作用 | 注意 |
|---|---|---|
| `dsh.bundle.patch` | 声明自己是 profile bundle，`dsh plugin add` 凭此把它加入 bundles 列表 | 路径必须存在，且要在 `exports` 里暴露（`"./cordis.patch.yml"`） |
| `dsh.client.platform` | 必须是 `"web"`，否则不被当作浏览器插件 | 没有此字段 = 纯 host 插件 |
| `dsh.client.inject` | **包级**依赖排序：本包 bundle 要在哪些包之后加载 | 写包名；你的 slot 由哪个包声明，就 inject 哪个包 |
| `exports["./client"]` | 浏览器 bundle 的路径 | 缺失会报 `declares dsh.client but exports no "./client" bundle` |
| `main` | host 入口 | 即使 host 为空也必须有合法入口 |

### 3.2 cordis.patch.yml

```yaml
# 单行 bundle patch：把本插件作为 profile 层激活。
# 一行同时覆盖本包的两个半部分（node 半部分 + 浏览器 bundle 同一 id 加载）。
- insert:
    - id: gomoku-local          # 自己起一个唯一 id
      name: 'dsh-gomoku-local'  # 必须与 package.json 的 name 一致
```

### 3.3 lib/index.js（node 半部分）

最小合法实现（空 host）：

```js
/** Node 半部分：游戏完全在浏览器中运行，这里故意为空。 */
const plugin = { name: 'dsh-gomoku-local', apply() {} }
export default plugin
```

Cordis 插件对象的合法形态（三选一）：
- 对象 `{ apply(ctx) {...}, inject?: [...] }`；
- 函数 `function (ctx) {...}`；
- 继承 `Service` 的类（发布服务时用）。

### 3.4 lib/client.js（浏览器 bundle，核心契约）

**手写即可，无需构建工具。** 必须严格遵守下面的外壳格式：

```js
window.__ModuleLoader__.load({
	id: "dsh-gomoku-local",          // 必须与 package.json 的 name 一致
	factory: function (require) {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react"); // react、react/jsx-runtime 是基座外部依赖，可直接 require

		// ── 你的代码 ──

		function apply(ctx) {
			// ctx 是浏览器端根 context；通过 exports.inject 声明的服务可直接 ctx.xxx 访问
			ctx.slots.inject("conversation.session.header.actions", function () {
				return ctx.slots.register(
					{ name: "conversation.session.header.actions", id: "gomoku-local", order: 30 },
					MyComponent
				);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots"];   // 依赖的【客户端服务名】列表（见 4.3）
		return module.exports;
	}
});
```

**注意两种 inject 的区别（高频错误）：**

| 位置 | 内容 | 作用 |
|---|---|---|
| `package.json` 的 `dsh.client.inject` | **包名**（如 `@deepseek-ai/dsh-client-ui-conversation`） | 控制 web 插件图谱中 bundle 的加载顺序 |
| bundle 的 `exports.inject` | **客户端服务名**（如 `"slots"`、`"locale"`、`"sessions"`） | Cordis 注入：声明后才能用 `ctx.slots` 访问 |

---

## 4. 浏览器端开发

### 4.1 UI 注册：Slot 机制

DSH 页面不是一个自由 DOM，UI 必须注册进具名 Slot。注册协议有三种：

| kind | 语义 | 注册参数 |
|---|---|---|
| `list` | 多个共存，各有一个条目 | `{ name, id, order?, label? }` |
| `keyed` | 按键分发，同 key 替换 | `{ name, key }` |
| `single` | 独占坑位，注册即替换整棵树 | 风险高，基本不要用 |

**常用 Slot 速查**（按用途选最窄的入口）：

| Slot | kind | 用途 |
|---|---|---|
| `conversation.session.header.actions` | list | **会话 header 动作按钮**（最常用入口，五子棋用的就是它） |
| `conversation.session.header.utilities` | list | header 右侧工具区 |
| `conversation.view` | list | 会话体视图 tab（如 chat / trajectory 那种整页切换） |
| `sidebar.footer.action` | list | 侧边栏底部小动作 |
| `settings.section` | list | 注册一整页设置页 |
| `settings.general.item` | list | 设置页里的一行偏好 |
| `shell.overlay` | list | 全局浮层（toast、弹窗） |
| `conversation.chat.turnTail` | chain | 一轮对话尾部追加内容 |
| `conversation.input.dock` | list | 输入框上方整行区域 |
| `tool.call.toolview` | keyed | 自定义某个工具调用的卡片 |

> 在 cordis preset 会话中，可以用 `cordis_inspect_query`（provider `Slots`，方法 `listSubTree`）查询当前页面的实时 Slot 树和每个 Slot 的完整契约。

### 4.2 React 与样式

- bundle 是 CJS factory 格式，**不是 ESM、没有 JSX 转换**。手写时用 `React.createElement`（建议起别名 `var h = React.createElement`）；要写得舒服可以自己接 tsdown/rollup 构建，产物格式参照本文 3.4 的外壳。
- 样式：bundle 运行在真实浏览器环境，`document` 可用。用 `ctx.effect` 注入 `<style>` 并返回清理函数：

```js
function apply(ctx) {
	ctx.effect(function () {
		var style = document.createElement("style");
		style.textContent = CSS_STRING;
		document.head.appendChild(style);
		return function () { style.remove(); };   // 插件卸载时自动清理
	}, "my-plugin: styles");
	// ...
}
```

- 颜色优先用主题变量，自动适配亮/暗主题：

| 变量 | 用途 |
|---|---|
| `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-1` / `--dsw-alias-bg-layer-2` / `--dsw-alias-bg-overlay` | 背景层级 |
| `--dsw-alias-border-l1` / `--dsw-alias-border-l2` | 边框 |
| `--dsw-alias-label-primary` / `--dsw-alias-label-secondary` | 文字 |
| `--dsw-alias-brand-primary` | 品牌强调色 |
| `--dsw-alias-state-success-primary` / `--dsw-alias-state-error-primary` / `--dsw-alias-state-warn-primary` | 状态色 |

### 4.3 客户端服务

通过 `exports.inject` 声明后在 `ctx` 上访问。已验证可用的：

| 服务 | 用途 |
|---|---|
| `slots` | Slot 注册（UI 必备） |
| `locale` | 多语言词典注册（`ctx.locale.register(ns, { zh, en })`） |
| `sessions` | 会话列表/快照访问 |

### 4.4 面板式 UI 的实用模式

header 按钮 + 固定定位浮层面板是最常用的形态（不占布局、随时开关）：

```js
function MyAction() {
	var openState = React.useState(false);
	var open = openState[0], setOpen = openState[1];
	return h(React.Fragment, null,
		h("button", { className: "my-trigger", onClick: function () { setOpen(!open); } }, "我的插件"),
		open ? h("div", { className: "my-panel" }, h(MyPanelContent)) : null
	);
}
// CSS: .my-panel { position: fixed; top: 64px; right: 16px; z-index: 220; ... }
```

### 4.5 浏览器端调试

- bundle 语法自检（不执行浏览器全局）：`node -e "new Function('window', require('fs').readFileSync('lib/client.js','utf8'))"`
- 加载后图谱里应出现你的包：浏览器控制台执行 `window.__DSH_BOOT__.entries.map(e => e.id)`
- bundle 是否可访问：访问 `http://<host>/plugins/<包名>/client.js`
- 渲染报错看浏览器控制台，错误带包名标签。

---

## 5. Node 端（host）开发

需要文件、网络、命令、模型工具等能力时才写 host 半部分。

```js
const plugin = {
	name: 'my-plugin',
	inject: ['someService'],        // 硬依赖：服务未出现则插件等待
	apply(ctx) {
		const optional = ctx.get('otherService');   // 软依赖：可能 undefined
		ctx.on('some/event', (payload) => { ... }); // 事件监听，卸载自动清理
		ctx.effect(() => subscribeSomething(), 'label');  // 外部订阅，返回清理函数
	},
}
export default plugin
```

Host ↔ Client 通信（package 私有 JSON RPC）：host 侧 `harness.handle(method, handler)`，client 侧 `host.call(method, args)`（动态插件内建；静态包通过 `@deepseek-ai/dsh-client-runtime` 的等价机制）。

**红线**：在 preset/组合里发布服务的行必须包在 `isolate` realm 里，否则第二个会话挂载时冲突。纯消费服务的行保持松散（不要包 realm）。

---

## 6. 安装、验证与卸载

```sh
# 安装（本地路径 / npm 包名 / github:user/repo 均可；相对路径会按调用目录锚定）
dsh plugin --profile web add /absolute/path/to/dsh-gomoku-local
dsh plugin --profile web add @scope/some-dsh-plugin

# 验证组合结果（应能看到你的行）
dsh --profile web --dump-config | grep -A2 "你的包名"

# 卸载
dsh plugin --profile web remove dsh-gomoku-local
```

`dsh plugin` 是 pnpm 的薄封装：在 profile 目录执行 `pnpm <args>`，然后自动 reconcile `dsh.profile.bundles`（装了带 `dsh.bundle` 的包就加入，卸了就移出）。本地路径会以 `link:` 形式装入，**改包代码后无需重装**（但 bundle 内容变化要重启+刷新才生效）。

**生效条件（重要）：**
1. 重启 dsh 进程（插件集合变化有永久缓存，不重启不扫描）；
2. 刷新浏览器页面（`__DSH_BOOT__` 在页面加载时注入）。

**临时禁用/启用某行**（不卸载）：编辑 `~/.dsh/profiles/<name>/cordis.patch.yml`：

```yaml
- id: gomoku-local
  disabled: true    # 删掉这两行即恢复启用
```

---

## 7. 常见坑（ checklist ）

1. **行 id 冲突**：一个包一行，id 全局唯一；不要给 client 半部分单独起第二行。
2. **两种 inject 写反**：`dsh.client.inject` 写包名；`exports.inject` 写客户端服务名。
3. **用了 `ctx.slots` 却没在 `exports.inject` 声明 `"slots"`** → 报 Guard 错误。
4. **写了 JSX / import / TS 语法** → bundle 不被转换，直接语法错误。手写就写纯 JS + `React.createElement`。
5. **改完代码不重启不刷新** → 看不到任何变化。
6. **`exports["./client"]` 缺失或路径错** → 组合期报 `client bundle not found`。
7. **`cordis.patch.yml` 没在 `exports` 里暴露** → `dsh plugin add` 的 reconcile 读不到 `dsh.bundle.patch`，包被当作普通依赖（会有 `declares no dsh.bundle` 警告）。
8. **在 patch 里直接编辑 profile 根 `cordis.yml`** → 应该编辑 `cordis.patch.yml`。
9. **动态插件当永久方案用** → 动态插件进程重启即消失，正式功能必须走 profile 静态包。

---

## 8. 完整示例索引

本仓库/本机已验证的实例：

- **dsh-gomoku-local**（本文范本，纯浏览器插件）：`~/.dsh/plugins/dsh-gomoku-local/`
  - 功能：会话 header 注册"五子棋"按钮，点击弹出 15×15 棋盘浮层；双人/人机（本地启发式 AI，零 LLM 调用）；悔棋、重开、胜负判定高亮。
  - 安装：`dsh plugin --profile web add /Users/king/.dsh/plugins/dsh-gomoku-local`
- **@yejiming/dsh-gomoku**（npm 上的三方插件，host+client 双半部分、带 host RPC 的参考）：其 LLM 对弈走 host 路由，适合作为"需要 host 能力"的进阶参考。

## 9. 动态插件（快速试验）速查

在 cordis preset 会话中，让 agent 用这组工具即时定义临时插件：

1. `cordis_inspect_list` → 查 Host/Client 能力目录；
2. `cordis_inspect_query` → 查具体 Service/Slot/Theme 契约；
3. `cordis_define`（plain JS，禁 JSX/import/TS；Client 用 `React.createElement`，内建 `React`/`styles`/`host`/`console`）；
4. `cordis_run` 激活（可能要用户在 UI 上授权）；
5. 出错用 `cordis_inspect_self` 看诊断，改代码追加新 Package 再 run。

动态插件的 UI 常挂 `tool.view.cordis`（key 固定 `self`），渲染在最新 `cordis_run` 卡片里。验证满意后，再按本文 3-6 节固化成静态插件。
