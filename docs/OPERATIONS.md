# 发布与运营手册

站点：<https://aigames.de5.net/>（Cloudflare Pages，推送 `main` 自动构建上线）。**域名不要更改**——canonical、sitemap、Open Graph 都来自 `scripts/site.ts` 的 `SITE_URL`。

## 1. 发布流程

```bash
npm test                      # 102 项测试
npm run build                 # 生成页面 → tsc（应用与脚本两套配置）→ vite build
node scripts/e2e.mjs smoke    # 无头浏览器冒烟（含音频电平断言）
node scripts/e2e.mjs mobile   # 改动了界面/触屏时再跑
node scripts/e2e.mjs pwa      # 改动了 SW / 缓存策略时再跑
node scripts/e2e.mjs flows    # 改动了菜单/机库/结算/输入流程时再跑（含英文界面与手柄）
node scripts/e2e.mjs fx       # 改动了伤害数字 / 命中特效 / 进化演出时再跑（截图在 .e2e/fx*.png，需要人看一眼）
node scripts/e2e.mjs layout   # 改动了 HUD / 样式 / 提示文案 / 新增屏幕元素时再跑（7 种屏幕 × 满配与开局两种状态，0 重叠 0 出屏）
node scripts/e2e.mjs art      # 改动了精灵 / Boss 绘制 / 着色工具包时再跑（图鉴截图在 .e2e/art-*.png，需要人看一眼；`--scale 8 --only pickups,weapons --items blade --sheeth 1100` 只放大指定条目）
git push origin main          # 触发 Cloudflare Pages 构建
```

上线核对：

```bash
curl -s https://aigames.de5.net/version.json      # id 应等于刚推送提交 SHA 的前 8 位
node scripts/e2e.mjs live                           # 线上冒烟 + 关键 URL 全部 200
node scripts/e2e.mjs flows --url https://aigames.de5.net   # 线上跑完整流程；除 pwa 外所有模式都支持 --url（此时不需要 dist/）
```

线上 e2e 偶发 `page.goto: Timeout 30000ms`？先别怀疑站点——本机 IPv6 到 Cloudflare 的 TLS 握手会随机挂起（`curl -w '%{remote_ip} %{time_appconnect}\n'` 能看到走 IPv6 的请求握手要好几秒甚至超时，IPv4 始终 0.2 秒）。把域名钉到 IPv4 再跑即可：

```bash
E2E_CHROME_ARGS="--host-resolver-rules=MAP aigames.de5.net $(dig +short A aigames.de5.net | head -1)" \
  node scripts/e2e.mjs mobile --url https://aigames.de5.net
```

推送后 `version.json` 迟迟不变？从 GitHub 一侧能看到 Cloudflare 的构建状态（不需要 Cloudflare 凭据）：

```bash
gh api repos/littlebugged/aigames/commits/<sha>/check-suites \
  --jq '.check_suites[] | select(.app.name=="Cloudflare Workers and Pages") | "\(.status)/\(.conclusion) runs=\(.latest_check_runs_count)"'
```

- `completed/success runs=1`：已部署（正常约 30 秒）。
- `queued/null runs=0` 停留超过几分钟：构建在 Cloudflare 一侧排队或被卡住，代码本身没问题。先看 <https://www.cloudflarestatus.com/> 有没有 Workers / Pages 相关故障，再到 Pages → Deployments 点 *Retry deployment*；没有 Cloudflare 凭据时，再推一个提交也能重新触发构建。
- 开发机上先用干净克隆验证提交本身可构建：`git clone . /tmp/x && cd /tmp/x && npm ci && npm run build`。

调试时一律用无头浏览器（`scripts/lib/headless.mjs` 里 `headless: true`），不会弹出窗口。

## 2. 回滚

- **最快**：Cloudflare Pages → 项目 → Deployments → 选择上一个成功部署 → *Rollback*。
- **留痕**：`git revert <sha>` 后推送 `main`，Pages 会重新构建。
- 玩家端会在回到菜单时看到"游戏已更新，刷新即可体验新版本"。回滚也走同样的路径（SW 文件字节变化 → 新 SW 接管）。

## 3. 缓存模型（排查"我这里还是旧版本"）

| 资源 | 策略 | 说明 |
| --- | --- | --- |
| HTML | 网络优先，离线回退缓存；`max-age=0, must-revalidate` | 推送后下一次打开就是新版 |
| `/assets/*` | 内容哈希 + `immutable` 一年；SW 缓存优先 | 文件名变了就是新资源 |
| `/sw.js`、`/version.json` | `no-cache` / `no-store` | 更新探测依赖它们，不能被缓存 |
| 图标、分享图 | 1 天 | 换图后最长一天生效 |

玩家的长时间标签页：回到标签页时、以及每 30 分钟，会主动探测新版本。出现异常时，让玩家硬刷新一次即可；仍然不行就在浏览器的"应用 → Service Workers"里 Unregister。

## 4. 内容与平衡的工作流

内容全部是数据驱动，改动顺序：

1. 在 `src/data/ids.ts` 登记新 id → TypeScript 会提示所有需要补齐的地方（数据、图标、词典…）。
2. 补齐 `src/data/*`、`src/i18n/zh.ts` 与 `en.ts`（`tests/i18n.test.ts` 会拦住漏翻或占位符不一致）。
3. 需要新行为时改 `src/game/*`（武器/敌人/Boss/升级逻辑），需要新画面时改 `src/render/*`。
4. `npm test`（数据约束 + 确定性 + 稳定性）→ `npm run sim -- --all`（看机器人存活、击杀、进化、Boss 耗时有没有失衡）；新武器 / 改武器数值表时再跑 `npm run bench`，与同档位的老武器对照强度。
5. `npm run build`：游戏指南页会自动带上新内容，无需手改文档。
6. 无头截图确认：`node scripts/e2e.mjs play --sector void --ff 400 --wait 4 --name check`，看 `.e2e/check.png`。

平衡参数集中在 `src/data/tuning.ts`；机器人只是粗略的参照，**真实难度以人工试玩为准**。

## 5. SEO 与可发现性

已经就绪：中英双语静态首页（可抓取的玩法说明与 FAQ）、游戏指南（数据表）、sitemap（含 hreflang）、canonical、Open Graph / Twitter Card、JSON-LD、站点图标与分享图。

需要站长在外部完成（无法由代码代劳）：

- 在 Google Search Console、Bing Webmaster Tools 验证站点并提交 `https://aigames.de5.net/sitemap.xml`。
- **Cloudflare 的"托管 robots.txt"会在边缘叠加规则**（拦截 AI 爬虫，有的账号还会拦截百度爬虫），这是 Cloudflare 控制台里的开关（AI Crawl Control / 机器人相关设置），不是仓库里的 `robots.txt`。如果希望百度等搜索引擎收录，请在控制台里关闭对应规则，然后用 `curl -s https://aigames.de5.net/robots.txt` 核对。
- 更换图标 / 分享图：都在 `scripts/gen-assets.mjs` 里生成——图标是用游戏里的**真实精灵**（先锋号 / 无人机 / 晶簇宝石，8 倍超采样重画一份）在无头浏览器里合成的，`favicon.svg` 内嵌一张 48px 位图；分享图用的是真实游戏画面。改后 `npm run build && node scripts/gen-assets.mjs`，提交 `public/` 下的新素材（美术大改后都要重新生成）。社交平台缓存分享图较久，需要在各平台的调试工具里刷新。
- 玩法指南里的敌人 / 飞船 / Boss 图：`npm run build && node scripts/gen-sprites.mjs`，输出 `public/img/sprites/*.webp`（已提交）；新增条目或改了美术后必须重跑，`npm test` 会检查文件齐全。

## 6. 统计与隐私

游戏本身不使用 Cookie、不接入统计、不上传数据，`/privacy/` 页面也是这样声明的。如果将来开启 Cloudflare Web Analytics（无 Cookie，控制台一个开关）或其它统计，请同步修改 `scripts/gen-pages.ts` 里的隐私页文案。

## 7. 常见问题

| 现象 | 处理 |
| --- | --- |
| 玩家反馈卡顿 | 设置里把画质改为"中/低"，关闭屏幕震动与伤害数字；自动画质会在帧率持续偏低时自动降档 |
| 存档丢失 | 存档只在玩家浏览器里（清除站点数据会丢失）；设置 → 导出存档可以备份，导入存档可以迁移 |
| 构建失败 | 先本地 `npm run build` 复现；常见原因是新增 id 后某个词典/数据表没补齐（类型检查会报错） |
| 想看某个时间点的画面 | `node scripts/e2e.mjs play --sector <fields\|wasteland\|void> --ff <秒> --wait <秒> --name <文件名>` |
| 想测性能 | `node scripts/e2e.mjs perf --q high --dpr 2 --gpu 1`（`--gpu 1` 使用 Metal，`0` 为纯软件光栅化的最坏情况）。做 A/B：`--eval "__neon.renderer.bloomPass=()=>{}"` 在采样前往页面里注入一段脚本，软件光栅化下噪声较大，建议新旧版本交替各跑 4 次取平均 |
| 想看 Boss 预警 / 手机竖屏 / 干净的截图 | `play ... --tele 1`（在玩家周围摆几条不同进度的预警）、`play ... --touch 1 --w 390 --h 844 --dpr 2`（按手机方式开）、`play ... --clean 1`（隐藏教学提示 / Toast / 横幅），`--clip x,y,w,h` 再截一张局部放大图 |
| 想看光束 / 电弧 / 冲击波 / 敌方子弹 / 爆炸 | `play --lab fx --w 1280 --h 720 --clean 1`（清场后摆一张定格样张；`--dpr 3 --clip x,y,w,h` 放大看细节）；真实对局里等某个效果出现再定格：`play --ff 25 --gear laser,rail,arc,nova --glv 8 --evo 1 --catch beams --clean 1`（`--catch` 可取 `beams / bolts / rings / ebullets / hbeams / hrings`，`--skip N` 跳过前 N 次命中）；子弹图鉴：`art --scale 5 --only bullets --sheeth 700` |
| 想看武器 / 拾取物的实物 | `play --gear orbit,chakram,drone,mine,missile --glv 6 [--evo 1] --ff 60 --dpr 3 --w 720 --h 440 --clean 1 --clip 215,95,290,250`（开局直接发武器、可指定等级 / 进化）；`play --pickups 1 --ff 30 --dpr 3 --clean 1`（清场后把五种拾取物摆成一排并暂停） |

## 8. 历史

重构前仓库里的旧小游戏（贪吃蛇、Star Vanguard 等）仍保存在 git 历史里，最后一个包含它们的提交是 `f628944`，需要时可 `git show f628944:<路径>` 取回。
