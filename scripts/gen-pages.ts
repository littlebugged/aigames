/**
 * 站点页面生成器（构建前运行）。
 *
 * 为什么要生成而不是手写：指南页里的武器 / 敌人 / Boss / 飞船 / 成就数据全部来自 src/data，
 * 改了数值或文案，页面自动跟着变，不会出现"指南和游戏对不上"的情况。
 *
 * 产物（均已 .gitignore）：
 *   /index.html  /en/index.html            游戏首页（画布 + 下方的可抓取文本内容）
 *   /guide/ /about/ /privacy/ (+ /en/…)    内容页
 *   /404.html  /public/sitemap.xml  /public/robots.txt
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACHIEVEMENTS } from '../src/data/achievements'
import { ENEMIES } from '../src/data/enemies'
import { BOSS_IDS, ENEMY_IDS, MAX_PASSIVES, MAX_WEAPONS, META_IDS, PASSIVE_IDS, SECTOR_IDS, SHIP_IDS, WEAPON_IDS, WEAPON_MAX_LEVEL } from '../src/data/ids'
import { METAS, formatMetaValue, metaCost } from '../src/data/meta'
import { PASSIVES, formatPassiveValue } from '../src/data/passives'
import { SECTORS, THREAT_LEVELS } from '../src/data/sectors'
import { SHIPS } from '../src/data/ships'
import { WEAPONS } from '../src/data/weapons'
import { dyn, tIn } from '../src/i18n'
import { enemyIcon, passiveIcon, shipIcon, uiIcon, weaponIcon } from '../src/ui/icons'
import { PAGE_KEYS, SITE_URL, pageFile, pagePath, type PageKey, type SiteLang } from './site'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** 被动道具的最高等级（个别道具更低，以表格里的“最高等级”为准） */
const PASSIVE_TOP_LEVEL = Math.max(...PASSIVE_IDS.map((id) => PASSIVES[id].maxLevel))
const YEAR = new Date().getFullYear()
const TODAY = new Date().toISOString().slice(0, 10)

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n0 = (n: number): string => n.toLocaleString('en-US')
const num = (v: number): string => (v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ''))
const T = (l: SiteLang, key: string, params?: Record<string, string | number>): string => tIn(l, dyn(key), params)

/** 页面语言间的文案。只放"页面结构"文案，游戏内容文案一律走 i18n 字典。 */
interface Copy {
  htmlLang: string
  locale: string
  ogLocaleAlt: string
  nav: Record<PageKey, string>
  switchLabel: string
  siteName: string
  home: {
    title: string
    desc: string
    h1: string
    lead: string
    ctaPlay: string
    ctaGuide: string
    featuresH: string
    features: { icon: string; color: string; title: string; text: string }[]
    controlsH: string
    controls: { who: string; keys: string }[]
    tipsH: string
    tips: string[]
    faqH: string
    faq: { q: string; a: string }[]
    moreH: string
    moreText: string
  }
  guide: {
    title: string
    desc: string
    h1: string
    lead: string
    toc: string
    sections: Record<'weapons' | 'passives' | 'enemies' | 'bosses' | 'ships' | 'sectors' | 'meta' | 'threat' | 'ach' | 'evo', string>
    evoText: string
    capsText: string
    col: Record<string, string>
    bossTips: Record<string, string>
    threatText: string
    metaText: string
    sectorText: string
    unitMin: string
    enemyHint: string
  }
  about: { title: string; desc: string; h1: string; paras: string[]; techH: string; tech: string[]; logH: string; log: string[]; creditsH: string; credits: string[] }
  privacy: { title: string; desc: string; h1: string; updated: string; blocks: { h: string; p: string }[] }
  notFound: { title: string; text: string; back: string }
  footer: string
}

const ZH: Copy = {
  htmlLang: 'zh-CN',
  locale: 'zh_CN',
  ogLocaleAlt: 'en_US',
  nav: { home: '开始游戏', guide: '游戏指南', about: '关于', privacy: '隐私政策' },
  switchLabel: 'English',
  siteName: '霓虹浪涌 NEON SURGE',
  home: {
    title: '霓虹浪涌 NEON SURGE — 免费在线霓虹肉鸽生存游戏，网页即点即玩',
    desc: '《霓虹浪涌》是一款免费的网页霓虹风割草肉鸽（Roguelite）生存游戏：自动开火、收集晶体、升级并进化武器，击败三大星区 Boss。无需下载注册，支持电脑、手机触屏与手柄。',
    h1: '霓虹浪涌 NEON SURGE：免费在线霓虹肉鸽生存游戏',
    lead: '《霓虹浪涌》是一款直接在浏览器里就能玩的俯视角「割草」肉鸽（Roguelite）生存游戏。驾驶战机深入霓虹星区，武器会自动开火，你只需要专注走位——收集晶体、升级、进化武器，在 10 分钟内击败星区 Boss。无需下载，无需注册，电脑、手机、手柄都能玩。',
    ctaPlay: '立即开始游戏',
    ctaGuide: '查看游戏指南',
    featuresH: '游戏特色',
    features: [
      { icon: 'swords', color: '#3df2ff', title: '自动开火，专注走位', text: '没有复杂的瞄准，单手也能操作。真正的挑战是在怪潮与弹幕之间找到安全的路线，并利用冲刺的无敌时间反杀。' },
      { icon: 'dice', color: '#ffd84a', title: `${WEAPON_IDS.length} 种武器 × ${PASSIVE_IDS.length} 种被动`, text: '脉冲炮、环绕刃、电弧、追踪导弹、棱镜激光、地雷、新星、无人机、回旋飞轮、磁轨炮……每次升级随机给出三选一，组合出完全不同的流派。' },
      { icon: 'play', color: '#ff4fd8', title: '武器进化系统', text: '武器升到满级并携带对应的搭档装备，就能在升级或补给箱里进化成终极形态——特效和威力都会质变。' },
      { icon: 'skull', color: '#ff4a6a', title: '3 个星区，3 个 Boss', text: '霓虹原野的监察者、数据荒原的分形核心、虚空裂隙的虚空之喉。每个 Boss 都有多阶段弹幕和独特机制，打赢才有成就感。' },
      { icon: 'hangar', color: '#a58bff', title: '机库永久成长', text: '每局获得的晶核可在机库购买 13 项永久升级，另有 4 艘风格迥异的飞船、4 档威胁等级，通关后还能开启无尽模式。' },
      { icon: 'gear', color: '#6dff8a', title: '手机、键盘、手柄通吃', text: '触屏浮动摇杆、键盘 WASD / 方向键、手柄全部原生支持；画质自动调节让低端设备也流畅，存档保存在本地，可离线游玩。' },
      { icon: 'sound', color: '#3df2ff', title: '实时合成的音乐音效', text: '全部音乐与音效由 WebAudio 实时合成，不下载任何音频文件。每个星区有自己的音阶与节奏，Boss 战会自动变奏提速。' },
      { icon: 'trophy', color: '#ffd84a', title: `${ACHIEVEMENTS.length} 个成就`, text: '从「单局击败 100 个敌人」到「在灾厄难度通关」，成就会奖励晶核，其中一些还会解锁新的飞船。' },
    ],
    controlsH: '操作方式',
    controls: [
      { who: '键盘', keys: 'WASD / 方向键 移动；空格 / Shift 冲刺（冲刺期间无敌）；Esc / P 暂停；升级时按 1 2 3 选择，R 重抽，B 放逐' },
      { who: '手机 / 平板', keys: '在屏幕左半边按住并拖动即可移动（浮动摇杆，设置里可切换左手模式）；点右下角按钮冲刺；点右上角暂停。建议横屏游玩' },
      { who: '手柄', keys: '左摇杆或十字键移动；A / B / RB / RT 冲刺；Start 暂停；菜单中用摇杆选择、A 确认' },
    ],
    tipsH: '新手入门五步',
    tips: [
      '<strong>一直移动。</strong>站着不动最危险。沿着怪潮外圈绕圈，让武器自动清理追上来的敌人。',
      '<strong>优先吃青色晶体。</strong>经验是变强的唯一途径；冲向晶体之前先确认退路。',
      '<strong>专精一把主力武器。</strong>把同一把武器升到高等级，通常比每把都升一点强得多，再配一个它的搭档被动。',
      '<strong>留意进化提示。</strong>战斗界面左下角武器栏闪烁金边，说明满足进化条件，下一次升级或开补给箱就会出现进化选项。',
      '<strong>学会冲刺。</strong>冲刺期间无敌，用来穿过 Boss 的环形弹幕或从包围里突围，冷却好了就别省着。',
    ],
    faqH: '常见问题',
    faq: [
      { q: '这个游戏免费吗？需要下载或注册吗？', a: '完全免费。打开网页就能玩，不需要下载安装，也不需要注册或登录。' },
      { q: '手机上能玩吗？', a: '可以。游戏针对触屏做了浮动摇杆和冲刺按钮，建议横屏体验更好。iPhone 的 Safari 不支持网页全屏，可以把网页「添加到主屏幕」获得更接近全屏的体验。' },
      { q: '存档保存在哪里？换设备怎么办？', a: '存档保存在你浏览器的本地存储里，不会上传到任何服务器。清除浏览器数据会丢失存档。需要换设备时，在「设置 → 导出存档」复制存档文本，到另一台设备的「设置 → 导入存档」粘贴即可。' },
      { q: '武器怎么进化？', a: '把一把武器升到满级（8 级），同时持有它对应的搭档被动道具（任意等级即可），下一次升级或打开补给箱时就会出现进化选项。完整的搭档对照表见游戏指南。' },
      { q: '武器和被动道具有数量、等级上限吗？', a: `有。一局最多同时携带 ${MAX_WEAPONS} 把武器和 ${MAX_PASSIVES} 件被动道具；武器最高 ${WEAPON_MAX_LEVEL} 级，被动道具最高 ${PASSIVE_TOP_LEVEL} 级。已经满级的不会再出现在升级选项里，栏位占满后也不会再出现新的武器或道具。升级界面下方会显示当前栏位（如 6/6）和各自的等级，满级的标有 MAX。` },
      { q: '游戏有点卡怎么办？', a: '默认开启了自动画质：帧率持续偏低时会自动降低特效。你也可以在「设置 → 画质」里手动改成「中」或「低」，并关闭屏幕震动和伤害数字。' },
      { q: '为什么切到别的标签页游戏会暂停？', a: '为了不让你在看不见画面时被打败，战斗中切走标签页或窗口失去焦点时，游戏会自动暂停。回来后点「继续」即可。' },
      { q: '有没有无尽模式？', a: '有。在某个星区至少通关一次后，出击界面会解锁「无尽模式」开关：击败 Boss 后战斗不会结束，敌人会持续变强，看你能撑多久。' },
    ],
    moreH: '继续了解',
    moreText: '想查看每种武器的进化条件、敌人图鉴、Boss 打法和机库升级价格？阅读',
  },
  guide: {
    title: '游戏指南：武器进化、敌人图鉴、Boss 打法与机库升级 — 霓虹浪涌',
    desc: `《霓虹浪涌》完整游戏指南：${WEAPON_IDS.length} 种武器的进化条件与搭档、${PASSIVE_IDS.length} 种被动、敌人图鉴、3 个 Boss 打法、4 艘飞船、星区与威胁等级、机库升级价格和全部成就。`,
    h1: '霓虹浪涌 游戏指南',
    lead: '这份指南的所有数据都由游戏内的真实配置自动生成，数值与游戏保持一致。第一次玩可以先看「武器与进化」和「Boss 打法」两节。',
    toc: '目录',
    sections: {
      evo: '进化速查',
      weapons: '武器',
      passives: '被动道具',
      enemies: '敌人图鉴',
      bosses: 'Boss 打法',
      ships: '飞船',
      sectors: '星区',
      threat: '威胁等级与无尽模式',
      meta: '机库（永久升级）',
      ach: '成就',
    },
    evoText: `任意一把武器升到 ${WEAPON_MAX_LEVEL} 级，并持有表中对应的搭档被动道具（1 级即可），下一次升级或开补给箱时就会出现进化选项。进化后的武器会替换原武器，威力和外观都有明显变化。`,
    capsText: `一局最多同时携带 ${MAX_WEAPONS} 把武器和 ${MAX_PASSIVES} 件被动道具。武器最高 ${WEAPON_MAX_LEVEL} 级，被动道具最高 ${PASSIVE_TOP_LEVEL} 级（个别道具上限更低，见下表）。已经满级的不会再出现在升级选项里；栏位占满后也不再出现新的武器或道具，选项会变成已有物品的升级、进化，以及回血和晶核补给。`,
    col: {
      name: '名称',
      desc: '说明',
      partner: '进化搭档',
      evo: '进化形态',
      damage: '伤害（1 级 → 8 级 → 进化）',
      effect: '效果',
      maxLv: '最高等级',
      hp: '生命',
      speed: '速度',
      dmg: '接触伤害',
      xp: '经验',
      where: '出没星区',
      power: '火力',
      crit: '暴击率',
      dash: '冲刺冷却',
      start: '初始武器',
      unlock: '获取方式',
      cost: '价格',
      len: '时长',
      boss: 'Boss',
      reward: '晶核倍率',
      rank: '等级',
      perRank: '每级效果',
      total: '满级总价',
      level: '等级',
      enemyHp: '敌人血量',
      spawn: '刷怪量',
      cores: '晶核收益',
      target: '目标',
      prize: '奖励',
      usedBy: '搭档武器',
    },
    bossTips: {
      overseer: '核心思路是「先清场再输出」。护卫会一波波刷新，优先用范围武器清理；环形弹幕有固定缺口，贴着缺口穿过去；最终阶段的螺旋扫射要沿着旋转方向反向绕圈。冲刺留给它的冲锋。',
      fractal: '它会绕着你转并在地面上标出激光网格，红色预警消失前一定要离开标记区域。保持中距离，别被逼到角落；预警出现的瞬间优先判断「哪个方向的格子最空」。',
      maw: '虚空之喉会持续把你往它那边拖。别和引力对抗，沿着切线方向移动；扩散冲击环是最大的威胁——看到冲击环扩散时，对着它冲刺穿过去（冲刺无敌）。',
    },
    threatText: '威胁等级影响敌人血量、刷怪量和晶核收益。每个星区的更高威胁等级需要在前一档通关后解锁。至少通关一次某个星区后，可以在出击界面开启「无尽模式」：击败 Boss 后战斗继续，敌人会随时间不断变强。',
    metaText: '晶核是跨局货币：每局结算时获得（击杀、存活时间、等级、进化、击败 Boss 都会加成），可在机库购买永久升级。不满意可以随时全额退款重新分配。',
    sectorText: '每个星区在 10 分钟时迎来该星区的 Boss。通关一个星区会解锁下一个星区。',
    unitMin: '分钟',
    enemyHint: '数值为基础值，实际血量会随时间与威胁等级成长。',
  },
  about: {
    title: '关于《霓虹浪涌》— 设计理念、技术与更新记录',
    desc: '了解《霓虹浪涌》的设计理念、纯前端技术实现（TypeScript + Canvas 2D + WebAudio）和版本更新记录。',
    h1: '关于《霓虹浪涌》',
    paras: [
      '《霓虹浪涌》（NEON SURGE）是一款为浏览器而生的霓虹风生存肉鸽。我们希望做到的事很简单：<strong>打开网页，三秒钟之后就能开始一局</strong>，每一局十分钟左右，结束时总有一点东西留给下一局。',
      '游戏的核心循环是「走位 → 收集 → 三选一升级 → 进化 → 打 Boss → 带着晶核回到机库」。我们刻意让操作保持简单（只有移动和冲刺），把深度放在构筑选择、敌人行为的读取和 Boss 机制上。',
      '游戏为单人离线体验：没有广告，没有内购，没有账号系统，也不需要联网才能继续游玩。',
    ],
    techH: '技术实现',
    tech: [
      '纯前端：TypeScript + 自研 Canvas 2D 渲染器，没有使用任何游戏引擎或运行时依赖。',
      '模拟与渲染分离：游戏逻辑完全不依赖浏览器，可以在 Node 里让机器人把整局打完，用来校准难度曲线和排查数值问题。',
      '所有音乐与音效由 WebAudio 实时合成，不含任何音频文件；每个星区拥有自己的音阶、速度和分层编曲。',
      '画质自适应：根据帧率自动调整分辨率与特效；同时提供手动画质档位、减少闪烁与屏幕震动开关。',
      '托管在 Cloudflare Pages；Service Worker 让游戏在首次访问后可以离线运行，并在发布新版本时自动更新。',
    ],
    logH: '更新记录',
    log: [
      '<strong>v1.4</strong> — 画面质感重做：整套美术从“发光的霓虹线框”改为哑光硬表面——敌人、飞船、Boss 和拾取物都是带深色描边与明暗面的实心机体，只在灯位点一小粒自发光；子弹变成实心弹珠、碎片变成实心残骸，敌人脚下有接触阴影；泛光加了阈值，只有爆炸、光束这类真正的强光才会晕开，人潮里不再糊成一团粉雾；背景改为深色点阵地面；Boss 预警改为流动的斜纹警示带；界面去掉所有彩色外发光，按钮、卡片与图标底板改为带高光边和投影的哑光材质，伤害数字的光晕收窄；应用图标与分享图同步换成同一套风格。',
      '<strong>v1.3</strong> — 界面质感升级：伤害数字重做为渐变霓虹字形（细暗描边 + 贴字形的柔光，日常数字克制、重击才上色并带斜体与高光，不再有粗描边与感叹号）；进化横幅改为铭牌式（六边形徽章、金属渐变标题、扫光，自动避开顶部信息）并在演出中加入四周暗角聚焦，白闪只持续一瞬；整理手机与小屏的 HUD 版面，通知、教学提示、装备栏与冲刺键不再互相遮挡。',
      '<strong>v1.2</strong> — 打击感大升级：伤害数字扩展为 8 档梯度（字号、颜色、光晕随伤害逐级升级，暴击再升一档），一眼看出这一下有多重；武器进化新增完整演出——蓄力、整屏冲击波、慢动作、大横幅与音效，进化瞬间的冲击波还会清场并抹掉附近的敌方弹幕；进化后飞船周围有常驻光环，进化武器开火更有分量。',
      '<strong>v1.1</strong> — 新增武器「回旋飞轮」与「磁轨炮」（共 10 种）及各自的进化形态；升级卡片会标出本次新增的等级，并显示武器 / 被动栏位上限；修复手机上经验晶体与道具偶尔绕着飞机打转的问题。',
      '<strong>v1.0</strong> — 首个正式版本：3 个星区与 Boss、8 种武器与进化、12 种被动、4 艘飞船、机库、成就、无尽模式、中英双语、触屏与手柄支持。',
    ],
    creditsH: '致谢',
    credits: ['界面字体：Orbitron（SIL Open Font License）。', '图标与全部图形均为程序绘制。'],
  },
  privacy: {
    title: '隐私政策 — 霓虹浪涌',
    desc: '《霓虹浪涌》不收集个人信息，游戏存档只保存在你的浏览器本地。',
    h1: '隐私政策',
    updated: `最后更新：${TODAY}`,
    blocks: [
      { h: '我们收集什么', p: '游戏本身不收集、不上传任何个人信息。游戏没有账号系统，也不使用广告或第三方追踪脚本。' },
      { h: '本地存储', p: '为了保存你的进度（晶核、机库升级、成就、设置），游戏会在你的浏览器 localStorage 中写入一份存档。这份数据只存在于你的设备上，清除浏览器数据即可删除。你也可以在「设置」中导出、导入或重置存档。' },
      { h: 'Cookie', p: '游戏不设置 Cookie。' },
      { h: '托管与访问日志', p: '本站托管在 Cloudflare Pages。与大多数网站一样，托管服务商可能会在服务器层面记录基础的访问日志（例如 IP 地址、请求时间、浏览器类型），用于保障安全和统计流量，这些数据不由游戏读取或使用。' },
      { h: '未成年人', p: '游戏内容适合所有年龄段，不包含需要提供个人信息的功能。' },
      { h: '政策变更', p: '如果这份政策发生变化，我们会更新本页面并修改页首的更新日期。' },
    ],
  },
  notFound: { title: '页面不存在 · 霓虹浪涌', text: '你要找的页面不存在，也许它已经被霓虹浪潮吞没了。', back: '回到游戏' },
  footer: '免费在线游戏 · 无需下载 · 数据只保存在你的浏览器',
}

const EN: Copy = {
  htmlLang: 'en',
  locale: 'en_US',
  ogLocaleAlt: 'zh_CN',
  nav: { home: 'Play', guide: 'Guide', about: 'About', privacy: 'Privacy' },
  switchLabel: '中文',
  siteName: 'NEON SURGE',
  home: {
    title: 'NEON SURGE — Free Online Neon Roguelite Survival Game | Play in Browser',
    desc: 'NEON SURGE is a free browser neon roguelite survivor: auto-fire weapons, collect gems, level up and evolve your arsenal, and defeat three sector bosses. No download or sign-up. Works on desktop, mobile and gamepad.',
    h1: 'NEON SURGE: A Free Online Neon Roguelite Survival Game',
    lead: 'NEON SURGE is a top-down arena-survivor roguelite that runs right in your browser. Pilot a fighter into neon-drenched sectors: your weapons fire automatically, so all you have to do is move — collect gems, level up, evolve your weapons, and take down the sector boss within ten minutes. No download, no sign-up; play on desktop, mobile or with a gamepad.',
    ctaPlay: 'Play now',
    ctaGuide: 'Read the guide',
    featuresH: 'Features',
    features: [
      { icon: 'swords', color: '#3df2ff', title: 'Auto-fire, pure movement', text: 'No aiming — it is playable one-handed. The real challenge is finding a safe path through swarms and bullet patterns, then counter-attacking during your dash invincibility.' },
      { icon: 'dice', color: '#ffd84a', title: `${WEAPON_IDS.length} weapons × ${PASSIVE_IDS.length} passives`, text: 'Pulse cannon, orbit blades, arc lightning, missiles, prism laser, mines, nova, drones, chakram, railgun… every level-up offers a random pick of three, so each run becomes a different build.' },
      { icon: 'play', color: '#ff4fd8', title: 'Weapon evolution', text: 'Max out a weapon and carry its partner passive to evolve it into an ultimate form from a level-up or a supply chest — in both looks and power.' },
      { icon: 'skull', color: '#ff4a6a', title: '3 sectors, 3 bosses', text: 'The Overseer in Neon Fields, the Fractal Core in Data Wasteland, the Maw in Void Rift. Each boss has multi-phase patterns and a unique gimmick.' },
      { icon: 'hangar', color: '#a58bff', title: 'Permanent hangar upgrades', text: 'Spend cores on 13 permanent upgrades, unlock 4 distinct ships, climb 4 threat levels, and open endless mode after your first clear.' },
      { icon: 'gear', color: '#6dff8a', title: 'Touch, keyboard & gamepad', text: 'A floating touch joystick, WASD / arrow keys and gamepads are all supported natively. Adaptive quality keeps low-end devices smooth; saves are local and the game works offline.' },
      { icon: 'sound', color: '#3df2ff', title: 'Synthesized music & SFX', text: 'All music and sound effects are synthesized live with WebAudio — no audio files to download. Every sector has its own scale and tempo, and boss fights change the arrangement.' },
      { icon: 'trophy', color: '#ffd84a', title: `${ACHIEVEMENTS.length} achievements`, text: 'From “defeat 100 enemies in one run” to “clear Cataclysm difficulty”. Achievements pay out cores, and some unlock new ships.' },
    ],
    controlsH: 'Controls',
    controls: [
      { who: 'Keyboard', keys: 'WASD / arrow keys to move; Space / Shift to dash (invincible while dashing); Esc / P to pause; press 1 2 3 to pick a card, R to reroll, B to banish' },
      { who: 'Mobile / tablet', keys: 'Touch and drag on the left half of the screen to move (floating joystick; left-handed mode is in Settings); tap the bottom-right button to dash; tap the top-right button to pause. Landscape is recommended' },
      { who: 'Gamepad', keys: 'Left stick or D-pad to move; A / B / RB / RT to dash; Start to pause; in menus use the stick to navigate and A to confirm' },
    ],
    tipsH: 'Five tips for new pilots',
    tips: [
      '<strong>Keep moving.</strong> Standing still is the most dangerous thing you can do. Circle around the edge of the swarm and let your weapons clean up what follows.',
      '<strong>Grab the cyan gems first.</strong> XP is the only way to get stronger — but check your escape route before diving for a gem.',
      '<strong>Specialize in one main weapon.</strong> One heavily upgraded weapon beats a little of everything. Add its partner passive.',
      '<strong>Watch for evolution.</strong> A flashing golden frame in the bottom-left weapon bar means the next level-up or chest will offer the evolution.',
      '<strong>Dash with purpose.</strong> You are invincible while dashing — use it to cross boss rings or break out of encirclements, and don’t hoard it.',
    ],
    faqH: 'FAQ',
    faq: [
      { q: 'Is it free? Do I need to download or sign up?', a: 'It is completely free. Open the page and play — no download, no sign-up, no login.' },
      { q: 'Can I play on mobile?', a: 'Yes. The game has a floating joystick and a dash button for touch screens; landscape orientation feels best. iPhone Safari does not support web fullscreen, but you can “Add to Home Screen” for a near-fullscreen experience.' },
      { q: 'Where is my save stored? What about switching devices?', a: 'Your save lives in your browser’s local storage and is never uploaded. Clearing browser data deletes it. To move to another device, use Settings → Export save, then paste the text into Settings → Import save on the other device.' },
      { q: 'How do I evolve a weapon?', a: 'Level a weapon to the maximum (level 8) while owning its partner passive (any level). The evolution is then offered at your next level-up or supply chest. The full partner table is in the guide.' },
      { q: 'Is there a limit on weapons, passives and their levels?', a: `Yes. You can carry at most ${MAX_WEAPONS} weapons and ${MAX_PASSIVES} passives per run; weapons top out at level ${WEAPON_MAX_LEVEL} and passives at level ${PASSIVE_TOP_LEVEL}. Maxed items are never offered again, and once the slots are full no new weapons or passives show up. The level-up screen shows your current slots (e.g. 6/6) and each item's level, with maxed ones marked MAX.` },
      { q: 'The game feels laggy — what can I do?', a: 'Adaptive quality is on by default and lowers effects when the frame rate stays low. You can also set Settings → Quality to Medium or Low and turn off screen shake and damage numbers.' },
      { q: 'Why does the game pause when I switch tabs?', a: 'So that you are never defeated while the game is out of sight, the game pauses automatically when the tab is hidden or the window loses focus. Just press Resume when you return.' },
      { q: 'Is there an endless mode?', a: 'Yes. After clearing a sector once, an Endless Mode toggle unlocks on the deploy screen: the run continues after the boss falls and enemies keep growing stronger — see how long you can last.' },
    ],
    moreH: 'Learn more',
    moreText: 'Want evolution recipes, the bestiary, boss strategies and hangar prices? Read the',
  },
  guide: {
    title: 'Guide: Weapon Evolutions, Enemies, Boss Strategies & Upgrades — NEON SURGE',
    desc: `The complete NEON SURGE guide: evolution recipes for all ${WEAPON_IDS.length} weapons, ${PASSIVE_IDS.length} passives, the enemy bestiary, boss strategies, 4 ships, sectors, threat levels, hangar upgrade prices and every achievement.`,
    h1: 'NEON SURGE Guide',
    lead: 'Every number on this page is generated from the game’s real configuration, so it always matches the game. If you are new, start with “Weapons” and “Boss strategies”.',
    toc: 'Contents',
    sections: {
      evo: 'Evolution cheat sheet',
      weapons: 'Weapons',
      passives: 'Passives',
      enemies: 'Bestiary',
      bosses: 'Boss strategies',
      ships: 'Ships',
      sectors: 'Sectors',
      threat: 'Threat levels & endless mode',
      meta: 'Hangar (permanent upgrades)',
      ach: 'Achievements',
    },
    evoText: `Level any weapon to ${WEAPON_MAX_LEVEL} and own the partner passive listed in the table (level 1 is enough). The evolution is then offered at your next level-up or supply chest. The evolved weapon replaces the original with a clear boost in power and visuals.`,
    capsText: `You can carry at most ${MAX_WEAPONS} weapons and ${MAX_PASSIVES} passives at once. Weapons top out at level ${WEAPON_MAX_LEVEL}; passives at level ${PASSIVE_TOP_LEVEL} (a few have a lower cap — see the table below). Maxed items are never offered again, and once a slot group is full no new weapons or passives are offered either — your choices become upgrades or evolutions of what you already own, plus repair and core supplies.`,
    col: {
      name: 'Name',
      desc: 'Description',
      partner: 'Partner passive',
      evo: 'Evolved form',
      damage: 'Damage (Lv.1 → Lv.8 → evolved)',
      effect: 'Effect',
      maxLv: 'Max level',
      hp: 'HP',
      speed: 'Speed',
      dmg: 'Contact dmg',
      xp: 'XP',
      where: 'Found in',
      power: 'Power',
      crit: 'Crit',
      dash: 'Dash cooldown',
      start: 'Starting weapon',
      unlock: 'How to get',
      cost: 'Price',
      len: 'Length',
      boss: 'Boss',
      reward: 'Core multiplier',
      rank: 'Ranks',
      perRank: 'Per rank',
      total: 'Total to max',
      level: 'Level',
      enemyHp: 'Enemy HP',
      spawn: 'Spawn rate',
      cores: 'Core reward',
      target: 'Goal',
      prize: 'Reward',
      usedBy: 'Partner weapons',
    },
    bossTips: {
      overseer: 'Clear first, damage second. Escorts spawn in waves, so use area weapons on them. The ring patterns always have a gap — thread through it. In the final phase, circle against the spiral’s rotation, and save your dash for its charge.',
      fractal: 'It orbits you and marks a laser grid on the floor. Leave the marked cells before the red warning ends. Stay at medium range, avoid corners, and the moment a warning appears, look for the emptiest direction.',
      maw: 'The Maw keeps pulling you in. Don’t fight the gravity — move along the tangent. The expanding shock ring is the biggest threat: dash straight through it as it expands (you are invincible while dashing).',
    },
    threatText: 'Threat level scales enemy HP, spawn rate and core rewards. Each higher level of a sector unlocks after clearing the previous one. After clearing a sector once you can enable Endless Mode on the deploy screen: the run continues after the boss and enemies keep scaling up.',
    metaText: 'Cores are the cross-run currency: you earn them at the end of every run (kills, survival time, level, evolutions and boss kills all add up) and spend them on permanent upgrades. You can refund everything at any time and reallocate.',
    sectorText: 'Each sector’s boss arrives at the 10-minute mark. Clearing a sector unlocks the next one.',
    unitMin: 'min',
    enemyHint: 'Values are base stats; actual HP grows with time and threat level.',
  },
  about: {
    title: 'About NEON SURGE — Design, Technology & Changelog',
    desc: 'Learn about the design philosophy of NEON SURGE, its pure front-end technology (TypeScript + Canvas 2D + WebAudio) and the changelog.',
    h1: 'About NEON SURGE',
    paras: [
      'NEON SURGE is a neon survival roguelite made for the browser. The goal is simple: <strong>open the page and be playing within three seconds</strong>, with each run lasting about ten minutes and always leaving something behind for the next one.',
      'The core loop is “move → collect → pick one of three → evolve → fight the boss → bring cores back to the hangar”. Controls are deliberately minimal (just movement and dash); the depth lives in build choices, reading enemy behaviour and boss mechanics.',
      'It is a single-player offline experience: no ads, no in-app purchases, no accounts, and no connection needed to keep playing.',
    ],
    techH: 'Technology',
    tech: [
      'Pure front-end: TypeScript with a custom Canvas 2D renderer — no game engine and no runtime dependencies.',
      'Simulation is separated from rendering: the game logic does not depend on the browser, so bots can play whole runs in Node to calibrate the difficulty curve and catch numeric problems.',
      'All music and sound effects are synthesized live with WebAudio — no audio files. Every sector has its own scale, tempo and layered arrangement.',
      'Adaptive quality: resolution and effects adjust to the frame rate, with manual quality tiers and options to reduce flashing and screen shake.',
      'Hosted on Cloudflare Pages. A service worker makes the game playable offline after the first visit and updates it automatically on new releases.',
    ],
    logH: 'Changelog',
    log: [
      '<strong>v1.4</strong> — Visual overhaul: the whole art direction moves from glowing neon wireframes to matte hard-surface — enemies, ships, bosses and pickups are now opaque, shaded hulls with dark outlines and only a tiny emissive lamp where a light belongs; bullets are solid beads, debris is solid shrapnel and enemies cast contact shadows; bloom is thresholded so only real bright sources such as explosions and beams bleed light, and big crowds no longer melt into a pink haze; the backdrop becomes a dark dot-grid floor; boss warnings are drawn as flowing hazard stripes; the interface drops every coloured outer glow in favour of highlighted edges, drop shadows and matte tiles, and damage-number glows are tightened; the app icon and share image follow the same style.',
      '<strong>v1.3</strong> — UI polish: damage numbers are redrawn as gradient neon glyphs (thin dark outline plus a glow hugging the letterforms; everyday numbers stay restrained and only heavy hits get colour, slant and gloss — no more fat outlines or exclamation marks); the evolution banner becomes a nameplate (hex emblem, metallic title, sheen sweep) that stays clear of the top HUD, with a focus vignette during the cinematic and a much shorter white flash; the HUD layout on phones and small screens is reorganised so notifications, tutorial hints, the loadout and the dash button no longer overlap.',
      '<strong>v1.2</strong> — Big game-feel upgrade: damage numbers now come in 8 visual tiers (size, colour and glow scale up with damage, and crits jump one tier) so you can tell a heavy hit at a glance; weapon evolution gets a full cinematic — charge-up, screen-wide shockwave, slow motion, banner and sound — and the shockwave also clears nearby enemies and enemy bullets; evolved weapons leave a persistent aura around the ship and fire with more weight.',
      '<strong>v1.1</strong> — Two new weapons, Boomerang Chakram and Railgun (10 in total), each with its own evolution; level-up cards now highlight the newly gained level and show the weapon / passive slot caps; fixed XP gems and pickups sometimes orbiting the ship on phones.',
      '<strong>v1.0</strong> — First release: 3 sectors with bosses, 8 weapons with evolutions, 12 passives, 4 ships, hangar, achievements, endless mode, Chinese/English UI, touch and gamepad support.',
    ],
    creditsH: 'Credits',
    credits: ['UI font: Orbitron (SIL Open Font License).', 'All icons and graphics are drawn procedurally.'],
  },
  privacy: {
    title: 'Privacy Policy — NEON SURGE',
    desc: 'NEON SURGE collects no personal information. Your save data stays in your own browser.',
    h1: 'Privacy Policy',
    updated: `Last updated: ${TODAY}`,
    blocks: [
      { h: 'What we collect', p: 'The game itself does not collect or upload any personal information. There are no accounts, no ads and no third-party tracking scripts.' },
      { h: 'Local storage', p: 'To keep your progress (cores, hangar upgrades, achievements, settings) the game writes a save to your browser’s localStorage. It exists only on your device and is removed when you clear your browser data. You can also export, import or reset the save in Settings.' },
      { h: 'Cookies', p: 'The game does not set cookies.' },
      { h: 'Hosting and access logs', p: 'This site is hosted on Cloudflare Pages. As with most websites, the hosting provider may record basic access logs on the server side (such as IP address, request time and browser type) for security and traffic statistics. The game does not read or use this data.' },
      { h: 'Children', p: 'The game is suitable for all ages and has no features that require personal information.' },
      { h: 'Changes', p: 'If this policy changes we will update this page and the date at the top.' },
    ],
  },
  notFound: { title: 'Page not found · NEON SURGE', text: 'The page you are looking for does not exist — maybe the neon surge swallowed it.', back: 'Back to the game' },
  footer: 'Free online game · No download · Your data stays in your browser',
}

const COPY: Record<SiteLang, Copy> = { zh: ZH, en: EN }

// ───────────────────────── 通用模板 ─────────────────────────

const other = (l: SiteLang): SiteLang => (l === 'zh' ? 'en' : 'zh')
const abs = (p: string): string => `${SITE_URL}${p}`
const ico = (svg: string): string => svg

function head(l: SiteLang, page: PageKey, o: { title: string; desc: string; jsonld?: object[]; robots?: string }): string {
  const c = COPY[l]
  const url = abs(pagePath(l, page))
  const og = abs('/og-image.jpg')
  const alt = (lang: SiteLang): string => abs(pagePath(lang, page))
  const ld = (o.jsonld ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<meta name="theme-color" content="#05060d">
<meta name="color-scheme" content="dark">
${o.robots ? `<meta name="robots" content="${o.robots}">` : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="zh-CN" href="${alt('zh')}">
<link rel="alternate" hreflang="en" href="${alt('en')}">
<link rel="alternate" hreflang="x-default" href="${alt('zh')}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(c.siteName)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${c.locale}">
<meta property="og:locale:alternate" content="${c.ogLocaleAlt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.desc)}">
<meta name="twitter:image" content="${og}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
${ld}`
}

function nav(l: SiteLang, current: PageKey): string {
  const c = COPY[l]
  const link = (k: PageKey): string => `<a href="${pagePath(l, k)}"${k === current ? ' aria-current="page"' : ''}>${esc(c.nav[k])}</a>`
  return `<header class="site-nav">
<a class="brand" href="${pagePath(l, 'home')}">${ico(uiIcon('play'))}<span>NEON SURGE</span></a>
${PAGE_KEYS.map(link).join('\n')}
<a href="${pagePath(other(l), current)}" hreflang="${other(l) === 'zh' ? 'zh-CN' : 'en'}" lang="${other(l) === 'zh' ? 'zh-CN' : 'en'}">${esc(c.switchLabel)}</a>
</header>`
}

function footer(l: SiteLang): string {
  const c = COPY[l]
  return `<footer class="site-foot">
<nav aria-label="Footer">
${PAGE_KEYS.map((k) => `<a href="${pagePath(l, k)}">${esc(c.nav[k])}</a>`).join('\n')}
<a href="${pagePath(other(l), 'home')}" hreflang="${other(l) === 'zh' ? 'zh-CN' : 'en'}" lang="${other(l) === 'zh' ? 'zh-CN' : 'en'}">${esc(c.switchLabel)}</a>
</nav>
<p>© ${YEAR} NEON SURGE · ${esc(c.footer)}</p>
</footer>`
}

function doc(l: SiteLang, page: PageKey, o: { title: string; desc: string; body: string; jsonld?: object[] }): string {
  const c = COPY[l]
  return `<!doctype html>
<html lang="${c.htmlLang}">
<head>
${head(l, page, o)}
<link rel="stylesheet" href="/src/styles/main.css">
</head>
<body class="doc-page">
${nav(l, page)}
<main class="doc">
${o.body}
</main>
${footer(l)}
</body>
</html>
`
}

// ───────────────────────── 首页 ─────────────────────────

function homePage(l: SiteLang): string {
  const c = COPY[l]
  const h = c.home
  const url = abs(pagePath(l, 'home'))
  const guide = pagePath(l, 'guide')
  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: ZH.siteName,
      alternateName: ['NEON SURGE', '霓虹浪涌'],
      url,
      description: h.desc,
      image: abs('/og-image.jpg'),
      genre: ['Roguelite', 'Survival', 'Action', 'Arcade'],
      gamePlatform: ['Web Browser', 'Desktop', 'Mobile'],
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any (web browser)',
      playMode: 'SinglePlayer',
      inLanguage: ['zh-CN', 'en'],
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: h.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: c.siteName, url: abs('/'), inLanguage: ['zh-CN', 'en'] },
  ]
  const features = h.features
    .map((f) => `<article class="fcard" style="--c:${f.color}"><h3>${ico(uiIcon(f.icon as Parameters<typeof uiIcon>[0]))}${esc(f.title)}</h3><p>${esc(f.text)}</p></article>`)
    .join('\n')
  const controls = h.controls.map((k) => `<div><strong>${esc(k.who)}</strong><span>${esc(k.keys)}</span></div>`).join('\n')
  const noscript = esc(T(l, 'page.noscript'))

  return `<!doctype html>
<html lang="${c.htmlLang}">
<head>
${head(l, 'home', { title: h.title, desc: h.desc, jsonld })}
</head>
<body>
<div id="stage" class="stage">
<canvas id="c" role="img" aria-label="${esc(c.siteName)}"></canvas>
<div id="ui"></div>
<div class="boot" aria-hidden="true">NEON SURGE</div>
<noscript><div class="noscript">${noscript}</div></noscript>
</div>
<div class="home-doc">
<main class="doc">
<h1>${esc(h.h1)}</h1>
<p class="lead">${esc(h.lead)}</p>
<div class="cta-row">
<a class="btn primary lg" href="#stage">${esc(h.ctaPlay)}</a>
<a class="btn lg" href="${guide}">${esc(h.ctaGuide)}</a>
</div>
<h2>${esc(h.featuresH)}</h2>
<div class="grid-cards">
${features}
</div>
<h2>${esc(h.controlsH)}</h2>
<div class="keys">
${controls}
</div>
<h2>${esc(h.tipsH)}</h2>
<ol>
${h.tips.map((t) => `<li>${t}</li>`).join('\n')}
</ol>
<h2>${esc(h.faqH)}</h2>
<div class="faq">
${h.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}
</div>
<h2>${esc(h.moreH)}</h2>
<p>${esc(h.moreText)} <a href="${guide}">${esc(c.nav.guide)}</a> · <a href="${pagePath(l, 'about')}">${esc(c.nav.about)}</a> · <a href="${pagePath(l, 'privacy')}">${esc(c.nav.privacy)}</a></p>
</main>
${footer(l)}
</div>
<script type="module" src="/src/main.ts"></script>
</body>
</html>
`
}

// ───────────────────────── 指南页（数据驱动） ─────────────────────────

function guidePage(l: SiteLang): string {
  const c = COPY[l]
  const g = c.guide
  const col = g.col
  const name = (kind: string, id: string): string => T(l, `${kind}.${id}.name`)
  const sectorName = (id: string): string => T(l, `sector.${id}.name`)
  const th = (cells: string[]): string => `<tr>${cells.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>`
  const table = (head: string[], rows: string[]): string => `<div class="tbl-wrap"><table class="tbl"><thead>${th(head)}</thead><tbody>${rows.join('\n')}</tbody></table></div>`
  const nm = (icon: string, text: string, color: string): string => `<div class="nm" style="--c:${color}">${icon}<span>${esc(text)}</span></div>`

  // 武器
  const dmgLine = (id: (typeof WEAPON_IDS)[number]): string => {
    const w = WEAPONS[id]
    const a = w.stats(1, false)
    const b = w.stats(WEAPON_MAX_LEVEL, false)
    const e = w.stats(WEAPON_MAX_LEVEL, true)
    const per = (s: typeof a): string => (id === 'mine' || id === 'nova' || id === 'laser' ? num(s.damage) : s.count > 1 ? `${num(s.damage)}×${num(s.count)}` : num(s.damage))
    return `${per(a)} → ${per(b)} → ${per(e)}`
  }
  const weaponRows = WEAPON_IDS.map((id) => {
    const w = WEAPONS[id]
    return `<tr><td>${nm(weaponIcon(id), name('weapon', id), w.color)}</td><td>${esc(T(l, `weapon.${id}.desc`))}</td><td>${dmgLine(id)}</td><td><span class="pill">${esc(name('passive', w.evolvesWith))}</span></td><td><strong>${esc(T(l, `weapon.${id}.evoName`))}</strong><br>${esc(T(l, `weapon.${id}.evoDesc`))}</td></tr>`
  })
  const evoRows = WEAPON_IDS.map((id) => {
    const w = WEAPONS[id]
    const p = PASSIVES[w.evolvesWith]
    return `<tr><td>${nm(weaponIcon(id), name('weapon', id), w.color)}</td><td>${nm(passiveIcon(w.evolvesWith), name('passive', w.evolvesWith), p.color)}</td><td><strong>${esc(T(l, `weapon.${id}.evoName`))}</strong></td></tr>`
  })

  // 被动
  const passiveRows = PASSIVE_IDS.map((id) => {
    const p = PASSIVES[id]
    const partners = WEAPON_IDS.filter((w) => WEAPONS[w].evolvesWith === id)
    const maxText = `${formatPassiveValue(p, p.maxLevel)}`
    return `<tr><td>${nm(passiveIcon(id), name('passive', id), p.color)}</td><td>${esc(T(l, `passive.${id}.desc`))} <span class="pill">${esc(`${col.perRank}: ${formatPassiveValue(p, 1)}`)}</span> <span class="pill">${esc(`${col.maxLv} ${p.maxLevel}: ${maxText}`)}</span></td><td>${partners.map((w) => `<span class="pill gold">${esc(name('weapon', w))}</span>`).join(' ') || '—'}</td></tr>`
  })

  // 敌人
  const enemyRows = ENEMY_IDS.map((id) => {
    const e = ENEMIES[id]
    const where = SECTOR_IDS.filter((s) => SECTORS[s].roster.some((r) => r.id === id)).map((s) => `<span class="pill">${esc(sectorName(s))}</span>`)
    return `<tr><td>${nm(enemyIcon(e.shape), name('enemy', id), e.color)}</td><td>${esc(T(l, `enemy.${id}.desc`))}</td><td>${e.hp}</td><td>${e.speed}</td><td>${e.dmg}</td><td>${where.join(' ') || '—'}</td></tr>`
  })

  // Boss
  const bossCards = BOSS_IDS.map((id) => {
    const sec = SECTOR_IDS.find((s) => SECTORS[s].boss === id)!
    const color = SECTORS[sec].palette.accent
    return `<article class="fcard" style="--c:${color}"><h3>${ico(uiIcon('skull'))}${esc(name('boss', id))}</h3><p><span class="pill">${esc(sectorName(sec))}</span> <span class="pill">${Math.round(SECTORS[sec].length / 60)} ${esc(g.unitMin)}</span></p><p>${esc(T(l, `boss.${id}.desc`))}</p><p><strong>${esc(g.bossTips[id] ?? '')}</strong></p></article>`
  })

  // 飞船
  const shipRows = SHIP_IDS.map((id) => {
    const s = SHIPS[id]
    const unlock = s.unlockAch
      ? `${esc(T(l, `ach.${s.unlockAch}.name`))} / ${esc(n0(s.cost))} ${esc(T(l, 'common.cores'))}`
      : esc(T(l, 'common.owned'))
    return `<tr><td>${nm(shipIcon(id), name('ship', id), s.color)}<small>${esc(T(l, `ship.${id}.tag`))}</small></td><td>${esc(T(l, `ship.${id}.desc`))}</td><td>${s.hp}</td><td>${s.speed}</td><td>×${s.dmg}</td><td>${Math.round(s.crit * 100)}%</td><td>${s.dashCd}s</td><td>${nm(weaponIcon(s.startWeapon), name('weapon', s.startWeapon), WEAPONS[s.startWeapon].color)}</td><td>${unlock}</td></tr>`
  })

  // 星区
  const sectorRows = SECTOR_IDS.map((id) => {
    const s = SECTORS[id]
    const roster = [...new Set(s.roster.map((r) => r.id))].map((e) => `<span class="pill">${esc(name('enemy', e))}</span>`)
    return `<tr><td><div class="nm" style="--c:${s.palette.accent}"><span>${esc(sectorName(id))}</span></div></td><td>${esc(T(l, `sector.${id}.desc`))}</td><td>${esc(name('boss', s.boss))}</td><td>${Math.round(s.length / 60)} ${esc(g.unitMin)}</td><td>×${s.reward}</td><td>${roster.join(' ')}</td></tr>`
  })

  // 威胁等级
  const threatRows = THREAT_LEVELS.map((t, i) => `<tr><td><strong>${esc(T(l, `threat.${i}.name`))}</strong></td><td>×${t.hp}</td><td>×${t.spawn}</td><td>×${t.reward}</td></tr>`)

  // 机库
  const metaRows = META_IDS.map((id) => {
    const m = METAS[id]
    let total = 0
    for (let r = 0; r < m.max; r++) total += metaCost(m, r)
    return `<tr><td>${nm(uiIcon('hangar'), name('meta', id), m.color)}</td><td>${esc(T(l, `meta.${id}.desc`))}</td><td>${m.max}</td><td>${esc(formatMetaValue(m, 1))}</td><td>${esc(formatMetaValue(m, m.max))}</td><td>${esc(n0(total))}</td></tr>`
  })

  // 成就
  const achRows = ACHIEVEMENTS.map((a) => {
    const ship = SHIP_IDS.find((s) => SHIPS[s].unlockAch === a.id)
    const extra = ship ? ` <span class="pill gold">${esc(T(l, 'ach.shipHint', { name: name('ship', ship) }))}</span>` : ''
    return `<tr><td><strong>${esc(T(l, `ach.${a.id}.name`))}</strong></td><td>${esc(T(l, `ach.${a.id}.desc`, { n: n0(a.target) }))}${extra}</td><td>${esc(T(l, 'ach.reward', { n: a.reward }))}</td></tr>`
  })

  const toc = (['evo', 'weapons', 'passives', 'enemies', 'bosses', 'ships', 'sectors', 'threat', 'meta', 'ach'] as const).map((k) => `<a class="pill" href="#${k}">${esc(g.sections[k])}</a>`).join(' ')

  const body = `<h1>${esc(g.h1)}</h1>
<p class="lead">${esc(g.lead)}</p>
<p><strong>${esc(g.toc)}：</strong> ${toc}</p>

<h2 id="evo">${esc(g.sections.evo)}</h2>
<p>${esc(g.evoText)}</p>
<p>${esc(g.capsText)}</p>
${table([col.name, col.partner, col.evo], evoRows)}

<h2 id="weapons">${esc(g.sections.weapons)}</h2>
${table([col.name, col.desc, col.damage, col.partner, col.evo], weaponRows)}

<h2 id="passives">${esc(g.sections.passives)}</h2>
${table([col.name, col.effect, col.usedBy], passiveRows)}

<h2 id="enemies">${esc(g.sections.enemies)}</h2>
<p>${esc(g.enemyHint)}</p>
${table([col.name, col.desc, col.hp, col.speed, col.dmg, col.where], enemyRows)}

<h2 id="bosses">${esc(g.sections.bosses)}</h2>
<div class="grid-cards">
${bossCards.join('\n')}
</div>

<h2 id="ships">${esc(g.sections.ships)}</h2>
${table([col.name, col.desc, col.hp, col.speed, col.power, col.crit, col.dash, col.start, col.unlock], shipRows)}

<h2 id="sectors">${esc(g.sections.sectors)}</h2>
<p>${esc(g.sectorText)}</p>
${table([col.name, col.desc, col.boss, col.len, col.reward, col.where], sectorRows)}

<h2 id="threat">${esc(g.sections.threat)}</h2>
<p>${esc(g.threatText)}</p>
${table([col.level, col.enemyHp, col.spawn, col.cores], threatRows)}

<h2 id="meta">${esc(g.sections.meta)}</h2>
<p>${esc(g.metaText)}</p>
${table([col.name, col.effect, col.rank, col.perRank, col.maxLv, col.total], metaRows)}

<h2 id="ach">${esc(g.sections.ach)}</h2>
${table([col.name, col.desc, col.prize], achRows)}

<div class="cta-row"><a class="btn primary lg" href="${pagePath(l, 'home')}">${esc(c.home.ctaPlay)}</a></div>`

  return doc(l, 'guide', {
    title: g.title,
    desc: g.desc,
    body,
    jsonld: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: g.h1,
        description: g.desc,
        inLanguage: c.htmlLang,
        dateModified: TODAY,
        mainEntityOfPage: abs(pagePath(l, 'guide')),
        image: abs('/og-image.jpg'),
        author: { '@type': 'Organization', name: ZH.siteName },
        publisher: { '@type': 'Organization', name: ZH.siteName },
      },
    ],
  })
}

function aboutPage(l: SiteLang): string {
  const a = COPY[l].about
  const body = `<h1>${esc(a.h1)}</h1>
${a.paras.map((p, i) => `<p${i === 0 ? ' class="lead"' : ''}>${p}</p>`).join('\n')}
<h2>${esc(a.techH)}</h2>
<ul>${a.tech.map((x) => `<li>${esc(x)}</li>`).join('\n')}</ul>
<h2>${esc(a.logH)}</h2>
<ul>${a.log.map((x) => `<li>${x}</li>`).join('\n')}</ul>
<h2>${esc(a.creditsH)}</h2>
<ul>${a.credits.map((x) => `<li>${esc(x)}</li>`).join('\n')}</ul>
<div class="cta-row"><a class="btn primary lg" href="${pagePath(l, 'home')}">${esc(COPY[l].home.ctaPlay)}</a></div>`
  return doc(l, 'about', { title: a.title, desc: a.desc, body })
}

function privacyPage(l: SiteLang): string {
  const p = COPY[l].privacy
  const body = `<h1>${esc(p.h1)}</h1>
<p class="lead">${esc(p.updated)}</p>
${p.blocks.map((b) => `<h2>${esc(b.h)}</h2>\n<p>${esc(b.p)}</p>`).join('\n')}`
  return doc(l, 'privacy', { title: p.title, desc: p.desc, body })
}

function notFoundPage(): string {
  const z = ZH.notFound
  const e = EN.notFound
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(z.title)}</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#05060d">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/src/styles/main.css">
</head>
<body class="doc-page">
<main class="doc" style="min-height:70vh;display:grid;align-content:center;text-align:center">
<h1>404</h1>
<p class="lead">${esc(z.text)}<br>${esc(e.text)}</p>
<div class="cta-row" style="justify-content:center"><a class="btn primary lg" href="/">${esc(z.back)}</a><a class="btn lg" href="/en/">${esc(e.back)}</a></div>
</main>
</body>
</html>
`
}

// ───────────────────────── sitemap / robots ─────────────────────────

function sitemap(): string {
  const urls = (['zh', 'en'] as SiteLang[]).flatMap((l) =>
    PAGE_KEYS.map((k) => {
      const loc = abs(pagePath(l, k))
      const pri = k === 'home' ? '1.0' : k === 'guide' ? '0.8' : '0.4'
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${k === 'home' || k === 'guide' ? 'weekly' : 'monthly'}</changefreq>
    <priority>${pri}</priority>
    <xhtml:link rel="alternate" hreflang="zh-CN" href="${abs(pagePath('zh', k))}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${abs(pagePath('en', k))}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(pagePath('zh', k))}"/>
  </url>`
    }),
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`
}

const robots = (): string => `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`

// ───────────────────────── 写文件 ─────────────────────────

function write(rel: string, content: string): void {
  const file = resolve(root, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

for (const l of ['zh', 'en'] as SiteLang[]) {
  write(pageFile(l, 'home'), homePage(l))
  write(pageFile(l, 'guide'), guidePage(l))
  write(pageFile(l, 'about'), aboutPage(l))
  write(pageFile(l, 'privacy'), privacyPage(l))
}
write('404.html', notFoundPage())
write('public/sitemap.xml', sitemap())
write('public/robots.txt', robots())
console.log(`gen-pages: ${PAGE_KEYS.length * 2 + 1} pages + sitemap + robots`)
