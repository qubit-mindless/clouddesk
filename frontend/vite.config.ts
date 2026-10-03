import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Lokalnie /api trafia do FastAPI – tak samo jak Nginx robi to w chmurze.
    proxy: { '/api': 'http://localhost:8000' },
  },
})
