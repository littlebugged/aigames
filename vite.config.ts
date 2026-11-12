import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { HTML_ENTRIES } from './scripts/site.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

/** 构建号：优先用 Cloudflare Pages 注入的提交号，其次本地 git，最后用时间戳。 */
function buildId(): string {
  const cf = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 8)
  if (cf) return cf
  try {
    return execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return Date.now().toString(36)
  }
}

const BUILD_ID = buildId()

/**
 * 构建产物里追加 version.json（部署探测）与 sw.js（带构建号和预缓存清单）。
 * 必须在 writeBundle 里做：此时 Vite 已经剔除了 HTML 入口产生的空占位 chunk，
 * 预缓存清单只会包含磁盘上真实存在的文件（否则一个 404 就会让 cache.addAll 整体失败）。
 */
function releaseFiles(): Plugin {
  return {
    name: 'neon-release-files',
    apply: 'build',
    writeBundle(opts, bundle) {
      const dir = opts.dir ?? resolve(root, 'dist')
      const assets = Object.keys(bundle)
        .filter((f) => /\.(js|css|woff2)$/.test(f))
        .filter((f) => existsSync(resolve(dir, f)))
        .map((f) => `/${f}`)
      const precache = ['/', '/en/', ...assets]
      const tpl = readFileSync(resolve(root, 'scripts/sw.template.js'), 'utf8')
      writeFileSync(resolve(dir, 'sw.js'), tpl.replace('__BUILD_ID__', BUILD_ID).replace('__PRECACHE__', JSON.stringify(precache)))
      writeFileSync(resolve(dir, 'version.json'), JSON.stringify({ id: BUILD_ID, builtAt: new Date().toISOString() }))
    },
  }
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [releaseFiles()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: Object.fromEntries(HTML_ENTRIES.map((f) => [f.replace(/\/?index\.html$/, '').replace(/\.html$/, '') || 'index', resolve(root, f)])),
    },
  },
})
