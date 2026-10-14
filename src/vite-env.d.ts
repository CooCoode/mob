/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MOBD_URL?: string;
  readonly VITE_MOBD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
