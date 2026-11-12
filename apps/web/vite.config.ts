import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/cloudpilot/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  build: { target: "es2022", sourcemap: true },
});
