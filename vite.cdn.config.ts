// Production build that loads React / Router / Supabase from a CDN (import map in index.html)
// and the logo from the main site, so the uploaded bundle is only the app's own code.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const LOGOS: Record<string, string> = {
  "leadnest-logo.webp": "https://leadnestmarketingco.com/assets/leadnest-logo.webp",
  "leadnest-logo-white.webp": "https://leadnestmarketingco.com/assets/leadnest-logo-white.webp",
};
const remoteLogos = (): Plugin => ({
  name: "remote-logos",
  enforce: "pre",
  resolveId(id) { const k = Object.keys(LOGOS).find((n) => id.endsWith(n)); return k ? "\0logo:" + k : null; },
  load(id) { return id.startsWith("\0logo:") ? `export default ${JSON.stringify(LOGOS[id.slice(6)])};` : null; },
});

export default defineConfig({
  plugins: [remoteLogos(), react()],
  publicDir: false,
  build: {
    outDir: "dist-cdn",
    emptyOutDir: true,
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "react-router-dom", "@supabase/supabase-js"],
      output: { entryFileNames: "assets/app-[hash].js", assetFileNames: "assets/app-[hash][extname]" },
    },
  },
});
