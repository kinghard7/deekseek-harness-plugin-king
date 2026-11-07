# deekseek-harness-plugin-king

面向 DSH（deepseek harness）Web GUI 的插件仓库。两个插件都注册在会话头部操作区（`conversation.session.header.actions`），随点随用，全程不消耗 LLM token。

## 插件一览

### 1. dsh-gomoku-local —— 五子棋 · 本地对弈

在会话头部放一个「五子棋」按钮，点开即玩，**纯浏览器本地运行**：不调用模型、不联网、零 token 消耗。

- **双人对弈**：同屏轮流落子，黑白交替
- **人机对战**：内置启发式 AI（按连子形态打分，攻守兼顾），你执黑先行
- **悔棋 / 重新开始**：人机模式下一步悔棋自动回退双方各一手
- **对局反馈**：最后一手高亮、五连获胜棋子描边、状态栏实时提示轮到谁

![五子棋](screenshots/gomoku.png)

代码：[`dsh-gomoku-local/`](dsh-gomoku-local/)（host 侧为空插件，游戏逻辑全部在 `lib/client.js`）。

### 2. dsh-novel-reader —— 小说阅读器

会话头部的「阅读」按钮，弹出一个完整的分页阅读面板：搜索、下载、书库、阅读、设置五个视图，**不涉及任何 LLM 调用**。

- **在线搜索**：双书源并发查询
  - 整本下载源（txt80）：搜索结果可直接**一键下载全文**入库（GBK 自动转 UTF-8）
  - 元信息源（云阅读 API）：书目更全，可「存为待读」占位
- **本地导入 / 导出**：支持导入 UTF-8 编码的 `.txt`；库中任意书籍可导出为 TXT
- **书库持久化**：书籍正文存于浏览器 IndexedDB，阅读进度与设置存于 localStorage，关掉页面也不丢
- **分页阅读**：按页翻阅，显示「当前页 / 总页数」，自动记忆每本书的阅读位置
- **全自定义快捷键**：收起/展开（默认 `Alt+X`，全局生效）、上一页 / 下一页（默认 `←` / `→`），点击按键框按下新组合即可改绑
- **排版可调**：每页字数（300–3000）、字号（12–28px）、行高（1.2–2.6）滑杆实时生效

| 书库 | 阅读 |
| --- | --- |
| ![书库](screenshots/reader-library.png) | ![阅读](screenshots/reader-reading.png) |

| 搜索 | 设置 |
| --- | --- |
| ![搜索](screenshots/reader-search.png) | ![设置](screenshots/reader-settings.png) |

代码：[`dsh-novel-reader/`](dsh-novel-reader/)。host 侧（`lib/index.js`）在同源 HTTP 路由上代理搜索与抓取（浏览器无 CORS 困扰，且校验 `Origin` 仅允许同源调用）；浏览器侧（`lib/client.js`）渲染全部阅读 UI。

## 安装

### 方式一：本地 link（当前可用，开发调试）

> 目前两个包**尚未发布到 npm**（`npm view dsh-gomoku-local` / `@kingkk/dsh-novel-reader` 均 404），所以现在只能用本地 link 安装。
> `dsh-novel-reader` 这个裸包名在 npm 上已被他人占用，发布时阅读器会使用 scope 包名 `@kingkk/dsh-novel-reader`，与本地目录对应。

一条命令装进 web profile（`dsh plugin add` 会自动把声明了 `dsh.bundle` 的包写进 `dsh.profile.bundles`）：

```bash
dsh plugin --profile web add link:/path/to/deekseek-harness-plugin-king/dsh-gomoku-local
dsh plugin --profile web add link:/path/to/deekseek-harness-plugin-king/dsh-novel-reader
```

也可以直接编辑 `~/.dsh/profiles/web/package.json`：

```json
{
  "dependencies": {
    "dsh-gomoku-local": "link:/path/to/deekseek-harness-plugin-king/dsh-gomoku-local",
    "@kingkk/dsh-novel-reader": "link:/path/to/deekseek-harness-plugin-king/dsh-novel-reader"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-gomoku-local", "@kingkk/dsh-novel-reader"]
    }
  }
}
```

`bundles` 里写的名字必须与各包 `package.json` 的 `name` **完全一致**（阅读器是 `@kingkk/dsh-novel-reader`），否则组合行会指向一个不存在的包。改完后 `pnpm install`，刷新浏览器；`patchReload: live` 的 profile 由插件管理安装时会直接热应用，手工改文件则需要重启 `dsh web`。

## 加载排查

"装了插件但界面没出现按钮"时，按这个顺序查：

1. **先确认行已激活**：`~/.dsh/profiles/web/package.json` 的 `dependencies` 和 `dsh.profile.bundles` 里都有插件名；`dsh --profile web --dump-config` 的输出里能找到对应的 `name`。
2. **再确认浏览器 bundle 进了启动图谱**：刷新页面，在页面源码里搜 `__DSH_BOOT__`，`entries` 里应有 `dsh-gomoku-local` 和 `@kingkk/dsh-novel-reader`。
3. **包名三处必须一致**：`package.json` 的 `name`、`cordis.patch.yml` 里 `insert` 行的 `name`、`lib/client.js` 里 `window.__ModuleLoader__.load({ id })` 的 `id`。scoped 包（如 `@kingkk/dsh-novel-reader`）三处都要带 scope——只改 package.json 不改另外两处时，行会解析不到包，或 bundle 注册的 id 与图谱行 id 不匹配，浏览器端会报 `bundle ... loaded without registering ...`。
4. **位置**：按钮注册在 `conversation.session.header.actions`，只有会话头部会渲染；工作区落地页（"探索未至之境"）没有这个 slot。
5. **改完 `lib/client.js` 后**：client-modules/HMR 会按文件 mtime 重新打包并推送，通常刷新即可；改 `package.json` / `cordis.patch.yml`（行结构变化）需要重启 `dsh web`。

## 截图说明

`screenshots/` 下的图片为实际运行截图（headless Chrome 驱动本机 dsh web GUI 拍摄，2x 缩放）。

## 发布（维护者）

```bash
npm login --registry=https://registry.npmjs.org   # 首次：登录 npm 官方源（镜像源不能发布）
./scripts/publish.sh --dry-run                    # 验证打包内容，不发布
./scripts/publish.sh                              # 交互式逐个发布
./scripts/publish.sh dsh-gomoku-local             # 只发某一个
```

脚本会检查登录态、`private` 标记、npm 上是否已存在该版本，并展示每个包的实际文件清单后才请求确认。发新版前记得在对应插件目录执行 `npm version patch`  bump 版本号。
