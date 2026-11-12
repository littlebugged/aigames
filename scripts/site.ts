/** 站点级常量：域名、页面清单。构建脚本与 vite 配置共用。 */

export const SITE_URL = 'https://aigames.de5.net'

export type PageKey = 'home' | 'guide' | 'about' | 'privacy'
export type SiteLang = 'zh' | 'en'

export const PAGE_KEYS: PageKey[] = ['home', 'guide', 'about', 'privacy']

/** 页面的站内路径（以 / 结尾，中文为默认语言放在根路径） */
export function pagePath(lang: SiteLang, page: PageKey): string {
  const base = lang === 'zh' ? '/' : '/en/'
  return page === 'home' ? base : `${base}${page}/`
}

/** 页面对应的 HTML 文件（相对项目根目录，用作 Vite 多页面入口） */
export function pageFile(lang: SiteLang, page: PageKey): string {
  return pagePath(lang, page).slice(1) + 'index.html'
}

export const HTML_ENTRIES: string[] = [
  ...(['zh', 'en'] as SiteLang[]).flatMap((l) => PAGE_KEYS.map((p) => pageFile(l, p))),
  '404.html',
]
