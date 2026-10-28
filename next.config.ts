import type { NextConfig } from "next";

// Every page in this app is per-account and dynamic, so Cache Components
// (and partial prefetching, which builds on it) are left off for now.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
