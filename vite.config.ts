import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        home: 'index.html',
        'neon-dash': 'games/neon-dash/index.html',
        snake: 'games/snake/index.html',
        'star-vanguard': 'games/star-vanguard/index.html',
      },
    },
  },
})
