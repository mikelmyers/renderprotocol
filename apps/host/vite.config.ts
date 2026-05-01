import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and forwards to it from the WebView.
// HMR over that channel is what gives us instant React iteration.
const HOST = "127.0.0.1";
const PORT = 5173;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: HOST,
    port: PORT,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: HOST,
      port: PORT,
    },
    watch: {
      // Tauri watches src-tauri itself; ignore from Vite to avoid double rebuilds.
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
}));
