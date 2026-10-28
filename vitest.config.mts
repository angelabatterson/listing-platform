import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path("./src"),
      "server-only": path("./tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    // Database tests share one database, so test files run one at a time.
    fileParallelism: false,
    env: {
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      // Unit tests never connect. Database tests use TEST_DATABASE_URL (see README).
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://unused@localhost:1/unused",
      EBAY_CLIENT_ID: "client",
      EBAY_CLIENT_SECRET: "secret",
      EBAY_RUNAME: "ru-name",
      ETSY_KEYSTRING: "etsykey",
      ETSY_SHARED_SECRET: "etsysecret",
      APP_URL: "https://app.example",
    },
  },
});
