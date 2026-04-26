/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SNIPR_APP_ORIGIN: string;
  readonly VITE_SNIPR_API_ORIGIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
