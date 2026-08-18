import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // wrangler.jsonc の assets.directory がここを指す
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // ローカルでは API だけ wrangler dev (8787) に投げる
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/img": "http://127.0.0.1:8787",
      "/hooks": "http://127.0.0.1:8787",
    },
  },
});
