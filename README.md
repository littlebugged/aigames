# Neon Arcade

纯前端的浏览器小游戏站。技术栈是 **Vite + TypeScript + Phaser 4**，构建产物是纯静态文件，直接丢到 Cloudflare Pages 就能跑。

## 为什么是这套

- **零后端**：没有服务器就是没有服务器。存档走 `localStorage`，将来要排行榜再加 Cloudflare 的 KV / D1。
- **无限带宽**：Cloudflare Pages 免费版对静态资源不限流量、不限请求数，这对游戏站（资源大、流量便宜不了）是最关键的一条。
- **多页架构**：每款游戏是一个独立页面，而不是单页应用里的一个路由。好处是每款游戏能有自己的标题、描述和 URL，搜索引擎能单独收录；同时 Phaser 这个大包只在该游戏页面加载，首页保持轻量。

## 目录结构

```
aigames/
├── index.html                 # 首页（游戏卡片墙）
├── src/
│   ├── style.css              # 首页样式
│   └── home.ts                # 首页脚本（读本地最高分）
├── games/
│   └── neon-dash/             # 一款游戏 = 一个目录
│       ├── index.html         # 游戏页（独立 SEO 元信息）
│       └── main.ts            # 游戏逻辑
├── public/                    # 原样复制到 dist 的静态文件
│   ├── _headers               # Cloudflare 缓存与安全响应头
│   ├── 404.html
│   └── favicon.svg
├── vite.config.ts             # 多页构建入口（加游戏要改这里）
└── tsconfig.json
```

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173
```

构建与本地预览：

```bash
npm run build    # 先做类型检查，再产出 dist/
npm run preview
```

## 部署到 Cloudflare Pages

### 方式一：连接 Git（推荐）

把仓库推到 GitHub / GitLab，然后在 Cloudflare Dashboard 里：

1. Workers & Pages → Create → Pages → Connect to Git，选仓库
2. 构建设置：

   | 项 | 值 |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

3. 保存并部署。之后每次 `git push` 自动重新构建。

免费版额度：500 次构建/月、单次构建 20 分钟超时、每个项目 100 个自定义域名。构建并发是 1。

### 方式二：本地命令行手动部署

```bash
npm run deploy   # 等价于 npm run build && npx wrangler pages deploy dist
```

首次会要求登录 Cloudflare 账号。

### 关于 Pages 和 Workers 的取舍

Cloudflare 现在的主力是 **Workers Static Assets**，Pages 的经营重心在往那边挪。两者的静态资源限制是一样的，但 Workers 多了 Durable Objects、Cron Triggers、更完整的可观测性，而且未来做实时对战（Durable Objects）会方便很多。

如果这是全新项目，可以直接上 Workers Static Assets：

```jsonc
// wrangler.jsonc
{
  "name": "aigames",
  "compatibility_date": "2026-09-10",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page"
  }
}
```

然后用 `npx wrangler deploy`。注意：这个文件和 Cloudflare Pages 的 Git 构建不要同时用，Pages 会尝试把它当自己的配置解析。

## 必须知道的限制

| 项 | 免费额度 | 说明 |
|---|---|---|
| 静态请求 / 带宽 | 无限 | 这是选它的最大理由 |
| 构建次数 | 500 / 月 | 够用 |
| 单个部署文件数 | 20,000 | 硬上限。每款游戏几十个文件的话，能放几百款；但如果每款游戏都塞大量图片音频，要盯着这个数 |
| 单文件大小 | 25 MiB | 单个资源超过就放 R2 |
| Pages Functions | 计入 Workers 免费额度：10 万请求/天，CPU 10ms/请求 | 将来做排行榜/云存档会撞到这条，尤其是 10ms 的 CPU 上限 |

## 中国大陆访问（重要）

Cloudflare 没有中国大陆节点。`*.pages.dev` 这个二级域名从 2022 年起在国内就不稳定，会间歇性解析失败或超时，移动宽带最明显。绑自定义域名能绕开域名层的污染，改善明显但不彻底，而且 **Cloudflare 无法做 ICP 备案**。

结论：**如果主要用户在国内，Cloudflare Pages 不是合适的托管。** 那种情况该用国内方案（腾讯云 EdgeOne Pages、阿里云 ESA、或者 COS/OSS + CDN + 备案域名）。

如果定位是海外用户、或者只是自己练手和作品展示，Cloudflare 完全够用，而且无限带宽这一点非常香。

折中方案也有：自定义域名 + DNS 分区解析（国内线路指向 Cloudflare 优选 IP，海外走官方线路），项目本身不用改。

## 加一款新游戏

假设新游戏叫 `my-game`：

1. 复制 `games/neon-dash/` 整个目录为 `games/my-game/`
2. 改 `games/my-game/index.html` 里的 `<title>`、`<meta name="description">`、`<link rel="canonical">`，以及末尾的 `<script src>` 路径
3. 改 `games/my-game/main.ts` 里的游戏逻辑，顺便改 `BEST_KEY` 常量（否则会和别的游戏共用存档）
4. 在 `vite.config.ts` 的 `rollupOptions.input` 里加一行：

   ```ts
   'my-game': 'games/my-game/index.html',
   ```

5. 在 `index.html` 里复制一份 `.game-card` 改成新游戏的介绍

## 下一步可以做的事

- 接广告：Google 的 **H5 Games Ads**（要申请，走 Ad Placement API）、CrazyGames SDK、Playgama Ad。优先上插屏和激励视频，banner 单价极低。
- 上架门户拿流量：CrazyGames、Poki、GameDistribution 都接受独立开发者提交，它们负责分发，你拿分成。这比自己从零做 SEO 快得多。
- 排行榜 / 云存档：Cloudflare KV 或 D1 + Pages Functions。
