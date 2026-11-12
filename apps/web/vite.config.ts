import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Content-Security-Policy for the published site (build only; the dev server needs
 * inline scripts). Scripts come only from this site, so an injected <script> can't
 * run and read the session stored in this browser.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "cloudpilot-csp",
  apply: "build",
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
});

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/cloudpilot/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), csp()],
  // No source maps in the published site.
  build: { target: "es2022", sourcemap: false },
});
