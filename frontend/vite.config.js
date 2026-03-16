import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/find-parking": "http://localhost:8000",
      "/areas": "http://localhost:8000",
      "/meters": "http://localhost:8000",
      "/meter": "http://localhost:8000",
      "/health": "http://localhost:8000",
      "/resolve-location": "http://localhost:8000",
      "/refresh": "http://localhost:8000",
      "/citation-hotspots": "http://localhost:8000",
    },
  },
});
