import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fakeApi } from './dev/fakeApi.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const useFakeApi = env.VITE_FAKE_API === 'true'

  return {
    plugins: [react(), useFakeApi && fakeApi()],
    server: {
      // Lokalnie /api trafia do FastAPI – tak samo jak Nginx robi to w chmurze.
      // Z VITE_FAKE_API=true odpowiada udawane API z dev/fakeApi.ts.
      proxy: useFakeApi ? undefined : { '/api': 'http://localhost:8000' },
    },
  }
})
