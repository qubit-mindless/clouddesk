export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api'

// SHA commita wdrożonej wersji – ustawiany w buildzie przez CD (deploy.yml); lokalnie „local”.
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'local'
