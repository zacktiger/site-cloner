import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// One dev server hosts every generated site: sites/<id>/index.html is served at /<id>/.
// All sites share this folder's node_modules, so a new clone needs no `npm install`.
export default defineConfig({
  root: "sites",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react"],
  },
});
