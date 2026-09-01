import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png"],
      manifest: {
        name: "AudioHub",
        short_name: "AudioHub",
        description: "Personal audio library and player",
        display: "standalone",
        start_url: "/",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Never let the service worker intercept streamed audio or API calls — Range requests
        // and SW-managed caching interact badly, and audio content should never be cached here.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\/.*\/stream$/,
            handler: "NetworkOnly",
          },
          {
            // Cover art is small and immutable per scan — safe (and useful) to cache; matched
            // before the generic /api/ catch-all below, since Workbox uses first-match-wins.
            urlPattern: /\/api\/(files|folders)\/\d+\/cover$/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "cover-images" },
          },
          {
            urlPattern: /\/api\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8420",
        changeOrigin: true,
      },
    },
  },
});
