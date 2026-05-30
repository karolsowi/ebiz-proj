/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PYTHON_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
