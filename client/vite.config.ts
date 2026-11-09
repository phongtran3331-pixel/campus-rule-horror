import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GH_PAGES ? "/campus-rule-horror/" : "/",
  plugins: [react()],
  server: {
    // Colyseus 直连 ws://<host>:2567，无需代理
  },
});
