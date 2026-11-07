/// <reference types="vite/client" />

// Zmienne VITE_* wkompilowywane w build (wzory w .env.example).
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_FAKE_API?: string
  /** SHA commita wdrożonej wersji; ustawia deploy.yml. */
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
