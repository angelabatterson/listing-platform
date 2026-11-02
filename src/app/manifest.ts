import type { MetadataRoute } from "next";

// Lets sellers add Relistic to their phone's home screen, where it opens like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Relistic",
    short_name: "Relistic",
    description: "List once, sell everywhere, and keep every store in sync.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#18181b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
