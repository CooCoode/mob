import { defineConfig } from "vite";
// @ts-expect-error process types without @types/node
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  clearScreen: false,
  envPrefix: ["VITE_", "MOBD_", "VNC_"],
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
