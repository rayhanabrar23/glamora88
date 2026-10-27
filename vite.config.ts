import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          excel: ['read-excel-file'],
        },
      },
    },
  },
  server: {
    // saat `npm run dev`, API diteruskan ke `wrangler dev` (port 8788)
    proxy: { '/api': 'http://localhost:8788' },
  },
})
