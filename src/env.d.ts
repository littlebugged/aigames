/// <reference types="vite/client" />

/** 构建号（vite define 注入）：本地为 git 短提交号，Cloudflare Pages 上为部署的提交号。 */
declare const __BUILD_ID__: string
