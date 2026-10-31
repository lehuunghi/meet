import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-ignore build-time Babel plugin
import uiTextPlugin from "./ui-text-plugin.mjs";
export default defineConfig({
  plugins: [react({ babel: { plugins: [uiTextPlugin] } })],
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
});
